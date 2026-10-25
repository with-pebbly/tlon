import { randomUUID } from 'node:crypto';

import type { Principal, Project, Task, TaskView } from '@tlon/contracts';
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
	/** Second Block of each side, written after the root Fact. */
	nextA: Ref;
	nextB: Ref;
};

const SECOND_B_TITLE = 'Bravo second';
const SECOND_B_BODY = 'Ivan «wrote» the nine letters\nin July';

/** Project with both seeds, the accepted root Fact and one advance Block per side. */
async function seeded(): Promise<Seeded> {
	const project = await service.createProject(P, { name: 'findings', domain: 'GENERIC' });
	const a = await participant(project.id, 'A');
	const b = await participant(project.id, 'B');
	const c = await participant(project.id, 'C');
	await service.startRun(P, project.id, { briefA: 'brief a', briefB: 'brief b' });
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

	const [propose] = (await service.listMyTasks(c, project.id)).items;
	if (!propose) throw new Error('propose task missing');
	await service.submitTask(c, project.id, propose.id, {
		submission: {
			type: 'propose_fact',
			candidates: [{ kind: 'object', text: 'A humming lantern' }]
		},
		idempotencyKey: key()
	});
	const [candidate] = (await service.getTriangle(P, project.id, triangle.id)).candidates;
	if (!candidate) throw new Error('candidate missing');
	await service.acceptFact(P, project.id, triangle.id, { candidateId: candidate.id });

	const advance = async (who: Principal, title: string, body: string): Promise<Ref> => {
		const task = (await service.listMyTasks(who, project.id)).items.find(
			(x) => x.type === 'advance_block'
		);
		if (!task) throw new Error('advance task missing');
		const done = await service.submitTask(who, project.id, task.id, {
			submission: { type: 'advance_block', block: { kind: 'EVENT', title, body } },
			idempotencyKey: key()
		});
		return done.task.resultRefs[0] as Ref;
	};
	const nextA = await advance(a, 'Alpha second', 'Alpha second body');
	const nextB = await advance(b, SECOND_B_TITLE, SECOND_B_BODY);
	return { project, a, b, c, seedA, seedB, nextA, nextB };
}

/** A continuity finding on the B chain, grounded in the seed and the second Block. */
const bFinding = (s: Seeded) => ({
	kind: 'identity_conflict',
	severity: 'blocker',
	artifactIds: [s.seedB.artifactId, s.nextB.artifactId],
	explanation: 'The letters are credited to two different authors.',
	evidence: [
		{ artifactId: s.seedB.artifactId, quote: 'Bravo seed body' },
		{ artifactId: s.nextB.artifactId, quote: 'Ivan "wrote" the nine letters in July' }
	]
});

