<script lang="ts">
	import { SCOPE_BADGE, SCOPE_DESCRIPTION, SCOPE_LABEL, SCOPE_SHORT } from '$lib/ui';
	import type { OwnerScope } from '@tlon/contracts';

	let { scope, long = false }: { scope: OwnerScope; long?: boolean } = $props();
</script>

<span
	class={['chip shrink-0', SCOPE_BADGE[scope]]}
	title="{SCOPE_LABEL[scope]} — {SCOPE_DESCRIPTION[scope]}"
	data-scope={scope}>{long ? SCOPE_LABEL[scope] : SCOPE_SHORT[scope]}</span
>
