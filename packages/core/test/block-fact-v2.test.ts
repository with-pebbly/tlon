/**
 * Regression suite from docs/reviews/BLOCK_FACT_V2_GENERATION_REVIEW.md (BF-02..BF-11 plus
 * the false-positive guards). Transitions are written by hand to reproduce what the
 * review found in the exported run; the assertions are about DETECTION and projection,
 * never about a particular rewrite.
 */
import type {
	Artifact,
	AssertionInput,
	AuditReport,
	CompletionPolicy,
	NarrativeConnection,
	TransitionInput,
	Triangle,
	ValidationIssue
} from '@tlon/contracts';
import { Transition } from '@tlon/contracts';
import { describe, expect, it } from 'vitest';

import {
	type AnnotationLike,
	chronologicalOrder,
	type CompletionInput,
	completionReport,
	entityRegistry,
	motifSignals,
	renderStoryMarkdown,
	storyBeats,
	validateContinuity
} from '../src/index.ts';
import { artifact, nextId, relation } from './fixtures.ts';

const at = new Date(0).toISOString();
const project = {
	id: '00000000-0000-4000-8000-000000000001',
	name: 'Старик посадил дерево',
	domain: 'NARRATIVE' as const,
	settings: { maxDepth: 5, maxCandidates: 3, maxNodesPerRun: 100, maxConcurrentJobs: 2 },
	createdAt: at,
	updatedAt: at
};
const s = (
	subject: string,
	predicate: string,
	value: string | number | boolean,
	extra: Partial<AssertionInput> = {}
): AssertionInput => ({ subject, predicate, value, ...extra });

type Spec = {
	/** A's Blocks in story order; the first is A's seed. */
	a: string[];
	/** B's Blocks in story order (earliest first); the LAST one is B's seed, written first. */
	b: string[];
	fact?: string;
	bodies?: Record<string, string>;
	advance?: Triangle['advance'];
	status?: Triangle['status'];
	/** Leave the triangle out entirely: a legacy project joined by one precedes relation. */
	legacy?: boolean;
};

/**
 * One Triangle joining A's seed and B's seed through a Fact; each side's continuation is
 * the Block next to its seed. Relations chain each side as the protocol writes it.
 */
function world(spec: Spec) {
	const make = (title: string, side: 'A' | 'B') =>
		artifact(title, {
			creatorRole: side,
			ownerScope: side === 'A' ? 'A_PRIVATE' : 'B_PRIVATE',
			body: spec.bodies?.[title] ?? `${title} body`
		});
	const aBlocks = spec.a.map((t) => make(t, 'A'));
	const bBlocks = spec.b.map((t) => make(t, 'B'));
	const fact = artifact(spec.fact ?? 'Roots keep memory', {
		kind: 'NOTE',
		artifactClass: 'FACT',
		factKind: 'rule',
		ownerScope: 'C_SHARED',
		creatorRole: 'C'
	});
	const chain = (blocks: Artifact[]) =>
		blocks.slice(1).map((next, i) => relation(blocks[i]!.id, next.id, { type: 'precedes' }));
	const relations = [...chain(aBlocks), ...chain(bBlocks)];
	const aSeed = aBlocks[0]!;
	const bSeed = bBlocks.at(-1)!;
	const ref = (a: Artifact) => ({ artifactId: a.id, revisionId: a.headRevisionId });
	const continuations: Triangle['continuations'] = [
		...(aBlocks[1] ? [{ side: 'left' as const, block: ref(aBlocks[1]), taskId: null }] : []),
		...(bBlocks.length > 1
			? [{ side: 'right' as const, block: ref(bBlocks.at(-2)!), taskId: null }]
			: [])
	];
	const triangle: Triangle = {
		id: nextId(),
		projectId: project.id,
		runId: null,
		left: { ...ref(aSeed), factAnchorId: null },
		right: { ...ref(bSeed), factAnchorId: null },
		fact: ref(fact),
		status: spec.status ?? 'converged',
		stageIndex: 2,
		depth: 1,
		parentTriangleId: null,
		...(spec.advance ? { advance: spec.advance } : {}),
		continuations,
		createdAt: at,
		updatedAt: at
	};
	if (spec.legacy) relations.push(relation(aSeed.id, bSeed.id, { type: 'precedes' }));
	const artifacts = [...aBlocks, ...bBlocks, fact];
	const graph = {
		project,
		artifacts,
		relations,
		expansions: [],
		triangles: spec.legacy ? [] : [triangle]
	};
	const id = (title: string) => artifacts.find((a) => a.title === title)!.id;
	const annotate = (byTitle: Record<string, TransitionInput>) => {
		const annotations = new Map<string, AnnotationLike>();
		const transitions = new Map<string, Transition>();
		for (const a of artifacts) {
			const input = byTitle[a.title];
			if (!input) continue;
			const transition = Transition.parse(input);
			annotations.set(a.id, { artifactRevisionId: a.headRevisionId, transition });
			transitions.set(a.id, transition);
		}
		return { annotations, transitions };
	};
	return { graph, id, factId: fact.id, aSeed, bSeed, annotate };
}

