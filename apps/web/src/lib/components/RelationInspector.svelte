<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime, shortId } from '$lib/ui';
	import {
		RELATION_STATUSES,
		RelationType,
		type Relation,
		type RelationStatus
	} from '@tlon/contracts';

	import ExpandableRelation from './ExpandableRelation.svelte';
	import KindBadge from './KindBadge.svelte';
	import RelationTypeInput from './RelationTypeInput.svelte';

	/** Mounted once per relation id + updatedAt, so the draft starts from the latest values. */
	let { relation }: { relation: Relation } = $props();

	const ws = getWorkspace();

	// svelte-ignore state_referenced_locally
	let type = $state(relation.type);
	// svelte-ignore state_referenced_locally
	let status = $state<RelationStatus>(relation.status);
	let saving = $state(false);
	let expanding = $state(false);

	const typeValid = $derived(RelationType.safeParse(type).success);
	const dirty = $derived(type !== relation.type || status !== relation.status);
	const from = $derived(ws.artifactsById.get(relation.fromId));
	const to = $derived(ws.artifactsById.get(relation.toId));
	const accepted = $derived(ws.acceptedExpansionFor(relation.id));
	const open = $derived(ws.openExpansionFor(relation.id));
	const producedBy = $derived(
		relation.expansionId ? ws.expansionsById.get(relation.expansionId) : undefined
	);
	const history = $derived(
		(ws.expansionsByTarget.get(relation.id) ?? []).filter(
			(e) => e.id !== accepted?.id && e.id !== open?.id
		)
	);
	const provenanceActive = $derived(ws.highlight?.relationId === relation.id);
	const collapsed = $derived(accepted ? ws.collapsed.has(accepted.id) : false);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!dirty || !typeValid) return;
		saving = true;
		try {
			await ws.updateRelation(relation.id, {
				...(type !== relation.type ? { type } : {}),
				...(status !== relation.status ? { status } : {})
			});
		} catch (error) {
			toasts.error(error);
		} finally {
			saving = false;
		}
	}

	async function expand() {
		expanding = true;
		try {
			await ws.expandRelation(relation.id);
		} catch (error) {
			toasts.error(error);
		} finally {
			expanding = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<header class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<span class="chip border-zinc-300 bg-zinc-100 font-mono text-zinc-700">relation</span>
			<span class="text-[11px] text-zinc-500">{relation.status}</span>
			<span class="ml-auto font-mono text-[11px] text-zinc-400" title={relation.id}
				>{shortId(relation.id)}</span
			>
		</div>
		<div class="flex flex-col gap-1">
			{#each [{ label: 'from', artifact: from }, { label: 'to', artifact: to }] as end (end.label)}
				<button
					class="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-left hover:bg-zinc-50"
					disabled={!end.artifact}
					onclick={() => end.artifact && ws.select({ type: 'artifact', id: end.artifact.id })}
				>
					<span class="w-8 text-[11px] text-zinc-400">{end.label}</span>
					{#if end.artifact}
						<KindBadge kind={end.artifact.kind} />
						<span class="truncate font-medium text-zinc-800">{end.artifact.title}</span>
					{:else}
						<span class="text-zinc-400">hidden or missing artifact</span>
					{/if}
				</button>
				{#if end.label === 'from'}
					<div class="pl-10 font-mono text-[11px] text-zinc-500">—{relation.type}→</div>
				{/if}
			{/each}
		</div>
		<div class="text-[11px] text-zinc-400">
			created {formatTime(relation.createdAt)} · updated {formatTime(relation.updatedAt)}
		</div>
	</header>

	<section class="flex flex-wrap gap-1.5">
		{#if accepted}
			<button class="btn btn-sm" onclick={() => ws.select({ type: 'expansion', id: accepted.id })}
				>View expansion (d{accepted.depth})</button
			>
			<button
				class="btn btn-sm"
				aria-pressed={collapsed}
				onclick={() => ws.toggleCollapse(accepted.id)}
			>
				{collapsed ? 'Show subtree' : 'Collapse subtree'}
			</button>
		{:else if open}
			<button
				class="btn btn-primary btn-sm"
				onclick={() => ws.select({ type: 'expansion', id: open.id })}
				>Open expansion ({open.status.toLowerCase()})</button
			>
		{:else}
			<button
				class="btn btn-primary btn-sm"
				disabled={expanding || relation.status === 'REJECTED'}
				onclick={expand}>{expanding ? 'Opening…' : 'Expand / Bridge'}</button
			>
		{/if}
		<button
			class="btn btn-sm"
			aria-pressed={provenanceActive}
			onclick={() => ws.showProvenance(relation)}
		>
			{provenanceActive ? 'Hide provenance' : 'Show provenance'}
		</button>
	</section>

	{#if relation.expandedByExpansionId}
		<p class="rounded-md bg-zinc-100 px-2 py-1.5 text-xs text-zinc-600">
			Collapsed parent edge: an accepted bridge subdivides this relation. It stays in the semantic
			graph as provenance and is hidden on the canvas unless “Show collapsed parent edges” is on.
		</p>
	{/if}

	{#if accepted && accepted.childRelationIds.length > 0}
		<section>
			<h3 class="section-title mb-1.5">Child relations</h3>
			<div class="flex flex-col gap-1">
				{#each accepted.childRelationIds as childId (childId)}
					{@const child = ws.relationsById.get(childId)}
					{#if child}<ExpandableRelation relation={child} />{/if}
				{/each}
			</div>
		</section>
	{/if}

	<form class="flex flex-col gap-2" onsubmit={save}>
		<div>
			<label class="label" for="ri-type">Type</label>
			<RelationTypeInput id="ri-type" bind:value={type} />
		</div>
		<div>
			<label class="label" for="ri-status">Status</label>
			<select id="ri-status" class="input" bind:value={status}>
				{#each RELATION_STATUSES as option (option)}<option value={option}>{option}</option>{/each}
			</select>
		</div>
		<div class="flex gap-2">
			<button class="btn btn-primary" disabled={!dirty || !typeValid || saving}>
				{saving ? 'Saving…' : 'Save relation'}
			</button>
			{#if dirty}
				<button
					type="button"
					class="btn"
					onclick={() => {
						type = relation.type;
						status = relation.status;
					}}>Discard</button
				>
			{/if}
		</div>
	</form>

	<section>
		<h3 class="section-title mb-1.5">Provenance</h3>
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			<dt class="text-zinc-500">Produced by</dt>
			<dd>
				{#if producedBy}
					<button
						class="text-accent-700 hover:underline"
						onclick={() => ws.select({ type: 'expansion', id: producedBy.id })}
						>expansion d{producedBy.depth} ({shortId(producedBy.id)})</button
					>
				{:else}
					<span class="text-zinc-500">authored directly</span>
				{/if}
			</dd>
			<dt class="text-zinc-500">Artifacts</dt>
			<dd class="flex flex-col gap-0.5">
				{#each relation.provenanceArtifactIds as id (id)}
					<button
						class="truncate text-left text-accent-700 hover:underline"
						onclick={() => ws.focusArtifact(id)}>{ws.title(id)}</button
					>
				{:else}
					<span class="text-zinc-400">none recorded</span>
				{/each}
			</dd>
		</dl>
	</section>

	{#if history.length > 0}
		<section>
			<h3 class="section-title mb-1.5">Earlier expansions</h3>
			<ul class="flex flex-col gap-0.5 text-xs">
				{#each history as expansion (expansion.id)}
					<li>
						<button
							class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-100"
							onclick={() => ws.select({ type: 'expansion', id: expansion.id })}
						>
							<span class="font-mono text-zinc-500">{shortId(expansion.id)}</span>
							<span class="text-zinc-500">{expansion.status}</span>
							<span class="ml-auto text-zinc-400">{formatTime(expansion.createdAt)}</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
