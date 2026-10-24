import type { EntityRef, Transition } from '@tlon/contracts';

export type EntityRegistryEntry = EntityRef & { artifactIds: string[] };

/**
 * Identity registry over the annotations (BLOCK_FACT_V2 review §4.3): the union of the
 * entities every beat mentions, keyed by stable id and nothing else. Two people called
 * Прохор stay two entries, two identical inscriptions on different surfaces stay two
 * entries; matching names or prose never merge. The first mention fixes the
 * name/kind/distinguishing note; `artifactIds` lists every beat that mentions the id,
 * in encounter order.
 */
export function entityRegistry(
	annotations: Iterable<{ artifactId: string; transition: Transition }>
): EntityRegistryEntry[] {
	const registry = new Map<string, EntityRegistryEntry>();
	for (const { artifactId, transition } of annotations) {
		for (const entity of transition.entities) {
			const known = registry.get(entity.id);
			if (!known) {
				registry.set(entity.id, { ...entity, artifactIds: [artifactId] });
				continue;
			}
			if (!known.artifactIds.includes(artifactId)) known.artifactIds.push(artifactId);
			known.distinguishing ??= entity.distinguishing;
		}
	}
	return [...registry.values()];
}
