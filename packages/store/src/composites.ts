import {
	type Artifact,
	type ArtifactStatus,
	type ClaimRef,
	type CompositeBoundary,
	CompositeContract,
	type CompositeDefinition,
	type CompositeRevisionList,
	type CompositeSummary,
	type CompositeView,
	CreateCompositeInput,
	OpenCompositeQuery,
	type OwnerScope,
	type Principal,
	type Relation,
	ReviseCompositeInput,
	type Role,
	TlonError
} from '@tlon/contracts';
import {
	assertNoMembershipCycle,
	compositionWarnings,
	creationScopeFor,
	inferBoundary,
	membershipIndex,
	transitiveMembers,
	visibleScopesFor,
	writableScopesFor,
	type MembershipIndex
} from '@tlon/core';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { appendRevision, insertArtifact } from './artifacts.ts';
import type { Db } from './db.ts';
import { asUuid, audit, authorize, chunk, parseInput, type Ctx } from './internal.ts';
import { getArtifactRow, loadRelations, selectArtifacts, toArtifact } from './projections.ts';
import {
	artifactRevisions,
	artifacts,
	compositeDefinitions,
	compositeMembers,
	compositeRelationMembers,
	relations,
	type CompositeDefinitionRow,
	type CompositeMemberRow
} from './schema.ts';

const LOOKUP_CHUNK = 5000;

/** A stored definition revision with its members and snapshotted relations (unfiltered). */
export type DefinitionBundle = {
	row: CompositeDefinitionRow;
	members: CompositeMemberRow[];
	relationIds: string[];
};

/** Head = highest version per composite. */
function headOf(projectId: string): SQL | undefined {
	return and(
		eq(compositeDefinitions.projectId, projectId),
		sql`${compositeDefinitions.version} = (select max(d2.version) from composite_definitions d2 where d2.composite_artifact_id = ${compositeDefinitions.compositeArtifactId})`
	);
}

async function loadBundles(q: Db, where: SQL | undefined): Promise<DefinitionBundle[]> {
	const rows = await q
		.select()
		.from(compositeDefinitions)
		.where(where)
		.orderBy(asc(compositeDefinitions.compositeArtifactId), asc(compositeDefinitions.version));
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const membersBy = new Map<string, CompositeMemberRow[]>();
	const relationsBy = new Map<string, string[]>();
	for (const part of chunk(ids, LOOKUP_CHUNK)) {
		const [memberRows, relationRows] = await Promise.all([
			q.select().from(compositeMembers).where(inArray(compositeMembers.definitionId, part)),
			q
				.select()
				.from(compositeRelationMembers)
				.where(inArray(compositeRelationMembers.definitionId, part))
		]);
		for (const m of memberRows) {
			const list = membersBy.get(m.definitionId);
			if (list) list.push(m);
			else membersBy.set(m.definitionId, [m]);
		}
		for (const r of relationRows) {
			const list = relationsBy.get(r.definitionId);
			if (list) list.push(r.relationId);
			else relationsBy.set(r.definitionId, [r.relationId]);
		}
	}
	return rows.map((row) => ({
		row,
		members: (membersBy.get(row.id) ?? []).sort(
			(a, b) =>
				a.displayOrder - b.displayOrder || a.memberArtifactId.localeCompare(b.memberArtifactId)
		),
		relationIds: (relationsBy.get(row.id) ?? []).sort()
	}));
}

/** Everything one caller can see: the basis for views, summaries and listings. */
type State = {
	artifacts: ReadonlyMap<string, Artifact>;
	relations: readonly Relation[];
	/** Head definitions of visible composites, filtered to what the caller may see. */
	definitions: ReadonlyMap<string, CompositeDefinition>;
	index: MembershipIndex;
};

type Visible = {
	artifactIds: ReadonlySet<string>;
	relationIds: ReadonlySet<string>;
};

function filterClaims(claims: readonly ClaimRef[], visible: Visible): ClaimRef[] {
	return claims.filter((c) => visible.artifactIds.has(c.sourceArtifactId));
}

