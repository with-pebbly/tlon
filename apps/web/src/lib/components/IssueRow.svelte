<script lang="ts">
	import { resolve } from '$app/paths';
	import { isApiError } from '$lib/api';
	import {
		ISSUE_KIND_LABEL,
		ISSUE_KIND_NOTE,
		ISSUE_SOURCE_CHIP,
		ISSUE_SOURCE_LABEL,
		ISSUE_SOURCE_TITLE,
		issueTone,
		RESOLUTION_LABEL,
		SUGGESTED_ACTION_LABEL,
		TONE_CARD,
		TONE_GLYPH,
		TONE_TEXT
	} from '$lib/continuity';
	import { TASK_STATE_CLASS } from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime, SCOPE_SHORT } from '$lib/ui';
	import type { DismissIssueInput, ValidationIssue } from '@tlon/contracts';

	/** `actions` off: read-only row (e.g. issues a candidate would add if accepted). */
	let { issue, actions = true }: { issue: ValidationIssue; actions?: boolean } = $props();

	const ws = getWorkspace();
	const uid = $props.id();

	type Resolution = DismissIssueInput['resolution'];
	const RESOLUTIONS: readonly { value: Resolution; action: string }[] = [
		{ value: 'dismissed', action: 'Dismiss with reason' },
		{ value: 'perspective_dependent', action: 'Mark perspective-dependent' },
		{ value: 'intentional', action: 'Mark intentional' }
	];

	let resolving = $state<(typeof RESOLUTIONS)[number] | null>(null);
	let reason = $state('');
	let busy = $state(false);

	const tone = $derived(issueTone(issue));
	const beats = $derived(ws.inStoryOrder(issue.artifactIds));
	/** Compare centres on the later beat, so its previous column shows the earlier side. */
	const compareTarget = $derived(beats.findLast((id) => ws.beatIndex.has(id)) ?? beats[0]);
	const bridge = $derived(
		issue.artifactIds.map((id) => ws.bridgeExpansionOf(id)).find((e) => e !== null) ?? null
	);

	/**
	 * The private side owning every Block of the issue, or null when the issue spans sides
	 * (or touches a shared/public artifact). Only side-local issues may go back to A or B:
	 * each side sees its own chain only.
	 */
	const side = $derived.by(() => {
		const scopes = new Set(issue.artifactIds.map((id) => ws.artifactsById.get(id)?.ownerScope));
		const [only] = scopes;
		return scopes.size === 1 && (only === 'A_PRIVATE' || only === 'B_PRIVATE') ? only : null;
	});
	const revisable = $derived(issue.severity === 'blocker' || issue.severity === 'warning');
	const revisionTask = $derived.by(() => {
		const taskId = ws.revisionTaskByIssue.get(issue.key);
		return taskId === undefined ? null : (ws.tasks.find((t) => t.id === taskId) ?? null);
	});
	let revising = $state(false);
	let reviseTarget = $state('');
	let reviseNote = $state('');
	let reviseError = $state<{ code: string; message: string } | null>(null);

	function openRevision() {
		// Default: the later Block — usually the one contradicting an earlier reference.
		reviseTarget = beats.at(-1) ?? '';
		reviseNote = '';
		reviseError = null;
		revising = true;
	}

	async function requestRevision(event: SubmitEvent) {
		event.preventDefault();
		if (reviseTarget === '') return;
		busy = true;
		reviseError = null;
		try {
			const note = reviseNote.trim();
			const task = await ws.requestRevision({
				issueKey: issue.key,
				artifactId: reviseTarget,
				...(note === '' ? {} : { instructions: note })
			});
			revising = false;
			toasts.push(
				'info',
				`Revision task for ${task.role} is on the task board (stage ${task.stageIndex}).`
			);
		} catch (error) {
			if (!isApiError(error)) {
				toasts.error(error);
				return;
			}
			reviseError =
				error.code === 'CROSS_SIDE_REVISION'
					? {
							code: error.code,
							message:
								'This issue spans both sides. A and B each see only their own chain, so neither can be asked to repair it — reconcile through C or a connection instead.'
						}
					: { code: error.code, message: error.message };
		} finally {
			busy = false;
		}
	}

	async function dismiss(event: SubmitEvent) {
		event.preventDefault();
		if (!resolving || reason.trim() === '') return;
		busy = true;
		try {
			await ws.dismissIssue({ key: issue.key, resolution: resolving.value, reason: reason.trim() });
			resolving = null;
			reason = '';
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = false;
		}
	}

	async function reconcile() {
		busy = true;
		try {
			const outcome = await ws.requestReconciliation(issue);
			if (outcome === 'selected') {
				toasts.push(
					'info',
					'No relation links these beats: both are now selected. Link them to open an expansion.'
				);
			} else if (outcome === null) {
				toasts.push('info', 'This issue has no neighbouring beat to reconcile with.');
			}
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = false;
		}
	}
