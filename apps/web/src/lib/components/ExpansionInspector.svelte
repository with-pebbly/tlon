<script module lang="ts">
	import { ValidationIssue } from '@tlon/contracts';

	/** `details.issues` of a 409 CONTINUITY_VIOLATION from accept. */
	const Blockers = ValidationIssue.pick({
		key: true,
		kind: true,
		severity: true,
		artifactIds: true,
		stateKey: true
	}).array();
</script>

<script lang="ts">
	import { api, isApiError } from '$lib/api';
	import { ISSUE_KIND_LABEL, issueTone, TONE_GLYPH, TONE_TEXT } from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { isOpen } from '$lib/state/workspace.svelte';
	import { formatTime, shortId } from '$lib/ui';
	import {
		DEFAULT_CHILD_RELATION_TYPE,
		RelationType,
		type Artifact,
		type ExpansionDetail
	} from '@tlon/contracts';

	import CandidateForm from './CandidateForm.svelte';
	import ExpandableRelation from './ExpandableRelation.svelte';
	import IssueRow from './IssueRow.svelte';
	import KindBadge from './KindBadge.svelte';
	import RelationTypeInput from './RelationTypeInput.svelte';

	let { expansionId }: { expansionId: string } = $props();

	const ws = getWorkspace();

	let detail = $state.raw<ExpansionDetail | null>(null);
	let pinnedVersions = $state.raw<{ left: number | null; right: number | null }>({
		left: null,
		right: null
	});
	let leftType = $state(DEFAULT_CHILD_RELATION_TYPE);
	let rightType = $state(DEFAULT_CHILD_RELATION_TYPE);
	let busy = $state<string | null>(null);
	/** Blockers the server refused an accept for, until accepted anyway or dismissed. */
	let violation = $state.raw<{
		candidateId: string;
		issues: ReturnType<typeof Blockers.parse>;
	} | null>(null);
	let acknowledgement = $state('');

	// Re-fetch on selection change and after every graph refresh (mutations bump `revision`).
	$effect(() => {
		const id = expansionId;
		void ws.revision;
		let cancelled = false;
		api
			.getExpansion(ws.projectId, id)
			.then(async (next) => {
				if (cancelled) return;
				detail = next;
				const [left, right] = await Promise.all([
					api.listRevisions(ws.projectId, next.left.id),
					api.listRevisions(ws.projectId, next.right.id)
				]);
				if (!cancelled) {
					pinnedVersions = {
						left: left.items.find((r) => r.id === next.expansion.leftRevisionId)?.version ?? null,
						right: right.items.find((r) => r.id === next.expansion.rightRevisionId)?.version ?? null
					};
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) toasts.error(error);
			});
		return () => {
			cancelled = true;
		};
	});

	const expansion = $derived(detail?.expansion.id === expansionId ? detail.expansion : null);
	const open = $derived(expansion ? isOpen(expansion) : false);
	const activeCandidates = $derived(
		(detail?.candidates ?? []).filter((c) => c.reviewStatus !== 'REJECTED').length
	);
	const maxCandidates = $derived(ws.project?.settings.maxCandidates ?? 3);
	const typesValid = $derived(
		RelationType.safeParse(leftType).success && RelationType.safeParse(rightType).success
	);
	const staleSides = $derived(
		detail
			? (['left', 'right'] as const).filter((side) =>
					side === 'left'
						? detail?.left.headRevisionId !== detail?.expansion.leftRevisionId
						: detail?.right.headRevisionId !== detail?.expansion.rightRevisionId
				)
			: []
	);

	async function run(label: string, action: () => Promise<unknown>) {
		busy = label;
		try {
			await action();
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = null;
		}
	}

	/**
	 * Accept a candidate. A 409 CONTINUITY_VIOLATION lists the blockers it would add; a
	 * human may then resend with `acknowledgeIssues` (the reason is recorded server-side).
	 */
	async function accept(candidateId: string, acknowledgeIssues?: string) {
		busy = `accept:${candidateId}`;
		try {
			await ws.accept(expansionId, {
				candidateId,
				leftRelationType: leftType,
				rightRelationType: rightType,
				...(acknowledgeIssues ? { acknowledgeIssues } : {})
			});
			violation = null;
			acknowledgement = '';
		} catch (error) {
			const details =
				isApiError(error) && error.code === 'CONTINUITY_VIOLATION' ? error.details : null;
			const blockers =
				details && typeof details === 'object' && 'issues' in details
					? Blockers.safeParse(details.issues)
					: null;
			if (blockers?.success) violation = { candidateId, issues: blockers.data };
			else toasts.error(error);
		} finally {
			busy = null;
		}
	}
