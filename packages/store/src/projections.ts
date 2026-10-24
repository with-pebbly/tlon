import {
	type Artifact,
	type ArtifactKind,
	type ArtifactRevision,
	type ArtifactSnapshot,
	type ArtifactStatus,
	type Expansion,
	type ExpansionCandidate,
	type ExpansionDetail,
	type ExpansionStatus,
	TlonError,
	type OwnerScope,
	type Principal,
	type Project,
	type ProjectDomain,
	ProjectSettings,
	CandidateScore,
	type Relation,
	type RelationStatus,
	type Role,
	type CandidateReviewStatus
} from '@tlon/contracts';
import { expansionLineage, visibleScopesFor } from '@tlon/core';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';

import type { Db } from './db.ts';
import {
	artifactRevisions,
	artifacts,
	expansionCandidates,
	expansions,
	relations,
	type ArtifactRow,
	type CandidateRow,
	type ExpansionRow,
	type ProjectRow,
	type RelationRow,
	type RevisionRow
} from './schema.ts';

export function toProject(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		domain: row.domain as ProjectDomain,
		settings: ProjectSettings.parse(row.settings),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

export function toArtifact(row: ArtifactRow, version: number): Artifact {
	return {
		id: row.id,
		projectId: row.projectId,
		kind: row.kind as ArtifactKind,
		title: row.title,
		body: row.body,
		structured: row.structured,
		status: row.status as ArtifactStatus,
		creatorRole: row.creatorRole as Role,
		ownerScope: row.ownerScope as OwnerScope,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		headRevisionId: row.headRevisionId,
		version,
		locked: row.locked,
		pinned: row.pinned
	};
}

export function snapshotOf(row: ArtifactRow): ArtifactSnapshot {
	return {
		kind: row.kind as ArtifactKind,
		title: row.title,
		body: row.body,
		structured: row.structured,
		status: row.status as ArtifactStatus,
		ownerScope: row.ownerScope as OwnerScope,
		locked: row.locked,
		pinned: row.pinned
	};
}

export function toRevision(row: RevisionRow): ArtifactRevision {
	return {
		id: row.id,
		artifactId: row.artifactId,
		version: row.version,
		snapshot: row.snapshot as ArtifactSnapshot,
		actorId: row.actorId,
		reason: row.reason,
		createdAt: row.createdAt.toISOString()
	};
}

export function toCandidate(row: CandidateRow): ExpansionCandidate {
	return {
		id: row.id,
		expansionId: row.expansionId,
		artifactId: row.artifactId,
		score: CandidateScore.parse(row.score),
		reviewStatus: row.reviewStatus as CandidateReviewStatus,
		createdAt: row.createdAt.toISOString()
	};
}

/** Artifact rows visible to `principal` (M3 seam: scope filter), joined with the head version. */
export async function selectArtifacts(
	q: Db,
	principal: Principal,
	projectId: string,
	where?: SQL,
	extra?: { limit?: number }
): Promise<Artifact[]> {
	const query = q
		.select({ a: artifacts, version: artifactRevisions.version })
		.from(artifacts)
		.innerJoin(artifactRevisions, eq(artifactRevisions.id, artifacts.headRevisionId))
		.where(
			and(
				eq(artifacts.projectId, projectId),
				inArray(artifacts.ownerScope, [...visibleScopesFor(principal)]),
				where
			)
		)
		.orderBy(asc(artifacts.createdAt), asc(artifacts.id));
	const rows = await (extra?.limit === undefined ? query : query.limit(extra.limit));
	return rows.map((r) => toArtifact(r.a, r.version));
}

export type ArtifactWithVersion = { row: ArtifactRow; version: number };

export async function getArtifactRow(
	q: Db,
	principal: Principal,
	projectId: string,
	artifactId: string
): Promise<ArtifactWithVersion> {
	const [found] = await q
		.select({ a: artifacts, version: artifactRevisions.version })
		.from(artifacts)
		.innerJoin(artifactRevisions, eq(artifactRevisions.id, artifacts.headRevisionId))
		.where(
			and(
				eq(artifacts.id, artifactId),
				eq(artifacts.projectId, projectId),
				inArray(artifacts.ownerScope, [...visibleScopesFor(principal)])
			)
		);
	if (!found) throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactId });
	return { row: found.a, version: found.version };
}