</script>

<article
	class={[
		'flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs',
		TONE_CARD[tone],
		issue.dismissal && 'opacity-70'
	]}
	data-issue-key={issue.key}
>
	<div class="flex items-center gap-1.5">
		<span class={['font-medium', TONE_TEXT[tone]]}
			>{TONE_GLYPH[tone]} {ISSUE_KIND_LABEL[issue.kind]}</span
		>
		{#if issue.stateKey}
			<span class="chip min-w-0 truncate border-zinc-300 bg-white font-mono text-zinc-700"
				>{issue.stateKey}</span
			>
		{/if}
		<span
			class={['chip shrink-0', ISSUE_SOURCE_CHIP[issue.source]]}
			title={ISSUE_SOURCE_TITLE[issue.source]}
			data-testid="issue-source">{ISSUE_SOURCE_LABEL[issue.source]}</span
		>
		<span class="ml-auto shrink-0 text-[11px] text-zinc-400">{issue.severity}</span>
	</div>
	<p class="text-zinc-800">{issue.explanation}</p>
	{#if ISSUE_KIND_NOTE[issue.kind]}
		<p class="text-[11px] text-zinc-500">{ISSUE_KIND_NOTE[issue.kind]}</p>
	{/if}
	{#if issue.evidence.length > 0}
		<ul class="flex flex-col gap-1" aria-label="Evidence quotes">
			{#each issue.evidence as item, i (i)}
				{@const beat = ws.beatIndex.get(item.artifactId)}
				<li>
					<button
						class="flex w-full flex-col gap-0.5 rounded border-l-2 border-zinc-300 bg-white/70 py-0.5 pr-1 pl-2 text-left hover:border-zinc-500"
						title="Select and center the quoted Block"
						data-testid="issue-quote"
						onclick={() => ws.focusArtifact(item.artifactId)}
					>
						<span class="text-zinc-800 italic">«{item.quote}»</span>
						<span class="truncate text-[10px] text-zinc-500"
							>— {beat === undefined ? '' : `#${beat} `}{ws.blockLabel(item.artifactId)}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<ul class="flex flex-col gap-0.5" aria-label="Affected beats">
		{#each beats as id (id)}
			{@const beat = ws.beatIndex.get(id)}
			<li>
				<button
					class="flex w-full min-w-0 items-baseline gap-1.5 text-left hover:underline"
					title="Select and center this beat"
					onclick={() => ws.focusArtifact(id)}
				>
					<span class="shrink-0 font-mono text-[10px] text-zinc-500"
						>{beat !== undefined
							? `#${beat}`
							: ws.pendingCandidateIds.has(id)
								? 'candidate'
								: 'off path'}</span
					>
					<span class="truncate text-zinc-800">{ws.title(id)}</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if issue.suggestedAction}
		<p class="text-[11px] text-zinc-500">
			Suggested: {SUGGESTED_ACTION_LABEL[issue.suggestedAction]}
		</p>
	{/if}
	{#if issue.dismissal}
		<p class="text-[11px] text-zinc-600">
			<span class="font-medium">{RESOLUTION_LABEL[issue.dismissal.resolution]}</span>
			by {ws.principalLabel(issue.dismissal.actorId)} · {formatTime(issue.dismissal.createdAt)} — {issue
				.dismissal.reason}
		</p>
	{:else if actions}
		{#if resolving}
			<form class="flex flex-col gap-1" onsubmit={dismiss}>
				<label class="label" for="{uid}-reason">{resolving.action} — reason</label>
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					id="{uid}-reason"
					class="input"
					rows="2"
					maxlength="1000"
					required
					autofocus
					bind:value={reason}></textarea>
				<div class="flex gap-1.5">
					<button class="btn btn-primary btn-sm" disabled={busy || reason.trim() === ''}
						>{busy ? 'Saving…' : 'Confirm'}</button
					>
					<button type="button" class="btn btn-sm" onclick={() => (resolving = null)}>Cancel</button
					>
				</div>
			</form>
		{:else}
			<div class="flex flex-wrap gap-1">
				{#if compareTarget}
					{@const target = compareTarget}
					<button
						class="btn btn-sm"
						onclick={() => (ws.compare = { artifactId: target, stateKey: issue.stateKey })}
						>Compare neighbours</button
					>
				{/if}
				<button class="btn btn-sm" disabled={busy} onclick={reconcile}
					>Request C reconciliation</button
				>
				{#if bridge}
					{@const expansionId = bridge.id}
					<button
						class="btn btn-sm"
						title="Open the bridge's expansion to propose a replacement candidate"
						onclick={() => ws.select({ type: 'expansion', id: expansionId })}
						>Regenerate bridge</button
					>
				{/if}
				{#each RESOLUTIONS as option (option.value)}
					<button class="btn btn-sm btn-ghost" disabled={busy} onclick={() => (resolving = option)}
						>{option.action}</button
					>
				{/each}
			</div>
		{/if}
		{#if revisable}
			{#if revisionTask}
				<p class="flex flex-wrap items-center gap-1 text-[11px] text-zinc-600">
					Revision requested from {revisionTask.role}:
					<span class={['chip', TASK_STATE_CLASS[revisionTask.state]]}>{revisionTask.state}</span>
					<a
						class="text-accent-600 hover:underline"
						href={resolve('/projects/[projectId]/protocol', { projectId: ws.projectId })}
						>task board ▸</a
					>
				</p>
			{/if}
			{#if side === null}
				<p class="text-[11px] text-zinc-500">
					Not inside one side's chain — neither A nor B can be asked to repair it alone.
				</p>
			{:else if revising}
				<form
					class="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white p-2"
					onsubmit={requestRevision}
					aria-label="Request revision from {SCOPE_SHORT[side]}"
				>
					{#if beats.length > 1}
						<label class="label" for="{uid}-revise-target">Block {SCOPE_SHORT[side]} revises</label>
						<select id="{uid}-revise-target" class="input" bind:value={reviseTarget}>
							{#each beats as id (id)}
								{@const beat = ws.beatIndex.get(id)}
								<option value={id}>{beat === undefined ? '' : `#${beat} `}{ws.title(id)}</option>
							{/each}
						</select>
					{:else}
						<p class="text-zinc-700">
							{SCOPE_SHORT[side]} revises “{ws.title(reviseTarget)}”.
						</p>
					{/if}
					<label class="label" for="{uid}-revise-note"
						>Note for {SCOPE_SHORT[side]} (optional)</label
					>
					<textarea
						id="{uid}-revise-note"
						class="input"
						rows="2"
						maxlength="1000"
						placeholder="What to keep, what to change"
						bind:value={reviseNote}></textarea>
					<p class="text-[11px] text-zinc-500">
						{SCOPE_SHORT[side]} sees the problem, the quotes from its own Blocks and its own chain — never
						the other side.
					</p>
					{#if reviseError}
						<p
							class="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-800"
							role="alert"
							data-testid="revise-error"
						>
							<span class="font-mono font-semibold">{reviseError.code}</span>
							{reviseError.message}
						</p>
					{/if}
					<div class="flex gap-1.5">
						<button class="btn btn-primary btn-sm" disabled={busy || reviseTarget === ''}
							>{busy ? 'Requesting…' : `Send to ${SCOPE_SHORT[side]}`}</button
						>
						<button type="button" class="btn btn-sm" onclick={() => (revising = false)}
							>Cancel</button
						>
					</div>
				</form>
			{:else if !resolving}
				<button class="btn btn-sm self-start" disabled={busy} onclick={openRevision}
					>Request revision from {SCOPE_SHORT[side]}</button
				>
			{/if}
		{/if}
	{/if}
</article>
