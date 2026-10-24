#!/usr/bin/env bun
/**
 * M4 runner: isolated A/B authors + C bridge coordinator over the Tlön gateway.
 *
 * Each agent is a separate omp SDK session with:
 *   - its own in-memory session (no shared history), private AgentRegistry, isolated settings
 *     (memory backend off, autolearn off, no MCP/LSP/extensions/skills/context files);
 *   - `restrictToolNames: true` and ONLY gateway tools bound to its own token (no shell,
 *     filesystem, fetch or browser) — required because operator access is tokenless on
 *     localhost (ADR 0007);
 *   - an empty temp cwd.
 * Agents propose; the human reviews bridges and disclosures in the web UI.
 *
 * Usage: bun packages/agents/src/run.ts --premise "..." [--project <id>] [--api http://127.0.0.1:3001]
 *        TLON_AGENT_MODEL=<pattern> selects the model (default: omp default model).
 */
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
	type AgentRole,
	AgentPrincipal,
	ApiErrorBody,
	DisclosureList,
	IssuedToken,
	Project,
	ProjectGraph
} from '../../contracts/src/index.ts';
import { GatewayClient, toolsForRole } from './gateway-tools.ts';
import { ROLE_PROMPTS } from './prompts.ts';

const { values } = parseArgs({
	options: {
		premise: { type: 'string' },
		project: { type: 'string' },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
const api = values.api ?? 'http://127.0.0.1:3001';
const premise =
	values.premise ?? 'A disgraced cartographer receives a map of a city that does not exist yet.';

/** Operator calls (tokenless localhost). Used only by this orchestrator, never exposed to agents. */
async function operator<T>(
	method: string,
	path: string,
	schema: { parse(value: unknown): T },
	body?: unknown
): Promise<T> {
	const response = await fetch(`${api}/api${path}`, {
		method,
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const json: unknown = await response.json();
	if (!response.ok) {
		const parsed = ApiErrorBody.safeParse(json);
		throw new Error(
			parsed.success
				? `${parsed.data.error.code}: ${parsed.data.error.message}`
				: `HTTP ${response.status}`
		);
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
		{ ttlSeconds: 3600 }
	);
	return { role, principalId: principal.id, token: issued.token };
}

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

async function runAgent(agent: Agent, projectId: string, prompt: string): Promise<string> {
	const gateway = new GatewayClient(api, projectId, agent.token);
	const tools = toolsForRole(agent.role, gateway);
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
	console.log(
		`[${agent.role}] model=${session.model?.id} tools=${session.getActiveToolNames().join(',')}`
	);

	let transcript = '';
	session.subscribe((event) => {
		if (event.type === 'tool_execution_start') console.log(`[${agent.role}] → ${event.toolName}`);
		if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
			transcript += event.assistantMessageEvent.delta;
		}
	});
	try {
		await session.prompt(prompt);
	} finally {
		await session.dispose();
	}
	return transcript.trim();
}

const runId = Date.now().toString(36);
const projectId =
	values.project ??
	(await operator('POST', '/projects', Project, { name: `Agents ${runId}`, domain: 'NARRATIVE' }))
		.id;
const [a, b, c] = await Promise.all([
	provisionAgent(projectId, 'A', runId),
	provisionAgent(projectId, 'B', runId),
	provisionAgent(projectId, 'C', runId)
]);
console.log(`project ${projectId}  (${api.replace(/:\d+$/, ':5173')}/projects/${projectId})`);

console.log('\n── phase 1: A and B write independently ──');
const [aSummary, bSummary] = await Promise.all([
	runAgent(a, projectId, `Premise: ${premise}\nWrite the OPENING of this story.`),
	runAgent(b, projectId, `Premise: ${premise}\nWrite the ENDING of this story.`)
]);
console.log(`\n[A] ${aSummary}\n\n[B] ${bSummary}`);

console.log('\n── phase 2: C bridges and prepares disclosures ──');
const cSummary = await runAgent(
	c,
	projectId,
	`Premise: ${premise}\nAuthor A (principal ${a.principalId}) wrote the opening; author B (principal ${b.principalId}) wrote the ending. Neither has seen the other.`
);
console.log(`\n[C] ${cSummary}`);

console.log('\n── isolation check (gateway, agent tokens) ──');
const visible = async (agent: Agent) =>
	new Set(
		(
			await new GatewayClient(api, projectId, agent.token).call('GET', '/graph', ProjectGraph)
		).artifacts.map((x) => x.id)
	);
const graph = await operator('GET', `/projects/${projectId}/graph`, ProjectGraph);
const ids = (scope: string) =>
	graph.artifacts.filter((x) => x.ownerScope === scope).map((x) => x.id);
const [seenByA, seenByB] = await Promise.all([visible(a), visible(b)]);
const leaksToA = ids('B_PRIVATE').filter((id) => seenByA.has(id)).length;
const leaksToB = ids('A_PRIVATE').filter((id) => seenByB.has(id)).length;
const disclosures = await operator('GET', `/projects/${projectId}/disclosures`, DisclosureList);
console.log(
	JSON.stringify(
		{
			A_private: ids('A_PRIVATE').length,
			B_private: ids('B_PRIVATE').length,
			C_shared: ids('C_SHARED').length,
			B_artifacts_visible_to_A: leaksToA,
			A_artifacts_visible_to_B: leaksToB,
			pending_disclosures: disclosures.items.filter((d) => d.status === 'PENDING').length
		},
		null,
		2
	)
);
if (leaksToA + leaksToB > 0) process.exitCode = 1;
console.log(
	'\nReview the bridge candidate and disclosures in the web UI (Disclosures / expansion inspector).'
);
