import {
	type AuditReport,
	CertifyInput,
	type Certification,
	CompletionPolicy,
	type CompletionReport,
	type ConnectionList,
	CreateConnectionInput,
	type InputManifest,
	type NarrativeConnection,
	type OwnerScope,
	type Principal,
	RunConfig,
	TlonError,
	UpdateConnectionInput
} from '@tlon/contracts';
import { completionReport, visibleScopesFor } from '@tlon/core';
import { and, asc, desc, eq, inArray, isNull, or, gt } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db.ts';
import { asUuid, audit, authorize, parseInput, type Ctx } from './internal.ts';
import {
	getArtifactRow,
	loadIssueList,
	loadLatestAnnotations,
	loadValidationGraph,
	selectArtifacts
} from './projections.ts';
import { assertEndpointsInProject } from './relations.ts';
import {
	agentPrincipals,
	artifacts,
	completionCertifications,
	grants,
	narrativeConnections,
	protocolRuns,
	protocolTasks,
	type CompletionCertificationRow,
	type NarrativeConnectionRow
} from './schema.ts';

const PolicyQuery = z.object({ policy: CompletionPolicy.optional() });

/** The private scope a participant role must never read (A ↔ B). */
const OPPOSITE_SCOPE: Record<'A' | 'B', OwnerScope> = { A: 'B_PRIVATE', B: 'A_PRIVATE' };

