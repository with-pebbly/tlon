<script lang="ts">
	import type { PyramidFlowNode } from '$lib/graph/types';
	import { SCOPE_CORNER, SCOPE_LABEL } from '$lib/ui';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data, selected }: NodeProps<PyramidFlowNode> = $props();

	const artifact = $derived(data.artifact);
	const corner = $derived(SCOPE_CORNER[artifact.ownerScope]);
	const roleText = $derived(
		data.role === 'base'
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
		data.role === 'base' && 'border-zinc-300 bg-zinc-200',
		data.role === 'bridge' && 'border-accent-500 bg-accent-200',
		data.role === 'candidate' && 'border-dashed border-accent-500 bg-accent-50',
		data.role === 'loose' && 'border-zinc-300 bg-white',
		data.category === 'rejected' && 'opacity-50',
		data.large && data.role === 'base' && 'bg-zinc-100',
		data.large && data.role === 'bridge' && 'bg-accent-50',
		selected && 'outline-2 outline-offset-2 outline-accent-600',
		data.highlighted && 'ring-4 ring-amber-300'
	]}
	title="{artifact.title} — {roleText} · {SCOPE_LABEL[artifact.ownerScope]}"
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
	{#if data.large}
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
