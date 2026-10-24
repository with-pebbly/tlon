<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { validateStructured } from '$lib/validation';
	import type { BridgeStructured, ExpansionDetail, StructuredRecord } from '@tlon/contracts';
	import { BRIDGE_STRATEGY_COUNT, forbiddenBridgeArtifactIds, suggestBridge } from '@tlon/core';

	let { detail }: { detail: ExpansionDetail } = $props();

	const ws = getWorkspace();

	let mode = $state<'new' | 'existing'>('new');
	let title = $state('');
	let body = $state('');
	let mechanism = $state('');
	let assumptions = $state<string[]>(['']);
	let reconcileLeft = $state('');
	let reconcileRight = $state('');
	/** Extra keys carried over from the last suggestion (e.g. its strategy), kept in `structured`. */
	let suggestionExtras = $state.raw<StructuredRecord>({});
	let variant = $state(0);
	let existingId = $state('');
	let submitting = $state(false);

	const relationType = $derived(detail.targetRelation?.type ?? 'pair');
	const structured = $derived<BridgeStructured>({
		...suggestionExtras,
		mechanism: mechanism.trim(),
		assumptions: assumptions.map((a) => a.trim()).filter((a) => a !== ''),
		anchorReconciliation: { left: reconcileLeft.trim(), right: reconcileRight.trim() }
	});
	const structuredError = $derived(
		validateStructured(ws.project?.domain ?? 'GENERIC', 'BRIDGE', structured)
	);
	const touched = $derived(mechanism !== '' || reconcileLeft !== '' || reconcileRight !== '');
	const canSubmit = $derived(
		mode === 'new' ? title.trim() !== '' && structuredError === null : existingId !== ''
	);

	const nominable = $derived.by(() => {
		const forbidden = forbiddenBridgeArtifactIds(detail.expansion, detail.lineage);
		const already = new Set(detail.expansion.bridgeArtifactIds);
		return ws.artifacts.filter(
			(a) => !forbidden.has(a.id) && !already.has(a.id) && a.status !== 'REJECTED'
		);
	});

	function suggest() {
		const suggestion = suggestBridge(detail.left, detail.right, relationType, variant);
		variant = (variant + 1) % BRIDGE_STRATEGY_COUNT;
		const { mechanism: m, assumptions: a, anchorReconciliation, ...extras } = suggestion.structured;
		title = suggestion.title;
		body = suggestion.body;
		mechanism = m;
		assumptions = a.length > 0 ? [...a] : [''];
		reconcileLeft = anchorReconciliation.left;
		reconcileRight = anchorReconciliation.right;
		suggestionExtras = extras;
	}

	function reset() {
		title = '';
		body = '';
		mechanism = '';
		assumptions = [''];
		reconcileLeft = '';
		reconcileRight = '';
		suggestionExtras = {};
		existingId = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		try {
			await ws.submitCandidate(
				detail.expansion.id,
				mode === 'new'
					? { artifact: { kind: 'BRIDGE', title: title.trim(), body, structured } }
					: { existingArtifactId: existingId }
			);
			reset();
		} catch (error) {
			toasts.error(error);
		} finally {
			submitting = false;
		}
	}
</script>

<form
	class="flex flex-col gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3"
	onsubmit={submit}
>
	<div class="flex items-center gap-2">
		<h3 class="section-title">Propose a bridge (C)</h3>
		<div class="ml-auto flex rounded-md border border-zinc-300 bg-white p-0.5 text-[11px]">
			<button
				type="button"
				class={['rounded px-2', mode === 'new' ? 'bg-zinc-200 text-zinc-900' : 'text-zinc-500']}
				onclick={() => (mode = 'new')}>New</button
			>
			<button
				type="button"
				class={[
					'rounded px-2',
					mode === 'existing' ? 'bg-zinc-200 text-zinc-900' : 'text-zinc-500'
				]}
				onclick={() => (mode = 'existing')}>Existing</button
			>
		</div>
	</div>

	{#if mode === 'existing'}
		<div>
			<label class="label" for="cf-existing">Artifact</label>
			<select id="cf-existing" class="input" bind:value={existingId}>
				<option value="">Choose an artifact…</option>
				{#each nominable as artifact (artifact.id)}
					<option value={artifact.id}>{artifact.kind} · {artifact.title}</option>
				{/each}
			</select>
			<p class="mt-0.5 text-[11px] text-zinc-500">
				Anchors and lineage artifacts are excluded (they would fold the tree onto itself). The
				server still checks that the artifact carries mechanism, assumptions and reconciliation.
			</p>
		</div>
	{:else}
		<button type="button" class="btn btn-sm self-start" onclick={suggest}>
			{variant === 0 ? 'Suggest' : 'Suggest another'} (next strategy {variant +
				1}/{BRIDGE_STRATEGY_COUNT})
		</button>
		<div>
			<label class="label" for="cf-title">Title</label>
			<input id="cf-title" class="input" bind:value={title} maxlength="300" />
		</div>
		<div>
			<label class="label" for="cf-body">Body</label>
			<textarea id="cf-body" class="input" rows="3" bind:value={body}></textarea>
		</div>
		<div>
			<label class="label" for="cf-mechanism">Mechanism</label>
			<textarea id="cf-mechanism" class="input" rows="2" bind:value={mechanism}></textarea>
		</div>
		<div>
			<div class="label">Assumptions</div>
			<div class="flex flex-col gap-1">
				{#each assumptions as _, index (index)}
					<div class="flex gap-1">
						<input
							class="input"
							aria-label="Assumption {index + 1}"
							bind:value={assumptions[index]}
						/>
						<button
							type="button"
							class="btn btn-ghost btn-sm text-zinc-400"
							aria-label="Remove assumption {index + 1}"
							onclick={() => (assumptions = assumptions.filter((__, i) => i !== index))}>✕</button
						>
					</div>
				{/each}
				<button
					type="button"
					class="self-start text-[11px] text-accent-600 hover:underline"
					onclick={() => assumptions.push('')}>+ Add assumption</button
				>
			</div>
		</div>
		<div>
			<label class="label" for="cf-left">How the left anchor stays true</label>
			<textarea id="cf-left" class="input" rows="2" bind:value={reconcileLeft}></textarea>
		</div>
		<div>
			<label class="label" for="cf-right">How the right anchor stays true</label>
			<textarea id="cf-right" class="input" rows="2" bind:value={reconcileRight}></textarea>
		</div>
		{#if structuredError && touched}
			<p class="text-[11px] text-rose-600">{structuredError}</p>
		{/if}
	{/if}

	<button class="btn btn-primary self-start" disabled={!canSubmit || submitting}>
		{submitting ? 'Submitting…' : 'Submit candidate'}
	</button>
</form>
