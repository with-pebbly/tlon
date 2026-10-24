<script lang="ts">
	import { getWorkspace } from '$lib/state/context';

	import FractalRow from './FractalRow.svelte';

	const ws = getWorkspace();

	/** Expansions opened on an ordered artifact pair rather than a relation. */
	const pairExpansions = $derived(ws.expansions.filter((e) => e.targetRelationId === null));
	const maxDepth = $derived(ws.expansions.reduce((max, e) => Math.max(max, e.depth), 0));
</script>

<div class="absolute inset-0 overflow-auto px-6 py-5">
	<div class="mx-auto max-w-4xl">
		<div class="mb-3 flex items-baseline justify-between">
			<h2 class="font-semibold text-zinc-900">Expansion hierarchy</h2>
			<span class="text-xs text-zinc-500">
				{ws.expansions.filter((e) => e.status === 'ACCEPTED').length} accepted bridges · max depth {maxDepth}
				/ {ws.project?.settings.maxDepth}
			</span>
		</div>
		{#if ws.fractal.length === 0}
			<p class="text-zinc-500">No relations yet. Link two artifacts in the Graph view first.</p>
		{:else}
			<ul class="flex flex-col gap-0.5">
				{#each ws.fractal as node (node.relation.id)}
					<FractalRow {node} />
				{/each}
			</ul>
		{/if}

		{#if pairExpansions.length > 0}
			<h3 class="section-title mt-6 mb-2">Expansions on artifact pairs</h3>
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
</div>
