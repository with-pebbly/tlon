import {
	type IssueList,
	type AcceptExpansionResult,
	type AgentList,
	type AgentPrincipal,
	type Artifact,
	type ArtifactPage,
	type AuditReport,
	type Certification,
	type CompletionReport,
	type ConnectionList,
	type NarrativeConnection,
	type CompositeRevisionList,
	type CompositeView,
	type AuditPage,
	type Disclosure,
	type DisclosureList,
	type ExpansionDetail,
	type ExportBundle,
	type FactAnchor,
	type FactRationale,
	type ParticipantLink,
	type ProtocolState,
	type Run,
	type SubmitTaskResult,
	type TaskList,
	type TaskView,
	type TriangleDetail,
	type Grant,
	type GrantList,
	type ImportResult,
	type IssuedToken,
	type Principal,
	type Project,
	type ProjectGraph,
	type ProjectList,
	type Relation,
	type RevisionList,
	type TransitionAnnotation,
	TlonError,
	Uuid,
	type WhoAmI
} from '@tlon/contracts';
import { eq } from 'drizzle-orm';

import { artifactMethods } from './artifacts.ts';
import { bundleMethods } from './bundle.ts';
import { completionMethods } from './completion.ts';
import { compositeMethods } from './composites.ts';
import type { Db } from './db.ts';
import { expansionMethods } from './expansions.ts';
import { gatewayMethods } from './gateway.ts';
import { auditDecision, createCtx, type Ctx, type ServiceOptions } from './internal.ts';
import { projectMethods } from './projects.ts';
import { protocolMethods } from './protocol.ts';
import { relationMethods } from './relations.ts';
import { projects } from './schema.ts';
import { validationMethods } from './validation.ts';

/**
 * The single domain service shared by API and CLI. Every method takes the acting
 * `Principal` first (resolved by the gateway, never client-supplied), validates `unknown`
 * input with the contract schemas, enforces project binding, the role→action matrix and
 * artifact visibility, and runs multi-row writes in one transaction. Refusals
 * (FORBIDDEN, hidden NOT_FOUND for agents) are audited (§12).
 */
export interface TlonService {
	/** Resolves a bearer token to its agent principal; any failure → UNAUTHENTICATED. */
	authenticateToken(token: string): Promise<Principal>;
	/** Transport-level 401 without a usable credential (e.g. tokenless non-loopback); audit only. */
	recordUnauthenticated(reason: string): Promise<void>;
	whoami(principal: Principal): Promise<WhoAmI>;

	listProjects(principal: Principal): Promise<ProjectList>;
	/** `options.id` pins the project id (seed tooling); not part of the public input contract. */
	createProject(principal: Principal, input: unknown, options?: { id?: string }): Promise<Project>;
	getProject(principal: Principal, projectId: string): Promise<Project>;
	getGraph(principal: Principal, projectId: string): Promise<ProjectGraph>;

	listArtifacts(principal: Principal, projectId: string, query?: unknown): Promise<ArtifactPage>;
	createArtifact(principal: Principal, projectId: string, input: unknown): Promise<Artifact>;
	getArtifact(principal: Principal, projectId: string, id: string): Promise<Artifact>;
	/** `expectedRevisionId` is the `If-Match` value; undefined → PRECONDITION_REQUIRED. */
	updateArtifact(
		principal: Principal,
		projectId: string,
		id: string,
		expectedRevisionId: string | undefined,
		input: unknown
	): Promise<Artifact>;
	listRevisions(principal: Principal, projectId: string, id: string): Promise<RevisionList>;

	/** Appends a state-contract annotation to the artifact's head revision (never creates a revision). */
	putTransition(
		principal: Principal,
		projectId: string,
		artifactId: string,
		input: unknown
	): Promise<TransitionAnnotation>;
	listIssues(principal: Principal, projectId: string): Promise<IssueList>;
	dismissIssue(principal: Principal, projectId: string, input: unknown): Promise<IssueList>;

	createComposite(principal: Principal, projectId: string, input: unknown): Promise<CompositeView>;
	/** `query` = `{ depth }` (default 1). Hidden members/relations/claims are omitted for the caller. */
	getComposite(
		principal: Principal,
		projectId: string,
		id: string,
		query?: unknown
	): Promise<CompositeView>;
	reviseComposite(
		principal: Principal,
		projectId: string,
		id: string,
		input: unknown
	): Promise<CompositeView>;
	listCompositeRevisions(
		principal: Principal,
		projectId: string,
		id: string
	): Promise<CompositeRevisionList>;
	archiveComposite(
		principal: Principal,
		projectId: string,
		id: string,
		reason?: string
	): Promise<Artifact>;

	createRelation(principal: Principal, projectId: string, input: unknown): Promise<Relation>;
	updateRelation(
		principal: Principal,
		projectId: string,
		id: string,
		input: unknown
	): Promise<Relation>;

