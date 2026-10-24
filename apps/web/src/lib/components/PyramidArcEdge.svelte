<script lang="ts">
	import { arcGeometry, naturalDip } from '$lib/graph/arc';
	import { getWorkspace } from '$lib/state/context';
	import { BaseEdge, EdgeLabel, type EdgeProps } from '@xyflow/svelte';

	let {
		id,
		label,
		style,
		markerEnd,
		interactionWidth,
		sourceX,
		sourceY,
		targetX,
		targetY,
		data
	}: EdgeProps = $props();

	const ws = getWorkspace();

	/**
	 * A shallow curve under the base line. `data.dip` (set by the canvas so labels of
	 * neighbouring aggregated edges never overlap) wins over the natural dip.
	 */
	const geometry = $derived(
		arcGeometry(
			sourceX,
			sourceY,
			targetX,
			targetY,
			typeof data?.dip === 'number'
				? data.dip
				: naturalDip(
						sourceX,
						sourceY,
						targetX,
						targetY,
						typeof data?.minDip === 'number' ? data.minDip : 0
					)
		)
	);
</script>

<BaseEdge {id} path={geometry.path} {style} {markerEnd} {interactionWidth} />
{#if label}
	<!-- The label selects its edge like a click on the line (URL-backed selection). -->
	<EdgeLabel
		x={geometry.labelX}
		y={geometry.labelY}
		class={['tlon-edge-label', data?.aggregated === true && 'italic']}
		onclick={() => ws.selectEdge(id)}>{label}</EdgeLabel
	>
{/if}