export function toConnection(row: NarrativeConnectionRow): NarrativeConnection {
	return {
		id: row.id,
		projectId: row.projectId,
		kind: row.kind as NarrativeConnection['kind'],
		endpointIds: [row.endpointAId, row.endpointBId],
		factArtifactId: row.factArtifactId,
		realizedByIds: row.realizedByIds,
		statement: row.statement,
		confidence: row.confidence as NarrativeConnection['confidence'],
		status: row.status as NarrativeConnection['status'],
		source: row.source as NarrativeConnection['source'],
		approvedBy: row.approvedBy,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

export function toCertification(row: CompletionCertificationRow): Certification {
	return {
		id: row.id,
		projectId: row.projectId,
		policy: row.policy as Certification['policy'],
		actorId: row.actorId,
		report: row.report,
		createdAt: row.createdAt.toISOString()
	};
}

export async function loadConnections(q: Db, projectId: string): Promise<NarrativeConnection[]> {
	const rows = await q
		.select()
		.from(narrativeConnections)
		.where(eq(narrativeConnections.projectId, projectId))
		.orderBy(asc(narrativeConnections.createdAt), asc(narrativeConnections.id));
	return rows.map(toConnection);
}

export async function loadCertifications(q: Db, projectId: string): Promise<Certification[]> {
	const rows = await q
		.select()
		.from(completionCertifications)
		.where(eq(completionCertifications.projectId, projectId))
		.orderBy(asc(completionCertifications.createdAt), asc(completionCertifications.id));
	return rows.map(toCertification);
}

/**
 * Manifest of what one executor was just served: ID-level only (artifact, pinned revision,
 * owner scope) plus the disclosure grants that made a non-base-visible artifact readable.
 */
export async function buildInputManifest(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	inputs: ReadonlyArray<{ artifactId: string; revisionId: string }>
): Promise<InputManifest> {
	const now = ctx.now();
	const unique = new Map(inputs.map((i) => [`${i.artifactId}:${i.revisionId}`, i]));
	const ids = [...new Set(inputs.map((i) => i.artifactId))];
	const scopeOf = new Map<string, OwnerScope>();
	if (ids.length > 0) {
		const rows = await q
			.select({ id: artifacts.id, scope: artifacts.ownerScope })
			.from(artifacts)
			.where(and(eq(artifacts.projectId, projectId), inArray(artifacts.id, ids)));
		for (const row of rows) scopeOf.set(row.id, row.scope as OwnerScope);
	}
	const base = visibleScopesFor(principal);
	const needGrant = ids.filter((id) => {
		const scope = scopeOf.get(id);
		return scope !== undefined && !base.includes(scope);
	});
	const grantRows =
		needGrant.length === 0
			? []
			: await q
					.select({ id: grants.id })
					.from(grants)
					.where(
						and(
							eq(grants.projectId, projectId),
							eq(grants.granteePrincipalId, principal.id),
							eq(grants.permission, 'READ'),
							inArray(grants.artifactId, needGrant),
							isNull(grants.revokedAt),
							or(isNull(grants.expiresAt), gt(grants.expiresAt, now))
						)
					)
					.orderBy(asc(grants.createdAt), asc(grants.id));
	return {
		servedAt: now.toISOString(),
		inputs: [...unique.values()].map((i) => ({
			artifactId: i.artifactId,
			revisionId: i.revisionId,
			ownerScope: scopeOf.get(i.artifactId) ?? 'PROJECT_PUBLIC'
		})),
		disclosureGrantIds: grantRows.map((g) => g.id)
	};
}

/**
 * Isolation audit (review P0): the manifests recorded when tasks were served, plus
 * server-side deny checks that run the real visibility predicate for every A/B participant
 * against every Block of the opposite private scope. Never contains text.
 */
export async function buildAudit(ctx: Ctx, q: Db, projectId: string): Promise<AuditReport> {
	const [taskRows, principalRows] = await Promise.all([
		q
			.select({ task: protocolTasks, executorKind: agentPrincipals.executorKind })
			.from(protocolTasks)
			.leftJoin(agentPrincipals, eq(agentPrincipals.id, protocolTasks.assigneePrincipalId))
			.where(eq(protocolTasks.projectId, projectId))
			.orderBy(asc(protocolTasks.createdAt), asc(protocolTasks.id)),
		q
			.select()
			.from(agentPrincipals)
			.where(
				and(eq(agentPrincipals.projectId, projectId), inArray(agentPrincipals.role, ['A', 'B']))
			)
			.orderBy(asc(agentPrincipals.createdAt), asc(agentPrincipals.id))
	]);

	const tasks: AuditReport['tasks'] = taskRows.map(({ task, executorKind }) => {
		const sideRole = task.role === 'A' || task.role === 'B' ? task.role : null;
		const forbidden = sideRole === null ? null : OPPOSITE_SCOPE[sideRole];
		return {
			taskId: task.id,
			type: task.type as AuditReport['tasks'][number]['type'],
			role: task.role as AuditReport['tasks'][number]['role'],
			executorKind: executorKind as AuditReport['tasks'][number]['executorKind'],
			stageIndex: task.stageIndex,
			state: task.state as AuditReport['tasks'][number]['state'],
			manifest: task.inputManifest,
			crossScopeInputIds:
				forbidden === null || task.inputManifest === null
					? []
					: task.inputManifest.inputs
							.filter((i) => i.ownerScope === forbidden)
							.map((i) => i.artifactId)
		};
	});

	const denyChecks: AuditReport['denyChecks'] = [];
	for (const row of principalRows) {
		if (row.role !== 'A' && row.role !== 'B') continue;
		const opposite = await q
			.select({ id: artifacts.id })
			.from(artifacts)
			.where(
				and(eq(artifacts.projectId, projectId), eq(artifacts.ownerScope, OPPOSITE_SCOPE[row.role]))
			);
		const ids = opposite.map((o) => o.id);
		const principal: Principal = {
			id: row.id,
			kind: 'AGENT',
			role: row.role,
			projectId
		};
		const visible =
			ids.length === 0
				? []
				: await selectArtifacts(ctx, q, principal, projectId, inArray(artifacts.id, ids));
		denyChecks.push({
			principalId: row.id,
			role: row.role,
			checkedArtifacts: ids.length,
			visibleArtifactIds: visible.map((a) => a.id)
		});
	}

	const served = tasks.filter((t) => (t.role === 'A' || t.role === 'B') && t.manifest !== null);
	const leaked =
		tasks.some((t) => t.crossScopeInputIds.length > 0) ||
		denyChecks.some((d) => d.visibleArtifactIds.length > 0);
	let isolationVerified: AuditReport['isolationVerified'];
	if (leaked) isolationVerified = false;
	else if (served.length === 0) isolationVerified = 'unknown';
	else isolationVerified = true;
	return { projectId, tasks, denyChecks, isolationVerified };
}

/** Completion policy a run was started with; the latest run wins, else exploratory. */
async function defaultPolicy(q: Db, projectId: string): Promise<CompletionPolicy> {
	const [run] = await q
		.select({ config: protocolRuns.config })
		.from(protocolRuns)
		.where(eq(protocolRuns.projectId, projectId))
		.orderBy(desc(protocolRuns.createdAt), desc(protocolRuns.id))
		.limit(1);
	return run ? RunConfig.parse(run.config).completionPolicy : 'exploratory';
}

export function completionMethods(ctx: Ctx) {
	const { db } = ctx;

	async function report(
		q: Db,
		principal: Principal,
		projectId: string,
		policy: CompletionPolicy | undefined
	): Promise<CompletionReport> {
		const resolved = policy ?? (await defaultPolicy(q, projectId));
		const [graph, issues, connections, auditReport, annotations] = await Promise.all([
			loadValidationGraph(ctx, q, principal, projectId),
			loadIssueList(ctx, q, principal, projectId),
			loadConnections(q, projectId),
			buildAudit(ctx, q, projectId),
			loadLatestAnnotations(ctx, q, principal, projectId)
		]);
		return completionReport({
			graph,
			connections: connections.filter((c) => c.status === 'active'),
			issues: issues.items,
			audit: auditReport,
			policy: resolved,
			transitions: new Map(annotations.map((a) => [a.artifactId, a.transition]))
		});
	}

	async function findConnection(q: Db, projectId: string, id: string) {
		asUuid(id, 'CONNECTION_NOT_FOUND');
		const [row] = await q
			.select()
			.from(narrativeConnections)
			.where(and(eq(narrativeConnections.projectId, projectId), eq(narrativeConnections.id, id)));
		if (!row) throw new TlonError('CONNECTION_NOT_FOUND', 'connection not found', { id });
		return row;
	}

	return {
		async listConnections(principal: Principal, projectId: string): Promise<ConnectionList> {
			await authorize(db, principal, projectId, 'connection.read');
			return { items: await loadConnections(db, projectId) };
		},

		async createConnection(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<NarrativeConnection> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'connection.write');
				const data = parseInput(CreateConnectionInput, input);
				if (data.endpointIds[0] === data.endpointIds[1]) {
					throw new TlonError('SELF_RELATION', 'a connection needs two different Blocks', {
						artifactId: data.endpointIds[0]
					});
				}
				if (data.source === 'ai_review' && (data.kind === 'causal_canon' || data.approve)) {
					throw new TlonError(
						'VALIDATION_FAILED',
						'an AI-review connection can be neither causal_canon nor approved',
						{ source: data.source }
					);
				}
				if (data.kind === 'causal_canon' && !data.approve) {
					throw new TlonError('VALIDATION_FAILED', 'causal_canon requires human approval', {
						kind: data.kind
					});
				}
				await assertEndpointsInProject(ctx, tx, principal, projectId, [
					...data.endpointIds,
					...data.realizedByIds,
					...(data.factArtifactId === undefined ? [] : [data.factArtifactId])
				]);
				if (data.factArtifactId !== undefined) {
					const { row } = await getArtifactRow(ctx, tx, principal, projectId, data.factArtifactId);
					if (row.artifactClass !== 'FACT') {
						throw new TlonError('VALIDATION_FAILED', 'factArtifactId must reference a Fact', {
							artifactId: row.id
						});
					}
				}
				const now = ctx.now();
				const [row] = await tx
					.insert(narrativeConnections)
					.values({
						id: ctx.newId(),
						projectId,
						kind: data.kind,
						endpointAId: data.endpointIds[0],
						endpointBId: data.endpointIds[1],
						factArtifactId: data.factArtifactId ?? null,
						realizedByIds: [...new Set(data.realizedByIds)],
						statement: data.statement,
						confidence: data.confidence,
						status: 'active',
						source: data.source,
						approvedBy: data.approve ? principal.id : null,
						createdAt: now,
						updatedAt: now
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'connection insert returned no row');
				await audit(ctx, tx, principal, projectId, 'connection.create', row.id, {
					kind: row.kind,
					source: row.source,
					approved: row.approvedBy !== null
				});
				return toConnection(row);
			});
		},

		async updateConnection(
			principal: Principal,
			projectId: string,
			connectionId: string,
			input: unknown
		): Promise<NarrativeConnection> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'connection.write');
				const data = parseInput(UpdateConnectionInput, input);
				const current = await findConnection(tx, projectId, connectionId);
				const kind = data.kind ?? (current.kind as NarrativeConnection['kind']);
				// connection.write is HUMAN-only: approving or promoting an AI-review suggestion
				// here IS the editorial act the review asks for (approvedBy records who did it).
				// AI review can only propose (enforced on create).
				// Leaving canon withdraws the approval that justified it unless re-approved.
				let approvedBy = current.approvedBy;
				if (data.approve === true) approvedBy = principal.id;
				else if (
					data.approve === false ||
					(current.kind === 'causal_canon' && kind !== 'causal_canon')
				) {
					approvedBy = null;
				}
				if (kind === 'causal_canon' && approvedBy === null) {
					throw new TlonError('VALIDATION_FAILED', 'causal_canon requires human approval', {
						connectionId
					});
				}
				const [row] = await tx
					.update(narrativeConnections)
					.set({
						kind,
						statement: data.statement ?? current.statement,
						status: data.status ?? current.status,
						approvedBy,
						updatedAt: ctx.now()
					})
					.where(eq(narrativeConnections.id, current.id))
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'connection update returned no row');
				await audit(ctx, tx, principal, projectId, 'connection.update', row.id, {
					kind: row.kind,
					status: row.status,
					approved: row.approvedBy !== null
				});
				return toConnection(row);
			});
		},

		async getCompletion(
			principal: Principal,
			projectId: string,
			query: unknown = {}
		): Promise<CompletionReport> {
			await authorize(db, principal, projectId, 'completion.read');
			const { policy } = parseInput(PolicyQuery, query);
			return report(db, principal, projectId, policy);
		},

		async certify(principal: Principal, projectId: string, input: unknown): Promise<Certification> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'completion.certify');
				const data = parseInput(CertifyInput, input);
				const snapshot = await report(tx, principal, projectId, data.policy);
				if (!snapshot.certifiable) {
					throw new TlonError('COMPLETION_BLOCKED', 'the project does not meet this policy', {
						policy: data.policy,
						reasons: snapshot.reasons
					});
				}
				const [row] = await tx
					.insert(completionCertifications)
					.values({
						id: ctx.newId(),
						projectId,
						policy: data.policy,
						actorId: principal.id,
						report: snapshot,
						createdAt: ctx.now()
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'certification insert returned no row');
				await audit(ctx, tx, principal, projectId, 'completion.certify', row.id, {
					policy: row.policy
				});
				return toCertification(row);
			});
		},

		async listCertifications(
			principal: Principal,
			projectId: string
		): Promise<{ items: Certification[] }> {
			await authorize(db, principal, projectId, 'completion.read');
			return { items: await loadCertifications(db, projectId) };
		},

		async getAudit(principal: Principal, projectId: string): Promise<AuditReport> {
			await authorize(db, principal, projectId, 'audit.read');
			return buildAudit(ctx, db, projectId);
		}
	};
}
