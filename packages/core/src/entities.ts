import type { EntityRef, Transition } from '@tlon/contracts';

export type EntityRegistryEntry = EntityRef & { artifactIds: string[] };

/**
 * Identity registry over the annotations (BLOCK_FACT_V2 review §4.3): the union of the
 * entities every beat mentions, keyed by stable id and nothing else. Two people called
 * Прохор stay two entries, two identical inscriptions on different surfaces stay two
 * entries; matching names or prose never merge. The first mention fixes the
 * name/kind/distinguishing note; aliases are the union over every mention;
 * `artifactIds` lists every beat that mentions the id, in encounter order.
 */
export function entityRegistry(
	annotations: Iterable<{ artifactId: string; transition: Transition }>
): EntityRegistryEntry[] {
	const registry = new Map<string, EntityRegistryEntry>();
	for (const { artifactId, transition } of annotations) {
		for (const entity of transition.entities) {
			const known = registry.get(entity.id);
			if (!known) {
				registry.set(entity.id, {
					...entity,
					aliases: [...entity.aliases],
					artifactIds: [artifactId]
				});
				continue;
			}
			if (!known.artifactIds.includes(artifactId)) known.artifactIds.push(artifactId);
			known.distinguishing ??= entity.distinguishing;
			for (const alias of entity.aliases) {
				if (!known.aliases.includes(alias)) known.aliases.push(alias);
			}
		}
	}
	return [...registry.values()];
}

/** Case, `ё`/`е`, punctuation and spacing are not part of a name's identity. */
export const normalizeName = (name: string): string =>
	name
		.toLowerCase()
		.replaceAll('ё', 'е')
		.replace(/[^\p{L}\p{N}\s]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();

/** Edit distance, capped: returns `limit + 1` as soon as it cannot be within `limit`. */
function boundedLevenshtein(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row.push(
				Math.min(
					previous[j]! + 1,
					row[j - 1]! + 1,
					previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
				)
			);
		}
		previous = row;
	}
	return previous[b.length]!;
}

/**
 * Whether two entities may be name variants of one thing (Ривка / Рива): any of their
 * names or aliases is equal after normalisation, or within one edit for names of at least
 * four letters sharing the first letter. Only a signal: entities are never merged.
 */
export function nameVariants(a: Pick<EntityRef, 'name' | 'aliases'>, b: typeof a): boolean {
	const namesOf = (e: typeof a) => [e.name, ...e.aliases].map(normalizeName).filter(Boolean);
	const right = namesOf(b);
	return namesOf(a).some((x) =>
		right.some(
			(y) =>
				x === y ||
				(x.length >= 4 && y.length >= 4 && x[0] === y[0] && boundedLevenshtein(x, y, 1) <= 1)
		)
	);
}