describe('findings: grounding', () => {
	it('accepts a verbatim quote after whitespace and quote-mark normalisation', async () => {
		const s = await seeded();
		const created = await service.createFinding(P, s.project.id, bFinding(s));
		expect(created).toMatchObject({
			kind: 'identity_conflict',
			severity: 'blocker',
			source: 'human',
			stale: false,
			actorId: P.id
		});
		// Guillemets, curly and straight quotes all compare equal; newlines collapse to a space.
		await service.createFinding(P, s.project.id, {
			...bFinding(s),
			evidence: [
				{ artifactId: s.nextB.artifactId, quote: '  Ivan „wrote“ the nine letters\tin   July ' }
			]
		});
		expect(created.evidence).toEqual([
			{
				artifactId: s.seedB.artifactId,
				revisionId: s.seedB.revisionId,
				quote: 'Bravo seed body'
			},
			expect.objectContaining({
				artifactId: s.nextB.artifactId,
				revisionId: s.nextB.revisionId
			})
		]);
		expect((await service.listFindings(P, s.project.id)).items).toHaveLength(2);
	});

	it('rejects a quote that is not in the cited Block, listing exactly the offenders', async () => {
		const s = await seeded();
		await expect(
			service.createFinding(P, s.project.id, {
				...bFinding(s),
				evidence: [
					{ artifactId: s.seedB.artifactId, quote: 'Bravo seed body' },
					{ artifactId: s.nextB.artifactId, quote: 'Ivan wrote the ninth letter in August' },
					// Present in the other Block, but not in the one cited.
					{ artifactId: s.seedB.artifactId, quote: 'nine letters' }
				]
			})
		).rejects.toMatchObject({
			code: 'UNGROUNDED_QUOTE',
			details: {
				ungrounded: [
					{ artifactId: s.nextB.artifactId, quote: 'Ivan wrote the ninth letter in August' },
					{ artifactId: s.seedB.artifactId, quote: 'nine letters' }
				]
			}
		});
		expect((await service.listFindings(P, s.project.id)).items).toEqual([]);
	});

	it('refuses evidence for an artifact the finding does not list, and unknown artifacts', async () => {
		const s = await seeded();
		await expectCode(
			service.createFinding(P, s.project.id, {
				...bFinding(s),
				artifactIds: [s.seedB.artifactId],
				evidence: [{ artifactId: s.nextB.artifactId, quote: 'nine letters' }]
			}),
			'VALIDATION_FAILED'
		);
		const other = await service.createProject(P, { name: 'other', domain: 'GENERIC' });
		const foreign = await service.createArtifact(P, other.id, {
			kind: 'EVENT',
			title: 'Foreign',
			body: 'Foreign body text'
		});
		await expectCode(
			service.createFinding(P, s.project.id, {
				...bFinding(s),
				artifactIds: [foreign.id],
				evidence: [{ artifactId: foreign.id, quote: 'Foreign body text' }]
			}),
			'ARTIFACT_NOT_FOUND'
		);
		await expectCode(service.createFinding(P, s.project.id, { kind: 'x' }), 'VALIDATION_FAILED');
	});
});

describe('findings: access', () => {
	it('is organizer-side only: the validator reports and reads, A/B/C get nothing', async () => {
		const s = await seeded();
		for (const who of [s.a, s.b, s.c]) {
			await expectCode(service.createFinding(who, s.project.id, bFinding(s)), 'FORBIDDEN');
			await expectCode(service.listFindings(who, s.project.id), 'FORBIDDEN');
			await expectCode(
				service.requestRevision(who, s.project.id, {
					issueKey: 'finding:x',
					artifactId: s.nextB.artifactId
				}),
				'FORBIDDEN'
			);
		}
		const v = await makeAgent(service, s.project.id, 'VALIDATOR');
		const created = await service.createFinding(v.principal, s.project.id, {
			...bFinding(s),
			source: 'audit'
		});
		expect(created).toMatchObject({ source: 'audit', actorId: v.principal.id });
		expect((await service.listFindings(v.principal, s.project.id)).items).toHaveLength(1);
		await expectCode(
			service.requestRevision(v.principal, s.project.id, {
				issueKey: `finding:${created.id}`,
				artifactId: s.nextB.artifactId
			}),
			'FORBIDDEN'
		);
		const issues = await service.listIssues(v.principal, s.project.id);
		expect(issues.items.find((i) => i.key === `finding:${created.id}`)?.source).toBe('audit');
	});

	it('never merges findings into the issue list of C, and A/B have no issue list at all', async () => {
		const s = await seeded();
		const created = await service.createFinding(P, s.project.id, bFinding(s));
		const forC = await service.listIssues(s.c, s.project.id);
		expect(forC.items.some((i) => i.key === `finding:${created.id}`)).toBe(false);
		await expectCode(service.listIssues(s.a, s.project.id), 'FORBIDDEN');
		await expectCode(service.listIssues(s.b, s.project.id), 'FORBIDDEN');
		const protocol = await service.getProtocol(s.c, s.project.id);
		expect(JSON.stringify(protocol)).not.toContain(created.id);
	});
});

