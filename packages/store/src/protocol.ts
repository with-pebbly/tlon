import { randomBytes } from 'node:crypto';

import {
	AGENT_TOKEN_PREFIX,
	LOCAL_HUMAN,
	RequestRevisionInput,
	type ReviseTaskPayload,
	AcceptFactInput,
	type Artifact,
	type ArtifactSnapshot,
	type BlockView,
	ComposeTriangleInput,
	type CompositeView,
	ConnectInput,
	CreateFactAnchorInput,
	CreateParticipantInput,
	type Direction,
	type ExportBundle,
	FACT_MAX_CHARS,
	FACT_MAX_WORDS,
	FACT_PREFERRED_WORDS,
	type FactAnchor,
	type FactCandidate,
	type FactRationale,
	type FactView,
	type OwnerScope,
	type ParticipantLink,
	type Principal,
	type ProtocolState,
	type Role,
	type Run,
	RunConfig,
	SetTriangleStatusInput,
	StartRunInput,
	SubmitTaskInput,
	type SubmitTaskResult,
	type Task,
	type TaskList,
	type TaskType,
	type TaskView,
	TlonError,
	type TriangleDetail,
	lintFactText,
	parseStructured
} from '@tlon/contracts';
import { isActionAllowed, storyBeats, visibleScopesFor, type GatewayAction } from '@tlon/core';
import { and, asc, desc, eq, inArray, isNull, max, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { appendRevision, insertArtifact } from './artifacts.ts';
import { buildInputManifest, loadCertifications, loadConnections } from './completion.ts';
import { compositeMethods } from './composites.ts';
import type { Db } from './db.ts';
import { hashToken, toAgent } from './gateway.ts';
import {
	asUuid,
	audit,
	authorize,
	chunk,
	guardValidation,
	parseInput,
	type Ctx
} from './internal.ts';
import {
	getArtifactRow,
	loadFindings,
	loadIssueList,
	loadRelations,
	loadTriangles,
	loadValidationGraph,
	selectArtifacts
} from './projections.ts';
import { assertEndpointsInProject } from './relations.ts';
import {
	agentPrincipals,
	completionCertifications,
	continuityFindings,
	narrativeConnections,
	agentTokens,
	artifactRevisions,
	artifacts,
	disclosures,
	factAnchors,
	factCandidates,
	factRationales,
	grants,
	protocolRuns,
	protocolTasks,
	relations,
	triangleContinuations,
	triangles,
	type FactAnchorRow,
	type ProtocolRunRow,
	type ProtocolTaskRow,
	type TriangleRow
} from './schema.ts';

const DEFAULT_PARTICIPANT_TTL_SECONDS = 24 * 60 * 60;
/** Depth cap for gaps opened outside any run (RunConfig.maxDepth's own ceiling). */
const UNBOUNDED_RUN_DEPTH = 10;
const LOCAL_CHAIN_LIMIT = 6;
/** Any UUID inside free text (issue keys embed artifact and finding ids). */
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IN_CHUNK = 5000;

type Side = 'left' | 'right';
type Anchor = { artifactId: string; revisionId: string; factAnchorId: string | null };

/** Roles whose protocol reads are not scrubbed (they see every Triangle anyway). */
const FULL_TASK_VIEW: Partial<Record<Role, true>> = { HUMAN: true, C: true, VALIDATOR: true };

const hidden = (code: 'TASK_NOT_FOUND' | 'TRIANGLE_NOT_FOUND' | 'RUN_NOT_FOUND', id: string) =>
	new TlonError(code, `${code.split('_')[0]?.toLowerCase()} not found`, { id });

// ── Row → contract projections ──────────────────────────────────────────────

function toRun(row: ProtocolRunRow): Run {
	return {
		id: row.id,
		projectId: row.projectId,
		config: RunConfig.parse(row.config),
		status: row.status as Run['status'],
		briefs: row.briefs,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

/**
 * Task projection per reader. A/B are never told where a task sits in the protocol
 * (run, triangle, side, stage, depth): only what the task asks of them.
 */
function toTask(row: ProtocolTaskRow, principal: Principal): Task {
	const full = FULL_TASK_VIEW[principal.role] === true;
	return {
		id: row.id,
		projectId: row.projectId,
		runId: full ? row.runId : null,
		type: row.type as TaskType,
		role: row.role as Task['role'],
		assigneePrincipalId: row.assigneePrincipalId,
		state: row.state as Task['state'],
		stageIndex: full ? row.stageIndex : 1,
		depth: full ? row.depth : 0,
		triangleId: full ? row.triangleId : null,
		side: full ? (row.side as Task['side']) : null,
		direction: row.direction as Direction | null,
		resultRefs: row.resultRefs,
		createdAt: row.createdAt.toISOString(),
		submittedAt: row.submittedAt?.toISOString() ?? null,
		payload: full ? row.payload : null
	};
}

function toFactAnchor(row: FactAnchorRow): FactAnchor {
	return {
		id: row.id,
		projectId: row.projectId,
		fact: { artifactId: row.factArtifactId, revisionId: row.factRevisionId },
		createdAt: row.createdAt.toISOString()
	};
}

async function getTriangleRow(
	q: Db,
	projectId: string,
	id: string,
	forUpdate = false
): Promise<TriangleRow> {
	asUuid(id, 'TRIANGLE_NOT_FOUND');
	const query = q
		.select()
		.from(triangles)
		.where(and(eq(triangles.id, id), eq(triangles.projectId, projectId)));
	const [row] = await (forUpdate ? query.for('update') : query);
	if (!row) throw hidden('TRIANGLE_NOT_FOUND', id);
	return row;
}

async function getRunRow(
	q: Db,
	projectId: string,
	id: string,
	forUpdate = false
): Promise<ProtocolRunRow> {
	asUuid(id, 'RUN_NOT_FOUND');
	const query = q
		.select()
		.from(protocolRuns)
		.where(and(eq(protocolRuns.id, id), eq(protocolRuns.projectId, projectId)));
	const [row] = await (forUpdate ? query.for('update') : query);
	if (!row) throw hidden('RUN_NOT_FOUND', id);
	return row;
}

/**
 * Candidates of the given triangles with their Fact text. `rationale` is filled only for
 * principals holding `fact.rationale.read`; hidden Facts (visibility) are omitted.
 */
async function loadFactCandidates(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	triangleIds: readonly string[],
	withRationale = true
): Promise<FactCandidate[]> {
	if (triangleIds.length === 0) return [];
	const rows = await q
		.select()
		.from(factCandidates)
		.where(inArray(factCandidates.triangleId, [...triangleIds]))
		.orderBy(asc(factCandidates.createdAt), asc(factCandidates.id));
	if (rows.length === 0) return [];
	const factIds = rows.map((r) => r.factArtifactId);
	const visible = new Map<string, Artifact>();
	for (const part of chunk(factIds, IN_CHUNK)) {
		for (const a of await selectArtifacts(
			ctx,
			q,
			principal,
			projectId,
			inArray(artifacts.id, part)
		)) {
			visible.set(a.id, a);
		}
	}
	const rationales = new Map<string, string>();
	if (withRationale && isActionAllowed(principal, 'fact.rationale.read')) {
		for (const part of chunk(factIds, IN_CHUNK)) {
			for (const r of await q
				.select()
				.from(factRationales)
				.where(inArray(factRationales.factArtifactId, part))) {
				rationales.set(r.factArtifactId, r.rationale);
			}
		}
	}
	return rows.flatMap((r) => {
		const fact = visible.get(r.factArtifactId);
		if (!fact || fact.factKind === null) return [];
		return [
			{
				id: r.id,
				triangleId: r.triangleId,
				fact: { artifactId: r.factArtifactId, revisionId: r.factRevisionId },
				kind: fact.factKind,
				text: fact.title,
				status: r.status as FactCandidate['status'],
				lint: lintFactText(fact.title),
				rationale: rationales.get(r.factArtifactId) ?? null,
				createdAt: r.createdAt.toISOString()
			}
		];
	});
}

async function loadTasks(q: Db, projectId: string, where?: SQL): Promise<ProtocolTaskRow[]> {
	return q
		.select()
		.from(protocolTasks)
		.where(and(eq(protocolTasks.projectId, projectId), where))
		.orderBy(asc(protocolTasks.createdAt), asc(protocolTasks.id));
}

async function loadTriangleDetail(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	triangleId: string
): Promise<TriangleDetail> {
	const [triangle] = await loadTriangles(q, projectId, eq(triangles.id, triangleId));
	if (!triangle) throw hidden('TRIANGLE_NOT_FOUND', triangleId);
	const [candidates, tasks] = await Promise.all([
		loadFactCandidates(ctx, q, principal, projectId, [triangleId]),
		loadTasks(q, projectId, eq(protocolTasks.triangleId, triangleId))
	]);
	return { triangle, candidates, tasks: tasks.map((t) => toTask(t, principal)) };
}

// ── Scheduling primitives ───────────────────────────────────────────────────

/** The single active participant of `role`, or null (then any participant of the role may claim). */
async function defaultAssignee(q: Db, projectId: string, role: Role): Promise<string | null> {
	const rows = await q
		.select({ id: agentPrincipals.id })
		.from(agentPrincipals)
		.where(
			and(
				eq(agentPrincipals.projectId, projectId),
				eq(agentPrincipals.role, role),
				isNull(agentPrincipals.disabledAt)
			)
		)
		.limit(2);
	return rows.length === 1 ? (rows[0]?.id ?? null) : null;
}

type NewTask = {
	projectId: string;
	runId: string | null;
	type: TaskType;
	role: 'A' | 'B' | 'C';
	stageIndex: number;
	depth: number;
	triangleId?: string;
	side?: Side;
	direction?: Direction;
	/** `revise_block` only. */
	payload?: ReviseTaskPayload;
	/** Leave the task claimable by any participant of the role instead of the single default one. */
	openClaim?: true;
};

async function insertTask(ctx: Ctx, q: Db, task: NewTask): Promise<ProtocolTaskRow> {
	const [row] = await q
		.insert(protocolTasks)
		.values({
			id: ctx.newId(),
			projectId: task.projectId,
			runId: task.runId,
			type: task.type,
			role: task.role,
			assigneePrincipalId: task.openClaim
				? null
				: await defaultAssignee(q, task.projectId, task.role),
			state: 'pending',
			stageIndex: task.stageIndex,
			depth: task.depth,
			triangleId: task.triangleId ?? null,
			side: task.side ?? null,
			direction: task.direction ?? null,
			payload: task.payload ?? null,
			resultRefs: [],
			submitIdempotencyKey: null,
			createdAt: ctx.now(),
			submittedAt: null
		})
		.returning();
	if (!row) throw new TlonError('INTERNAL', 'task insert returned no row');
	return row;
}

/** Generation wave of a Block/Fact: the stage of the task that produced it; 1 for anything else. */
async function artifactStage(q: Db, projectId: string, artifactId: string): Promise<number> {
	const [row] = await q
		.select({ stage: protocolTasks.stageIndex })
		.from(protocolTasks)
		.where(
			and(
				eq(protocolTasks.projectId, projectId),
				sql`${protocolTasks.resultRefs} @> ${JSON.stringify([{ artifactId }])}::jsonb`
			)
		)
		.orderBy(desc(protocolTasks.stageIndex))
		.limit(1);
	return row?.stage ?? 1;
}

type GapInput = {
	projectId: string;
	runId: string | null;
	left: Anchor;
	right: Anchor;
	parent: TriangleRow | null;
	depth: number;
	stage: number;
	advance: { left: Direction; right: Direction };
};

/** SAME_SIDE_GAP: a gap needs opposed sides, so two anchors of one private scope are refused. */
async function assertOpposedAnchors(
	q: Db,
	projectId: string,
	leftId: string,
	rightId: string
): Promise<void> {
	const rows = await q
		.select({ scope: artifacts.ownerScope })
		.from(artifacts)
		.where(and(eq(artifacts.projectId, projectId), inArray(artifacts.id, [leftId, rightId])));
	const [first, second] = rows;
	if (rows.length === 2 && first?.scope === second?.scope) {
		if (first?.scope === 'A_PRIVATE' || first?.scope === 'B_PRIVATE') {
			throw new TlonError(
				'SAME_SIDE_GAP',
				'both anchors belong to the same private side; a gap needs opposed sides',
				{ side: first.scope === 'A_PRIVATE' ? 'A' : 'B' }
			);
		}
	}
}

/** Records what this executor was served (IDs only) as the task's last-served input manifest. */
async function recordInputManifest(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	task: ProtocolTaskRow,
	view: TaskView
): Promise<void> {
	const block = (b: BlockView) => ({ artifactId: b.id, revisionId: b.revisionId });
	const fact = (f: FactView) => ({ artifactId: f.id, revisionId: f.revisionId });
	let inputs: Array<{ artifactId: string; revisionId: string }> = [];
	if (view.type === 'propose_fact') {
		inputs = [block(view.left), block(view.right), ...view.existingFacts.map(fact)];
	} else if (view.type === 'advance_block') {
		inputs = [block(view.ownBlock), ...view.localContext.map(block), fact(view.fact)];
	} else if (view.type === 'revise_block') {
		inputs = [block(view.ownBlock), ...view.localContext.map(block)];
	}
	const manifest = await buildInputManifest(ctx, q, principal, projectId, inputs);
	await q
		.update(protocolTasks)
		.set({ inputManifest: manifest })
		.where(eq(protocolTasks.id, task.id));
}

/** A Triangle without a Fact yet, plus C's `propose_fact` task. */
async function openGap(ctx: Ctx, q: Db, gap: GapInput): Promise<TriangleRow> {
	await assertOpposedAnchors(q, gap.projectId, gap.left.artifactId, gap.right.artifactId);
	const now = ctx.now();
	const [row] = await q
		.insert(triangles)
		.values({
			id: ctx.newId(),
			projectId: gap.projectId,
			runId: gap.runId,
			leftArtifactId: gap.left.artifactId,
			leftRevisionId: gap.left.revisionId,
			leftFactAnchorId: gap.left.factAnchorId,
			rightArtifactId: gap.right.artifactId,
			rightRevisionId: gap.right.revisionId,
			rightFactAnchorId: gap.right.factAnchorId,
			factArtifactId: null,
			factRevisionId: null,
			status: 'proposed',
			stageIndex: gap.stage,
			depth: gap.depth,
			parentTriangleId: gap.parent?.id ?? null,
			leftDirection: gap.advance.left,
			rightDirection: gap.advance.right,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	if (!row) throw new TlonError('INTERNAL', 'triangle insert returned no row');
	await insertTask(ctx, q, {
		projectId: gap.projectId,
		runId: gap.runId,
		type: 'propose_fact',
		role: 'C',
		stageIndex: gap.stage,
		depth: gap.depth,
		triangleId: row.id
	});
	return row;
}

async function insertRelation(
	ctx: Ctx,
	q: Db,
	projectId: string,
	fromId: string,
	toId: string,
	type: string
): Promise<void> {
	const now = ctx.now();
	await q.insert(relations).values({
		id: ctx.newId(),
		projectId,
		fromId,
		toId,
		type,
		status: 'ACCEPTED',
		expansionId: null,
		provenanceArtifactIds: [],
		createdAt: now,
		updatedAt: now
	});
}

// ── Disclosure (fact-only boundary crossing) ────────────────────────────────

/**
 * READ grant, created only when the pair never had one: a revoked grant is a human
 * decision and must not be silently re-issued by lazy claiming.
 */
async function ensureReadGrant(
	ctx: Ctx,
	q: Db,
	projectId: string,
	granteeId: string,
	artifactId: string,
	createdBy: string
): Promise<boolean> {
	const [existing] = await q
		.select({ id: grants.id })
		.from(grants)
		.where(and(eq(grants.granteePrincipalId, granteeId), eq(grants.artifactId, artifactId)))
		.limit(1);
	if (existing) return false;
	await q.insert(grants).values({
		id: ctx.newId(),
		projectId,
		granteePrincipalId: granteeId,
		artifactId,
		permission: 'READ',
		createdBy,
		createdAt: ctx.now(),
		expiresAt: null,
		revokedAt: null
	});
	return true;
}

/** Role of the participants who write `side` of the triangle (§1.3): the anchor's private scope, else A/B by position. */
function sideRole(anchorScope: OwnerScope, side: Side): 'A' | 'B' {
	if (anchorScope === 'A_PRIVATE') return 'A';
	if (anchorScope === 'B_PRIVATE') return 'B';
	return side === 'left' ? 'A' : 'B';
}

async function anchorScopes(
	q: Db,
	projectId: string,
	triangle: TriangleRow
): Promise<Record<Side, OwnerScope>> {
	const rows = await q
		.select({ id: artifacts.id, scope: artifacts.ownerScope })
		.from(artifacts)
		.where(
			and(
				eq(artifacts.projectId, projectId),
				inArray(artifacts.id, [triangle.leftArtifactId, triangle.rightArtifactId])
			)
		);
	const scopeOf = (id: string) => {
		const found = rows.find((r) => r.id === id);
		if (!found) throw new TlonError('INTERNAL', 'triangle anchor is missing');
		return found.scope as OwnerScope;
	};
	return { left: scopeOf(triangle.leftArtifactId), right: scopeOf(triangle.rightArtifactId) };
}

/**
 * What a side may read to advance: the accepted Fact (grant + a PUBLISHED `fact_only`
 * disclosure so it shows in the review UI) and, when the anchor is not already in the
 * side's scope (a Fact or a composite chosen as endpoint), the anchor itself. Never the
 * opposite anchor.
 */
async function grantSideAccess(
	ctx: Ctx,
	q: Db,
	projectId: string,
	triangle: TriangleRow,
	side: Side,
	recipient: { id: string; role: Role },
	grantedBy: string
): Promise<void> {
	if (triangle.factArtifactId === null || triangle.factRevisionId === null) return;
	const anchorId = side === 'left' ? triangle.leftArtifactId : triangle.rightArtifactId;
	const [anchor] = await q
		.select({ scope: artifacts.ownerScope })
		.from(artifacts)
		.where(eq(artifacts.id, anchorId));
	if (
		anchor &&
		!visibleScopesFor({ role: recipient.role } as unknown as Principal).includes(
			anchor.scope as OwnerScope
		)
	) {
		await ensureReadGrant(ctx, q, projectId, recipient.id, anchorId, grantedBy);
	}
	const created = await ensureReadGrant(
		ctx,
		q,
		projectId,
		recipient.id,
		triangle.factArtifactId,
		grantedBy
	);
	if (!created) return;
	const [fact] = await q
		.select({ title: artifacts.title })
		.from(artifacts)
		.where(eq(artifacts.id, triangle.factArtifactId));
	const now = ctx.now();
	await q.insert(disclosures).values({
		id: ctx.newId(),
		projectId,
		fromPrincipalId: grantedBy,
		toPrincipalId: recipient.id,
		sourceRefs: [{ artifactId: triangle.factArtifactId, revisionId: triangle.factRevisionId }],
		sharedPayload: { kind: 'NOTE', title: fact?.title ?? '', body: '', structured: {} },
		redactionNote: 'fact_only',
		status: 'PUBLISHED',
		sharedArtifactId: triangle.factArtifactId,
		reviewedBy: grantedBy,
		createdAt: now,
		reviewedAt: now
	});
}

// ── Task access and views ───────────────────────────────────────────────────

/** An executor may act on tasks of its role that are unclaimed or already its own. */
function canActOn(principal: Principal, task: ProtocolTaskRow): boolean {
	return (
		principal.kind === 'AGENT' &&
		principal.role === task.role &&
		(task.assigneePrincipalId === null || task.assigneePrincipalId === principal.id)
	);
}

async function lockTask(
	q: Db,
	principal: Principal,
	projectId: string,
	taskId: string,
	forUpdate: boolean
): Promise<ProtocolTaskRow> {
	asUuid(taskId, 'TASK_NOT_FOUND');
	const query = q
		.select()
		.from(protocolTasks)
		.where(and(eq(protocolTasks.id, taskId), eq(protocolTasks.projectId, projectId)));
	const [row] = await (forUpdate ? query.for('update') : query);
	// Another participant's task is indistinguishable from a missing one.
	if (!row || (principal.kind === 'AGENT' && !canActOn(principal, row))) {
		throw hidden('TASK_NOT_FOUND', taskId);
	}
	return row;
}

/** Every artifact a view exposes must pass the normal visibility predicate — never bypassed. */
async function visibleArtifacts(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	ids: readonly string[]
): Promise<Map<string, Artifact>> {
	const unique = [...new Set(ids)];
	const found = await selectArtifacts(ctx, q, principal, projectId, inArray(artifacts.id, unique));
	const map = new Map(found.map((a) => [a.id, a]));
	for (const id of unique) {
		if (!map.has(id)) {
			throw new TlonError('INVALID_STATE', 'a task input is not visible to this executor');
		}
	}
	return map;
}

async function pinnedSnapshots(
	q: Db,
	refs: ReadonlyArray<{ artifactId: string; revisionId: string }>
): Promise<Map<string, ArtifactSnapshot>> {
	const rows = await q
		.select({
			id: artifactRevisions.id,
			artifactId: artifactRevisions.artifactId,
			snapshot: artifactRevisions.snapshot
		})
		.from(artifactRevisions)
		.where(
			inArray(
				artifactRevisions.id,
				refs.map((r) => r.revisionId)
			)
		);
	const map = new Map<string, ArtifactSnapshot>();
	for (const ref of refs) {
		const row = rows.find((r) => r.id === ref.revisionId && r.artifactId === ref.artifactId);
		if (!row) throw new TlonError('REVISION_NOT_FOUND', 'pinned revision not found');
		map.set(ref.revisionId, row.snapshot as ArtifactSnapshot);
	}
	return map;
}

function blockView(
	artifact: Artifact,
	revisionId: string,
	snapshots: ReadonlyMap<string, ArtifactSnapshot>
): BlockView {
	const snap = snapshots.get(revisionId);
	if (!snap) throw new TlonError('REVISION_NOT_FOUND', 'pinned revision not found');
	return {
		id: artifact.id,
		revisionId,
		kind: snap.kind,
		title: snap.title,
		body: snap.body,
		ownerScope: artifact.ownerScope
	};
}

function factView(
	artifactId: string,
	revisionId: string,
	snapshots: ReadonlyMap<string, ArtifactSnapshot>
): FactView {
	const snap = snapshots.get(revisionId);
	if (!snap || snap.factKind === null) {
		throw new TlonError('INTERNAL', 'fact revision is not a Fact');
	}
	return { id: artifactId, revisionId, kind: snap.factKind, text: snap.title };
}

/** Own-scope ancestors along `precedes`, oldest first, at most six. */
async function localChain(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string,
	own: Artifact
): Promise<BlockView[]> {
	const chain: Artifact[] = [];
	const seen = new Set([own.id]);
	let cursor = own.id;
	for (let i = 0; i < LOCAL_CHAIN_LIMIT; i += 1) {
		const incoming = await loadRelations(
			ctx,
			q,
			principal,
			projectId,
			and(
				eq(relations.type, 'precedes'),
				eq(relations.toId, cursor),
				ne(relations.status, 'REJECTED')
			)
		);
		const fromIds = incoming.map((r) => r.fromId).filter((id) => !seen.has(id));
		if (fromIds.length === 0) break;
		const found = await selectArtifacts(
			ctx,
			q,
			principal,
			projectId,
			inArray(artifacts.id, fromIds)
		);
		const next = found.find(
			(a) =>
				a.ownerScope === own.ownerScope && a.artifactClass === 'BLOCK' && a.status !== 'REJECTED'
		);
		if (!next) break;
		chain.unshift(next);
		seen.add(next.id);
		cursor = next.id;
	}
	return chain.map(headBlockView);
}

/** A Block as served to an executor: its current head revision. */
function headBlockView(a: Artifact): BlockView {
	return {
		id: a.id,
		revisionId: a.headRevisionId,
		kind: a.kind,
		title: a.title,
		body: a.body,
		ownerScope: a.ownerScope
	};
}

/**
 * View of a `revise_block` task. Reading order comes from the whole story graph (computed
 * with full read access), but only Blocks of the executor's own scope leave this function.
 */
async function reviseView(
	ctx: Ctx,
	tx: Db,
	principal: Principal,
	projectId: string,
	task: ProtocolTaskRow,
	taskView: Task
): Promise<TaskView> {
	const payload = task.payload;
	if (payload === null) throw new TlonError('INTERNAL', 'revise task without a payload');
	const own = (await visibleArtifacts(ctx, tx, principal, projectId, [payload.artifactId])).get(
		payload.artifactId
	);
	if (!own) throw new TlonError('INTERNAL', 'revision target is missing');
	const graph = await loadValidationGraph(ctx, tx, LOCAL_HUMAN, projectId);
	const side = storyBeats(graph)
		.map((beat) => beat.artifact)
		.filter((a) => a.ownerScope === own.ownerScope && a.artifactClass === 'BLOCK');
	return {
		type: 'revise_block',
		task: taskView,
		ownBlock: headBlockView(own),
		localContext: (side.some((a) => a.id === own.id) ? side : [...side, own]).map(headBlockView),
		problems: payload.problems,
		instructions: payload.instructions
	};
}

/** Gives a role-matched executor its side's access lazily (late-joining participants). */
async function ensureSideAccess(
	ctx: Ctx,
	tx: Db,
	principal: Principal,
	projectId: string,
	task: ProtocolTaskRow,
	triangle: TriangleRow
): Promise<void> {
	if (principal.kind !== 'AGENT' || task.side === null) return;
	await grantSideAccess(ctx, tx, projectId, triangle, task.side as Side, principal, 'protocol');
}

async function buildView(
	ctx: Ctx,
	tx: Db,
	principal: Principal,
	projectId: string,
	task: ProtocolTaskRow
): Promise<TaskView> {
	const taskView = toTask(task, principal);
	if (task.type === 'seed_block') {
		if (task.runId === null) throw new TlonError('INTERNAL', 'seed task without a run');
		const run = await getRunRow(tx, projectId, task.runId);
		return {
			type: 'seed_block',
			task: taskView,
			brief: task.role === 'A' ? run.briefs.A : run.briefs.B
		};
	}
	if (task.type === 'revise_block') {
		return reviseView(ctx, tx, principal, projectId, task, taskView);
	}
	if (task.triangleId === null) throw new TlonError('INTERNAL', 'task without a triangle');
	const triangle = await getTriangleRow(tx, projectId, task.triangleId);

	if (task.type === 'propose_fact') {
		const artifactMap = await visibleArtifacts(ctx, tx, principal, projectId, [
			triangle.leftArtifactId,
			triangle.rightArtifactId
		]);
		const earlier = await tx
			.select({ candidate: factCandidates, triangle: triangles })
			.from(factCandidates)
			.innerJoin(triangles, eq(triangles.id, factCandidates.triangleId))
			.where(
				and(
					eq(triangles.projectId, projectId),
					ne(triangles.id, triangle.id),
					eq(factCandidates.status, 'accepted'),
					or(
						and(
							eq(triangles.leftArtifactId, triangle.leftArtifactId),
							eq(triangles.rightArtifactId, triangle.rightArtifactId)
						),
						and(
							eq(triangles.leftArtifactId, triangle.rightArtifactId),
							eq(triangles.rightArtifactId, triangle.leftArtifactId)
						)
					)
				)
			)
			.orderBy(asc(factCandidates.createdAt));
		await visibleArtifacts(
			ctx,
			tx,
			principal,
			projectId,
			earlier.map((e) => e.candidate.factArtifactId)
		);
		const snapshots = await pinnedSnapshots(tx, [
			{ artifactId: triangle.leftArtifactId, revisionId: triangle.leftRevisionId },
			{ artifactId: triangle.rightArtifactId, revisionId: triangle.rightRevisionId },
			...earlier.map((e) => ({
				artifactId: e.candidate.factArtifactId,
				revisionId: e.candidate.factRevisionId
			}))
		]);
		const left = artifactMap.get(triangle.leftArtifactId);
		const right = artifactMap.get(triangle.rightArtifactId);
		if (!left || !right) throw new TlonError('INTERNAL', 'triangle anchor is missing');
		const maxCandidates = triangle.runId
			? RunConfig.parse((await getRunRow(tx, projectId, triangle.runId)).config).maxCandidates
			: RunConfig.parse({}).maxCandidates;
		return {
			type: 'propose_fact',
			task: taskView,
			left: blockView(left, triangle.leftRevisionId, snapshots),
			right: blockView(right, triangle.rightRevisionId, snapshots),
			existingFacts: earlier.map((e) =>
				factView(e.candidate.factArtifactId, e.candidate.factRevisionId, snapshots)
			),
			policy: {
				maxWords: FACT_MAX_WORDS,
				maxChars: FACT_MAX_CHARS,
				preferredWords: { ...FACT_PREFERRED_WORDS },
				maxCandidates
			}
		};
	}

	if (task.type === 'advance_block') {
		if (
			triangle.factArtifactId === null ||
			triangle.factRevisionId === null ||
			task.side === null
		) {
			throw new TlonError('INVALID_STATE', 'the Fact for this task is not accepted yet');
		}
		await ensureSideAccess(ctx, tx, principal, projectId, task, triangle);
		const ownId = task.side === 'left' ? triangle.leftArtifactId : triangle.rightArtifactId;
		const ownRevisionId = task.side === 'left' ? triangle.leftRevisionId : triangle.rightRevisionId;
		const artifactMap = await visibleArtifacts(ctx, tx, principal, projectId, [
			ownId,
			triangle.factArtifactId
		]);
		const snapshots = await pinnedSnapshots(tx, [
			{ artifactId: ownId, revisionId: ownRevisionId },
			{ artifactId: triangle.factArtifactId, revisionId: triangle.factRevisionId }
		]);
		const own = artifactMap.get(ownId);
		if (!own) throw new TlonError('INTERNAL', 'triangle anchor is missing');
		return {
			type: 'advance_block',
			task: taskView,
			ownBlock: blockView(own, ownRevisionId, snapshots),
			localContext: await localChain(ctx, tx, principal, projectId, own),
			fact: factView(triangle.factArtifactId, triangle.factRevisionId, snapshots),
			direction: (task.direction as Direction | null) ?? 'forward'
		};
	}
	throw new TlonError('INVALID_STATE', 'this task type has no executor view');
}

// ── Anchors ─────────────────────────────────────────────────────────────────

/** Pins the Fact's current head as a FactAnchor, reusing an existing anchor of the same revision. */
async function persistFactAnchor(
	ctx: Ctx,
	q: Db,
	projectId: string,
	factArtifactId: string,
	factRevisionId: string
): Promise<FactAnchorRow> {
	const [existing] = await q
		.select()
		.from(factAnchors)
		.where(
			and(
				eq(factAnchors.projectId, projectId),
				eq(factAnchors.factArtifactId, factArtifactId),
				eq(factAnchors.factRevisionId, factRevisionId)
			)
		);
	if (existing) return existing;
	const [row] = await q
		.insert(factAnchors)
		.values({
			id: ctx.newId(),
			projectId,
			factArtifactId,
			factRevisionId,
			createdAt: ctx.now()
		})
		.returning();
	if (!row) throw new TlonError('INTERNAL', 'fact anchor insert returned no row');
	return row;
}

async function resolveAnchor(
	ctx: Ctx,
	tx: Db,
	principal: Principal,
	projectId: string,
	ref: { artifactId: string; viaFact: boolean }
): Promise<Anchor> {
	asUuid(ref.artifactId, 'ARTIFACT_NOT_FOUND');
	await assertEndpointsInProject(ctx, tx, principal, projectId, [ref.artifactId]);
	const { row } = await getArtifactRow(ctx, tx, principal, projectId, ref.artifactId);
	if (row.status === 'REJECTED' || row.status === 'ARCHIVED') {
		throw new TlonError('INVALID_STATE', 'a rejected or archived artifact cannot be an anchor', {
			artifactId: row.id
		});
	}
	const isFact = row.artifactClass === 'FACT';
	if (isFact !== ref.viaFact) {
		throw new TlonError(
			'VALIDATION_FAILED',
			isFact
				? 'a Fact can only be an anchor through a FactAnchor (viaFact)'
				: 'viaFact is only valid for a Fact',
			{ artifactId: row.id }
		);
	}
	if (!isFact) return { artifactId: row.id, revisionId: row.headRevisionId, factAnchorId: null };
	if (row.status !== 'ACCEPTED') {
		throw new TlonError('INVALID_STATE', 'only an accepted Fact can be an anchor', {
			artifactId: row.id
		});
	}
	const anchor = await persistFactAnchor(ctx, tx, projectId, row.id, row.headRevisionId);
	return { artifactId: row.id, revisionId: row.headRevisionId, factAnchorId: anchor.id };
}

// ── Facilitator / mediator authorization ────────────────────────────────────

/** Facilitator (HUMAN) or the mediator C; A/B/VALIDATOR are refused. */
async function authorizeGapWriter(tx: Db, principal: Principal, projectId: string) {
	const action: GatewayAction = principal.role === 'C' ? 'triangle.read' : 'protocol.facilitate';
	return authorize(tx, principal, projectId, action);
}

// ── Public methods ──────────────────────────────────────────────────────────

export function protocolMethods(ctx: Ctx) {
	const { db } = ctx;
	const composites = compositeMethods(ctx);

	async function maybeConverge(tx: Db, triangleId: string): Promise<void> {
		const [triangle] = await tx.select().from(triangles).where(eq(triangles.id, triangleId));
		if (!triangle || triangle.status !== 'expanding') return;
		const conts = await tx
			.select({ side: triangleContinuations.side })
			.from(triangleContinuations)
			.where(eq(triangleContinuations.triangleId, triangleId));
		const pending = await tx
			.select({ id: protocolTasks.id })
			.from(protocolTasks)
			.where(
				and(
					eq(protocolTasks.triangleId, triangleId),
					eq(protocolTasks.type, 'advance_block'),
					eq(protocolTasks.state, 'pending')
				)
			)
			.limit(1);
		const sides = new Set(conts.map((c) => c.side));
		if (sides.has('left') && sides.has('right') && pending.length === 0) {
			await tx
				.update(triangles)
				.set({ status: 'converged', updatedAt: ctx.now() })
				.where(eq(triangles.id, triangleId));
		}
	}

	/** The submitter's private scope for new Blocks (A_PRIVATE / B_PRIVATE). */
	function blockScope(principal: Principal): OwnerScope {
		if (principal.role === 'A') return 'A_PRIVATE';
		if (principal.role === 'B') return 'B_PRIVATE';
		throw new TlonError('FORBIDDEN', 'only A and B write Blocks');
	}

	return {
		async createParticipant(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<ParticipantLink> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'project.admin');
				const data = parseInput(CreateParticipantInput, input);
				const [clash] = await tx
					.select({ id: agentPrincipals.id })
					.from(agentPrincipals)
					.where(
						and(
							eq(agentPrincipals.projectId, projectId),
							eq(agentPrincipals.role, data.role),
							eq(agentPrincipals.name, data.name)
						)
					);
				if (clash) {
					throw new TlonError(
						'INVALID_STATE',
						'a participant with this role and name already exists',
						{
							principalId: clash.id
						}
					);
				}
				const now = ctx.now();
				const [row] = await tx
					.insert(agentPrincipals)
					.values({
						id: ctx.newId(),
						projectId,
						role: data.role,
						name: data.name,
						executorKind: data.executorKind,
						createdAt: now,
						disabledAt: null
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'participant insert returned no row');
				const ttl = data.ttlSeconds ?? DEFAULT_PARTICIPANT_TTL_SECONDS;
				const expiresAt = new Date(now.getTime() + ttl * 1000);
				const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
				const tokenId = ctx.newId();
				await tx.insert(agentTokens).values({
					id: tokenId,
					principalId: row.id,
					tokenHash: hashToken(token),
					createdAt: now,
					expiresAt,
					revokedAt: null
				});
				await audit(ctx, tx, principal, projectId, 'participant.create', row.id, {
					role: data.role,
					executorKind: data.executorKind,
					tokenId,
					ttlSeconds: ttl
				});
				const agent = toAgent(row);
				return {
					principalId: agent.id,
					role: data.role,
					name: agent.name,
					executorKind: agent.executorKind,
					token,
					expiresAt: expiresAt.toISOString()
				};
			});
		},

		async startRun(principal: Principal, projectId: string, input: unknown): Promise<Run> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'protocol.facilitate');
				const data = parseInput(StartRunInput, input);
				const config = RunConfig.parse(data.config ?? {});
				const now = ctx.now();
				const [row] = await tx
					.insert(protocolRuns)
					.values({
						id: ctx.newId(),
						projectId,
						config,
						status: 'active',
						briefs: { A: data.briefA, B: data.briefB },
						createdAt: now,
						updatedAt: now
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'run insert returned no row');
				for (const role of ['A', 'B'] as const) {
					await insertTask(ctx, tx, {
						projectId,
						runId: row.id,
						type: 'seed_block',
						role,
						stageIndex: 1,
						depth: 0
					});
				}
				await audit(ctx, tx, principal, projectId, 'run.start', row.id, {
					participantMode: config.participantMode,
					factReview: config.factReview
				});
				return toRun(row);
			});
		},

		async listRuns(principal: Principal, projectId: string): Promise<{ items: Run[] }> {
			await authorize(db, principal, projectId, 'protocol.facilitate');
			const rows = await db
				.select()
				.from(protocolRuns)
				.where(eq(protocolRuns.projectId, projectId))
				.orderBy(asc(protocolRuns.createdAt), asc(protocolRuns.id));
			return { items: rows.map(toRun) };
		},

		/** HUMAN: everything. C: triangles + its tasks. VALIDATOR: triangles. A/B: forbidden. */
		async getProtocol(principal: Principal, projectId: string): Promise<ProtocolState> {
			await authorize(db, principal, projectId, 'triangle.read');
			const facilitator = isActionAllowed(principal, 'protocol.facilitate');
			const [runRows, triangleList, taskRows, anchorRows] = await Promise.all([
				facilitator
					? db
							.select()
							.from(protocolRuns)
							.where(eq(protocolRuns.projectId, projectId))
							.orderBy(asc(protocolRuns.createdAt), asc(protocolRuns.id))
					: Promise.resolve([]),
				loadTriangles(db, projectId),
				facilitator
					? loadTasks(db, projectId)
					: isActionAllowed(principal, 'task.own')
						? loadTasks(db, projectId, eq(protocolTasks.role, principal.role))
						: Promise.resolve([]),
				db
					.select()
					.from(factAnchors)
					.where(eq(factAnchors.projectId, projectId))
					.orderBy(asc(factAnchors.createdAt), asc(factAnchors.id))
			]);
			return {
				runs: runRows.map(toRun),
				triangles: triangleList,
				tasks: taskRows.map((t) => toTask(t, principal)),
				factAnchors: anchorRows.map(toFactAnchor)
			};
		},

		async listTasks(principal: Principal, projectId: string): Promise<TaskList> {
			await authorize(db, principal, projectId, 'protocol.facilitate');
			const rows = await loadTasks(db, projectId);
			return { items: rows.map((t) => toTask(t, principal)) };
		},

		/** Pending/submitted tasks assigned to the caller, or claimable by its role. */
		async listMyTasks(principal: Principal, projectId: string): Promise<TaskList> {
			await authorize(db, principal, projectId, 'task.own');
			const rows = await loadTasks(
				db,
				projectId,
				and(
					eq(protocolTasks.role, principal.role),
					inArray(protocolTasks.state, ['pending', 'submitted']),
					or(
						eq(protocolTasks.assigneePrincipalId, principal.id),
						and(isNull(protocolTasks.assigneePrincipalId), eq(protocolTasks.state, 'pending'))
					)
				)
			);
			return { items: rows.map((t) => toTask(t, principal)) };
		},

		async getTaskView(principal: Principal, projectId: string, taskId: string): Promise<TaskView> {
			return db.transaction(async (tx) => {
				await authorize(
					tx,
					principal,
					projectId,
					principal.kind === 'HUMAN' ? 'protocol.facilitate' : 'task.own'
				);
				const task = await lockTask(tx, principal, projectId, taskId, false);
				const view = await buildView(ctx, tx, principal, projectId, task);
				if (principal.kind === 'AGENT') {
					await recordInputManifest(ctx, tx, principal, projectId, task, view);
				}
				return view;
			});
		},

		async submitTask(
			principal: Principal,
			projectId: string,
			taskId: string,
			input: unknown
		): Promise<SubmitTaskResult> {
			return db.transaction(async (tx) => {
				const project = await authorize(tx, principal, projectId, 'task.own');
				const data = parseInput(SubmitTaskInput, input);
				const task = await lockTask(tx, principal, projectId, taskId, true);

				const [byKey] = await tx
					.select()
					.from(protocolTasks)
					.where(
						and(
							eq(protocolTasks.projectId, projectId),
							eq(protocolTasks.submitIdempotencyKey, data.idempotencyKey)
						)
					);
				if (byKey) {
					if (byKey.id !== task.id) {
						throw new TlonError(
							'IDEMPOTENCY_KEY_REUSED',
							'idempotency key was used for another task'
						);
					}
					return {
						task: toTask(task, principal),
						warnings: await replayWarnings(tx, task),
						replayed: true
					};
				}
				if (task.state !== 'pending') {
					throw new TlonError('INVALID_STATE', 'task was already submitted', { taskId: task.id });
				}
				const submission = data.submission;
				if (submission.type !== task.type) {
					throw new TlonError('VALIDATION_FAILED', 'submission type does not match the task');
				}

				const resultRefs: Array<{ artifactId: string; revisionId: string }> = [];
				const warnings: string[] = [];

				if (submission.type === 'seed_block') {
					if (task.runId === null) throw new TlonError('INTERNAL', 'seed task without a run');
					await getRunRow(tx, projectId, task.runId, true); // serialises the two seed submissions
					const structured = guardValidation(() =>
						parseStructured(project.domain as 'NARRATIVE' | 'GENERIC', submission.block.kind, {})
					);
					const block = await insertArtifact(
						ctx,
						tx,
						principal,
						projectId,
						{
							kind: submission.block.kind,
							title: submission.block.title,
							body: submission.block.body,
							structured,
							status: 'ACCEPTED',
							ownerScope: blockScope(principal),
							locked: false,
							pinned: false
						},
						`seed task ${task.id}`
					);
					resultRefs.push({ artifactId: block.id, revisionId: block.headRevisionId });
				} else if (submission.type === 'propose_fact') {
					if (task.triangleId === null) throw new TlonError('INTERNAL', 'task without a triangle');
					const triangle = await getTriangleRow(tx, projectId, task.triangleId, true);
					if (triangle.status !== 'proposed' || triangle.factArtifactId !== null) {
						throw new TlonError('INVALID_STATE', 'this gap already has a Fact');
					}
					const maxCandidates = triangle.runId
						? RunConfig.parse((await getRunRow(tx, projectId, triangle.runId)).config).maxCandidates
						: RunConfig.parse({}).maxCandidates;
					if (submission.candidates.length > maxCandidates) {
						throw new TlonError('CANDIDATE_LIMIT_EXCEEDED', 'too many Fact candidates', {
							max: maxCandidates
						});
					}
					for (const [index, candidate] of submission.candidates.entries()) {
						const fact = await insertArtifact(
							ctx,
							tx,
							principal,
							projectId,
							{
								kind: 'NOTE',
								artifactClass: 'FACT',
								factKind: candidate.kind,
								title: candidate.text,
								body: '',
								structured: {},
								status: 'PROPOSED',
								ownerScope: 'C_SHARED',
								locked: false,
								pinned: false
							},
							`fact proposal ${task.id}`
						);
						await tx.insert(factCandidates).values({
							id: ctx.newId(),
							triangleId: triangle.id,
							factArtifactId: fact.id,
							factRevisionId: fact.headRevisionId,
							status: 'proposed',
							createdAt: ctx.now()
						});
						const rationale = candidate.rationale?.trim();
						if (rationale) {
							await tx.insert(factRationales).values({
								factArtifactId: fact.id,
								projectId,
								rationale,
								createdAt: ctx.now()
							});
						}
						for (const warning of lintFactText(candidate.text).warnings) {
							warnings.push(`Candidate ${index + 1}: ${warning}`);
						}
						resultRefs.push({ artifactId: fact.id, revisionId: fact.headRevisionId });
					}
				} else if (submission.type === 'revise_block') {
					const payload = task.payload;
					if (payload === null) throw new TlonError('INTERNAL', 'revise task without a payload');
					// Invisible → ARTIFACT_NOT_FOUND; another side's Block is never writable here.
					const current = await getArtifactRow(ctx, tx, principal, projectId, payload.artifactId);
					if (current.row.ownerScope !== blockScope(principal)) {
						throw new TlonError('FORBIDDEN', 'the Block belongs to the other side', {
							artifactId: payload.artifactId
						});
					}
					if (current.row.locked) {
						throw new TlonError('INVALID_STATE', 'the Block is locked', {
							artifactId: payload.artifactId
						});
					}
					const kind = submission.block.kind;
					const structured = guardValidation(() =>
						parseStructured(
							project.domain as 'NARRATIVE' | 'GENERIC',
							kind,
							kind === current.row.kind ? current.row.structured : {}
						)
					);
					const revised = await appendRevision(
						ctx,
						tx,
						principal,
						current,
						{ kind, title: submission.block.title, body: submission.block.body, structured },
						`revise task ${task.id}`
					);
					resultRefs.push({ artifactId: revised.row.id, revisionId: revised.row.headRevisionId });
				} else {
					if (task.triangleId === null || task.side === null) {
						throw new TlonError('INTERNAL', 'task without a triangle');
					}
					const triangle = await getTriangleRow(tx, projectId, task.triangleId, true);
					if (triangle.factArtifactId === null || triangle.factRevisionId === null) {
						throw new TlonError('INVALID_STATE', 'the Fact for this task is not accepted yet');
					}
					const side = task.side as Side;
					const anchorId = side === 'left' ? triangle.leftArtifactId : triangle.rightArtifactId;
					await ensureSideAccess(ctx, tx, principal, projectId, task, triangle);
					// The anchor must be readable by the writer: the same predicate the view used.
					await visibleArtifacts(ctx, tx, principal, projectId, [
						anchorId,
						triangle.factArtifactId
					]);
					const structured = guardValidation(() =>
						parseStructured(project.domain as 'NARRATIVE' | 'GENERIC', submission.block.kind, {})
					);
					const block = await insertArtifact(
						ctx,
						tx,
						principal,
						projectId,
						{
							kind: submission.block.kind,
							title: submission.block.title,
							body: submission.block.body,
							structured,
							status: 'ACCEPTED',
							ownerScope: blockScope(principal),
							locked: false,
							pinned: false
						},
						`advance task ${task.id}`
					);
					const direction = (task.direction as Direction | null) ?? 'forward';
					if (direction === 'forward') {
						await insertRelation(ctx, tx, projectId, anchorId, block.id, 'precedes');
					} else if (direction === 'backward') {
						await insertRelation(ctx, tx, projectId, block.id, anchorId, 'precedes');
					} else {
						await insertRelation(ctx, tx, projectId, block.id, anchorId, 'involves');
					}
					await insertRelation(ctx, tx, projectId, block.id, triangle.factArtifactId, 'has_fact');
					await tx.insert(triangleContinuations).values({
						triangleId: triangle.id,
						side,
						artifactId: block.id,
						revisionId: block.headRevisionId,
						taskId: task.id
					});
					resultRefs.push({ artifactId: block.id, revisionId: block.headRevisionId });
				}

				const [updated] = await tx
					.update(protocolTasks)
					.set({
						state: 'submitted',
						assigneePrincipalId: principal.id,
						resultRefs,
						submitIdempotencyKey: data.idempotencyKey,
						submittedAt: ctx.now()
					})
					.where(eq(protocolTasks.id, task.id))
					.returning();
				if (!updated) throw new TlonError('INTERNAL', 'task update returned no row');

				if (task.type === 'seed_block' && task.runId !== null) {
					await scheduleRoot(tx, projectId, task.runId);
				}
				if (task.type === 'advance_block' && task.triangleId !== null) {
					await maybeConverge(tx, task.triangleId);
				}
				await audit(ctx, tx, principal, projectId, 'task.submit', task.id, {
					type: task.type,
					results: resultRefs.map((r) => r.artifactId)
				});
				return { task: toTask(updated, principal), warnings, replayed: false };
			});
		},

		async connect(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<TriangleDetail> {
			return db.transaction(async (tx) => {
				await authorizeGapWriter(tx, principal, projectId);
				const data = parseInput(ConnectInput, input);
				if (data.left.artifactId === data.right.artifactId) {
					throw new TlonError('SELF_RELATION', 'a gap needs two different anchors', {
						artifactId: data.left.artifactId
					});
				}
				const parent =
					data.parentTriangleId === undefined
						? null
						: await getTriangleRow(tx, projectId, data.parentTriangleId);
				const runId = data.runId ?? parent?.runId ?? null;
				const run = runId === null ? null : await getRunRow(tx, projectId, runId);
				if (run && run.status !== 'active') {
					throw new TlonError('INVALID_STATE', 'the run is not active', { runId: run.id });
				}
				const depth = (parent?.depth ?? 0) + 1;
				const maxDepth = run ? RunConfig.parse(run.config).maxDepth : UNBOUNDED_RUN_DEPTH;
				if (depth > maxDepth) {
					throw new TlonError('DEPTH_LIMIT_EXCEEDED', 'gap depth exceeds the run limit', {
						depth,
						maxDepth
					});
				}
				const left = await resolveAnchor(ctx, tx, principal, projectId, data.left);
				const right = await resolveAnchor(ctx, tx, principal, projectId, data.right);
				const [open] = await tx
					.select({ id: triangles.id })
					.from(triangles)
					.where(
						and(
							eq(triangles.projectId, projectId),
							inArray(triangles.status, ['proposed', 'expanding']),
							or(
								and(
									eq(triangles.leftArtifactId, left.artifactId),
									eq(triangles.rightArtifactId, right.artifactId)
								),
								and(
									eq(triangles.leftArtifactId, right.artifactId),
									eq(triangles.rightArtifactId, left.artifactId)
								)
							)
						)
					)
					.limit(1);
				if (open) {
					throw new TlonError('INVALID_STATE', 'a gap between these anchors is already open', {
						triangleId: open.id
					});
				}
				const stage =
					Math.max(
						await artifactStage(tx, projectId, left.artifactId),
						await artifactStage(tx, projectId, right.artifactId)
					) + 1;
				const triangle = await openGap(ctx, tx, {
					projectId,
					runId,
					left,
					right,
					parent,
					depth,
					stage,
					advance: data.advance
				});
				await audit(ctx, tx, principal, projectId, 'triangle.connect', triangle.id, {
					depth,
					stage
				});
				return loadTriangleDetail(ctx, tx, principal, projectId, triangle.id);
			});
		},

		async getTriangle(
			principal: Principal,
			projectId: string,
			triangleId: string
		): Promise<TriangleDetail> {
			await authorize(db, principal, projectId, 'triangle.read');
			asUuid(triangleId, 'TRIANGLE_NOT_FOUND');
			return loadTriangleDetail(ctx, db, principal, projectId, triangleId);
		},

		async acceptFact(
			principal: Principal,
			projectId: string,
			triangleId: string,
			input: unknown
		): Promise<TriangleDetail> {
			return db.transaction(async (tx) => {
				await authorizeGapWriter(tx, principal, projectId);
				const data = parseInput(AcceptFactInput, input);
				const triangle = await getTriangleRow(tx, projectId, triangleId, true);
				const run = triangle.runId === null ? null : await getRunRow(tx, projectId, triangle.runId);
				const policy = run ? RunConfig.parse(run.config).factReview : 'facilitator';
				if (principal.role === 'C' && policy !== 'mediator') {
					throw new TlonError('FORBIDDEN', 'only the facilitator accepts Facts in this run', {
						projectId
					});
				}
				if (triangle.status !== 'proposed' || triangle.factArtifactId !== null) {
					throw new TlonError('INVALID_STATE', 'this gap already has a Fact');
				}
				asUuid(data.candidateId, 'CANDIDATE_NOT_FOUND');
				const candidates = await tx
					.select()
					.from(factCandidates)
					.where(eq(factCandidates.triangleId, triangle.id))
					.orderBy(asc(factCandidates.createdAt), asc(factCandidates.id));
				const chosen = candidates.find((c) => c.id === data.candidateId && c.status === 'proposed');
				if (!chosen) {
					throw new TlonError('CANDIDATE_NOT_FOUND', 'Fact candidate not found', {
						candidateId: data.candidateId
					});
				}
				let acceptedRevisionId = chosen.factRevisionId;
				for (const candidate of candidates) {
					if (candidate.status !== 'proposed') continue;
					const accepted = candidate.id === chosen.id;
					const current = await getArtifactRow(
						ctx,
						tx,
						principal,
						projectId,
						candidate.factArtifactId
					);
					const updated = await appendRevision(
						ctx,
						tx,
						principal,
						current,
						{ status: accepted ? 'ACCEPTED' : 'REJECTED', locked: accepted },
						accepted
							? `fact accepted for gap ${triangle.id}`
							: `fact not chosen for gap ${triangle.id}`
					);
					if (accepted) acceptedRevisionId = updated.row.headRevisionId;
					await tx
						.update(factCandidates)
						.set({
							status: accepted ? 'accepted' : 'rejected',
							factRevisionId: updated.row.headRevisionId
						})
						.where(eq(factCandidates.id, candidate.id));
				}
				const [accepted] = await tx
					.update(triangles)
					.set({
						factArtifactId: chosen.factArtifactId,
						factRevisionId: acceptedRevisionId,
						status: 'expanding',
						updatedAt: ctx.now()
					})
					.where(eq(triangles.id, triangle.id))
					.returning();
				if (!accepted) throw new TlonError('INTERNAL', 'triangle update returned no row');
				await tx
					.update(protocolTasks)
					.set({ state: 'approved' })
					.where(
						and(
							eq(protocolTasks.triangleId, triangle.id),
							eq(protocolTasks.type, 'propose_fact'),
							eq(protocolTasks.state, 'submitted')
						)
					);
				// Association only: the relation stays hidden from the opposite side by endpoint visibility.
				await insertRelation(
					ctx,
					tx,
					projectId,
					triangle.leftArtifactId,
					chosen.factArtifactId,
					'has_fact'
				);
				await insertRelation(
					ctx,
					tx,
					projectId,
					triangle.rightArtifactId,
					chosen.factArtifactId,
					'has_fact'
				);

				const scopes = await anchorScopes(tx, projectId, triangle);
				for (const side of ['left', 'right'] as const) {
					const role = sideRole(scopes[side], side);
					const recipients = await tx
						.select({ id: agentPrincipals.id, role: agentPrincipals.role })
						.from(agentPrincipals)
						.where(
							and(
								eq(agentPrincipals.projectId, projectId),
								eq(agentPrincipals.role, role),
								isNull(agentPrincipals.disabledAt)
							)
						);
					for (const recipient of recipients) {
						await grantSideAccess(
							ctx,
							tx,
							projectId,
							accepted,
							side,
							{ id: recipient.id, role: recipient.role as Role },
							principal.id
						);
					}
					await insertTask(ctx, tx, {
						projectId,
						runId: triangle.runId,
						type: 'advance_block',
						role,
						stageIndex: triangle.stageIndex + 1,
						depth: triangle.depth,
						triangleId: triangle.id,
						side,
						direction: (side === 'left'
							? triangle.leftDirection
							: triangle.rightDirection) as Direction
					});
				}
				await audit(ctx, tx, principal, projectId, 'triangle.accept_fact', triangle.id, {
					factArtifactId: chosen.factArtifactId
				});
				return loadTriangleDetail(ctx, tx, principal, projectId, triangle.id);
			});
		},

		async setTriangleStatus(
			principal: Principal,
			projectId: string,
			triangleId: string,
			input: unknown
		): Promise<TriangleDetail> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'protocol.facilitate');
				const data = parseInput(SetTriangleStatusInput, input);
				const triangle = await getTriangleRow(tx, projectId, triangleId, true);
				await tx
					.update(triangles)
					.set({ status: data.status, updatedAt: ctx.now() })
					.where(eq(triangles.id, triangle.id));
				await audit(ctx, tx, principal, projectId, 'triangle.status', triangle.id, {
					from: triangle.status,
					to: data.status
				});
				return loadTriangleDetail(ctx, tx, principal, projectId, triangle.id);
			});
		},

		async createFactAnchor(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<FactAnchor> {
			return db.transaction(async (tx) => {
				await authorizeGapWriter(tx, principal, projectId);
				const data = parseInput(CreateFactAnchorInput, input);
				asUuid(data.factArtifactId, 'ARTIFACT_NOT_FOUND');
				const { row } = await getArtifactRow(ctx, tx, principal, projectId, data.factArtifactId);
				if (row.artifactClass !== 'FACT' || row.status !== 'ACCEPTED') {
					throw new TlonError('INVALID_STATE', 'only an accepted Fact can become an anchor', {
						artifactId: row.id
					});
				}
				const anchor = await persistFactAnchor(ctx, tx, projectId, row.id, row.headRevisionId);
				await audit(ctx, tx, principal, projectId, 'fact_anchor.create', anchor.id, {
					factArtifactId: row.id
				});
				return toFactAnchor(anchor);
			});
		},

		/** Composes the Triangle (anchors, Fact, continuations and the relations among them) into a composite Block. */
		async composeTriangle(
			principal: Principal,
			projectId: string,
			triangleId: string,
			input: unknown
		): Promise<CompositeView> {
			await authorizeGapWriter(db, principal, projectId);
			const data = parseInput(ComposeTriangleInput, input);
			const triangle = await getTriangleRow(db, projectId, triangleId);
			if (triangle.factArtifactId === null) {
				throw new TlonError('INVALID_STATE', 'a gap without an accepted Fact cannot be composed');
			}
			const conts = await db
				.select({ artifactId: triangleContinuations.artifactId })
				.from(triangleContinuations)
				.where(eq(triangleContinuations.triangleId, triangle.id));
			const memberIds = [
				...new Set([
					triangle.leftArtifactId,
					triangle.factArtifactId,
					triangle.rightArtifactId,
					...conts.map((c) => c.artifactId).sort()
				])
			];
			const internal = await loadRelations(
				ctx,
				db,
				principal,
				projectId,
				and(
					inArray(relations.fromId, memberIds),
					inArray(relations.toId, memberIds),
					ne(relations.status, 'REJECTED')
				)
			);
			return composites.createComposite(principal, projectId, {
				title: data.title,
				memberArtifactIds: memberIds,
				memberRelationIds: internal.map((r) => r.id),
				boundary: { entries: [triangle.leftArtifactId], exits: [triangle.rightArtifactId] },
				contract: { summary: data.summary ?? '' },
				reason: `composed from gap ${triangle.id}`
			});
		},

		/**
		 * Facilitator asks the owning side to repair an open issue inside its own chain. The task
		 * only carries that side's Blocks and quotes; an issue spanning sides is refused.
		 */
		async requestRevision(principal: Principal, projectId: string, input: unknown): Promise<Task> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'protocol.facilitate');
				const data = parseInput(RequestRevisionInput, input);
				const { items } = await loadIssueList(ctx, tx, principal, projectId);
				const issue = items.find((i) => i.key === data.issueKey && i.dismissal === null);
				if (!issue)
					throw new TlonError('ISSUE_NOT_FOUND', 'issue not found', { key: data.issueKey });
				if (!issue.artifactIds.includes(data.artifactId)) {
					throw new TlonError('VALIDATION_FAILED', 'artifactId is not one of the issue Blocks', {
						artifactId: data.artifactId
					});
				}
				const cited = [
					...new Set([...issue.artifactIds, ...issue.evidence.map((e) => e.artifactId)])
				];
				const rows = await tx
					.select({ id: artifacts.id, scope: artifacts.ownerScope, locked: artifacts.locked })
					.from(artifacts)
					.where(and(eq(artifacts.projectId, projectId), inArray(artifacts.id, cited)));
				const scopeOf = new Map(rows.map((r) => [r.id, r.scope]));
				const scopes = new Set(issue.artifactIds.map((id) => scopeOf.get(id)));
				const [scope] = scopes;
				if (scopes.size !== 1 || (scope !== 'A_PRIVATE' && scope !== 'B_PRIVATE')) {
					throw new TlonError(
						'CROSS_SIDE_REVISION',
						'the issue spans both sides (or shared material); only one side may revise its own chain',
						{ key: issue.key }
					);
				}
				if (rows.find((r) => r.id === data.artifactId)?.locked) {
					throw new TlonError('INVALID_STATE', 'the Block is locked', {
						artifactId: data.artifactId
					});
				}
				const [pending] = await tx
					.select()
					.from(protocolTasks)
					.where(
						and(
							eq(protocolTasks.projectId, projectId),
							eq(protocolTasks.type, 'revise_block'),
							eq(protocolTasks.state, 'pending'),
							sql`${protocolTasks.payload} @> ${JSON.stringify({
								artifactId: data.artifactId,
								issueKey: issue.key
							})}::jsonb`
						)
					)
					.limit(1);
				if (pending) return toTask(pending, principal);

				const [run] = await tx
					.select({ id: protocolRuns.id })
					.from(protocolRuns)
					.where(eq(protocolRuns.projectId, projectId))
					.orderBy(desc(protocolRuns.createdAt), desc(protocolRuns.id))
					.limit(1);
				const [stage] = await tx
					.select({ max: max(protocolTasks.stageIndex) })
					.from(protocolTasks)
					.where(eq(protocolTasks.projectId, projectId));
				const role = scope === 'A_PRIVATE' ? 'A' : 'B';
				const task = await insertTask(ctx, tx, {
					projectId,
					runId: run?.id ?? null,
					type: 'revise_block',
					role,
					stageIndex: (stage?.max ?? 0) + 1,
					depth: 0,
					openClaim: true,
					payload: {
						artifactId: data.artifactId,
						issueKey: issue.key,
						problems: [
							{
								explanation: issue.explanation,
								// Quotes from the other side's Blocks never travel with the task.
								evidence: issue.evidence
									.filter((e) => scopeOf.get(e.artifactId) === scope)
									.map((e) => ({ blockId: e.artifactId, quote: e.quote }))
							}
						],
						instructions: data.instructions ?? null
					}
				});
				await audit(ctx, tx, principal, projectId, 'revision.request', task.id, {
					issueKey: issue.key,
					artifactId: data.artifactId,
					role
				});
				return toTask(task, principal);
			});
		},

		async getFactRationale(
			principal: Principal,
			projectId: string,
			factArtifactId: string
		): Promise<FactRationale> {
			await authorize(db, principal, projectId, 'fact.rationale.read');
			asUuid(factArtifactId, 'ARTIFACT_NOT_FOUND');
			const [row] = await db
				.select()
				.from(factRationales)
				.where(
					and(
						eq(factRationales.factArtifactId, factArtifactId),
						eq(factRationales.projectId, projectId)
					)
				);
			if (!row) throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { factArtifactId });
			return {
				factArtifactId: row.factArtifactId,
				rationale: row.rationale,
				createdAt: row.createdAt.toISOString()
			};
		}
	};

	/** Warnings of the first submission, recomputed from the stored Facts. */
	async function replayWarnings(tx: Db, task: ProtocolTaskRow): Promise<string[]> {
		if (task.type !== 'propose_fact' || task.resultRefs.length === 0) return [];
		const rows = await tx
			.select({ id: artifacts.id, title: artifacts.title })
			.from(artifacts)
			.where(
				inArray(
					artifacts.id,
					task.resultRefs.map((r) => r.artifactId)
				)
			);
		return task.resultRefs.flatMap((ref, index) => {
			const title = rows.find((r) => r.id === ref.artifactId)?.title ?? '';
			return lintFactText(title).warnings.map((w) => `Candidate ${index + 1}: ${w}`);
		});
	}

	/** Both seeds of an auto-scheduled run exist → the root Triangle and C's first task. */
	async function scheduleRoot(tx: Db, projectId: string, runId: string): Promise<void> {
		const run = await getRunRow(tx, projectId, runId, true);
		if (!RunConfig.parse(run.config).autoSchedule) return;
		const seeds = await loadTasks(
			tx,
			projectId,
			and(eq(protocolTasks.runId, runId), eq(protocolTasks.type, 'seed_block'))
		);
		const seedOf = (role: string) => seeds.find((s) => s.role === role && s.state === 'submitted');
		const a = seedOf('A')?.resultRefs[0];
		const b = seedOf('B')?.resultRefs[0];
		if (!a || !b) return;
		const [existing] = await tx
			.select({ id: triangles.id })
			.from(triangles)
			.where(and(eq(triangles.runId, runId), isNull(triangles.parentTriangleId)))
			.limit(1);
		if (existing) return;
		await openGap(ctx, tx, {
			projectId,
			runId,
			left: { artifactId: a.artifactId, revisionId: a.revisionId, factAnchorId: null },
			right: { artifactId: b.artifactId, revisionId: b.revisionId, factAnchorId: null },
			parent: null,
			depth: 1,
			stage: 2,
			advance: { left: 'forward', right: 'backward' }
		});
	}
}

