<script lang="ts">
	import { afterNavigate, replaceState } from '$app/navigation';
	import { api, isApiError, setBearerToken } from '$lib/api';
	import {
		inboxOrder,
		PARTICIPANT_ROLE_TEXT,
		PARTICIPANT_TOKEN_KEY,
		TASK_TYPE_LABEL
	} from '$lib/protocol';
	import type { SubmitTaskResult, Task, TaskSubmission, TaskView, WhoAmI } from '@tlon/contracts';
	import { onMount } from 'svelte';

	import AdvanceEditor from './AdvanceEditor.svelte';
	import ProposeFactEditor from './ProposeFactEditor.svelte';
	import SeedEditor from './SeedEditor.svelte';

	/** Inbox refresh while waiting for the next task (the other side may still be writing). */
	const POLL_MS = 8000;

	let me = $state.raw<WhoAmI | null>(null);
	let tasks = $state.raw<Task[]>([]);
	/** Link-level failure: no token, expired or revoked. */
	let fatal = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let view = $state.raw<TaskView | null>(null);
	let opening = $state<string | null>(null);
	let done = $state.raw<SubmitTaskResult | null>(null);
	let busy = $state(false);
	let submitError = $state<string[] | null>(null);
	/** Idempotency key per task draft, kept until the server confirms the submission. */
	const draftKeys = new Map<string, string>();

	const pending = $derived(tasks.filter((t) => t.state === 'pending'));
	const ordered = $derived(inboxOrder(tasks));

	function messagesOf(error: unknown): string[] {
		if (!isApiError(error)) return [error instanceof Error ? error.message : String(error)];
		if (error.status === 401)
			return ['This link is invalid or has expired. Ask the facilitator for a new one.'];
		const issues = Array.isArray(error.details) ? error.details : [];
		const details = issues.flatMap((issue: unknown) =>
			typeof issue === 'object' && issue !== null && 'message' in issue
				? [String(issue.message)]
				: []
		);
		return details.length > 0 ? details : [error.message];
	}

	async function loadInbox() {
		try {
			const who = me ?? (await api.whoami());
			if (who.kind !== 'AGENT' || who.projectId === null) {
				fatal = 'This page needs a participant link from the facilitator.';
				return;
			}
			me = who;
			tasks = (await api.listMyTasks(who.projectId)).items;
			loadError = null;
		} catch (error) {
			if (isApiError(error) && error.status === 401) fatal = messagesOf(error)[0] ?? null;
			else loadError = messagesOf(error).join(' ');
		}
	}

	async function open(task: Task) {
		if (!me?.projectId) return;
		opening = task.id;
		submitError = null;
		try {
			view = await api.getTaskView(me.projectId, task.id);
		} catch (error) {
			loadError = messagesOf(error).join(' ');
		} finally {
			opening = null;
		}
	}

	async function submit(submission: TaskSubmission) {
		if (!me?.projectId || !view) return;
		const taskId = view.task.id;
		let key = draftKeys.get(taskId);
		if (!key) {
			key = `${taskId}:${crypto.randomUUID()}`;
			draftKeys.set(taskId, key);
		}
		busy = true;
		submitError = null;
		try {
			done = await api.submitTask(me.projectId, taskId, { submission, idempotencyKey: key });
			draftKeys.delete(taskId);
			view = null;
			await loadInbox();
		} catch (error) {
			submitError = messagesOf(error);
		} finally {
			busy = false;
		}
	}

	function backToInbox() {
		view = null;
		done = null;
		submitError = null;
		void loadInbox();
	}

	// The link carries the token in the hash (never sent to a server); keep it for this tab.
	const fromHash = decodeURIComponent(window.location.hash.slice(1)).trim();
	if (fromHash !== '') sessionStorage.setItem(PARTICIPANT_TOKEN_KEY, fromHash);

	// Drop the secret from the address bar and history once the router can rewrite the URL.
	afterNavigate(() => {
		if (window.location.hash !== '')
			replaceState(window.location.pathname + window.location.search, {});
	});

	onMount(() => {
		const token = sessionStorage.getItem(PARTICIPANT_TOKEN_KEY);
		if (!token) {
			fatal = 'This page needs a participant link from the facilitator.';
			return;
		}
		setBearerToken(token);
		void loadInbox();
		const timer = setInterval(() => {
			if (view === null && done === null && fatal === null && !document.hidden) void loadInbox();
		}, POLL_MS);
		return () => {
			clearInterval(timer);
			setBearerToken(null);
		};
	});
