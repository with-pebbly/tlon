<script lang="ts">
	import { isApiError } from '$lib/api';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { artifactCategory, CATEGORY_LABEL, formatTime, shortId } from '$lib/ui';
	import { parseJsonObject, validateStructured } from '$lib/validation';
	import {
		ARTIFACT_KINDS,
		ARTIFACT_STATUSES,
		type Artifact,
		type ArtifactKind,
		type ArtifactStatus,
		type UpdateArtifactInput
	} from '@tlon/contracts';

	import ExpandableRelation from './ExpandableRelation.svelte';
	import Icon from './Icon.svelte';
	import KindBadge from './KindBadge.svelte';
	import NarrativeFields from './NarrativeFields.svelte';
	import RevisionHistory from './RevisionHistory.svelte';

	/** Mounted once per (artifact id, head revision): the draft starts from that revision. */
	let { artifact }: { artifact: Artifact } = $props();

	const ws = getWorkspace();

	// svelte-ignore state_referenced_locally
	const initial = artifact;
	let title = $state(initial.title);
	let kind = $state<ArtifactKind>(initial.kind);
	let status = $state<ArtifactStatus>(initial.status);
	let body = $state(initial.body);
	let structuredText = $state(JSON.stringify(initial.structured, null, 2));
	let reason = $state('');
	let saving = $state(false);
	let conflict = $state<{ currentRevisionId: string | null } | null>(null);

	const domain = $derived(ws.project?.domain ?? 'GENERIC');
	const parsed = $derived(parseJsonObject(structuredText));
	const structuredError = $derived(
		parsed.ok ? validateStructured(domain, kind, parsed.value) : parsed.error
	);

	const patch = $derived.by<UpdateArtifactInput | null>(() => {
		const next: UpdateArtifactInput = {};
		if (title.trim() !== artifact.title) next.title = title.trim();
		if (kind !== artifact.kind) next.kind = kind;
		if (status !== artifact.status) next.status = status;
		if (body !== artifact.body) next.body = body;
		if (parsed.ok && JSON.stringify(parsed.value) !== JSON.stringify(artifact.structured)) {
			next.structured = parsed.value;
		}
		return Object.keys(next).length > 0 ? next : null;
	});
	const canSave = $derived(
		patch !== null && !saving && !artifact.locked && structuredError === null && title.trim() !== ''
	);

	const incoming = $derived(ws.relations.filter((r) => r.toId === artifact.id));
	const outgoing = $derived(ws.relations.filter((r) => r.fromId === artifact.id));
	const involvement = $derived(ws.expansionsInvolving(artifact.id));
	const bridgeOf = $derived(
		involvement
			.filter((i) => i.role === 'bridge' && i.expansion.selectedBridgeArtifactId === artifact.id)
			.map((i) => i.expansion)
	);
	const category = $derived(
		artifactCategory(artifact, ws.pendingCandidateIds, ws.acceptedBridgeIds)
	);

	function setNarrativeField(key: string, value: string) {
		if (!parsed.ok) return;
		const next = { ...parsed.value };
		if (value.trim() === '') delete next[key];
		else next[key] = value;
		structuredText = JSON.stringify(next, null, 2);
	}

	function staleRevisionId(error: unknown): string | null {
		if (!isApiError(error)) return null;
		const details = error.details;
		if (details && typeof details === 'object' && 'currentRevisionId' in details) {
			return typeof details.currentRevisionId === 'string' ? details.currentRevisionId : null;
		}
		return null;
	}

	async function save(input: UpdateArtifactInput) {
		saving = true;
		try {
			await ws.updateArtifact(artifact, input);
		} catch (error) {
			if (isApiError(error) && error.code === 'STALE_REVISION') {
				conflict = { currentRevisionId: staleRevisionId(error) };
			} else {
				toasts.error(error);
			}
		} finally {
			saving = false;
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!patch || !canSave) return;
		save({ ...patch, ...(reason.trim() ? { reason: reason.trim() } : {}) });
	}

	function discard() {
		title = artifact.title;
		kind = artifact.kind;
		status = artifact.status;
		body = artifact.body;
		structuredText = JSON.stringify(artifact.structured, null, 2);
		reason = '';
	}
