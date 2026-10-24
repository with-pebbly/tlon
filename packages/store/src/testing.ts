import { migrateDatabase, openDatabase, type DatabaseHandle } from './db.ts';
import type { ServiceOptions } from './internal.ts';
import { createTlonService, type TlonService } from './service.ts';

export type TestService = {
	service: TlonService;
	handle: DatabaseHandle;
	close(): Promise<void>;
};

/** In-memory PGlite, migrated, wrapped in the real service. Each call is an isolated database. */
export async function createTestService(options: ServiceOptions = {}): Promise<TestService> {
	const handle = await openDatabase('pglite:memory');
	await migrateDatabase(handle);
	return { service: createTlonService(handle.db, options), handle, close: () => handle.close() };
}
