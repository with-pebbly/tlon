<script lang="ts">
	import {
		ISSUE_KIND_LABEL,
		ISSUE_KIND_ORDER,
		issueTone,
		TONE_GLYPH,
		TONE_RANK,
		TONE_TEXT
	} from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import { UNANNOTATED_LABEL } from '$lib/state/workspace.svelte';

	import IssueRow from './IssueRow.svelte';

	const ws = getWorkspace();

	let showDismissed = $state(false);
	let unannotatedOpen = $state(false);

	/** One group per kind; its heading takes the strongest tone (severity varies per item). */
	const groups = $derived(
		ISSUE_KIND_ORDER.map((kind) => {
			const items = ws.openIssues.filter((i) => i.kind === kind);
			const tone = items
				.map((i) => issueTone(i))
				.reduce(
					(a, b) => (TONE_RANK[b] > TONE_RANK[a] ? b : a),
					issueTone({ kind, severity: 'info' })
				);
			return { kind, items, tone };
		}).filter((g) => g.items.length > 0)
	);
	const unannotatedHighlighted = $derived(ws.highlight?.label === UNANNOTATED_LABEL);
</script>

<section id="issues-panel" class="flex scroll-mt-3 flex-col gap-2" aria-label="Continuity issues">
	<div class="flex items-baseline justify-between">
		<h3 class="section-title">Issues</h3>
		<span class="text-[11px] text-zinc-400"
			>{ws.openIssues.length} open · {ws.blockerCount} blocker{ws.blockerCount === 1
				? ''
				: 's'}</span
		>
	</div>

	{#if ws.issuesError}
		<div
			class="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800"
			role="alert"
		>
			<span class="font-mono font-semibold">{ws.issuesError.code}</span>
			<span class="min-w-0 truncate">{ws.issuesError.message}</span>
			<button class="btn btn-sm ml-auto" onclick={() => ws.reloadIssues()}>Retry</button>
		</div>
	{/if}

	{#if ws.unannotatedIds.length > 0}
		<div class="flex flex-col gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs">
			<p class="text-zinc-600">
				<span class="font-semibold text-zinc-800">{ws.unannotatedIds.length}</span>
				beat{ws.unannotatedIds.length === 1 ? '' : 's'} without a state annotation — validation is blind
				there.
			</p>
			<div class="flex gap-3">
				<button class="text-accent-600 hover:underline" onclick={() => ws.showUnannotated()}
					>{unannotatedHighlighted ? 'Clear highlight' : 'Highlight on canvas'}</button
				>
				<button
					class="text-accent-600 hover:underline"
					aria-expanded={unannotatedOpen}
					onclick={() => (unannotatedOpen = !unannotatedOpen)}
					>{unannotatedOpen ? 'Hide list' : 'List them'}</button
				>
			</div>
			{#if unannotatedOpen}
				<ul class="flex flex-col gap-0.5">
					{#each ws.inStoryOrder(ws.unannotatedIds) as id (id)}
						{@const beat = ws.beatIndex.get(id)}
						<li>
							<button
								class="flex w-full min-w-0 items-baseline gap-1.5 text-left hover:underline"
								title="Open the State tab to annotate this beat"
								onclick={() => ws.inspectState(id)}
							>
								<span class="shrink-0 font-mono text-[10px] text-zinc-500"
									>{beat === undefined ? '—' : `#${beat}`}</span
								>
								<span class="truncate text-zinc-800">{ws.title(id)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if ws.issueList && groups.length === 0}
		<p class="text-xs text-zinc-400">No open issues on the committed path.</p>
	{/if}

	{#each groups as group (group.kind)}
		{@const tone = group.tone}
		<details class="group" open={group.kind !== 'redundancy'}>
			<summary
				class="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-zinc-50"
			>
				<span class="inline-block text-zinc-400 transition-transform group-open:rotate-90">▸</span>
				<span class={['font-medium', TONE_TEXT[tone]]}
					>{TONE_GLYPH[tone]} {ISSUE_KIND_LABEL[group.kind]}</span
				>
				<span class="ml-auto text-[11px] text-zinc-400">{group.items.length}</span>
			</summary>
			<div class="mt-1.5 flex flex-col gap-1.5">
				{#each group.items as issue (issue.key)}
					<IssueRow {issue} />
				{/each}
			</div>
		</details>
	{/each}

	{#if ws.dismissedIssues.length > 0}
		<label class="flex items-center gap-2 text-xs text-zinc-600">
			<input type="checkbox" bind:checked={showDismissed} />
			Show dismissed ({ws.dismissedIssues.length})
		</label>
		{#if showDismissed}
			<div class="flex flex-col gap-1.5" aria-label="Dismissed issues">
				{#each ws.dismissedIssues as issue (issue.key)}
					<IssueRow {issue} />
				{/each}
			</div>
		{/if}
	{/if}
</section>
