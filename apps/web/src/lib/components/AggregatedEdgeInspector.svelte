<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import type { AggregatedEdge } from '@tlon/core';

	let { edge }: { edge: AggregatedEdge } = $props();

	const ws = getWorkspace();
</script>

<div class="flex flex-col gap-3">
	<header class="flex flex-col gap-1">
		<span class="chip self-start border-dashed border-zinc-400 bg-zinc-50 font-mono text-zinc-600"
			>aggregated edge</span
		>
		<h2 class="text-[15px] leading-snug font-semibold text-zinc-900">
			{ws.title(edge.fromId)} ⇢ {ws.title(edge.toId)}
		</h2>
		<p class="text-xs text-zinc-500">
			Virtual, never persisted: it stands for {edge.sourceRelationIds.length} real relation{edge
				.sourceRelationIds.length === 1
				? ''
				: 's'} touching members hidden inside a collapsed composite. Open the composite to see them in
			place.
		</p>
	</header>
	<section>
		<h3 class="section-title mb-1.5">Source relations</h3>
		<ul class="flex flex-col gap-0.5 text-xs">
			{#each edge.sourceRelationIds as relationId (relationId)}
				{@const relation = ws.relationsById.get(relationId)}
				<li>
					{#if relation}
						<button
							class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-zinc-100"
							onclick={() => ws.select({ type: 'relation', id: relation.id })}
						>
							<span class="truncate text-zinc-700">{ws.title(relation.fromId)}</span>
							<span class="shrink-0 font-mono text-[10px] text-zinc-400">—{relation.type}→</span>
							<span class="truncate text-zinc-700">{ws.title(relation.toId)}</span>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
	<div class="flex flex-wrap gap-1.5">
		{#each [edge.fromId, edge.toId] as id (id)}
			{#if ws.compositesById.has(id) && !ws.openComposites.has(id)}
				<button class="btn btn-sm" onclick={() => ws.setCompositeOpen(id, true)}
					>Open {ws.title(id)}</button
				>
			{/if}
		{/each}
	</div>
</div>
