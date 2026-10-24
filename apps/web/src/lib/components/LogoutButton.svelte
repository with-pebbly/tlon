<script lang="ts">
	import { auth } from '$lib/state/auth.svelte';
	import { toasts } from '$lib/state/toasts.svelte';

	let { class: className = '' }: { class?: string } = $props();

	let pending = $state(false);

	async function logout() {
		pending = true;
		try {
			await auth.logout();
		} catch (error) {
			toasts.error(error);
		} finally {
			pending = false;
		}
	}
</script>

<button
	class={['btn', className]}
	onclick={logout}
	disabled={pending}
	title="End this browser session"
>
	{pending ? 'Signing out…' : 'Sign out'}
</button>