const kinds = (issues: Array<{ kind: string; severity: string }>) =>
	issues.map((i) => `${i.kind}/${i.severity}`);

const connection = (
	patch: Pick<NarrativeConnection, 'kind' | 'endpointIds'> & Partial<NarrativeConnection>
): NarrativeConnection => ({
	id: nextId(),
	projectId: project.id,
	factArtifactId: null,
	realizedByIds: [],
	statement: 'statement',
	confidence: 'unknown',
	status: 'active',
	source: 'human',
	approvedBy: null,
	createdAt: at,
	updatedAt: at,
	...patch
});

const issue = (patch: Partial<ValidationIssue> & Pick<ValidationIssue, 'kind' | 'severity'>) =>
	({
		key: `${patch.kind}:${nextId()}`,
		artifactIds: [],
		stateKey: null,
		explanation: 'x',
		suggestedAction: null,
		dismissal: null,
		...patch
	}) satisfies ValidationIssue;

const FOUR = { a: ['A seed', 'A after'], b: ['B before', 'B seed'] };

describe('identity (BF-02, BF-05, BF-06)', () => {
	it('BF-02: two Прохор stay two entities, are flagged as info and never raise a violation', () => {
		const w = world(FOUR);
		const { annotations, transitions } = w.annotate({
			'B before': {
				entities: [
					{
						id: 'prokhor_dyatlov',
						name: 'Прохор Дятлов',
						kind: 'person',
						distinguishing: 'stove-builder, 1957'
					}
				],
				time: { year: 1957 }
			},
			'B seed': {
				entities: [
					{
						id: 'prokhor_averyanov',
						name: 'Прохор Аверьянов',
						kind: 'person',
						distinguishing: "Efim's grandfather, 1963"
					},
					{ id: 'prokhor_dyatlov', name: 'прохор дятлов (other spelling)', kind: 'person' }
				],
				time: { year: 1963 }
			}
		});
		const registry = entityRegistry(
			[...transitions].map(([artifactId, transition]) => ({ artifactId, transition }))
		);
		expect(registry.map((e) => e.id).toSorted()).toEqual(['prokhor_averyanov', 'prokhor_dyatlov']);
		const dyatlov = registry.find((e) => e.id === 'prokhor_dyatlov')!;
		// First mention wins; the same id seen twice is one entity mentioned by two beats.
		expect(dyatlov.name).toBe('Прохор Дятлов');
		expect(dyatlov.artifactIds).toEqual([w.id('B before'), w.id('B seed')]);

		const { issues } = validateContinuity(w.graph, annotations);
		expect(kinds(issues)).toEqual(['ambiguous_entity/info']);
		expect(issues[0]).toMatchObject({ suggestedAction: 'keep_as_is' });
		expect(issues[0]!.explanation).toContain('kept as distinct');
		expect(issues[0]!.explanation).toContain('prokhor_averyanov');
	});

	it('flags a bare first name against a full name, and equal names across kinds, but not unrelated names', () => {
		const w = world(FOUR);
		const { annotations } = w.annotate({
			'A seed': {
				entities: [
					{ id: 'prokhor', name: 'Прохор', kind: 'person' },
					{ id: 'wall_a', name: 'Пол не поднимать', kind: 'inscription' },
					{ id: 'lilia', name: 'Лилия', kind: 'person' }
				]
			},
			'B seed': {
				entities: [
					{ id: 'prokhor_dyatlov', name: 'Прохор Дятлов', kind: 'person' },
					{ id: 'wall_b', name: ' пол не поднимать ', kind: 'inscription' },
					{ id: 'efim', name: 'Ефим', kind: 'person' }
				]
			}
		});
		const flagged = validateContinuity(w.graph, annotations).issues.filter(
			(i) => i.kind === 'ambiguous_entity'
		);
		expect(flagged.map((i) => i.stateKey).toSorted()).toEqual([
			'prokhor|prokhor_dyatlov',
			'wall_a|wall_b'
		]);
	});

	it('BF-05: the same inscription text on two surfaces is two instances without a clash', () => {
		const w = world({ a: ['A seed', 'A after'], b: ['B before', 'B seed'] });
		const door = {
			id: 'warning_pantry_door',
			name: 'Пол не поднимать',
			kind: 'inscription' as const,
			distinguishing: 'inside of the pantry door'
		};
		const board = {
			id: 'warning_floorboard',
			name: 'Пол не поднимать',
			kind: 'inscription' as const,
			distinguishing: 'scratched on a middle floorboard'
		};
		const { annotations } = w.annotate({
			'A seed': { entities: [door], effects: [s('warning_pantry_door', 'surface', 'pantry door')] },
			'A after': {
				entities: [board],
				preconditions: [s('warning_pantry_door', 'surface', 'pantry door')],
				effects: [s('warning_floorboard', 'surface', 'floorboard')]
			}
		});
		const { issues } = validateContinuity(w.graph, annotations);
		expect(kinds(issues)).toEqual(['ambiguous_entity/info']);
		expect(issues[0]!.explanation).toContain('never merged');
		const registry = entityRegistry(
			[...annotations].map(([artifactId, a]) => ({ artifactId, transition: a.transition }))
		);
		expect(registry.map((e) => e.id)).toEqual(['warning_pantry_door', 'warning_floorboard']);
	});

	it('BF-06: a circle-with-three-strokes stamp and a ять stamp on the same subject key do not clash across sides', () => {
		const states = {
			'A after': { effects: [s('compound_brick', 'mark', 'К + ять')] },
			'B seed': { preconditions: [s('compound_brick', 'mark', 'circle with three short strokes')] }
		};
		const blockFact = world(FOUR);
		expect(
			validateContinuity(blockFact.graph, blockFact.annotate(states).annotations).issues
		).toEqual([]);

		// Control: the same prose on one legacy path IS a disagreement between independent
		// anchors (a creative tension, never a blocker): the check works, only the scope changed.
		const legacy = world({ ...FOUR, legacy: true });
		expect(
			kinds(validateContinuity(legacy.graph, legacy.annotate(states).annotations).issues)
		).toEqual(['tension/info']);
	});

	it('BF-07: ten knocks on A and 17 pulses on B are distinct counted quantities, not a monotonic break', () => {
		const counts = {
			'A after': {
				effects: [s('signal', 'count', 10, { unit: 'events', monotonic: 'decreasing' })]
			},
			'B seed': { effects: [s('signal', 'count', 17, { unit: 'events', monotonic: 'decreasing' })] }
		};
		const blockFact = world(FOUR);
		expect(
			validateContinuity(blockFact.graph, blockFact.annotate(counts).annotations).issues
		).toEqual([]);

		const legacy = world({ ...FOUR, legacy: true });
		expect(
			kinds(validateContinuity(legacy.graph, legacy.annotate(counts).annotations).issues)
		).toEqual(['monotonic_violation/warning']);
	});
});