/**
 * Definition as the caller may see it: hidden members, relations, claims and boundary
 * entries are dropped entirely — no ids, no placeholders, no counts.
 */
function visibleDefinition(bundle: DefinitionBundle, visible: Visible): CompositeDefinition {
	const stored = CompositeContract.parse(bundle.row.contract);
	const seen = (id: string) => visible.artifactIds.has(id);
	return {
		id: bundle.row.id,
		compositeArtifactId: bundle.row.compositeArtifactId,
		artifactRevisionId: bundle.row.artifactRevisionId,
		version: bundle.row.version,
		contract: {
			summary: stored.summary,
			entryConditions: filterClaims(stored.entryConditions, visible),
			exitConditions: filterClaims(stored.exitConditions, visible),
			invariants: filterClaims(stored.invariants, visible),
			keyClaims: filterClaims(stored.keyClaims, visible),
			openQuestions: stored.openQuestions
		},
		boundary: {
			entries: bundle.row.boundary.entries.filter(seen),
			exits: bundle.row.boundary.exits.filter(seen)
		},
		members: bundle.members
			.filter((m) => seen(m.memberArtifactId))
			.map((m) => ({
				artifactId: m.memberArtifactId,
				pinnedRevisionId: m.memberRevisionId,
				order: m.displayOrder
			})),
		memberRelationIds: bundle.relationIds.filter((id) => visible.relationIds.has(id)),
		actorId: bundle.row.actorId,
		reason: bundle.row.reason,
		createdAt: bundle.row.createdAt.toISOString()
	};
}

function visibleOf(artifactList: readonly Artifact[], relationList: readonly Relation[]): Visible {
	return {
		artifactIds: new Set(artifactList.map((a) => a.id)),
		relationIds: new Set(relationList.map((r) => r.id))
	};
}

function buildState(
	artifactList: readonly Artifact[],
	relationList: readonly Relation[],
	heads: readonly DefinitionBundle[]
): State {
	const visible = visibleOf(artifactList, relationList);
	const definitions = new Map<string, CompositeDefinition>();
	for (const head of heads) {
		if (!visible.artifactIds.has(head.row.compositeArtifactId)) continue;
		definitions.set(head.row.compositeArtifactId, visibleDefinition(head, visible));
	}
	return {
		artifacts: new Map(artifactList.map((a) => [a.id, a])),
		relations: relationList,
		definitions,
		index: membershipIndex(
			[...definitions.values()].map((d) => ({
				artifactId: d.compositeArtifactId,
				memberArtifactIds: d.members.map((m) => m.artifactId)
			}))
		)
	};
}

function summariesOf(state: State, artifactList: readonly Artifact[]): CompositeSummary[] {
	const out: CompositeSummary[] = [];
	for (const artifact of artifactList) {
		const def = state.definitions.get(artifact.id);
		if (!def) continue;
		const inside = transitiveMembers(artifact.id, state.index);
		out.push({
			artifactId: artifact.id,
			definitionId: def.id,
			version: def.version,
			memberArtifactIds: def.members.map((m) => m.artifactId),
			memberRelationIds: def.memberRelationIds,
			boundary: def.boundary,
			externalRelationIds: state.relations
				.filter((r) => inside.has(r.fromId) !== inside.has(r.toId))
				.map((r) => r.id)
		});
	}
	return out;
}

/** Graph projection: head definitions of every visible composite, filtered per caller. */
export async function loadCompositeSummaries(
	q: Db,
	projectId: string,
	artifactList: readonly Artifact[],
	relationList: readonly Relation[]
): Promise<CompositeSummary[]> {
	if (!artifactList.some((a) => a.composition === 'COMPOSITE')) return [];
	const heads = await loadBundles(q, headOf(projectId));
	return summariesOf(buildState(artifactList, relationList, heads), artifactList);
}

