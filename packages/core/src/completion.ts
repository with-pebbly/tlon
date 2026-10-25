import type {
	CompletionPolicy,
	CompletionReport,
	AuditReport,
	NarrativeConnection,
	ProjectGraph,
	Transition,
	Triangle,
	ValidationIssue
} from '@tlon/contracts';

import { activeTriangles, storyBeats } from './story.ts';

type GraphLike = Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'> & {
	triangles?: readonly Triangle[];
};

const PRIVATE_SIDE: Record<string, 'A' | 'B'> = { A_PRIVATE: 'A', B_PRIVATE: 'B' };

export type CompletionInput = {
	graph: GraphLike;
	connections: readonly NarrativeConnection[];
	/** Already merged with dismissals. */
	issues: readonly ValidationIssue[];
	audit: AuditReport | null;
	policy: CompletionPolicy;
	/** Beat annotations by artifact id; only needed for the advisory quiet-beat motif signal. */
	transitions?: ReadonlyMap<string, Transition>;
};

/**
 * Non-spoiler, organizer-only completion report (BLOCK_FACT_V2 review §4.5, ISSUE-01/08).
 * A Fact link is never read as causality: cross-branch causal paths count only approved
 * `causal_canon` connections, and stay `unknown` while nothing at all has been decided.
 * Certification is a declared contract (`policy`), never inferred from the graph being
 * "fully connected".
 */
