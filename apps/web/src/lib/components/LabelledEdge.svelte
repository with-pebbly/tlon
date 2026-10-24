<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import {
		BaseEdge,
		EdgeLabel,
		getBezierPath,
		getStraightPath,
		type EdgeProps
	} from '@xyflow/svelte';

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
		sourcePosition,
		targetPosition,
		data
	}: EdgeProps = $props();

	const ws = getWorkspace();

	/** Bezier (flow relations) unless `data.shape` is 'straight' (pyramid triangle sides). */
	const geometry = $derived.by(() => {
		const [path, labelX, labelY] =
			data?.shape === 'straight'
				? getStraightPath({ sourceX, sourceY, targetX, targetY })
				: getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
		return { path, labelX, labelY };
	});
</script>

<BaseEdge {id} path={geometry.path} {style} {markerEnd} {interactionWidth} />
{#if label}
	<!-- The built-in label only toggles Svelte Flow's own selection; this one selects in the URL. -->
	<EdgeLabel
		x={geometry.labelX}
		y={geometry.labelY}
		class="tlon-edge-label"
		onclick={() => ws.selectEdge(id)}>{label}</EdgeLabel
	>
{/if}
