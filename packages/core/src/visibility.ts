import type { OwnerScope, Principal } from '@tlon/contracts';

/**
 * Owner scopes a principal reads without an explicit grant (§7.1). Deny by default:
 * A/B see only their own private scope; everything else (the other side, C_SHARED,
 * PROJECT_PUBLIC canon) reaches them solely through per-artifact grants created by
 * approved disclosures. HUMAN and C see the whole project; VALIDATOR reads all
 * canonical material but cannot publish or write.
 */
const BASE_VISIBLE_SCOPES: Record<Principal['role'], readonly OwnerScope[]> = {
	HUMAN: ['A_PRIVATE', 'B_PRIVATE', 'C_SHARED', 'PROJECT_PUBLIC'],
	C: ['A_PRIVATE', 'B_PRIVATE', 'C_SHARED', 'PROJECT_PUBLIC'],
	VALIDATOR: ['A_PRIVATE', 'B_PRIVATE', 'C_SHARED', 'PROJECT_PUBLIC'],
	A: ['A_PRIVATE'],
	B: ['B_PRIVATE']
};

export function visibleScopesFor(principal: Principal): readonly OwnerScope[] {
	return BASE_VISIBLE_SCOPES[principal.role] ?? [];
}

/** Scope a principal's new artifacts are forced into (client-supplied ownerScope is ignored for agents). */
const WRITE_SCOPE: Record<Principal['role'], OwnerScope | null> = {
	HUMAN: null,
	C: 'C_SHARED',
	A: 'A_PRIVATE',
	B: 'B_PRIVATE',
	VALIDATOR: null
};

/**
 * Scope an artifact created by `principal` lands in: humans choose freely, agents are
 * pinned to their own scope, VALIDATOR cannot create (returns null → FORBIDDEN).
 */
export function creationScopeFor(principal: Principal, requested: OwnerScope): OwnerScope | null {
	if (principal.role === 'HUMAN') return requested;
	return WRITE_SCOPE[principal.role] ?? null;
}

/** Scopes whose artifacts a principal may edit (agents only edit their own scope). */
export function writableScopesFor(principal: Principal): readonly OwnerScope[] {
	if (principal.role === 'HUMAN') return BASE_VISIBLE_SCOPES.HUMAN;
	const own = WRITE_SCOPE[principal.role];
	return own ? [own] : [];
}

export type GatewayAction =
	| 'project.read'
	| 'project.admin'
	| 'artifact.create'
	| 'relation.create'
	| 'relation.update'
	| 'expansion.read'
	| 'expansion.open'
	| 'expansion.submit_candidate'
	| 'expansion.review'
	| 'disclosure.propose'
	| 'disclosure.review'
	| 'disclosure.read'
	| 'export'
	| 'import'
	| 'composite.create'
	| 'composite.revise'
	| 'composite.read'
	| 'transition.write'
	| 'validation.read'
	| 'issue.dismiss'
	| 'protocol.facilitate'
	| 'triangle.read'
	| 'task.own'
	| 'fact.rationale.read';

/**
 * Role → action matrix (§7.1/§7.4, MVP approval policy: human reviews). A/B never see
 * expansions (they reference the other side) and cannot publish; C cannot accept or
 * reject bridges; nobody but HUMAN administers agents, exports or imports.
 */
const ALLOWED: Record<Principal['role'], readonly GatewayAction[]> = {
	HUMAN: [
		'project.read',
		'project.admin',
		'artifact.create',
		'relation.create',
		'relation.update',
		'expansion.read',
		'expansion.open',
		'expansion.submit_candidate',
		'expansion.review',
		'disclosure.review',
		'disclosure.read',
		'export',
		'import',
		'composite.create',
		'composite.revise',
		'composite.read',
		'transition.write',
		'validation.read',
		'issue.dismiss',
		'protocol.facilitate',
		'triangle.read',
		'fact.rationale.read'
	],
	C: [
		'project.read',
		'artifact.create',
		'relation.create',
		'expansion.read',
		'expansion.open',
		'expansion.submit_candidate',
		'disclosure.propose',
		'disclosure.read',
		'composite.create',
		'composite.revise',
		'composite.read',
		'transition.write',
		'validation.read',
		'triangle.read',
		'task.own',
		'fact.rationale.read'
	],
	VALIDATOR: [
		'project.read',
		'expansion.read',
		'composite.read',
		'validation.read',
		'triangle.read'
	],
	A: [
		'project.read',
		'artifact.create',
		'relation.create',
		'composite.create',
		'composite.revise',
		'composite.read',
		'transition.write',
		'task.own'
	],
	B: [
		'project.read',
		'artifact.create',
		'relation.create',
		'composite.create',
		'composite.revise',
		'composite.read',
		'transition.write',
		'task.own'
	]
};

export function isActionAllowed(principal: Principal, action: GatewayAction): boolean {
	return (ALLOWED[principal.role] ?? []).includes(action);
}
