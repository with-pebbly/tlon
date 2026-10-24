import {
	EXPORT_FORMAT,
	EXPORT_VERSION,
	ExportBundle,
	TlonError,
	ImportAsNewProjectOptions,
	ImportOptions,
	type ImportResult,
	type Principal,
	type ArtifactRevision
} from '@tlon/contracts';
import { findBundleIntegrityIssues, remapBundleIds } from '@tlon/core';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { Db } from './db.ts';
import { assertAllowed, audit, authorize, chunk, parseInput, type Ctx } from './internal.ts';
import {
	loadCandidates,
	loadExpansions,
	loadRelations,
	selectArtifacts,
	toProject,
	toRevision
} from './projections.ts';
import {
	artifactRevisions,
	artifacts,
	expansionCandidates,
	expansions,
	members,
	projects,
	relations
} from './schema.ts';

const INSERT_CHUNK = 500;
const LOOKUP_CHUNK = 5000;

async function countExisting(
	q: Db,
	table: PgTable,
	column: PgColumn,
	ids: readonly string[]
): Promise<number> {
	let total = 0;
	for (const part of chunk(ids, LOOKUP_CHUNK)) {
		const [row] = await q.select({ n: count() }).from(table).where(inArray(column, part));
		total += row?.n ?? 0;
	}
	return total;
}

function parseBundle(bundle: unknown): ExportBundle {
	if (
		typeof bundle === 'object' &&
		bundle !== null &&
		'version' in bundle &&
		bundle.version !== EXPORT_VERSION
	) {
		throw new TlonError(
			'UNSUPPORTED_EXPORT_VERSION',
			`export version is not supported (expected ${EXPORT_VERSION})`,
			{
				version: bundle.version
			}
		);
	}
	return parseInput(ExportBundle, bundle);
}

