<script lang="ts">
	import { ISSUE_TONE_TITLE, toneRing, type IssueTone } from '$lib/continuity';
	import type { GraphLayout } from '$lib/graph/positions';
	import { CATEGORY_CARD, CATEGORY_LABEL, SCOPE_DESCRIPTION, type ArtifactCategory } from '$lib/ui';
	import { OWNER_SCOPES } from '@tlon/contracts';

	import ScopeBadge from './ScopeBadge.svelte';

	let { layout }: { layout: GraphLayout } = $props();

	/** Continuity overlay (Issues panel): node mark and edge stroke per issue tone. */
	const OVERLAY: readonly { tone: IssueTone; stroke: string; dash: string; detail: string }[] = [
		{
			tone: 'blocker',
			stroke: 'var(--color-rose-500)',
			dash: '',
			detail: 'continuity or anchor violation on the story path'
		},
		{
			tone: 'warning',
			stroke: 'var(--color-amber-500)',
			dash: '',
			detail: 'abandoned preparation or stale annotation'
		},
		{
			tone: 'creative',
			stroke: 'var(--color-amber-500)',
			dash: '4 3',
			detail: 'never an error — a prompt for a bridge'
		}
	];

	const CATEGORIES: ArtifactCategory[] = [
		'fact',
		'explanation',
		'candidate',
		'bridge',
		'rejected',
		'archived'
	];

	const CELLS = [
		{
			label: 'Base line — authored artifacts, ordered by their relations',
			class: 'border-zinc-300 bg-zinc-200'
		},
		{
			label: 'Bridge — accepted, above the midpoint of its two anchors',
			class: 'border-accent-500 bg-accent-200'
		},
		{
			label: 'Candidate — proposed, not yet accepted',
			class: 'border-dashed border-accent-500 bg-accent-50'
		},
		{
			label: 'Collapsed composite — ◈ nesting level; “+” opens it, double-click drills in',
			class: 'border-2 border-zinc-700 bg-white'
		},
		{
			label: 'Open composite — dashed frame around its members (tab: Collapse)',
			class: 'border-dashed border-zinc-400 bg-transparent'
		},
		{
			label: 'Stale bridge — an anchor changed after acceptance',
			class: 'rounded-full border-amber-500 bg-amber-400'
		}
	];

	const FLOW_EDGES = [
		{ label: 'Relation (type label, arrow = direction)', dash: '', color: 'var(--color-zinc-400)' },
		{ label: 'Proposed relation', dash: '5 3', color: 'var(--color-zinc-400)' },
		{ label: 'Collapsed parent edge (expanded)', dash: '6 4', color: 'var(--color-zinc-400)' },
		{ label: 'Candidate preview (to its anchors)', dash: '2 4', color: 'var(--color-accent-500)' },
		{ label: 'contradicts — a creative tension', dash: '', color: 'var(--color-amber-500)' },
		{
			label: 'aggregated (n) — virtual edge for relations inside a collapsed composite',
			dash: '8 5',
			color: 'var(--color-zinc-500)'
		}
	];
</script>

<div class="flex flex-col gap-2 text-xs text-zinc-600">
	{#if layout === 'pyramid'}
		<ul class="flex flex-col gap-1">
			{#each CELLS as cell (cell.label)}
				<li class="flex items-center gap-2">
					<span class={['inline-block size-3 shrink-0 rounded-[3px] border', cell.class]}></span>
					<span class="text-[11px] leading-4">{cell.label}</span>
				</li>
			{/each}
		</ul>
		<div class="flex items-center gap-2">
			<svg width="28" height="18" class="shrink-0" aria-hidden="true">
				<path d="M3 15 L14 4 L25 15" fill="none" stroke="var(--color-zinc-400)" stroke-width="1" />
				<rect x="11" y="1" width="6" height="6" rx="1" fill="var(--color-accent-200)" />
				<rect x="0" y="12" width="6" height="6" rx="1" fill="#d4d4d8" />
				<rect x="22" y="12" width="6" height="6" rx="1" fill="#d4d4d8" />
			</svg>
			<span class="text-[11px] leading-4"
				>Triangle — one expansion: bridge apex over its anchors; expanding a side nests a smaller
				triangle (dashed while open)</span
			>
		</div>
		<div class="flex items-center gap-2">
			<svg width="28" height="12" class="shrink-0" aria-hidden="true">
				<path d="M2 2 Q14 14 26 2" fill="none" stroke="var(--color-zinc-400)" stroke-width="1" />
			</svg>
			<span class="text-[11px] leading-4">Base link — a root relation (amber: contradicts)</span>
		</div>
		<div class="flex items-center gap-2">
			<svg width="28" height="12" class="shrink-0" aria-hidden="true">
				<path
					d="M2 2 Q14 14 26 2"
					fill="none"
					stroke="var(--color-zinc-500)"
					stroke-width="1.5"
					stroke-dasharray="4 3"
				/>
			</svg>
			<span class="text-[11px] leading-4"
				>aggregated (n) — virtual edge for relations inside a collapsed composite; click to list
				them</span
			>
		</div>
		<p class="text-[11px] text-zinc-400">
			Hover or select a cell for its title; zoom in to label every cell. Corner colour marks the
			owner scope:
		</p>
	{:else}
		<ul class="flex flex-col gap-1">
			{#each CATEGORIES as category (category)}
				<li class="flex items-center gap-2">
					<span class={['inline-block h-3.5 w-6 rounded border', CATEGORY_CARD[category]]}></span>
					{CATEGORY_LABEL[category]}
				</li>
			{/each}
		</ul>
	{/if}
	<ul class="flex flex-col gap-1.5" aria-label="Continuity overlay">
		{#each OVERLAY as entry (entry.tone)}
			<li class="flex items-center gap-2">
				<span
					class={[
						'inline-block size-3 shrink-0 rounded-[3px] border border-zinc-300 bg-white',
						toneRing(entry.tone, false)
					]}
				></span>
				<svg width="18" height="8" class="shrink-0" aria-hidden="true">
					<line
						x1="0"
						y1="4"
						x2="18"
						y2="4"
						stroke={entry.stroke}
						stroke-width="2"
						stroke-dasharray={entry.dash}
					/>
				</svg>
				<span class="text-[11px] leading-4"
					><span class="font-medium">{ISSUE_TONE_TITLE[entry.tone]}</span> — {entry.detail}</span
				>
			</li>
		{/each}
	</ul>
	<ul class="flex flex-col gap-1" aria-label="Owner scopes">
		{#each OWNER_SCOPES as scope (scope)}
			<li class="flex items-start gap-2">
				<span class="w-12 shrink-0"><ScopeBadge {scope} /></span>
				<span class="text-[11px] leading-[18px]">{SCOPE_DESCRIPTION[scope]}</span>
			</li>
		{/each}
	</ul>
	{#if layout === 'flow'}
		<ul class="flex flex-col gap-1">
			{#each FLOW_EDGES as edge (edge.label)}
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
		<p class="text-[11px] text-zinc-400">
			Badge ◆ dN marks an accepted bridge at expansion depth N.
		</p>
	{/if}
</div>