// ── Export / import ─────────────────────────────────────────────────────────

type ProtocolBundle = Required<
	Pick<
		ExportBundle,
		| 'runs'
		| 'triangles'
		| 'tasks'
		| 'factCandidates'
		| 'factRationales'
		| 'factAnchors'
		| 'connections'
		| 'certifications'
		| 'findings'
	>
>;

/** The protocol arrays of a bundle; older bundles have none. */
export function protocolPart(bundle: ExportBundle): ProtocolBundle {
	return {
		runs: bundle.runs ?? [],
		triangles: bundle.triangles ?? [],
		tasks: bundle.tasks ?? [],
		factCandidates: bundle.factCandidates ?? [],
		factRationales: bundle.factRationales ?? [],
		factAnchors: bundle.factAnchors ?? [],
		connections: bundle.connections ?? [],
		certifications: bundle.certifications ?? [],
		findings: bundle.findings ?? []
	};
}

export async function loadProtocolExport(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string
): Promise<ProtocolBundle> {
	const [runRows, triangleList, taskRows, anchorRows, rationaleRows] = await Promise.all([
		q
			.select()
			.from(protocolRuns)
			.where(eq(protocolRuns.projectId, projectId))
			.orderBy(asc(protocolRuns.createdAt), asc(protocolRuns.id)),
		loadTriangles(q, projectId),
		loadTasks(q, projectId),
		q
			.select()
			.from(factAnchors)
			.where(eq(factAnchors.projectId, projectId))
			.orderBy(asc(factAnchors.createdAt), asc(factAnchors.id)),
		q
			.select()
			.from(factRationales)
			.where(eq(factRationales.projectId, projectId))
			.orderBy(asc(factRationales.createdAt))
	]);
	return {
		runs: runRows.map(toRun),
		triangles: triangleList,
		tasks: taskRows.map((t) => toTask(t, principal)),
		factCandidates: await loadFactCandidates(
			ctx,
			q,
			principal,
			projectId,
			triangleList.map((t) => t.id),
			false
		),
		factRationales: rationaleRows.map((r) => ({
			factArtifactId: r.factArtifactId,
			rationale: r.rationale,
			createdAt: r.createdAt.toISOString()
		})),
		factAnchors: anchorRows.map(toFactAnchor),
		connections: await loadConnections(q, projectId),
		certifications: await loadCertifications(q, projectId),
		findings: await loadFindings(q, projectId)
	};
}

