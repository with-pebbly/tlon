import {
	DismissIssueInput,
	type IssueList,
	PutTransitionInput,
	TlonError,
	type OwnerScope,
	type Principal,
	type Transition,
	type TransitionAnnotation
} from '@tlon/contracts';
import { writableScopesFor } from '@tlon/core';

import type { Db } from './db.ts';
import { asUuid, audit, authorize, parseInput, type Ctx } from './internal.ts';
import { getArtifactRow, loadIssueList, toAnnotation } from './projections.ts';
import { issueDismissals, transitionAnnotations } from './schema.ts';

/** Appends one annotation row. Never touches the artifact or its revisions. Caller owns the transaction. */
export async function insertAnnotation(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	annotation: {
		artifactId: string;
		artifactRevisionId: string;
		transition: Transition;
		source: TransitionAnnotation['source'];
		reviewed: boolean;
	}
): Promise<TransitionAnnotation> {
	const [row] = await q
		.insert(transitionAnnotations)
		.values({
			id: ctx.newId(),
			projectId,
			...annotation,
			actorId: principal.id,
			createdAt: ctx.now()
		})
		.returning();
	if (!row) throw new TlonError('INTERNAL', 'annotation insert returned no row');
	return toAnnotation(row);
}

export function validationMethods(ctx: Ctx) {
	const { db } = ctx;
	return {
		async putTransition(
			principal: Principal,
			projectId: string,
			artifactId: string,
			input: unknown
		): Promise<TransitionAnnotation> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'transition.write');
				const data = parseInput(PutTransitionInput, input);
				asUuid(artifactId, 'ARTIFACT_NOT_FOUND');
				// Invisible → ARTIFACT_NOT_FOUND; visible but outside the writable scopes → FORBIDDEN.
				const current = await getArtifactRow(ctx, tx, principal, projectId, artifactId);
				if (!writableScopesFor(principal).includes(current.row.ownerScope as OwnerScope)) {
					throw new TlonError('FORBIDDEN', 'artifact is read-only for this principal', {
						artifactId
					});
				}
				if (current.row.headRevisionId !== data.artifactRevisionId) {
					throw new TlonError('STALE_REVISION', 'artifact changed since the expected revision', {
						currentRevisionId: current.row.headRevisionId
					});
				}
				const annotation = await insertAnnotation(ctx, tx, principal, projectId, {
					artifactId,
					artifactRevisionId: data.artifactRevisionId,
					transition: data.transition,
					// Only humans review: agent-supplied provenance flags are ignored.
					source: principal.role === 'HUMAN' ? data.source : 'author',
					reviewed: principal.role === 'HUMAN' ? data.reviewed : false
				});
				await audit(ctx, tx, principal, projectId, 'artifact.transition.put', artifactId, {
					annotationId: annotation.id,
					artifactRevisionId: annotation.artifactRevisionId,
					source: annotation.source,
					reviewed: annotation.reviewed
				});
				return annotation;
			});
		},

		async listIssues(principal: Principal, projectId: string): Promise<IssueList> {
			await authorize(db, principal, projectId, 'validation.read');
			return loadIssueList(ctx, db, principal, projectId);
		},

		async dismissIssue(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<IssueList> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'issue.dismiss');
				const data = parseInput(DismissIssueInput, input);
				const id = ctx.newId();
				await tx.insert(issueDismissals).values({
					id,
					projectId,
					issueKey: data.key,
					resolution: data.resolution,
					reason: data.reason,
					actorId: principal.id,
					createdAt: ctx.now()
				});
				await audit(ctx, tx, principal, projectId, 'issue.dismiss', id, {
					issueKey: data.key,
					resolution: data.resolution
				});
				return loadIssueList(ctx, tx, principal, projectId);
			});
		}
	};
}
