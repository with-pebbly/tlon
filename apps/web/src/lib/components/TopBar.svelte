<script lang="ts">
	import { resolve } from '$app/paths';
	import { api } from '$lib/api';
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { VIEWS } from '$lib/state/workspace.svelte';

	import KindBadge from './KindBadge.svelte';
	import LogoutButton from './LogoutButton.svelte';

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

	async function exportJson() {
		exporting = true;
		try {
			const bundle = await api.exportProject(ws.projectId);
			const slug =
				bundle.project.name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '') || 'project';
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
			);
			const link = document.createElement('a');
			link.href = url;
			link.download = `${slug}.tlon.json`;
			link.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			toasts.error(error);
		} finally {
			exporting = false;
		}
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
	<button class="btn" onclick={exportJson} disabled={exporting}>Export</button>
	<button class="btn btn-primary" onclick={() => (ws.newArtifactOpen = true)}>+ New artifact</button
	>
	<LogoutButton />
</header>