export type ProtocolIssue = { path: string; message: string; ref?: string };

/** Referential integrity of the protocol part of a bundle (IDs only, never text). */
export function findProtocolIntegrityIssues(whole: ExportBundle): ProtocolIssue[] {
	const issues: ProtocolIssue[] = [];
	const bundle = { ...whole, ...protocolPart(whole) };
	const revisionOwner = new Map(bundle.revisions.map((r) => [r.id, r.artifactId]));
	const artifactIds = new Set(bundle.artifacts.map((a) => a.id));
	const runIds = new Set(bundle.runs.map((r) => r.id));
	const triangleIds = new Set(bundle.triangles.map((t) => t.id));
	const anchorIds = new Set(bundle.factAnchors.map((a) => a.id));
	const ref = (path: string, r: { artifactId: string; revisionId: string }) => {
		if (!artifactIds.has(r.artifactId)) {
			issues.push({ path, message: 'unknown artifact', ref: r.artifactId });
		} else if (revisionOwner.get(r.revisionId) !== r.artifactId) {
			issues.push({ path, message: 'pinned revision mismatch', ref: r.revisionId });
		}
	};
	for (const a of bundle.factAnchors) ref(`factAnchors.${a.id}`, a.fact);
	for (const t of bundle.triangles) {
		const at = `triangles.${t.id}`;
		if (t.runId !== null && !runIds.has(t.runId)) {
			issues.push({ path: `${at}.runId`, message: 'unknown run', ref: t.runId });
		}
		if (t.parentTriangleId !== null && !triangleIds.has(t.parentTriangleId)) {
			issues.push({ path: `${at}.parent`, message: 'unknown triangle', ref: t.parentTriangleId });
		}
		for (const [side, anchor] of [
			['left', t.left],
			['right', t.right]
		] as const) {
			ref(`${at}.${side}`, anchor);
			if (anchor.factAnchorId !== null && !anchorIds.has(anchor.factAnchorId)) {
				issues.push({
					path: `${at}.${side}`,
					message: 'unknown fact anchor',
					ref: anchor.factAnchorId
				});
			}
		}
		if (t.fact !== null) ref(`${at}.fact`, t.fact);
		for (const c of t.continuations) ref(`${at}.continuations`, c.block);
	}
	for (const task of bundle.tasks) {
		const at = `tasks.${task.id}`;
		if (task.runId !== null && !runIds.has(task.runId)) {
			issues.push({ path: `${at}.runId`, message: 'unknown run', ref: task.runId });
		}
		if (task.triangleId !== null && !triangleIds.has(task.triangleId)) {
			issues.push({ path: `${at}.triangleId`, message: 'unknown triangle', ref: task.triangleId });
		}
		for (const r of task.resultRefs) ref(`${at}.resultRefs`, r);
	}
	const taskIds = new Set(bundle.tasks.map((t) => t.id));
	for (const t of bundle.triangles) {
		for (const c of t.continuations) {
			if (c.taskId !== null && !taskIds.has(c.taskId)) {
				issues.push({
					path: `triangles.${t.id}.continuations`,
					message: 'unknown task',
					ref: c.taskId
				});
			}
		}
	}
	for (const c of bundle.factCandidates) {
		if (!triangleIds.has(c.triangleId)) {
			issues.push({
				path: `factCandidates.${c.id}`,
				message: 'unknown triangle',
				ref: c.triangleId
			});
		}
		ref(`factCandidates.${c.id}`, c.fact);
	}
	for (const r of bundle.factRationales) {
		if (!artifactIds.has(r.factArtifactId)) {
			issues.push({ path: 'factRationales', message: 'unknown artifact', ref: r.factArtifactId });
		}
	}
	for (const c of bundle.connections) {
		const at = `connections.${c.id}`;
		for (const id of [
			...c.endpointIds,
			...c.realizedByIds,
			...(c.factArtifactId ? [c.factArtifactId] : [])
		]) {
			if (!artifactIds.has(id)) issues.push({ path: at, message: 'unknown artifact', ref: id });
		}
	}
	for (const task of bundle.tasks) {
		if (task.payload && !artifactIds.has(task.payload.artifactId)) {
			issues.push({
				path: `tasks.${task.id}.payload`,
				message: 'unknown artifact',
				ref: task.payload.artifactId
			});
		}
	}
	for (const f of bundle.findings) {
		const at = `findings.${f.id}`;
		for (const id of f.artifactIds) {
			if (!artifactIds.has(id)) issues.push({ path: at, message: 'unknown artifact', ref: id });
		}
		for (const e of f.evidence) ref(at, e);
	}
	return issues;
}

