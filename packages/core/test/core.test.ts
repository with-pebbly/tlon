import { type ExportBundle, TlonError, parseStructured, type Relation } from '@tlon/contracts';
import { describe, expect, it } from 'vitest';

import {
	acceptanceFingerprint,
	assertCandidateArtifactAllowed,
	assertDepthWithinLimit,
	assertRelationAcyclic,
	buildFractalTree,
	buildTimeline,
	countAcceptedBridges,
	detectTensions,
	expansionLineage,
	findBundleIntegrityIssues,
	planChildRelations,
	remapBundleIds,
	resolveExpansionParent,
	suggestBridge
} from '../src/index.ts';
import { acceptBridge, artifact, type MiniGraph, nextId, relation } from './fixtures.ts';

const codeOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		return error instanceof TlonError ? error.code : 'NOT_TLON_ERROR';
	}
	return 'NO_THROW';
};

function earthMars(): { graph: MiniGraph; root: Relation } {
	const a = artifact('Born on Earth', {
		structured: {
			subject: 'protagonist',
			predicate: 'born_on',
			object: 'Earth',
			perspective: 'Earth archive'
		}
	});
	const b = artifact('Born on Mars', {
		structured: {
			subject: 'Protagonist',
			predicate: 'born_on',
			object: 'Mars',
			perspective: 'Martian archive'
		}
	});
	const root = relation(a.id, b.id);
	return { graph: { artifacts: [a, b], relations: [root], expansions: [] }, root };
}

/** Fully expands every leaf interval `depth` times. */
function expandFully(depth: number) {
	const { graph, root } = earthMars();
	let frontier = [root];
	for (let level = 0; level < depth; level++) {
		frontier = frontier.flatMap((r, i) => acceptBridge(graph, r, `C${level}.${i}`));
	}
	return { graph, root };
}

describe('expansion hierarchy', () => {
	it('derives parent and depth from the expansion that produced the target relation', () => {
		const { graph, root } = earthMars();
		const [left] = acceptBridge(graph, root, 'C');
		const byId = new Map(graph.expansions.map((e) => [e.id, e]));
		expect(resolveExpansionParent(root, byId)).toEqual({ parentExpansionId: null, depth: 1 });
		expect(resolveExpansionParent(left, byId)).toEqual({
			parentExpansionId: graph.expansions[0]?.id,
			depth: 2
		});
	});

	it('rejects a relation that points at an unknown expansion', () => {
		expect(codeOf(() => resolveExpansionParent({ expansionId: nextId() }, new Map()))).toBe(
			'MISSING_REFERENCE'
		);
	});

	it('enforces maxDepth inclusively', () => {
		expect(codeOf(() => assertDepthWithinLimit(5, { maxDepth: 5 }))).toBe('NO_THROW');
		expect(codeOf(() => assertDepthWithinLimit(6, { maxDepth: 5 }))).toBe('DEPTH_LIMIT_EXCEEDED');
	});

	it('full depth-3 subdivision yields 2^3 - 1 bridges and a 9-artifact timeline', () => {
		const { graph } = expandFully(3);
		const [tree] = buildFractalTree(graph);
		expect(tree).toBeDefined();
		expect(countAcceptedBridges(tree!)).toBe(7);
		expect(graph.expansions.map((e) => e.depth).sort()).toEqual([1, 2, 2, 3, 3, 3, 3]);
		const [thread] = buildTimeline(graph);
		expect(thread?.artifactIds).toHaveLength(9);
		expect(new Set(thread?.artifactIds).size).toBe(9);
	});

	it('orders the timeline anchor → bridges → anchor regardless of insertion order', () => {
		const { graph, root } = earthMars();
		const [left] = acceptBridge(graph, root, 'C');
		acceptBridge(graph, left, 'D');
		const titles = buildTimeline(graph)[0]?.artifactIds.map(
			(id) => graph.artifacts.find((a) => a.id === id)?.title
		);
		expect(titles).toEqual(['Born on Earth', 'D', 'C', 'Born on Mars']);
	});

	it('omits child relations from roots and rejected relations entirely', () => {
		const { graph, root } = earthMars();
		acceptBridge(graph, root, 'C');
		const a = graph.artifacts[0]!;
		const b = graph.artifacts[1]!;
		graph.relations.push(relation(a.id, b.id, { type: 'precedes', status: 'REJECTED' }));
		expect(buildFractalTree(graph).map((n) => n.relation.id)).toEqual([root.id]);
	});

	it('lineage is ordered root → parent and forbids reusing lineage anchors as bridges', () => {
		const { graph, root } = earthMars();
		const [left] = acceptBridge(graph, root, 'C');
		const [, innerRight] = acceptBridge(graph, left, 'D');
		const byId = new Map(graph.expansions.map((e) => [e.id, e]));
		const lineage = expansionLineage(innerRight.expansionId, byId);
		expect(lineage.map((e) => e.depth)).toEqual([1, 2]);
		const pending = { leftArtifactId: innerRight.fromId, rightArtifactId: innerRight.toId };
		const earth = graph.artifacts[0]!.id;
		const fresh = artifact('unrelated').id;
		expect(codeOf(() => assertCandidateArtifactAllowed(earth, pending, lineage))).toBe(
			'CYCLE_DETECTED'
		);
		expect(codeOf(() => assertCandidateArtifactAllowed(fresh, pending, lineage))).toBe('NO_THROW');
	});

	it('detects corrupted expansion parent loops', () => {
		const { graph, root } = earthMars();
		const [left] = acceptBridge(graph, root, 'C');
		acceptBridge(graph, left, 'D');
		const [outer, inner] = graph.expansions;
		outer!.parentExpansionId = inner!.id;
		const byId = new Map(graph.expansions.map((e) => [e.id, e]));
		expect(codeOf(() => expansionLineage(inner!.id, byId))).toBe('CYCLE_DETECTED');
	});

	it('plans A→C and C→B child relations with full provenance', () => {
		const planned = planChildRelations({ leftArtifactId: 'a', rightArtifactId: 'b' }, 'c', {
			rightRelationType: 'causes'
		});
		expect(planned.map((r) => [r.fromId, r.toId, r.type])).toEqual([
			['a', 'c', 'bridges'],
			['c', 'b', 'causes']
		]);
		expect(planned[0].provenanceArtifactIds).toEqual(['a', 'c', 'b']);
	});

	it('acceptance fingerprint changes with candidate or pinned revision, not key order', () => {
		const base = { id: 'e', targetRelationId: 'r', leftRevisionId: 'l1', rightRevisionId: 'r1' };
		const fp = (expansion: typeof base, candidateId = 'c1') =>
			acceptanceFingerprint({
				expansion,
				candidateId,
				leftRelationType: 'bridges',
				rightRelationType: 'bridges'
			});
		expect(fp(base)).toBe(
			fp({ rightRevisionId: 'r1', leftRevisionId: 'l1', targetRelationId: 'r', id: 'e' })
		);
		expect(fp(base, 'c2')).not.toBe(fp(base));
		expect(fp({ ...base, leftRevisionId: 'l2' })).not.toBe(fp(base));
	});
});

