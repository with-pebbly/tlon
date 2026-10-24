<script lang="ts">
	let {
		title = $bindable(''),
		body = $bindable(''),
		idPrefix
	}: { title?: string; body?: string; idPrefix: string } = $props();
</script>

<div class="flex flex-col gap-3">
	<div>
		<label class="label" for="{idPrefix}-title">Title</label>
		<input
			id="{idPrefix}-title"
			class="input"
			maxlength="300"
			required
			placeholder="A short name for this block"
			bind:value={title}
		/>
	</div>
	<div>
		<label class="label" for="{idPrefix}-body">Text</label>
		<textarea
			id="{idPrefix}-body"
			class="input min-h-48 py-2 leading-relaxed"
			maxlength="20000"
			required
			placeholder="Write the block itself"
			bind:value={body}></textarea>
	</div>
</div>
