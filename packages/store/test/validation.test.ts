import {
	type AssertionInput,
	type ExpansionDetail,
	TlonError,
	type TransitionInput
} from '@tlon/contracts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { artifactRevisions, auditEvents, transitionAnnotations } from '../src/schema.ts';
import { createTestService, type TestService } from '../src/testing.ts';
import { bridgeInput, expectCode, makeAgent, nextKey, P } from './helpers.ts';

/** Exactly the fields the gate may expose: no `explanation` (it can quote titles). */
const ContinuityDetails = z.strictObject({
	issues: z.array(
		z.strictObject({
			key: z.string(),
			kind: z.string(),
			severity: z.string(),
			artifactIds: z.array(z.string()),
			stateKey: z.string().nullable()
		})
	)
});

let t: TestService;
beforeEach(async () => {
	t = await createTestService();
});
afterEach(async () => {
	await t.close();
});

const w = (
	subject: string,
	predicate: string,
	value: string | boolean,
	extra: Partial<AssertionInput> = {}
): AssertionInput => ({ subject, predicate, value, ...extra });

const A31: TransitionInput = {
	effects: [w('mercury_bath', 'level', 'FULL'), w('drain_cock', 'state', 'partially_unlocked')]
};
const B35: TransitionInput = {
	preconditions: [w('drain_cock', 'state', 'open')],
	effects: [w('odile', 'action', 'drained_the_bath')]
};
const C33: TransitionInput = {
	preconditions: [w('mercury_bath', 'level', 'FULL')],
	effects: [
		w('mercury_bath', 'level', 'falling', { irreversible: true }),
		w('drain_cock', 'state', 'open')
	]
};
/** Resets the level to FULL after 33 already started draining. */
const C34_RESET: TransitionInput = {
	preconditions: [w('mercury_bath', 'level', 'FULL')],
	effects: [w('odile', 'hand', 'on_crank')]
};

/**
 * Hesper Point: anchors 31 (A) and 35 (B) annotated, bridge 33 accepted between them with
 * its candidate transition; `second` is the open interval 33→35 awaiting candidate 34.
 */
async function drain() {
	const { service } = t;
	const project = await service.createProject(P, { name: 'hesper', domain: 'GENERIC' });
	const a = await makeAgent(service, project.id, 'A');
	const b = await makeAgent(service, project.id, 'B');
	const c = await makeAgent(service, project.id, 'C');
	const validator = await makeAgent(service, project.id, 'VALIDATOR');
	const a31 = await service.createArtifact(a.principal, project.id, {
		kind: 'FACT',
		title: '31 drain cock seized'
	});
	const b35 = await service.createArtifact(b.principal, project.id, {
		kind: 'FACT',
		title: '35 Odile drains the bath'
	});
	const root = await service.createRelation(P, project.id, {
		fromId: a31.id,
		toId: b35.id,
		type: 'precedes',
		status: 'ACCEPTED'
	});
	const ann31 = await service.putTransition(P, project.id, a31.id, {
		artifactRevisionId: a31.headRevisionId,
		transition: A31
	});
	const ann35 = await service.putTransition(P, project.id, b35.id, {
		artifactRevisionId: b35.headRevisionId,
		transition: B35
	});
	const first = await service.createExpansion(P, project.id, { targetRelationId: root.id });
	const submitted = await service.submitCandidate(P, project.id, first.expansion.id, {
		...bridgeInput('33 plug comes free'),
		transition: C33
	});
	const candidate33 = submitted.candidates[0];
	if (!candidate33) throw new Error('candidate 33 missing');
	expect(candidate33.issues).toEqual([]);
	const accepted = await service.acceptExpansion(P, project.id, first.expansion.id, nextKey(), {
		candidateId: candidate33.id
	});
	const second = await service.createExpansion(P, project.id, {
		targetRelationId: accepted.childRelations[1].id
	});
	return {
		project,
		a,
		b,
		c,
		validator,
		a31,
		b35,
		ann31,
		ann35,
		bridge33: accepted.bridge,
		first,
		second,
		accept: (detail: ExpansionDetail, extra: Record<string, unknown> = {}, key = nextKey()) =>
			service.acceptExpansion(P, project.id, detail.expansion.id, key, {
				candidateId: detail.candidates[0]?.id,
				...extra
			})
	};
}

