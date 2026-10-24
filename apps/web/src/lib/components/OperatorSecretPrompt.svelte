<!--
	Protected mode only (server started with TLON_OPERATOR_TOKEN): when an operator call is
	refused with 401 and /health confirms the mode, ask for the facilitator secret. It lives
	in sessionStorage for this tab and is sent as bearer from operator pages. Without
	protected mode this never renders — there is no login screen (ADR 0007).
-->
<script lang="ts">
	import { api, OPERATOR_SECRET_KEY, setOperatorUnauthorizedHandler } from '$lib/api';
	import { onMount } from 'svelte';

	import Modal from './Modal.svelte';

	let open = $state(false);
	/** A stored secret was refused: it is wrong or was rotated on the server. */
	let rejected = $state(false);
	let secret = $state('');

	onMount(() => {
		setOperatorUnauthorizedHandler(() => {
			if (open) return;
			api
				.health()
				.then((health) => {
					if (!health.operatorTokenRequired) return;
					rejected = sessionStorage.getItem(OPERATOR_SECRET_KEY) !== null;
					open = true;
				})
				.catch(() => {});
		});
		return () => setOperatorUnauthorizedHandler(null);
	});

	function save(event: SubmitEvent) {
		event.preventDefault();
		const value = secret.trim();
		if (value === '') return;
		sessionStorage.setItem(OPERATOR_SECRET_KEY, value);
		// Every page loads its data on mount; a reload replays them with the secret.
		window.location.reload();
	}
</script>

{#if open}
	<Modal title="Facilitator secret" onclose={() => (open = false)}>
		<form class="flex flex-col gap-3" onsubmit={save}>
			<p class="text-sm text-zinc-600">
				This server runs in protected mode. Enter the facilitator secret (the server's
				<code class="font-mono text-xs">TLON_OPERATOR_TOKEN</code>) to use the workspace. It is kept
				only in this browser tab.
			</p>
			{#if rejected}
				<p class="text-sm text-rose-700" role="alert">
					The stored secret was refused — it may be wrong or was changed.
				</p>
			{/if}
			<input
				class="input font-mono"
				type="password"
				autocomplete="off"
				aria-label="Facilitator secret"
				bind:value={secret}
			/>
			<div class="flex justify-end">
				<button class="btn btn-primary" type="submit" disabled={secret.trim() === ''}
					>Continue</button
				>
			</div>
		</form>
	</Modal>
{/if}
