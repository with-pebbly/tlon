<script lang="ts">
	import { DIRECTION_TEXT, FACT_KIND_ICON } from '$lib/protocol';
	import type { TaskSubmission, TaskView } from '@tlon/contracts';

	import BlockCard from './BlockCard.svelte';
	import BlockFields from './BlockFields.svelte';

	let {
		view,
		busy,
		onsubmit
	}: {
		view: Extract<TaskView, { type: 'advance_block' }>;
		busy: boolean;
		onsubmit: (submission: TaskSubmission) => void;
	} = $props();

	let title = $state('');
	let body = $state('');
	const ready = $derived(title.trim() !== '' && body.trim() !== '');
	const direction = $derived(DIRECTION_TEXT[view.direction]);
	/** Earlier own blocks leading to the one being continued (oldest first). */
	const chain = $derived(view.localContext.filter((b) => b.id !== view.ownBlock.id));
</script>

<form
	class="flex flex-col gap-5"
	onsubmit={(event) => {
		event.preventDefault();
		if (ready) onsubmit({ type: 'advance_block', block: { kind: 'EVENT', title, body } });
	}}
>
	{#if chain.length > 0}
		<details class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
			<summary class="cursor-pointer text-sm font-medium text-zinc-700"
				>Your earlier blocks ({chain.length})</summary
			>
			<ol class="mt-2 flex flex-col gap-2">
				{#each chain as block (block.id)}
					<li><BlockCard {block} label="Earlier" /></li>
				{/each}
			</ol>
		</details>
	{/if}

	<BlockCard block={view.ownBlock} label="Your block" emphasis />

	<section
		aria-labelledby="fact-heading"
		class="rounded-lg border-2 border-amber-400 bg-amber-50 p-4"
		data-testid="disclosed-fact"
	>
		<h2 id="fact-heading" class="text-[11px] font-semibold tracking-wide text-amber-800 uppercase">
			The Fact
		</h2>
		<p class="mt-1 text-lg font-medium text-zinc-900">
			<span aria-hidden="true">{FACT_KIND_ICON[view.fact.kind]}</span>
			{view.fact.text}
		</p>
		<p class="mt-1 text-xs text-amber-900">Kind: {view.fact.kind}</p>
	</section>

	<section class="text-sm leading-relaxed text-zinc-700">
		<h2 class="font-semibold text-zinc-900">{direction.title}</h2>
		<p>{direction.detail}</p>
		<p class="mt-1 text-zinc-600">
			The Fact should matter to what you write, not appear as a mandatory phrase. You don't need to
			name it word for word.
		</p>
	</section>

	<BlockFields idPrefix="advance" bind:title bind:body />
	<div class="flex justify-end">
		<button class="btn btn-primary" type="submit" disabled={!ready || busy}
			>{busy ? 'Submitting…' : 'Submit block'}</button
		>
	</div>
</form>
