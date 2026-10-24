<!--
	Isolation audit (review P0 / BF-12, BF-13): what every task executor was served, by id
	only, and the server-side deny checks of each A/B participant against the opposite
	side. Facilitator only; no text is ever shown here.
-->
<script lang="ts">
	import { api } from '$lib/api';
	import { PARTICIPANT_ROLE_TEXT, TASK_STATE_CLASS, TASK_TYPE_SHORT } from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { formatTime } from '$lib/ui';
	import type { AuditReport } from '@tlon/contracts';

	const ws = getWorkspace();

	let audit = $state.raw<AuditReport | null>(null);
	let auditError = $state<string | null>(null);
	let loading = $state(false);

	const tasks = $derived((audit?.tasks ?? []).toSorted((a, b) => a.stageIndex - b.stageIndex));
	const crossScopeTotal = $derived(tasks.reduce((n, t) => n + t.crossScopeInputIds.length, 0));

	$effect(() => {
		void ws.revision;
		load();
	});

	function load() {
		loading = true;
		api
			.getAudit(ws.projectId)
			.then((next) => {
				audit = next;
				auditError = null;
			})
			.catch((error: unknown) => {
				auditError = error instanceof Error ? error.message : String(error);
			})
			.finally(() => (loading = false));
	}
</script>

<section class="panel flex flex-col gap-3 p-4" aria-labelledby="audit-h" data-testid="audit">
	<div class="flex items-baseline gap-2">
		<h2 id="audit-h" class="font-semibold text-zinc-900">Isolation audit</h2>
		<span class="text-xs text-zinc-500">ids only — what each executor was served</span>
		<button class="btn btn-ghost btn-sm ml-auto" disabled={loading} onclick={load}
			>{loading ? 'Checking…' : 'Re-check'}</button
		>
	</div>

	{#if auditError}
		<p class="text-sm text-rose-700" role="alert">Audit unavailable: {auditError}</p>
	{:else if audit}
		<div
			class={[
				'rounded border px-2 py-1.5 text-sm',
				audit.isolationVerified === true && 'border-emerald-300 bg-emerald-50 text-emerald-900',
				audit.isolationVerified === false && 'border-rose-300 bg-rose-50 text-rose-900',
				audit.isolationVerified === 'unknown' && 'border-zinc-300 bg-zinc-50 text-zinc-700'
			]}
			data-testid="audit-verdict"
		>
			<span class="font-medium">Isolation verified: {audit.isolationVerified}</span>
			<span class="text-xs">
				{#if audit.isolationVerified === true}
					— every served A/B input set and every deny check is clean.
				{:else if audit.isolationVerified === false}
					— {crossScopeTotal} cross-scope input(s) served or an opposite-side Block is visible.
				{:else}
					— no task view has been served yet, so there is nothing to verify.
				{/if}
			</span>
		</div>

		<div class="overflow-x-auto">
			<table class="w-full text-left text-[13px]" aria-label="Audited tasks">
				<thead class="text-[11px] text-zinc-500">
					<tr>
						<th>Stage</th><th>Type</th><th>Role</th><th>Executor</th><th>State</th><th
							title="Inputs served in the last task view">#inputs</th
						><th>Cross-scope inputs</th>
					</tr>
				</thead>
				<tbody>
					{#each tasks as t (t.taskId)}
						<tr data-testid="audit-task-row">
							<td>{t.stageIndex}</td>
							<td>{TASK_TYPE_SHORT[t.type]}</td>
							<td title={PARTICIPANT_ROLE_TEXT[t.role]}>{t.role}</td>
							<td>{t.executorKind ?? '—'}</td>
							<td><span class={['chip', TASK_STATE_CLASS[t.state]]}>{t.state}</span></td>
							<td
								title={t.manifest
									? `served ${formatTime(t.manifest.servedAt)} · ${t.manifest.disclosureGrantIds.length} disclosure grant(s)`
									: 'never served'}>{t.manifest ? t.manifest.inputs.length : '—'}</td
							>
							<td>
								{#if t.crossScopeInputIds.length > 0}
									<span class="font-medium text-rose-700"
										>{t.crossScopeInputIds.length}: {t.crossScopeInputIds
											.map((id) => ws.blockLabel(id))
											.join(', ')}</span
									>
								{:else}
									<span class="text-zinc-400">0</span>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="text-zinc-400">No tasks.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="flex flex-col gap-1">
			<h3 class="section-title">Deny checks</h3>
			<ul class="flex flex-col gap-0.5 text-xs" aria-label="Deny checks">
				{#each audit.denyChecks as check (check.principalId)}
					<li class="flex items-center gap-2">
						<span class="chip border-zinc-300 bg-zinc-50 font-mono text-zinc-800">{check.role}</span
						>
						<span class="text-zinc-700">{ws.principalLabel(check.principalId)}</span>
						<span class="text-zinc-500"
							>{check.checkedArtifacts} opposite-side Block(s) checked</span
						>
						{#if check.visibleArtifactIds.length > 0}
							<span class="font-medium text-rose-700"
								>visible: {check.visibleArtifactIds.map((id) => ws.blockLabel(id)).join(', ')}</span
							>
						{:else}
							<span class="text-emerald-700">none visible</span>
						{/if}
					</li>
				{:else}
					<li class="text-zinc-400">No A/B participants to check.</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="text-sm text-zinc-400">Loading audit…</p>
	{/if}
</section>
