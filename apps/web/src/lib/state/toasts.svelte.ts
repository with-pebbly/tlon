import { isApiError } from '$lib/api';

export type Toast = {
	id: number;
	kind: 'error' | 'info';
	code: string | null;
	message: string;
};

const AUTO_DISMISS_MS = 8000;

class ToastState {
	items = $state<Toast[]>([]);
	#nextId = 1;

	push(kind: Toast['kind'], message: string, code: string | null = null) {
		const id = this.#nextId++;
		this.items.push({ id, kind, code, message });
		if (kind === 'info') setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
	}

	/** Surface any thrown value; API errors keep their typed code. A 401 is not toasted: the
	 * api hook already routes the user to /login. */
	error(error: unknown) {
		if (isApiError(error) && error.status === 401) return;
		if (isApiError(error)) this.push('error', error.message, error.code);
		else if (error instanceof Error) this.push('error', error.message);
		else this.push('error', String(error));
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastState();
