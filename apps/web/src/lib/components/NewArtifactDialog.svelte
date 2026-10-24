<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { parseJsonObject, validateStructured } from '$lib/validation';
	import { ARTIFACT_KINDS, type ArtifactKind } from '@tlon/contracts';

	import Modal from './Modal.svelte';
	import NarrativeFields from './NarrativeFields.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const ws = getWorkspace();
	const CREATE_STATUSES = ['DRAFT', 'PROPOSED', 'ACCEPTED'] as const;

	let kind = $state<ArtifactKind>('FACT');
	let title = $state('');
	let body = $state('');
	let status = $state<(typeof CREATE_STATUSES)[number]>('DRAFT');
	let structuredText = $state('{}');
	let saving = $state(false);

	const domain = $derived(ws.project?.domain ?? 'GENERIC');
	const parsed = $derived(parseJsonObject(structuredText));
	const structuredError = $derived(
		parsed.ok ? validateStructured(domain, kind, parsed.value) : parsed.error
	);

	function setNarrativeField(key: string, value: string) {
		if (!parsed.ok) return;
		const next = { ...parsed.value };
		if (value.trim() === '') delete next[key];
		else next[key] = value;
		structuredText = JSON.stringify(next, null, 2);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!parsed.ok || structuredError || title.trim() === '') return;
		saving = true;
		try {
			await ws.createArtifact({
				kind,
				title: title.trim(),
				body,
				status,
				structured: parsed.value
			});
			onclose();
		} catch (error) {
			toasts.error(error);
		} finally {
			saving = false;
		}
	}
</script>

<Modal title="New artifact" {onclose} width="w-[560px]">
	<form class="flex flex-col gap-2.5" onsubmit={submit}>
		<div class="grid grid-cols-[1fr_140px_140px] gap-2">
			<div>
				<label class="label" for="na-title">Title</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input id="na-title" class="input" bind:value={title} maxlength="300" required autofocus />
			</div>
			<div>
				<label class="label" for="na-kind">Kind</label>
				<select id="na-kind" class="input" bind:value={kind}>
					{#each ARTIFACT_KINDS as option (option)}<option value={option}>{option}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="na-status">Status</label>
				<select id="na-status" class="input" bind:value={status}>
					{#each CREATE_STATUSES as option (option)}<option value={option}>{option}</option>{/each}
				</select>
			</div>
		</div>
		<div>
			<label class="label" for="na-body">Body</label>
			<textarea id="na-body" class="input" rows="3" bind:value={body}></textarea>
		</div>
		{#if domain === 'NARRATIVE'}
			<div>
				<div class="label">Narrative fields</div>
				<NarrativeFields
					structured={parsed.ok ? parsed.value : null}
					onchange={setNarrativeField}
				/>
			</div>
		{/if}
		<div>
			<label class="label" for="na-structured">Structured (JSON)</label>
			<textarea
				id="na-structured"
				class={['input font-mono text-xs', structuredError && 'border-rose-400']}
				rows="4"
				spellcheck="false"
				bind:value={structuredText}></textarea>
			{#if structuredError}
				<p class="mt-0.5 text-[11px] text-rose-600">{structuredError}</p>
			{:else if kind === 'BRIDGE'}
				<p class="mt-0.5 text-[11px] text-zinc-500">
					BRIDGE artifacts need mechanism, assumptions and anchorReconciliation.
				</p>
			{/if}
		</div>
		<div class="flex justify-end gap-2">
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving || !!structuredError || title.trim() === ''}>
				{saving ? 'Creating…' : 'Create artifact'}
			</button>
		</div>
	</form>
</Modal>
