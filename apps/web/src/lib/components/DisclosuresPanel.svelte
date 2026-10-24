<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime, shortId } from '$lib/ui';
	import type { Disclosure } from '@tlon/contracts';
	import { onMount } from 'svelte';

	import KindBadge from './KindBadge.svelte';
	import Modal from './Modal.svelte';
	import ScopeBadge from './ScopeBadge.svelte';
	import SourceRefList from './SourceRefList.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const ws = getWorkspace();

	const STATUS_CHIP: Record<Disclosure['status'], string> = {
		PENDING: 'border-amber-300 bg-amber-50 text-amber-800',
		PUBLISHED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
		REJECTED: 'border-zinc-300 bg-zinc-100 text-zinc-500'
	};

	let showAll = $state(false);
	let busy = $state<string | null>(null);
	/** Optional review reason per disclosure id. */
	let reasons = $state<Record<string, string>>({});

	const items = $derived(
		[...(showAll ? ws.disclosures : ws.pendingDisclosures)].sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt)
		)
	);

	/** Agents act outside this tab: refresh the graph too so cited sources show their real head. */
	function refresh() {
		Promise.all([ws.reload(), ws.reloadGateway()]).catch((error: unknown) => toasts.error(error));
	}

	onMount(refresh);

	async function review(disclosure: Disclosure, decision: 'PUBLISH' | 'REJECT') {
		busy = `${decision}:${disclosure.id}`;
		const reason = reasons[disclosure.id]?.trim();
		try {
			const result = await ws.reviewDisclosure(disclosure.id, {
				decision,
				...(reason ? { reason } : {})
			});
			toasts.push(
				'info',
				result.status === 'PUBLISHED'
					? `Published to ${ws.principalLabel(result.toPrincipalId)} as a new C-shared artifact.`
					: 'Disclosure rejected.'
			);
		} catch (error) {
			toasts.error(error);
		} finally {
			busy = null;
		}
	}

	function openArtifact(artifactId: string) {
		onclose();
		ws.focusArtifact(artifactId);
	}
</script>

<Modal title="Disclosure review" {onclose} width="w-[760px]">
	<div class="flex max-h-[75vh] flex-col gap-3 overflow-y-auto pr-1">
		{#if ws.gatewayError}
			<p
				class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
				role="alert"
			>
				<span class="font-mono font-semibold">{ws.gatewayError.code}</span>
				{ws.gatewayError.message}
			</p>
		{/if}
		<div class="flex items-center gap-2">
			<p class="text-[11px] text-zinc-500">
				C proposes; a human publishes. Publishing creates a new C-shared artifact from the payload
				and grants the destination READ on that artifact only — never on the cited sources.
			</p>
			<label class="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-zinc-600">
				<input type="checkbox" bind:checked={showAll} /> Show reviewed
			</label>
			<button
				class="btn btn-ghost btn-sm shrink-0 text-zinc-500"
				disabled={ws.gatewayLoading || ws.loading}
				onclick={refresh}>{ws.gatewayLoading || ws.loading ? 'Refreshing…' : 'Refresh'}</button
			>
		</div>

		{#if items.length === 0}
			<p class="py-6 text-center text-xs text-zinc-400">
				{showAll ? 'No disclosures in this project.' : 'No pending disclosures.'}
			</p>
		{/if}

		{#each items as disclosure (disclosure.id)}
			{@const payload = disclosure.sharedPayload}
			{@const destination = ws.agentsById.get(disclosure.toPrincipalId)}
			<article class="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
				<header class="flex flex-wrap items-center gap-2 text-xs">
					<span class={['chip', STATUS_CHIP[disclosure.status]]}>{disclosure.status}</span>
					<span class="text-zinc-500">
						from <span class="font-medium text-zinc-800"
							>{ws.principalLabel(disclosure.fromPrincipalId)}</span
						>
						to
						<span class="font-medium text-zinc-800"
							>{ws.principalLabel(disclosure.toPrincipalId)}</span
						>
						{#if destination?.disabledAt}<span class="text-rose-600">(disabled)</span>{/if}
					</span>
					<span class="ml-auto font-mono text-[11px] text-zinc-400" title={disclosure.id}
						>{shortId(disclosure.id)} · {formatTime(disclosure.createdAt)}</span
					>
				</header>

				<section class="rounded-md bg-zinc-50 px-2.5 py-2">
					<div class="mb-1 flex items-center gap-1.5">
						<span class="section-title">Shared payload</span>
						<KindBadge kind={payload.kind} />
						<ScopeBadge scope="C_SHARED" />
					</div>
					<div class="font-medium text-zinc-900">{payload.title}</div>
					{#if payload.body}
						<p class="mt-0.5 max-h-40 overflow-y-auto text-xs whitespace-pre-wrap text-zinc-700">
							{payload.body}
						</p>
					{/if}
					{#if Object.keys(payload.structured).length > 0}
						<pre
							class="mt-1 max-h-32 overflow-auto rounded border border-zinc-200 bg-white p-1.5 font-mono text-[11px] text-zinc-600">{JSON.stringify(
								payload.structured,
								null,
								2
							)}</pre>
					{/if}
				</section>

				{#if disclosure.redactionNote}
					<p class="text-xs text-zinc-600">
						<span class="section-title">Redaction note</span>
						{disclosure.redactionNote}
					</p>
				{/if}

				<section>
					<div class="section-title mb-1">
						Cited sources ({disclosure.sourceRefs.length}) — pinned revision vs current
					</div>
					<SourceRefList refs={disclosure.sourceRefs} onnavigate={onclose} />
				</section>

				{#if disclosure.status === 'PENDING'}
					<div class="flex items-center gap-2">
						<input
							class="input flex-1"
							placeholder="Review note (optional)"
							aria-label="Review note"
							maxlength="1000"
							bind:value={reasons[disclosure.id]}
						/>
						<button
							class="btn"
							disabled={busy !== null}
							onclick={() => review(disclosure, 'REJECT')}
							>{busy === `REJECT:${disclosure.id}` ? 'Rejecting…' : 'Reject'}</button
						>
						<button
							class="btn btn-primary"
							disabled={busy !== null || (destination?.disabledAt ?? null) !== null}
							onclick={() => review(disclosure, 'PUBLISH')}
							>{busy === `PUBLISH:${disclosure.id}` ? 'Publishing…' : 'Publish'}</button
						>
					</div>
				{:else}
					<div class="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
						<span
							>{disclosure.status === 'PUBLISHED' ? 'Published' : 'Rejected'}
							{#if disclosure.reviewedAt}{formatTime(disclosure.reviewedAt)}{/if}
							{#if disclosure.reviewedBy}by {ws.principalLabel(disclosure.reviewedBy)}{/if}</span
						>
						{#if disclosure.sharedArtifactId}
							{@const sharedId = disclosure.sharedArtifactId}
							<button
								class="ml-auto text-accent-700 hover:underline"
								onclick={() => openArtifact(sharedId)}
								>Open shared artifact {ws.artifactsById.has(sharedId)
									? `“${ws.title(sharedId)}”`
									: shortId(sharedId)}</button
							>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</Modal>
