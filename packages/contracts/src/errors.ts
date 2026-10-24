import { z } from 'zod';

/** Typed error codes → HTTP status. Every API/CLI failure maps to exactly one code. */
export const ERROR_STATUS = {
	VALIDATION_FAILED: 400,
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	PROJECT_NOT_FOUND: 404,
	ARTIFACT_NOT_FOUND: 404,
	RELATION_NOT_FOUND: 404,
	EXPANSION_NOT_FOUND: 404,
	CANDIDATE_NOT_FOUND: 404,
	REVISION_NOT_FOUND: 404,
	ROUTE_NOT_FOUND: 404,
	PRINCIPAL_NOT_FOUND: 404,
	GRANT_NOT_FOUND: 404,
	DISCLOSURE_NOT_FOUND: 404,
	DUPLICATE_EXPANSION: 409,
	ALREADY_EXPANDED: 409,
	ALREADY_ACCEPTED: 409,
	INVALID_STATE: 409,
	STALE_REVISION: 409,
	STALE_ANCHOR_REVISION: 409,
	ID_CONFLICT: 409,
	IMPORT_TARGET_NOT_EMPTY: 409,
	GRAPH_TOO_LARGE: 413,
	CROSS_PROJECT_REFERENCE: 422,
	SELF_RELATION: 422,
	CYCLE_DETECTED: 422,
	DEPTH_LIMIT_EXCEEDED: 422,
	CANDIDATE_LIMIT_EXCEEDED: 422,
	IDEMPOTENCY_KEY_REUSED: 422,
	MISSING_REFERENCE: 422,
	UNSUPPORTED_EXPORT_VERSION: 422,
	ARTIFACT_LOCKED: 423,
	PRECONDITION_REQUIRED: 428,
	IDEMPOTENCY_KEY_REQUIRED: 428,
	INTERNAL: 500
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ErrorCode = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

export const ApiErrorBody = z.object({
	error: z.object({
		code: ErrorCode,
		message: z.string(),
		details: z.unknown().optional()
	})
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/**
 * Domain error shared by store, API and CLI. `message` must never contain private
 * artifact text (§9 observability): reference IDs, not bodies.
 */
export class TlonError extends Error {
	readonly code: ErrorCode;
	readonly details: unknown;

	constructor(code: ErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = 'TlonError';
		this.code = code;
		this.details = details;
	}

	get status(): number {
		return ERROR_STATUS[this.code];
	}

	toBody(): ApiErrorBody {
		return {
			error: {
				code: this.code,
				message: this.message,
				...(this.details === undefined ? {} : { details: this.details })
			}
		};
	}
}

export const isTlonError = (value: unknown): value is TlonError => value instanceof TlonError;
