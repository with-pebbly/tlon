<script lang="ts">
	import { page } from '$app/state';
	import ProtocolPage from '$lib/components/protocol/ProtocolPage.svelte';
</script>

{#key page.params.projectId}
	<ProtocolPage projectId={page.params.projectId ?? ''} />
{/key}
