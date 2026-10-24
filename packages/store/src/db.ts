import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';

import * as schema from './schema.ts';

export const DEFAULT_DATABASE_URL = 'postgres://tlon:tlon@127.0.0.1:54329/tlon';

/** Driver-agnostic Drizzle database; transactions (`tx`) share this type. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DatabaseHandle = {
	db: Db;
	driver: 'postgres' | 'pglite';
	close(): Promise<void>;
	/** @internal used by migrateDatabase to pick the matching migrator. */
	readonly native:
		| { kind: 'postgres'; db: NodePgDatabase<typeof schema> }
		| { kind: 'pglite'; db: PgliteDatabase<typeof schema> };
};

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * `postgres://…` → node-postgres pool; `pglite:memory` → in-memory PGlite;
 * `pglite:<dir>` → PGlite persisted in a directory.
 */
export async function openDatabase(
	url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
): Promise<DatabaseHandle> {
	if (url.startsWith('pglite:')) {
		const target = url.slice('pglite:'.length);
		if (target === '') throw new Error("DATABASE_URL 'pglite:' needs 'memory' or a directory");
		const client = target === 'memory' ? new PGlite() : new PGlite(target);
		await client.waitReady;
		const db = drizzlePglite({ client, schema });
		return {
			db: db as unknown as Db,
			driver: 'pglite',
			close: () => client.close(),
			native: { kind: 'pglite', db }
		};
	}
	if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
		const pool = new pg.Pool({ connectionString: url });
		const db = drizzleNodePg({ client: pool, schema });
		return {
			db: db as unknown as Db,
			driver: 'postgres',
			close: () => pool.end(),
			native: { kind: 'postgres', db }
		};
	}
	throw new Error(
		'unsupported DATABASE_URL scheme (expected postgres://, pglite:memory or pglite:<dir>)'
	);
}

export async function migrateDatabase(handle: DatabaseHandle): Promise<void> {
	if (handle.native.kind === 'pglite') {
		await migratePglite(handle.native.db, { migrationsFolder: MIGRATIONS_FOLDER });
	} else {
		await migrateNodePg(handle.native.db, { migrationsFolder: MIGRATIONS_FOLDER });
	}
}
