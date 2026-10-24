/**
 * Block–Fact collaboration protocol (docs/BLOCK_FACT_ARCHITECTURE_PART_1/2.md).
 *
 * Participant-neutral: humans, AI and scripted executors claim the same tasks, see the
 * same server-assembled task views and submit the same payloads. Nothing here depends
 * on a model, prompt or provider.
 */
import { z } from 'zod';

import { ArtifactKind, FactKind, OwnerScope } from './enums.ts';
import { AgentRole, ExecutorKind } from './gateway.ts';
import { Uuid } from './models.ts';

const IsoDate = z.iso.datetime({ offset: true });

// ── Fact policy (§4.1) ──────────────────────────────────────────────────────

/** Hard cap on shareable Fact text (characters, language-agnostic). */
export const FACT_MAX_CHARS = 160;
/** Advisory preferred word range for space-delimited languages. */
export const FACT_PREFERRED_WORDS = { min: 3, max: 12 } as const;

export type FactLint = {
	/** Submit-time blockers: over the hard cap, empty, several sentences. */
	errors: string[];
	/** Advisory: length outside preferred range, reads like a plot instruction. */
	warnings: string[];
};

/**
 * Words that usually turn a circumstance into an instruction or an outline
 * (“must”, “then”, “convinces”…). Advisory only: a Fact may legitimately be a rule.
 */
const DIRECTIVE_MARKERS = [
	/\bmust\b/i,
	/\bshould\b/i,
	/\bwill\b/i,
	/\bthen\b/i,
	/\bfinally\b/i,
	/\bin order to\b/i,
	/\bconvinc/i,
	/\bdecides?\b/i,
	/\bdiscovers?\b/i,
	/\bдолж/i,
	/\bзатем\b/i,
	/\bпотом\b/i,
	/\bв итоге\b/i,
	/\bчтобы\b/i
];

/**
 * Language-aware-enough Fact lint (§4.1): character hard cap, single statement,
 * advisory word range and directive markers. Used by the API at submit time and by
 * editors while drafting.
 */
export function lintFactText(raw: string): FactLint {
	const text = raw.trim();
	const errors: string[] = [];
	const warnings: string[] = [];
	if (text.length === 0) errors.push('A Fact needs text.');
	if ([...text].length > FACT_MAX_CHARS) {
		errors.push(`A Fact is at most ${FACT_MAX_CHARS} characters (now ${[...text].length}).`);
	}
	// More than one sentence terminator followed by more text → an outline, not a circumstance.
	if (/[.!?…]\s+\S/.test(text))
		errors.push('One short statement only — this reads as several sentences.');
	const words = text.split(/\s+/).filter(Boolean).length;
	if (/\s/.test(text) && (words < FACT_PREFERRED_WORDS.min || words > FACT_PREFERRED_WORDS.max)) {
		warnings.push(
			`Prefer ${FACT_PREFERRED_WORDS.min}–${FACT_PREFERRED_WORDS.max} words (now ${words}).`
		);
	}
	if (DIRECTIVE_MARKERS.some((re) => re.test(text))) {
		warnings.push(
			'This reads like a plot instruction; make it an open circumstance (an object, trace, rule, need…).'
		);
	}
	return { errors, warnings };
}

export const FactText = z
	.string()
	.trim()
	.superRefine((value, ctx) => {
		for (const message of lintFactText(value).errors) ctx.addIssue({ code: 'custom', message });
	});

export const FactCandidateInput = z.object({
	kind: FactKind,
	text: FactText,
	/** Mediator-private justification; never part of the Fact or any disclosure (§2.1). */
	rationale: z.string().trim().max(2000).optional()
});
export type FactCandidateInput = z.input<typeof FactCandidateInput>;

// ── Triangle / FactAnchor (§2.3–2.4) ────────────────────────────────────────

export const RevisionRef = z.object({ artifactId: Uuid, revisionId: Uuid });
export type RevisionRef = z.infer<typeof RevisionRef>;

export const TRIANGLE_STATUSES = [
	'proposed',
	'expanding',
	'converged',
	'validated',
	'rejected',
	'superseded'
] as const;
export const TriangleStatus = z.enum(TRIANGLE_STATUSES);
export type TriangleStatus = z.infer<typeof TriangleStatus>;

/** Non-destructive Block-like projection of a Fact, persisted when used as an anchor. */
export const FactAnchor = z.object({
	id: Uuid,
	projectId: Uuid,
	fact: RevisionRef,
	createdAt: IsoDate
});
export type FactAnchor = z.infer<typeof FactAnchor>;

