import type { IssueTone } from '$lib/continuity';
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
	/** Accepted bridge whose anchors moved past the pinned revisions (`staleSides`). */
	stale: boolean;
	/** Strongest open continuity issue this artifact takes part in (canvas overlay). */
	issue: IssueTone | null;
};

export type ArtifactFlowNode = Node<ArtifactNodeData, 'artifact'>;

/** Collapsed composite: nesting level (max depth) and visible direct member count. */
export type CompositeBadge = { level: number; members: number };

export type PyramidNodeData = {
	artifact: Artifact;
	category: ArtifactCategory;
	role: PyramidRole;
	/** Expansion depth that produced the cell (0 for the base line). */
	depth: number;
	highlighted: boolean;
	/** Fractal view: titled cell instead of a compact square. */
	large: boolean;
	/** Set for a collapsed composite: drawn as a larger stacked cell with an Open button. */
	composite: CompositeBadge | null;
	stale: boolean;
	/** Strongest open continuity issue (a collapsed composite: of its hidden members). */
	issue: IssueTone | null;
};

export type PyramidFlowNode = Node<PyramidNodeData, 'cell'>;

/** Flow layout card of a collapsed composite. */
export type CompositeNodeData = {
	artifact: Artifact;
	category: ArtifactCategory;
	highlighted: boolean;
	badge: CompositeBadge;
	issue: IssueTone | null;
};

export type CompositeFlowNode = Node<CompositeNodeData, 'composite'>;

/** Open composite: a frame drawn behind its members, with a title tab and Collapse. */
export type FrameNodeData = {
	artifact: Artifact;
	level: number;
	/** Pixel height of the title tab at the top of the frame. */
	tab: number;
	/** Flow layout: relations may start/end on the frame (left target, right source). */
	connectable: boolean;
};

export type FrameFlowNode = Node<FrameNodeData, 'frame'>;

export type CanvasFlowNode = ArtifactFlowNode | PyramidFlowNode | CompositeFlowNode | FrameFlowNode;
