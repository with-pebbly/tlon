import { buildFractalTree, countAcceptedBridges } from '@tlon/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestService, type TestService } from '../src/testing.ts';
import {
	bridgeInput,
	expandOnce,
	expandTree,
	expectCode,
	fact,
	nextKey,
	P,
	seedPair
} from './helpers.ts';

let t: TestService;
beforeEach(async () => {
	t = await createTestService();
});
afterEach(async () => {
	await t.close();
});

describe('accepting a bridge', () => {
	it('keeps anchors untouched, creates child relations with provenance and retains the parent edge', async () => {
		const { service } = t;
		const { project, a, b, relation } = await seedPair(service);
		const result = await expandOnce(service, project.id, relation.id, 'C');

		const [left, right] = result.childRelations;
		expect([left.fromId, left.toId]).toEqual([a.id, result.bridge.id]);
		expect([right.fromId, right.toId]).toEqual([result.bridge.id, b.id]);
		for (const child of result.childRelations) {
			expect(child.expansionId).toBe(result.expansion.id);
			expect(child.provenanceArtifactIds).toEqual([a.id, result.bridge.id, b.id]);
			expect(child.status).toBe('ACCEPTED');
		}
		expect(result.bridge.status).toBe('ACCEPTED');
		expect(result.replayed).toBe(false);

		const a2 = await service.getArtifact(P, project.id, a.id);
		const b2 = await service.getArtifact(P, project.id, b.id);
		expect([a2.headRevisionId, a2.version]).toEqual([a.headRevisionId, 1]);
		expect([b2.headRevisionId, b2.version]).toEqual([b.headRevisionId, 1]);

		const graph = await service.getGraph(P, project.id);
		const original = graph.relations.find((r) => r.id === relation.id);
		expect(original?.status).toBe('ACCEPTED');
		expect(original?.expandedByExpansionId).toBe(result.expansion.id);
		expect(graph.relations).toHaveLength(3);
	});

	it('depth-3 full expansion yields 7 accepted bridges with correct parent/depth topology', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service);
		const accepted = await expandTree(service, project.id, relation, 3);
		expect(accepted).toHaveLength(7);

		const graph = await service.getGraph(P, project.id);
		const tree = buildFractalTree(graph);
		expect(tree).toHaveLength(1);
		expect(countAcceptedBridges(tree[0]!)).toBe(7);

		const byId = new Map(graph.expansions.map((e) => [e.id, e]));
		const depthCounts = [1, 2, 3].map((d) => graph.expansions.filter((e) => e.depth === d).length);
		expect(depthCounts).toEqual([1, 2, 4]);
		for (const e of graph.expansions) {
			if (e.depth === 1) {
				expect(e.parentExpansionId).toBeNull();
			} else {
				expect(byId.get(e.parentExpansionId as string)?.depth).toBe(e.depth - 1);
				const target = graph.relations.find((r) => r.id === e.targetRelationId);
				expect(target?.expansionId).toBe(e.parentExpansionId);
			}
		}
		expect(graph.expansions.every((e) => e.status === 'ACCEPTED')).toBe(true);
	});

	it('rejects expansions beyond the project depth limit', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service, { maxDepth: 2 });
		const first = await expandOnce(service, project.id, relation.id, 'C');
		const second = await expandOnce(service, project.id, first.childRelations[0].id, 'D');
		await expectCode(
			service.createExpansion(P, project.id, { targetRelationId: second.childRelations[0].id }),
			'DEPTH_LIMIT_EXCEEDED'
		);
	});
});

describe('idempotent accept', () => {
	it('replays the same key, rejects other keys and key reuse for another candidate', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service);
		const opened = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		await service.submitCandidate(P, project.id, opened.expansion.id, bridgeInput('C1'));
		const detail = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C2')
		);
		const [c1, c2] = detail.candidates;
		const key = nextKey();

		const first = await service.acceptExpansion(P, project.id, opened.expansion.id, key, {
			candidateId: c1!.id
		});
		const replay = await service.acceptExpansion(P, project.id, opened.expansion.id, key, {
			candidateId: c1!.id
		});
		expect(first.replayed).toBe(false);
		expect(replay.replayed).toBe(true);
		expect(replay.bridge.id).toBe(first.bridge.id);
		expect(replay.childRelations.map((r) => r.id)).toEqual(first.childRelations.map((r) => r.id));

		const graph = await service.getGraph(P, project.id);
		expect(graph.relations).toHaveLength(3);
		expect(
			graph.artifacts.filter((a) => a.status === 'ACCEPTED' && a.kind === 'BRIDGE')
		).toHaveLength(1);
		expect(graph.artifacts.filter((a) => a.status === 'REJECTED')).toHaveLength(1);

		await expectCode(
			service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
				candidateId: c1!.id
			}),
			'ALREADY_ACCEPTED'
		);
		await expectCode(
			service.acceptExpansion(P, project.id, opened.expansion.id, key, { candidateId: c2!.id }),
			'IDEMPOTENCY_KEY_REUSED'
		);
		await expectCode(
			service.acceptExpansion(P, project.id, opened.expansion.id, undefined, {
				candidateId: c1!.id
			}),
			'IDEMPOTENCY_KEY_REQUIRED'
		);
	});

	it('refuses a key already used for another expansion', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service);
		const key = nextKey();
		const first = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		const withC = await service.submitCandidate(
			P,
			project.id,
			first.expansion.id,
			bridgeInput('C')
		);
		const accepted = await service.acceptExpansion(P, project.id, first.expansion.id, key, {
			candidateId: withC.candidates[0]!.id
		});
		const second = await service.createExpansion(P, project.id, {
			targetRelationId: accepted.childRelations[0].id
		});
		const withD = await service.submitCandidate(
			P,
			project.id,
			second.expansion.id,
			bridgeInput('D')
		);
		await expectCode(
			service.acceptExpansion(P, project.id, second.expansion.id, key, {
				candidateId: withD.candidates[0]!.id
			}),
			'IDEMPOTENCY_KEY_REUSED'
		);
	});
});

