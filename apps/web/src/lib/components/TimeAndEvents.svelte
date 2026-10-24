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
		transition: Pick<Transition, 'time' | 'events' | 'repeatableEvents'>;
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
</div>
