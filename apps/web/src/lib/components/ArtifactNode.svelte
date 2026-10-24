<script lang="ts">
	import { toneRing } from '$lib/continuity';
	import { NODE_HEIGHT, NODE_WIDTH } from '$lib/graph/layout';
	import type { ArtifactFlowNode } from '$lib/graph/types';
	import { FACT_KIND_ICON } from '$lib/protocol';
	import { CATEGORY_CARD, CATEGORY_LABEL, STATUS_TEXT } from '$lib/ui';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	import Icon from './Icon.svelte';
	import KindBadge from './KindBadge.svelte';
	import ScopeBadge from './ScopeBadge.svelte';

	let { data, selected }: NodeProps<ArtifactFlowNode> = $props();

	const artifact = $derived(data.artifact);
	const isFact = $derived(artifact.artifactClass === 'FACT');
</script>

{#if isFact}
	<!-- A Fact is a small connector, not a scene: drawn as a yellow chip with its kind. -->
	<div
		class={[
			'flex flex-col justify-center gap-0.5 overflow-hidden rounded-full border-2 px-3 shadow-xs',
			artifact.status === 'ACCEPTED'
				? 'border-amber-500 bg-amber-100'
				: 'border-dashed border-amber-500 bg-amber-50',
			artifact.status === 'REJECTED' && 'opacity-50',
			selected && 'shadow-md outline-2 outline-offset-2 outline-accent-500',
			data.highlighted ? 'ring-4 ring-amber-300' : toneRing(data.issue, selected)
		]}
		style:width="{NODE_WIDTH}px"
		style:height="{NODE_HEIGHT * 0.75}px"
		title="Fact · {artifact.factKind ?? 'unknown kind'} · {artifact.status.toLowerCase()}"
		data-artifact-class="FACT"
	>
		<Handle type="target" position={Position.Left} />
		<div class="flex items-center gap-1.5 text-[10px] text-amber-900">
			<span aria-hidden="true">{artifact.factKind ? FACT_KIND_ICON[artifact.factKind] : '◆'}</span>
			<span class="font-semibold tracking-wide uppercase">Fact · {artifact.factKind ?? '—'}</span>
			{#if data.stage !== null}
				<span class="ml-auto font-mono" data-testid="stage-badge">stage {data.stage}</span>
			{/if}
		</div>
		<div class="line-clamp-2 text-[12px] leading-[15px] font-medium text-zinc-900">
			{artifact.title}
		</div>
		<Handle type="source" position={Position.Right} />
	</div>
{:else}
	<div
		class={[
			'flex flex-col gap-1 overflow-hidden rounded-lg border px-2.5 py-2 shadow-xs transition-shadow',
			CATEGORY_CARD[data.category],
			selected && 'shadow-md outline-2 outline-offset-2 outline-accent-500',
			data.highlighted ? 'ring-4 ring-amber-300' : toneRing(data.issue, selected)
		]}
		style:width="{NODE_WIDTH}px"
		style:height="{NODE_HEIGHT}px"
		title={CATEGORY_LABEL[data.category]}
	>
		<Handle type="target" position={Position.Left} />
		<div class="flex items-center gap-1.5 text-[11px]">
			<KindBadge kind={artifact.kind} />
			<ScopeBadge scope={artifact.ownerScope} />
			<span class={['font-medium', STATUS_TEXT[artifact.status]]}>{artifact.status}</span>
			{#if data.stage !== null}
				<span
					class="chip border-zinc-300 bg-white font-mono text-zinc-700"
					title="Block–Fact stage {data.stage}"
					data-testid="stage-badge">S{data.stage}</span
				>
			{/if}
			{#if data.category === 'candidate'}
				<span class="text-accent-600">candidate</span>
			{:else if data.bridgeDepth !== null}
				<span class="text-accent-600" title="Accepted bridge at expansion depth {data.bridgeDepth}"
					>◆ d{data.bridgeDepth}</span
				>
			{/if}
			{#if data.stale}
				<span
					class="chip border-amber-300 bg-amber-50 text-amber-800"
					title="Stale bridge: an anchor changed after acceptance">stale</span
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
{/if}
