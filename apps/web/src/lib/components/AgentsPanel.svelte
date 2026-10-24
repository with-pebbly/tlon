<script lang="ts">
	import { getWorkspace } from '$lib/state/context';
	import { toasts } from '$lib/state/toasts.svelte';
	import { AGENT_ROLE_LABEL, formatTime, shortId } from '$lib/ui';
	import {
		AGENT_ROLES,
		DEFAULT_AGENT_TOKEN_TTL_SECONDS,
		type AgentPrincipal,
		type AgentRole,
		type Grant,
		type IssuedToken
	} from '@tlon/contracts';
	import { onMount } from 'svelte';

	import Modal from './Modal.svelte';
	import ScopeBadge from './ScopeBadge.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const ws = getWorkspace();

	const TTL_OPTIONS = [
		{ seconds: 15 * 60, label: '15 minutes' },
		{ seconds: DEFAULT_AGENT_TOKEN_TTL_SECONDS, label: '1 hour' },
		{ seconds: 8 * 60 * 60, label: '8 hours' },
		{ seconds: 24 * 60 * 60, label: '24 hours' }
	];

	let role = $state<AgentRole>('A');
	let name = $state('');
	let ttlSeconds = $state(DEFAULT_AGENT_TOKEN_TTL_SECONDS);
	let busy = $state<string | null>(null);
	/** Plaintext token from the last issue call; lives only in this modal, never persisted. */
	let issued = $state.raw<IssuedToken | null>(null);
	let copied = $state(false);
	let now = $state(Date.now());

	const issuedFor = $derived(issued ? ws.agentsById.get(issued.principalId) : undefined);
	const grants = $derived(
		[...ws.grants].sort(
			(a, b) => Number(grantState(a) !== 'active') - Number(grantState(b) !== 'active')
		)
	);

	onMount(() => {
		ws.reloadGateway().catch((error: unknown) => toasts.error(error));
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	function grantState(grant: Grant): 'active' | 'revoked' | 'expired' {
		if (grant.revokedAt !== null) return 'revoked';
		if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= now) return 'expired';
		return 'active';
	}

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

	function create(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed === '') return;
		run('create', async () => {
			await ws.createAgent({ role, name: trimmed });
			name = '';
		});
	}

	function issue(agent: AgentPrincipal) {
		run(`issue:${agent.id}`, async () => {
			copied = false;
			issued = await ws.issueToken(agent.id, ttlSeconds);
		});
	}

	function disable(agent: AgentPrincipal) {
		if (
			!confirm(`Disable ${agent.role} · ${agent.name}? All of its tokens stop working immediately.`)
		)
			return;
		run(`disable:${agent.id}`, async () => {
			await ws.disableAgent(agent.id);
			if (issued?.principalId === agent.id) issued = null;
		});
	}

	function revokeIssued() {
		const token = issued;
		if (!token) return;
		run('revoke-token', async () => {
			await ws.revokeToken(token.principalId, token.tokenId);
			issued = null;
			toasts.push('info', 'Token revoked.');
		});
	}

	async function copyToken() {
		if (!issued) return;
		try {
			await navigator.clipboard.writeText(issued.token);
			copied = true;
		} catch {
			toasts.push('error', 'Clipboard unavailable — select the token and copy it manually.');
		}
	}

	function openArtifact(artifactId: string) {
		onclose();
		ws.focusArtifact(artifactId);
	}
</script>

