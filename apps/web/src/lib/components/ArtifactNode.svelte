<script lang="ts">
	import { NODE_HEIGHT, NODE_WIDTH } from '$lib/graph/layout';
	import type { ArtifactFlowNode } from '$lib/graph/types';
	import { CATEGORY_CARD, CATEGORY_LABEL, STATUS_TEXT } from '$lib/ui';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	import Icon from './Icon.svelte';
	import KindBadge from './KindBadge.svelte';

	let { data, selected }: NodeProps<ArtifactFlowNode> = $props();

	const artifact = $derived(data.artifact);
</script>

<div
	class={[
		'flex flex-col gap-1 overflow-hidden rounded-lg border px-2.5 py-2 shadow-xs transition-shadow',
		CATEGORY_CARD[data.category],
		selected && 'shadow-md outline-2 outline-offset-2 outline-accent-500',
		data.highlighted && 'ring-4 ring-amber-300'
	]}
	style:width="{NODE_WIDTH}px"
	style:height="{NODE_HEIGHT}px"
	title={CATEGORY_LABEL[data.category]}
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-center gap-1.5 text-[11px]">
		<KindBadge kind={artifact.kind} />
		<span class={['font-medium', STATUS_TEXT[artifact.status]]}>{artifact.status}</span>
		{#if data.category === 'candidate'}
			<span class="text-accent-600">candidate</span>
		{:else if data.bridgeDepth !== null}
			<span class="text-accent-600" title="Accepted bridge at expansion depth {data.bridgeDepth}"
				>◆ d{data.bridgeDepth}</span
			>
		{/if}
		<span class="ml-auto flex items-center gap-1 text-zinc-400">
			{#if artifact.pinned}<Icon name="pin" label="Pinned" />{/if}
			{#if artifact.locked}<Icon name="lock" label="Locked" />{/if}
			<span class="font-mono text-[10px]">v{artifact.version}</span>
		</span>
	</div>
	<div class="line-clamp-2 text-[13px] leading-[17px] font-medium text-zinc-900">
		{artifact.title}
	</div>
	<Handle type="source" position={Position.Right} />
</div>
