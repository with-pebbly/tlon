import type { ArtifactCategory } from '$lib/ui';
import type { Artifact } from '@tlon/contracts';
import type { Node } from '@xyflow/svelte';

import type { PyramidRole } from './layout';

export type ArtifactNodeData = {
	artifact: Artifact;
	category: ArtifactCategory;
	/** Highlighted by "Show provenance". */
	highlighted: boolean;
	/** Depth of the accepted expansion that produced this bridge, if any. */
	bridgeDepth: number | null;
};

export type ArtifactFlowNode = Node<ArtifactNodeData, 'artifact'>;

export type PyramidNodeData = {
	artifact: Artifact;
	category: ArtifactCategory;
	role: PyramidRole;
	/** Expansion depth that produced the cell (0 for the base line). */
	depth: number;
	highlighted: boolean;
	/** Fractal view: titled cell instead of a compact square. */
	large: boolean;
};

export type PyramidFlowNode = Node<PyramidNodeData, 'cell'>;
