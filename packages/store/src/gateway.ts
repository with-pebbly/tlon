import { createHash, randomBytes } from 'node:crypto';

import {
	AGENT_TOKEN_PREFIX,
	type AgentList,
	type AgentPrincipal,
	type AuditPage,
	CreateAgentInput,
	CreateGrantInput,
	type Disclosure,
	type DisclosureList,
	type Grant,
	type GrantList,
	IssueTokenInput,
	type IssuedToken,
	type Principal,
	ProposeDisclosureInput,
	ReviewDisclosureInput,
	TlonError,
	type Role,
	type WhoAmI,
	parseStructured
} from '@tlon/contracts';
import { isActionAllowed } from '@tlon/core';
import { and, asc, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { decodeCursor, insertArtifact } from './artifacts.ts';
import type { Db } from './db.ts';
import {
	asUuid,
	audit,
	auditDecision,
	authorize,
	guardValidation,
	parseInput,
	type Ctx
} from './internal.ts';
import { getArtifactRow } from './projections.ts';
import {
	agentPrincipals,
	agentTokens,
	artifactRevisions,
	auditEvents,
	disclosures,
	grants,
	type AgentPrincipalRow,
	type DisclosureRow,
	type GrantRow
} from './schema.ts';

const AuditQuery = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	cursor: z.string().max(200).optional()
});

/** sha256 hex: the only form in which a token is ever stored or looked up. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function toAgent(row: AgentPrincipalRow): AgentPrincipal {
	return {
		id: row.id,
		projectId: row.projectId,
		role: row.role as AgentPrincipal['role'],
		name: row.name,
		executorKind: row.executorKind as AgentPrincipal['executorKind'],
		createdAt: row.createdAt.toISOString(),
		disabledAt: row.disabledAt?.toISOString() ?? null
	};
}

function toGrant(row: GrantRow): Grant {
	return {
		id: row.id,
		projectId: row.projectId,
		granteePrincipalId: row.granteePrincipalId,
		artifactId: row.artifactId,
		permission: 'READ',
		createdBy: row.createdBy,
		createdAt: row.createdAt.toISOString(),
		expiresAt: row.expiresAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null
	};
}

/** `recipientView` strips what the destination agent must never learn: the cited private sources. */
function toDisclosure(row: DisclosureRow, recipientView: boolean): Disclosure {
	return {
		id: row.id,
		projectId: row.projectId,
		fromPrincipalId: row.fromPrincipalId,
		toPrincipalId: row.toPrincipalId,
		sourceRefs: recipientView ? [] : row.sourceRefs,
		sharedPayload: row.sharedPayload as Disclosure['sharedPayload'],
		redactionNote: recipientView ? null : row.redactionNote,
		status: row.status as Disclosure['status'],
		sharedArtifactId: row.sharedArtifactId,
		reviewedBy: row.reviewedBy,
		createdAt: row.createdAt.toISOString(),
		reviewedAt: row.reviewedAt?.toISOString() ?? null
	};
}

async function findAgent(
	q: Db,
	projectId: string,
	principalId: string
): Promise<AgentPrincipalRow> {
	asUuid(principalId, 'PRINCIPAL_NOT_FOUND');
	const [row] = await q
		.select()
		.from(agentPrincipals)
		.where(and(eq(agentPrincipals.id, principalId), eq(agentPrincipals.projectId, projectId)));
	if (!row) throw new TlonError('PRINCIPAL_NOT_FOUND', 'principal not found', { principalId });
	return row;
}

export { toAgent };

