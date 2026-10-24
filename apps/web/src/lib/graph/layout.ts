import type { PyramidLayout } from '@tlon/core';
import ELK from 'elkjs/lib/elk.bundled.js';

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 84;

export type XY = { x: number; y: number };

const elk = new ELK();

/** Layered left→right layout computed in the browser; returns top-left positions by node id. */
export async function layoutLayered(
	nodeIds: readonly string[],
	edges: readonly { id: string; source: string; target: string }[]
): Promise<Map<string, XY>> {
	const result = await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.spacing.nodeNode': '36',
			'elk.layered.spacing.nodeNodeBetweenLayers': '96',
			'elk.layered.spacing.edgeNodeBetweenLayers': '32',
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			'elk.separateConnectedComponents': 'true',
			'elk.spacing.componentComponent': '64'
		},
		children: nodeIds.map((id) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT })),
		edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
	});
	const positions = new Map<string, XY>();
	for (const child of result.children ?? []) {
		positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
	}
	return positions;
}

/** Cell geometry for rendering a `layoutPyramid` grid on a canvas. */
export type PyramidScale = {
	/** Pixels per horizontal grid unit (smallest gap between two nodes). */
	unitPx: number;
	/** Pixels per row above the base line. */
	rowPx: number;
	cellWidth: number;
	cellHeight: number;
};

/** Graph view: a dense field of small squares. */
export const PYRAMID_COMPACT: PyramidScale = {
	unitPx: 30,
	rowPx: 44,
	cellWidth: 22,
	cellHeight: 22
};
/** Fractal view: the same pyramid with titled cells. */
export const PYRAMID_LARGE: PyramidScale = {
	unitPx: 120,
	rowPx: 96,
	cellWidth: 112,
	cellHeight: 60
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
