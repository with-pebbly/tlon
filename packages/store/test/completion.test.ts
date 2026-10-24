import { randomUUID } from 'node:crypto';

import type { Principal, Project, Triangle } from '@tlon/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TlonService } from '../src/service.ts';
import { createTestService, type TestService } from '../src/testing.ts';
import { P, expectCode, makeAgent } from './helpers.ts';

let t: TestService;
let service: TlonService;

beforeAll(async () => {
	t = await createTestService();
	service = t.service;
});
afterAll(() => t.close());

type Ref = { artifactId: string; revisionId: string };

async function participant(projectId: string, role: 'A' | 'B' | 'C'): Promise<Principal> {
	const link = await service.createParticipant(P, projectId, { role, name: `${role}-person` });
	return service.authenticateToken(link.token);
}

const key = () => `idem-${randomUUID()}`;

type Seeded = {
	project: Project;
	a: Principal;
	b: Principal;
	c: Principal;
	seedA: Ref;
	seedB: Ref;
	triangle: Triangle;
};

/** Project with participants, both seeds submitted and the root triangle open. */
async function seeded(config?: { completionPolicy?: 'coherent_open_mystery' }): Promise<Seeded> {
	const project = await service.createProject(P, { name: 'completion', domain: 'GENERIC' });
	const a = await participant(project.id, 'A');
	const b = await participant(project.id, 'B');
	const c = await participant(project.id, 'C');
	await service.startRun(P, project.id, { briefA: 'brief a', briefB: 'brief b', config });
	const seed = async (who: Principal, title: string): Promise<Ref> => {
		const [task] = (await service.listMyTasks(who, project.id)).items;
		if (!task) throw new Error('seed task missing');
		const done = await service.submitTask(who, project.id, task.id, {
			submission: { type: 'seed_block', block: { kind: 'EVENT', title, body: `${title} body` } },
			idempotencyKey: key()
		});
		return done.task.resultRefs[0] as Ref;
	};
	const seedA = await seed(a, 'Alpha seed');
	const seedB = await seed(b, 'Bravo seed');
	const [triangle] = (await service.getProtocol(P, project.id)).triangles;
	if (!triangle) throw new Error('root triangle missing');
	return { project, a, b, c, seedA, seedB, triangle };
}

/** C proposes one Fact, the facilitator accepts it; returns the Fact artifact id. */
async function acceptRootFact(s: Seeded): Promise<string> {
	const [task] = (await service.listMyTasks(s.c, s.project.id)).items;
	if (!task) throw new Error('propose task missing');
	await service.submitTask(s.c, s.project.id, task.id, {
		submission: {
			type: 'propose_fact',
			candidates: [{ kind: 'object', text: 'A humming lantern' }]
		},
		idempotencyKey: key()
	});
	const detail = await service.getTriangle(P, s.project.id, s.triangle.id);
	const candidate = detail.candidates[0];
	if (!candidate) throw new Error('candidate missing');
	const accepted = await service.acceptFact(P, s.project.id, s.triangle.id, {
		candidateId: candidate.id
	});
	const fact = accepted.triangle.fact;
	if (!fact) throw new Error('fact missing');
	return fact.artifactId;
}

