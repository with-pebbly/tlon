import type {
	Direction,
	FactKind,
	Role,
	Task,
	TaskState,
	TaskType,
	TriangleStatus
} from '@tlon/contracts';

/** sessionStorage key holding the participant link token while `/p` is open. */
export const PARTICIPANT_TOKEN_KEY = 'tlon:participant';

/** Text glyph per Fact kind (always paired with the kind name for screen readers). */
export const FACT_KIND_ICON: Record<FactKind, string> = {
	object: '◆',
	person: '●',
	place: '▲',
	rule: '§',
	signal: '≈',
	trace: '∴',
	document: '¶',
	need: '◇',
	constraint: '⊘',
	belief: '?',
	damage: '✕',
	resource: '⊕',
	relationship: '⇄',
	other: '·'
};

export const FACT_KIND_HINT: Record<FactKind, string> = {
	object: 'a thing that exists in the world',
	person: 'someone who is present or known',
	place: 'a location both sides could touch',
	rule: 'a law, custom or regulation in force',
	signal: 'a sound, message or sign',
	trace: 'a mark left behind',
	document: 'a letter, record or text',
	need: 'something someone lacks',
	constraint: 'a limit that applies',
	belief: 'something someone holds true',
	damage: 'something broken or lost',
	resource: 'something available to use',
	relationship: 'a tie between people',
	other: 'any other circumstance'
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
	seed_block: 'Write the opening block',
	propose_fact: 'Propose a connecting Fact',
	advance_block: 'Continue your block',
	review_triangle: 'Review a triangle',
	compose_subgraph: 'Compose a subgraph'
};

/** Facilitator-facing short names (task board). */
export const TASK_TYPE_SHORT: Record<TaskType, string> = {
	seed_block: 'seed',
	propose_fact: 'propose fact',
	advance_block: 'advance',
	review_triangle: 'review',
	compose_subgraph: 'compose'
};

export const TASK_STATE_CLASS: Record<TaskState, string> = {
	pending: 'border-amber-300 bg-amber-50 text-amber-800',
	submitted: 'border-emerald-300 bg-emerald-50 text-emerald-800',
	approved: 'border-emerald-400 bg-emerald-100 text-emerald-900',
	rejected: 'border-zinc-300 bg-zinc-100 text-zinc-500',
	cancelled: 'border-zinc-300 bg-zinc-100 text-zinc-500'
};

export const PARTICIPANT_ROLE_TEXT: Record<Role, string> = {
	HUMAN: 'Facilitator',
	A: 'Participant A',
	B: 'Participant B',
	C: 'Participant C (mediator)',
	VALIDATOR: 'Validator'
};

/** Plain-language direction of an advance task, as the writer sees it. */
export const DIRECTION_TEXT: Record<Direction, { title: string; detail: string }> = {
	forward: {
		title: 'What happens next',
		detail: 'Write what happens after your block.'
	},
	backward: {
		title: 'What happened before',
		detail: 'Write what happened before your block, leading up to it.'
	},
	atemporal: {
		title: 'Alongside',
		detail: 'Write something that holds alongside your block, not before or after it.'
	}
};

export const TRIANGLE_STATUS_CLASS: Record<TriangleStatus, string> = {
	proposed: 'border-dashed border-amber-400 bg-amber-50 text-amber-800',
	expanding: 'border-sky-300 bg-sky-50 text-sky-800',
	converged: 'border-emerald-300 bg-emerald-50 text-emerald-800',
	validated: 'border-emerald-500 bg-emerald-100 text-emerald-900',
	rejected: 'border-zinc-300 bg-zinc-100 text-zinc-500 line-through',
	superseded: 'border-zinc-300 bg-zinc-100 text-zinc-500'
};

/** Facts are short; canvases show at most this many characters before an ellipsis. */
export function shortFact(text: string, max = 48): string {
	const chars = [...text];
	return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** Tasks that still need work first, then the rest in creation order. */
export function inboxOrder(tasks: readonly Task[]): Task[] {
	const open = (t: Task) => (t.state === 'pending' ? 0 : 1);
	return tasks.toSorted(
		(a, b) =>
			open(a) - open(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
	);
}
