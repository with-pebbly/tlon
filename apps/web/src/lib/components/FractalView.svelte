<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	import FractalRow from './FractalRow.svelte';
	import GraphCanvas from './GraphCanvas.svelte';

	const ws = getWorkspace();

	/** Secondary panel: the left rail outline already shows the same hierarchy. */
	let treeOpen = $state(false);

	/** Expansions opened on an ordered artifact pair rather than a relation. */
	const pairExpansions = $derived(ws.expansions.filter((e) => e.targetRelationId === null));
	const maxDepth = $derived(ws.expansions.reduce((max, e) => Math.max(max, e.depth), 0));
</script>

<!-- The pyramid with titled cells; the indented hierarchy (with Expand actions) on demand. -->
<div class="absolute inset-0 flex">
	<div class="relative min-w-0 flex-1">
		<SvelteFlowProvider>
			<GraphCanvas variant="fractal" />
		</SvelteFlowProvider>
		{#if !treeOpen}
			<button
				class="btn btn-sm absolute top-2 left-2 z-10 bg-white shadow-sm"
				onclick={() => (treeOpen = true)}>▸ Expansion hierarchy</button
			>
		{/if}
	</div>
	{#if treeOpen}
		<aside
			class="flex w-[26rem] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50"
			aria-label="Expansion hierarchy"
		>
			<div class="flex items-baseline justify-between gap-2 border-b border-zinc-200 px-3 py-2">
				<h2 class="font-semibold text-zinc-900">Expansion hierarchy</h2>
				<span class="text-[11px] text-zinc-500">
					{ws.expansions.filter((e) => e.status === 'ACCEPTED').length} bridges · depth {maxDepth}
					/ {ws.project?.settings.maxDepth}
				</span>
				<button
					class="ml-auto text-[11px] text-zinc-500 hover:text-zinc-800"
					aria-label="Hide expansion hierarchy"
					onclick={() => (treeOpen = false)}>Hide ◂</button
				>
			</div>
			<div class="min-h-0 flex-1 overflow-auto px-2 py-2">
				{#if ws.fractal.length === 0}
					<p class="px-2 text-zinc-500">
						No relations yet. Link two artifacts in the Graph view first.
					</p>
				{:else}
					<ul class="flex flex-col gap-0.5">
						{#each ws.fractal as node (node.relation.id)}
							<FractalRow {node} />
						{/each}
					</ul>
				{/if}

				{#if pairExpansions.length > 0}
					<h3 class="section-title mt-6 mb-2 px-2">Expansions on artifact pairs</h3>
					<ul class="flex flex-col gap-1">
						{#each pairExpansions as expansion (expansion.id)}
							<li>
								<button
									class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white"
									onclick={() => ws.select({ type: 'expansion', id: expansion.id })}
								>
									<span class="chip border-zinc-200 bg-zinc-100 font-mono text-zinc-500"
										>d{expansion.depth}</span
									>
									<span class="truncate">{ws.title(expansion.leftArtifactId)}</span>
									<span class="text-zinc-400">⇢</span>
									<span class="truncate">{ws.title(expansion.rightArtifactId)}</span>
									<span class="ml-auto text-[11px] text-zinc-500">{expansion.status}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</aside>
	{/if}
</div>
