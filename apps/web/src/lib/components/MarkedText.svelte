<script lang="ts">
	import { markQuotes } from '$lib/quotes';

	/** `text` with every occurrence of `quotes` highlighted (whitespace / quote marks normalised). */
	let { text, quotes }: { text: string; quotes: readonly string[] } = $props();

	const segments = $derived(markQuotes(text, quotes));
</script>

{#each segments as segment, i (i)}{#if segment.marked}<mark
			class="rounded-sm bg-amber-200/80 px-0.5 text-zinc-900"
			data-testid="quote-mark">{segment.text}</mark
		>{:else}{segment.text}{/if}{/each}
