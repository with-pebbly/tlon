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
