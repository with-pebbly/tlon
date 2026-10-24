import {
	ACYCLIC_RELATION_TYPES,
	CreateRelationInput,
	TlonError,
	type Principal,
	type Relation,
	UpdateRelationInput
} from '@tlon/contracts';
import { assertRelationAcyclic } from '@tlon/core';
import { and, eq, inArray, ne } from 'drizzle-orm';

import type { Db } from './db.ts';
import { asUuid, audit, authorize, parseInput, type Ctx } from './internal.ts';
import { getArtifactRow, loadRelations } from './projections.ts';
import { artifacts, relations } from './schema.ts';

/** Endpoints must be visible artifacts of `projectId`; another project's artifact is a CROSS_PROJECT_REFERENCE. */
export async function assertEndpointsInProject(
	q: Db,
	principal: Principal,
	projectId: string,
	artifactIds: readonly string[]
): Promise<void> {
	const unique = [...new Set(artifactIds)];
	const found = await q
		.select({ id: artifacts.id, projectId: artifacts.projectId })
		.from(artifacts)
		.where(inArray(artifacts.id, unique));
	for (const id of unique) {
		const hit = found.find((f) => f.id === id);
		if (!hit) throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactId: id });
		if (hit.projectId !== projectId) {
			throw new TlonError('CROSS_PROJECT_REFERENCE', 'artifact belongs to another project', {
				artifactId: id
			});
		}
		await getArtifactRow(q, principal, projectId, id);
	}
}

/** Cycle guard for the chronology-like relation types (§1); other types may form cycles. */
export async function assertAcyclicInProject(
	q: Db,
	projectId: string,
	candidate: { fromId: string; toId: string; type: string; ignoreRelationId?: string }
): Promise<void> {
	if (!ACYCLIC_RELATION_TYPES.includes(candidate.type)) return;
	const existing = await q
		.select({
			id: relations.id,
			fromId: relations.fromId,
			toId: relations.toId,
			type: relations.type,
			status: relations.status
		})
		.from(relations)
		.where(
			and(
				eq(relations.projectId, projectId),
				eq(relations.type, candidate.type),
				ne(relations.status, 'REJECTED')
			)
		);
	assertRelationAcyclic(
		existing.map((r) => ({ ...r, status: r.status as Relation['status'] })),
		candidate
	);
}

export function relationMethods(ctx: Ctx) {
	const { db } = ctx;
	return {
		async createRelation(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<Relation> {
			const data = parseInput(CreateRelationInput, input);
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'write');
				await assertEndpointsInProject(tx, principal, projectId, [data.fromId, data.toId]);
				if (data.fromId === data.toId) {
					throw new TlonError('SELF_RELATION', 'a relation must connect two different artifacts', {
						artifactId: data.fromId
					});
				}
				if (data.status !== 'REJECTED') {
					await assertAcyclicInProject(tx, projectId, data);
				}
				const now = ctx.now();
				const id = ctx.newId();
				await tx.insert(relations).values({
					id,
					projectId,
					fromId: data.fromId,
					toId: data.toId,
					type: data.type,
					status: data.status,
					expansionId: null,
					provenanceArtifactIds: [],
					createdAt: now,
					updatedAt: now
				});
				await audit(ctx, tx, principal, projectId, 'relation.create', id, { type: data.type });
				const [created] = await loadRelations(tx, projectId, eq(relations.id, id));
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
			const patch = parseInput(UpdateRelationInput, input);
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'write');
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
				if (status !== 'REJECTED' && (type !== row.type || row.status === 'REJECTED')) {
					await assertAcyclicInProject(tx, projectId, {
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
				const [updated] = await loadRelations(tx, projectId, eq(relations.id, id));
				if (!updated) throw new TlonError('INTERNAL', 'relation vanished after update');
				return updated;
			});
		}
	};
}