describe('story time per side chain (BF-03, BF-04)', () => {
	it('BF-03: 1957 → 1958 → 1963 within B raises no chronology error, even with unrelated A clocks', () => {
		const w = world({ a: ['A seed', 'A after'], b: ['B first', 'B before', 'B seed'] });
		const { annotations } = w.annotate({
			'A seed': { time: { day: 0, minute: 600 } },
			'A after': { time: { day: 0, minute: 900 } },
			'B first': { time: { year: 1957 } },
			'B before': { time: { year: 1958 } },
			// A's clock never leaks into B's: B's minute 100 follows A's minute 900 in reading order.
			'B seed': { time: { year: 1963, day: 0, minute: 100 } }
		});
		expect(validateContinuity(w.graph, annotations).issues).toEqual([]);
	});

	it('diagnoses a year that steps back against the requested direction once, tolerating approx ±1 and explicit flashbacks', () => {
		const stepBack = world({ a: ['A seed'], b: ['B before', 'B seed'] });
		const { issues } = validateContinuity(
			stepBack.graph,
			stepBack.annotate({
				'B before': { time: { year: 1963 } },
				'B seed': { time: { year: 1930 } }
			}).annotations
		);
		// Reading order is not a time axis: only the triangle's direction is judged.
		expect(kinds(issues)).toEqual(['direction_mismatch/warning']);
		expect(issues[0]!.explanation).toContain('1930');
		expect(issues[0]!.explanation).toContain('1963');

		const near = world({ a: ['A seed'], b: ['B before', 'B seed'] });
		expect(
			validateContinuity(
				near.graph,
				near.annotate({
					'B before': { time: { year: 1964, approx: true } },
					'B seed': { time: { year: 1963 } }
				}).annotations
			).issues
		).toEqual([]);

		const flashback = world({ a: ['A seed'], b: ['B before', 'B seed'] });
		expect(
			validateContinuity(
				flashback.graph,
				flashback.annotate({
					'B before': { time: { year: 1963, outOfOrder: true } },
					'B seed': { time: { year: 1930 } }
				}).annotations
			).issues
		).toEqual([]);
	});

	it('judges a same-day clock step back once, as a direction mismatch', () => {
		const w = world({ a: ['A seed', 'A after'], b: ['B seed'] });
		const { issues } = validateContinuity(
			w.graph,
			w.annotate({
				'A seed': { time: { day: 0, minute: 600 } },
				'A after': { time: { day: 0, minute: 500 } }
			}).annotations
		);
		expect(kinds(issues)).toEqual(['direction_mismatch/warning']);
	});

	it('never orders Blocks by clock time alone when their dates are unknown or relative', () => {
		const w = world({ a: ['A seed'], b: ['B before', 'B seed'] });
		const { issues } = validateContinuity(
			w.graph,
			w.annotate({
				'B before': { time: { minute: 720, relative: 'in July' } },
				'B seed': { time: { minute: 120, relative: 'in October' } }
			}).annotations
		);
		expect(issues).toEqual([]);
	});

	it('reports a state change between non-contiguous Blocks of one side as a missing transition, not a violation', () => {
		const w = world({ a: ['A seed'], b: ['B before', 'B seed'] });
		const hut = (value: string) => ({
			subject: 'ravine_hut',
			predicate: 'status',
			value,
			epistemic: 'world' as const,
			irreversible: false,
			preparation: false
		});
		const { issues } = validateContinuity(
			w.graph,
			w.annotate({
				'B before': { effects: [hut('inventoried')], time: { relative: 'eleven winters earlier' } },
				'B seed': { preconditions: [hut('escheated')], time: { year: 1957 } }
			}).annotations
		);
		expect(kinds(issues)).toEqual(['missing_transition/warning']);
	});

	it('BF-04: a relative-only date never takes part in comparisons and is never turned into a year', () => {
		const w = world({ a: ['A seed'], b: ['B before', 'B seed'] });
		const { annotations, transitions } = w.annotate({
			'B before': { time: { relative: 'eleven winters before the church was boarded up' } },
			'B seed': { time: { year: 1930 } }
		});
		expect(validateContinuity(w.graph, annotations).issues).toEqual([]);

		const beats = storyBeats(w.graph);
		const { dated, undated } = chronologicalOrder(beats, transitions);
		expect(dated.map((e) => e.beat.artifact.title)).toEqual(['B seed']);
		expect(undated.map((e) => e.beat.artifact.title)).toEqual(['A seed', 'B before']);
		const relative = undated.find((e) => e.beat.artifact.title === 'B before')!;
		expect(relative.time).toMatchObject({
			relative: 'eleven winters before the church was boarded up'
		});
		expect(relative.time?.year).toBeUndefined();

		const md = renderStoryMarkdown(w.graph, { annotations: true, transitions });
		expect(md).toContain(
			'relative: “eleven winters before the church was boarded up” (absolute date unknown)'
		);
	});
});

