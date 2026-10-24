<script lang="ts">
	import { clockOf, MONOTONIC_BADGE } from '$lib/continuity';
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
		unit: string;
		monotonic: Assertion['monotonic'] | '';
	};
	type EventList = 'events' | 'repeatableEvents';

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
	const MONOTONIC = Object.entries(MONOTONIC_BADGE) as [
		NonNullable<Assertion['monotonic']>,
		(typeof MONOTONIC_BADGE)[keyof typeof MONOTONIC_BADGE]
	][];
	const EVENT_LISTS: readonly { key: EventList; label: string; hint: string }[] = [
		{ key: 'events', label: 'Unique events', hint: 'happen once on the path (ilse.wakes)' },
		{
			key: 'repeatableEvents',
			label: 'Repeatable events',
			hint: 'may legitimately recur (a second phone call)'
		}
	];

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
		preparation: a?.preparation ?? false,
		unit: a?.unit ?? '',
		monotonic: a?.monotonic ?? ''
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

	/** Story time as typed: Day N is 1-based in the form, `day` 0-based in the contract. */
	let time = $state<{
		day: number | null;
		clock: string;
		approx: boolean;
		tolerance: number | null;
		outOfOrder: boolean;
	}>({
		day: start?.time?.day === undefined ? null : start.time.day + 1,
		clock: start?.time?.minute === undefined ? '' : clockOf(start.time.minute),
		approx: start?.time?.approx ?? false,
		tolerance: start?.time?.toleranceMinutes ?? 0,
		outOfOrder: start?.time?.outOfOrder ?? false
	});
	let events = $state<Record<EventList, string[]>>({
		events: [...(start?.events ?? [])],
		repeatableEvents: [...(start?.repeatableEvents ?? [])]
	});
	let eventInput = $state<Record<EventList, string>>({ events: '', repeatableEvents: '' });

	function addEvent(list: EventList) {
		const id = eventInput[list].trim().toLowerCase().replaceAll(/\s+/g, '_');
		if (id !== '' && !events[list].includes(id)) events[list].push(id);
		eventInput[list] = '';
	}

	function toTime(): TransitionInput['time'] {
		const day = typeof time.day === 'number' ? time.day - 1 : undefined;
		const [hours, minutes] = time.clock.split(':').map(Number);
		const minute =
			time.clock === '' || hours === undefined || minutes === undefined
				? undefined
				: hours * 60 + minutes;
		if (day === undefined && minute === undefined && !time.outOfOrder) return undefined;
		return {
			...(day === undefined ? {} : { day }),
			...(minute === undefined ? {} : { minute }),
			approx: time.approx,
			toleranceMinutes: time.approx ? (time.tolerance ?? 0) : 0,
			outOfOrder: time.outOfOrder
		};
	}

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
			...(row.holder.trim() ? { holder: row.holder.trim() } : {}),
			...(row.unit.trim() ? { unit: row.unit.trim() } : {}),
			...(row.monotonic ? { monotonic: row.monotonic } : {})
		};
	}

	const draft = $derived.by<TransitionInput>(() => {
		const at = toTime();
		return {
			preconditions: rows.preconditions.map(toAssertion),
			effects: rows.effects.map(toAssertion),
			assumptions: rows.assumptions.map(toAssertion),
			...(at ? { time: at } : {}),
			events: [...events.events],
			repeatableEvents: [...events.repeatableEvents]
		};
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
	<fieldset class="flex flex-col gap-1.5">
		<legend class="mb-1 flex w-full items-baseline gap-2">
			<span class="label mb-0">Story time</span>
			<span class="text-[11px] text-zinc-400">when the beat happens, as far as the text says</span>
		</legend>
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600">
			<label class="flex items-center gap-1"
				>Day <input
					type="number"
					step="1"
					class="input h-6 w-16 text-xs"
					placeholder="—"
					aria-label="Story day (1 = first day)"
					bind:value={time.day}
				/></label
			>
			<label class="flex items-center gap-1"
				>at <input
					type="time"
					class="input h-6 w-auto py-0 text-xs"
					aria-label="Clock time"
					bind:value={time.clock}
				/></label
			>
			<label class="flex items-center gap-1"
				><input type="checkbox" bind:checked={time.approx} /> approximate</label
			>
			{#if time.approx}
				<label class="flex items-center gap-1"
					>± <input
						type="number"
						min="0"
						max="1440"
						step="1"
						class="input h-6 w-16 text-xs"
						aria-label="Tolerance in minutes"
						bind:value={time.tolerance}
					/> min</label
				>
			{/if}
			<label
				class="flex items-center gap-1"
				title="Flashback / flash-forward: excluded from chronology checks"
				><input type="checkbox" bind:checked={time.outOfOrder} /> flashback</label
			>
		</div>
	</fieldset>

	{#each EVENT_LISTS as list (list.key)}
		<fieldset class="flex flex-col gap-1.5">
			<legend class="mb-1 flex w-full items-baseline gap-2">
				<span class="label mb-0">{list.label}</span>
				<span class="text-[11px] text-zinc-400">{list.hint}</span>
			</legend>
			<div class="flex flex-wrap items-center gap-1">
				{#each events[list.key] as id, index (id)}
					<span
						class={[
							'chip gap-0.5 font-mono',
							list.key === 'events'
								? 'border-zinc-300 bg-zinc-50 text-zinc-800'
								: 'border-dashed border-zinc-300 bg-white text-zinc-600'
						]}
						>{id}<button
							type="button"
							class="px-0.5 text-zinc-400 hover:text-zinc-700"
							aria-label="Remove {list.label.toLowerCase()} {id}"
							onclick={() => events[list.key].splice(index, 1)}>✕</button
						></span
					>
				{/each}
				<input
					class="input h-6 w-44 font-mono text-xs"
					placeholder="event.id + Enter"
					aria-label="Add {list.label.toLowerCase()}"
					bind:value={eventInput[list.key]}
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						addEvent(list.key);
					}}
					onblur={() => addEvent(list.key)}
				/>
			</div>
		</fieldset>
	{/each}

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
						{#if /^-?\d+(\.\d+)?$/.test(row.value.trim()) || row.unit || row.monotonic}
							<input
								class="input h-6 w-20 text-xs"
								placeholder="unit"
								aria-label="{section.label} {index + 1} unit"
								bind:value={row.unit}
							/>
							<select
								class="input h-6 w-auto py-0 text-xs"
								aria-label="{section.label} {index + 1} one-way direction"
								bind:value={row.monotonic}
							>
								<option value="">two-way</option>
								{#each MONOTONIC as [value, badge] (value)}
									<option {value} title={badge.title}
										>{badge.glyph} {value.replace('_', '-')}</option
									>
								{/each}
							</select>
						{/if}
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