describe('findings as issues', () => {
	it('merges into /issues, counts in the completion report and obeys dismissals', async () => {
		const s = await seeded();
		const before = await service.getCompletion(P, s.project.id);
		const created = await service.createFinding(P, s.project.id, bFinding(s));
		const issueKey = `finding:${created.id}`;
		const open = (await service.listIssues(P, s.project.id)).items.find((i) => i.key === issueKey);
		expect(open).toMatchObject({
			kind: 'identity_conflict',
			severity: 'blocker',
			artifactIds: [s.seedB.artifactId, s.nextB.artifactId],
			stateKey: null,
			explanation: 'The letters are credited to two different authors.',
			suggestedAction: 'revise_bridge',
			source: 'human',
			dismissal: null
		});
		expect(open?.evidence.map((e) => e.artifactId)).toEqual([
			s.seedB.artifactId,
			s.nextB.artifactId
		]);

		const blocked = await service.getCompletion(P, s.project.id);
		expect(blocked.blockers).toBe(before.blockers + 1);
		expect(blocked.certifiable).toBe(false);

		const dismissed = await service.dismissIssue(P, s.project.id, {
			key: issueKey,
			resolution: 'dismissed',
			reason: 'checked by the author'
		});
		expect(dismissed.items.find((i) => i.key === issueKey)?.dismissal).toMatchObject({
			resolution: 'dismissed',
			reason: 'checked by the author'
		});
		expect((await service.getCompletion(P, s.project.id)).blockers).toBe(before.blockers);
	});

	it('goes stale, and disappears from open issues, once a cited Block gets a new revision', async () => {
		const s = await seeded();
		const created = await service.createFinding(P, s.project.id, bFinding(s));
		const issueKey = `finding:${created.id}`;
		expect((await service.listIssues(P, s.project.id)).items.some((i) => i.key === issueKey)).toBe(
			true
		);
		await service.updateArtifact(P, s.project.id, s.nextB.artifactId, s.nextB.revisionId, {
			body: 'Ivan wrote the nine letters in July, again'
		});
		const [listed] = (await service.listFindings(P, s.project.id)).items;
		expect(listed).toMatchObject({ id: created.id, stale: true });
		expect((await service.listIssues(P, s.project.id)).items.some((i) => i.key === issueKey)).toBe(
			false
		);
	});
});

