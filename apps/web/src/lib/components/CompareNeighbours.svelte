<script module lang="ts">
	const NONE: ReadonlySet<string> = new Set();
	const EXCERPT = 420;
</script>

<script lang="ts">
	import {
		PROVENANCE_CHIP,
		PROVENANCE_LABEL,
		provenanceOf,
		replayBefore,
		stateKeyOf
	} from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import type { Transition } from '@tlon/contracts';

	import AssertionList from './AssertionList.svelte';
	import Modal from './Modal.svelte';

	let {
		artifactId,
		stateKey,
		onclose
	}: { artifactId: string; stateKey: string | null; onclose: () => void } = $props();

	const ws = getWorkspace();

	// svelte-ignore state_referenced_locally
	let focusKey = $state(stateKey);

	const through = $derived(ws.pathThrough(artifactId));
	const transitionOf = (id: string) => ws.transitionsByArtifact.get(id)?.transition;

	/** previous → current → next on the story path, plus the bridge's right anchor. */
	const columns = $derived.by(() => {
		if (!through) return [];
		const { path } = through;
		const at = path.indexOf(artifactId);
		const out: { id: string; role: string }[] = [];
		const previous = path[at - 1];
		const next = path[at + 1];
		if (previous !== undefined) out.push({ id: previous, role: 'Previous beat' });
		out.push({ id: artifactId, role: 'This beat' });
		if (next !== undefined) out.push({ id: next, role: 'Next beat' });
		const expansion = ws.bridgeExpansionOf(artifactId);
		if (expansion && !out.some((c) => c.id === expansion.rightArtifactId)) {
			out.push({ id: expansion.rightArtifactId, role: 'Right anchor of this bridge' });
		}
		return out;
	});

	/** Every state key the shown beats state, for switching the highlighted key. */
	const keys = $derived(
		[
			...new Set(
				columns.flatMap(({ id }) => {
					const t = transitionOf(id);
					return t
						? [...t.preconditions, ...t.effects, ...t.assumptions].map((a) => stateKeyOf(a))
						: [];
				})
			)
		].toSorted()
	);
	const focusKeys = $derived(focusKey ? new Set([focusKey]) : NONE);

	function view(id: string) {
		const path = through?.path ?? [];
		const at = path.indexOf(id);
		const t: Transition | undefined = transitionOf(id);
		const artifact = ws.artifactsById.get(id);
		const before = at < 0 ? null : replayBefore(path, at, transitionOf).world;
		const after = at < 0 ? null : replayBefore(path, at + 1, transitionOf).world;
		const body = artifact?.body.trim() ?? '';
		return {
			beat: at < 0 ? null : at + 1,
			artifact,
			transition: t,
			provenance: provenanceOf(
				id,
				ws.acceptedBridgeIds,
				through?.hypothetical && id === artifactId ? new Set([id]) : NONE
			),
			excerpt: body.length > EXCERPT ? `${body.slice(0, EXCERPT).trimEnd()}…` : body,
			keyIn: focusKey && before ? before.get(focusKey) : undefined,
			keyOut: focusKey && after ? after.get(focusKey) : undefined
		};
	}
</script>

<Modal title="Compare neighbours" width="w-[min(1280px,calc(100vw-2rem))]" {onclose}>
	{#if !through}
		<p class="text-zinc-500">
			“{ws.title(artifactId)}” is not on the story path, so it has no neighbours to compare.
		</p>
	{:else}
		<div class="flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<span class="text-zinc-500">Highlighted state key</span>
				{#each keys as key (key)}
					<button
						class={[
							'chip font-mono',
							key === focusKey
								? 'border-rose-400 bg-rose-50 text-rose-800'
								: 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
						]}
						aria-pressed={key === focusKey}
						onclick={() => (focusKey = key === focusKey ? null : key)}>{key}</button
					>
				{:else}
					<span class="text-zinc-400">none — these beats have no state annotations</span>
				{/each}
				{#if through.hypothetical}
					<span class="ml-auto text-[11px] text-zinc-500"
						>Path as if this candidate were accepted</span
					>
				{/if}
			</div>
			<div
				class="grid max-h-[70vh] gap-3 overflow-y-auto"
				style:grid-template-columns="repeat({columns.length}, minmax(0, 1fr))"
			>
				{#each columns as column (column.id)}
					{@const v = view(column.id)}
					<article
						class={[
							'flex min-w-0 flex-col gap-2 rounded-lg border p-3',
							column.id === artifactId ? 'border-accent-500 bg-accent-50/30' : 'border-zinc-200'
						]}
						aria-label={column.role}
					>
						<div class="flex items-center gap-1.5 text-[11px] text-zinc-500">
							<span class="font-semibold tracking-wide uppercase">{column.role}</span>
							{#if v.beat !== null}<span class="font-mono">#{v.beat}</span>{/if}
							<span class={['chip ml-auto', PROVENANCE_CHIP[v.provenance]]}
								>{PROVENANCE_LABEL[v.provenance]}</span
							>
						</div>
						<button
							class="text-left text-[14px] leading-snug font-semibold text-zinc-900 hover:underline"
							title="Select this beat"
							onclick={() => {
								ws.focusArtifact(column.id);
								onclose();
							}}>{v.artifact?.title ?? column.id}</button
						>
						<p class="text-xs whitespace-pre-line text-zinc-700">{v.excerpt || '(no text)'}</p>
						{#if focusKey}
							<div
								class="flex flex-wrap items-baseline gap-x-1.5 rounded-md border border-rose-200 bg-rose-50/60 px-2 py-1 text-xs"
							>
								<span class="font-mono text-zinc-700">{focusKey}</span>
								<span class="text-zinc-500">in</span>
								<span class="font-mono font-semibold"
									>{v.keyIn === undefined ? '—' : String(v.keyIn.value)}</span
								>
								<span class="text-zinc-400">→ out</span>
								<span class="font-mono font-semibold"
									>{v.keyOut === undefined ? '—' : String(v.keyOut.value)}</span
								>
							</div>
						{/if}
						{#if v.transition}
							{#each [['Preconditions', v.transition.preconditions], ['Effects', v.transition.effects], ['Assumptions', v.transition.assumptions]] as const as [label, items] (label)}
								<div class="flex flex-col gap-1">
									<div class="section-title">{label}</div>
									<AssertionList {items} path={through.path} highlightKeys={focusKeys} />
								</div>
							{/each}
						{:else}
							<p class="text-xs text-zinc-400">No state annotation.</p>
						{/if}
						<button
							class="btn btn-sm mt-auto self-start"
							onclick={() => {
								ws.inspectState(column.id);
								onclose();
							}}>Open State tab</button
						>
					</article>
				{/each}
			</div>
		</div>
	{/if}
</Modal>
