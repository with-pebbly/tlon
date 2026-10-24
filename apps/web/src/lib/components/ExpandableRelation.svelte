<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import type { Relation } from '@tlon/contracts';

	/** A relation row with its expansion state and an Expand / Open action. */
	let { relation }: { relation: Relation } = $props();

	const ws = getWorkspace();

	let busy = $state(false);

	const accepted = $derived(ws.acceptedExpansionFor(relation.id));
	const open = $derived(ws.openExpansionFor(relation.id));

	async function expand() {
		busy = true;
		try {
			await ws.expandRelation(relation.id);
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs">
	<button
		class="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-accent-700"
		onclick={() => ws.select({ type: 'relation', id: relation.id })}
	>
		<span class="truncate">{ws.title(relation.fromId)}</span>
		<span class="shrink-0 font-mono text-[10px] text-zinc-400">—{relation.type}→</span>
		<span class="truncate">{ws.title(relation.toId)}</span>
	</button>
	{#if accepted}
		<button
			class="chip shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700"
			onclick={() => ws.select({ type: 'expansion', id: accepted.id })}
			>expanded d{accepted.depth}</button
		>
	{:else if open}
		<button
			class="btn btn-sm shrink-0"
			onclick={() => ws.select({ type: 'expansion', id: open.id })}>Open expansion</button
		>
	{:else if relation.status !== 'REJECTED'}
		<button class="btn btn-sm shrink-0" disabled={busy} onclick={expand}>Expand</button>
	{/if}
</div>
