import { z } from 'zod';

import { Uuid } from './models.ts';

const IsoDate = z.iso.datetime({ offset: true });
const Key = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.regex(/^[a-z0-9_.:-]+$/, 'lower_snake identifiers joined by dots, e.g. mercury_bath.level');

/**
 * Canonical state token: lower_snake, so "FULL", "Full " and "full" compare equal.
 * Values are meant to be short enumerations (`full`, `falling`, `open`); prose detail
 * belongs in `note`, otherwise "uncapped" and "uncapped, on the rail" read as a clash.
 */
export const canonicalStateValue = (raw: string): string =>
	raw
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 60) || '_';

/**
 * One state claim of a beat (GENERATION_REVIEW "NarrativeAssertion"). `subject` +
 * `predicate` form the state key; only `world` assertions drive continuity replay —
 * beliefs, rumours and hypotheses may disagree without breaking the path.
 */
export const Assertion = z.object({
	subject: Key,
	predicate: Key,
	value: z.union([
		z.string().trim().min(1).max(200).transform(canonicalStateValue),
		z.number(),
		z.boolean()
	]),
	/** Free-text detail that never takes part in comparisons. */
	note: z.string().trim().max(300).optional(),
	epistemic: z.enum(['world', 'belief', 'rumor', 'hypothesis']).default('world'),
	/** Whose belief/rumour this is (required in spirit for non-world assertions). */
	holder: z.string().trim().max(120).optional(),
	/** Effect that can happen only once on a path (a valve drained, a ship wrecked). */
	irreversible: z.boolean().default(false),
	/** Effect that sets up an action a later beat is expected to consume (a lever readied). */
	preparation: z.boolean().default(false),
	/**
	 * Numeric quantities that may only move one way along story time (a countdown, fuel,
	 * water level after release). `decreasing` also forbids staying equal while story
	 * time advances (a countdown cannot freeze unexplained).
	 */
	monotonic: z.enum(['decreasing', 'non_increasing', 'increasing', 'non_decreasing']).optional(),
	/** Unit of a numeric value (`seconds`, `metres`); values with different units never compare. */
	unit: z.string().trim().max(40).optional(),
	/**
	 * A fact that holds for the whole story world whenever it is told: identity, kinship,
	 * who wrote or received something, the date, place or count of a past event
	 * (family.death_date = 1941-09). It cannot change off-page, so two Blocks of one side
	 * disagreeing on it are a contradiction however far apart they are.
	 */
	timeless: z.boolean().default(false)
});
export type Assertion = z.infer<typeof Assertion>;
export type AssertionInput = z.input<typeof Assertion>;

/**
 * When a beat happens in story time, as far as the text says. `day` is a relative day
 * index within the story (0 = first day), `minute` minutes after that day's midnight.
 * `year` (calendar year) places beats of multi-era stories; `relative` keeps a relative
 * statement whose absolute date is unknown ("eleven winters before the church closed")
 * verbatim instead of guessing a year. Any field may be absent; `approx` widens
 * comparisons by `toleranceMinutes`; `yearApprox` widens the year by one.
 */
export const BeatTime = z.object({
	year: z.int().min(-100_000).max(100_000).optional(),
	/** Calendar month (1–12) and day of month, when the text states them. */
	month: z.int().min(1).max(12).optional(),
	dayOfMonth: z.int().min(1).max(31).optional(),
	day: z.int().min(-100_000).max(100_000).optional(),
	minute: z
		.int()
		.min(0)
		.max(24 * 60 - 1)
		.optional(),
	relative: z.string().trim().max(200).optional(),
	approx: z.boolean().default(false),
	/** The year is inferred rather than stated: widens year comparisons by ±1 (and then months are not compared). */
	yearApprox: z.boolean().default(false),
	toleranceMinutes: z
		.int()
		.min(0)
		.max(24 * 60)
		.default(0),
	/** Explicit flashback/flash-forward: excluded from chronology checks. */
	outOfOrder: z.boolean().default(false)
});
export type BeatTime = z.infer<typeof BeatTime>;

/**
 * A stable identity a beat mentions (BLOCK_FACT_V2 review §4.3). Identity is the `id`,
 * never the display name: two people called Прохор are two entities
 * (`prokhor_dyatlov`, `prokhor_averyanov`), two identical inscriptions on different
 * surfaces are two instances. Assertion subjects should use these ids.
 */
