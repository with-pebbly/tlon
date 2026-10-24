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
	'SUPERSEDED'
] as const;
export const ArtifactStatus = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

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
	'bridges'
] as const;

/** Relation types whose accepted/proposed edges must stay acyclic (chronology, derivation). */
export const ACYCLIC_RELATION_TYPES: readonly string[] = ['precedes', 'derived_from'];

/** Type used for A→C and C→B child relations when the accept request does not override it. */
export const DEFAULT_CHILD_RELATION_TYPE = 'bridges';

export const RelationType = z
	.string()
	.regex(/^[a-z][a-z0-9_]{0,63}$/, 'relation type must be snake_case, 1-64 chars');
export type RelationType = z.infer<typeof RelationType>;