export function completionReport(input: CompletionInput): CompletionReport {
	const { graph, connections, issues, audit, policy } = input;
	const artifacts = new Map(graph.artifacts.map((a) => [a.id, a]));
	const beatNumber = new Map(storyBeats(graph).map((b) => [b.artifact.id, b.index]));
	const ref = (id: string) =>
		beatNumber.has(id) ? `#${beatNumber.get(id)}` : `“${artifacts.get(id)?.title ?? '?'}”`;

	const connectedPairs = activeTriangles(graph.triangles).filter((t) => t.fact !== null);
	const active = connections.filter((c) => c.status === 'active');

	const crossBranch = (c: NarrativeConnection) => {
		const sides = c.endpointIds.map((id) => PRIVATE_SIDE[artifacts.get(id)?.ownerScope ?? '']);
		return sides[0] !== undefined && sides[1] !== undefined && sides[0] !== sides[1];
	};
	const canonPaths = active.filter(
		(c) => c.kind === 'causal_canon' && c.approvedBy !== null && crossBranch(c)
	).length;
	const confirmedCrossBranchCausalPaths: CompletionReport['confirmedCrossBranchCausalPaths'] =
		canonPaths > 0 || active.some((c) => c.approvedBy !== null) ? canonPaths : 'unknown';

	const openQuestions: CompletionReport['openQuestions'] = [
		...active
			.filter((c) => c.kind === 'open_mystery')
			.map((c) => ({
				connectionId: c.id,
				kind: 'open_mystery' as const,
				statement: c.statement,
				endpointIds: [...c.endpointIds],
				intentional: c.approvedBy !== null
			})),
		...active
			.filter((c) => c.kind === 'causal_hypothesis')
			.map((c) => ({
				connectionId: c.id,
				kind: 'causal_hypothesis' as const,
				statement: c.statement,
				endpointIds: [...c.endpointIds],
				intentional: false
			}))
	];
	const decisions = active.filter((c) => c.kind === 'causal_canon' || c.kind === 'open_mystery');
	for (const t of connectedPairs.toSorted((a, b) => a.stageIndex - b.stageIndex)) {
		const factId = t.fact?.artifactId;
		if (factId === undefined) continue;
		const explained = decisions.some(
			(c) =>
				c.factArtifactId === factId ||
				(c.endpointIds.includes(t.left.artifactId) && c.endpointIds.includes(t.right.artifactId))
		);
		if (explained) continue;
		openQuestions.push({
			connectionId: null,
			kind: 'unexplained_fact_link',
			statement: `How, if at all, does “${artifacts.get(factId)?.title ?? '?'}” join ${ref(t.left.artifactId)} and ${ref(t.right.artifactId)}?`,
			endpointIds: [t.left.artifactId, t.right.artifactId],
			intentional: false
		});
	}

	const open = issues.filter((i) => i.dismissal === null);
	const chronologyConflicts = open.filter(
		(i) =>
			(i.kind === 'temporal_order' || i.kind === 'direction_mismatch') &&
			(i.severity === 'blocker' || i.severity === 'warning')
	).length;
	const blockers = open.filter((i) => i.severity === 'blocker').length;

	const unintentional = openQuestions.filter((q) => !q.intentional).length;
	/** Why `candidate` cannot be certified now; empty = certifiable. */
	const reasonsFor = (candidate: CompletionPolicy): string[] => {
		const reasons: string[] = [];
		if (blockers > 0) {
			reasons.push(`${blockers} open blocking continuity issue(s) must be resolved or dismissed.`);
		}
		if (candidate === 'coherent_open_mystery' && unintentional > 0) {
			reasons.push(
				`${unintentional} open question(s) are not marked as intentional by a facilitator; approve each as a deliberate mystery or answer it.`
			);
		}
		if (candidate === 'causally_connected' || candidate === 'resolved') {
			if (confirmedCrossBranchCausalPaths === 'unknown') {
				reasons.push(
					'Cross-branch causality is unknown: no approved connection between the A and B branches has been recorded.'
				);
			} else if (confirmedCrossBranchCausalPaths < 1) {
				reasons.push(
					'No approved causal connection (causal_canon) joins the A and B branches; a Fact link alone is not causality.'
				);
			}
		}
		if (candidate === 'resolved' && openQuestions.length > 0) {
			reasons.push(`${openQuestions.length} open question(s) remain unanswered.`);
		}
		return reasons;
	};
	const certifiableAs: CompletionReport['certifiableAs'] = {
		exploratory: reasonsFor('exploratory').length === 0,
		coherent_open_mystery: reasonsFor('coherent_open_mystery').length === 0,
		causally_connected: reasonsFor('causally_connected').length === 0,
		resolved: reasonsFor('resolved').length === 0
	};

	return {
		policy,
		connectedFactPairs: connectedPairs.length,
		confirmedCrossBranchCausalPaths,
		openQuestions,
		chronologyConflicts,
		blockers,
		isolationVerified: audit?.isolationVerified ?? 'unknown',
		motifSignals: motifSignals(graph, input.transitions),
		certifiable: certifiableAs[policy],
		reasons: reasonsFor(policy),
		certifiableAs
	};
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Advisory motif-reuse signals (review ISSUE-09). They never block certification and
 * quiet atmospheric beats alone are never a signal: only a run of three annotated,
 * function-less beats on one side is mentioned.
 */
export function motifSignals(
	graph: GraphLike,
	transitions?: ReadonlyMap<string, Transition>
): { artifactId: string; signal: string }[] {
	const signals: { artifactId: string; signal: string }[] = [];
	const add = (artifactId: string, signal: string) => {
		if (!signals.some((s) => s.artifactId === artifactId && s.signal === signal)) {
			signals.push({ artifactId, signal });
		}
	};
	const artifacts = new Map(graph.artifacts.map((a) => [a.id, a]));
	const beats = storyBeats(graph);

	const facts = new Map<string, { title: string; continuations: string[] }>();
	for (const triangle of activeTriangles(graph.triangles)) {
		const fact = triangle.fact ? artifacts.get(triangle.fact.artifactId) : undefined;
		if (!fact) continue;
		const known = facts.get(fact.id) ?? { title: fact.title, continuations: [] };
		known.continuations.push(...triangle.continuations.map((c) => c.block.artifactId));
		facts.set(fact.id, known);
	}
	for (const { title, continuations } of facts.values()) {
		const words = (title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4);
		if (words.length > 0) {
			for (const id of continuations) {
				const blockTitle = artifacts.get(id)?.title.toLowerCase();
				if (blockTitle !== undefined && words.every((w) => blockTitle.includes(w))) {
					add(id, 'titles itself after the Fact');
				}
			}
		}
		const phrase = title.trim().split(/\s+/).filter(Boolean).map(escapeRegExp).join('\\s+');
		if (phrase === '') continue;
		const verbatim = new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, 'iu');
		for (const beat of beats.filter((b) => verbatim.test(b.artifact.body)).slice(2)) {
			add(beat.artifact.id, 'repeats Fact phrase verbatim');
		}
	}

	if (transitions) {
		for (const side of ['A_PRIVATE', 'B_PRIVATE']) {
			let quiet = 0;
			for (const { artifact } of beats.filter((b) => b.artifact.ownerScope === side)) {
				const transition = transitions.get(artifact.id);
				quiet = transition && transition.functions.length === 0 ? quiet + 1 : 0;
				if (quiet === 3) add(artifact.id, 'third quiet beat in a row');
			}
		}
	}
	return signals;
}
