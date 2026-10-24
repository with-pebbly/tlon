import type { OwnerScope, Principal } from '@tlon/contracts';

/**
 * Owner scopes a principal may read without an explicit grant. M3 adds grants and
 * disclosures (C_SHARED material reaches A/B only through those); until then only
 * HUMAN principals exist at runtime. Deny by default: unknown roles see nothing.
 */
const BASE_VISIBLE_SCOPES: Record<Principal['role'], readonly OwnerScope[]> = {
	HUMAN: ['A_PRIVATE', 'B_PRIVATE', 'C_SHARED', 'PROJECT_PUBLIC'],
	C: ['A_PRIVATE', 'B_PRIVATE', 'C_SHARED', 'PROJECT_PUBLIC'],
	VALIDATOR: ['PROJECT_PUBLIC', 'C_SHARED'],
	A: ['A_PRIVATE', 'PROJECT_PUBLIC'],
	B: ['B_PRIVATE', 'PROJECT_PUBLIC']
};

export function visibleScopesFor(principal: Principal): readonly OwnerScope[] {
	return BASE_VISIBLE_SCOPES[principal.role] ?? [];
}
