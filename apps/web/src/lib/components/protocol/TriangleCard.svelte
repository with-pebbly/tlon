<script lang="ts">
	import { FACT_KIND_ICON, TASK_TYPE_SHORT, TRIANGLE_STATUS_CLASS } from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import type { Triangle } from '@tlon/contracts';

	let { triangle }: { triangle: Triangle } = $props();

	const ws = getWorkspace();

	let busy = $state<string | null>(null);
	let composing = $state(false);
	let composeTitle = $state('');

	const detail = $derived(ws.triangleDetails.get(triangle.id));
	const candidates = $derived(detail?.candidates ?? []);
	const tasks = $derived(detail?.tasks ?? ws.tasks.filter((t) => t.triangleId === triangle.id));
	const factArtifact = $derived(
		triangle.fact ? ws.artifactsById.get(triangle.fact.artifactId) : undefined
	);
	/** Latest continuation per side: the ends of a child gap. */
	const lastLeft = $derived(triangle.continuations.findLast((c) => c.side === 'left'));
	const lastRight = $derived(triangle.continuations.findLast((c) => c.side === 'right'));
	const childGapOpen = $derived(
		ws.triangles.some(
			(t) =>
				t.parentTriangleId === triangle.id &&
				t.left.artifactId === lastLeft?.block.artifactId &&
				t.right.artifactId === lastRight?.block.artifactId
		)
	);
	const canAccept = $derived(triangle.status === 'proposed');

	async function run(label: string, action: () => Promise<unknown>) {
		busy = label;
		try {
			await action();
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = null;
		}
	}

	function openChildGap() {
		if (!lastLeft || !lastRight) return;
		void run('child', () =>
			ws.connect({
				left: { artifactId: lastLeft.block.artifactId },
				right: { artifactId: lastRight.block.artifactId },
				parentTriangleId: triangle.id,
				...(triangle.runId ? { runId: triangle.runId } : {})
			})
		);
	}

	function compose(event: SubmitEvent) {
		event.preventDefault();
		const title = composeTitle.trim();
		if (title === '') return;
		void run('compose', async () => {
			const view = await ws.composeTriangle(triangle.id, { title });
			composing = false;
			toasts.push('info', `Composite “${view.artifact.title}” created.`);
		});
	}

	function startCompose() {
		composeTitle = `${ws.title(triangle.left.artifactId)} ⟷ ${ws.title(triangle.right.artifactId)}`;
		composing = true;
	}
</script>

<article
	class="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3"
	aria-label="Triangle {triangle.id.slice(0, 8)}"
	data-testid="triangle-card"
	data-status={triangle.status}
