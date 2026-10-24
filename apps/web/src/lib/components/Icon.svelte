<script lang="ts">
	type IconName = 'lock' | 'pin';

	let { name, size = 12, label }: { name: IconName; size?: number; label: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 16 16"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	role="img"
	aria-label={label}
>
	<title>{label}</title>
	{#if name === 'lock'}
		<rect x="3" y="7" width="10" height="7" rx="1.5" />
		<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
	{:else}
		<path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6 6 2Z" />
		<path d="M8 8.5V14" />
	{/if}
</svg>