export const EntityRef = z.object({
	id: Key,
	name: z.string().trim().min(1).max(120),
	kind: z.enum(['person', 'object', 'place', 'inscription', 'phenomenon', 'group', 'other']),
	/** What tells it apart from same-named entities (surname, surface, era). */
	distinguishing: z.string().trim().max(200).optional(),
	/** Other names the text uses for this same entity (diminutives, patronymic forms). */
	aliases: z.array(z.string().trim().min(1).max(120)).max(10).default([])
});
export type EntityRef = z.infer<typeof EntityRef>;

/** Story function of a beat (review ISSUE-09). Advisory; quiet beats legitimately have none. */
export const BEAT_FUNCTIONS = [
	'new_decision',
	'irreversible_change',
	'new_constraint',
	'stake_shift',
	'revelation',
	'causal_dependency'
] as const;
export const BeatFunction = z.enum(BEAT_FUNCTIONS);
export type BeatFunction = z.infer<typeof BeatFunction>;

const EventId = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.regex(/^[a-z0-9_.:-]+$/, 'lower_snake event id, e.g. ilse.wakes or call.charter_office.ends');

/** State contract of one beat: what must hold before, what it changes, what it invents. */
export const Transition = z.object({
	preconditions: z.array(Assertion).max(40).default([]),
	effects: z.array(Assertion).max(40).default([]),
	/** Newly invented facts this beat relies on (become committed only on acceptance). */
	assumptions: z.array(Assertion).max(40).default([]),
	time: BeatTime.optional(),
	/** Unique story events this beat performs (each may happen once on the path unless repeatable). */
	events: z.array(EventId).max(20).default([]),
	/** Events this beat performs that may legitimately recur (a second phone call). */
	repeatableEvents: z.array(EventId).max(20).default([]),
	/** Identities this beat mentions; the registry is the union over annotations. */
	entities: z.array(EntityRef).max(40).default([]),
	functions: z.array(BeatFunction).max(6).default([])
});
export type Transition = z.infer<typeof Transition>;
export type TransitionInput = z.input<typeof Transition>;

/**
 * Derived, never author-supplied: where a stated fact comes from. A later bridge must
 * not treat a `proposal` as established.
 */
export const PROVENANCES = ['canonical_anchor', 'committed_generated', 'proposal'] as const;
export const Provenance = z.enum(PROVENANCES);
export type Provenance = z.infer<typeof Provenance>;

/**
 * Transition annotation attached to an exact artifact revision. Stored beside the
 * artifact, so annotating an authored anchor never creates a new anchor revision
 * (and never marks its bridges stale).
 */
export const TransitionAnnotation = z.object({
	id: Uuid,
	artifactId: Uuid,
	artifactRevisionId: Uuid,
	transition: Transition,
	source: z.enum(['author', 'extracted', 'human']),
	reviewed: z.boolean(),
	actorId: z.string(),
	createdAt: IsoDate
});
export type TransitionAnnotation = z.infer<typeof TransitionAnnotation>;

export const PutTransitionInput = z.object({
	/** Revision the annotation describes (optimistic: must be the head revision). */
	artifactRevisionId: Uuid,
	transition: Transition,
	source: z.enum(['author', 'extracted', 'human']).default('human'),
	reviewed: z.boolean().default(false)
});
export type PutTransitionInput = z.input<typeof PutTransitionInput>;

export const ISSUE_KINDS = [
	/** Two committed beats on the same path need incompatible world states. */
	'continuity_violation',
	/** A bridge breaks its right/left anchor contract or consumes the anchor's own event. */
	'anchor_violation',
	/** Intentional, unresolved contradiction between independent sources (creative input). */
	'tension',
	/** Characters believe different things; fine unless narrated as objective truth. */
	'perspective_conflict',
	/** A beat adds no state change or new fact: candidate for "sufficient detail". */
	'redundancy',
	/** A prepared action is never consumed or explained later on the path. */
	'abandoned_preparation',
	/** The annotation describes an older revision than the artifact's head. */
	'stale_annotation',
	/** A beat is placed after a beat that happens later in story time. */
	'temporal_order',
	/** The same unique event (a call ending, a character waking) happens twice on the path. */
	'duplicate_event',
	/** A one-way quantity moves the wrong way or a countdown freezes while time passes. */
	'monotonic_violation',
	/** State differs across a gap of unnarrated beats: a transition is probably missing. */
	'missing_transition',
	/**
	 * Block–Fact: a continuation's story time contradicts the direction it was asked to
	 * write in (a `backward` Block dated after its own anchor).
	 */
	'direction_mismatch',
	/** Different entity ids share a display name: kept distinct, flagged for the reader. */
	'ambiguous_entity',
	/** Two Blocks of one side disagree on a timeless fact (kinship, authorship, a past date). */
	'fact_conflict',
	/**
	 * Name variants of what may be one person carry incompatible timeless roles (mother of
	 * X here, wife of X there), or one entity holds incompatible roles.
	 */
	'identity_conflict',
	/** The annotation itself sets one key to several values in one Block (extraction shape, not story). */
	'annotation_conflict',
	'unknown'
] as const;
export const IssueKind = z.enum(ISSUE_KINDS);
export type IssueKind = z.infer<typeof IssueKind>;

