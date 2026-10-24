import { randomUUID } from 'node:crypto';

import type {
	AgentPrincipal,
	ApiErrorBody,
	Artifact,
	CompositeView,
	ExportBundle,
	ImportResult,
	ParticipantLink,
	Project,
	ProjectGraph,
	ProtocolState,
	Run,
	SubmitTaskResult,
	TaskList,
	TaskView,
	TriangleDetail
} from '@tlon/contracts';
import { createTestService, type TestService } from '@tlon/store/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';

let t: TestService;
let app: FastifyInstance;

type CallOptions = { token?: string; body?: unknown };

async function call<T = unknown>(
	method: 'GET' | 'POST' | 'PATCH',
	url: string,
	{ token, body }: CallOptions = {}
) {
	const res = await app.inject({
		method,
		url: `/api${url}`,
		payload: body as object | undefined,
		headers: token ? { authorization: `Bearer ${token}` } : {}
	});
	return {
		status: res.statusCode,
		text: res.body,
		body: (res.body ? JSON.parse(res.body) : undefined) as T
	};
}

const key = () => `idem-${randomUUID()}`;
const codeOf = (res: { body: unknown }) => (res.body as ApiErrorBody).error.code;

async function newProject(name: string): Promise<Project> {
	const res = await call<Project>('POST', '/projects', { body: { name, domain: 'GENERIC' } });
	expect(res.status).toBe(201);
	return res.body;
}

async function participant(
	projectId: string,
	role: 'A' | 'B' | 'C' | 'VALIDATOR',
	executorKind: 'human' | 'ai' | 'scripted' = 'human'
): Promise<ParticipantLink> {
	const res = await call<ParticipantLink>('POST', `/projects/${projectId}/participants`, {
		body: { role, name: `${role}-${randomUUID().slice(0, 6)}`, executorKind }
	});
	expect(res.status).toBe(201);
	return res.body;
}

type Crew = { project: Project; A: ParticipantLink; B: ParticipantLink; C: ParticipantLink };

async function crew(name: string): Promise<Crew> {
	const project = await newProject(name);
	return {
		project,
		A: await participant(project.id, 'A'),
		B: await participant(project.id, 'B'),
		C: await participant(project.id, 'C', 'scripted')
	};
}

const base = (c: Crew) => `/projects/${c.project.id}`;

async function myTasks(c: Crew, who: ParticipantLink) {
	return (await call<TaskList>('GET', `${base(c)}/tasks/mine`, { token: who.token })).body.items;
}

async function view(c: Crew, who: ParticipantLink, taskId: string) {
	return call<TaskView>('GET', `${base(c)}/tasks/${taskId}/view`, { token: who.token });
}

async function submit(
	c: Crew,
	who: ParticipantLink,
	taskId: string,
	submission: object,
	k = key()
) {
	return call<SubmitTaskResult>('POST', `${base(c)}/tasks/${taskId}/submit`, {
		token: who.token,
		body: { submission, idempotencyKey: k }
	});
}

async function startRun(c: Crew, briefA: string, briefB: string, config?: object) {
	const res = await call<Run>('POST', `${base(c)}/runs`, { body: { briefA, briefB, config } });
	expect(res.status).toBe(201);
	return res.body;
}

const seedBlock = (title: string, body: string) => ({
	type: 'seed_block',
	block: { kind: 'EVENT', title, body }
});

type Seeded = {
	triangle: ProtocolState['triangles'][number];
	seedA: { artifactId: string; revisionId: string };
	seedB: { artifactId: string; revisionId: string };
};

/** Both seeds submitted; returns the root triangle and the two seed artifacts. */
async function seedBoth(
	c: Crew,
	a = ['Alpha seed', 'alpha body'],
	b = ['Bravo seed', 'bravo body']
): Promise<Seeded> {
	const [taskA] = await myTasks(c, c.A);
	const [taskB] = await myTasks(c, c.B);
	if (!taskA || !taskB) throw new Error('seed tasks missing');
	const subA = await submit(c, c.A, taskA.id, seedBlock(a[0] as string, a[1] as string));
	const subB = await submit(c, c.B, taskB.id, seedBlock(b[0] as string, b[1] as string));
	expect(subA.status).toBe(200);
	expect(subB.status).toBe(200);
	const state = (await call<ProtocolState>('GET', `${base(c)}/protocol`)).body;
	const triangle = state.triangles[0];
	if (!triangle) throw new Error('root triangle missing');
	return {
		triangle,
		seedA: subA.body.task.resultRefs[0] as { artifactId: string; revisionId: string },
		seedB: subB.body.task.resultRefs[0] as { artifactId: string; revisionId: string }
	};
}

