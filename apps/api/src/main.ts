import { createTlonService, migrateDatabase, openDatabase } from '@tlon/store';

import { buildApp } from './app.ts';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error(`invalid API_PORT: ${process.env.API_PORT}`);
	process.exit(1);
}

const handle = await openDatabase();
await migrateDatabase(handle);
// Optional protected mode (ADR 0007): without a token the loopback peer is the operator.
const operatorToken = process.env.TLON_OPERATOR_TOKEN?.trim() || undefined;
const app = buildApp({ service: createTlonService(handle.db), logger: true, operatorToken });

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
