import type { Artifact, ProjectGraph } from '@tlon/contracts';

export const TENSION_DIMENSIONS = [
	'worldTime',
	'perspective',
	'speaker',
	'location',
	'epistemicStatus'
] as const;
export type TensionDimension = (typeof TENSION_DIMENSIONS)[number];

export type Tension = {
	kind: 'EXPLICIT_CONTRADICTION' | 'FACT_CONFLICT';
	artifactIds: [string, string];
	relationId: string | null;
	/** Accepted expansion bridging this pair (explicitly reconciled), if any. */
	resolvedByExpansionId: string | null;
	/** Qualifiers that differ between the two artifacts and may reconcile them (§3.5). */
	distinguishingDimensions: TensionDimension[];
};

const INACTIVE_STATUSES: Record<string, true> = { REJECTED: true, SUPERSEDED: true };

const field = (a: Artifact, key: string): string | undefined => {
	const value = a.structured[key];
	return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : undefined;
};

function distinguishing(a: Artifact, b: Artifact): TensionDimension[] {
	return TENSION_DIMENSIONS.filter((d) => field(a, d) !== field(b, d));
}

/**
 * Surfaces contradictions as creative input, never as errors (§0). Explicit
 * `contradicts` relations are listed, plus narrative facts that assert the same
 * subject+predicate with different objects.
 */
export function detectTensions(
	graph: Pick<ProjectGraph, 'artifacts' | 'relations' | 'expansions'>
): Tension[] {
	const active = new Map(
		graph.artifacts.filter((a) => !INACTIVE_STATUSES[a.status]).map((a) => [a.id, a])
	);
	const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

	const resolvedByPair = new Map<string, string>();
	for (const e of graph.expansions) {
		if (e.status === 'ACCEPTED')
			resolvedByPair.set(pairKey(e.leftArtifactId, e.rightArtifactId), e.id);
	}

	const tensions: Tension[] = [];
	const seenPairs = new Set<string>();
	for (const r of graph.relations) {
		if (r.type !== 'contradicts' || r.status === 'REJECTED') continue;
		const a = active.get(r.fromId);
		const b = active.get(r.toId);
		if (!a || !b) continue;
		const key = pairKey(a.id, b.id);
		seenPairs.add(key);
		tensions.push({
			kind: 'EXPLICIT_CONTRADICTION',
			artifactIds: [a.id, b.id],
			relationId: r.id,
			resolvedByExpansionId: resolvedByPair.get(key) ?? null,
			distinguishingDimensions: distinguishing(a, b)
		});
	}

	const bySubjectPredicate = new Map<string, Artifact[]>();
	for (const a of active.values()) {
		const subject = field(a, 'subject');
		const predicate = field(a, 'predicate');
		if (!subject || !predicate || !field(a, 'object')) continue;
		const key = `${subject}\u0000${predicate}`;
		const list = bySubjectPredicate.get(key);
		if (list) list.push(a);
		else bySubjectPredicate.set(key, [a]);
	}
	for (const group of bySubjectPredicate.values()) {
		for (let i = 0; i < group.length; i++) {
			for (let j = i + 1; j < group.length; j++) {
				const a = group[i] as Artifact;
				const b = group[j] as Artifact;
				const key = pairKey(a.id, b.id);
				if (seenPairs.has(key) || field(a, 'object') === field(b, 'object')) continue;
				seenPairs.add(key);
				tensions.push({
					kind: 'FACT_CONFLICT',
					artifactIds: [a.id, b.id],
					relationId: null,
					resolvedByExpansionId: resolvedByPair.get(key) ?? null,
					distinguishingDimensions: distinguishing(a, b)
				});
			}
		}
	}
	return tensions;
}
