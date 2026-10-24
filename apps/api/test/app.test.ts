import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	ApiErrorBody,
	type Artifact,
	type ExpansionDetail,
	type Project,
	type ProjectGraph
} from '@tlon/contracts';
import { createTlonService, migrateDatabase, openDatabase } from '@tlon/store';
import { createTestService, type TestService } from '@tlon/store/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';

const ADMIN = 'tlon_admin_test_token_0123456789abcdefghij';
const AUTH = { authorization: `Bearer ${ADMIN}` };
let t: TestService;
let app: FastifyInstance;
beforeEach(async () => {
	t = await createTestService();
	app = buildApp({ service: t.service, adminToken: ADMIN });
});
afterEach(async () => {
	await app.close();
	await t.close();
});

async function api<T>(
	method: 'GET' | 'POST' | 'PATCH',
	url: string,
	body?: unknown,
	headers: Record<string, string> = {}
) {
	const res = await app.inject({
		method,
		url: `/api${url}`,
		payload: body as object | undefined,
		headers: { ...AUTH, ...headers }
	});
	return { status: res.statusCode, body: res.json() as T, headers: res.headers };
}

const bridge = (title: string) => ({
	artifact: {
		title,
		structured: {
			mechanism: 'm',
			assumptions: ['x'],
			anchorReconciliation: { left: 'l', right: 'r' }
		}
	}
});

async function setup() {
	const project = (await api<Project>('POST', '/projects', { name: 'http' })).body;
	const a = (
		await api<Artifact>('POST', `/projects/${project.id}/artifacts`, { kind: 'FACT', title: 'A' })
	).body;
	const b = (
		await api<Artifact>('POST', `/projects/${project.id}/artifacts`, { kind: 'FACT', title: 'B' })
	).body;
	const relation = (
		await api<{ id: string }>('POST', `/projects/${project.id}/relations`, {
			fromId: a.id,
			toId: b.id,
			type: 'contradicts'
		})
	).body;
	return { project, a, b, relation };
}

