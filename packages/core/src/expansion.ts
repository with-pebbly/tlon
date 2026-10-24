import {
	DEFAULT_CHILD_RELATION_TYPE,
	type Expansion,
	TlonError,
	type ProjectSettings,
	type Relation
} from '@tlon/contracts';

/**
 * Parent/depth for a new expansion. An expansion targeting a relation that was itself
 * produced by expansion E is a child of E (one level deeper); anything else is a root.
 */
export function resolveExpansionParent(
	targetRelation: Pick<Relation, 'expansionId'> | null,
	expansionsById: ReadonlyMap<string, Pick<Expansion, 'id' | 'depth'>>
): { parentExpansionId: string | null; depth: number } {
	const parentId = targetRelation?.expansionId ?? null;
	if (parentId === null) return { parentExpansionId: null, depth: 1 };
	const parent = expansionsById.get(parentId);
	if (!parent) {
		throw new TlonError('MISSING_REFERENCE', 'relation references an unknown expansion', {
			expansionId: parentId
		});
	}
	return { parentExpansionId: parent.id, depth: parent.depth + 1 };
}

export function assertDepthWithinLimit(depth: number, settings: Pick<ProjectSettings, 'maxDepth'>) {
	if (depth > settings.maxDepth) {
		throw new TlonError(
			'DEPTH_LIMIT_EXCEEDED',
			`expansion depth ${depth} exceeds maxDepth ${settings.maxDepth}`,
			{
				depth,
				maxDepth: settings.maxDepth
			}
		);
	}
}

/** Ancestors of an expansion, ordered root → direct parent. Detects corrupted parent loops. */
export function expansionLineage(
	parentExpansionId: string | null,
	expansionsById: ReadonlyMap<string, Expansion>
): Expansion[] {
	const lineage: Expansion[] = [];
	const seen = new Set<string>();
	let cursor = parentExpansionId;
	while (cursor !== null) {
		if (seen.has(cursor)) {
			throw new TlonError('CYCLE_DETECTED', 'expansion parent chain contains a cycle', {
				expansionId: cursor
			});
		}
		seen.add(cursor);
		const current = expansionsById.get(cursor);
		if (!current) {
			throw new TlonError('MISSING_REFERENCE', 'expansion parent not found', {
				expansionId: cursor
			});
		}
		lineage.push(current);
		cursor = current.parentExpansionId;
	}
	return lineage.reverse();
}

/**
 * Artifacts that may not be nominated as the bridge of an expansion: its own anchors
 * and every anchor/bridge along its lineage. Reusing one would fold the expansion tree
 * back onto itself.
 */
export function forbiddenBridgeArtifactIds(
	expansion: Pick<Expansion, 'leftArtifactId' | 'rightArtifactId'>,
	lineage: readonly Expansion[]
): Set<string> {
	const ids = new Set([expansion.leftArtifactId, expansion.rightArtifactId]);
	for (const ancestor of lineage) {
		ids.add(ancestor.leftArtifactId);
		ids.add(ancestor.rightArtifactId);
		if (ancestor.selectedBridgeArtifactId) ids.add(ancestor.selectedBridgeArtifactId);
	}
	return ids;
}

export function assertCandidateArtifactAllowed(
	artifactId: string,
	expansion: Pick<Expansion, 'leftArtifactId' | 'rightArtifactId'>,
	lineage: readonly Expansion[]
) {
	if (forbiddenBridgeArtifactIds(expansion, lineage).has(artifactId)) {
		throw new TlonError(
			'CYCLE_DETECTED',
			'bridge candidate is an anchor of this expansion or its lineage',
			{
				artifactId
			}
		);
	}
}

export type PlannedChildRelation = {
	fromId: string;
	toId: string;
	type: string;
	provenanceArtifactIds: string[];
};

/**
 * Child relations created when `bridgeArtifactId` is accepted: left→C and C→right.
 * These are the expansion opportunities of §5 step 5; nothing is auto-expanded.
 */
export function planChildRelations(
	expansion: Pick<Expansion, 'leftArtifactId' | 'rightArtifactId'>,
	bridgeArtifactId: string,
	types: { leftRelationType?: string | undefined; rightRelationType?: string | undefined } = {}
): [PlannedChildRelation, PlannedChildRelation] {
	const provenance = [expansion.leftArtifactId, bridgeArtifactId, expansion.rightArtifactId];
	return [
		{
			fromId: expansion.leftArtifactId,
			toId: bridgeArtifactId,
			type: types.leftRelationType ?? DEFAULT_CHILD_RELATION_TYPE,
			provenanceArtifactIds: provenance
		},
		{
			fromId: bridgeArtifactId,
			toId: expansion.rightArtifactId,
			type: types.rightRelationType ?? DEFAULT_CHILD_RELATION_TYPE,
			provenanceArtifactIds: provenance
		}
	];
}

/** Deterministic JSON with sorted object keys; stable across engines for fingerprints. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * §4 idempotency key material: (target relation, pinned revisions, operation options).
 * The store hashes this and compares it with the fingerprint stored at first accept.
 */
export function acceptanceFingerprint(input: {
	expansion: Pick<Expansion, 'id' | 'targetRelationId' | 'leftRevisionId' | 'rightRevisionId'>;
	candidateId: string;
	leftRelationType: string;
	rightRelationType: string;
}): string {
	return canonicalJson({
		op: 'expansion.accept',
		expansionId: input.expansion.id,
		targetRelationId: input.expansion.targetRelationId,
		leftRevisionId: input.expansion.leftRevisionId,
		rightRevisionId: input.expansion.rightRevisionId,
		candidateId: input.candidateId,
		leftRelationType: input.leftRelationType,
		rightRelationType: input.rightRelationType
	});
}
