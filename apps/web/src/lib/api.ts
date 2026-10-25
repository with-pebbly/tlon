import {
	API_PREFIX,
	ApiErrorBody,
	IDEMPOTENCY_KEY_HEADER,
	IF_MATCH_HEADER,
	type AcceptExpansionInput,
	type AcceptExpansionResult,
	type Artifact,
	type ArtifactListQuery,
	type ArtifactPage,
	type CompositeRevisionList,
	type CompositeView,
	type CreateArtifactInput,
	type DismissIssueInput,
	type IssueList,
	type ContinuityFinding,
	type CreateFindingInput,
	type RequestRevisionInput,
	type Task,
	type PutTransitionInput,
	type TransitionAnnotation,
	type CreateCompositeInput,
	type CreateExpansionInput,
	type CreateProjectInput,
	type CreateRelationInput,
	type ErrorCode,
	type ExpansionDetail,
	type ExportBundle,
	type ImportAsNewProjectOptions,
	type ImportResult,
	type Project,
	type ProjectGraph,
	type ProjectList,
	type RejectExpansionInput,
	type Relation,
	type RevisionList,
	type ReviseCompositeInput,
	type SubmitCandidateInput,
	type UpdateArtifactInput,
	type UpdateRelationInput,
	type AgentList,
	type AgentPrincipal,
	type AuditPage,
	type CreateAgentInput,
	type Disclosure,
	type DisclosureList,
	type Grant,
	type GrantList,
	type IssuedToken,
	type IssueTokenInput,
	type ProposeDisclosureInput,
	type ReviewDisclosureInput,
	type WhoAmI,
	type AgentRole,
	type ConnectInput,
	type ExecutorKind,
	type ParticipantLink,
	type ProtocolState,
	type Run,
	type StartRunInput,
	type SubmitTaskInput,
	type SubmitTaskResult,
	type TaskList,
	type TaskView,
	type TriangleDetail,
	type TriangleStatus,
	type AuditReport,
	type Certification,
	type CompletionPolicy,
	type CompletionReport,
	type ConnectionList,
	type CreateConnectionInput,
	type NarrativeConnection,
	type UpdateConnectionInput
} from '@tlon/contracts';

/** Client-side codes for failures that never reached a well-formed API error body. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'BAD_RESPONSE';

export class ApiError extends Error {
	readonly code: ErrorCode | ClientErrorCode;
	readonly status: number;
	readonly details: unknown;

	constructor(
		code: ErrorCode | ClientErrorCode,
		status: number,
		message: string,
		details?: unknown
	) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

/**
 * Participant mode (`/p`): every request carries this bearer token. The operator
 * workspace never sets it (local HUMAN), so the token stays scoped to the page using it.
 */
let bearerToken: string | null = null;

export function setBearerToken(token: string | null) {
	bearerToken = token;
}

/**
 * sessionStorage key of the facilitator secret in protected mode (`TLON_OPERATOR_TOKEN`
 * set on the server). Sent as bearer from operator pages only — never from `/p`.
 */
export const OPERATOR_SECRET_KEY = 'tlon:operator';

/** Called when an operator-page request is refused with 401 (protected mode). */
let onOperatorUnauthorized: (() => void) | null = null;

export function setOperatorUnauthorizedHandler(handler: (() => void) | null) {
	onOperatorUnauthorized = handler;
}

type RequestOptions = {
	method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
	body?: unknown;
	headers?: Record<string, string>;
	/** Only string/number/boolean values are sent; anything else is omitted. */
	query?: Record<string, unknown>;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const url = new URL(`${API_PREFIX}${path}`, window.location.origin);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			url.searchParams.set(key, String(value));
		}
	}
	const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
	if (options.body !== undefined) headers['content-type'] = 'application/json';
	const { pathname } = window.location;
	const participantPage = pathname === '/p' || pathname.startsWith('/p/');
	const token =
		bearerToken ?? (participantPage ? null : sessionStorage.getItem(OPERATOR_SECRET_KEY));
	if (token !== null) headers.authorization = `Bearer ${token}`;

	let response: Response;
	try {
		response = await fetch(url, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body)
		});
	} catch {
		throw new ApiError('NETWORK_ERROR', 0, 'The API server is unreachable');
	}

	const text = await response.text();
	let payload: unknown = undefined;
	if (text !== '') {
		try {
			payload = JSON.parse(text);
		} catch {
			throw new ApiError(
				'BAD_RESPONSE',
				response.status,
				`Unexpected non-JSON response (HTTP ${response.status})`
			);
		}
	}

	if (response.status === 401 && bearerToken === null && !participantPage)
		onOperatorUnauthorized?.();
	if (!response.ok) {
		const parsed = ApiErrorBody.safeParse(payload);
		if (parsed.success) {
			const { code, message, details } = parsed.data.error;
			throw new ApiError(code, response.status, message, details);
		}
		throw new ApiError(
			'BAD_RESPONSE',
			response.status,
			`Request failed with HTTP ${response.status}`
		);
	}
	return payload as T;
}

