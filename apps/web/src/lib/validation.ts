import {
	parseStructured,
	type ArtifactKind,
	type ProjectDomain,
	type StructuredRecord
} from '@tlon/contracts';

export type StructuredCheck = { ok: true; value: StructuredRecord } | { ok: false; error: string };

/** Parses the JSON textarea into a plain object (no schema validation yet). */
export function parseJsonObject(text: string): StructuredCheck {
	let value: unknown;
	try {
		value = text.trim() === '' ? {} : JSON.parse(text);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' };
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ok: false, error: 'structured must be a JSON object' };
	}
	return { ok: true, value: { ...value } };
}

/** Client-side mirror of the server rule: `parseStructured(domain, kind, structured)`. */
export function validateStructured(
	domain: ProjectDomain,
	kind: ArtifactKind,
	value: StructuredRecord
): string | null {
	try {
		parseStructured(domain, kind, value);
		return null;
	} catch (error) {
		if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
			const issues: unknown[] = error.issues;
			const messages = issues.map((issue) => {
				if (!issue || typeof issue !== 'object') return String(issue);
				const message = 'message' in issue ? String(issue.message) : 'invalid value';
				const path = 'path' in issue && Array.isArray(issue.path) ? issue.path.map(String) : [];
				return path.length > 0 ? `${path.join('.')}: ${message}` : message;
			});
			if (messages.length > 0) return messages.join('; ');
		}
		return error instanceof Error ? error.message : 'invalid structured data';
	}
}
