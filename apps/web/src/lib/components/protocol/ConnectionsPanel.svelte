<!--
	Narrative connections manager (review §4.1, BF-08/10/15). A Fact link is derived from
	triangles and never a cause; everything beyond it is an explicit, attributed
	connection. Only a facilitator canonizes causality; AI-proposed rows stay proposals.
-->
<script lang="ts">
	import {
		CONNECTION_KIND_CLASS,
		CONNECTION_KIND_HINT,
		CONNECTION_KIND_LABEL
	} from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime } from '$lib/ui';
	import {
		CONNECTION_KINDS,
		type ConnectionKind,
		type NarrativeConnection,
		type UpdateConnectionInput
	} from '@tlon/contracts';
	import { onMount } from 'svelte';

	const ws = getWorkspace();

	const CONFIDENCES: readonly NarrativeConnection['confidence'][] = [
		'unknown',
		'inferred',
		'explicit'
	];

	let busy = $state<string | null>(null);
	let showRejected = $state(false);

	let kind = $state<ConnectionKind>('open_mystery');
	let left = $state('');
	let right = $state('');
	let factId = $state('');
	let realizedBy = $state<string[]>([]);
	let statement = $state('');
	let confidence = $state<NarrativeConnection['confidence']>('unknown');
	let approve = $state(false);

	/** Endpoints: Blocks and composites, never a Fact itself. */
	const blocks = $derived(
		ws.artifacts.filter(
			(a) => a.artifactClass !== 'FACT' && a.status !== 'REJECTED' && a.status !== 'ARCHIVED'
		)
	);
	const factLinks = $derived(
		ws.triangles.filter(
			(t) => t.fact !== null && t.status !== 'rejected' && t.status !== 'superseded'
		).length
	);
	const groups = $derived(
		CONNECTION_KINDS.map((k) => ({
			kind: k,
			items: ws.connections.filter((c) => c.kind === k && (showRejected || c.status === 'active'))
		}))
	);
	const rejectedCount = $derived(ws.connections.filter((c) => c.status === 'rejected').length);
	const canSubmit = $derived(
		left !== '' && right !== '' && left !== right && statement.trim() !== '' && busy === null
	);

	onMount(() => {
		void ws.reloadConnections();
	});

	async function act(label: string, action: () => Promise<unknown>) {
		busy = label;
		try {
			await action();
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = null;
		}
	}

	function update(connection: NarrativeConnection, input: UpdateConnectionInput, done: string) {
		void act(connection.id, async () => {
			await ws.updateConnection(connection.id, input);
			toasts.push('info', done);
		});
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		void act('add', async () => {
			await ws.createConnection({
				kind,
				endpointIds: [left, right],
				...(factId === '' ? {} : { factArtifactId: factId }),
				realizedByIds: realizedBy,
				statement: statement.trim(),
				confidence,
				source: 'human',
				// Canon is a facilitator decision: it is always approved on creation.
				approve: kind === 'causal_canon' || approve
			});
			left = '';
			right = '';
			factId = '';
			realizedBy = [];
			statement = '';
			approve = false;
		});
	}
</script>

<section
	class="panel flex flex-col gap-3 p-4"
	aria-labelledby="connections-h"
	data-testid="connections"