</script>

<svelte:head><title>Your tasks · Tlön</title></svelte:head>

<div class="min-h-screen bg-zinc-100/60">
	<header class="border-b border-zinc-200 bg-white">
		<div class="mx-auto flex h-12 max-w-4xl items-center gap-3 px-4">
			<span class="font-semibold text-zinc-900">Tlön</span>
			{#if me}
				<span class="chip border-zinc-300 bg-zinc-50 text-zinc-700" data-testid="participant-role"
					>{PARTICIPANT_ROLE_TEXT[me.role]}</span
				>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-4xl px-4 py-6">
		{#if fatal}
			<div class="panel p-6 text-center" role="alert">
				<p class="text-zinc-800">{fatal}</p>
			</div>
		{:else if done}
			<section class="panel flex flex-col gap-3 p-6" aria-live="polite">
				<h1 class="text-lg font-semibold text-zinc-900">
					{done.replayed ? 'Already submitted' : 'Submitted — thank you'}
				</h1>
				<p class="text-zinc-700">
					{done.replayed
						? 'This submission had already reached the server; nothing was sent twice.'
						: 'Your work was saved. The next task appears in your inbox when it is ready.'}
				</p>
				{#if done.warnings.length > 0}
					<ul class="list-disc pl-5 text-sm text-amber-800">
						{#each done.warnings as warning, i (i)}<li>{warning}</li>{/each}
					</ul>
				{/if}
				<div><button class="btn btn-primary" onclick={backToInbox}>Back to inbox</button></div>
			</section>
		{:else if view}
			<div class="mb-4 flex items-center gap-3">
				<button class="btn btn-ghost btn-sm" onclick={backToInbox}>◂ Inbox</button>
				<h1 class="text-lg font-semibold text-zinc-900">{TASK_TYPE_LABEL[view.type]}</h1>
			</div>
			<div class="panel p-5">
				{#key view.task.id}
					{#if view.type === 'seed_block'}
						<SeedEditor {view} {busy} onsubmit={submit} />
					{:else if view.type === 'propose_fact'}
						<ProposeFactEditor {view} {busy} onsubmit={submit} />
					{:else}
						<AdvanceEditor {view} {busy} onsubmit={submit} />
					{/if}
				{/key}
				{#if submitError}
					<div
						class="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"
						role="alert"
					>
						<p class="font-semibold">Not submitted:</p>
						<ul class="list-disc pl-5">
							{#each submitError as message, i (i)}<li>{message}</li>{/each}
						</ul>
					</div>
				{/if}
			</div>
		{:else}
			<div class="mb-4 flex items-center justify-between">
				<h1 class="text-lg font-semibold text-zinc-900">Your tasks</h1>
				<button class="btn btn-sm" onclick={() => void loadInbox()}>Refresh</button>
			</div>
			{#if loadError}
				<p class="mb-3 text-sm text-rose-700" role="alert">{loadError}</p>
			{/if}
			{#if !me}
				<p class="text-zinc-500">Loading…</p>
			{:else if tasks.length === 0}
				<p class="panel p-5 text-zinc-600">
					Nothing to do yet. This page checks for new tasks every few seconds.
				</p>
			{:else}
				{#if pending.length === 0}
					<p class="mb-3 text-sm text-zinc-600">
						All done for now — the next task appears here when it is ready.
					</p>
				{/if}
				<ul class="flex flex-col gap-2" aria-label="Tasks">
					{#each ordered as task (task.id)}
						<li class="panel flex items-center gap-3 px-4 py-3" data-testid="task-row">
							<div class="min-w-0 flex-1">
								<div class="font-medium text-zinc-900">{TASK_TYPE_LABEL[task.type]}</div>
								<div class="text-xs text-zinc-500">
									{task.state === 'pending' ? 'Waiting for you' : `Status: ${task.state}`}
								</div>
							</div>
							{#if task.state === 'pending'}
								<button
									class="btn btn-primary"
									disabled={opening !== null}
									onclick={() => open(task)}>{opening === task.id ? 'Opening…' : 'Start'}</button
								>
							{:else}
								<span class="chip border-emerald-300 bg-emerald-50 text-emerald-800">Done</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</main>
</div>
