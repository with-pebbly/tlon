import { type CustomTool, z } from '@oh-my-pi/pi-coding-agent';

import {
	type AgentRole,
	ApiErrorBody,
	type Artifact,
	Artifact as ArtifactSchema,
	Disclosure,
	ExpansionDetail,
	ProjectGraph,
	Relation
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

const CreateParams = z.object({
	kind: Kind,
	title: z.string().min(1).max(300),
	body: z.string().max(4000).describe('Markdown prose of the artifact'),
	worldTime: z.string().max(200).optional().describe('When in story time this holds'),
	location: z.string().max(200).optional()
});
const RelationParams = z.object({
	fromId: z.string(),
	toId: z.string(),
	type: z.enum(['precedes', 'causes', 'enables', 'contradicts', 'explains', 'references'])
});
const ExpansionParams = z.object({ leftArtifactId: z.string(), rightArtifactId: z.string() });
const CandidateParams = z.object({
	expansionId: z.string(),
	title: z.string().min(1).max(300),
	body: z.string().max(4000),
	mechanism: z.string().min(1).max(2000),
	assumptions: z.array(z.string().min(1).max(500)).min(1).max(10),
	leftStaysTrue: z.string().min(1).max(1000),
	rightStaysTrue: z.string().min(1).max(1000)
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
				return text({
					artifacts: graph.artifacts.map(brief),
					relations: graph.relations.map((r) => ({
						id: r.id,
						from: r.fromId,
						to: r.toId,
						type: r.type,
						status: r.status
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
				'Create one story artifact (a fact, event, scene, belief...). It is stored in your own scope automatically.',
			parameters: CreateParams,
			async execute(_id, params) {
				const p = CreateParams.parse(params);
				const structured: Record<string, string> = {};
				if (p.worldTime) structured.worldTime = p.worldTime;
				if (p.location) structured.location = p.location;
				const created = await gw.call('POST', '/artifacts', ArtifactSchema, {
					kind: p.kind,
					title: p.title,
					body: p.body,
					structured
				});
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
				'Open a bridge expansion on an ordered artifact pair (left then right). Returns the expansion id.',
			parameters: ExpansionParams,
			async execute(_id, params) {
				const detail = await gw.call(
					'POST',
					'/expansions',
					ExpansionDetail,
					ExpansionParams.parse(params)
				);
				return text({ expansionId: detail.expansion.id, depth: detail.expansion.depth });
			}
		},
		{
			name: 'expansion_submit_candidate',
			label: 'Submit bridge candidate',
			loadMode: 'essential',
			approval: 'write',
			description:
				'Submit a bridge C that makes both anchors true at once. State the mechanism, explicit assumptions and how each anchor stays true. A human reviews it.',
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
						}
					}
				);
				const last = detail.candidates.at(-1);
				return text({
					candidateId: last?.id,
					artifactId: last?.artifactId,
					status: 'awaiting human review'
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

export function toolsForRole(role: AgentRole, gw: GatewayClient): CustomTool[] {
	return role === 'C' ? [...commonTools(gw), ...bridgeTools(gw)] : commonTools(gw);
}
