import type { AssertionInput, Relation, Transition, TransitionInput } from '@tlon/contracts';
import { Transition as TransitionSchema } from '@tlon/contracts';
import { describe, expect, it } from 'vitest';

import { type AnnotationLike, candidateIssues, validateContinuity } from '../src/index.ts';
import { acceptBridge, artifact, type MiniGraph, relation } from './fixtures.ts';

const T = (t: TransitionInput): Transition => TransitionSchema.parse(t);
const w = (
	subject: string,
	predicate: string,
	value: string | boolean,
	extra: Partial<AssertionInput> = {}
): AssertionInput => ({
	subject,
	predicate,
	value,
	...extra
});
const project = {
	id: '00000000-0000-4000-8000-000000000001',
	name: 'p',
	domain: 'NARRATIVE' as const,
	settings: { maxDepth: 5, maxCandidates: 3, maxNodesPerRun: 100, maxConcurrentJobs: 2 },
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString()
};

function annotate(graph: MiniGraph, byTitle: Record<string, TransitionInput>) {
	const map = new Map<string, AnnotationLike>();
	for (const a of graph.artifacts) {
		const t = byTitle[a.title];
		if (t) map.set(a.id, { artifactRevisionId: a.headRevisionId, transition: T(t) });
	}
	return map;
}

/**
 * Hesper Point beats 31–35 (docs/samples/lighthouse-story-annotated.md): 31 seizes the
 * cock (level FULL), 33 drains (level falling, irreversible), 34 still reads FULL and
 * pulls the crank, 35 (author B) drains. Built as the engine built it: B-anchor 35 is
 * the right end; 33 and 34 are nested bridges.
 */
function drainSequence() {
	const a31 = artifact('31 drain cock seized', { creatorRole: 'A' });
	const b35 = artifact('35 Odile drains the bath', { creatorRole: 'B' });
	const root = relation(a31.id, b35.id, { type: 'precedes' });
	const graph: MiniGraph = { artifacts: [a31, b35], relations: [root], expansions: [] };
	const [, toRight] = acceptBridge(graph, root, '33 plug comes free');
	acceptBridge(graph, toRight, 'placeholder');
	return graph;
}

