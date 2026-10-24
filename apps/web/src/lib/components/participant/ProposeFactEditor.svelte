<script lang="ts">
	import { FACT_KIND_HINT, FACT_KIND_ICON } from '$lib/protocol';
	import {
		FACT_KINDS,
		lintFactText,
		type FactKind,
		type TaskSubmission,
		type TaskView
	} from '@tlon/contracts';

	import BlockCard from './BlockCard.svelte';

	let {
		view,
		busy,
		onsubmit
	}: {
		view: Extract<TaskView, { type: 'propose_fact' }>;
		busy: boolean;
		onsubmit: (submission: TaskSubmission) => void;
	} = $props();

	type Draft = { key: number; kind: FactKind; text: string; rationale: string };

	let nextKey = 1;
	let drafts = $state<Draft[]>([{ key: 0, kind: 'object', text: '', rationale: '' }]);

	const max = $derived(Math.min(5, view.policy.maxCandidates));
	const lints = $derived(drafts.map((d) => lintFactText(d.text)));
	const ready = $derived(lints.every((l) => l.errors.length === 0));

	function add() {
		if (drafts.length < max)
			drafts.push({ key: nextKey++, kind: 'object', text: '', rationale: '' });
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!ready) return;
		onsubmit({
			type: 'propose_fact',
			candidates: drafts.map((d) => ({
				kind: d.kind,
				text: d.text.trim(),
				...(d.rationale.trim() !== '' ? { rationale: d.rationale.trim() } : {})
			}))
		});
	}
</script>

<form class="flex flex-col gap-5" onsubmit={submit}>
	<section
		class="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm leading-relaxed text-zinc-800"
	>
		<h2 class="mb-1 font-semibold">What is a Fact?</h2>
		<p>
			A Fact is a bare circumstance in a couple of words that could touch both blocks — an object, a
			trace, a rule, a need. It is <strong>not a scene</strong>, not an explanation and not an
			instruction: each writer will see only the Fact and decide on their own how it matters.
		</p>
		<p class="mt-1 text-zinc-600">
			{view.policy.preferredWords.min}–{view.policy.preferredWords.max} words, at most {view.policy
				.maxWords}; no commas or qualifiers. «Корни хранят память» — a Fact. «В корнях обнаружена
			неизвестная система хранения памяти» — not a Fact.
		</p>
	</section>

	<div class="grid gap-3 md:grid-cols-2">
		<BlockCard block={view.left} label="Block 1" />
		<BlockCard block={view.right} label="Block 2" />
	</div>

	{#if view.existingFacts.length > 0}
		<section aria-labelledby="existing-heading">
			<h2 id="existing-heading" class="section-title mb-1">Already used between these blocks</h2>
			<ul class="flex flex-col gap-1 text-sm text-zinc-700">
				{#each view.existingFacts as fact (fact.id)}
					<li>
						<span aria-hidden="true">{FACT_KIND_ICON[fact.kind]}</span>
						<span class="sr-only">{fact.kind}:</span>
						{fact.text}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<fieldset class="flex flex-col gap-4">
		<legend class="section-title mb-2">Your Fact candidates ({drafts.length} of up to {max})</legend
		>
		{#each drafts as draft, index (draft.key)}
			{@const lint = lints[index] ?? { errors: [], warnings: [] }}
			{@const words = draft.text.trim().split(/\s+/).filter(Boolean).length}
			{@const id = `fact-${draft.key}`}
			<div
				class={[
					'flex flex-col gap-2 rounded-lg border p-3',
					lint.errors.length > 0 && draft.text !== '' ? 'border-rose-300' : 'border-zinc-200'
				]}
				data-testid="fact-candidate"
			>
				<div class="flex items-center gap-2">
					<span class="text-sm font-semibold text-zinc-800">Candidate {index + 1}</span>
					{#if drafts.length > 1}
						<button
							type="button"
							class="btn btn-ghost btn-sm ml-auto text-zinc-500"
							onclick={() => drafts.splice(index, 1)}>Remove</button
						>
					{/if}
				</div>
				<div class="grid gap-2 sm:grid-cols-[11rem_1fr]">
					<div>
						<label class="label" for="{id}-kind">Kind</label>
						<select id="{id}-kind" class="input" bind:value={draft.kind}>
							{#each FACT_KINDS as kind (kind)}
								<option value={kind}>{FACT_KIND_ICON[kind]} {kind} — {FACT_KIND_HINT[kind]}</option>
							{/each}
						</select>
					</div>
					<div>
						<div class="flex items-baseline justify-between">
							<label class="label" for="{id}-text">Fact</label>
							<span
								class={[
									'font-mono text-[11px]',
									words > view.policy.maxWords ? 'text-rose-700' : 'text-zinc-500'
								]}
								aria-live="polite">{words}/{view.policy.maxWords} words</span
							>
						</div>
						<textarea
							id="{id}-text"
							class="input min-h-16 py-1.5"
							rows="1"
							placeholder="e.g. Корни хранят память"
							aria-invalid={lint.errors.length > 0 && draft.text !== ''}
							aria-describedby="{id}-lint"
							bind:value={draft.text}></textarea>
					</div>
				</div>
				<div id="{id}-lint" aria-live="polite" class="flex flex-col gap-0.5 text-[13px]">
					{#if draft.text !== ''}
						{#each lint.errors as message (message)}
							<p class="text-rose-700" role="alert">Error: {message}</p>
						{/each}
					{/if}
					{#each lint.warnings as message (message)}
						<p class="text-amber-700">Note: {message}</p>
					{/each}
				</div>
				<div>
					<label class="label" for="{id}-rationale"
						>Why this Fact? (private — only you and the facilitator see this)</label
					>
					<textarea
						id="{id}-rationale"
						class="input min-h-12 py-1.5"
						rows="1"
						maxlength="2000"
						bind:value={draft.rationale}></textarea>
				</div>
			</div>
		{/each}
	</fieldset>

	<div class="flex items-center gap-2">
		<button type="button" class="btn" onclick={add} disabled={drafts.length >= max}
			>+ Add another candidate</button
		>
		<span class="ml-auto text-sm text-zinc-500">
			{ready ? '' : 'Fix the errors above to submit.'}
		</span>
		<button class="btn btn-primary" type="submit" disabled={!ready || busy}
			>{busy
				? 'Submitting…'
				: `Submit ${drafts.length} candidate${drafts.length === 1 ? '' : 's'}`}</button
		>
	</div>
</form>