describe('direction_mismatch', () => {
	it('a backward continuation dated 1963 from a 1930 anchor is a warning naming both years', () => {
		const w = world(FOUR);
		const { issues } = validateContinuity(
			w.graph,
			w.annotate({
				'B before': { time: { year: 1963 } },
				'B seed': { time: { year: 1930 } }
			}).annotations
		);
		const mismatch = issues.filter((i) => i.kind === 'direction_mismatch');
		expect(mismatch).toHaveLength(1);
		expect(mismatch[0]).toMatchObject({ severity: 'warning', suggestedAction: 'revise_bridge' });
		expect(mismatch[0]!.artifactIds.toSorted()).toEqual(
			[w.id('B before'), w.id('B seed')].toSorted()
		);
		expect(mismatch[0]!.explanation).toContain('backward');
		expect(mismatch[0]!.explanation).toContain('year 1963');
		expect(mismatch[0]!.explanation).toContain('year 1930');
	});

	it('a forward continuation earlier than its anchor is flagged at day level; correct directions are not', () => {
		const wrong = world(FOUR);
		const { issues } = validateContinuity(
			wrong.graph,
			wrong.annotate({
				'A seed': { time: { day: 5, minute: 60 } },
				'A after': { time: { day: 3, minute: 60 } }
			}).annotations
		);
		const mismatch = issues.filter((i) => i.kind === 'direction_mismatch');
		expect(mismatch).toHaveLength(1);
		expect(mismatch[0]!.explanation).toContain('forward');
		expect(mismatch[0]!.explanation).toContain('day 3');
		expect(mismatch[0]!.explanation).toContain('day 5');

		const right = world(FOUR);
		expect(
			validateContinuity(
				right.graph,
				right.annotate({
					'A seed': { time: { year: 1930 } },
					'A after': { time: { year: 1931 } },
					'B before': { time: { year: 1958 } },
					'B seed': { time: { year: 1963 } }
				}).annotations
			).issues
		).toEqual([]);
	});

	it('respects an overridden advance, unknown times and atemporal continuations', () => {
		const times = { 'B before': { time: { year: 1963 } }, 'B seed': { time: { year: 1930 } } };
		const forwardRight = world({ ...FOUR, advance: { left: 'forward', right: 'forward' } });
		expect(
			validateContinuity(
				forwardRight.graph,
				forwardRight.annotate(times).annotations
			).issues.filter((i) => i.kind === 'direction_mismatch')
		).toEqual([]);
		const atemporal = world({ ...FOUR, advance: { left: 'atemporal', right: 'atemporal' } });
		expect(
			validateContinuity(atemporal.graph, atemporal.annotate(times).annotations).issues.filter(
				(i) => i.kind === 'direction_mismatch'
			)
		).toEqual([]);
		const unknown = world(FOUR);
		expect(
			validateContinuity(
				unknown.graph,
				unknown.annotate({
					'B before': { time: { relative: 'much later' } },
					'B seed': { time: { year: 1930 } }
				}).annotations
			).issues
		).toEqual([]);
	});
});