describe('request revision', () => {
	const view = async (who: Principal, projectId: string, task: Task): Promise<TaskView> =>
		service.getTaskView(who, projectId, task.id);

	it('opens a claimable revise_block task for the owning side with side-local content only', async () => {
		const s = await seeded();
		const finding = await service.createFinding(P, s.project.id, bFinding(s));
		const issueKey = `finding:${finding.id}`;
		const lastStage = Math.max(
			...(await service.listTasks(P, s.project.id)).items.map((x) => x.stageIndex)
		);
		const task = await service.requestRevision(P, s.project.id, {
			issueKey,
			artifactId: s.nextB.artifactId,
			instructions: 'Keep the letters, fix the author.'
		});
		expect(task).toMatchObject({
			type: 'revise_block',
			role: 'B',
			state: 'pending',
			assigneePrincipalId: null,
			stageIndex: lastStage + 1,
			depth: 0,
			triangleId: null,
			resultRefs: []
		});
		expect(task.runId).not.toBeNull();
		expect(task.payload).toMatchObject({ artifactId: s.nextB.artifactId, issueKey });

		// B sees it, A does not see or claim it.
		expect((await service.listMyTasks(s.b, s.project.id)).items.map((x) => x.id)).toContain(
			task.id
		);
		expect((await service.listMyTasks(s.a, s.project.id)).items.map((x) => x.id)).not.toContain(
			task.id
		);
		await expectCode(service.getTaskView(s.a, s.project.id, task.id), 'TASK_NOT_FOUND');
		await expectCode(
			service.submitTask(s.a, s.project.id, task.id, {
				submission: { type: 'revise_block', block: { kind: 'EVENT', title: 'x', body: 'y' } },
				idempotencyKey: key()
			}),
			'TASK_NOT_FOUND'
		);
		// The task entry A or C could list never carries the payload.
		const forB = (await service.listMyTasks(s.b, s.project.id)).items.find((x) => x.id === task.id);
		expect(forB?.payload).toBeNull();

		const served = await view(s.b, s.project.id, task);
		if (served.type !== 'revise_block') throw new Error('wrong view');
		expect(served.ownBlock).toMatchObject({
			id: s.nextB.artifactId,
			revisionId: s.nextB.revisionId,
			title: SECOND_B_TITLE,
			body: SECOND_B_BODY,
			ownerScope: 'B_PRIVATE'
		});
		// Story reading order: B continues backward from its seed, so the new Block reads first.
		expect(served.localContext.map((b) => b.id)).toEqual([s.nextB.artifactId, s.seedB.artifactId]);
		expect(served.localContext.every((b) => b.ownerScope === 'B_PRIVATE')).toBe(true);
		expect(served.instructions).toBe('Keep the letters, fix the author.');
		expect(served.problems).toEqual([
			{
				explanation: 'The letters are credited to two different authors.',
				evidence: [
					{ blockId: s.seedB.artifactId, quote: 'Bravo seed body' },
					{ blockId: s.nextB.artifactId, quote: 'Ivan "wrote" the nine letters in July' }
				]
			}
		]);
		expect(served.task).toMatchObject({ runId: null, triangleId: null, stageIndex: 1, depth: 0 });
		const everything = JSON.stringify(served);
		expect(everything).not.toContain('Alpha');
		expect(everything).not.toContain(s.seedA.artifactId);

		// The manifest records exactly what was served, B scope only.
		const audit = await service.getAudit(P, s.project.id);
		const manifest = audit.tasks.find((x) => x.taskId === task.id)?.manifest;
		expect(manifest?.inputs.map((i) => i.artifactId).toSorted()).toEqual(
			[s.seedB.artifactId, s.nextB.artifactId].toSorted()
		);
		expect(manifest?.inputs.every((i) => i.ownerScope === 'B_PRIVATE')).toBe(true);
		expect(audit.isolationVerified).toBe(true);
	});

	it('is idempotent per artifact and issue while the task is pending', async () => {
		const s = await seeded();
		const finding = await service.createFinding(P, s.project.id, bFinding(s));
		const input = { issueKey: `finding:${finding.id}`, artifactId: s.nextB.artifactId };
		const first = await service.requestRevision(P, s.project.id, input);
		const again = await service.requestRevision(P, s.project.id, input);
		expect(again.id).toBe(first.id);
		// Another Block of the same issue is a separate request.
		const other = await service.requestRevision(P, s.project.id, {
			...input,
			artifactId: s.seedB.artifactId
		});
		expect(other.id).not.toBe(first.id);
		expect(
			(await service.listTasks(P, s.project.id)).items.filter((x) => x.type === 'revise_block')
		).toHaveLength(2);
	});

	it('refuses cross-side, unknown, dismissed and locked cases', async () => {
		const s = await seeded();
		const cross = await service.createFinding(P, s.project.id, {
			kind: 'fact_conflict',
			severity: 'warning',
			artifactIds: [s.seedA.artifactId, s.seedB.artifactId],
			explanation: 'The two sides disagree.',
			evidence: [
				{ artifactId: s.seedA.artifactId, quote: 'Alpha seed body' },
				{ artifactId: s.seedB.artifactId, quote: 'Bravo seed body' }
			]
		});
		await expectCode(
			service.requestRevision(P, s.project.id, {
				issueKey: `finding:${cross.id}`,
				artifactId: s.seedA.artifactId
			}),
			'CROSS_SIDE_REVISION'
		);
		await expectCode(
			service.requestRevision(P, s.project.id, {
				issueKey: `finding:${randomUUID()}`,
				artifactId: s.nextB.artifactId
			}),
			'ISSUE_NOT_FOUND'
		);

		const own = await service.createFinding(P, s.project.id, bFinding(s));
		const ownKey = `finding:${own.id}`;
		await expectCode(
			service.requestRevision(P, s.project.id, {
				issueKey: ownKey,
				artifactId: s.nextA.artifactId
			}),
			'VALIDATION_FAILED'
		);
		await service.dismissIssue(P, s.project.id, {
			key: ownKey,
			resolution: 'dismissed',
			reason: 'not a problem'
		});
		await expectCode(
			service.requestRevision(P, s.project.id, {
				issueKey: ownKey,
				artifactId: s.seedB.artifactId
			}),
			'ISSUE_NOT_FOUND'
		);

		// Locking is itself a revision, so the finding is reported again on the locked Block.
		await service.updateArtifact(P, s.project.id, s.nextB.artifactId, s.nextB.revisionId, {
			locked: true
		});
		const onLocked = await service.createFinding(P, s.project.id, bFinding(s));
		await expectCode(
			service.requestRevision(P, s.project.id, {
				issueKey: `finding:${onLocked.id}`,
				artifactId: s.nextB.artifactId
			}),
			'INVALID_STATE'
		);
	});

	it('submission writes a new revision of the same Block and retires the finding', async () => {
		const s = await seeded();
		const finding = await service.createFinding(P, s.project.id, bFinding(s));
		const task = await service.requestRevision(P, s.project.id, {
			issueKey: `finding:${finding.id}`,
			artifactId: s.nextB.artifactId
		});
		await service.getTaskView(s.b, s.project.id, task.id);
		const submitKey = key();
		const done = await service.submitTask(s.b, s.project.id, task.id, {
			submission: {
				type: 'revise_block',
				block: { kind: 'EVENT', title: SECOND_B_TITLE, body: 'Yakov wrote the nine letters.' }
			},
			idempotencyKey: submitKey
		});
		expect(done.task.state).toBe('submitted');
		expect(done.task.assigneePrincipalId).not.toBeNull();
		const [ref] = done.task.resultRefs;
		expect(ref?.artifactId).toBe(s.nextB.artifactId);
		expect(ref?.revisionId).not.toBe(s.nextB.revisionId);

		const head = await service.getArtifact(P, s.project.id, s.nextB.artifactId);
		expect(head).toMatchObject({
			headRevisionId: ref?.revisionId,
			body: 'Yakov wrote the nine letters.',
			ownerScope: 'B_PRIVATE',
			version: 2
		});
		const revisions = await service.listRevisions(P, s.project.id, s.nextB.artifactId);
		expect(revisions.items.map((r) => r.id)).toContain(s.nextB.revisionId);
		expect(revisions.items).toHaveLength(2);

		// The old finding now cites a replaced revision.
		const [listed] = (await service.listFindings(P, s.project.id)).items;
		expect(listed?.stale).toBe(true);
		const issues = await service.listIssues(P, s.project.id);
		expect(issues.items.some((i) => i.key === `finding:${finding.id}`)).toBe(false);

		// The same key replays the first result; a new key on a submitted task is refused.
		const replay = await service.submitTask(s.b, s.project.id, task.id, {
			submission: { type: 'revise_block', block: { kind: 'EVENT', title: 'x', body: 'y' } },
			idempotencyKey: submitKey
		});
		expect(replay.replayed).toBe(true);
		await expectCode(
			service.submitTask(s.b, s.project.id, task.id, {
				submission: { type: 'revise_block', block: { kind: 'EVENT', title: 'x', body: 'y' } },
				idempotencyKey: key()
			}),
			'INVALID_STATE'
		);
	});
});

