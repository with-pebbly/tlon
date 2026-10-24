import type {
	Assertion,
	BeatTime,
	IssueKind,
	IssueList,
	ProjectGraph,
	Provenance,
	Transition,
	ValidationIssue
} from '@tlon/contracts';
import { storyBeats } from '@tlon/core';

/**
 * How an issue reads in the UI. Blockers are errors (red); warnings ask for a look
 * (amber); a probable missing transition is a "gap" (sky, dotted) — something is
 * unnarrated, not contradicted; tensions and perspective conflicts are creative input
 * and keep the tension style (never red); everything else is muted information.
 */
export type IssueTone = 'blocker' | 'warning' | 'gap' | 'creative' | 'info';

export function issueTone(issue: Pick<ValidationIssue, 'kind' | 'severity'>): IssueTone {
	// Same-named entities are kept distinct; the flag only informs the reader.
	if (issue.kind === 'ambiguous_entity') return 'info';
	if (issue.severity === 'blocker') return 'blocker';
	if (issue.kind === 'tension' || issue.kind === 'perspective_conflict') return 'creative';
	if (issue.kind === 'missing_transition' && issue.severity === 'warning') return 'gap';
	if (issue.kind === 'direction_mismatch') return 'warning';
	return issue.severity === 'warning' ? 'warning' : 'info';
}

/** Higher wins when one node or edge takes part in several issues. */
export const TONE_RANK: Record<IssueTone, number> = {
	blocker: 4,
	warning: 3,
	gap: 2,
	creative: 1,
	info: 0
};

export const TONE_CARD: Record<IssueTone, string> = {
	blocker: 'border-rose-300 bg-rose-50/60',
	warning: 'border-amber-400 bg-amber-50/70',
	gap: 'border-dashed border-sky-400 bg-sky-50/60',
	creative: 'border-amber-200 bg-amber-50/50',
	info: 'border-zinc-200 bg-zinc-50'
};

export const TONE_TEXT: Record<IssueTone, string> = {
	blocker: 'text-rose-700',
	warning: 'text-amber-800',
	gap: 'text-sky-800',
	creative: 'text-amber-800',
	info: 'text-zinc-500'
};

export const TONE_GLYPH: Record<IssueTone, string> = {
	blocker: '●',
	warning: '▲',
	gap: '⋯',
	creative: '◆',
	info: '○'
};

/** Tooltip / legend wording of the canvas overlay per tone. */
export const ISSUE_TONE_TITLE: Record<IssueTone, string> = {
	blocker: 'continuity blocker',
	warning: 'continuity warning',
	gap: 'gap — a transition is probably missing',
	creative: 'tension / perspective conflict (creative input)',
	info: 'continuity note'
};

/**
 * Canvas mark for a node taking part in issues of the given tone (info draws nothing).
 * `outline` is for stacked composite cards, whose box-shadow a ring cannot share; an
 * outline mark yields to the selection outline.
 */
export function toneRing(
	tone: IssueTone | null,
	selected: boolean,
	outline = false
): string | false {
	if (tone === null || tone === 'info') return false;
	if (tone === 'gap')
		return selected ? false : 'outline-2 outline-offset-2 outline-dotted outline-sky-500';
	if (tone === 'creative' || outline) {
		if (selected) return false;
		const color = tone === 'blocker' ? 'outline-rose-500' : 'outline-amber-500';
		return tone === 'creative'
			? `outline-1 outline-offset-2 outline-dashed ${color}`
			: `outline-2 outline-offset-4 ${color}`;
	}
	return tone === 'blocker'
		? 'ring-2 ring-rose-500 ring-offset-1'
		: 'ring-2 ring-amber-500 ring-offset-1';
}

/** Panel group order: blockers first, gaps and creative input after warnings, info last. */
export const ISSUE_KIND_ORDER: readonly IssueKind[] = [
	'continuity_violation',
	'anchor_violation',
	'temporal_order',
	'direction_mismatch',
	'duplicate_event',
	'monotonic_violation',
	'abandoned_preparation',
	'stale_annotation',
	'missing_transition',
	'tension',
	'perspective_conflict',
	'redundancy',
	'ambiguous_entity',
	'unknown'
];

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = {
	continuity_violation: 'Continuity violation',
	anchor_violation: 'Anchor violation',
	tension: 'Tension',
	perspective_conflict: 'Perspective conflict',
	redundancy: 'Redundant beat',
	abandoned_preparation: 'Abandoned preparation',
	stale_annotation: 'Stale annotation',
	temporal_order: 'Out of time order',
	duplicate_event: 'Duplicate event',
	monotonic_violation: 'One-way quantity reversed',
	missing_transition: 'Gap — missing transition',
	direction_mismatch: 'Time runs against the continuation direction',
	ambiguous_entity: 'Same name, distinct entities',
	unknown: 'Other'
};

