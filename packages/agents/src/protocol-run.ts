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
 *          --end "The universe collapses." [--target 24] [--max-depth 11] [--title "..."]
 *          [--out ~/Desktop/story.md] [--review] [--skip-analyze]
 */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { discoverAuthStorage, ModelRegistry } from '@oh-my-pi/pi-coding-agent';

import {
	type AgentRole,
	ParticipantLink,
	Project,
	ProjectGraph,
	ProtocolState,
	Run,
	type Task,
	TaskList,
	TriangleDetail
} from '../../contracts/src/index.ts';
import { renderStoryMarkdown, storyBeats } from '../../core/src/index.ts';
import { apiClient, executeTask } from './participant.ts';

const { values } = parseArgs({
	options: {
		start: { type: 'string' },
		end: { type: 'string' },
		title: { type: 'string' },
		target: { type: 'string', default: '24' },
		'max-depth': { type: 'string', default: '11' },
		out: { type: 'string' },
		review: { type: 'boolean', default: false },
		'skip-analyze': { type: 'boolean', default: false },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
if (!values.start || !values.end) throw new Error('--start and --end are required');
const api = values.api ?? 'http://127.0.0.1:3001';
const target = Number(values.target);
const maxDepth = Number(values['max-depth']);
const title = values.title ?? `${values.start} … ${values.end}`;

const call = apiClient(api);

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

// ── participant execution (isolated sessions, see participant.ts) ───────────
async function execute(role: 'A' | 'B' | 'C', task: Task): Promise<void> {
	const view = await executeTask({
		call,
		projectId: project.id,
		token: links[role].token,
		role,
		task,
		authStorage,
		modelRegistry,
		facilitatorReview: values.review,
		onError: (message) => {
			errors.push(message);
			console.log(`  ✗ ${message}`);
		}
	});
	deliveredViews[role].push(view);
	// A/B task views carry scrubbed stage/depth (ADR 0012), so only C's stage is real.
	console.log(`  [${role}] ${task.type}${role === 'C' ? ` (stage ${task.stageIndex})` : ''} done`);
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
	// BLOCK_FACT §1.3: the next gap of a converged Triangle lies between its two new
	// continuations (A′ forward from A, B′ backward from B), one level deeper. Gaps are
	// never opened between two Blocks of the same side: that side wrote them in sequence.
	const parents = new Set(protocol.triangles.map((t) => t.parentTriangleId));
	const chosen = protocol.triangles
		.filter((t) => t.status === 'converged' && !parents.has(t.id) && t.depth < maxDepth)
		.flatMap((t) => {
			const left = t.continuations.find((c) => c.side === 'left');
			const right = t.continuations.find((c) => c.side === 'right');
			return left && right
				? [{ left: left.block.artifactId, right: right.block.artifactId, parent: t }]
				: [];
		})
		.toSorted((a, b) => a.parent.depth - b.parent.depth)
		.slice(0, Math.max(1, Math.ceil((target - beats.length) / 2)));
	if (chosen.length === 0) {
		console.log(`\nno converged gap left within max depth ${maxDepth}; stopping`);
		break;
	}
	console.log(`\n── round ${round}: ${beats.length} Blocks, opening ${chosen.length} gap(s) ──`);
	for (const g of chosen) {
		await call('POST', `${P}/connect`, TriangleDetail, {
			left: { artifactId: g.left },
			right: { artifactId: g.right },
			parentTriangleId: g.parent.id,
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
// Ids and prose bodies, not titles: a writer may legitimately title a Block after the
// disclosed Fact, so the same two words can appear on both sides.
const leaked = (views: string, b: (typeof graph.artifacts)[number]) =>
	views.includes(b.id) ||
	(b.body.length >= 40 && views.includes(JSON.stringify(b.body).slice(1, 61)));
for (const b of own('B_PRIVATE'))
	if (leaked(viewsA, b)) failures.push(`A received B block ${b.id}`);
for (const a of own('A_PRIVATE'))
	if (leaked(viewsB, a)) failures.push(`B received A block ${a.id}`);
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
else if (!values.review && !values['skip-analyze']) {
	// Organizer analysis: extraction, join review (ai_review suggestions only), completion
	// report, isolation audit and the reader / organizer / chronology exports.
	const result = spawnSync(
		'bun',
		['packages/agents/src/analyze.ts', '--project', project.id, '--out', out, '--api', api],
		{ cwd: new URL('../../../', import.meta.url).pathname, stdio: 'inherit' }
	);
	if (result.status !== 0) process.exitCode = result.status ?? 1;
}
