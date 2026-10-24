import type { PyramidLayout } from '@tlon/core';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 84;
/** Flow layout card of a collapsed composite: visibly larger than an atomic card. */
export const COMPOSITE_WIDTH = 264;
export const COMPOSITE_HEIGHT = 104;

export type XY = { x: number; y: number };
export type Rect = XY & { width: number; height: number };

/** Frame geometry (pixels) per canvas: padding, title-tab height, minimum width for the tab. */
export type FrameGeometry = { pad: number; tab: number; minWidth: number };
export const FLOW_FRAME: FrameGeometry = { pad: 16, tab: 26, minWidth: 280 };

const elk = new ELK();

export type LayeredNode = {
	id: string;
	width: number;
	height: number;
	/** Open composite (compound node) this node is laid out inside, if any. */
	parentId: string | null;
};

/**
 * Layered left→right layout computed in the browser; returns absolute top-left positions
 * of leaf nodes. `containers` are open composites: ELK lays their members out inside one
 * compound box so a frame never has to stretch across unrelated nodes. Edges may end on
 * a container (relations to an open composite).
 */
export async function layoutLayered(
	nodes: readonly LayeredNode[],
	containers: readonly { id: string; parentId: string | null }[],
	edges: readonly { id: string; source: string; target: string }[]
): Promise<Map<string, XY>> {
	const padding = `[top=${FLOW_FRAME.pad + FLOW_FRAME.tab},left=${FLOW_FRAME.pad},bottom=${FLOW_FRAME.pad},right=${FLOW_FRAME.pad}]`;
	const spacing = {
		'elk.spacing.nodeNode': '36',
		'elk.layered.spacing.nodeNodeBetweenLayers': '96',
		'elk.layered.spacing.edgeNodeBetweenLayers': '32'
	};
	const elkNodes = new Map<string, ElkNode>();
	for (const c of containers) {
		// Compound nodes do not inherit the root's spacing: repeat it so members breathe.
		elkNodes.set(c.id, {
			id: c.id,
			layoutOptions: { 'elk.padding': padding, ...spacing },
			children: []
		});
	}
	for (const n of nodes) elkNodes.set(n.id, { id: n.id, width: n.width, height: n.height });
	const roots: ElkNode[] = [];
	for (const item of [...containers, ...nodes]) {
		const node = elkNodes.get(item.id) as ElkNode;
		const parent = item.parentId === null ? undefined : elkNodes.get(item.parentId);
		if (parent?.children) parent.children.push(node);
		else roots.push(node);
	}
	const result = await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
			...spacing,
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			'elk.separateConnectedComponents': 'true',
			'elk.spacing.componentComponent': '64'
		},
		children: roots,
		edges: edges
			.filter((e) => elkNodes.has(e.source) && elkNodes.has(e.target) && e.source !== e.target)
			.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
	});
	const positions = new Map<string, XY>();
	const walk = (children: readonly ElkNode[], offset: XY) => {
		for (const child of children) {
			const at = { x: offset.x + (child.x ?? 0), y: offset.y + (child.y ?? 0) };
			if (child.children) walk(child.children, at);
			else positions.set(child.id, at);
		}
	};
	walk(result.children ?? [], { x: 0, y: 0 });
	return positions;
}

/**
 * Pixel rectangles of open-composite frames around their drawn members. A frame wraps
 * its direct members' rects, nested open frames included (computed first), plus padding
 * and the title tab on top. Members drawn nowhere are skipped.
 */
export function frameRects(
	frames: readonly { id: string; memberIds: readonly string[] }[],
	nodeRects: ReadonlyMap<string, Rect>,
	geometry: FrameGeometry
): Map<string, Rect> {
	const byId = new Map(frames.map((f) => [f.id, f]));
	const out = new Map<string, Rect>();
	const visiting = new Set<string>();
	const rectOf = (id: string): Rect | undefined => {
		const done = out.get(id);
		if (done) return done;
		const frame = byId.get(id);
		if (!frame) return nodeRects.get(id);
		if (visiting.has(id)) return undefined;
		visiting.add(id);
		const inner = frame.memberIds.map(rectOf).filter((r): r is Rect => r !== undefined);
		visiting.delete(id);
		if (inner.length === 0) return undefined;
		const minX = Math.min(...inner.map((r) => r.x));
		const minY = Math.min(...inner.map((r) => r.y));
		const maxX = Math.max(...inner.map((r) => r.x + r.width));
		const maxY = Math.max(...inner.map((r) => r.y + r.height));
		// Narrow frames (one small pyramid cell) widen symmetrically so the tab stays legible.
		const width = Math.max(geometry.minWidth, maxX - minX + 2 * geometry.pad);
		const rect = {
			x: (minX + maxX) / 2 - width / 2,
			y: minY - geometry.pad - geometry.tab,
			width,
			height: maxY - minY + 2 * geometry.pad + geometry.tab
		};
		out.set(id, rect);
		return rect;
	};
	for (const frame of frames) rectOf(frame.id);
	return out;
}

