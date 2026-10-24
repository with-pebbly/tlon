<script lang="ts">
	import '@xyflow/svelte/dist/style.css';
	import { pairKey, TONE_RANK, type IssueTone } from '$lib/continuity';
	import { stackArcLabels } from '$lib/graph/arc';
	import {
		COMPOSITE_HEIGHT,
		COMPOSITE_WIDTH,
		FLOW_FRAME,
		frameRects,
		layoutLayered,
		NODE_HEIGHT,
		NODE_WIDTH,
		placePyramid,
		PYRAMID_COMPACT,
		PYRAMID_LARGE,
		type PyramidPlacement,
		type PyramidRole,
		type Rect,
		type XY
	} from '$lib/graph/layout';
	import { loadPositions, savePositions, type GraphLayout } from '$lib/graph/positions';
	import type {
		ArtifactFlowNode,
		CanvasFlowNode,
		CompositeBadge,
		CompositeFlowNode,
		FrameFlowNode,
		PyramidFlowNode,
		PyramidNodeData
	} from '$lib/graph/types';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { isOpen } from '$lib/state/workspace.svelte';
	import { artifactCategory } from '$lib/ui';
	import type { Artifact, Relation } from '@tlon/contracts';
	import { layoutPyramid, type AggregatedEdge, type PyramidTriangle } from '@tlon/core';
	import {
		Background,
		Controls,
		MarkerType,
		MiniMap,
		Panel,
		Position,
		SvelteFlow,
		useSvelteFlow,
		useViewport,
		type Connection,
		type Edge,
		type EdgeTypes,
		type Node,
		type NodeTypes
	} from '@xyflow/svelte';
	import { tick, untrack } from 'svelte';

	import ArtifactNode from './ArtifactNode.svelte';
	import CompositeNode from './CompositeNode.svelte';
	import ConnectDialog from './ConnectDialog.svelte';
	import FrameNode from './FrameNode.svelte';
	import LabelledEdge from './LabelledEdge.svelte';
	import Legend from './Legend.svelte';
	import PyramidArcEdge from './PyramidArcEdge.svelte';
	import PyramidNode from './PyramidNode.svelte';

	/** 'graph': Graph view (pyramid by default, ELK flow on request); 'fractal': titled pyramid. */
	let { variant = 'graph' }: { variant?: 'graph' | 'fractal' } = $props();

	const nodeTypes: NodeTypes = {
		artifact: ArtifactNode,
		cell: PyramidNode,
		composite: CompositeNode,
		frame: FrameNode
	};
	const edgeTypes: EdgeTypes = { arc: PyramidArcEdge, labelled: LabelledEdge };
	const ARROW = { type: MarkerType.ArrowClosed, width: 16, height: 16 } as const;
	/** Compact cells show their titles once the canvas is zoomed in past this level. */
	const LABEL_ZOOM = 1.2;
	const MINIMAP_ROLE_COLOR: Record<PyramidRole, string> = {
		base: '#d4d4d8',
		bridge: 'var(--color-accent-500)',
		candidate: 'var(--color-accent-200)',
		loose: '#e4e4e7'
	};

	const ws = getWorkspace();
	const flow = useSvelteFlow();
	const viewport = useViewport();

	const layout = $derived<GraphLayout>(variant === 'fractal' ? 'pyramid' : ws.graphLayout);
	const scale = $derived(variant === 'fractal' ? PYRAMID_LARGE : PYRAMID_COMPACT);
	/** Dragged positions are kept per layout: coordinates of one mean nothing in another. */
	const positionsKey = $derived(
		variant === 'fractal' ? 'fractal' : layout === 'flow' ? 'graph' : 'graph-pyramid'
	);

	let nodes = $state.raw<CanvasFlowNode[]>([]);
	let autoPositions = $state.raw(new Map<string, XY>());
	let saved = $derived(loadPositions(ws.projectId, positionsKey));
	let pendingConnection = $state<{ fromId: string; toId: string } | null>(null);
	let legendOpen = $state(false);
	/** `<layout>:<drill-in id>` last fitted; a new layout or drill-in level fits again. */
	let fittedLayout: string | null = null;
	let lastFocusAt = 0;

	const showLabels = $derived(
		layout === 'pyramid' && variant === 'graph' && viewport.current.zoom > LABEL_ZOOM
	);

	// ── Composite collapse (filters → drill-in scope → collapseComposites) ──────

	const canvas = $derived(ws.canvas);
	const framesById = $derived(new Map(canvas.frames.map((f) => [f.artifactId, f])));
	/** Drawn as cards/cells; open composites are frames instead. */
	const nodeArtifacts = $derived(canvas.artifacts.filter((a) => canvas.nodeIds.has(a.id)));

	/** Open-issue tone per drawn node; a collapsed composite carries its hidden members' tones. */
	const nodeTones = $derived.by(() => {
		const map = new Map<string, IssueTone>();
		for (const [id, tone] of ws.issueToneByArtifact) {
			const shown = canvas.representative.get(id) ?? id;
			const current = map.get(shown);
			if (!current || TONE_RANK[tone] > TONE_RANK[current]) map.set(shown, tone);
		}
		return map;
	});

	/** Issue stroke for an edge whose two ends take part in one open issue. */
	function issueClass(a: string, b: string): string | false {
		const tone = ws.issueToneByPair.get(pairKey(a, b));
		return tone ? `tlon-issue-${tone}` : false;
	}

	function badgeOf(artifactId: string): CompositeBadge | null {
		const summary = ws.compositesById.get(artifactId);
		if (!summary) return null;
		return {
			level: ws.compositeLevels.get(artifactId) ?? 1,
			members: summary.memberArtifactIds.length
		};
	}

	/**
	 * Pyramid edge endpoints. A member hidden behind a collapsed composite resolves to that
	 * composite; an open composite resolves to its boundary (as `layoutPyramid` places it):
	 * an edge leaving it starts at its exits, an edge entering it ends at its entries.
	 */
	function ports(id: string, side: 'from' | 'to', seen = new Set<string>()): string[] {
		const shown = canvas.representative.get(id) ?? id;
		const frame = framesById.get(shown);
		if (!frame) return canvas.nodeIds.has(shown) ? [shown] : [];
		if (seen.has(shown)) return [];
		seen.add(shown);
		const drawnOf = (ids: readonly string[]) =>
			ids.filter((m) => canvas.nodeIds.has(m) || framesById.has(m));
		const boundary = drawnOf(side === 'from' ? frame.boundary.exits : frame.boundary.entries);
		return (boundary.length > 0 ? boundary : drawnOf(frame.memberArtifactIds)).flatMap((m) =>
			ports(m, side, seen)
		);
	}

	/** Every drawn (source, target) pair standing for one edge between two possibly open ends. */
	const portPairs = (fromId: string, toId: string) =>
		ports(fromId, 'from').flatMap((source) =>
			ports(toId, 'to')
				.filter((target) => target !== source)
				.map((target) => ({ source, target }))
		);
	/** One relation may fan out to several boundary members; extra copies get `#n`. */
	const edgeId = (id: string, index: number) => (index === 0 ? id : `${id}#${index}`);

	// ── Pyramid layout ───────────────────────────────────────────────────────────

	const pyramid = $derived(
		layout === 'pyramid'
			? layoutPyramid({
					artifacts: canvas.artifacts,
					relations: ws.relations,
					expansions: canvas.expansions,
					composites: canvas.composites,
					representative: canvas.representative
				})
			: null
	);

	const placements = $derived(
		pyramid
			? placePyramid(
					pyramid,
					nodeArtifacts.map((a) => a.id),
					scale
				)
			: new Map<string, PyramidPlacement>()
	);

	// ── Flow (ELK) layout ────────────────────────────────────────────────────────

	/** Dotted edges from each visible pending candidate to the anchors of its expansion. */
	const previewEdges = $derived.by(() => {
		const drawn = (id: string) => canvas.nodeIds.has(id) || framesById.has(id);
		const out: { id: string; source: string; target: string }[] = [];
		for (const expansion of canvas.expansions) {
			if (!isOpen(expansion)) continue;
			const left = canvas.representative.get(expansion.leftArtifactId) ?? expansion.leftArtifactId;
			const right =
				canvas.representative.get(expansion.rightArtifactId) ?? expansion.rightArtifactId;
			for (const c of ws.candidatesOf(expansion.id)) {
				if (c.reviewStatus !== 'PENDING' || !canvas.nodeIds.has(c.artifactId)) continue;
				if (drawn(left)) out.push({ id: `preview:${c.id}:l`, source: left, target: c.artifactId });
				if (drawn(right))
					out.push({ id: `preview:${c.id}:r`, source: c.artifactId, target: right });
			}
		}
		return out;
	});

	const bridgeDepth = $derived(
		new Map(
			ws.expansions
				.filter((e) => e.status === 'ACCEPTED' && e.selectedBridgeArtifactId)
				.map((e) => [e.selectedBridgeArtifactId as string, e.depth])
		)
	);

	/** Flow: each drawn node / frame sits inside the first open composite listing it. */
	const flowParents = $derived.by(() => {
		const parent = new Map<string, string>();
		for (const frame of canvas.frames) {
			for (const m of frame.memberArtifactIds) {
				if (parent.has(m) || m === frame.artifactId) continue;
				if (canvas.nodeIds.has(m) || framesById.has(m)) parent.set(m, frame.artifactId);
			}
		}
		return parent;
	});

	const flowLayoutEdges = $derived([
		...canvas.relations.map((r) => ({ id: r.id, source: r.fromId, target: r.toId })),
		...canvas.aggregatedEdges.map((e) => ({ id: e.id, source: e.fromId, target: e.toId })),
		...previewEdges
	]);

	/** ELK only re-runs when the visible structure changes, not on content edits. */
	const structureSignature = $derived(
		layout === 'flow'
			? JSON.stringify([
					nodeArtifacts.map((a) => [a.id, ws.compositesById.has(a.id)]),
					canvas.frames.map((f) => f.artifactId),
					[...flowParents],
					flowLayoutEdges.map((e) => e.id)
				])
			: ''
	);

	$effect(() => {
		if (structureSignature === '') return;
		const input = untrack(() => ({
			nodes: nodeArtifacts.map((a) => {
				const composite = ws.compositesById.has(a.id);
				return {
					id: a.id,
					width: composite ? COMPOSITE_WIDTH : NODE_WIDTH,
					height: composite ? COMPOSITE_HEIGHT : NODE_HEIGHT,
					parentId: flowParents.get(a.id) ?? null
				};
			}),
			containers: canvas.frames.map((f) => ({
				id: f.artifactId,
				parentId: flowParents.get(f.artifactId) ?? null
			})),
			edges: flowLayoutEdges
		}));
		let cancelled = false;
		layoutLayered(input.nodes, input.containers, input.edges)
			.then((positions) => {
				if (!cancelled) autoPositions = positions;
			})
			.catch((error: unknown) => toasts.error(error));
		return () => {
			cancelled = true;
		};
	});

	const layoutReady = $derived(layout === 'pyramid' ? pyramid !== null : autoPositions.size > 0);

	// ── Nodes ────────────────────────────────────────────────────────────────────

	/**
	 * Explicit size and handle geometry let Svelte Flow route edges to cells it never
	 * rendered (onlyRenderVisibleElements) instead of waiting for DOM measurement.
	 */
	function cellHandles(width: number, height: number) {
		const centre = { x: width / 2 - 0.5, y: height / 2, width: 1, height: 1 };
		return [
			{ id: 'c', type: 'source' as const, position: Position.Top, ...centre },
			{ id: 't', type: 'target' as const, position: Position.Top, ...centre },
			{
				id: 'link',
				type: 'source' as const,
				position: Position.Right,
				x: width - 4,
				y: height / 2 - 4,
				width: 8,
				height: 8
			}
		];
	}

	// Svelte Flow owns `nodes` (drag, measure, select); rebuild them from the model.
	$effect(() => {
		const previous = new Map(untrack(() => nodes).map((n) => [n.id, n]));
		const selection = ws.selection;
		const selectedId = selection?.type === 'artifact' ? selection.id : null;
		const isSelected = (id: string) => id === selectedId || ws.multi.has(id);
		const highlighted = ws.highlight?.artifactIds;
		const categoryOf = (artifact: Artifact) =>
			artifactCategory(artifact, ws.pendingCandidateIds, ws.acceptedBridgeIds);
		const rects = new Map<string, Rect>();
		let cards: CanvasFlowNode[];

		if (layout === 'flow') {
			cards = nodeArtifacts.map((artifact): ArtifactFlowNode | CompositeFlowNode => {
				const old = previous.get(artifact.id);
				const position = saved[artifact.id] ??
					autoPositions.get(artifact.id) ??
					old?.position ?? { x: 0, y: 0 };
				const badge = badgeOf(artifact.id);
				const measured = old?.measured ? { measured: old.measured } : {};
				if (badge) {
					rects.set(artifact.id, { ...position, width: COMPOSITE_WIDTH, height: COMPOSITE_HEIGHT });
					return {
						id: artifact.id,
						type: 'composite',
						position,
						data: {
							artifact,
							category: categoryOf(artifact),
							highlighted: highlighted?.has(artifact.id) ?? false,
							issue: nodeTones.get(artifact.id) ?? null,
							badge
						},
						selected: isSelected(artifact.id),
						...(old?.type === 'composite' ? measured : {})
					};
				}
				rects.set(artifact.id, { ...position, width: NODE_WIDTH, height: NODE_HEIGHT });
				return {
					id: artifact.id,
					type: 'artifact',
					position,
					data: {
						artifact,
						category: categoryOf(artifact),
						highlighted: highlighted?.has(artifact.id) ?? false,
						bridgeDepth: bridgeDepth.get(artifact.id) ?? null,
						stale: ws.staleBridgeIds.has(artifact.id),
						issue: nodeTones.get(artifact.id) ?? null
					},
					selected: isSelected(artifact.id),
					...(old?.type === 'artifact' ? measured : {})
				};
			});
		} else {
			const large = variant === 'fractal';
			const plainHandles = cellHandles(scale.cellWidth, scale.cellHeight);
			const compositeHandles = cellHandles(scale.compositeWidth, scale.compositeHeight);
			cards = nodeArtifacts.map((artifact): PyramidFlowNode => {
				const placement = placements.get(artifact.id);
				const composite = badgeOf(artifact.id);
				const width = composite ? scale.compositeWidth : scale.cellWidth;
				const height = composite ? scale.compositeHeight : scale.cellHeight;
				// Placements are top-left for a plain cell; a larger composite keeps its centre.
				const placed = placement?.position ?? { x: 0, y: 0 };
				const position = saved[artifact.id] ?? {
					x: placed.x - (width - scale.cellWidth) / 2,
					y: placed.y - (height - scale.cellHeight) / 2
				};
				rects.set(artifact.id, { ...position, width, height });
				const data: PyramidNodeData = {
					artifact,
					category: categoryOf(artifact),
					role: placement?.role ?? 'loose',
					depth: placement?.depth ?? 0,
					highlighted: highlighted?.has(artifact.id) ?? false,
					large,
					composite,
					stale: ws.staleBridgeIds.has(artifact.id),
					issue: nodeTones.get(artifact.id) ?? null
				};
				const selected = isSelected(artifact.id);
				// Keep the object identity of unchanged cells: Svelte Flow then skips them, so a
				// selection change on a 300-cell pyramid touches two nodes instead of all.
				const old = previous.get(artifact.id);
				if (
					old?.type === 'cell' &&
					old.selected === selected &&
					old.width === width &&
					old.height === height &&
					old.position.x === position.x &&
					old.position.y === position.y &&
					old.data.artifact === data.artifact &&
					old.data.category === data.category &&
					old.data.role === data.role &&
					old.data.depth === data.depth &&
					old.data.highlighted === data.highlighted &&
					old.data.large === large &&
					old.data.stale === data.stale &&
					old.data.issue === data.issue &&
					old.data.composite?.level === composite?.level &&
					old.data.composite?.members === composite?.members
				)
					return old;
				return {
					id: artifact.id,
					type: 'cell',
					position,
					width,
					height,
					handles: composite ? compositeHandles : plainHandles,
					data,
					selected
				};
			});
		}

		const geometry = layout === 'flow' ? FLOW_FRAME : scale.frame;
		const frameRect = frameRects(
			canvas.frames.map((f) => ({ id: f.artifactId, memberIds: f.memberArtifactIds })),
			rects,
			geometry
		);
		const frames = canvas.frames
			.flatMap((frame): FrameFlowNode[] => {
				const rect = frameRect.get(frame.artifactId);
				const artifact = ws.artifactsById.get(frame.artifactId);
				if (!rect || !artifact) return [];
				return [
					{
						id: frame.artifactId,
						type: 'frame',
						position: { x: rect.x, y: rect.y },
						width: rect.width,
						height: rect.height,
						zIndex: -1,
						draggable: false,
						selectable: false,
						connectable: layout === 'flow',
						data: {
							artifact,
							level: ws.compositeLevels.get(frame.artifactId) ?? 1,
							tab: geometry.tab,
							connectable: layout === 'flow'
						}
					}
				];
			})
			// Outer frames first, so nested ones paint above them.
			.toSorted((a, b) => b.data.level - a.data.level);
		nodes = [...frames, ...cards];
	});

	// ── Edges ────────────────────────────────────────────────────────────────────

	function relationClass(r: Relation, highlightRelation: string | null | undefined) {
		return [
			r.expandedByExpansionId !== null && 'tlon-edge-collapsed',
			r.status === 'PROPOSED' && 'tlon-edge-proposed',
			r.status === 'REJECTED' && 'tlon-edge-rejected',
			r.type === 'contradicts' && 'tlon-edge-tension',
			highlightRelation === r.id && 'tlon-edge-highlight',
			issueClass(r.fromId, r.toId)
		];
	}

	const joinClass = (parts: (string | false | null | undefined)[]) =>
		parts.filter(Boolean).join(' ');

	/**
	 * Virtual edge for relations hidden inside collapsed composites; never styled as a
	 * relation. Drawn as an arc dipping under the cards so its label never hides behind
	 * whatever sits between the two ends.
	 */
	function aggregatedEdge(e: AggregatedEdge, id: string, source: string, target: string): Edge {
		const selection = ws.selection;
		const pyramidCells = layout === 'pyramid';
		return {
			id,
			source,
			target,
			type: 'arc',
			...(pyramidCells ? { sourceHandle: 'c', targetHandle: 't' } : {}),
			// The label sits at half the dip: clear the cards' lower half plus a margin. The
			// final dip is stacked per label in `edges` so neighbouring labels never overlap.
			data: {
				minDip: (pyramidCells ? scale.compositeHeight : COMPOSITE_HEIGHT) * 2 + 40,
				aggregated: true
			},
			label: `aggregated (${e.sourceRelationIds.length})`,
			markerEnd: ARROW,
			selected: selection?.type === 'aggregate' && selection.id === e.id,
			class: joinClass([
				pyramidCells && 'tlon-arc',
				'tlon-edge-aggregated',
				...e.sourceRelationIds.map((rid) => {
					const r = ws.relationsById.get(rid);
					return r ? issueClass(r.fromId, r.toId) : false;
				})
			])
		};
	}

	/**
	 * Edges are fully derived: selection lives in the URL, so writes Svelte Flow makes to
	 * `edges` (selection toggles) are ignored via the function binding below.
	 */
	const flowEdges = $derived.by<Edge[]>(() => {
		const selection = ws.selection;
		const highlightRelation = ws.highlight?.relationId;
		return [
			...canvas.relations.map((r) => ({
				id: r.id,
				source: r.fromId,
				target: r.toId,
				type: 'labelled',
				label: r.type,
				markerEnd: ARROW,
				selected: selection?.type === 'relation' && selection.id === r.id,
				class: joinClass(relationClass(r, highlightRelation))
			})),
			...canvas.aggregatedEdges.map((e) => aggregatedEdge(e, e.id, e.fromId, e.toId)),
			...previewEdges.map((e) => ({
				id: e.id,
				source: e.source,
				target: e.target,
				class: 'tlon-edge-preview',
				markerEnd: ARROW,
				selectable: false,
				focusable: false
			}))
		];
	});

	/**
	 * Pyramid edges: every triangle is drawn apex→left and apex→right as thin straight
	 * lines. A side backed by a child relation selects that relation (so Expand and
	 * Collapse keep working from the inspector) — also when the relation itself is hidden
	 * as a collapsed parent edge, because its triangle still needs the side. Sides without
	 * a relation (open candidates, pair expansions) select their expansion. Every other
	 * visible relation — root links of the base line, contradictions — is a faint curve
	 * under the line. Ends on open composites resolve to their boundary members.
	 */
	const pyramidEdges = $derived.by<Edge[]>(() => {
		if (!pyramid) return [];
		const selection = ws.selection;
		const highlightRelation = ws.highlight?.relationId;
		const selectedExpansion = selection?.type === 'expansion' ? selection.id : null;
		const sideKey = (expansionId: string, a: string, b: string) =>
			a < b ? `${expansionId}:${a}:${b}` : `${expansionId}:${b}:${a}`;
		const sides = new Map<string, PyramidTriangle>();
		for (const t of pyramid.triangles) {
			sides.set(sideKey(t.expansionId, t.apexId, t.leftId), t);
			sides.set(sideKey(t.expansionId, t.apexId, t.rightId), t);
		}
		const triangleClass = (t: PyramidTriangle) => [
			'tlon-tri',
			!t.accepted && 'tlon-tri-open',
			selectedExpansion === t.expansionId && 'tlon-tri-selected'
		];

		const drawn = new Set<string>();
		const out: Edge[] = [];
		for (const r of canvas.relations) {
			const key = r.expansionId === null ? null : sideKey(r.expansionId, r.fromId, r.toId);
			const side = key === null ? undefined : sides.get(key);
			if (key !== null && side) drawn.add(key);
			const selected = selection?.type === 'relation' && selection.id === r.id;
			portPairs(r.fromId, r.toId).forEach(({ source, target }, index) => {
				out.push({
					id: edgeId(r.id, index),
					source,
					target,
					sourceHandle: 'c',
					targetHandle: 't',
					type: side ? 'labelled' : 'arc',
					...(side ? { data: { shape: 'straight' } } : {}),
					label: selected ? r.type : undefined,
					selected,
					class: joinClass([
						...(side ? triangleClass(side) : ['tlon-arc']),
						...relationClass(r, highlightRelation)
					])
				});
			});
		}
		const sideRelations = new Map<string, Relation>();
		for (const r of ws.relations) {
			if (r.expansionId !== null) sideRelations.set(sideKey(r.expansionId, r.fromId, r.toId), r);
		}
		for (const t of pyramid.triangles) {
			for (const anchor of [t.leftId, t.rightId]) {
				const key = sideKey(t.expansionId, t.apexId, anchor);
				if (drawn.has(key)) continue;
				drawn.add(key);
				const relation = sideRelations.get(key);
				ports(anchor, anchor === t.leftId ? 'from' : 'to').forEach((target, index) => {
					out.push({
						id: edgeId(relation?.id ?? `tri:${t.expansionId}:${t.apexId}:${anchor}`, index),
						source: t.apexId,
						target,
						sourceHandle: 'c',
						targetHandle: 't',
						type: 'straight',
						selected:
							relation !== undefined &&
							selection?.type === 'relation' &&
							selection.id === relation.id,
						class: joinClass([
							...triangleClass(t),
							relation !== undefined && highlightRelation === relation.id && 'tlon-edge-highlight',
							issueClass(t.apexId, anchor)
						]),
						selectable: relation !== undefined,
						focusable: false
					});
				});
			}
		}
		for (const e of canvas.aggregatedEdges) {
			portPairs(e.fromId, e.toId).forEach(({ source, target }, index) => {
				out.push(aggregatedEdge(e, edgeId(e.id, index), source, target));
			});
		}
		return out;
	});

	const baseEdges = $derived(layout === 'pyramid' ? pyramidEdges : flowEdges);

	/**
	 * Aggregated edges get one dip each so their labels never overlap. Anchors come from the
	 * current node boxes: pyramid cells connect at their centre, flow cards right → left.
	 */
	const edges = $derived.by<Edge[]>(() => {
		const boxes = new Map(nodes.map((n) => [n.id, n]));
		const anchor = (id: string, side: 'source' | 'target') => {
			const n = boxes.get(id);
			if (!n) return null;
			const width = n.width ?? n.measured?.width ?? 0;
			const height = n.height ?? n.measured?.height ?? 0;
			const y = n.position.y + height / 2;
			if (layout === 'pyramid') return { x: n.position.x + width / 2, y };
			return { x: side === 'source' ? n.position.x + width : n.position.x, y };
		};
		const arcs = baseEdges.flatMap((e) => {
			if (e.data?.aggregated !== true || typeof e.label !== 'string') return [];
			const source = anchor(e.source, 'source');
			const target = anchor(e.target, 'target');
			const minDip = typeof e.data.minDip === 'number' ? e.data.minDip : 0;
			return source && target ? [{ id: e.id, source, target, label: e.label, minDip }] : [];
		});
		if (arcs.length < 2) return baseEdges;
		const dips = stackArcLabels(arcs);
		return baseEdges.map((e) => {
			const dip = dips.get(e.id);
			return dip === undefined ? e : { ...e, data: { ...e.data, dip } };
		});
	});

	// ── Viewport ─────────────────────────────────────────────────────────────────

	/**
	 * `includeHiddenNodes` makes fitView use declared cell sizes: with
	 * onlyRenderVisibleElements most pyramid cells are never rendered, hence never measured.
	 */
	const FIT = { padding: 0.15, maxZoom: 1.2, includeHiddenNodes: true } as const;

	// Fit when a layout (or drill-in level) is first shown; later reloads keep the viewport.
	$effect(() => {
		const key = `${layout}:${ws.fractalScope === null ? '' : ws.fractalIn}`;
		if (!layoutReady || fittedLayout === key) return;
		fittedLayout = key;
		void tick().then(() => flow.fitView(FIT));
	});

	$effect(() => {
		const request = ws.focusRequest;
		if (!request || request.at === lastFocusAt) return;
		const known =
			framesById.has(request.artifactId) ||
			(layout === 'pyramid'
				? placements.has(request.artifactId)
				: autoPositions.has(request.artifactId));
		if (!known) return;
		lastFocusAt = request.at;
		untrack(() =>
			flow.fitView({
				nodes: [{ id: request.artifactId }],
				duration: 300,
				maxZoom: layout === 'pyramid' && variant === 'graph' ? 2 : 1.2,
				padding: 0.6,
				includeHiddenNodes: true
			})
		);
	});

	function onbeforeconnect(connection: Connection): false {
		if (connection.source !== connection.target) {
			pendingConnection = { fromId: connection.source, toId: connection.target };
		}
		// The edge is created server-side; the graph re-fetch renders it.
		return false;
	}

	function onnodeclick({ node, event }: { node: Node; event: MouseEvent | TouchEvent }) {
		if (event.shiftKey || event.metaKey || event.ctrlKey) {
			if (node.type === 'frame') return;
			if (ws.multi.has(node.id)) ws.multi.delete(node.id);
			else ws.multi.add(node.id);
			return;
		}
		ws.multi.clear();
		// A second click of a double-click drills into a composite (Fractal view).
		if (event.detail >= 2 && ws.compositesById.has(node.id)) {
			void ws.enterComposite(node.id);
			return;
		}
		void ws.select({ type: 'artifact', id: node.id });
	}

	/** Shift-drag box: the boxed cards become the multi-selection (frames excluded). */
	function onselectionend() {
		const boxed = nodes.filter((n) => n.selected && n.type !== 'frame').map((n) => n.id);
		if (boxed.length === 0) return;
		ws.multi.clear();
		for (const id of boxed) ws.multi.add(id);
	}

	function resetLayout() {
		saved = {};
		savePositions(ws.projectId, positionsKey, saved);
		flow.fitView({ ...FIT, duration: 300 });
	}

	function minimapColor(n: Node) {
		if (n.type === 'frame') return 'rgb(63 63 70 / 0.06)';
		if (n.selected) return 'var(--color-accent-500)';
		if (n.type === 'composite') return '#3f3f46';
		if (n.type === 'cell') {
			const data = n.data as PyramidNodeData;
			return data.composite ? '#3f3f46' : MINIMAP_ROLE_COLOR[data.role];
		}
		return '#d4d4d8';
	}
