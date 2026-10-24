#!/usr/bin/env bun
/**
 * M4 runner: isolated A/B authors + C bridge coordinator over the Tlön gateway,
 * growing one scenario recursively until it reaches `--target` blocks.
 *
 * Each agent turn is a fresh omp SDK session with an in-memory history, a private
 * AgentRegistry, isolated settings (memory/autolearn off), an empty temp cwd and
 * `restrictToolNames: true` — only gateway tools bound to its own token (ADR 0008).
 *
 * Rounds:
 *   0. A writes the opening, B writes the ending (independently, in parallel).
 *   n. C bridges the A→B seam, then the open child intervals level by level (up to
 *      `--bridges-per-round` per round, depth ≤ `--max-depth`) → the operator accepts
 *      them (`--review` stops for human review instead). One recursive tree, so the
 *      pyramid view fills out as nested triangles.
 *   end. C briefs A and B through disclosures; the operator publishes them.
 *
 * Usage: bun packages/agents/src/run.ts --premise "..." [--target 30] [--rounds 8]
 *        [--bridges-per-round 8] [--max-depth 5] [--min-depth 3] [--chain-min-depth 2]
 *        [--project <id>] [--review]
 *        TLON_AGENT_MODEL=<pattern> selects the model.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
	AgentRegistry,
	createAgentSession,
	discoverAuthStorage,
	ModelRegistry,
	SessionManager,
	Settings
} from '@oh-my-pi/pi-coding-agent';

import {
	AcceptExpansionResult,
	type AgentRole,
	AgentPrincipal,
	ApiErrorBody,
	Disclosure,
	DisclosureList,
	ExpansionDetail,
	IssuedToken,
	Project,
	type ProjectGraph,
	ProjectGraph as ProjectGraphSchema,
	type Relation,
	TransitionAnnotation
} from '../../contracts/src/index.ts';
import { type BeatForExtraction, extractTransitions, vocabularyOf } from './extraction.ts';
import { GatewayClient, toolsForRole } from './gateway-tools.ts';
import { ROLE_PROMPTS } from './prompts.ts';

const { values } = parseArgs({
	options: {
		premise: { type: 'string' },
		project: { type: 'string' },
		target: { type: 'string', default: '30' },
		rounds: { type: 'string', default: '8' },
		'bridges-per-round': { type: 'string', default: '10' },
		'max-depth': { type: 'string', default: '5' },
		'min-depth': { type: 'string', default: '3' },
		'chain-min-depth': { type: 'string', default: '2' },
		'max-repairs': { type: 'string', default: '2' },
		review: { type: 'boolean', default: false },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
const api = values.api ?? 'http://127.0.0.1:3001';
const premise =
	values.premise ?? 'A disgraced cartographer receives a map of a city that does not exist yet.';
const target = Number(values.target);
const maxRounds = Number(values.rounds);
const bridgesPerRound = Number(values['bridges-per-round']);
const maxDepth = Number(values['max-depth']);
const seamMinDepth = Number(values['min-depth']);
const chainMinDepth = Number(values['chain-min-depth']);
const maxRepairs = Number(values['max-repairs']);

class OperatorError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

/** Operator calls (tokenless localhost). Orchestrator only — never exposed to agents. */
async function operator<T>(
	method: string,
	path: string,
	schema: { parse(value: unknown): T },
	body?: unknown,
	headers: Record<string, string> = {}
): Promise<T> {
	const response = await fetch(`${api}/api${path}`, {
		method,
		headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const json: unknown = await response.json();
	if (!response.ok) {
		const parsed = ApiErrorBody.safeParse(json);
		throw parsed.success
			? new OperatorError(parsed.data.error.code, parsed.data.error.message)
			: new OperatorError('INTERNAL', `HTTP ${response.status}`);
	}
	return schema.parse(json);
}

type Agent = { role: AgentRole; principalId: string; token: string };

async function provisionAgent(projectId: string, role: AgentRole, runId: string): Promise<Agent> {
	const principal = await operator('POST', `/projects/${projectId}/agents`, AgentPrincipal, {
		role,
		name: `${role.toLowerCase()}-${runId}`
	});
	const issued = await operator(
		'POST',
		`/projects/${projectId}/agents/${principal.id}/tokens`,
		IssuedToken,
		{ ttlSeconds: 6 * 3600 }
	);
	return { role, principalId: principal.id, token: issued.token };
}

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();
const toolErrors: string[] = [];
/** Expansions whose candidates kept failing the gate after all repair attempts. */
const unresolved = new Map<string, Rejection>();
/** Candidates the verifier could not annotate (accepted on C's own contract only). */
const unverified = new Set<string>();
let gateRejections = 0;

const stopped = new Map<string, string>();

async function runAgent(agent: Agent, projectId: string, prompt: string): Promise<string> {
	const tools = toolsForRole(agent.role, new GatewayClient(api, projectId, agent.token), {
		onStop: (relationId, reason) => {
			// Recorded always; ignored by openIntervals while the interval is above its tree's min depth.
			stopped.set(relationId, reason);
			console.log(`[${agent.role}] ■ stop ${relationId.slice(0, 8)}: ${reason}`);
		}
	});
	const { session, modelFallbackMessage } = await createAgentSession({
		cwd: mkdtempSync(join(tmpdir(), `tlon-agent-${agent.role}-`)),
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
		systemPrompt: [ROLE_PROMPTS[agent.role]]
	});
	if (modelFallbackMessage) console.error(`[${agent.role}] ${modelFallbackMessage}`);
	if (session.getActiveToolNames().some((name) => !tools.some((t) => t.name === name))) {
		throw new Error(
			`[${agent.role}] session exposes non-gateway tools: ${session.getActiveToolNames()}`
		);
	}
	let transcript = '';
	let calls = 0;
	session.subscribe((event) => {
		if (event.type === 'tool_execution_end') {
			calls++;
			if (event.isError) {
				const detail = JSON.stringify(event.result).slice(0, 300);
				toolErrors.push(`[${agent.role}] ${event.toolName}: ${detail}`);
				console.log(`[${agent.role}] ✗ ${event.toolName} ${detail}`);
			}
		}
		if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
			transcript += event.assistantMessageEvent.delta;
		}
	});
	try {
		await session.prompt(prompt);
	} finally {
		await session.dispose();
	}
	console.log(`[${agent.role}] ${calls} tool calls`);
	return transcript.trim();
}

const graphOf = (projectId: string) =>
	operator('GET', `/projects/${projectId}/graph`, ProjectGraphSchema);
const blocks = (g: ProjectGraph) =>
	g.artifacts.filter((a) => a.status !== 'REJECTED' && a.status !== 'SUPERSEDED').length;

type Interval = { relation: Relation; depth: number; minDepth: number; tree: 'seam' | 'chain' };

/**
 * Unbridged intervals, shallowest first. Every root relation (the A→B seam and each
 * link inside an author's chain) grows its own pyramid. A tree MUST be bridged down to
 * its minimum depth (`--min-depth` for the seam, `--chain-min-depth` for chains); below
 * that C may STOP an interval as sufficiently detailed, which gives uneven depth.
 */
function openIntervals(g: ProjectGraph): Interval[] {
	const expansions = new Map(g.expansions.map((e) => [e.id, e]));
	const relations = new Map(g.relations.map((r) => [r.id, r]));
	const scopeOf = new Map(g.artifacts.map((a) => [a.id, a.ownerScope]));
	const busy = new Set(
		g.expansions
			.filter((e) => ['PENDING', 'GENERATING', 'REVIEW', 'ACCEPTED'].includes(e.status))
			.map((e) => e.targetRelationId)
	);
	const rootOf = (r: Relation): Relation => {
		let cursor = r;
		for (let guard = 0; cursor.expansionId !== null && guard < 64; guard++) {
			const e = expansions.get(cursor.expansionId);
			const targetId = e?.targetRelationId;
			const target = targetId ? relations.get(targetId) : undefined;
			if (!target) break;
			cursor = target;
		}
		return cursor;
	};
	return g.relations
		.filter((r) => r.status !== 'REJECTED' && r.expandedByExpansionId === null && !busy.has(r.id))
		.flatMap((relation): Interval[] => {
			const depth =
				relation.expansionId === null ? 1 : (expansions.get(relation.expansionId)?.depth ?? 0) + 1;
			const root = rootOf(relation);
			const tree = scopeOf.get(root.fromId) === scopeOf.get(root.toId) ? 'chain' : 'seam';
			const minDepth = tree === 'seam' ? seamMinDepth : chainMinDepth;
			// The seam root is opened by C from a pair; its child intervals start at depth 2.
			if (tree === 'seam' && depth === 1) return [];
			if (depth > maxDepth) return [];
			if (stopped.has(relation.id) && depth > minDepth) return [];
			return [{ relation, depth, minDepth, tree }];
		})
		.toSorted(
			(a, b) =>
				Number(a.tree === 'chain') - Number(b.tree === 'chain') ||
				a.depth - b.depth ||
				a.relation.createdAt.localeCompare(b.relation.createdAt)
		);
}

function chainEnds(g: ProjectGraph, scope: 'A_PRIVATE' | 'B_PRIVATE') {
	const own = g.artifacts.filter((a) => a.ownerScope === scope && a.status !== 'REJECTED');
	const ids = new Set(own.map((a) => a.id));
	const hasIn = new Set(
		g.relations.filter((r) => ids.has(r.fromId) && ids.has(r.toId)).map((r) => r.toId)
	);
	const hasOut = new Set(
		g.relations.filter((r) => ids.has(r.fromId) && ids.has(r.toId)).map((r) => r.fromId)
	);
	const byTime = own.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
	return {
		first: byTime.find((a) => !hasIn.has(a.id)) ?? byTime[0],
		last: byTime.findLast((a) => !hasOut.has(a.id)) ?? byTime.at(-1)
	};
}

type Rejection = {
	expansionId: string;
	relationId: string | null;
	title: string;
	explanation: string;
};

/**
 * Independent verification of every pending candidate (LIGHTHOUSE_V2_REVIEW §1/§3):
 * a read-only VALIDATOR session re-extracts the candidate's contract from its text,
 * with its two neighbours' contracts as context and the project vocabulary. The
 * operator stores it as the candidate's latest (`extracted`) annotation, so the accept
 * gate judges what the bridge narrates, not what C claimed about it.
 */
async function verifyCandidates(projectId: string): Promise<void> {
	const g = await graphOf(projectId);
	const contracts = new Map(g.transitions.map((t) => [t.artifactId, t.transition]));
	const beats: BeatForExtraction[] = [];
	const pending: Array<{ artifactId: string; revisionId: string }> = [];
	for (const e of g.expansions.filter((x) => x.status === 'REVIEW')) {
		const detail = await operator(
			'GET',
			`/projects/${projectId}/expansions/${e.id}`,
			ExpansionDetail
		);
		const candidate = detail.candidates.find((c) => c.reviewStatus === 'PENDING');
		if (!candidate) continue;
		const mechanism = candidate.artifact.structured.mechanism;
		const context = (a: typeof detail.left) => ({
			id: a.id,
			order: 0,
			title: a.title,
			body: a.body,
			contextOnly: true,
			...(contracts.get(a.id) ? { knownContract: contracts.get(a.id) } : {})
		});
		beats.push(
			context(detail.left),
			{
				id: candidate.artifact.id,
				order: 0,
				title: candidate.artifact.title,
				body: candidate.artifact.body,
				...(typeof mechanism === 'string' ? { mechanism } : {})
			},
			context(detail.right)
		);
		pending.push({
			artifactId: candidate.artifact.id,
			revisionId: candidate.artifact.headRevisionId
		});
	}
	if (pending.length === 0) return;
	const proposals = await extractTransitions({
		beats,
		vocabulary: vocabularyOf(g),
		authStorage,
		modelRegistry,
		chunk: 3
	});
	for (const p of pending) {
		const t = proposals.get(p.artifactId);
		if (!t) {
			unverified.add(p.artifactId);
			continue;
		}
		await operator(
			'PUT',
			`/projects/${projectId}/artifacts/${p.artifactId}/transition`,
			TransitionAnnotation,
			{
				artifactRevisionId: p.revisionId,
				transition: t,
				source: 'extracted',
				reviewed: false
			}
		);
	}
	console.log(
		`verified ${pending.length - [...unverified].filter((id) => pending.some((p) => p.artifactId === id)).length}/${pending.length} candidates independently`
	);
}

/**
 * Accepts each reviewed bridge as the operator. The gateway refuses candidates that
 * add blocker continuity issues (CONTINUITY_VIOLATION); then EVERY pending candidate of
 * that expansion is rejected (so the candidate limit never blocks a repair) and the
 * findings are returned for C. Nothing is ever force-accepted.
 */
async function acceptReviewedBridges(
	projectId: string
): Promise<{ accepted: number; rejected: Rejection[] }> {
	await verifyCandidates(projectId);
	const g = await graphOf(projectId);
	let accepted = 0;
	const rejected: Rejection[] = [];
	for (const e of g.expansions.filter((x) => x.status === 'REVIEW')) {
		const detail = await operator(
			'GET',
			`/projects/${projectId}/expansions/${e.id}`,
			ExpansionDetail
		);
		const pendingCandidates = detail.candidates.filter((c) => c.reviewStatus === 'PENDING');
		const candidate = pendingCandidates[0];
		if (!candidate) continue;
		try {
			await operator(
				'POST',
				`/projects/${projectId}/expansions/${e.id}/accept`,
				AcceptExpansionResult,
				{
					candidateId: candidate.id,
					reason: 'accepted by runner auto-accept policy (independently verified)'
				},
				{ 'idempotency-key': randomUUID() }
			);
			accepted++;
		} catch (error) {
			if (!(error instanceof OperatorError) || error.code !== 'CONTINUITY_VIOLATION') throw error;
			const explanation = candidate.issues
				.filter((i) => i.severity === 'blocker')
				.map((i) => i.explanation)
				.join(' | ');
			for (const c of pendingCandidates) {
				await operator(
					'POST',
					`/projects/${projectId}/expansions/${e.id}/reject`,
					ExpansionDetail,
					{
						candidateId: c.id,
						reason: 'continuity validation failed'
					}
				);
			}
			gateRejections++;
			rejected.push({
				expansionId: e.id,
				relationId: e.targetRelationId,
				title: candidate.artifact.title,
				explanation
			});
			console.log(`  ✗ rejected "${candidate.artifact.title}": ${explanation}`);
		}
	}
	return { accepted, rejected };
}

async function publishPendingDisclosures(projectId: string): Promise<number> {
	const list = await operator('GET', `/projects/${projectId}/disclosures`, DisclosureList);
	let published = 0;
	for (const d of list.items.filter((x) => x.status === 'PENDING')) {
		await operator('POST', `/projects/${projectId}/disclosures/${d.id}/review`, Disclosure, {
			decision: 'PUBLISH',
			reason: 'published by runner auto-publish policy'
		});
		published++;
	}
	return published;
}

// ── run ──────────────────────────────────────────────────────────────────────
const runId = Date.now().toString(36);
const projectId =
	values.project ??
	(await operator('POST', '/projects', Project, { name: `Fractal ${runId}`, domain: 'NARRATIVE' }))
		.id;
const [a, b, c] = await Promise.all([
	provisionAgent(projectId, 'A', runId),
	provisionAgent(projectId, 'B', runId),
	provisionAgent(projectId, 'C', runId)
]);
console.log(`project ${projectId}\n  ${api.replace(/:\d+$/, ':5173')}/projects/${projectId}`);

// Resuming an existing scenario (--project with artifacts) continues from round 1.
if (blocks(await graphOf(projectId)) === 0) {
	console.log('\n── round 0: A and B write independently ──');
	await Promise.all([
		runAgent(a, projectId, `Premise: ${premise}\nWrite the OPENING of this story: 3 linked beats.`),
		runAgent(b, projectId, `Premise: ${premise}\nWrite the ENDING of this story: 3 linked beats.`)
	]);
}

for (let round = 1; round <= maxRounds; round++) {
	const g = await graphOf(projectId);
	if (blocks(g) >= target) break;

	const intervals = openIntervals(g).slice(0, bridgesPerRound);
	const titles = new Map(g.artifacts.map((x) => [x.id, x.title]));
	const aEnds = chainEnds(g, 'A_PRIVATE');
	const bEnds = chainEnds(g, 'B_PRIVATE');
	const seamOpen =
		aEnds.last !== undefined &&
		bEnds.first !== undefined &&
		!g.relations.some((r) => r.fromId === aEnds.last?.id && r.toId === bEnds.first?.id);
	const tasks = [
		...(seamOpen && aEnds.last && bEnds.first
			? [
					`- SEAM pair left=${aEnds.last.id} ("${aEnds.last.title}") → right=${bEnds.first.id} ("${bEnds.first.title}")`
				]
			: []),
		...intervals.map(
			(i) =>
				`- ${i.depth <= i.minDepth ? 'MUST BRIDGE' : 'bridge or stop'} relationId=${i.relation.id} depth=${i.depth} ${i.relation.type}: "${titles.get(i.relation.fromId)}" → "${titles.get(i.relation.toId)}"`
		)
	];
	if (tasks.length === 0) {
		console.log(`\nno open intervals up to depth ${maxDepth}; stopping`);
		break;
	}
	console.log(`\n── round ${round}: ${blocks(g)} blocks, bridging ${tasks.length} intervals ──`);
	await runAgent(
		c,
		projectId,
		[
			`Premise: ${premise}`,
			`Budget: the scenario has ${blocks(g)} blocks and should reach about ${target}. Intervals marked MUST BRIDGE need a beat (the story is still too coarse there). For the others decide: BRIDGE (one candidate with a full state contract) or STOP with interval_stop when another beat would only restate motions, delay an established outcome or add no new causal information, character choice or reversal. Uneven depth is good pacing.`,
			'Before bridging, call artifact_list_visible and read the `state` of both ends and of their neighbours: your preconditions must match what the left end leaves, your effects must leave what the right end requires, and you must not perform the right end’s own irreversible event.',
			`An independent verifier re-reads your prose and checks it against the neighbours: write each beat strictly inside its interval (after everything the left end narrates, before everything the right end narrates; same clock direction), and reuse these state keys, value tokens and event ids where they apply: ${JSON.stringify(vocabularyOf(g))}`,
			...tasks
		].join('\n')
	);
	if (values.review) {
		console.log('\n--review: bridge candidates await your decision in the web UI. Stopping.');
		break;
	}
	let result = await acceptReviewedBridges(projectId);
	let accepted = result.accepted;
	for (let attempt = 1; attempt <= maxRepairs && result.rejected.length > 0; attempt++) {
		await runAgent(
			c,
			projectId,
			[
				`Premise: ${premise}`,
				`Repair attempt ${attempt}/${maxRepairs}. These candidates failed independent continuity validation and were rejected. For each, submit ONE corrected candidate to the same expansionId — rewrite the beat so it happens strictly between its two ends (no event of the right end, nothing that must come before the left end, no reset of state the left end changed) — or interval_stop its relation if the interval needs no beat:`,
				...result.rejected.map(
					(r) =>
						`- expansionId=${r.expansionId} relationId=${r.relationId} "${r.title}": ${r.explanation}`
				)
			].join('\n')
		);
		result = await acceptReviewedBridges(projectId);
		accepted += result.accepted;
	}
	for (const r of result.rejected) unresolved.set(r.expansionId, r);
	console.log(
		`accepted ${accepted} bridges, still rejected ${result.rejected.length}, stopped ${stopped.size} intervals so far`
	);
}

if (!values.review) {
	console.log('\n── briefing: C discloses to A and B ──');
	await runAgent(
		c,
		projectId,
		`Premise: ${premise}\nBrief author A (principal ${a.principalId}) and author B (principal ${b.principalId}) on how the story now connects their parts. One disclosure each.`
	);
	console.log(`published ${await publishPendingDisclosures(projectId)} disclosures`);
}

// ── isolation check ──────────────────────────────────────────────────────────
console.log('\n── isolation check (gateway, agent tokens) ──');
const final = await graphOf(projectId);
const scoped = (scope: string) => final.artifacts.filter((x) => x.ownerScope === scope);
const failures: string[] = [];
async function assertHidden(viewer: Agent, hidden: ProjectGraph['artifacts']) {
	const gw = new GatewayClient(api, projectId, viewer.token);
	const seen = new Set(
		(await gw.call('GET', '/graph', ProjectGraphSchema)).artifacts.map((x) => x.id)
	);
	for (const h of hidden) {
		if (seen.has(h.id)) failures.push(`${viewer.role} sees ${h.id} in graph`);
		for (const path of [`/artifacts/${h.id}`, `/artifacts/${h.id}/revisions`]) {
			const r = await fetch(`${api}/api/projects/${projectId}${path}`, {
				headers: { authorization: `Bearer ${viewer.token}` }
			});
			if (r.status !== 404) failures.push(`${viewer.role} GET ${path} → ${r.status}`);
		}
		const q = encodeURIComponent(h.title.slice(0, 40));
		const r = await fetch(`${api}/api/projects/${projectId}/artifacts?q=${q}`, {
			headers: { authorization: `Bearer ${viewer.token}` }
		});
		if ((await r.text()).includes(h.id)) failures.push(`${viewer.role} finds ${h.id} via search`);
	}
}
const aPrivate = scoped('A_PRIVATE');
const bPrivate = scoped('B_PRIVATE');
if (aPrivate.length === 0) failures.push('A produced no artifacts (check would be vacuous)');
if (bPrivate.length === 0) failures.push('B produced no artifacts (check would be vacuous)');
await assertHidden(a, bPrivate);
await assertHidden(b, aPrivate);

const bridges = final.expansions.filter((e) => e.status === 'ACCEPTED');
console.log(
	JSON.stringify(
		{
			blocks: blocks(final),
			A_private: aPrivate.length,
			B_private: bPrivate.length,
			C_shared: scoped('C_SHARED').length,
			accepted_bridges: bridges.length,
			max_depth: Math.max(0, ...bridges.map((e) => e.depth)),
			tool_errors: toolErrors.length,
			stopped_intervals: stopped.size,
			gate_rejections: gateRejections,
			unresolved_intervals: [...unresolved.values()].map((r) => ({
				expansionId: r.expansionId,
				title: r.title,
				why: r.explanation.slice(0, 200)
			})),
			unverified_candidates: unverified.size,
			isolation_failures: failures
		},
		null,
		2
	)
);
// Ending below --target is fine: STOP decisions are pacing, not failure.
if (failures.length > 0) process.exitCode = 1;
