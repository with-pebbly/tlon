import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { api, isApiError, onUnauthenticated } from '$lib/api';
import type { WhoAmI } from '@tlon/contracts';

/**
 * Who the browser session belongs to. The admin token itself never lives here: it is exchanged
 * once for an HttpOnly cookie on /login and the browser keeps nothing but that cookie.
 */
class AuthState {
	whoami = $state.raw<WhoAmI | null>(null);
	checking = $state(false);
	/** Set when the session could not be verified for a reason other than a missing session. */
	error = $state<string | null>(null);
	#redirecting = false;

	/** Resolves the current session; a 401 routes to /login through the api hook. */
	async check() {
		if (this.checking) return;
		this.checking = true;
		this.error = null;
		try {
			this.whoami = await api.whoami();
		} catch (error) {
			this.whoami = null;
			if (!isApiError(error) || error.status !== 401) {
				this.error = error instanceof Error ? error.message : String(error);
			}
		} finally {
			this.checking = false;
		}
	}

	async logout() {
		try {
			await api.deleteSession();
		} finally {
			// Leave first: clearing `whoami` on a guarded route would trigger a needless re-check.
			await goto(resolve('/login'));
			this.whoami = null;
		}
	}

	/** Called on any 401: drop the session and send the user to /login, then back. */
	async toLogin() {
		this.whoami = null;
		const login = resolve('/login');
		if (this.#redirecting || window.location.pathname === login) return;
		this.#redirecting = true;
		try {
			const { pathname, search, hash } = window.location;
			await goto(`${login}?next=${encodeURIComponent(`${pathname}${search}${hash}`)}`, {
				replaceState: true
			});
		} finally {
			this.#redirecting = false;
		}
	}
}

export const auth = new AuthState();

onUnauthenticated(() => void auth.toLogin());

/** Only same-origin paths are honoured as a post-login target (no open redirect). */
export function safeNext(next: string | null): string {
	if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
		return next;
	}
	return resolve('/');
}