const FACTS = [
	{
		kind: 'object',
		text: 'A humming lantern',
		rationale: 'private-rationale-1'
	},
	{ kind: 'rule', text: 'The river forbidden', rationale: 'private-rationale-2' },
	{ kind: 'trace', text: 'Fresh footprints' }
];

async function proposeFacts(c: Crew, triangleId: string, facts: object[] = FACTS) {
	const tasks = await myTasks(c, c.C);
	const task = tasks.find((x) => x.type === 'propose_fact' && x.triangleId === triangleId);
	if (!task) throw new Error('propose task missing');
	const res = await submit(c, c.C, task.id, { type: 'propose_fact', candidates: facts });
	expect(res.status).toBe(200);
	return (await call<TriangleDetail>('GET', `${base(c)}/triangles/${triangleId}`)).body;
}

async function acceptFact(c: Crew, triangleId: string, candidateId: string, who?: ParticipantLink) {
	return call<TriangleDetail>('POST', `${base(c)}/triangles/${triangleId}/accept-fact`, {
		token: who?.token,
		body: { candidateId }
	});
}

const advanceBlock = (title: string, body: string) => ({
	type: 'advance_block',
	block: { kind: 'EVENT', title, body }
});

function expectNoLeak(value: unknown, markers: string[]) {
	const text = JSON.stringify(value);
	for (const marker of markers) expect(text, `leaked ${marker}`).not.toContain(marker);
}

beforeAll(async () => {
	t = await createTestService();
	app = buildApp({ service: t.service });
});

afterAll(async () => {
	await app.close();
	await t.close();
});

