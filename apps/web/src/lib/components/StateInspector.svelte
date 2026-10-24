<script module lang="ts">
	/** Beats before the one under review are never a proposal. */
	const NONE: ReadonlySet<string> = new Set();
</script>

<script lang="ts">
	import { isApiError } from '$lib/api';
	import {
		PROVENANCE_CHIP,
		PROVENANCE_LABEL,
		provenanceOf,
		replayBefore,
		stateKeyOf
	} from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime, shortId } from '$lib/ui';
	import type { Artifact, TransitionInput } from '@tlon/contracts';

	import AssertionList from './AssertionList.svelte';
	import IssueRow from './IssueRow.svelte';
	import TransitionEditor from './TransitionEditor.svelte';

	let { artifact }: { artifact: Artifact } = $props();

	const ws = getWorkspace();

	let editing = $state(false);
	let saving = $state(false);
	let stale = $state(false);

	const annotation = $derived(ws.transitionsByArtifact.get(artifact.id) ?? null);
	const transition = $derived(annotation?.transition ?? null);
	const through = $derived(ws.pathThrough(artifact.id));
	const index = $derived(through ? through.path.indexOf(artifact.id) : -1);
	const replay = $derived(
		through
			? replayBefore(through.path, index, (id) => ws.transitionsByArtifact.get(id)?.transition)
			: null
	);
	const provenance = $derived(
		provenanceOf(
			artifact.id,
			ws.acceptedBridgeIds,
			through?.hypothetical ? new Set([artifact.id]) : NONE
		)
	);
	const annotationStale = $derived(
		annotation !== null && annotation.artifactRevisionId !== artifact.headRevisionId
	);
	const issues = $derived(ws.issuesOf(artifact.id));
	/** Keys this beat states a world precondition for (emphasised in the incoming state). */
	const preconditionKeys = $derived(
		new Set(
			(transition?.preconditions ?? [])
				.filter((a) => a.epistemic === 'world')
				.map((a) => stateKeyOf(a))
		)
	);
	const issueKeys = $derived(new Set(issues.flatMap((i) => (i.stateKey ? [i.stateKey] : []))));
	const incoming = $derived(
		replay ? [...replay.world].toSorted(([a], [b]) => a.localeCompare(b)) : []
	);

	const beatRef = (id: string) => {
		const at = through ? through.path.indexOf(id) : -1;
		return at < 0 ? ws.title(id) : `#${at + 1} ${ws.title(id)}`;
	};

	async function save(next: TransitionInput, reviewed: boolean) {
		saving = true;
		try {
			await ws.putTransition(artifact, next, reviewed);
			editing = false;
		} catch (error) {
			if (isApiError(error) && error.code === 'STALE_REVISION') stale = true;
			else toasts.error(error);
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<section class="flex flex-col gap-1.5" aria-label="Position on the story path">
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			{#if through}
				<span class="chip border-zinc-300 bg-zinc-50 font-mono text-zinc-700"
					>#{index + 1} / {through.path.length}</span
				>
				<span class="text-zinc-600"
					>{through.hypothetical
						? 'on the story path if this candidate is accepted'
						: 'on the committed story path'}</span
				>
			{:else}
				<span class="text-zinc-500"
					>Not on the story path (notes, rejected and unlinked beats).</span
				>
			{/if}
			<span class={['chip ml-auto', PROVENANCE_CHIP[provenance]]}
				>{PROVENANCE_LABEL[provenance]}</span
			>
		</div>
		{#if through}
			<button
				class="btn btn-sm self-start"
				onclick={() =>
					(ws.compare = { artifactId: artifact.id, stateKey: issues[0]?.stateKey ?? null })}
				>Compare neighbours</button
			>
		{/if}
	</section>

	{#if stale}
		<div
			class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
			role="alert"
		>
			<div class="font-semibold">STALE_REVISION — the artifact changed while you edited.</div>
			<p class="mt-0.5">
				An annotation must describe the head revision. Reload and annotate the latest text.
			</p>
			<button
				class="btn btn-sm mt-1.5"
				onclick={() => ws.reload().catch((error: unknown) => toasts.error(error))}
				>Reload latest</button
			>
		</div>
	{/if}

	<section class="flex flex-col gap-1.5" aria-label="Annotation">
		<h3 class="section-title">Annotation</h3>
		{#if annotation}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<span class="chip border-zinc-300 bg-white text-zinc-700">{annotation.source}</span>
				{#if annotation.reviewed}
					<span class="chip border-emerald-300 bg-emerald-50 text-emerald-700">✓ reviewed</span>
				{:else}
					<span class="chip border-zinc-300 bg-zinc-50 text-zinc-500">not reviewed</span>
				{/if}
				{#if annotationStale}
					<span
						class="chip border-amber-300 bg-amber-50 text-amber-800"
						title="The annotation describes revision {shortId(
							annotation.artifactRevisionId
						)}; the head is {shortId(artifact.headRevisionId)}">stale</span
					>
				{/if}
			</div>
			<p class="text-[11px] text-zinc-500">
				Describes revision <span class="font-mono" title={annotation.artifactRevisionId}
					>{shortId(annotation.artifactRevisionId)}</span
				>{annotationStale ? ' (older than the head)' : ` (head, v${artifact.version})`} · by {ws.principalLabel(
					annotation.actorId
				)} · {formatTime(annotation.createdAt)}
			</p>
		{:else}
			<p class="text-xs text-zinc-500">
				No state annotation — validation cannot check this beat or anything that depends on it.
			</p>
		{/if}
		{#if !editing}
			<div class="flex gap-1.5">
				<button class="btn btn-sm" disabled={saving} onclick={() => (editing = true)}
					>{annotation ? 'Edit transition' : 'Add transition'}</button
				>
				{#if annotation && transition && (!annotation.reviewed || annotationStale)}
					{@const current = transition}
					<button
						class="btn btn-sm"
						disabled={saving}
						title="Confirm this transition for the current head revision"
						onclick={() => save(current, true)}>Mark reviewed</button
					>
				{/if}
			</div>
		{/if}
	</section>

	{#if editing}
		<TransitionEditor
			initial={transition}
			initialReviewed={annotation?.reviewed ?? false}
			{saving}
			onsave={save}
			oncancel={() => (editing = false)}
		/>
	{:else if through && transition}
		<section class="flex flex-col gap-1.5" aria-label="Preconditions">
			<h3 class="section-title">Preconditions</h3>
			<AssertionList
				items={transition.preconditions}
				path={through.path}
				highlightKeys={issueKeys}
				incoming={replay?.world ?? null}
			/>
		</section>
		<section class="flex flex-col gap-1.5" aria-label="Effects">
			<h3 class="section-title">Effects</h3>
			<AssertionList
				items={transition.effects}
				path={through.path}
				highlightKeys={issueKeys}
				{provenance}
			/>
		</section>
		<section class="flex flex-col gap-1.5" aria-label="Assumptions">
			<h3 class="section-title">Assumptions</h3>
			<AssertionList
				items={transition.assumptions}
				path={through.path}
				highlightKeys={issueKeys}
				{provenance}
			/>
		</section>
	{:else if transition}
		<section class="flex flex-col gap-1.5" aria-label="Contract">
			<h3 class="section-title">Contract</h3>
			{#each [['Preconditions', transition.preconditions], ['Effects', transition.effects], ['Assumptions', transition.assumptions]] as const as [label, items] (label)}
				<div class="text-[11px] text-zinc-500">{label}</div>
				<AssertionList {items} path={[]} {provenance} />
			{/each}
		</section>
	{/if}

	{#if issues.length > 0}
		<section class="flex flex-col gap-1.5" aria-label="Issues of this beat">
			<h3 class="section-title">Issues</h3>
			{#each issues as issue (issue.key)}
				<IssueRow {issue} />
			{/each}
		</section>
	{/if}

	{#if replay}
		<section class="flex flex-col gap-1.5" aria-label="Incoming world state">
			<div class="flex items-baseline justify-between">
				<h3 class="section-title">Incoming world state</h3>
				<span class="text-[11px] text-zinc-400"
					>replayed from {index} earlier beat{index === 1 ? '' : 's'}</span
				>
			</div>
			{#if replay.blind.length > 0}
				<p class="text-[11px] text-amber-800">
					{replay.blind.length} earlier beat{replay.blind.length === 1 ? ' is' : 's are'} unannotated;
					their changes are unknown here.
				</p>
			{/if}
			{#if incoming.length === 0}
				<p class="text-xs text-zinc-400">No world state established before this beat.</p>
			{:else}
				<table class="w-full table-fixed text-xs">
					<thead class="text-left text-[11px] text-zinc-500">
						<tr>
							<th class="w-[42%] font-medium">key</th>
							<th class="w-[22%] font-medium">value</th>
							<th class="font-medium">set by</th>
						</tr>
					</thead>
					<tbody>
						{#each incoming as [key, entry] (key)}
							{@const source = provenanceOf(entry.artifactId, ws.acceptedBridgeIds, NONE)}
							<tr
								class={[
									'border-t border-zinc-100 align-top',
									issueKeys.has(key) && 'bg-rose-50',
									!issueKeys.has(key) && preconditionKeys.has(key) && 'bg-accent-50/60'
								]}
							>
								<td class="py-0.5 pr-1 font-mono break-all text-zinc-700">{key}</td>
								<td class="py-0.5 pr-1 font-mono font-semibold break-all text-zinc-900"
									>{String(entry.value)}{entry.irreversible ? ' ⦿' : ''}</td
								>
								<td class="py-0.5">
									<button
										class="block w-full truncate text-left text-zinc-600 hover:underline"
										title="{beatRef(entry.artifactId)} · {PROVENANCE_LABEL[source]}"
										onclick={() => ws.focusArtifact(entry.artifactId)}
										>{beatRef(entry.artifactId)}</button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="text-[11px] text-zinc-400">
					Rose: key of an issue on this beat · tinted: a precondition of this beat · ⦿ irreversible
				</p>
			{/if}
			{#if replay.held.length > 0}
				<details class="text-xs">
					<summary class="cursor-pointer text-[11px] text-zinc-500"
						>Beliefs, rumours and hypotheses so far ({replay.held.length}) — never world state</summary
					>
					<ul class="mt-1 flex flex-col gap-0.5">
						{#each replay.held as view, i (i)}
							<li class="text-zinc-600">
								<span class="font-mono">{view.key}</span> =
								<span class="font-mono">{String(view.value)}</span>
								<span class="text-zinc-400"
									>({view.epistemic} of {view.holder}, {beatRef(view.artifactId)})</span
								>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</section>
	{/if}
</div>
