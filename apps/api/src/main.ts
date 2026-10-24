import { fileURLToPath } from 'node:url';

import { createTlonService, migrateDatabase, openDatabase } from '@tlon/store';

import { buildApp } from './app.ts';
import { loadOrCreateAdminToken } from './auth.ts';

const ADMIN_TOKEN_PATH = fileURLToPath(new URL('../../../.data/admin-token', import.meta.url));

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error(`invalid API_PORT: ${process.env.API_PORT}`);
	process.exit(1);
}

let adminToken: string;
try {
	adminToken = loadOrCreateAdminToken(ADMIN_TOKEN_PATH);
} catch (error) {
	console.error(error instanceof Error ? error.message : 'cannot load admin token');
	process.exit(1);
}

const handle = await openDatabase();
await migrateDatabase(handle);
const app = buildApp({ service: createTlonService(handle.db), adminToken, logger: true });
if (process.env.TLON_ADMIN_TOKEN) {
	app.log.info('human credential: TLON_ADMIN_TOKEN');
} else {
	app.log.info({ path: ADMIN_TOKEN_PATH }, 'human credential: admin token file');
}

let closing = false;
async function shutdown(signal: string) {
	if (closing) return;
	closing = true;
	app.log.info({ signal }, 'shutting down');
	try {
		await app.close();
		await handle.close();
		process.exit(0);
	} catch (error) {
		console.error('shutdown failed', error instanceof Error ? error.name : 'unknown');
		process.exit(1);
	}
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host, port });
