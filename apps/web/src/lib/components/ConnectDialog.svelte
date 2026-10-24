<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { RELATION_STATUSES, RelationType, type RelationStatus } from '@tlon/contracts';

	import Modal from './Modal.svelte';
	import RelationTypeInput from './RelationTypeInput.svelte';

	let { fromId, toId, onclose }: { fromId: string; toId: string; onclose: () => void } = $props();

	const ws = getWorkspace();

	let type = $state('causes');
	let status = $state<RelationStatus>('ACCEPTED');
	let saving = $state(false);

	const valid = $derived(RelationType.safeParse(type).success);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!valid) return;
		saving = true;
		try {
			await ws.createRelation({ fromId, toId, type, status });
			onclose();
		} catch (error) {
			toasts.error(error);
		} finally {
			saving = false;
		}
	}
</script>

<Modal title="New relation" {onclose}>
	<form class="flex flex-col gap-3" onsubmit={submit}>
		<div class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
			<span class="label">From</span>
			<span class="truncate font-medium">{ws.title(fromId)}</span>
			<span class="label">To</span>
			<span class="truncate font-medium">{ws.title(toId)}</span>
		</div>
		<div>
			<label class="label" for="connect-type">Relation type</label>
			<RelationTypeInput id="connect-type" bind:value={type} />
		</div>
		<div>
			<label class="label" for="connect-status">Status</label>
			<select id="connect-status" class="input" bind:value={status}>
				{#each RELATION_STATUSES.filter((s) => s !== 'REJECTED') as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<div class="flex justify-end gap-2">
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={!valid || saving}>
				{saving ? 'Linking…' : 'Create relation'}
			</button>
		</div>
	</form>
</Modal>
