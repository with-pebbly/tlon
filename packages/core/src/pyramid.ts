import type {
	Artifact,
	CompositeSummary,
	Expansion,
	ProjectGraph,
	Relation,
	Triangle
} from '@tlon/contracts';

type GraphLike = Pick<ProjectGraph, 'artifacts' | 'relations' | 'expansions'> & {
	/** Head composite definitions (graph projection); open composites are those with visible members. */
	composites?: readonly CompositeSummary[];
	/** From `collapseComposites`: hidden member → visible collapsed composite. */
	representative?: ReadonlyMap<string, string>;
	/** Block–Fact triangles (ADR 0011): the Fact is drawn as the apex over its two anchors. */
	triangles?: readonly Triangle[];
};

type OrderEdge = Pick<Relation, 'fromId' | 'toId' | 'expansionId' | 'status' | 'type'>;

/**
 * One subdivided interval, whichever mechanism produced it: a legacy expansion (apex =
 * full-scene bridge Block) or a Block–Fact triangle (apex = minimal Fact, atemporal).
 */
type Gap = {
	id: string;
	source: 'expansion' | 'triangle';
	open: boolean;
	apexId: string | null;
	candidateIds: readonly string[];
	leftArtifactId: string;
	rightArtifactId: string;
	depth: number;
	parentId: string | null;
	createdAt: string;
	stageIndex: number | null;
};

const OPEN_EXPANSION: Record<string, true> = { PENDING: true, GENERATING: true, REVIEW: true };
const LIVE_TRIANGLE: Record<string, true> = {
	proposed: true,
	expanding: true,
	converged: true,
	validated: true
};

function gapsOf(expansions: readonly Expansion[], triangles: readonly Triangle[]): Gap[] {
	return [
		...expansions
			.filter((e) => e.status === 'ACCEPTED' || OPEN_EXPANSION[e.status])
			.map((e) => ({
				id: e.id,
				source: 'expansion' as const,
				open: e.status !== 'ACCEPTED',
				apexId: e.status === 'ACCEPTED' ? e.selectedBridgeArtifactId : null,
				candidateIds: e.status === 'ACCEPTED' ? [] : e.bridgeArtifactIds,
				leftArtifactId: e.leftArtifactId,
				rightArtifactId: e.rightArtifactId,
				depth: e.depth,
				parentId: e.parentExpansionId,
				createdAt: e.createdAt,
				stageIndex: null
			})),
		...triangles
			.filter((t) => LIVE_TRIANGLE[t.status])
			.map((t) => ({
				id: t.id,
				source: 'triangle' as const,
				open: t.fact === null,
				apexId: t.fact?.artifactId ?? null,
				candidateIds: [],
				leftArtifactId: t.left.artifactId,
				rightArtifactId: t.right.artifactId,
				depth: t.depth,
				parentId: t.parentTriangleId,
				createdAt: t.createdAt,
				stageIndex: t.stageIndex
			}))
	];
}

export type PyramidNode = {
	artifactId: string;
	/** Horizontal position in grid units (1 unit = smallest gap between two nodes). */
	x: number;
	/** Row above the base line: 0 = base sequence, higher = coarser bridge. */
	y: number;
	/**
	 * 'base' = Block on the line; 'bridge' = accepted legacy full-scene bridge;
	 * 'fact' = accepted triangle Fact (atemporal apex); 'candidate' = proposed, unaccepted.
	 */
	role: 'base' | 'bridge' | 'fact' | 'candidate';
	/** Depth of the expansion/triangle that produced this node (0 for base). */
	depth: number;
	/** Generation stage of a triangle Fact (first C Fact = 2); null otherwise. */
	stage: number | null;
};

export type PyramidTriangle = {
	/** Expansion id (legacy bridge) or triangle id (Block–Fact). */
	expansionId: string;
	source: 'expansion' | 'triangle';
	apexId: string;
	leftId: string;
	rightId: string;
	accepted: boolean;
};

