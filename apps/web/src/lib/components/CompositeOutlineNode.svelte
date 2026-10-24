<script lang="ts">
	import { getWorkspace } from '$lib/state/context';

	import CompositeOutlineNode from './CompositeOutlineNode.svelte';

	/** `ancestors` guards the recursion (membership is a DAG, a bad payload must stay finite). */
	let { compositeId, ancestors = [] }: { compositeId: string; ancestors?: readonly string[] } =
		$props();

	const ws = getWorkspace();

	let open = $state(false);

	const summary = $derived(ws.compositesById.get(compositeId));
	const members = $derived(
		(summary?.memberArtifactIds ?? []).filter((id) => {
			const artifact = ws.artifactsById.get(id);
			return artifact !== undefined && (artifact.status !== 'ARCHIVED' || ws.filters.showArchived);
		})
	);
	const path = $derived([...ancestors, compositeId]);
	const selected = $derived(ws.selection?.type === 'artifact' && ws.selection.id === compositeId);
	const archived = $derived(ws.artifactsById.get(compositeId)?.status === 'ARCHIVED');
</script>

<li>
	<div
		class={[
			'flex items-center gap-1 rounded px-1 py-0.5',
			selected ? 'bg-accent-50' : 'hover:bg-zinc-100'
		]}
	>
		<button
			class="w-4 shrink-0 text-[10px] text-zinc-400 hover:text-zinc-700"
			aria-label={open ? 'Collapse members' : 'Expand members'}
			aria-expanded={open}
			onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button
		>
		<button
			class={['flex min-w-0 flex-1 items-center gap-1 text-left text-xs', archived && 'opacity-60']}
			title="{ws.title(compositeId)} — composite, level {ws.compositeLevels.get(compositeId) ?? 1}"
			onclick={() => ws.focusArtifact(compositeId)}
			ondblclick={() => ws.enterComposite(compositeId)}
		>
			<span class="shrink-0 font-mono text-zinc-500">◈</span>
			<span class="truncate font-medium text-zinc-800">{ws.title(compositeId)}</span>
			<span class="ml-auto shrink-0 text-[10px] text-zinc-400">{members.length}</span>
		</button>
	</div>
	{#if open}
		<ul class="ml-3 border-l border-zinc-200 pl-1">
			{#each members as id (id)}
				{#if ws.compositesById.has(id) && !path.includes(id)}
					<CompositeOutlineNode compositeId={id} ancestors={path} />
				{:else}
					<li>
						<button
							class={[
								'ml-5 block max-w-[calc(100%-1.25rem)] truncate rounded px-1 text-left text-[11px] text-zinc-700 hover:bg-zinc-100',
								ws.selection?.id === id && 'bg-accent-50 text-accent-700'
							]}
							onclick={() => ws.focusArtifact(id)}>{ws.title(id)}</button
						>
					</li>
				{/if}
			{:else}
				<li class="ml-5 text-[11px] text-zinc-400">No visible members.</li>
			{/each}
		</ul>
	{/if}
</li>
