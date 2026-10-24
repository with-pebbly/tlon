<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import type { FractalNode } from '@tlon/core';

	import OutlineNode from './OutlineNode.svelte';

	let { node }: { node: FractalNode } = $props();

	const ws = getWorkspace();

	let open = $state(true);

	const relation = $derived(node.relation);
	const bridgeId = $derived(node.acceptedExpansion?.selectedBridgeArtifactId ?? null);
	const selected = $derived(ws.selection?.type === 'relation' && ws.selection.id === relation.id);
</script>

<li>
	<div
		class={[
			'group flex items-center gap-1 rounded px-1 py-0.5',
			selected ? 'bg-accent-50' : 'hover:bg-zinc-100'
		]}
	>
		{#if node.children.length > 0}
			<button
				class="w-4 shrink-0 text-[10px] text-zinc-400 hover:text-zinc-700"
				aria-label={open ? 'Collapse' : 'Expand'}
				aria-expanded={open}
				onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button
			>
		{:else}
			<span class="w-4 shrink-0"></span>
		{/if}
		<button
			class="flex min-w-0 flex-1 items-center gap-1 text-left text-xs"
			onclick={() => ws.select({ type: 'relation', id: relation.id })}
			title={`${ws.title(relation.fromId)} —${relation.type}→ ${ws.title(relation.toId)}`}
		>
			<span class="truncate text-zinc-700">{ws.title(relation.fromId)}</span>
			<span class="shrink-0 font-mono text-[10px] text-zinc-400">{relation.type}→</span>
			<span class="truncate text-zinc-700">{ws.title(relation.toId)}</span>
		</button>
		{#if node.openExpansions.length > 0}
			<span class="shrink-0 text-[10px] text-accent-600" title="Open expansion awaiting a decision"
				>●</span
			>
		{/if}
	</div>
	{#if open && node.children.length > 0}
		<ul class="ml-3 border-l border-zinc-200 pl-1">
			{#if bridgeId}
				<li>
					<button
						class="ml-5 block max-w-full truncate rounded px-1 text-left text-[11px] text-accent-700 hover:bg-accent-50"
						onclick={() => ws.focusArtifact(bridgeId)}
					>
						◆ {ws.title(bridgeId)}
					</button>
				</li>
			{/if}
			{#each node.children as child (child.relation.id)}
				<OutlineNode node={child} />
			{/each}
		</ul>
	{/if}
</li>
