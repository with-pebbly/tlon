import type { CompletionReport, InputManifest } from '@tlon/contracts';
import { sql } from 'drizzle-orm';
import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const projects = pgTable('projects', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	domain: text('domain').notNull(),
	settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
	createdAt: ts('created_at').notNull(),
	updatedAt: ts('updated_at').notNull()
});

export const members = pgTable(
	'members',
	{
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		principalId: text('principal_id').notNull(),
		role: text('role').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.projectId, t.principalId] })]
);

export const artifacts = pgTable(
	'artifacts',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		kind: text('kind').notNull(),
		composition: text('composition').notNull().default('ATOMIC'),
		// BLOCK (narrative segment, default for all pre-protocol rows) or FACT (mediator connector).
		artifactClass: text('artifact_class').notNull().default('BLOCK'),
		factKind: text('fact_kind'),
		title: text('title').notNull(),
		body: text('body').notNull(),
		structured: jsonb('structured').$type<Record<string, unknown>>().notNull(),
		status: text('status').notNull(),
		creatorRole: text('creator_role').notNull(),
		ownerScope: text('owner_scope').notNull(),
		locked: boolean('locked').notNull().default(false),
		pinned: boolean('pinned').notNull().default(false),
		// No FK: artifact and its first revision reference each other; the service writes both in one transaction.
		headRevisionId: uuid('head_revision_id').notNull(),
		createdAt: ts('created_at').notNull(),
		updatedAt: ts('updated_at').notNull()
	},
	(t) => [
		unique('artifacts_project_id_id_uq').on(t.projectId, t.id),
		index('artifacts_project_idx').on(t.projectId, t.createdAt, t.id)
	]
);

export const artifactRevisions = pgTable(
	'artifact_revisions',
	{
		id: uuid('id').primaryKey(),
		artifactId: uuid('artifact_id')
			.notNull()
			.references(() => artifacts.id),
		version: integer('version').notNull(),
		snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
		actorId: text('actor_id').notNull(),
		reason: text('reason'),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		unique('artifact_revisions_artifact_version_uq').on(t.artifactId, t.version),
		index('artifact_revisions_artifact_idx').on(t.artifactId)
	]
);

export const relations = pgTable(
	'relations',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		fromId: uuid('from_id').notNull(),
		toId: uuid('to_id').notNull(),
		type: text('type').notNull(),
		status: text('status').notNull(),
		// No FK: relations and expansions reference each other; integrity is enforced by the service.
		expansionId: uuid('expansion_id'),
		provenanceArtifactIds: jsonb('provenance_artifact_ids').$type<string[]>().notNull(),
		createdAt: ts('created_at').notNull(),
		updatedAt: ts('updated_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'relations_from_fk',
			columns: [t.projectId, t.fromId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'relations_to_fk',
			columns: [t.projectId, t.toId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		index('relations_project_idx').on(t.projectId),
		index('relations_from_idx').on(t.fromId),
		index('relations_to_idx').on(t.toId),
		index('relations_expansion_idx').on(t.expansionId)
	]
);

export const expansions = pgTable(
	'expansions',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		targetRelationId: uuid('target_relation_id').references(() => relations.id),
		leftArtifactId: uuid('left_artifact_id').notNull(),
		rightArtifactId: uuid('right_artifact_id').notNull(),
		leftRevisionId: uuid('left_revision_id').notNull(),
		rightRevisionId: uuid('right_revision_id').notNull(),
		parentExpansionId: uuid('parent_expansion_id'),
		selectedBridgeArtifactId: uuid('selected_bridge_artifact_id'),
		depth: integer('depth').notNull(),
		status: text('status').notNull(),
		attempts: integer('attempts').notNull().default(0),
		acceptedAt: ts('accepted_at'),
		acceptIdempotencyKey: text('accept_idempotency_key'),
		acceptFingerprintHash: text('accept_fingerprint_hash'),
		createdAt: ts('created_at').notNull(),
		updatedAt: ts('updated_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'expansions_left_fk',
			columns: [t.projectId, t.leftArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'expansions_right_fk',
			columns: [t.projectId, t.rightArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'expansions_parent_fk',
			columns: [t.parentExpansionId],
			foreignColumns: [t.id]
		}),
		unique('expansions_project_idempotency_uq').on(t.projectId, t.acceptIdempotencyKey),
		// At most one open-or-accepted expansion per target relation (also guards races).
		uniqueIndex('expansions_target_active_uq')
			.on(t.targetRelationId)
			.where(
				sql`${t.targetRelationId} is not null and ${t.status} in ('PENDING','GENERATING','REVIEW','ACCEPTED')`
			),
		index('expansions_project_idx').on(t.projectId),
		index('expansions_parent_idx').on(t.parentExpansionId),
		index('expansions_target_idx').on(t.targetRelationId),
		index('expansions_status_idx').on(t.projectId, t.status)
	]
);

export const expansionCandidates = pgTable(
	'expansion_candidates',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		expansionId: uuid('expansion_id')
			.notNull()
			.references(() => expansions.id),
		artifactId: uuid('artifact_id')
			.notNull()
			.references(() => artifacts.id),
		score: jsonb('score').$type<Record<string, unknown>>().notNull(),
		reviewStatus: text('review_status').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		unique('expansion_candidates_expansion_artifact_uq').on(t.expansionId, t.artifactId),
		index('expansion_candidates_expansion_idx').on(t.expansionId),
		index('expansion_candidates_project_idx').on(t.projectId)
	]
);

export const auditEvents = pgTable(
	'audit_events',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id').references(() => projects.id),
		actorId: text('actor_id').notNull(),
		operation: text('operation').notNull(),
		subjectId: text('subject_id'),
		outcome: text('outcome').notNull(),
		// IDs and counts only — never artifact titles or bodies.
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		index('audit_events_project_idx').on(t.projectId, t.createdAt),
		index('audit_events_actor_idx').on(t.projectId, t.actorId, t.createdAt)
	]
);

