<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { artifactCategory, CATEGORY_CARD, STATUS_TEXT } from '$lib/ui';

	import KindBadge from './KindBadge.svelte';

	const ws = getWorkspace();

	/** Relation linking two consecutive artifacts of a thread (for the separator label). */
	const relationBetween = $derived.by(() => {
		const map = new Map<string, string>();
		for (const r of ws.relations) {
			if (r.status === 'REJECTED') continue;
			// Child relations of an expansion win over the collapsed parent edge they replace.
			const key = `${r.fromId}|${r.toId}`;
			if (!map.has(key) || r.expandedByExpansionId === null) map.set(key, r.id);
		}
		return map;
	});
</script>

<div class="absolute inset-0 overflow-auto px-6 py-5">
	<div class="mb-1 flex items-baseline justify-between">
		<h2 class="font-semibold text-zinc-900">Timeline</h2>
		<span class="text-xs text-zinc-500"
			>One thread per root relation, read through its accepted bridges.</span
		>
	</div>
	<p class="mb-4 text-xs text-zinc-400">
		Order follows the expansion intervals; a bridge is not claimed to be a chronological midpoint.
	</p>
	{#if ws.timeline.length === 0}
		<p class="text-zinc-500">No relations yet.</p>
	{/if}
	<div class="flex flex-col gap-5">
		{#each ws.timeline as thread (thread.rootRelationId)}
			<section>
				<button
					class="mb-1.5 font-mono text-[11px] text-zinc-500 hover:text-accent-600"
					onclick={() => ws.select({ type: 'relation', id: thread.rootRelationId })}
					>root: {thread.type} · {thread.artifactIds.length} artifacts</button
				>
				<ol class="flex items-stretch gap-0 overflow-x-auto p-1 pb-2">
					{#each thread.artifactIds as artifactId, index (`${index}:${artifactId}`)}
						{@const artifact = ws.artifactsById.get(artifactId)}
						{#if index > 0}
							{@const prev = thread.artifactIds[index - 1] ?? ''}
							{@const relationId = relationBetween.get(`${prev}|${artifactId}`)}
							{@const relation = relationId ? ws.relationsById.get(relationId) : undefined}
							<li class="flex shrink-0 items-center px-1" aria-hidden={!relation}>
								{#if relation}
									<button
										class="flex flex-col items-center font-mono text-[10px] text-zinc-400 hover:text-accent-600"
										onclick={() => ws.select({ type: 'relation', id: relation.id })}
									>
										<span>{relation.type}</span>
										<span class="text-base leading-none">⟶</span>
									</button>
								{:else}
									<span class="text-zinc-300">⟶</span>
								{/if}
							</li>
						{/if}
						<li class="shrink-0">
							{#if artifact}
								<button
									class={[
										'flex h-full w-52 flex-col gap-1 rounded-lg border p-2 text-left shadow-xs hover:shadow-md',
										CATEGORY_CARD[
											artifactCategory(artifact, ws.pendingCandidateIds, ws.acceptedBridgeIds)
										],
										ws.selection?.id === artifact.id &&
											'outline-2 outline-offset-2 outline-accent-500'
									]}
									onclick={() => ws.select({ type: 'artifact', id: artifact.id })}
								>
									<span class="flex items-center gap-1.5 text-[11px]">
										<KindBadge kind={artifact.kind} />
										<span class={STATUS_TEXT[artifact.status]}>{artifact.status}</span>
									</span>
									<span class="line-clamp-3 font-medium text-zinc-900">{artifact.title}</span>
									{#if typeof artifact.structured.worldTime === 'string'}
										<span class="text-[11px] text-zinc-500"
											>world time: {artifact.structured.worldTime}</span
										>
									{/if}
								</button>
							{:else}
								<span
									class="block w-52 rounded-lg border border-dashed border-zinc-300 p-2 text-zinc-400"
									>Hidden artifact</span
								>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	</div>
</div>
