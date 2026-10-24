import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestService, type TestService } from '../src/testing.ts';
import { bridgeInput, expectCode, fact, nextKey, P } from './helpers.ts';

let t: TestService;
beforeEach(async () => {
	t = await createTestService();
});
afterEach(async () => {
	await t.close();
});

/** Project with `count` facts per group, chained by `supports` inside each group. */
async function seedGroups(groups: string[], count = 3) {
	const { service } = t;
	const project = await service.createProject(P, { name: 'composite', domain: 'GENERIC' });
	const out: Record<string, { ids: string[]; relationIds: string[] }> = {};
	for (const g of groups) {
		const ids: string[] = [];
		const relationIds: string[] = [];
		for (let i = 0; i < count; i++) {
			ids.push((await fact(service, project.id, `${g}${i}`)).id);
			const prev = ids[i - 1];
			if (prev) {
				const rel = await service.createRelation(P, project.id, {
					fromId: prev,
					toId: ids[i] as string,
					type: 'supports',
					status: 'ACCEPTED'
				});
				relationIds.push(rel.id);
			}
		}
		out[g] = { ids, relationIds };
	}
	return { project, groups: out };
}

async function compose(
	projectId: string,
	title: string,
	g: { ids: string[]; relationIds: string[] }
) {
	return t.service.createComposite(P, projectId, {
		title,
		memberArtifactIds: g.ids,
		memberRelationIds: g.relationIds,
		contract: { summary: `${title} summary` }
	});
}