>
	<div class="flex items-baseline gap-2">
		<h2 id="connections-h" class="font-semibold text-zinc-900">Connections</h2>
		<span class="text-xs text-zinc-500">how Blocks are joined beyond sharing a Fact</span>
	</div>

	{#if ws.connectionsError}
		<p class="text-sm text-rose-700" role="alert">
			Connections unavailable: {ws.connectionsError.message}
		</p>
	{/if}

	<p class="text-xs text-zinc-600">
		<span class="font-medium">Fact links: {factLinks}</span> — derived from triangles. A shared Fact is
		a link, never a cause.
	</p>

	{#each groups as group (group.kind)}
		<div class="flex flex-col gap-1">
			<h3 class="section-title" title={CONNECTION_KIND_HINT[group.kind]}>
				{CONNECTION_KIND_LABEL[group.kind]} ({group.items.length})
				<span class="font-normal text-zinc-400 normal-case"
					>— {CONNECTION_KIND_HINT[group.kind]}</span
				>
			</h3>
			<ul class="flex flex-col gap-1" aria-label={CONNECTION_KIND_LABEL[group.kind]}>
				{#each group.items as c (c.id)}
					{@const ai = c.source === 'ai_review'}
					<li
						class={[
							'flex flex-col gap-1 rounded border px-2 py-1.5 text-xs',
							c.status === 'rejected'
								? 'border-dashed border-zinc-300 bg-zinc-50 opacity-60'
								: 'border-zinc-200'
						]}
						data-testid="connection-row"
						data-kind={c.kind}
						data-status={c.status}
					>
						<div class="flex flex-wrap items-center gap-1">
							<span class={['chip', CONNECTION_KIND_CLASS[c.kind]]}
								>{CONNECTION_KIND_LABEL[c.kind]}</span
							>
							<span
								class={[
									'chip',
									ai
										? 'border-dashed border-sky-300 bg-white text-sky-700'
										: 'border-zinc-300 bg-zinc-50 text-zinc-700'
								]}
								title={ai ? 'Proposed by AI review — not canon' : 'Added by a facilitator'}
								>{ai ? 'AI review' : 'human'}</span
							>
							{#if c.approvedBy}
								<span
									class="chip border-emerald-300 bg-emerald-50 text-emerald-800"
									title="Approved by {ws.principalLabel(c.approvedBy)}"
									>{c.kind === 'open_mystery' ? 'intentional' : 'approved'}</span
								>
							{:else}
								<span class="chip border-zinc-200 bg-white text-zinc-500">not approved</span>
							{/if}
							<span class="text-zinc-500">confidence: {c.confidence}</span>
							{#if c.status === 'rejected'}<span class="text-zinc-500">rejected</span>{/if}
							<span class="ml-auto text-zinc-400">{formatTime(c.updatedAt)}</span>
						</div>
						<div class="text-zinc-700">
							<span class="font-medium">{ws.blockLabel(c.endpointIds[0])}</span>
							↔
							<span class="font-medium">{ws.blockLabel(c.endpointIds[1])}</span>
							{#if c.factArtifactId}
								<span class="text-zinc-500">· via Fact “{ws.title(c.factArtifactId)}”</span>
							{/if}
						</div>
						{#if c.realizedByIds.length > 0}
							<div class="text-zinc-500">
								realized by {c.realizedByIds.map((id) => ws.blockLabel(id)).join(', ')}
							</div>
						{/if}
						<p class="text-zinc-900">{c.statement}</p>
						{#if c.status === 'active'}
							<div class="flex flex-wrap gap-1">
								{#if !c.approvedBy && c.kind !== 'causal_canon'}
									<button
										class="btn btn-sm"
										disabled={busy !== null}
										title={c.kind === 'open_mystery'
											? 'Keep this question open on purpose (your editorial decision)'
											: 'Approve this reading (your editorial decision)'}
										onclick={() =>
											update(
												c,
												{ approve: true },
												c.kind === 'open_mystery'
													? 'Marked as intentional.'
													: 'Connection approved.'
											)}>{c.kind === 'open_mystery' ? 'Approve as intentional' : 'Approve'}</button
									>
								{/if}
								{#if c.kind === 'causal_hypothesis' || c.kind === 'open_mystery'}
									<button
										class="btn btn-sm"
										disabled={busy !== null}
										title={ai
											? 'Adopt this AI suggestion as causal canon — you approve it'
											: 'Canonize this causal relation (facilitator decision)'}
										onclick={() =>
											update(
												c,
												{ kind: 'causal_canon', approve: true },
												'Promoted to causal canon.'
											)}>Promote to canon</button
									>
								{/if}
								<button
									class="btn btn-ghost btn-sm text-rose-700"
									disabled={busy !== null}
									title="Removes this interpretation only — the Fact and the texts stay"
									onclick={() =>
										update(
											c,
											{ status: 'rejected' },
											'Connection rejected — the Fact and the texts stay.'
										)}>Reject</button
								>
							</div>
						{/if}
					</li>
				{:else}
					<li class="text-xs text-zinc-400">None.</li>
				{/each}
			</ul>
		</div>
	{/each}

	{#if rejectedCount > 0}
		<label class="flex items-center gap-2 text-xs text-zinc-600">
			<input type="checkbox" bind:checked={showRejected} /> Show rejected ({rejectedCount})
		</label>
	{/if}

	<form
		class="flex flex-col gap-2 rounded border border-zinc-200 p-2"
		onsubmit={add}
		aria-label="Add connection"
	>
		<h3 class="section-title">Add connection</h3>
		<div class="grid grid-cols-2 gap-2">
			<div>
				<label class="label" for="conn-kind">Kind</label>
				<select id="conn-kind" class="input" bind:value={kind}>
					{#each CONNECTION_KINDS as k (k)}<option value={k}>{CONNECTION_KIND_LABEL[k]}</option
						>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="conn-confidence">Confidence</label>
				<select id="conn-confidence" class="input" bind:value={confidence}>
					{#each CONFIDENCES as option (option)}<option value={option}>{option}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="conn-left">Block</label>
				<select id="conn-left" class="input" bind:value={left}>
					<option value="">—</option>
					{#each blocks as a (a.id)}<option value={a.id}>{ws.blockLabel(a.id)}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="conn-right">Block</label>
				<select id="conn-right" class="input" bind:value={right}>
					<option value="">—</option>
					{#each blocks as a (a.id)}<option value={a.id}>{ws.blockLabel(a.id)}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="conn-fact">Fact (optional)</label>
				<select id="conn-fact" class="input" bind:value={factId}>
					<option value="">—</option>
					{#each ws.factArtifacts as f (f.id)}<option value={f.id}>{f.title}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="conn-realized">Realized by (optional)</label>
				<select id="conn-realized" class="input h-auto" multiple size="3" bind:value={realizedBy}>
					{#each blocks as a (a.id)}<option value={a.id}>{ws.blockLabel(a.id)}</option>{/each}
				</select>
			</div>
		</div>
		<div>
			<label class="label" for="conn-statement"
				>{kind === 'open_mystery' ? 'Question' : 'Explanation'}</label
			>
			<textarea
				id="conn-statement"
				class="input min-h-14 py-1.5"
				maxlength="2000"
				placeholder={kind === 'open_mystery'
					? 'How, if at all, do the ten knocks relate to the seventeen pulses?'
					: 'What joins the two Blocks, as the texts support it'}
				bind:value={statement}></textarea>
		</div>
		<div class="flex items-center gap-2">
			{#if kind === 'causal_canon'}
				<span class="text-xs text-zinc-500">Canon is approved by you on creation.</span>
			{:else}
				<label class="flex items-center gap-1 text-xs text-zinc-700"
					><input type="checkbox" bind:checked={approve} />
					{kind === 'open_mystery' ? 'approve as intentional' : 'approve now'}</label
				>
			{/if}
			<button class="btn btn-primary ml-auto" type="submit" disabled={!canSubmit}
				>{busy === 'add' ? 'Adding…' : 'Add connection'}</button
			>
		</div>
	</form>
</section>