async function submit34(
	world: { project: { id: string }; second: ExpansionDetail },
	transition = C34_RESET
) {
	return t.service.submitCandidate(P, world.project.id, world.second.expansion.id, {
		...bridgeInput('34 reaching for the crank'),
		transition
	});
}

describe('transition annotations', () => {
	it('append to the head revision without creating a revision or staling bridges', async () => {
		const { service } = t;
		const world = await drain();
		const revisions = await service.listRevisions(P, world.project.id, world.a31.id);
		expect(revisions.items).toHaveLength(1);
		const artifact = await service.getArtifact(P, world.project.id, world.a31.id);
		expect(artifact.headRevisionId).toBe(world.a31.headRevisionId);
		expect(world.ann31.artifactRevisionId).toBe(world.a31.headRevisionId);
		expect(
			(await service.getExpansion(P, world.project.id, world.first.expansion.id)).expansion
				.staleSides
		).toEqual([]);

		// A second annotation supersedes the first; history stays append-only.
		const again = await service.putTransition(P, world.project.id, world.a31.id, {
			artifactRevisionId: world.a31.headRevisionId,
			transition: { effects: [w('mercury_bath', 'level', 'FULL')] },
			source: 'extracted'
		});
		const graph = await service.getGraph(P, world.project.id);
		expect(graph.transitions.find((x) => x.artifactId === world.a31.id)?.id).toBe(again.id);
		const rows = await t.handle.db
			.select()
			.from(transitionAnnotations)
			.where(eq(transitionAnnotations.artifactId, world.a31.id));
		expect(rows).toHaveLength(2);
		const revisionRows = await t.handle.db
			.select()
			.from(artifactRevisions)
			.where(eq(artifactRevisions.artifactId, world.a31.id));
		expect(revisionRows).toHaveLength(1);
	});

	it('refuses stale revisions, unknown artifacts, read-only artifacts and the VALIDATOR', async () => {
		const { service } = t;
		const world = await drain();
		await expectCode(
			service.putTransition(P, world.project.id, world.a31.id, {
				artifactRevisionId: world.ann31.id,
				transition: A31
			}),
			'STALE_REVISION'
		);
		await expectCode(
			service.putTransition(world.validator.principal, world.project.id, world.a31.id, {
				artifactRevisionId: world.a31.headRevisionId,
				transition: A31
			}),
			'FORBIDDEN'
		);
		// A cannot even see B's artifact: hidden, not forbidden.
		await expectCode(
			service.putTransition(world.a.principal, world.project.id, world.b35.id, {
				artifactRevisionId: world.b35.headRevisionId,
				transition: B35
			}),
			'ARTIFACT_NOT_FOUND'
		);
		// Own artifact: allowed.
		const own = await service.putTransition(world.a.principal, world.project.id, world.a31.id, {
			artifactRevisionId: world.a31.headRevisionId,
			transition: A31,
			source: 'author'
		});
		expect(own.actorId).toBe(world.a.principal.id);
		// Visible through a grant but outside A's writable scope: forbidden.
		await service.createGrant(P, world.project.id, {
			granteePrincipalId: world.a.agentId,
			artifactId: world.b35.id
		});
		await expectCode(
			service.putTransition(world.a.principal, world.project.id, world.b35.id, {
				artifactRevisionId: world.b35.headRevisionId,
				transition: B35
			}),
			'FORBIDDEN'
		);
	});

	it('are scoped to visible artifacts in the graph projection', async () => {
		const { service } = t;
		const world = await drain();
		const asA = await service.getGraph(world.a.principal, world.project.id);
		expect(asA.transitions.map((x) => x.artifactId)).toEqual([world.a31.id]);
		const asB = await service.getGraph(world.b.principal, world.project.id);
		expect(asB.transitions.map((x) => x.artifactId)).toEqual([world.b35.id]);
		// Each side's accepted bridge annotation belongs to the C-visible material only.
		const asHuman = await service.getGraph(P, world.project.id);
		expect(asHuman.transitions.map((x) => x.artifactId).sort()).toEqual(
			[world.a31.id, world.b35.id, world.bridge33.id].sort()
		);
		const asValidator = await service.getGraph(world.validator.principal, world.project.id);
		expect(asValidator.transitions).toHaveLength(3);
		// A grant makes the annotation visible together with the artifact.
		await service.createGrant(P, world.project.id, {
			granteePrincipalId: world.a.agentId,
			artifactId: world.b35.id
		});
		const granted = await service.getGraph(world.a.principal, world.project.id);
		expect(granted.transitions.map((x) => x.artifactId).sort()).toEqual(
			[world.a31.id, world.b35.id].sort()
		);
	});
});

