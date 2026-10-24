import { ACYCLIC_RELATION_TYPES, TlonError, type Relation } from '@tlon/contracts';

type Edge = Pick<Relation, 'id' | 'fromId' | 'toId' | 'type' | 'status'>;

/**
 * Whether adding `fromId → toId` of `type` closes a cycle among non-rejected relations
 * of the same type. Only meaningful for ACYCLIC_RELATION_TYPES; the semantic graph is
 * otherwise allowed to be cyclic (§1).
 */
export function wouldCreateCycle(
	relations: readonly Edge[],
	candidate: { fromId: string; toId: string; type: string; ignoreRelationId?: string }
): boolean {
	if (candidate.fromId === candidate.toId) return true;
	const adjacency = new Map<string, string[]>();
	for (const r of relations) {
		if (
			r.type !== candidate.type ||
			r.status === 'REJECTED' ||
			r.id === candidate.ignoreRelationId
		) {
			continue;
		}
		const next = adjacency.get(r.fromId);
		if (next) next.push(r.toId);
		else adjacency.set(r.fromId, [r.toId]);
	}
	const stack = [candidate.toId];
	const seen = new Set<string>();
	while (stack.length > 0) {
		const node = stack.pop() as string;
		if (node === candidate.fromId) return true;
		if (seen.has(node)) continue;
		seen.add(node);
		for (const next of adjacency.get(node) ?? []) stack.push(next);
	}
	return false;
}

export function assertRelationAcyclic(
	relations: readonly Edge[],
	candidate: { fromId: string; toId: string; type: string; ignoreRelationId?: string }
) {
	if (ACYCLIC_RELATION_TYPES.includes(candidate.type) && wouldCreateCycle(relations, candidate)) {
		throw new TlonError('CYCLE_DETECTED', `relation type '${candidate.type}' must stay acyclic`, {
			fromId: candidate.fromId,
			toId: candidate.toId,
			type: candidate.type
		});
	}
}
