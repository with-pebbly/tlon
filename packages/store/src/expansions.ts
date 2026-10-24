import { createHash } from 'node:crypto';

import {
	AcceptExpansionInput,
	type AcceptExpansionResult,
	BridgeStructured,
	CreateExpansionInput,
	DEFAULT_CHILD_RELATION_TYPE,
	type ExpansionDetail,
	TlonError,
	IdempotencyKey,
	OPEN_EXPANSION_STATUSES,
	ProjectSettings,
	NarrativeStructured,
	type Principal,
	RejectExpansionInput,
	SubmitCandidateInput
} from '@tlon/contracts';
import {
	acceptanceFingerprint,
	assertCandidateArtifactAllowed,
	assertDepthWithinLimit,
	candidateIssues,
	planChildRelations,
	creationScopeFor,
	resolveExpansionParent
} from '@tlon/core';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { appendRevision, insertArtifact } from './artifacts.ts';
import type { Db } from './db.ts';
import { asUuid, audit, authorize, guardValidation, parseInput, type Ctx } from './internal.ts';
import {
	getArtifactRow,
	loadDismissals,
	loadExpansion,
	loadExpansionDetail,
	loadLatestAnnotations,
	loadLineage,
	loadRelations,
	loadValidationGraph,
	selectArtifacts
} from './projections.ts';
import { assertAcyclicInProject, assertEndpointsInProject } from './relations.ts';
import {
	artifacts,
	expansionCandidates,
	expansions,
	relations,
	type ExpansionRow
} from './schema.ts';
import { insertAnnotation } from './validation.ts';

const OPEN: readonly string[] = OPEN_EXPANSION_STATUSES;

async function lockExpansion(q: Db, projectId: string, expansionId: string): Promise<ExpansionRow> {
	asUuid(expansionId, 'EXPANSION_NOT_FOUND');
	const [row] = await q
		.select()
		.from(expansions)
		.where(and(eq(expansions.id, expansionId), eq(expansions.projectId, projectId)))
		.for('update');
	if (!row) throw new TlonError('EXPANSION_NOT_FOUND', 'expansion not found', { expansionId });
	return row;
}

/**
 * Marks a no-longer-wanted candidate artifact REJECTED. Only untouched proposals are
 * rejected: an existing accepted/locked artifact that was merely nominated stays as is.
 */
async function rejectCandidateArtifact(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	artifactId: string,
	reason: string
): Promise<void> {
	const current = await getArtifactRow(ctx, q, principal, projectId, artifactId);
	if (current.row.status !== 'PROPOSED' || current.row.locked) return;
	await appendRevision(ctx, q, principal, current, { status: 'REJECTED' }, reason);
}