</script>

<div class="flex flex-col gap-4">
	<header class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<KindBadge kind={artifact.kind} />
			<span class="text-[11px] text-zinc-500">{CATEGORY_LABEL[category]}</span>
			<span class="ml-auto font-mono text-[11px] text-zinc-400" title={artifact.id}
				>{shortId(artifact.id)} · v{artifact.version}</span
			>
		</div>
		<h2 class="text-[15px] leading-snug font-semibold text-zinc-900">{artifact.title}</h2>
		<div class="flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
			<span>creator <span class="font-mono text-zinc-700">{artifact.creatorRole}</span></span>
			<span>scope <span class="font-mono text-zinc-700">{artifact.ownerScope}</span></span>
			<span>updated {formatTime(artifact.updatedAt)}</span>
		</div>
		<div class="mt-1 flex gap-1.5">
			<button
				class={['btn btn-sm', artifact.locked && 'border-amber-300 bg-amber-50 text-amber-800']}
				disabled={saving}
				aria-pressed={artifact.locked}
				onclick={() => save({ locked: !artifact.locked })}
			>
				<Icon name="lock" label="Lock" />
				{artifact.locked ? 'Locked — unlock' : 'Lock'}
			</button>
			<button
				class={['btn btn-sm', artifact.pinned && 'border-accent-200 bg-accent-50 text-accent-700']}
				disabled={saving || artifact.locked}
				aria-pressed={artifact.pinned}
				onclick={() => save({ pinned: !artifact.pinned })}
			>
				<Icon name="pin" label="Pin" />
				{artifact.pinned ? 'Pinned — unpin' : 'Pin'}
			</button>
			<button class="btn btn-sm btn-ghost ml-auto" onclick={() => ws.focusArtifact(artifact.id)}>
				Center
			</button>
		</div>
	</header>

	{#if conflict}
		<div
			class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
			role="alert"
		>
			<div class="font-semibold">STALE_REVISION — this artifact changed since you opened it.</div>
			<p class="mt-0.5">
				Your draft was based on v{artifact.version}{conflict.currentRevisionId
					? ` (server head is now ${shortId(conflict.currentRevisionId)})`
					: ''}. Reload to see the latest version; unsaved edits will be discarded.
			</p>
			<button
				class="btn btn-sm mt-1.5"
				onclick={() => ws.reload().catch((error: unknown) => toasts.error(error))}
				>Reload latest</button
			>
		</div>
	{/if}

	{#if artifact.locked}
		<p class="rounded-md bg-zinc-100 px-2 py-1.5 text-xs text-zinc-600">
			Locked: every change except unlocking is rejected by the server.
		</p>
	{/if}

	{#each bridgeOf as expansion (expansion.id)}
		<section class="rounded-lg border border-accent-200 bg-accent-50/50 p-2.5">
			<h3 class="section-title mb-1.5 text-accent-700">
				Accepted bridge · depth {expansion.depth} · child relations
			</h3>
			<div class="flex flex-col gap-1">
				{#each expansion.childRelationIds as relationId (relationId)}
					{@const relation = ws.relationsById.get(relationId)}
					{#if relation}<ExpandableRelation {relation} />{/if}
				{/each}
			</div>
		</section>
	{/each}

	<form class="flex flex-col gap-2.5" onsubmit={submit}>
		<fieldset class="contents" disabled={artifact.locked}>
			<div>
				<label class="label" for="ai-title">Title</label>
				<input id="ai-title" class="input" bind:value={title} maxlength="300" required />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label class="label" for="ai-kind">Kind</label>
					<select id="ai-kind" class="input" bind:value={kind}>
						{#each ARTIFACT_KINDS as option (option)}<option value={option}>{option}</option>{/each}
					</select>
				</div>
				<div>
					<label class="label" for="ai-status">Status</label>
					<select id="ai-status" class="input" bind:value={status}>
						{#each ARTIFACT_STATUSES as option (option)}<option value={option}>{option}</option
							>{/each}
					</select>
				</div>
			</div>
			<div>
				<label class="label" for="ai-body">Body</label>
				<textarea id="ai-body" class="input" rows="4" bind:value={body}></textarea>
			</div>
			{#if domain === 'NARRATIVE'}
				<div>
					<div class="label">Narrative fields</div>
					<NarrativeFields
						structured={parsed.ok ? parsed.value : null}
						disabled={artifact.locked}
						onchange={setNarrativeField}
					/>
				</div>
			{/if}
			<div>
				<label class="label" for="ai-structured">Structured (JSON)</label>
				<textarea
					id="ai-structured"
					class={['input font-mono text-xs', structuredError && 'border-rose-400']}
					rows="6"
					spellcheck="false"
					bind:value={structuredText}></textarea>
				{#if structuredError}
					<p class="mt-0.5 text-[11px] text-rose-600">{structuredError}</p>
				{/if}
			</div>
			<div>
				<label class="label" for="ai-reason">Change reason (optional)</label>
				<input id="ai-reason" class="input" bind:value={reason} maxlength="1000" />
			</div>
		</fieldset>
		<div class="flex gap-2">
			<button class="btn btn-primary" disabled={!canSave}
				>{saving ? 'Saving…' : 'Save revision'}</button
			>
			{#if patch}
				<button type="button" class="btn" onclick={discard}>Discard</button>
				<span class="self-center text-[11px] text-zinc-500"
					>Unsaved: {Object.keys(patch).join(', ')}</span
				>
			{/if}
		</div>
	</form>

	<section>
		<h3 class="section-title mb-1.5">Relations</h3>
		{#if incoming.length === 0 && outgoing.length === 0}
			<p class="text-xs text-zinc-400">None.</p>
		{/if}
		<ul class="flex flex-col gap-0.5 text-xs">
			{#each incoming as relation (relation.id)}
				<li>
					<button
						class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-zinc-100"
						onclick={() => ws.select({ type: 'relation', id: relation.id })}
					>
						<span class="text-zinc-400">in</span>
						<span class="truncate text-zinc-700">{ws.title(relation.fromId)}</span>
						<span class="shrink-0 font-mono text-[10px] text-zinc-400">—{relation.type}→</span>
						<span class="text-zinc-400">this</span>
						{#if relation.expandedByExpansionId}<span class="ml-auto text-[10px] text-zinc-400"
								>collapsed</span
							>{/if}
						{#if relation.status !== 'ACCEPTED'}<span class="ml-auto text-[10px] text-zinc-400"
								>{relation.status}</span
							>{/if}
					</button>
				</li>
			{/each}
			{#each outgoing as relation (relation.id)}
				<li>
					<button
						class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-zinc-100"
						onclick={() => ws.select({ type: 'relation', id: relation.id })}
					>
						<span class="text-zinc-400">out</span>
						<span class="text-zinc-400">this</span>
						<span class="shrink-0 font-mono text-[10px] text-zinc-400">—{relation.type}→</span>
						<span class="truncate text-zinc-700">{ws.title(relation.toId)}</span>
						{#if relation.expandedByExpansionId}<span class="ml-auto text-[10px] text-zinc-400"
								>collapsed</span
							>{/if}
						{#if relation.status !== 'ACCEPTED'}<span class="ml-auto text-[10px] text-zinc-400"
								>{relation.status}</span
							>{/if}
					</button>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h3 class="section-title mb-1.5">Expansion lineage</h3>
		{#if involvement.length === 0}
			<p class="text-xs text-zinc-400">Not an anchor or bridge of any expansion.</p>
		{:else}
			<ul class="flex flex-col gap-0.5 text-xs">
				{#each involvement as { expansion, role } (expansion.id)}
					<li>
						<button
							class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-zinc-100"
							onclick={() => ws.select({ type: 'expansion', id: expansion.id })}
						>
							<span class="chip border-zinc-200 bg-zinc-50 font-mono text-zinc-500"
								>d{expansion.depth}</span
							>
							<span class="text-zinc-500"
								>{role === 'bridge' ? 'bridge of' : `${role} anchor of`}</span
							>
							<span class="truncate text-zinc-700">
								{ws.title(expansion.leftArtifactId)} ⇢ {ws.title(expansion.rightArtifactId)}
							</span>
							<span class="ml-auto shrink-0 text-[10px] text-zinc-400">{expansion.status}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<RevisionHistory {artifact} />
</div>
