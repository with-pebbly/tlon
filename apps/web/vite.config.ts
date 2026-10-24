import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const apiTarget = process.env.TLON_API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		proxy: { '/api': { target: apiTarget, changeOrigin: false } }
	},
	preview: {
		proxy: { '/api': { target: apiTarget, changeOrigin: false } }
	}
});
