import { randomUUID } from 'node:crypto';

import type {
	ApiErrorBody,
	Artifact,
	AuditReport,
	Certification,
	CompletionReport,
	ConnectionList,
	NarrativeConnection,
	ParticipantLink,
	Project
} from '@tlon/contracts';
import { createTestService, type TestService } from '@tlon/store/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';

const OPERATOR_TOKEN = 'operator-secret-for-tests';

let t: TestService;
let open: FastifyInstance;
let protectedApp: FastifyInstance;

async function call<T = unknown>(
	app: FastifyInstance,
	method: 'GET' | 'POST' | 'PATCH',
	url: string,
	{ token, body }: { token?: string; body?: unknown } = {}
) {
	const res = await app.inject({
		method,
		url: `/api${url}`,
		payload: body as object | undefined,
		headers: token ? { authorization: `Bearer ${token}` } : {}
	});
	return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : undefined) as T };
}

const errorOf = (res: { body: unknown }) => (res.body as ApiErrorBody).error;

beforeAll(async () => {
	t = await createTestService();
	open = buildApp({ service: t.service });
	protectedApp = buildApp({ service: t.service, operatorToken: OPERATOR_TOKEN });
});

afterAll(async () => {
	await open.close();
	await protectedApp.close();
	await t.close();
});

async function newProject(name: string): Promise<Project> {
	const res = await call<Project>(open, 'POST', '/projects', {
		body: { name, domain: 'GENERIC' }
	});
	expect(res.status).toBe(201);
	return res.body;
}

async function block(projectId: string, title: string, ownerScope: string): Promise<Artifact> {
	const res = await call<Artifact>(open, 'POST', `/projects/${projectId}/artifacts`, {
		body: { kind: 'EVENT', title, ownerScope }
	});
	expect(res.status).toBe(201);
	return res.body;
}

describe('connections, completion and certification routes', () => {
	it('walks a connection through create, promote, reject; certify is blocked then allowed', async () => {
		const project = await newProject('routes');
		const a = await block(project.id, 'a', 'A_PRIVATE');
		const b = await block(project.id, 'b', 'B_PRIVATE');
		const base = `/projects/${project.id}`;

		const bad = await call(open, 'POST', `${base}/connections`, {
			body: {
				kind: 'causal_canon',
				endpointIds: [a.id, b.id],
				statement: 'unapproved',
				source: 'ai_review',
				approve: true
			}
		});
		expect(bad.status).toBe(400);
		expect(errorOf(bad).code).toBe('VALIDATION_FAILED');

		const created = await call<NarrativeConnection>(open, 'POST', `${base}/connections`, {
			body: { kind: 'open_mystery', endpointIds: [a.id, b.id], statement: 'why?' }
		});
		expect(created.status).toBe(201);
		const list = await call<ConnectionList>(open, 'GET', `${base}/connections`);
		expect(list.body.items.map((c) => c.id)).toEqual([created.body.id]);

		const report = await call<CompletionReport>(open, 'GET', `${base}/completion`);
		expect(report.body).toMatchObject({
			policy: 'exploratory',
			confirmedCrossBranchCausalPaths: 'unknown',
			isolationVerified: 'unknown'
		});

		// Not approved as intentional: the open mystery blocks the policy.
		const blocked = await call(open, 'POST', `${base}/certify`, {
			body: { policy: 'coherent_open_mystery' }
		});
		expect(blocked.status).toBe(409);
		expect(errorOf(blocked).code).toBe('COMPLETION_BLOCKED');
		expect(errorOf(blocked).details).toMatchObject({ reasons: [expect.any(String)] });

		const approved = await call<NarrativeConnection>(
			open,
			'PATCH',
			`${base}/connections/${created.body.id}`,
			{ body: { approve: true } }
		);
		expect(approved.body.approvedBy).not.toBeNull();
		const ok = await call<Certification>(open, 'POST', `${base}/certify`, {
			body: { policy: 'coherent_open_mystery' }
		});
		expect(ok.status).toBe(201);
		expect(ok.body.report.certifiable).toBe(true);
		const certs = await call<{ items: Certification[] }>(open, 'GET', `${base}/certifications`);
		expect(certs.body.items).toHaveLength(1);

		const rejected = await call<NarrativeConnection>(
			open,
			'PATCH',
			`${base}/connections/${created.body.id}`,
			{ body: { status: 'rejected' } }
		);
		expect(rejected.body.status).toBe('rejected');
		const missing = await call(open, 'PATCH', `${base}/connections/${randomUUID()}`, {
			body: { status: 'rejected' }
		});
		expect(missing.status).toBe(404);
		expect(errorOf(missing).code).toBe('CONNECTION_NOT_FOUND');

		const audit = await call<AuditReport>(open, 'GET', `${base}/audit`);
		expect(audit.body).toMatchObject({ projectId: project.id, isolationVerified: 'unknown' });
	});

	it('POST /connect refuses two anchors of one private side with 422 SAME_SIDE_GAP', async () => {
		const project = await newProject('same side');
		const a1 = await block(project.id, 'a1', 'A_PRIVATE');
		const a2 = await block(project.id, 'a2', 'A_PRIVATE');
		const b1 = await block(project.id, 'b1', 'B_PRIVATE');
		const connect = (l: string, r: string) =>
			call(open, 'POST', `/projects/${project.id}/connect`, {
				body: { left: { artifactId: l }, right: { artifactId: r } }
			});
		const refused = await connect(a1.id, a2.id);
		expect(refused.status).toBe(422);
		expect(errorOf(refused)).toMatchObject({ code: 'SAME_SIDE_GAP', details: { side: 'A' } });
		expect((await connect(a1.id, b1.id)).status).toBe(201);
	});
});