/** Existing ids of a protocol bundle in this database (for ID_CONFLICT when not remapping). */
export function protocolIdChecks(
	bundle: ProtocolBundle
): Array<[string, PgTable, PgColumn, string[]]> {
	return [
		['runs', protocolRuns, protocolRuns.id, bundle.runs.map((r) => r.id)],
		['factAnchors', factAnchors, factAnchors.id, bundle.factAnchors.map((a) => a.id)],
		['triangles', triangles, triangles.id, bundle.triangles.map((t) => t.id)],
		['tasks', protocolTasks, protocolTasks.id, bundle.tasks.map((t) => t.id)],
		['factCandidates', factCandidates, factCandidates.id, bundle.factCandidates.map((c) => c.id)],
		[
			'connections',
			narrativeConnections,
			narrativeConnections.id,
			bundle.connections.map((c) => c.id)
		],
		[
			'certifications',
			completionCertifications,
			completionCertifications.id,
			bundle.certifications.map((c) => c.id)
		],
		['findings', continuityFindings, continuityFindings.id, bundle.findings.map((f) => f.id)]
	];
}

/**
 * Imports the protocol part. `artifactMap`/`revisionMap` translate bundle ids to the
 * ids actually written (identity unless remapped). Participants are not part of a bundle:
 * task assignees are dropped so the tasks become claimable by the target project's roles.
 */
