<!--
	Facilitator "Report a problem": a continuity finding grounded in verbatim quotes. The
	server checks every quote against the cited Block's head revision (422 UNGROUNDED_QUOTE
	lists the ones it could not find); the local "found / not found" mark is a preview only.
-->
<script lang="ts">
	import { isApiError } from '$lib/api';
	import { ISSUE_KIND_LABEL, ISSUE_KIND_NOTE, ISSUE_KIND_ORDER } from '$lib/continuity';
	import { markQuotes, normaliseQuote } from '$lib/quotes';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { CreateFindingInput, type IssueKind } from '@tlon/contracts';

	import MarkedText from './MarkedText.svelte';
	import Modal from './Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const ws = getWorkspace();
	const SEVERITIES = ['blocker', 'warning', 'info'] as const;
	const MAX_BLOCKS = 8;
	const MAX_QUOTES = 8;

	/** Story Blocks a finding may cite: no Facts, composites, rejected or archived artifacts. */
	const blocks = $derived(
		ws.inStoryOrder(
			ws.artifacts
				.filter(
					(a) =>
						a.artifactClass !== 'FACT' &&
						!ws.compositesById.has(a.id) &&
						a.status !== 'REJECTED' &&
						a.status !== 'ARCHIVED'
				)
				.map((a) => a.id)
		)
	);

	// Starts from the canvas multi-selection, else the selected artifact (mounted per opening).
	const initialPicks = (
		ws.multi.size > 0 ? [...ws.multi] : ws.selection?.type === 'artifact' ? [ws.selection.id] : []
	)
		.filter((id) => blocks.includes(id))
		.slice(0, MAX_BLOCKS);

	let picked = $state<string[]>(initialPicks);
	let kind = $state<IssueKind>('fact_conflict');
	let severity = $state<(typeof SEVERITIES)[number]>('warning');
	let explanation = $state('');
	let nextUid = 0;
	let quotes = $state<{ uid: number; artifactId: string; quote: string }[]>([
		{ uid: nextUid++, artifactId: initialPicks[0] ?? '', quote: '' }
	]);
	let saving = $state(false);
	let failure = $state<{ code: string; message: string } | null>(null);
	/** Quotes the server could not find in the cited head revision (last attempt). */
	let ungrounded = $state.raw<{ artifactId: string; quote: string }[]>([]);

	const pickedInOrder = $derived(ws.inStoryOrder(picked));
	const input = $derived({
		kind,
		severity,
		artifactIds: pickedInOrder,
		explanation,
		evidence: quotes.map((q) => ({ artifactId: q.artifactId, quote: q.quote })),
		source: 'human' as const
	});
	const problems = $derived.by(() => {
		const checked = CreateFindingInput.safeParse(input);
		const messages = checked.success
			? []
			: checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
		if (quotes.some((q) => q.artifactId !== '' && !picked.includes(q.artifactId)))
			messages.push('Every quote must come from one of the picked Blocks.');
		return messages;
	});

	function isUngrounded(row: { artifactId: string; quote: string }) {
		const quote = normaliseQuote(row.quote);
		return ungrounded.some(
			(u) => u.artifactId === row.artifactId && normaliseQuote(u.quote) === quote
		);
	}

	function togglePick(id: string) {
		const at = picked.indexOf(id);
		if (at !== -1) picked.splice(at, 1);
		else if (picked.length < MAX_BLOCKS) picked.push(id);
		for (const row of quotes)
			if (row.artifactId === '' && picked.length > 0) row.artifactId = picked[0] ?? '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (problems.length > 0 || saving) return;
		saving = true;
		failure = null;
		try {
			await ws.createFinding(input);
			toasts.push('info', 'Problem recorded: it is now an open issue.');
			onclose();
		} catch (error) {
			if (!isApiError(error)) {
				toasts.error(error);
				return;
			}
			const { details } = error;
			ungrounded =
				error.code === 'UNGROUNDED_QUOTE' &&
				typeof details === 'object' &&
				details !== null &&
				'ungrounded' in details &&
				Array.isArray(details.ungrounded)
					? details.ungrounded.flatMap((item: unknown) =>
							typeof item === 'object' &&
							item !== null &&
							'artifactId' in item &&
							'quote' in item &&
							typeof item.artifactId === 'string' &&
							typeof item.quote === 'string'
								? [{ artifactId: item.artifactId, quote: item.quote }]
								: []
						)
					: [];
			failure = {
				code: error.code,
				message:
					error.code === 'UNGROUNDED_QUOTE'
						? 'Some quotes do not occur verbatim in the current text of the cited Block (marked below). Copy them exactly from the Block.'
						: error.message
			};
		} finally {
			saving = false;
		}
	}
</script>

