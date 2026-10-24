import { z } from 'zod';

import { CompositeDefinitionRecord, CompositeSummary } from './composites.ts';
import {
	ArtifactKind,
	ArtifactStatus,
	OwnerScope,
	ProjectDomain,
	RelationStatus,
	RelationType
} from './enums.ts';
import {
	Artifact,
	ArtifactRevision,
	CandidateScore,
	Expansion,
	ExpansionCandidate,
	Project,
	ProjectSettings,
	Relation,
	Uuid
} from './models.ts';
import { BridgeStructured, StructuredRecord } from './structured.ts';
import { Transition, TransitionAnnotation, ValidationIssue } from './validation.ts';

/** HTTP header carrying the expected head revision ID for optimistic concurrency. */
export const IF_MATCH_HEADER = 'if-match';
/** HTTP header carrying the client idempotency key for expansion acceptance. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKey = z.string().trim().min(8).max(200);

export const API_PREFIX = '/api';

const Title = z.string().trim().min(1).max(300);
const Body = z.string().max(100_000);
const Reason = z.string().trim().max(1000);

// ── Projects ────────────────────────────────────────────────────────────────

export const CreateProjectInput = z.object({
	name: z.string().trim().min(1).max(200),
	domain: ProjectDomain.default('GENERIC'),
	settings: ProjectSettings.partial().optional()
});
export type CreateProjectInput = z.input<typeof CreateProjectInput>;

export const ProjectList = z.object({ items: z.array(Project) });
export type ProjectList = z.infer<typeof ProjectList>;

// ── Artifacts ───────────────────────────────────────────────────────────────

export const CreateArtifactInput = z.object({
	kind: ArtifactKind,
	title: Title,
	body: Body.default(''),
	structured: StructuredRecord.default({}),
	status: z.enum(['DRAFT', 'PROPOSED', 'ACCEPTED']).default('DRAFT'),
	ownerScope: OwnerScope.default('PROJECT_PUBLIC'),
	locked: z.boolean().default(false),
	pinned: z.boolean().default(false),
	reason: Reason.optional()
});
export type CreateArtifactInput = z.input<typeof CreateArtifactInput>;

/** PATCH body; requires `If-Match: <headRevisionId>`. At least one field besides `reason`. */
export const UpdateArtifactInput = z
	.object({
		kind: ArtifactKind.optional(),
		title: Title.optional(),
		body: Body.optional(),
		structured: StructuredRecord.optional(),
		status: ArtifactStatus.optional(),
		ownerScope: OwnerScope.optional(),
		locked: z.boolean().optional(),
		pinned: z.boolean().optional(),
		reason: Reason.optional()
	})
	.refine(
		(v) => Object.keys(v).some((k) => k !== 'reason' && v[k as keyof typeof v] !== undefined),
		{
			message: 'patch must change at least one field'
		}
	);
export type UpdateArtifactInput = z.input<typeof UpdateArtifactInput>;

export const ArtifactListQuery = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(100),
	cursor: z.string().max(200).optional(),
	kind: ArtifactKind.optional(),
	status: ArtifactStatus.optional(),
	q: z.string().trim().max(200).optional()
});
export type ArtifactListQuery = z.input<typeof ArtifactListQuery>;

export const ArtifactPage = z.object({
	items: z.array(Artifact),
	nextCursor: z.string().nullable()
});
export type ArtifactPage = z.infer<typeof ArtifactPage>;

export const RevisionList = z.object({ items: z.array(ArtifactRevision) });
export type RevisionList = z.infer<typeof RevisionList>;

// ── Relations ───────────────────────────────────────────────────────────────

export const CreateRelationInput = z.object({
	fromId: Uuid,
	toId: Uuid,
	type: RelationType,
	status: RelationStatus.default('ACCEPTED')
});
export type CreateRelationInput = z.input<typeof CreateRelationInput>;

export const UpdateRelationInput = z
	.object({ type: RelationType.optional(), status: RelationStatus.optional() })
	.refine((v) => v.type !== undefined || v.status !== undefined, {
		message: 'patch must change type or status'
	});
export type UpdateRelationInput = z.input<typeof UpdateRelationInput>;

// ── Expansions ──────────────────────────────────────────────────────────────

/** Open an expansion on a relation (preferred) or an ordered artifact pair. */
export const CreateExpansionInput = z
	.object({
		targetRelationId: Uuid.optional(),
		leftArtifactId: Uuid.optional(),
		rightArtifactId: Uuid.optional()
	})
	.refine(
		(v) =>
			v.targetRelationId !== undefined ||
			(v.leftArtifactId !== undefined && v.rightArtifactId !== undefined),
		{ message: 'provide targetRelationId or both leftArtifactId and rightArtifactId' }
	);
export type CreateExpansionInput = z.input<typeof CreateExpansionInput>;

export const NewCandidateArtifact = z.object({
	kind: ArtifactKind.default('BRIDGE'),
	title: Title,
	body: Body.default(''),
	structured: BridgeStructured
});
export type NewCandidateArtifact = z.input<typeof NewCandidateArtifact>;