export const SUGGESTED_ACTION_LABEL: Record<
	NonNullable<ValidationIssue['suggestedAction']>,
	string
> = {
	revise_bridge: 'revise the bridge',
	request_c_resolution: 'ask C to reconcile',
	mark_intentional: 'mark as intentional',
	keep_as_is: 'keep as is',
	stop_expansion: 'stop expanding here — the interval may have enough detail'
};

export const RESOLUTION_LABEL: Record<
	NonNullable<ValidationIssue['dismissal']>['resolution'],
	string
> = {
	dismissed: 'Dismissed',
	perspective_dependent: 'Perspective-dependent',
	intentional: 'Intentional'
};

export const PROVENANCE_LABEL: Record<Provenance, string> = {
	canonical_anchor: 'canonical anchor',
	committed_generated: 'committed bridge',
	proposal: 'proposal'
};

export const PROVENANCE_CHIP: Record<Provenance, string> = {
	canonical_anchor: 'border-zinc-300 bg-white text-zinc-700',
	committed_generated: 'border-accent-200 bg-accent-50 text-accent-700',
	proposal: 'border-dashed border-accent-500 bg-accent-50/60 text-accent-700'
};

export const stateKeyOf = (a: Pick<Assertion, 'subject' | 'predicate'>) =>
	`${a.subject}.${a.predicate}`;

export const EMPTY_TRANSITION: Transition = {
	preconditions: [],
	effects: [],
	assumptions: [],
	events: [],
	repeatableEvents: [],
	entities: [],
	functions: []
};

/** Badge of a one-way numeric quantity: ↓ may only fall, ↑ may only rise. */
export const MONOTONIC_BADGE: Record<
	NonNullable<Assertion['monotonic']>,
	{ glyph: string; title: string }
> = {
	decreasing: { glyph: '↓', title: 'strictly decreasing — may not stay equal while time passes' },
	non_increasing: { glyph: '↓=', title: 'non-increasing — may fall or stay, never rise' },
	increasing: { glyph: '↑', title: 'strictly increasing — may not stay equal while time passes' },
	non_decreasing: { glyph: '↑=', title: 'non-decreasing — may rise or stay, never fall' }
};

