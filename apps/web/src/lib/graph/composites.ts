import {
	LOCAL_HUMAN,
	ROLES,
	type Artifact,
	type CompositeContract,
	type CompositeSummary,
	type OwnerScope,
	type Role
} from '@tlon/contracts';
import { type MembershipIndex, visibleScopesFor } from '@tlon/core';

/**
 * Nesting level per composite: a composite of atomic members is level 1, a composite
 * containing a level-1 composite is level 2, and so on (the "nested-level count").
 */
export function nestingLevels(index: MembershipIndex): Map<string, number> {
	const levels = new Map<string, number>();
	const visiting = new Set<string>();
	const level = (id: string): number => {
		const members = index.get(id);
		if (!members) return 0;
		const known = levels.get(id);
		if (known !== undefined) return known;
		// A cycle cannot be persisted (MEMBERSHIP_CYCLE); the guard keeps a bad payload finite.
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const value = 1 + Math.max(0, ...members.map(level));
		visiting.delete(id);
		levels.set(id, value);
		return value;
	};
	for (const id of index.keys()) level(id);
	return levels;
}

/** Member → composites whose head definition lists it directly. */
export function parentIndex(composites: readonly CompositeSummary[]): Map<string, string[]> {
	const parents = new Map<string, string[]>();
	for (const c of composites) {
		for (const member of c.memberArtifactIds) {
			const list = parents.get(member);
			if (list) list.push(c.artifactId);
			else parents.set(member, [c.artifactId]);
		}
	}
	return parents;
}

/**
 * Open/collapsed composites are UI state only (ADR 0009), remembered per project in
 * localStorage. Default: every composite is collapsed.
 */
const openKey = (projectId: string) => `tlon:open-composites:${projectId}`;

export function loadOpenComposites(projectId: string): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(openKey(projectId)) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

export function saveOpenComposites(projectId: string, ids: Iterable<string>) {
	try {
		const list = [...ids];
		if (list.length === 0) localStorage.removeItem(openKey(projectId));
		else localStorage.setItem(openKey(projectId), JSON.stringify(list));
	} catch {
		// Storage disabled: open state lasts for this page only.
	}
}

/** Roles that read a scope without a grant (core visibility rules). */
export function scopeAudience(scope: OwnerScope): Set<Role> {
	return new Set(
		ROLES.filter((role) => visibleScopesFor({ ...LOCAL_HUMAN, role }).includes(scope))
	);
}

/**
 * Member scopes the composite scope would leak to a wider audience (the server rejects
 * these with SCOPE_LEAK): the composite's audience must be contained in every member's.
 */
export function leakingScopes(
	compositeScope: OwnerScope,
	memberScopes: Iterable<OwnerScope>
): OwnerScope[] {
	const audience = scopeAudience(compositeScope);
	const out = new Set<OwnerScope>();
	for (const scope of memberScopes) {
		const memberAudience = scopeAudience(scope);
		if ([...audience].some((role) => !memberAudience.has(role))) out.add(scope);
	}
	return [...out];
}

/**
 * Best-effort world-time span of a set of artifacts: min/max of the string
 * `structured.worldTime` values (lexicographic, so ISO-like values order correctly).
 */
export function worldTimeRange(
	ids: Iterable<string>,
	artifactsById: ReadonlyMap<string, Artifact>
): { min: string; max: string } | null {
	let min: string | null = null;
	let max: string | null = null;
	for (const id of ids) {
		const value = artifactsById.get(id)?.structured.worldTime;
		if (typeof value !== 'string' || value.trim() === '') continue;
		if (min === null || value.localeCompare(min) < 0) min = value;
		if (max === null || value.localeCompare(max) > 0) max = value;
	}
	return min !== null && max !== null ? { min, max } : null;
}

export type ClaimSection = 'entryConditions' | 'exitConditions' | 'invariants' | 'keyClaims';

export const CLAIM_SECTIONS: readonly { key: ClaimSection; label: string }[] = [
	{ key: 'keyClaims', label: 'Key claims' },
	{ key: 'entryConditions', label: 'Entry conditions' },
	{ key: 'exitConditions', label: 'Exit conditions' },
	{ key: 'invariants', label: 'Invariants' }
];

/** Every ClaimRef of a contract with the section it belongs to. */
export function contractClaims(contract: CompositeContract) {
	return CLAIM_SECTIONS.flatMap(({ key, label }) =>
		contract[key].map((claim) => ({ section: label, claim }))
	);
}
