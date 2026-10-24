/**
 * Regression suite from docs/LIGHTHOUSE_V2_REVIEW.md ("Regression fixture suite").
 * Each fixture is a slice of `docs/samples/lighthouse-v2-annotated.md` reduced to the
 * state contracts its prose states; it tests DETECTION, not a particular rewrite.
 */
import type { AssertionInput, Relation, TransitionInput } from '@tlon/contracts';
import { Transition } from '@tlon/contracts';
import { describe, expect, it } from 'vitest';

import { type AnnotationLike, candidateIssues, validateContinuity } from '../src/index.ts';
import { acceptBridge, artifact, type MiniGraph, relation } from './fixtures.ts';

const project = {
	id: '00000000-0000-4000-8000-000000000001',
	name: 'v2',
	domain: 'NARRATIVE' as const,
	settings: { maxDepth: 5, maxCandidates: 3, maxNodesPerRun: 100, maxConcurrentJobs: 2 },
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString()
};
const s = (
	subject: string,
	predicate: string,
	value: string | number | boolean,
	extra: Partial<AssertionInput> = {}
): AssertionInput => ({ subject, predicate, value, ...extra });
const at = (h: number, m: number, day = 0) => ({ day, minute: h * 60 + m });

/**
 * Builds left anchor → bridges… → right anchor in story order (each new bridge splits
 * the last interval) and annotates beats by title.
 */
function sequence(
	leftAnchor: [string, TransitionInput],
	bridges: Array<[string, TransitionInput]>,
	rightAnchor: [string, TransitionInput],
	authors: { left?: 'A' | 'B'; right?: 'A' | 'B' } = {}
) {
	const left = artifact(leftAnchor[0], { creatorRole: authors.left ?? 'A' });
	const right = artifact(rightAnchor[0], { creatorRole: authors.right ?? 'B' });
	let tail: Relation = relation(left.id, right.id, { type: 'precedes' });
	const graph: MiniGraph = { artifacts: [left, right], relations: [tail], expansions: [] };
	for (const [title] of bridges) [, tail] = acceptBridge(graph, tail, title);
	const contracts = new Map<string, TransitionInput>([leftAnchor, ...bridges, rightAnchor]);
	const annotations = new Map<string, AnnotationLike>();
	for (const a of graph.artifacts) {
		const c = contracts.get(a.title);
		if (c)
			annotations.set(a.id, {
				artifactRevisionId: a.headRevisionId,
				transition: Transition.parse(c)
			});
	}
	const g = { ...graph, project };
	const id = (title: string) => graph.artifacts.find((a) => a.title === title)!.id;
	return { g, annotations, id, issues: validateContinuity(g, annotations).issues };
}

const kinds = (issues: Array<{ kind: string; severity: string }>) =>
	issues.map((i) => `${i.kind}/${i.severity}`);