describe('connections: ACL and rules', () => {
	it('is organizer-only: A, B and C are refused, the validator may only read', async () => {
		const s = await seeded();
		const input = {
			kind: 'thematic_echo',
			endpointIds: [s.seedA.artifactId, s.seedB.artifactId],
			statement: 'Both count things.'
		};
		for (const who of [s.a, s.b, s.c]) {
			await expectCode(service.createConnection(who, s.project.id, input), 'FORBIDDEN');
			await expectCode(service.listConnections(who, s.project.id), 'FORBIDDEN');
			await expectCode(service.getCompletion(who, s.project.id), 'FORBIDDEN');
			await expectCode(service.getAudit(who, s.project.id), 'FORBIDDEN');
			await expectCode(service.certify(who, s.project.id, { policy: 'exploratory' }), 'FORBIDDEN');
		}
		const created = await service.createConnection(P, s.project.id, input);
		expect(created).toMatchObject({ kind: 'thematic_echo', status: 'active', approvedBy: null });
		const v = await makeAgent(service, s.project.id, 'VALIDATOR');
		expect((await service.listConnections(v.principal, s.project.id)).items).toHaveLength(1);
		await service.getCompletion(v.principal, s.project.id);
		await expectCode(service.createConnection(v.principal, s.project.id, input), 'FORBIDDEN');
		await expectCode(service.getAudit(v.principal, s.project.id), 'FORBIDDEN');
	});

	it('ai_review only proposes; canon always needs a human approval, which may adopt an AI suggestion', async () => {
		const s = await seeded();
		const endpointIds = [s.seedA.artifactId, s.seedB.artifactId];
		await expectCode(
			service.createConnection(P, s.project.id, {
				kind: 'causal_canon',
				endpointIds,
				statement: 'x',
				source: 'ai_review',
				approve: true
			}),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.createConnection(P, s.project.id, {
				kind: 'causal_hypothesis',
				endpointIds,
				statement: 'x',
				source: 'ai_review',
				approve: true
			}),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.createConnection(P, s.project.id, {
				kind: 'causal_canon',
				endpointIds,
				statement: 'unapproved'
			}),
			'VALIDATION_FAILED'
		);
		const hypothesis = await service.createConnection(P, s.project.id, {
			kind: 'causal_hypothesis',
			endpointIds,
			statement: 'maybe',
			source: 'ai_review'
		});
		await expectCode(
			service.updateConnection(P, s.project.id, hypothesis.id, { kind: 'causal_canon' }),
			'VALIDATION_FAILED'
		);
		const adopted = await service.updateConnection(P, s.project.id, hypothesis.id, {
			kind: 'causal_canon',
			approve: true
		});
		expect(adopted).toMatchObject({ kind: 'causal_canon', source: 'ai_review', approvedBy: P.id });
		const own = await service.createConnection(P, s.project.id, {
			kind: 'causal_hypothesis',
			endpointIds,
			statement: 'human guess'
		});
		await expectCode(
			service.updateConnection(P, s.project.id, own.id, { kind: 'causal_canon' }),
			'VALIDATION_FAILED'
		);
		const promoted = await service.updateConnection(P, s.project.id, own.id, {
			kind: 'causal_canon',
			approve: true
		});
		expect(promoted).toMatchObject({ kind: 'causal_canon', approvedBy: P.id });
		// Leaving canon withdraws the approval.
		const demoted = await service.updateConnection(P, s.project.id, own.id, {
			kind: 'causal_hypothesis'
		});
		expect(demoted.approvedBy).toBeNull();
	});

	it('rejecting a connection keeps the Fact and every text', async () => {
		const s = await seeded();
		const factId = await acceptRootFact(s);
		const before = await service.getGraph(P, s.project.id);
		const created = await service.createConnection(P, s.project.id, {
			kind: 'causal_hypothesis',
			endpointIds: [s.seedA.artifactId, s.seedB.artifactId],
			factArtifactId: factId,
			statement: 'the lantern is the cause'
		});
		const rejected = await service.updateConnection(P, s.project.id, created.id, {
			status: 'rejected'
		});
		expect(rejected.status).toBe('rejected');
		const after = await service.getGraph(P, s.project.id);
		expect(after.artifacts).toEqual(before.artifacts);
		expect(
			(await service.getTriangle(P, s.project.id, s.triangle.id)).triangle.fact
		).not.toBeNull();
		// A rejected interpretation no longer counts as an open question.
		const report = await service.getCompletion(P, s.project.id);
		expect(report.openQuestions.some((q) => q.connectionId === created.id)).toBe(false);
	});

	it('endpoints, realizedBy and the Fact must belong to the project', async () => {
		const s = await seeded();
		const other = await service.createProject(P, { name: 'other', domain: 'GENERIC' });
		const foreign = await service.createArtifact(P, other.id, { kind: 'EVENT', title: 'foreign' });
		const base = {
			kind: 'thematic_echo',
			endpointIds: [s.seedA.artifactId, s.seedB.artifactId],
			statement: 'x'
		};
		await expectCode(
			service.createConnection(P, s.project.id, {
				...base,
				endpointIds: [s.seedA.artifactId, foreign.id]
			}),
			'CROSS_PROJECT_REFERENCE'
		);
		await expectCode(
			service.createConnection(P, s.project.id, { ...base, realizedByIds: [foreign.id] }),
			'CROSS_PROJECT_REFERENCE'
		);
		await expectCode(
			service.createConnection(P, s.project.id, { ...base, factArtifactId: foreign.id }),
			'CROSS_PROJECT_REFERENCE'
		);
		await expectCode(
			service.createConnection(P, s.project.id, { ...base, factArtifactId: s.seedA.artifactId }),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.createConnection(P, s.project.id, {
				...base,
				endpointIds: [s.seedA.artifactId, s.seedA.artifactId]
			}),
			'SELF_RELATION'
		);
		await expectCode(
			service.updateConnection(P, s.project.id, randomUUID(), { status: 'rejected' }),
			'CONNECTION_NOT_FOUND'
		);
	});
});

