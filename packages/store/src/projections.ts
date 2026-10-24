import {
	type Artifact,
	type ArtifactKind,
	type ArtifactRevision,
	type ArtifactSnapshot,
	type ArtifactStatus,
	type Expansion,
	type ExpansionCandidate,
	type ExpansionDetail,
	type Composition,
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
	type CandidateReviewStatus,
	OWNER_SCOPES,
	OPEN_EXPANSION_STATUSES,
	Transition,
	type IssueList,
	type ProjectGraph,
	type TransitionAnnotation,
	type ValidationIssue
} from '@tlon/contracts';
import {
	candidateIssues,
	expansionLineage,
	isActionAllowed,
	validateContinuity,
	visibleScopesFor
} from '@tlon/core';
import { and, asc, desc, eq, exists, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from './db.ts';
import { chunk, type Ctx } from './internal.ts';
import {
	artifactRevisions,
	artifacts,
	expansionCandidates,
	expansions,
	grants,
	issueDismissals,
	projects,
	relations,
	transitionAnnotations,
	type ArtifactRow,
	type CandidateRow,
	type ExpansionRow,
	type ProjectRow,
	type RelationRow,
	type RevisionRow,
	type TransitionAnnotationRow
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
		composition: row.composition as Composition,
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
		composition: row.composition as Composition,
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

/**
 * THE artifact-visibility predicate (§7.1, spec rule 4): an artifact is visible iff its
 * ownerScope ∈ visibleScopesFor(principal) OR the principal holds an active READ grant
 * (not revoked, not expired at `now`) on it. Every artifact/relation/revision/graph/
 * list/search read composes this into its SQL; it must reference the `artifacts` table.
 * Returns `undefined` when the principal's scopes already cover every scope (no filter).
 */
export function visibleArtifactPredicate(q: Db, principal: Principal, now: Date): SQL | undefined {
	const scopes = visibleScopesFor(principal);
	if (OWNER_SCOPES.every((scope) => scopes.includes(scope))) return undefined;
	const byScope = scopes.length === 0 ? sql`false` : inArray(artifacts.ownerScope, [...scopes]);
	// Grants are keyed by agent principal uuid; humans never hold them and never get here.
	if (principal.kind !== 'AGENT') return byScope;
	const granted = exists(
		q
			.select({ one: sql`1` })
			.from(grants)
			.where(
				and(
					eq(grants.granteePrincipalId, principal.id),
					eq(grants.artifactId, artifacts.id),
					eq(grants.permission, 'READ'),
					isNull(grants.revokedAt),
					or(isNull(grants.expiresAt), gt(grants.expiresAt, now))
				)
			)
	);
	return or(byScope, granted);
}

/** Ids of artifacts of `projectId` visible to `principal`, as a subquery. */
function visibleArtifactIds(q: Db, principal: Principal, now: Date, projectId: string) {
	return q
		.select({ id: artifacts.id })
		.from(artifacts)
		.where(and(eq(artifacts.projectId, projectId), visibleArtifactPredicate(q, principal, now)));
}

/** Relation visibility (spec rule 5): both endpoints must be visible. */
function visibleRelationPredicate(
	q: Db,
	principal: Principal,
	now: Date,
	projectId: string
): SQL | undefined {
	if (visibleArtifactPredicate(q, principal, now) === undefined) return undefined;
	const ids = visibleArtifactIds(q, principal, now, projectId);
	return and(inArray(relations.fromId, ids), inArray(relations.toId, ids));
}

/** Artifact rows visible to `principal`, joined with the head version. */
export async function selectArtifacts(
	ctx: Ctx,
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
				visibleArtifactPredicate(q, principal, ctx.now()),
				where
			)
		)
		.orderBy(asc(artifacts.createdAt), asc(artifacts.id));
	const rows = await (extra?.limit === undefined ? query : query.limit(extra.limit));
	return rows.map((r) => toArtifact(r.a, r.version));
}

export type ArtifactWithVersion = { row: ArtifactRow; version: number };

