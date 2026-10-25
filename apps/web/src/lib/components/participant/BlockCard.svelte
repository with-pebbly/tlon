<script lang="ts">
	import type { BlockView } from '@tlon/contracts';

	import MarkedText from '../MarkedText.svelte';

	let {
		block,
		label,
		emphasis = false,
		quotes = [],
		anchor
	}: {
		block: BlockView;
		label: string;
		emphasis?: boolean;
		/** Passages to highlight in the title and text (problem quotes of a revise task). */
		quotes?: readonly string[];
		/** Element id, so problem quotes can link to the card. */
		anchor?: string;
	} = $props();
</script>

<article
	id={anchor}
	class={[
		'flex scroll-mt-4 flex-col gap-1.5 rounded-lg border bg-white p-3',
		emphasis ? 'border-zinc-500 shadow-sm' : 'border-zinc-200'
	]}
	aria-label="{label}: {block.title}"
>
	<span class="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
	<h3 class="font-semibold text-zinc-900"><MarkedText text={block.title} {quotes} /></h3>
	{#if block.body}
		<p class="text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-700">
			<MarkedText text={block.body} {quotes} />
		</p>
	{/if}
</article>
