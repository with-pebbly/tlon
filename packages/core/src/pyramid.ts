import type { Artifact, Expansion, ProjectGraph, Relation } from '@tlon/contracts';

type GraphLike = Pick<ProjectGraph, 'artifacts' | 'relations' | 'expansions'>;

export type PyramidNode = {
	artifactId: string;
	/** Horizontal position in grid units (1 unit = smallest gap between two nodes). */
	x: number;
	/** Row above the base line: 0 = base sequence, higher = coarser bridge. */
	y: number;
	/** 'base' = authored sequence; 'bridge' = accepted bridge; 'candidate' = proposed, unaccepted. */
	role: 'base' | 'bridge' | 'candidate';
	/** Depth of the expansion that produced this node (0 for base). */
	depth: number;
};

export type PyramidTriangle = {
	expansionId: string;
	apexId: string;
	leftId: string;
	rightId: string;
	accepted: boolean;
};

export type PyramidLayout = {
	nodes: PyramidNode[];
	triangles: PyramidTriangle[];
	/** Grid width/height in units; renderers scale by their cell size. */
	width: number;
	height: number;
};

const INACTIVE: Record<string, true> = { REJECTED: true, SUPERSEDED: true };
/** Grid units between neighbouring base artifacts not spanned by an expansion tree. */
const BASE_GAP = 2;

/**
 * Orders base artifacts along the line using root relations (not produced by an
 * expansion, not rejected) as "left of" edges; ties and cycles fall back to creation
 * order. `contradicts` edges carry no order.
 */
function orderBase(base: readonly Artifact[], relations: readonly Relation[]): Artifact[] {
	const byId = new Map(base.map((a) => [a.id, a]));
	const out = new Map<string, string[]>();
	const indegree = new Map(base.map((a) => [a.id, 0]));
	for (const r of relations) {
		if (r.expansionId !== null || r.status === 'REJECTED' || r.type === 'contradicts') continue;
		if (!byId.has(r.fromId) || !byId.has(r.toId) || r.fromId === r.toId) continue;
		out.set(r.fromId, [...(out.get(r.fromId) ?? []), r.toId]);
		indegree.set(r.toId, (indegree.get(r.toId) ?? 0) + 1);
	}
	const byCreation = (a: Artifact, b: Artifact) =>
		a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
	const ready = base.filter((a) => indegree.get(a.id) === 0).toSorted(byCreation);
	const ordered: Artifact[] = [];
	const placed = new Set<string>();
	while (ready.length > 0) {
		const next = ready.shift() as Artifact;
		ordered.push(next);
		placed.add(next.id);
		for (const to of out.get(next.id) ?? []) {
			const remaining = (indegree.get(to) ?? 0) - 1;
			indegree.set(to, remaining);
			if (remaining === 0) {
				ready.push(byId.get(to) as Artifact);
				ready.sort(byCreation);
			}
		}
	}
	// Cycle members: keep creation order.
	for (const a of base.toSorted(byCreation)) if (!placed.has(a.id)) ordered.push(a);
	return ordered;
}

/**
 * Fractal "pyramid" layout (ARCHITECTURE §3.2): authored artifacts sit on a base line;
 * every accepted bridge sits above the midpoint of its two anchors, so recursive
 * subdivision draws nested triangles — a fully expanded depth-d interval is a
 * Sierpinski-like pyramid with its root bridge at the apex. Base slots are spaced
 * just wide enough (2^depth units) for the tree they host, so midpoints never collide.
 */
