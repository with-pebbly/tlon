<script lang="ts">
	import type { FrameFlowNode } from '$lib/graph/types';
	import { getWorkspace } from '$lib/state/context';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { id, data }: NodeProps<FrameFlowNode> = $props();

	const ws = getWorkspace();

	const selected = $derived(ws.selection?.type === 'artifact' && ws.selection.id === id);
	const fontSize = $derived(Math.max(10, Math.round(data.tab * 0.5)));
</script>

<!--
	Drawn behind the members. The frame body ignores the pointer (CSS: pane clicks and the
	selection box pass through); only the title tab and the handles take events.
-->
<div
	class={[
		'h-full w-full rounded-lg border-2 border-dashed',
		selected ? 'border-zinc-700 bg-zinc-500/10' : 'border-zinc-400 bg-zinc-400/5',
		data.artifact.status === 'ARCHIVED' && 'opacity-60'
	]}
>
	{#if data.connectable}
		<Handle type="target" position={Position.Left} class="tlon-frame-handle" />
		<Handle type="source" position={Position.Right} class="tlon-frame-handle" />
	{/if}
	<div
		class="tlon-frame-tab flex max-w-full items-center gap-1.5 rounded-tl-md rounded-br-md bg-zinc-700 px-1.5 text-white"
		style:height="{data.tab}px"
		style:font-size="{fontSize}px"
		title="Open composite — double-click to drill in (Fractal)"
	>
		<span class="shrink-0" aria-hidden="true">◈</span>
		<span class="min-w-0 truncate font-medium">{data.artifact.title}</span>
		<span class="shrink-0 font-mono opacity-70">L{data.level}</span>
		<button
			class="nodrag shrink-0 rounded px-1 font-medium text-zinc-200 hover:bg-zinc-600 hover:text-white"
			onclick={(event) => {
				event.stopPropagation();
				ws.setCompositeOpen(id, false);
			}}>Collapse</button
		>
	</div>
</div>
