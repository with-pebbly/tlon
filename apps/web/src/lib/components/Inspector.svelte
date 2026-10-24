<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { isOpen } from '$lib/state/workspace.svelte';

	import ArtifactInspector from './ArtifactInspector.svelte';
	import ExpansionInspector from './ExpansionInspector.svelte';
	import Legend from './Legend.svelte';
	import RelationInspector from './RelationInspector.svelte';
	import TensionsPanel from './TensionsPanel.svelte';

	const ws = getWorkspace();

	const selection = $derived(ws.selection);
	const artifact = $derived(
		selection?.type === 'artifact' ? ws.artifactsById.get(selection.id) : undefined
	);
	const relation = $derived(
		selection?.type === 'relation' ? ws.relationsById.get(selection.id) : undefined
	);
	const counts = $derived({
		artifacts: ws.artifacts.filter((a) => a.status !== 'REJECTED').length,
		relations: ws.relations.filter((r) => r.status !== 'REJECTED').length,
		accepted: ws.expansions.filter((e) => e.status === 'ACCEPTED').length,
		open: ws.expansions.filter(isOpen).length
	});
</script>

<aside class="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white">
	<div class="flex h-9 shrink-0 items-center justify-between border-b border-zinc-100 px-3">
		<span class="section-title">{selection ? `Inspector · ${selection.type}` : 'Overview'}</span>
		{#if selection}
			<button
				class="btn btn-ghost btn-sm text-zinc-500"
				onclick={() => ws.select(null)}
				title="Clear selection (Esc)"
			>
				Clear
			</button>
		{/if}
	</div>
	<div
		class="min-h-0 flex-1 overflow-y-auto px-3 py-3"
		{@attach (el) => {
			// Re-runs whenever the selection changes: start each inspected item at the top.
			void selection?.id;
			el.scrollTop = 0;
		}}
	>
		{#if selection?.type === 'artifact'}
			{#if artifact}
				{#key `${artifact.id}:${artifact.headRevisionId}`}
					<ArtifactInspector {artifact} />
				{/key}
			{:else}
				<p class="text-zinc-500">Artifact not found in this project.</p>
			{/if}
		{:else if selection?.type === 'relation'}
			{#if relation}
				{#key `${relation.id}:${relation.updatedAt}`}
					<RelationInspector {relation} />
				{/key}
			{:else}
				<p class="text-zinc-500">Relation not found in this project.</p>
			{/if}
		{:else if selection?.type === 'expansion'}
			{#if ws.expansionsById.has(selection.id)}
				<ExpansionInspector expansionId={selection.id} />
			{:else}
				<p class="text-zinc-500">Expansion not found in this project.</p>
			{/if}
		{:else}
			<div class="flex flex-col gap-5">
				<dl class="grid grid-cols-2 gap-2">
					{#each [['Artifacts', counts.artifacts], ['Relations', counts.relations], ['Accepted bridges', counts.accepted], ['Open expansions', counts.open]] as [label, value] (label)}
						<div class="rounded-lg border border-zinc-200 px-2.5 py-1.5">
							<dt class="text-[11px] text-zinc-500">{label}</dt>
							<dd class="text-lg font-semibold text-zinc-900">{value}</dd>
						</div>
					{/each}
				</dl>
				<p class="text-xs text-zinc-500">
					Select a node, edge or outline row to inspect it. Drag from a node's right handle onto
					another node to create a relation. Esc clears the selection.
				</p>
				<TensionsPanel />
				<section>
					<h3 class="section-title mb-2">Legend</h3>
					<Legend
						layout={ws.view === 'graph'
							? ws.graphLayout
							: ws.view === 'fractal'
								? 'pyramid'
								: 'flow'}
					/>
				</section>
			</div>
		{/if}
	</div>
</aside>
