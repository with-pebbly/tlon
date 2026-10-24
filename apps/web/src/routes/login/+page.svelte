<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, isApiError } from '$lib/api';
	import { auth, safeNext } from '$lib/state/auth.svelte';

	let submitting = $state(false);
	let error = $state<string | null>(null);

	/** The token is read straight from the form and the field is cleared at once: it is never
	 * held in component state or browser storage; only the HttpOnly session cookie remains. */
	async function login(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const token = String(new FormData(form).get('token') ?? '').trim();
		form.reset();
		if (token === '') return;
		submitting = true;
		error = null;
		try {
			await api.createSession({ token });
			auth.whoami = null;
			await goto(safeNext(page.url.searchParams.get('next')), { replaceState: true });
		} catch (failure) {
			error =
				isApiError(failure) && failure.status === 401
					? 'That token is not valid.'
					: failure instanceof Error
						? failure.message
						: String(failure);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>Sign in · Tlön</title></svelte:head>

<div class="flex min-h-full items-center justify-center px-6 py-10">
	<form class="panel flex w-full max-w-sm flex-col gap-3 p-5" onsubmit={login}>
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-zinc-900">Tlön</h1>
			<p class="text-zinc-500">Sign in with the admin token.</p>
		</div>
		<div>
			<label class="label" for="admin-token">Admin token</label>
			<input
				id="admin-token"
				name="token"
				type="password"
				class="input"
				autocomplete="off"
				spellcheck="false"
				required
				maxlength="500"
				aria-describedby="admin-token-hint"
				aria-invalid={error !== null}
			/>
			<p id="admin-token-hint" class="mt-1 text-xs text-zinc-500">
				Find it in <code class="font-mono">.data/admin-token</code> at the repository root (written
				on the API's first boot), or use the value of
				<code class="font-mono">TLON_ADMIN_TOKEN</code> if you set one.
			</p>
		</div>
		{#if error}
			<p
				class="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-rose-700"
				role="alert"
			>
				{error}
			</p>
		{/if}
		<button class="btn btn-primary justify-center" disabled={submitting}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
</div>
