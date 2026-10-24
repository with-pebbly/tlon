<script lang="ts">
	import { page } from '$app/state';
	import WorkspaceShell from '$lib/components/WorkspaceShell.svelte';
</script>

{#key page.params.projectId}
	<WorkspaceShell projectId={page.params.projectId ?? ''} />
{/key}
