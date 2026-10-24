import {
	type Artifact,
	type ArtifactKind,
	type ArtifactPage,
	ArtifactListQuery,
	CreateArtifactInput,
	TlonError,
	type Principal,
	type ArtifactRevision,
	UpdateArtifactInput,
	type FactKind,
	type OwnerScope,
	type RevisionList,
	type Role,
	lintFactText
} from '@tlon/contracts';
import { parseStructured } from '@tlon/contracts';
import { creationScopeFor, writableScopesFor } from '@tlon/core';
import { and, asc, desc, eq, gt, ilike, inArray, or } from 'drizzle-orm';

import type { Db } from './db.ts';
import { asUuid, audit, authorize, guardValidation, parseInput, type Ctx } from './internal.ts';
import {
	type ArtifactWithVersion,
	getArtifactRow,
	selectArtifacts,
	snapshotOf,
	toArtifact,
	toRevision
} from './projections.ts';
import {
	artifactRevisions,
	artifacts,
	expansionCandidates,
	expansions,
	type ArtifactRow
} from './schema.ts';

type ArtifactChange = Partial<
	Pick<
		ArtifactRow,
		| 'kind'
		| 'title'
		| 'body'
		| 'structured'
		| 'status'
		| 'ownerScope'
		| 'locked'
		| 'pinned'
		| 'factKind'
	>
>;

/**
 * Appends a revision and moves the artifact head with a conditional update
 * (`WHERE head_revision_id = <expected>`), so concurrent writers cannot both win.
 */
export async function appendRevision(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	current: ArtifactWithVersion,
	change: ArtifactChange,
	reason: string | null
): Promise<ArtifactWithVersion> {
	const now = ctx.now();
	const revisionId = ctx.newId();
	const [updated] = await q
		.update(artifacts)
		.set({ ...change, headRevisionId: revisionId, updatedAt: now })
		.where(
			and(
				eq(artifacts.id, current.row.id),
				eq(artifacts.projectId, current.row.projectId),
				eq(artifacts.headRevisionId, current.row.headRevisionId)
			)
		)
		.returning();
	if (!updated) {
		const [latest] = await q
			.select({ head: artifacts.headRevisionId })
			.from(artifacts)
			.where(eq(artifacts.id, current.row.id));
		throw new TlonError('STALE_REVISION', 'artifact changed since the expected revision', {
			currentRevisionId: latest?.head ?? null
		});
	}
	const version = current.version + 1;
	await q.insert(artifactRevisions).values({
		id: revisionId,
		artifactId: updated.id,
		version,
		snapshot: snapshotOf(updated),
		actorId: principal.id,
		reason,
		createdAt: now
	});
	return { row: updated, version };
}

