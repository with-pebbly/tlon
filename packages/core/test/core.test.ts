import {
	type ExportBundle,
	lintFactText,
	TlonError,
	parseStructured,
	type Relation
} from '@tlon/contracts';
import { describe, expect, it } from 'vitest';

import {
	acceptanceFingerprint,
	assertCandidateArtifactAllowed,
	assertNoMembershipCycle,
	collapseComposites,
	compositionWarnings,
	inferBoundary,
	membershipIndex,
	transitiveMembers,
	assertDepthWithinLimit,
	assertRelationAcyclic,
	buildFractalTree,
	buildTimeline,
	countAcceptedBridges,
	detectTensions,
	expansionLineage,
	findBundleIntegrityIssues,
	layoutPyramid,
	planChildRelations,
	remapBundleIds,
	renderStoryMarkdown,
	storyBeats,
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
						composition: a.composition,
						artifactClass: a.artifactClass,
						factKind: a.factKind,
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
							composition: 'ATOMIC' as const,
							artifactClass: 'BLOCK' as const,
							factKind: null,
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
							composition: 'ATOMIC' as const,
							artifactClass: 'BLOCK' as const,
							factKind: null,
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
			})),
			compositeDefinitions: [],
			transitions: []
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

describe('pyramid layout', () => {
	it('places every bridge above the midpoint of its anchors and stacks finer bridges lower', () => {
		const { graph } = expandFully(3);
		const layout = layoutPyramid(graph);
		const at = new Map(layout.nodes.map((n) => [n.artifactId, n]));
		expect(layout.nodes.filter((n) => n.role === 'base')).toHaveLength(2);
		expect(layout.triangles).toHaveLength(7);
		for (const t of layout.triangles) {
			const apex = at.get(t.apexId)!;
			const l = at.get(t.leftId)!;
			const r = at.get(t.rightId)!;
			expect(apex.x).toBe((l.x + r.x) / 2);
		}
		const rows = [1, 2, 3].map((y) => layout.nodes.filter((n) => n.y === y).length);
		expect(rows).toEqual([4, 2, 1]);
		expect(new Set(layout.nodes.map((n) => `${n.x}:${n.y}`)).size).toBe(layout.nodes.length);
	});

	it('orders base artifacts along precedes chains, independent of creation order', () => {
		const late = artifact('late');
		const early = artifact('early');
		const graph: MiniGraph = {
			artifacts: [late, early],
			relations: [relation(early.id, late.id, { type: 'precedes' })],
			expansions: []
		};
		const xs = layoutPyramid(graph)
			.nodes.toSorted((a, b) => a.x - b.x)
			.map((n) => n.artifactId);
		expect(xs).toEqual([early.id, late.id]);
	});
});

describe('story manuscript', () => {
	it('reads bridges between the beats they reconcile and numbers every beat', () => {
		const { graph, root } = earthMars();
		const [left] = acceptBridge(graph, root, 'C');
		acceptBridge(graph, left, 'D');
		const project = bundleProject(graph);
		const titles = storyBeats({ ...graph, project }).map((b) => b.artifact.title);
		expect(titles).toEqual(['Born on Earth', 'D', 'C', 'Born on Mars']);
		const md = renderStoryMarkdown({ ...graph, project }, { annotations: true });
		expect(md).toContain('## 2. D');
		expect(md).toContain('bridge, depth 2');
	});
});

function bundleProject(graph: MiniGraph) {
	const at = new Date(0).toISOString();
	return {
		id: graph.artifacts[0]!.projectId,
		name: 'p',
		domain: 'NARRATIVE' as const,
		settings: { maxDepth: 5, maxCandidates: 3, maxNodesPerRun: 100, maxConcurrentJobs: 2 },
		createdAt: at,
		updatedAt: at
	};
}

