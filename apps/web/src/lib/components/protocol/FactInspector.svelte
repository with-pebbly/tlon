<script lang="ts">
	import { FACT_KIND_HINT, FACT_KIND_ICON, TRIANGLE_STATUS_CLASS } from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { formatTime, SCOPE_LABEL, STATUS_TEXT } from '$lib/ui';
	import { lintFactText, type Artifact } from '@tlon/contracts';

	let { artifact }: { artifact: Artifact } = $props();

	const ws = getWorkspace();

	const lint = $derived(lintFactText(artifact.title));
	const stage = $derived(ws.stageByArtifact.get(artifact.id));
	const triangles = $derived(ws.trianglesByArtifact.get(artifact.id) ?? []);
	const disclosures = $derived(
		ws.disclosures.filter(
			(d) =>
				d.sharedArtifactId === artifact.id || d.sourceRefs.some((r) => r.artifactId === artifact.id)
		)
	);
	const grants = $derived(ws.grants.filter((g) => g.artifactId === artifact.id));
</script>

<div class="flex flex-col gap-4" data-testid="fact-inspector">
	<section class="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
		<p class="text-[11px] font-semibold tracking-wide text-amber-800 uppercase">Fact</p>
		<p class="mt-1 text-base font-medium text-zinc-900">{artifact.title}</p>
	</section>

	{#if lint.warnings.length > 0 || lint.errors.length > 0}
		<section class="rounded border border-amber-300 bg-amber-50/60 p-2 text-[13px]" role="note">
			{#each lint.errors as message (message)}<p class="text-rose-700">Error: {message}</p>{/each}
			{#each lint.warnings as message (message)}<p class="text-amber-800">Note: {message}</p>{/each}
		</section>
	{/if}

	<dl class="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-[13px]">
		<dt class="text-zinc-500">Kind</dt>
		<dd>
			{#if artifact.factKind}
				<span aria-hidden="true">{FACT_KIND_ICON[artifact.factKind]}</span>
				{artifact.factKind} <span class="text-zinc-500">— {FACT_KIND_HINT[artifact.factKind]}</span>
			{:else}—{/if}
		</dd>
		<dt class="text-zinc-500">Stage</dt>
		<dd>{stage ?? '—'}</dd>
		<dt class="text-zinc-500">Status</dt>
		<dd class={STATUS_TEXT[artifact.status]}>{artifact.status}</dd>
		<dt class="text-zinc-500">Scope</dt>
		<dd>{SCOPE_LABEL[artifact.ownerScope]}</dd>
		<dt class="text-zinc-500">Created</dt>
		<dd>{formatTime(artifact.createdAt)} by role {artifact.creatorRole}</dd>
	</dl>

	<section>
		<h3 class="section-title mb-1">Disclosed to</h3>
		{#if disclosures.length === 0 && grants.length === 0}
			<p class="text-[13px] text-zinc-500">Not disclosed to any participant.</p>
		{:else}
			<ul class="flex flex-col gap-0.5 text-[13px]">
				{#each disclosures as d (d.id)}
					<li>{ws.principalLabel(d.toPrincipalId)} · {d.status.toLowerCase()}</li>
				{/each}
				{#each grants.filter((g) => !disclosures.some((d) => d.toPrincipalId === g.granteePrincipalId)) as g (g.id)}
					<li>
						{ws.principalLabel(g.granteePrincipalId)} · read grant{g.revokedAt ? ' (revoked)' : ''}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h3 class="section-title mb-1">Triangles</h3>
		{#if triangles.length === 0}
			<p class="text-[13px] text-zinc-500">Not part of a triangle.</p>
		{:else}
			<ul class="flex flex-col gap-1 text-[13px]">
				{#each triangles as t (t.id)}
					<li>
						<button
							class="flex w-full items-center gap-2 text-left hover:underline"
							onclick={() => ws.select({ type: 'triangle', id: t.id })}
						>
							<span class={['chip', TRIANGLE_STATUS_CLASS[t.status]]}>{t.status}</span>
							<span class="truncate"
								>{ws.title(t.left.artifactId)} ⟷ {ws.title(t.right.artifactId)}</span
							>
							<span class="ml-auto shrink-0 font-mono text-[11px] text-zinc-500"
								>{t.fact?.artifactId === artifact.id
									? 'fact'
									: t.left.artifactId === artifact.id || t.right.artifactId === artifact.id
										? 'anchor'
										: 'candidate'}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
