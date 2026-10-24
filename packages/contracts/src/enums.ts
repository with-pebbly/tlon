import { z } from 'zod';

export const ROLES = ['HUMAN', 'A', 'B', 'C', 'VALIDATOR'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ARTIFACT_KINDS = [
	'FACT',
	'EVENT',
	'STATE',
	'BELIEF',
	'GOAL',
	'CONSTRAINT',
	'BRIDGE',
	'ARC',
	'SCENE',
	'NOTE'
] as const;
export const ArtifactKind = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ARTIFACT_STATUSES = [
	'DRAFT',
	'PROPOSED',
	'ACCEPTED',
	'REJECTED',
	'SUPERSEDED',
	/** Retired composite (or artifact): kept with full history, members untouched. */
	'ARCHIVED'
] as const;
export const ArtifactStatus = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

/**
 * Atomic artifacts carry their own content; composite artifacts are a versioned
 * semantic composition over a subgraph (COMPOSITE_ARTIFACTS_SPEC). Orthogonal to
 * `kind`, which stays the narrative label (a composite is typically SCENE/ARC).
 */
export const COMPOSITIONS = ['ATOMIC', 'COMPOSITE'] as const;
export const Composition = z.enum(COMPOSITIONS);
export type Composition = z.infer<typeof Composition>;

/** BLOCK (narrative point/segment) vs FACT (minimal mediator connector), BLOCK_FACT §1.1. */
export const ARTIFACT_CLASSES = ['BLOCK', 'FACT'] as const;
export const ArtifactClass = z.enum(ARTIFACT_CLASSES);
export type ArtifactClass = z.infer<typeof ArtifactClass>;

/** What a Fact is (BLOCK_FACT §4). */
export const FACT_KINDS = [
	'object',
	'person',
	'place',
	'rule',
	'signal',
	'trace',
	'document',
	'need',
	'constraint',
	'belief',
	'damage',
	'resource',
	'relationship',
	'other'
] as const;
export const FactKind = z.enum(FACT_KINDS);
export type FactKind = z.infer<typeof FactKind>;

export const OWNER_SCOPES = ['A_PRIVATE', 'B_PRIVATE', 'C_SHARED', 'PROJECT_PUBLIC'] as const;
export const OwnerScope = z.enum(OWNER_SCOPES);
export type OwnerScope = z.infer<typeof OwnerScope>;

export const RELATION_STATUSES = ['PROPOSED', 'ACCEPTED', 'REJECTED'] as const;
export const RelationStatus = z.enum(RELATION_STATUSES);
export type RelationStatus = z.infer<typeof RelationStatus>;

export const EXPANSION_STATUSES = [
	'PENDING',
	'GENERATING',
	'REVIEW',
	'ACCEPTED',
	'FAILED',
	'CANCELLED'
] as const;
export const ExpansionStatus = z.enum(EXPANSION_STATUSES);
export type ExpansionStatus = z.infer<typeof ExpansionStatus>;

/** Expansion statuses that still accept candidates / a decision. */
export const OPEN_EXPANSION_STATUSES: readonly ExpansionStatus[] = [
	'PENDING',
	'GENERATING',
	'REVIEW'
];

export const CANDIDATE_REVIEW_STATUSES = [
	'PENDING',
	'SELECTED',
	'NOT_SELECTED',
	'REJECTED'
] as const;
export const CandidateReviewStatus = z.enum(CANDIDATE_REVIEW_STATUSES);
export type CandidateReviewStatus = z.infer<typeof CandidateReviewStatus>;

export const PROJECT_DOMAINS = ['NARRATIVE', 'GENERIC'] as const;
export const ProjectDomain = z.enum(PROJECT_DOMAINS);
export type ProjectDomain = z.infer<typeof ProjectDomain>;

/** Validation ladder from §1: a bridge is not proof. */
export const VALIDATION_LEVELS = [
	'syntactically_valid',
	'locally_coherent',
	'globally_consistent',
	'narratively_effective',
	'externally_verified'
] as const;
export const ValidationLevel = z.enum(VALIDATION_LEVELS);
export type ValidationLevel = z.infer<typeof ValidationLevel>;

export const EPISTEMIC_STATUSES = [
	'WORLD_FACT',
	'CHARACTER_BELIEF',
	'CLAIM',
	'RUMOR',
	'HYPOTHESIS'
] as const;
export const EpistemicStatus = z.enum(EPISTEMIC_STATUSES);
export type EpistemicStatus = z.infer<typeof EpistemicStatus>;

/** Relation types are extensible; these are the documented built-ins. */
export const WELL_KNOWN_RELATION_TYPES = [
	'precedes',
	'causes',
	'enables',
	'contradicts',
	'explains',
	'references',
	'same_identity_as',
	'believed_by',
	'derived_from',
	'bridges',
	/** Block ↔ Fact association inside a Triangle (BLOCK_FACT §4 SemanticRelation). */
	'has_fact',
	'involves'
] as const;

/** Relation types whose accepted/proposed edges must stay acyclic (chronology, derivation). */
export const ACYCLIC_RELATION_TYPES: readonly string[] = ['precedes', 'derived_from'];

/** Type used for A→C and C→B child relations when the accept request does not override it. */
export const DEFAULT_CHILD_RELATION_TYPE = 'bridges';

/**
 * Membership lives only in composite definitions; semantic relations may never use
 * these names, so `contains` can't be confused with `causes`/`precedes` (spec §2.1).
 */
export const RESERVED_RELATION_TYPES: readonly string[] = ['contains', 'member_of', 'part_of'];

export const RelationType = z
	.string()
	.regex(/^[a-z][a-z0-9_]{0,63}$/, 'relation type must be snake_case, 1-64 chars')
	.refine((t) => !RESERVED_RELATION_TYPES.includes(t), {
		message: 'membership types are reserved; compose artifacts instead'
	});
export type RelationType = z.infer<typeof RelationType>;
