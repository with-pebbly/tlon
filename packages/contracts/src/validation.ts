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
	preparation: z.boolean().default(false)
});
export type Assertion = z.infer<typeof Assertion>;
export type AssertionInput = z.input<typeof Assertion>;

/** State contract of one beat: what must hold before, what it changes, what it invents. */
export const Transition = z.object({
	preconditions: z.array(Assertion).max(40).default([]),
	effects: z.array(Assertion).max(40).default([]),
	/** Newly invented facts this beat relies on (become committed only on acceptance). */
	assumptions: z.array(Assertion).max(40).default([])
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