describe('protected mode (TLON_OPERATOR_TOKEN)', () => {
	it('health tells the web whether an operator token is required', async () => {
		expect((await call(open, 'GET', '/health')).body).toEqual({
			ok: true,
			operatorTokenRequired: false
		});
		expect((await call(protectedApp, 'GET', '/health')).body).toEqual({
			ok: true,
			operatorTokenRequired: true
		});
	});

	it('refuses tokenless loopback, accepts the operator bearer, rejects a wrong one', async () => {
		const tokenless = await call(protectedApp, 'GET', '/projects');
		expect(tokenless.status).toBe(401);
		expect(errorOf(tokenless).code).toBe('UNAUTHENTICATED');
		expect((await call(open, 'GET', '/projects')).status).toBe(200);

		const operator = await call(protectedApp, 'GET', '/projects', { token: OPERATOR_TOKEN });
		expect(operator.status).toBe(200);
		const wrong = await call(protectedApp, 'GET', '/projects', { token: 'not-the-token' });
		expect(wrong.status).toBe(401);
		expect(errorOf(wrong).code).toBe('UNAUTHENTICATED');
	});

	it('a participant token never gains operator rights', async () => {
		const project = (
			await call<Project>(protectedApp, 'POST', '/projects', {
				token: OPERATOR_TOKEN,
				body: { name: 'protected', domain: 'GENERIC' }
			})
		).body;
		const link = (
			await call<ParticipantLink>(protectedApp, 'POST', `/projects/${project.id}/participants`, {
				token: OPERATOR_TOKEN,
				body: { role: 'A', name: 'Ann' }
			})
		).body;
		const base = `/projects/${project.id}`;
		for (const url of [
			`${base}/connections`,
			`${base}/completion`,
			`${base}/audit`,
			`${base}/export`
		]) {
			const res = await call(protectedApp, 'GET', url, { token: link.token });
			expect(res.status, url).toBe(403);
			expect(errorOf(res).code).toBe('FORBIDDEN');
		}
		const created = await call(protectedApp, 'POST', `${base}/participants`, {
			token: link.token,
			body: { role: 'B', name: 'Bob' }
		});
		expect(created.status).toBe(403);
		// The same routes work for the operator bearer.
		expect(
			(await call(protectedApp, 'GET', `${base}/audit`, { token: OPERATOR_TOKEN })).status
		).toBe(200);
	});
});