export type PyramidLayout = {
	nodes: PyramidNode[];
	triangles: PyramidTriangle[];
	/** Bounding boxes (grid units) of OPEN composites around their visible members. */
	frames: Array<{ compositeId: string; minX: number; maxX: number; minY: number; maxY: number }>;
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
function orderBase(base: readonly Artifact[], relations: readonly OrderEdge[]): Artifact[] {
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
	const gaps = gapsOf(graph.expansions, graph.triangles ?? []);
	const accepted = gaps.filter((g) => !g.open && g.apexId !== null);
	const open = gaps.filter((g) => g.open);
	const bridgeIds = new Set(accepted.map((g) => g.apexId as string));
	const candidateIds = new Set(open.flatMap((g) => g.candidateIds));

	// An OPEN composite is drawn as its members (plus a frame); anything anchored on it
	// attaches to its boundary: a left anchor resolves to its exits, a right anchor to
	// its entries — a bridge between M and N sits between M's exit and N's entry.
	const openComposites = new Map(
		(graph.composites ?? [])
			.filter(
				(c) =>
					artifactsById.has(c.artifactId) && c.memberArtifactIds.some((m) => artifactsById.has(m))
			)
			.map((c) => [c.artifactId, c])
	);
	const endpoints = (id: string, side: 'from' | 'to', seen = new Set<string>()): string[] => {
		const viaRep = graph.representative?.get(id);
		if (viaRep !== undefined && viaRep !== id) return endpoints(viaRep, side, seen);
		const composite = openComposites.get(id);
		if (!composite || seen.has(id)) return [id];
		seen.add(id);
		const visible = (ids: readonly string[]) =>
			ids.filter((m) => artifactsById.has(m) || openComposites.has(m));
		const ports = visible(side === 'from' ? composite.boundary.exits : composite.boundary.entries);
		const fallback = visible(composite.memberArtifactIds);
		return (ports.length > 0 ? ports : fallback).flatMap((m) => endpoints(m, side, seen));
	};

	// Facts are atemporal connectors: never on the story line, only as triangle apexes.
	const base = [...artifactsById.values()].filter(
		(a) =>
			a.artifactClass !== 'FACT' &&
			!bridgeIds.has(a.id) &&
			!candidateIds.has(a.id) &&
			!openComposites.has(a.id)
	);
	const orderEdges: OrderEdge[] = graph.relations.flatMap((r) =>
		endpoints(r.fromId, 'from').flatMap((fromId) =>
			endpoints(r.toId, 'to').map((toId) => ({ ...r, fromId, toId }))
		)
	);
	const ordered = orderBase(base, orderEdges);
	const baseIndex = new Map(ordered.map((a, i) => [a.id, i]));
	const indexOf = (id: string, side: 'left' | 'right') => {
		const found = endpoints(id, side === 'left' ? 'from' : 'to')
			.map((m) => baseIndex.get(m))
			.filter((i): i is number => i !== undefined);
		if (found.length === 0) return undefined;
		return side === 'left' ? Math.max(...found) : Math.min(...found);
	};

	// Height of each expansion tree: the apex row of a root expansion equals the depth of
	// its deepest descendant, so finer bridges sit lower and the pyramid widens downward.
	const byId = new Map(gaps.map((g) => [g.id, g]));
	const rootOf = (e: Gap): Gap => {
		let cursor = e;
		const seen = new Set<string>();
		while (cursor.parentId !== null && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			const parent = byId.get(cursor.parentId);
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
		const i = root ? indexOf(root.leftArtifactId, 'left') : undefined;
		const j = root ? indexOf(root.rightArtifactId, 'right') : undefined;
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
		nodes.push({ artifactId: a.id, x: cursorX, y: 0, role: 'base', depth: 0, stage: null });
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

	const anchorAt = (id: string, side: 'left' | 'right') => {
		const found = endpoints(id, side === 'left' ? 'from' : 'to')
			.map((m) => position.get(m))
			.filter((p): p is { x: number; y: number } => p !== undefined);
		if (found.length === 0) return undefined;
		const xs = found.map((p) => p.x);
		return {
			x: side === 'left' ? Math.max(...xs) : Math.min(...xs),
			y: Math.max(...found.map((p) => p.y))
		};
	};

	const triangles: PyramidTriangle[] = [];
	for (const e of accepted.toSorted(
		(a, b) => a.depth - b.depth || a.createdAt.localeCompare(b.createdAt)
	)) {
		const bridge = e.apexId as string;
		const left = anchorAt(e.leftArtifactId, 'left');
		const right = anchorAt(e.rightArtifactId, 'right');
		if (!left || !right || !artifactsById.has(bridge)) continue;
		const y = (treeDepth.get(rootOf(e).id) ?? e.depth) - e.depth + 1;
		const x = place(bridge, (left.x + right.x) / 2, y);
		nodes.push({
			artifactId: bridge,
			x,
			y,
			role: e.source === 'triangle' ? 'fact' : 'bridge',
			depth: e.depth,
			stage: e.stageIndex
		});
		triangles.push({
			expansionId: e.id,
			source: e.source,
			apexId: bridge,
			leftId: e.leftArtifactId,
			rightId: e.rightArtifactId,
			accepted: true
		});
	}
	for (const e of open) {
		const left = anchorAt(e.leftArtifactId, 'left');
		const right = anchorAt(e.rightArtifactId, 'right');
		if (!left || !right) continue;
		e.candidateIds
			.filter((id) => artifactsById.has(id) && !position.has(id))
			.forEach((id) => {
				const x = place(id, (left.x + right.x) / 2, Math.max(left.y, right.y) + 0.5);
				nodes.push({
					artifactId: id,
					x,
					y: Math.max(left.y, right.y) + 0.5,
					role: 'candidate',
					depth: e.depth,
					stage: e.stageIndex
				});
				triangles.push({
					expansionId: e.id,
					source: e.source,
					apexId: id,
					leftId: e.leftArtifactId,
					rightId: e.rightArtifactId,
					accepted: false
				});
			});
	}

	const frames = [...openComposites.values()].flatMap((c) => {
		const inside = new Set<string>();
		const stack = [...c.memberArtifactIds];
		while (stack.length > 0) {
			const id = stack.pop() as string;
			if (inside.has(id)) continue;
			inside.add(id);
			stack.push(...(openComposites.get(id)?.memberArtifactIds ?? []));
		}
		const pts = nodes.filter((n) => inside.has(n.artifactId));
		if (pts.length === 0) return [];
		return [
			{
				compositeId: c.artifactId,
				minX: Math.min(...pts.map((p) => p.x)),
				maxX: Math.max(...pts.map((p) => p.x)),
				minY: Math.min(...pts.map((p) => p.y)),
				maxY: Math.max(...pts.map((p) => p.y))
			}
		];
	});

	return {
		nodes,
		triangles,
		frames,
		width: Math.max(0, ...nodes.map((n) => n.x)),
		height: Math.max(0, ...nodes.map((n) => n.y))
	};
}