<Modal title="Report a problem" {onclose} width="w-[680px]">
	<form class="flex max-h-[75vh] flex-col gap-3 overflow-y-auto" onsubmit={submit}>
		<fieldset class="flex flex-col gap-1">
			<legend class="label">Blocks involved ({picked.length}/{MAX_BLOCKS})</legend>
			<ul
				class="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-md border border-zinc-200 p-1.5 text-xs"
				aria-label="Blocks"
			>
				{#each blocks as id (id)}
					{@const beat = ws.beatIndex.get(id)}
					<li>
						<label class="flex items-baseline gap-1.5">
							<input
								type="checkbox"
								checked={picked.includes(id)}
								disabled={!picked.includes(id) && picked.length >= MAX_BLOCKS}
								onchange={() => togglePick(id)}
							/>
							<span class="shrink-0 font-mono text-[10px] text-zinc-500"
								>{beat === undefined ? '—' : `#${beat}`}</span
							>
							<span class="truncate">{ws.blockLabel(id)}</span>
						</label>
					</li>
				{/each}
			</ul>
		</fieldset>

		<div class="grid grid-cols-2 gap-2">
			<div>
				<label class="label" for="finding-kind">Kind</label>
				<select id="finding-kind" class="input" bind:value={kind}>
					{#each ISSUE_KIND_ORDER as option (option)}
						<option value={option}>{ISSUE_KIND_LABEL[option]}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="finding-severity">Severity</label>
				<select id="finding-severity" class="input" bind:value={severity}>
					{#each SEVERITIES as option (option)}<option value={option}>{option}</option>{/each}
				</select>
			</div>
		</div>
		{#if ISSUE_KIND_NOTE[kind]}
			<p class="text-[11px] text-zinc-500">{ISSUE_KIND_NOTE[kind]}</p>
		{/if}

		<div>
			<label class="label" for="finding-explanation">What is wrong</label>
			<textarea
				id="finding-explanation"
				class="input"
				rows="3"
				maxlength="2000"
				placeholder="The hero's mother in #16 is the letter writer's wife in #21."
				bind:value={explanation}></textarea>
		</div>

		<fieldset class="flex flex-col gap-2">
			<legend class="label">Quotes — paste them verbatim from the Blocks</legend>
			{#each quotes as row, index (row.uid)}
				{@const artifact = ws.artifactsById.get(row.artifactId)}
				{@const flagged = isUngrounded(row)}
				{@const found =
					artifact !== undefined &&
					normaliseQuote(row.quote).length >= 3 &&
					[artifact.title, artifact.body].some((text) =>
						markQuotes(text, [row.quote]).some((s) => s.marked)
					)}
				<div
					class={[
						'flex flex-col gap-1 rounded-md border p-1.5',
						flagged ? 'border-rose-400 bg-rose-50' : 'border-zinc-200 bg-zinc-50'
					]}
					data-testid="finding-quote"
					data-ungrounded={flagged}
				>
					<div class="flex items-center gap-1">
						<select
							class="input h-7 min-w-0 flex-1 py-0 text-xs"
							aria-label="Quote {index + 1} Block"
							bind:value={row.artifactId}
						>
							<option value="">— pick a Block —</option>
							{#each pickedInOrder as id (id)}
								{@const beat = ws.beatIndex.get(id)}
								<option value={id}
									>{beat === undefined ? '' : `#${beat} `}{ws.blockLabel(id)}</option
								>
							{/each}
						</select>
						<button
							type="button"
							class="btn btn-ghost btn-sm px-1 text-zinc-400"
							aria-label="Remove quote {index + 1}"
							disabled={quotes.length === 1}
							onclick={() => quotes.splice(index, 1)}>✕</button
						>
					</div>
					<textarea
						class="input text-xs"
						rows="2"
						maxlength="400"
						placeholder="«…exact words from the Block…»"
						aria-label="Quote {index + 1} text"
						aria-invalid={flagged}
						bind:value={row.quote}></textarea>
					<div class="flex flex-wrap items-center gap-2 text-[11px]">
						{#if flagged}
							<span class="font-medium text-rose-700" role="alert"
								>Not found verbatim in this Block's current text.</span
							>
						{:else if artifact && row.quote.trim() !== ''}
							<span class={found ? 'text-emerald-700' : 'text-amber-700'}
								>{found ? '✓ found in the text' : 'not found in the current text'}</span
							>
						{/if}
						{#if artifact}
							<details class="w-full">
								<summary class="cursor-pointer text-zinc-500">Show the Block's text</summary>
								<p
									class="mt-1 max-h-40 overflow-y-auto rounded border border-zinc-200 bg-white p-1.5 leading-relaxed whitespace-pre-wrap text-zinc-700"
								>
									<span class="font-semibold"
										><MarkedText text={artifact.title} quotes={[row.quote]} /></span
									>
									<MarkedText text={artifact.body} quotes={[row.quote]} />
								</p>
							</details>
						{/if}
					</div>
				</div>
			{/each}
			<button
				type="button"
				class="btn btn-sm self-start"
				disabled={quotes.length >= MAX_QUOTES}
				onclick={() =>
					quotes.push({ uid: nextUid++, artifactId: pickedInOrder[0] ?? '', quote: '' })}
				>+ quote</button
			>
		</fieldset>

		{#if failure}
			<p
				class="rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-800"
				role="alert"
				data-testid="finding-error"
			>
				<span class="font-mono font-semibold">{failure.code}</span>
				{failure.message}
			</p>
		{/if}
		{#if problems.length > 0 && explanation.trim() !== ''}
			<ul class="list-disc pl-5 text-[11px] text-zinc-500">
				{#each problems as problem, i (i)}<li>{problem}</li>{/each}
			</ul>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={problems.length > 0 || saving}
				>{saving ? 'Recording…' : 'Record problem'}</button
			>
		</div>
	</form>
</Modal>