</script>

<div class={['absolute inset-0', showLabels && 'tlon-labels']}>
	<SvelteFlow
		bind:nodes
		bind:edges={() => edges, () => {}}
		{nodeTypes}
		{edgeTypes}
		fitView
		fitViewOptions={FIT}
		minZoom={layout === 'pyramid' ? 0.02 : 0.1}
		maxZoom={layout === 'pyramid' && variant === 'graph' ? 4 : 2}
		onlyRenderVisibleElements={layout === 'pyramid'}
		deleteKey={null}
		selectionKey="Shift"
		multiSelectionKey={['Shift', 'Meta', 'Control']}
		zoomOnDoubleClick={false}
		{onbeforeconnect}
		{onnodeclick}
		{onselectionend}
		onedgeclick={({ edge }) => ws.selectEdge(edge.id)}
		onpaneclick={() => {
			ws.multi.clear();
			ws.select(null);
		}}
		onnodedragstop={({ nodes: dragged }) => {
			const next = { ...saved };
			for (const n of dragged) next[n.id] = { x: n.position.x, y: n.position.y };
			saved = next;
			savePositions(ws.projectId, positionsKey, next);
		}}
	>
		<Background gap={layout === 'pyramid' ? scale.unitPx : 20} />
		<Controls showLock={false} fitViewOptions={FIT} />
		<MiniMap pannable zoomable nodeColor={minimapColor} />
		<Panel position="top-right">
			<div class="panel w-64 shadow-sm">
				<div class="flex items-center justify-between gap-2 px-3 py-1.5">
					<button
						class="section-title hover:text-zinc-800"
						aria-expanded={legendOpen}
						onclick={() => (legendOpen = !legendOpen)}>{legendOpen ? '▾' : '▸'} Legend</button
					>
					{#if Object.keys(saved).length > 0}
						<button class="text-[11px] text-accent-600 hover:underline" onclick={resetLayout}
							>Reset layout</button
						>
					{/if}
					{#if variant === 'graph'}
						<div
							class="ml-auto flex rounded border border-zinc-300 bg-zinc-100 p-px"
							role="radiogroup"
							aria-label="Graph layout"
						>
							{#each [['pyramid', 'Pyramid'], ['flow', 'Flow']] as const as [value, text] (value)}
								<button
									role="radio"
									aria-checked={layout === value}
									class={[
										'h-5 rounded-[3px] px-1.5 text-[11px] font-medium',
										layout === value
											? 'bg-white text-zinc-900 shadow-xs'
											: 'text-zinc-500 hover:text-zinc-800'
									]}
									title={value === 'pyramid'
										? 'Fractal pyramid: base line with bridges above their anchors'
										: 'Left→right flow of relations (ELK)'}
									onclick={() => ws.setGraphLayout(value)}>{text}</button
								>
							{/each}
						</div>
					{/if}
				</div>
				{#if legendOpen}
					<div class="border-t border-zinc-100 px-3 py-2"><Legend {layout} /></div>
				{/if}
			</div>
		</Panel>
		{#if ws.multi.size > 0}
			<Panel position="top-center">
				<div
					class="panel flex items-center gap-2 px-3 py-1.5 shadow-sm"
					role="toolbar"
					aria-label="Multi-selection"
				>
					<span class="text-xs text-zinc-600">{ws.multi.size} selected</span>
					<button
						class="btn btn-primary btn-sm"
						onclick={() => (ws.composeMemberIds = [...ws.multi])}>Compose selection</button
					>
					<button class="btn btn-ghost btn-sm" onclick={() => ws.multi.clear()}>Clear</button>
				</div>
			</Panel>
		{:else if ws.highlight && ws.highlight.relationId === null}
			{@const count = ws.highlight.artifactIds.size}
			<Panel position="top-center">
				<div
					class="panel flex items-center gap-2 px-3 py-1.5 shadow-sm"
					role="status"
					aria-label="Highlighted artifacts"
				>
					<span class="size-2.5 rounded-full bg-amber-300"></span>
					<span class="text-xs text-zinc-600">Highlighting {count} {ws.highlight.label}</span>
					<button class="btn btn-ghost btn-sm" onclick={() => (ws.highlight = null)}>Clear</button>
				</div>
			</Panel>
		{:else if canvas.nodeIds.size === 0}
			<Panel position="top-center">
				<div class="panel px-4 py-3 text-zinc-500 shadow-sm">
					{ws.artifacts.length === 0
						? 'No artifacts yet — use “New artifact” to create the first one.'
						: 'Every artifact is hidden by the current filters.'}
				</div>
			</Panel>
		{/if}
	</SvelteFlow>
</div>

{#if pendingConnection}
	<ConnectDialog
		fromId={pendingConnection.fromId}
		toId={pendingConnection.toId}
		onclose={() => (pendingConnection = null)}
	/>
{/if}
