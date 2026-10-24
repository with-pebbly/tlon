<script lang="ts">
	import { BaseEdge, type EdgeProps } from '@xyflow/svelte';

	let {
		id,
		label,
		style,
		markerEnd,
		interactionWidth,
		sourceX,
		sourceY,
		targetX,
		targetY
	}: EdgeProps = $props();

	/**
	 * Root relations of the pyramid run along (or between) cells of the base line; drawing
	 * them as a shallow curve dipping below the line keeps them apart from triangle sides.
	 */
	const geometry = $derived.by(() => {
		const midX = (sourceX + targetX) / 2;
		const dip = Math.min(140, 12 + Math.hypot(targetX - sourceX, targetY - sourceY) * 0.18);
		const controlY = Math.max(sourceY, targetY) + dip;
		return {
			path: `M${sourceX},${sourceY} Q${midX},${controlY} ${targetX},${targetY}`,
			labelX: midX,
			// The quadratic curve's lowest point sits halfway between the line and the control point.
			labelY: (Math.max(sourceY, targetY) + controlY) / 2
		};
	});
</script>

<BaseEdge
	{id}
	path={geometry.path}
	labelX={geometry.labelX}
	labelY={geometry.labelY}
	{label}
	{style}
	{markerEnd}
	{interactionWidth}
/>