</script>

{#snippet anchor(side: 'left' | 'right', artifact: Artifact, pinnedId: string)}
	{@const stale = artifact.headRevisionId !== pinnedId}
	<button
		class={[
			'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left hover:bg-zinc-50',
			stale ? 'border-amber-300 bg-amber-50/60' : 'border-zinc-200'
		]}
		onclick={() => ws.select({ type: 'artifact', id: artifact.id })}
	>
		<span class="flex items-center gap-1.5 text-[11px] text-zinc-500">
			{side === 'left' ? 'Left anchor (A)' : 'Right anchor (B)'}
			<KindBadge kind={artifact.kind} />
		</span>
		<span class="font-medium text-zinc-800">{artifact.title}</span>
		<span class={['font-mono text-[11px]', stale ? 'text-amber-800' : 'text-zinc-400']}>
			pinned v{pinnedVersions[side] ?? '?'} · current v{artifact.version}{stale
				? ' — changed since pinned'
				: ''}
		</span>
	</button>
{/snippet}

{#if !detail || !expansion}
	<p class="text-zinc-400">Loading expansion…</p>
{:else}
	<div class="flex flex-col gap-4">
		<header class="flex flex-col gap-1">
			<div class="flex items-center gap-2">
				<span class="chip border-accent-200 bg-accent-50 font-mono text-accent-700">expansion</span>
				<span class="chip border-zinc-200 bg-zinc-50 font-mono text-zinc-600"
					>depth {expansion.depth}</span
				>
				<span class="text-[11px] font-medium text-zinc-600">{expansion.status}</span>
				{#if expansion.staleSides.length > 0}
					<span
						class="chip border-amber-300 bg-amber-50 text-amber-800"
						title="An anchor's head revision moved past the pinned one after acceptance"
						>stale: {expansion.staleSides.join('/')}</span
					>
				{/if}
				<span class="ml-auto font-mono text-[11px] text-zinc-400" title={expansion.id}
					>{shortId(expansion.id)}</span
				>
			</div>
			<nav
				class="flex flex-wrap items-center gap-1 text-[11px] text-zinc-500"
				aria-label="Expansion lineage"
			>
				{#each detail.lineage as ancestor (ancestor.id)}
					<button
						class="hover:text-accent-700 hover:underline"
						onclick={() => ws.select({ type: 'expansion', id: ancestor.id })}
						>d{ancestor.depth}
						{ws.title(ancestor.leftArtifactId)} ⇢ {ws.title(ancestor.rightArtifactId)}</button
					>
					<span>›</span>
				{/each}
				<span class="font-medium text-zinc-700">d{expansion.depth} (this)</span>
			</nav>
			<div class="text-[11px] text-zinc-400">
				opened {formatTime(expansion.createdAt)} · {expansion.attempts} submission{expansion.attempts ===
				1
					? ''
					: 's'}
				{#if expansion.acceptedAt}· accepted {formatTime(expansion.acceptedAt)}{/if}
			</div>
		</header>

		<section class="flex flex-col gap-1.5">
			{@render anchor('left', detail.left, expansion.leftRevisionId)}
			{#if detail.targetRelation}
				{@const target = detail.targetRelation}
				<button
					class="self-start pl-2 font-mono text-[11px] text-zinc-500 hover:text-accent-700"
					onclick={() => ws.select({ type: 'relation', id: target.id })}
					>—{target.type}→ (target relation)</button
				>
			{:else}
				<span class="pl-2 text-[11px] text-zinc-400">ordered pair (no target relation)</span>
			{/if}
			{@render anchor('right', detail.right, expansion.rightRevisionId)}
			{#if open && staleSides.length > 0}
				<p
					class="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
					role="alert"
				>
					The {staleSides.join(' and ')} anchor changed after this expansion pinned it. Accepting will
					fail with STALE_ANCHOR_REVISION — cancel this expansion and open a new one to bridge the current
					versions.
				</p>
			{/if}
		</section>

		{#if expansion.status === 'ACCEPTED'}
			<section
				class="flex flex-col gap-1.5 rounded-lg border border-accent-200 bg-accent-50/50 p-2.5"
			>
				<h3 class="section-title text-accent-700">Accepted bridge</h3>
				{#if expansion.staleSides.length > 0}
					<p
						class="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
						role="alert"
					>
						Stale: the {expansion.staleSides.join(' and ')} anchor changed after this bridge was accepted
						(e.g. a composite got a new definition). The bridge is kept as is — review whether it still
						reconciles the current versions.
					</p>
				{/if}
				{#if expansion.selectedBridgeArtifactId}
					{@const bridgeId = expansion.selectedBridgeArtifactId}
					<button
						class="text-left font-medium text-accent-800 hover:underline"
						onclick={() => ws.focusArtifact(bridgeId)}>◆ {ws.title(bridgeId)}</button
					>
				{/if}
				{#each detail.childRelations as relation (relation.id)}
					<ExpandableRelation {relation} />
				{/each}
				<button class="btn btn-sm self-start" onclick={() => ws.toggleCollapse(expansion.id)}>
					{ws.collapsed.has(expansion.id) ? 'Show subtree on canvas' : 'Collapse subtree on canvas'}
				</button>
			</section>
		{/if}

		<section class="flex flex-col gap-2">
			<div class="flex items-baseline justify-between">
				<h3 class="section-title">Candidates</h3>
				<span class="text-[11px] text-zinc-400">{activeCandidates} / {maxCandidates} active</span>
			</div>
			{#if open && detail.candidates.some((c) => c.reviewStatus === 'PENDING')}
				<div class="grid grid-cols-2 gap-2 rounded-md bg-zinc-50 p-2">
					<div>
						<label class="label" for="ei-left-type">A → C type</label>
						<RelationTypeInput id="ei-left-type" bind:value={leftType} />
					</div>
					<div>
						<label class="label" for="ei-right-type">C → B type</label>
						<RelationTypeInput id="ei-right-type" bind:value={rightType} />
					</div>
				</div>
			{/if}
			{#each detail.candidates as candidate (candidate.id)}
				{@const structured = candidate.artifact.structured}
				{@const reconciliation = structured.anchorReconciliation}
				<article
					class={[
						'flex flex-col gap-1.5 rounded-lg border p-2.5',
						candidate.reviewStatus === 'PENDING' &&
							'border-dashed border-accent-500 bg-accent-50/40',
						candidate.reviewStatus === 'SELECTED' && 'border-accent-500 bg-white',
						(candidate.reviewStatus === 'REJECTED' || candidate.reviewStatus === 'NOT_SELECTED') &&
							'border-zinc-200 bg-zinc-50 opacity-70'
					]}
				>
					<div class="flex items-center gap-2">
						<button
							class="min-w-0 flex-1 truncate text-left font-medium text-zinc-900 hover:underline"
							onclick={() => ws.select({ type: 'artifact', id: candidate.artifactId })}
							>{candidate.artifact.title}</button
						>
						<span class="shrink-0 text-[11px] font-medium text-zinc-500"
							>{candidate.reviewStatus}</span
						>
					</div>
					<dl class="flex flex-col gap-1 text-xs">
						<div>
							<dt class="text-[11px] text-zinc-500">Mechanism</dt>
							<dd class="text-zinc-800">
								{typeof structured.mechanism === 'string' ? structured.mechanism : '—'}
							</dd>
						</div>
						{#if Array.isArray(structured.assumptions) && structured.assumptions.length > 0}
							<div>
								<dt class="text-[11px] text-zinc-500">Assumptions</dt>
								<dd>
									<ul class="list-disc pl-4 text-zinc-700">
										{#each structured.assumptions as assumption, i (i)}<li>
												{String(assumption)}
											</li>{/each}
									</ul>
								</dd>
							</div>
						{/if}
						{#if reconciliation && typeof reconciliation === 'object' && 'left' in reconciliation && 'right' in reconciliation}
							<div>
								<dt class="text-[11px] text-zinc-500">Reconciliation</dt>
								<dd class="text-zinc-700">
									<div><span class="text-zinc-400">A:</span> {String(reconciliation.left)}</div>
									<div><span class="text-zinc-400">B:</span> {String(reconciliation.right)}</div>
								</dd>
							</div>
						{/if}
					</dl>
					{#if candidate.issues.length > 0}
						<div class="flex flex-col gap-1.5">
							<div class="text-[11px] font-medium text-zinc-600">
								If accepted, adds {candidate.issues.length} issue{candidate.issues.length === 1
									? ''
									: 's'} to the story path:
							</div>
							{#each candidate.issues as issue (issue.key)}
								<IssueRow {issue} actions={false} />
							{/each}
						</div>
					{:else if candidate.reviewStatus === 'PENDING'}
						<p class="text-[11px] text-zinc-500">
							{ws.transitionsByArtifact.has(candidate.artifactId)
								? 'Adds no continuity issues to the story path.'
								: 'No state annotation — continuity was not checked.'}
						</p>
					{/if}
					{#if open && candidate.reviewStatus === 'PENDING'}
						<div class="flex gap-1.5">
							<button
								class="btn btn-primary btn-sm"
								disabled={busy !== null || !typesValid}
								onclick={() => accept(candidate.id)}
								>{busy === `accept:${candidate.id}` ? 'Accepting…' : 'Accept'}</button
							>
							<button
								class="btn btn-sm"
								disabled={busy !== null}
								onclick={() =>
									run(`reject:${candidate.id}`, () => ws.reject(expansionId, candidate.id))}
								>Reject candidate</button
							>
						</div>
						{#if violation?.candidateId === candidate.id}
							{@const blocked = violation}
							<div
								class="flex flex-col gap-1.5 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900"
								role="alert"
							>
								<div class="font-semibold">
									CONTINUITY_VIOLATION — accepting adds {blocked.issues.length} blocker{blocked
										.issues.length === 1
										? ''
										: 's'}:
								</div>
								<ul class="flex flex-col gap-1">
									{#each blocked.issues as issue (issue.key)}
										{@const tone = issueTone(issue)}
										<li class="flex flex-col">
											<span
												><span class={['font-medium', TONE_TEXT[tone]]}
													>{TONE_GLYPH[tone]} {ISSUE_KIND_LABEL[issue.kind]}</span
												>
												{#if issue.stateKey}<span class="font-mono text-zinc-700"
														>· {issue.stateKey}</span
													>{/if}</span
											>
											<span class="text-zinc-700">
												{ws
													.inStoryOrder(issue.artifactIds)
													.map((id) => {
														const beat = ws.beatIndex.get(id);
														return `${beat === undefined ? '' : `#${beat} `}${ws.title(id)}`;
													})
													.join(' ⇄ ')}
											</span>
										</li>
									{/each}
								</ul>
								<form
									class="flex flex-col gap-1"
									onsubmit={(event) => {
										event.preventDefault();
										if (acknowledgement.trim() !== '') accept(candidate.id, acknowledgement.trim());
									}}
								>
									<label class="label text-rose-800" for="ei-ack-{candidate.id}"
										>Reason for accepting anyway (recorded in the revision and audit)</label
									>
									<textarea
										id="ei-ack-{candidate.id}"
										class="input"
										rows="2"
										maxlength="1000"
										required
										bind:value={acknowledgement}></textarea>
									<div class="flex gap-1.5">
										<button
											class="btn btn-sm border-rose-300 text-rose-800"
											disabled={busy !== null || acknowledgement.trim() === ''}
											>{busy === `accept:${candidate.id}` ? 'Accepting…' : 'Accept anyway'}</button
										>
										<button
											type="button"
											class="btn btn-sm"
											onclick={() => {
												violation = null;
												acknowledgement = '';
											}}>Keep open</button
										>
									</div>
								</form>
							</div>
						{/if}
					{/if}
				</article>
			{:else}
				<p class="text-xs text-zinc-400">No candidates yet.</p>
			{/each}
		</section>

		{#if open}
			{#if activeCandidates < maxCandidates}
				<CandidateForm {detail} />
			{:else}
				<p class="text-xs text-zinc-500">Candidate limit reached; reject one to propose another.</p>
			{/if}
			<button
				class="btn self-start text-rose-700"
				disabled={busy !== null}
				onclick={() => run('cancel', () => ws.reject(expansionId))}>Cancel expansion</button
			>
		{/if}
	</div>
{/if}