/** Endpoint of a Triangle: a Block revision, or a Fact used through a FactAnchor. */
export const AnchorRef = RevisionRef.extend({ factAnchorId: Uuid.nullable() });
export type AnchorRef = z.infer<typeof AnchorRef>;

export const TriangleContinuation = z.object({
	side: z.enum(['left', 'right']),
	block: RevisionRef,
	taskId: Uuid.nullable()
});

/**
 * Two anchors + one Fact (a hyperedge, not a chronological midpoint). The Fact is null
 * while C's proposal is still under review. Readable by HUMAN/C/VALIDATOR only: a
 * Triangle names both endpoints.
 */
export const Triangle = z.object({
	id: Uuid,
	projectId: Uuid,
	runId: Uuid.nullable(),
	left: AnchorRef,
	right: AnchorRef,
	fact: RevisionRef.nullable(),
	status: TriangleStatus,
	/** Generation wave of the Fact (first C Fact = 2). Not story time, not depth. */
	stageIndex: z.int().min(1),
	/** Expansion hierarchy: 1 for a root gap, parent + 1 for a child gap. */
	depth: z.int().min(1),
	parentTriangleId: Uuid.nullable(),
	continuations: z.array(TriangleContinuation),
	createdAt: IsoDate,
	updatedAt: IsoDate
});
export type Triangle = z.infer<typeof Triangle>;

export const FactCandidate = z.object({
	id: Uuid,
	triangleId: Uuid,
	/** The candidate is itself a PROPOSED Fact artifact in C scope. */
	fact: RevisionRef,
	kind: FactKind,
	text: z.string(),
	status: z.enum(['proposed', 'accepted', 'rejected']),
	lint: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }),
	createdAt: IsoDate
});
export type FactCandidate = z.infer<typeof FactCandidate>;

// ── Runs, tasks, views, submissions (§3.3, §19.4) ───────────────────────────

export const TASK_TYPES = [
	'seed_block',
	'propose_fact',
	'advance_block',
	'review_triangle',
	'compose_subgraph'
] as const;
export const TaskType = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskType>;

export const TASK_STATES = ['pending', 'submitted', 'approved', 'rejected', 'cancelled'] as const;
export const TaskState = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskState>;

export const Direction = z.enum(['forward', 'backward', 'atemporal']);
export type Direction = z.infer<typeof Direction>;

/** Who accepts C's Fact candidates: the facilitator (default, §16.1) or C itself. */
export const FactReviewPolicy = z.enum(['facilitator', 'mediator']);

export const RunConfig = z.object({
	participantMode: z.enum(['human_only', 'ai_only', 'mixed']).default('human_only'),
	factReview: FactReviewPolicy.default('facilitator'),
	maxDepth: z.int().min(1).max(10).default(3),
	maxCandidates: z.int().min(1).max(5).default(3),
	/** Automatically open the next task when its inputs are ready (§3.3). */
	autoSchedule: z.boolean().default(true)
});
export type RunConfig = z.infer<typeof RunConfig>;

/** Facilitator-only view of a run; briefs are private to their side (never cross-disclosed). */
export const Run = z.object({
	id: Uuid,
	projectId: Uuid,
	config: RunConfig,
	status: z.enum(['active', 'completed', 'cancelled']),
	briefs: z.object({ A: z.string(), B: z.string() }),
	createdAt: IsoDate,
	updatedAt: IsoDate
});
export type Run = z.infer<typeof Run>;

export const StartRunInput = z.object({
	/** Side-local premise for A's seed (only A's task view contains it). */
	briefA: z.string().trim().min(1).max(4000),
	/** Side-local premise for B's seed (only B's task view contains it). */
	briefB: z.string().trim().min(1).max(4000),
	config: RunConfig.partial().optional()
});
export type StartRunInput = z.input<typeof StartRunInput>;

export const Task = z.object({
	id: Uuid,
	projectId: Uuid,
	runId: Uuid.nullable(),
	type: TaskType,
	role: AgentRole,
	/** Specific participant, or null: any participant holding `role` may claim it. */
	assigneePrincipalId: Uuid.nullable(),
	state: TaskState,
	stageIndex: z.int().min(1),
	depth: z.int().min(0),
	triangleId: Uuid.nullable(),
	side: z.enum(['left', 'right']).nullable(),
	direction: Direction.nullable(),
	/** Artifacts this task produced (Blocks, Fact candidates). */
	resultRefs: z.array(RevisionRef),
	createdAt: IsoDate,
	submittedAt: IsoDate.nullable()
});
export type Task = z.infer<typeof Task>;