/** Export: every definition revision of every visible composite (callers pass an unrestricted view). */
export async function loadCompositeDefinitions(
	q: Db,
	projectId: string,
	artifactList: readonly Artifact[],
	relationList: readonly Relation[]
): Promise<CompositeDefinition[]> {
	if (!artifactList.some((a) => a.composition === 'COMPOSITE')) return [];
	const visible = visibleOf(artifactList, relationList);
	const all = await loadBundles(q, eq(compositeDefinitions.projectId, projectId));
	return all
		.filter((b) => visible.artifactIds.has(b.row.compositeArtifactId))
		.map((b) => visibleDefinition(b, visible))
		.sort(
			(a, b) =>
				a.createdAt.localeCompare(b.createdAt) || a.version - b.version || a.id.localeCompare(b.id)
		);
}

function buildView(
	state: State,
	id: string,
	depth: number,
	memo: Map<string, CompositeView>,
	path: ReadonlySet<string>
): CompositeView {
	const key = `${id}:${depth}`;
	const cached = memo.get(key);
	if (cached) return cached;
	const artifact = state.artifacts.get(id);
	const definition = state.definitions.get(id);
	if (!artifact || !definition) throw new TlonError('INTERNAL', 'composite definition missing');
	const memberIds = definition.members.map((m) => m.artifactId);
	const memberRelationIds = new Set(definition.memberRelationIds);
	const internal = state.relations.filter((r) => memberRelationIds.has(r.id));
	const inside = transitiveMembers(id, state.index);
	const externalRelations = state.relations.filter(
		(r) => inside.has(r.fromId) !== inside.has(r.toId)
	);
	const nextPath = new Set(path).add(id);
	const children =
		depth > 0
			? memberIds
					.filter((m) => state.definitions.has(m) && !nextPath.has(m))
					.map((m) => buildView(state, m, depth - 1, memo, nextPath))
			: [];
	const view: CompositeView = {
		artifact,
		definition,
		memberArtifacts: memberIds.flatMap((m) => {
			const found = state.artifacts.get(m);
			return found ? [found] : [];
		}),
		relations: internal,
		externalRelations,
		children,
		parentIds: [...state.definitions.values()]
			.filter((d) => d.members.some((m) => m.artifactId === id))
			.map((d) => d.compositeArtifactId),
		warnings: compositionWarnings(memberIds, internal, externalRelations.length)
	};
	memo.set(key, view);
	return view;
}

async function loadState(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<{ state: State; artifactList: Artifact[] }> {
	const [artifactList, relationList, heads] = await Promise.all([
		selectArtifacts(ctx, q, principal, projectId),
		loadRelations(ctx, q, principal, projectId),
		loadBundles(q, headOf(projectId))
	]);
	return { state: buildState(artifactList, relationList, heads), artifactList };
}

async function openView(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	id: string,
	depth: number
): Promise<CompositeView> {
	const { state } = await loadState(ctx, q, principal, projectId);
	const artifact = state.artifacts.get(id);
	if (!artifact)
		throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactId: id });
	if (artifact.composition !== 'COMPOSITE') {
		throw new TlonError('NOT_A_COMPOSITE', 'artifact is not a composite', { artifactId: id });
	}
	return buildView(state, id, depth, new Map(), new Set());
}

const ROLES: readonly Role[] = ['HUMAN', 'C', 'VALIDATOR', 'A', 'B'];

/** Roles that read `scope` without a grant. */
function visibleAudience(scope: OwnerScope): ReadonlySet<Role> {
	return new Set(
		ROLES.filter((role) => visibleScopesFor({ role } as unknown as Principal).includes(scope))
	);
}

function assertNoDuplicates(ids: readonly string[], what: string): void {
	if (new Set(ids).size !== ids.length) {
		throw new TlonError('VALIDATION_FAILED', `duplicate ${what}`);
	}
}

type DefinitionDraft = {
	memberIds: string[];
	relationIds: string[];
	/** Relations carried over from the previous definition are dropped quietly when no longer valid. */
	carriedRelations: boolean;
	contract: CompositeContract;
	boundary: Partial<CompositeBoundary> | undefined;
	/** Infer the boundary for sides the draft leaves open (otherwise `previousBoundary` is kept). */
	previousBoundary: CompositeBoundary | null;
};

