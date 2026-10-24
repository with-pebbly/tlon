<script lang="ts">
	import { ISSUE_TONE_TITLE, toneRing } from '$lib/continuity';
	import type { PyramidFlowNode } from '$lib/graph/types';
	import { getWorkspace } from '$lib/state/context';
	import { SCOPE_CORNER, SCOPE_LABEL } from '$lib/ui';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { id, data, selected }: NodeProps<PyramidFlowNode> = $props();

	const ws = getWorkspace();

	const artifact = $derived(data.artifact);
	const corner = $derived(SCOPE_CORNER[artifact.ownerScope]);
	const roleText = $derived(
		data.composite
			? `composite · level ${data.composite.level} · ${data.composite.members} members — double-click to drill in`
			: data.role === 'base'
				? 'base line'
				: data.role === 'loose'
					? 'not placed (anchors hidden)'
					: `${data.role} · depth ${data.depth}`
	);
</script>

<!--
	Kept deliberately light: hundreds of these render at once. The title label is hidden
	by CSS (app.css) unless the cell is hovered or selected, or the canvas is zoomed in.
-->
<div
	class={[
		'tlon-cell relative h-full w-full border',
		data.large ? 'rounded-md px-2 py-1' : 'rounded-[3px]',
		data.composite && 'tlon-composite-card border-2 border-zinc-700 bg-white',
		!data.composite && data.role === 'base' && 'border-zinc-300 bg-zinc-200',
		!data.composite && data.role === 'bridge' && 'border-accent-500 bg-accent-200',
		!data.composite && data.role === 'candidate' && 'border-dashed border-accent-500 bg-accent-50',
		!data.composite && data.role === 'loose' && 'border-zinc-300 bg-white',
		(data.category === 'rejected' || data.category === 'archived') && 'opacity-50',
		!data.composite && data.large && data.role === 'base' && 'bg-zinc-100',
		!data.composite && data.large && data.role === 'bridge' && 'bg-accent-50',
		selected && 'outline-2 outline-offset-2 outline-accent-600',
		data.highlighted
			? 'ring-4 ring-amber-300'
			: toneRing(data.issue, selected, data.composite !== null)
	]}
	title="{artifact.title} — {roleText} · {SCOPE_LABEL[artifact.ownerScope]}{data.stale
		? ' · stale bridge: an anchor changed after acceptance'
		: ''}{data.issue ? ` · ${ISSUE_TONE_TITLE[data.issue]}` : ''}"
>
	<Handle id="c" type="source" position={Position.Top} isConnectable={false} class="tlon-anchor" />
	<Handle
		id="t"
		type="target"
		position={Position.Top}
		isConnectableStart={false}
		class="tlon-anchor"
	/>
	<Handle id="link" type="source" position={Position.Right} class="tlon-link-handle" />
	{#if corner}
		<span
			class={[
				'absolute top-0 right-0 [clip-path:polygon(0_0,100%_0,100%_100%)]',
				data.large ? 'size-3' : 'size-2',
				corner
			]}
		></span>
	{/if}
	{#if data.stale}
		<span
			class={[
				'absolute rounded-full bg-amber-500 ring-1 ring-white',
				data.large ? 'top-1 left-1 size-2.5' : '-top-1 -left-1 size-2'
			]}
			aria-label="Stale bridge"
		></span>
	{/if}
	{#if data.composite}
		{#if data.large}
			<div class="flex h-full flex-col gap-0.5">
				<span class="font-mono text-[10px] font-semibold text-zinc-500">◈ COMPOSITE</span>
				<span class="line-clamp-2 text-[12px] leading-[15px] font-semibold text-zinc-900"
					>{artifact.title}</span
				>
				<span class="mt-auto flex items-center gap-1.5 text-[10px] text-zinc-600">
					<span class="font-mono">L{data.composite.level}</span>
					<span>{data.composite.members} members</span>
					<button
						class="nodrag ml-auto rounded border border-zinc-300 px-1 font-medium hover:bg-zinc-100"
						onclick={(event) => {
							event.stopPropagation();
							ws.setCompositeOpen(id, true);
						}}>Open</button
					>
				</span>
			</div>
		{:else}
			<span
				class="flex h-full items-center justify-center font-mono text-[10px] leading-none font-semibold text-zinc-700"
				>◈{data.composite.level}</span
			>
			<button
				class="tlon-open-btn nodrag absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full border border-zinc-400 bg-white text-[10px] leading-none text-zinc-700 hover:bg-zinc-100"
				aria-label="Open composite"
				title="Open composite"
				onclick={(event) => {
					event.stopPropagation();
					ws.setCompositeOpen(id, true);
				}}>+</button
			>
			<span class="tlon-cell-label tlon-label-below">{artifact.title}</span>
		{/if}
	{:else if data.large}
		<div class="line-clamp-3 text-[12px] leading-[15px] font-medium text-zinc-800">
			{artifact.title}
		</div>
	{:else}
		<span
			class={['tlon-cell-label', data.role === 'base' ? 'tlon-label-below' : 'tlon-label-above']}
			>{artifact.title}</span
		>
	{/if}
</div>