describe('LIGHTHOUSE_V2_REVIEW regression fixtures', () => {
	it('V2-01: the call is hung up, the next beat continues the same call → FLAG', () => {
		const { issues, id } = sequence(
			[
				'#11 Odile goes down to the telephone',
				{
					effects: [s('charter_call', 'status', 'ringing')],
					events: ['charter_call.placed'],
					time: at(3, 30)
				}
			],
			[
				[
					'#12 the clerk refuses; Odile hangs up and wakes Ilse',
					{
						effects: [s('charter_call', 'status', 'ended'), s('ilse', 'awake', true)],
						events: ['charter_call.ends', 'ilse.wakes'],
						time: at(3, 33)
					}
				],
				[
					"#13 Odile doesn't hang up",
					{
						preconditions: [s('charter_call', 'status', 'connected')],
						effects: [s('charter_call', 'status', 'held_open')],
						time: at(3, 34)
					}
				]
			],
			['#15 Ilse reads the Notice', { preconditions: [s('ilse', 'awake', true)], time: at(3, 45) }]
		);
		const call = issues.find((i) => i.stateKey === 'charter_call.status');
		// #12 is #13's left anchor, so the join itself is broken.
		expect(call).toMatchObject({ kind: 'anchor_violation', severity: 'blocker' });
		expect(call?.artifactIds).toEqual([
			id('#12 the clerk refuses; Odile hangs up and wakes Ilse'),
			id("#13 Odile doesn't hang up")
		]);
	});

	it('V2-01b: the grandmother awakens twice without sleeping in between → FLAG', () => {
		const { issues } = sequence(
			['#11 phone rings', { effects: [s('ilse', 'awake', false)] }],
			[
				[
					'#12 Odile wakes Ilse by the shoulders',
					{ effects: [s('ilse', 'awake', true)], events: ['ilse.wakes'] }
				],
				['#14 Ilse opens her door', { effects: [s('ilse', 'location', 'landing')] }],
				[
					'#15 Odile wakes her grandmother',
					{ effects: [s('ilse', 'awake', true)], events: ['ilse.wakes'] }
				]
			],
			['#19 Ilse turns the lamp down', { preconditions: [s('ilse', 'awake', true)] }]
		);
		expect(issues.filter((i) => i.stateKey === 'event:ilse.wakes').map((i) => i.severity)).toEqual([
			'blocker'
		]);
	});

	it('V2-02: hover reserve 4 min at 03:59 and still 4 min at 04:07 → FLAG; a falling reserve passes', () => {
		const reserve = (minutes: number) =>
			s('thalassas_promise', 'hover_reserve', minutes, {
				unit: 'minutes',
				monotonic: 'decreasing'
			});
		const frozen = sequence(
			['#15 Ilse reads the Notice', { effects: [reserve(9)], time: at(3, 52) }],
			[
				['#16 the voice demands a station', { effects: [reserve(4)], time: at(3, 59) }],
				['#17 four minutes of hover left', { preconditions: [reserve(4)], time: at(4, 7) }]
			],
			['#19 Ilse turns the lamp down', { time: at(4, 10) }]
		);
		const frozenIssue = frozen.issues.find((i) => i.kind === 'monotonic_violation');
		expect(frozenIssue?.severity).toBe('blocker');
		expect(frozenIssue?.explanation).toMatch(/8 min pass/);
		const falling = sequence(
			['#15', { effects: [reserve(9)], time: at(3, 52) }],
			[
				['#16', { effects: [reserve(4)], time: at(3, 59) }],
				['#17', { preconditions: [reserve(1)], time: at(4, 2) }]
			],
			['#19', { time: at(4, 10) }]
		);
		expect(falling.issues.filter((i) => i.kind === 'monotonic_violation')).toEqual([]);
	});

	it('V2-03: pre-commitment dialogue placed after the committed landing → FLAG; a flashback is allowed', () => {
		const run = (outOfOrder: boolean) =>
			sequence(
				[
					'#19 Ilse turns the lamp down onto the frost',
					{
						effects: [s('thalassas_promise', 'landing', 'committed', { irreversible: true })],
						events: ['landing.commits'],
						time: at(4, 10)
					}
				],
				[['#20 a human voice asks whether it is water', { time: { ...at(4, 8), outOfOrder } }]],
				[
					'#21 Odile lights a berth on the salt',
					{ preconditions: [s('thalassas_promise', 'landing', 'committed')], time: at(4, 11) }
				],
				{ left: 'B', right: 'B' }
			).issues.filter((i) => i.kind === 'temporal_order');
		expect(kinds(run(false))).toEqual(['temporal_order/blocker']);
		expect(run(true)).toEqual([]);
	});

	it('V2-04: a ground flare becomes the gallery-rail berth lamp → FLAG', () => {
		const { issues } = sequence(
			[
				'#21 Odile plants a flare forty metres from the door',
				{
					effects: [
						s('flare_1', 'location', 'salt_40m_from_door'),
						s('odile', 'location', 'tower_door')
					]
				}
			],
			[
				[
					'#22 the tower shakes; Odile still at the berth lamp',
					{ preconditions: [s('flare_1', 'location', 'gallery_rail')] }
				]
			],
			[
				'#25 the ark skids to rest',
				{ preconditions: [s('flare_1', 'location', 'salt_40m_from_door')] }
			]
		);
		expect(issues.some((i) => i.stateKey === 'flare_1.location' && i.severity === 'blocker')).toBe(
			true
		);
	});

	it('V2-05: the spoon is gone with no transition after staying wedged → WARN (missing transition)', () => {
		const { issues } = sequence(
			['#25 the ark skids to rest', { effects: [s('soup_spoon', 'location', 'tilt_gear')] }],
			[
				[
					'#26 Ilse leaves the spoon in',
					{
						preconditions: [s('soup_spoon', 'location', 'tilt_gear')],
						effects: [s('lens', 'orientation', 'pointed_down')]
					}
				],
				[
					'#27a Doornik arrives at first light',
					{ effects: [s('doornik', 'location', 'lamp_room')] }
				],
				[
					'#27 what was left of the spoon when they let the gear go',
					{ preconditions: [s('soup_spoon', 'location', 'removed')] }
				]
			],
			['#30 ballast becomes the only sea', {}]
		);
		expect(kinds(issues.filter((i) => i.stateKey === 'soup_spoon.location'))).toEqual([
			'missing_transition/warning'
		]);
	});

	it('V2-06: a bridge that leads straight into a next-day anchor → WARN', () => {
		const { issues } = sequence(
			['#28 the ark votes at eleven', { time: at(11, 0) }],
			[['#29 Doornik reaches the valve as noon comes up', { time: at(11, 55) }]],
			['#30 the following day, noon to dusk', { time: at(12, 0, 1) }],
			{ left: 'B', right: 'B' }
		);
		expect(kinds(issues.filter((i) => i.kind === 'temporal_order'))).toEqual([
			'temporal_order/warning'
		]);
	});

	it('CREATIVE-01: the coaster name reconciled with the ark autopilot identity → ALLOW', () => {
		const { issues } = sequence(
			[
				'#6 mayday from the coaster Margarethe Holm',
				{ effects: [s('caller', 'identity', 'margarethe_holm')] }
			],
			[
				[
					'#15 the ark flies a coaster autopilot that still answers to her name',
					{
						preconditions: [s('caller', 'identity', 'margarethe_holm')],
						effects: [s('caller', 'vessel', 'thalassas_promise')]
					}
				]
			],
			[
				"#19 the ark Thalassa's Promise",
				{ preconditions: [s('caller', 'vessel', 'thalassas_promise')] }
			],
			{ left: 'A', right: 'B' }
		);
		expect(issues.filter((i) => i.severity === 'blocker')).toEqual([]);
	});

	it('CREATIVE-02: no sea at first, water released into the basin at the end → ALLOW (state change, not contradiction)', () => {
		const { issues } = sequence(
			['#1 the light burns over a sea that never came', { effects: [s('basin', 'water', false)] }],
			[
				[
					'#29 the ballast valve opens',
					{
						preconditions: [s('basin', 'water', false)],
						effects: [s('basin', 'water', true)],
						events: ['ballast.released']
					}
				]
			],
			['#30 ballast becomes the only sea', { preconditions: [s('basin', 'water', true)] }],
			{ left: 'A', right: 'B' }
		);
		expect(issues).toEqual([]);
	});

	it('CREATIVE-03: different characters hold incompatible beliefs → ALLOW (perspective info)', () => {
		const { issues } = sequence(
			[
				'#13',
				{ effects: [s('vessel', 'floating', true, { epistemic: 'belief', holder: 'clerk' })] }
			],
			[
				[
					'#14',
					{ effects: [s('vessel', 'floating', false, { epistemic: 'belief', holder: 'odile' })] }
				]
			],
			['#15', {}]
		);
		expect(kinds(issues)).toEqual(['perspective_conflict/info']);
	});

	it('IMMUTABLE-01: a candidate that overwrites the authored landing outcome → REJECT at the gate', () => {
		const { g, annotations, id } = sequence(
			['#21 berth lit', { effects: [s('thalassas_promise', 'approach', 'final_skim')] }],
			[],
			[
				'#25 the ark skids to rest forty metres from the tower',
				{
					preconditions: [s('thalassas_promise', 'approach', 'final_skim')],
					effects: [
						s('thalassas_promise', 'rest_position', 'forty_m_from_tower', { irreversible: true })
					],
					events: ['ark.comes_to_rest']
				}
			],
			{ left: 'B', right: 'B' }
		);
		const c = artifact('candidate: the ark stops at the harbour wall', {
			kind: 'BRIDGE',
			creatorRole: 'C',
			status: 'PROPOSED'
		});
		g.artifacts.push(c);
		const root = g.relations[0]!;
		const expansionId = '00000000-0000-4000-8000-0000000000aa';
		g.expansions.push({
			...g.expansions[0]!,
			id: expansionId,
			targetRelationId: root.id,
			leftArtifactId: id('#21 berth lit'),
			rightArtifactId: id('#25 the ark skids to rest forty metres from the tower'),
			status: 'REVIEW',
			selectedBridgeArtifactId: null,
			bridgeArtifactIds: [c.id],
			depth: 1,
			parentExpansionId: null
		} as MiniGraph['expansions'][number]);
		const added = candidateIssues(g, annotations, {
			expansionId,
			artifactId: c.id,
			transition: Transition.parse({
				effects: [s('thalassas_promise', 'rest_position', 'harbour_wall', { irreversible: true })],
				events: ['ark.comes_to_rest']
			})
		});
		expect(added.some((i) => i.severity === 'blocker' && i.kind === 'anchor_violation')).toBe(true);
	});
});