type ValidDefinition = {
	members: Artifact[];
	relationIds: string[];
	contract: CompositeContract;
	boundary: CompositeBoundary;
};

async function lockComposites(q: Db, projectId: string, ids: readonly string[]): Promise<void> {
	if (ids.length === 0) return;
	await q
		.select({ id: artifacts.id })
		.from(artifacts)
		.where(
			and(
				eq(artifacts.projectId, projectId),
				inArray(artifacts.id, [...ids]),
				eq(artifacts.composition, 'COMPOSITE')
			)
		)
		.orderBy(asc(artifacts.id))
		.for('update');
}

/**
 * Shared Compose/Revise validation. Visibility first (hidden = nonexistent, never revealed),
 * then structure, scope containment, claims, boundary and membership cycles.
 */
async function validateDefinition(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	compositeId: string | null,
	scope: OwnerScope,
	draft: DefinitionDraft
): Promise<ValidDefinition> {
	assertNoDuplicates(draft.memberIds, 'members');
	assertNoDuplicates(draft.relationIds, 'member relations');
	if (compositeId !== null && draft.memberIds.includes(compositeId)) {
		throw new TlonError('MEMBERSHIP_CYCLE', 'composite would contain itself', {
			compositeId,
			memberId: compositeId
		});
	}

	await lockComposites(q, projectId, [...(compositeId ? [compositeId] : []), ...draft.memberIds]);

	const visibleMembers = new Map<string, Artifact>();
	for (const part of chunk(draft.memberIds, LOOKUP_CHUNK)) {
		for (const a of await selectArtifacts(
			ctx,
			q,
			principal,
			projectId,
			inArray(artifacts.id, part)
		)) {
			visibleMembers.set(a.id, a);
		}
	}
	const members = draft.memberIds.map((id) => {
		const found = visibleMembers.get(id);
		if (!found) throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactId: id });
		return found;
	});
	for (const m of members) {
		if (m.status === 'REJECTED') {
			throw new TlonError('VALIDATION_FAILED', 'rejected artifacts cannot be composed', {
				artifactId: m.id
			});
		}
	}

	const memberSet = new Set(draft.memberIds);
	const foundRelations = new Map<string, Relation>();
	for (const part of chunk(draft.relationIds, LOOKUP_CHUNK)) {
		for (const r of await loadRelations(
			ctx,
			q,
			principal,
			projectId,
			inArray(relations.id, part)
		)) {
			foundRelations.set(r.id, r);
		}
	}
	const validRelations: Relation[] = [];
	for (const id of draft.relationIds) {
		const rel = foundRelations.get(id);
		const inside = rel !== undefined && memberSet.has(rel.fromId) && memberSet.has(rel.toId);
		if (draft.carriedRelations) {
			if (inside) validRelations.push(rel);
			continue;
		}
		if (!rel) throw new TlonError('RELATION_NOT_FOUND', 'relation not found', { relationId: id });
		if (!inside) {
			throw new TlonError(
				'VALIDATION_FAILED',
				'member relations need both endpoints among the members',
				{
					relationId: id
				}
			);
		}
		validRelations.push(rel);
	}

	// Scope containment: nobody who can read the composite may be unable to read a member.
	const audience = visibleAudience(scope);
	for (const m of members) {
		const memberAudience = visibleAudience(m.ownerScope);
		for (const role of audience) {
			if (!memberAudience.has(role)) {
				throw new TlonError(
					'SCOPE_LEAK',
					'composite scope would expose a member to readers who cannot see it',
					{
						artifactId: m.id
					}
				);
			}
		}
	}

	// Claims cite a member's exact revision.
	const claims = [
		...draft.contract.entryConditions,
		...draft.contract.exitConditions,
		...draft.contract.invariants,
		...draft.contract.keyClaims
	];
	for (const claim of claims) {
		if (!memberSet.has(claim.sourceArtifactId)) {
			throw new TlonError('VALIDATION_FAILED', 'claim source must be a member', {
				claimId: claim.claimId
			});
		}
	}
	const revisionIds = [...new Set(claims.map((c) => c.sourceRevisionId))];
	const revisionOwner = new Map<string, string>();
	for (const part of chunk(revisionIds, LOOKUP_CHUNK)) {
		const rows = await q
			.select({ id: artifactRevisions.id, artifactId: artifactRevisions.artifactId })
			.from(artifactRevisions)
			.where(inArray(artifactRevisions.id, part));
		for (const r of rows) revisionOwner.set(r.id, r.artifactId);
	}
	for (const claim of claims) {
		if (revisionOwner.get(claim.sourceRevisionId) !== claim.sourceArtifactId) {
			throw new TlonError('VALIDATION_FAILED', 'claim cites an unknown member revision', {
				claimId: claim.claimId
			});
		}
	}

	const inferred = inferBoundary(draft.memberIds, validRelations);
	const boundary: CompositeBoundary = {
		entries: draft.boundary?.entries ?? draft.previousBoundary?.entries ?? inferred.entries,
		exits: draft.boundary?.exits ?? draft.previousBoundary?.exits ?? inferred.exits
	};
	for (const ref of [...boundary.entries, ...boundary.exits]) {
		if (!memberSet.has(ref)) {
			throw new TlonError('VALIDATION_FAILED', 'boundary entries and exits must be members', {
				artifactId: ref
			});
		}
	}

	if (compositeId !== null) {
		const heads = await loadBundles(q, headOf(projectId));
		assertNoMembershipCycle(
			compositeId,
			draft.memberIds,
			membershipIndex(
				heads
					.filter((h) => h.row.compositeArtifactId !== compositeId)
					.map((h) => ({
						artifactId: h.row.compositeArtifactId,
						memberArtifactIds: h.members.map((m) => m.memberArtifactId)
					}))
			)
		);
	}

	return {
		members,
		relationIds: validRelations.map((r) => r.id),
		contract: draft.contract,
		boundary
	};
}