	createExpansion(
		principal: Principal,
		projectId: string,
		input: unknown
	): Promise<ExpansionDetail>;
	getExpansion(principal: Principal, projectId: string, id: string): Promise<ExpansionDetail>;
	submitCandidate(
		principal: Principal,
		projectId: string,
		expansionId: string,
		input: unknown
	): Promise<ExpansionDetail>;
	/** `idempotencyKey` is the `Idempotency-Key` value; undefined → IDEMPOTENCY_KEY_REQUIRED. */
	acceptExpansion(
		principal: Principal,
		projectId: string,
		expansionId: string,
		idempotencyKey: string | undefined,
		input: unknown
	): Promise<AcceptExpansionResult>;
	rejectExpansion(
		principal: Principal,
		projectId: string,
		expansionId: string,
		input?: unknown
	): Promise<ExpansionDetail>;

	exportProject(principal: Principal, projectId: string): Promise<ExportBundle>;
	/** Atomically creates a project from the bundle and imports into it; failure leaves nothing behind. */
	importAsNewProject(
		principal: Principal,
		bundle: unknown,
		options?: unknown
	): Promise<ImportResult>;
	importProject(
		principal: Principal,
		projectId: string,
		bundle: unknown,
		options?: unknown
	): Promise<ImportResult>;

	listAgents(principal: Principal, projectId: string): Promise<AgentList>;
	createAgent(principal: Principal, projectId: string, input: unknown): Promise<AgentPrincipal>;
	/** Disables the principal and revokes all of its tokens. */
	disableAgent(
		principal: Principal,
		projectId: string,
		principalId: string
	): Promise<AgentPrincipal>;
	/** Returns the plaintext token once; only its sha256 is stored. */
	issueToken(
		principal: Principal,
		projectId: string,
		principalId: string,
		input?: unknown
	): Promise<IssuedToken>;
	revokeToken(
		principal: Principal,
		projectId: string,
		principalId: string,
		tokenId: string
	): Promise<void>;

	listGrants(principal: Principal, projectId: string): Promise<GrantList>;
	createGrant(principal: Principal, projectId: string, input: unknown): Promise<Grant>;
	revokeGrant(principal: Principal, projectId: string, grantId: string): Promise<Grant>;

	proposeDisclosure(principal: Principal, projectId: string, input: unknown): Promise<Disclosure>;
	listDisclosures(principal: Principal, projectId: string): Promise<DisclosureList>;
	/** HUMAN only; PUBLISH atomically creates the shared artifact and the destination's grant. */
	reviewDisclosure(
		principal: Principal,
		projectId: string,
		disclosureId: string,
		input: unknown
	): Promise<Disclosure>;

	listOwnAudit(principal: Principal, projectId: string, query?: unknown): Promise<AuditPage>;

	/** Principal + link token in one call (facilitator). Executor kind never changes permissions. */
	createParticipant(
		principal: Principal,
		projectId: string,
		input: unknown
	): Promise<ParticipantLink>;
	/** Creates the run and the two side `seed_block` tasks (facilitator). */
	startRun(principal: Principal, projectId: string, input: unknown): Promise<Run>;
	listRuns(principal: Principal, projectId: string): Promise<{ items: Run[] }>;
	/** HUMAN: all; C: triangles + its tasks; VALIDATOR: triangles; A/B: FORBIDDEN. */
	getProtocol(principal: Principal, projectId: string): Promise<ProtocolState>;
	/** Facilitator view of every task. */
	listTasks(principal: Principal, projectId: string): Promise<TaskList>;
	/** A/B/C: pending/submitted tasks assigned to the caller or claimable by its role. */
	listMyTasks(principal: Principal, projectId: string): Promise<TaskList>;
	getTaskView(principal: Principal, projectId: string, taskId: string): Promise<TaskView>;
	/** Idempotent by `idempotencyKey`; claims the task for the submitter. */
	submitTask(
		principal: Principal,
		projectId: string,
		taskId: string,
		input: unknown
	): Promise<SubmitTaskResult>;
	/** Opens a gap between two anchors → a `propose_fact` task for C. */
	connect(principal: Principal, projectId: string, input: unknown): Promise<TriangleDetail>;
	getTriangle(principal: Principal, projectId: string, triangleId: string): Promise<TriangleDetail>;
	/** Facilitator, or C when the run's policy is `mediator`. */
	acceptFact(
		principal: Principal,
		projectId: string,
		triangleId: string,
		input: unknown
	): Promise<TriangleDetail>;
	setTriangleStatus(
		principal: Principal,
		projectId: string,
		triangleId: string,
		input: unknown
	): Promise<TriangleDetail>;
	createFactAnchor(principal: Principal, projectId: string, input: unknown): Promise<FactAnchor>;
	composeTriangle(
		principal: Principal,
		projectId: string,
		triangleId: string,
		input: unknown
	): Promise<CompositeView>;
	/** HUMAN/C only: the mediator-private rationale of one Fact. */
	getFactRationale(
		principal: Principal,
		projectId: string,
		factArtifactId: string
	): Promise<FactRationale>;

