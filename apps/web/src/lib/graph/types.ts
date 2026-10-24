import type { ArtifactCategory } from '$lib/ui';
import type { Artifact } from '@tlon/contracts';
import type { Node } from '@xyflow/svelte';

export type ArtifactNodeData = {
	artifact: Artifact;
	category: ArtifactCategory;
	/** Highlighted by "Show provenance". */
	highlighted: boolean;
	/** Depth of the accepted expansion that produced this bridge, if any. */
	bridgeDepth: number | null;
};

export type ArtifactFlowNode = Node<ArtifactNodeData, 'artifact'>;