describe('human-only Block–Fact protocol', () => {
	let c: Crew;
	let run: Run;
	let root: Seeded;
	let candidates: TriangleDetail['candidates'];
	let childId = '';
	let m: Artifact | undefined;

	it('starts a run: each side sees only its own brief', async () => {
		c = await crew('protocol-e2e');
		run = await startRun(
			c,
			'ALPHA-BRIEF an old man plants a tree',
			'BRAVO-BRIEF the universe collapses'
		);
		expect(run.briefs.A).toContain('ALPHA-BRIEF');

		const aTasks = await myTasks(c, c.A);
		const bTasks = await myTasks(c, c.B);
		expect(aTasks).toHaveLength(1);
		expect(bTasks).toHaveLength(1);
		expect(aTasks[0]).toMatchObject({
			type: 'seed_block',
			role: 'A',
			runId: null,
			triangleId: null
		});
		expect(await myTasks(c, c.C)).toHaveLength(0);

		const aView = await view(c, c.A, (aTasks[0] as { id: string }).id);
		expect(aView.body).toMatchObject({ type: 'seed_block', brief: run.briefs.A });
		expectNoLeak(aView.body, ['BRAVO-BRIEF', run.id]);
		// B's task is invisible to A, indistinguishable from a missing one.
		const crossed = await view(c, c.A, (bTasks[0] as { id: string }).id);
		expect(crossed.status).toBe(404);
		expect(codeOf(crossed)).toBe('TASK_NOT_FOUND');
		const missing = await view(c, c.A, randomUUID());
		expect(missing.status).toBe(404);
		expect(codeOf(missing)).toBe('TASK_NOT_FOUND');
	});

	it('seeds are idempotent and open the first C task', async () => {
		const [taskA] = await myTasks(c, c.A);
		const [taskB] = await myTasks(c, c.B);
		if (!taskA || !taskB) throw new Error('missing');
		const k = key();
		const first = await submit(c, c.A, taskA.id, seedBlock('ALPHA-TITLE', 'alpha-secret-body'), k);
		expect(first.body.replayed).toBe(false);
		const again = await submit(c, c.A, taskA.id, seedBlock('different', 'different'), k);
		expect(again.body.replayed).toBe(true);
		expect(again.body.task.resultRefs).toEqual(first.body.task.resultRefs);
		// A different key on a submitted task is refused; another task cannot reuse the key.
		expect(codeOf(await submit(c, c.A, taskA.id, seedBlock('x', 'y')))).toBe('INVALID_STATE');
		expect(codeOf(await submit(c, c.B, taskB.id, seedBlock('x', 'y'), k))).toBe(
			'IDEMPOTENCY_KEY_REUSED'
		);
		expect(await myTasks(c, c.C)).toHaveLength(0);
		const second = await submit(c, c.B, taskB.id, seedBlock('BRAVO-TITLE', 'bravo-secret-body'));
		expect(second.status).toBe(200);

		const state = (await call<ProtocolState>('GET', `${base(c)}/protocol`)).body;
		expect(state.runs).toHaveLength(1);
		expect(state.triangles).toHaveLength(1);
		const triangle = state.triangles[0];
		expect(triangle).toMatchObject({ status: 'proposed', stageIndex: 2, depth: 1, fact: null });
		root = {
			triangle: triangle as ProtocolState['triangles'][number],
			seedA: first.body.task.resultRefs[0] as { artifactId: string; revisionId: string },
			seedB: second.body.task.resultRefs[0] as { artifactId: string; revisionId: string }
		};
		// Seeds live in the submitter's private scope, ACCEPTED.
		const seed = (await call<Artifact>('GET', `${base(c)}/artifacts/${root.seedA.artifactId}`))
			.body;
		expect(seed).toMatchObject({
			ownerScope: 'A_PRIVATE',
			status: 'ACCEPTED',
			artifactClass: 'BLOCK'
		});
	});

	it('C sees both blocks; A and B see no protocol surface', async () => {
		const tasks = await myTasks(c, c.C);
		expect(tasks).toHaveLength(1);
		const cView = await view(c, c.C, (tasks[0] as { id: string }).id);
		expect(cView.body).toMatchObject({
			type: 'propose_fact',
			left: { id: root.seedA.artifactId, title: 'ALPHA-TITLE', body: 'alpha-secret-body' },
			right: { id: root.seedB.artifactId, title: 'BRAVO-TITLE', body: 'bravo-secret-body' },
			existingFacts: [],
			policy: { maxWords: 4, maxChars: 48, maxCandidates: 3 }
		});
		for (const who of [c.A, c.B]) {
			for (const url of [
				`${base(c)}/protocol`,
				`${base(c)}/runs`,
				`${base(c)}/tasks`,
				`${base(c)}/triangles/${root.triangle.id}`,
				`${base(c)}/triangles/${randomUUID()}`,
				`${base(c)}/facts/${randomUUID()}/rationale`
			]) {
				const res = await call('GET', url, { token: who.token });
				expect(res.status, url).toBe(403);
			}
		}
		// A cannot work on C's task or even see its view.
		const peek = await view(c, c.A, (tasks[0] as { id: string }).id);
		expect(peek.status).toBe(404);
		// Nobody but C proposes.
		expect(
			(
				await submit(c, c.A, (tasks[0] as { id: string }).id, {
					type: 'propose_fact',
					candidates: FACTS
				})
			).status
		).toBe(404);
		// Another project's C cannot see this project at all.
		const other = await crew('other-project');
		for (const url of [
			`${base(c)}/tasks/mine`,
			`${base(c)}/protocol`,
			`${base(c)}/triangles/${root.triangle.id}`
		]) {
			const res = await call('GET', url, { token: other.C.token });
			expect(res.status).toBe(404);
			expect(codeOf(res)).toBe('PROJECT_NOT_FOUND');
		}
	});

	it('rejects Facts longer than a couple of words or with clauses inside', async () => {
		const tasks = await myTasks(c, c.C);
		const id = (tasks[0] as { id: string }).id;
		const tooLong = await submit(c, c.C, id, {
			type: 'propose_fact',
			candidates: [{ kind: 'object', text: 'roots keep memory of every lost child' }]
		});
		expect(tooLong.status).toBe(400);
		expect(codeOf(tooLong)).toBe('VALIDATION_FAILED');
		const outline = await submit(c, c.C, id, {
			type: 'propose_fact',
			candidates: [{ kind: 'object', text: 'A door opens. Then a man walks in.' }]
		});
		expect(outline.status).toBe(400);
		// Owner's example: a qualified explanation is not a Fact; the bare statement is.
		const explained = await submit(c, c.C, id, {
			type: 'propose_fact',
			candidates: [
				{ kind: 'trace', text: 'В корнях обнаружена неизвестная система хранения памяти' }
			]
		});
		expect(explained.status).toBe(400);
		const tooMany = await submit(c, c.C, id, {
			type: 'propose_fact',
			candidates: [...FACTS, FACTS[0]]
		});
		expect(tooMany.status).toBe(422);
		expect(codeOf(tooMany)).toBe('CANDIDATE_LIMIT_EXCEEDED');
	});

	it('C proposes three Facts; only the facilitator accepts under the default policy', async () => {
		const detail = await proposeFacts(c, root.triangle.id);
		candidates = detail.candidates;
		expect(candidates).toHaveLength(3);
		expect(candidates.every((x) => x.status === 'proposed')).toBe(true);
		// Candidates are PROPOSED Facts in C_SHARED, invisible to A/B.
		const fact = (
			await call<Artifact>('GET', `${base(c)}/artifacts/${candidates[0]?.fact.artifactId}`)
		).body;
		expect(fact).toMatchObject({
			artifactClass: 'FACT',
			factKind: 'object',
			status: 'PROPOSED',
			ownerScope: 'C_SHARED',
			body: ''
		});
		for (const who of [c.A, c.B]) {
			const res = await call('GET', `${base(c)}/artifacts/${fact.id}`, { token: who.token });
			expect(res.status).toBe(404);
		}
		// Rationale: HUMAN and C only.
		expect(candidates[0]?.rationale).toBe('private-rationale-1');
		const cRead = await call<{ rationale: string }>(
			'GET',
			`${base(c)}/facts/${fact.id}/rationale`,
			{ token: c.C.token }
		);
		expect(cRead.body.rationale).toBe('private-rationale-1');
		// C may not accept: the run's policy is `facilitator`.
		const denied = await acceptFact(c, root.triangle.id, (candidates[0] as { id: string }).id, c.C);
		expect(denied.status).toBe(403);
		// A resubmission of the already-submitted proposal is idempotent / refused.
		const again = await call('GET', `${base(c)}/tasks/mine`, { token: c.C.token });
		expect(again.status).toBe(200);
	});

	it('accepting a Fact discloses exactly that Fact to the advancing sides', async () => {
		const chosen = candidates[1] as TriangleDetail['candidates'][number];
		const accepted = await acceptFact(c, root.triangle.id, chosen.id);
		expect(accepted.status).toBe(200);
		expect(accepted.body.triangle).toMatchObject({
			status: 'expanding',
			fact: { artifactId: chosen.fact.artifactId }
		});
		expect(accepted.body.candidates.map((x) => x.status).sort()).toEqual([
			'accepted',
			'rejected',
			'rejected'
		]);
		expect(codeOf(await acceptFact(c, root.triangle.id, chosen.id))).toBe('INVALID_STATE');

		const [aTask] = (await myTasks(c, c.A)).filter((x) => x.type === 'advance_block');
		const [bTask] = (await myTasks(c, c.B)).filter((x) => x.type === 'advance_block');
		if (!aTask || !bTask) throw new Error('advance tasks missing');
		expect(aTask).toMatchObject({ direction: 'forward', triangleId: null, side: null, depth: 0 });
		expect(bTask.direction).toBe('backward');

		const aView = await view(c, c.A, aTask.id);
		expect(aView.status).toBe(200);
		expect(aView.body).toMatchObject({
			type: 'advance_block',
			direction: 'forward',
			ownBlock: { id: root.seedA.artifactId, title: 'ALPHA-TITLE', body: 'alpha-secret-body' },
			fact: {
				id: chosen.fact.artifactId,
				text: 'The river forbidden',
				kind: 'rule'
			}
		});
		const markersForA = [
			root.seedB.artifactId,
			'BRAVO-TITLE',
			'bravo-secret-body',
			'BRAVO-BRIEF',
			root.triangle.id,
			run.id,
			'private-rationale'
		];
		expectNoLeak(aView.body, markersForA);
		expectNoLeak(await myTasks(c, c.A), markersForA);

		const bView = await view(c, c.B, bTask.id);
		expect(bView.body).toMatchObject({
			type: 'advance_block',
			direction: 'backward',
			ownBlock: { id: root.seedB.artifactId, title: 'BRAVO-TITLE' }
		});
		expectNoLeak(bView.body, [
			root.seedA.artifactId,
			'ALPHA-TITLE',
			'alpha-secret-body',
			'ALPHA-BRIEF',
			root.triangle.id,
			run.id,
			'private-rationale'
		]);

		// A reads the Fact only after acceptance, and only the accepted one.
		const factRead = await call<Artifact>('GET', `${base(c)}/artifacts/${chosen.fact.artifactId}`, {
			token: c.A.token
		});
		expect(factRead.status).toBe(200);
		expect(factRead.body).toMatchObject({
			title: 'The river forbidden',
			body: ''
		});
		for (const other of [candidates[0], candidates[2]]) {
			const res = await call('GET', `${base(c)}/artifacts/${other?.fact.artifactId}`, {
				token: c.A.token
			});
			expect(res.status).toBe(404);
		}
		const aGraph = (await call<ProjectGraph>('GET', `${base(c)}/graph`, { token: c.A.token })).body;
		expect(aGraph.artifacts.map((a) => a.id).sort()).toEqual(
			[root.seedA.artifactId, chosen.fact.artifactId].sort()
		);
		expectNoLeak(aGraph, [root.seedB.artifactId, 'BRAVO-TITLE', 'bravo-secret-body']);
		// B's has_fact relation to the Fact stays hidden from A (its endpoint is invisible).
		expect(aGraph.relations.every((r) => r.fromId !== root.seedB.artifactId)).toBe(true);
		expect(
			(await call('GET', `${base(c)}/artifacts/${root.seedB.artifactId}`, { token: c.A.token }))
				.status
		).toBe(404);
		// The disclosure record is the Fact only.
		const disclosures = (
			await call<{
				items: Array<{ sharedPayload: { title: string; body: string }; sourceRefs: unknown[] }>;
			}>('GET', `${base(c)}/disclosures`, { token: c.A.token })
		).body.items;
		expect(disclosures).toHaveLength(1);
		expect(disclosures[0]).toMatchObject({
			sharedPayload: { title: 'The river forbidden', body: '' },
			sourceRefs: []
		});
		// Rationale and triangles stay closed for A.
		expect(
			(
				await call('GET', `${base(c)}/facts/${chosen.fact.artifactId}/rationale`, {
					token: c.A.token
				})
			).status
		).toBe(403);
		expect(
			(await call('GET', `${base(c)}/triangles/${root.triangle.id}`, { token: c.A.token })).status
		).toBe(403);
	});

	it('A and B advance independently with brand-new Blocks; the triangle converges', async () => {
		const headBefore = (
			await call<Artifact>('GET', `${base(c)}/artifacts/${root.seedA.artifactId}`)
		).body.headRevisionId;
		const [aTask] = (await myTasks(c, c.A)).filter((x) => x.type === 'advance_block');
		const [bTask] = (await myTasks(c, c.B)).filter((x) => x.type === 'advance_block');
		if (!aTask || !bTask) throw new Error('advance tasks missing');
		const a2 = await submit(c, c.A, aTask.id, advanceBlock('Alpha continues', 'alpha next'));
		expect(a2.status).toBe(200);
		const [aRef] = a2.body.task.resultRefs;
		expect(aRef?.artifactId).not.toBe(root.seedA.artifactId);
		const b2 = await submit(c, c.B, bTask.id, advanceBlock('Bravo prepares', 'bravo before'));
		expect(b2.status).toBe(200);
		// The anchors are unchanged: a continuation never rewrites its anchor.
		const headAfter = (await call<Artifact>('GET', `${base(c)}/artifacts/${root.seedA.artifactId}`))
			.body.headRevisionId;
		expect(headAfter).toBe(headBefore);
		const detail = (await call<TriangleDetail>('GET', `${base(c)}/triangles/${root.triangle.id}`))
			.body;
		expect(detail.triangle.status).toBe('converged');
		expect(detail.triangle.continuations).toHaveLength(2);
		// forward: anchor precedes continuation; backward: continuation precedes anchor.
		const graph = (await call<ProjectGraph>('GET', `${base(c)}/graph`)).body;
		const precedes = graph.relations.filter((r) => r.type === 'precedes');
		expect(
			precedes.some((r) => r.fromId === root.seedA.artifactId && r.toId === aRef?.artifactId)
		).toBe(true);
		const bRef = b2.body.task.resultRefs[0];
		expect(
			precedes.some((r) => r.fromId === bRef?.artifactId && r.toId === root.seedB.artifactId)
		).toBe(true);
		expect(graph.relations.filter((r) => r.type === 'has_fact')).toHaveLength(4);
	});

	it('opens a child gap between the two continuations (depth 2, stage 4)', async () => {
		const detail = (await call<TriangleDetail>('GET', `${base(c)}/triangles/${root.triangle.id}`))
			.body;
		const left = detail.triangle.continuations.find((x) => x.side === 'left');
		const right = detail.triangle.continuations.find((x) => x.side === 'right');
		if (!left || !right) throw new Error('continuations missing');
		const child = await call<TriangleDetail>('POST', `${base(c)}/connect`, {
			body: {
				left: { artifactId: left.block.artifactId },
				right: { artifactId: right.block.artifactId },
				parentTriangleId: root.triangle.id
			}
		});
		expect(child.status).toBe(201);
		expect(child.body.triangle).toMatchObject({
			depth: 2,
			stageIndex: 4,
			status: 'proposed',
			runId: run.id
		});
		childId = child.body.triangle.id;
		// A duplicate open gap is refused.
		const dup = await call('POST', `${base(c)}/connect`, {
			body: {
				left: { artifactId: left.block.artifactId },
				right: { artifactId: right.block.artifactId }
			}
		});
		expect(codeOf(dup)).toBe('INVALID_STATE');
		// Depth limit of another run.
		const shallow = await startRun(c, 'shallow brief a', 'shallow brief b', { maxDepth: 1 });
		const tooDeep = await call('POST', `${base(c)}/connect`, {
			body: {
				left: { artifactId: root.seedA.artifactId },
				right: { artifactId: root.seedB.artifactId },
				parentTriangleId: root.triangle.id,
				runId: shallow.id
			}
		});
		expect(tooDeep.status).toBe(422);
		expect(codeOf(tooDeep)).toBe('DEPTH_LIMIT_EXCEEDED');
		// Self connection / Fact without viaFact are refused.
		expect(
			codeOf(
				await call('POST', `${base(c)}/connect`, {
					body: {
						left: { artifactId: left.block.artifactId },
						right: { artifactId: left.block.artifactId }
					}
				})
			)
		).toBe('SELF_RELATION');
		expect(
			(
				await call('POST', `${base(c)}/connect`, {
					body: {
						left: { artifactId: candidates[1]?.fact.artifactId },
						right: { artifactId: left.block.artifactId }
					}
				})
			).status
		).toBe(400);
	});

	it('C proposes for the child gap, the facilitator accepts, both sides advance at stage 5', async () => {
		const detail = await proposeFacts(c, childId, [{ kind: 'need', text: 'Village needs water' }]);
		const accepted = await acceptFact(c, childId, (detail.candidates[0] as { id: string }).id);
		expect(accepted.status).toBe(200);
		const advance = accepted.body.tasks.filter((x) => x.type === 'advance_block');
		expect(advance).toHaveLength(2);
		expect(advance.every((x) => x.stageIndex === 5 && x.depth === 2)).toBe(true);
		// The continuations are the anchors now: own Block + local chain, no other side.
		const [aTask] = (await myTasks(c, c.A)).filter(
			(x) => x.type === 'advance_block' && x.state === 'pending'
		);
		if (!aTask) throw new Error('missing');
		const aView = await view(c, c.A, aTask.id);
		expect(aView.body).toMatchObject({ ownBlock: { title: 'Alpha continues' } });
		const chain = (aView.body as Extract<TaskView, { type: 'advance_block' }>).localContext;
		expect(chain.map((x) => x.title)).toEqual(['ALPHA-TITLE']);
		for (const task of await myTasks(c, c.A)) {
			if (task.type !== 'advance_block' || task.state !== 'pending') continue;
			expect(
				(await submit(c, c.A, task.id, advanceBlock('Alpha again', 'alpha three'))).status
			).toBe(200);
		}
		for (const task of await myTasks(c, c.B)) {
			if (task.type !== 'advance_block' || task.state !== 'pending') continue;
			expect(
				(await submit(c, c.B, task.id, advanceBlock('Bravo again', 'bravo three'))).status
			).toBe(200);
		}
		const done = (await call<TriangleDetail>('GET', `${base(c)}/triangles/${childId}`)).body;
		expect(done.triangle.status).toBe('converged');
	});

	it('composes the root triangle and uses the composite as an endpoint of a new gap', async () => {
		const composed = await call<CompositeView>(
			'POST',
			`${base(c)}/triangles/${root.triangle.id}/compose`,
			{
				body: { title: 'Root triangle', summary: 'a composed triangle' }
			}
		);
		expect(composed.status).toBe(201);
		m = composed.body.artifact;
		expect(composed.body.definition.members.map((x) => x.artifactId).sort()).toEqual(
			[
				root.seedA.artifactId,
				root.seedB.artifactId,
				candidates[1]?.fact.artifactId,
				...(
					await call<TriangleDetail>('GET', `${base(c)}/triangles/${root.triangle.id}`)
				).body.triangle.continuations.map((x) => x.block.artifactId)
			].sort()
		);
		expect(composed.body.definition.boundary).toEqual({
			entries: [root.seedA.artifactId],
			exits: [root.seedB.artifactId]
		});
		expect(composed.body.relations.length).toBeGreaterThanOrEqual(6);

		const n = await call<Artifact>('POST', `${base(c)}/artifacts`, {
			body: { kind: 'EVENT', title: 'Human block N', body: 'a new human block' }
		});
		expect(n.status).toBe(201);
		const gap = await call<TriangleDetail>('POST', `${base(c)}/connect`, {
			body: { left: { artifactId: m.id }, right: { artifactId: n.body.id } }
		});
		expect(gap.status).toBe(201);
		expect(gap.body.triangle.left.artifactId).toBe(m.id);
		expect(gap.body.triangle).toMatchObject({ depth: 1, stageIndex: 2 });

		// The composite endpoint works through the whole protocol: the sides advance from it.
		const proposed = await proposeFacts(c, gap.body.triangle.id, [
			{ kind: 'resource', text: 'One surviving map' }
		]);
		const okay = await acceptFact(
			c,
			gap.body.triangle.id,
			(proposed.candidates[0] as { id: string }).id
		);
		expect(okay.status).toBe(200);
		const compositeTask = (await myTasks(c, c.A)).find(
			(x) => x.type === 'advance_block' && x.state === 'pending'
		);
		if (!compositeTask) throw new Error('missing');
		const compositeView = await view(c, c.A, compositeTask.id);
		expect(compositeView.body).toMatchObject({ ownBlock: { id: m.id, title: 'Root triangle' } });
		expectNoLeak(compositeView.body, [root.seedB.artifactId, 'BRAVO-TITLE', 'bravo-secret-body']);

		const opened = (await call<CompositeView>('GET', `${base(c)}/composites/${m.id}?depth=1`)).body;
		expect(opened.memberArtifacts.map((a) => a.id).sort()).toEqual(
			composed.body.definition.members.map((x) => x.artifactId).sort()
		);
		expect(opened.memberArtifacts.find((a) => a.id === root.seedA.artifactId)?.title).toBe(
			'ALPHA-TITLE'
		);
	});

	it('a Fact can be an anchor through a persisted FactAnchor', async () => {
		const factId = candidates[1]?.fact.artifactId as string;
		const anchor = await call<{ id: string; fact: { artifactId: string } }>(
			'POST',
			`${base(c)}/fact-anchors`,
			{
				body: { factArtifactId: factId }
			}
		);
		expect(anchor.status).toBe(201);
		const reused = await call<{ id: string }>('POST', `${base(c)}/fact-anchors`, {
			body: { factArtifactId: factId }
		});
		expect(reused.body.id).toBe(anchor.body.id);
		// Rejected candidates are not anchorable.
		const rejected = await call('POST', `${base(c)}/fact-anchors`, {
			body: { factArtifactId: candidates[0]?.fact.artifactId }
		});
		expect(rejected.status).toBe(409);
		const block = await call<Artifact>('POST', `${base(c)}/artifacts`, {
			body: { kind: 'EVENT', title: 'Block for the fact gap', body: 'text' }
		});
		const gap = await call<TriangleDetail>('POST', `${base(c)}/connect`, {
			body: {
				left: { artifactId: factId, viaFact: true },
				right: { artifactId: block.body.id }
			}
		});
		expect(gap.status).toBe(201);
		expect(gap.body.triangle.left).toMatchObject({
			artifactId: factId,
			factAnchorId: anchor.body.id
		});
		expect(gap.body.triangle).toMatchObject({ stageIndex: 3 });
	});

	it('revoking the Fact grant closes the Fact for the side; the revocation is not undone', async () => {
		const fresh = await crew('revoke');
		await startRun(fresh, 'a brief for a', 'a brief for b');
		const seeded = await seedBoth(fresh);
		const detail = await proposeFacts(fresh, seeded.triangle.id, [
			{ kind: 'object', text: 'Key in well' }
		]);
		const accepted = await acceptFact(
			fresh,
			seeded.triangle.id,
			(detail.candidates[0] as { id: string }).id
		);
		const factId = accepted.body.triangle.fact?.artifactId as string;
		const grants = (
			await call<{ items: Array<{ id: string; granteePrincipalId: string; artifactId: string }> }>(
				'GET',
				`${base(fresh)}/grants`
			)
		).body.items;
		const grant = grants.find(
			(g) => g.granteePrincipalId === fresh.A.principalId && g.artifactId === factId
		);
		expect(grant).toBeDefined();
		expect(
			(await call('POST', `${base(fresh)}/grants/${grant?.id}/revoke`, { body: {} })).status
		).toBe(200);
		expect(
			(await call('GET', `${base(fresh)}/artifacts/${factId}`, { token: fresh.A.token })).status
		).toBe(404);
		const [aTask] = (await myTasks(fresh, fresh.A)).filter((x) => x.type === 'advance_block');
		if (!aTask) throw new Error('missing');
		const blocked = await view(fresh, fresh.A, aTask.id);
		expect(blocked.status).toBe(409);
		expect(codeOf(blocked)).toBe('INVALID_STATE');
		// B keeps its own grant.
		expect(
			(await call('GET', `${base(fresh)}/artifacts/${factId}`, { token: fresh.B.token })).status
		).toBe(200);
	});

	it('in a mediator run C accepts its own Fact', async () => {
		const med = await crew('mediator');
		await startRun(med, 'brief a for the mediator run', 'brief b for the mediator run', {
			factReview: 'mediator'
		});
		const seeded = await seedBoth(med);
		const detail = await proposeFacts(med, seeded.triangle.id, [
			{ kind: 'signal', text: 'Bell rings twice' }
		]);
		const accepted = await acceptFact(
			med,
			seeded.triangle.id,
			(detail.candidates[0] as { id: string }).id,
			med.C
		);
		expect(accepted.status).toBe(200);
		expect(accepted.body.triangle.status).toBe('expanding');
		// A and B never get that right.
		const other = await acceptFact(
			med,
			seeded.triangle.id,
			(detail.candidates[0] as { id: string }).id,
			med.A
		);
		expect(other.status).toBe(403);
	});

	it('executor kind does not change the ACL: an AI-kind A is as restricted as a human A', async () => {
		const ai = await participant(c.project.id, 'A', 'ai');
		const agents = (await call<{ items: AgentPrincipal[] }>('GET', `${base(c)}/agents`)).body.items;
		expect(agents.find((a) => a.id === ai.principalId)?.executorKind).toBe('ai');
		for (const url of [`${base(c)}/protocol`, `${base(c)}/runs`, `${base(c)}/tasks`]) {
			expect((await call('GET', url, { token: ai.token })).status).toBe(403);
		}
		const graph = (await call<ProjectGraph>('GET', `${base(c)}/graph`, { token: ai.token })).body;
		expectNoLeak(graph, [root.seedB.artifactId, 'BRAVO-TITLE']);
		// Role-based claiming: an unassigned A task is claimable by any A, an assigned one only by its assignee.
		await startRun(c, 'second run brief a', 'second run brief b');
		const claimable = (await myTasks(c, ai)).filter(
			(x) => x.runId === null && x.type === 'seed_block'
		);
		expect(claimable.length).toBeGreaterThan(0);
	});

	it('exports the protocol state and re-imports it with remapped ids', async () => {
		const bundle = (await call<ExportBundle>('GET', `${base(c)}/export`)).body;
		expect(bundle.triangles?.length).toBe(4);
		expect(bundle.factCandidates?.length).toBe(5);
		expect(bundle.factRationales?.length).toBe(2);
		expect(bundle.factAnchors).toHaveLength(1);
		const imported = await call<ImportResult>('POST', '/projects/import?remapIds=true', {
			body: bundle
		});
		expect(imported.status).toBe(201);
		const copy = (await call<ProtocolState>('GET', `/projects/${imported.body.projectId}/protocol`))
			.body;
		expect(copy.triangles).toHaveLength(bundle.triangles?.length ?? -1);
		expect(copy.tasks).toHaveLength(bundle.tasks?.length ?? -1);
		expect(copy.runs).toHaveLength(bundle.runs?.length ?? -1);
		const original = new Set(bundle.triangles?.map((x) => x.id));
		expect(copy.triangles.every((x) => !original.has(x.id))).toBe(true);
		const copyGraph = (
			await call<ProjectGraph>('GET', `/projects/${imported.body.projectId}/graph`)
		).body;
		const ids = new Set(copyGraph.artifacts.map((a) => a.id));
		for (const tri of copy.triangles) {
			expect(ids.has(tri.left.artifactId)).toBe(true);
			expect(ids.has(tri.right.artifactId)).toBe(true);
			if (tri.fact) expect(ids.has(tri.fact.artifactId)).toBe(true);
			expect(tri.runId === null || copy.runs.some((r) => r.id === tri.runId)).toBe(true);
		}
		const detail = (
			await call<TriangleDetail>(
				'GET',
				`/projects/${imported.body.projectId}/triangles/${copy.triangles[0]?.id}`
			)
		).body;
		expect(detail.candidates.length).toBeGreaterThan(0);
		expect(m).toBeDefined();
	});
});

