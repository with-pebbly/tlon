<script lang="ts">
	import { EPISTEMIC_STATUSES, type StructuredRecord } from '@tlon/contracts';

	/** §3.5 narrative plugin fields, edited as keys of the `structured` record. */
	let {
		structured,
		disabled = false,
		onchange
	}: {
		structured: StructuredRecord | null;
		disabled?: boolean;
		onchange: (key: string, value: string) => void;
	} = $props();

	const TEXT_FIELDS = [
		['subject', 'Subject'],
		['predicate', 'Predicate'],
		['object', 'Object'],
		['worldTime', 'World time'],
		['location', 'Location'],
		['perspective', 'Perspective'],
		['speaker', 'Speaker']
	] as const;

	const text = (key: string) => {
		const value = structured?.[key];
		return typeof value === 'string' ? value : '';
	};
</script>

<div class="grid grid-cols-2 gap-x-2 gap-y-1.5">
	{#each TEXT_FIELDS as [key, label] (key)}
		<div>
			<label class="label" for="nf-{key}">{label}</label>
			<input
				id="nf-{key}"
				class="input"
				value={text(key)}
				disabled={disabled || structured === null}
				oninput={(e) => onchange(key, e.currentTarget.value)}
			/>
		</div>
	{/each}
	<div>
		<label class="label" for="nf-epistemic">Epistemic status</label>
		<select
			id="nf-epistemic"
			class="input"
			value={text('epistemicStatus')}
			disabled={disabled || structured === null}
			onchange={(e) => onchange('epistemicStatus', e.currentTarget.value)}
		>
			<option value="">—</option>
			{#each EPISTEMIC_STATUSES as status (status)}
				<option value={status}>{status}</option>
			{/each}
		</select>
	</div>
</div>
