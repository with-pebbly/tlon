import { z } from 'zod';

import { ArtifactKind, Role } from './enums.ts';
import { Uuid } from './models.ts';
import { StructuredRecord } from './structured.ts';

const IsoDate = z.iso.datetime({ offset: true });

/** Roles an agent principal may hold. HUMAN principals are never minted through the API. */
export const AGENT_ROLES = ['A', 'B', 'C', 'VALIDATOR'] as const;
export const AgentRole = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof AgentRole>;

/** Bearer scheme prefix for agent tokens: `Authorization: Bearer tlon_<secret>`. */
export const AGENT_TOKEN_PREFIX = 'tlon_';
export const DEFAULT_AGENT_TOKEN_TTL_SECONDS = 60 * 60;
export const MAX_AGENT_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Agent principal: one per (project, role, name). Identity is bound to a project;
 * its role comes from this record, never from request parameters (§7.2).
 */
export const AgentPrincipal = z.object({
	id: Uuid,
	projectId: Uuid,
	role: AgentRole,
	name: z.string(),
	createdAt: IsoDate,
	disabledAt: IsoDate.nullable()
});
export type AgentPrincipal = z.infer<typeof AgentPrincipal>;

export const CreateAgentInput = z.object({
	role: AgentRole,
	name: z.string().trim().min(1).max(100)
});
export type CreateAgentInput = z.input<typeof CreateAgentInput>;

export const IssueTokenInput = z.object({
	ttlSeconds: z
		.int()
		.min(60)
		.max(MAX_AGENT_TOKEN_TTL_SECONDS)
		.default(DEFAULT_AGENT_TOKEN_TTL_SECONDS)
});
export type IssueTokenInput = z.input<typeof IssueTokenInput>;

/** Returned once; only a hash of `token` is stored. */
export const IssuedToken = z.object({
	tokenId: Uuid,
	principalId: Uuid,
	token: z.string(),
	expiresAt: IsoDate
});
export type IssuedToken = z.infer<typeof IssuedToken>;

export const AgentList = z.object({ items: z.array(AgentPrincipal) });
export type AgentList = z.infer<typeof AgentList>;

export const GRANT_PERMISSIONS = ['READ'] as const;
export const GrantPermission = z.enum(GRANT_PERMISSIONS);

export const Grant = z.object({
	id: Uuid,
	projectId: Uuid,
	granteePrincipalId: Uuid,
	artifactId: Uuid,
	permission: GrantPermission,
	createdBy: z.string(),
	createdAt: IsoDate,
	expiresAt: IsoDate.nullable(),
	revokedAt: IsoDate.nullable()
});
export type Grant = z.infer<typeof Grant>;

/** `POST /grants` body (HUMAN only): explicit READ grant of one artifact to one agent principal. */
export const CreateGrantInput = z.object({
	granteePrincipalId: Uuid,
	artifactId: Uuid,
	expiresAt: IsoDate.optional()
});
export type CreateGrantInput = z.input<typeof CreateGrantInput>;

export const GrantList = z.object({ items: z.array(Grant) });
export type GrantList = z.infer<typeof GrantList>;

export const DISCLOSURE_STATUSES = ['PENDING', 'PUBLISHED', 'REJECTED'] as const;
export const DisclosureStatus = z.enum(DISCLOSURE_STATUSES);
export type DisclosureStatus = z.infer<typeof DisclosureStatus>;

/** Pinned source revision cited by a disclosure (exact text C saw). */
export const SourceRef = z.object({ artifactId: Uuid, revisionId: Uuid });
export type SourceRef = z.infer<typeof SourceRef>;

/** Purpose-built shared payload; becomes a NEW C_SHARED artifact on publish (§7.3 step 5). */
export const SharedPayload = z.object({
	kind: ArtifactKind.default('NOTE'),
	title: z.string().trim().min(1).max(300),
	body: z.string().max(100_000).default(''),
	structured: StructuredRecord.default({})
});
export type SharedPayload = z.input<typeof SharedPayload>;

/** `disclosure.publish` (§7.4) — C only. Creates a PENDING disclosure awaiting human approval. */
export const ProposeDisclosureInput = z.object({
	destinationPrincipalId: Uuid,
	sourceRefs: z.array(SourceRef).min(1).max(50),
	sharedPayload: SharedPayload,
	redactionNote: z.string().trim().max(2000).optional()
});
export type ProposeDisclosureInput = z.input<typeof ProposeDisclosureInput>;

export const ReviewDisclosureInput = z.object({
	decision: z.enum(['PUBLISH', 'REJECT']),
	reason: z.string().trim().max(1000).optional()
});
export type ReviewDisclosureInput = z.input<typeof ReviewDisclosureInput>;

export const Disclosure = z.object({
	id: Uuid,
	projectId: Uuid,
	fromPrincipalId: z.string(),
	toPrincipalId: Uuid,
	sourceRefs: z.array(SourceRef),
	sharedPayload: SharedPayload.extend({
		kind: ArtifactKind,
		body: z.string(),
		structured: StructuredRecord
	}),
	redactionNote: z.string().nullable(),
	status: DisclosureStatus,
	/** C_SHARED artifact created on publish; the destination gets a READ grant on it only. */
	sharedArtifactId: Uuid.nullable(),
	reviewedBy: z.string().nullable(),
	createdAt: IsoDate,
	reviewedAt: IsoDate.nullable()
});
export type Disclosure = z.infer<typeof Disclosure>;

export const DisclosureList = z.object({ items: z.array(Disclosure) });
export type DisclosureList = z.infer<typeof DisclosureList>;

/** Who the caller is, as resolved by the gateway. */
export const WhoAmI = z.object({
	principalId: z.string(),
	kind: z.enum(['HUMAN', 'AGENT']),
	role: Role,
	projectId: Uuid.nullable()
});
export type WhoAmI = z.infer<typeof WhoAmI>;

/** Own audit trail (`audit.get_own`); metadata holds IDs only. */
export const AuditEvent = z.object({
	id: Uuid,
	operation: z.string(),
	subjectId: z.string().nullable(),
	outcome: z.string(),
	metadata: z.record(z.string(), z.unknown()),
	createdAt: IsoDate
});
export const AuditPage = z.object({
	items: z.array(AuditEvent),
	nextCursor: z.string().nullable()
});
export type AuditPage = z.infer<typeof AuditPage>;
