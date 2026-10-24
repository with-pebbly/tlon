<script lang="ts">
	import '../app.css';
	import OperatorSecretPrompt from '$lib/components/OperatorSecretPrompt.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	let { children } = $props();
</script>

{@render children()}
<Toasts />
<OperatorSecretPrompt />
