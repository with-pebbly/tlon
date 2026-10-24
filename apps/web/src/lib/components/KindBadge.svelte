<script lang="ts">
	import { KIND_BADGE } from '$lib/ui';
	import type { ArtifactKind } from '@tlon/contracts';

	let { kind }: { kind: ArtifactKind } = $props();
</script>

<span class={['chip shrink-0 font-mono tracking-tight', KIND_BADGE[kind]]}>{kind}</span>
