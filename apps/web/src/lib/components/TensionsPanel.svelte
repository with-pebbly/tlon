<script lang="ts">
	import { getWorkspace } from '$lib/state/context';

	const ws = getWorkspace();

	const DIMENSION_LABEL: Record<string, string> = {
		worldTime: 'world time',
		perspective: 'perspective',
		speaker: 'speaker',
		location: 'location',
		epistemicStatus: 'epistemic status'
	};
</script>

<section class="flex flex-col gap-2">
	<div class="flex items-baseline justify-between">
		<h3 class="section-title">Tensions</h3>
		<span class="text-[11px] text-zinc-400">creative prompts, not errors</span>
	</div>
	{#if ws.tensions.length === 0}
		<p class="text-xs text-zinc-400">No contradictions detected.</p>
	{/if}
	{#each ws.tensions as tension (`${tension.kind}:${tension.artifactIds.join('|')}`)}
		{@const [a, b] = tension.artifactIds}
		{@const resolvedBy = tension.resolvedByExpansionId}
		<article
			class={[
				'flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs',
				resolvedBy ? 'border-zinc-200 bg-white' : 'border-amber-200 bg-amber-50/50'
			]}
		>
			<div class="flex items-center gap-2">
				<span class="font-medium text-amber-800">
					{tension.kind === 'EXPLICIT_CONTRADICTION' ? 'Marked contradiction' : 'Conflicting facts'}
				</span>
				<span class={['ml-auto', resolvedBy ? 'text-emerald-700' : 'text-zinc-500']}>
					{resolvedBy ? 'bridged' : 'open'}
				</span>
			</div>
			<div class="flex flex-col gap-0.5">
				<button
					class="truncate text-left text-zinc-800 hover:underline"
					onclick={() => ws.focusArtifact(a)}>{ws.title(a)}</button
				>
				<span class="text-zinc-400">vs</span>
				<button
					class="truncate text-left text-zinc-800 hover:underline"
					onclick={() => ws.focusArtifact(b)}>{ws.title(b)}</button
				>
			</div>
			{#if tension.distinguishingDimensions.length > 0}
				<div class="flex flex-wrap items-center gap-1">
					<span class="text-zinc-500">Could differ by</span>
					{#each tension.distinguishingDimensions as dimension (dimension)}
						<span class="chip border-zinc-200 bg-white text-zinc-600"
							>{DIMENSION_LABEL[dimension] ?? dimension}</span
						>
					{/each}
				</div>
			{:else}
				<p class="text-zinc-500">
					Same time, place and source — a bridge needs a stronger mechanism.
				</p>
			{/if}
			<div class="flex gap-1.5">
				{#if resolvedBy}
					<button
						class="btn btn-sm"
						onclick={() => ws.select({ type: 'expansion', id: resolvedBy })}>View bridge</button
					>
				{:else if tension.relationId}
					{@const relationId = tension.relationId}
					<button class="btn btn-sm" onclick={() => ws.select({ type: 'relation', id: relationId })}
						>Open relation</button
					>
				{/if}
			</div>
		</article>
	{/each}
</section>
