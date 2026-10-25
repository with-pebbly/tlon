#!/usr/bin/env bun
/**
 * Back-fills state annotations for an existing scenario (independent extraction, see
 * extraction.ts). The operator stores proposals as `extracted`, unreviewed annotations
 * pinned to each beat's current revision; artifacts are never modified. Prints every
 * non-info issue and writes the full list to `--report` (Markdown) if given.
 * Exit code 2 when some beats are still unannotated after the retry.
 *
 * Usage: bun packages/agents/src/extract.ts --project <id> [--only-missing] [--report file.md]
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { discoverAuthStorage, ModelRegistry } from '@oh-my-pi/pi-coding-agent';

import {
	AgentPrincipal,
	ApiErrorBody,
	IssueList,
	IssuedToken,
	ProjectGraph,
	ProtocolState,
	TransitionAnnotation
} from '../../contracts/src/index.ts';
import { storyBeats } from '../../core/src/index.ts';
import { extractTransitions, vocabularyOf } from './extraction.ts';
import { GatewayClient } from './gateway-tools.ts';

const SIDE: Record<string, string> = { A_PRIVATE: 'A', B_PRIVATE: 'B' };

const { values } = parseArgs({
	options: {
		project: { type: 'string' },
		'only-missing': { type: 'boolean', default: false },
		/** Missing annotations plus annotations of an older revision (after a repair). */
		'only-stale': { type: 'boolean', default: false },
		report: { type: 'string' },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
if (!values.project) throw new Error('--project is required');
const projectId = values.project;
const api = values.api ?? 'http://127.0.0.1:3001';

async function operator<T>(
	method: string,
	path: string,
	schema: { parse(v: unknown): T },
	body?: unknown
): Promise<T> {
	const response = await fetch(`${api}/api/projects/${projectId}${path}`, {
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

const graph = await operator('GET', '/graph', ProjectGraph);
// Block–Fact projects: triangles define the reading order (Facts are never beats).
const { triangles } = await operator('GET', '/protocol', ProtocolState);
const annotatedRevision = new Map(
	graph.transitions.map((t) => [t.artifactId, t.artifactRevisionId])
);
const beats = storyBeats({ ...graph, triangles });
const todo = beats.filter((b) =>
	values['only-stale']
		? annotatedRevision.get(b.artifact.id) !== b.artifact.headRevisionId
		: !values['only-missing'] || !annotatedRevision.has(b.artifact.id)
);
console.log(`${beats.length} beats in story order, ${todo.length} to annotate`);

// The validator principal reads through the gateway with its own token: extraction sees
// exactly what a VALIDATOR may see, nothing the operator could leak in.
const principal = await operator('POST', '/agents', AgentPrincipal, {
	role: 'VALIDATOR',
	name: `extract-${Date.now().toString(36)}`
});
const token = (
	await operator('POST', `/agents/${principal.id}/tokens`, IssuedToken, { ttlSeconds: 3600 })
).token;
const visible = new Map(
	(
		await new GatewayClient(api, projectId, token).call('GET', '/graph', ProjectGraph)
	).artifacts.map((a) => [a.id, a])
);

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();
// One session per side, reading that side's whole chain at once: timeless facts (kinship,
// authorship, past dates) and entity ids stay consistent across the chain, and a
// Block–Fact side never shares an extraction context with the other side.
const todoIds = new Set(todo.map((b) => b.artifact.id));
const known = new Map(graph.transitions.map((t) => [t.artifactId, t.transition]));
const sideOf = (scope: string) => SIDE[scope] ?? 'other';
const sides = Object.entries(Object.groupBy(beats, (b) => sideOf(b.artifact.ownerScope))).filter(
	([, chain]) => chain?.some((b) => todoIds.has(b.artifact.id))
);
const proposals = new Map(
	(
		await Promise.all(
			sides.map(async ([, chain]) => {
				const list = (chain ?? []).flatMap((b) => {
					const a = visible.get(b.artifact.id);
					const mechanism = a?.structured.mechanism;
					const knownContract = known.get(b.artifact.id);
					if (!a) return [];
					return [
						{
							id: a.id,
							order: b.index,
							title: a.title,
							body: a.body,
							...(typeof mechanism === 'string' ? { mechanism } : {}),
							...(todoIds.has(a.id) ? {} : { contextOnly: true, knownContract })
						}
					];
				});
				const result = await extractTransitions({
					beats: list,
					vocabulary: values['only-missing'] || values['only-stale'] ? vocabularyOf(graph) : {},
					authStorage,
					modelRegistry,
					chunk: Math.max(6, list.length)
				});
				return [...result];
			})
		)
	).flat()
);

let stored = 0;
for (const b of todo) {
	const t = proposals.get(b.artifact.id);
	if (!t) continue;
	await operator('PUT', `/artifacts/${b.artifact.id}/transition`, TransitionAnnotation, {
		artifactRevisionId: b.artifact.headRevisionId,
		transition: t,
		source: 'extracted',
		reviewed: false
	});
	stored++;
}
console.log(`stored ${stored}/${todo.length} extracted annotations (unreviewed)`);

const issues = await operator('GET', '/issues', IssueList);
const titles = new Map(graph.artifacts.map((a) => [a.id, a.title]));
const order = new Map(beats.map((b) => [b.artifact.id, b.index]));
const lines = issues.items
	.filter((i) => i.dismissal === null)
	.toSorted(
		(a, b) =>
			Math.min(...a.artifactIds.map((id) => order.get(id) ?? 0)) -
			Math.min(...b.artifactIds.map((id) => order.get(id) ?? 0))
	)
	.map((i) => {
		const where = i.artifactIds
			.map((id) => `#${order.get(id) ?? '?'} ${titles.get(id)}`)
			.join(' ↔ ');
		return `- **[${i.severity}] ${i.kind}** ${i.stateKey ?? ''}\n  ${where}\n  ${i.explanation}`;
	});
for (const l of lines.filter((x) => !x.includes('[info]'))) console.log(l);
if (values.report) {
	await writeFile(
		values.report,
		`# Continuity issues — ${graph.project.name}\n\n${lines.join('\n')}\n`
	);
	console.log(`report: ${values.report}`);
}
const counts = Object.groupBy(issues.items, (i) => `${i.kind}/${i.severity}`);
console.log(
	JSON.stringify(
		{
			byKind: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v?.length ?? 0])),
			unannotated: issues.unannotatedArtifactIds.length
		},
		null,
		2
	)
);
if (issues.unannotatedArtifactIds.length > 0) process.exitCode = 2;
