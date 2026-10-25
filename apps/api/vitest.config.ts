import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Same reason as packages/store: every suite boots and migrates an in-memory pglite
		// database in a hook, which exceeds the 10s default when store and api suites run
		// side by side (`pnpm test`).
		testTimeout: 20000,
		hookTimeout: 30000
	}
});