export function layoutPyramid(graph: GraphLike): PyramidLayout {
	const artifactsById = new Map(
		graph.artifacts.filter((a) => !INACTIVE[a.status]).map((a) => [a.id, a])
	);
	const accepted = graph.expansions.filter(
		(e) => e.status === 'ACCEPTED' && e.selectedBridgeArtifactId !== null
	);
	const open = graph.expansions.filter(
		(e) => e.status === 'PENDING' || e.status === 'GENERATING' || e.status === 'REVIEW'
	);
	const bridgeIds = new Set(accepted.map((e) => e.selectedBridgeArtifactId as string));
	const candidateIds = new Set(open.flatMap((e) => e.bridgeArtifactIds));

	const base = [...artifactsById.values()].filter(
		(a) => !bridgeIds.has(a.id) && !candidateIds.has(a.id)
	);
	const ordered = orderBase(base, graph.relations);
	const baseIndex = new Map(ordered.map((a, i) => [a.id, i]));

	// Height of each expansion tree: the apex row of a root expansion equals the depth of
	// its deepest descendant, so finer bridges sit lower and the pyramid widens downward.
	const byId = new Map(graph.expansions.map((e) => [e.id, e]));
	const rootOf = (e: Expansion): Expansion => {
		let cursor = e;
		const seen = new Set<string>();
		while (cursor.parentExpansionId !== null && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			const parent = byId.get(cursor.parentExpansionId);
			if (!parent) break;
			cursor = parent;
		}
		return cursor;
	};
	const treeDepth = new Map<string, number>();
	for (const e of [...accepted, ...open]) {
		const root = rootOf(e).id;
		treeDepth.set(root, Math.max(treeDepth.get(root) ?? 0, e.depth));
	}

	// Each gap between neighbouring base artifacts is only as wide as the deepest tree
	// spanning it needs (2^depth units, shared across the gaps it covers); plain neighbours
	// stay close, so one deep fractal is not dwarfed by a long, flat base line.
	const gap = ordered.slice(1).map(() => BASE_GAP);
	for (const [rootId, depth] of treeDepth) {
		const root = byId.get(rootId);
		const i = root ? baseIndex.get(root.leftArtifactId) : undefined;
		const j = root ? baseIndex.get(root.rightArtifactId) : undefined;
		if (i === undefined || j === undefined || i === j) continue;
		const [lo, hi] = i < j ? [i, j] : [j, i];
		const share = 2 ** Math.min(depth, 12) / (hi - lo);
		for (let k = lo; k < hi; k++) gap[k] = Math.max(gap[k] ?? BASE_GAP, share);
	}
	const position = new Map<string, { x: number; y: number }>();
	const nodes: PyramidNode[] = [];
	let cursorX = 0;
	ordered.forEach((a, i) => {
		if (i > 0) cursorX += gap[i - 1] ?? BASE_GAP;
		position.set(a.id, { x: cursorX, y: 0 });
		nodes.push({ artifactId: a.id, x: cursorX, y: 0, role: 'base', depth: 0 });
	});

	const occupied = new Set<string>();
	const place = (id: string, x: number, y: number) => {
		let px = x;
		// Overlapping intervals (two root relations sharing an anchor) can share a midpoint.
		while (occupied.has(`${px}:${y}`)) px += 0.5;
		occupied.add(`${px}:${y}`);
		position.set(id, { x: px, y });
		return px;
	};

	const triangles: PyramidTriangle[] = [];
	for (const e of accepted.toSorted(
		(a, b) => a.depth - b.depth || a.createdAt.localeCompare(b.createdAt)
	)) {
		const bridge = e.selectedBridgeArtifactId as string;
		const left = position.get(e.leftArtifactId);
		const right = position.get(e.rightArtifactId);
		if (!left || !right || !artifactsById.has(bridge)) continue;
		const y = (treeDepth.get(rootOf(e).id) ?? e.depth) - e.depth + 1;
		const x = place(bridge, (left.x + right.x) / 2, y);
		nodes.push({ artifactId: bridge, x, y, role: 'bridge', depth: e.depth });
		triangles.push({
			expansionId: e.id,
			apexId: bridge,
			leftId: e.leftArtifactId,
			rightId: e.rightArtifactId,
			accepted: true
		});
	}
	for (const e of open) {
		const left = position.get(e.leftArtifactId);
		const right = position.get(e.rightArtifactId);
		if (!left || !right) continue;
		e.bridgeArtifactIds
			.filter((id) => artifactsById.has(id) && !position.has(id))
			.forEach((id) => {
				const x = place(id, (left.x + right.x) / 2, Math.max(left.y, right.y) + 0.5);
				nodes.push({
					artifactId: id,
					x,
					y: Math.max(left.y, right.y) + 0.5,
					role: 'candidate',
					depth: e.depth
				});
				triangles.push({
					expansionId: e.id,
					apexId: id,
					leftId: e.leftArtifactId,
					rightId: e.rightArtifactId,
					accepted: false
				});
			});
	}

	return {
		nodes,
		triangles,
		width: Math.max(0, ...nodes.map((n) => n.x)),
		height: Math.max(0, ...nodes.map((n) => n.y))
	};
}