describe('findings in export bundles', () => {
	it('round-trips findings and pending revise tasks with remapped ids', async () => {
		const s = await seeded();
		const finding = await service.createFinding(P, s.project.id, bFinding(s));
		const task = await service.requestRevision(P, s.project.id, {
			issueKey: `finding:${finding.id}`,
			artifactId: s.nextB.artifactId
		});
		const bundle = await service.exportProject(P, s.project.id);
		expect(bundle.findings).toHaveLength(1);
		expect(bundle.tasks?.find((x) => x.id === task.id)?.payload?.artifactId).toBe(
			s.nextB.artifactId
		);

		const copy = await service.importAsNewProject(P, bundle, { remapIds: true, name: 'copy' });
		const [copied] = (await service.listFindings(P, copy.projectId)).items;
		expect(copied).toMatchObject({ kind: 'identity_conflict', stale: false });
		expect(copied?.id).not.toBe(finding.id);
		expect(copied?.artifactIds).not.toContain(s.nextB.artifactId);
		expect(copied?.evidence.map((e) => e.quote)).toEqual(finding.evidence.map((e) => e.quote));

		const issues = (await service.listIssues(P, copy.projectId)).items;
		expect(issues.some((i) => i.key === `finding:${copied?.id}`)).toBe(true);

		const revise = (await service.listTasks(P, copy.projectId)).items.find(
			(x) => x.type === 'revise_block'
		);
		expect(revise?.payload?.issueKey).toBe(`finding:${copied?.id}`);
		expect(copied?.artifactIds).toContain(revise?.payload?.artifactId);
		expect(revise?.payload?.problems[0]?.evidence.map((e) => e.blockId)).toEqual(
			copied?.evidence.map((e) => e.artifactId)
		);
	});
});

