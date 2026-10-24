<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		COMPLETION_POLICY_HINT,
		COMPLETION_POLICY_LABEL,
		PARTICIPANT_ROLE_TEXT,
		TASK_STATE_CLASS,
		TASK_TYPE_SHORT
	} from '$lib/protocol';
	import { setWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { Workspace } from '$lib/state/workspace.svelte';
	import { formatTime } from '$lib/ui';
	import {
		AGENT_ROLES,
		CompletionPolicy,
		EXECUTOR_KINDS,
		MAX_AGENT_TOKEN_TTL_SECONDS,
		type AgentRole,
		type ExecutorKind,
		type Task
	} from '@tlon/contracts';
	import { onMount } from 'svelte';

	import AuditPanel from './AuditPanel.svelte';
	import CompletionPanel from './CompletionPanel.svelte';
	import ConnectionsPanel from './ConnectionsPanel.svelte';
	import TriangleCard from './TriangleCard.svelte';

	let { projectId }: { projectId: string } = $props();

	// The route re-creates this component per project ({#key}), so the id is fixed here.
	// svelte-ignore state_referenced_locally
	const ws = setWorkspace(new Workspace(projectId));

	const TTL_OPTIONS = [
		{ seconds: 8 * 60 * 60, label: '8 hours' },
		{ seconds: 24 * 60 * 60, label: '1 day' },
		{ seconds: MAX_AGENT_TOKEN_TTL_SECONDS, label: '7 days' }
	];

	let busy = $state<string | null>(null);
	let role = $state<AgentRole>('A');
	let name = $state('');
	let executorKind = $state<ExecutorKind>('human');
	let ttlSeconds = $state(24 * 60 * 60);
	/** Links minted in this page session: the token is shown once and never persisted. */
	let links = $state.raw<{ principalId: string; url: string; expiresAt: string }[]>([]);

	let briefA = $state('');
	let briefB = $state('');
	let factReview = $state<'facilitator' | 'mediator'>('facilitator');
	let maxDepth = $state(3);
	let completionPolicy = $state<CompletionPolicy>('exploratory');

	let gapLeft = $state('');
	let gapRight = $state('');

	/** Anchorable artifacts for a manual gap: Blocks and composites, never a Fact itself. */
	const anchorable = $derived(
		ws.artifacts.filter(
			(a) => a.artifactClass !== 'FACT' && a.status !== 'REJECTED' && a.status !== 'ARCHIVED'
		)
	);
	const stages = $derived.by(() => {
		const map = new Map<number, Task[]>();
		for (const task of ws.tasks)
			map.set(task.stageIndex, [...(map.get(task.stageIndex) ?? []), task]);
		return [...map].toSorted(([a], [b]) => a - b);
	});
	const triangles = $derived(
		ws.triangles.toSorted((a, b) => a.depth - b.depth || a.createdAt.localeCompare(b.createdAt))
	);

	onMount(() => {
		ws.reload().catch((error: unknown) => toasts.error(error));
		ws.reloadGateway().catch(() => {});
	});

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

	const linkUrl = (token: string) => `${window.location.origin}/p#${token}`;

	function createParticipant(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed === '') return;
		void run('participant', async () => {
			const link = await ws.createParticipant({ role, name: trimmed, executorKind, ttlSeconds });
			links = [
				...links.filter((l) => l.principalId !== link.principalId),
				{ principalId: link.principalId, url: linkUrl(link.token), expiresAt: link.expiresAt }
			];
			name = '';
		});
	}

	function newLink(principalId: string) {
		void run(`link:${principalId}`, async () => {
			const issued = await ws.issueToken(principalId, ttlSeconds);
			links = [
				...links.filter((l) => l.principalId !== principalId),
				{ principalId, url: linkUrl(issued.token), expiresAt: issued.expiresAt }
			];
		});
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toasts.push('info', 'Link copied.');
		} catch {
			toasts.push('error', 'Clipboard unavailable — select the link and copy it manually.');
		}
	}

	function startRun(event: SubmitEvent) {
		event.preventDefault();
		if (briefA.trim() === '' || briefB.trim() === '') return;
		void run('run', async () => {
			await ws.startRun({ briefA, briefB, config: { factReview, maxDepth, completionPolicy } });
			briefA = '';
			briefB = '';
			toasts.push('info', 'Run started: A and B have their seed tasks.');
		});
	}

	function openGap(event: SubmitEvent) {
		event.preventDefault();
		if (gapLeft === '' || gapRight === '' || gapLeft === gapRight) return;
		void run('gap', async () => {
			await ws.connect({
				left: { artifactId: gapLeft },
				right: { artifactId: gapRight },
				...(ws.runs[0] ? { runId: ws.runs[0].id } : {})
			});
			gapLeft = '';
			gapRight = '';
			toasts.push('info', 'Gap opened: C has a new task.');
		});
	}
</script>

