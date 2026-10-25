import {
	type Artifact,
	type AuditReport,
	type BeatTime,
	type CompletionReport,
	CompletionPolicy,
	CONNECTION_KINDS,
	type NarrativeConnection,
	type ProjectGraph,
	type Transition,
	type Triangle,
	type ValidationIssue
} from '@tlon/contracts';

import { chronologicalOrder } from './chronology.ts';
import { layoutPyramid } from './pyramid.ts';

type GraphLike = Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'> & {
	triangles?: readonly Triangle[];
};

export type StoryBeat = {
	index: number;
	artifact: Artifact;
	/** 0 = authored by A/B (or the human); n = bridge at expansion depth n. */
	depth: number;
};

/** Triangles that still shape the story: everything except rejected and superseded ones. */
export const activeTriangles = (triangles: readonly Triangle[] | undefined): Triangle[] =>
	(triangles ?? []).filter((t) => t.status !== 'rejected' && t.status !== 'superseded');

/**
 * The scenario as one reading order: Blocks and accepted legacy bridges sorted by
 * their position on the pyramid's base axis (in-order traversal of every expansion
 * tree). Rejected artifacts, open candidates, disclosure notes, composites and Facts
 * (atemporal connectors, ADR 0011) are left out.
 */
export function storyBeats(graph: GraphLike): StoryBeat[] {
	// Disclosure notes, composites and Facts are structure around the story, not beats.
	const excluded = new Set(
		graph.artifacts
			.filter(
				(a) =>
					(a.ownerScope === 'C_SHARED' && a.kind === 'NOTE') ||
					a.composition === 'COMPOSITE' ||
					a.artifactClass === 'FACT'
			)
			.map((a) => a.id)
	);
	const byId = new Map(graph.artifacts.map((a) => [a.id, a]));
	return layoutPyramid(graph)
		.nodes.filter((n) => n.role !== 'candidate' && n.role !== 'fact' && !excluded.has(n.artifactId))
		.toSorted((a, b) => a.x - b.x || a.y - b.y)
		.flatMap((n) => {
			const artifact = byId.get(n.artifactId);
			return artifact ? [{ artifact, depth: n.depth }] : [];
		})
		.map((beat, i) => ({ ...beat, index: i + 1 }));
}

const SOURCE: Record<string, string> = {
	A: 'author A',
	B: 'author B',
	C: 'bridge',
	HUMAN: 'human'
};

const SIDE_LABEL: Record<string, string> = { A_PRIVATE: 'A', B_PRIVATE: 'B' };

export type StoryRenderOptions = {
	annotations?: boolean;
	/** `presentation` (default) = protocol reading order; `chronological` = story time of dated Blocks. */
	order?: 'presentation' | 'chronological';
	/** Beat annotations by artifact id: needed for the chronological order and time/entity notes. */
	transitions?: ReadonlyMap<string, Transition>;
	connections?: readonly NarrativeConnection[];
	completion?: CompletionReport;
	audit?: AuditReport;
	/** Continuity issues (already merged with dismissals); open blockers/warnings get an organizer section. */
	issues?: readonly ValidationIssue[];
};

const formatTime = (time: BeatTime) => {
	const parts: string[] = [];
	if (time.year !== undefined) {
		const two = (n: number) => String(n).padStart(2, '0');
		const date = [`${time.yearApprox ? '~' : ''}${time.year}`];
		if (time.month !== undefined) date.push(two(time.month));
		if (time.month !== undefined && time.dayOfMonth !== undefined) date.push(two(time.dayOfMonth));
		parts.push(date.join('-'));
	} else if (time.month !== undefined) {
		parts.push(
			time.dayOfMonth === undefined
				? `month ${time.month}`
				: `month ${time.month}, day ${time.dayOfMonth}`
		);
	}
	if (time.day !== undefined) parts.push(`day ${time.day}`);
	if (time.minute !== undefined) {
		parts.push(
			`${String(Math.floor(time.minute / 60)).padStart(2, '0')}:${String(time.minute % 60).padStart(2, '0')}`
		);
	}
	if (time.relative !== undefined) {
		const dated = parts.length > 0;
		parts.push(`relative: “${time.relative}”${dated ? '' : ' (absolute date unknown)'}`);
	}
	return parts.join(' · ');
};

const yamlText = (text: string) => JSON.stringify(text);

/**
 * Markdown manuscript for readers outside the tool (e.g. script editors): numbered
 * beats with time/place and prose, optionally annotated with who wrote each beat and,
 * for bridges, the mechanism and assumptions it relies on. Block–Fact projects also get
 * their Facts (labelled as fact links, never as causal claims); organizer exports may
 * add connections, the completion report and an ID-level isolation audit.
 * Headings always carry the PRESENTATION number, whatever order is shown, so cross
 * references (`#n`) stay valid in the chronological view.
 */