>
	<header class="flex flex-wrap items-center gap-2 text-[11px]">
		<span class={['chip', TRIANGLE_STATUS_CLASS[triangle.status]]}>{triangle.status}</span>
		<span class="chip border-zinc-300 bg-zinc-50 font-mono text-zinc-700"
			>stage {triangle.stageIndex}</span
		>
		<span class="chip border-zinc-300 bg-zinc-50 font-mono text-zinc-700"
			>depth {triangle.depth}</span
		>
		{#if triangle.advance}
			<span class="text-zinc-500" title="How each side continues its anchor"
				>left {triangle.advance.left} · right {triangle.advance.right}</span
			>
		{/if}
		{#if triangle.parentTriangleId}
			<button
				class="text-accent-600 hover:underline"
				onclick={() => ws.select({ type: 'triangle', id: triangle.parentTriangleId as string })}
				>child of {triangle.parentTriangleId.slice(0, 8)}</button
			>
		{/if}
		<button
			class="ml-auto text-accent-600 hover:underline"
			onclick={() => ws.select({ type: 'triangle', id: triangle.id })}>Show in graph</button
		>
	</header>

	<div class="grid grid-cols-[1fr_auto_1fr] items-start gap-2 text-[13px]">
		<button
			class="rounded border border-sky-200 bg-sky-50/60 px-2 py-1 text-left hover:border-sky-400"
			onclick={() => ws.focusArtifact(triangle.left.artifactId)}
		>
			<span class="block text-[10px] font-semibold text-sky-800 uppercase">Left anchor</span>
			{ws.title(triangle.left.artifactId)}
			{#if triangle.left.factAnchorId}<span class="text-[10px] text-zinc-500">
					(via Fact)</span
				>{/if}
		</button>
		<div class="min-w-28 max-w-56 text-center">
			{#if triangle.fact}
				<button
					class="w-full rounded-full border border-amber-400 bg-amber-100 px-2 py-1 text-[12px] font-medium text-zinc-900 hover:border-amber-600"
					onclick={() => ws.focusArtifact(triangle.fact?.artifactId ?? '')}
					data-testid="triangle-fact"
				>
					{#if factArtifact?.factKind}<span aria-hidden="true"
							>{FACT_KIND_ICON[factArtifact.factKind]}</span
						>{/if}
					{factArtifact?.title ?? triangle.fact.artifactId.slice(0, 8)}
				</button>
			{:else}
				<span
					class="block rounded-full border border-dashed border-amber-400 px-2 py-1 text-zinc-500"
					>no Fact yet</span
				>
			{/if}
		</div>
		<button
			class="rounded border border-fuchsia-200 bg-fuchsia-50/60 px-2 py-1 text-left hover:border-fuchsia-400"
			onclick={() => ws.focusArtifact(triangle.right.artifactId)}
		>
			<span class="block text-[10px] font-semibold text-fuchsia-800 uppercase">Right anchor</span>
			{ws.title(triangle.right.artifactId)}
			{#if triangle.right.factAnchorId}<span class="text-[10px] text-zinc-500">
					(via Fact)</span
				>{/if}
		</button>
	</div>

	{#if candidates.length > 0}
		<section aria-label="Fact candidates">
			<h4 class="section-title mb-1">Candidates</h4>
			<ul class="flex flex-col gap-1.5">
				{#each candidates as c (c.id)}
					<li
						class={[
							'flex flex-col gap-1 rounded border px-2 py-1.5 text-[13px]',
							c.status === 'accepted' && 'border-emerald-300 bg-emerald-50/60',
							c.status === 'rejected' && 'border-zinc-200 opacity-60',
							c.status === 'proposed' && 'border-amber-200'
						]}
						data-testid="fact-candidate-row"
					>
						<div class="flex items-start gap-2">
							<span class="font-mono text-zinc-500" title={c.kind}
								><span aria-hidden="true">{FACT_KIND_ICON[c.kind]}</span>
								<span class="sr-only">{c.kind}</span></span
							>
							<span class="min-w-0 flex-1 text-zinc-900">{c.text}</span>
							<span class="shrink-0 text-[11px] text-zinc-500">{c.status}</span>
							{#if canAccept && c.status === 'proposed'}
								<button
									class="btn btn-primary btn-sm shrink-0"
									disabled={busy !== null}
									onclick={() => run(`accept:${c.id}`, () => ws.acceptFact(triangle.id, c.id))}
									>{busy === `accept:${c.id}` ? 'Accepting…' : 'Accept'}</button
								>
							{/if}
						</div>
						{#if c.rationale}
							<p class="text-[11px] text-zinc-500">
								<span class="font-semibold">C's private rationale:</span>
								{c.rationale}
							</p>
						{/if}
						{#each c.lint.warnings as warning (warning)}
							<p class="text-[11px] text-amber-700">Note: {warning}</p>
						{/each}
						{#each c.lint.errors as error (error)}
							<p class="text-[11px] text-rose-700">Error: {error}</p>
						{/each}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if triangle.continuations.length > 0}
		<section aria-label="Continuations">
			<h4 class="section-title mb-1">Continuations</h4>
			<ul class="flex flex-col gap-1 text-[13px]">
				{#each triangle.continuations as c (`${c.side}:${c.block.artifactId}`)}
					<li>
						<button
							class="text-left hover:underline"
							onclick={() => ws.focusArtifact(c.block.artifactId)}
							><span class="font-mono text-[11px] text-zinc-500">{c.side}</span>
							{ws.title(c.block.artifactId)}</button
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if tasks.length > 0}
		<p class="text-[11px] text-zinc-500">
			Tasks: {tasks.map((t) => `${TASK_TYPE_SHORT[t.type]} (${t.role}, ${t.state})`).join(' · ')}
		</p>
	{/if}

	<footer class="flex flex-wrap items-center gap-2">
		{#if lastLeft && lastRight}
			<button
				class="btn btn-sm"
				disabled={busy !== null || childGapOpen}
				title="Open a gap between the two latest continuations (POST /connect with this triangle as parent)"
				onclick={openChildGap}
				>{childGapOpen
					? 'Child gap open'
					: busy === 'child'
						? 'Opening…'
						: 'Open child gap'}</button
			>
		{/if}
		{#if triangle.fact}
			<button class="btn btn-sm" disabled={busy !== null} onclick={startCompose}>Compose…</button>
		{/if}
		{#if triangle.status === 'converged'}
			<button
				class="btn btn-sm"
				disabled={busy !== null}
				onclick={() => run('validate', () => ws.setTriangleStatus(triangle.id, 'validated'))}
				>Mark validated</button
			>
		{/if}
		{#if triangle.status !== 'rejected' && triangle.status !== 'superseded'}
			<button
				class="btn btn-ghost btn-sm text-zinc-500"
				disabled={busy !== null}
				onclick={() => run('reject', () => ws.setTriangleStatus(triangle.id, 'rejected'))}
				>Reject</button
			>
		{/if}
	</footer>

	{#if composing}
		<form class="flex flex-col gap-2 border-t border-zinc-100 pt-2" onsubmit={compose}>
			<label class="label" for="compose-{triangle.id}">Composite title</label>
			<input id="compose-{triangle.id}" class="input" maxlength="300" bind:value={composeTitle} />
			<p class="text-[11px] text-zinc-500">
				Members: both anchors, the Fact and every continuation, with the relations among them.
			</p>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm" onclick={() => (composing = false)}>Cancel</button>
				<button class="btn btn-primary btn-sm" type="submit" disabled={busy !== null}
					>{busy === 'compose' ? 'Composing…' : 'Compose'}</button
				>
			</div>
		</form>
	{/if}
</article>
