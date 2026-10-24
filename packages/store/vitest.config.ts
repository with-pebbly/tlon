import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// pglite tests are CPU-bound and exceed the 5s default under load; the per-test
		// `beforeEach` that boots and migrates an in-memory database hits the same ceiling.
		testTimeout: 20000,
		hookTimeout: 30000
	}
});