describe('composites (core)', () => {
	const summary = (
		artifactId: string,
		members: string[],
		entries = [members[0]!],
		exits = [members.at(-1)!]
	) => ({
		artifactId,
		definitionId: nextId(),
		version: 1,
		memberArtifactIds: members,
		memberRelationIds: [],
		boundary: { entries, exits },
		externalRelationIds: []
	});

	it('rejects direct and transitive self-membership, allows DAG reuse', () => {
		const index = membershipIndex([summary('M', ['a', 'b']), summary('P', ['M', 'c'])]);
		expect(codeOf(() => assertNoMembershipCycle('M', ['a', 'P'], index))).toBe('MEMBERSHIP_CYCLE');
		expect(codeOf(() => assertNoMembershipCycle('M', ['M'], index))).toBe('MEMBERSHIP_CYCLE');
		expect(codeOf(() => assertNoMembershipCycle('N', ['a', 'b'], index))).toBe('NO_THROW');
		expect([...transitiveMembers('P', index)].sort()).toEqual(['M', 'a', 'b', 'c']);
	});

	it('infers entries/exits from internal edges and warns about disconnected selections', () => {
		const internal = [
			{ fromId: 'a', toId: 'b' },
			{ fromId: 'b', toId: 'c' }
		];
		expect(inferBoundary(['a', 'b', 'c'], internal)).toEqual({ entries: ['a'], exits: ['c'] });
		expect(compositionWarnings(['a', 'b', 'x'], internal.slice(0, 1), 0)).toHaveLength(1);
		expect(compositionWarnings(['a', 'b', 'c'], internal, 2)).toEqual([
			expect.stringContaining('2 external')
		]);
	});

	function chainWithComposites() {
		const [a1, a2, a3, b1, b2] = ['a1', 'a2', 'a3', 'b1', 'b2'].map((t) => artifact(t));
		const M = artifact('M', { kind: 'ARC', composition: 'COMPOSITE' });
		const N = artifact('N', { kind: 'ARC', composition: 'COMPOSITE' });
		const x = artifact('outsider');
		const relations = [
			relation(a1!.id, a2!.id, { type: 'precedes' }),
			relation(a2!.id, a3!.id, { type: 'precedes' }),
			relation(b1!.id, b2!.id, { type: 'precedes' }),
			relation(x.id, a2!.id, { type: 'causes' }),
			relation(M.id, N.id, { type: 'precedes' })
		];
		const composites = [
			summary(M.id, [a1!.id, a2!.id, a3!.id], [a1!.id], [a3!.id]),
			summary(N.id, [b1!.id, b2!.id], [b1!.id], [b2!.id])
		];
		const graph = {
			artifacts: [a1!, a2!, a3!, b1!, b2!, M, N, x],
			relations,
			expansions: [] as MiniGraph['expansions'],
			composites
		};
		return { graph, a1: a1!, a3: a3!, b1: b1!, M, N, x, root: relations[4]! };
	}

	it('collapse hides members and stands in for boundary relations with aggregated edges only', () => {
		const { graph, M, N, x } = chainWithComposites();
		const collapsed = collapseComposites(graph, new Set());
		expect(collapsed.artifacts.map((a) => a.title).sort()).toEqual(['M', 'N', 'outsider']);
		expect(collapsed.relations.map((r) => [r.fromId, r.toId])).toEqual([[M.id, N.id]]);
		expect(collapsed.aggregatedEdges).toEqual([
			expect.objectContaining({ fromId: x.id, toId: M.id })
		]);
		const opened = collapseComposites(graph, new Set([M.id, N.id]));
		expect(opened.artifacts).toHaveLength(8);
		expect(opened.aggregatedEdges).toEqual([]);
	});

	it('a bridge between open composites lands between M’s exit and N’s entry, and reads in order', () => {
		const { graph, a3, b1, root, M, N } = chainWithComposites();
		const mini: MiniGraph = {
			artifacts: graph.artifacts,
			relations: graph.relations,
			expansions: []
		};
		acceptBridge(mini, root, 'C');
		const full = { ...mini, composites: graph.composites };
		const layout = layoutPyramid(collapseComposites(full, new Set([M.id, N.id])));
		const at = new Map(layout.nodes.map((n) => [n.artifactId, n]));
		const c = layout.nodes.find((n) => n.role === 'bridge')!;
		expect(c.x).toBe((at.get(a3.id)!.x + at.get(b1.id)!.x) / 2);
		expect(at.has(M.id)).toBe(false);
		expect(layout.frames.map((f) => f.compositeId).sort()).toEqual([M.id, N.id].sort());
		const project = bundleProject(mini);
		const titles = storyBeats({ ...full, project }).map((b) => b.artifact.title);
		// outsider causes a2, so it precedes a2 on the line.
		expect(titles).toEqual(['a1', 'outsider', 'a2', 'a3', 'C', 'b1', 'b2']);
	});
});

