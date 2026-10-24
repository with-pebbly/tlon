<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		onclose,
		width = 'w-[420px]',
		children
	}: { title: string; onclose: () => void; width?: string; children: Snippet } = $props();

	/** Opens the native dialog modally for as long as this component is mounted. */
	function openModal(dialog: HTMLDialogElement) {
		dialog.showModal();
		return () => dialog.close();
	}
</script>

<dialog
	{@attach openModal}
	class={[
		'm-auto max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-800 shadow-2xl backdrop:bg-zinc-900/30',
		width
	]}
	aria-label={title}
	oncancel={(e) => {
		e.preventDefault();
		onclose();
	}}
>
	<div class="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
		<h2 class="font-semibold text-zinc-900">{title}</h2>
		<button class="btn btn-ghost btn-sm text-zinc-400" aria-label="Close" onclick={onclose}
			>✕</button
		>
	</div>
	<div class="p-4">
		{@render children()}
	</div>
</dialog>
