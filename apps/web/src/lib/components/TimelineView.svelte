<script lang="ts">
	import { clockOf, formatBeatTime } from '$lib/continuity';
	import { worldTimeRange } from '$lib/graph/composites';
	import { FACT_KIND_ICON } from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { artifactCategory, CATEGORY_CARD, STATUS_TEXT } from '$lib/ui';
	import { transitiveMembers } from '@tlon/core';
	import { SvelteSet } from 'svelte/reactivity';

	import KindBadge from './KindBadge.svelte';

	const ws = getWorkspace();

	/** Composite rows unfolded to their members (UI only). */
	const expanded = new SvelteSet<string>();

	/** Relation linking two consecutive artifacts of a thread (for the separator label). */
	const relationBetween = $derived.by(() => {
		const map = new Map<string, string>();
		for (const r of ws.relations) {
			if (r.status === 'REJECTED') continue;
			// Child relations of an expansion win over the collapsed parent edge they replace.
			const key = `${r.fromId}|${r.toId}`;
			if (!map.has(key) || r.expandedByExpansionId === null) map.set(key, r.id);
		}
		return map;
	});

	/** One row per shown composite: direct member count and world-time span of all members. */
	const compositeRows = $derived(
		ws.composites
			.filter((c) => {
				const status = ws.artifactsById.get(c.artifactId)?.status;
				return status !== undefined && (status !== 'ARCHIVED' || ws.filters.showArchived);
			})
			.map((c) => ({
				id: c.artifactId,
				memberIds: c.memberArtifactIds.filter((id) => ws.artifactsById.has(id)),
				span: worldTimeRange(transitiveMembers(c.artifactId, ws.membership), ws.artifactsById)
			}))
	);
	/** Facts are atemporal connectors: listed beside the threads, never placed on them. */
	const facts = $derived(
		ws.factArtifacts.filter((a) => a.status !== 'REJECTED' || ws.filters.showRejected)
	);
</script>