export const TaskList = z.object({ items: z.array(Task) });
export type TaskList = z.infer<typeof TaskList>;

/** A Block as a task executor may see it (server projection, no foreign ids). */
export const BlockView = z.object({
	id: Uuid,
	revisionId: Uuid,
	kind: ArtifactKind,
	title: z.string(),
	body: z.string(),
	ownerScope: OwnerScope
});
export type BlockView = z.infer<typeof BlockView>;

/** Exactly the disclosed Fact projection (§6.3): id, revision, kind, text. */
export const FactView = z.object({
	id: Uuid,
	revisionId: Uuid,
	kind: FactKind,
	text: z.string()
});
export type FactView = z.infer<typeof FactView>;

/**
 * Server-assembled view of one task for its executor (§19.4 AuthorizedTaskView). A/B
 * views contain only their own Blocks and the disclosed Fact — never the opposite
 * Block, the Triangle, its stage position or a global goal.
 */
export const TaskView = z.discriminatedUnion('type', [
	z.object({ type: z.literal('seed_block'), task: Task, brief: z.string() }),
	z.object({
		type: z.literal('propose_fact'),
		task: Task,
		left: BlockView,
		right: BlockView,
		/** Facts already used between these anchors (avoid repeating). */
		existingFacts: z.array(FactView),
		policy: z.object({
			maxChars: z.int(),
			preferredWords: z.object({ min: z.int(), max: z.int() }),
			maxCandidates: z.int()
		})
	}),
	z.object({
		type: z.literal('advance_block'),
		task: Task,
		ownBlock: BlockView,
		/** Own-scope chain leading to `ownBlock` (local context only). */
		localContext: z.array(BlockView),
		fact: FactView,
		direction: Direction
	})
]);
export type TaskView = z.infer<typeof TaskView>;

export const BlockDraft = z.object({
	kind: ArtifactKind.default('EVENT'),
	title: z.string().trim().min(1).max(300),
	body: z.string().trim().min(1).max(20_000)
});
export type BlockDraft = z.input<typeof BlockDraft>;

export const TaskSubmission = z.discriminatedUnion('type', [
	z.object({ type: z.literal('seed_block'), block: BlockDraft }),
	z.object({
		type: z.literal('propose_fact'),
		candidates: z.array(FactCandidateInput).min(1).max(5)
	}),
	z.object({ type: z.literal('advance_block'), block: BlockDraft })
]);
export type TaskSubmission = z.input<typeof TaskSubmission>;

export const SubmitTaskInput = z.object({
	submission: TaskSubmission,
	/** Retries with the same key return the first result (§5.2 idempotency). */
	idempotencyKey: z.string().trim().min(8).max(200)
});
export type SubmitTaskInput = z.input<typeof SubmitTaskInput>;

export const SubmitTaskResult = z.object({
	task: Task,
	/** Advisory lint per submitted Fact candidate (errors already rejected). */
	warnings: z.array(z.string()),
	replayed: z.boolean()
});
export type SubmitTaskResult = z.infer<typeof SubmitTaskResult>;

/** `connect(B1, B2)`: open a gap → a propose_fact task for C. */
export const ConnectInput = z.object({
	left: z.object({ artifactId: Uuid, viaFact: z.boolean().default(false) }),
	right: z.object({ artifactId: Uuid, viaFact: z.boolean().default(false) }),
	parentTriangleId: Uuid.optional(),
	runId: Uuid.optional(),
	/** Who writes continuations of each side (default: the left anchor's scope → A, right → B). */
	advance: z
		.object({ left: Direction.default('forward'), right: Direction.default('backward') })
		.default({ left: 'forward', right: 'backward' })
});
export type ConnectInput = z.input<typeof ConnectInput>;

export const AcceptFactInput = z.object({ candidateId: Uuid });

export const ParticipantLink = z.object({
	principalId: Uuid,
	role: AgentRole,
	name: z.string(),
	executorKind: ExecutorKind,
	token: z.string(),
	expiresAt: IsoDate
});
export type ParticipantLink = z.infer<typeof ParticipantLink>;

export const TriangleDetail = z.object({
	triangle: Triangle,
	candidates: z.array(FactCandidate),
	tasks: z.array(Task)
});
export type TriangleDetail = z.infer<typeof TriangleDetail>;

export const ProtocolState = z.object({
	runs: z.array(Run),
	triangles: z.array(Triangle),
	tasks: z.array(Task),
	factAnchors: z.array(FactAnchor)
});
export type ProtocolState = z.infer<typeof ProtocolState>;