	/** HUMAN write; HUMAN + VALIDATOR read. A/B/C are forbidden (organizer-only). */
	listConnections(principal: Principal, projectId: string): Promise<ConnectionList>;
	createConnection(
		principal: Principal,
		projectId: string,
		input: unknown
	): Promise<NarrativeConnection>;
	updateConnection(
		principal: Principal,
		projectId: string,
		connectionId: string,
		input: unknown
	): Promise<NarrativeConnection>;
	/** `query` = `{ policy? }`; defaults to the latest run's completion policy, else exploratory. */
	getCompletion(
		principal: Principal,
		projectId: string,
		query?: unknown
	): Promise<CompletionReport>;
	/** 409 COMPLETION_BLOCKED (`details.reasons`) unless the policy is certifiable now. */
	certify(principal: Principal, projectId: string, input: unknown): Promise<Certification>;
	listCertifications(principal: Principal, projectId: string): Promise<{ items: Certification[] }>;
	/** HUMAN only: input manifests and server-side deny checks. */
	getAudit(principal: Principal, projectId: string): Promise<AuditReport>;
}

type Method = (principal: Principal, ...args: unknown[]) => Promise<unknown>;

/** Methods that have no acting principal to audit, or audit themselves. */
const UNAUDITED = new Set(['whoami', 'authenticateToken', 'recordUnauthenticated']);
/** Methods whose first argument after the principal is not a project id. */
const NO_PROJECT_ARG = new Set(['listProjects', 'createProject', 'importAsNewProject']);

const asId = (value: unknown): string | null =>
	typeof value === 'string' && Uuid.safeParse(value).success ? value : null;

/**
 * Records a refused gateway decision after the method's transaction has rolled back, so the
 * audit row survives. Only IDs are stored. Never throws: a failing audit must not change the
 * response the caller gets.
 */
async function recordRefusal(
	ctx: Ctx,
	operation: string,
	principal: Principal,
	args: unknown[],
	error: unknown
): Promise<void> {
	if (!(error instanceof TlonError)) return;
	let outcome: 'DENIED' | 'HIDDEN';
	if (error.code === 'FORBIDDEN') outcome = 'DENIED';
	else if (
		principal.kind === 'AGENT' &&
		(error.code === 'ARTIFACT_NOT_FOUND' ||
			error.code === 'PROJECT_NOT_FOUND' ||
			error.code === 'TASK_NOT_FOUND' ||
			error.code === 'TRIANGLE_NOT_FOUND' ||
			error.code === 'RUN_NOT_FOUND')
	) {
		outcome = 'HIDDEN';
	} else return;
	try {
		const requestedProjectId = NO_PROJECT_ARG.has(operation) ? null : asId(args[0]);
		let projectId = principal.kind === 'AGENT' ? principal.projectId : null;
		if (principal.kind === 'HUMAN' && requestedProjectId !== null) {
			const [found] = await ctx.db
				.select({ id: projects.id })
				.from(projects)
				.where(eq(projects.id, requestedProjectId));
			projectId = found?.id ?? null;
		}
		const subjectId = NO_PROJECT_ARG.has(operation) ? null : asId(args[1]);
		await auditDecision(ctx, ctx.db, principal.id, projectId, operation, subjectId, outcome, {
			code: error.code,
			...(requestedProjectId !== null && requestedProjectId !== projectId
				? { requestedProjectId }
				: {})
		});
	} catch {
		// see above: audit failures are swallowed.
	}
}

export function createTlonService(db: Db, options: ServiceOptions = {}): TlonService {
	const ctx = createCtx(db, options);
	const methods = {
		...projectMethods(ctx),
		...artifactMethods(ctx),
		...compositeMethods(ctx),
		...relationMethods(ctx),
		...expansionMethods(ctx),
		...bundleMethods(ctx),
		...validationMethods(ctx),
		...gatewayMethods(ctx),
		...protocolMethods(ctx),
		...completionMethods(ctx)
	};
	const audited: Record<string, unknown> = {};
	for (const [name, method] of Object.entries(methods) as Array<[string, Method]>) {
		audited[name] = UNAUDITED.has(name)
			? method
			: async (principal: Principal, ...args: unknown[]) => {
					try {
						return await method(principal, ...args);
					} catch (error) {
						await recordRefusal(ctx, name, principal, args, error);
						throw error;
					}
				};
	}
	return audited as unknown as TlonService;
}
