import { type CustomTool, z } from '@oh-my-pi/pi-coding-agent';

import {
	type AgentRole,
	ApiErrorBody,
	type Artifact,
	Artifact as ArtifactSchema,
	Disclosure,
	ExpansionDetail,
	ProjectGraph,
	Relation,
	TransitionAnnotation
} from '../../contracts/src/index.ts';

type Schema<T> = { parse(value: unknown): T };

/**
 * HTTP client bound to ONE agent token. Every tool goes through it, so the gateway —
 * not this code — decides what the agent may see or change (ADR 0007).
 */
export class GatewayClient {
	readonly #base: string;
	readonly #projectId: string;
	readonly #token: string;

	constructor(base: string, projectId: string, token: string) {
		this.#base = base;
		this.#projectId = projectId;
		this.#token = token;
	}

	async call<T>(method: string, path: string, schema: Schema<T>, body?: unknown): Promise<T> {
		const response = await fetch(`${this.#base}/api/projects/${this.#projectId}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.#token}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
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
}

const text = (value: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }],
	details: undefined
});

/** Compact projection: agents get ids/titles/bodies, never transport metadata. */
const brief = (a: Artifact) => ({
	id: a.id,
	revisionId: a.headRevisionId,
	kind: a.kind,
	scope: a.ownerScope,
	by: a.creatorRole,
	title: a.title,
	body: a.body,
	structured: a.structured
});

const Kind = z.enum([
	'FACT',
	'EVENT',
	'STATE',
	'BELIEF',
	'GOAL',
	'CONSTRAINT',
	'ARC',
	'SCENE',
	'NOTE'
]);

const createFields = {
	kind: Kind,
	title: z.string().min(1).max(300),
	body: z.string().max(4000).describe('Markdown prose of the artifact'),
	worldTime: z.string().max(200).optional().describe('When in story time this holds'),
	location: z.string().max(200).optional()
};
const RelationParams = z.object({
	fromId: z.string(),
	toId: z.string(),
	type: z.enum(['precedes', 'causes', 'enables', 'contradicts', 'explains', 'references'])
});
const ExpansionParams = z.object({
	relationId: z.string().optional().describe('Relation (interval) to subdivide — preferred'),
	leftArtifactId: z.string().optional(),
	rightArtifactId: z.string().optional()
});
/** Wire shape of one state claim (mirrors contracts `Assertion`). */
const AssertionParams = z.object({
	subject: z.string().describe('lower_snake entity, e.g. mercury_bath'),
	predicate: z.string().describe('lower_snake property, e.g. level'),
	value: z
		.union([z.string(), z.number(), z.boolean()])
		.describe(
			'short canonical token, 1–3 words, e.g. full / falling / open / on_crank — put detail in note'
		),
	note: z.string().optional().describe('free-text detail, never compared'),
	epistemic: z.enum(['world', 'belief', 'rumor', 'hypothesis']).optional(),
	holder: z.string().optional().describe('whose belief/rumor'),
	irreversible: z.boolean().optional().describe('can only happen once (a valve drained)'),
	preparation: z.boolean().optional().describe('readies an action a later beat must use')
});
const StateParams = {
	preconditions: z
		.array(AssertionParams)
		.max(20)
		.describe('world state that must already hold when this beat starts'),
	effects: z.array(AssertionParams).max(20).describe('state this beat changes'),
	inventedFacts: z
		.array(AssertionParams)
		.max(20)
		.describe('new facts this beat invents to work (proposals until accepted)')
};
const CandidateParams = z.object({
	expansionId: z.string(),
	title: z.string().min(1).max(300),
	body: z.string().max(4000),
	mechanism: z.string().min(1).max(2000),
	assumptions: z.array(z.string().min(1).max(500)).min(1).max(10),
	leftStaysTrue: z.string().min(1).max(1000),
	rightStaysTrue: z.string().min(1).max(1000),
	...StateParams
});
/** Authors may state their beat's state contract too (optional; validated server-side). */
const AuthorCreateParams = z.object({
	...createFields,
	preconditions: StateParams.preconditions.optional(),
	effects: StateParams.effects.optional(),
	inventedFacts: StateParams.inventedFacts.optional()
});
const StopParams = z.object({
	relationId: z.string(),
	reason: z.string().min(1).max(500)
});
const DisclosureParams = z.object({
	destinationPrincipalId: z.string(),
	title: z.string().min(1).max(300),
	body: z.string().max(4000),
	sources: z
		.array(z.object({ artifactId: z.string(), revisionId: z.string() }))
		.min(1)
		.max(20)
});

function commonTools(gw: GatewayClient): CustomTool[] {
	return [
		{
			name: 'artifact_list_visible',
			label: 'List visible artifacts',
			loadMode: 'essential',
			approval: 'read',
			description:
				'List every artifact and relation you are allowed to see in this project. Returns ids, revisions, titles, bodies.',
			parameters: z.object({}),
			async execute() {
				const graph = await gw.call('GET', '/graph', ProjectGraph);
				const state = new Map(graph.transitions.map((t) => [t.artifactId, t.transition]));
				return text({
					artifacts: graph.artifacts.map((a) => ({ ...brief(a), state: state.get(a.id) ?? null })),
					relations: graph.relations.map((r) => ({
						id: r.id,
						from: r.fromId,
						to: r.toId,
						type: r.type,
						status: r.status,
						// Present only for roles allowed to see expansions (C/VALIDATOR).
						producedByExpansion: r.expansionId,
						alreadyBridgedBy: r.expandedByExpansionId
					}))
				});
			}
		},
		{
			name: 'artifact_create',
			label: 'Create artifact',
			loadMode: 'essential',
			approval: 'write',
			description:
				'Create one story artifact (a fact, event, scene, belief...). It is stored in your own scope automatically. Optionally state its world-state contract (preconditions/effects) so continuity can be checked.',
			parameters: AuthorCreateParams,
			async execute(_id, params) {
				const p = AuthorCreateParams.parse(params);
				const structured: Record<string, string> = {};
				if (p.worldTime) structured.worldTime = p.worldTime;
				if (p.location) structured.location = p.location;
				const created = await gw.call('POST', '/artifacts', ArtifactSchema, {
					kind: p.kind,
					title: p.title,
					body: p.body,
					structured
				});
				if (p.preconditions?.length || p.effects?.length || p.inventedFacts?.length) {
					await gw.call('PUT', `/artifacts/${created.id}/transition`, TransitionAnnotation, {
						artifactRevisionId: created.headRevisionId,
						source: 'author',
						transition: {
							preconditions: p.preconditions ?? [],
							effects: p.effects ?? [],
							assumptions: p.inventedFacts ?? []
						}
					});
				}
				return text(brief(created));
			}
		},
		{
			name: 'relation_propose',
			label: 'Propose relation',
			loadMode: 'essential',
			approval: 'write',
			description:
				'Propose a typed relation between two artifacts you can see (types: precedes, causes, enables, contradicts, explains, references).',
			parameters: RelationParams,
			async execute(_id, params) {
				const r = await gw.call('POST', '/relations', Relation, RelationParams.parse(params));
				return text({ id: r.id, from: r.fromId, to: r.toId, type: r.type, status: r.status });
			}
		}
	];
}

function bridgeTools(gw: GatewayClient): CustomTool[] {
	return [
		{
			name: 'expansion_propose',
			label: 'Open expansion',
			loadMode: 'essential',
			approval: 'write',
			description:
				'Open a bridge expansion on an interval. Pass relationId of an unbridged relation (preferred), or an ordered artifact pair — a `precedes` relation is created for the pair first so the bridge joins the fractal. Returns the expansion id and depth.',
			parameters: ExpansionParams,
			async execute(_id, params) {
				const p = ExpansionParams.parse(params);
				let relationId = p.relationId;
				if (!relationId) {
					if (!p.leftArtifactId || !p.rightArtifactId) {
						throw new Error('pass relationId or both leftArtifactId and rightArtifactId');
					}
					const graph = await gw.call('GET', '/graph', ProjectGraph);
					const existing = graph.relations.find(
						(r) =>
							r.fromId === p.leftArtifactId &&
							r.toId === p.rightArtifactId &&
							r.status !== 'REJECTED' &&
							r.expandedByExpansionId === null
					);
					relationId =
						existing?.id ??
						(
							await gw.call('POST', '/relations', Relation, {
								fromId: p.leftArtifactId,
								toId: p.rightArtifactId,
								type: 'precedes'
							})
						).id;
				}
				const detail = await gw.call('POST', '/expansions', ExpansionDetail, {
					targetRelationId: relationId
				});
				return text({
					expansionId: detail.expansion.id,
					relationId,
					depth: detail.expansion.depth
				});
			}
		},
		{
			name: 'expansion_submit_candidate',
			label: 'Submit bridge candidate',
			loadMode: 'essential',
			approval: 'write',
			description:
				'Submit a bridge C that makes both anchors true at once. State the mechanism, explicit assumptions and how each anchor stays true, plus its state contract: preconditions must match the LEFT neighbour’s resulting state, effects must leave what the RIGHT neighbour requires, and never perform the right anchor’s own irreversible event. Validation runs before a human accepts.',
			parameters: CandidateParams,
			async execute(_id, params) {
				const p = CandidateParams.parse(params);
				const detail = await gw.call(
					'POST',
					`/expansions/${p.expansionId}/candidates`,
					ExpansionDetail,
					{
						artifact: {
							kind: 'BRIDGE',
							title: p.title,
							body: p.body,
							structured: {
								mechanism: p.mechanism,
								assumptions: p.assumptions,
								anchorReconciliation: { left: p.leftStaysTrue, right: p.rightStaysTrue }
							}
						},
						transition: {
							preconditions: p.preconditions,
							effects: p.effects,
							assumptions: p.inventedFacts
						}
					}
				);
				const last = detail.candidates.at(-1);
				return text({
					candidateId: last?.id,
					artifactId: last?.artifactId,
					status: 'awaiting review',
					// Continuity issues this candidate would add; blockers must be fixed by a new candidate.
					issues:
						last?.issues.map((i) => ({
							kind: i.kind,
							severity: i.severity,
							explanation: i.explanation
						})) ?? []
				});
			}
		},
		{
			name: 'disclosure_publish',
			label: 'Propose disclosure',
			loadMode: 'essential',
			approval: 'write',
			description:
				'Send a purpose-built shared note to one author (A or B). Never paste the other side verbatim: write what they need to continue. Cite source artifacts with their revisionId. A human approves before delivery.',
			parameters: DisclosureParams,
			async execute(_id, params) {
				const p = DisclosureParams.parse(params);
				const d = await gw.call('POST', '/disclosures', Disclosure, {
					destinationPrincipalId: p.destinationPrincipalId,
					sourceRefs: p.sources,
					sharedPayload: { kind: 'NOTE', title: p.title, body: p.body }
				});
				return text({ disclosureId: d.id, status: d.status });
			}
		}
	];
}

export type ToolHooks = {
	/** Called when C judges an interval sufficiently detailed (run-scoped STOP). */
	onStop?: (relationId: string, reason: string) => void;
};

function stopTool(hooks: ToolHooks): CustomTool {
	return {
		name: 'interval_stop',
		label: 'Stop expanding interval',
		loadMode: 'essential',
		approval: 'read',
		description:
			'Declare an interval sufficiently detailed instead of bridging it: use when a new beat would only restate motions, delay an established outcome, or add no new causal information, character choice or reversal. This is a successful outcome, not a failure.',
		parameters: StopParams,
		async execute(_id, params) {
			const p = StopParams.parse(params);
			hooks.onStop?.(p.relationId, p.reason);
			return text({ relationId: p.relationId, status: 'stopped: sufficient detail' });
		}
	};
}

export function toolsForRole(
	role: AgentRole,
	gw: GatewayClient,
	hooks: ToolHooks = {}
): CustomTool[] {
	return role === 'C' ? [...commonTools(gw), ...bridgeTools(gw), stopTool(hooks)] : commonTools(gw);
}