<Modal title="Agents & grants" {onclose} width="w-[760px]">
	<div class="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pr-1">
		{#if ws.gatewayError}
			<p
				class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
				role="alert"
			>
				<span class="font-mono font-semibold">{ws.gatewayError.code}</span>
				{ws.gatewayError.message}
			</p>
		{/if}

		{#if issued}
			<section
				class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
				aria-label="Issued token"
			>
				<div class="font-semibold">
					Token for {issuedFor
						? `${issuedFor.role} · ${issuedFor.name}`
						: shortId(issued.principalId)}
					— copy it now, it will not be shown again.
				</div>
				<div class="mt-2 flex gap-1.5">
					<input
						class="input font-mono text-xs"
						readonly
						value={issued.token}
						aria-label="Agent token"
						onfocus={(e) => e.currentTarget.select()}
					/>
					<button class="btn" onclick={copyToken}>{copied ? 'Copied' : 'Copy'}</button>
				</div>
				<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
					<span>Expires {formatTime(issued.expiresAt)}</span>
					<span class="font-mono text-amber-700">token id {shortId(issued.tokenId)}</span>
					<span class="text-amber-700">Use as <code>Authorization: Bearer &lt;token&gt;</code></span
					>
					<span class="ml-auto flex gap-1.5">
						<button class="btn btn-sm" disabled={busy !== null} onclick={revokeIssued}
							>{busy === 'revoke-token' ? 'Revoking…' : 'Revoke this token'}</button
						>
						<button class="btn btn-sm" onclick={() => (issued = null)}>Done</button>
					</span>
				</div>
			</section>
		{/if}

		<section class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<h3 class="section-title">Agent principals</h3>
				<button
					class="btn btn-ghost btn-sm text-zinc-500"
					disabled={ws.gatewayLoading}
					onclick={() => ws.reloadGateway().catch((error: unknown) => toasts.error(error))}
					>{ws.gatewayLoading ? 'Refreshing…' : 'Refresh'}</button
				>
			</div>
			<form class="flex items-end gap-2" onsubmit={create}>
				<div class="w-56">
					<label class="label" for="ag-role">Role</label>
					<select id="ag-role" class="input" bind:value={role}>
						{#each AGENT_ROLES as option (option)}<option value={option}
								>{AGENT_ROLE_LABEL[option]}</option
							>{/each}
					</select>
				</div>
				<div class="flex-1">
					<label class="label" for="ag-name">Name</label>
					<input
						id="ag-name"
						class="input"
						bind:value={name}
						maxlength="100"
						placeholder="e.g. scout"
					/>
				</div>
				<button class="btn btn-primary" disabled={busy !== null || name.trim() === ''}
					>{busy === 'create' ? 'Creating…' : 'Create agent'}</button
				>
			</form>
			<div class="flex items-center gap-2 text-xs text-zinc-500">
				<label for="ag-ttl">New tokens expire after</label>
				<select id="ag-ttl" class="input h-6 w-32 text-xs" bind:value={ttlSeconds}>
					{#each TTL_OPTIONS as option (option.seconds)}<option value={option.seconds}
							>{option.label}</option
						>{/each}
				</select>
			</div>

			{#if ws.agents.length === 0}
				<p class="text-xs text-zinc-400">No agent principals in this project yet.</p>
			{:else}
				<table class="w-full text-left text-xs">
					<thead class="text-[11px] text-zinc-500">
						<tr class="border-b border-zinc-200">
							<th class="py-1 font-medium">Name</th>
							<th class="py-1 font-medium">Role</th>
							<th class="py-1 font-medium">Created</th>
							<th class="py-1 font-medium">Status</th>
							<th class="py-1"></th>
						</tr>
					</thead>
					<tbody>
						{#each ws.agents as agent (agent.id)}
							{@const disabled = agent.disabledAt !== null}
							<tr class={['border-b border-zinc-100', disabled && 'text-zinc-400']}>
								<td class="py-1.5">
									<span class="font-medium">{agent.name}</span>
									<span class="ml-1 font-mono text-[10px] text-zinc-400" title={agent.id}
										>{shortId(agent.id)}</span
									>
								</td>
								<td class="py-1.5"
									><span class="chip border-zinc-200 bg-zinc-50 font-mono">{agent.role}</span></td
								>
								<td class="py-1.5">{formatTime(agent.createdAt)}</td>
								<td class="py-1.5">
									{#if agent.disabledAt}
										<span title="Disabled {formatTime(agent.disabledAt)}">disabled</span>
									{:else}
										<span class="text-emerald-700">active</span>
									{/if}
								</td>
								<td class="py-1.5 text-right whitespace-nowrap">
									{#if !disabled}
										<button class="btn btn-sm" disabled={busy !== null} onclick={() => issue(agent)}
											>{busy === `issue:${agent.id}` ? 'Issuing…' : 'Issue token'}</button
										>
										<button
											class="btn btn-sm text-rose-700"
											disabled={busy !== null}
											title="Disables the agent and revokes all of its tokens"
											onclick={() => disable(agent)}
											>{busy === `disable:${agent.id}` ? 'Disabling…' : 'Disable'}</button
										>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section class="flex flex-col gap-2">
			<h3 class="section-title">Grants</h3>
			<p class="text-[11px] text-zinc-500">
				READ grants let an A/B agent see one artifact outside its own scope (published disclosures
				create them). Revocation applies from the agent's next request.
			</p>
			{#if grants.length === 0}
				<p class="text-xs text-zinc-400">No grants.</p>
			{:else}
				<table class="w-full text-left text-xs">
					<thead class="text-[11px] text-zinc-500">
						<tr class="border-b border-zinc-200">
							<th class="py-1 font-medium">Artifact</th>
							<th class="py-1 font-medium">Grantee</th>
							<th class="py-1 font-medium">Permission</th>
							<th class="py-1 font-medium">Created</th>
							<th class="py-1 font-medium">State</th>
							<th class="py-1"></th>
						</tr>
					</thead>
					<tbody>
						{#each grants as grant (grant.id)}
							{@const status = grantState(grant)}
							{@const artifact = ws.artifactsById.get(grant.artifactId)}
							<tr class={['border-b border-zinc-100', status !== 'active' && 'text-zinc-400']}>
								<td class="max-w-56 py-1.5">
									<span class="flex items-center gap-1.5">
										{#if artifact}
											<ScopeBadge scope={artifact.ownerScope} />
											<button
												class="truncate text-left text-accent-700 hover:underline"
												onclick={() => openArtifact(grant.artifactId)}>{artifact.title}</button
											>
										{:else}
											<span class="font-mono" title={grant.artifactId}
												>{shortId(grant.artifactId)}</span
											>
										{/if}
									</span>
								</td>
								<td class="py-1.5">{ws.principalLabel(grant.granteePrincipalId)}</td>
								<td class="py-1.5 font-mono">{grant.permission}</td>
								<td class="py-1.5">{formatTime(grant.createdAt)}</td>
								<td class="py-1.5">
									{#if status === 'revoked' && grant.revokedAt}
										<span title="Revoked {formatTime(grant.revokedAt)}">revoked</span>
									{:else if status === 'expired' && grant.expiresAt}
										<span title="Expired {formatTime(grant.expiresAt)}">expired</span>
									{:else}
										<span class="text-emerald-700"
											>active{grant.expiresAt
												? ` · until ${formatTime(grant.expiresAt)}`
												: ''}</span
										>
									{/if}
								</td>
								<td class="py-1.5 text-right">
									{#if status === 'active'}
										<button
											class="btn btn-sm text-rose-700"
											disabled={busy !== null}
											onclick={() => run(`grant:${grant.id}`, () => ws.revokeGrant(grant.id))}
											>{busy === `grant:${grant.id}` ? 'Revoking…' : 'Revoke'}</button
										>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	</div>
</Modal>
