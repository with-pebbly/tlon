import { randomUUID } from 'node:crypto';

import type {
	AgentPrincipal,
	AcceptExpansionResult,
	ApiErrorBody,
	Artifact,
	ExpansionDetail,
	IssuedToken,
	IssueList,
	Project,
	ProjectGraph,
	Relation,
	TransitionAnnotation
} from '@tlon/contracts';
import { createTestService, type TestService } from '@tlon/store/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';

let t: TestService;
let app: FastifyInstance;

async function call<T = unknown>(
	method: 'GET' | 'POST' | 'PUT',
	url: string,
	{
		token,
		body,
		headers = {}
	}: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
	const res = await app.inject({
		method,
		url: `/api${url}`,
		payload: body as object | undefined,
		headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers
	});
	return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : undefined) as T };
}

const w = (subject: string, predicate: string, value: string, extra = {}) => ({
	subject,
	predicate,
	value,
	...extra
});
const bridge = (title: string, transition: unknown) => ({
	artifact: {
		title,
		structured: {
			mechanism: 'm',
			assumptions: ['x'],
			anchorReconciliation: { left: 'l', right: 'r' }
		}
	},
	transition
});

type Agent = { id: string; token: string };
type World = {
	project: Project;
	base: string;
	a: Agent;
	b: Agent;
	validator: Agent;
	a31: Artifact;
	b35: Artifact;
	bridge33: Artifact;
	second: ExpansionDetail;
};
let world: World;

async function makeAgent(base: string, role: 'A' | 'B' | 'C' | 'VALIDATOR'): Promise<Agent> {
	const created = await call<AgentPrincipal>('POST', `${base}/agents`, {
		body: { role, name: `${role.toLowerCase()}-${randomUUID().slice(0, 6)}` }
	});
	expect(created.status).toBe(201);
	const issued = await call<IssuedToken>('POST', `${base}/agents/${created.body.id}/tokens`, {
		body: {}
	});
	expect(issued.status).toBe(201);
	return { id: created.body.id, token: issued.body.token };
}

beforeAll(async () => {
	t = await createTestService();
	app = buildApp({ service: t.service });
	const project = (await call<Project>('POST', '/projects', { body: { name: 'hesper' } })).body;
	const base = `/projects/${project.id}`;
	const a = await makeAgent(base, 'A');
	const b = await makeAgent(base, 'B');
	const validator = await makeAgent(base, 'VALIDATOR');
	const a31 = (
		await call<Artifact>('POST', `${base}/artifacts`, {
			token: a.token,
			body: { kind: 'FACT', title: '31 drain cock seized' }
		})
	).body;
	const b35 = (
		await call<Artifact>('POST', `${base}/artifacts`, {
			token: b.token,
			body: { kind: 'FACT', title: '35 Odile drains the bath' }
		})
	).body;
	const root = (
		await call<Relation>('POST', `${base}/relations`, {
			body: { fromId: a31.id, toId: b35.id, type: 'precedes', status: 'ACCEPTED' }
		})
	).body;
	const put = (artifact: Artifact, transition: unknown) =>
		call<TransitionAnnotation>('PUT', `${base}/artifacts/${artifact.id}/transition`, {
			body: { artifactRevisionId: artifact.headRevisionId, transition }
		});
	expect(
		(
			await put(a31, {
				effects: [
					w('mercury_bath', 'level', 'FULL'),
					w('drain_cock', 'state', 'partially_unlocked')
				]
			})
		).status
	).toBe(201);
	expect(
		(
			await put(b35, {
				preconditions: [w('drain_cock', 'state', 'open')],
				effects: [w('odile', 'action', 'drained_the_bath')]
			})
		).status
	).toBe(201);

	const first = (
		await call<ExpansionDetail>('POST', `${base}/expansions`, {
			body: { targetRelationId: root.id }
		})
	).body;
	const withCandidate = await call<ExpansionDetail>(
		'POST',
		`${base}/expansions/${first.expansion.id}/candidates`,
		{
			body: bridge('33 plug comes free', {
				preconditions: [w('mercury_bath', 'level', 'FULL')],
				effects: [
					w('mercury_bath', 'level', 'falling', { irreversible: true }),
					w('drain_cock', 'state', 'open')
				]
			})
		}
	);
	expect(withCandidate.status).toBe(201);
	expect(withCandidate.body.candidates[0]?.issues).toEqual([]);
	const accepted = await call<AcceptExpansionResult>(
		'POST',
		`${base}/expansions/${first.expansion.id}/accept`,
		{
			headers: { 'idempotency-key': 'accept-33' },
			body: { candidateId: withCandidate.body.candidates[0]?.id }
		}
	);
	expect(accepted.status).toBe(200);
	const second = (
		await call<ExpansionDetail>('POST', `${base}/expansions`, {
			body: { targetRelationId: accepted.body.childRelations[1].id }
		})
	).body;
	world = { project, base, a, b, validator, a31, b35, bridge33: accepted.body.bridge, second };
});
afterAll(async () => {
	await app.close();
	await t.close();
});