describe('Block–Fact pyramid (ADR 0011)', () => {
	it('draws each Fact as the apex over its anchors, keeps Facts off the story line and labels stages', () => {
		const a = artifact('A seed', { creatorRole: 'A', ownerScope: 'A_PRIVATE' });
		const b = artifact('B seed', { creatorRole: 'B', ownerScope: 'B_PRIVATE' });
		const ac = artifact('A continuation', { creatorRole: 'A', ownerScope: 'A_PRIVATE' });
		const bc = artifact('B continuation', { creatorRole: 'B', ownerScope: 'B_PRIVATE' });
		const f1 = artifact('A seed with two shadows', {
			artifactClass: 'FACT',
			factKind: 'trace',
			ownerScope: 'C_SHARED',
			creatorRole: 'C'
		});
		const f2 = artifact('A ledger with a missing year', {
			artifactClass: 'FACT',
			factKind: 'document',
			ownerScope: 'C_SHARED',
			creatorRole: 'C'
		});
		const rels = [
			relation(a.id, ac.id, { type: 'precedes' }),
			relation(bc.id, b.id, { type: 'precedes' }),
			relation(a.id, f1.id, { type: 'has_fact' }),
			relation(b.id, f1.id, { type: 'has_fact' })
		];
		const at = new Date(0).toISOString();
		const tri = (
			id: string,
			l: typeof a,
			r: typeof a,
			f: typeof a,
			stage: number,
			depth: number,
			parent: string | null
		) => ({
			id,
			projectId: a.projectId,
			runId: null,
			left: { artifactId: l.id, revisionId: l.headRevisionId, factAnchorId: null },
			right: { artifactId: r.id, revisionId: r.headRevisionId, factAnchorId: null },
			fact: { artifactId: f.id, revisionId: f.headRevisionId },
			status: 'expanding' as const,
			stageIndex: stage,
			depth,
			parentTriangleId: parent,
			continuations: [],
			createdAt: at,
			updatedAt: at
		});
		const root = tri(nextId(), a, b, f1, 2, 1, null);
		const child = tri(nextId(), ac, bc, f2, 4, 2, root.id);
		const graph = {
			artifacts: [a, b, ac, bc, f1, f2],
			relations: rels,
			expansions: [],
			triangles: [root, child]
		};
		const layout = layoutPyramid(graph);
		const node = new Map(layout.nodes.map((n) => [n.artifactId, n]));
		expect(node.get(f1.id)).toMatchObject({ role: 'fact', stage: 2 });
		expect(node.get(f2.id)).toMatchObject({ role: 'fact', stage: 4 });
		expect(node.get(f1.id)!.x).toBe((node.get(a.id)!.x + node.get(b.id)!.x) / 2);
		expect(node.get(f1.id)!.y).toBeGreaterThan(node.get(f2.id)!.y);
		const titles = storyBeats({ ...graph, project: bundleProject(graph as MiniGraph) }).map(
			(s) => s.artifact.title
		);
		expect(titles).toEqual(['A seed', 'A continuation', 'B continuation', 'B seed']);
	});
});

describe('Fact policy (owner decision: a couple of words)', () => {
	it('accepts a bare two-three word circumstance and rejects qualified explanations or outlines', () => {
		expect(lintFactText('Корни хранят память').errors).toEqual([]);
		expect(lintFactText('Корни хранят память.').errors).toEqual([]);
		expect(
			lintFactText('В корнях обнаружена неизвестная система хранения памяти').errors.length
		).toBeGreaterThan(0);
		expect(lintFactText('A door opens. Then a man walks in').errors.length).toBeGreaterThan(0);
		expect(lintFactText('Ключ, письмо').errors.length).toBeGreaterThan(0);
		expect(lintFactText('A key engraved twice').warnings).toEqual(['Prefer 2–3 words (now 4).']);
	});
});

describe('Block–Fact reading order', () => {
	it('orders the innermost continuations L′ before R′ even when R′ was written first', () => {
		const bSeed = artifact('B seed', { creatorRole: 'B', ownerScope: 'B_PRIVATE' });
		const bNext = artifact('B before', { creatorRole: 'B', ownerScope: 'B_PRIVATE' });
		const aSeed = artifact('A seed', { creatorRole: 'A', ownerScope: 'A_PRIVATE' });
		const aNext = artifact('A after', { creatorRole: 'A', ownerScope: 'A_PRIVATE' });
		const fact = artifact('Roots keep memory', {
			artifactClass: 'FACT',
			factKind: 'rule',
			ownerScope: 'C_SHARED',
			creatorRole: 'C'
		});
		const at = new Date(0).toISOString();
		const triangle = {
			id: nextId(),
			projectId: aSeed.projectId,
			runId: null,
			left: { artifactId: aSeed.id, revisionId: aSeed.headRevisionId, factAnchorId: null },
			right: { artifactId: bSeed.id, revisionId: bSeed.headRevisionId, factAnchorId: null },
			fact: { artifactId: fact.id, revisionId: fact.headRevisionId },
			status: 'converged' as const,
			stageIndex: 2,
			depth: 1,
			parentTriangleId: null,
			continuations: [
				{
					side: 'right' as const,
					block: { artifactId: bNext.id, revisionId: bNext.headRevisionId },
					taskId: null
				},
				{
					side: 'left' as const,
					block: { artifactId: aNext.id, revisionId: aNext.headRevisionId },
					taskId: null
				}
			],
			createdAt: at,
			updatedAt: at
		};
		const graph = {
			artifacts: [bSeed, bNext, aSeed, aNext, fact],
			relations: [
				relation(aSeed.id, aNext.id, { type: 'precedes' }),
				relation(bNext.id, bSeed.id, { type: 'precedes' })
			],
			expansions: [],
			triangles: [triangle]
		};
		const titles = storyBeats({ ...graph, project: bundleProject(graph as MiniGraph) }).map(
			(s) => s.artifact.title
		);
		expect(titles).toEqual(['A seed', 'A after', 'B before', 'B seed']);
	});
});
