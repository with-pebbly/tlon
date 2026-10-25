import { randomUUID } from 'node:crypto';

import type {
	ApiErrorBody,
	Artifact,
	ContinuityFinding,
	FindingList,
	IssueList,
	ParticipantLink,
	Project,
	SubmitTaskResult,
	Task,
	TaskView
} from '@tlon/contracts';
import { createTestService, type TestService } from '@tlon/store/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';

let t: TestService;
let app: FastifyInstance;

async function call<T = unknown>(
	method: 'GET' | 'POST',
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
	app = buildApp({ service: t.service });
});

afterAll(async () => {
	await app.close();
	await t.close();
});

async function block(
	projectId: string,
	title: string,
	body: string,
	ownerScope: string
): Promise<Artifact> {
	const res = await call<Artifact>('POST', `/projects/${projectId}/artifacts`, {
		body: { kind: 'EVENT', title, body, ownerScope }
	});
	expect(res.status).toBe(201);
	return res.body;
}

async function participant(projectId: string, role: 'A' | 'B'): Promise<string> {
	const res = await call<ParticipantLink>('POST', `/projects/${projectId}/participants`, {
		body: { role, name: `${role}-person` }
	});
	expect(res.status).toBe(201);
	return res.body.token;
}

describe('continuity findings routes', () => {
	it('grounds findings, merges them into issues, and walks a revision request end to end', async () => {
		const project = (
			await call<Project>('POST', '/projects', { body: { name: 'findings', domain: 'GENERIC' } })
		).body;
		const base = `/projects/${project.id}`;
		const b1 = await block(project.id, 'Letters', 'Ryva is Yakov’s mother.', 'B_PRIVATE');
		const b2 = await block(project.id, 'Wife', 'Ryva, the wife of the author, wept.', 'B_PRIVATE');
		const a1 = await block(project.id, 'Other side', 'Nothing about letters here.', 'A_PRIVATE');

		const grounded = {
			kind: 'identity_conflict',
			severity: 'blocker',
			artifactIds: [b1.id, b2.id],
			explanation: 'Ryva is both mother and wife.',
			evidence: [
				{ artifactId: b1.id, quote: 'Ryva is Yakov’s mother.' },
				{ artifactId: b2.id, quote: 'Ryva, the wife of the author' }
			],
			source: 'audit'
		};
		const created = await call<ContinuityFinding>('POST', `${base}/findings`, { body: grounded });
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({ source: 'audit', stale: false, severity: 'blocker' });

		const ungrounded = await call('POST', `${base}/findings`, {
			body: {
				...grounded,
				evidence: [{ artifactId: b2.id, quote: 'Ryva is Yakov’s mother.' }]
			}
		});
		expect(ungrounded.status).toBe(422);
		expect(errorOf(ungrounded)).toMatchObject({
			code: 'UNGROUNDED_QUOTE',
			details: { ungrounded: [{ artifactId: b2.id, quote: 'Ryva is Yakov’s mother.' }] }
		});

		const listed = await call<FindingList>('GET', `${base}/findings`);
		expect(listed.body.items.map((f) => f.id)).toEqual([created.body.id]);

		const key = `finding:${created.body.id}`;
		const issues = await call<IssueList>('GET', `${base}/issues`);
		const issue = issues.body.items.find((i) => i.key === key);
		expect(issue).toMatchObject({ source: 'audit', kind: 'identity_conflict', dismissal: null });
		expect(issue?.evidence).toEqual([
			{ artifactId: b1.id, quote: 'Ryva is Yakov’s mother.' },
			{ artifactId: b2.id, quote: 'Ryva, the wife of the author' }
		]);

		// Participants never read or write findings.
		const tokenA = await participant(project.id, 'A');
		const tokenB = await participant(project.id, 'B');
		const attempts = [tokenA, tokenB].flatMap((token) => [
			call('GET', `${base}/findings`, { token }),
			call('POST', `${base}/findings`, { token, body: grounded }),
			call('GET', `${base}/issues`, { token })
		]);
		expect((await Promise.all(attempts)).map((r) => r.status)).toEqual([
			403, 403, 403, 403, 403, 403
		]);

		// Revision: refused across sides and for unknown issues, created once for a side-local one.
		const cross = await call<ContinuityFinding>('POST', `${base}/findings`, {
			body: {
				kind: 'fact_conflict',
				severity: 'warning',
				artifactIds: [a1.id, b1.id],
				explanation: 'Sides disagree.',
				evidence: [
					{ artifactId: a1.id, quote: 'Nothing about letters here.' },
					{ artifactId: b1.id, quote: 'Ryva is' }
				]
			}
		});
		expect(cross.status).toBe(201);
		const refused = await call('POST', `${base}/issues/request-revision`, {
			body: { issueKey: `finding:${cross.body.id}`, artifactId: a1.id }
		});
		expect(refused.status).toBe(422);
		expect(errorOf(refused).code).toBe('CROSS_SIDE_REVISION');
		const missing = await call('POST', `${base}/issues/request-revision`, {
			body: { issueKey: `finding:${randomUUID()}`, artifactId: b1.id }
		});
		expect(missing.status).toBe(404);
		expect(errorOf(missing).code).toBe('ISSUE_NOT_FOUND');
		expect(
			(
				await call('POST', `${base}/issues/request-revision`, {
					token: tokenB,
					body: { issueKey: key, artifactId: b1.id }
				})
			).status
		).toBe(403);

		const requested = await call<Task>('POST', `${base}/issues/request-revision`, {
			body: { issueKey: key, artifactId: b1.id, instructions: 'Make Ryva the wife only.' }
		});
		expect(requested.status).toBe(201);
		expect(requested.body).toMatchObject({ type: 'revise_block', role: 'B', state: 'pending' });
		const again = await call<Task>('POST', `${base}/issues/request-revision`, {
			body: { issueKey: key, artifactId: b1.id }
		});
		expect(again.body.id).toBe(requested.body.id);

		const forA = await call('GET', `${base}/tasks/${requested.body.id}/view`, { token: tokenA });
		expect(forA.status).toBe(404);
		const view = await call<TaskView>('GET', `${base}/tasks/${requested.body.id}/view`, {
			token: tokenB
		});
		expect(view.status).toBe(200);
		if (view.body.type !== 'revise_block') throw new Error('wrong view');
		expect(view.body.localContext.map((b) => b.id).toSorted()).toEqual([b1.id, b2.id].toSorted());
		expect(view.body.instructions).toBe('Make Ryva the wife only.');

		const submitted = await call<SubmitTaskResult>(
			'POST',
			`${base}/tasks/${requested.body.id}/submit`,
			{
				token: tokenB,
				body: {
					submission: {
						type: 'revise_block',
						block: { kind: 'EVENT', title: 'Letters', body: 'Ryva, the wife, wrote nine letters.' }
					},
					idempotencyKey: `idem-${randomUUID()}`
				}
			}
		);
		expect(submitted.status).toBe(200);
		expect(submitted.body.task.resultRefs[0]?.artifactId).toBe(b1.id);

		const after = await call<FindingList>('GET', `${base}/findings`);
		expect(after.body.items.find((f) => f.id === created.body.id)?.stale).toBe(true);
		const issuesAfter = await call<IssueList>('GET', `${base}/issues`);
		expect(issuesAfter.body.items.some((i) => i.key === key)).toBe(false);
	});
});
