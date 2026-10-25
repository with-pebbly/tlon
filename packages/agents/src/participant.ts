/**
 * AI executor for one Block–Fact task, shared by the protocol runner and the repair loop.
 * The session sees exactly the server-assembled TaskView fetched with the participant's
 * own token and can only call the submit endpoints of that task — the same contract a
 * human uses through `/p`.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	AgentRegistry,
	type CustomTool,
	createAgentSession,
	type ModelRegistry,
	SessionManager,
	Settings,
	z
} from '@oh-my-pi/pi-coding-agent';

import {
	ApiErrorBody,
	SubmitTaskResult,
	type Task,
	TaskView,
	TriangleDetail
} from '../../contracts/src/index.ts';
import { ADVANCE_PROMPT, MEDIATOR_PROMPT, REVISE_PROMPT, SEED_PROMPT } from './protocol-prompts.ts';

type AuthStorage = ConstructorParameters<typeof ModelRegistry>[0];

export class ApiError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

export type Call = <T>(
	method: string,
	path: string,
	schema: { parse(v: unknown): T },
	body?: unknown,
	token?: string
) => Promise<T>;

/**
 * HTTP client for `/api`. `token` = participant identity; absent = facilitator, which
 * sends `TLON_OPERATOR_TOKEN` when protected mode is on.
 */
export function apiClient(api: string): Call {
	return async (method, path, schema, body, token) => {
		const bearer = token ?? process.env.TLON_OPERATOR_TOKEN;
		const response = await fetch(`${api}/api${path}`, {
			method,
			headers: {
				...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		const json: unknown = response.status === 204 ? null : await response.json();
		if (!response.ok) {
			const parsed = ApiErrorBody.safeParse(json);
			throw parsed.success
				? new ApiError(parsed.data.error.code, parsed.data.error.message)
				: new ApiError('INTERNAL', `HTTP ${response.status}`);
		}
		return schema.parse(json);
	};
}

const FACT_KINDS = [
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
] as const;

/**
 * Executes one task as `role` and returns the serialized TaskView it was given (kept by
 * callers as isolation evidence). Tool errors are reported through `onError`.
 */
export async function executeTask(options: {
	call: Call;
	projectId: string;
	token: string;
	role: 'A' | 'B' | 'C';
	task: Task;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	/** C proposes only; the facilitator accepts. */
	facilitatorReview?: boolean;
	onError?: (message: string) => void;
}): Promise<string> {
	const { call, token, role, task } = options;
	const P = `/projects/${options.projectId}`;
	const view = await call('GET', `${P}/tasks/${task.id}/view`, TaskView, undefined, token);
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
	const submitBlock = (type: 'seed_block' | 'advance_block' | 'revise_block'): CustomTool => ({
		name: 'submit_block',
		label: 'Submit Block',
		loadMode: 'essential',
		approval: 'write',
		description:
			type === 'revise_block'
				? 'Submit the full revised Block (title and whole text) once.'
				: 'Submit your Block for this task (once).',
		parameters: BlockParams,
		async execute(_id, params) {
			const p = BlockParams.parse(params);
			const result = await call(
				'POST',
				`${P}/tasks/${task.id}/submit`,
				SubmitTaskResult,
				{
					idempotencyKey,
					submission: { type, block: { kind: p.kind ?? 'EVENT', title: p.title, body: p.body } }
				},
				token
			);
			return text({ submitted: true, state: result.task.state });
		}
	});
	const FactsParams = z.object({
		candidates: z
			.array(
				z.object({
					kind: z.enum(FACT_KINDS),
					text: z.string().min(1).max(400),
					rationale: z.string().max(2000).optional()
				})
			)
			.min(1)
			.max(5)
	});
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
			const ids = result.task.resultRefs.map((r) => r.artifactId);
			return text({
				factIds: ids,
				candidates: p.candidates.map((c, i) => ({ factId: ids[i], text: c.text })),
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

	const json = (v: unknown) => JSON.stringify(v, null, 1);
	const [tools, system, prompt]: [CustomTool[], string, string] =
		view.type === 'seed_block'
			? [[submitBlock('seed_block')], SEED_PROMPT, `Your brief: ${view.brief}`]
			: view.type === 'advance_block'
				? [
						[submitBlock('advance_block')],
						ADVANCE_PROMPT,
						json({
							yourBlock: view.ownBlock,
							localContext: view.localContext,
							fact: view.fact,
							direction: view.direction
						})
					]
				: view.type === 'revise_block'
					? [
							[submitBlock('revise_block')],
							REVISE_PROMPT,
							json({
								blockToRevise: view.ownBlock,
								yourWholeLine: view.localContext,
								problems: view.problems,
								facilitatorNote: view.instructions
							})
						]
					: [
							options.facilitatorReview ? [submitFacts] : [submitFacts, acceptFact],
							MEDIATOR_PROMPT +
								(options.facilitatorReview
									? '\nThe facilitator chooses among your candidates; do not try to accept one.'
									: ''),
							json({
								left: view.left,
								right: view.right,
								alreadyUsedFacts: view.existingFacts,
								policy: view.policy
							})
						];

	const { session } = await createAgentSession({
		cwd: mkdtempSync(join(tmpdir(), `tlon-${role}-`)),
		authStorage: options.authStorage,
		modelRegistry: options.modelRegistry,
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
			options.onError?.(`[${role}] ${e.toolName}: ${JSON.stringify(e.result).slice(0, 240)}`);
		}
	});
	try {
		await session.prompt(prompt);
	} finally {
		await session.dispose();
	}
	return JSON.stringify(view);
}
