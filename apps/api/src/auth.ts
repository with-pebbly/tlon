import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ADMIN_TOKEN_PREFIX = 'tlon_admin_';
export const ADMIN_TOKEN_MIN_LENGTH = 32;
export const SESSION_COOKIE = 'tlon_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Constant-time string comparison (length is not secret; content is). */
export function secretsEqual(a: string, b: string): boolean {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

export function assertAdminToken(token: string, source: string): string {
	if (token.length < ADMIN_TOKEN_MIN_LENGTH) {
		throw new Error(`${source} must be at least ${ADMIN_TOKEN_MIN_LENGTH} characters`);
	}
	return token;
}

/**
 * The human credential. Uses `TLON_ADMIN_TOKEN` when set (≥ 32 chars, otherwise throws);
 * else reads `path`, creating it with a fresh random token (mode 0600) on first boot.
 * The value is never logged: callers may log `path` only.
 */
export function loadOrCreateAdminToken(
	path: string,
	env: Record<string, string | undefined> = process.env
): string {
	const fromEnv = env.TLON_ADMIN_TOKEN;
	if (fromEnv !== undefined && fromEnv !== '') return assertAdminToken(fromEnv, 'TLON_ADMIN_TOKEN');
	if (existsSync(path)) {
		return assertAdminToken(readFileSync(path, 'utf8').trim(), `admin token file ${path}`);
	}
	mkdirSync(dirname(path), { recursive: true });
	const token = `${ADMIN_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
	writeFileSync(path, `${token}\n`, { mode: 0o600, flag: 'wx' });
	chmodSync(path, 0o600);
	return token;
}

/** In-memory human sessions: opaque random ids, 12 h TTL, lost on restart. */
export class SessionStore {
	private readonly now: () => number;
	private readonly sessions = new Map<string, number>();

	constructor(now: () => number) {
		this.now = now;
	}

	create(): string {
		this.sweep();
		const id = randomBytes(32).toString('base64url');
		this.sessions.set(id, this.now() + SESSION_TTL_MS);
		return id;
	}

	isValid(id: string): boolean {
		const expiresAt = this.sessions.get(id);
		if (expiresAt === undefined) return false;
		if (expiresAt <= this.now()) {
			this.sessions.delete(id);
			return false;
		}
		return true;
	}

	delete(id: string): void {
		this.sessions.delete(id);
	}

	private sweep(): void {
		const now = this.now();
		for (const [id, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(id);
	}
}

export function readCookie(header: string | undefined, name: string): string | undefined {
	if (header === undefined) return undefined;
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index < 0) continue;
		if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || undefined;
	}
	return undefined;
}

export function sessionCookie(id: string): string {
	return `${SESSION_COOKIE}=${id}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearedSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`;
}
