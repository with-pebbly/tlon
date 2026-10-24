import type {
	Assertion,
	IssueKind,
	ProjectGraph,
	Provenance,
	Transition,
	ValidationIssue
} from '@tlon/contracts';

import { storyBeats } from './story.ts';
import { detectTensions } from './tensions.ts';

type GraphLike = Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'> &
	Partial<Pick<ProjectGraph, 'composites'>>;

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
				suggestedAction
			});
		}
	};
	const title = (id: string) => `“${artifacts.get(id)?.title ?? id}”`;

	/** Path position of every beat (annotated or not): adjacency and gaps are judged on it. */
	const position = new Map(beats.map((b, i) => [b.artifact.id, i]));
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
		if (!hard && gap > 0) {
			// Beats in between could have changed it without saying so: a missing transition,
			// not proof of contradiction (GENERATION_REVIEW V2-05).
			push(
				'missing_transition',
				'warning',
				[earlierId, laterId],
				key,
				`${title(laterId)} needs ${key} different from what ${title(earlierId)} left, and none of the ${gap} beat(s) between narrates the change: ${detail}.`,
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

	// ── story time ───────────────────────────────────────────────────────────
	/** Minutes since the story's day 0; days missing on a beat are inherited from the last stated day. */
	let lastTime: { abs: number; tolerance: number; artifactId: string; dayStated: boolean } | null =
		null;
	let lastDay: number | null = null;
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
			dayStated
		};
	};
	const checkTime = (artifactId: string, t: Transition) => {
		const now = absTime(artifactId, t);
		if (!now) return null;
		if (lastTime && now.abs + now.tolerance + lastTime.tolerance < lastTime.abs) {
			const back = lastTime.abs - now.abs;
			// Both days stated (or a step back under 12 h): the beat is out of order.
			// Otherwise it may silently cross midnight, so ask for the day instead.
			const certain = (now.dayStated && lastTime.dayStated) || back < 12 * 60;
			push(
				'temporal_order',
				certain ? 'blocker' : 'warning',
				[lastTime.artifactId, artifactId],
				null,
				certain
					? `${title(artifactId)} happens ${back} min before ${title(lastTime.artifactId)} but follows it in the story (mark it as a flashback or move the event).`
					: `${title(artifactId)} reads as earlier than ${title(lastTime.artifactId)}; if it is the next day, state the day.`,
				'revise_bridge'
			);
		}
		const bridge = bridgeOf.get(artifactId);
		if (
			lastTime &&
			bridge &&
			bridge.leftArtifactId === lastTime.artifactId &&
			now.abs - lastTime.abs > 6 * 60
		) {
			push(
				'temporal_order',
				'warning',
				[lastTime.artifactId, artifactId],
				null,
				`${title(artifactId)} starts ${Math.round((now.abs - lastTime.abs) / 60)} h after its left anchor without narrating the interval.`,
				'revise_bridge'
			);
		}
		if (lastTime) {
			const prevBridge = bridgeOf.get(lastTime.artifactId);
			if (
				prevBridge &&
				prevBridge.rightArtifactId === artifactId &&
				now.abs - lastTime.abs > 6 * 60
			) {
				push(
					'temporal_order',
					'warning',
					[lastTime.artifactId, artifactId],
					null,
					`${title(lastTime.artifactId)} is written as leading straight into ${title(artifactId)}, but ${Math.round((now.abs - lastTime.abs) / 60)} h pass between them; establish the interval (e.g. the night) in the bridge.`,
					'revise_bridge'
				);
			}
		}
		lastTime = now;
		return now.abs;
	};

	// ── unique events and one-way quantities ────────────────────────────────
	const eventsDone = new Map<string, string>();
	type Reading = { value: number; unit: string | undefined; at: number | null; artifactId: string };
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
	const unannotated: string[] = [];
	const path = beats.map((b) => b.artifact.id);

	for (const { artifact } of beats) {
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
		for (const a of [...t.preconditions, ...t.effects]) checkMonotonic(a, artifact.id, at);
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
			if (pre.epistemic !== 'world') continue;
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
			if (preparations.has(key) && preparations.get(key) !== artifact.id) preparations.delete(key);
			if (eff.preparation) preparations.set(key, artifact.id);
			world.set(key, { value: eff.value, artifactId: artifact.id, irreversible: eff.irreversible });
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
	return { issues, path, unannotatedArtifactIds: unannotated };
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
