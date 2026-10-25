import type {
	Assertion,
	BeatTime,
	IssueKind,
	ProjectGraph,
	Provenance,
	Transition,
	Triangle,
	ValidationIssue
} from '@tlon/contracts';

import { compareBeatTime, type TimeComparison } from './chronology.ts';
import { entityRegistry, nameVariants } from './entities.ts';
import { activeTriangles, type StoryBeat, storyBeats } from './story.ts';
import { detectTensions } from './tensions.ts';

type GraphLike = Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'> &
	Partial<Pick<ProjectGraph, 'composites'>> & { triangles?: readonly Triangle[] };

/** Private side of an artifact's owner scope; everything else replays as one shared chain. */
const SIDE_OF_SCOPE: Record<string, 'A' | 'B'> = { A_PRIVATE: 'A', B_PRIVATE: 'B' };

export type AnnotationLike = { artifactRevisionId: string; transition: Transition };

/** A bridge candidate evaluated as if it were accepted (before commit). */
export type CandidateUnderReview = {
	expansionId: string;
	artifactId: string;
	transition: Transition;
};

export type ValidationResult = {
	issues: Array<Omit<ValidationIssue, 'dismissal'>>;
	/** Ordered artifact ids the replay walked (the committed reading path). */
	path: string[];
	unannotatedArtifactIds: string[];
};

const stateKey = (a: Pick<Assertion, 'subject' | 'predicate'>) => `${a.subject}.${a.predicate}`;

export function issueKey(
	kind: IssueKind,
	artifactIds: readonly string[],
	key: string | null
): string {
	return `${kind}:${key ?? ''}:${[...artifactIds].sort().join(',')}`;
}

type Holder = { value: Assertion['value']; artifactId: string; irreversible: boolean };

/**
 * Kinship is recorded person-centrically as single-valued timeless assertions
 * `subject=<person id>, predicate=<one of these>, value=<relative's person id>`
 * ("Yakov's mother is Rivka" → `yakov.mother = rivka`). Children and siblings are
 * expressed through the child's own `mother`/`father` keys, so no key is multi-valued.
 */
export const KINSHIP_PREDICATES = [
	'mother',
	'father',
	'wife',
	'husband',
	'fiance',
	'fiancee'
] as const;

/** One person may legitimately hold both of these toward the same relative (engaged, then married). */
const COMPATIBLE_KINSHIP: readonly (readonly string[])[] = [
	['fiancee', 'wife'],
	['fiance', 'husband']
];

type KinshipClaim = { subject: string; predicate: string; target: string; artifactId: string };

/** Keys of `assertions` stated with more than one distinct value, with those values. */
function conflictingKeys(assertions: readonly Assertion[]): Map<string, Assertion['value'][]> {
	const byKey = new Map<string, Assertion['value'][]>();
	for (const a of assertions) {
		const values = byKey.get(stateKey(a)) ?? [];
		if (!values.includes(a.value)) values.push(a.value);
		byKey.set(stateKey(a), values);
	}
	return new Map([...byKey].filter(([, values]) => values.length > 1));
}

/**
 * Replays world-state transitions along the committed reading path (story order)
 * and classifies conflicts (GENERATION_REVIEW "core semantic rule"):
 *  - two independently authored anchors disagreeing → `tension` (creative input, info);
 *  - a bridge disagreeing with its own anchor, or consuming the right anchor's
 *    irreversible event → `anchor_violation` (blocker);
 *  - any other committed/proposed pair needing incompatible states, or an irreversible
 *    event happening twice → `continuity_violation` (blocker);
 *  - beliefs/rumours never break the path; differing holders → `perspective_conflict`.
 * Deterministic and conservative: it only sees what annotations state. Prose without
 * an annotation is reported as unannotated, never guessed at.
 */