describe('completion report and certification', () => {
	it('keeps cross-branch causality unknown and isolation unknown until something is served', async () => {
		const s = await seeded();
		const report = await service.getCompletion(P, s.project.id);
		expect(report).toMatchObject({
			policy: 'exploratory',
			confirmedCrossBranchCausalPaths: 'unknown',
			isolationVerified: 'unknown',
			certifiable: true
		});
		expect(report.connectedFactPairs).toBe(0);
	});

	it('defaults the policy to the latest run config', async () => {
		const s = await seeded({ completionPolicy: 'coherent_open_mystery' });
		expect((await service.getCompletion(P, s.project.id)).policy).toBe('coherent_open_mystery');
		expect((await service.getCompletion(P, s.project.id, { policy: 'resolved' })).policy).toBe(
			'resolved'
		);
	});

	it('blocks certification until open mysteries are approved, then stores the snapshot', async () => {
		const s = await seeded();
		const factId = await acceptRootFact(s);
		const blocked = await service
			.certify(P, s.project.id, { policy: 'coherent_open_mystery' })
			.catch((e: unknown) => e);
		expect(blocked).toMatchObject({ code: 'COMPLETION_BLOCKED', status: 409 });
		expect(blocked).toMatchObject({ details: { reasons: [expect.any(String)] } });
		expect((await service.listCertifications(P, s.project.id)).items).toEqual([]);

		await service.createConnection(P, s.project.id, {
			kind: 'open_mystery',
			endpointIds: [s.seedA.artifactId, s.seedB.artifactId],
			factArtifactId: factId,
			statement: 'How do the lantern and the collapse relate?',
			approve: true
		});
		const cert = await service.certify(P, s.project.id, { policy: 'coherent_open_mystery' });
		expect(cert).toMatchObject({ policy: 'coherent_open_mystery', actorId: P.id });
		expect(cert.report.certifiable).toBe(true);
		expect(cert.report.openQuestions).toEqual([
			expect.objectContaining({ kind: 'open_mystery', intentional: true })
		]);
		expect((await service.listCertifications(P, s.project.id)).items).toHaveLength(1);

		// A Fact link is not causality: the stricter policy stays blocked, honestly unknown.
		await expectCode(
			service.certify(P, s.project.id, { policy: 'causally_connected' }),
			'COMPLETION_BLOCKED'
		);
		expect((await service.getCompletion(P, s.project.id)).confirmedCrossBranchCausalPaths).toBe(0);
	});

	it('counts only approved cross-branch canon as a causal path', async () => {
		const s = await seeded();
		await acceptRootFact(s);
		await service.createConnection(P, s.project.id, {
			kind: 'causal_canon',
			endpointIds: [s.seedA.artifactId, s.seedB.artifactId],
			statement: 'The knocks are the detector pulses.',
			approve: true
		});
		const report = await service.getCompletion(P, s.project.id, { policy: 'causally_connected' });
		expect(report.confirmedCrossBranchCausalPaths).toBe(1);
		const cert = await service.certify(P, s.project.id, { policy: 'causally_connected' });
		expect(cert.report.confirmedCrossBranchCausalPaths).toBe(1);
	});
});