describe('HTTP mapping', () => {
	it('serves health and typed 404 / validation errors', async () => {
		expect((await api('GET', '/health')).body).toEqual({ ok: true });

		const missing = await api<ApiErrorBody>('GET', '/nope');
		expect(missing.status).toBe(404);
		expect(missing.body.error.code).toBe('ROUTE_NOT_FOUND');

		const invalid = await api<ApiErrorBody>('POST', '/projects', { name: '' });
		expect(invalid.status).toBe(400);
		expect(ApiErrorBody.parse(invalid.body).error.code).toBe('VALIDATION_FAILED');
		expect(Array.isArray(invalid.body.error.details)).toBe(true);

		const malformed = await app.inject({
			method: 'POST',
			url: '/api/projects',
			headers: { ...AUTH, 'content-type': 'application/json' },
			payload: '{"name":'
		});
		expect(malformed.statusCode).toBe(400);
		expect(malformed.json().error.code).toBe('VALIDATION_FAILED');

		const unknownProject = await api<ApiErrorBody>(
			'GET',
			'/projects/00000000-0000-4000-8000-0000000000aa'
		);
		expect(unknownProject.status).toBe(404);
		expect(unknownProject.body.error.code).toBe('PROJECT_NOT_FOUND');
	});

	it('maps If-Match: missing → 428, stale → 409 with current revision, matching → 200', async () => {
		const { project, a } = await setup();
		const url = `/projects/${project.id}/artifacts/${a.id}`;
		const missing = await api<ApiErrorBody>('PATCH', url, { title: 'A2' });
		expect(missing.status).toBe(428);
		expect(missing.body.error.code).toBe('PRECONDITION_REQUIRED');

		const ok = await api<Artifact>('PATCH', url, { title: 'A2' }, { 'if-match': a.headRevisionId });
		expect(ok.status).toBe(200);
		expect(ok.body.version).toBe(2);

		const stale = await api<ApiErrorBody>(
			'PATCH',
			url,
			{ title: 'A3' },
			{ 'if-match': a.headRevisionId }
		);
		expect(stale.status).toBe(409);
		expect(stale.body.error.code).toBe('STALE_REVISION');
		expect(stale.body.error.details).toEqual({ currentRevisionId: ok.body.headRevisionId });
	});

	it('requires Idempotency-Key to accept and replays the same key', async () => {
		const { project, relation } = await setup();
		const base = `/projects/${project.id}`;
		const opened = await api<ExpansionDetail>('POST', `${base}/expansions`, {
			targetRelationId: relation.id
		});
		expect(opened.status).toBe(201);
		const id = opened.body.expansion.id;
		const withCandidate = await api<ExpansionDetail>(
			'POST',
			`${base}/expansions/${id}/candidates`,
			bridge('C')
		);
		expect(withCandidate.status).toBe(201);
		const candidateId = withCandidate.body.candidates[0]!.id;

		const noKey = await api<ApiErrorBody>('POST', `${base}/expansions/${id}/accept`, {
			candidateId
		});
		expect(noKey.status).toBe(428);
		expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

		const headers = { 'idempotency-key': 'http-key-0001' };
		const first = await api<{ replayed: boolean; bridge: Artifact }>(
			'POST',
			`${base}/expansions/${id}/accept`,
			{ candidateId },
			headers
		);
		const replay = await api<{ replayed: boolean; bridge: Artifact }>(
			'POST',
			`${base}/expansions/${id}/accept`,
			{ candidateId },
			headers
		);
		expect([first.status, first.body.replayed]).toEqual([200, false]);
		expect([replay.status, replay.body.replayed]).toEqual([200, true]);
		expect(replay.body.bridge.id).toBe(first.body.bridge.id);

		const other = await api<ApiErrorBody>(
			'POST',
			`${base}/expansions/${id}/accept`,
			{ candidateId },
			{ 'idempotency-key': 'http-key-0002' }
		);
		expect([other.status, other.body.error.code]).toEqual([409, 'ALREADY_ACCEPTED']);
	});

	it('rejects a cross-project relation with 422', async () => {
		const { project, a } = await setup();
		const other = (await api<Project>('POST', '/projects', { name: 'other' })).body;
		const foreign = (
			await api<Artifact>('POST', `/projects/${other.id}/artifacts`, { kind: 'NOTE', title: 'X' })
		).body;
		const res = await api<ApiErrorBody>('POST', `/projects/${project.id}/relations`, {
			fromId: a.id,
			toId: foreign.id,
			type: 'causes'
		});
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe('CROSS_PROJECT_REFERENCE');
	});

	it('cancels an expansion with an empty reject body', async () => {
		const { project, relation } = await setup();
		const base = `/projects/${project.id}`;
		const opened = await api<ExpansionDetail>('POST', `${base}/expansions`, {
			targetRelationId: relation.id
		});
		const res = await app.inject({
			method: 'POST',
			url: `/api${base}/expansions/${opened.body.expansion.id}/reject`,
			headers: AUTH
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().expansion.status).toBe('CANCELLED');
	});

	it('exports and imports over HTTP', async () => {
		const { project } = await setup();
		const exported = await app.inject({
			method: 'GET',
			url: `/api/projects/${project.id}/export`,
			headers: AUTH
		});
		expect(exported.statusCode).toBe(200);
		expect(exported.headers['content-disposition']).toBe('attachment; filename="http.tlon.json"');
		const bundle = exported.json();
		expect(bundle.format).toBe('tlon.export');

		const copy = (await api<Project>('POST', '/projects', { name: 'copy' })).body;
		const imported = await api<{ artifacts: number; remapped: boolean }>(
			'POST',
			`/projects/${copy.id}/import?remapIds=true`,
			bundle
		);
		expect(imported.status).toBe(201);
		expect(imported.body).toMatchObject({ artifacts: 2, relations: 1, remapped: true });
		const graph = (await api<ProjectGraph>('GET', `/projects/${copy.id}/graph`)).body;
		expect(graph.artifacts.map((x) => x.title).sort()).toEqual(['A', 'B']);

		const conflict = await api<ApiErrorBody>('POST', `/projects/${copy.id}/import`, bundle);
		expect(conflict.status).toBe(409);
		expect(conflict.body.error.code).toBe('IMPORT_TARGET_NOT_EMPTY');
	});
});

describe('import as new project', () => {
	it('POST /projects/import returns 201 and lists the project', async () => {
		const { project } = await setup();
		const bundle = (
			await app.inject({ method: 'GET', url: `/api/projects/${project.id}/export`, headers: AUTH })
		).json();
		const res = await api<{ projectId: string }>(
			'POST',
			'/projects/import?remapIds=true&name=Imported',
			bundle
		);
		expect(res.status).toBe(201);
		const list = await api<{ items: Project[] }>('GET', '/projects');
		expect(list.body.items.find((p) => p.id === res.body.projectId)?.name).toBe('Imported');
	});
});

describe('restart', () => {
	it(
		'data written through one app instance is readable after rebuilding on the same pglite directory',
		{ timeout: 60_000 },
		async () => {
			const dir = await mkdtemp(join(tmpdir(), 'tlon-api-'));
			const url = `pglite:${dir}`;
			try {
				const first = await openDatabase(url);
				await migrateDatabase(first);
				const app1 = buildApp({ service: createTlonService(first.db), adminToken: ADMIN });
				const created = await app1.inject({
					method: 'POST',
					url: '/api/projects',
					headers: AUTH,
					payload: { name: 'durable' }
				});
				expect(created.statusCode).toBe(201);
				await app1.close();
				await first.close();

				const second = await openDatabase(url);
				await migrateDatabase(second);
				const app2 = buildApp({ service: createTlonService(second.db), adminToken: ADMIN });
				const listed = await app2.inject({ method: 'GET', url: '/api/projects', headers: AUTH });
				expect(listed.json().items.map((p: Project) => p.name)).toEqual(['durable']);
				await app2.close();
				await second.close();
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		}
	);
});