export function expansionMethods(ctx: Ctx) {
	const { db } = ctx;

	async function buildAcceptResult(
		q: Db,
		principal: Principal,
		projectId: string,
		expansionId: string,
		replayed: boolean
	): Promise<AcceptExpansionResult> {
		const expansion = await loadExpansion(q, projectId, expansionId);
		if (expansion.selectedBridgeArtifactId === null) {
			throw new TlonError('INTERNAL', 'accepted expansion has no selected bridge');
		}
		const [bridge] = await selectArtifacts(
			ctx,
			q,
			principal,
			projectId,
			eq(artifacts.id, expansion.selectedBridgeArtifactId)
		);
		const children = await loadRelations(
			ctx,
			q,
			principal,
			projectId,
			eq(relations.expansionId, expansionId)
		);
		const ordered = expansion.childRelationIds.flatMap((id) => children.filter((c) => c.id === id));
		const [first, second] = ordered;
		if (!bridge || !first || !second) {
			throw new TlonError(
				'INTERNAL',
				'accepted expansion is missing its bridge or child relations'
			);
		}
		return { expansion, bridge, childRelations: [first, second], replayed };
	}

	return {
		async createExpansion(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<ExpansionDetail> {
			return db.transaction(async (tx) => {
				const project = await authorize(tx, principal, projectId, 'expansion.open');
				const data = parseInput(CreateExpansionInput, input);
				let leftId: string;
				let rightId: string;
				let target: typeof relations.$inferSelect | null = null;
				if (data.targetRelationId !== undefined) {
					asUuid(data.targetRelationId, 'RELATION_NOT_FOUND');
					const [row] = await tx
						.select()
						.from(relations)
						.where(and(eq(relations.id, data.targetRelationId), eq(relations.projectId, projectId)))
						.for('update');
					if (!row) {
						throw new TlonError('RELATION_NOT_FOUND', 'relation not found', {
							relationId: data.targetRelationId
						});
					}
					if (row.status === 'REJECTED') {
						throw new TlonError('INVALID_STATE', 'a rejected relation cannot be expanded', {
							relationId: row.id
						});
					}
					if (
						(data.leftArtifactId !== undefined && data.leftArtifactId !== row.fromId) ||
						(data.rightArtifactId !== undefined && data.rightArtifactId !== row.toId)
					) {
						throw new TlonError(
							'VALIDATION_FAILED',
							'leftArtifactId/rightArtifactId do not match the target relation'
						);
					}
					target = row;
					leftId = row.fromId;
					rightId = row.toId;
				} else {
					leftId = data.leftArtifactId as string;
					rightId = data.rightArtifactId as string;
				}
				await assertEndpointsInProject(ctx, tx, principal, projectId, [leftId, rightId]);
				if (leftId === rightId) {
					throw new TlonError('SELF_RELATION', 'an expansion needs two different anchors', {
						artifactId: leftId
					});
				}

				const existing = await tx
					.select({ id: expansions.id, status: expansions.status })
					.from(expansions)
					.where(
						and(
							eq(expansions.projectId, projectId),
							inArray(expansions.status, [...OPEN, 'ACCEPTED']),
							target
								? eq(expansions.targetRelationId, target.id)
								: and(
										isNull(expansions.targetRelationId),
										eq(expansions.leftArtifactId, leftId),
										eq(expansions.rightArtifactId, rightId)
									)
						)
					);
				const accepted = existing.find((e) => e.status === 'ACCEPTED');
				if (accepted) {
					throw new TlonError(
						'ALREADY_EXPANDED',
						'this interval already has an accepted expansion',
						{
							expansionId: accepted.id
						}
					);
				}
				const open = existing[0];
				if (open) {
					throw new TlonError(
						'DUPLICATE_EXPANSION',
						'an open expansion already exists for this interval',
						{
							expansionId: open.id
						}
					);
				}

				const parents = new Map<string, { id: string; depth: number }>();
				if (target?.expansionId) {
					const [parent] = await tx
						.select({ id: expansions.id, depth: expansions.depth })
						.from(expansions)
						.where(and(eq(expansions.id, target.expansionId), eq(expansions.projectId, projectId)));
					if (parent) parents.set(parent.id, parent);
				}
				const { parentExpansionId, depth } = resolveExpansionParent(target, parents);
				assertDepthWithinLimit(depth, ProjectSettings.parse(project.settings));

				const heads = await tx
					.select({ id: artifacts.id, head: artifacts.headRevisionId })
					.from(artifacts)
					.where(inArray(artifacts.id, [leftId, rightId]));
				const leftRevisionId = heads.find((h) => h.id === leftId)?.head;
				const rightRevisionId = heads.find((h) => h.id === rightId)?.head;
				if (!leftRevisionId || !rightRevisionId) {
					throw new TlonError('ARTIFACT_NOT_FOUND', 'anchor artifact not found');
				}

				const now = ctx.now();
				const id = ctx.newId();
				await tx.insert(expansions).values({
					id,
					projectId,
					targetRelationId: target?.id ?? null,
					leftArtifactId: leftId,
					rightArtifactId: rightId,
					leftRevisionId,
					rightRevisionId,
					parentExpansionId,
					depth,
					status: 'PENDING',
					attempts: 0,
					createdAt: now,
					updatedAt: now
				});
				await audit(ctx, tx, principal, projectId, 'expansion.create', id, {
					targetRelationId: target?.id ?? null,
					depth
				});
				return loadExpansionDetail(ctx, tx, principal, projectId, id);
			});
		},

		async getExpansion(
			principal: Principal,
			projectId: string,
			id: string
		): Promise<ExpansionDetail> {
			await authorize(db, principal, projectId, 'expansion.read');
			asUuid(id, 'EXPANSION_NOT_FOUND');
			return loadExpansionDetail(ctx, db, principal, projectId, id);
		},

		async submitCandidate(
			principal: Principal,
			projectId: string,
			expansionId: string,
			input: unknown
		): Promise<ExpansionDetail> {
			return db.transaction(async (tx) => {
				const project = await authorize(tx, principal, projectId, 'expansion.submit_candidate');
				const data = parseInput(SubmitCandidateInput, input);
				const expansion = await lockExpansion(tx, projectId, expansionId);
				if (!OPEN.includes(expansion.status)) {
					throw new TlonError('INVALID_STATE', 'expansion no longer accepts candidates', {
						expansionId,
						status: expansion.status
					});
				}
				const { maxCandidates } = ProjectSettings.parse(project.settings);
				const [{ active } = { active: 0 }] = await tx
					.select({ active: sql<number>`count(*)::int` })
					.from(expansionCandidates)
					.where(
						and(
							eq(expansionCandidates.expansionId, expansionId),
							ne(expansionCandidates.reviewStatus, 'REJECTED')
						)
					);
				if (active >= maxCandidates) {
					throw new TlonError(
						'CANDIDATE_LIMIT_EXCEEDED',
						`expansion already has ${maxCandidates} open candidates`,
						{
							expansionId,
							maxCandidates
						}
					);
				}

				let artifactId: string;
				if ('existingArtifactId' in data) {
					asUuid(data.existingArtifactId, 'ARTIFACT_NOT_FOUND');
					await assertEndpointsInProject(ctx, tx, principal, projectId, [data.existingArtifactId]);
					const lineage = await loadLineage(tx, projectId, expansion.parentExpansionId);
					assertCandidateArtifactAllowed(data.existingArtifactId, expansion, lineage);
					const [dup] = await tx
						.select({ id: expansionCandidates.id })
						.from(expansionCandidates)
						.where(
							and(
								eq(expansionCandidates.expansionId, expansionId),
								eq(expansionCandidates.artifactId, data.existingArtifactId)
							)
						);
					if (dup) {
						throw new TlonError(
							'INVALID_STATE',
							'artifact is already a candidate of this expansion',
							{
								artifactId: data.existingArtifactId
							}
						);
					}
					artifactId = data.existingArtifactId;
				} else {
					const structured = guardValidation(() => {
						const bridge = BridgeStructured.parse(data.artifact.structured);
						return project.domain === 'NARRATIVE' ? NarrativeStructured.parse(bridge) : bridge;
					});
					// Candidates a C agent creates are C_SHARED (forced); human-authored ones stay PROJECT_PUBLIC.
					const ownerScope = creationScopeFor(principal, 'PROJECT_PUBLIC');
					if (ownerScope === null) {
						throw new TlonError('FORBIDDEN', 'principal may not create artifacts', { projectId });
					}
					const created = await insertArtifact(
						ctx,
						tx,
						principal,
						projectId,
						{
							kind: data.artifact.kind,
							title: data.artifact.title,
							body: data.artifact.body,
							structured,
							status: 'PROPOSED',
							ownerScope,
							locked: false,
							pinned: false
						},
						`proposed as candidate of expansion ${expansionId}`
					);
					artifactId = created.id;
				}

				const now = ctx.now();
				const candidateId = ctx.newId();
				await tx.insert(expansionCandidates).values({
					id: candidateId,
					projectId,
					expansionId,
					artifactId,
					score: data.score ?? { validation: [] },
					reviewStatus: 'PENDING',
					createdAt: now
				});
				await tx
					.update(expansions)
					.set({ status: 'REVIEW', attempts: expansion.attempts + 1, updatedAt: ctx.now() })
					.where(eq(expansions.id, expansionId));
				let annotationId: string | null = null;
				if (data.transition !== undefined) {
					const head = await getArtifactRow(ctx, tx, principal, projectId, artifactId);
					const annotation = await insertAnnotation(ctx, tx, principal, projectId, {
						artifactId,
						artifactRevisionId: head.row.headRevisionId,
						transition: data.transition,
						source: 'author',
						reviewed: false
					});
					annotationId = annotation.id;
				}
				await audit(ctx, tx, principal, projectId, 'expansion.candidate.submit', expansionId, {
					candidateId,
					artifactId,
					...(annotationId === null ? {} : { annotationId })
				});
				return loadExpansionDetail(ctx, tx, principal, projectId, expansionId);
			});
		},

		async acceptExpansion(
			principal: Principal,
			projectId: string,
			expansionId: string,
			idempotencyKey: string | undefined,
			input: unknown
		): Promise<AcceptExpansionResult> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'expansion.review');
				if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
					throw new TlonError(
						'IDEMPOTENCY_KEY_REQUIRED',
						'an Idempotency-Key is required to accept an expansion'
					);
				}
				const key = parseInput(IdempotencyKey, idempotencyKey);
				const data = parseInput(AcceptExpansionInput, input);
				const row = await lockExpansion(tx, projectId, expansionId);
				const leftRelationType = data.leftRelationType ?? DEFAULT_CHILD_RELATION_TYPE;
				const rightRelationType = data.rightRelationType ?? DEFAULT_CHILD_RELATION_TYPE;
				const fingerprintHash = createHash('sha256')
					.update(
						acceptanceFingerprint({
							expansion: row,
							candidateId: data.candidateId,
							leftRelationType,
							rightRelationType
						})
					)
					.digest('hex');

				const [keyElsewhere] = await tx
					.select({ id: expansions.id })
					.from(expansions)
					.where(
						and(
							eq(expansions.projectId, projectId),
							eq(expansions.acceptIdempotencyKey, key),
							ne(expansions.id, expansionId)
						)
					);
				if (keyElsewhere) {
					throw new TlonError(
						'IDEMPOTENCY_KEY_REUSED',
						'idempotency key was used for a different expansion'
					);
				}
				if (row.status === 'ACCEPTED') {
					if (row.acceptIdempotencyKey !== key) {
						throw new TlonError('ALREADY_ACCEPTED', 'expansion was already accepted', {
							expansionId
						});
					}
					if (row.acceptFingerprintHash !== fingerprintHash) {
						throw new TlonError(
							'IDEMPOTENCY_KEY_REUSED',
							'idempotency key was used for a different request',
							{
								expansionId
							}
						);
					}
					return buildAcceptResult(tx, principal, projectId, expansionId, true);
				}
				if (!OPEN.includes(row.status)) {
					throw new TlonError('INVALID_STATE', 'expansion is not open', {
						expansionId,
						status: row.status
					});
				}

				asUuid(data.candidateId, 'CANDIDATE_NOT_FOUND');
				const candidates = await tx
					.select()
					.from(expansionCandidates)
					.where(eq(expansionCandidates.expansionId, expansionId));
				const chosen = candidates.find((c) => c.id === data.candidateId);
				if (!chosen) {
					throw new TlonError('CANDIDATE_NOT_FOUND', 'candidate not found on this expansion', {
						candidateId: data.candidateId
					});
				}
				if (chosen.reviewStatus !== 'PENDING') {
					throw new TlonError('INVALID_STATE', 'candidate is no longer pending', {
						candidateId: chosen.id,
						reviewStatus: chosen.reviewStatus
					});
				}

				const heads = await tx
					.select({ id: artifacts.id, head: artifacts.headRevisionId })
					.from(artifacts)
					.where(inArray(artifacts.id, [row.leftArtifactId, row.rightArtifactId]));
				const stale = [
					{ side: 'left', artifactId: row.leftArtifactId, pinned: row.leftRevisionId },
					{ side: 'right', artifactId: row.rightArtifactId, pinned: row.rightRevisionId }
				].flatMap((anchor) => {
					const current = heads.find((h) => h.id === anchor.artifactId)?.head ?? null;
					return current === anchor.pinned
						? []
						: [{ ...anchor, pinnedRevisionId: anchor.pinned, currentRevisionId: current }];
				});
				if (stale.length > 0) {
					throw new TlonError(
						'STALE_ANCHOR_REVISION',
						'an anchor changed after the expansion was opened',
						{
							stale: stale.map(({ side, artifactId, pinnedRevisionId, currentRevisionId }) => ({
								side,
								artifactId,
								pinnedRevisionId,
								currentRevisionId
							}))
						}
					);
				}

				const bridge = await getArtifactRow(ctx, tx, principal, projectId, chosen.artifactId);
				if (bridge.row.locked) {
					throw new TlonError('ARTIFACT_LOCKED', 'bridge artifact is locked', {
						artifactId: bridge.row.id
					});
				}
				// Continuity gate: the candidate's latest annotation is checked against the whole committed
				// path. No annotation → nothing to check. Replays returned above and never reach here.
				const annotations = new Map(
					(await loadLatestAnnotations(ctx, tx, principal, projectId)).map((a) => [a.artifactId, a])
				);
				const chosenAnnotation = annotations.get(chosen.artifactId);
				let acknowledged: string[] = [];
				if (chosenAnnotation) {
					const [graph, dismissals] = await Promise.all([
						loadValidationGraph(ctx, tx, principal, projectId),
						loadDismissals(tx, projectId)
					]);
					const blockers = candidateIssues(graph, annotations, {
						expansionId,
						artifactId: chosen.artifactId,
						transition: chosenAnnotation.transition
					}).filter((issue) => issue.severity === 'blocker' && !dismissals.has(issue.key));
					if (blockers.length > 0) {
						if (principal.role !== 'HUMAN' || data.acknowledgeIssues === undefined) {
							// Keys and ids only: explanations may quote artifact titles.
							throw new TlonError(
								'CONTINUITY_VIOLATION',
								'accepting this candidate would break the continuity of the committed path',
								{
									issues: blockers.map(({ key, kind, severity, artifactIds, stateKey }) => ({
										key,
										kind,
										severity,
										artifactIds,
										stateKey
									}))
								}
							);
						}
						acknowledged = blockers.map((issue) => issue.key);
					}
				}
				const baseReason = data.reason
					? `accepted as bridge of expansion ${expansionId}: ${data.reason}`
					: `accepted as bridge of expansion ${expansionId}`;
				const accepted = await appendRevision(
					ctx,
					tx,
					principal,
					bridge,
					{ status: 'ACCEPTED' },
					acknowledged.length > 0
						? `${baseReason} [acknowledged continuity issues ${acknowledged.join(', ')}: ${data.acknowledgeIssues}]`
						: baseReason
				);
				// Carry a current annotation onto the accepted revision so it is not reported as stale.
				if (chosenAnnotation && chosenAnnotation.artifactRevisionId === bridge.row.headRevisionId) {
					await insertAnnotation(ctx, tx, principal, projectId, {
						artifactId: chosen.artifactId,
						artifactRevisionId: accepted.row.headRevisionId,
						transition: chosenAnnotation.transition,
						source: chosenAnnotation.source,
						reviewed: true
					});
				}
				for (const other of candidates) {
					if (other.id === chosen.id || other.reviewStatus !== 'PENDING') continue;
					await tx
						.update(expansionCandidates)
						.set({ reviewStatus: 'NOT_SELECTED' })
						.where(eq(expansionCandidates.id, other.id));
					await rejectCandidateArtifact(
						ctx,
						tx,
						principal,
						projectId,
						other.artifactId,
						`not selected for expansion ${expansionId}`
					);
				}
				await tx
					.update(expansionCandidates)
					.set({ reviewStatus: 'SELECTED' })
					.where(eq(expansionCandidates.id, chosen.id));

				const planned = planChildRelations(row, chosen.artifactId, {
					leftRelationType: data.leftRelationType,
					rightRelationType: data.rightRelationType
				});
				const childIds: string[] = [];
				for (const child of planned) {
					await assertAcyclicInProject(ctx, tx, principal, projectId, child);
					const now = ctx.now();
					const id = ctx.newId();
					await tx.insert(relations).values({
						id,
						projectId,
						fromId: child.fromId,
						toId: child.toId,
						type: child.type,
						status: 'ACCEPTED',
						expansionId,
						provenanceArtifactIds: child.provenanceArtifactIds,
						createdAt: now,
						updatedAt: now
					});
					childIds.push(id);
				}

				const acceptedAt = ctx.now();
				await tx
					.update(expansions)
					.set({
						status: 'ACCEPTED',
						selectedBridgeArtifactId: chosen.artifactId,
						acceptedAt,
						updatedAt: acceptedAt,
						acceptIdempotencyKey: key,
						acceptFingerprintHash: fingerprintHash
					})
					.where(eq(expansions.id, expansionId));
				await audit(ctx, tx, principal, projectId, 'expansion.accept', expansionId, {
					candidateId: chosen.id,
					bridgeArtifactId: chosen.artifactId,
					childRelationIds: childIds,
					...(acknowledged.length > 0 ? { acknowledgedIssueKeys: acknowledged } : {})
				});
				return buildAcceptResult(tx, principal, projectId, expansionId, false);
			});
		},

		async rejectExpansion(
			principal: Principal,
			projectId: string,
			expansionId: string,
			input: unknown = {}
		): Promise<ExpansionDetail> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'expansion.review');
				const data = parseInput(RejectExpansionInput, input);
				const row = await lockExpansion(tx, projectId, expansionId);
				if (!OPEN.includes(row.status)) {
					throw new TlonError('INVALID_STATE', 'expansion is already final', {
						expansionId,
						status: row.status
					});
				}
				const candidates = await tx
					.select()
					.from(expansionCandidates)
					.where(eq(expansionCandidates.expansionId, expansionId));
				const reason = data.reason
					? `rejected in expansion ${expansionId}: ${data.reason}`
					: `rejected in expansion ${expansionId}`;

				if (data.candidateId !== undefined) {
					asUuid(data.candidateId, 'CANDIDATE_NOT_FOUND');
					const target = candidates.find((c) => c.id === data.candidateId);
					if (!target) {
						throw new TlonError('CANDIDATE_NOT_FOUND', 'candidate not found on this expansion', {
							candidateId: data.candidateId
						});
					}
					if (target.reviewStatus !== 'PENDING') {
						throw new TlonError('INVALID_STATE', 'candidate is no longer pending', {
							candidateId: target.id,
							reviewStatus: target.reviewStatus
						});
					}
					await tx
						.update(expansionCandidates)
						.set({ reviewStatus: 'REJECTED' })
						.where(eq(expansionCandidates.id, target.id));
					await rejectCandidateArtifact(ctx, tx, principal, projectId, target.artifactId, reason);
					const stillPending = candidates.some(
						(c) => c.id !== target.id && c.reviewStatus === 'PENDING'
					);
					await tx
						.update(expansions)
						.set({ status: stillPending ? row.status : 'PENDING', updatedAt: ctx.now() })
						.where(eq(expansions.id, expansionId));
					await audit(ctx, tx, principal, projectId, 'expansion.candidate.reject', expansionId, {
						candidateId: target.id
					});
				} else {
					for (const candidate of candidates) {
						if (candidate.reviewStatus !== 'PENDING') continue;
						await tx
							.update(expansionCandidates)
							.set({ reviewStatus: 'REJECTED' })
							.where(eq(expansionCandidates.id, candidate.id));
						await rejectCandidateArtifact(
							ctx,
							tx,
							principal,
							projectId,
							candidate.artifactId,
							reason
						);
					}
					await tx
						.update(expansions)
						.set({ status: 'CANCELLED', updatedAt: ctx.now() })
						.where(eq(expansions.id, expansionId));
					await audit(ctx, tx, principal, projectId, 'expansion.cancel', expansionId);
				}
				return loadExpansionDetail(ctx, tx, principal, projectId, expansionId);
			});
		}
	};
}
