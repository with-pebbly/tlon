#!/usr/bin/env bun
/**
 * Organizer post-run analysis of a Block–Fact project (BLOCK_FACT_V2 review):
 *   1. independent state extraction (times, eras, entities, beat functions) — extract.ts;
 *   2. join review: echoes / causal hypotheses / open questions as `ai_review`
 *      connections (never canon; a human approves or rejects them);
 *   3. completion report + isolation audit from the API;
 *   4. reader and organizer exports via `tlon story`.
 *
 * Usage: bun packages/agents/src/analyze.ts --project <id> --out ~/Desktop/story.md
 *          [--skip-extract] [--skip-joins]
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { discoverAuthStorage, ModelRegistry } from '@oh-my-pi/pi-coding-agent';

import {
	ApiErrorBody,
	AuditReport,
	CompletionReport,
	ConnectionList,
	NarrativeConnection,
	ProjectGraph,
	ProtocolState
} from '../../contracts/src/index.ts';
import { reviewJoins } from './review-joins.ts';

const { values } = parseArgs({
	options: {
		project: { type: 'string' },
		out: { type: 'string' },
		'skip-extract': { type: 'boolean', default: false },
		'skip-joins': { type: 'boolean', default: false },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
const projectId = values.project;
if (!projectId || !values.out) throw new Error('--project and --out are required');
const api = values.api ?? 'http://127.0.0.1:3001';
const root = new URL('../../../', import.meta.url).pathname;

async function operator<T>(
	method: string,
	path: string,
	schema: { parse(v: unknown): T },
	body?: unknown
): Promise<T> {
	const response = await fetch(`${api}/api/projects/${projectId}${path}`, {
		method,
		headers: {
			...(process.env.TLON_OPERATOR_TOKEN
				? { authorization: `Bearer ${process.env.TLON_OPERATOR_TOKEN}` }
				: {}),
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

const run = (args: string[]) => {
	const result = spawnSync(args[0]!, args.slice(1), { cwd: root, stdio: 'inherit' });
	if (result.status !== 0) throw new Error(`${args.join(' ')} exited with ${result.status}`);
};

if (!values['skip-extract']) {
	console.log('── extraction ──');
	run(['bun', 'packages/agents/src/extract.ts', '--project', projectId]);
}

if (!values['skip-joins']) {
	console.log('── join review ──');
	const graph = await operator('GET', '/graph', ProjectGraph);
	const { triangles } = await operator('GET', '/protocol', ProtocolState);
	const existing = await operator('GET', '/connections', ConnectionList);
	// Re-running replaces earlier unapproved AI suggestions; human and approved ones stay.
	for (const c of existing.items.filter(
		(c) => c.source === 'ai_review' && c.approvedBy === null && c.status === 'active'
	)) {
		await operator('PATCH', `/connections/${c.id}`, NarrativeConnection, { status: 'rejected' });
	}
	const authStorage = await discoverAuthStorage();
	const modelRegistry = new ModelRegistry(authStorage);
	await modelRegistry.refresh();
	const proposals = await reviewJoins({ graph, triangles, authStorage, modelRegistry });
	for (const p of proposals) await operator('POST', '/connections', NarrativeConnection, p);
	console.log(`recorded ${proposals.length} ai_review connections`);
}

const completion = await operator('GET', '/completion', CompletionReport);
const audit = await operator('GET', '/audit', AuditReport);
const organizer = values.out.replace(/\.md$/, '') + '-organizer.md';
run(['pnpm', '-s', 'tlon', 'story', projectId, '-o', values.out]);
run(['pnpm', '-s', 'tlon', 'story', projectId, '--annotations', '--organizer', '-o', organizer]);
run([
	'pnpm',
	'-s',
	'tlon',
	'story',
	projectId,
	'--annotations',
	'--order',
	'chronological',
	'-o',
	values.out.replace(/\.md$/, '') + '-chronology.md'
]);
console.log(
	JSON.stringify(
		{
			connected_fact_pairs: completion.connectedFactPairs,
			confirmed_cross_branch_causal_paths: completion.confirmedCrossBranchCausalPaths,
			open_questions: completion.openQuestions.length,
			chronology_conflicts: completion.chronologyConflicts,
			blockers: completion.blockers,
			isolation_verified: audit.isolationVerified,
			cross_scope_inputs: audit.tasks.reduce((n, t) => n + t.crossScopeInputIds.length, 0),
			deny_visible: audit.denyChecks.reduce((n, d) => n + d.visibleArtifactIds.length, 0),
			motif_signals: completion.motifSignals.length,
			exports: [values.out, organizer]
		},
		null,
		2
	)
);
