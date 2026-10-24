import type { Artifact, ProjectGraph, Triangle } from '@tlon/contracts';

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

/**
 * Markdown manuscript for readers outside the tool (e.g. script editors): numbered
 * beats with time/place and prose, optionally annotated with who wrote each beat and,
 * for bridges, the mechanism and assumptions it relies on.
 */
export function renderStoryMarkdown(
	graph: GraphLike,
	options: { annotations?: boolean } = {}
): string {
	const beats = storyBeats(graph);
	const lines = [`# ${graph.project.name}`, ''];
	if (options.annotations) {
		const bridges = beats.filter((b) => b.depth > 0).length;
		// "bridges" = legacy full-scene bridges; Block–Fact projects report their Facts separately.
		lines.push(
			`_${beats.length} beats: ${beats.length - bridges} authored, ${bridges} bridges (max depth ${Math.max(0, ...beats.map((b) => b.depth))})._`,
			''
		);
	}
	for (const { index, artifact, depth } of beats) {
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
	}
	const triangles = (graph.triangles ?? []).filter(
		(t) => t.fact !== null && t.status !== 'rejected' && t.status !== 'superseded'
	);
	if (options.annotations && triangles.length > 0) {
		const byId = new Map(graph.artifacts.map((a) => [a.id, a]));
		const number = new Map(beats.map((b) => [b.artifact.id, b.index]));
		const ref = (id: string) =>
			number.has(id) ? `#${number.get(id)}` : `“${byId.get(id)?.title ?? '?'}”`;
		lines.push('', '---', '', '## Facts (mediator C)', '');
		for (const t of triangles.toSorted((a, b) => a.stageIndex - b.stageIndex)) {
			const fact = byId.get(t.fact!.artifactId);
			if (!fact) continue;
			lines.push(
				`- **${fact.title}** (${fact.factKind ?? 'fact'}, stage ${t.stageIndex}) — links ${ref(t.left.artifactId)} and ${ref(t.right.artifactId)}`
			);
		}
	}
	return `${lines.join('\n').trimEnd()}\n`;
}