describe('accept gate', () => {
	it('blocks a drain regression with CONTINUITY_VIOLATION and shows it on the candidate', async () => {
		const { service } = t;
		const world = await drain();
		const detail = await submit34(world);
		const issues = detail.candidates[0]?.issues ?? [];
		expect(
			issues.some((i) => i.severity === 'blocker' && i.stateKey === 'mercury_bath.level')
		).toBe(true);

		const refused = await world.accept(detail).catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(TlonError);
		expect(refused).toMatchObject({ code: 'CONTINUITY_VIOLATION' });
		const body = ContinuityDetails.parse((refused as TlonError).details);
		expect(body.issues.length).toBeGreaterThan(0);
		for (const issue of body.issues) expect(issue.severity).toBe('blocker');
		expect(JSON.stringify(body)).not.toContain('reaching for the crank');
		const after = await service.getExpansion(P, world.project.id, world.second.expansion.id);
		expect(after.expansion.status).toBe('REVIEW');
	});

	it('lets a human acknowledge and records it in the revision reason and audit', async () => {
		const { service } = t;
		const world = await drain();
		const detail = await submit34(world);
		const key = nextKey();
		const accepted = await world.accept(detail, { acknowledgeIssues: 'intentional retcon' }, key);
		expect(accepted.replayed).toBe(false);
		expect(accepted.expansion.status).toBe('ACCEPTED');

		const revisions = await service.listRevisions(P, world.project.id, accepted.bridge.id);
		expect(revisions.items[0]?.reason).toContain('acknowledged continuity issues');
		const events = await t.handle.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.operation, 'expansion.accept'));
		const ack = events.find((e) => e.subjectId === world.second.expansion.id);
		const { acknowledgedIssueKeys } = z
			.object({ acknowledgedIssueKeys: z.array(z.string()).min(1) })
			.parse(ack?.metadata);
		expect(acknowledgedIssueKeys.length).toBeGreaterThan(0);
		expect(JSON.stringify(ack?.metadata)).not.toContain('intentional retcon');

		// Replay is idempotent and does not run the gate again (no acknowledgement needed).
		const replay = await world.accept(detail, {}, key);
		expect(replay.replayed).toBe(true);
		expect(replay.bridge.id).toBe(accepted.bridge.id);
	});

	it('does not let C accept or acknowledge', async () => {
		const { service } = t;
		const world = await drain();
		const detail = await submit34(world);
		await expectCode(
			service.acceptExpansion(
				world.c.principal,
				world.project.id,
				world.second.expansion.id,
				nextKey(),
				{
					candidateId: detail.candidates[0]?.id,
					acknowledgeIssues: 'trust me'
				}
			),
			'FORBIDDEN'
		);
		const after = await service.getExpansion(P, world.project.id, world.second.expansion.id);
		expect(after.expansion.status).toBe('REVIEW');
		await expectCode(world.accept(detail), 'CONTINUITY_VIOLATION');
	});

	it('does not gate on dismissed blockers', async () => {
		const { service } = t;
		const world = await drain();
		const detail = await submit34(world);
		for (const issue of detail.candidates[0]?.issues ?? []) {
			if (issue.severity !== 'blocker') continue;
			await service.dismissIssue(P, world.project.id, {
				key: issue.key,
				resolution: 'intentional',
				reason: 'planned flashback'
			});
		}
		const refreshed = await service.getExpansion(P, world.project.id, world.second.expansion.id);
		expect(
			refreshed.candidates[0]?.issues
				.filter((i) => i.severity === 'blocker')
				.every((i) => i.dismissal)
		).toBe(true);
		const accepted = await world.accept(detail);
		expect(accepted.expansion.status).toBe('ACCEPTED');
	});

	it('accepts a candidate that reconciles independent anchors (tension resolved)', async () => {
		const { service } = t;
		const project = await service.createProject(P, { name: 'earth', domain: 'GENERIC' });
		const a = await makeAgent(service, project.id, 'A');
		const b = await makeAgent(service, project.id, 'B');
		const earth = await service.createArtifact(a.principal, project.id, {
			kind: 'FACT',
			title: 'Earth is flat'
		});
		const mars = await service.createArtifact(b.principal, project.id, {
			kind: 'FACT',
			title: 'Mars sees a round Earth'
		});
		const rel = await service.createRelation(P, project.id, {
			fromId: earth.id,
			toId: mars.id,
			type: 'precedes',
			status: 'ACCEPTED'
		});
		await service.putTransition(P, project.id, earth.id, {
			artifactRevisionId: earth.headRevisionId,
			transition: { effects: [w('earth', 'shape', 'flat')] }
		});
		await service.putTransition(P, project.id, mars.id, {
			artifactRevisionId: mars.headRevisionId,
			transition: { preconditions: [w('earth', 'shape', 'round')] }
		});
		const before = await service.listIssues(P, project.id);
		expect(before.items.some((i) => i.kind === 'tension' && i.severity === 'info')).toBe(true);

		const opened = await service.createExpansion(P, project.id, { targetRelationId: rel.id });
		const detail = await service.submitCandidate(P, project.id, opened.expansion.id, {
			...bridgeInput('Terraforming of the globe'),
			transition: {
				preconditions: [w('earth', 'shape', 'flat')],
				effects: [w('earth', 'shape', 'round')]
			}
		});
		expect(detail.candidates[0]?.issues).toEqual([]);
		const accepted = await service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
			candidateId: detail.candidates[0]?.id as string
		});
		expect(accepted.expansion.status).toBe('ACCEPTED');
		const after = await service.listIssues(P, project.id);
		expect(after.items.filter((i) => i.kind === 'tension')).toEqual([]);
		// The accepted bridge keeps a current annotation (carried onto its accepted revision).
		expect(after.items.some((i) => i.kind === 'stale_annotation')).toBe(false);
	});
});