export function gatewayMethods(ctx: Ctx) {
	const { db } = ctx;

	async function rejectAuth(
		reason: string,
		who?: { principalId: string; projectId: string; subjectId: string }
	): Promise<never> {
		try {
			await auditDecision(
				ctx,
				db,
				who?.principalId ?? 'anonymous',
				who?.projectId ?? null,
				'auth.token',
				who?.subjectId ?? null,
				'UNAUTHENTICATED',
				{ reason }
			);
		} catch {
			// Auditing must never turn a clean 401 into a 500.
		}
		throw new TlonError('UNAUTHENTICATED', 'invalid or expired credentials');
	}

	return {
		async whoami(principal: Principal): Promise<WhoAmI> {
			return {
				principalId: principal.id,
				kind: principal.kind,
				role: principal.role,
				projectId: principal.projectId
			};
		},

		/** Resolves a bearer token to its agent principal; every failure is the same UNAUTHENTICATED. */
		async authenticateToken(token: string): Promise<Principal> {
			if (
				typeof token !== 'string' ||
				!token.startsWith(AGENT_TOKEN_PREFIX) ||
				token.length > 256
			) {
				return rejectAuth('malformed');
			}
			const [row] = await db
				.select({ t: agentTokens, p: agentPrincipals })
				.from(agentTokens)
				.innerJoin(agentPrincipals, eq(agentPrincipals.id, agentTokens.principalId))
				.where(eq(agentTokens.tokenHash, hashToken(token)));
			if (!row) return rejectAuth('unknown');
			const who = { principalId: row.p.id, projectId: row.p.projectId, subjectId: row.t.id };
			if (row.t.revokedAt !== null) return rejectAuth('revoked', who);
			if (row.t.expiresAt.getTime() <= ctx.now().getTime()) return rejectAuth('expired', who);
			if (row.p.disabledAt !== null) return rejectAuth('disabled', who);
			return {
				id: row.p.id,
				kind: 'AGENT',
				role: row.p.role as Role,
				projectId: row.p.projectId
			};
		},

		/** For the transport layer: a request carried no usable credentials (e.g. tokenless non-loopback). */
		async recordUnauthenticated(reason: string): Promise<void> {
			await auditDecision(ctx, db, 'anonymous', null, 'auth.request', null, 'UNAUTHENTICATED', {
				reason: /^[a-z_]{1,64}$/.test(reason) ? reason : 'unspecified'
			});
		},

		async listAgents(principal: Principal, projectId: string): Promise<AgentList> {
			await authorize(db, principal, projectId, 'project.admin');
			const rows = await db
				.select()
				.from(agentPrincipals)
				.where(eq(agentPrincipals.projectId, projectId))
				.orderBy(asc(agentPrincipals.createdAt), asc(agentPrincipals.id));
			return { items: rows.map(toAgent) };
		},

		async createAgent(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<AgentPrincipal> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				const data = parseInput(CreateAgentInput, input);
				const [clash] = await tx
					.select({ id: agentPrincipals.id })
					.from(agentPrincipals)
					.where(
						and(
							eq(agentPrincipals.projectId, projectId),
							eq(agentPrincipals.role, data.role),
							eq(agentPrincipals.name, data.name)
						)
					);
				if (clash) {
					throw new TlonError('INVALID_STATE', 'an agent with this role and name already exists', {
						principalId: clash.id
					});
				}
				const [row] = await tx
					.insert(agentPrincipals)
					.values({
						id: ctx.newId(),
						projectId,
						role: data.role,
						name: data.name,
						executorKind: data.executorKind,
						createdAt: ctx.now(),
						disabledAt: null
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'agent insert returned no row');
				await audit(ctx, tx, principal, projectId, 'agent.create', row.id, { role: data.role });
				return toAgent(row);
			});
		},

		/** Disables the principal and revokes all of its tokens; takes effect on the next request. */
		async disableAgent(
			principal: Principal,
			projectId: string,
			principalId: string
		): Promise<AgentPrincipal> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				const agent = await findAgent(tx, projectId, principalId);
				const now = ctx.now();
				const [updated] = await tx
					.update(agentPrincipals)
					.set({ disabledAt: agent.disabledAt ?? now })
					.where(eq(agentPrincipals.id, agent.id))
					.returning();
				await tx
					.update(agentTokens)
					.set({ revokedAt: now })
					.where(and(eq(agentTokens.principalId, agent.id), isNull(agentTokens.revokedAt)));
				await audit(ctx, tx, principal, projectId, 'agent.disable', agent.id);
				return toAgent(updated ?? agent);
			});
		},

		async issueToken(
			principal: Principal,
			projectId: string,
			principalId: string,
			input: unknown = {}
		): Promise<IssuedToken> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				const data = parseInput(IssueTokenInput, input ?? {});
				const agent = await findAgent(tx, projectId, principalId);
				if (agent.disabledAt !== null) {
					throw new TlonError('INVALID_STATE', 'agent is disabled', { principalId });
				}
				const now = ctx.now();
				const expiresAt = new Date(now.getTime() + data.ttlSeconds * 1000);
				const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
				const tokenId = ctx.newId();
				await tx.insert(agentTokens).values({
					id: tokenId,
					principalId: agent.id,
					tokenHash: hashToken(token),
					createdAt: now,
					expiresAt,
					revokedAt: null
				});
				await audit(ctx, tx, principal, projectId, 'agent.token.issue', tokenId, {
					principalId: agent.id,
					ttlSeconds: data.ttlSeconds
				});
				return {
					tokenId,
					principalId: agent.id,
					token,
					expiresAt: expiresAt.toISOString()
				};
			});
		},

		async revokeToken(
			principal: Principal,
			projectId: string,
			principalId: string,
			tokenId: string
		): Promise<void> {
			await db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				const agent = await findAgent(tx, projectId, principalId);
				asUuid(tokenId, 'PRINCIPAL_NOT_FOUND');
				const [token] = await tx
					.select({ id: agentTokens.id })
					.from(agentTokens)
					.where(and(eq(agentTokens.id, tokenId), eq(agentTokens.principalId, agent.id)));
				if (!token) throw new TlonError('PRINCIPAL_NOT_FOUND', 'token not found', { tokenId });
				await tx
					.update(agentTokens)
					.set({ revokedAt: ctx.now() })
					.where(and(eq(agentTokens.id, tokenId), isNull(agentTokens.revokedAt)));
				await audit(ctx, tx, principal, projectId, 'agent.token.revoke', tokenId, {
					principalId: agent.id
				});
			});
		},

		async listGrants(principal: Principal, projectId: string): Promise<GrantList> {
			await authorize(db, principal, projectId, 'project.admin');
			const rows = await db
				.select()
				.from(grants)
				.where(eq(grants.projectId, projectId))
				.orderBy(asc(grants.createdAt), asc(grants.id));
			return { items: rows.map(toGrant) };
		},

		async createGrant(principal: Principal, projectId: string, input: unknown): Promise<Grant> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				const data = parseInput(CreateGrantInput, input);
				const agent = await findAgent(tx, projectId, data.granteePrincipalId);
				asUuid(data.artifactId, 'ARTIFACT_NOT_FOUND');
				await getArtifactRow(ctx, tx, principal, projectId, data.artifactId);
				const now = ctx.now();
				const expiresAt = data.expiresAt === undefined ? null : new Date(data.expiresAt);
				if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
					throw new TlonError('VALIDATION_FAILED', 'expiresAt must be in the future');
				}
				const [row] = await tx
					.insert(grants)
					.values({
						id: ctx.newId(),
						projectId,
						granteePrincipalId: agent.id,
						artifactId: data.artifactId,
						permission: 'READ',
						createdBy: principal.id,
						createdAt: now,
						expiresAt,
						revokedAt: null
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'grant insert returned no row');
				await audit(ctx, tx, principal, projectId, 'grant.create', row.id, {
					granteePrincipalId: agent.id,
					artifactId: data.artifactId
				});
				return toGrant(row);
			});
		},

		/** Prospective: the grantee's next request no longer sees the artifact. */
		async revokeGrant(principal: Principal, projectId: string, grantId: string): Promise<Grant> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				asUuid(grantId, 'GRANT_NOT_FOUND');
				const [row] = await tx
					.select()
					.from(grants)
					.where(and(eq(grants.id, grantId), eq(grants.projectId, projectId)))
					.for('update');
				if (!row) throw new TlonError('GRANT_NOT_FOUND', 'grant not found', { grantId });
				const [updated] = await tx
					.update(grants)
					.set({ revokedAt: row.revokedAt ?? ctx.now() })
					.where(eq(grants.id, grantId))
					.returning();
				await audit(ctx, tx, principal, projectId, 'grant.revoke', grantId, {
					granteePrincipalId: row.granteePrincipalId,
					artifactId: row.artifactId
				});
				return toGrant(updated ?? row);
			});
		},

		/** `disclosure.publish` (§7.4): C proposes; nothing is shared until a human publishes it. */
		async proposeDisclosure(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<Disclosure> {
			return db.transaction(async (tx) => {
				const project = await authorize(tx, principal, projectId, 'disclosure.propose');
				const data = parseInput(ProposeDisclosureInput, input);
				const destination = await findAgent(tx, projectId, data.destinationPrincipalId);
				if (destination.disabledAt !== null) {
					throw new TlonError('PRINCIPAL_NOT_FOUND', 'principal not found', {
						principalId: destination.id
					});
				}
				if (destination.role !== 'A' && destination.role !== 'B') {
					throw new TlonError('VALIDATION_FAILED', 'disclosures can only target an A or B agent');
				}
				for (const ref of data.sourceRefs) {
					asUuid(ref.artifactId, 'ARTIFACT_NOT_FOUND');
					await getArtifactRow(ctx, tx, principal, projectId, ref.artifactId);
					const [revision] = await tx
						.select({ id: artifactRevisions.id })
						.from(artifactRevisions)
						.where(
							and(
								eq(artifactRevisions.id, ref.revisionId),
								eq(artifactRevisions.artifactId, ref.artifactId)
							)
						);
					if (!revision) {
						throw new TlonError('REVISION_NOT_FOUND', 'revision not found', {
							artifactId: ref.artifactId,
							revisionId: ref.revisionId
						});
					}
				}
				const payload = data.sharedPayload;
				const structured = guardValidation(() =>
					parseStructured(
						project.domain as 'NARRATIVE' | 'GENERIC',
						payload.kind,
						payload.structured
					)
				);
				const [row] = await tx
					.insert(disclosures)
					.values({
						id: ctx.newId(),
						projectId,
						fromPrincipalId: principal.id,
						toPrincipalId: destination.id,
						sourceRefs: data.sourceRefs,
						sharedPayload: {
							kind: payload.kind,
							title: payload.title,
							body: payload.body,
							structured
						},
						redactionNote: data.redactionNote ?? null,
						status: 'PENDING',
						sharedArtifactId: null,
						reviewedBy: null,
						createdAt: ctx.now(),
						reviewedAt: null
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'disclosure insert returned no row');
				await audit(ctx, tx, principal, projectId, 'disclosure.propose', row.id, {
					toPrincipalId: destination.id,
					sourceRefs: data.sourceRefs
				});
				return toDisclosure(row, false);
			});
		},

		/**
		 * HUMAN/C see every disclosure of the project. A/B only learn about PUBLISHED disclosures
		 * addressed to them, without the cited sources or the redaction note.
		 */
		async listDisclosures(principal: Principal, projectId: string): Promise<DisclosureList> {
			await authorize(db, principal, projectId, 'project.read');
			if (isActionAllowed(principal, 'disclosure.read')) {
				const rows = await db
					.select()
					.from(disclosures)
					.where(eq(disclosures.projectId, projectId))
					.orderBy(asc(disclosures.createdAt), asc(disclosures.id));
				return { items: rows.map((r) => toDisclosure(r, false)) };
			}
			if (principal.role !== 'A' && principal.role !== 'B') {
				throw new TlonError('FORBIDDEN', 'principal may not perform this action', { projectId });
			}
			const rows = await db
				.select()
				.from(disclosures)
				.where(
					and(
						eq(disclosures.projectId, projectId),
						eq(disclosures.toPrincipalId, principal.id),
						eq(disclosures.status, 'PUBLISHED')
					)
				)
				.orderBy(asc(disclosures.createdAt), asc(disclosures.id));
			return { items: rows.map((r) => toDisclosure(r, true)) };
		},

		/**
		 * Human review. PUBLISH is one transaction: new C_SHARED artifact from the shared payload,
		 * a READ grant for the destination on that artifact only, disclosure marked PUBLISHED.
		 * The cited source artifacts are never granted.
		 */
		async reviewDisclosure(
			principal: Principal,
			projectId: string,
			disclosureId: string,
			input: unknown
		): Promise<Disclosure> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'disclosure.review');
				const data = parseInput(ReviewDisclosureInput, input);
				asUuid(disclosureId, 'DISCLOSURE_NOT_FOUND');
				const [row] = await tx
					.select()
					.from(disclosures)
					.where(and(eq(disclosures.id, disclosureId), eq(disclosures.projectId, projectId)))
					.for('update');
				if (!row) {
					throw new TlonError('DISCLOSURE_NOT_FOUND', 'disclosure not found', { disclosureId });
				}
				if (row.status !== 'PENDING') {
					throw new TlonError('INVALID_STATE', 'disclosure was already reviewed', {
						disclosureId,
						status: row.status
					});
				}
				const now = ctx.now();
				if (data.decision === 'REJECT') {
					const [rejected] = await tx
						.update(disclosures)
						.set({ status: 'REJECTED', reviewedBy: principal.id, reviewedAt: now })
						.where(eq(disclosures.id, disclosureId))
						.returning();
					await audit(ctx, tx, principal, projectId, 'disclosure.reject', disclosureId, {
						hasReason: data.reason !== undefined
					});
					return toDisclosure(rejected ?? row, false);
				}

				const [destination] = await tx
					.select()
					.from(agentPrincipals)
					.where(eq(agentPrincipals.id, row.toPrincipalId));
				if (!destination || destination.disabledAt !== null) {
					throw new TlonError('INVALID_STATE', 'destination agent is disabled', {
						disclosureId
					});
				}
				const payload = row.sharedPayload as Disclosure['sharedPayload'];
				const shared = await insertArtifact(
					ctx,
					tx,
					principal,
					projectId,
					{
						kind: payload.kind,
						title: payload.title,
						body: payload.body,
						structured: payload.structured,
						status: 'ACCEPTED',
						ownerScope: 'C_SHARED',
						locked: false,
						pinned: false
					},
					`disclosure ${disclosureId}`,
					'C'
				);
				const grantId = ctx.newId();
				await tx.insert(grants).values({
					id: grantId,
					projectId,
					granteePrincipalId: row.toPrincipalId,
					artifactId: shared.id,
					permission: 'READ',
					createdBy: principal.id,
					createdAt: now,
					expiresAt: null,
					revokedAt: null
				});
				const [published] = await tx
					.update(disclosures)
					.set({
						status: 'PUBLISHED',
						sharedArtifactId: shared.id,
						reviewedBy: principal.id,
						reviewedAt: now
					})
					.where(eq(disclosures.id, disclosureId))
					.returning();
				await audit(ctx, tx, principal, projectId, 'disclosure.publish', disclosureId, {
					sharedArtifactId: shared.id,
					grantId,
					toPrincipalId: row.toPrincipalId
				});
				return toDisclosure(published ?? row, false);
			});
		},

		/** The caller's own audit trail in this project, newest first. */
		async listOwnAudit(
			principal: Principal,
			projectId: string,
			query: unknown = {}
		): Promise<AuditPage> {
			await authorize(db, principal, projectId, 'project.read');
			const q = parseInput(AuditQuery, query);
			const filters: Array<SQL | undefined> = [
				eq(auditEvents.projectId, projectId),
				eq(auditEvents.actorId, principal.id)
			];
			if (q.cursor) {
				const { at, id } = decodeCursor(q.cursor);
				filters.push(
					or(
						lt(auditEvents.createdAt, at),
						and(eq(auditEvents.createdAt, at), lt(auditEvents.id, id))
					)
				);
			}
			const rows = await db
				.select()
				.from(auditEvents)
				.where(and(...filters))
				.orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
				.limit(q.limit + 1);
			const page = rows.slice(0, q.limit);
			const last = page.at(-1);
			return {
				items: page.map((r) => ({
					id: r.id,
					operation: r.operation,
					subjectId: r.subjectId,
					outcome: r.outcome,
					metadata: r.metadata,
					createdAt: r.createdAt.toISOString()
				})),
				nextCursor: rows.length > q.limit && last ? `${last.createdAt.getTime()}_${last.id}` : null
			};
		}
	};
}