/** One identity per (project, role, name); the role lives here, never in a request (§7.2). */
export const agentPrincipals = pgTable(
	'agent_principals',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		role: text('role').notNull(),
		name: text('name').notNull(),
		executorKind: text('executor_kind').notNull().default('ai'),
		createdAt: ts('created_at').notNull(),
		disabledAt: ts('disabled_at')
	},
	(t) => [
		unique('agent_principals_project_role_name_uq').on(t.projectId, t.role, t.name),
		index('agent_principals_project_idx').on(t.projectId)
	]
);

/** Only the sha256 hex of a token is stored; the plaintext is returned once on issue. */
export const agentTokens = pgTable(
	'agent_tokens',
	{
		id: uuid('id').primaryKey(),
		principalId: uuid('principal_id')
			.notNull()
			.references(() => agentPrincipals.id),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: ts('created_at').notNull(),
		expiresAt: ts('expires_at').notNull(),
		revokedAt: ts('revoked_at')
	},
	(t) => [index('agent_tokens_principal_idx').on(t.principalId)]
);

/** Explicit per-artifact read access for an agent principal (created by humans or published disclosures). */
export const grants = pgTable(
	'grants',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		granteePrincipalId: uuid('grantee_principal_id')
			.notNull()
			.references(() => agentPrincipals.id),
		artifactId: uuid('artifact_id').notNull(),
		permission: text('permission').notNull(),
		createdBy: text('created_by').notNull(),
		createdAt: ts('created_at').notNull(),
		expiresAt: ts('expires_at'),
		revokedAt: ts('revoked_at')
	},
	(t) => [
		foreignKey({
			name: 'grants_artifact_fk',
			columns: [t.projectId, t.artifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		index('grants_grantee_artifact_idx').on(t.granteePrincipalId, t.artifactId),
		index('grants_project_idx').on(t.projectId)
	]
);

export const disclosures = pgTable(
	'disclosures',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		fromPrincipalId: text('from_principal_id').notNull(),
		toPrincipalId: uuid('to_principal_id')
			.notNull()
			.references(() => agentPrincipals.id),
		sourceRefs: jsonb('source_refs')
			.$type<Array<{ artifactId: string; revisionId: string }>>()
			.notNull(),
		sharedPayload: jsonb('shared_payload').$type<Record<string, unknown>>().notNull(),
		redactionNote: text('redaction_note'),
		status: text('status').notNull(),
		sharedArtifactId: uuid('shared_artifact_id').references(() => artifacts.id),
		reviewedBy: text('reviewed_by'),
		createdAt: ts('created_at').notNull(),
		reviewedAt: ts('reviewed_at')
	},
	(t) => [
		index('disclosures_project_status_idx').on(t.projectId, t.status, t.createdAt),
		index('disclosures_to_idx').on(t.toPrincipalId, t.status)
	]
);

/**
 * One row per composite definition revision (the head is the max `version`). Definitions
 * pin member revisions; the composite artifact's own revision chain lives in
 * `artifact_revisions` as for any artifact.
 */
export const compositeDefinitions = pgTable(
	'composite_definitions',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		compositeArtifactId: uuid('composite_artifact_id').notNull(),
		artifactRevisionId: uuid('artifact_revision_id')
			.notNull()
			.references(() => artifactRevisions.id),
		version: integer('version').notNull(),
		contract: jsonb('contract').$type<Record<string, unknown>>().notNull(),
		boundary: jsonb('boundary').$type<{ entries: string[]; exits: string[] }>().notNull(),
		actorId: text('actor_id').notNull(),
		reason: text('reason'),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'composite_definitions_artifact_fk',
			columns: [t.projectId, t.compositeArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		unique('composite_definitions_artifact_version_uq').on(t.compositeArtifactId, t.version),
		index('composite_definitions_project_idx').on(t.projectId),
		index('composite_definitions_composite_idx').on(t.compositeArtifactId)
	]
);

/** Members of one definition with the revision pinned at definition time. */
export const compositeMembers = pgTable(
	'composite_members',
	{
		definitionId: uuid('definition_id')
			.notNull()
			.references(() => compositeDefinitions.id),
		memberArtifactId: uuid('member_artifact_id')
			.notNull()
			.references(() => artifacts.id),
		memberRevisionId: uuid('member_revision_id')
			.notNull()
			.references(() => artifactRevisions.id),
		displayOrder: integer('display_order').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.definitionId, t.memberArtifactId] }),
		index('composite_members_member_idx').on(t.memberArtifactId)
	]
);