function toRelation(row: RelationRow, expandedBy: ReadonlyMap<string, string>): Relation {
	return {
		id: row.id,
		projectId: row.projectId,
		fromId: row.fromId,
		toId: row.toId,
		type: row.type,
		status: row.status as RelationStatus,
		expansionId: row.expansionId,
		provenanceArtifactIds: row.provenanceArtifactIds,
		expandedByExpansionId: expandedBy.get(row.id) ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

async function acceptedExpansionByTarget(q: Db, projectId: string): Promise<Map<string, string>> {
	const rows = await q
		.select({ id: expansions.id, target: expansions.targetRelationId })
		.from(expansions)
		.where(and(eq(expansions.projectId, projectId), eq(expansions.status, 'ACCEPTED')));
	const map = new Map<string, string>();
	for (const r of rows) if (r.target !== null) map.set(r.target, r.id);
	return map;
}

export async function loadRelations(q: Db, projectId: string, where?: SQL): Promise<Relation[]> {
	const [rows, expandedBy] = await Promise.all([
		q
			.select()
			.from(relations)
			.where(and(eq(relations.projectId, projectId), where))
			.orderBy(asc(relations.createdAt), asc(relations.id)),
		acceptedExpansionByTarget(q, projectId)
	]);
	return rows.map((r) => toRelation(r, expandedBy));
}

/** Child relations in interval order: left→C first, then C→right. */
function orderChildren(leftArtifactId: string, children: RelationRow[]): RelationRow[] {
	const rank = (r: RelationRow) => (r.fromId === leftArtifactId ? 0 : 1);
	return [...children].sort(
		(a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime()
	);
}

function toExpansion(
	row: ExpansionRow,
	candidates: CandidateRow[],
	children: RelationRow[]
): Expansion {
	return {
		id: row.id,
		projectId: row.projectId,
		targetRelationId: row.targetRelationId,
		leftArtifactId: row.leftArtifactId,
		rightArtifactId: row.rightArtifactId,
		leftRevisionId: row.leftRevisionId,
		rightRevisionId: row.rightRevisionId,
		parentExpansionId: row.parentExpansionId,
		bridgeArtifactIds: candidates.map((c) => c.artifactId),
		selectedBridgeArtifactId: row.selectedBridgeArtifactId,
		depth: row.depth,
		status: row.status as ExpansionStatus,
		attempts: row.attempts,
		childRelationIds: orderChildren(row.leftArtifactId, children).map((c) => c.id),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		acceptedAt: row.acceptedAt?.toISOString() ?? null
	};
}

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> => {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = map.get(k);
		if (list) list.push(item);
		else map.set(k, [item]);
	}
	return map;
};

export async function loadExpansions(q: Db, projectId: string, where?: SQL): Promise<Expansion[]> {
	const rows = await q
		.select()
		.from(expansions)
		.where(and(eq(expansions.projectId, projectId), where))
		.orderBy(asc(expansions.createdAt), asc(expansions.id));
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const [candidateRows, childRows] = await Promise.all([
		q
			.select()
			.from(expansionCandidates)
			.where(
				and(
					eq(expansionCandidates.projectId, projectId),
					inArray(expansionCandidates.expansionId, ids)
				)
			)
			.orderBy(asc(expansionCandidates.createdAt), asc(expansionCandidates.id)),
		q
			.select()
			.from(relations)
			.where(and(eq(relations.projectId, projectId), inArray(relations.expansionId, ids)))
			.orderBy(asc(relations.createdAt), asc(relations.id))
	]);
	const candidatesBy = groupBy(candidateRows, (c) => c.expansionId);
	const childrenBy = groupBy(childRows, (c) => c.expansionId as string);
	return rows.map((r) => toExpansion(r, candidatesBy.get(r.id) ?? [], childrenBy.get(r.id) ?? []));
}

export async function loadExpansion(
	q: Db,
	projectId: string,
	expansionId: string
): Promise<Expansion> {
	const [expansion] = await loadExpansions(q, projectId, eq(expansions.id, expansionId));
	if (!expansion)
		throw new TlonError('EXPANSION_NOT_FOUND', 'expansion not found', { expansionId });
	return expansion;
}

export async function loadCandidates(
	q: Db,
	projectId: string,
	where?: SQL
): Promise<ExpansionCandidate[]> {
	const rows = await q
		.select()
		.from(expansionCandidates)
		.where(and(eq(expansionCandidates.projectId, projectId), where))
		.orderBy(asc(expansionCandidates.createdAt), asc(expansionCandidates.id));
	return rows.map(toCandidate);
}

/** Ancestors of an expansion ordered root → direct parent. */
export async function loadLineage(
	q: Db,
	projectId: string,
	parentExpansionId: string | null
): Promise<Expansion[]> {
	const chain = new Map<string, Expansion>();
	let cursor = parentExpansionId;
	while (cursor !== null && !chain.has(cursor)) {
		const parent = await loadExpansion(q, projectId, cursor);
		chain.set(parent.id, parent);
		cursor = parent.parentExpansionId;
	}
	return expansionLineage(parentExpansionId, chain);
}

export async function loadExpansionDetail(
	q: Db,
	principal: Principal,
	projectId: string,
	expansionId: string
): Promise<ExpansionDetail> {
	const expansion = await loadExpansion(q, projectId, expansionId);
	const [candidates, lineage, childRelations, targetRelation] = await Promise.all([
		loadCandidates(q, projectId, eq(expansionCandidates.expansionId, expansionId)),
		loadLineage(q, projectId, expansion.parentExpansionId),
		loadRelations(q, projectId, eq(relations.expansionId, expansionId)),
		expansion.targetRelationId === null
			? Promise.resolve([])
			: loadRelations(q, projectId, eq(relations.id, expansion.targetRelationId))
	]);
	const wanted = [
		...new Set([
			expansion.leftArtifactId,
			expansion.rightArtifactId,
			...candidates.map((c) => c.artifactId)
		])
	];
	const visible = new Map(
		(await selectArtifacts(q, principal, projectId, inArray(artifacts.id, wanted))).map((a) => [
			a.id,
			a
		])
	);
	const left = visible.get(expansion.leftArtifactId);
	const right = visible.get(expansion.rightArtifactId);
	if (!left || !right) {
		throw new TlonError('ARTIFACT_NOT_FOUND', 'expansion anchor is not visible', { expansionId });
	}
	const ordered = [...childRelations].sort(
		(a, b) => expansion.childRelationIds.indexOf(a.id) - expansion.childRelationIds.indexOf(b.id)
	);
	return {
		expansion,
		candidates: candidates.flatMap((c) => {
			const artifact = visible.get(c.artifactId);
			return artifact ? [{ ...c, artifact }] : [];
		}),
		left,
		right,
		targetRelation: targetRelation[0] ?? null,
		childRelations: ordered,
		lineage
	};
}