describe('legacy projects stay as they were', () => {
	const timeline = {
		'A seed': { time: { day: 0, minute: 600 }, effects: [s('door', 'state', 'open')] },
		'A after': { time: { day: 0, minute: 900 } },
		'B before': { time: { day: 0, minute: 100 } },
		'B seed': { time: { day: 0, minute: 200 }, preconditions: [s('door', 'state', 'closed')] }
	};

	it('without triangles one path is replayed across A and B (cross-side differences still count)', () => {
		const legacy = world({ ...FOUR, legacy: true });
		const result = validateContinuity(legacy.graph, legacy.annotate(timeline).annotations);
		expect(result.path).toEqual(storyBeats(legacy.graph).map((b) => b.artifact.id));
		expect(kinds(result.issues)).toContain('temporal_order/blocker');
		expect(kinds(result.issues)).toContain('tension/info');
	});

	it('the same annotations on a Block–Fact project replay per side: no cross-side issue at all', () => {
		const bf = world(FOUR);
		const result = validateContinuity(bf.graph, bf.annotate(timeline).annotations);
		expect(result.issues).toEqual([]);
		expect(result.path.toSorted()).toEqual(
			storyBeats(bf.graph)
				.map((b) => b.artifact.id)
				.toSorted()
		);
	});

	it('rejected and superseded triangles do not switch a project to per-side replay', () => {
		for (const status of ['rejected', 'superseded'] as const) {
			const w = world({ ...FOUR, status });
			const result = validateContinuity(w.graph, w.annotate(timeline).annotations);
			expect(kinds(result.issues)).toContain('temporal_order/blocker');
		}
	});
});

