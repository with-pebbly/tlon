<script lang="ts">
	import {
		ISSUE_KIND_LABEL,
		issueTone,
		RESOLUTION_LABEL,
		SUGGESTED_ACTION_LABEL,
		TONE_CARD,
		TONE_GLYPH,
		TONE_TEXT
	} from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime } from '$lib/ui';
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
		<span class="ml-auto shrink-0 text-[11px] text-zinc-400">{issue.severity}</span>
	</div>
	<p class="text-zinc-800">{issue.explanation}</p>
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
	{/if}
</article>
