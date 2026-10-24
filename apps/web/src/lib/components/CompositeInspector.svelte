<script lang="ts">
	import { api, isApiError } from '$lib/api';
	import { contractClaims, CLAIM_SECTIONS, scopeAudience } from '$lib/graph/composites';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime, SCOPE_DESCRIPTION, shortId, STATUS_TEXT } from '$lib/ui';
	import type {
		Artifact,
		CompositeDefinition,
		CompositeView,
		ReviseCompositeInput
	} from '@tlon/contracts';
	import { inferBoundary } from '@tlon/core';
	import { SvelteSet } from 'svelte/reactivity';

	import KindBadge from './KindBadge.svelte';
	import ScopeBadge from './ScopeBadge.svelte';

	/** Mounted per composite id; the view re-fetches after every graph refresh. */
	let { artifact }: { artifact: Artifact } = $props();

	const ws = getWorkspace();

	const TABS = [
		['overview', 'Overview'],
		['boundary', 'Boundary'],
		['members', 'Members'],
		['external', 'External edges'],
		['revisions', 'Revisions'],
		['access', 'Access'],
		['derivation', 'Derivation']
	] as const;
	type Tab = (typeof TABS)[number][0];

	let tab = $state<Tab>('overview');
	let view = $state.raw<CompositeView | null>(null);
	let revisions = $state.raw<CompositeDefinition[] | null>(null);
	/** Member revision id → version, for pinned revisions that are no longer the head. */
	let pinnedVersions = $state.raw(new Map<string, number>());
	let busy = $state<string | null>(null);
	let archiveOpen = $state(false);
	let archiveReason = $state('');

	// Revise form (Revisions tab); seeded from the head definition whenever it changes.
	let reviseTitle = $state('');
	let reviseSummary = $state('');
	let reviseReason = $state('');
	const reviseMembers = new SvelteSet<string>();
	const reviseExcluded = new SvelteSet<string>();
	let staleVersion = $state<number | null>(null);

	$effect(() => {
		const id = artifact.id;
		void ws.revision;
		let cancelled = false;
		Promise.all([
			api.getComposite(ws.projectId, id, 1),
			api.listCompositeRevisions(ws.projectId, id)
		])
			.then(async ([next, list]) => {
				if (cancelled) return;
				view = next;
				revisions = list.items.toSorted((a, b) => b.version - a.version);
				reviseTitle = next.artifact.title;
				reviseSummary = next.definition.contract.summary;
				reviseMembers.clear();
				for (const m of next.definition.members) reviseMembers.add(m.artifactId);
				reviseExcluded.clear();
				const heads = new Map(next.memberArtifacts.map((a) => [a.id, a.headRevisionId]));
				const moved = next.definition.members.filter(
					(m) => heads.get(m.artifactId) !== m.pinnedRevisionId
				);
				const lists = await Promise.all(
					moved.map((m) => api.listRevisions(ws.projectId, m.artifactId))
				);
				if (cancelled) return;
				pinnedVersions = new Map(lists.flatMap((l) => l.items.map((r) => [r.id, r.version])));
			})
			.catch((error: unknown) => {
				if (!cancelled) toasts.error(error);
			});
		return () => {
			cancelled = true;
		};
	});

	const definition = $derived(view?.artifact.id === artifact.id ? view.definition : null);
	const memberArtifacts = $derived(new Map((view?.memberArtifacts ?? []).map((a) => [a.id, a])));
	const open = $derived(ws.openComposites.has(artifact.id));
	const level = $derived(ws.compositeLevels.get(artifact.id) ?? 1);
	const grants = $derived(
		ws.grants.filter((g) => g.artifactId === artifact.id && g.revokedAt === null)
	);
	const audience = $derived([...scopeAudience(artifact.ownerScope)]);

	// ── Revise ───────────────────────────────────────────────────────────────────

	const reviseInternal = $derived(
		ws.relations.filter(
			(r) =>
				r.status !== 'REJECTED' &&
				r.fromId !== r.toId &&
				reviseMembers.has(r.fromId) &&
				reviseMembers.has(r.toId)
		)
	);
	const addable = $derived(
		[...ws.multi].filter((id) => id !== artifact.id && !reviseMembers.has(id))
	);

	async function revise(event: SubmitEvent) {
		event.preventDefault();
		if (!definition || reviseMembers.size === 0 || reviseTitle.trim() === '') return;
		const memberIds = [
			...definition.members.map((m) => m.artifactId).filter((id) => reviseMembers.has(id)),
			...[...reviseMembers].filter((id) => !definition.members.some((m) => m.artifactId === id))
		];
		const relationIds = reviseInternal.filter((r) => !reviseExcluded.has(r.id)).map((r) => r.id);
		const membersChanged =
			memberIds.length !== definition.members.length ||
			definition.members.some((m) => !reviseMembers.has(m.artifactId));
		const keep = <T extends { sourceArtifactId: string }>(list: T[]) =>
			list.filter((c) => reviseMembers.has(c.sourceArtifactId));
		const contract = definition.contract;
		const input: ReviseCompositeInput = {
			expectedDefinitionVersion: definition.version,
			memberArtifactIds: memberIds,
			memberRelationIds: relationIds,
			contract: {
				...contract,
				summary: reviseSummary.trim(),
				entryConditions: keep(contract.entryConditions),
				exitConditions: keep(contract.exitConditions),
				invariants: keep(contract.invariants),
				keyClaims: keep(contract.keyClaims)
			},
			// A changed member set re-infers the boundary; otherwise the current one carries over.
			...(membersChanged
				? {
						boundary: inferBoundary(
							memberIds,
							ws.relations.filter((r) => relationIds.includes(r.id))
						)
					}
				: {}),
			...(reviseTitle.trim() !== artifact.title ? { title: reviseTitle.trim() } : {}),
			...(reviseReason.trim() ? { reason: reviseReason.trim() } : {})
		};
		busy = 'revise';
		try {
			await ws.reviseComposite(artifact.id, input);
			reviseReason = '';
			staleVersion = null;
		} catch (error) {
			if (isApiError(error) && error.code === 'STALE_DEFINITION') {
				const details = error.details;
				staleVersion =
					details &&
					typeof details === 'object' &&
					'currentVersion' in details &&
					typeof details.currentVersion === 'number'
						? details.currentVersion
						: -1;
			} else {
				toasts.error(error);
			}
		} finally {
			busy = null;
		}
	}

	async function archive() {
		busy = 'archive';
		try {
			await ws.archiveComposite(artifact.id, archiveReason.trim() || undefined);
			archiveOpen = false;
			archiveReason = '';
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = null;
		}
	}