describe('relation cycles', () => {
	const [a, b, c] = ['a', 'b', 'c'];
	const edges = [relation(a, b, { type: 'precedes' }), relation(b, c, { type: 'precedes' })];

	it('rejects closing a precedes cycle and self loops', () => {
		expect(
			codeOf(() => assertRelationAcyclic(edges, { fromId: c, toId: a, type: 'precedes' }))
		).toBe('CYCLE_DETECTED');
		expect(
			codeOf(() => assertRelationAcyclic(edges, { fromId: a, toId: a, type: 'precedes' }))
		).toBe('CYCLE_DETECTED');
	});

	it('allows cycles for cyclic-tolerant types and ignores rejected edges', () => {
		expect(codeOf(() => assertRelationAcyclic(edges, { fromId: c, toId: a, type: 'causes' }))).toBe(
			'NO_THROW'
		);
		const withRejected = [
			relation(a, b, { type: 'precedes' }),
			relation(b, c, { type: 'precedes', status: 'REJECTED' })
		];
		expect(
			codeOf(() => assertRelationAcyclic(withRejected, { fromId: c, toId: a, type: 'precedes' }))
		).toBe('NO_THROW');
	});
});

describe('tensions', () => {
	it('reports explicit contradictions once, with distinguishing qualifiers, and marks resolution', () => {
		const { graph, root } = earthMars();
		const before = detectTensions(graph);
		expect(before).toHaveLength(1);
		expect(before[0]).toMatchObject({
			kind: 'EXPLICIT_CONTRADICTION',
			relationId: root.id,
			resolvedByExpansionId: null
		});
		expect(before[0]?.distinguishingDimensions).toEqual(['perspective']);
		acceptBridge(graph, root, 'C');
		expect(detectTensions(graph)[0]?.resolvedByExpansionId).toBe(graph.expansions[0]?.id);
	});

	it('finds implicit fact conflicts on subject+predicate and skips agreeing or inactive facts', () => {
		const s = (object: string) => ({ subject: 'ship', predicate: 'named', object });
		const graph: MiniGraph = {
			artifacts: [
				artifact('x', { structured: s('Aurora') }),
				artifact('y', { structured: s('aurora') }),
				artifact('z', { structured: s('Nadir') }),
				artifact('w', { structured: s('Zenith'), status: 'REJECTED' })
			],
			relations: [],
			expansions: []
		};
		const tensions = detectTensions(graph);
		expect(tensions.every((t) => t.kind === 'FACT_CONFLICT')).toBe(true);
		expect(tensions).toHaveLength(2);
	});
});

