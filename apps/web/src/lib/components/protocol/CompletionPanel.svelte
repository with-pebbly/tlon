<!--
	Organizer-only completion report (review §4.5): a live `GET /completion?policy=` for the
	chosen policy, certification (a separate, recorded act) and the certification history.
	`unknown` is rendered literally — it is never rounded to 0 or "yes".
-->
<script lang="ts">
	import { api, isApiError } from '$lib/api';
	import { COMPLETION_POLICY_HINT, COMPLETION_POLICY_LABEL } from '$lib/protocol';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime } from '$lib/ui';
	import { CompletionPolicy, type Certification, type CompletionReport } from '@tlon/contracts';

	const ws = getWorkspace();

	const POLICIES = CompletionPolicy.options;
	const QUESTION_KIND_LABEL: Record<CompletionReport['openQuestions'][number]['kind'], string> = {
		open_mystery: 'open mystery',
		causal_hypothesis: 'unconfirmed hypothesis',
		unexplained_fact_link: 'unexplained Fact link'
	};

	/** null = follow the current run's policy. */
	let chosen = $state<CompletionPolicy | null>(null);
	const policy = $derived(chosen ?? ws.completionPolicy);

	let report = $state.raw<CompletionReport | null>(null);
	let reportError = $state<string | null>(null);
	let certifications = $state.raw<Certification[]>([]);
	let certifying = $state(false);
	/** Reasons of the last refused certification (409 COMPLETION_BLOCKED). */
	let refused = $state.raw<{ policy: CompletionPolicy; reasons: string[] } | null>(null);
	/** Strictest policy the project can be certified under right now (policy order = strictness). */
	const highest = $derived(
		POLICIES.findLast((option) => report?.certifiableAs[option] === true) ?? null
	);

	$effect(() => {
		const current = policy;
		// Re-fetch whenever the graph or the connections change.
		void ws.revision;
		void ws.connectionsRevision;
		let cancelled = false;
		api
			.getCompletion(ws.projectId, current)
			.then((next) => {
				if (cancelled) return;
				report = next;
				reportError = null;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				report = null;
				reportError = error instanceof Error ? error.message : String(error);
			});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		void ws.connectionsRevision;
		loadCertifications();
	});

	function loadCertifications() {
		api
			.listCertifications(ws.projectId)
			.then((list) => (certifications = list.items))
			.catch((error: unknown) => toasts.error(error));
	}
	async function certify() {
		certifying = true;
		refused = null;
		const target = policy;
		try {
			await api.certify(ws.projectId, target);
			toasts.push('info', `Certified as “${COMPLETION_POLICY_LABEL[target]}”.`);
			loadCertifications();
		} catch (error) {
			if (!isApiError(error) || error.code !== 'COMPLETION_BLOCKED') {
				toasts.error(error);
				return;
			}
			const { details } = error;
			const reasons =
				typeof details === 'object' &&
				details !== null &&
				'reasons' in details &&
				Array.isArray(details.reasons)
					? details.reasons.map(String)
					: [error.message];
			refused = { policy: target, reasons };
		} finally {
			certifying = false;
		}
	}
</script>

<section
	class="panel flex flex-col gap-3 p-4"
	aria-labelledby="completion-h"
	data-testid="completion"
