<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { ARTIFACT_KINDS, ARTIFACT_STATUSES } from '@tlon/contracts';

	import CompositeOutlineNode from './CompositeOutlineNode.svelte';
	import OutlineNode from './OutlineNode.svelte';

	const ws = getWorkspace();
	const f = ws.filters;

	const kindCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const a of ws.artifacts) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
		return counts;
	});
	const statusCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const a of ws.artifacts) counts[a.status] = (counts[a.status] ?? 0) + 1;
		return counts;
	});
	const unlinked = $derived.by(() => {
		const linked = new Set<string>();
		for (const r of ws.relations) {
			linked.add(r.fromId);
			linked.add(r.toId);
		}
		return ws.artifacts.filter(
			(a) =>
				!linked.has(a.id) &&
				a.status !== 'REJECTED' &&
				a.status !== 'ARCHIVED' &&
				!ws.pendingCandidateIds.has(a.id) &&
				!ws.compositesById.has(a.id) &&
				!ws.parentsOf.has(a.id)
		);
	});
	/** Outline roots: shown composites no other shown composite contains. */
	const rootComposites = $derived.by(() => {
		const shown = new Set(
			ws.composites
				.map((c) => c.artifactId)
				.filter((id) => {
					const status = ws.artifactsById.get(id)?.status;
					return status !== undefined && (status !== 'ARCHIVED' || f.showArchived);
				})
		);
		return [...shown].filter((id) => !(ws.parentsOf.get(id) ?? []).some((p) => shown.has(p)));
	});
</script>

<aside class="flex w-64 shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-white">
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if rootComposites.length > 0}
			<section class="border-b border-zinc-100 px-3 py-2.5" aria-label="Composites">
				<div class="mb-1.5 flex items-center justify-between">
					<h2 class="section-title">Composites</h2>
					<span class="text-[11px] text-zinc-400">{ws.composites.length}</span>
				</div>
				<ul class="-mx-1">
					{#each rootComposites as id (id)}
						<CompositeOutlineNode compositeId={id} />
					{/each}
				</ul>
			</section>
		{/if}
		<section class="border-b border-zinc-100 px-3 py-2.5">
			<div class="mb-1.5 flex items-center justify-between">
				<h2 class="section-title">Outline</h2>
				<span class="text-[11px] text-zinc-400"
					>{ws.fractal.length} root relation{ws.fractal.length === 1 ? '' : 's'}</span
				>
			</div>
			{#if ws.fractal.length === 0}
				<p class="text-xs text-zinc-400">
					No relations yet. Drag from a node's right handle to another node to link them.
				</p>
			{:else}
				<ul class="-mx-1">
					{#each ws.fractal as node (node.relation.id)}
						<OutlineNode {node} />
					{/each}
				</ul>
			{/if}
			{#if unlinked.length > 0}
				<div class="mt-2 mb-1 text-[11px] text-zinc-400">Unlinked artifacts</div>
				<ul class="-mx-1">
					{#each unlinked as artifact (artifact.id)}
						<li>
							<button
								class={[
									'block w-full truncate rounded px-1.5 py-0.5 text-left text-xs hover:bg-zinc-100',
									ws.selection?.id === artifact.id && 'bg-accent-50 text-accent-700'
								]}
								onclick={() => ws.focusArtifact(artifact.id)}>{artifact.title}</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="flex flex-col gap-2.5 px-3 py-2.5">
			<div class="flex items-center justify-between">
				<h2 class="section-title">Filters</h2>
				{#if f.active}
					<button class="text-[11px] text-accent-600 hover:underline" onclick={() => f.reset()}
						>Clear</button
					>
				{/if}
			</div>
			<input
				class="input"
				type="search"
				placeholder="Filter by text…"
				aria-label="Filter by text"
				bind:value={f.query}
			/>

			<div>
				<div class="label">Kind</div>
				<div class="flex flex-wrap gap-1">
					{#each ARTIFACT_KINDS as kind (kind)}
						<button
							class={[
								'chip font-mono',
								f.kinds.has(kind)
									? 'border-accent-500 bg-accent-50 text-accent-700'
									: 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300',
								!kindCounts[kind] && !f.kinds.has(kind) && 'opacity-40'
							]}
							aria-pressed={f.kinds.has(kind)}
							onclick={() => (f.kinds.has(kind) ? f.kinds.delete(kind) : f.kinds.add(kind))}
						>
							{kind}<span class="text-zinc-400">{kindCounts[kind] ?? 0}</span>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<div class="label">Status</div>
				<div class="flex flex-wrap gap-1">
					{#each ARTIFACT_STATUSES as status (status)}
						<button
							class={[
								'chip',
								f.statuses.has(status)
									? 'border-accent-500 bg-accent-50 text-accent-700'
									: 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300',
								!statusCounts[status] && !f.statuses.has(status) && 'opacity-40'
							]}
							aria-pressed={f.statuses.has(status)}
							onclick={() =>
								f.statuses.has(status) ? f.statuses.delete(status) : f.statuses.add(status)}
						>
							{status}<span class="text-zinc-400">{statusCounts[status] ?? 0}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-1 text-zinc-600">
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={f.showCandidates} /> Show candidates
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={f.showRejected} /> Show rejected
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={f.showArchived} /> Show archived
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={f.showCollapsedEdges} /> Show collapsed parent edges
				</label>
			</div>
			{#if ws.collapsed.size > 0}
				<button class="btn btn-sm self-start" onclick={() => ws.collapsed.clear()}>
					Expand all collapsed subtrees ({ws.collapsed.size})
				</button>
			{/if}
			{#if ws.openComposites.size > 0}
				<button
					class="btn btn-sm self-start"
					onclick={() => {
						for (const id of [...ws.openComposites]) ws.setCompositeOpen(id, false);
					}}
				>
					Collapse all composites ({ws.openComposites.size})
				</button>
			{/if}
		</section>
	</div>
</aside>
