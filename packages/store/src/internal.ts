import { randomUUID } from 'node:crypto';

import { TlonError, type ErrorCode, type Principal, Uuid } from '@tlon/contracts';
import { isActionAllowed, type GatewayAction } from '@tlon/core';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { Db } from './db.ts';
import { auditEvents, members, projects, type ProjectRow } from './schema.ts';

export type ServiceOptions = {
	/** Clock; made strictly increasing by the service so ordering by createdAt is submission order. */
	now?: () => Date;
	newId?: () => string;
};

export type Ctx = {
	db: Db;
	now(): Date;
	newId(): string;
};

export function createCtx(db: Db, options: ServiceOptions = {}): Ctx {
	const clock = options.now ?? (() => new Date());
	let last = 0;
	return {
		db,
		now() {
			last = Math.max(clock().getTime(), last + 1);
			return new Date(last);
		},
		newId: options.newId ?? randomUUID
	};
}

/** Validates against a contract schema; failures become VALIDATION_FAILED with zod issues (no input echoed). */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new TlonError('VALIDATION_FAILED', 'request validation failed', result.error.issues);
	}
	return result.data;
}

/** Runs a contract helper that may throw ZodError (e.g. parseStructured) and maps it to VALIDATION_FAILED. */
export function guardValidation<T>(fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		if (error instanceof Error && error.name === 'ZodError' && 'issues' in error) {
			throw new TlonError('VALIDATION_FAILED', 'request validation failed', error.issues);
		}
		throw error;
	}
}

/** Malformed IDs can never exist: report the matching NOT_FOUND code instead of a driver error. */
export function asUuid(value: string, code: ErrorCode): string {
	if (!Uuid.safeParse(value).success)
		throw new TlonError(code, `${code.toLowerCase()}: malformed id`);
	return value;
}

const WRITE_ROLES: Record<string, true> = { OWNER: true, EDITOR: true };
const READ_ROLES: Record<string, true> = { OWNER: true, EDITOR: true, VIEWER: true };

/** Actions a read-only project member (VIEWER) may still perform. */
const READ_ACTIONS: readonly GatewayAction[] = [
	'project.read',
	'expansion.read',
	'disclosure.read',
	'composite.read',
	'validation.read',
	'export',
	'connection.read',
	'completion.read',
	'finding.read',
	'audit.read'
];

/**
 * Single authorization point (§6, §7.2). Order matters and never leaks:
 * 1. agents are bound to one project — any other project is PROJECT_NOT_FOUND;
 * 2. unknown project → PROJECT_NOT_FOUND;
 * 3. the role→action matrix (`isActionAllowed`) → FORBIDDEN;
 * 4. humans additionally need a `members` row with a sufficient role → FORBIDDEN.
 * Artifact-level visibility is enforced separately, in SQL, by `visibleArtifactPredicate`.
 */
export async function authorize(
	q: Db,
	principal: Principal,
	projectId: string,
	action: GatewayAction
): Promise<ProjectRow> {
	asUuid(projectId, 'PROJECT_NOT_FOUND');
	if (principal.kind === 'AGENT' && principal.projectId !== projectId) {
		throw new TlonError('PROJECT_NOT_FOUND', 'project not found', { projectId });
	}
	const [project] = await q.select().from(projects).where(eq(projects.id, projectId));
	if (!project) throw new TlonError('PROJECT_NOT_FOUND', 'project not found', { projectId });
	if (!isActionAllowed(principal, action)) {
		throw new TlonError('FORBIDDEN', 'principal may not perform this action', { projectId });
	}
	if (principal.kind === 'HUMAN') {
		const [member] = await q
			.select()
			.from(members)
			.where(and(eq(members.projectId, projectId), eq(members.principalId, principal.id)));
		const roles = READ_ACTIONS.includes(action) ? READ_ROLES : WRITE_ROLES;
		if (!member || roles[member.role] !== true) {
			throw new TlonError('FORBIDDEN', 'principal may not access this project', { projectId });
		}
	}
	return project;
}

/** Actions that need no project (create/import) are gated by the matrix alone. */
export function assertAllowed(principal: Principal, action: GatewayAction): void {
	if (!isActionAllowed(principal, action)) {
		throw new TlonError('FORBIDDEN', 'principal may not perform this action');
	}
}

/** Audit row for a mutation. Metadata: IDs and counts only, never titles or bodies. */
export async function audit(
	ctx: Ctx,
	q: Db,
	principal: Principal,
	projectId: string | null,
	operation: string,
	subjectId: string | null,
	metadata: Record<string, unknown> = {}
): Promise<void> {
	await q.insert(auditEvents).values({
		id: ctx.newId(),
		projectId,
		actorId: principal.id,
		operation,
		subjectId,
		outcome: 'SUCCESS',
		metadata,
		createdAt: ctx.now()
	});
}

/** Audit row for a gateway decision that was refused (denied or hidden). IDs only. */
export async function auditDecision(
	ctx: Ctx,
	q: Db,
	actorId: string,
	projectId: string | null,
	operation: string,
	subjectId: string | null,
	outcome: 'DENIED' | 'HIDDEN' | 'UNAUTHENTICATED',
	metadata: Record<string, unknown> = {}
): Promise<void> {
	await q.insert(auditEvents).values({
		id: ctx.newId(),
		projectId,
		actorId,
		operation,
		subjectId,
		outcome,
		metadata,
		createdAt: ctx.now()
	});
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
