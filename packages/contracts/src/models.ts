import { z } from 'zod';

import {
	ArtifactKind,
	ArtifactStatus,
	CandidateReviewStatus,
	ExpansionStatus,
	OwnerScope,
	ProjectDomain,
	RelationStatus,
	RelationType,
	Role,
	ValidationLevel
} from './enums.ts';
import { StructuredRecord } from './structured.ts';

export const Uuid = z.uuid();
export type UUID = string;

const IsoDate = z.iso.datetime({ offset: true });

/** §4 "controlling complexity" defaults, configurable per project. */
export const ProjectSettings = z.object({
	maxDepth: z.int().min(1).max(20).default(5),
	maxCandidates: z.int().min(1).max(10).default(3),
	maxNodesPerRun: z.int().min(1).max(10_000).default(100),
	maxConcurrentJobs: z.int().min(1).max(16).default(2)
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = ProjectSettings.parse({});

export const Project = z.object({
	id: Uuid,
	name: z.string(),
	domain: ProjectDomain,
	settings: ProjectSettings,
	createdAt: IsoDate,
	updatedAt: IsoDate
});
export type Project = z.infer<typeof Project>;

/** API projection of an artifact (never a raw DB row). `version` is the head revision number. */
export const Artifact = z.object({
	id: Uuid,
	projectId: Uuid,
	kind: ArtifactKind,
	title: z.string(),
	body: z.string(),
	structured: StructuredRecord,
	status: ArtifactStatus,
	creatorRole: Role,
	ownerScope: OwnerScope,
	createdAt: IsoDate,
	updatedAt: IsoDate,
	headRevisionId: Uuid,
	version: z.int().min(1),
	locked: z.boolean(),
	pinned: z.boolean()
});
export type Artifact = z.infer<typeof Artifact>;

/** Full immutable snapshot stored in every revision (append-only history). */
export const ArtifactSnapshot = z.object({
	kind: ArtifactKind,
	title: z.string(),
	body: z.string(),
	structured: StructuredRecord,
	status: ArtifactStatus,
	ownerScope: OwnerScope,
	locked: z.boolean(),
	pinned: z.boolean()
});
export type ArtifactSnapshot = z.infer<typeof ArtifactSnapshot>;

export const ArtifactRevision = z.object({
	id: Uuid,
	artifactId: Uuid,
	version: z.int().min(1),
	snapshot: ArtifactSnapshot,
	actorId: z.string(),
	reason: z.string().nullable(),
	createdAt: IsoDate
});
export type ArtifactRevision = z.infer<typeof ArtifactRevision>;

export const Relation = z.object({
	id: Uuid,
	projectId: Uuid,
	fromId: Uuid,
	toId: Uuid,
	type: RelationType,
	status: RelationStatus,
	/** Expansion that produced this relation (A→C / C→B child), if any. */
	expansionId: Uuid.nullable(),
	provenanceArtifactIds: z.array(Uuid),
	/** Derived: the ACCEPTED expansion that targets this relation (collapsed parent edge). */
	expandedByExpansionId: Uuid.nullable(),
	createdAt: IsoDate,
	updatedAt: IsoDate
});
export type Relation = z.infer<typeof Relation>;

const Score = z.number().min(0).max(5);
/** §4 scoring: heuristic/human, explicitly not pretend-objective. */
export const CandidateScore = z.object({
	anchorPreservation: Score.optional(),
	localCoherence: Score.optional(),
	globalCompatibility: Score.optional(),
	dramaticContribution: Score.optional(),
	novelty: Score.optional(),
	assumptionCost: Score.optional(),
	provenance: Score.optional(),
	validation: z.array(ValidationLevel).default([]),
	notes: z.string().max(4000).optional()
});
export type CandidateScore = z.infer<typeof CandidateScore>;

export const Expansion = z.object({
	id: Uuid,
	projectId: Uuid,
	targetRelationId: Uuid.nullable(),
	leftArtifactId: Uuid,
	rightArtifactId: Uuid,
	/** Anchor revisions pinned when the expansion was opened (§4 invariant). */
	leftRevisionId: Uuid,
	rightRevisionId: Uuid,
	parentExpansionId: Uuid.nullable(),
	/** Artifact IDs of every candidate ever submitted, in submission order. */
	bridgeArtifactIds: z.array(Uuid),
	selectedBridgeArtifactId: Uuid.nullable(),
	depth: z.int().min(1),
	status: ExpansionStatus,
	attempts: z.int().min(0),
	/** Derived: relations produced on accept ([left→C, C→right]); empty until accepted. */
	childRelationIds: z.array(Uuid),
	createdAt: IsoDate,
	updatedAt: IsoDate,
	acceptedAt: IsoDate.nullable()
});
export type Expansion = z.infer<typeof Expansion>;

export const ExpansionCandidate = z.object({
	id: Uuid,
	expansionId: Uuid,
	artifactId: Uuid,
	score: CandidateScore,
	reviewStatus: CandidateReviewStatus,
	createdAt: IsoDate
});
export type ExpansionCandidate = z.infer<typeof ExpansionCandidate>;

/** Human/agent identity resolved server-side; never taken from a client-supplied role field. */
export const Principal = z.object({
	id: z.string().min(1),
	kind: z.enum(['HUMAN', 'AGENT']),
	role: Role
});
export type Principal = z.infer<typeof Principal>;

/** M0–M2 runs single-user; M3 replaces this with authenticated principals and tokens. */
export const LOCAL_HUMAN: Principal = { id: 'local-human', kind: 'HUMAN', role: 'HUMAN' };