>
	<div class="flex items-baseline gap-2">
		<h2 id="completion-h" class="font-semibold text-zinc-900">Completion</h2>
		<span class="text-xs text-zinc-500">organizer-only · never shown to A or B</span>
	</div>

	<div class="flex flex-col gap-1">
		<label class="label" for="completion-policy">Policy</label>
		<select
			id="completion-policy"
			class="input"
			value={policy}
			onchange={(e) => {
				chosen = CompletionPolicy.parse(e.currentTarget.value);
				refused = null;
			}}
		>
			{#each POLICIES as option (option)}
				<option value={option}
					>{COMPLETION_POLICY_LABEL[option]}{option === ws.completionPolicy
						? ' (run default)'
						: ''}</option
				>
			{/each}
		</select>
		<p class="text-xs text-zinc-500">{COMPLETION_POLICY_HINT[policy]}</p>
	</div>

	{#if reportError}
		<p class="text-sm text-rose-700" role="alert">Completion report unavailable: {reportError}</p>
	{:else if report === null}
		<p class="text-sm text-zinc-400">Loading report…</p>
	{:else}
		<dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="completion-report">
			<dt class="text-zinc-600" title="Triangles whose Fact joins two Blocks — a link, not a cause">
				Connected Fact pairs
			</dt>
			<dd class="font-mono">{report.connectedFactPairs}</dd>
			<dt class="text-zinc-600" title="Approved causal canon connections across A and B">
				Confirmed cross-branch causal paths
			</dt>
			<dd class="font-mono" data-testid="causal-paths">{report.confirmedCrossBranchCausalPaths}</dd>
			<dt class="text-zinc-600">Chronology conflicts</dt>
			<dd class={['font-mono', report.chronologyConflicts > 0 && 'text-amber-700']}>
				{report.chronologyConflicts}
			</dd>
			<dt class="text-zinc-600">Open blockers</dt>
			<dd class={['font-mono', report.blockers > 0 && 'text-rose-700']}>{report.blockers}</dd>
			<dt class="text-zinc-600" title="From the isolation audit of served task inputs">
				Isolation verified
			</dt>
			<dd
				class={[
					'font-mono',
					report.isolationVerified === true && 'text-emerald-700',
					report.isolationVerified === false && 'text-rose-700'
				]}
			>
				{report.isolationVerified}
			</dd>
		</dl>

		<div class="flex flex-col gap-1">
			<h3 class="section-title">Open questions ({report.openQuestions.length})</h3>
			{#if report.openQuestions.length === 0}
				<p class="text-xs text-zinc-400">None.</p>
			{/if}
			<ul class="flex flex-col gap-1" aria-label="Open questions">
				{#each report.openQuestions as q, i (`${i}:${q.connectionId ?? q.endpointIds.join('|')}`)}
					<li class="flex flex-col gap-0.5 rounded border border-zinc-200 px-2 py-1 text-xs">
						<div class="flex flex-wrap items-center gap-1">
							<span class="chip border-zinc-300 bg-zinc-50 text-zinc-700"
								>{QUESTION_KIND_LABEL[q.kind]}</span
							>
							{#if q.intentional}
								<span
									class="chip border-violet-300 bg-violet-50 text-violet-800"
									title="Approved by a facilitator as intentional ambiguity">intentional</span
								>
							{/if}
							<span class="text-zinc-500"
								>{q.endpointIds.map((id) => ws.blockLabel(id)).join(' ↔ ')}</span
							>
						</div>
						<p class="text-zinc-800">{q.statement}</p>
					</li>
				{/each}
			</ul>
		</div>

		{#if report.motifSignals.length > 0}
			<div class="flex flex-col gap-1">
				<h3 class="section-title">Motif signals · advisory</h3>
				<ul class="flex flex-col gap-0.5 text-xs text-zinc-600" aria-label="Motif signals">
					{#each report.motifSignals as s, i (`${i}:${s.artifactId}`)}
						<li><span class="font-medium">{ws.title(s.artifactId)}</span> — {s.signal}</li>
					{/each}
				</ul>
				<p class="text-[11px] text-zinc-400">
					Never blocks certification; quiet scenes stay valid.
				</p>
			</div>
		{/if}

		<div class="flex flex-col gap-1" data-testid="certifiable-as">
			<h3 class="section-title">
				Certifiable as · highest: {highest === null ? 'none' : COMPLETION_POLICY_LABEL[highest]}
			</h3>
			<table class="w-full text-left text-[13px]">
				<tbody>
					{#each POLICIES as option (option)}
						{@const ok = report.certifiableAs[option]}
						<tr
							class={[
								option === report.policy && 'bg-accent-50 font-medium ring-1 ring-accent-200'
							]}
							data-policy={option}
							data-certifiable={ok}
						>
							<td class="px-1.5 py-0.5" title={COMPLETION_POLICY_HINT[option]}
								>{COMPLETION_POLICY_LABEL[option]}{option === report.policy
									? ' · requested'
									: ''}</td
							>
							<td class={['px-1.5 py-0.5 text-right', ok ? 'text-emerald-700' : 'text-rose-700']}
								>{ok ? '✓ certifiable' : '✗ not certifiable'}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div
			class={[
				'flex flex-col gap-1 rounded border px-2 py-1.5 text-sm',
				report.certifiableAs[report.policy]
					? 'border-emerald-300 bg-emerald-50 text-emerald-900'
					: 'border-amber-300 bg-amber-50 text-amber-900'
			]}
			data-testid="certifiable"
		>
			<span class="font-medium"
				>{report.certifiableAs[report.policy]
					? `Certifiable as “${COMPLETION_POLICY_LABEL[report.policy]}”`
					: `Not certifiable as “${COMPLETION_POLICY_LABEL[report.policy]}”`}</span
			>
			{#if report.reasons.length > 0}
				<ul class="list-disc pl-5 text-xs">
					{#each report.reasons as reason, i (i)}<li>{reason}</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<div class="flex items-center gap-2">
		<button class="btn btn-primary" disabled={certifying} onclick={certify}
			>{certifying ? 'Certifying…' : `Certify “${COMPLETION_POLICY_LABEL[policy]}”`}</button
		>
		<span class="text-xs text-zinc-500">Records the report as it stands now.</span>
	</div>
	{#if refused}
		<div
			class="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800"
			role="alert"
		>
			<p class="font-medium">
				Certification as “{COMPLETION_POLICY_LABEL[refused.policy]}” refused:
			</p>
			<ul class="list-disc pl-5">
				{#each refused.reasons as reason, i (i)}<li>{reason}</li>{/each}
			</ul>
		</div>
	{/if}

	{#if certifications.length > 0}
		<div class="flex flex-col gap-1">
			<h3 class="section-title">Certifications</h3>
			<ul class="flex flex-col gap-0.5 text-xs" aria-label="Certifications">
				{#each certifications as c (c.id)}
					<li class="flex items-center gap-2">
						<span class="chip border-emerald-300 bg-emerald-50 text-emerald-800"
							>{COMPLETION_POLICY_LABEL[c.policy]}</span
						>
						<span class="text-zinc-600">{ws.principalLabel(c.actorId)}</span>
						<span class="text-zinc-500"
							>{c.report.connectedFactPairs} Fact pairs · causal paths {c.report
								.confirmedCrossBranchCausalPaths} · {c.report.openQuestions.length} open</span
						>
						<span class="ml-auto text-zinc-400">{formatTime(c.createdAt)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