export const ValidationIssue = z.object({
	/** Stable key (kind + artifacts + state key) so dismissals survive recomputation. */
	key: z.string(),
	kind: IssueKind,
	severity: z.enum(['blocker', 'warning', 'info']),
	artifactIds: z.array(Uuid),
	/** `subject.predicate` the issue is about, when it concerns a state key. */
	stateKey: z.string().nullable(),
	explanation: z.string(),
	suggestedAction: z
		.enum([
			'revise_bridge',
			'request_c_resolution',
			'mark_intentional',
			'keep_as_is',
			'stop_expansion'
		])
		.nullable(),
	/** replay = computed from annotations; audit = grounded finding of a continuity audit; human = reported by a facilitator. */
	source: z.enum(['replay', 'audit', 'human']).default('replay'),
	/** Verbatim quotes that ground the issue (required for audit/human findings). */
	evidence: z.array(z.object({ artifactId: Uuid, quote: z.string() })).default([]),
	/** Finding-sourced issues only: the Block the auditor judged to deviate (null otherwise). */
	reviseArtifactId: Uuid.nullable().optional(),
	/** Set when a human dismissed or marked this issue intentional. */
	dismissal: z
		.object({
			resolution: z.enum(['dismissed', 'perspective_dependent', 'intentional']),
			reason: z.string(),
			actorId: z.string(),
			createdAt: IsoDate
		})
		.nullable()
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const IssueList = z.object({
	items: z.array(ValidationIssue),
	/** Artifacts on the path without any transition annotation (validation is blind there). */
	unannotatedArtifactIds: z.array(Uuid)
});
export type IssueList = z.infer<typeof IssueList>;

export const DismissIssueInput = z.object({
	key: z.string().min(1).max(500),
	resolution: z.enum(['dismissed', 'perspective_dependent', 'intentional']),
	reason: z.string().trim().min(1).max(1000)
});
export type DismissIssueInput = z.input<typeof DismissIssueInput>;

/**
 * A continuity problem reported by a reader — an AI continuity audit or a facilitator —
 * rather than computed from annotations. Every finding is grounded: each quote must occur
 * verbatim in the cited revision of a Block. A finding goes stale (hidden from open
 * issues) once a cited Block gets a new revision; re-audit decides whether it persists.
 */
export const ContinuityFinding = z.object({
	id: Uuid,
	projectId: Uuid,
	kind: IssueKind,
	severity: z.enum(['blocker', 'warning', 'info']),
	artifactIds: z.array(Uuid),
	explanation: z.string(),
	evidence: z.array(z.object({ artifactId: Uuid, revisionId: Uuid, quote: z.string() })),
	source: z.enum(['audit', 'human']),
	/** The Block the reporter judged to deviate, when stated. */
	reviseArtifactId: Uuid.nullable(),
	stale: z.boolean(),
	actorId: z.string(),
	createdAt: IsoDate
});
export type ContinuityFinding = z.infer<typeof ContinuityFinding>;

export const CreateFindingInput = z.object({
	kind: IssueKind,
	severity: z.enum(['blocker', 'warning', 'info']),
	artifactIds: z.array(Uuid).min(1).max(8),
	explanation: z.string().trim().min(1).max(2000),
	/** At least one verbatim quote; quotes are checked against the cited head revisions. */
	evidence: z
		.array(z.object({ artifactId: Uuid, quote: z.string().trim().min(3).max(400) }))
		.min(1)
		.max(8),
	source: z.enum(['audit', 'human']).default('human'),
	/** The Block the auditor judges to deviate (the one to revise); must be one of `artifactIds`. */
	reviseArtifactId: Uuid.optional()
});
export type CreateFindingInput = z.input<typeof CreateFindingInput>;

export const FindingList = z.object({ items: z.array(ContinuityFinding) });
export type FindingList = z.infer<typeof FindingList>;

/**
 * Facilitator asks the owning side to repair an open issue in its own chain. Allowed only
 * when every artifact of the issue belongs to the same private side (A or B).
 */
export const RequestRevisionInput = z.object({
	issueKey: z.string().min(1).max(500),
	/** Which of the issue's Blocks to revise. */
	artifactId: Uuid,
	instructions: z.string().trim().max(1000).optional()
});
export type RequestRevisionInput = z.input<typeof RequestRevisionInput>;