export async function insertProtocolImport(
	ctx: Ctx,
	q: Db,
	projectId: string,
	bundle: ProtocolBundle,
	maps: {
		artifacts: ReadonlyMap<string, string>;
		revisions: ReadonlyMap<string, string>;
		remap: boolean;
	}
): Promise<void> {
	const memo = new Map<string, string>();
	const pid = (old: string) => {
		if (!maps.remap) return old;
		let next = memo.get(old);
		if (!next) {
			next = ctx.newId();
			memo.set(old, next);
		}
		return next;
	};
	const optional = (old: string | null) => (old === null ? null : pid(old));
	const art = (id: string) => maps.artifacts.get(id) ?? id;
	const rev = (id: string) => maps.revisions.get(id) ?? id;
	const date = (iso: string) => new Date(iso);

	for (const r of bundle.runs) {
		await q.insert(protocolRuns).values({
			id: pid(r.id),
			projectId,
			config: r.config,
			status: r.status,
			briefs: r.briefs,
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt)
		});
	}
	for (const a of bundle.factAnchors) {
		await q.insert(factAnchors).values({
			id: pid(a.id),
			projectId,
			factArtifactId: art(a.fact.artifactId),
			factRevisionId: rev(a.fact.revisionId),
			createdAt: date(a.createdAt)
		});
	}
	// Parents first so the self-referencing FK holds.
	for (const t of [...bundle.triangles].sort((x, y) => x.depth - y.depth)) {
		await q.insert(triangles).values({
			id: pid(t.id),
			projectId,
			runId: optional(t.runId),
			leftArtifactId: art(t.left.artifactId),
			leftRevisionId: rev(t.left.revisionId),
			leftFactAnchorId: optional(t.left.factAnchorId),
			rightArtifactId: art(t.right.artifactId),
			rightRevisionId: rev(t.right.revisionId),
			rightFactAnchorId: optional(t.right.factAnchorId),
			factArtifactId: t.fact ? art(t.fact.artifactId) : null,
			factRevisionId: t.fact ? rev(t.fact.revisionId) : null,
			status: t.status,
			stageIndex: t.stageIndex,
			depth: t.depth,
			parentTriangleId: optional(t.parentTriangleId),
			leftDirection: t.advance?.left ?? 'forward',
			rightDirection: t.advance?.right ?? 'backward',
			createdAt: date(t.createdAt),
			updatedAt: date(t.updatedAt)
		});
	}
	for (const f of bundle.findings) {
		await q.insert(continuityFindings).values({
			id: pid(f.id),
			projectId,
			kind: f.kind,
			severity: f.severity,
			artifactIds: f.artifactIds.map(art),
			explanation: f.explanation,
			evidence: f.evidence.map((e) => ({
				artifactId: art(e.artifactId),
				revisionId: rev(e.revisionId),
				quote: e.quote
			})),
			source: f.source,
			reviseArtifactId: f.reviseArtifactId === null ? null : art(f.reviseArtifactId),
			actorId: f.actorId,
			createdAt: date(f.createdAt)
		});
	}
	for (const t of bundle.tasks) {
		await q.insert(protocolTasks).values({
			id: pid(t.id),
			projectId,
			runId: optional(t.runId),
			type: t.type,
			role: t.role,
			assigneePrincipalId: null,
			state: t.state,
			stageIndex: t.stageIndex,
			depth: t.depth,
			triangleId: optional(t.triangleId),
			side: t.side,
			direction: t.direction,
			payload: t.payload
				? {
						...t.payload,
						artifactId: art(t.payload.artifactId),
						// Issue keys embed artifact ids and `finding:<id>`; follow the remapped ids.
						issueKey: t.payload.issueKey.replace(UUID_IN_TEXT, (id) => memo.get(id) ?? art(id)),
						problems: t.payload.problems.map((p) => ({
							...p,
							evidence: p.evidence.map((e) => ({ ...e, blockId: art(e.blockId) }))
						}))
					}
				: null,
			resultRefs: t.resultRefs.map((r) => ({
				artifactId: art(r.artifactId),
				revisionId: rev(r.revisionId)
			})),
			submitIdempotencyKey: null,
			createdAt: date(t.createdAt),
			submittedAt: t.submittedAt === null ? null : date(t.submittedAt)
		});
	}
	for (const t of bundle.triangles) {
		for (const c of t.continuations) {
			await q.insert(triangleContinuations).values({
				triangleId: pid(t.id),
				side: c.side,
				artifactId: art(c.block.artifactId),
				revisionId: rev(c.block.revisionId),
				taskId: optional(c.taskId)
			});
		}
	}
	for (const c of bundle.factCandidates) {
		await q.insert(factCandidates).values({
			id: pid(c.id),
			triangleId: pid(c.triangleId),
			factArtifactId: art(c.fact.artifactId),
			factRevisionId: rev(c.fact.revisionId),
			status: c.status,
			createdAt: date(c.createdAt)
		});
	}
	for (const r of bundle.factRationales) {
		await q.insert(factRationales).values({
			factArtifactId: art(r.factArtifactId),
			projectId,
			rationale: r.rationale,
			createdAt: date(r.createdAt)
		});
	}
	for (const c of bundle.connections) {
		await q.insert(narrativeConnections).values({
			id: pid(c.id),
			projectId,
			kind: c.kind,
			endpointAId: art(c.endpointIds[0]),
			endpointBId: art(c.endpointIds[1]),
			factArtifactId: c.factArtifactId === null ? null : art(c.factArtifactId),
			realizedByIds: c.realizedByIds.map(art),
			statement: c.statement,
			confidence: c.confidence,
			status: c.status,
			source: c.source,
			approvedBy: c.approvedBy,
			createdAt: date(c.createdAt),
			updatedAt: date(c.updatedAt)
		});
	}
	for (const c of bundle.certifications) {
		await q.insert(completionCertifications).values({
			id: pid(c.id),
			projectId,
			policy: c.policy,
			actorId: c.actorId,
			// The snapshot's references follow the remapped ids.
			report: {
				...c.report,
				openQuestions: c.report.openQuestions.map((oq) => ({
					...oq,
					connectionId: oq.connectionId === null ? null : pid(oq.connectionId),
					endpointIds: oq.endpointIds.map(art)
				})),
				motifSignals: c.report.motifSignals.map((m) => ({ ...m, artifactId: art(m.artifactId) }))
			},
			createdAt: date(c.createdAt)
		});
	}
}