describe('input manifests and the isolation audit', () => {
	it('records what each side was served and finds no cross-scope input', async () => {
		const s = await seeded();
		const factId = await acceptRootFact(s);
		const advance = async (who: Principal) =>
			(await service.listMyTasks(who, s.project.id)).items.find((x) => x.type === 'advance_block');
		const taskA = await advance(s.a);
		const taskB = await advance(s.b);
		if (!taskA || !taskB) throw new Error('advance tasks missing');

		const first = await service.getAudit(P, s.project.id);
		expect(first.isolationVerified).toBe('unknown');
		expect(first.tasks.every((x) => x.manifest === null)).toBe(true);

		const viewA = await service.getTaskView(s.a, s.project.id, taskA.id);
		await service.getTaskView(s.b, s.project.id, taskB.id);
		// A facilitator looking at the task does not overwrite the executor's manifest.
		await service.getTaskView(P, s.project.id, taskA.id);

		const audit = await service.getAudit(P, s.project.id);
		const served = audit.tasks.find((x) => x.taskId === taskA.id);
		expect(served?.manifest?.inputs).toEqual(
			expect.arrayContaining([
				{
					artifactId: s.seedA.artifactId,
					revisionId: s.seedA.revisionId,
					ownerScope: 'A_PRIVATE'
				},
				expect.objectContaining({ artifactId: factId, ownerScope: 'C_SHARED' })
			])
		);
		expect(served?.manifest?.inputs.some((i) => i.artifactId === s.seedB.artifactId)).toBe(false);
		expect(served?.manifest?.disclosureGrantIds.length).toBeGreaterThan(0);
		expect(served?.crossScopeInputIds).toEqual([]);
		// The manifest is ID-level only.
		expect(JSON.stringify(audit)).not.toContain('Alpha seed body');
		expect(viewA.type).toBe('advance_block');

		expect(audit.denyChecks).toHaveLength(2);
		for (const check of audit.denyChecks) {
			expect(check.checkedArtifacts).toBe(1);
			expect(check.visibleArtifactIds).toEqual([]);
		}
		expect(audit.isolationVerified).toBe(true);
		expect((await service.getCompletion(P, s.project.id)).isolationVerified).toBe(true);
	});

	it('flags a leak: a grant on the other side’s Block fails the deny check', async () => {
		const s = await seeded();
		await acceptRootFact(s);
		const taskA = (await service.listMyTasks(s.a, s.project.id)).items.find(
			(x) => x.type === 'advance_block'
		);
		if (!taskA) throw new Error('task missing');
		await service.getTaskView(s.a, s.project.id, taskA.id);
		const agentA = (await service.listAgents(P, s.project.id)).items.find((x) => x.role === 'A');
		if (!agentA) throw new Error('agent A missing');
		await service.createGrant(P, s.project.id, {
			granteePrincipalId: agentA.id,
			artifactId: s.seedB.artifactId
		});
		const audit = await service.getAudit(P, s.project.id);
		expect(audit.denyChecks.find((d) => d.principalId === agentA.id)?.visibleArtifactIds).toEqual([
			s.seedB.artifactId
		]);
		expect(audit.isolationVerified).toBe(false);
	});
});