describe('concurrency and locking', () => {
	it('stale If-Match is STALE_REVISION with the current id; missing If-Match is PRECONDITION_REQUIRED', async () => {
		const { service } = t;
		const { project, a } = await seedPair(service);
		const updated = await service.updateArtifact(P, project.id, a.id, a.headRevisionId, {
			title: 'A2'
		});
		expect(updated.version).toBe(2);
		await expect(
			service.updateArtifact(P, project.id, a.id, a.headRevisionId, { title: 'A3' })
		).rejects.toMatchObject({
			code: 'STALE_REVISION',
			details: { currentRevisionId: updated.headRevisionId }
		});
		await expectCode(
			service.updateArtifact(P, project.id, a.id, undefined, { title: 'A3' }),
			'PRECONDITION_REQUIRED'
		);
		const revisions = await service.listRevisions(P, project.id, a.id);
		expect(revisions.items.map((r) => r.version)).toEqual([2, 1]);
		expect(revisions.items[1]?.snapshot.title).toBe('A');
	});

	it('accepting after an anchor changed is STALE_ANCHOR_REVISION', async () => {
		const { service } = t;
		const { project, a, relation } = await seedPair(service);
		const opened = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		const withC = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C')
		);
		await service.updateArtifact(P, project.id, a.id, a.headRevisionId, {
			body: 'edited after pinning'
		});
		await expect(
			service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
				candidateId: withC.candidates[0]!.id
			})
		).rejects.toMatchObject({
			code: 'STALE_ANCHOR_REVISION',
			details: { stale: [{ side: 'left', artifactId: a.id }] }
		});
		const graph = await service.getGraph(P, project.id);
		expect(graph.relations).toHaveLength(1);
	});

	it('locked artifacts reject changes until unlocked', async () => {
		const { service } = t;
		const { project } = await seedPair(service);
		const locked = await service.createArtifact(P, project.id, {
			kind: 'NOTE',
			title: 'L',
			locked: true
		});
		await expectCode(
			service.updateArtifact(P, project.id, locked.id, locked.headRevisionId, { title: 'L2' }),
			'ARTIFACT_LOCKED'
		);
		const unlocked = await service.updateArtifact(P, project.id, locked.id, locked.headRevisionId, {
			locked: false,
			reason: 'unlock'
		});
		expect(unlocked.locked).toBe(false);
		const renamed = await service.updateArtifact(
			P,
			project.id,
			locked.id,
			unlocked.headRevisionId,
			{
				title: 'L2'
			}
		);
		expect(renamed.title).toBe('L2');
	});

	it('a pending candidate cannot be accepted through PATCH', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service);
		const opened = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		const withC = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C')
		);
		const candidate = withC.candidates[0]!.artifact;
		await expectCode(
			service.updateArtifact(P, project.id, candidate.id, candidate.headRevisionId, {
				status: 'ACCEPTED'
			}),
			'INVALID_STATE'
		);
	});
});

describe('relations', () => {
	it('rejects cross-project, self and cyclic relations', async () => {
		const { service } = t;
		const { project, a, b } = await seedPair(service);
		const other = await service.createProject(P, { name: 'other' });
		const foreign = await fact(service, other.id, 'X');
		await expectCode(
			service.createRelation(P, project.id, { fromId: a.id, toId: foreign.id, type: 'causes' }),
			'CROSS_PROJECT_REFERENCE'
		);
		await expectCode(
			service.createRelation(P, project.id, { fromId: a.id, toId: a.id, type: 'causes' }),
			'SELF_RELATION'
		);
		const c = await fact(service, project.id, 'C');
		await service.createRelation(P, project.id, { fromId: a.id, toId: b.id, type: 'precedes' });
		await service.createRelation(P, project.id, { fromId: b.id, toId: c.id, type: 'precedes' });
		await expectCode(
			service.createRelation(P, project.id, { fromId: c.id, toId: a.id, type: 'precedes' }),
			'CYCLE_DETECTED'
		);
		// semantic relations may be cyclic
		await service.createRelation(P, project.id, { fromId: c.id, toId: a.id, type: 'causes' });
	});

	it('denies principals that are not project members', async () => {
		const { service } = t;
		const { project } = await seedPair(service);
		await expectCode(
			service.getProject(
				{ id: 'stranger', kind: 'HUMAN', role: 'HUMAN', projectId: null },
				project.id
			),
			'FORBIDDEN'
		);
		await expectCode(
			service.getProject(P, '00000000-0000-4000-8000-0000000000ff'),
			'PROJECT_NOT_FOUND'
		);
	});
});