describe('suggestBridge', () => {
	it('is deterministic, satisfies the bridge schema and cycles strategies by variant', () => {
		const l = { id: 'l', title: 'Born on Earth' };
		const r = { id: 'r', title: 'Born on Mars' };
		const first = suggestBridge(l, r, 'contradicts');
		expect(suggestBridge(l, r, 'contradicts')).toEqual(first);
		expect(() => parseStructured('NARRATIVE', 'BRIDGE', first.structured)).not.toThrow();
		expect(first.structured.mechanism).toMatch(/identity/i);
		expect(suggestBridge(l, r, 'contradicts', 1).structured.mechanism).not.toBe(
			first.structured.mechanism
		);
	});
});

describe('export bundles', () => {
	function bundleFrom(graph: MiniGraph): ExportBundle {
		const at = new Date(0).toISOString();
		return {
			format: 'tlon.export',
			version: 1,
			exportedAt: at,
			project: {
				id: graph.artifacts[0]!.projectId,
				name: 'p',
				domain: 'NARRATIVE',
				settings: { maxDepth: 5, maxCandidates: 3, maxNodesPerRun: 100, maxConcurrentJobs: 2 },
				createdAt: at,
				updatedAt: at
			},
			artifacts: graph.artifacts,
			revisions: [
				...graph.artifacts.map((a) => ({
					id: a.headRevisionId,
					artifactId: a.id,
					version: 1,
					snapshot: {
						kind: a.kind,
						title: a.title,
						body: a.body,
						structured: a.structured,
						status: a.status,
						ownerScope: a.ownerScope,
						locked: a.locked,
						pinned: a.pinned
					},
					actorId: 'local-human',
					reason: null,
					createdAt: at
				})),
				...graph.expansions.flatMap((e) => [
					{
						id: e.leftRevisionId,
						artifactId: e.leftArtifactId,
						version: 1,
						snapshot: {
							kind: 'FACT' as const,
							title: '',
							body: '',
							structured: {},
							status: 'ACCEPTED' as const,
							ownerScope: 'PROJECT_PUBLIC' as const,
							locked: false,
							pinned: false
						},
						actorId: 'local-human',
						reason: null,
						createdAt: at
					},
					{
						id: e.rightRevisionId,
						artifactId: e.rightArtifactId,
						version: 1,
						snapshot: {
							kind: 'FACT' as const,
							title: '',
							body: '',
							structured: {},
							status: 'ACCEPTED' as const,
							ownerScope: 'PROJECT_PUBLIC' as const,
							locked: false,
							pinned: false
						},
						actorId: 'local-human',
						reason: null,
						createdAt: at
					}
				])
			],
			relations: graph.relations,
			expansions: graph.expansions,
			candidates: graph.expansions.map((e) => ({
				id: nextId(),
				expansionId: e.id,
				artifactId: e.selectedBridgeArtifactId!,
				score: { validation: [] },
				reviewStatus: 'SELECTED' as const,
				createdAt: at
			}))
		};
	}

	it('accepts a consistent bundle and pinpoints dangling references by id', () => {
		const { graph } = expandFully(2);
		const bundle = bundleFrom(graph);
		expect(findBundleIntegrityIssues(bundle)).toEqual([]);
		const ghost = nextId();
		const broken = {
			...bundle,
			relations: [...bundle.relations, relation(ghost, graph.artifacts[0]!.id)]
		};
		expect(findBundleIntegrityIssues(broken)).toEqual([
			expect.objectContaining({ ref: ghost, message: 'unknown artifact' })
		]);
	});

	it('remaps every id consistently and keeps the bundle valid', () => {
		const { graph } = expandFully(2);
		const bundle = bundleFrom(graph);
		const remapped = remapBundleIds(bundle, nextId, nextId());
		expect(findBundleIntegrityIssues(remapped)).toEqual([]);
		const oldIds = new Set(
			[...bundle.artifacts, ...bundle.relations, ...bundle.expansions].map((x) => x.id)
		);
		expect(
			[...remapped.artifacts, ...remapped.relations, ...remapped.expansions].some((x) =>
				oldIds.has(x.id)
			)
		).toBe(false);
		const [before] = buildFractalTree(bundle);
		const [after] = buildFractalTree(remapped);
		expect(countAcceptedBridges(after!)).toBe(countAcceptedBridges(before!));
	});
});