{#snippet card(artifactId: string)}
	{@const artifact = ws.artifactsById.get(artifactId)}
	{@const time = ws.transitionsByArtifact.get(artifactId)?.transition.time}
	{@const timeLabel = formatBeatTime(time)}
	{#if artifact}
		<button
			class={[
				'flex h-full w-52 flex-col gap-1 rounded-lg border p-2 text-left shadow-xs hover:shadow-md',
				ws.compositesById.has(artifact.id)
					? 'tlon-composite-card border-2 border-zinc-700 bg-white'
					: CATEGORY_CARD[artifactCategory(artifact, ws.pendingCandidateIds, ws.acceptedBridgeIds)],
				ws.selection?.id === artifact.id && 'outline-2 outline-offset-2 outline-accent-500'
			]}
			onclick={() => ws.select({ type: 'artifact', id: artifact.id })}
		>
			<span class="flex items-center gap-1.5 text-[11px]">
				{#if ws.compositesById.has(artifact.id)}<span class="font-mono text-zinc-600">◈</span>{/if}
				<KindBadge kind={artifact.kind} />
				<span class={STATUS_TEXT[artifact.status]}>{artifact.status}</span>
			</span>
			<span class="line-clamp-3 font-medium text-zinc-900">{artifact.title}</span>
			{#if typeof artifact.structured.worldTime === 'string'}
				<span class="text-[11px] text-zinc-500">world time: {artifact.structured.worldTime}</span>
			{/if}
			{#if time && timeLabel}
				<span
					class={['font-mono text-[11px]', time.outOfOrder ? 'text-violet-700' : 'text-zinc-700']}
					title={time.outOfOrder ? 'Flashback — excluded from chronology checks' : 'Story time'}
					>{timeLabel}</span
				>
				{#if time.approx && time.minute !== undefined && time.toleranceMinutes > 0}
					{@const from = Math.max(0, time.minute - time.toleranceMinutes)}
					{@const to = Math.min(24 * 60 - 1, time.minute + time.toleranceMinutes)}
					<span
						class="relative block h-1.5 w-full rounded-full bg-zinc-100"
						title="Approximate: {clockOf(from)}–{clockOf(to)} within the day"
						aria-label="Time range {clockOf(from)} to {clockOf(to)}"
						role="img"
					>
						<span
							class="absolute inset-y-0 min-w-1 rounded-full bg-sky-300"
							style:left="{(from / (24 * 60)) * 100}%"
							style:width="{((to - from) / (24 * 60)) * 100}%"
						></span>
						<span
							class="absolute inset-y-[-2px] w-px bg-sky-700"
							style:left="{(time.minute / (24 * 60)) * 100}%"
						></span>
					</span>
				{/if}
			{/if}
		</button>
	{:else}
		<span class="block w-52 rounded-lg border border-dashed border-zinc-300 p-2 text-zinc-400"
			>Hidden artifact</span
		>
	{/if}
{/snippet}

<div class="absolute inset-0 overflow-auto px-6 py-5">
	<div class="mb-1 flex items-baseline justify-between">
		<h2 class="font-semibold text-zinc-900">Timeline</h2>
		<span class="text-xs text-zinc-500"
			>One thread per root relation, read through its accepted bridges.</span
		>
	</div>
	<p class="mb-4 text-xs text-zinc-400">
		Order follows the expansion intervals; a bridge is not claimed to be a chronological midpoint.
	</p>
	{#if facts.length > 0}
		<aside
			class="absolute top-4 right-4 z-10 max-h-[60%] w-72 overflow-y-auto rounded-lg border border-amber-300 bg-amber-50/95 p-3 shadow-sm"
			aria-label="Atemporal facts"
		>
			<h3 class="section-title mb-1 text-amber-900">Atemporal facts</h3>
			<p class="mb-2 text-[11px] text-amber-900/80">
				Facts connect blocks without a place in time; they are not beats.
			</p>
			<ul class="flex flex-col gap-1">
				{#each facts as fact (fact.id)}
					<li>
						<button
							class={[
								'flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-[13px] hover:bg-amber-100',
								fact.status !== 'ACCEPTED' && 'text-zinc-500'
							]}
							onclick={() => ws.select({ type: 'artifact', id: fact.id })}
						>
							<span aria-hidden="true">{fact.factKind ? FACT_KIND_ICON[fact.factKind] : '◆'}</span>
							<span class="min-w-0 flex-1">{fact.title}</span>
							{#if ws.stageByArtifact.has(fact.id)}
								<span class="shrink-0 font-mono text-[10px] text-amber-900"
									>S{ws.stageByArtifact.get(fact.id)}</span
								>
							{/if}
							{#if fact.status !== 'ACCEPTED'}
								<span class="shrink-0 text-[10px]">{fact.status.toLowerCase()}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</aside>
	{/if}
	{#if compositeRows.length > 0}
		<section class="mb-6" aria-label="Composites">
			<h3 class="section-title mb-1.5">Composites</h3>
			<ul class="flex flex-col gap-1">
				{#each compositeRows as row (row.id)}
					<li class="rounded-lg border border-zinc-200 bg-white">
						<div class="flex items-center gap-2 px-2 py-1.5">
							<button
								class="w-4 shrink-0 text-[10px] text-zinc-400 hover:text-zinc-700"
								aria-label={expanded.has(row.id) ? 'Hide members' : 'Show members'}
								aria-expanded={expanded.has(row.id)}
								onclick={() =>
									expanded.has(row.id) ? expanded.delete(row.id) : expanded.add(row.id)}
								>{expanded.has(row.id) ? '▾' : '▸'}</button
							>
							<button
								class="flex min-w-0 flex-1 items-center gap-2 text-left"
								onclick={() => ws.select({ type: 'artifact', id: row.id })}
							>
								<span class="font-mono text-zinc-600">◈</span>
								<span class="truncate font-medium text-zinc-900">{ws.title(row.id)}</span>
								<span class="shrink-0 font-mono text-[11px] text-zinc-500"
									>L{ws.compositeLevels.get(row.id) ?? 1}</span
								>
								<span class="shrink-0 text-[11px] text-zinc-500"
									>{row.memberIds.length} member{row.memberIds.length === 1 ? '' : 's'}</span
								>
								<span class="ml-auto shrink-0 text-[11px] text-zinc-500">
									{#if row.span}
										world time {row.span.min}{row.span.max !== row.span.min
											? ` – ${row.span.max}`
											: ''}
									{:else}
										no world time
									{/if}
								</span>
							</button>
						</div>
						{#if expanded.has(row.id)}
							<ol class="flex items-stretch gap-2 overflow-x-auto border-t border-zinc-100 p-2">
								{#each row.memberIds as id (id)}
									<li class="shrink-0">{@render card(id)}</li>
								{/each}
							</ol>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	{#if ws.timeline.length === 0}
		<p class="text-zinc-500">No relations yet.</p>
	{/if}
	<div class="flex flex-col gap-5">
		{#each ws.timeline as thread (thread.rootRelationId)}
			<section>
				<button
					class="mb-1.5 font-mono text-[11px] text-zinc-500 hover:text-accent-600"
					onclick={() => ws.select({ type: 'relation', id: thread.rootRelationId })}
					>root: {thread.type} · {thread.artifactIds.length} artifacts</button
				>
				<ol class="flex items-stretch gap-0 overflow-x-auto p-1 pb-2">
					{#each thread.artifactIds as artifactId, index (`${index}:${artifactId}`)}
						{#if index > 0}
							{@const prev = thread.artifactIds[index - 1] ?? ''}
							{@const relationId = relationBetween.get(`${prev}|${artifactId}`)}
							{@const relation = relationId ? ws.relationsById.get(relationId) : undefined}
							<li class="flex shrink-0 items-center px-1" aria-hidden={!relation}>
								{#if relation}
									<button
										class="flex flex-col items-center font-mono text-[10px] text-zinc-400 hover:text-accent-600"
										onclick={() => ws.select({ type: 'relation', id: relation.id })}
									>
										<span>{relation.type}</span>
										<span class="text-base leading-none">⟶</span>
									</button>
								{:else}
									<span class="text-zinc-300">⟶</span>
								{/if}
							</li>
						{/if}
						<li class="shrink-0">{@render card(artifactId)}</li>
					{/each}
				</ol>
			</section>
		{/each}
	</div>
</div>