/** Invisible and nonexistent artifacts are indistinguishable: same code, same message. */
export async function getArtifactRow(
	ctx: Ctx,
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
				visibleArtifactPredicate(q, principal, ctx.now())
			)
		);
	if (!found) throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactId });
	return { row: found.a, version: found.version };
}

/** Number of artifacts of the project the principal can see (never a global count). */
export async function countVisibleArtifacts(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<number> {
	const [row] = await q
		.select({ n: sql<number>`count(*)::int` })
		.from(artifacts)
		.where(
			and(eq(artifacts.projectId, projectId), visibleArtifactPredicate(q, principal, ctx.now()))
		);
	return row?.n ?? 0;
}

function toRelation(
	row: RelationRow,
	expandedBy: ReadonlyMap<string, string>,
	scrub: { visibleProvenance: ReadonlySet<string> } | null
): Relation {
	return {
		id: row.id,
		projectId: row.projectId,
		fromId: row.fromId,
		toId: row.toId,
		type: row.type,
		status: row.status as RelationStatus,
		expansionId: scrub ? null : row.expansionId,
		provenanceArtifactIds: scrub
			? row.provenanceArtifactIds.filter((id) => scrub.visibleProvenance.has(id))
			: row.provenanceArtifactIds,
		expandedByExpansionId: scrub ? null : (expandedBy.get(row.id) ?? null),
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

/**
 * Relations visible to `principal` (both endpoints visible). Principals without
 * `expansion.read` (A/B) never learn that expansions exist: expansion links are nulled
 * and provenance is cut down to artifacts they can see.
 */
export async function loadRelations(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	where?: SQL
): Promise<Relation[]> {
	const now = ctx.now();
	const scrubbed = !isActionAllowed(principal, 'expansion.read');
	const [rows, expandedBy] = await Promise.all([
		q
			.select()
			.from(relations)
			.where(
				and(
					eq(relations.projectId, projectId),
					visibleRelationPredicate(q, principal, now, projectId),
					where
				)
			)
			.orderBy(asc(relations.createdAt), asc(relations.id)),
		scrubbed ? Promise.resolve(new Map<string, string>()) : acceptedExpansionByTarget(q, projectId)
	]);
	if (!scrubbed) return rows.map((r) => toRelation(r, expandedBy, null));
	const cited = [...new Set(rows.flatMap((r) => r.provenanceArtifactIds))];
	const visibleProvenance = new Set<string>();
	if (cited.length > 0) {
		const found = await q
			.select({ id: artifacts.id })
			.from(artifacts)
			.where(
				and(
					eq(artifacts.projectId, projectId),
					inArray(artifacts.id, cited),
					visibleArtifactPredicate(q, principal, now)
				)
			);
		for (const f of found) visibleProvenance.add(f.id);
	}
	return rows.map((r) => toRelation(r, expandedBy, { visibleProvenance }));
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
	children: RelationRow[],
	staleSides: Array<'left' | 'right'>
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
		acceptedAt: row.acceptedAt?.toISOString() ?? null,
		staleSides
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
	const anchorIds = [
		...new Set(
			rows
				.filter((r) => r.status === 'ACCEPTED')
				.flatMap((r) => [r.leftArtifactId, r.rightArtifactId])
		)
	];
	const heads = new Map<string, string>();
	for (const part of chunk(anchorIds, 5000)) {
		const found = await q
			.select({ id: artifacts.id, head: artifacts.headRevisionId })
			.from(artifacts)
			.where(and(eq(artifacts.projectId, projectId), inArray(artifacts.id, part)));
		for (const f of found) heads.set(f.id, f.head);
	}
	return rows.map((r) => {
		const stale: Array<'left' | 'right'> = [];
		if (r.status === 'ACCEPTED') {
			if (heads.get(r.leftArtifactId) !== r.leftRevisionId) stale.push('left');
			if (heads.get(r.rightArtifactId) !== r.rightRevisionId) stale.push('right');
		}
		return toExpansion(r, candidatesBy.get(r.id) ?? [], childrenBy.get(r.id) ?? [], stale);
	});
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
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	expansionId: string
): Promise<ExpansionDetail> {
	const expansion = await loadExpansion(q, projectId, expansionId);
	const [candidates, lineage, childRelations, targetRelation] = await Promise.all([
		loadCandidates(q, projectId, eq(expansionCandidates.expansionId, expansionId)),
		loadLineage(q, projectId, expansion.parentExpansionId),
		loadRelations(ctx, q, principal, projectId, eq(relations.expansionId, expansionId)),
		expansion.targetRelationId === null
			? Promise.resolve([])
			: loadRelations(ctx, q, principal, projectId, eq(relations.id, expansion.targetRelationId))
	]);
	const wanted = [
		...new Set([
			expansion.leftArtifactId,
			expansion.rightArtifactId,
			...candidates.map((c) => c.artifactId)
		])
	];
	const visible = new Map(
		(await selectArtifacts(ctx, q, principal, projectId, inArray(artifacts.id, wanted))).map(
			(a) => [a.id, a]
		)
	);
	const left = visible.get(expansion.leftArtifactId);
	const right = visible.get(expansion.rightArtifactId);
	if (!left || !right) {
		throw new TlonError('ARTIFACT_NOT_FOUND', 'expansion anchor is not visible', { expansionId });
	}
	const ordered = [...childRelations].sort(
		(a, b) => expansion.childRelationIds.indexOf(a.id) - expansion.childRelationIds.indexOf(b.id)
	);
	const issuesByArtifact = await loadCandidateIssues(
		ctx,
		q,
		principal,
		projectId,
		expansion,
		candidates
	);
	return {
		expansion,
		candidates: candidates.flatMap((c) => {
			const artifact = visible.get(c.artifactId);
			return artifact ? [{ ...c, artifact, issues: issuesByArtifact.get(c.artifactId) ?? [] }] : [];
		}),
		left,
		right,
		targetRelation: targetRelation[0] ?? null,
		childRelations: ordered,
		lineage
	};
}

export function toAnnotation(row: TransitionAnnotationRow): TransitionAnnotation {
	return {
		id: row.id,
		artifactId: row.artifactId,
		artifactRevisionId: row.artifactRevisionId,
		transition: Transition.parse(row.transition),
		source: row.source as TransitionAnnotation['source'],
		reviewed: row.reviewed,
		actorId: row.actorId,
		createdAt: row.createdAt.toISOString()
	};
}

/** Latest annotation of every artifact the principal can see (annotations of hidden artifacts never appear). */
export async function loadLatestAnnotations(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<TransitionAnnotation[]> {
	const rows = await q
		.selectDistinctOn([transitionAnnotations.artifactId], { a: transitionAnnotations })
		.from(transitionAnnotations)
		.innerJoin(artifacts, eq(artifacts.id, transitionAnnotations.artifactId))
		.where(
			and(
				eq(transitionAnnotations.projectId, projectId),
				visibleArtifactPredicate(q, principal, ctx.now())
			)
		)
		.orderBy(
			asc(transitionAnnotations.artifactId),
			desc(transitionAnnotations.createdAt),
			desc(transitionAnnotations.id)
		);
	return rows
		.map((r) => toAnnotation(r.a))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Every annotation (full history, oldest first) of the artifacts the principal can see. */
export async function loadAllAnnotations(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<TransitionAnnotation[]> {
	const rows = await q
		.select({ a: transitionAnnotations })
		.from(transitionAnnotations)
		.innerJoin(artifacts, eq(artifacts.id, transitionAnnotations.artifactId))
		.where(
			and(
				eq(transitionAnnotations.projectId, projectId),
				visibleArtifactPredicate(q, principal, ctx.now())
			)
		)
		.orderBy(asc(transitionAnnotations.createdAt), asc(transitionAnnotations.id));
	return rows.map((r) => toAnnotation(r.a));
}

export type Dismissal = NonNullable<ValidationIssue['dismissal']>;

/** Latest human resolution per issue key. */
export async function loadDismissals(q: Db, projectId: string): Promise<Map<string, Dismissal>> {
	const rows = await q
		.select()
		.from(issueDismissals)
		.where(eq(issueDismissals.projectId, projectId))
		.orderBy(asc(issueDismissals.createdAt), asc(issueDismissals.id));
	const map = new Map<string, Dismissal>();
	for (const r of rows) {
		map.set(r.issueKey, {
			resolution: r.resolution as Dismissal['resolution'],
			reason: r.reason,
			actorId: r.actorId,
			createdAt: r.createdAt.toISOString()
		});
	}
	return map;
}

export function withDismissals(
	issues: ReadonlyArray<Omit<ValidationIssue, 'dismissal'>>,
	dismissals: ReadonlyMap<string, Dismissal>
): ValidationIssue[] {
	return issues.map((issue) => ({ ...issue, dismissal: dismissals.get(issue.key) ?? null }));
}

/**
 * The project as the principal sees it, shaped for continuity validation. Expansions whose
 * anchors are hidden are dropped so replays and explanations never mention hidden titles.
 */
export async function loadValidationGraph(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'>> {
	const [[project], artifactList, relationList, expansionList] = await Promise.all([
		q.select().from(projects).where(eq(projects.id, projectId)),
		selectArtifacts(ctx, q, principal, projectId),
		loadRelations(ctx, q, principal, projectId),
		loadExpansions(q, projectId)
	]);
	if (!project) throw new TlonError('PROJECT_NOT_FOUND', 'project not found', { projectId });
	const visible = new Set(artifactList.map((a) => a.id));
	return {
		project: toProject(project),
		artifacts: artifactList,
		relations: relationList,
		expansions: expansionList.filter(
			(e) => visible.has(e.leftArtifactId) && visible.has(e.rightArtifactId)
		)
	};
}

/** Continuity issues of the committed path as the principal sees it, dismissals merged by key. */
export async function loadIssueList(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<IssueList> {
	const [graph, annotations, dismissals] = await Promise.all([
		loadValidationGraph(ctx, q, principal, projectId),
		loadLatestAnnotations(ctx, q, principal, projectId),
		loadDismissals(q, projectId)
	]);
	const result = validateContinuity(graph, new Map(annotations.map((a) => [a.artifactId, a])));
	return {
		items: withDismissals(result.issues, dismissals),
		unannotatedArtifactIds: result.unannotatedArtifactIds
	};
}

/**
 * Issues each pending candidate of an open expansion would add if accepted now, computed on
 * the caller-visible graph. Only principals with `validation.read` get any; candidates
 * without an annotation have nothing to check.
 */
async function loadCandidateIssues(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	expansion: Expansion,
	candidates: ExpansionCandidate[]
): Promise<Map<string, ValidationIssue[]>> {
	const out = new Map<string, ValidationIssue[]>();
	if (
		!isActionAllowed(principal, 'validation.read') ||
		!OPEN_EXPANSION_STATUSES.includes(expansion.status)
	) {
		return out;
	}
	const pending = candidates.filter((c) => c.reviewStatus === 'PENDING');
	if (pending.length === 0) return out;
	const annotations = new Map(
		(await loadLatestAnnotations(ctx, q, principal, projectId)).map((a) => [a.artifactId, a])
	);
	const annotated = pending.filter((c) => annotations.has(c.artifactId));
	if (annotated.length === 0) return out;
	const [graph, dismissals] = await Promise.all([
		loadValidationGraph(ctx, q, principal, projectId),
		loadDismissals(q, projectId)
	]);
	const visible = new Set(graph.artifacts.map((a) => a.id));
	for (const c of annotated) {
		const annotation = annotations.get(c.artifactId);
		if (!annotation || !visible.has(c.artifactId)) continue;
		const issues = candidateIssues(graph, annotations, {
			expansionId: expansion.id,
			artifactId: c.artifactId,
			transition: annotation.transition
		});
		out.set(c.artifactId, withDismissals(issues, dismissals));
	}
	return out;
}
