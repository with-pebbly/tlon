<script lang="ts">
	import { leakingScopes } from '$lib/graph/composites';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { SCOPE_DESCRIPTION, SCOPE_LABEL } from '$lib/ui';
	import {
		ARTIFACT_KINDS,
		OWNER_SCOPES,
		type ArtifactKind,
		type ClaimRef,
		type CompositeBoundary,
		type OwnerScope
	} from '@tlon/contracts';
	import { compositionWarnings, inferBoundary } from '@tlon/core';
	import { SvelteSet } from 'svelte/reactivity';

	import KindBadge from './KindBadge.svelte';
	import ScopeBadge from './ScopeBadge.svelte';

	/** Mounted per Compose action; the member list starts from the multi-selection. */
	let { memberIds, onclose }: { memberIds: readonly string[]; onclose: () => void } = $props();

	const ws = getWorkspace();

	// svelte-ignore state_referenced_locally
	let members = $state([...memberIds]);
	let title = $state('');
	let kind = $state<ArtifactKind>('ARC');
	let summary = $state('');
	let ownerScope = $state<OwnerScope>('PROJECT_PUBLIC');
	let reason = $state('');
	let questionsText = $state('');
	/** Internal relations the user unticked (everything selected-internal starts ticked). */
	const excluded = new SvelteSet<string>();
	/** Null = follow `inferBoundary`; set once the user edits entries/exits. */
	let boundaryEdit = $state.raw<CompositeBoundary | null>(null);
	let claims = $state.raw<ClaimRef[]>([]);
	// svelte-ignore state_referenced_locally
	let claimMember = $state(memberIds[0] ?? '');
	let claimText = $state('');
	let saving = $state(false);

	const memberSet = $derived(new Set(members));
	const internal = $derived(
		ws.relations.filter(
			(r) =>
				r.status !== 'REJECTED' &&
				r.fromId !== r.toId &&
				memberSet.has(r.fromId) &&
				memberSet.has(r.toId)
		)
	);
	const included = $derived(internal.filter((r) => !excluded.has(r.id)));
	const externalCount = $derived(
		ws.relations.filter(
			(r) => r.status !== 'REJECTED' && memberSet.has(r.fromId) !== memberSet.has(r.toId)
		).length
	);
	const inferred = $derived(inferBoundary(members, included));
	const boundary = $derived<CompositeBoundary>(
		boundaryEdit
			? {
					entries: boundaryEdit.entries.filter((id) => memberSet.has(id)),
					exits: boundaryEdit.exits.filter((id) => memberSet.has(id))
				}
			: inferred
	);
	const liveClaims = $derived(claims.filter((c) => memberSet.has(c.sourceArtifactId)));
	const openQuestions = $derived(
		questionsText
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '')
	);
	const warnings = $derived(compositionWarnings(members, included, externalCount));
	const leaks = $derived(
		leakingScopes(
			ownerScope,
			members.flatMap((id) => {
				const scope = ws.artifactsById.get(id)?.ownerScope;
				return scope ? [scope] : [];
			})
		)
	);
	const canSubmit = $derived(!saving && title.trim() !== '' && members.length > 0);

	function toggleBoundary(side: keyof CompositeBoundary, id: string) {
		const current = boundary[side];
		const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
		boundaryEdit = { ...boundary, [side]: members.filter((m) => next.includes(m)) };
	}

	function removeMember(id: string) {
		members = members.filter((m) => m !== id);
		if (claimMember === id) claimMember = members[0] ?? '';
	}

	function addClaim() {
		const source = ws.artifactsById.get(claimMember);
		const text = claimText.trim();
		if (!source || text === '') return;
		claims = [
			...claims,
			{
				claimId: `claim-${crypto.randomUUID().slice(0, 8)}`,
				text,
				sourceArtifactId: source.id,
				// The claim cites the member exactly as it reads now.
				sourceRevisionId: source.headRevisionId
			}
		];
		claimText = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		saving = true;
		try {
			await ws.createComposite({
				title: title.trim(),
				kind,
				memberArtifactIds: members,
				memberRelationIds: included.map((r) => r.id),
				boundary,
				contract: { summary: summary.trim(), keyClaims: liveClaims, openQuestions },
				ownerScope,
				...(reason.trim() ? { reason: reason.trim() } : {})
			});
			onclose();
		} catch (error) {
			toasts.error(error);
		} finally {
			saving = false;
		}
	}