describe('composites', () => {
	it('Compose(M), Compose(N), Bridge(M,N), Compose(P) and recursive open', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a', 'b']);
		const a = groups.a as { ids: string[]; relationIds: string[] };
		const b = groups.b as { ids: string[]; relationIds: string[] };
		const m = await compose(project.id, 'M', a);
		const n = await compose(project.id, 'N', b);

		expect(m.artifact.composition).toBe('COMPOSITE');
		expect(m.definition.version).toBe(1);
		expect(m.definition.members.map((x) => x.artifactId)).toEqual(a.ids);
		expect(m.definition.boundary).toEqual({ entries: [a.ids[0]], exits: [a.ids[2]] });
		expect(m.relations.map((r) => r.id).sort()).toEqual([...a.relationIds].sort());
		expect(m.artifact.body).toBe('M summary');
		const pinned = await service.getArtifact(P, project.id, a.ids[0] as string);
		expect(m.definition.members[0]?.pinnedRevisionId).toBe(pinned.headRevisionId);

		// Bridge(M, N) through the ordinary expansion pipeline.
		const rel = await service.createRelation(P, project.id, {
			fromId: m.artifact.id,
			toId: n.artifact.id,
			type: 'contradicts'
		});
		const opened = await service.createExpansion(P, project.id, { targetRelationId: rel.id });
		expect(opened.expansion.leftRevisionId).toBe(m.artifact.headRevisionId);
		const withCandidate = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C')
		);
		const candidate = withCandidate.candidates[0];
		if (!candidate) throw new Error('candidate missing');
		const accepted = await service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
			candidateId: candidate.id
		});

		const p = await service.createComposite(P, project.id, {
			title: 'P',
			memberArtifactIds: [m.artifact.id, accepted.bridge.id, n.artifact.id],
			memberRelationIds: accepted.childRelations.map((r) => r.id)
		});
		expect(p.relations).toHaveLength(2);

		const deep = await service.getComposite(P, project.id, p.artifact.id, { depth: 2 });
		expect(deep.memberArtifacts.map((x) => x.id)).toEqual([
			m.artifact.id,
			accepted.bridge.id,
			n.artifact.id
		]);
		expect(deep.children.map((c) => c.artifact.id)).toEqual([m.artifact.id, n.artifact.id]);
		const inner = deep.children[0];
		expect(inner?.memberArtifacts.map((x) => x.id)).toEqual(a.ids);
		expect(inner?.relations.map((r) => r.id).sort()).toEqual([...a.relationIds].sort());
		expect(inner?.parentIds).toEqual([p.artifact.id]);
		const shallow = await service.getComposite(P, project.id, p.artifact.id, { depth: 0 });
		expect(shallow.children).toEqual([]);

		const graph = await service.getGraph(P, project.id);
		expect(graph.composites.map((c) => c.artifactId).sort()).toEqual(
			[m.artifact.id, n.artifact.id, p.artifact.id].sort()
		);
		const summaryM = graph.composites.find((c) => c.artifactId === m.artifact.id);
		// The M→N relation attaches to the composite itself, not to its members.
		expect(summaryM?.externalRelationIds).toEqual([]);
		expect(graph.artifacts.find((x) => x.id === a.ids[0])?.composition).toBe('ATOMIC');
	});

	it('reuses an artifact in two composites without duplicating it', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a']);
		const a = groups.a as { ids: string[]; relationIds: string[] };
		const first = await compose(project.id, 'first', a);
		const second = await service.createComposite(P, project.id, {
			title: 'second',
			memberArtifactIds: a.ids.slice(0, 2)
		});
		const before = await service.getGraph(P, project.id);
		expect(before.artifacts.filter((x) => a.ids.includes(x.id))).toHaveLength(3);
		expect(before.artifacts).toHaveLength(3 + 2);
		const shared = await service.getComposite(P, project.id, second.artifact.id);
		expect(shared.memberArtifacts.map((x) => x.id)).toEqual(a.ids.slice(0, 2));
		expect(first.definition.members).toHaveLength(3);
		expect(
			(await service.getComposite(P, project.id, a.ids[0] as string).catch((e: unknown) => e)) as {
				code: string;
			}
		).toMatchObject({ code: 'NOT_A_COMPOSITE' });
	});

	it('rejects membership cycles introduced by a revision', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a', 'b']);
		const m = await compose(project.id, 'M', groups.a as { ids: string[]; relationIds: string[] });
		const p = await service.createComposite(P, project.id, {
			title: 'P',
			memberArtifactIds: [m.artifact.id, ...(groups.b?.ids ?? [])]
		});
		await expectCode(
			service.reviseComposite(P, project.id, m.artifact.id, {
				expectedDefinitionVersion: 1,
				memberArtifactIds: [p.artifact.id, ...(groups.a?.ids ?? [])]
			}),
			'MEMBERSHIP_CYCLE'
		);
		await expectCode(
			service.reviseComposite(P, project.id, m.artifact.id, {
				expectedDefinitionVersion: 1,
				memberArtifactIds: [m.artifact.id]
			}),
			'MEMBERSHIP_CYCLE'
		);
	});

	it('archives a composite and leaves members and relations untouched', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a']);
		const a = groups.a as { ids: string[]; relationIds: string[] };
		const m = await compose(project.id, 'M', a);
		const archived = await service.archiveComposite(P, project.id, m.artifact.id, 'retired');
		expect(archived.status).toBe('ARCHIVED');
		expect(archived.version).toBe(2);
		const graph = await service.getGraph(P, project.id);
		for (const id of a.ids) {
			const member = graph.artifacts.find((x) => x.id === id);
			expect(member?.status).toBe('ACCEPTED');
			expect(member?.version).toBe(1);
		}
		expect(graph.relations.filter((r) => a.relationIds.includes(r.id))).toHaveLength(2);
		expect(graph.composites.find((c) => c.artifactId === m.artifact.id)?.memberArtifactIds).toEqual(
			a.ids
		);
		await expectCode(
			service.reviseComposite(P, project.id, m.artifact.id, { expectedDefinitionVersion: 1 }),
			'INVALID_STATE'
		);
		expect((await service.archiveComposite(P, project.id, m.artifact.id)).version).toBe(2);
	});

	it('flags stale bridge sides after the composite is revised', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a', 'b']);
		const m = await compose(project.id, 'M', groups.a as { ids: string[]; relationIds: string[] });
		const n = await compose(project.id, 'N', groups.b as { ids: string[]; relationIds: string[] });
		const rel = await service.createRelation(P, project.id, {
			fromId: m.artifact.id,
			toId: n.artifact.id,
			type: 'contradicts'
		});
		const opened = await service.createExpansion(P, project.id, { targetRelationId: rel.id });
		const withCandidate = await service.submitCandidate(
			P,
			project.id,
			opened.expansion.id,
			bridgeInput('C')
		);
		await service.acceptExpansion(P, project.id, opened.expansion.id, nextKey(), {
			candidateId: withCandidate.candidates[0]?.id
		});
		let graph = await service.getGraph(P, project.id);
		expect(graph.expansions.find((e) => e.id === opened.expansion.id)?.staleSides).toEqual([]);

		await service.reviseComposite(P, project.id, m.artifact.id, {
			expectedDefinitionVersion: 1,
			title: 'M v2',
			reason: 'new interface'
		});
		graph = await service.getGraph(P, project.id);
		expect(graph.expansions.find((e) => e.id === opened.expansion.id)?.staleSides).toEqual([
			'left'
		]);
	});

	it('revision bumps the version, re-pins members and lists definitions newest first', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a']);
		const a = groups.a as { ids: string[]; relationIds: string[] };
		const m = await compose(project.id, 'M', a);
		const first = a.ids[0] as string;
		await service.updateArtifact(
			P,
			project.id,
			first,
			(await service.getArtifact(P, project.id, first)).headRevisionId,
			{ title: 'a0 edited' }
		);
		const revised = await service.reviseComposite(P, project.id, m.artifact.id, {
			expectedDefinitionVersion: 1,
			memberArtifactIds: a.ids.slice(0, 2)
		});
		expect(revised.definition.version).toBe(2);
		expect(revised.definition.members).toHaveLength(2);
		// Dropped relation endpoint → carried relation silently falls away, boundary re-inferred.
		expect(revised.relations.map((r) => r.id)).toEqual(a.relationIds.slice(0, 1));
		expect(revised.definition.boundary).toEqual({ entries: [a.ids[0]], exits: [a.ids[1]] });
		const head = await service.getArtifact(P, project.id, first);
		expect(revised.definition.members[0]?.pinnedRevisionId).toBe(head.headRevisionId);
		expect(revised.artifact.version).toBe(2);
		const list = await service.listCompositeRevisions(P, project.id, m.artifact.id);
		expect(list.items.map((d) => d.version)).toEqual([2, 1]);
		expect(list.items[1]?.members).toHaveLength(3);
	});

	it('rejects a revision against a stale definition version', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a']);
		const m = await compose(project.id, 'M', groups.a as { ids: string[]; relationIds: string[] });
		await service.reviseComposite(P, project.id, m.artifact.id, {
			expectedDefinitionVersion: 1,
			title: 'v2'
		});
		await expect(
			service.reviseComposite(P, project.id, m.artifact.id, {
				expectedDefinitionVersion: 1,
				title: 'v3'
			})
		).rejects.toMatchObject({ code: 'STALE_DEFINITION', details: { currentVersion: 2 } });
	});

	it('validates members, relations, claims and boundary', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a', 'b']);
		const a = groups.a as { ids: string[]; relationIds: string[] };
		const b = groups.b as { ids: string[]; relationIds: string[] };
		await expectCode(
			service.createComposite(P, project.id, {
				title: 'x',
				memberArtifactIds: [a.ids[0], a.ids[0]]
			}),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.createComposite(P, project.id, {
				title: 'x',
				memberArtifactIds: [crypto.randomUUID()]
			}),
			'ARTIFACT_NOT_FOUND'
		);
		await expectCode(
			service.createComposite(P, project.id, {
				title: 'x',
				memberArtifactIds: a.ids,
				memberRelationIds: [crypto.randomUUID()]
			}),
			'RELATION_NOT_FOUND'
		);
		await expectCode(
			service.createComposite(P, project.id, {
				title: 'x',
				memberArtifactIds: [a.ids[0], a.ids[1]],
				memberRelationIds: a.relationIds.slice(1)
			}),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.createComposite(P, project.id, {
				title: 'x',
				memberArtifactIds: a.ids,
				boundary: { entries: [b.ids[0]] }
			}),
			'VALIDATION_FAILED'
		);
		const head = await service.getArtifact(P, project.id, a.ids[0] as string);
		await expectCode(
			service.createComposite(P, project.id, {
				title: 'x',
				memberArtifactIds: a.ids,
				contract: {
					keyClaims: [
						{
							claimId: 'c1',
							text: 'claim',
							sourceArtifactId: b.ids[0],
							sourceRevisionId: head.headRevisionId
						}
					]
				}
			}),
			'VALIDATION_FAILED'
		);
		const ok = await service.createComposite(P, project.id, {
			title: 'ok',
			memberArtifactIds: a.ids,
			contract: {
				keyClaims: [
					{
						claimId: 'c1',
						text: 'claim',
						sourceArtifactId: a.ids[0],
						sourceRevisionId: head.headRevisionId
					}
				]
			}
		});
		expect(ok.definition.contract.keyClaims).toHaveLength(1);
		const rejected = await service.createArtifact(P, project.id, {
			kind: 'FACT',
			title: 'r',
			status: 'PROPOSED'
		});
		await service.updateArtifact(P, project.id, rejected.id, rejected.headRevisionId, {
			status: 'REJECTED'
		});
		await expectCode(
			service.createComposite(P, project.id, { title: 'x', memberArtifactIds: [rejected.id] }),
			'VALIDATION_FAILED'
		);
	});

	it('keeps membership relation types reserved', async () => {
		const { project, groups } = await seedGroups(['a'], 2);
		for (const type of ['contains', 'member_of', 'part_of']) {
			await expectCode(
				t.service.createRelation(P, project.id, {
					fromId: groups.a?.ids[0],
					toId: groups.a?.ids[1],
					type
				}),
				'VALIDATION_FAILED'
			);
		}
	});

	it('rolls everything back when Compose fails midway', async () => {
		await t.close();
		let calls = 0;
		let failAt = Infinity;
		t = await createTestService({
			newId: () => {
				calls += 1;
				if (calls >= failAt) throw new Error('boom');
				return crypto.randomUUID();
			}
		});
		const { project, groups } = await seedGroups(['a']);
		const a = groups.a as { ids: string[]; relationIds: string[] };
		const before = await t.service.getGraph(P, project.id);
		// artifact id + revision id + audit ids are drawn before/after the definition insert.
		failAt = calls + 4;
		await expect(compose(project.id, 'M', a)).rejects.toThrow('boom');
		const after = await t.service.getGraph(P, project.id);
		expect(after.artifacts).toHaveLength(before.artifacts.length);
		expect(after.composites).toEqual([]);
		failAt = Infinity;
		await expect(compose(project.id, 'M', a)).resolves.toBeDefined();
	});

	it('round-trips composites through export and import (preserved and remapped)', async () => {
		const { service } = t;
		const { project, groups } = await seedGroups(['a', 'b']);
		const m = await compose(project.id, 'M', groups.a as { ids: string[]; relationIds: string[] });
		const n = await compose(project.id, 'N', groups.b as { ids: string[]; relationIds: string[] });
		await service.createComposite(P, project.id, {
			title: 'P',
			memberArtifactIds: [m.artifact.id, n.artifact.id]
		});
		await service.reviseComposite(P, project.id, m.artifact.id, {
			expectedDefinitionVersion: 1,
			title: 'M2'
		});
		const bundle = await service.exportProject(P, project.id);
		expect(bundle.compositeDefinitions).toHaveLength(4);
		const json = JSON.parse(JSON.stringify(bundle));

		const other = await createTestService();
		try {
			const kept = await other.service.importAsNewProject(P, json, { remapIds: false });
			const keptGraph = await other.service.getGraph(P, kept.projectId);
			const original = await service.getGraph(P, project.id);
			expect(keptGraph.composites).toEqual(original.composites);
			expect(keptGraph.artifacts.filter((a) => a.composition === 'COMPOSITE')).toHaveLength(3);
			const view = await other.service.getComposite(P, kept.projectId, m.artifact.id, {
				depth: 1
			});
			expect(view.definition.version).toBe(2);

			const copy = await other.service.importAsNewProject(P, json, { remapIds: true });
			const copyGraph = await other.service.getGraph(P, copy.projectId);
			expect(copyGraph.composites).toHaveLength(3);
			const ids = new Set(copyGraph.artifacts.map((a) => a.id));
			for (const c of copyGraph.composites) {
				expect(ids.has(c.artifactId)).toBe(true);
				expect(c.artifactId).not.toBe(m.artifact.id);
				for (const member of c.memberArtifactIds) expect(ids.has(member)).toBe(true);
			}
			const depthTwo = copyGraph.composites.find((c) => c.memberArtifactIds.length === 2);
			expect(depthTwo).toBeDefined();
		} finally {
			await other.close();
		}
	}, 30_000);
});