describe('chronological projection (BF-11)', () => {
	const dates = {
		'A seed': { time: { year: 1958 } },
		'A after': { time: { year: 1930 } },
		'B before': { time: { relative: 'eleven winters before the closing' } },
		'B seed': { time: { year: 1963 } }
	};

	it('sorts dated beats by (year, day, minute), falls back to presentation order and never mutates', () => {
		const w = world({ a: ['A seed', 'A mid', 'A after'], b: ['B before', 'B seed'] });
		const { transitions } = w.annotate({
			'A seed': { time: { year: 1958, day: 2 } },
			'A mid': { time: { year: 1958, day: 2 } },
			'A after': { time: { year: 1958, day: 1, minute: 30 } },
			'B seed': { time: { year: 1930 } }
		});
		const beats = storyBeats(w.graph);
		const snapshot = structuredClone(beats);
		const { dated, undated } = chronologicalOrder(beats, transitions);
		expect(dated.map((e) => e.beat.artifact.title)).toEqual([
			'B seed',
			'A after',
			'A seed',
			'A mid'
		]);
		expect(undated.map((e) => e.beat.artifact.title)).toEqual(['B before']);
		expect(undated[0]!.time).toBeNull();
		expect(beats).toEqual(snapshot);
	});

	it('reorders only the view: same text, presentation numbers kept, undated Blocks after, order labelled', () => {
		const w = world(FOUR);
		const { transitions } = w.annotate(dates);
		const presentation = renderStoryMarkdown(w.graph, { annotations: true, transitions });
		const chronological = renderStoryMarkdown(w.graph, {
			annotations: true,
			transitions,
			order: 'chronological'
		});
		const headings = (md: string) =>
			md.match(/^## \d+\. .*$/gm)!.filter((h) => !h.includes('Facts'));
		expect(headings(presentation)).toEqual([
			'## 1. A seed',
			'## 2. A after',
			'## 3. B before',
			'## 4. B seed'
		]);
		expect(headings(chronological)).toEqual([
			'## 2. A after',
			'## 1. A seed',
			'## 4. B seed',
			'## 3. B before'
		]);
		expect(presentation).toContain('order: presentation (protocol reading order');
		expect(chronological).toContain('order: chronological (dated Blocks by story time');
		for (const title of ['A seed', 'A after', 'B before', 'B seed']) {
			expect(chronological).toContain(`${title} body`);
		}
		// Cross references use the presentation numbers in both views.
		expect(chronological).toContain('fact link between #1 and #4');
	});

	it('chronological order without annotations on the beats degrades to the reading order', () => {
		const w = world(FOUR);
		const md = renderStoryMarkdown(w.graph, { order: 'chronological' });
		expect(md.match(/^## \d+\. .*$/gm)).toEqual([
			'## 1. A seed',
			'## 2. A after',
			'## 3. B before',
			'## 4. B seed'
		]);
		expect(md).toContain('_Order: chronological');
	});
});

describe('rendering a Block–Fact export', () => {
	it('BF-08: shows the Fact link and the realization line from the continuations, not as causality', () => {
		const w = world({ ...FOUR, fact: 'Семнадцать осколков кирпича' });
		const md = renderStoryMarkdown(w.graph, { annotations: true });
		expect(md).toContain(
			'_4 Blocks (A 2, B 2) · 1 Fact · triangle depth ≤ 1 · generation stages 1–3 · order: presentation'
		);
		expect(md).not.toMatch(/bridges|max depth/);
		expect(md).toContain('not causal claims');
		expect(md).toContain(
			'- **Семнадцать осколков кирпича** (rule, stage 2) — fact link between #1 and #4; disclosed to and realized by #2 (A) and #3 (B)'
		);
	});

	it('shows story time and entity notes on annotated beats', () => {
		const w = world(FOUR);
		const { transitions } = w.annotate({
			'B before': {
				time: { year: 1957 },
				entities: [
					{
						id: 'prokhor_dyatlov',
						name: 'Прохор Дятлов',
						kind: 'person',
						distinguishing: 'stove-builder'
					}
				]
			}
		});
		const md = renderStoryMarkdown(w.graph, { annotations: true, transitions });
		expect(md).toContain('> **Story time:** 1957');
		expect(md).toContain('> **Entities:** Прохор Дятлов (person: stove-builder)');
		expect(renderStoryMarkdown(w.graph, { transitions })).not.toContain('Story time');
	});

	it('prints organizer sections: connections grouped by kind (rejected omitted), completion yaml, audit counts', () => {
		const w = world(FOUR);
		const connections = [
			connection({
				kind: 'open_mystery',
				endpointIds: [w.aSeed.id, w.bSeed.id],
				statement: 'Do the knocks relate to the pulses?',
				approvedBy: 'facilitator'
			}),
			connection({
				kind: 'thematic_echo',
				endpointIds: [w.aSeed.id, w.bSeed.id],
				statement: 'Counting echo',
				source: 'ai_review'
			}),
			connection({
				kind: 'causal_hypothesis',
				endpointIds: [w.aSeed.id, w.bSeed.id],
				statement: 'REJECTED GUESS',
				status: 'rejected'
			})
		];
		const completion = completionReport({
			graph: w.graph,
			connections,
			issues: [],
			audit: null,
			policy: 'coherent_open_mystery'
		});
		const audit: AuditReport = {
			projectId: project.id,
			tasks: [
				{
					taskId: nextId(),
					type: 'seed_block',
					role: 'A',
					executorKind: 'human',
					stageIndex: 1,
					state: 'approved',
					manifest: null,
					crossScopeInputIds: []
				}
			],
			denyChecks: [
				{ principalId: nextId(), role: 'A', checkedArtifacts: 2, visibleArtifactIds: [] }
			],
			isolationVerified: true
		};
		const md = renderStoryMarkdown(w.graph, { annotations: true, connections, completion, audit });
		expect(md).toContain('## Connections (organizer)');
		expect(md).toMatch(
			/### open_mystery\n\n- #1 and #4 — Do the knocks relate to the pulses\? _\(status: active; approved; source: human\)_/
		);
		expect(md).toMatch(
			/### thematic_echo\n\n- #1 and #4 — Counting echo _\(status: active; not approved; source: ai_review\)_/
		);
		expect(md).not.toContain('REJECTED GUESS');
		expect(md).toContain(
			'```yaml\npolicy: coherent_open_mystery\nconnected_fact_pairs: 1\nconfirmed_cross_branch_causal_paths: 0\nopen_questions:'
		);
		expect(md).toContain('    intentional: true');
		expect(md).toContain('certifiable: true');
		expect(md).toContain('isolation_verified: unknown');
		expect(md).toContain('## Isolation audit');
		expect(md).toContain('- Tasks audited: 1 (0 with a recorded input manifest)');
		expect(md).toContain('- Isolation verified: yes');
	});
});

describe('completion report (BF-09, BF-10)', () => {
	const report = (w: { graph: CompletionInput['graph'] }, over: Partial<CompletionInput> = {}) => {
		const run = (policy: CompletionPolicy) =>
			completionReport({
				graph: w.graph,
				connections: [],
				issues: [],
				audit: null,
				...over,
				policy
			});
		return {
			exploratory: run('exploratory'),
			coherent_open_mystery: run('coherent_open_mystery'),
			causally_connected: run('causally_connected'),
			resolved: run('resolved')
		};
	};

	it('a bare Fact link is neither causality nor an answer: unknown paths and one unexplained question', () => {
		const w = world({ ...FOUR, fact: 'Семнадцать осколков кирпича' });
		const r = report(w);
		expect(r.exploratory).toMatchObject({
			connectedFactPairs: 1,
			confirmedCrossBranchCausalPaths: 'unknown',
			isolationVerified: 'unknown',
			chronologyConflicts: 0,
			blockers: 0,
			certifiable: true,
			reasons: []
		});
		expect(r.exploratory.openQuestions).toEqual([
			{
				connectionId: null,
				kind: 'unexplained_fact_link',
				statement: 'How, if at all, does “Семнадцать осколков кирпича” join #1 and #4?',
				endpointIds: [w.aSeed.id, w.bSeed.id],
				intentional: false
			}
		]);
		// BF-09: "story complete" with required causal linkage is blocked, with plain reasons.
		expect(r.causally_connected.certifiable).toBe(false);
		expect(r.causally_connected.reasons).toEqual([
			'Cross-branch causality is unknown: no approved connection between the A and B branches has been recorded.'
		]);
		expect(r.resolved.certifiable).toBe(false);
		expect(r.resolved.reasons).toHaveLength(2);
		expect(r.resolved.reasons[1]).toContain('1 open question(s) remain unanswered');
		expect(r.coherent_open_mystery.certifiable).toBe(false);
		expect(r.coherent_open_mystery.reasons).toEqual([
			'1 open question(s) are not marked as intentional by a facilitator; approve each as a deliberate mystery or answer it.'
		]);
	});

	it('BF-10: an approved open mystery permits a coherent open ending but not a causal one', () => {
		const w = world(FOUR);
		const mystery = connection({
			kind: 'open_mystery',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			factArtifactId: w.factId,
			statement: 'Do the knocks relate to the pulses?',
			approvedBy: 'facilitator'
		});
		const r = report(w, { connections: [mystery] });
		expect(r.coherent_open_mystery).toMatchObject({
			certifiable: true,
			reasons: [],
			confirmedCrossBranchCausalPaths: 0
		});
		expect(r.coherent_open_mystery.openQuestions).toEqual([
			expect.objectContaining({ connectionId: mystery.id, kind: 'open_mystery', intentional: true })
		]);
		expect(r.causally_connected.certifiable).toBe(false);
		expect(r.causally_connected.reasons[0]).toContain('No approved causal connection');
		expect(r.resolved.certifiable).toBe(false);
	});

	it('an unapproved mystery or an AI hypothesis stays an unintentional open question', () => {
		const w = world(FOUR);
		const unapproved = connection({
			kind: 'open_mystery',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			factArtifactId: w.factId
		});
		expect(report(w, { connections: [unapproved] }).coherent_open_mystery.certifiable).toBe(false);

		const hypothesis = connection({
			kind: 'causal_hypothesis',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			source: 'ai_review',
			statement: 'The house sits inside chamber seven'
		});
		const r = report(w, { connections: [hypothesis] });
		expect(r.coherent_open_mystery.openQuestions.map((q) => q.kind)).toEqual([
			'causal_hypothesis',
			'unexplained_fact_link'
		]);
		expect(r.coherent_open_mystery.openQuestions.every((q) => !q.intentional)).toBe(true);
		// A hypothesis is never evidence of a cause.
		expect(r.causally_connected.confirmedCrossBranchCausalPaths).toBe('unknown');
	});

	it('an approved cross-branch causal_canon connects and resolves; same-side or unapproved canon does not', () => {
		const w = world(FOUR);
		const canon = connection({
			kind: 'causal_canon',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			factArtifactId: w.factId,
			approvedBy: 'facilitator'
		});
		const r = report(w, { connections: [canon] });
		expect(r.causally_connected).toMatchObject({
			certifiable: true,
			confirmedCrossBranchCausalPaths: 1
		});
		expect(r.resolved).toMatchObject({ certifiable: true, reasons: [], openQuestions: [] });

		const sameSide = connection({
			kind: 'causal_canon',
			endpointIds: [w.aSeed.id, w.id('A after')],
			factArtifactId: w.factId,
			approvedBy: 'facilitator'
		});
		const same = report(w, { connections: [sameSide] });
		expect(same.causally_connected.confirmedCrossBranchCausalPaths).toBe(0);
		expect(same.causally_connected.certifiable).toBe(false);

		const unapproved = connection({ kind: 'causal_canon', endpointIds: [w.aSeed.id, w.bSeed.id] });
		expect(report(w, { connections: [unapproved] }).causally_connected.certifiable).toBe(false);
	});

	it('BF-15: a rejected interpretation disappears while the Fact link remains a question', () => {
		const w = world(FOUR);
		const rejected = connection({
			kind: 'causal_canon',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			factArtifactId: w.factId,
			approvedBy: 'facilitator',
			status: 'rejected'
		});
		const r = report(w, { connections: [rejected] });
		expect(r.causally_connected.confirmedCrossBranchCausalPaths).toBe('unknown');
		expect(r.causally_connected.connectedFactPairs).toBe(1);
		expect(r.causally_connected.openQuestions.map((q) => q.kind)).toEqual([
			'unexplained_fact_link'
		]);
	});

	it('counts only live triangles with an accepted Fact as connected pairs', () => {
		const rejected = world({ ...FOUR, status: 'rejected' });
		expect(report(rejected).exploratory.connectedFactPairs).toBe(0);
		expect(report(rejected).exploratory.openQuestions).toEqual([]);
		const noFact = world(FOUR);
		noFact.graph.triangles = [{ ...noFact.graph.triangles[0]!, fact: null }];
		expect(report(noFact).exploratory.connectedFactPairs).toBe(0);
	});

	it('blockers gate every non-exploratory policy; dismissed issues and info do not; chronology counts warnings', () => {
		const w = world(FOUR);
		const mystery = connection({
			kind: 'open_mystery',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			factArtifactId: w.factId,
			approvedBy: 'f'
		});
		const blocker = issue({ kind: 'continuity_violation', severity: 'blocker' });
		const dismissed = issue({
			kind: 'temporal_order',
			severity: 'blocker',
			dismissal: { resolution: 'intentional', reason: 'flashback', actorId: 'h', createdAt: at }
		});
		const open = report(w, { connections: [mystery], issues: [blocker, dismissed] });
		expect(open.exploratory.certifiable).toBe(true);
		expect(open.coherent_open_mystery).toMatchObject({
			certifiable: false,
			blockers: 1,
			chronologyConflicts: 0
		});
		expect(open.coherent_open_mystery.reasons).toEqual([
			'1 open blocking continuity issue(s) must be resolved or dismissed.'
		]);

		const chrono = report(w, {
			connections: [mystery],
			issues: [
				issue({ kind: 'temporal_order', severity: 'warning' }),
				issue({ kind: 'direction_mismatch', severity: 'warning' }),
				issue({ kind: 'temporal_order', severity: 'info' }),
				issue({ kind: 'ambiguous_entity', severity: 'info' })
			]
		});
		expect(chrono.coherent_open_mystery).toMatchObject({
			chronologyConflicts: 2,
			blockers: 0,
			certifiable: true
		});
	});

	it('reads isolation from the audit and keeps unknown without one', () => {
		const w = world(FOUR);
		const audit = (isolationVerified: AuditReport['isolationVerified']): AuditReport => ({
			projectId: project.id,
			tasks: [],
			denyChecks: [],
			isolationVerified
		});
		expect(report(w, { audit: audit(true) }).exploratory.isolationVerified).toBe(true);
		expect(report(w, { audit: audit(false) }).exploratory.isolationVerified).toBe(false);
		expect(report(w, { audit: audit('unknown') }).exploratory.isolationVerified).toBe('unknown');
		expect(report(w).exploratory.isolationVerified).toBe('unknown');
	});
});

describe('motif signals (advisory)', () => {
	it('flags a continuation that titles itself after the Fact (all words of 4+ letters)', () => {
		const w = world({
			a: ['A seed', 'Семнадцать осколков, снова кирпича'],
			b: ['B before', 'B seed'],
			fact: 'Семнадцать осколков кирпича'
		});
		expect(motifSignals(w.graph)).toEqual([
			{
				artifactId: w.id('Семнадцать осколков, снова кирпича'),
				signal: 'titles itself after the Fact'
			}
		]);
		const partial = world({
			a: ['A seed', 'Семнадцать осколков'],
			b: ['B before', 'B seed'],
			fact: 'Семнадцать осколков кирпича'
		});
		expect(motifSignals(partial.graph)).toEqual([]);
	});

	it('flags the Fact phrase only from its third verbatim use on, and only as whole phrase', () => {
		const phrase = 'Пол не поднимать';
		const w = world({
			a: ['a1', 'a2', 'a3', 'a4'],
			b: ['B seed'],
			fact: phrase,
			bodies: {
				a1: `Он прочёл: «${phrase}».`,
				a2: `Снова ${phrase.toLowerCase()}!`,
				a3: `Надпись гласила ${phrase}`,
				a4: `Пол не лежал, поднимать не стали`
			}
		});
		const signals = motifSignals(w.graph);
		expect(signals).toEqual([{ artifactId: w.id('a3'), signal: 'repeats Fact phrase verbatim' }]);
		const twice = world({
			a: ['a1', 'a2'],
			b: ['B seed'],
			fact: phrase,
			bodies: { a1: phrase, a2: phrase }
		});
		expect(motifSignals(twice.graph)).toEqual([]);
	});

	it('quiet beats alone are not a signal; the third quiet annotated beat in a row on one side is', () => {
		const w = world({ a: ['a1', 'a2', 'a3', 'a4'], b: ['b1', 'B seed'] });
		const quiet = { functions: [] };
		const busy = { functions: ['revelation' as const] };
		const some = (byTitle: Record<string, TransitionInput>) =>
			motifSignals(w.graph, w.annotate(byTitle).transitions);
		expect(some({ a1: quiet, a2: quiet })).toEqual([]);
		expect(some({ a1: quiet, a2: quiet, a3: quiet })).toEqual([
			{ artifactId: w.id('a3'), signal: 'third quiet beat in a row' }
		]);
		expect(some({ a1: quiet, a2: busy, a3: quiet, a4: quiet })).toEqual([]);
		// An unannotated beat breaks the run: unknown is not quiet.
		expect(some({ a1: quiet, a3: quiet, a4: quiet })).toEqual([]);
		// Runs never straddle the two sides.
		expect(some({ a4: quiet, b1: quiet, 'B seed': quiet })).toEqual([]);
		// Without annotations there is nothing to judge.
		expect(motifSignals(w.graph)).toEqual([]);
	});

	it('are reported by the completion report and never block certification', () => {
		const w = world({
			a: ['A seed', 'A after'],
			b: ['B before', 'B seed'],
			fact: 'Roots keep memory',
			bodies: {
				'A seed': 'Roots keep memory',
				'A after': 'Roots keep memory',
				'B before': 'Roots keep memory'
			}
		});
		const mystery = connection({
			kind: 'open_mystery',
			endpointIds: [w.aSeed.id, w.bSeed.id],
			factArtifactId: w.factId,
			approvedBy: 'f'
		});
		const r = completionReport({
			graph: w.graph,
			connections: [mystery],
			issues: [],
			audit: null,
			policy: 'coherent_open_mystery'
		});
		expect(r.motifSignals).toEqual([
			{ artifactId: w.id('B before'), signal: 'repeats Fact phrase verbatim' }
		]);
		expect(r.certifiable).toBe(true);
	});
});