/** Internal relations snapshotted into a definition; endpoints must both be members (service-enforced). */
export const compositeRelationMembers = pgTable(
	'composite_relation_members',
	{
		definitionId: uuid('definition_id')
			.notNull()
			.references(() => compositeDefinitions.id),
		relationId: uuid('relation_id')
			.notNull()
			.references(() => relations.id)
	},
	(t) => [
		primaryKey({ columns: [t.definitionId, t.relationId] }),
		index('composite_relation_members_relation_idx').on(t.relationId)
	]
);

/**
 * Append-only state-contract annotations (preconditions/effects/assumptions) of one exact
 * artifact revision. Kept beside the artifact so annotating never creates a revision;
 * the latest row per artifact is the current annotation.
 */
export const transitionAnnotations = pgTable(
	'transition_annotations',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		artifactId: uuid('artifact_id').notNull(),
		artifactRevisionId: uuid('artifact_revision_id')
			.notNull()
			.references(() => artifactRevisions.id),
		transition: jsonb('transition').$type<Record<string, unknown>>().notNull(),
		source: text('source').notNull(),
		reviewed: boolean('reviewed').notNull(),
		actorId: text('actor_id').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'transition_annotations_artifact_fk',
			columns: [t.projectId, t.artifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		index('transition_annotations_artifact_idx').on(t.artifactId, t.createdAt)
	]
);

/** Human resolutions of validation issues, keyed by the stable issue key; the latest row per key wins. */
export const issueDismissals = pgTable(
	'issue_dismissals',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		issueKey: text('issue_key').notNull(),
		resolution: text('resolution').notNull(),
		reason: text('reason').notNull(),
		actorId: text('actor_id').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [index('issue_dismissals_project_key_idx').on(t.projectId, t.issueKey)]
);

