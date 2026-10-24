import type { Expansion, ProjectGraph, Relation } from '@tlon/contracts';
import { OPEN_EXPANSION_STATUSES } from '@tlon/contracts';

type GraphLike = Pick<ProjectGraph, 'relations' | 'expansions'>;

export type FractalNode = {
	relation: Relation;
	/** ACCEPTED expansion that subdivides this relation (relation is then a collapsed parent edge). */
	acceptedExpansion: Expansion | null;
	/** Expansions still awaiting candidates/decision on this relation. */
	openExpansions: Expansion[];
	/** [left→C, C→right] when expanded, recursively. */
	children: FractalNode[];
	depth: number;
};

function indexGraph(graph: GraphLike) {
	const childRelationsByExpansion = new Map<string, Relation[]>();
	for (const r of graph.relations) {
		if (r.expansionId === null) continue;
		const list = childRelationsByExpansion.get(r.expansionId);
		if (list) list.push(r);
		else childRelationsByExpansion.set(r.expansionId, [r]);
	}
	const expansionsByTarget = new Map<string, Expansion[]>();
	for (const e of graph.expansions) {
		if (e.targetRelationId === null) continue;
		const list = expansionsByTarget.get(e.targetRelationId);
		if (list) list.push(e);
		else expansionsByTarget.set(e.targetRelationId, [e]);
	}
	return { childRelationsByExpansion, expansionsByTarget };
}

/** Child relations of an accepted expansion in interval order: left→C first, then C→right. */
function orderedChildren(expansion: Expansion, children: readonly Relation[]): Relation[] {
	return [...children].sort((a, b) => {
		const rank = (r: Relation) => (r.fromId === expansion.leftArtifactId ? 0 : 1);
		return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt);
	});
}

/**
 * Expansion hierarchy ("Fractal" view). Roots are relations not produced by an
 * expansion; rejected relations are omitted. The semantic graph may share nodes, but
 * this tree follows expansion provenance only, so it is always finite.
 */
export function buildFractalTree(graph: GraphLike): FractalNode[] {
	const { childRelationsByExpansion, expansionsByTarget } = indexGraph(graph);
	const visited = new Set<string>();

	const build = (relation: Relation, depth: number): FractalNode => {
		visited.add(relation.id);
		const expansions = expansionsByTarget.get(relation.id) ?? [];
		const accepted = expansions.find((e) => e.status === 'ACCEPTED') ?? null;
		const children = accepted
			? orderedChildren(accepted, childRelationsByExpansion.get(accepted.id) ?? [])
					.filter((child) => !visited.has(child.id))
					.map((child) => build(child, depth + 1))
			: [];
		return {
			relation,
			acceptedExpansion: accepted,
			openExpansions: expansions.filter((e) => OPEN_EXPANSION_STATUSES.includes(e.status)),
			children,
			depth
		};
	};

	return graph.relations
		.filter((r) => r.expansionId === null && r.status !== 'REJECTED')
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
		.map((r) => build(r, 0));
}

/**
 * Linear artifact sequence of a fractal node: an unexpanded relation yields
 * [from, to]; an expanded one yields seq(left→C) ⧺ seq(C→right) with the shared
 * bridge listed once. This is the "Timeline" reading of an interval, not a claim
 * that C is a chronological midpoint.
 */
export function linearizeNode(node: FractalNode): string[] {
	if (node.children.length === 0) return [node.relation.fromId, node.relation.toId];
	const sequence: string[] = [];
	for (const child of node.children) {
		for (const id of linearizeNode(child)) {
			if (sequence[sequence.length - 1] !== id) sequence.push(id);
		}
	}
	return sequence;
}

export type TimelineThread = { rootRelationId: string; type: string; artifactIds: string[] };

export function buildTimeline(graph: GraphLike): TimelineThread[] {
	return buildFractalTree(graph).map((root) => ({
		rootRelationId: root.relation.id,
		type: root.relation.type,
		artifactIds: linearizeNode(root)
	}));
}

/** Count of accepted bridges under a fractal node (2^d − 1 for a fully expanded depth-d tree). */
export function countAcceptedBridges(node: FractalNode): number {
	return (
		(node.acceptedExpansion ? 1 : 0) +
		node.children.reduce((sum, child) => sum + countAcceptedBridges(child), 0)
	);
}
