<!--
	`revise_block`: the owning side repairs one of its own Blocks. Problems come first, with
	their quotes highlighted inside the side's own chain; the editor starts from the Block as
	it stands, and the submission becomes a new revision of that same Block.
-->
<script lang="ts">
	import type { TaskSubmission, TaskView } from '@tlon/contracts';

	import BlockCard from './BlockCard.svelte';
	import BlockFields from './BlockFields.svelte';

	let {
		view,
		busy,
		onsubmit
	}: {
		view: Extract<TaskView, { type: 'revise_block' }>;
		busy: boolean;
		onsubmit: (submission: TaskSubmission) => void;
	} = $props();

	// The editor is mounted per task ({#key}): it starts from the Block as served.
	// svelte-ignore state_referenced_locally
	let title = $state(view.ownBlock.title);
	// svelte-ignore state_referenced_locally
	let body = $state(view.ownBlock.body);

	const changed = $derived(
		title.trim() !== view.ownBlock.title.trim() || body.trim() !== view.ownBlock.body.trim()
	);
	const ready = $derived(title.trim() !== '' && body.trim() !== '' && changed);
	/** Position of each own Block in the chain (1-based), for "block 3" references. */
	const position = $derived(new Map(view.localContext.map((b, i) => [b.id, i + 1])));
	const evidenceByBlock = $derived(
		Map.groupBy(
			view.problems.flatMap((p) => p.evidence),
			(item) => item.blockId
		)
	);
</script>

<form
	class="flex flex-col gap-5"
	onsubmit={(event) => {
		event.preventDefault();
		if (ready) onsubmit({ type: 'revise_block', block: { kind: view.ownBlock.kind, title, body } });
	}}
>
	<section
		aria-labelledby="problems-heading"
		class="flex flex-col gap-3 rounded-lg border-2 border-rose-300 bg-rose-50 p-4"
		data-testid="revise-problems"
	>
		<h2
			id="problems-heading"
			class="text-[11px] font-semibold tracking-wide text-rose-800 uppercase"
		>
			What doesn't fit in your story ({view.problems.length})
		</h2>
		<ol class="flex flex-col gap-3">
			{#each view.problems as problem, i (i)}
				<li class="flex flex-col gap-1.5">
					<p class="text-zinc-900">{problem.explanation}</p>
					{#each problem.evidence as item, j (j)}
						{@const at = position.get(item.blockId)}
						<blockquote class="border-l-2 border-rose-300 pl-2 text-sm text-zinc-700">
							«{item.quote}»
							<button
								type="button"
								class="text-xs text-rose-700 hover:underline"
								onclick={() =>
									document
										.getElementById(`revise-block-${item.blockId}`)
										?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
								>— {item.blockId === view.ownBlock.id
									? 'the block to repair'
									: at === undefined
										? 'your story'
										: `your block ${at}`}</button
							>
						</blockquote>
					{/each}
				</li>
			{/each}
		</ol>
		{#if view.instructions}
			<div class="rounded border border-rose-200 bg-white px-3 py-2 text-sm text-zinc-800">
				<span class="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
					>Note from the facilitator</span
				>
				<p class="whitespace-pre-wrap">{view.instructions}</p>
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-2" aria-labelledby="chain-heading">
		<h2 id="chain-heading" class="text-sm font-semibold text-zinc-900">
			Your story so far ({view.localContext.length} block{view.localContext.length === 1
				? ''
				: 's'})
		</h2>
		<ol class="flex flex-col gap-2">
			{#each view.localContext as block, i (block.id)}
				<li>
					<BlockCard
						{block}
						anchor="revise-block-{block.id}"
						label={block.id === view.ownBlock.id ? `Block ${i + 1} — to repair` : `Block ${i + 1}`}
						emphasis={block.id === view.ownBlock.id}
						quotes={evidenceByBlock.get(block.id)?.map((item) => item.quote) ?? []}
					/>
				</li>
			{/each}
		</ol>
	</section>

	<section class="text-sm leading-relaxed text-zinc-700">
		<h2 class="font-semibold text-zinc-900">Make the smallest change that fixes it</h2>
		<p>
			Change only what contradicts the rest of your story — a name, a date, who wrote to whom. Keep
			everything else as it is: the scene, its events and its voice stay the same. Your edit
			replaces this block; the earlier version is kept in its history.
		</p>
	</section>

	<BlockFields idPrefix="revise" bind:title bind:body />
	<div class="flex items-center justify-end gap-3">
		{#if !changed}
			<span class="text-xs text-zinc-500">Nothing changed yet.</span>
		{/if}
		<button class="btn btn-primary" type="submit" disabled={!ready || busy}
			>{busy ? 'Submitting…' : 'Submit revised block'}</button
		>
	</div>
</form>
