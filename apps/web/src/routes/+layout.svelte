<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import Toasts from '$lib/components/Toasts.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { untrack } from 'svelte';

	let { children } = $props();

	const onLogin = $derived(page.route.id === '/login');

	// Every route but /login needs a session; resolve it whenever one is missing.
	$effect(() => {
		if (!onLogin && auth.whoami === null) untrack(() => auth.check());
	});
</script>

{#if onLogin || auth.whoami}
	{@render children()}
{:else if auth.error}
	<div class="flex min-h-full items-center justify-center p-6">
		<div class="panel flex max-w-sm flex-col gap-3 p-4" role="alert">
			<p class="text-zinc-700">Could not verify the session: {auth.error}</p>
			<button class="btn justify-center" onclick={() => auth.check()} disabled={auth.checking}>
				Retry
			</button>
		</div>
	</div>
{:else}
	<p class="p-6 text-zinc-500">Checking session…</p>
{/if}
<Toasts />
