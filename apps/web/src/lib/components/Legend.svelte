<script lang="ts">
	import { CATEGORY_CARD, CATEGORY_LABEL, type ArtifactCategory } from '$lib/ui';

	const CATEGORIES: ArtifactCategory[] = ['fact', 'explanation', 'candidate', 'bridge', 'rejected'];

	const EDGES = [
		{ label: 'Relation (type label, arrow = direction)', dash: '', color: 'var(--color-zinc-400)' },
		{ label: 'Proposed relation', dash: '5 3', color: 'var(--color-zinc-400)' },
		{ label: 'Collapsed parent edge (expanded)', dash: '6 4', color: 'var(--color-zinc-400)' },
		{ label: 'Candidate preview (to its anchors)', dash: '2 4', color: 'var(--color-accent-500)' },
		{ label: 'contradicts — a creative tension', dash: '', color: 'var(--color-amber-500)' }
	];
</script>

<div class="flex flex-col gap-2 text-xs text-zinc-600">
	<ul class="flex flex-col gap-1">
		{#each CATEGORIES as category (category)}
			<li class="flex items-center gap-2">
				<span class={['inline-block h-3.5 w-6 rounded border', CATEGORY_CARD[category]]}></span>
				{CATEGORY_LABEL[category]}
			</li>
		{/each}
	</ul>
	<ul class="flex flex-col gap-1">
		{#each EDGES as edge (edge.label)}
			<li class="flex items-center gap-2">
				<svg width="24" height="8" aria-hidden="true">
					<line
						x1="0"
						y1="4"
						x2="18"
						y2="4"
						stroke={edge.color}
						stroke-width="2"
						stroke-dasharray={edge.dash}
						stroke-linecap="round"
					/>
					<path d="M18 1 L24 4 L18 7 Z" fill={edge.color} />
				</svg>
				{edge.label}
			</li>
		{/each}
	</ul>
	<p class="text-[11px] text-zinc-400">Badge ◆ dN marks an accepted bridge at expansion depth N.</p>
</div>