</script>

<aside
	class="fixed top-11 right-0 bottom-0 z-40 flex w-[460px] flex-col border-l border-zinc-200 bg-white shadow-2xl"
	aria-label="Compose selection"
>
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-zinc-100 px-4">
		<h2 class="font-semibold text-zinc-900">◈ Compose selection</h2>
		<button class="btn btn-ghost btn-sm text-zinc-400" aria-label="Close" onclick={onclose}
			>✕</button
		>
	</div>
	<form class="flex min-h-0 flex-1 flex-col" onsubmit={submit}>
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
			<div class="grid grid-cols-[1fr_120px] gap-2">
				<div>
					<label class="label" for="cd-title">Title</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input id="cd-title" class="input" bind:value={title} maxlength="300" autofocus />
				</div>
				<div>
					<label class="label" for="cd-kind">Kind</label>
					<select id="cd-kind" class="input" bind:value={kind}>
						{#each ARTIFACT_KINDS as option (option)}<option value={option}>{option}</option>{/each}
					</select>
				</div>
			</div>
			<div>
				<label class="label" for="cd-summary">Summary</label>
				<textarea id="cd-summary" class="input" rows="3" bind:value={summary}></textarea>
			</div>

			<section>
				<h3 class="label">Members ({members.length})</h3>
				<ul class="flex flex-col gap-0.5">
					{#each members as id (id)}
						{@const artifact = ws.artifactsById.get(id)}
						<li class="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-zinc-50">
							{#if artifact}
								<KindBadge kind={artifact.kind} />
								<ScopeBadge scope={artifact.ownerScope} />
							{/if}
							{#if ws.compositesById.has(id)}<span class="font-mono text-zinc-500">◈</span>{/if}
							<span class="min-w-0 flex-1 truncate text-zinc-800">{ws.title(id)}</span>
							<button
								type="button"
								class="text-zinc-400 hover:text-rose-600 disabled:opacity-30"
								aria-label="Remove {ws.title(id)}"
								disabled={members.length === 1}
								onclick={() => removeMember(id)}>✕</button
							>
						</li>
					{/each}
				</ul>
			</section>

			<section>
				<h3 class="label">Included internal relations ({included.length}/{internal.length})</h3>
				{#if internal.length === 0}
					<p class="text-xs text-zinc-400">No relations between the selected members.</p>
				{/if}
				<ul class="flex flex-col gap-0.5">
					{#each internal as relation (relation.id)}
						<li>
							<label class="flex items-center gap-1.5 text-xs">
								<input
									type="checkbox"
									checked={!excluded.has(relation.id)}
									onchange={() =>
										excluded.has(relation.id)
											? excluded.delete(relation.id)
											: excluded.add(relation.id)}
								/>
								<span class="truncate text-zinc-700">{ws.title(relation.fromId)}</span>
								<span class="shrink-0 font-mono text-[10px] text-zinc-400">—{relation.type}→</span>
								<span class="truncate text-zinc-700">{ws.title(relation.toId)}</span>
							</label>
						</li>
					{/each}
				</ul>
			</section>

			<section>
				<div class="flex items-baseline justify-between">
					<h3 class="label">Boundary</h3>
					{#if boundaryEdit}
						<button
							type="button"
							class="text-[11px] text-accent-600 hover:underline"
							onclick={() => (boundaryEdit = null)}>Reset to inferred</button
						>
					{:else}
						<span class="text-[11px] text-zinc-400">inferred from relations</span>
					{/if}
				</div>
				<table class="w-full text-xs">
					<thead>
						<tr class="text-[11px] text-zinc-500">
							<th class="text-left font-medium">Member</th>
							<th class="w-14 font-medium">Entry</th>
							<th class="w-14 font-medium">Exit</th>
						</tr>
					</thead>
					<tbody>
						{#each members as id (id)}
							<tr>
								<td class="max-w-0 truncate py-0.5 text-zinc-700">{ws.title(id)}</td>
								<td class="text-center"
									><input
										type="checkbox"
										aria-label="Entry: {ws.title(id)}"
										checked={boundary.entries.includes(id)}
										onchange={() => toggleBoundary('entries', id)}
									/></td
								>
								<td class="text-center"
									><input
										type="checkbox"
										aria-label="Exit: {ws.title(id)}"
										checked={boundary.exits.includes(id)}
										onchange={() => toggleBoundary('exits', id)}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			<section class="flex flex-col gap-1.5">
				<h3 class="label">Key claims</h3>
				{#each liveClaims as claim (claim.claimId)}
					<div class="flex items-start gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs">
						<div class="min-w-0 flex-1">
							<div class="text-zinc-800">{claim.text}</div>
							<div class="text-[11px] text-zinc-500">
								cites {ws.title(claim.sourceArtifactId)} @ {claim.sourceRevisionId.slice(0, 8)}
							</div>
						</div>
						<button
							type="button"
							class="text-zinc-400 hover:text-rose-600"
							aria-label="Remove claim"
							onclick={() => (claims = claims.filter((c) => c.claimId !== claim.claimId))}>✕</button
						>
					</div>
				{/each}
				<div class="grid grid-cols-[150px_1fr_auto] gap-1.5">
					<select class="input" aria-label="Claim source member" bind:value={claimMember}>
						{#each members as id (id)}<option value={id}>{ws.title(id)}</option>{/each}
					</select>
					<input
						class="input"
						placeholder="Claim text…"
						aria-label="Claim text"
						bind:value={claimText}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addClaim();
							}
						}}
					/>
					<button
						type="button"
						class="btn btn-sm h-7"
						disabled={claimText.trim() === ''}
						onclick={addClaim}>Add</button
					>
				</div>
				<p class="text-[11px] text-zinc-400">
					A claim cites the member's current revision; only its text is published on the interface.
				</p>
			</section>

			<div>
				<label class="label" for="cd-questions">Open questions (one per line)</label>
				<textarea id="cd-questions" class="input" rows="2" bind:value={questionsText}></textarea>
			</div>

			<div class="grid grid-cols-[150px_1fr] items-end gap-2">
				<div>
					<label class="label" for="cd-scope">Composite scope</label>
					<select id="cd-scope" class="input" bind:value={ownerScope}>
						{#each OWNER_SCOPES as option (option)}<option value={option}
								>{SCOPE_LABEL[option]}</option
							>{/each}
					</select>
				</div>
				<p class="pb-1 text-[11px] text-zinc-500">{SCOPE_DESCRIPTION[ownerScope]}</p>
			</div>
			{#if leaks.length > 0}
				<p
					class="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-800"
					role="alert"
				>
					SCOPE_LEAK: a {SCOPE_LABEL[ownerScope]} composite would be readable by roles that cannot read
					its {leaks.map((s) => SCOPE_LABEL[s]).join(', ')} members. Pick another scope.
				</p>
			{/if}

			<div>
				<label class="label" for="cd-reason">Reason (optional)</label>
				<input id="cd-reason" class="input" bind:value={reason} maxlength="1000" />
			</div>

			{#if warnings.length > 0}
				<ul
					class="flex flex-col gap-0.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
					aria-label="Composition warnings"
				>
					{#each warnings as warning (warning)}<li>⚠ {warning}</li>{/each}
				</ul>
			{/if}
		</div>
		<div class="flex shrink-0 justify-end gap-2 border-t border-zinc-100 px-4 py-2.5">
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={!canSubmit}
				>{saving ? 'Composing…' : 'Compose'}</button
			>
		</div>
	</form>
</aside>
