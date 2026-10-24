import {
	ACYCLIC_RELATION_TYPES,
	CreateRelationInput,
	TlonError,
	type Principal,
	type Relation,
	UpdateRelationInput
} from '@tlon/contracts';
import { assertRelationAcyclic } from '@tlon/core';
import { and, eq, ne } from 'drizzle-orm';

import type { Db } from './db.ts';
import { asUuid, audit, authorize, parseInput, type Ctx } from './internal.ts';
import { getArtifactRow, loadRelations } from './projections.ts';
import { artifacts, relations } from './schema.ts';

/**
 * Endpoints must be visible artifacts of `projectId`. Invisible, foreign-project and
 * nonexistent artifacts are indistinguishable for agents (ARTIFACT_NOT_FOUND); humans
 * additionally get the more specific CROSS_PROJECT_REFERENCE for another project's artifact.
 */
export async function assertEndpointsInProject(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	artifactIds: readonly string[]
): Promise<void> {
	const unique = [...new Set(artifactIds)];
	for (const id of unique) {
		try {
			await getArtifactRow(ctx, q, principal, projectId, id);
		} catch (error) {
			if (
				principal.kind === 'HUMAN' &&
				error instanceof TlonError &&
				error.code === 'ARTIFACT_NOT_FOUND'
			) {
				const [other] = await q
					.select({ projectId: artifacts.projectId })
					.from(artifacts)
					.where(eq(artifacts.id, id));
				if (other && other.projectId !== projectId) {
					throw new TlonError('CROSS_PROJECT_REFERENCE', 'artifact belongs to another project', {
						artifactId: id
					});
				}
			}
			throw error;
		}
	}
}

/** Cycle guard for the chronology-like relation types (§1); other types may form cycles. */
export async function assertAcyclicInProject(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	candidate: { fromId: string; toId: string; type: string; ignoreRelationId?: string }
): Promise<void> {
	if (!ACYCLIC_RELATION_TYPES.includes(candidate.type)) return;
	// Restricted principals only see (and are checked against) their own view of the graph:
	// a cycle error through hidden nodes would leak hidden structure.
	// TODO(M4 hidden-cycle recheck): agent-proposed relations are re-checked against the full
	// graph only when a human accepts them (updateRelation); hidden cycles are not rejected earlier.
	const existing = (
		await loadRelations(
			ctx,
			q,
			principal,
			projectId,
			and(eq(relations.type, candidate.type), ne(relations.status, 'REJECTED'))
		)
	).map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, type: r.type, status: r.status }));
	assertRelationAcyclic(existing, candidate);
}

export function relationMethods(ctx: Ctx) {
	const { db } = ctx;
	return {
		async createRelation(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<Relation> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'relation.create');
				const data = parseInput(CreateRelationInput, input);
				await assertEndpointsInProject(ctx, tx, principal, projectId, [data.fromId, data.toId]);
				if (data.fromId === data.toId) {
					throw new TlonError('SELF_RELATION', 'a relation must connect two different artifacts', {
						artifactId: data.fromId
					});
				}
				// Agent-proposed relations always start PROPOSED; only humans/review accept them.
				const status = principal.kind === 'AGENT' ? 'PROPOSED' : data.status;
				if (status !== 'REJECTED') {
					await assertAcyclicInProject(ctx, tx, principal, projectId, data);
				}
				const now = ctx.now();
				const id = ctx.newId();
				await tx.insert(relations).values({
					id,
					projectId,
					fromId: data.fromId,
					toId: data.toId,
					type: data.type,
					status,
					expansionId: null,
					provenanceArtifactIds: [],
					createdAt: now,
					updatedAt: now
				});
				await audit(ctx, tx, principal, projectId, 'relation.create', id, { type: data.type });
				const [created] = await loadRelations(ctx, tx, principal, projectId, eq(relations.id, id));
				if (!created) throw new TlonError('INTERNAL', 'relation vanished after insert');
				return created;
			});
		},

		async updateRelation(
			principal: Principal,
			projectId: string,
			id: string,
			input: unknown
		): Promise<Relation> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'relation.update');
				const patch = parseInput(UpdateRelationInput, input);
				asUuid(id, 'RELATION_NOT_FOUND');
				const [row] = await tx
					.select()
					.from(relations)
					.where(and(eq(relations.id, id), eq(relations.projectId, projectId)))
					.for('update');
				if (!row)
					throw new TlonError('RELATION_NOT_FOUND', 'relation not found', { relationId: id });
				const type = patch.type ?? row.type;
				const status = patch.status ?? row.status;
				const reopened =
					row.status === 'REJECTED' || (row.status === 'PROPOSED' && status === 'ACCEPTED');
				if (status !== 'REJECTED' && (type !== row.type || reopened)) {
					await assertAcyclicInProject(ctx, tx, principal, projectId, {
						fromId: row.fromId,
						toId: row.toId,
						type,
						ignoreRelationId: row.id
					});
				}
				await tx
					.update(relations)
					.set({ type, status, updatedAt: ctx.now() })
					.where(eq(relations.id, id));
				await audit(ctx, tx, principal, projectId, 'relation.update', id, {
					type: patch.type ?? null,
					status: patch.status ?? null
				});
				const [updated] = await loadRelations(ctx, tx, principal, projectId, eq(relations.id, id));
				if (!updated) throw new TlonError('INTERNAL', 'relation vanished after update');
				return updated;
			});
		}
	};
}