<svelte:head><title>Protocol · {ws.project?.name ?? 'Project'} · Tlön</title></svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
	<header class="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3">
		<a
			href={resolve('/projects/[projectId]', { projectId })}
			class="btn btn-ghost btn-sm text-zinc-500">◂ Workspace</a
		>
		<h1 class="truncate font-semibold text-zinc-900">
			Protocol · {ws.project?.name ?? '…'}
		</h1>
		{#if ws.pending > 0 || ws.loading}<span class="text-xs text-zinc-400">Syncing…</span>{/if}
		<button class="btn btn-sm ml-auto" onclick={() => ws.reload().catch((e) => toasts.error(e))}
			>Refresh</button
		>
	</header>

	<main class="min-h-0 flex-1 overflow-y-auto bg-zinc-100/60">
		<div class="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-2">
			{#if ws.protocolError}
				<p class="panel p-3 text-sm text-rose-700 lg:col-span-2" role="alert">
					Protocol state unavailable: {ws.protocolError.message}
				</p>
			{/if}

			<section class="panel flex flex-col gap-3 p-4" aria-labelledby="participants-h">
				<h2 id="participants-h" class="font-semibold text-zinc-900">Participants</h2>
				<form class="grid grid-cols-2 gap-2 sm:grid-cols-4" onsubmit={createParticipant}>
					<div>
						<label class="label" for="p-role">Role</label>
						<select id="p-role" class="input" bind:value={role}>
							{#each AGENT_ROLES as r (r)}<option value={r}>{r}</option>{/each}
						</select>
					</div>
					<div>
						<label class="label" for="p-name">Name</label>
						<input id="p-name" class="input" maxlength="100" bind:value={name} />
					</div>
					<div>
						<label class="label" for="p-kind">Executor</label>
						<select id="p-kind" class="input" bind:value={executorKind}>
							{#each EXECUTOR_KINDS as k (k)}<option value={k}>{k}</option>{/each}
						</select>
					</div>
					<div>
						<label class="label" for="p-ttl">Link valid for</label>
						<select id="p-ttl" class="input" bind:value={ttlSeconds}>
							{#each TTL_OPTIONS as o (o.seconds)}<option value={o.seconds}>{o.label}</option
								>{/each}
						</select>
					</div>
					<div class="col-span-2 flex justify-end sm:col-span-4">
						<button
							class="btn btn-primary"
							type="submit"
							disabled={busy !== null || name.trim() === ''}
							>{busy === 'participant' ? 'Creating…' : 'Create participant'}</button
						>
					</div>
				</form>
				{#if ws.agents.length === 0}
					<p class="text-sm text-zinc-500">No participants yet.</p>
				{:else}
					<ul class="flex flex-col gap-2" aria-label="Participants">
						{#each ws.agents as agent (agent.id)}
							{@const link = links.find((l) => l.principalId === agent.id)}
							<li
								class="flex flex-col gap-1 rounded border border-zinc-200 px-2 py-1.5"
								data-testid="participant-row"
								data-role={agent.role}
								data-name={agent.name}
							>
								<div class="flex items-center gap-2 text-sm">
									<span class="chip border-zinc-300 bg-zinc-50 font-mono text-zinc-800"
										>{agent.role}</span
									>
									<span class="font-medium text-zinc-900">{agent.name}</span>
									<span class="text-xs text-zinc-500">{agent.executorKind}</span>
									{#if agent.disabledAt}<span class="text-xs text-zinc-400">disabled</span>{/if}
									<button
										class="btn btn-ghost btn-sm ml-auto"
										disabled={busy !== null || agent.disabledAt !== null}
										onclick={() => newLink(agent.id)}>New link</button
									>
								</div>
								{#if link}
									<div class="flex items-center gap-2">
										<input
											class="input font-mono text-[11px]"
											readonly
											value={link.url}
											aria-label="Participant link for {agent.role} {agent.name}"
											data-testid="participant-link"
											onfocus={(e) => e.currentTarget.select()}
										/>
										<button class="btn btn-sm" onclick={() => copy(link.url)}>Copy</button>
									</div>
									<p class="text-[11px] text-zinc-500">
										Expires {formatTime(link.expiresAt)}. Shown only now — the server keeps a hash.
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="panel flex flex-col gap-3 p-4" aria-labelledby="run-h">
				<h2 id="run-h" class="font-semibold text-zinc-900">Start a run</h2>
				<form class="flex flex-col gap-2" onsubmit={startRun}>
					<div>
						<label class="label" for="brief-a">Brief for A (only A sees it)</label>
						<textarea id="brief-a" class="input min-h-16 py-1.5" bind:value={briefA}></textarea>
					</div>
					<div>
						<label class="label" for="brief-b">Brief for B (only B sees it)</label>
						<textarea id="brief-b" class="input min-h-16 py-1.5" bind:value={briefB}></textarea>
					</div>
					<div class="flex flex-wrap items-end gap-2">
						<div>
							<label class="label" for="policy">Who accepts Facts</label>
							<select id="policy" class="input" bind:value={factReview}>
								<option value="facilitator">facilitator</option>
								<option value="mediator">mediator (C)</option>
							</select>
						</div>
						<div>
							<label class="label" for="max-depth">Max depth</label>
							<input
								id="max-depth"
								class="input w-20"
								type="number"
								min="1"
								max="16"
								bind:value={maxDepth}
							/>
						</div>
						<div>
							<label class="label" for="run-completion">Aims for</label>
							<select
								id="run-completion"
								class="input"
								title={COMPLETION_POLICY_HINT[completionPolicy]}
								bind:value={completionPolicy}
							>
								{#each CompletionPolicy.options as option (option)}
									<option value={option}>{COMPLETION_POLICY_LABEL[option]}</option>
								{/each}
							</select>
						</div>
						<button
							class="btn btn-primary ml-auto"
							type="submit"
							disabled={busy !== null || briefA.trim() === '' || briefB.trim() === ''}
							>{busy === 'run' ? 'Starting…' : 'Start run'}</button
						>
					</div>
				</form>
				{#if ws.runs.length > 0}
					<ul class="flex flex-col gap-1 text-sm" aria-label="Runs">
						{#each ws.runs as r (r.id)}
							<li class="flex items-center gap-2">
								<span class="font-mono text-[11px] text-zinc-500">{r.id.slice(0, 8)}</span>
								<span>{r.status}</span>
								<span class="text-xs text-zinc-500"
									>{r.config.participantMode} · facts by {r.config.factReview} · depth ≤ {r.config
										.maxDepth} · aims for {COMPLETION_POLICY_LABEL[
										r.config.completionPolicy ?? 'exploratory'
									]}</span
								>
								<span class="ml-auto text-xs text-zinc-500">{formatTime(r.createdAt)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="panel flex flex-col gap-3 p-4" aria-labelledby="tasks-h">
				<h2 id="tasks-h" class="font-semibold text-zinc-900">Task board</h2>
				{#if stages.length === 0}
					<p class="text-sm text-zinc-500">No tasks yet — start a run.</p>
				{/if}
				{#each stages as [stage, tasks] (stage)}
					<div>
						<h3 class="section-title mb-1">Stage {stage}</h3>
						<table class="w-full table-fixed text-left text-[13px]">
							<thead class="text-[11px] text-zinc-500">
								<tr><th>Type</th><th>Role</th><th>Assignee</th><th>Side</th><th>State</th></tr>
							</thead>
							<tbody>
								{#each tasks as task (task.id)}
									<tr data-testid="task-board-row" data-type={task.type} data-state={task.state}>
										<td>{TASK_TYPE_SHORT[task.type]}</td>
										<td title={PARTICIPANT_ROLE_TEXT[task.role]}>{task.role}</td>
										<td
											>{task.assigneePrincipalId
												? ws.principalLabel(task.assigneePrincipalId)
												: 'any ' + task.role}</td
										>
										<td>{task.side ?? '—'}{task.direction ? ` · ${task.direction}` : ''}</td>
										<td><span class={['chip', TASK_STATE_CLASS[task.state]]}>{task.state}</span></td
										>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/each}
			</section>

			<section class="panel flex flex-col gap-3 p-4" aria-labelledby="gap-h">
				<h2 id="gap-h" class="font-semibold text-zinc-900">Propose connecting Fact</h2>
				<p class="text-xs text-zinc-500">
					Open a gap between any two Blocks or composites; C gets a task to propose a Fact. (In the
					Graph view: shift-select two blocks.)
				</p>
				<form class="grid grid-cols-[1fr_1fr_auto] items-end gap-2" onsubmit={openGap}>
					<div>
						<label class="label" for="gap-left">Left</label>
						<select id="gap-left" class="input" bind:value={gapLeft}>
							<option value="">—</option>
							{#each anchorable as a (a.id)}<option value={a.id}>{a.title}</option>{/each}
						</select>
					</div>
					<div>
						<label class="label" for="gap-right">Right</label>
						<select id="gap-right" class="input" bind:value={gapRight}>
							<option value="">—</option>
							{#each anchorable as a (a.id)}<option value={a.id}>{a.title}</option>{/each}
						</select>
					</div>
					<button
						class="btn btn-primary"
						type="submit"
						disabled={busy !== null || gapLeft === '' || gapRight === '' || gapLeft === gapRight}
						>{busy === 'gap' ? 'Opening…' : 'Open gap'}</button
					>
				</form>
			</section>

			<CompletionPanel />
			<ConnectionsPanel />
			<div class="lg:col-span-2"><AuditPanel /></div>

			<section class="flex flex-col gap-3 lg:col-span-2" aria-labelledby="triangles-h">
				<h2 id="triangles-h" class="font-semibold text-zinc-900">Triangles</h2>
				{#if triangles.length === 0}
					<p class="text-sm text-zinc-500">No triangles yet.</p>
				{/if}
				<div class="grid gap-3 lg:grid-cols-2">
					{#each triangles as triangle (triangle.id)}
						<TriangleCard {triangle} />
					{/each}
				</div>
			</section>
		</div>
	</main>
</div>