/** Mediator-private justification of a Fact; never part of the artifact or any disclosure. */
export const factRationales = pgTable(
	'fact_rationales',
	{
		factArtifactId: uuid('fact_artifact_id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		rationale: text('rationale').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'fact_rationales_artifact_fk',
			columns: [t.projectId, t.factArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		index('fact_rationales_project_idx').on(t.projectId)
	]
);

/** One protocol run: config + side-private briefs (facilitator-only). */
export const protocolRuns = pgTable(
	'protocol_runs',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		config: jsonb('config').$type<Record<string, unknown>>().notNull(),
		status: text('status').notNull(),
		briefs: jsonb('briefs').$type<{ A: string; B: string }>().notNull(),
		createdAt: ts('created_at').notNull(),
		updatedAt: ts('updated_at').notNull()
	},
	(t) => [
		unique('protocol_runs_project_id_id_uq').on(t.projectId, t.id),
		index('protocol_runs_project_idx').on(t.projectId)
	]
);

/** Fact persisted as an anchor (§16.5): pins the exact Fact revision. */
export const factAnchors = pgTable(
	'fact_anchors',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		factArtifactId: uuid('fact_artifact_id').notNull(),
		factRevisionId: uuid('fact_revision_id').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'fact_anchors_artifact_fk',
			columns: [t.projectId, t.factArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		unique('fact_anchors_project_id_id_uq').on(t.projectId, t.id),
		index('fact_anchors_project_idx').on(t.projectId)
	]
);

/** Two anchors + one Fact (hyperedge). The Fact is null while C's proposal is under review. */
export const triangles = pgTable(
	'triangles',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		runId: uuid('run_id').references(() => protocolRuns.id),
		leftArtifactId: uuid('left_artifact_id').notNull(),
		leftRevisionId: uuid('left_revision_id').notNull(),
		leftFactAnchorId: uuid('left_fact_anchor_id').references(() => factAnchors.id),
		rightArtifactId: uuid('right_artifact_id').notNull(),
		rightRevisionId: uuid('right_revision_id').notNull(),
		rightFactAnchorId: uuid('right_fact_anchor_id').references(() => factAnchors.id),
		factArtifactId: uuid('fact_artifact_id'),
		factRevisionId: uuid('fact_revision_id'),
		status: text('status').notNull(),
		stageIndex: integer('stage_index').notNull(),
		depth: integer('depth').notNull(),
		parentTriangleId: uuid('parent_triangle_id'),
		leftDirection: text('left_direction').notNull().default('forward'),
		rightDirection: text('right_direction').notNull().default('backward'),
		createdAt: ts('created_at').notNull(),
		updatedAt: ts('updated_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'triangles_left_fk',
			columns: [t.projectId, t.leftArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'triangles_right_fk',
			columns: [t.projectId, t.rightArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'triangles_fact_fk',
			columns: [t.projectId, t.factArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'triangles_parent_fk',
			columns: [t.parentTriangleId],
			foreignColumns: [t.id]
		}),
		unique('triangles_project_id_id_uq').on(t.projectId, t.id),
		index('triangles_project_idx').on(t.projectId),
		index('triangles_run_idx').on(t.runId),
		index('triangles_parent_idx').on(t.parentTriangleId)
	]
);

/** One protocol task: the unit humans, AI and scripted executors claim and submit. */
export const protocolTasks = pgTable(
	'protocol_tasks',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		runId: uuid('run_id').references(() => protocolRuns.id),
		type: text('type').notNull(),
		role: text('role').notNull(),
		assigneePrincipalId: uuid('assignee_principal_id').references(() => agentPrincipals.id),
		state: text('state').notNull(),
		stageIndex: integer('stage_index').notNull(),
		depth: integer('depth').notNull(),
		triangleId: uuid('triangle_id').references(() => triangles.id),
		side: text('side'),
		direction: text('direction'),
		resultRefs: jsonb('result_refs')
			.$type<Array<{ artifactId: string; revisionId: string }>>()
			.notNull(),
		submitIdempotencyKey: text('submit_idempotency_key'),
		inputManifest: jsonb('input_manifest').$type<InputManifest>(),
		createdAt: ts('created_at').notNull(),
		submittedAt: ts('submitted_at')
	},
	(t) => [
		unique('protocol_tasks_project_idempotency_uq').on(t.projectId, t.submitIdempotencyKey),
		index('protocol_tasks_project_idx').on(t.projectId, t.state),
		index('protocol_tasks_role_idx').on(t.projectId, t.role, t.state),
		index('protocol_tasks_triangle_idx').on(t.triangleId),
		index('protocol_tasks_assignee_idx').on(t.assigneePrincipalId)
	]
);

/** Blocks written by the two sides from the accepted Fact (several per side are allowed). */
export const triangleContinuations = pgTable(
	'triangle_continuations',
	{
		triangleId: uuid('triangle_id')
			.notNull()
			.references(() => triangles.id),
		side: text('side').notNull(),
		artifactId: uuid('artifact_id').notNull(),
		revisionId: uuid('revision_id').notNull(),
		taskId: uuid('task_id').references(() => protocolTasks.id)
	},
	(t) => [
		primaryKey({ columns: [t.triangleId, t.side, t.artifactId] }),
		index('triangle_continuations_artifact_idx').on(t.artifactId)
	]
);

/** C's Fact proposals for a Triangle; each candidate is itself a PROPOSED Fact artifact. */
export const factCandidates = pgTable(
	'fact_candidates',
	{
		id: uuid('id').primaryKey(),
		triangleId: uuid('triangle_id')
			.notNull()
			.references(() => triangles.id),
		factArtifactId: uuid('fact_artifact_id').notNull(),
		factRevisionId: uuid('fact_revision_id').notNull(),
		status: text('status').notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [
		unique('fact_candidates_triangle_artifact_uq').on(t.triangleId, t.factArtifactId),
		index('fact_candidates_triangle_idx').on(t.triangleId)
	]
);

/**
 * Organizer-only narrative relations beyond a shared Fact (review §4.1). Never visible to
 * A/B/C; may hold cross-side reasoning. `fact_link` is derived from triangles, not stored.
 */
export const narrativeConnections = pgTable(
	'narrative_connections',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		kind: text('kind').notNull(),
		endpointAId: uuid('endpoint_a_id').notNull(),
		endpointBId: uuid('endpoint_b_id').notNull(),
		factArtifactId: uuid('fact_artifact_id'),
		realizedByIds: jsonb('realized_by_ids').$type<string[]>().notNull(),
		statement: text('statement').notNull(),
		confidence: text('confidence').notNull(),
		status: text('status').notNull(),
		source: text('source').notNull(),
		approvedBy: text('approved_by'),
		createdAt: ts('created_at').notNull(),
		updatedAt: ts('updated_at').notNull()
	},
	(t) => [
		foreignKey({
			name: 'narrative_connections_a_fk',
			columns: [t.projectId, t.endpointAId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'narrative_connections_b_fk',
			columns: [t.projectId, t.endpointBId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		foreignKey({
			name: 'narrative_connections_fact_fk',
			columns: [t.projectId, t.factArtifactId],
			foreignColumns: [artifacts.projectId, artifacts.id]
		}),
		index('narrative_connections_project_idx').on(t.projectId, t.createdAt)
	]
);

/** A human's explicit "this run meets policy X" act, with the report it was based on. */
export const completionCertifications = pgTable(
	'completion_certifications',
	{
		id: uuid('id').primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		policy: text('policy').notNull(),
		actorId: text('actor_id').notNull(),
		report: jsonb('report').$type<CompletionReport>().notNull(),
		createdAt: ts('created_at').notNull()
	},
	(t) => [index('completion_certifications_project_idx').on(t.projectId, t.createdAt)]
);

export type CompositeDefinitionRow = typeof compositeDefinitions.$inferSelect;
export type CompositeMemberRow = typeof compositeMembers.$inferSelect;

export type ProjectRow = typeof projects.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type RevisionRow = typeof artifactRevisions.$inferSelect;
export type RelationRow = typeof relations.$inferSelect;
export type ExpansionRow = typeof expansions.$inferSelect;
export type CandidateRow = typeof expansionCandidates.$inferSelect;
export type AgentPrincipalRow = typeof agentPrincipals.$inferSelect;
export type GrantRow = typeof grants.$inferSelect;
export type DisclosureRow = typeof disclosures.$inferSelect;
export type TransitionAnnotationRow = typeof transitionAnnotations.$inferSelect;
export type IssueDismissalRow = typeof issueDismissals.$inferSelect;
export type ProtocolRunRow = typeof protocolRuns.$inferSelect;
export type ProtocolTaskRow = typeof protocolTasks.$inferSelect;
export type TriangleRow = typeof triangles.$inferSelect;
export type FactCandidateRow = typeof factCandidates.$inferSelect;
export type NarrativeConnectionRow = typeof narrativeConnections.$inferSelect;
export type CompletionCertificationRow = typeof completionCertifications.$inferSelect;
export type FactAnchorRow = typeof factAnchors.$inferSelect;
