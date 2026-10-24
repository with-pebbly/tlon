<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api';
	import { toasts } from '$lib/state/toasts.svelte';
	import { formatTime } from '$lib/ui';
	import { PROJECT_DOMAINS, type Project, type ProjectDomain } from '@tlon/contracts';
	import { onMount } from 'svelte';

	let projects = $state.raw<Project[] | null>(null);
	let name = $state('');
	let domain = $state<ProjectDomain>('NARRATIVE');
	let creating = $state(false);

	let importName = $state('');
	let importFile = $state<File | null>(null);
	let remapIds = $state(true);
	let importing = $state(false);

	async function load() {
		try {
			projects = (await api.listProjects()).items;
		} catch (error) {
			projects = [];
			toasts.error(error);
		}
	}

	onMount(load);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		creating = true;
		try {
			const project = await api.createProject({ name: name.trim(), domain });
			await goto(resolve('/projects/[projectId]', { projectId: project.id }));
		} catch (error) {
			toasts.error(error);
		} finally {
			creating = false;
		}
	}

	/** Creates a project from an export file in one atomic request. */
	async function importBundle(event: SubmitEvent) {
		event.preventDefault();
		if (!importFile) return;
		importing = true;
		try {
			let bundle: unknown;
			try {
				bundle = JSON.parse(await importFile.text());
			} catch {
				toasts.push('error', 'The selected file is not valid JSON', 'VALIDATION_FAILED');
				return;
			}
			const trimmed = importName.trim();
			const result = await api.importAsNewProject(bundle, {
				...(trimmed ? { name: trimmed } : {}),
				remapIds
			});
			toasts.push(
				'info',
				`Imported ${result.artifacts} artifacts, ${result.relations} relations, ${result.expansions} expansions`
			);
			await goto(resolve('/projects/[projectId]', { projectId: result.projectId }));
		} catch (error) {
			toasts.error(error);
		} finally {
			importing = false;
		}
	}
</script>

<svelte:head><title>Projects · Tlön</title></svelte:head>

<div class="mx-auto flex min-h-full max-w-5xl flex-col gap-6 px-6 py-10">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-zinc-900">Tlön</h1>
			<p class="text-zinc-500">Artifacts, relations and recursive bridges.</p>
		</div>
	</header>

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class="panel overflow-hidden">
			<div class="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5">
				<h2 class="section-title">Projects</h2>
				<button class="btn btn-ghost btn-sm" onclick={load}>Refresh</button>
			</div>
			{#if projects === null}
				<p class="px-4 py-6 text-zinc-500">Loading…</p>
			{:else if projects.length === 0}
				<p class="px-4 py-6 text-zinc-500">No projects yet. Create one or import an export file.</p>
			{:else}
				<ul class="divide-y divide-zinc-100">
					{#each projects as project (project.id)}
						<li>
							<a
								href={resolve('/projects/[projectId]', { projectId: project.id })}
								class="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-zinc-50"
							>
								<span class="min-w-0">
									<span class="block truncate font-medium text-zinc-900">{project.name}</span>
									<span class="font-mono text-[11px] text-zinc-400">{project.id}</span>
								</span>
								<span class="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
									<span class="chip border-zinc-200 bg-zinc-50 text-zinc-600">{project.domain}</span
									>
									<span>{formatTime(project.updatedAt)}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<div class="flex flex-col gap-6">
			<form class="panel flex flex-col gap-3 p-4" onsubmit={create}>
				<h2 class="section-title">New project</h2>
				<div>
					<label class="label" for="project-name">Name</label>
					<input id="project-name" class="input" bind:value={name} required maxlength="200" />
				</div>
				<fieldset>
					<legend class="label">Schema</legend>
					<div class="flex gap-2">
						{#each PROJECT_DOMAINS as option (option)}
							<label
								class={[
									'flex flex-1 cursor-pointer items-center justify-center rounded-md border px-2 py-1 text-[13px]',
									domain === option
										? 'border-accent-500 bg-accent-50 text-accent-700'
										: 'border-zinc-300 bg-white text-zinc-600'
								]}
							>
								<input type="radio" class="sr-only" value={option} bind:group={domain} />
								{option === 'NARRATIVE' ? 'Narrative' : 'Generic'}
							</label>
						{/each}
					</div>
				</fieldset>
				<button class="btn btn-primary justify-center" disabled={creating || name.trim() === ''}>
					{creating ? 'Creating…' : 'Create project'}
				</button>
			</form>

			<form class="panel flex flex-col gap-3 p-4" onsubmit={importBundle}>
				<h2 class="section-title">Import export file</h2>
				<div>
					<label class="label" for="import-file">File (.tlon.json)</label>
					<input
						id="import-file"
						type="file"
						accept=".json,application/json"
						class="block w-full text-xs text-zinc-600 file:mr-2 file:rounded file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-xs"
						onchange={(e) => (importFile = e.currentTarget.files?.[0] ?? null)}
					/>
				</div>
				<div>
					<label class="label" for="import-name">Project name (optional)</label>
					<input id="import-name" class="input" bind:value={importName} placeholder="From file" />
				</div>
				<label class="flex items-center gap-2 text-zinc-600">
					<input type="checkbox" bind:checked={remapIds} />
					Generate fresh IDs (remap)
				</label>
				<button class="btn justify-center" disabled={importing || !importFile}>
					{importing ? 'Importing…' : 'Import into new project'}
				</button>
			</form>
		</div>
	</div>
</div>
