<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';

	import GraphCanvas from './GraphCanvas.svelte';
</script>

<SvelteFlowProvider>
	<GraphCanvas />
</SvelteFlowProvider>
