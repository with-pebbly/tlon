<script lang="ts">
	import { resolve } from '$app/paths';
	import { api } from '$lib/api';
	import { renderIssuesMarkdown } from '$lib/continuity';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { VIEWS } from '$lib/state/workspace.svelte';
	import { renderStoryMarkdown } from '@tlon/core';
	import { tick } from 'svelte';

	import KindBadge from './KindBadge.svelte';

	const ws = getWorkspace();

	const VIEW_LABEL = { graph: 'Graph', fractal: 'Fractal', timeline: 'Timeline' } as const;

	let search = $state('');
	let searchOpen = $state(false);
	let exporting = $state(false);

	const results = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (q === '') return [];
		return ws.artifacts.filter((a) => a.title.toLowerCase().includes(q)).slice(0, 8);
	});
	const unresolvedTensions = $derived(
		ws.tensions.filter((t) => t.resolvedByExpansionId === null).length
	);

	function pick(id: string) {
		search = '';
		searchOpen = false;
		ws.focusArtifact(id);
	}

	function download(name: string, content: string, type: string) {
		const url = URL.createObjectURL(new Blob([content], { type }));
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		link.click();
		URL.revokeObjectURL(url);
	}

	const slug = (name: string) =>
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'project';

	async function exportJson() {
		exporting = true;
		try {
			const bundle = await api.exportProject(ws.projectId);
			download(
				`${slug(bundle.project.name)}.tlon.json`,
				JSON.stringify(bundle, null, 2),
				'application/json'
			);
		} catch (error) {
			toasts.error(error);
		} finally {
			exporting = false;
		}
	}

	async function exportStory() {
		exporting = true;
		try {
			const graph = await api.getGraph(ws.projectId);
			download(
				`${slug(graph.project.name)}.md`,
				renderStoryMarkdown({ ...graph, triangles: ws.triangles }, { annotations: true }),
				'text/markdown'
			);
		} catch (error) {
			toasts.error(error);
		} finally {
			exporting = false;
		}
	}

	/** Markdown list of non-dismissed issues, numbered like the story export. */
	async function exportIssues() {
		exporting = true;
		try {
			const [graph, list] = await Promise.all([
				api.getGraph(ws.projectId),
				api.listIssues(ws.projectId)
			]);
			const { project, artifacts, relations, expansions } = graph;
			download(
				`${slug(project.name)}-issues.md`,
				renderIssuesMarkdown({ project, artifacts, relations, expansions }, list),
				'text/markdown'
			);
		} catch (error) {
			toasts.error(error);
		} finally {
			exporting = false;
		}
	}

	/** The Issues panel lives in the overview: clear the selection and scroll to it. */
	async function openIssues() {
		await ws.select(null);
		await tick();
		document.getElementById('issues-panel')?.scrollIntoView({ block: 'start' });
	}
</script>

<header class="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3">
	<a href={resolve('/')} class="btn btn-ghost btn-sm text-zinc-500" title="All projects"
		>◂ Projects</a
	>
	<div class="flex min-w-0 items-center gap-2">
		<h1 class="truncate font-semibold text-zinc-900">{ws.project?.name ?? '…'}</h1>
		{#if ws.project}
			<span class="chip border-zinc-200 bg-zinc-50 text-zinc-500">{ws.project.domain}</span>
		{/if}
	</div>

	<div class="ml-2 flex rounded-md border border-zinc-300 bg-zinc-100 p-0.5" role="tablist">
		{#each VIEWS as view (view)}
			<button
				role="tab"
				aria-selected={ws.view === view}
				class={[
					'h-6 rounded px-3 text-xs font-medium',
					ws.view === view
						? 'bg-white text-zinc-900 shadow-xs'
						: 'text-zinc-500 hover:text-zinc-800'
				]}
				onclick={() => ws.setView(view)}>{VIEW_LABEL[view]}</button
			>
		{/each}
	</div>

	<div class="relative ml-auto w-72">
		<input
			class="input"
			type="search"
			placeholder="Search artifacts…"
			aria-label="Search artifacts"
			bind:value={search}
			onfocus={() => (searchOpen = true)}
			onblur={() => setTimeout(() => (searchOpen = false), 150)}
			onkeydown={(e) => {
				if (e.key === 'Enter' && results[0]) pick(results[0].id);
				if (e.key === 'Escape') {
					search = '';
					e.currentTarget.blur();
				}
			}}
		/>
		{#if searchOpen && results.length > 0}
			<ul class="panel absolute top-8 right-0 left-0 z-30 max-h-80 overflow-auto py-1 shadow-lg">
				{#each results as artifact (artifact.id)}
					<li>
						<button
							class="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-zinc-100"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => pick(artifact.id)}
						>
							<KindBadge kind={artifact.kind} />
							<span class="truncate">{artifact.title}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if ws.issueList}
		{@const others = ws.openIssues.length - ws.blockerCount}
		<button
			class={['btn btn-ghost btn-sm', ws.blockerCount > 0 ? 'text-rose-700' : 'text-zinc-500']}
			title="Continuity issues of the story path — open the Issues panel"
			onclick={openIssues}
		>
			{#if ws.blockerCount > 0}
				<span class="chip border-rose-300 bg-rose-50 text-rose-700"
					>● {ws.blockerCount} blocker{ws.blockerCount === 1 ? '' : 's'}</span
				>
			{:else}
				✓ No blockers
			{/if}
			{#if others > 0}<span class="text-zinc-500">+{others} issue{others === 1 ? '' : 's'}</span
				>{/if}
		</button>
	{/if}
	{#if ws.tensions.length > 0}
		<button
			class="btn btn-ghost btn-sm text-amber-700"
			title="Contradictions are creative prompts — open the overview"
			onclick={() => ws.select(null)}
		>
			◆ {ws.tensions.length} tension{ws.tensions.length === 1 ? '' : 's'}
			{#if unresolvedTensions > 0}<span class="text-zinc-500">({unresolvedTensions} open)</span
				>{/if}
		</button>
	{/if}
	{#if ws.pending > 0 || ws.loading}
		<span class="text-xs text-zinc-400">Syncing…</span>
	{/if}
	<a
		class="btn"
		href={resolve('/projects/[projectId]/protocol', { projectId: ws.projectId })}
		title="Block–Fact protocol: participants, runs, tasks and triangles">Protocol</a
	>
	<button class="btn" onclick={() => (ws.gatewayPanel = 'agents')}>Agents</button>
	<button
		class={['btn', ws.pendingDisclosures.length > 0 && 'border-amber-300 text-amber-800']}
		title="Review disclosures proposed by C"
		onclick={() => (ws.gatewayPanel = 'disclosures')}
	>
		Disclosures
		{#if ws.pendingDisclosures.length > 0}
			<span class="chip border-amber-300 bg-amber-50 text-amber-800"
				>{ws.pendingDisclosures.length} pending</span
			>
		{/if}
	</button>
	<button
		class="btn"
		onclick={exportStory}
		disabled={exporting}
		title="Linear manuscript in story order (Markdown)">Story</button
	>
	<button
		class="btn"
		onclick={exportIssues}
		disabled={exporting}
		title="Open continuity issues with beat numbers (Markdown)">Issues report</button
	>
	<button class="btn" onclick={exportJson} disabled={exporting}>Export</button>
	<button class="btn btn-primary" onclick={() => (ws.newArtifactOpen = true)}>+ New artifact</button
	>
</header>
