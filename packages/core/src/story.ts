import type { Artifact, ProjectGraph } from '@tlon/contracts';

import { layoutPyramid } from './pyramid.ts';

type GraphLike = Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'>;

export type StoryBeat = {
	index: number;
	artifact: Artifact;
	/** 0 = authored by A/B (or the human); n = bridge at expansion depth n. */
	depth: number;
};

/**
 * The scenario as one reading order: authored beats and accepted bridges sorted by
 * their position on the pyramid's base axis (in-order traversal of every expansion
 * tree), so each bridge lands between the two beats it reconciles. Rejected
 * artifacts, open candidates and disclosure notes are left out.
 */
export function storyBeats(graph: GraphLike): StoryBeat[] {
	const disclosed = new Set(
		graph.artifacts.filter((a) => a.ownerScope === 'C_SHARED' && a.kind === 'NOTE').map((a) => a.id)
	);
	const byId = new Map(graph.artifacts.map((a) => [a.id, a]));
	return layoutPyramid(graph)
		.nodes.filter((n) => n.role !== 'candidate' && !disclosed.has(n.artifactId))
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
	return `${lines.join('\n').trimEnd()}\n`;
}
