<script module lang="ts">
	const NONE: ReadonlySet<string> = new Set();
</script>

<script lang="ts">
	import { formatBeatTime } from '$lib/continuity';
	import type { Transition } from '@tlon/contracts';

	let {
		transition,
		highlightEvents = NONE
	}: {
		transition: Pick<Transition, 'time' | 'events' | 'repeatableEvents' | 'entities' | 'functions'>;
		/** Event ids of the issues under review (their `event:<id>` state keys). */
		highlightEvents?: ReadonlySet<string>;
	} = $props();

	const time = $derived(formatBeatTime(transition.time));
	const events = $derived([
		...transition.events.map((id) => ({ id, repeatable: false })),
		...transition.repeatableEvents.map((id) => ({ id, repeatable: true }))
	]);
</script>

<div class="flex flex-col gap-1 text-xs">
	<div class="flex flex-wrap items-baseline gap-1.5">
		<span class="text-[11px] text-zinc-500">Time</span>
		{#if time}
			<span
				class={[
					'chip font-mono',
					transition.time?.outOfOrder
						? 'border-violet-200 bg-violet-50 text-violet-700'
						: 'border-zinc-300 bg-white text-zinc-800'
				]}
				title={transition.time?.outOfOrder
					? 'Flashback / flash-forward — excluded from chronology checks'
					: transition.time?.approx
						? 'Approximate time'
						: 'Story time of this beat'}>{time}</span
			>
			{#if transition.time?.outOfOrder}
				<span class="text-[11px] text-violet-700">flashback</span>
			{/if}
		{:else}
			<span class="text-[11px] text-zinc-400">not stated</span>
		{/if}
	</div>
	<div class="flex flex-wrap items-baseline gap-1">
		<span class="text-[11px] text-zinc-500">Events</span>
		{#each events as event (`${event.repeatable}:${event.id}`)}
			<span
				class={[
					'chip font-mono',
					highlightEvents.has(event.id)
						? 'border-rose-400 bg-rose-50 text-rose-800'
						: event.repeatable
							? 'border-dashed border-zinc-300 bg-white text-zinc-600'
							: 'border-zinc-300 bg-zinc-50 text-zinc-800'
				]}
				title={event.repeatable ? 'Repeatable event — may recur' : 'Unique event — happens once'}
				>{event.id}{event.repeatable ? ' ↻' : ''}</span
			>
		{:else}
			<span class="text-[11px] text-zinc-400">none</span>
		{/each}
	</div>
	{#if transition.entities.length > 0}
		<div class="flex flex-wrap items-baseline gap-1">
			<span class="text-[11px] text-zinc-500">Entities</span>
			{#each transition.entities as entity, i (`${i}:${entity.id}`)}
				<span
					class="chip border-zinc-300 bg-white text-zinc-800"
					title="{entity.kind} · id {entity.id} — identity is the id, not the name"
					>{entity.name}{#if entity.distinguishing}<span class="ml-1 text-zinc-500"
							>({entity.distinguishing})</span
						>{/if}<span class="ml-1 font-mono text-[10px] text-zinc-400">{entity.id}</span></span
				>
			{/each}
		</div>
	{/if}
	{#if transition.functions.length > 0}
		<div class="flex flex-wrap items-baseline gap-1">
			<span class="text-[11px] text-zinc-500">Function</span>
			{#each transition.functions as fn (fn)}
				<span class="chip border-accent-200 bg-accent-50 text-accent-700"
					>{fn.replaceAll('_', ' ')}</span
				>
			{/each}
		</div>
	{/if}
</div>