describe('validation over HTTP', () => {
	it('PUT transition: 201 for humans, 409 on a stale revision, 403 for the VALIDATOR', async () => {
		const { base, a31, validator } = world;
		const ok = await call<TransitionAnnotation>('PUT', `${base}/artifacts/${a31.id}/transition`, {
			body: {
				artifactRevisionId: a31.headRevisionId,
				transition: { effects: [w('mercury_bath', 'level', 'FULL')] }
			}
		});
		expect(ok.status).toBe(201);
		expect(ok.body).toMatchObject({ artifactId: a31.id, source: 'human', reviewed: false });

		const stale = await call<ApiErrorBody>('PUT', `${base}/artifacts/${a31.id}/transition`, {
			body: { artifactRevisionId: randomUUID(), transition: {} }
		});
		expect(stale.status).toBe(409);
		expect(stale.body.error.code).toBe('STALE_REVISION');

		const denied = await call<ApiErrorBody>('PUT', `${base}/artifacts/${a31.id}/transition`, {
			token: validator.token,
			body: { artifactRevisionId: a31.headRevisionId, transition: {} }
		});
		expect(denied.status).toBe(403);

		const revisions = await call<{ items: unknown[] }>(
			'GET',
			`${base}/artifacts/${a31.id}/revisions`
		);
		expect(revisions.body.items).toHaveLength(1);
		// Restore the original anchor annotation for the following tests.
		await call('PUT', `${base}/artifacts/${a31.id}/transition`, {
			body: {
				artifactRevisionId: a31.headRevisionId,
				transition: {
					effects: [
						w('mercury_bath', 'level', 'FULL'),
						w('drain_cock', 'state', 'partially_unlocked')
					]
				}
			}
		});
	});

	it('keeps annotations of B artifacts out of A graph and denies /issues to A and B', async () => {
		const { base, a, b, a31, b35 } = world;
		const graph = await call<ProjectGraph>('GET', `${base}/graph`, { token: a.token });
		expect(graph.status).toBe(200);
		expect(graph.body.transitions.map((x) => x.artifactId)).toEqual([a31.id]);
		const asB = await call<ProjectGraph>('GET', `${base}/graph`, { token: b.token });
		expect(asB.body.transitions.map((x) => x.artifactId)).toEqual([b35.id]);
		expect((await call('GET', `${base}/issues`, { token: a.token })).status).toBe(403);
		expect((await call('GET', `${base}/issues`, { token: b.token })).status).toBe(403);
		const dismiss = await call('POST', `${base}/issues/dismiss`, {
			token: a.token,
			body: { key: 'x', resolution: 'dismissed', reason: 'r' }
		});
		expect(dismiss.status).toBe(403);
	});

	it('gates a drain regression with 409 CONTINUITY_VIOLATION, acknowledge, then lists and dismisses', async () => {
		const { base, second, validator } = world;
		const submitted = await call<ExpansionDetail>(
			'POST',
			`${base}/expansions/${second.expansion.id}/candidates`,
			{
				body: bridge('34 reaching for the crank', {
					preconditions: [w('mercury_bath', 'level', 'FULL')],
					effects: [w('odile', 'hand', 'on_crank')]
				})
			}
		);
		expect(submitted.status).toBe(201);
		const candidate = submitted.body.candidates[0];
		expect(candidate?.issues.some((i) => i.severity === 'blocker')).toBe(true);

		const refused = await call<ApiErrorBody>(
			'POST',
			`${base}/expansions/${second.expansion.id}/accept`,
			{ headers: { 'idempotency-key': 'accept-34-a' }, body: { candidateId: candidate?.id } }
		);
		expect(refused.status).toBe(409);
		expect(refused.body.error.code).toBe('CONTINUITY_VIOLATION');
		expect(JSON.stringify(refused.body)).not.toContain('reaching for the crank');

		const accepted = await call<AcceptExpansionResult>(
			'POST',
			`${base}/expansions/${second.expansion.id}/accept`,
			{
				headers: { 'idempotency-key': 'accept-34-b' },
				body: { candidateId: candidate?.id, acknowledgeIssues: 'intentional' }
			}
		);
		expect(accepted.status).toBe(200);
		expect(accepted.body.expansion.status).toBe('ACCEPTED');

		const issues = await call<IssueList>('GET', `${base}/issues`);
		expect(issues.status).toBe(200);
		const blocker = issues.body.items.find((i) => i.severity === 'blocker');
		expect(blocker).toBeDefined();

		const dismissed = await call<IssueList>('POST', `${base}/issues/dismiss`, {
			body: { key: blocker?.key, resolution: 'intentional', reason: 'planned' }
		});
		expect(dismissed.status).toBe(200);
		expect(dismissed.body.items.find((i) => i.key === blocker?.key)?.dismissal?.resolution).toBe(
			'intentional'
		);
		const viaValidator = await call<IssueList>('GET', `${base}/issues`, { token: validator.token });
		expect(viaValidator.status).toBe(200);
		expect(viaValidator.body.items.find((i) => i.key === blocker?.key)?.dismissal).not.toBeNull();
	});

	it('forces source author / reviewed false for agent annotations', async () => {
		const { base } = world;
		const c = await makeAgent(base, 'C');
		const note = (
			await call<Artifact>('POST', `${base}/artifacts`, {
				token: c.token,
				body: { kind: 'FACT', title: 'C-owned beat' }
			})
		).body;
		const res = await call<TransitionAnnotation>('PUT', `${base}/artifacts/${note.id}/transition`, {
			token: c.token,
			body: {
				artifactRevisionId: note.headRevisionId,
				transition: { effects: [w('lamp', 'state', 'lit')] },
				source: 'human',
				reviewed: true
			}
		});
		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({ source: 'author', reviewed: false });
		const graph = await call<ProjectGraph>('GET', `${base}/graph`);
		expect(graph.body.transitions.find((x) => x.artifactId === note.id)).toMatchObject({
			source: 'author',
			reviewed: false
		});
	});
});
