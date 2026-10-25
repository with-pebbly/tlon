<script lang="ts">
	import { clockOf, MONOTONIC_BADGE, MONTH_NAMES } from '$lib/continuity';
	import {
		BEAT_FUNCTIONS,
		EntityRef,
		Transition,
		type Assertion,
		type AssertionInput,
		type BeatFunction,
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
		timeless: boolean;
	};
	type EventList = 'events' | 'repeatableEvents';
	type EntityRow = {
		uid: number;
		id: string;
		name: string;
		kind: EntityRef['kind'];
		distinguishing: string;
		/** Other names of the same entity, comma-separated as typed. */
		aliases: string;
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
	const ENTITY_KINDS = EntityRef.shape.kind.options;
	const FUNCTION_LABEL: Record<BeatFunction, string> = {
		new_decision: 'new decision',
		irreversible_change: 'irreversible change',
		new_constraint: 'new constraint',
		stake_shift: 'stake shift',
		revelation: 'revelation',
		causal_dependency: 'causal dependency'
	};

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
		monotonic: a?.monotonic ?? '',
		timeless: a?.timeless ?? false
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
		year: number | null;
		month: number | null;
		dayOfMonth: number | null;
		day: number | null;
		clock: string;
		relative: string;
		approx: boolean;
		tolerance: number | null;
		outOfOrder: boolean;
	}>({
		year: start?.time?.year ?? null,
		month: start?.time?.month ?? null,
		dayOfMonth: start?.time?.dayOfMonth ?? null,
		day: start?.time?.day === undefined ? null : start.time.day + 1,
		clock: start?.time?.minute === undefined ? '' : clockOf(start.time.minute),
		relative: start?.time?.relative ?? '',
		approx: start?.time?.approx ?? false,
		tolerance: start?.time?.toleranceMinutes ?? 0,
		outOfOrder: start?.time?.outOfOrder ?? false
	});
	let entities = $state<EntityRow[]>(
		(start?.entities ?? []).map((e) => ({
			uid: nextUid++,
			id: e.id,
			name: e.name,
			kind: e.kind,
			distinguishing: e.distinguishing ?? '',
			aliases: e.aliases.join(', ')
		}))
	);
	let functions = $state<BeatFunction[]>([...(start?.functions ?? [])]);

	function toggleFunction(fn: BeatFunction) {
		const at = functions.indexOf(fn);
		if (at === -1) functions.push(fn);
		else functions.splice(at, 1);
	}
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
		const year = typeof time.year === 'number' ? time.year : undefined;
		const month = typeof time.month === 'number' ? time.month : undefined;
		const dayOfMonth = typeof time.dayOfMonth === 'number' ? time.dayOfMonth : undefined;
		const day = typeof time.day === 'number' ? time.day - 1 : undefined;
		const [hours, minutes] = time.clock.split(':').map(Number);
		const minute =
			time.clock === '' || hours === undefined || minutes === undefined
				? undefined
				: hours * 60 + minutes;
		const relative = time.relative.trim();
		if (
			year === undefined &&
			month === undefined &&
			dayOfMonth === undefined &&
			day === undefined &&
			minute === undefined &&
			relative === '' &&
			!time.outOfOrder
		)
			return undefined;
		return {
			...(year === undefined ? {} : { year }),
			...(month === undefined ? {} : { month }),
			...(dayOfMonth === undefined ? {} : { dayOfMonth }),
			...(day === undefined ? {} : { day }),
			...(minute === undefined ? {} : { minute }),
			...(relative === '' ? {} : { relative }),
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
			timeless: row.timeless,
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
			repeatableEvents: [...events.repeatableEvents],
			entities: entities.map((e) => {
				const entity: EntityRef = {
					id: e.id.trim(),
					name: e.name.trim(),
					kind: e.kind,
					aliases: e.aliases
						.split(',')
						.map((alias) => alias.trim())
						.filter((alias) => alias !== '')
				};
				const distinguishing = e.distinguishing.trim();
				if (distinguishing !== '') entity.distinguishing = distinguishing;
				return entity;
			}),
			functions: [...functions]
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
				>Year <input
					type="number"
					step="1"
					class="input h-6 w-20 text-xs"
					placeholder="—"
					aria-label="Calendar year"
					bind:value={time.year}
				/></label
			>
			<label class="flex items-center gap-1"
				>Month <select
					class="input h-6 w-auto py-0 text-xs"
					aria-label="Calendar month"
					bind:value={time.month}
				>
					<option value={null}>—</option>
					{#each MONTH_NAMES as name, i (name)}<option value={i + 1}>{name}</option>{/each}
				</select></label
			>
			<label class="flex items-center gap-1"
				>Date <input
					type="number"
					min="1"
					max="31"
					step="1"
					class="input h-6 w-14 text-xs"
					placeholder="—"
					aria-label="Day of the month"
					bind:value={time.dayOfMonth}
				/></label
			>
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
		<input
			class="input h-6 text-xs"
			placeholder="relative time, verbatim (eleven winters before the church closed)"
			title="A relative statement whose absolute date is unknown — kept as written, never turned into a year"
			aria-label="Relative time statement"
			bind:value={time.relative}
		/>
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

	<fieldset class="flex flex-col gap-1.5">
		<legend class="mb-1 flex w-full items-baseline gap-2">
			<span class="label mb-0">Entities</span>
			<span class="text-[11px] text-zinc-400"
				>who / what the beat mentions — identity is the id, never the name</span
			>
		</legend>
		{#each entities as entity, index (entity.uid)}
			<div class="flex flex-wrap items-center gap-1">
				<input
					class="input h-6 w-36 font-mono text-xs"
					placeholder="id (prokhor_dyatlov)"
					aria-label="Entity {index + 1} id"
					bind:value={entity.id}
				/>
				<input
					class="input h-6 w-28 text-xs"
					placeholder="name"
					aria-label="Entity {index + 1} name"
					bind:value={entity.name}
				/>
				<select
					class="input h-6 w-auto py-0 text-xs"
					aria-label="Entity {index + 1} kind"
					bind:value={entity.kind}
				>
					{#each ENTITY_KINDS as kind (kind)}<option value={kind}>{kind}</option>{/each}
				</select>
				<input
					class="input h-6 min-w-0 flex-1 text-xs"
					placeholder="distinguishing (surname, surface, era)"
					aria-label="Entity {index + 1} distinguishing detail"
					bind:value={entity.distinguishing}
				/>
				<input
					class="input h-6 w-full text-xs"
					placeholder="aliases, comma-separated (Bill, William Smith)"
					title="Other names the text uses for this same entity — kept on this id, never merged with another"
					aria-label="Entity {index + 1} aliases"
					bind:value={entity.aliases}
				/>
				<button
					type="button"
					class="btn btn-ghost btn-sm px-1 text-zinc-400"
					aria-label="Remove entity {index + 1}"
					onclick={() => entities.splice(index, 1)}>✕</button
				>
			</div>
		{/each}
		<button
			type="button"
			class="btn btn-sm self-start"
			onclick={() =>
				entities.push({
					uid: nextUid++,
					id: '',
					name: '',
					kind: 'person',
					distinguishing: '',
					aliases: ''
				})}>+ entity</button
		>
	</fieldset>

	<fieldset class="flex flex-col gap-1.5">
		<legend class="mb-1 flex w-full items-baseline gap-2">
			<span class="label mb-0">Story function</span>
			<span class="text-[11px] text-zinc-400">advisory — quiet beats may have none</span>
		</legend>
		<div class="flex flex-wrap items-center gap-1">
			{#each BEAT_FUNCTIONS as fn (fn)}
				<button
					type="button"
					class={[
						'chip',
						functions.includes(fn)
							? 'border-accent-500 bg-accent-50 text-accent-700'
							: 'border-zinc-200 bg-white text-zinc-500'
					]}
					aria-pressed={functions.includes(fn)}
					onclick={() => toggleFunction(fn)}>{FUNCTION_LABEL[fn]}</button
				>
			{/each}
		</div>
	</fieldset>

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
						<label
							class="flex items-center gap-1"
							title="Holds for the whole story world: identity, kinship, who wrote to whom, the date, place or count of a past event. It cannot change off-page; two Blocks of one side disagreeing on it are a contradiction."
							><input type="checkbox" bind:checked={row.timeless} /> timeless</label
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