/**
 * Either author a new bridge artifact or nominate an existing one (cycle-checked).
 * `transition` states the candidate's preconditions/effects/assumptions; it is stored as
 * an `author` annotation of the candidate revision and drives the accept-time check.
 */
export const SubmitCandidateInput = z.union([
	z.object({
		artifact: NewCandidateArtifact,
		score: CandidateScore.optional(),
		transition: Transition.optional()
	}),
	z.object({
		existingArtifactId: Uuid,
		score: CandidateScore.optional(),
		transition: Transition.optional()
	})
]);
export type SubmitCandidateInput = z.input<typeof SubmitCandidateInput>;

/**
 * Requires `Idempotency-Key` header. Accept fails with `CONTINUITY_VIOLATION` when the
 * candidate adds blocker issues to the committed path, unless a human supplies
 * `acknowledgeIssues` (recorded in the revision reason and audit).
 */
export const AcceptExpansionInput = z.object({
	candidateId: Uuid,
	leftRelationType: RelationType.optional(),
	rightRelationType: RelationType.optional(),
	reason: Reason.optional(),
	acknowledgeIssues: z.string().trim().min(1).max(1000).optional()
});
export type AcceptExpansionInput = z.input<typeof AcceptExpansionInput>;

/** With `candidateId`: reject one candidate. Without: cancel the whole expansion. */
export const RejectExpansionInput = z.object({
	candidateId: Uuid.optional(),
	reason: Reason.optional()
});
export type RejectExpansionInput = z.input<typeof RejectExpansionInput>;

export const CandidateWithArtifact = ExpansionCandidate.extend({
	artifact: Artifact,
	/** Issues this candidate would add to the committed path if accepted now. */
	issues: z.array(ValidationIssue).default([])
});
export type CandidateWithArtifact = z.infer<typeof CandidateWithArtifact>;

export const ExpansionDetail = z.object({
	expansion: Expansion,
	candidates: z.array(CandidateWithArtifact),
	left: Artifact,
	right: Artifact,
	targetRelation: Relation.nullable(),
	childRelations: z.array(Relation),
	/** Ancestor expansions ordered root → parent. */
	lineage: z.array(Expansion)
});
export type ExpansionDetail = z.infer<typeof ExpansionDetail>;

export const AcceptExpansionResult = z.object({
	expansion: Expansion,
	bridge: Artifact,
	childRelations: z.tuple([Relation, Relation]),
	/** true when the same idempotency key was replayed and nothing new was written. */
	replayed: z.boolean()
});
export type AcceptExpansionResult = z.infer<typeof AcceptExpansionResult>;

// ── Graph / export ──────────────────────────────────────────────────────────

/** Hard cap on artifacts returned by the graph projection (larger graphs → GRAPH_TOO_LARGE). */
export const MAX_GRAPH_ARTIFACTS = 10_000;

export const ProjectGraph = z.object({
	project: Project,
	artifacts: z.array(Artifact),
	relations: z.array(Relation),
	expansions: z.array(Expansion),
	candidates: z.array(ExpansionCandidate),
	/** Head definitions of visible composites, filtered per member ACL. */
	composites: z.array(CompositeSummary).default([]),
	/** Latest state annotation per visible artifact (continuity validation input). */
	transitions: z.array(TransitionAnnotation).default([])
});
export type ProjectGraph = z.infer<typeof ProjectGraph>;

export const EXPORT_FORMAT = 'tlon.export';
export const EXPORT_VERSION = 1;

/**
 * Versioned, self-contained project export. Derived fields (`version`,
 * `expandedByExpansionId`, `childRelationIds`, `projectId`) are informative and
 * recomputed on import.
 */
export const ExportBundle = z.object({
	format: z.literal(EXPORT_FORMAT),
	version: z.literal(EXPORT_VERSION),
	exportedAt: z.iso.datetime({ offset: true }),
	project: Project,
	artifacts: z.array(Artifact),
	revisions: z.array(ArtifactRevision),
	relations: z.array(Relation),
	expansions: z.array(Expansion),
	candidates: z.array(ExpansionCandidate),
	/** Every composite definition revision (additive in v1; absent in older bundles). */
	compositeDefinitions: z.array(CompositeDefinitionRecord).default([]),
	/** Every state annotation (additive in v1). */
	transitions: z.array(TransitionAnnotation).default([])
});
export type ExportBundle = z.infer<typeof ExportBundle>;

export const ImportOptions = z.object({
	/** Generate fresh IDs (consistently remapped) instead of preserving bundle IDs. */
	remapIds: z.union([z.boolean(), z.stringbool()]).default(false)
});
export type ImportOptions = z.input<typeof ImportOptions>;

export const ImportAsNewProjectOptions = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	remapIds: z.union([z.boolean(), z.stringbool()]).default(false)
});
export type ImportAsNewProjectOptions = z.input<typeof ImportAsNewProjectOptions>;

export const ImportResult = z.object({
	projectId: Uuid,
	artifacts: z.int(),
	revisions: z.int(),
	relations: z.int(),
	expansions: z.int(),
	candidates: z.int(),
	remapped: z.boolean()
});
export type ImportResult = z.infer<typeof ImportResult>;
