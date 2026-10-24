<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import type { FractalNode } from '@tlon/core';
	import { countAcceptedBridges } from '@tlon/core';

	import FractalRow from './FractalRow.svelte';
	import KindBadge from './KindBadge.svelte';

	let { node }: { node: FractalNode } = $props();

	const ws = getWorkspace();

	let open = $state(true);
	let expanding = $state(false);

	const relation = $derived(node.relation);
	const accepted = $derived(node.acceptedExpansion);
	const bridge = $derived(
		accepted?.selectedBridgeArtifactId
			? ws.artifactsById.get(accepted.selectedBridgeArtifactId)
			: undefined
	);
	const selected = $derived(ws.selection?.type === 'relation' && ws.selection.id === relation.id);
	const bridgeCount = $derived(countAcceptedBridges(node));

	async function expand() {
		expanding = true;
		try {
			await ws.expandRelation(relation.id);
		} catch (error) {
			toasts.error(error);
		} finally {
			expanding = false;
		}
	}
</script>

<li>
	<div
		class={[
			'group flex items-center gap-2 rounded-md border px-2 py-1.5',
			selected ? 'border-accent-500 bg-accent-50' : 'border-transparent hover:bg-white'
		]}
	>
		{#if node.children.length > 0}
			<button
				class="w-4 shrink-0 text-xs text-zinc-400 hover:text-zinc-700"
				aria-label={open ? 'Collapse row' : 'Expand row'}
				aria-expanded={open}
				onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button
			>
		{:else}
			<span class="w-4 shrink-0"></span>
		{/if}
		<span
			class="chip shrink-0 border-zinc-200 bg-zinc-100 font-mono text-zinc-500"
			title="Expansion depth of this interval">d{node.depth}</span
		>
		<button
			class="flex min-w-0 flex-1 items-center gap-2 text-left"
			onclick={() => ws.select({ type: 'relation', id: relation.id })}
		>
			<span class="truncate font-medium text-zinc-800">{ws.title(relation.fromId)}</span>
			<span class="shrink-0 font-mono text-[11px] text-zinc-400">—{relation.type}→</span>
			<span class="truncate font-medium text-zinc-800">{ws.title(relation.toId)}</span>
			{#if relation.status !== 'ACCEPTED'}
				<span class="shrink-0 text-[11px] text-zinc-400">{relation.status}</span>
			{/if}
		</button>
		{#each node.openExpansions as expansion (expansion.id)}
			<button
				class="chip shrink-0 border-accent-200 bg-accent-50 text-accent-700 hover:border-accent-500"
				title="Open expansion awaiting a decision"
				onclick={() => ws.select({ type: 'expansion', id: expansion.id })}
				>● {expansion.status.toLowerCase()} · {ws.candidatesOf(expansion.id).length} cand.</button
			>
		{/each}
		{#if accepted}
			<span class="shrink-0 text-[11px] text-zinc-400"
				>{bridgeCount} bridge{bridgeCount === 1 ? '' : 's'} below</span
			>
		{:else if node.openExpansions.length === 0 && relation.status !== 'REJECTED'}
			<button
				class="btn btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100"
				disabled={expanding}
				onclick={expand}>Expand</button
			>
		{/if}
	</div>

	{#if open && accepted && bridge}
		<ul class="ml-[22px] border-l border-dashed border-accent-200 pl-3">
			<li class="my-0.5 flex items-center gap-2">
				<button
					class={[
						'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white',
						ws.selection?.id === bridge.id && 'bg-accent-50'
					]}
					onclick={() => ws.select({ type: 'artifact', id: bridge.id })}
				>
					<span class="text-accent-600">◆</span>
					<KindBadge kind={bridge.kind} />
					<span class="truncate text-accent-700">{bridge.title}</span>
				</button>
				<button
					class="shrink-0 text-[11px] text-zinc-400 hover:text-accent-600"
					onclick={() => ws.select({ type: 'expansion', id: accepted.id })}
					>expansion d{accepted.depth}</button
				>
			</li>
			{#each node.children as child (child.relation.id)}
				<FractalRow node={child} />
			{/each}
		</ul>
	{/if}
</li>
