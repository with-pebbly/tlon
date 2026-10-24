<script lang="ts">
	import type { BlockView } from '@tlon/contracts';

	let {
		block,
		label,
		emphasis = false
	}: { block: BlockView; label: string; emphasis?: boolean } = $props();
</script>

<article
	class={[
		'flex flex-col gap-1.5 rounded-lg border bg-white p-3',
		emphasis ? 'border-zinc-500 shadow-sm' : 'border-zinc-200'
	]}
	aria-label="{label}: {block.title}"
>
	<span class="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
	<h3 class="font-semibold text-zinc-900">{block.title}</h3>
	{#if block.body}
		<p class="text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-700">{block.body}</p>
	{/if}
</article>
