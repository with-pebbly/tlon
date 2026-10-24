<script lang="ts">
	import { toneRing } from '$lib/continuity';
	import { COMPOSITE_HEIGHT, COMPOSITE_WIDTH } from '$lib/graph/layout';
	import type { CompositeFlowNode } from '$lib/graph/types';
	import { getWorkspace } from '$lib/state/context';
	import { STATUS_TEXT } from '$lib/ui';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	import KindBadge from './KindBadge.svelte';
	import ScopeBadge from './ScopeBadge.svelte';

	let { id, data, selected }: NodeProps<CompositeFlowNode> = $props();

	const ws = getWorkspace();

	const artifact = $derived(data.artifact);
</script>

<!-- Collapsed composite: a stacked card, visibly not an atomic artifact. -->
<div
	class={[
		'tlon-composite-card flex flex-col gap-1 overflow-hidden rounded-lg border-2 border-zinc-700 bg-white px-3 py-2',
		selected && 'outline-2 outline-offset-4 outline-accent-500',
		data.highlighted && 'ring-4 ring-amber-300',
		toneRing(data.issue, selected, true),
		data.category === 'archived' && 'opacity-60'
	]}
	style:width="{COMPOSITE_WIDTH}px"
	style:height="{COMPOSITE_HEIGHT}px"
	title="Composite — double-click to drill in (Fractal)"
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
		<span class="chip shrink-0 border-zinc-700 bg-zinc-800 font-mono text-white">◈ COMPOSITE</span>
		<KindBadge kind={artifact.kind} />
		<ScopeBadge scope={artifact.ownerScope} />
		<span class={['min-w-0 truncate font-medium', STATUS_TEXT[artifact.status]]}
			>{artifact.status}</span
		>
		<span class="ml-auto shrink-0 font-mono text-[10px] text-zinc-400">v{artifact.version}</span>
	</div>
	<div class="line-clamp-2 text-[13px] leading-[17px] font-semibold text-zinc-900">
		{artifact.title}
	</div>
	<div class="mt-auto flex items-center gap-2 text-[11px] text-zinc-600">
		<span class="font-mono" title="Nesting level (max depth of nested composites)"
			>L{data.badge.level}</span
		>
		<span>{data.badge.members} member{data.badge.members === 1 ? '' : 's'}</span>
		<button
			class="nodrag btn btn-sm ml-auto"
			onclick={(event) => {
				event.stopPropagation();
				ws.setCompositeOpen(id, true);
			}}>Open</button
		>
	</div>
	<Handle type="source" position={Position.Right} />
</div>
