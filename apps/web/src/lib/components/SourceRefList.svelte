<script lang="ts">
	import { api } from '$lib/api';
	import { getWorkspace } from '$lib/state/context';
	import { shortId } from '$lib/ui';
	import type { SourceRef } from '@tlon/contracts';

	import KindBadge from './KindBadge.svelte';
	import ScopeBadge from './ScopeBadge.svelte';

	/** Pinned source revisions cited by a disclosure, compared with each artifact's head. */
	let { refs, onnavigate }: { refs: SourceRef[]; onnavigate?: () => void } = $props();

	const ws = getWorkspace();

	/** revisionId → version, or `null` while loading / when the revisions could not be read. */
	let pinnedVersions = $state.raw<Map<string, number> | null>(null);
	let failed = $state(false);

	// Re-fetch when the cited artifacts change and after every graph refresh (heads move).
	$effect(() => {
		const artifactIds = [...new Set(refs.map((r) => r.artifactId))];
		void ws.revision;
		let cancelled = false;
		Promise.all(artifactIds.map((artifactId) => api.listRevisions(ws.projectId, artifactId)))
			.then((lists) => {
				if (cancelled) return;
				pinnedVersions = new Map(lists.flatMap((l) => l.items.map((r) => [r.id, r.version])));
				failed = false;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<ul class="flex flex-col gap-1 text-xs">
	{#each refs as ref (`${ref.artifactId}:${ref.revisionId}`)}
		{@const artifact = ws.artifactsById.get(ref.artifactId)}
		{@const pinned = pinnedVersions?.get(ref.revisionId) ?? null}
		{@const stale = artifact !== undefined && artifact.headRevisionId !== ref.revisionId}
		<li class="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1">
			{#if artifact}
				<KindBadge kind={artifact.kind} />
				<ScopeBadge scope={artifact.ownerScope} />
				<button
					class="min-w-0 truncate text-left text-accent-700 hover:underline"
					title="Open {artifact.title}"
					onclick={() => {
						onnavigate?.();
						ws.focusArtifact(artifact.id);
					}}>{artifact.title}</button
				>
			{:else}
				<span class="font-mono text-zinc-500" title={ref.artifactId}
					>artifact {shortId(ref.artifactId)} (not in graph)</span
				>
			{/if}
			<span class="ml-auto shrink-0 font-mono text-[11px] text-zinc-500" title={ref.revisionId}>
				pinned {pinned !== null ? `v${pinned}` : failed ? shortId(ref.revisionId) : '…'}
				{#if artifact}· current v{artifact.version}{/if}
			</span>
			{#if stale}
				<span
					class="chip shrink-0 border-amber-300 bg-amber-50 text-amber-800"
					title="The source changed after C cited it; the disclosure is based on the pinned revision"
					>changed since</span
				>
			{/if}
		</li>
	{/each}
</ul>