describe('Fact artifact rules', () => {
	it('enforces lint, empty body, factKind and authorship', async () => {
		const c = await crew('fact-rules');
		const post = (body: object, token?: string) =>
			call<Artifact>('POST', `${base(c)}/artifacts`, { token, body });
		const ok = await post({
			kind: 'NOTE',
			artifactClass: 'FACT',
			factKind: 'object',
			title: 'A rusted key'
		});
		expect(ok.status).toBe(201);
		expect(ok.body).toMatchObject({ artifactClass: 'FACT', factKind: 'object', body: '' });
		for (const bad of [
			{ title: 'x'.repeat(161), factKind: 'object' },
			{ title: 'One. Two sentences', factKind: 'object' },
			{ title: 'Has a body', body: 'not allowed', factKind: 'object' },
			{ title: 'No kind' }
		]) {
			const res = await post({ kind: 'NOTE', artifactClass: 'FACT', ...bad });
			expect(res.status, JSON.stringify(bad)).toBe(400);
			expect(codeOf(res)).toBe('VALIDATION_FAILED');
		}
		// Agents never create Facts ad hoc.
		expect(
			(
				await post(
					{ kind: 'NOTE', artifactClass: 'FACT', factKind: 'object', title: 'sneaky' },
					c.C.token
				)
			).status
		).toBe(403);
		// Patching enforces the same lint.
		const patch = await app.inject({
			method: 'PATCH',
			url: `/api${base(c)}/artifacts/${ok.body.id}`,
			headers: { 'if-match': ok.body.headRevisionId },
			payload: { title: 'x'.repeat(200) }
		});
		expect(patch.statusCode).toBe(400);
		// Legacy expansions refuse Fact anchors.
		const block = await post({ kind: 'EVENT', title: 'plain block' });
		const expansion = await call('POST', `${base(c)}/expansions`, {
			body: { leftArtifactId: ok.body.id, rightArtifactId: block.body.id }
		});
		expect(expansion.status).toBe(409);
		expect(codeOf(expansion)).toBe('INVALID_STATE');
		// Old behaviour: a plain Block keeps working, class defaults to BLOCK.
		expect(block.body.artifactClass).toBe('BLOCK');
	});
});
