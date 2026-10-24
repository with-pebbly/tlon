<script module lang="ts">
	const NONE: ReadonlySet<string> = new Set();
</script>

<script lang="ts">
	import {
		MONOTONIC_BADGE,
		PROVENANCE_CHIP,
		PROVENANCE_LABEL,
		provenanceOf,
		stateKeyOf,
		type WorldEntry
	} from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import type { Assertion, Provenance } from '@tlon/contracts';

	let {
		items,
		path,
		highlightKeys = NONE,
		incoming = null,
		provenance = null
	}: {
		items: readonly Assertion[];
		/** Story path the beat numbers refer to. */
		path: readonly string[];
		/** State keys to emphasise (the clashing keys of issues). */
		highlightKeys?: ReadonlySet<string>;
		/** Preconditions: world state entering the beat, to show whether each one holds. */
		incoming?: ReadonlyMap<string, WorldEntry> | null;
		/** Provenance of the beat stating these assertions. */
		provenance?: Provenance | null;
	} = $props();

	const ws = getWorkspace();

	function beatRef(id: string) {
		const at = path.indexOf(id);
		return `${at < 0 ? '' : `#${at + 1} `}“${ws.title(id)}”`;
	}
</script>

<ul class="flex flex-col gap-1">
	{#each items as assertion, index (index)}
		{@const key = stateKeyOf(assertion)}
		{@const world = assertion.epistemic === 'world'}
		{@const held = incoming && world ? incoming.get(key) : undefined}
		<li
			class={[
				'flex flex-col gap-0.5 rounded border px-1.5 py-1 text-xs',
				highlightKeys.has(key) ? 'border-rose-300 bg-rose-50' : 'border-zinc-200 bg-white'
			]}
		>
			<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
				<span class="font-mono break-all text-zinc-700">{key}</span>
				<span class="text-zinc-400">=</span>
				<span class="font-mono font-semibold break-all text-zinc-900"
					>{String(assertion.value)}{#if assertion.unit}<span
							class="ml-0.5 font-normal text-zinc-500">{assertion.unit}</span
						>{/if}</span
				>
				{#if assertion.monotonic}
					{@const badge = MONOTONIC_BADGE[assertion.monotonic]}
					<span
						class="chip border-indigo-200 bg-indigo-50 font-mono text-indigo-700"
						title="One-way quantity: {badge.title}">{badge.glyph}</span
					>
				{/if}
				{#if !world}
					<span class="chip border-violet-200 bg-violet-50 text-violet-700"
						>{assertion.epistemic}{assertion.holder ? ` · ${assertion.holder}` : ''}</span
					>
				{/if}
				{#if assertion.irreversible}
					<span class="chip border-zinc-300 bg-zinc-100 text-zinc-700">irreversible</span>
				{/if}
				{#if assertion.preparation}
					<span class="chip border-sky-200 bg-sky-50 text-sky-700">preparation</span>
				{/if}
				{#if provenance}
					<span
						class={['chip ml-auto', PROVENANCE_CHIP[provenance]]}
						title="Provenance of the beat stating this">{PROVENANCE_LABEL[provenance]}</span
					>
				{/if}
			</div>
			{#if assertion.note}
				<p class="text-[11px] text-zinc-500">{assertion.note}</p>
			{/if}
			{#if incoming && world}
				{#if held === undefined}
					<p class="text-[11px] text-zinc-400">Not established by an earlier annotated beat.</p>
				{:else}
					{@const source = provenanceOf(held.artifactId, ws.acceptedBridgeIds, NONE)}
					<p
						class={[
							'flex flex-wrap items-baseline gap-x-1 text-[11px]',
							held.value === assertion.value ? 'text-emerald-700' : 'text-rose-700'
						]}
					>
						{held.value === assertion.value ? '✓ holds' : `✗ incoming ${String(held.value)}`} — set by
						<button
							class="truncate underline-offset-2 hover:underline"
							onclick={() => ws.focusArtifact(held.artifactId)}>{beatRef(held.artifactId)}</button
						>
						<span class={['chip', PROVENANCE_CHIP[source]]}>{PROVENANCE_LABEL[source]}</span>
					</p>
				{/if}
			{/if}
		</li>
	{:else}
		<li class="text-[11px] text-zinc-400">None.</li>
	{/each}
</ul>
