import type {
	AcceptExpansionResult,
	Artifact,
	ArtifactPage,
	ExpansionDetail,
	ExportBundle,
	ImportResult,
	Principal,
	Project,
	ProjectGraph,
	ProjectList,
	Relation,
	RevisionList
} from '@tlon/contracts';

import { artifactMethods } from './artifacts.ts';
import { bundleMethods } from './bundle.ts';
import type { Db } from './db.ts';
import { expansionMethods } from './expansions.ts';
import { createCtx, type ServiceOptions } from './internal.ts';
import { projectMethods } from './projects.ts';
import { relationMethods } from './relations.ts';

/**
 * The single domain service shared by API and CLI. Every method takes the acting
 * `Principal` first, validates `unknown` input with the contract schemas, enforces the
 * domain rules and runs multi-row writes in one transaction.
 */
export interface TlonService {
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
}

export function createTlonService(db: Db, options: ServiceOptions = {}): TlonService {
	const ctx = createCtx(db, options);
	return {
		...projectMethods(ctx),
		...artifactMethods(ctx),
		...relationMethods(ctx),
		...expansionMethods(ctx),
		...bundleMethods(ctx)
	};
}