/** Cell geometry for rendering a `layoutPyramid` grid on a canvas. */
export type PyramidScale = {
	/** Pixels per horizontal grid unit (smallest gap between two nodes). */
	unitPx: number;
	/** Pixels per row above the base line. */
	rowPx: number;
	cellWidth: number;
	cellHeight: number;
	/** Collapsed composite cell: larger than an atomic one, same centre. */
	compositeWidth: number;
	compositeHeight: number;
	frame: FrameGeometry;
};

/** Graph view: a dense field of small squares. */
export const PYRAMID_COMPACT: PyramidScale = {
	unitPx: 30,
	rowPx: 44,
	cellWidth: 22,
	cellHeight: 22,
	compositeWidth: 40,
	compositeHeight: 30,
	frame: { pad: 18, tab: 16, minWidth: 170 }
};
/** Fractal view: the same pyramid with titled cells. */
export const PYRAMID_LARGE: PyramidScale = {
	unitPx: 120,
	rowPx: 96,
	cellWidth: 112,
	cellHeight: 60,
	compositeWidth: 168,
	compositeHeight: 84,
	frame: { pad: 14, tab: 24, minWidth: 280 }
};

/** 'loose' = visible artifact the pyramid could not place (e.g. its anchors are filtered out). */
export type PyramidRole = 'base' | 'bridge' | 'candidate' | 'loose';

export type PyramidPlacement = { position: XY; role: PyramidRole; depth: number };

const CELL_GAP = 6;

/**
 * Converts pyramid grid units to top-left canvas positions (base line at y = 0, bridges
 * above it). Cells sharing a row are nudged apart when they would overlap (several
 * candidates of one expansion share a midpoint); visible artifacts the pyramid did not
 * place go on a separate row under the base line.
 *
 * A depth-D pyramid is 2^D units wide but only D rows tall, so rows grow with depth past
 * `scale.rowPx` to keep each root triangle about half as tall as it is wide — otherwise
 * deep pyramids flatten into a strip and stop reading as triangles.
 */
export function placePyramid(
	pyramid: PyramidLayout,
	visibleIds: readonly string[],
	scale: PyramidScale
): Map<string, PyramidPlacement> {
	const { unitPx, cellWidth, cellHeight } = scale;
	// Same cap as layoutPyramid's base slot (2^min(maxDepth, 12)).
	const depth = Math.min(12, Math.max(1, ...pyramid.nodes.map((n) => n.depth)));
	const rowPx = Math.max(scale.rowPx, (unitPx * 2 ** depth) / (2 * depth));
	const minGap = cellWidth + CELL_GAP;
	const rows = new Map<number, { id: string; x: number }[]>();
	const placed = new Map<string, PyramidPlacement>();
	for (const node of pyramid.nodes) {
		const y = -node.y * rowPx;
		const row = rows.get(y) ?? [];
		row.push({ id: node.artifactId, x: node.x * unitPx });
		rows.set(y, row);
		placed.set(node.artifactId, {
			position: { x: 0, y: y - cellHeight / 2 },
			role: node.role,
			depth: node.depth
		});
	}
	for (const row of rows.values()) {
		row.sort((a, b) => a.x - b.x);
		let previous = -Infinity;
		for (const cell of row) {
			const x = Math.max(cell.x, previous + minGap);
			previous = x;
			const placement = placed.get(cell.id) as PyramidPlacement;
			placement.position = { x: x - cellWidth / 2, y: placement.position.y };
		}
	}
	let looseX = 0;
	for (const id of visibleIds) {
		if (placed.has(id)) continue;
		placed.set(id, {
			position: { x: looseX - cellWidth / 2, y: 1.5 * scale.rowPx - cellHeight / 2 },
			role: 'loose',
			depth: 0
		});
		looseX += Math.max(unitPx, minGap);
	}
	return placed;
}