describe('issues', () => {
	it('lists committed-path issues and keeps dismissals across recomputation', async () => {
		const { service } = t;
		const world = await drain();
		const detail = await submit34(world);
		await world.accept(detail, { acknowledgeIssues: 'known' });

		const listed = await service.listIssues(P, world.project.id);
		const blocker = listed.items.find((i) => i.severity === 'blocker');
		expect(blocker).toBeDefined();
		expect(blocker?.dismissal).toBeNull();
		expect(listed.unannotatedArtifactIds).toEqual([]);

		const dismissed = await service.dismissIssue(P, world.project.id, {
			key: blocker?.key as string,
			resolution: 'perspective_dependent',
			reason: 'Odile misremembers'
		});
		const entry = dismissed.items.find((i) => i.key === blocker?.key);
		expect(entry?.dismissal).toMatchObject({
			resolution: 'perspective_dependent',
			reason: 'Odile misremembers',
			actorId: P.id
		});
		const recomputed = await service.listIssues(P, world.project.id);
		expect(recomputed.items.find((i) => i.key === blocker?.key)?.dismissal?.resolution).toBe(
			'perspective_dependent'
		);
		const events = await t.handle.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.operation, 'issue.dismiss'));
		expect(events).toHaveLength(1);
		expect(JSON.stringify(events[0]?.metadata)).not.toContain('misremembers');
	});

	it('is readable by C and the VALIDATOR only; dismissal is human only', async () => {
		const { service } = t;
		const world = await drain();
		await service.listIssues(world.c.principal, world.project.id);
		await service.listIssues(world.validator.principal, world.project.id);
		await expectCode(service.listIssues(world.a.principal, world.project.id), 'FORBIDDEN');
		await expectCode(service.listIssues(world.b.principal, world.project.id), 'FORBIDDEN');
		const input = { key: 'tension::x', resolution: 'dismissed', reason: 'because' };
		for (const who of [world.a, world.b, world.c, world.validator]) {
			await expectCode(service.dismissIssue(who.principal, world.project.id, input), 'FORBIDDEN');
		}
	});

	it('shows candidate issues to C and the VALIDATOR; A/B never reach expansions', async () => {
		const { service } = t;
		const world = await drain();
		await submit34(world);
		const asC = await service.getExpansion(
			world.c.principal,
			world.project.id,
			world.second.expansion.id
		);
		expect(asC.candidates[0]?.issues.length).toBeGreaterThan(0);
		const asValidator = await service.getExpansion(
			world.validator.principal,
			world.project.id,
			world.second.expansion.id
		);
		expect(asValidator.candidates[0]?.issues.length).toBeGreaterThan(0);
		// A/B hold no expansion.read and never reach expansion details at all.
		await expectCode(
			service.getExpansion(world.a.principal, world.project.id, world.second.expansion.id),
			'FORBIDDEN'
		);
	});
});