export function renderStoryMarkdown(graph: GraphLike, options: StoryRenderOptions = {}): string {
	const beats = storyBeats(graph);
	const triangles = activeTriangles(graph.triangles);
	const blockFact = triangles.length > 0;
	const order = options.order ?? 'presentation';
	const transitions = options.transitions ?? new Map<string, Transition>();
	const byId = new Map(graph.artifacts.map((a) => [a.id, a]));
	const number = new Map(beats.map((b) => [b.artifact.id, b.index]));
	const ref = (id: string) =>
		number.has(id) ? `#${number.get(id)}` : `“${byId.get(id)?.title ?? '?'}”`;

	const orderLabel =
		order === 'chronological'
			? 'chronological (dated Blocks by story time, undated after in reading order)'
			: blockFact
				? 'presentation (protocol reading order: A forward, then B written backward from its seed)'
				: 'presentation (reading order)';
	const chrono = chronologicalOrder(beats, transitions);
	const shown =
		order === 'chronological' ? [...chrono.dated, ...chrono.undated].map((e) => e.beat) : beats;

	const lines = [`# ${graph.project.name}`, ''];
	if (options.annotations && blockFact) {
		const sideCount = (scope: string) =>
			beats.filter((b) => b.artifact.ownerScope === scope).length;
		const other = beats.length - sideCount('A_PRIVATE') - sideCount('B_PRIVATE');
		const facts = triangles.filter((t) => t.fact !== null);
		const lastStage = Math.max(
			1,
			...triangles.map((t) => t.stageIndex + (t.continuations.length > 0 ? 1 : 0))
		);
		lines.push(
			`_${beats.length} Blocks (A ${sideCount('A_PRIVATE')}, B ${sideCount('B_PRIVATE')}${other > 0 ? `, other ${other}` : ''}) · ${facts.length} ${facts.length === 1 ? 'Fact' : 'Facts'} · triangle depth ≤ ${Math.max(...triangles.map((t) => t.depth))} · generation stages 1–${lastStage} · order: ${orderLabel}._`,
			''
		);
	} else {
		if (options.annotations) {
			const bridges = beats.filter((b) => b.depth > 0).length;
			// "bridges" = legacy full-scene bridges.
			lines.push(
				`_${beats.length} beats: ${beats.length - bridges} authored, ${bridges} bridges (max depth ${Math.max(0, ...beats.map((b) => b.depth))})._`,
				''
			);
		}
		lines.push(`_Order: ${orderLabel}._`, '');
	}

	for (const { index, artifact, depth } of shown) {
		lines.push(`## ${index}. ${artifact.title}`);
		const s = artifact.structured;
		const where = [s.worldTime, s.location].filter((v) => typeof v === 'string' && v.trim() !== '');
		const meta = [...where];
		if (options.annotations) {
			meta.push(
				depth > 0
					? `bridge, depth ${depth}`
					: (SOURCE[artifact.creatorRole] ?? artifact.creatorRole)
			);
		}
		if (meta.length > 0) lines.push(`*${meta.join(' · ')}*`);
		lines.push('', artifact.body.trim() || '_(no text)_', '');
		if (options.annotations && depth > 0) {
			if (typeof s.mechanism === 'string') lines.push(`> **Mechanism:** ${s.mechanism}`);
			if (Array.isArray(s.assumptions) && s.assumptions.length > 0) {
				lines.push(`> **Assumes:** ${s.assumptions.join('; ')}`);
			}
			lines.push('');
		}
		const transition = options.annotations ? transitions.get(artifact.id) : undefined;
		if (transition) {
			const time = transition.time ? formatTime(transition.time) : '';
			if (time !== '') lines.push(`> **Story time:** ${time}`);
			if (transition.entities.length > 0) {
				const entities = transition.entities.map(
					(e) => `${e.name} (${e.kind}${e.distinguishing ? `: ${e.distinguishing}` : ''})`
				);
				lines.push(`> **Entities:** ${entities.join('; ')}`);
			}
			if (time !== '' || transition.entities.length > 0) lines.push('');
		}
	}

	const facts = triangles.filter((t) => t.fact !== null);
	const tail: string[] = [];
	if (options.annotations && facts.length > 0) {
		tail.push(
			'## Facts (mediator C)',
			'',
			'_A Fact is a shared minimal circumstance that links two Blocks. These are fact links, not causal claims: nothing here says one Block causes the other._',
			''
		);
		for (const t of facts.toSorted((a, b) => a.stageIndex - b.stageIndex)) {
			const fact = t.fact && byId.get(t.fact.artifactId);
			if (!fact) continue;
			const realized = t.continuations
				.toSorted((a, b) => (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1))
				.map((c) => {
					const side = SIDE_LABEL[byId.get(c.block.artifactId)?.ownerScope ?? ''];
					return `${ref(c.block.artifactId)}${side ? ` (${side})` : ''}`;
				});
			tail.push(
				`- **${fact.title}** (${fact.factKind ?? 'fact'}, stage ${t.stageIndex}) — fact link between ${ref(t.left.artifactId)} and ${ref(t.right.artifactId)}${realized.length > 0 ? `; disclosed to and realized by ${realized.join(' and ')}` : ''}`
			);
		}
		tail.push('');
	}

	const connections = (options.connections ?? []).filter((c) => c.status !== 'rejected');
	if (connections.length > 0) {
		tail.push('## Connections (organizer)', '');
		for (const kind of CONNECTION_KINDS) {
			const ofKind = connections.filter((c) => c.kind === kind);
			if (ofKind.length === 0) continue;
			tail.push(`### ${kind}`, '');
			for (const c of ofKind) {
				tail.push(
					`- ${ref(c.endpointIds[0])} and ${ref(c.endpointIds[1])} — ${c.statement.trim()} _(status: ${c.status}; ${c.approvedBy === null ? 'not approved' : 'approved'}; source: ${c.source})_`
				);
			}
			tail.push('');
		}
	}

	if (options.issues) {
		const rank: Record<ValidationIssue['severity'], number> = { blocker: 0, warning: 1, info: 2 };
		const open = options.issues
			.filter((i) => i.dismissal === null && i.severity !== 'info')
			.toSorted((a, b) => rank[a.severity] - rank[b.severity]);
		tail.push('## Continuity issues (organizer)', '');
		if (open.length === 0) tail.push('_No open blocking or warning issues._', '');
		for (const issue of open) {
			tail.push(
				`- **${issue.kind}** (${issue.severity}; source: ${issue.source}) — ${issue.artifactIds.map(ref).join(', ')}: ${issue.explanation.trim()}`
			);
			for (const e of issue.evidence) {
				tail.push(`  > «${e.quote.replace(/\s+/g, ' ').trim()}» — ${ref(e.artifactId)}`);
			}
		}
		if (open.length > 0) tail.push('');
	}

	const report = options.completion;
	if (report) {
		const questions = report.openQuestions.flatMap((q) => [
			`  - kind: ${q.kind}`,
			`    statement: ${yamlText(q.statement)}`,
			`    endpoints: [${q.endpointIds.map((id) => yamlText(ref(id))).join(', ')}]`,
			`    intentional: ${q.intentional}`
		]);
		const motifs = report.motifSignals.flatMap((m) => [
			`  - block: ${yamlText(ref(m.artifactId))}`,
			`    signal: ${yamlText(m.signal)}`
		]);
		const highest = CompletionPolicy.options.findLast((p) => report.certifiableAs[p]);
		tail.push(
			'## Completion report (organizer)',
			'',
			'```yaml',
			`# highest certifiable policy: ${highest ?? 'none'}`,
			`policy: ${report.policy}`,
			`connected_fact_pairs: ${report.connectedFactPairs}`,
			`confirmed_cross_branch_causal_paths: ${report.confirmedCrossBranchCausalPaths}`,
			...(questions.length > 0 ? ['open_questions:', ...questions] : ['open_questions: []']),
			`chronology_conflicts: ${report.chronologyConflicts}`,
			`isolation_verified: ${report.isolationVerified}`,
			`certifiable: ${report.certifiable}`,
			'certifiable_as:',
			...CompletionPolicy.options.map((p) => `  ${p}: ${report.certifiableAs[p]}`),
			...(report.reasons.length > 0
				? ['reasons:', ...report.reasons.map((r) => `  - ${yamlText(r)}`)]
				: ['reasons: []']),
			...(motifs.length > 0 ? ['motif_signals:', ...motifs] : ['motif_signals: []']),
			'```',
			''
		);
	}

	const audit = options.audit;
	if (audit) {
		const crossScope = audit.tasks.reduce((n, t) => n + t.crossScopeInputIds.length, 0);
		const leaks = audit.denyChecks.filter((c) => c.visibleArtifactIds.length > 0).length;
		const verified =
			audit.isolationVerified === 'unknown' ? 'unknown' : audit.isolationVerified ? 'yes' : 'no';
		tail.push(
			'## Isolation audit',
			'',
			'_ID-level counts only: no prompts, texts or artifact contents._',
			'',
			`- Tasks audited: ${audit.tasks.length} (${audit.tasks.filter((t) => t.manifest !== null).length} with a recorded input manifest)`,
			`- Inputs served across the A/B boundary: ${crossScope}`,
			`- Deny checks: ${audit.denyChecks.length} (${leaks} with opposite-side Blocks visible)`,
			`- Isolation verified: ${verified}`,
			''
		);
	}
	if (tail.length > 0) lines.push('---', '', ...tail);
	return `${lines.join('\n').trimEnd()}\n`;
}
