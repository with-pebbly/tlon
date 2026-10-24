import type { XY } from './layout';

/**
 * User-dragged node positions, per project and view. Kept in localStorage only:
 * canvas coordinates are an exploration aid and never part of persisted project data.
 */
const storageKey = (projectId: string, view: string) => `tlon:positions:${projectId}:${view}`;

export function loadPositions(projectId: string, view: string): Record<string, XY> {
	try {
		const raw = localStorage.getItem(storageKey(projectId, view));
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return {};
		const out: Record<string, XY> = {};
		for (const [id, value] of Object.entries(parsed)) {
			if (!value || typeof value !== 'object' || !('x' in value) || !('y' in value)) continue;
			if (typeof value.x === 'number' && typeof value.y === 'number')
				out[id] = { x: value.x, y: value.y };
		}
		return out;
	} catch {
		return {};
	}
}

export function savePositions(projectId: string, view: string, positions: Record<string, XY>) {
	try {
		if (Object.keys(positions).length === 0) localStorage.removeItem(storageKey(projectId, view));
		else localStorage.setItem(storageKey(projectId, view), JSON.stringify(positions));
	} catch {
		// Storage full or disabled: layout simply falls back to automatic positions.
	}
}
