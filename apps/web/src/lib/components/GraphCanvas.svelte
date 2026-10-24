<script lang="ts">
	import '@xyflow/svelte/dist/style.css';
	import {
		layoutLayered,
		placePyramid,
		PYRAMID_COMPACT,
		PYRAMID_LARGE,
		type PyramidPlacement,
		type PyramidRole,
		type XY
	} from '$lib/graph/layout';
	import { loadPositions, savePositions, type GraphLayout } from '$lib/graph/positions';
	import type { ArtifactFlowNode, PyramidFlowNode, PyramidNodeData } from '$lib/graph/types';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { isOpen } from '$lib/state/workspace.svelte';
	import { artifactCategory } from '$lib/ui';
	import type { Relation } from '@tlon/contracts';
	import { layoutPyramid, type PyramidTriangle } from '@tlon/core';
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
	import ConnectDialog from './ConnectDialog.svelte';
	import Legend from './Legend.svelte';
	import PyramidArcEdge from './PyramidArcEdge.svelte';
	import PyramidNode from './PyramidNode.svelte';

	/** 'graph': Graph view (pyramid by default, ELK flow on request); 'fractal': titled pyramid. */
	let { variant = 'graph' }: { variant?: 'graph' | 'fractal' } = $props();

	const nodeTypes: NodeTypes = { artifact: ArtifactNode, cell: PyramidNode };
	const edgeTypes: EdgeTypes = { arc: PyramidArcEdge };
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

	let nodes = $state.raw<(ArtifactFlowNode | PyramidFlowNode)[]>([]);
	let autoPositions = $state.raw(new Map<string, XY>());
	let saved = $derived(loadPositions(ws.projectId, positionsKey));
	let pendingConnection = $state<{ fromId: string; toId: string } | null>(null);
	let legendOpen = $state(false);
	let fittedLayout: GraphLayout | null = null;
	let lastFocusAt = 0;

	const showLabels = $derived(
		layout === 'pyramid' && variant === 'graph' && viewport.current.zoom > LABEL_ZOOM
	);

	// ── Pyramid layout ───────────────────────────────────────────────────────────

	const pyramid = $derived(
		layout === 'pyramid'
			? layoutPyramid({
					artifacts: ws.visibleArtifacts,
					relations: ws.relations,
					expansions: ws.expansions
				})
			: null
	);

	const placements = $derived(
		pyramid
			? placePyramid(
					pyramid,
					ws.visibleArtifacts.map((a) => a.id),
					scale
				)
			: new Map<string, PyramidPlacement>()
	);

	// ── Flow (ELK) layout ────────────────────────────────────────────────────────

	/** Dotted edges from each visible pending candidate to the anchors of its expansion. */
	const previewEdges = $derived.by(() => {
		const out: { id: string; source: string; target: string }[] = [];
		for (const expansion of ws.expansions) {
			if (!isOpen(expansion)) continue;
			for (const c of ws.candidatesOf(expansion.id)) {
				if (c.reviewStatus !== 'PENDING' || !ws.visibleArtifactIds.has(c.artifactId)) continue;
				if (ws.visibleArtifactIds.has(expansion.leftArtifactId)) {
					out.push({
						id: `preview:${c.id}:l`,
						source: expansion.leftArtifactId,
						target: c.artifactId
					});
				}
				if (ws.visibleArtifactIds.has(expansion.rightArtifactId)) {
					out.push({
						id: `preview:${c.id}:r`,
						source: c.artifactId,
						target: expansion.rightArtifactId
					});
				}
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

	/** ELK only re-runs when the visible structure changes, not on content edits. */
	const structureSignature = $derived(
		layout === 'flow'
			? JSON.stringify([
					ws.visibleArtifacts.map((a) => a.id),
					ws.visibleRelations.map((r) => r.id),
					previewEdges.map((e) => e.id)
				])
			: ''
	);

	$effect(() => {
		if (structureSignature === '') return;
		const { nodeIds, layoutEdges } = untrack(() => ({
			nodeIds: ws.visibleArtifacts.map((a) => a.id),
			layoutEdges: [
				...ws.visibleRelations.map((r) => ({ id: r.id, source: r.fromId, target: r.toId })),
				...previewEdges
			]
		}));
		let cancelled = false;
		layoutLayered(nodeIds, layoutEdges)
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

	// Svelte Flow owns `nodes` (drag, measure, select); rebuild them from the model.
	$effect(() => {
		const previous = new Map(untrack(() => nodes).map((n) => [n.id, n]));
		const selection = ws.selection;
		const selectedId = selection?.type === 'artifact' ? selection.id : null;
		const highlighted = ws.highlight?.artifactIds;
		const categoryOf = (artifact: (typeof ws.visibleArtifacts)[number]) =>
			artifactCategory(artifact, ws.pendingCandidateIds, ws.acceptedBridgeIds);

		if (layout === 'flow') {
			nodes = ws.visibleArtifacts.map((artifact): ArtifactFlowNode => {
				const old = previous.get(artifact.id);
				return {
					id: artifact.id,
					type: 'artifact',
					position: saved[artifact.id] ??
						autoPositions.get(artifact.id) ??
						old?.position ?? { x: 0, y: 0 },
					data: {
						artifact,
						category: categoryOf(artifact),
						highlighted: highlighted?.has(artifact.id) ?? false,
						bridgeDepth: bridgeDepth.get(artifact.id) ?? null
					},
					selected: artifact.id === selectedId,
					...(old?.type === 'artifact' && old.measured ? { measured: old.measured } : {})
				};
			});
			return;
		}

		// Explicit size and handle geometry let Svelte Flow route edges to cells it never
		// rendered (onlyRenderVisibleElements) instead of waiting for DOM measurement.
		const { cellWidth: width, cellHeight: height } = scale;
		const centre = { x: width / 2 - 0.5, y: height / 2, width: 1, height: 1 };
		const handles = [
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
		const large = variant === 'fractal';
		nodes = ws.visibleArtifacts.map((artifact): PyramidFlowNode => {
			const placement = placements.get(artifact.id);
			const position = saved[artifact.id] ?? placement?.position ?? { x: 0, y: 0 };
			const data: PyramidNodeData = {
				artifact,
				category: categoryOf(artifact),
				role: placement?.role ?? 'loose',
				depth: placement?.depth ?? 0,
				highlighted: highlighted?.has(artifact.id) ?? false,
				large
			};
			const selected = artifact.id === selectedId;
			// Keep the object identity of unchanged cells: Svelte Flow then skips them, so a
			// selection change on a 300-cell pyramid touches two nodes instead of all.
			const old = previous.get(artifact.id);
			if (
				old?.type === 'cell' &&
				old.selected === selected &&
				old.width === width &&
				old.position.x === position.x &&
				old.position.y === position.y &&
				old.data.artifact === data.artifact &&
				old.data.category === data.category &&
				old.data.role === data.role &&
				old.data.depth === data.depth &&
				old.data.highlighted === data.highlighted &&
				old.data.large === large
			)
				return old;
			return {
				id: artifact.id,
				type: 'cell',
				position,
				width,
				height,
				handles,
				data,
				selected
			};
		});
	});

	// ── Edges ────────────────────────────────────────────────────────────────────

	function relationClass(r: Relation, highlightRelation: string | undefined) {
		return [
			r.expandedByExpansionId !== null && 'tlon-edge-collapsed',
			r.status === 'PROPOSED' && 'tlon-edge-proposed',
			r.status === 'REJECTED' && 'tlon-edge-rejected',
			r.type === 'contradicts' && 'tlon-edge-tension',
			highlightRelation === r.id && 'tlon-edge-highlight'
		];
	}

	const joinClass = (parts: (string | false | null | undefined)[]) =>
		parts.filter(Boolean).join(' ');

	/**
	 * Edges are fully derived: selection lives in the URL, so writes Svelte Flow makes to
	 * `edges` (selection toggles) are ignored via the function binding below.
	 */
	const flowEdges = $derived.by<Edge[]>(() => {
		const selection = ws.selection;
		const highlightRelation = ws.highlight?.relationId;
		return [
			...ws.visibleRelations.map((r) => ({
				id: r.id,
				source: r.fromId,
				target: r.toId,
				label: r.type,
				markerEnd: ARROW,
				selected: selection?.type === 'relation' && selection.id === r.id,
				class: joinClass(relationClass(r, highlightRelation))
			})),
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
	 * under the line.
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
		for (const r of ws.visibleRelations) {
			const key = r.expansionId === null ? null : sideKey(r.expansionId, r.fromId, r.toId);
			const side = key === null ? undefined : sides.get(key);
			if (key !== null && side) drawn.add(key);
			const selected = selection?.type === 'relation' && selection.id === r.id;
			out.push({
				id: r.id,
				source: r.fromId,
				target: r.toId,
				sourceHandle: 'c',
				targetHandle: 't',
				type: side ? 'straight' : 'arc',
				label: selected ? r.type : undefined,
				selected,
				class: joinClass([
					...(side ? triangleClass(side) : ['tlon-arc']),
					...relationClass(r, highlightRelation)
				])
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
				out.push({
					id: relation?.id ?? `tri:${t.expansionId}:${t.apexId}:${anchor}`,
					source: t.apexId,
					target: anchor,
					sourceHandle: 'c',
					targetHandle: 't',
					type: 'straight',
					selected:
						relation !== undefined &&
						selection?.type === 'relation' &&
						selection.id === relation.id,
					class: joinClass([
						...triangleClass(t),
						relation !== undefined && highlightRelation === relation.id && 'tlon-edge-highlight'
					]),
					selectable: relation !== undefined,
					focusable: false
				});
			}
		}
		return out;
	});

	const edges = $derived(layout === 'pyramid' ? pyramidEdges : flowEdges);

	// ── Viewport ─────────────────────────────────────────────────────────────────

	/**
	 * `includeHiddenNodes` makes fitView use declared cell sizes: with
	 * onlyRenderVisibleElements most pyramid cells are never rendered, hence never measured.
	 */
	const FIT = { padding: 0.15, maxZoom: 1.2, includeHiddenNodes: true } as const;

	// Fit when a layout is first shown; later reloads keep the viewport.
	$effect(() => {
		if (!layoutReady || fittedLayout === layout) return;
		fittedLayout = layout;
		void tick().then(() => flow.fitView(FIT));
	});

	$effect(() => {
		const request = ws.focusRequest;
		if (!request || request.at === lastFocusAt) return;
		const known =
			layout === 'pyramid'
				? placements.has(request.artifactId)
				: autoPositions.has(request.artifactId);
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

	function resetLayout() {
		saved = {};
		savePositions(ws.projectId, positionsKey, saved);
		flow.fitView({ ...FIT, duration: 300 });
	}

	function minimapColor(n: Node) {
		if (n.selected) return 'var(--color-accent-500)';
		if (n.type === 'cell') return MINIMAP_ROLE_COLOR[(n.data as PyramidNodeData).role];
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
		selectionKey={null}
		{onbeforeconnect}
		onnodeclick={({ node }) => ws.select({ type: 'artifact', id: node.id })}
		onedgeclick={({ edge }) => {
			// Synthetic triangle sides are `tri:<expansionId>:<apexId>:<anchorId>`.
			if (edge.id.startsWith('tri:'))
				ws.select({ type: 'expansion', id: edge.id.slice(4, edge.id.indexOf(':', 4)) });
			else if (!edge.id.startsWith('preview:')) ws.select({ type: 'relation', id: edge.id });
		}}
		onpaneclick={() => ws.select(null)}
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
		{#if ws.visibleArtifacts.length === 0}
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
