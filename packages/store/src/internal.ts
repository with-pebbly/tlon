import { randomUUID } from 'node:crypto';

import { TlonError, type ErrorCode, type Principal, Uuid } from '@tlon/contracts';
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

export type Action = 'read' | 'write';

/**
 * Single authorization point (§6): unknown project → PROJECT_NOT_FOUND, non-member or
 * insufficient role → FORBIDDEN. M3 replaces the membership check with grants.
 */
export async function authorize(
	q: Db,
	principal: Principal,
	projectId: string,
	action: Action
): Promise<ProjectRow> {
	asUuid(projectId, 'PROJECT_NOT_FOUND');
	const [project] = await q.select().from(projects).where(eq(projects.id, projectId));
	if (!project) throw new TlonError('PROJECT_NOT_FOUND', 'project not found', { projectId });
	const [member] = await q
		.select()
		.from(members)
		.where(and(eq(members.projectId, projectId), eq(members.principalId, principal.id)));
	const allowed = member && (action === 'write' ? WRITE_ROLES : READ_ROLES)[member.role] === true;
	if (!allowed)
		throw new TlonError('FORBIDDEN', 'principal may not access this project', { projectId });
	return project;
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

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
