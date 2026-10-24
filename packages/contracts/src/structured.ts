import { z } from 'zod';

import { type ArtifactKind, EpistemicStatus, type ProjectDomain } from './enums.ts';
import { TlonError } from './errors.ts';

/** Upper bound on serialized `structured` payload size (bytes of JSON). */
export const MAX_STRUCTURED_BYTES = 64 * 1024;

const shortText = z.string().max(2000);
const textList = z.array(z.string().min(1).max(2000)).max(200);

/** §3.5 narrative plugin fields; unknown keys are preserved (domain packs may extend). */
export const NarrativeStructured = z.looseObject({
	subject: shortText.optional(),
	predicate: shortText.optional(),
	object: shortText.optional(),
	worldTime: shortText.optional(),
	location: shortText.optional(),
	perspective: shortText.optional(),
	speaker: shortText.optional(),
	epistemicStatus: EpistemicStatus.optional(),
	characters: textList.optional(),
	prerequisites: textList.optional(),
	effects: textList.optional(),
	assumptions: textList.optional(),
	dramaticFunction: shortText.optional()
});
export type NarrativeStructured = z.infer<typeof NarrativeStructured>;

/**
 * §4 invariant: every proposed C states its mechanism, explicit assumptions and how
 * each anchor remains true. Enforced for every expansion candidate regardless of kind.
 */
export const BridgeStructured = z.looseObject({
	mechanism: z.string().trim().min(1).max(4000),
	assumptions: textList,
	anchorReconciliation: z.object({
		left: z.string().trim().min(1).max(4000),
		right: z.string().trim().min(1).max(4000)
	})
});
export type BridgeStructured = z.infer<typeof BridgeStructured>;

export const StructuredRecord = z.record(z.string(), z.unknown());
export type StructuredRecord = z.infer<typeof StructuredRecord>;

/**
 * Validates `structured` for an artifact of `kind` in a project of `domain`.
 * BRIDGE artifacts always carry the bridge shape; narrative projects validate the
 * narrative plugin fields on every kind. Returns the parsed (normalised) record.
 */
export function parseStructured(
	domain: ProjectDomain,
	kind: ArtifactKind,
	structured: unknown
): StructuredRecord {
	const record = StructuredRecord.parse(structured ?? {});
	if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_STRUCTURED_BYTES) {
		throw new TlonError(
			'VALIDATION_FAILED',
			`structured payload exceeds ${MAX_STRUCTURED_BYTES} bytes`
		);
	}
	let parsed: StructuredRecord = record;
	if (kind === 'BRIDGE') parsed = BridgeStructured.parse(parsed);
	if (domain === 'NARRATIVE') parsed = NarrativeStructured.parse(parsed);
	return parsed;
}
