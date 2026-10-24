import {
	CreateProjectInput,
	TlonError,
	MAX_GRAPH_ARTIFACTS,
	type Principal,
	type Project,
	type ProjectGraph,
	type ProjectList,
	ProjectSettings,
	Uuid
} from '@tlon/contracts';
import { isActionAllowed } from '@tlon/core';
import { asc, eq, inArray } from 'drizzle-orm';

import { assertAllowed, audit, authorize, parseInput, type Ctx } from './internal.ts';
import {
	countVisibleArtifacts,
	loadCandidates,
	loadExpansions,
	loadRelations,
	selectArtifacts,
	toProject
} from './projections.ts';
import { members, projects } from './schema.ts';

export function projectMethods(ctx: Ctx) {
	const { db } = ctx;
	return {
		async listProjects(principal: Principal): Promise<ProjectList> {
			assertAllowed(principal, 'project.read');
			// Agents are bound to a single project and are not `members`.
			if (principal.kind === 'AGENT') {
				if (principal.projectId === null) return { items: [] };
				const rows = await db.select().from(projects).where(eq(projects.id, principal.projectId));
				return { items: rows.map(toProject) };
			}
			const memberOf = await db
				.select({ projectId: members.projectId })
				.from(members)
				.where(eq(members.principalId, principal.id));
			if (memberOf.length === 0) return { items: [] };
			const rows = await db
				.select()
				.from(projects)
				.where(
					inArray(
						projects.id,
						memberOf.map((m) => m.projectId)
					)
				)
				.orderBy(asc(projects.createdAt), asc(projects.id));
			return { items: rows.map(toProject) };
		},

		/** `options.id` pins the project id (seed/import tooling); it is not part of the public contract input. */
		async createProject(
			principal: Principal,
			input: unknown,
			options: { id?: string } = {}
		): Promise<Project> {
			assertAllowed(principal, 'project.admin');
			const data = parseInput(CreateProjectInput, input);
			const settings = ProjectSettings.parse({ ...data.settings });
			const id = options.id ?? ctx.newId();
			if (!Uuid.safeParse(id).success)
				throw new TlonError('VALIDATION_FAILED', 'project id must be a UUID');
			return db.transaction(async (tx) => {
				const now = ctx.now();
				const [row] = await tx
					.insert(projects)
					.values({
						id,
						name: data.name,
						domain: data.domain,
						settings,
						createdAt: now,
						updatedAt: now
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'project insert returned no row');
				await tx
					.insert(members)
					.values({ projectId: id, principalId: principal.id, role: 'OWNER', createdAt: now });
				await audit(ctx, tx, principal, id, 'project.create', id, { domain: data.domain });
				return toProject(row);
			});
		},

		async getProject(principal: Principal, projectId: string): Promise<Project> {
			return toProject(await authorize(db, principal, projectId, 'project.read'));
		},

		async getGraph(principal: Principal, projectId: string): Promise<ProjectGraph> {
			const project = await authorize(db, principal, projectId, 'project.read');
			// The limit applies to what the principal can see: hidden counts must not leak.
			const total = await countVisibleArtifacts(ctx, db, principal, projectId);
			if (total > MAX_GRAPH_ARTIFACTS) {
				throw new TlonError('GRAPH_TOO_LARGE', 'project graph exceeds the projection limit', {
					artifacts: total,
					max: MAX_GRAPH_ARTIFACTS
				});
			}
			// A/B never see expansions or candidates (they reference the other side's material).
			const withExpansions = isActionAllowed(principal, 'expansion.read');
			const [artifactList, relationList, expansionList, candidateList] = await Promise.all([
				selectArtifacts(ctx, db, principal, projectId),
				loadRelations(ctx, db, principal, projectId),
				withExpansions ? loadExpansions(db, projectId) : Promise.resolve([]),
				withExpansions ? loadCandidates(db, projectId) : Promise.resolve([])
			]);
			return {
				project: toProject(project),
				artifacts: artifactList,
				relations: relationList,
				expansions: expansionList,
				candidates: candidateList
			};
		}
	};
}
