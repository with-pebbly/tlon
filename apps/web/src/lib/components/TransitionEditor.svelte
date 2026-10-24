<script lang="ts">
	import {
		Transition,
		type Assertion,
		type AssertionInput,
		type TransitionInput
	} from '@tlon/contracts';

	type Section = 'preconditions' | 'effects' | 'assumptions';
	type Row = {
		uid: number;
		subject: string;
		predicate: string;
		value: string;
		/** Value as loaded; kept verbatim while the text still reads the same. */
		original: Assertion['value'] | null;
		note: string;
		epistemic: Assertion['epistemic'];
		holder: string;
		irreversible: boolean;
		preparation: boolean;
	};

	let {
		initial,
		initialReviewed,
		saving,
		onsave,
		oncancel
	}: {
		initial: Transition | null;
		initialReviewed: boolean;
		saving: boolean;
		onsave: (transition: TransitionInput, reviewed: boolean) => void;
		oncancel: () => void;
	} = $props();

	const SECTIONS: readonly { key: Section; label: string; hint: string }[] = [
		{
			key: 'preconditions',
			label: 'Preconditions',
			hint: 'must already hold when the beat starts'
		},
		{ key: 'effects', label: 'Effects', hint: 'what the beat changes' },
		{ key: 'assumptions', label: 'Assumptions', hint: 'new facts the beat invents and relies on' }
	];
	const EPISTEMIC: readonly Assertion['epistemic'][] = ['world', 'belief', 'rumor', 'hypothesis'];

	let nextUid = 0;
	const toRow = (a: Assertion | null): Row => ({
		uid: nextUid++,
		subject: a?.subject ?? '',
		predicate: a?.predicate ?? '',
		value: a === null ? '' : String(a.value),
		original: a?.value ?? null,
		note: a?.note ?? '',
		epistemic: a?.epistemic ?? 'world',
		holder: a?.holder ?? '',
		irreversible: a?.irreversible ?? false,
		preparation: a?.preparation ?? false
	});

	// The editor is mounted per edit session: it starts from the annotation as it was.
	// svelte-ignore state_referenced_locally
	const start = initial;
	let rows = $state<Record<Section, Row[]>>({
		preconditions: (start?.preconditions ?? []).map(toRow),
		effects: (start?.effects ?? []).map(toRow),
		assumptions: (start?.assumptions ?? []).map(toRow)
	});
	// svelte-ignore state_referenced_locally
	let reviewed = $state(initialReviewed);

	/** Text → value: unchanged text keeps the loaded value; new text infers number/boolean. */
	function toValue(row: Row): Assertion['value'] {
		const text = row.value.trim();
		if (row.original !== null && String(row.original) === text) return row.original;
		if (text === 'true' || text === 'false') return text === 'true';
		if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
		return text;
	}

	function toAssertion(row: Row): AssertionInput {
		return {
			subject: row.subject.trim(),
			predicate: row.predicate.trim(),
			value: toValue(row),
			epistemic: row.epistemic,
			irreversible: row.irreversible,
			preparation: row.preparation,
			...(row.note.trim() ? { note: row.note.trim() } : {}),
			...(row.holder.trim() ? { holder: row.holder.trim() } : {})
		};
	}

	const draft = $derived<TransitionInput>({
		preconditions: rows.preconditions.map(toAssertion),
		effects: rows.effects.map(toAssertion),
		assumptions: rows.assumptions.map(toAssertion)
	});
	const checked = $derived(Transition.safeParse(draft));
	const errors = $derived(
		checked.success
			? []
			: checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (checked.success && !saving) onsave(draft, reviewed);
	}
</script>

<form class="flex flex-col gap-3" onsubmit={submit} aria-label="Edit state transition">
	{#each SECTIONS as section (section.key)}
		<fieldset class="flex flex-col gap-1.5">
			<legend class="mb-1 flex w-full items-baseline gap-2">
				<span class="label mb-0">{section.label}</span>
				<span class="text-[11px] text-zinc-400">{section.hint}</span>
			</legend>
			{#each rows[section.key] as row, index (row.uid)}
				<div class="flex flex-col gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1.5">
					<div class="flex items-center gap-1">
						<input
							class="input h-6 min-w-0 flex-1 font-mono text-xs"
							placeholder="subject"
							aria-label="{section.label} {index + 1} subject"
							bind:value={row.subject}
						/>
						<span class="text-zinc-400">.</span>
						<input
							class="input h-6 min-w-0 flex-1 font-mono text-xs"
							placeholder="predicate"
							aria-label="{section.label} {index + 1} predicate"
							bind:value={row.predicate}
						/>
						<span class="text-zinc-400">=</span>
						<input
							class="input h-6 min-w-0 flex-1 font-mono text-xs"
							placeholder="value"
							aria-label="{section.label} {index + 1} value"
							bind:value={row.value}
						/>
						<button
							type="button"
							class="btn btn-ghost btn-sm px-1 text-zinc-400"
							aria-label="Remove {section.label} {index + 1}"
							onclick={() => rows[section.key].splice(index, 1)}>✕</button
						>
					</div>
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600">
						<select
							class="input h-6 w-auto py-0 text-xs"
							aria-label="{section.label} {index + 1} epistemic status"
							bind:value={row.epistemic}
						>
							{#each EPISTEMIC as option (option)}<option value={option}>{option}</option>{/each}
						</select>
						{#if row.epistemic !== 'world'}
							<input
								class="input h-6 w-28 text-xs"
								placeholder="holder"
								aria-label="{section.label} {index + 1} holder"
								bind:value={row.holder}
							/>
						{/if}
						<label class="flex items-center gap-1"
							><input type="checkbox" bind:checked={row.irreversible} /> irreversible</label
						>
						<label class="flex items-center gap-1"
							><input type="checkbox" bind:checked={row.preparation} /> preparation</label
						>
					</div>
					<input
						class="input h-6 text-xs"
						placeholder="note (free text, never compared)"
						aria-label="{section.label} {index + 1} note"
						bind:value={row.note}
					/>
				</div>
			{/each}
			<button
				type="button"
				class="btn btn-sm self-start"
				onclick={() => rows[section.key].push(toRow(null))}>+ {section.label.toLowerCase()}</button
			>
		</fieldset>
	{/each}

	{#if errors.length > 0}
		<ul
			class="list-disc rounded-md border border-rose-200 bg-rose-50 py-1.5 pr-2 pl-6 text-[11px] text-rose-700"
		>
			{#each errors as error, i (i)}<li>{error}</li>{/each}
		</ul>
	{/if}

	<label class="flex items-center gap-2 text-xs text-zinc-700">
		<input type="checkbox" bind:checked={reviewed} />
		Reviewed — a human checked this annotation against the beat's text
	</label>
	<div class="flex gap-2">
		<button class="btn btn-primary" disabled={!checked.success || saving}
			>{saving ? 'Saving…' : 'Save annotation'}</button
		>
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
	</div>
	<p class="text-[11px] text-zinc-400">
		Saved as a human annotation of the current head revision; the artifact itself gets no new
		revision.
	</p>
</form>
