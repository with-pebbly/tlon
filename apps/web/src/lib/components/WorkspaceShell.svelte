<script lang="ts">
	import { resolve } from '$app/paths';
	import { setWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { Workspace } from '$lib/state/workspace.svelte';
	import { onMount } from 'svelte';

	import FractalView from './FractalView.svelte';
	import GraphView from './GraphView.svelte';
	import Inspector from './Inspector.svelte';
	import LeftRail from './LeftRail.svelte';
	import NewArtifactDialog from './NewArtifactDialog.svelte';
	import TimelineView from './TimelineView.svelte';
	import TopBar from './TopBar.svelte';

	let { projectId }: { projectId: string } = $props();

	// The route re-creates this component per project ({#key}), so the id is fixed here.
	// svelte-ignore state_referenced_locally
	const ws = setWorkspace(new Workspace(projectId));

	onMount(() => {
		ws.reload().catch((error: unknown) => toasts.error(error));
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;
		if (ws.selection) ws.select(null);
		ws.highlight = null;
	}
</script>

<svelte:window {onkeydown} />
<svelte:head><title>{ws.project?.name ?? 'Project'} · Tlön</title></svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
	<TopBar />
	{#if ws.loadError && !ws.graph}
		<div class="flex flex-1 items-center justify-center">
			<div class="panel max-w-md p-6 text-center">
				<div class="font-mono text-xs font-semibold text-rose-700">{ws.loadError.code}</div>
				<p class="mt-1 text-zinc-700">{ws.loadError.message}</p>
				<div class="mt-4 flex justify-center gap-2">
					<a class="btn" href={resolve('/')}>All projects</a>
					<button class="btn btn-primary" onclick={() => ws.reload().catch(() => {})}>Retry</button>
				</div>
			</div>
		</div>
	{:else if !ws.graph}
		<div class="flex flex-1 items-center justify-center text-zinc-500">Loading project…</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<LeftRail />
			<main class="relative min-w-0 flex-1 bg-zinc-100/60">
				{#if ws.view === 'graph'}
					<GraphView />
				{:else if ws.view === 'fractal'}
					<FractalView />
				{:else}
					<TimelineView />
				{/if}
			</main>
			<Inspector />
		</div>
	{/if}
</div>

{#if ws.newArtifactOpen}
	<NewArtifactDialog onclose={() => (ws.newArtifactOpen = false)} />
{/if}