describe('same-side gaps', () => {
	it('refuses two anchors of one private side with the side in details', async () => {
		const project = await service.createProject(P, { name: 'sides', domain: 'GENERIC' });
		const block = (title: string, ownerScope: string) =>
			service.createArtifact(P, project.id, { kind: 'EVENT', title, ownerScope });
		const [a1, a2, b1, b2, shared] = await Promise.all([
			block('a1', 'A_PRIVATE'),
			block('a2', 'A_PRIVATE'),
			block('b1', 'B_PRIVATE'),
			block('b2', 'B_PRIVATE'),
			block('shared', 'C_SHARED')
		]);
		const gap = (l: string, r: string) =>
			service.connect(P, project.id, { left: { artifactId: l }, right: { artifactId: r } });
		const refusedA = await gap(a1.id, a2.id).catch((e: unknown) => e);
		expect(refusedA).toMatchObject({ code: 'SAME_SIDE_GAP', status: 422, details: { side: 'A' } });
		expect(await gap(b1.id, b2.id).catch((e: unknown) => e)).toMatchObject({
			code: 'SAME_SIDE_GAP',
			details: { side: 'B' }
		});
		expect(
			(
				await service.connect(P, project.id, {
					left: { artifactId: a1.id },
					right: { artifactId: b1.id }
				})
			).triangle.status
		).toBe('proposed');
		expect((await gap(a2.id, shared.id)).triangle.status).toBe('proposed');
		expect((await service.getProtocol(P, project.id)).triangles).toHaveLength(2);
	});
});

describe('export and import', () => {
	it('round-trips connections and certifications with remapped ids', async () => {
		const s = await seeded();
		const factId = await acceptRootFact(s);
		const connection = await service.createConnection(P, s.project.id, {
			kind: 'open_mystery',
			endpointIds: [s.seedA.artifactId, s.seedB.artifactId],
			factArtifactId: factId,
			realizedByIds: [s.seedB.artifactId],
			statement: 'An open question.',
			approve: true
		});
		await service.certify(P, s.project.id, { policy: 'coherent_open_mystery' });
		const bundle = await service.exportProject(P, s.project.id);
		expect(bundle.connections).toHaveLength(1);
		expect(bundle.certifications).toHaveLength(1);

		const result = await service.importAsNewProject(P, bundle, { remapIds: true });
		const imported = await service.listConnections(P, result.projectId);
		expect(imported.items).toHaveLength(1);
		const copy = imported.items[0];
		expect(copy?.id).not.toBe(connection.id);
		expect(copy).toMatchObject({ kind: 'open_mystery', statement: 'An open question.' });
		const graph = await service.getGraph(P, result.projectId);
		const ids = new Set(graph.artifacts.map((a) => a.id));
		expect(copy?.endpointIds.every((id) => ids.has(id))).toBe(true);
		expect(copy?.endpointIds.some((id) => id === s.seedA.artifactId)).toBe(false);
		expect(copy?.factArtifactId && ids.has(copy.factArtifactId)).toBe(true);
		expect(copy?.realizedByIds.every((id) => ids.has(id))).toBe(true);
		const certs = (await service.listCertifications(P, result.projectId)).items;
		expect(certs).toHaveLength(1);
		expect(certs[0]?.report.openQuestions[0]?.connectionId).toBe(copy?.id);
		expect(certs[0]?.report.openQuestions[0]?.endpointIds.every((id) => ids.has(id))).toBe(true);

		// Same ids into a fresh project would clash; an old bundle without the arrays is fine.
		const old: Record<string, unknown> = { ...bundle };
		delete old.connections;
		delete old.certifications;
		const plain = await service.importAsNewProject(P, old, { remapIds: true });
		expect((await service.listConnections(P, plain.projectId)).items).toEqual([]);
	});
});
