import type { Artifact, Expansion, Relation } from '@tlon/contracts';

let counter = 0;
const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, counter++)).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
let seq = 1000;
export const nextId = () => uuid(seq++);

export function artifact(title: string, patch: Partial<Artifact> = {}): Artifact {
	const id = patch.id ?? nextId();
	const at = ts();
	return {
		id,
		projectId: uuid(1),
		kind: 'FACT',
		title,
		body: '',
		structured: {},
		status: 'ACCEPTED',
		creatorRole: 'HUMAN',
		ownerScope: 'PROJECT_PUBLIC',
		createdAt: at,
		updatedAt: at,
		headRevisionId: nextId(),
		version: 1,
		locked: false,
		pinned: false,
		...patch
	};
}

export function relation(fromId: string, toId: string, patch: Partial<Relation> = {}): Relation {
	const at = ts();
	return {
		id: nextId(),
		projectId: uuid(1),
		fromId,
		toId,
		type: 'contradicts',
		status: 'ACCEPTED',
		expansionId: null,
		provenanceArtifactIds: [],
		expandedByExpansionId: null,
		createdAt: at,
		updatedAt: at,
		...patch
	};
}

export type MiniGraph = { artifacts: Artifact[]; relations: Relation[]; expansions: Expansion[] };

/**
 * Accepts a bridge on `target` the way the store does: new BRIDGE artifact,
 * ACCEPTED expansion, two child relations. Returns the child relations.
 */
export function acceptBridge(
	graph: MiniGraph,
	target: Relation,
	title: string
): [Relation, Relation] {
	const parent = graph.expansions.find((e) => e.id === target.expansionId) ?? null;
	const bridge = artifact(title, { kind: 'BRIDGE' });
	const at = ts();
	const expansion: Expansion = {
		id: nextId(),
		projectId: uuid(1),
		targetRelationId: target.id,
		leftArtifactId: target.fromId,
		rightArtifactId: target.toId,
		leftRevisionId: nextId(),
		rightRevisionId: nextId(),
		parentExpansionId: parent?.id ?? null,
		bridgeArtifactIds: [bridge.id],
		selectedBridgeArtifactId: bridge.id,
		depth: (parent?.depth ?? 0) + 1,
		status: 'ACCEPTED',
		attempts: 1,
		childRelationIds: [],
		createdAt: at,
		updatedAt: at,
		acceptedAt: at
	};
	// Insert right child first to prove ordering does not depend on insertion order.
	const right = relation(bridge.id, target.toId, { type: 'bridges', expansionId: expansion.id });
	const left = relation(target.fromId, bridge.id, { type: 'bridges', expansionId: expansion.id });
	expansion.childRelationIds = [left.id, right.id];
	target.expandedByExpansionId = expansion.id;
	graph.artifacts.push(bridge);
	graph.relations.push(right, left);
	graph.expansions.push(expansion);
	return [left, right];
}
