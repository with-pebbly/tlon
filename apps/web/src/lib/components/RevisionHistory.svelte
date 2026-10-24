<script lang="ts">
	import { api } from '$lib/api';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime } from '$lib/ui';
	import type { Artifact, ArtifactRevision, ArtifactSnapshot } from '@tlon/contracts';

	let { artifact }: { artifact: Artifact } = $props();

	const ws = getWorkspace();

	let revisions = $state.raw<ArtifactRevision[] | null>(null);
	let restoring = $state<string | null>(null);
	let openId = $state<string | null>(null);

	const SNAPSHOT_FIELDS: (keyof ArtifactSnapshot)[] = [
		'title',
		'kind',
		'status',
		'body',
		'structured',
		'ownerScope',
		'locked',
		'pinned'
	];

	// Re-fetch whenever the head revision moves (every save appends one).
	$effect(() => {
		const { id, headRevisionId } = artifact;
		void headRevisionId;
		let cancelled = false;
		api
			.listRevisions(ws.projectId, id)
			.then((list) => {
				if (!cancelled) revisions = list.items;
			})
			.catch((error: unknown) => {
				if (!cancelled) toasts.error(error);
			});
		return () => {
			cancelled = true;
		};
	});

	function changedFields(revision: ArtifactRevision, index: number): string[] {
		const previous = revisions?.[index + 1];
		if (!previous) return ['created'];
		return SNAPSHOT_FIELDS.filter(
			(field) =>
				JSON.stringify(revision.snapshot[field]) !== JSON.stringify(previous.snapshot[field])
		);
	}

	async function restore(revision: ArtifactRevision) {
		restoring = revision.id;
		try {
			const { kind, title, body, structured, status, ownerScope, locked, pinned } =
				revision.snapshot;
			await ws.updateArtifact(artifact, {
				kind,
				title,
				body,
				structured,
				status,
				ownerScope,
				locked,
				pinned,
				reason: `restore v${revision.version}`
			});
		} catch (error) {
			toasts.error(error);
		} finally {
			restoring = null;
		}
	}
</script>

<section>
	<h3 class="section-title mb-1.5">Revision history</h3>
	{#if revisions === null}
		<p class="text-xs text-zinc-400">Loading…</p>
	{:else}
		<ol class="flex flex-col gap-1">
			{#each revisions as revision, index (revision.id)}
				{@const isHead = revision.id === artifact.headRevisionId}
				<li class="rounded-md border border-zinc-200">
					<button
						class="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-zinc-50"
						aria-expanded={openId === revision.id}
						onclick={() => (openId = openId === revision.id ? null : revision.id)}
					>
						<span class="font-mono text-[11px] font-semibold text-zinc-700"
							>v{revision.version}</span
						>
						{#if isHead}<span class="chip border-emerald-200 bg-emerald-50 text-emerald-700"
								>current</span
							>{/if}
						<span class="min-w-0 flex-1 truncate text-xs text-zinc-500">
							{revision.reason ?? changedFields(revision, index).join(', ')}
						</span>
						<span class="shrink-0 text-[11px] text-zinc-400">{formatTime(revision.createdAt)}</span>
					</button>
					{#if openId === revision.id}
						<div class="flex flex-col gap-1 border-t border-zinc-100 px-2 py-1.5 text-xs">
							<div class="text-zinc-500">
								by <span class="font-mono">{revision.actorId}</span> · changed: {changedFields(
									revision,
									index
								).join(', ') || 'nothing'}
							</div>
							<div class="font-medium text-zinc-800">{revision.snapshot.title}</div>
							<div class="text-zinc-500">{revision.snapshot.kind} · {revision.snapshot.status}</div>
							{#if revision.snapshot.body}
								<p class="line-clamp-4 whitespace-pre-wrap text-zinc-600">
									{revision.snapshot.body}
								</p>
							{/if}
							{#if !isHead}
								<button
									class="btn btn-sm self-start"
									disabled={restoring !== null}
									onclick={() => restore(revision)}
								>
									{restoring === revision.id ? 'Restoring…' : 'Restore this version'}
								</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>
