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
	type CreateArtifactInput,
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
	type WhoAmI
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

type RequestOptions = {
	method?: 'GET' | 'POST' | 'PATCH';
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
	health: () => request<{ ok: true }>('/health'),

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
		request<AuditPage>(`${p(projectId)}/audit/own`, { query })
};
