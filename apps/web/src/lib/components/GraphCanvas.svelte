<script lang="ts">
	import '@xyflow/svelte/dist/style.css';
	import { layoutLayered, type XY } from '$lib/graph/layout';
	import { loadPositions, savePositions } from '$lib/graph/positions';
	import type { ArtifactFlowNode } from '$lib/graph/types';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { isOpen } from '$lib/state/workspace.svelte';
	import { artifactCategory } from '$lib/ui';
	import {
		Background,
		Controls,
		MarkerType,
		MiniMap,
		Panel,
		SvelteFlow,
		useSvelteFlow,
		type Connection,
		type Edge,
		type NodeTypes
	} from '@xyflow/svelte';
	import { untrack } from 'svelte';

	import ArtifactNode from './ArtifactNode.svelte';
	import ConnectDialog from './ConnectDialog.svelte';
	import Legend from './Legend.svelte';

	const VIEW_KEY = 'graph';
	const nodeTypes: NodeTypes = { artifact: ArtifactNode };
	const ARROW = { type: MarkerType.ArrowClosed, width: 16, height: 16 } as const;

	const ws = getWorkspace();
	const flow = useSvelteFlow();

	let nodes = $state.raw<ArtifactFlowNode[]>([]);
	let autoPositions = $state.raw(new Map<string, XY>());
	let saved = $state.raw<Record<string, XY>>(loadPositions(ws.projectId, VIEW_KEY));
	let pendingConnection = $state<{ fromId: string; toId: string } | null>(null);
	let legendOpen = $state(false);
	let fittedOnce = false;
	let lastFocusAt = 0;

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

	/** Layout only re-runs when the visible structure changes, not on content edits. */
	const structureSignature = $derived(
		JSON.stringify([
			ws.visibleArtifacts.map((a) => a.id),
			ws.visibleRelations.map((r) => r.id),
			previewEdges.map((e) => e.id)
		])
	);

	$effect(() => {
		void structureSignature;
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

	// Svelte Flow owns `nodes`/`edges` (drag, measure, select); rebuild them from the model.
	$effect(() => {
		const previous = new Map(untrack(() => nodes).map((n) => [n.id, n]));
		const selection = ws.selection;
		const highlighted = ws.highlight?.artifactIds;
		nodes = ws.visibleArtifacts.map((artifact) => {
			const old = previous.get(artifact.id);
			return {
				id: artifact.id,
				type: 'artifact',
				position: saved[artifact.id] ??
					autoPositions.get(artifact.id) ??
					old?.position ?? { x: 0, y: 0 },
				data: {
					artifact,
					category: artifactCategory(artifact, ws.pendingCandidateIds, ws.acceptedBridgeIds),
					highlighted: highlighted?.has(artifact.id) ?? false,
					bridgeDepth: bridgeDepth.get(artifact.id) ?? null
				},
				selected: selection?.type === 'artifact' && selection.id === artifact.id,
				...(old?.measured ? { measured: old.measured } : {})
			};
		});
	});

	/**
	 * Edges are fully derived: selection lives in the URL, so writes Svelte Flow makes to
	 * `edges` (selection toggles) are ignored via the function binding below.
	 */
	const edges = $derived.by<Edge[]>(() => {
		const selection = ws.selection;
		const highlightRelation = ws.highlight?.relationId;
		const relationEdges: Edge[] = ws.visibleRelations.map((r) => ({
			id: r.id,
			source: r.fromId,
			target: r.toId,
			label: r.type,
			markerEnd: ARROW,
			selected: selection?.type === 'relation' && selection.id === r.id,
			class: [
				r.expandedByExpansionId !== null && 'tlon-edge-collapsed',
				r.status === 'PROPOSED' && 'tlon-edge-proposed',
				r.status === 'REJECTED' && 'tlon-edge-rejected',
				r.type === 'contradicts' && 'tlon-edge-tension',
				highlightRelation === r.id && 'tlon-edge-highlight'
			]
				.filter(Boolean)
				.join(' ')
		}));
		return [
			...relationEdges,
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

	// Fit once the first automatic layout is applied; later reloads keep the viewport.
	$effect(() => {
		if (fittedOnce || autoPositions.size === 0) return;
		fittedOnce = true;
		flow.fitView({ padding: 0.2, maxZoom: 1.2 });
	});

	$effect(() => {
		const request = ws.focusRequest;
		if (!request || request.at === lastFocusAt || !autoPositions.has(request.artifactId)) return;
		lastFocusAt = request.at;
		untrack(() =>
			flow.fitView({
				nodes: [{ id: request.artifactId }],
				duration: 300,
				maxZoom: 1.2,
				padding: 0.6
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
		savePositions(ws.projectId, VIEW_KEY, saved);
		flow.fitView({ padding: 0.2, maxZoom: 1.2, duration: 300 });
	}
</script>

<div class="absolute inset-0">
	<SvelteFlow
		bind:nodes
		bind:edges={() => edges, () => {}}
		{nodeTypes}
		fitView
		minZoom={0.1}
		maxZoom={2}
		deleteKey={null}
		selectionKey={null}
		{onbeforeconnect}
		onnodeclick={({ node }) => ws.select({ type: 'artifact', id: node.id })}
		onedgeclick={({ edge }) => {
			if (!edge.id.startsWith('preview:')) ws.select({ type: 'relation', id: edge.id });
		}}
		onpaneclick={() => ws.select(null)}
		onnodedragstop={({ nodes: dragged }) => {
			const next = { ...saved };
			for (const n of dragged) next[n.id] = { x: n.position.x, y: n.position.y };
			saved = next;
			savePositions(ws.projectId, VIEW_KEY, next);
		}}
	>
		<Background gap={20} />
		<Controls showLock={false} />
		<MiniMap
			pannable
			zoomable
			nodeColor={(n) => (n.selected ? 'var(--color-accent-500)' : '#d4d4d8')}
		/>
		<Panel position="top-right">
			<div class="panel w-64 shadow-sm">
				<div class="flex items-center justify-between px-3 py-1.5">
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
				</div>
				{#if legendOpen}
					<div class="border-t border-zinc-100 px-3 py-2"><Legend /></div>
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