describe('candidate transitions and bundles', () => {
	it('stores the submitted transition as an author annotation of an existing artifact too', async () => {
		const { service } = t;
		const world = await drain();
		const loose = await service.createArtifact(P, world.project.id, {
			kind: 'BRIDGE',
			title: 'Existing bridge',
			structured: {
				mechanism: 'm',
				assumptions: ['x'],
				anchorReconciliation: { left: 'l', right: 'r' }
			}
		});
		const detail = await service.submitCandidate(P, world.project.id, world.second.expansion.id, {
			existingArtifactId: loose.id,
			transition: C34_RESET
		});
		expect(detail.candidates).toHaveLength(1);
		const graph = await service.getGraph(P, world.project.id);
		const annotation = graph.transitions.find((x) => x.artifactId === loose.id);
		expect(annotation).toMatchObject({
			source: 'author',
			reviewed: false,
			artifactRevisionId: loose.headRevisionId
		});
	});

	it('round-trips annotations through export and import (remapped)', async () => {
		const { service } = t;
		const world = await drain();
		const bundle = await service.exportProject(P, world.project.id);
		// Full history: the three annotations plus 33's, carried onto its accepted revision.
		expect(bundle.transitions).toHaveLength(4);
		const imported = await service.importAsNewProject(P, bundle, { remapIds: true });
		const graph = await service.getGraph(P, imported.projectId);
		expect(graph.transitions).toHaveLength(3);
		const oldIds = new Set(bundle.transitions.map((x) => x.id));
		expect(graph.transitions.every((x) => !oldIds.has(x.id))).toBe(true);
		const copy = await service.listIssues(P, imported.projectId);
		expect(copy.unannotatedArtifactIds).toEqual([]);
	});
});