describe('findings: revise target', () => {
	it('stores a valid target, refuses one outside artifactIds, and exposes it on the issue', async () => {
		const s = await seeded();
		await expectCode(
			service.createFinding(P, s.project.id, {
				...bFinding(s),
				reviseArtifactId: s.nextA.artifactId
			}),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.createFinding(P, s.project.id, { ...bFinding(s), reviseArtifactId: 'not-a-uuid' }),
			'VALIDATION_FAILED'
		);
		const plain = await service.createFinding(P, s.project.id, bFinding(s));
		expect(plain.reviseArtifactId).toBeNull();

		const targeted = await service.createFinding(P, s.project.id, {
			...bFinding(s),
			reviseArtifactId: s.nextB.artifactId
		});
		expect(targeted.reviseArtifactId).toBe(s.nextB.artifactId);

		const issues = (await service.listIssues(P, s.project.id)).items;
		expect(issues.find((i) => i.key === `finding:${targeted.id}`)?.reviseArtifactId).toBe(
			s.nextB.artifactId
		);
		expect(issues.find((i) => i.key === `finding:${plain.id}`)?.reviseArtifactId).toBeNull();
		// Participants have no issue list, so the target never reaches A or B.
		await expectCode(service.listIssues(s.a, s.project.id), 'FORBIDDEN');
		await expectCode(service.listIssues(s.b, s.project.id), 'FORBIDDEN');
	});

	it('round-trips through export and import with remapped ids', async () => {
		const s = await seeded();
		const finding = await service.createFinding(P, s.project.id, {
			...bFinding(s),
			reviseArtifactId: s.nextB.artifactId
		});
		const bundle = await service.exportProject(P, s.project.id);
		expect(bundle.findings?.find((f) => f.id === finding.id)?.reviseArtifactId).toBe(
			s.nextB.artifactId
		);
		const copy = await service.importAsNewProject(P, bundle, { remapIds: true, name: 'copy' });
		const [copied] = (await service.listFindings(P, copy.projectId)).items;
		expect(copied?.reviseArtifactId).not.toBeNull();
		expect(copied?.reviseArtifactId).not.toBe(s.nextB.artifactId);
		expect(copied?.artifactIds).toContain(copied?.reviseArtifactId);
	});
});