describe('continuity validation (GENERATION_REVIEW acceptance scenarios)', () => {
	it('1. drain reset: falling then FULL without refill is a blocker on the committed path', () => {
		const graph = drainSequence();
		const g = {
			...graph,
			artifacts: graph.artifacts.map((a) =>
				a.title === 'placeholder' ? { ...a, title: '34 reaching for the crank' } : a
			),
			project
		};
		const ann = annotate(g, {
			'31 drain cock seized': {
				effects: [
					w('mercury_bath', 'level', 'FULL'),
					w('drain_cock', 'state', 'partially_unlocked')
				]
			},
			'33 plug comes free': {
				preconditions: [w('mercury_bath', 'level', 'FULL')],
				effects: [
					w('mercury_bath', 'level', 'falling', { irreversible: true }),
					w('drain_cock', 'state', 'open')
				]
			},
			'34 reaching for the crank': {
				preconditions: [
					w('mercury_bath', 'level', 'FULL'),
					w('drain_cock', 'state', 'partially_unlocked')
				],
				effects: [w('odile', 'hand', 'on_crank')]
			},
			'35 Odile drains the bath': {
				preconditions: [w('mercury_bath', 'level', 'FULL')],
				effects: [w('mercury_bath', 'level', 'falling', { irreversible: true })]
			}
		});
		const { issues, path } = validateContinuity(g, ann);
		expect(path.map((id) => g.artifacts.find((a) => a.id === id)?.title)).toEqual([
			'31 drain cock seized',
			'33 plug comes free',
			'34 reaching for the crank',
			'35 Odile drains the bath'
		]);
		const blockers = issues.filter((i) => i.severity === 'blocker');
		expect(blockers.map((i) => i.stateKey)).toContain('mercury_bath.level');
		expect(
			blockers.some((i) => i.kind === 'continuity_violation' || i.kind === 'anchor_violation')
		).toBe(true);
		const reset = blockers.find(
			(i) => i.stateKey === 'mercury_bath.level' && i.artifactIds.length === 2
		);
		expect(reset?.explanation).toMatch(/falling/);
	});

	it('2. right-anchor ownership: a candidate that drains before the B anchor is rejected at the gate', () => {
		const a = artifact('braces the crank', { creatorRole: 'A' });
		const b = artifact('opens the drain', { creatorRole: 'B' });
		const root = relation(a.id, b.id, { type: 'precedes' });
		const graph: MiniGraph = { artifacts: [a, b], relations: [root], expansions: [] };
		const c = artifact('candidate', { kind: 'BRIDGE', creatorRole: 'C', status: 'PROPOSED' });
		graph.artifacts.push(c);
		const expansion = {
			...acceptBridgeShape(root, c.id),
			status: 'REVIEW' as const,
			selectedBridgeArtifactId: null,
			bridgeArtifactIds: [c.id]
		};
		graph.expansions.push(expansion);
		const ann = annotate(graph, {
			'braces the crank': { effects: [w('mercury_bath', 'level', 'FULL')] },
			'opens the drain': {
				preconditions: [w('mercury_bath', 'level', 'FULL')],
				effects: [w('mercury_bath', 'level', 'falling', { irreversible: true })]
			}
		});
		const bad = candidateIssues({ ...graph, project }, ann, {
			expansionId: expansion.id,
			artifactId: c.id,
			transition: T({ effects: [w('mercury_bath', 'level', 'falling', { irreversible: true })] })
		});
		expect(bad.some((i) => i.kind === 'anchor_violation' && i.severity === 'blocker')).toBe(true);
		const good = candidateIssues({ ...graph, project }, ann, {
			expansionId: expansion.id,
			artifactId: c.id,
			transition: T({
				preconditions: [w('mercury_bath', 'level', 'FULL')],
				effects: [w('odile', 'hand', 'on_crank')]
			})
		});
		expect(good.filter((i) => i.severity === 'blocker')).toEqual([]);
	});

	it('3. creative birth paradox: independent anchors disagreeing is a tension, and a reconciling bridge passes', () => {
		const a = artifact('born on Earth', { creatorRole: 'A' });
		const b = artifact('born on Mars', { creatorRole: 'B' });
		const root = relation(a.id, b.id, { type: 'contradicts' });
		const graph: MiniGraph = { artifacts: [a, b], relations: [root], expansions: [] };
		const ann = annotate(graph, {
			'born on Earth': { effects: [w('protagonist', 'birthplace', 'Earth')] },
			'born on Mars': { preconditions: [w('protagonist', 'birthplace', 'Mars')] }
		});
		const before = validateContinuity({ ...graph, project }, ann).issues;
		expect(before.every((i) => i.severity !== 'blocker')).toBe(true);
		expect(before.some((i) => i.kind === 'tension')).toBe(true);
		acceptBridge(graph, root, 'clone activated on Mars');
		const ann2 = annotate(graph, {
			'born on Earth': { effects: [w('original', 'birthplace', 'Earth')] },
			'clone activated on Mars': {
				preconditions: [w('original', 'birthplace', 'Earth')],
				effects: [w('protagonist', 'birthplace', 'Mars')],
				assumptions: [w('cloning', 'exists', true)]
			},
			'born on Mars': { preconditions: [w('protagonist', 'birthplace', 'Mars')] }
		});
		expect(
			validateContinuity({ ...graph, project }, ann2).issues.filter((i) => i.severity === 'blocker')
		).toEqual([]);
	});

	it('4. unreliable witness: conflicting beliefs are a perspective conflict, never a blocker', () => {
		const a = artifact('Mags says the sump is sound', { creatorRole: 'A' });
		const b = artifact('Odile thinks it is cracked', { creatorRole: 'A' });
		const graph: MiniGraph = {
			artifacts: [a, b],
			relations: [relation(a.id, b.id, { type: 'precedes' })],
			expansions: []
		};
		const ann = annotate(graph, {
			'Mags says the sump is sound': {
				effects: [w('sump', 'cracked', false, { epistemic: 'belief', holder: 'Mags' })]
			},
			'Odile thinks it is cracked': {
				effects: [w('sump', 'cracked', true, { epistemic: 'belief', holder: 'Odile' })]
			}
		});
		const { issues } = validateContinuity({ ...graph, project }, ann);
		expect(issues.map((i) => [i.kind, i.severity])).toEqual([['perspective_conflict', 'info']]);
	});

	it('5. lamp device: a prepared screen that is never used warns; consuming it clears the warning', () => {
		const prep = artifact('oils the eclipse screen', { creatorRole: 'A' });
		const sig = artifact('signals three eclipses', { creatorRole: 'A' });
		const end = artifact('ship answers', { creatorRole: 'A' });
		const graph: MiniGraph = {
			artifacts: [prep, sig, end],
			relations: [
				relation(prep.id, sig.id, { type: 'precedes' }),
				relation(sig.id, end.id, { type: 'precedes' })
			],
			expansions: []
		};
		const unused = annotate(graph, {
			'oils the eclipse screen': {
				effects: [w('eclipse_screen', 'ready', true, { preparation: true })]
			},
			'signals three eclipses': { effects: [w('signal', 'sent', 'three_eclipses')] },
			'ship answers': { preconditions: [w('signal', 'sent', 'three_eclipses')] }
		});
		expect(validateContinuity({ ...graph, project }, unused).issues.map((i) => i.kind)).toEqual([
			'abandoned_preparation'
		]);
		const used = annotate(graph, {
			'oils the eclipse screen': {
				effects: [w('eclipse_screen', 'ready', true, { preparation: true })]
			},
			'signals three eclipses': {
				preconditions: [w('eclipse_screen', 'ready', true)],
				effects: [w('signal', 'sent', 'three_eclipses')]
			},
			'ship answers': { preconditions: [w('signal', 'sent', 'three_eclipses')] }
		});
		expect(validateContinuity({ ...graph, project }, used).issues).toEqual([]);
	});

	it('6. budget: a low-information micro-bridge is flagged as redundancy (info, stop), not an error', () => {
		const a = artifact('a', { creatorRole: 'A' });
		const b = artifact('b', { creatorRole: 'B' });
		const root = relation(a.id, b.id, { type: 'precedes' });
		const graph: MiniGraph = { artifacts: [a, b], relations: [root], expansions: [] };
		acceptBridge(graph, root, 'she breathes');
		const ann = annotate(graph, {
			'she breathes': { preconditions: [w('odile', 'hand', 'on_crank')] }
		});
		const issues = validateContinuity({ ...graph, project }, ann).issues;
		expect(issues).toEqual([
			expect.objectContaining({
				kind: 'redundancy',
				severity: 'info',
				suggestedAction: 'stop_expansion'
			})
		]);
	});

	it('reports unannotated beats instead of guessing, and flags annotations of older revisions', () => {
		const a = artifact('a', { creatorRole: 'A' });
		const b = artifact('b', { creatorRole: 'A' });
		const graph: MiniGraph = {
			artifacts: [a, b],
			relations: [relation(a.id, b.id, { type: 'precedes' })],
			expansions: []
		};
		const ann = new Map<string, AnnotationLike>([
			[
				a.id,
				{
					artifactRevisionId: '00000000-0000-4000-8000-0000000000ff',
					transition: T({ effects: [w('x', 'y', 'z')] })
				}
			]
		]);
		const result = validateContinuity({ ...graph, project }, ann);
		expect(result.unannotatedArtifactIds).toEqual([b.id]);
		expect(result.issues.map((i) => i.kind)).toEqual(['stale_annotation']);
	});
});

function acceptBridgeShape(target: Relation, bridgeId: string) {
	const at = new Date(0).toISOString();
	return {
		id: '00000000-0000-4000-8000-0000000000ee',
		projectId: project.id,
		targetRelationId: target.id,
		leftArtifactId: target.fromId,
		rightArtifactId: target.toId,
		leftRevisionId: '00000000-0000-4000-8000-0000000000e1',
		rightRevisionId: '00000000-0000-4000-8000-0000000000e2',
		parentExpansionId: null,
		bridgeArtifactIds: [bridgeId],
		selectedBridgeArtifactId: bridgeId,
		depth: 1,
		status: 'ACCEPTED' as const,
		attempts: 1,
		childRelationIds: [],
		createdAt: at,
		updatedAt: at,
		acceptedAt: null,
		staleSides: []
	};
}
