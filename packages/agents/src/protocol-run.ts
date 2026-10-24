#!/usr/bin/env bun
/**
 * AI adapter for the Block–Fact protocol (ADR 0011/0012, BLOCK_FACT §22).
 *
 * The runner plays two parts, kept strictly apart:
 *   - facilitator (operator, tokenless localhost): creates the project, AI participants
 *     A/B/C and a run with two side-private briefs, and opens child gaps;
 *   - participants: for every task assigned to A, B or C it reads the server-assembled
 *     TaskView WITH THAT PARTICIPANT'S TOKEN and lets one isolated omp session submit
 *     through the same task API a human uses. The session's only tools are the submit
 *     calls; it never sees anything the TaskView does not contain.
 *
 * A only ever gets brief A, B only brief B; C sees both Blocks of a gap and publishes a
 * minimal Fact. Child gaps are opened between neighbouring Blocks on the story line,
 * shallowest first, until `--target` Blocks or `--max-depth`.
 *
 * Usage: bun packages/agents/src/protocol-run.ts --start "An old man plants a tree." \
 *          --end "The universe collapses." [--target 24] [--max-depth 3] [--title "..."]
 *          [--out ~/Desktop/story.md] [--review]
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
	AgentRegistry,
	type CustomTool,
	createAgentSession,
	discoverAuthStorage,
	ModelRegistry,
	SessionManager,
	Settings,
	z
} from '@oh-my-pi/pi-coding-agent';

import {
	ApiErrorBody,
	type AgentRole,
	ParticipantLink,
	Project,
	ProjectGraph,
	ProtocolState,
	Run,
	SubmitTaskResult,
	type Task,
	TaskList,
	TaskView,
	TriangleDetail
} from '../../contracts/src/index.ts';
import { renderStoryMarkdown, storyBeats } from '../../core/src/index.ts';
import { ADVANCE_PROMPT, MEDIATOR_PROMPT, SEED_PROMPT } from './protocol-prompts.ts';

const { values } = parseArgs({
	options: {
		start: { type: 'string' },
		end: { type: 'string' },
		title: { type: 'string' },
		target: { type: 'string', default: '24' },
		'max-depth': { type: 'string', default: '3' },
		out: { type: 'string' },
		review: { type: 'boolean', default: false },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
if (!values.start || !values.end) throw new Error('--start and --end are required');
const api = values.api ?? 'http://127.0.0.1:3001';
const target = Number(values.target);
const maxDepth = Number(values['max-depth']);
const title = values.title ?? `${values.start} … ${values.end}`;

class ApiError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

/** One HTTP call; `token` = participant identity, absent = facilitator (operator). */
async function call<T>(
	method: string,
	path: string,
	schema: { parse(v: unknown): T },
	body?: unknown,
	token?: string
): Promise<T> {
	const response = await fetch(`${api}/api${path}`, {
		method,
		headers: {
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const json: unknown = response.status === 204 ? null : await response.json();
	if (!response.ok) {
		const parsed = ApiErrorBody.safeParse(json);
		throw parsed.success
			? new ApiError(parsed.data.error.code, parsed.data.error.message)
			: new ApiError('INTERNAL', `HTTP ${response.status}`);
	}
	return schema.parse(json);
}

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

// ── setup (facilitator) ──────────────────────────────────────────────────────
const project = await call('POST', '/projects', Project, { name: title, domain: 'NARRATIVE' });
const P = `/projects/${project.id}`;
const links = Object.fromEntries(
	await Promise.all(
		(['A', 'B', 'C'] as const).map(async (role) => [
			role,
			await call('POST', `${P}/participants`, ParticipantLink, {
				role,
				name: `${role.toLowerCase()}-ai`,
				executorKind: 'ai',
				ttlSeconds: 6 * 3600
			})
		])
	)
) as Record<AgentRole & ('A' | 'B' | 'C'), ParticipantLink>;
const run = await call('POST', `${P}/runs`, Run, {
	briefA: values.start,
	briefB: values.end,
	config: {
		participantMode: 'ai_only',
		factReview: values.review ? 'facilitator' : 'mediator',
		maxDepth
	}
});
console.log(`project ${project.id}\n  ${api.replace(/:\d+$/, ':5173')}/projects/${project.id}`);

/** Every TaskView an executor received, kept to prove isolation afterwards. */
const deliveredViews: Record<'A' | 'B' | 'C', string[]> = { A: [], B: [], C: [] };
const errors: string[] = [];

// ── participant execution (isolated sessions) ───────────────────────────────
async function execute(role: 'A' | 'B' | 'C', task: Task): Promise<void> {
	const token = links[role].token;
	const view = await call('GET', `${P}/tasks/${task.id}/view`, TaskView, undefined, token);
	deliveredViews[role].push(JSON.stringify(view));
	const idempotencyKey = randomUUID();
	const text = (v: unknown) => ({
		content: [{ type: 'text' as const, text: JSON.stringify(v) }],
		details: undefined
	});

	const BlockParams = z.object({
		kind: z.enum(['EVENT', 'STATE', 'SCENE', 'BELIEF', 'GOAL']).optional(),
		title: z.string().min(1).max(300),
		body: z.string().min(1).max(8000)
	});
	const submitBlock: CustomTool = {
		name: 'submit_block',
		label: 'Submit Block',
		loadMode: 'essential',
		approval: 'write',
		description: 'Submit your Block for this task (once).',
		parameters: BlockParams,
		async execute(_id, params) {
			const p = BlockParams.parse(params);
			const result = await call(
				'POST',
				`${P}/tasks/${task.id}/submit`,
				SubmitTaskResult,
				{
					idempotencyKey,
					submission: {
						type: view.type,
						block: { kind: p.kind ?? 'EVENT', title: p.title, body: p.body }
					}
				},
				token
			);
			return text({ submitted: true, state: result.task.state });
		}
	};
	const FactsParams = z.object({
		candidates: z
			.array(
				z.object({
					kind: z.enum([
						'object',
						'person',
						'place',
						'rule',
						'signal',
						'trace',
						'document',
						'need',
						'constraint',
						'belief',
						'damage',
						'resource',
						'relationship',
						'other'
					]),
					text: z.string().min(1).max(400),
					rationale: z.string().max(2000).optional()
				})
			)
			.min(1)
			.max(5)
	});
	let proposedFactIds: string[] = [];
	const submitFacts: CustomTool = {
		name: 'submit_facts',
		label: 'Submit Fact candidates',
		loadMode: 'essential',
		approval: 'write',
		description:
			'Submit 1–5 candidate Facts. Returns their ids and lint warnings; a Fact longer than 4 words or with punctuation inside is rejected with an error.',
		parameters: FactsParams,
		async execute(_id, params) {
			const p = FactsParams.parse(params);
			const result = await call(
				'POST',
				`${P}/tasks/${task.id}/submit`,
				SubmitTaskResult,
				{
					idempotencyKey: randomUUID(),
					submission: { type: 'propose_fact', candidates: p.candidates }
				},
				token
			);
			proposedFactIds = result.task.resultRefs.map((r) => r.artifactId);
			return text({
				factIds: proposedFactIds,
				candidates: p.candidates.map((c, i) => ({ factId: proposedFactIds[i], text: c.text })),
				warnings: result.warnings
			});
		}
	};
	const AcceptParams = z.object({ factId: z.string() });
	const acceptFact: CustomTool = {
		name: 'accept_fact',
		label: 'Accept a Fact',
		loadMode: 'essential',
		approval: 'write',
		description:
			'Accept one of your submitted candidates by its factId (it is then disclosed to the writers).',
		parameters: AcceptParams,
		async execute(_id, params) {
			const { factId } = AcceptParams.parse(params);
			if (!task.triangleId) throw new Error('task has no triangle');
			const detail = await call(
				'GET',
				`${P}/triangles/${task.triangleId}`,
				TriangleDetail,
				undefined,
				token
			);
			const candidate = detail.candidates.find((c) => c.fact.artifactId === factId);
			if (!candidate) throw new Error('unknown factId; use an id returned by submit_facts');
			await call(
				'POST',
				`${P}/triangles/${task.triangleId}/accept-fact`,
				TriangleDetail,
				{ candidateId: candidate.id },
				token
			);
			return text({ accepted: factId });
		}
	};

	const [tools, system, prompt] =
		view.type === 'seed_block'
			? [[submitBlock], SEED_PROMPT, `Your brief: ${view.brief}`]
			: view.type === 'advance_block'
				? [
						[submitBlock],
						ADVANCE_PROMPT,
						JSON.stringify(
							{
								yourBlock: view.ownBlock,
								localContext: view.localContext,
								fact: view.fact,
								direction: view.direction
							},
							null,
							1
						)
					]
				: [
						values.review ? [submitFacts] : [submitFacts, acceptFact],
						MEDIATOR_PROMPT +
							(values.review
								? '\nThe facilitator chooses among your candidates; do not try to accept one.'
								: ''),
						JSON.stringify(
							{
								left: view.left,
								right: view.right,
								alreadyUsedFacts: view.existingFacts,
								policy: view.policy
							},
							null,
							1
						)
					];

	const { session } = await createAgentSession({
		cwd: mkdtempSync(join(tmpdir(), `tlon-${role}-`)),
		authStorage,
		modelRegistry,
		modelPattern: process.env.TLON_AGENT_MODEL,
		settings: Settings.isolated({ 'memory.backend': 'off', 'autolearn.enabled': false }),
		sessionManager: SessionManager.inMemory(),
		agentRegistry: new AgentRegistry(),
		bindProcessState: false,
		customTools: tools,
		allowRestrictedCustomTools: true,
		toolNames: tools.map((t) => t.name),
		restrictToolNames: true,
		enableMCP: false,
		enableLsp: false,
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		systemPrompt: [system]
	});
	session.subscribe((e) => {
		if (e.type === 'tool_execution_end' && e.isError) {
			const detail = JSON.stringify(e.result).slice(0, 240);
			errors.push(`[${role}] ${e.toolName}: ${detail}`);
			console.log(`  [${role}] ✗ ${e.toolName} ${detail}`);
		}
	});
	try {
		await session.prompt(prompt);
	} finally {
		await session.dispose();
	}
	console.log(`  [${role}] ${view.type} (stage ${task.stageIndex}) done`);
}

/** Runs every pending task of every participant, in parallel across roles. */
async function drain(): Promise<number> {
	let executed = 0;
	for (;;) {
		const batches = await Promise.all(
			(['A', 'B', 'C'] as const).map(async (role) => ({
				role,
				tasks: (
					await call('GET', `${P}/tasks/mine`, TaskList, undefined, links[role].token)
				).items.filter((t) => t.state === 'pending')
			}))
		);
		const work = batches.flatMap((b) => b.tasks.map((t) => ({ role: b.role, task: t })));
		if (work.length === 0) return executed;
		await Promise.all(
			work.map((w) =>
				execute(w.role, w.task).catch((err: unknown) => {
					errors.push(`[${w.role}] ${w.task.type}: ${String(err)}`);
				})
			)
		);
		executed += work.length;
		if (values.review) return executed;
	}
}

// ── scheduling (facilitator) ─────────────────────────────────────────────────
console.log('\n── stage 1–3: seeds, first Fact, continuations ──');
await drain();

for (let round = 1; ; round++) {
	const graph = await call('GET', `${P}/graph`, ProjectGraph);
	const protocol = await call('GET', `${P}/protocol`, ProtocolState);
	const beats = storyBeats({ ...graph, triangles: protocol.triangles });
	if (beats.length >= target || values.review) break;
	// Open a gap between every pair of neighbouring Blocks not yet joined by a triangle,
	// shallowest parents first; the parent is the triangle that produced the later Block.
	const producedBy = new Map<string, (typeof protocol.triangles)[number]>();
	for (const t of protocol.triangles)
		for (const c of t.continuations) producedBy.set(c.block.artifactId, t);
	const joined = new Set(
		protocol.triangles.map((t) => `${t.left.artifactId}|${t.right.artifactId}`)
	);
	const gaps = beats
		.slice(1)
		.map((b, i) => ({ left: beats[i]!.artifact, right: b.artifact }))
		.filter((g) => !joined.has(`${g.left.id}|${g.right.id}`))
		.map((g) => {
			const parent = producedBy.get(g.right.id) ?? producedBy.get(g.left.id) ?? null;
			return { ...g, parent, depth: (parent?.depth ?? 0) + 1 };
		})
		.filter((g) => g.depth <= maxDepth)
		.toSorted((a, b) => a.depth - b.depth);
	const budget = Math.ceil((target - beats.length) / 2);
	const chosen = gaps.slice(0, Math.max(1, budget));
	if (chosen.length === 0) {
		console.log(`\nno open gaps within max depth ${maxDepth}; stopping`);
		break;
	}
	console.log(`\n── round ${round}: ${beats.length} Blocks, opening ${chosen.length} gap(s) ──`);
	for (const g of chosen) {
		await call('POST', `${P}/connect`, TriangleDetail, {
			left: { artifactId: g.left.id },
			right: { artifactId: g.right.id },
			...(g.parent ? { parentTriangleId: g.parent.id } : {}),
			runId: run.id
		});
	}
	await drain();
}

// ── isolation evidence + export ─────────────────────────────────────────────
const graph = await call('GET', `${P}/graph`, ProjectGraph);
const protocol = await call('GET', `${P}/protocol`, ProtocolState);
const own = (scope: string) =>
	graph.artifacts.filter((a) => a.ownerScope === scope && a.artifactClass === 'BLOCK');
const failures: string[] = [];
const viewsA = deliveredViews.A.join('\n');
const viewsB = deliveredViews.B.join('\n');
if (viewsA.includes(values.end)) failures.push('a task view for A contained brief B');
if (viewsB.includes(values.start)) failures.push('a task view for B contained brief A');
for (const b of own('B_PRIVATE'))
	if (viewsA.includes(b.id) || viewsA.includes(b.title))
		failures.push(`A received B block ${b.id}`);
for (const a of own('A_PRIVATE'))
	if (viewsB.includes(a.id) || viewsB.includes(a.title))
		failures.push(`B received A block ${a.id}`);
for (const [viewer, hidden] of [
	['A', own('B_PRIVATE')],
	['B', own('A_PRIVATE')]
] as const) {
	const seen = await call('GET', `${P}/graph`, ProjectGraph, undefined, links[viewer].token);
	for (const h of hidden)
		if (seen.artifacts.some((a) => a.id === h.id))
			failures.push(`${viewer} sees ${h.id} in its graph`);
}
const full = { ...graph, triangles: protocol.triangles };
const beats = storyBeats(full);
const facts = protocol.triangles.filter((t) => t.fact !== null);
const out =
	values.out ??
	join(
		homedir(),
		'Desktop',
		`${
			title
				.toLowerCase()
				.replace(/[^a-zа-я0-9]+/giu, '-')
				.replace(/^-|-$/g, '')
				.slice(0, 60) || 'story'
		}.md`
	);
await writeFile(
	out,
	renderStoryMarkdown({ ...full, project: { ...full.project, name: title } }, { annotations: true })
);
console.log(
	JSON.stringify(
		{
			blocks: beats.length,
			A_blocks: own('A_PRIVATE').length,
			B_blocks: own('B_PRIVATE').length,
			facts: facts.length,
			max_depth: Math.max(0, ...protocol.triangles.map((t) => t.depth)),
			max_stage: Math.max(0, ...protocol.triangles.map((t) => t.stageIndex)),
			triangles_by_status: Object.fromEntries(
				Object.entries(Object.groupBy(protocol.triangles, (t) => t.status)).map(([k, v]) => [
					k,
					v?.length ?? 0
				])
			),
			errors: errors.length,
			isolation_failures: failures,
			story: out
		},
		null,
		2
	)
);
if (failures.length > 0) process.exitCode = 1;