export function validateContinuity(
	graph: GraphLike,
	annotations: ReadonlyMap<string, AnnotationLike>,
	candidate?: CandidateUnderReview
): ValidationResult {
	const hypothetical = candidate
		? {
				...graph,
				expansions: graph.expansions.map((e) =>
					e.id === candidate.expansionId
						? { ...e, status: 'ACCEPTED' as const, selectedBridgeArtifactId: candidate.artifactId }
						: e
				)
			}
		: graph;
	const beats = storyBeats(hypothetical);
	const artifacts = new Map(graph.artifacts.map((a) => [a.id, a]));
	const bridgeOf = new Map(
		hypothetical.expansions
			.filter((e) => e.status === 'ACCEPTED' && e.selectedBridgeArtifactId !== null)
			.map((e) => [e.selectedBridgeArtifactId as string, e])
	);
	const provenance = (id: string): Provenance =>
		candidate?.artifactId === id
			? 'proposal'
			: bridgeOf.has(id)
				? 'committed_generated'
				: 'canonical_anchor';
	const transitionOf = (id: string): Transition | undefined =>
		candidate?.artifactId === id ? candidate.transition : annotations.get(id)?.transition;
	const isAnchorPair = (bridgeId: string, otherId: string) => {
		const e = bridgeOf.get(bridgeId);
		return e !== undefined && (e.leftArtifactId === otherId || e.rightArtifactId === otherId);
	};

	const issues: ValidationResult['issues'] = [];
	const push = (
		kind: IssueKind,
		severity: ValidationIssue['severity'],
		ids: string[],
		key: string | null,
		explanation: string,
		suggestedAction: ValidationIssue['suggestedAction']
	) => {
		const k = issueKey(kind, ids, key);
		if (!issues.some((i) => i.key === k)) {
			issues.push({
				key: k,
				kind,
				severity,
				artifactIds: ids,
				stateKey: key,
				explanation,
				suggestedAction,
				source: 'replay',
				evidence: []
			});
		}
	};
	const title = (id: string) => `“${artifacts.get(id)?.title ?? id}”`;
	/**
	 * Block–Fact continuations can lie years apart, so neighbours on a side chain are not
	 * contiguous moments: a state change between them is a missing transition unless both
	 * state the same story day (and year), and chronology is judged per triangle
	 * (`direction_mismatch`), not by the reading order.
	 */
	const blockFact = activeTriangles(graph.triangles).length > 0;
	const sameMoment = (aId: string, bId: string) => {
		const a = transitionOf(aId)?.time;
		const b = transitionOf(bId)?.time;
		return (
			a?.day !== undefined &&
			a.day === b?.day &&
			a.year === b.year &&
			!a.outOfOrder &&
			!b.outOfOrder
		);
	};

	/** Path position within the chain being replayed: adjacency and gaps are judged on it. */
	let position = new Map<string, number>();
	const gapBetween = (earlierId: string, laterId: string) =>
		(position.get(laterId) ?? 0) - (position.get(earlierId) ?? 0) - 1;

	/** Classifies a state clash between an earlier holder and the current beat. */
	const clash = (earlierId: string, laterId: string, key: string, detail: string, hard = false) => {
		const pe = provenance(earlierId);
		const pl = provenance(laterId);
		const ea = artifacts.get(earlierId);
		const la = artifacts.get(laterId);
		if (
			pe === 'canonical_anchor' &&
			pl === 'canonical_anchor' &&
			ea?.creatorRole !== la?.creatorRole
		) {
			push(
				'tension',
				'info',
				[earlierId, laterId],
				key,
				`Independent sources disagree on ${key}: ${detail}. A bridge can reconcile this.`,
				'request_c_resolution'
			);
			return;
		}
		if (isAnchorPair(laterId, earlierId) || isAnchorPair(earlierId, laterId)) {
			push(
				'anchor_violation',
				'blocker',
				[earlierId, laterId],
				key,
				`Bridge breaks its anchor contract on ${key}: ${detail}.`,
				'revise_bridge'
			);
			return;
		}
		const gap = gapBetween(earlierId, laterId);
		if (!hard && (gap > 0 || (blockFact && !sameMoment(earlierId, laterId)))) {
			// Beats in between could have changed it without saying so: a missing transition,
			// not proof of contradiction (GENERATION_REVIEW V2-05).
			push(
				'missing_transition',
				'warning',
				[earlierId, laterId],
				key,
				gap > 0
					? `${title(laterId)} needs ${key} different from what ${title(earlierId)} left, and none of the ${gap} beat(s) between narrates the change: ${detail}.`
					: `${title(laterId)} needs ${key} different from what ${title(earlierId)} left; the two Blocks are not stated to be the same moment, so the change may have happened off-page: ${detail}.`,
				'revise_bridge'
			);
			return;
		}
		push(
			'continuity_violation',
			'blocker',
			[earlierId, laterId],
			key,
			`${title(laterId)} needs ${key} incompatible with ${title(earlierId)}: ${detail}.`,
			'revise_bridge'
		);
	};

	const unannotated: string[] = [];
	const paths: string[][] = [];

	/**
	 * Replays one reading chain. Legacy projects have a single chain (the whole story);
	 * Block–Fact projects replay A's and B's chains separately (independent worlds joined
	 * only by Facts), so cross-side state differences never raise issues.
	 */
	const replayChain = (chain: readonly StoryBeat[]) => {
		position = new Map(chain.map((b, i) => [b.artifact.id, i]));
		// ── story time ───────────────────────────────────────────────────────────
		/** Minutes since the story's day 0; days missing on a beat are inherited from the last stated day. */
		let lastTime: {
			abs: number;
			tolerance: number;
			artifactId: string;
			dayStated: boolean;
			year: number | undefined;
		} | null = null;
		let lastDay: number | null = null;
		let lastYear: { year: number; tolerance: number; artifactId: string } | null = null;
		const absTime = (artifactId: string, t: Transition) => {
			const time = t.time;
			if (!time || time.outOfOrder || time.minute === undefined) {
				if (time?.day !== undefined && !time.outOfOrder) lastDay = time.day;
				return null;
			}
			const dayStated = time.day !== undefined;
			const day = time.day ?? lastDay ?? 0;
			lastDay = day;
			return {
				abs: day * 1440 + time.minute,
				tolerance: time.approx ? time.toleranceMinutes : 0,
				artifactId,
				dayStated,
				year: time.year
			};
		};
		const checkTime = (artifactId: string, t: Transition) => {
			const time = t.time;
			if (blockFact) {
				// Chronology of Block–Fact chains is checked per triangle (direction_mismatch);
				// keep a comparable instant only for same-day monotonic checks.
				return time?.day !== undefined && time.minute !== undefined && !time.outOfOrder
					? (time.year ?? 0) * 527_040 + time.day * 1440 + time.minute
					: null;
			}
			if (time?.year !== undefined && !time.outOfOrder) {
				// `approx` widens a year by ±1; `relative`-only beats never reach this point.
				const tolerance = time.yearApprox ? 1 : 0;
				if (lastYear && time.year + tolerance + lastYear.tolerance < lastYear.year) {
					push(
						'temporal_order',
						'warning',
						[lastYear.artifactId, artifactId],
						null,
						`${title(artifactId)} is dated ${time.year}, earlier than ${title(lastYear.artifactId)} (${lastYear.year}), which it follows in this chain; if it is a flashback, mark it out of order.`,
						'mark_intentional'
					);
				}
				lastYear = { year: time.year, tolerance, artifactId };
			}
			const now = absTime(artifactId, t);
			if (!now) return null;
			// Day/minute only compare within one year: when both state different years the year decides.
			const comparable =
				!lastTime ||
				lastTime.year === undefined ||
				now.year === undefined ||
				lastTime.year === now.year;
			const prev = comparable ? lastTime : null;
			if (prev && now.abs + now.tolerance + prev.tolerance < prev.abs) {
				const back = prev.abs - now.abs;
				// Both days stated (or a step back under 12 h): the beat is out of order.
				// Otherwise it may silently cross midnight, so ask for the day instead.
				const certain = (now.dayStated && prev.dayStated) || back < 12 * 60;
				push(
					'temporal_order',
					certain ? 'blocker' : 'warning',
					[prev.artifactId, artifactId],
					null,
					certain
						? `${title(artifactId)} happens ${back} min before ${title(prev.artifactId)} but follows it in the story (mark it as a flashback or move the event).`
						: `${title(artifactId)} reads as earlier than ${title(prev.artifactId)}; if it is the next day, state the day.`,
					'revise_bridge'
				);
			}
			const bridge = bridgeOf.get(artifactId);
			if (
				prev &&
				bridge &&
				bridge.leftArtifactId === prev.artifactId &&
				now.abs - prev.abs > 6 * 60
			) {
				push(
					'temporal_order',
					'warning',
					[prev.artifactId, artifactId],
					null,
					`${title(artifactId)} starts ${Math.round((now.abs - prev.abs) / 60)} h after its left anchor without narrating the interval.`,
					'revise_bridge'
				);
			}
			if (prev) {
				const prevBridge = bridgeOf.get(prev.artifactId);
				if (
					prevBridge &&
					prevBridge.rightArtifactId === artifactId &&
					now.abs - prev.abs > 6 * 60
				) {
					push(
						'temporal_order',
						'warning',
						[prev.artifactId, artifactId],
						null,
						`${title(prev.artifactId)} is written as leading straight into ${title(artifactId)}, but ${Math.round((now.abs - prev.abs) / 60)} h pass between them; establish the interval (e.g. the night) in the bridge.`,
						'revise_bridge'
					);
				}
			}
			lastTime = now;
			return comparable ? now.abs : null;
		};

		// ── unique events and one-way quantities ────────────────────────────────
		const eventsDone = new Map<string, string>();
		type Reading = {
			value: number;
			unit: string | undefined;
			at: number | null;
			artifactId: string;
		};
		const readings = new Map<string, Reading>();
		const checkMonotonic = (a: Assertion, artifactId: string, at: number | null) => {
			if (typeof a.value !== 'number' || a.epistemic !== 'world') return;
			const key = stateKey(a);
			const prev = readings.get(key);
			const mode = a.monotonic;
			if (prev && mode && prev.unit === a.unit) {
				const up = a.value > prev.value;
				const same = a.value === prev.value;
				const timePassed = prev.at !== null && at !== null && at > prev.at;
				const wrong =
					((mode === 'decreasing' || mode === 'non_increasing') && up) ||
					((mode === 'increasing' || mode === 'non_decreasing') && a.value < prev.value) ||
					((mode === 'decreasing' || mode === 'increasing') && same && timePassed);
				if (wrong) {
					const unit = a.unit ? ` ${a.unit}` : '';
					const gap = gapBetween(prev.artifactId, artifactId);
					const base = same
						? `${key} stays at ${a.value}${unit} from ${title(prev.artifactId)} to ${title(artifactId)} while ${at! - prev.at!} min pass; a ${mode} quantity cannot freeze unexplained.`
						: `${key} goes from ${prev.value} to ${a.value}${unit} (${title(prev.artifactId)} → ${title(artifactId)}), but it is ${mode}.`;
					push(
						'monotonic_violation',
						// Across unnarrated beats a refill/reset may have happened off-page: warn.
						gap > 0 ? 'warning' : 'blocker',
						[prev.artifactId, artifactId],
						key,
						gap > 0 ? `${base} None of the ${gap} beat(s) between explains it.` : base,
						'revise_bridge'
					);
				}
			}
			readings.set(key, { value: a.value, unit: a.unit, at, artifactId });
		};

		const world = new Map<string, Holder>();
		const irreversibleDone = new Map<string, Holder>();
		const beliefs = new Map<
			string,
			Array<{ value: Assertion['value']; holder: string; artifactId: string }>
		>();
		const preparations = new Map<string, string>();
		const path = chain.map((b) => b.artifact.id);
		paths.push(path);
		// Timeless facts are checked per chain against the first value stated for each key.
		const timelessRef = new Map<string, { value: Assertion['value']; artifactId: string }>();
		const kinship: KinshipClaim[] = [];

		for (const { artifact } of chain) {
			const t = transitionOf(artifact.id);
			if (!t) {
				unannotated.push(artifact.id);
				continue;
			}
			const at = checkTime(artifact.id, t);
			for (const event of t.events) {
				const first = eventsDone.get(event);
				if (first !== undefined) {
					clash(
						first,
						artifact.id,
						`event:${event}`,
						`${event} already happened in ${title(first)}`,
						true
					);
				} else {
					eventsDone.set(event, artifact.id);
				}
			}
			// One Block stating a key as several values is ambiguous: it neither sets state nor is checked.
			const worldEffects = t.effects.filter((a) => a.epistemic === 'world' && !a.timeless);
			const worldPreconditions = t.preconditions.filter(
				(a) => a.epistemic === 'world' && !a.timeless
			);
			const timelessHere = [...t.preconditions, ...t.effects, ...t.assumptions].filter(
				(a) => a.epistemic === 'world' && a.timeless
			);
			const ambiguous = new Set<string>();
			for (const [where, list] of [
				['effects', worldEffects],
				['preconditions', worldPreconditions],
				['timeless assertions', timelessHere]
			] as const) {
				for (const [key, values] of conflictingKeys(list)) {
					ambiguous.add(key);
					push(
						'annotation_conflict',
						'info',
						[artifact.id],
						key,
						`${title(artifact.id)} states ${key} as ${values.map(String).join(' and ')} within its ${where}; the annotation is ambiguous there, so ${key} neither sets state nor is checked. This is the shape of the annotation, not the story.`,
						'keep_as_is'
					);
				}
			}
			const seenTimeless = new Set<string>();
			for (const a of timelessHere) {
				const key = stateKey(a);
				if (ambiguous.has(key) || seenTimeless.has(key)) continue;
				seenTimeless.add(key);
				if (KINSHIP_PREDICATES.some((p) => p === a.predicate) && typeof a.value === 'string') {
					kinship.push({
						subject: a.subject,
						predicate: a.predicate,
						target: a.value,
						artifactId: artifact.id
					});
				}
				const reference = timelessRef.get(key);
				if (!reference) {
					timelessRef.set(key, { value: a.value, artifactId: artifact.id });
					continue;
				}
				if (reference.value === a.value) continue;
				if (
					!blockFact &&
					provenance(reference.artifactId) === 'canonical_anchor' &&
					provenance(artifact.id) === 'canonical_anchor' &&
					artifacts.get(reference.artifactId)?.creatorRole !== artifact.creatorRole
				) {
					push(
						'tension',
						'info',
						[reference.artifactId, artifact.id],
						key,
						`Independent sources disagree on ${key}: ${String(reference.value)} in ${title(reference.artifactId)} but ${String(a.value)} in ${title(artifact.id)}. A bridge can reconcile this.`,
						'request_c_resolution'
					);
					continue;
				}
				push(
					'fact_conflict',
					'blocker',
					[reference.artifactId, artifact.id],
					key,
					`${key} is ${String(reference.value)} in ${title(reference.artifactId)} but ${String(a.value)} in ${title(artifact.id)}. Identity, kinship, authorship and the date or place of a past event cannot change off-page, however far apart the Blocks are.`,
					'revise_bridge'
				);
			}
			for (const a of [...t.preconditions, ...t.effects]) {
				if (!a.timeless && !ambiguous.has(stateKey(a))) checkMonotonic(a, artifact.id, at);
			}
			const ann = annotations.get(artifact.id);
			if (
				ann &&
				candidate?.artifactId !== artifact.id &&
				ann.artifactRevisionId !== artifact.headRevisionId
			) {
				push(
					'stale_annotation',
					'warning',
					[artifact.id],
					null,
					`State annotation of ${title(artifact.id)} describes an older revision.`,
					'keep_as_is'
				);
			}
			for (const pre of t.preconditions) {
				const key = stateKey(pre);
				if (pre.epistemic !== 'world' || pre.timeless || ambiguous.has(key)) continue;
				preparations.delete(key);
				const cur = world.get(key);
				if (cur && cur.value !== pre.value) {
					clash(
						cur.artifactId,
						artifact.id,
						key,
						`expects ${String(pre.value)}, but ${title(cur.artifactId)} left it ${String(cur.value)}`
					);
				}
			}
			for (const eff of t.effects) {
				const key = stateKey(eff);
				if (eff.epistemic !== 'world') {
					const list = beliefs.get(key) ?? [];
					const holder = eff.holder ?? '(unspecified)';
					for (const other of list) {
						if (other.value !== eff.value && other.holder !== holder) {
							push(
								'perspective_conflict',
								'info',
								[other.artifactId, artifact.id],
								key,
								`${other.holder} and ${holder} hold different views on ${key}.`,
								'mark_intentional'
							);
						}
					}
					list.push({ value: eff.value, holder, artifactId: artifact.id });
					beliefs.set(key, list);
					continue;
				}
				if (eff.timeless) continue;
				if (ambiguous.has(key)) {
					// Which value holds afterwards is unknown: forget the earlier holder.
					world.delete(key);
					preparations.delete(key);
					continue;
				}
				const done = irreversibleDone.get(key);
				if (eff.irreversible && done && done.value === eff.value) {
					clash(
						done.artifactId,
						artifact.id,
						key,
						`the irreversible change to ${String(eff.value)} already happened in ${title(done.artifactId)}`,
						true
					);
				}
				if (eff.irreversible)
					irreversibleDone.set(key, {
						value: eff.value,
						artifactId: artifact.id,
						irreversible: true
					});
				if (preparations.has(key) && preparations.get(key) !== artifact.id)
					preparations.delete(key);
				if (eff.preparation) preparations.set(key, artifact.id);
				world.set(key, {
					value: eff.value,
					artifactId: artifact.id,
					irreversible: eff.irreversible
				});
			}
			if (
				provenance(artifact.id) !== 'canonical_anchor' &&
				t.effects.length === 0 &&
				t.assumptions.length === 0
			) {
				push(
					'redundancy',
					'info',
					[artifact.id],
					null,
					`${title(artifact.id)} changes no state and adds no fact; this interval may already have sufficient detail.`,
					'stop_expansion'
				);
			}
		}
		for (const [key, artifactId] of preparations) {
			if (path.indexOf(artifactId) < path.length - 1) {
				push(
					'abandoned_preparation',
					'warning',
					[artifactId],
					key,
					`${title(artifactId)} prepares ${key}, but no later beat uses or explains it.`,
					'request_c_resolution'
				);
			}
		}

		// ── identity: name variants must not carry incompatible kinship toward one person ──
		const chainEntities = new Map(
			entityRegistry(
				chain.flatMap((b) => {
					const transition = transitionOf(b.artifact.id);
					return transition ? [{ artifactId: b.artifact.id, transition }] : [];
				})
			).map((entity) => [entity.id, entity])
		);
		const nameOf = (id: string) => chainEntities.get(id)?.name ?? id;
		for (const [i, first] of kinship.entries()) {
			for (const second of kinship.slice(i + 1)) {
				if (first.subject !== second.subject || first.predicate === second.predicate) continue;
				if (
					COMPATIBLE_KINSHIP.some(
						(pair) => pair.includes(first.predicate) && pair.includes(second.predicate)
					)
				) {
					continue;
				}
				const a = chainEntities.get(first.target);
				const b = chainEntities.get(second.target);
				if (first.target !== second.target && !(a && b && nameVariants(a, b))) continue;
				const claims = [first, second].map((c) => `${c.subject}.${c.predicate}`).toSorted();
				push(
					'identity_conflict',
					'warning',
					[...new Set([first.artifactId, second.artifactId])],
					claims.join('|'),
					`“${nameOf(first.subject)}” (${first.subject}) has ${first.predicate} “${nameOf(first.target)}” (${first.target}) in ${title(first.artifactId)} but ${second.predicate} “${nameOf(second.target)}” (${second.target}) in ${title(second.artifactId)}. ${first.target === second.target ? 'One person cannot hold both roles toward the same person.' : 'The two names look like variants of one person, who would then hold both roles; either the text is inconsistent or two characters share a near-identical name.'} They are kept as distinct entities and never merged.`,
					'revise_bridge'
				);
			}
		}
	};

	const liveTriangles = activeTriangles(graph.triangles);
	const chains =
		liveTriangles.length === 0
			? [beats]
			: (['A', 'B', 'other'] as const)
					.map((side) =>
						beats.filter((b) => (SIDE_OF_SCOPE[b.artifact.ownerScope] ?? 'other') === side)
					)
					.filter((chain) => chain.length > 0);
	for (const chain of chains) replayChain(chain);

	// ── Block–Fact: a continuation must not contradict the direction it was asked to write in ──
	const describeTime = (time: BeatTime, component: TimeComparison['component']) => {
		const two = (n: number | undefined) => String(n).padStart(2, '0');
		if (component === 'year') return `year ${time.year}`;
		if (component === 'month') return `${time.year}-${two(time.month)}`;
		if (component === 'dayOfMonth')
			return `${time.year}-${two(time.month)}-${two(time.dayOfMonth)}`;
		if (component === 'day') return `day ${time.day}`;
		const minute = time.minute ?? 0;
		const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
		return time.day === undefined ? clock : `day ${time.day}, ${clock}`;
	};
	for (const triangle of liveTriangles) {
		const advance = triangle.advance ?? { left: 'forward', right: 'backward' };
		for (const continuation of triangle.continuations) {
			const direction = advance[continuation.side];
			if (direction === 'atemporal') continue;
			const anchorId = triangle[continuation.side].artifactId;
			const blockId = continuation.block.artifactId;
			const blockTime = transitionOf(blockId)?.time;
			const anchorTime = transitionOf(anchorId)?.time;
			if (!blockTime || !anchorTime || blockTime.outOfOrder || anchorTime.outOfOrder) continue;
			const compared = compareBeatTime(blockTime, anchorTime);
			if (!compared || compared.delta === 0) continue;
			const wrong = direction === 'backward' ? compared.delta > 0 : compared.delta < 0;
			if (!wrong) continue;
			push(
				'direction_mismatch',
				'warning',
				[blockId, anchorId],
				null,
				`${title(blockId)} is written ${direction} from its anchor ${title(anchorId)} but is dated ${direction === 'backward' ? 'later' : 'earlier'} (${describeTime(blockTime, compared.component)} vs ${describeTime(anchorTime, compared.component)}).`,
				'revise_bridge'
			);
		}
	}

	// ── identity: same-looking names are flagged, never merged ──
	const registry = entityRegistry(
		beats.flatMap((b) => {
			const transition = transitionOf(b.artifact.id);
			return transition ? [{ artifactId: b.artifact.id, transition }] : [];
		})
	);
	const names = registry.map((entity) => ({
		entity,
		forms: [entity.name, ...entity.aliases].map((name) => {
			const full = name.trim().toLowerCase();
			return { full, first: full.split(/\s+/)[0] ?? full };
		})
	}));
	for (const [i, a] of names.entries()) {
		for (const b of names.slice(i + 1)) {
			const bothPeople = a.entity.kind === 'person' && b.entity.kind === 'person';
			const alike = a.forms.some((fa) =>
				b.forms.some(
					(fb) =>
						fa.full === fb.full ||
						fa.first === fb.full ||
						fb.first === fa.full ||
						(bothPeople && fa.first === fb.first)
				)
			);
			if (!alike) continue;
			const ids = [...new Set([a.entity.artifactIds[0], b.entity.artifactIds[0]])].filter(
				(id): id is string => id !== undefined
			);
			const describe = (e: (typeof registry)[number]) =>
				`“${e.name}” (${e.id}${e.distinguishing ? `, ${e.distinguishing}` : ''})`;
			push(
				'ambiguous_entity',
				'info',
				ids,
				[a.entity.id, b.entity.id].toSorted().join('|'),
				`${describe(a.entity)} and ${describe(b.entity)} look alike by name but have different ids; they are kept as distinct entities and never merged.`,
				'keep_as_is'
			);
		}
	}

	for (const t of detectTensions(graph)) {
		if (t.resolvedByExpansionId === null) {
			push(
				'tension',
				'info',
				[...t.artifactIds],
				null,
				'Unresolved contradiction between independent sources — creative input, not an error.',
				'request_c_resolution'
			);
		}
	}
	return { issues, path: paths.flat(), unannotatedArtifactIds: unannotated };
}

/** Issues a candidate would ADD to the committed path (used as the accept gate). */
export function candidateIssues(
	graph: GraphLike,
	annotations: ReadonlyMap<string, AnnotationLike>,
	candidate: CandidateUnderReview
): ValidationResult['issues'] {
	const before = new Set(validateContinuity(graph, annotations).issues.map((i) => i.key));
	return validateContinuity(graph, annotations, candidate).issues.filter((i) => !before.has(i.key));
}