</script>

{#snippet artifactLink(id: string, extra?: string)}
	<button
		class="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-zinc-100"
		onclick={() => ws.focusArtifact(id)}
	>
		{#if ws.compositesById.has(id)}<span class="font-mono text-zinc-500">◈</span>{/if}
		<span class="min-w-0 flex-1 truncate text-zinc-800">{ws.title(id)}</span>
		{#if extra}<span class="shrink-0 text-[11px] text-zinc-400">{extra}</span>{/if}
	</button>
{/snippet}

<div class="flex flex-col gap-3">
	<header class="flex flex-col gap-1">
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="chip border-zinc-700 bg-zinc-800 font-mono text-white">◈ COMPOSITE</span>
			<KindBadge kind={artifact.kind} />
			<ScopeBadge scope={artifact.ownerScope} long />
			<span class={['text-[11px] font-medium', STATUS_TEXT[artifact.status]]}
				>{artifact.status}</span
			>
			<span class="ml-auto font-mono text-[11px] text-zinc-400" title={artifact.id}
				>{shortId(artifact.id)} · v{artifact.version}{definition
					? ` · def v${definition.version}`
					: ''}</span
			>
		</div>
		<h2 class="text-[15px] leading-snug font-semibold text-zinc-900">{artifact.title}</h2>
		<div class="text-[11px] text-zinc-500">
			level {level} · {definition?.members.length ?? '…'} visible members · updated {formatTime(
				artifact.updatedAt
			)}
		</div>
		<div class="mt-1 flex flex-wrap gap-1.5">
			<button class="btn btn-sm" onclick={() => ws.setCompositeOpen(artifact.id, !open)}
				>{open ? 'Collapse on canvas' : 'Open on canvas'}</button
			>
			<button class="btn btn-sm" onclick={() => ws.enterComposite(artifact.id)}
				>Drill in (Fractal)</button
			>
			<button class="btn btn-sm btn-ghost ml-auto" onclick={() => ws.focusArtifact(artifact.id)}
				>Center</button
			>
		</div>
	</header>

	<div class="flex flex-wrap gap-1 border-b border-zinc-200 pb-1.5" role="tablist">
		{#each TABS as [value, text] (value)}
			<button
				role="tab"
				aria-selected={tab === value}
				class={[
					'rounded px-1.5 py-0.5 text-[11px] font-medium',
					tab === value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-100'
				]}
				onclick={() => (tab = value)}>{text}</button
			>
		{/each}
	</div>

	{#if !view || !definition}
		<p class="text-zinc-400">Loading composite…</p>
	{:else if tab === 'overview'}
		<section class="flex flex-col gap-3" role="tabpanel">
			<div>
				<h3 class="section-title mb-1">Summary</h3>
				<p class="text-xs whitespace-pre-wrap text-zinc-700">
					{definition.contract.summary || '—'}
				</p>
			</div>
			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
				<dt class="text-zinc-500">Kind</dt>
				<dd>{artifact.kind}</dd>
				<dt class="text-zinc-500">Scope</dt>
				<dd>{SCOPE_DESCRIPTION[artifact.ownerScope]}</dd>
				<dt class="text-zinc-500">Definition</dt>
				<dd>
					v{definition.version} · {formatTime(definition.createdAt)} · {ws.principalLabel(
						definition.actorId
					)}
				</dd>
			</dl>
			<div class="flex flex-col gap-2">
				<h3 class="section-title">Contract</h3>
				{#each CLAIM_SECTIONS as section (section.key)}
					{@const list = definition.contract[section.key]}
					{#if list.length > 0}
						<div>
							<div class="text-[11px] text-zinc-500">{section.label}</div>
							<ul class="list-disc pl-4 text-xs text-zinc-800">
								{#each list as claim (claim.claimId)}<li>{claim.text}</li>{/each}
							</ul>
						</div>
					{/if}
				{/each}
				{#if definition.contract.openQuestions.length > 0}
					<div>
						<div class="text-[11px] text-zinc-500">Open questions</div>
						<ul class="list-disc pl-4 text-xs text-zinc-800">
							{#each definition.contract.openQuestions as question, i (i)}<li>{question}</li>{/each}
						</ul>
					</div>
				{/if}
				{#if contractClaims(definition.contract).length === 0 && definition.contract.openQuestions.length === 0}
					<p class="text-xs text-zinc-400">No claims or open questions published.</p>
				{/if}
			</div>
			{#if view.warnings.length > 0}
				<ul
					class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
				>
					{#each view.warnings as warning (warning)}<li>⚠ {warning}</li>{/each}
				</ul>
			{/if}
			{#if view.parentIds.length > 0}
				<div>
					<h3 class="section-title mb-1">Part of</h3>
					{#each view.parentIds as id (id)}{@render artifactLink(id)}{/each}
				</div>
			{/if}
			{#if artifact.status !== 'ARCHIVED'}
				<div class="border-t border-zinc-100 pt-2">
					{#if archiveOpen}
						<div class="flex flex-col gap-1.5">
							<label class="label" for="ci-archive-reason">Archive reason (optional)</label>
							<input
								id="ci-archive-reason"
								class="input"
								bind:value={archiveReason}
								maxlength="1000"
							/>
							<p class="text-[11px] text-zinc-500">
								Retires the composite; members and relations stay untouched.
							</p>
							<div class="flex gap-1.5">
								<button class="btn btn-sm text-rose-700" disabled={busy !== null} onclick={archive}
									>{busy === 'archive' ? 'Archiving…' : 'Confirm archive'}</button
								>
								<button class="btn btn-sm btn-ghost" onclick={() => (archiveOpen = false)}
									>Cancel</button
								>
							</div>
						</div>
					{:else}
						<button class="btn btn-sm text-rose-700" onclick={() => (archiveOpen = true)}
							>Archive…</button
						>
					{/if}
				</div>
			{:else}
				<p class="rounded-md bg-zinc-100 px-2 py-1.5 text-xs text-zinc-600">
					Archived: hidden on canvases unless “Show archived” is on. Members are untouched.
				</p>
			{/if}
		</section>
	{:else if tab === 'boundary'}
		<section class="flex flex-col gap-3" role="tabpanel">
			{#each [['Entries', definition.boundary.entries, 'internal flow starts here; right-side bridges attach before'], ['Exits', definition.boundary.exits, 'internal flow ends here; left-side bridges attach after']] as const as [label, ids, hint] (label)}
				<div>
					<h3 class="section-title">{label}</h3>
					<p class="mb-1 text-[11px] text-zinc-400">{hint}</p>
					{#each ids as id (id)}{@render artifactLink(id)}{:else}<p class="text-xs text-zinc-400">
							None visible.
						</p>{/each}
				</div>
			{/each}
		</section>
	{:else if tab === 'members'}
		<section class="flex flex-col gap-1" role="tabpanel">
			<p class="text-[11px] text-zinc-500">
				Pinned = member revision this definition was composed over.
			</p>
			{#each definition.members.toSorted((a, b) => a.order - b.order) as member (member.artifactId)}
				{@const current = memberArtifacts.get(member.artifactId)}
				{@const changed =
					current !== undefined && current.headRevisionId !== member.pinnedRevisionId}
				<div
					class={[
						'rounded-md border px-1 py-0.5',
						changed ? 'border-amber-300 bg-amber-50/50' : 'border-zinc-200'
					]}
				>
					{@render artifactLink(member.artifactId)}
					<div class="flex gap-2 px-1.5 pb-0.5 font-mono text-[11px] text-zinc-500">
						<span
							>pinned v{changed
								? (pinnedVersions.get(member.pinnedRevisionId) ?? '?')
								: (current?.version ?? '?')}</span
						>
						<span>current v{current?.version ?? '?'}</span>
						{#if changed}<span class="text-amber-800">changed since pinned</span>{/if}
					</div>
				</div>
			{/each}
			<p class="mt-1 text-[11px] text-zinc-500">
				{definition.memberRelationIds.length} internal relation{definition.memberRelationIds
					.length === 1
					? ''
					: 's'} snapshotted.
			</p>
		</section>
	{:else if tab === 'external'}
		<section class="flex flex-col gap-0.5" role="tabpanel">
			<p class="mb-1 text-[11px] text-zinc-500">
				Relations with exactly one end inside the composite (kept on the members, never rewritten).
			</p>
			{#each view.externalRelations as relation (relation.id)}
				<button
					class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-zinc-100"
					onclick={() => ws.select({ type: 'relation', id: relation.id })}
				>
					<span class="truncate text-zinc-700">{ws.title(relation.fromId)}</span>
					<span class="shrink-0 font-mono text-[10px] text-zinc-400">—{relation.type}→</span>
					<span class="truncate text-zinc-700">{ws.title(relation.toId)}</span>
				</button>
			{:else}
				<p class="text-xs text-zinc-400">No external relations.</p>
			{/each}
		</section>
	{:else if tab === 'revisions'}
		<section class="flex flex-col gap-3" role="tabpanel">
			<ol class="flex flex-col gap-1">
				{#each revisions ?? [] as def (def.id)}
					<li class="rounded-md border border-zinc-200 px-2 py-1 text-xs">
						<div class="flex items-center gap-2">
							<span class="font-mono font-semibold text-zinc-700">def v{def.version}</span>
							{#if def.version === definition.version}<span
									class="chip border-emerald-200 bg-emerald-50 text-emerald-700">current</span
								>{/if}
							<span class="ml-auto text-[11px] text-zinc-400">{formatTime(def.createdAt)}</span>
						</div>
						<div class="text-zinc-500">
							{def.members.length} members · {def.memberRelationIds.length} relations · by {ws.principalLabel(
								def.actorId
							)}
						</div>
						{#if def.reason}<div class="text-zinc-600">{def.reason}</div>{/if}
					</li>
				{/each}
			</ol>

			<form class="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2.5" onsubmit={revise}>
				<h3 class="section-title">Revise (from def v{definition.version})</h3>
				{#if staleVersion !== null}
					<div
						class="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
						role="alert"
					>
						STALE_DEFINITION — the composite was revised meanwhile{staleVersion > 0
							? ` (now def v${staleVersion})`
							: ''}. Reload and re-apply your change.
						<button
							type="button"
							class="btn btn-sm mt-1"
							onclick={() => {
								staleVersion = null;
								ws.reload().catch((error: unknown) => toasts.error(error));
							}}>Reload latest</button
						>
					</div>
				{/if}
				<div>
					<label class="label" for="ci-title">Title</label>
					<input id="ci-title" class="input" bind:value={reviseTitle} maxlength="300" />
				</div>
				<div>
					<label class="label" for="ci-summary">Summary</label>
					<textarea id="ci-summary" class="input" rows="3" bind:value={reviseSummary}></textarea>
				</div>
				<div>
					<div class="label">Members</div>
					{#each [...new Set( [...definition.members.map((m) => m.artifactId), ...reviseMembers] )] as id (id)}
						<label class="flex items-center gap-1.5 text-xs">
							<input
								type="checkbox"
								checked={reviseMembers.has(id)}
								onchange={() =>
									reviseMembers.has(id) ? reviseMembers.delete(id) : reviseMembers.add(id)}
							/>
							<span class="truncate">{ws.title(id)}</span>
						</label>
					{/each}
					{#if addable.length > 0}
						<button
							type="button"
							class="btn btn-sm mt-1"
							onclick={() => {
								for (const id of addable) reviseMembers.add(id);
							}}>Add canvas selection ({addable.length})</button
						>
					{:else}
						<p class="text-[11px] text-zinc-400">
							Shift-select artifacts on the canvas to add them as members.
						</p>
					{/if}
				</div>
				<div>
					<div class="label">Internal relations</div>
					{#each reviseInternal as relation (relation.id)}
						<label class="flex items-center gap-1.5 text-xs">
							<input
								type="checkbox"
								checked={!reviseExcluded.has(relation.id)}
								onchange={() =>
									reviseExcluded.has(relation.id)
										? reviseExcluded.delete(relation.id)
										: reviseExcluded.add(relation.id)}
							/>
							<span class="truncate"
								>{ws.title(relation.fromId)} —{relation.type}→ {ws.title(relation.toId)}</span
							>
						</label>
					{:else}
						<p class="text-[11px] text-zinc-400">None between the members.</p>
					{/each}
				</div>
				<div>
					<label class="label" for="ci-reason">Reason (optional)</label>
					<input id="ci-reason" class="input" bind:value={reviseReason} maxlength="1000" />
				</div>
				<button
					class="btn btn-primary self-start"
					disabled={busy !== null || reviseMembers.size === 0 || reviseTitle.trim() === ''}
					>{busy === 'revise' ? 'Revising…' : 'Revise composite'}</button
				>
				<p class="text-[11px] text-zinc-500">
					Appends def v{definition.version + 1} with fresh member pins; bridges anchored on this composite
					become stale.
				</p>
			</form>
		</section>
	{:else if tab === 'access'}
		<section class="flex flex-col gap-2 text-xs" role="tabpanel">
			<div class="flex items-center gap-2">
				<ScopeBadge scope={artifact.ownerScope} long />
				<span class="text-zinc-600">{SCOPE_DESCRIPTION[artifact.ownerScope]}</span>
			</div>
			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<dt class="text-zinc-500">Readable by role</dt>
				<dd class="font-mono">{audience.join(', ')}</dd>
				<dt class="text-zinc-500">Creator role</dt>
				<dd class="font-mono">{artifact.creatorRole}</dd>
			</dl>
			<div>
				<h3 class="section-title mb-1">Grants on this composite</h3>
				{#each grants as grant (grant.id)}
					<div class="flex gap-2">
						<span>{ws.principalLabel(grant.granteePrincipalId)}</span>
						<span class="text-zinc-400"
							>{grant.expiresAt ? `until ${formatTime(grant.expiresAt)}` : 'no expiry'}</span
						>
					</div>
				{:else}
					<p class="text-zinc-400">None.</p>
				{/each}
			</div>
			<p class="text-[11px] text-zinc-500">
				Reading a composite never grants its members: each reader sees only the members, relations
				and claims they can read on their own.
			</p>
		</section>
	{:else if tab === 'derivation'}
		<section class="flex flex-col gap-1.5" role="tabpanel">
			{#each contractClaims(definition.contract) as { section, claim } (claim.claimId)}
				{@const source = memberArtifacts.get(claim.sourceArtifactId)}
				<div class="rounded-md border border-zinc-200 px-2 py-1.5 text-xs">
					<div class="text-[11px] text-zinc-500">{section}</div>
					<div class="text-zinc-800">{claim.text}</div>
					<button
						class="mt-0.5 flex items-center gap-1 text-[11px] text-accent-700 hover:underline"
						onclick={() => ws.focusArtifact(claim.sourceArtifactId)}
					>
						→ {ws.title(claim.sourceArtifactId)} @ rev {shortId(claim.sourceRevisionId)}
					</button>
					{#if source && source.headRevisionId !== claim.sourceRevisionId}
						<div class="text-[11px] text-amber-800">
							source changed since cited (now v{source.version})
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-xs text-zinc-400">No claims cite member revisions.</p>
			{/each}
		</section>
	{/if}
</div>
