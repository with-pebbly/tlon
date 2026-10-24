import {
	type CompositeBoundary,
	type CompositeSummary,
	type ProjectGraph,
	type Relation,
	TlonError
} from '@tlon/contracts';

/** Direct-membership map: composite id → member ids (head definitions only). */
export type MembershipIndex = ReadonlyMap<string, readonly string[]>;

export function membershipIndex(
	composites: readonly Pick<CompositeSummary, 'artifactId' | 'memberArtifactIds'>[]
): MembershipIndex {
	return new Map(composites.map((c) => [c.artifactId, c.memberArtifactIds]));
}

/** Every artifact reachable through membership from `compositeId` (excluding itself). */
export function transitiveMembers(compositeId: string, index: MembershipIndex): Set<string> {
	const out = new Set<string>();
	const stack = [...(index.get(compositeId) ?? [])];
	while (stack.length > 0) {
		const id = stack.pop() as string;
		if (out.has(id)) continue;
		out.add(id);
		for (const child of index.get(id) ?? []) stack.push(child);
	}
	return out;
}

/**
 * Rejects a definition for `compositeId` whose members would make it (transitively)
 * contain itself. `index` holds the other composites' current head definitions.
 */
export function assertNoMembershipCycle(
	compositeId: string,
	memberIds: readonly string[],
	index: MembershipIndex
) {
	for (const member of memberIds) {
		if (member === compositeId || transitiveMembers(member, index).has(compositeId)) {
			throw new TlonError('MEMBERSHIP_CYCLE', 'composite would contain itself', {
				compositeId,
				memberId: member
			});
		}
	}
}

/**
 * Default boundary: entries are members with no incoming internal edge (internal
 * sources), exits are members with no outgoing internal edge (sinks). Isolated members
 * are both. Order follows `memberIds`.
 */
export function inferBoundary(
	memberIds: readonly string[],
	internal: readonly Pick<Relation, 'fromId' | 'toId'>[]
): CompositeBoundary {
	const hasIn = new Set(internal.map((r) => r.toId));
	const hasOut = new Set(internal.map((r) => r.fromId));
	return {
		entries: memberIds.filter((id) => !hasIn.has(id)),
		exits: memberIds.filter((id) => !hasOut.has(id))
	};
}

/** Non-blocking findings returned with Compose (spec §7: warnings, not errors). */
export function compositionWarnings(
	memberIds: readonly string[],
	internal: readonly Pick<Relation, 'fromId' | 'toId'>[],
	externalCount: number
): string[] {
	const warnings: string[] = [];
	if (memberIds.length > 1) {
		const adjacency = new Map<string, string[]>(memberIds.map((id) => [id, []]));
		for (const r of internal) {
			adjacency.get(r.fromId)?.push(r.toId);
			adjacency.get(r.toId)?.push(r.fromId);
		}
		const seen = new Set<string>();
		const stack = [memberIds[0] as string];
		while (stack.length > 0) {
			const id = stack.pop() as string;
			if (seen.has(id)) continue;
			seen.add(id);
			for (const next of adjacency.get(id) ?? []) stack.push(next);
		}
		if (seen.size < memberIds.length)
			warnings.push('members are not connected by the selected relations');
	}
	if (externalCount > 0) {
		warnings.push(`${externalCount} external relation(s) stay attached to members unchanged`);
	}
	return warnings;
}

export type AggregatedEdge = {
	/** Synthetic id `agg:<from>:<to>`; never persisted. */
	id: string;
	fromId: string;
	toId: string;
	/** Real relations this virtual edge stands for (spec §3.2). */
	sourceRelationIds: string[];
};

export type CollapsedGraph<
	G extends Pick<ProjectGraph, 'artifacts' | 'relations' | 'expansions' | 'composites'>
> = G & {
	/** Members hidden behind a collapsed composite → that composite. */
	representative: ReadonlyMap<string, string>;
	/** Virtual edges between visible nodes standing in for hidden real relations. */
	aggregatedEdges: AggregatedEdge[];
};

/**
 * UI-only Collapse (spec §2): hides members of collapsed composites, keeps every real
 * relation between visible nodes untouched, and replaces relations that touch hidden
 * members with explicit virtual `aggregated` edges. Nothing is written anywhere.
 *
 * Visibility walks the membership DAG from top-level artifacts: members of an OPEN
 * composite are visible; a member reused by several composites is visible if any
 * visible open composite contains it.
 */
export function collapseComposites<
	G extends Pick<ProjectGraph, 'artifacts' | 'relations' | 'expansions' | 'composites'>
>(graph: G, openCompositeIds: ReadonlySet<string>): CollapsedGraph<G> {
	const index = membershipIndex(graph.composites);
	const memberOfSomething = new Set([...index.values()].flat());
	const visible = new Set<string>();
	const representative = new Map<string, string>();
	const queue = graph.artifacts.filter((a) => !memberOfSomething.has(a.id)).map((a) => a.id);
	while (queue.length > 0) {
		const id = queue.shift() as string;
		if (visible.has(id)) continue;
		visible.add(id);
		const members = index.get(id);
		if (!members) continue;
		if (openCompositeIds.has(id)) {
			queue.push(...members);
		} else {
			for (const hidden of transitiveMembers(id, index)) {
				if (!representative.has(hidden)) representative.set(hidden, id);
			}
		}
	}
	// A member visible through another open path is not represented by a collapsed one.
	for (const id of visible) representative.delete(id);

	const keep = (id: string) => visible.has(id);
	const aggregated = new Map<string, AggregatedEdge>();
	const relations = graph.relations.filter((r) => {
		if (keep(r.fromId) && keep(r.toId)) return true;
		const from = keep(r.fromId) ? r.fromId : representative.get(r.fromId);
		const to = keep(r.toId) ? r.toId : representative.get(r.toId);
		if (from && to && from !== to) {
			const key = `agg:${from}:${to}`;
			const edge = aggregated.get(key) ?? {
				id: key,
				fromId: from,
				toId: to,
				sourceRelationIds: []
			};
			edge.sourceRelationIds.push(r.id);
			aggregated.set(key, edge);
		}
		return false;
	});
	const hiddenBridge = (e: G['expansions'][number]) =>
		e.selectedBridgeArtifactId !== null && !keep(e.selectedBridgeArtifactId);
	return {
		...graph,
		artifacts: graph.artifacts.filter((a) => keep(a.id)),
		relations,
		expansions: graph.expansions.filter((e) => !hiddenBridge(e)),
		representative,
		aggregatedEdges: [...aggregated.values()]
	};
}