describe('expansion rules', () => {
	it('rejects duplicate open expansions and already expanded relations', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service);
		const opened = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		await expect(
			service.createExpansion(P, project.id, { targetRelationId: relation.id })
		).rejects.toMatchObject({
			code: 'DUPLICATE_EXPANSION',
			details: { expansionId: opened.expansion.id }
		});
		const withC = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C')
		);
		await service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
			candidateId: withC.candidates[0]!.id
		});
		await expectCode(
			service.createExpansion(P, project.id, { targetRelationId: relation.id }),
			'ALREADY_EXPANDED'
		);
	});

	it('enforces the candidate limit and counts rejected candidates as free slots', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service, { maxCandidates: 2 });
		const opened = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		await service.submitCandidate(P, project.id, opened.expansion.id, bridgeInput('C1'));
		const two = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C2')
		);
		await expectCode(
			service.submitCandidate(P, project.id, opened.expansion.id, bridgeInput('C3')),
			'CANDIDATE_LIMIT_EXCEEDED'
		);
		await service.rejectExpansion(P, project.id, opened.expansion.id, {
			candidateId: two.candidates[1]!.id
		});
		const three = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C3')
		);
		expect(three.candidates.filter((c) => c.reviewStatus === 'PENDING')).toHaveLength(2);
		expect(three.expansion.bridgeArtifactIds).toHaveLength(3);
	});

	it('rejects nominating an anchor or lineage bridge as a candidate (cycle)', async () => {
		const { service } = t;
		const { project, a, relation } = await seedPair(service);
		const root = await expandOnce(service, project.id, relation.id, 'C');
		const child = await service.createExpansion(P, project.id, {
			targetRelationId: root.childRelations[0].id
		});
		await expectCode(
			service.submitCandidate(P, project.id, child.expansion.id, { existingArtifactId: a.id }),
			'CYCLE_DETECTED'
		);
		await expectCode(
			service.submitCandidate(P, project.id, child.expansion.id, {
				existingArtifactId: root.bridge.id
			}),
			'CYCLE_DETECTED'
		);
		const unrelated = await fact(service, project.id, 'D');
		const ok = await service.submitCandidate(P, project.id, child.expansion.id, {
			existingArtifactId: unrelated.id
		});
		expect(ok.candidates).toHaveLength(1);
	});

	it('reject cancels the expansion and rejects pending proposals; terminal expansions refuse further changes', async () => {
		const { service } = t;
		const { project, relation } = await seedPair(service);
		const opened = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		const withC = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C')
		);
		const cancelled = await service.rejectExpansion(P, project.id, opened.expansion.id, {});
		expect(cancelled.expansion.status).toBe('CANCELLED');
		expect(cancelled.candidates[0]?.reviewStatus).toBe('REJECTED');
		expect(cancelled.candidates[0]?.artifact.status).toBe('REJECTED');
		await expectCode(
			service.submitCandidate(P, project.id, opened.expansion.id, bridgeInput('D')),
			'INVALID_STATE'
		);
		await expectCode(
			service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
				candidateId: withC.candidates[0]!.id
			}),
			'INVALID_STATE'
		);
		// a cancelled expansion frees the relation
		const again = await service.createExpansion(P, project.id, { targetRelationId: relation.id });
		expect(again.expansion.status).toBe('PENDING');
	});

	it('creates an expansion from an ordered pair', async () => {
		const { service } = t;
		const { project, a, b } = await seedPair(service);
		const detail = await service.createExpansion(P, project.id, {
			leftArtifactId: b.id,
			rightArtifactId: a.id
		});
		expect(detail.expansion.targetRelationId).toBeNull();
		expect([detail.left.id, detail.right.id]).toEqual([b.id, a.id]);
		expect(detail.expansion.depth).toBe(1);
	});
});

describe('listing', () => {
	it('pages artifacts with a keyset cursor', async () => {
		const { service } = t;
		const { project } = await seedPair(service);
		for (const n of [1, 2, 3]) await fact(service, project.id, `extra ${n}`);
		const first = await service.listArtifacts(P, project.id, { limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.nextCursor).not.toBeNull();
		const second = await service.listArtifacts(P, project.id, {
			limit: 2,
			cursor: first.nextCursor
		});
		const third = await service.listArtifacts(P, project.id, {
			limit: 2,
			cursor: second.nextCursor
		});
		const ids = [...first.items, ...second.items, ...third.items].map((a) => a.id);
		expect(new Set(ids).size).toBe(5);
		expect(third.nextCursor).toBeNull();
		const filtered = await service.listArtifacts(P, project.id, { q: 'extra' });
		expect(filtered.items).toHaveLength(3);
	});
});