/** Inserts a brand-new artifact plus its revision v1. Caller owns the transaction. */
export async function insertArtifact(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	values: Pick<
		ArtifactRow,
		'kind' | 'title' | 'body' | 'structured' | 'status' | 'ownerScope' | 'locked' | 'pinned'
	> &
		Partial<Pick<ArtifactRow, 'composition' | 'artifactClass' | 'factKind'>>,
	reason: string | null,
	/** Override for artifacts authored on behalf of another role (e.g. a published disclosure is C's). */
	creatorRole: Role = principal.role
): Promise<Artifact> {
	const now = ctx.now();
	const id = ctx.newId();
	const revisionId = ctx.newId();
	const [row] = await q
		.insert(artifacts)
		.values({
			...values,
			id,
			projectId,
			creatorRole,
			headRevisionId: revisionId,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	if (!row) throw new TlonError('INTERNAL', 'artifact insert returned no row');
	await q.insert(artifactRevisions).values({
		id: revisionId,
		artifactId: id,
		version: 1,
		snapshot: snapshotOf(row),
		actorId: principal.id,
		reason,
		createdAt: now
	});
	return toArtifact(row, 1);
}

/**
 * Shape rules of a FACT artifact (§4.1): the couple-of-words Fact text lives in
 * `title`, the body stays empty and the kind is required. Violations are VALIDATION_FAILED
 * with the lint messages (never the text itself).
 */
export function assertFactShape(title: string, body: string, factKind: FactKind | null): void {
	const messages = lintFactText(title).errors;
	if (body.trim() !== '')
		messages.push('A Fact has no body; put the whole statement in the title.');
	if (factKind === null) messages.push('A Fact needs a factKind.');
	if (messages.length > 0) {
		throw new TlonError(
			'VALIDATION_FAILED',
			'request validation failed',
			messages.map((message) => ({ code: 'custom', path: ['title'], message }))
		);
	}
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function decodeCursor(cursor: string): { at: Date; id: string } {
	const [ms, id] = cursor.split('_');
	const at = new Date(Number(ms));
	if (!ms || !id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) {
		throw new TlonError('VALIDATION_FAILED', 'malformed cursor');
	}
	return { at, id };
}

export function artifactMethods(ctx: Ctx) {
	const { db } = ctx;
	return {
		async listArtifacts(
			principal: Principal,
			projectId: string,
			query: unknown = {}
		): Promise<ArtifactPage> {
			await authorize(db, principal, projectId, 'project.read');
			const q = parseInput(ArtifactListQuery, query);
			const filters = [
				q.kind ? eq(artifacts.kind, q.kind) : undefined,
				q.status ? eq(artifacts.status, q.status) : undefined,
				q.q
					? or(
							ilike(artifacts.title, `%${escapeLike(q.q)}%`),
							ilike(artifacts.body, `%${escapeLike(q.q)}%`)
						)
					: undefined
			];
			if (q.cursor) {
				const { at, id } = decodeCursor(q.cursor);
				filters.push(
					or(gt(artifacts.createdAt, at), and(eq(artifacts.createdAt, at), gt(artifacts.id, id)))
				);
			}
			const items = await selectArtifacts(ctx, db, principal, projectId, and(...filters), {
				limit: q.limit + 1
			});
			const page = items.slice(0, q.limit);
			const last = page.at(-1);
			return {
				items: page,
				nextCursor:
					items.length > q.limit && last ? `${new Date(last.createdAt).getTime()}_${last.id}` : null
			};
		},

		async createArtifact(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<Artifact> {
			return db.transaction(async (tx) => {
				const project = await authorize(tx, principal, projectId, 'artifact.create');
				const data = parseInput(CreateArtifactInput, input);
				// Agents are pinned to their own scope (a forged ownerScope is ignored) and cannot
				// self-accept or lock; VALIDATOR has no creation scope at all.
				const ownerScope = creationScopeFor(principal, data.ownerScope);
				if (ownerScope === null) {
					throw new TlonError('FORBIDDEN', 'principal may not create artifacts', { projectId });
				}
				if (principal.kind === 'AGENT' && (data.status === 'ACCEPTED' || data.locked)) {
					throw new TlonError('FORBIDDEN', 'agents may not accept or lock artifacts', {
						projectId
					});
				}
				const isFact = data.artifactClass === 'FACT';
				if (isFact) {
					// Facts are authored by the protocol (C's proposals) or by the facilitator, never ad hoc by agents.
					if (principal.kind !== 'HUMAN') {
						throw new TlonError('FORBIDDEN', 'Facts are created through the protocol', {
							projectId
						});
					}
					assertFactShape(data.title, data.body, data.factKind ?? null);
				} else if (data.factKind !== undefined) {
					throw new TlonError('VALIDATION_FAILED', 'factKind is only valid for Facts');
				}
				const structured = isFact
					? {}
					: guardValidation(() =>
							parseStructured(project.domain as 'NARRATIVE' | 'GENERIC', data.kind, data.structured)
						);
				const artifact = await insertArtifact(
					ctx,
					tx,
					principal,
					projectId,
					{
						kind: isFact ? 'NOTE' : data.kind,
						artifactClass: data.artifactClass,
						factKind: isFact ? (data.factKind ?? null) : null,
						title: data.title,
						body: data.body,
						structured,
						status: data.status,
						ownerScope,
						locked: data.locked,
						pinned: data.pinned
					},
					data.reason ?? null
				);
				await audit(ctx, tx, principal, projectId, 'artifact.create', artifact.id, {
					kind: data.kind,
					artifactClass: data.artifactClass
				});
				return artifact;
			});
		},

		async getArtifact(principal: Principal, projectId: string, id: string): Promise<Artifact> {
			await authorize(db, principal, projectId, 'project.read');
			asUuid(id, 'ARTIFACT_NOT_FOUND');
			const { row, version } = await getArtifactRow(ctx, db, principal, projectId, id);
			return toArtifact(row, version);
		},

		async updateArtifact(
			principal: Principal,
			projectId: string,
			id: string,
			expectedRevisionId: string | undefined,
			input: unknown
		): Promise<Artifact> {
			return db.transaction(async (tx) => {
				const project = await authorize(tx, principal, projectId, 'artifact.create');
				if (expectedRevisionId === undefined || expectedRevisionId === '') {
					throw new TlonError(
						'PRECONDITION_REQUIRED',
						'If-Match with the head revision id is required'
					);
				}
				const patch = parseInput(UpdateArtifactInput, input);
				asUuid(id, 'ARTIFACT_NOT_FOUND');
				// Invisible → ARTIFACT_NOT_FOUND; visible but outside the writable scopes → FORBIDDEN.
				const current = await getArtifactRow(ctx, tx, principal, projectId, id);
				if (!writableScopesFor(principal).includes(current.row.ownerScope as OwnerScope)) {
					throw new TlonError('FORBIDDEN', 'artifact is read-only for this principal', {
						artifactId: id
					});
				}
				if (current.row.headRevisionId !== expectedRevisionId) {
					throw new TlonError('STALE_REVISION', 'artifact changed since the expected revision', {
						currentRevisionId: current.row.headRevisionId
					});
				}
				const { reason, ...fields } = patch;
				if (
					principal.kind === 'AGENT' &&
					(fields.ownerScope !== undefined ||
						fields.locked !== undefined ||
						fields.status === 'ACCEPTED')
				) {
					throw new TlonError(
						'FORBIDDEN',
						'agents may not change scope or lock state, or accept artifacts',
						{ artifactId: id }
					);
				}
				const changedKeys = Object.keys(fields).filter(
					(k) => fields[k as keyof typeof fields] !== undefined
				);
				if (current.row.locked) {
					const onlyUnlock =
						changedKeys.length === 1 && changedKeys[0] === 'locked' && fields.locked === false;
					if (!onlyUnlock)
						throw new TlonError('ARTIFACT_LOCKED', 'artifact is locked', { artifactId: id });
				}
				if (fields.status === 'ACCEPTED') {
					const pending = await tx
						.select({ id: expansionCandidates.id })
						.from(expansionCandidates)
						.innerJoin(expansions, eq(expansions.id, expansionCandidates.expansionId))
						.where(
							and(
								eq(expansionCandidates.artifactId, id),
								eq(expansionCandidates.reviewStatus, 'PENDING'),
								inArray(expansions.status, ['PENDING', 'GENERATING', 'REVIEW'])
							)
						)
						.limit(1);
					if (pending.length > 0) {
						throw new TlonError(
							'INVALID_STATE',
							'artifact is a pending expansion candidate; accept it via the expansion',
							{
								artifactId: id
							}
						);
					}
				}
				const isFact = current.row.artifactClass === 'FACT';
				if (isFact) {
					if (fields.kind !== undefined || fields.structured !== undefined) {
						throw new TlonError('VALIDATION_FAILED', 'a Fact has no kind or structured content');
					}
					assertFactShape(
						fields.title ?? current.row.title,
						fields.body ?? current.row.body,
						(fields.factKind ?? current.row.factKind) as FactKind | null
					);
				} else if (fields.factKind !== undefined) {
					throw new TlonError('VALIDATION_FAILED', 'factKind is only valid for Facts');
				}
				const next = {
					kind: (fields.kind ?? current.row.kind) as ArtifactKind,
					structured: fields.structured ?? current.row.structured
				};
				const structured =
					!isFact && (fields.kind !== undefined || fields.structured !== undefined)
						? guardValidation(() =>
								parseStructured(
									project.domain as 'NARRATIVE' | 'GENERIC',
									next.kind,
									next.structured
								)
							)
						: current.row.structured;
				const updated = await appendRevision(
					ctx,
					tx,
					principal,
					current,
					{
						kind: next.kind,
						factKind: fields.factKind ?? current.row.factKind,
						title: fields.title ?? current.row.title,
						body: fields.body ?? current.row.body,
						structured,
						status: fields.status ?? current.row.status,
						ownerScope: fields.ownerScope ?? current.row.ownerScope,
						locked: fields.locked ?? current.row.locked,
						pinned: fields.pinned ?? current.row.pinned
					},
					reason ?? null
				);
				await audit(ctx, tx, principal, projectId, 'artifact.update', id, {
					fields: changedKeys,
					version: updated.version
				});
				return toArtifact(updated.row, updated.version);
			});
		},

		async listRevisions(
			principal: Principal,
			projectId: string,
			id: string
		): Promise<RevisionList> {
			await authorize(db, principal, projectId, 'project.read');
			asUuid(id, 'ARTIFACT_NOT_FOUND');
			await getArtifactRow(ctx, db, principal, projectId, id);
			const rows = await db
				.select()
				.from(artifactRevisions)
				.where(eq(artifactRevisions.artifactId, id))
				.orderBy(desc(artifactRevisions.version), asc(artifactRevisions.id));
			const items: ArtifactRevision[] = rows.map(toRevision);
			return { items };
		}
	};
}
