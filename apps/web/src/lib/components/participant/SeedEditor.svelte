<script lang="ts">
	import type { TaskSubmission, TaskView } from '@tlon/contracts';

	import BlockFields from './BlockFields.svelte';

	let {
		view,
		busy,
		onsubmit
	}: {
		view: Extract<TaskView, { type: 'seed_block' }>;
		busy: boolean;
		onsubmit: (submission: TaskSubmission) => void;
	} = $props();

	let title = $state('');
	let body = $state('');
	const ready = $derived(title.trim() !== '' && body.trim() !== '');
</script>

<form
	class="flex flex-col gap-5"
	onsubmit={(event) => {
		event.preventDefault();
		if (ready) onsubmit({ type: 'seed_block', block: { kind: 'EVENT', title, body } });
	}}
>
	<section aria-labelledby="brief-heading" class="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
		<h2 id="brief-heading" class="section-title mb-1.5">Your brief</h2>
		<p class="leading-relaxed whitespace-pre-wrap text-zinc-800">{view.brief}</p>
	</section>
	<p class="text-sm text-zinc-600">
		Write the opening block of your side of the story. Only you and the facilitator can read it.
	</p>
	<BlockFields idPrefix="seed" bind:title bind:body />
	<div class="flex justify-end">
		<button class="btn btn-primary" type="submit" disabled={!ready || busy}
			>{busy ? 'Submitting…' : 'Submit block'}</button
		>
	</div>
</form>