async function insertDefinition(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	compositeId: string,
	artifactRevisionId: string,
	version: number,
	valid: ValidDefinition,
	reason: string | null
): Promise<void> {
	const definitionId = ctx.newId();
	await q.insert(compositeDefinitions).values({
		id: definitionId,
		projectId,
		compositeArtifactId: compositeId,
		artifactRevisionId,
		version,
		contract: valid.contract,
		boundary: valid.boundary,
		actorId: principal.id,
		reason,
		createdAt: ctx.now()
	});
	for (const part of chunk(
		valid.members.map((m, order) => ({
			definitionId,
			memberArtifactId: m.id,
			// Pins are re-taken at definition time: the head each member has right now.
			memberRevisionId: m.headRevisionId,
			displayOrder: order
		})),
		LOOKUP_CHUNK
	)) {
		await q.insert(compositeMembers).values(part);
	}
	for (const part of chunk(
		valid.relationIds.map((relationId) => ({ definitionId, relationId })),
		LOOKUP_CHUNK
	)) {
		await q.insert(compositeRelationMembers).values(part);
	}
}

/** Imports a bundle's definitions (ids already remapped when requested). */
export async function insertImportedDefinitions(
	q: Db,
	projectId: string,
	definitions: readonly CompositeDefinition[]
): Promise<void> {
	for (const d of definitions) {
		await q.insert(compositeDefinitions).values({
			id: d.id,
			projectId,
			compositeArtifactId: d.compositeArtifactId,
			artifactRevisionId: d.artifactRevisionId,
			version: d.version,
			contract: d.contract,
			boundary: d.boundary,
			actorId: d.actorId,
			reason: d.reason,
			createdAt: new Date(d.createdAt)
		});
		for (const part of chunk(
			d.members.map((m) => ({
				definitionId: d.id,
				memberArtifactId: m.artifactId,
				memberRevisionId: m.pinnedRevisionId,
				displayOrder: m.order
			})),
			LOOKUP_CHUNK
		)) {
			await q.insert(compositeMembers).values(part);
		}
		for (const part of chunk(
			d.memberRelationIds.map((relationId) => ({ definitionId: d.id, relationId })),
			LOOKUP_CHUNK
		)) {
			await q.insert(compositeRelationMembers).values(part);
		}
	}
}