/** `hh:mm` of minutes after midnight. */
export const clockOf = (minute: number) =>
	`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * "1958 · Day N hh:mm ±t · relative" of a beat time, story day 0 shown as Day 1; null
 * when the text gives no year, day, clock time or relative statement. A flashback is
 * marked with ↶. A relative statement is shown verbatim — its absolute date stays unknown.
 */
export function formatBeatTime(time: BeatTime | undefined): string | null {
	if (
		!time ||
		(time.year === undefined &&
			time.day === undefined &&
			time.minute === undefined &&
			!time.relative)
	)
		return null;
	const parts: string[] = [];
	if (time.outOfOrder) parts.push('↶');
	if (time.year !== undefined) parts.push(String(time.year));
	if (time.day !== undefined) parts.push(`Day ${time.day + 1}`);
	if (time.minute !== undefined) parts.push(clockOf(time.minute));
	if (time.approx) parts.push(time.toleranceMinutes > 0 ? `±${time.toleranceMinutes}m` : '≈');
	if (time.relative) parts.push(`“${time.relative}”`);
	return parts.join(' ');
}

/** `event:<id>` issue keys name a story event, not a state key. */
export const eventOfStateKey = (stateKey: string | null | undefined) =>
	stateKey?.startsWith('event:') ? stateKey.slice('event:'.length) : null;

/** Unordered pair key for issue edges. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Provenance as `validateContinuity` derives it: the beat under review is a proposal,
 * accepted bridges are committed generated text, everything else is a canonical anchor.
 */
export function provenanceOf(
	artifactId: string,
	acceptedBridgeIds: ReadonlySet<string>,
	proposalIds: ReadonlySet<string>
): Provenance {
	if (proposalIds.has(artifactId)) return 'proposal';
	return acceptedBridgeIds.has(artifactId) ? 'committed_generated' : 'canonical_anchor';
}

export type WorldEntry = {
	value: Assertion['value'];
	/** Beat whose effect last set this key. */
	artifactId: string;
	irreversible: boolean;
	note: string | undefined;
};

export type HeldView = {
	key: string;
	value: Assertion['value'];
	holder: string;
	epistemic: Assertion['epistemic'];
	artifactId: string;
};

export type ReplayedState = {
	/** World state entering the beat, keyed by `subject.predicate`. */
	world: Map<string, WorldEntry>;
	/** Beliefs, rumours and hypotheses stated earlier (never part of the world). */
	held: HeldView[];
	/** Earlier beats without an annotation: the replay is blind there. */
	blind: string[];
};

/**
 * World state entering `path[index]`, replayed like `validateContinuity`: only world
 * effects of earlier beats set state; preconditions never do.
 */
export function replayBefore(
	path: readonly string[],
	index: number,
	transitionOf: (artifactId: string) => Transition | undefined
): ReplayedState {
	const world = new Map<string, WorldEntry>();
	const held: HeldView[] = [];
	const blind: string[] = [];
	for (const artifactId of path.slice(0, Math.max(0, index))) {
		const t = transitionOf(artifactId);
		if (!t) {
			blind.push(artifactId);
			continue;
		}
		for (const effect of t.effects) {
			const key = stateKeyOf(effect);
			if (effect.epistemic === 'world') {
				world.set(key, {
					value: effect.value,
					artifactId,
					irreversible: effect.irreversible,
					note: effect.note
				});
			} else {
				held.push({
					key,
					value: effect.value,
					holder: effect.holder ?? '(unspecified)',
					epistemic: effect.epistemic,
					artifactId
				});
			}
		}
	}
	return { world, held, blind };
}

const TONE_HEADING: Record<IssueTone, string> = {
	blocker: 'Blockers',
	warning: 'Warnings',
	gap: 'Gaps (a transition is probably missing)',
	creative: 'Tensions and perspective conflicts (creative input)',
	info: 'Notes'
};
const TONE_ORDER: readonly IssueTone[] = ['blocker', 'warning', 'gap', 'creative', 'info'];

/**
 * "Issues report" for script editors: every non-dismissed issue with the beat numbers of
 * `storyBeats` (same numbering as the story export), grouped by tone, plus the beats
 * validation could not check. Pass the graph the server validates (no composites).
 */
export function renderIssuesMarkdown(
	graph: Pick<ProjectGraph, 'project' | 'artifacts' | 'relations' | 'expansions'>,
	list: IssueList
): string {
	const beats = storyBeats(graph);
	const number = new Map(beats.map((b) => [b.artifact.id, b.index]));
	const titles = new Map(graph.artifacts.map((a) => [a.id, a.title]));
	const at = (id: string) => number.get(id) ?? Number.MAX_SAFE_INTEGER;
	const beatRef = (id: string) => {
		const n = number.get(id);
		return n === undefined ? '(off path)' : `#${n}`;
	};
	const open = list.items.filter((i) => i.dismissal === null);
	const count = (tone: IssueTone) => open.filter((i) => issueTone(i) === tone).length;
	const lines = [
		`# ${graph.project.name} — continuity issues`,
		'',
		`_${open.length} open: ${count('blocker')} blockers, ${count('warning')} warnings, ${count('gap')} gaps, ${count('creative')} tensions / perspective conflicts, ${count('info')} notes. ${list.items.length - open.length} dismissed issues are not listed. ${list.unannotatedArtifactIds.length} of ${beats.length} beats have no state annotation._`,
		''
	];
	for (const tone of TONE_ORDER) {
		const items = open
			.filter((i) => issueTone(i) === tone)
			.map((issue) => ({ issue, ids: issue.artifactIds.toSorted((a, b) => at(a) - at(b)) }))
			.toSorted(
				(a, b) =>
					ISSUE_KIND_ORDER.indexOf(a.issue.kind) - ISSUE_KIND_ORDER.indexOf(b.issue.kind) ||
					at(a.ids[0] ?? '') - at(b.ids[0] ?? '')
			);
		if (items.length === 0) continue;
		lines.push(`## ${TONE_HEADING[tone]}`, '');
		for (const { issue, ids } of items) {
			const key = issue.stateKey ? ` · \`${issue.stateKey}\`` : '';
			lines.push(
				`- **${ISSUE_KIND_LABEL[issue.kind]}**${key} · beats ${ids.map(beatRef).join(', ')}`,
				`  ${issue.explanation}`
			);
			for (const id of ids) lines.push(`  - ${beatRef(id)} ${titles.get(id) ?? id}`);
			if (issue.suggestedAction) {
				lines.push(`  - _Suggested: ${SUGGESTED_ACTION_LABEL[issue.suggestedAction]}_`);
			}
		}
		lines.push('');
	}
	if (list.unannotatedArtifactIds.length > 0) {
		lines.push('## Beats without a state annotation', '');
		for (const id of list.unannotatedArtifactIds.toSorted((a, b) => at(a) - at(b))) {
			lines.push(`- ${beatRef(id)} ${titles.get(id) ?? id}`);
		}
		lines.push('');
	}
	return `${lines.join('\n').trimEnd()}\n`;
}
