import type { Artifact, BridgeStructured } from '@tlon/contracts';

export type BridgeSuggestion = {
	kind: 'BRIDGE';
	title: string;
	body: string;
	structured: BridgeStructured;
};

type Template = {
	id: string;
	title: (l: string, r: string) => string;
	mechanism: string;
	assumptions: string[];
	left: (l: string) => string;
	right: (r: string) => string;
};

/** Reconciliation strategies from §0: perspective, time, identity, scope, unreliable narration. */
const TEMPLATES: readonly Template[] = [
	{
		id: 'identity',
		title: (l, r) => `Two referents behind “${l}” and “${r}”`,
		mechanism:
			'Identity split: the anchors describe different entities that share one identity or name.',
		assumptions: [
			'A second entity shares the identity in question',
			'The overlap is not publicly known'
		],
		left: (l) => `“${l}” is true of the original referent.`,
		right: (r) => `“${r}” is true of the second referent carrying the same identity.`
	},
	{
		id: 'time',
		title: (l, r) => `A change between “${l}” and “${r}”`,
		mechanism: 'Temporal shift: both anchors held, at different points in world time.',
		assumptions: ['An event between the two moments changed the situation'],
		left: (l) => `“${l}” held before the change.`,
		right: (r) => `“${r}” holds after the change.`
	},
	{
		id: 'perspective',
		title: (l, r) => `Whose account: “${l}” vs “${r}”`,
		mechanism: 'Perspective: each anchor is reported by a different, partially informed source.',
		assumptions: ['At least one source is mistaken, biased or deliberately misleading'],
		left: (l) => `“${l}” is accurate from its source's vantage point.`,
		right: (r) => `“${r}” is what its source sincerely records.`
	},
	{
		id: 'scope',
		title: (l, r) => `Different meanings in “${l}” and “${r}”`,
		mechanism: 'Scope: a key term means different things in each anchor’s context.',
		assumptions: ['The two contexts define the key term differently'],
		left: (l) => `“${l}” is true under the first definition.`,
		right: (r) => `“${r}” is true under the second definition.`
	}
];

/** FNV-1a 32-bit: tiny, deterministic, dependency-free hash for template selection. */
function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Deterministic placeholder for an LLM C-agent (§5 step 4): the same anchors and
 * relation type always yield the same suggestion. `variant` cycles strategies.
 * Output is a draft the human edits; it is never auto-accepted.
 */
export function suggestBridge(
	left: Pick<Artifact, 'id' | 'title'>,
	right: Pick<Artifact, 'id' | 'title'>,
	relationType: string,
	variant = 0
): BridgeSuggestion {
	const base = relationType === 'contradicts' ? 0 : fnv1a(`${left.id}|${right.id}|${relationType}`);
	const template = TEMPLATES[(base + variant) % TEMPLATES.length] as Template;
	const l = left.title.trim();
	const r = right.title.trim();
	return {
		kind: 'BRIDGE',
		title: template.title(l, r),
		body: `${template.mechanism}\n\nBridges “${l}” → “${r}” (${relationType}).`,
		structured: {
			mechanism: template.mechanism,
			assumptions: [...template.assumptions],
			anchorReconciliation: { left: template.left(l), right: template.right(r) },
			suggestion: { strategy: template.id, deterministic: true }
		}
	};
}

export const BRIDGE_STRATEGY_COUNT = TEMPLATES.length;