const ArchiveReason = z.string().trim().max(1000).optional();

export function compositeMethods(ctx: Ctx) {
	const { db } = ctx;

	async function compositeRow(tx: Db, principal: Principal, projectId: string, id: string) {
		asUuid(id, 'ARTIFACT_NOT_FOUND');
		const current = await getArtifactRow(ctx, tx, principal, projectId, id);
		if (current.row.composition !== 'COMPOSITE') {
			throw new TlonError('NOT_A_COMPOSITE', 'artifact is not a composite', { artifactId: id });
		}
		if (!writableScopesFor(principal).includes(current.row.ownerScope as OwnerScope)) {
			throw new TlonError('FORBIDDEN', 'composite is read-only for this principal', {
				artifactId: id
			});
		}
		return current;
	}

	return {
		async createComposite(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<CompositeView> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'composite.create');
				const data = parseInput(CreateCompositeInput, input);
				const scope = creationScopeFor(principal, data.ownerScope);
				if (scope === null) {
					throw new TlonError('FORBIDDEN', 'principal may not create composites', { projectId });
				}
				const valid = await validateDefinition(ctx, tx, principal, projectId, null, scope, {
					memberIds: data.memberArtifactIds,
					relationIds: data.memberRelationIds,
					carriedRelations: false,
					contract: data.contract,
					boundary: data.boundary,
					previousBoundary: null
				});
				const status: ArtifactStatus = principal.kind === 'AGENT' ? 'PROPOSED' : 'ACCEPTED';
				const artifact = await insertArtifact(
					ctx,
					tx,
					principal,
					projectId,
					{
						kind: data.kind,
						composition: 'COMPOSITE',
						title: data.title,
						body: valid.contract.summary,
						structured: {},
						status,
						ownerScope: scope,
						locked: false,
						pinned: false
					},
					data.reason ?? null
				);
				await insertDefinition(
					ctx,
					tx,
					principal,
					projectId,
					artifact.id,
					artifact.headRevisionId,
					1,
					valid,
					data.reason ?? null
				);
				await audit(ctx, tx, principal, projectId, 'composite.create', artifact.id, {
					members: valid.members.length,
					relations: valid.relationIds.length,
					version: 1
				});
				return openView(ctx, tx, principal, projectId, artifact.id, 1);
			});
		},

		async getComposite(
			principal: Principal,
			projectId: string,
			id: string,
			query: unknown = {}
		): Promise<CompositeView> {
			await authorize(db, principal, projectId, 'composite.read');
			const { depth } = parseInput(OpenCompositeQuery, query);
			asUuid(id, 'ARTIFACT_NOT_FOUND');
			return openView(ctx, db, principal, projectId, id, depth);
		},

		async reviseComposite(
			principal: Principal,
			projectId: string,
			id: string,
			input: unknown
		): Promise<CompositeView> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'composite.revise');
				const data = parseInput(ReviseCompositeInput, input);
				await compositeRow(tx, principal, projectId, id);
				// Serialise concurrent revisions, then judge the artifact and definition head.
				await lockComposites(tx, projectId, [id]);
				const current = await compositeRow(tx, principal, projectId, id);
				if (current.row.locked) {
					throw new TlonError('ARTIFACT_LOCKED', 'artifact is locked', { artifactId: id });
				}
				if (current.row.status === 'ARCHIVED') {
					throw new TlonError('INVALID_STATE', 'archived composites cannot be revised', {
						artifactId: id
					});
				}
				const [head] = (
					await loadBundles(
						tx,
						and(
							eq(compositeDefinitions.projectId, projectId),
							eq(compositeDefinitions.compositeArtifactId, id)
						)
					)
				).slice(-1);
				if (!head) throw new TlonError('INTERNAL', 'composite definition missing');
				if (head.row.version !== data.expectedDefinitionVersion) {
					throw new TlonError(
						'STALE_DEFINITION',
						'composite definition changed since the expected version',
						{
							currentVersion: head.row.version
						}
					);
				}
				const previousContract = CompositeContract.parse(head.row.contract);
				const structureChanged =
					data.memberArtifactIds !== undefined || data.memberRelationIds !== undefined;
				const valid = await validateDefinition(
					ctx,
					tx,
					principal,
					projectId,
					id,
					current.row.ownerScope as OwnerScope,
					{
						memberIds: data.memberArtifactIds ?? head.members.map((m) => m.memberArtifactId),
						relationIds: data.memberRelationIds ?? head.relationIds,
						carriedRelations: data.memberRelationIds === undefined,
						contract: data.contract ?? previousContract,
						boundary: data.boundary,
						previousBoundary: structureChanged ? null : head.row.boundary
					}
				);
				const updated = await appendRevision(
					ctx,
					tx,
					principal,
					current,
					{
						title: data.title ?? current.row.title,
						body: data.contract ? valid.contract.summary : current.row.body
					},
					data.reason ?? null
				);
				await insertDefinition(
					ctx,
					tx,
					principal,
					projectId,
					id,
					updated.row.headRevisionId,
					head.row.version + 1,
					valid,
					data.reason ?? null
				);
				await audit(ctx, tx, principal, projectId, 'composite.revise', id, {
					members: valid.members.length,
					relations: valid.relationIds.length,
					version: head.row.version + 1
				});
				return openView(ctx, tx, principal, projectId, id, 1);
			});
		},

		async listCompositeRevisions(
			principal: Principal,
			projectId: string,
			id: string
		): Promise<CompositeRevisionList> {
			await authorize(db, principal, projectId, 'composite.read');
			asUuid(id, 'ARTIFACT_NOT_FOUND');
			const { state, artifactList } = await loadState(ctx, db, principal, projectId);
			const artifact = state.artifacts.get(id);
			if (!artifact) {
				throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactId: id });
			}
			if (artifact.composition !== 'COMPOSITE') {
				throw new TlonError('NOT_A_COMPOSITE', 'artifact is not a composite', { artifactId: id });
			}
			const visible = visibleOf(artifactList, state.relations);
			const bundles = await loadBundles(
				db,
				and(
					eq(compositeDefinitions.projectId, projectId),
					eq(compositeDefinitions.compositeArtifactId, id)
				)
			);
			return {
				items: bundles
					.map((b) => visibleDefinition(b, visible))
					.sort((a, b) => b.version - a.version)
			};
		},

		async archiveComposite(
			principal: Principal,
			projectId: string,
			id: string,
			reason?: string
		): Promise<Artifact> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'composite.revise');
				const why = parseInput(ArchiveReason, reason);
				const first = await compositeRow(tx, principal, projectId, id);
				// HUMAN archives anything writable; agents only what their own role created.
				if (principal.kind === 'AGENT' && first.row.creatorRole !== principal.role) {
					throw new TlonError('FORBIDDEN', 'composite was created by another role', {
						artifactId: id
					});
				}
				await lockComposites(tx, projectId, [id]);
				const current = await compositeRow(tx, principal, projectId, id);
				if (current.row.status === 'ARCHIVED') return toArtifact(current.row, current.version);
				if (current.row.locked) {
					throw new TlonError('ARTIFACT_LOCKED', 'artifact is locked', { artifactId: id });
				}
				const updated = await appendRevision(
					ctx,
					tx,
					principal,
					current,
					{ status: 'ARCHIVED' },
					why ?? null
				);
				await audit(ctx, tx, principal, projectId, 'composite.archive', id, {
					version: updated.version
				});
				return toArtifact(updated.row, updated.version);
			});
		}
	};
}