export function bundleMethods(ctx: Ctx) {
	const { db } = ctx;
	async function runImport(
		tx: Db,
		principal: Principal,
		projectId: string,
		parsed: ExportBundle,
		remapIds: boolean
	): Promise<ImportResult> {
		await authorize(tx, principal, projectId, 'import');
		const [existing] = await tx
			.select({ n: count() })
			.from(artifacts)
			.where(eq(artifacts.projectId, projectId));
		if ((existing?.n ?? 0) > 0) {
			throw new TlonError(
				'IMPORT_TARGET_NOT_EMPTY',
				'import target project already contains artifacts',
				{
					projectId
				}
			);
		}
		const data = remapIds
			? remapBundleIds(parsed, ctx.newId, projectId)
			: {
					...parsed,
					artifacts: parsed.artifacts.map((a) => ({ ...a, projectId })),
					relations: parsed.relations.map((r) => ({ ...r, projectId })),
					expansions: parsed.expansions.map((e) => ({ ...e, projectId }))
				};

		if (!remapIds) {
			const checks: Array<[string, PgTable, PgColumn, string[]]> = [
				['artifacts', artifacts, artifacts.id, data.artifacts.map((a) => a.id)],
				['revisions', artifactRevisions, artifactRevisions.id, data.revisions.map((r) => r.id)],
				['relations', relations, relations.id, data.relations.map((r) => r.id)],
				['expansions', expansions, expansions.id, data.expansions.map((e) => e.id)],
				[
					'candidates',
					expansionCandidates,
					expansionCandidates.id,
					data.candidates.map((c) => c.id)
				]
			];
			for (const [entity, table, column, ids] of checks) {
				const clashes = await countExisting(tx, table, column, ids);
				if (clashes > 0) {
					throw new TlonError(
						'ID_CONFLICT',
						`imported ${entity} ids already exist in this database`,
						{
							entity,
							clashes
						}
					);
				}
			}
		}

		for (const part of chunk(data.artifacts, INSERT_CHUNK)) {
			await tx.insert(artifacts).values(
				part.map((a) => ({
					id: a.id,
					projectId,
					kind: a.kind,
					title: a.title,
					body: a.body,
					structured: a.structured,
					status: a.status,
					creatorRole: a.creatorRole,
					ownerScope: a.ownerScope,
					locked: a.locked,
					pinned: a.pinned,
					headRevisionId: a.headRevisionId,
					createdAt: new Date(a.createdAt),
					updatedAt: new Date(a.updatedAt)
				}))
			);
		}
		for (const part of chunk(data.revisions, INSERT_CHUNK)) {
			await tx.insert(artifactRevisions).values(
				part.map((r) => ({
					id: r.id,
					artifactId: r.artifactId,
					version: r.version,
					snapshot: r.snapshot,
					actorId: r.actorId,
					reason: r.reason,
					createdAt: new Date(r.createdAt)
				}))
			);
		}
		for (const part of chunk(data.relations, INSERT_CHUNK)) {
			await tx.insert(relations).values(
				part.map((r) => ({
					id: r.id,
					projectId,
					fromId: r.fromId,
					toId: r.toId,
					type: r.type,
					status: r.status,
					expansionId: r.expansionId,
					provenanceArtifactIds: r.provenanceArtifactIds,
					createdAt: new Date(r.createdAt),
					updatedAt: new Date(r.updatedAt)
				}))
			);
		}
		// Parents first so the self-referencing parent FK holds.
		const orderedExpansions = [...data.expansions].sort((a, b) => a.depth - b.depth);
		for (const part of chunk(orderedExpansions, INSERT_CHUNK)) {
			await tx.insert(expansions).values(
				part.map((e) => ({
					id: e.id,
					projectId,
					targetRelationId: e.targetRelationId,
					leftArtifactId: e.leftArtifactId,
					rightArtifactId: e.rightArtifactId,
					leftRevisionId: e.leftRevisionId,
					rightRevisionId: e.rightRevisionId,
					parentExpansionId: e.parentExpansionId,
					selectedBridgeArtifactId: e.selectedBridgeArtifactId,
					depth: e.depth,
					status: e.status,
					attempts: e.attempts,
					acceptedAt: e.acceptedAt === null ? null : new Date(e.acceptedAt),
					createdAt: new Date(e.createdAt),
					updatedAt: new Date(e.updatedAt)
				}))
			);
		}
		for (const part of chunk(data.candidates, INSERT_CHUNK)) {
			await tx.insert(expansionCandidates).values(
				part.map((c) => ({
					id: c.id,
					projectId,
					expansionId: c.expansionId,
					artifactId: c.artifactId,
					score: c.score,
					reviewStatus: c.reviewStatus,
					createdAt: new Date(c.createdAt)
				}))
			);
		}
		await tx
			.update(projects)
			.set({ settings: parsed.project.settings, updatedAt: ctx.now() })
			.where(eq(projects.id, projectId));

		const result: ImportResult = {
			projectId,
			artifacts: data.artifacts.length,
			revisions: data.revisions.length,
			relations: data.relations.length,
			expansions: data.expansions.length,
			candidates: data.candidates.length,
			remapped: remapIds
		};
		await audit(ctx, tx, principal, projectId, 'project.import', projectId, {
			...result,
			projectId: undefined
		});
		return result;
	}

	return {
		async exportProject(principal: Principal, projectId: string): Promise<ExportBundle> {
			const project = await authorize(db, principal, projectId, 'export');
			const [artifactList, revisionRows, relationList, expansionList, candidateList] =
				await Promise.all([
					selectArtifacts(ctx, db, principal, projectId),
					db
						.select({ r: artifactRevisions })
						.from(artifactRevisions)
						.innerJoin(artifacts, eq(artifacts.id, artifactRevisions.artifactId))
						.where(eq(artifacts.projectId, projectId))
						.orderBy(asc(artifactRevisions.createdAt), asc(artifactRevisions.id)),
					loadRelations(ctx, db, principal, projectId),
					loadExpansions(db, projectId),
					loadCandidates(db, projectId)
				]);
			const visible = new Set(artifactList.map((a) => a.id));
			const revisions: ArtifactRevision[] = revisionRows
				.map((r) => toRevision(r.r))
				.filter((r) => visible.has(r.artifactId));
			return {
				format: EXPORT_FORMAT,
				version: EXPORT_VERSION,
				exportedAt: ctx.now().toISOString(),
				project: toProject(project),
				artifacts: artifactList,
				revisions,
				relations: relationList,
				expansions: expansionList,
				candidates: candidateList
			};
		},

		async importAsNewProject(
			principal: Principal,
			bundle: unknown,
			options: unknown = {}
		): Promise<ImportResult> {
			assertAllowed(principal, 'import');
			const { name, remapIds } = parseInput(ImportAsNewProjectOptions, options);
			const parsed = parseBundle(bundle);
			const issues = findBundleIntegrityIssues(parsed);
			if (issues.length > 0) {
				throw new TlonError('MISSING_REFERENCE', 'export bundle has broken references', issues);
			}
			return db.transaction(async (tx) => {
				const id = remapIds ? ctx.newId() : parsed.project.id;
				if (!remapIds) {
					const [taken] = await tx
						.select({ id: projects.id })
						.from(projects)
						.where(eq(projects.id, id));
					if (taken) {
						throw new TlonError(
							'ID_CONFLICT',
							'imported project id already exists in this database',
							{
								entity: 'projects'
							}
						);
					}
				}
				const now = ctx.now();
				await tx.insert(projects).values({
					id,
					name: name ?? parsed.project.name,
					domain: parsed.project.domain,
					settings: parsed.project.settings,
					createdAt: now,
					updatedAt: now
				});
				await tx
					.insert(members)
					.values({ projectId: id, principalId: principal.id, role: 'OWNER', createdAt: now });
				await audit(ctx, tx, principal, id, 'project.import_new', id);
				return runImport(tx, principal, id, parsed, remapIds);
			});
		},

		async importProject(
			principal: Principal,
			projectId: string,
			bundle: unknown,
			options: unknown = {}
		): Promise<ImportResult> {
			// Refuse (binding, matrix, membership) before looking at the potentially huge bundle;
			// runImport authorizes again inside the transaction.
			await authorize(db, principal, projectId, 'import');
			const { remapIds } = parseInput(ImportOptions, options);
			const parsed = parseBundle(bundle);
			const issues = findBundleIntegrityIssues(parsed);
			if (issues.length > 0) {
				throw new TlonError('MISSING_REFERENCE', 'export bundle has broken references', issues);
			}
			return db.transaction((tx) => runImport(tx, principal, projectId, parsed, remapIds));
		}
	};
}