const p = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const id = (value: string) => encodeURIComponent(value);

export const api = {
	/** `operatorTokenRequired`: protected mode — operator calls need the facilitator secret. */
	health: () => request<{ ok: true; operatorTokenRequired: boolean }>('/health'),

	listProjects: () => request<ProjectList>('/projects'),
	createProject: (input: CreateProjectInput) =>
		request<Project>('/projects', { method: 'POST', body: input }),
	getProject: (projectId: string) => request<Project>(p(projectId)),
	getGraph: (projectId: string) => request<ProjectGraph>(`${p(projectId)}/graph`),

	listArtifacts: (projectId: string, query: ArtifactListQuery = {}) =>
		request<ArtifactPage>(`${p(projectId)}/artifacts`, { query }),
	createArtifact: (projectId: string, input: CreateArtifactInput) =>
		request<Artifact>(`${p(projectId)}/artifacts`, { method: 'POST', body: input }),
	getArtifact: (projectId: string, artifactId: string) =>
		request<Artifact>(`${p(projectId)}/artifacts/${id(artifactId)}`),
	/** `headRevisionId` is sent as `If-Match`; a mismatch fails with STALE_REVISION. */
	updateArtifact: (
		projectId: string,
		artifactId: string,
		headRevisionId: string,
		input: UpdateArtifactInput
	) =>
		request<Artifact>(`${p(projectId)}/artifacts/${id(artifactId)}`, {
			method: 'PATCH',
			body: input,
			headers: { [IF_MATCH_HEADER]: headRevisionId }
		}),
	listRevisions: (projectId: string, artifactId: string) =>
		request<RevisionList>(`${p(projectId)}/artifacts/${id(artifactId)}/revisions`),
	/**
	 * Appends a state annotation for the artifact's head revision (`artifactRevisionId`);
	 * an older revision fails with STALE_REVISION. Never creates an artifact revision.
	 */
	putTransition: (projectId: string, artifactId: string, input: PutTransitionInput) =>
		request<TransitionAnnotation>(`${p(projectId)}/artifacts/${id(artifactId)}/transition`, {
			method: 'PUT',
			body: input
		}),

	// ── Continuity validation ───────────────────────────────────────────────────

	listIssues: (projectId: string) => request<IssueList>(`${p(projectId)}/issues`),
	/** Records a dismissal by issue key; returns the recomputed list. */
	dismissIssue: (projectId: string, input: DismissIssueInput) =>
		request<IssueList>(`${p(projectId)}/issues/dismiss`, { method: 'POST', body: input }),
	/**
	 * Facilitator finding; every quote must occur verbatim in the cited Block's head
	 * revision, else 422 UNGROUNDED_QUOTE with `details.ungrounded: [{artifactId, quote}]`.
	 */
	createFinding: (projectId: string, input: CreateFindingInput) =>
		request<ContinuityFinding>(`${p(projectId)}/findings`, { method: 'POST', body: input }),
	/**
	 * Asks the owning side (A or B) to revise one Block of an open issue: returns the
	 * `revise_block` task (an existing pending one for the same Block and issue is reused).
	 * 422 CROSS_SIDE_REVISION when the issue spans both sides.
	 */
	requestRevision: (projectId: string, input: RequestRevisionInput) =>
		request<Task>(`${p(projectId)}/issues/request-revision`, { method: 'POST', body: input }),

	createRelation: (projectId: string, input: CreateRelationInput) =>
		request<Relation>(`${p(projectId)}/relations`, { method: 'POST', body: input }),
	updateRelation: (projectId: string, relationId: string, input: UpdateRelationInput) =>
		request<Relation>(`${p(projectId)}/relations/${id(relationId)}`, {
			method: 'PATCH',
			body: input
		}),

	createExpansion: (projectId: string, input: CreateExpansionInput) =>
		request<ExpansionDetail>(`${p(projectId)}/expansions`, { method: 'POST', body: input }),
	getExpansion: (projectId: string, expansionId: string) =>
		request<ExpansionDetail>(`${p(projectId)}/expansions/${id(expansionId)}`),
	submitCandidate: (projectId: string, expansionId: string, input: SubmitCandidateInput) =>
		request<ExpansionDetail>(`${p(projectId)}/expansions/${id(expansionId)}/candidates`, {
			method: 'POST',
			body: input
		}),
	acceptExpansion: (
		projectId: string,
		expansionId: string,
		idempotencyKey: string,
		input: AcceptExpansionInput
	) =>
		request<AcceptExpansionResult>(`${p(projectId)}/expansions/${id(expansionId)}/accept`, {
			method: 'POST',
			body: input,
			headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }
		}),
	rejectExpansion: (projectId: string, expansionId: string, input: RejectExpansionInput) =>
		request<ExpansionDetail>(`${p(projectId)}/expansions/${id(expansionId)}/reject`, {
			method: 'POST',
			body: input
		}),

	exportProject: (projectId: string) => request<ExportBundle>(`${p(projectId)}/export`),
	importProject: (projectId: string, bundle: unknown, remapIds = false) =>
		request<ImportResult>(`${p(projectId)}/import`, {
			method: 'POST',
			body: bundle,
			query: { remapIds }
		}),
	/** Atomically creates a project from the bundle (no empty project is left on failure). */
	importAsNewProject: (bundle: unknown, options: ImportAsNewProjectOptions = {}) =>
		request<ImportResult>('/projects/import', {
			method: 'POST',
			body: bundle,
			query: { name: options.name, remapIds: options.remapIds }
		}),

	// ── Artifact Gateway (M3) ───────────────────────────────────────────────────

	whoami: () => request<WhoAmI>('/whoami'),

	listAgents: (projectId: string) => request<AgentList>(`${p(projectId)}/agents`),
	createAgent: (projectId: string, input: CreateAgentInput) =>
		request<AgentPrincipal>(`${p(projectId)}/agents`, { method: 'POST', body: input }),
	/** Disables the principal and revokes every token it holds. */
	disableAgent: (projectId: string, principalId: string) =>
		request<AgentPrincipal>(`${p(projectId)}/agents/${id(principalId)}/disable`, {
			method: 'POST'
		}),
	/** The plaintext `token` is returned exactly once; the server keeps only its hash. */
	issueToken: (projectId: string, principalId: string, input: IssueTokenInput = {}) =>
		request<IssuedToken>(`${p(projectId)}/agents/${id(principalId)}/tokens`, {
			method: 'POST',
			body: input
		}),
	revokeToken: (projectId: string, principalId: string, tokenId: string) =>
		request<undefined>(`${p(projectId)}/agents/${id(principalId)}/tokens/${id(tokenId)}/revoke`, {
			method: 'POST'
		}),

	listGrants: (projectId: string) => request<GrantList>(`${p(projectId)}/grants`),
	createGrant: (
		projectId: string,
		input: { granteePrincipalId: string; artifactId: string; expiresAt?: string }
	) => request<Grant>(`${p(projectId)}/grants`, { method: 'POST', body: input }),
	revokeGrant: (projectId: string, grantId: string) =>
		request<Grant>(`${p(projectId)}/grants/${id(grantId)}/revoke`, { method: 'POST' }),

	listDisclosures: (projectId: string) => request<DisclosureList>(`${p(projectId)}/disclosures`),
	/** Role C only; the web UI (HUMAN) never proposes, it is here for API completeness. */
	proposeDisclosure: (projectId: string, input: ProposeDisclosureInput) =>
		request<Disclosure>(`${p(projectId)}/disclosures`, { method: 'POST', body: input }),
	reviewDisclosure: (projectId: string, disclosureId: string, input: ReviewDisclosureInput) =>
		request<Disclosure>(`${p(projectId)}/disclosures/${id(disclosureId)}/review`, {
			method: 'POST',
			body: input
		}),

	listOwnAudit: (projectId: string, query: { cursor?: string; limit?: number } = {}) =>
		request<AuditPage>(`${p(projectId)}/audit/own`, { query }),

	// ── Composite artifacts ─────────────────────────────────────────────────────

	createComposite: (projectId: string, input: CreateCompositeInput) =>
		request<CompositeView>(`${p(projectId)}/composites`, { method: 'POST', body: input }),
	/** `depth` = how many nested membership levels the server opens (0 = this one only). */
	getComposite: (projectId: string, compositeId: string, depth = 1) =>
		request<CompositeView>(`${p(projectId)}/composites/${id(compositeId)}`, {
			query: { depth }
		}),
	/** Fails with STALE_DEFINITION (409, details.currentVersion) on a version mismatch. */
	reviseComposite: (projectId: string, compositeId: string, input: ReviseCompositeInput) =>
		request<CompositeView>(`${p(projectId)}/composites/${id(compositeId)}/revisions`, {
			method: 'POST',
			body: input
		}),
	listCompositeRevisions: (projectId: string, compositeId: string) =>
		request<CompositeRevisionList>(`${p(projectId)}/composites/${id(compositeId)}/revisions`),
	/** Status ARCHIVED via a normal revision; members and relations stay untouched. */
	archiveComposite: (projectId: string, compositeId: string, reason?: string) =>
		request<Artifact>(`${p(projectId)}/composites/${id(compositeId)}/archive`, {
			method: 'POST',
			body: reason ? { reason } : {}
		}),

	// ── Block–Fact protocol ─────────────────────────────────────────────────────

	/** Creates a participant principal and its link token in one call (HUMAN). */
	createParticipant: (
		projectId: string,
		input: { role: AgentRole; name: string; executorKind: ExecutorKind; ttlSeconds?: number }
	) => request<ParticipantLink>(`${p(projectId)}/participants`, { method: 'POST', body: input }),
	startRun: (projectId: string, input: StartRunInput) =>
		request<Run>(`${p(projectId)}/runs`, { method: 'POST', body: input }),
	/** Filtered per caller: runs for HUMAN only, C sees triangles and tasks of its role. */
	getProtocol: (projectId: string) => request<ProtocolState>(`${p(projectId)}/protocol`),
	/** Pending/submitted tasks assigned to the caller or claimable for its role (A/B/C). */
	listMyTasks: (projectId: string) => request<TaskList>(`${p(projectId)}/tasks/mine`),
	getTaskView: (projectId: string, taskId: string) =>
		request<TaskView>(`${p(projectId)}/tasks/${id(taskId)}/view`),
	submitTask: (projectId: string, taskId: string, input: SubmitTaskInput) =>
		request<SubmitTaskResult>(`${p(projectId)}/tasks/${id(taskId)}/submit`, {
			method: 'POST',
			body: input
		}),
	getTriangle: (projectId: string, triangleId: string) =>
		request<TriangleDetail>(`${p(projectId)}/triangles/${id(triangleId)}`),
	acceptFact: (projectId: string, triangleId: string, candidateId: string) =>
		request<TriangleDetail>(`${p(projectId)}/triangles/${id(triangleId)}/accept-fact`, {
			method: 'POST',
			body: { candidateId }
		}),
	setTriangleStatus: (
		projectId: string,
		triangleId: string,
		status: Extract<TriangleStatus, 'validated' | 'rejected' | 'superseded'>
	) =>
		request<TriangleDetail>(`${p(projectId)}/triangles/${id(triangleId)}/status`, {
			method: 'POST',
			body: { status }
		}),
	/** Composes the triangle (anchors, Fact, continuations) into one composite. */
	composeTriangle: (
		projectId: string,
		triangleId: string,
		input: { title: string; summary?: string }
	) =>
		request<CompositeView>(`${p(projectId)}/triangles/${id(triangleId)}/compose`, {
			method: 'POST',
			body: input
		}),
	/** Opens a gap between two anchors: a proposed triangle plus a propose_fact task for C. */
	connect: (projectId: string, input: ConnectInput) =>
		request<TriangleDetail>(`${p(projectId)}/connect`, { method: 'POST', body: input }),

	// ── Joining semantics, completion and audit (organizer-only) ────────────────

	listConnections: (projectId: string) => request<ConnectionList>(`${p(projectId)}/connections`),
	createConnection: (projectId: string, input: CreateConnectionInput) =>
		request<NarrativeConnection>(`${p(projectId)}/connections`, { method: 'POST', body: input }),
	/** Approve, promote/demote or reject; rejecting never touches the Fact or the texts. */
	updateConnection: (projectId: string, connectionId: string, input: UpdateConnectionInput) =>
		request<NarrativeConnection>(`${p(projectId)}/connections/${id(connectionId)}`, {
			method: 'PATCH',
			body: input
		}),
	getCompletion: (projectId: string, policy: CompletionPolicy) =>
		request<CompletionReport>(`${p(projectId)}/completion`, { query: { policy } }),
	/** 409 COMPLETION_BLOCKED with `details.reasons` when the policy cannot be certified. */
	certify: (projectId: string, policy: CompletionPolicy) =>
		request<Certification>(`${p(projectId)}/certify`, { method: 'POST', body: { policy } }),
	listCertifications: (projectId: string) =>
		request<{ items: Certification[] }>(`${p(projectId)}/certifications`),
	getAudit: (projectId: string) => request<AuditReport>(`${p(projectId)}/audit`)
};
