<script lang="ts">
	import { RelationType, WELL_KNOWN_RELATION_TYPES } from '@tlon/contracts';

	/** Free-text relation type with well-known suggestions; parents validate with `RelationType`. */
	let { value = $bindable(), id }: { value: string; id: string } = $props();

	const error = $derived.by(() => {
		const parsed = RelationType.safeParse(value);
		return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'invalid relation type');
	});
</script>

<input
	{id}
	class={['input font-mono', error && 'border-rose-400']}
	list="{id}-types"
	bind:value
	autocomplete="off"
	spellcheck="false"
	aria-invalid={error !== null}
/>
<datalist id="{id}-types">
	{#each WELL_KNOWN_RELATION_TYPES as type (type)}
		<option value={type}></option>
	{/each}
</datalist>
{#if error}
	<p class="mt-0.5 text-[11px] text-rose-600">{error}</p>
{/if}
