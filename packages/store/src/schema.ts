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

export type ProjectRow = typeof projects.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type RevisionRow = typeof artifactRevisions.$inferSelect;
export type RelationRow = typeof relations.$inferSelect;
export type ExpansionRow = typeof expansions.$inferSelect;
export type CandidateRow = typeof expansionCandidates.$inferSelect;
export type AgentPrincipalRow = typeof agentPrincipals.$inferSelect;
export type GrantRow = typeof grants.$inferSelect;
export type DisclosureRow = typeof disclosures.$inferSelect;
