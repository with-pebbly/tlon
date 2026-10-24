<script lang="ts">
	import { toasts } from '$lib/state/toasts.svelte';
</script>

<div
	class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
>
	{#each toasts.items as toast (toast.id)}
		<div
			role={toast.kind === 'error' ? 'alert' : 'status'}
			class={[
				'pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2 shadow-lg',
				toast.kind === 'error' ? 'border-rose-200 bg-white' : 'border-zinc-200 bg-white'
			]}
		>
			<div class="min-w-0 flex-1">
				{#if toast.code}
					<div class="font-mono text-[11px] font-semibold text-rose-700">{toast.code}</div>
				{/if}
				<div class="break-words text-zinc-700">{toast.message}</div>
			</div>
			<button
				class="btn btn-ghost btn-sm -mr-1 text-zinc-400"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(toast.id)}>✕</button
			>
		</div>
	{/each}
</div>
