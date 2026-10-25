#!/usr/bin/env bun
/**
 * Organizer post-run analysis and repair of a Block–Fact project:
 *   1. independent state extraction per side (eras, calendar dates, timeless facts,
 *      entities with stable ids, beat functions) — extract.ts;
 *   2. grounded continuity audit per side → findings (quotes verified by the server);
 *   3. repair: every open side-local blocker becomes a `revise_block` task for the side
 *      that owns it; an AI participant of that side revises its own Block through the
 *      task API (it sees only its own line); revised Blocks are re-extracted and the side
 *      is re-audited, up to `--repair-rounds` times;
 *   4. join review: echoes / causal hypotheses / open questions as `ai_review`
 *      connections (never canon);
 *   5. completion report + isolation audit, reader / organizer / chronology exports.
 *
 * Usage: bun packages/agents/src/analyze.ts --project <id> --out ~/Desktop/story.md
 *          [--skip-extract] [--skip-audit] [--repair-rounds 2] [--skip-joins]
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { discoverAuthStorage, ModelRegistry } from '@oh-my-pi/pi-coding-agent';

import {
	AuditReport,
	CompletionReport,
	ConnectionList,
	FindingList,
	IssueList,
	NarrativeConnection,
	ParticipantLink,
	ProjectGraph,
	ProtocolState,
	Task,
	TaskList,
	type ValidationIssue
} from '../../contracts/src/index.ts';
import { storyBeats } from '../../core/src/index.ts';
import { auditChain } from './audit-continuity.ts';
import { apiClient, executeTask } from './participant.ts';
import { reviewJoins } from './review-joins.ts';

const { values } = parseArgs({
	options: {
		project: { type: 'string' },
		out: { type: 'string' },
		'skip-extract': { type: 'boolean', default: false },
		'skip-audit': { type: 'boolean', default: false },
		'repair-rounds': { type: 'string', default: '2' },
		'skip-joins': { type: 'boolean', default: false },
		api: { type: 'string', default: process.env.TLON_API_URL ?? 'http://127.0.0.1:3001' }
	}
});
const projectId = values.project;
const out = values.out;
if (!projectId || !out) throw new Error('--project and --out are required');
const call = apiClient(values.api ?? 'http://127.0.0.1:3001');
const P = `/projects/${projectId}`;
const root = new URL('../../../', import.meta.url).pathname;
const SIDE: Record<string, 'A' | 'B'> = { A_PRIVATE: 'A', B_PRIVATE: 'B' };
/** Repair targets: real story contradictions, not annotation hygiene or creative tension. */
const REPAIRABLE: ReadonlySet<string> = new Set([
	'continuity_violation',
	'fact_conflict',
	'identity_conflict',
	'temporal_order',
	'direction_mismatch',
	'duplicate_event',
	'monotonic_violation'
]);

const run = (args: string[]) => {
	const result = spawnSync(args[0] ?? 'false', args.slice(1), { cwd: root, stdio: 'inherit' });
	if (result.status !== 0) throw new Error(`${args.join(' ')} exited with ${result.status}`);
};
const extract = (mode: string[]) =>
	run(['bun', 'packages/agents/src/extract.ts', '--project', projectId, ...mode]);

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

async function audit(): Promise<number> {
	const graph = await call('GET', `${P}/graph`, ProjectGraph);
	const { triangles } = await call('GET', `${P}/protocol`, ProtocolState);
	const beats = storyBeats({ ...graph, triangles });
	const findings = await call('GET', `${P}/findings`, FindingList);
	const issues = await call('GET', `${P}/issues`, IssueList);
	const results = await Promise.all(
		(['A', 'B'] as const).map(async (side) => {
			const chain = beats
				.filter((b) => SIDE[b.artifact.ownerScope] === side)
				.map((b) => ({ number: b.index, artifact: b.artifact }));
			const ids = new Set(chain.map((b) => b.artifact.id));
			const known = findings.items
				.filter(
					(f) => !f.stale && f.reviseArtifactId !== null && f.artifactIds.every((id) => ids.has(id))
				)
				.map((f) => f.explanation);
			const suspected = issues.items
				.filter(
					(i) =>
						i.dismissal === null &&
						i.source === 'replay' &&
						i.severity === 'blocker' &&
						REPAIRABLE.has(i.kind) &&
						i.artifactIds.every((id) => ids.has(id))
				)
				.map((i) => i.explanation);
			return chain.length === 0
				? []
				: auditChain({
						call,
						projectId: projectId ?? '',
						chain,
						known,
						suspected,
						authStorage,
						modelRegistry
					});
		})
	);
	return results.flat().length;
}

async function repairRound(round: number): Promise<number> {
	const graph = await call('GET', `${P}/graph`, ProjectGraph);
	const byId = new Map(graph.artifacts.map((a) => [a.id, a]));
	const issues = await call('GET', `${P}/issues`, IssueList);
	const sideOf = (issue: ValidationIssue) => {
		const sides = new Set(issue.artifactIds.map((id) => SIDE[byId.get(id)?.ownerScope ?? '']));
		const [only] = sides;
		return sides.size === 1 ? only : undefined;
	};
	const open = issues.items.filter(
		(i) => i.dismissal === null && REPAIRABLE.has(i.kind) && sideOf(i) !== undefined
	);
	// Only the auditor — who read the whole line — decides which Block deviates from what
	// the rest establishes. A computed blocker without an audit verdict is reported, never
	// auto-repaired: two Blocks disagreeing doesn't say which one is wrong. Audit warnings
	// about identity or timeless facts (a narrated "fact" that contradicts the line) are
	// repaired too; other warnings stay with the facilitator.
	const targets = open.filter(
		(i) =>
			i.source === 'audit' &&
			i.reviseArtifactId &&
			(i.severity === 'blocker' || i.kind === 'identity_conflict' || i.kind === 'fact_conflict')
	);
	const unjudged = open.filter(
		(i) => i.severity === 'blocker' && i.source === 'replay' && !targets.includes(i)
	);
	if (unjudged.length > 0) {
		console.log(
			`  ${unjudged.length} computed blocker(s) left for the facilitator (no audit verdict)`
		);
	}
	if (targets.length === 0) return 0;
	console.log(`── repair round ${round}: ${targets.length} side-local problem(s) ──`);
	for (const issue of targets) {
		if (!issue.reviseArtifactId) continue;
		await call('POST', `${P}/issues/request-revision`, Task, {
			issueKey: issue.key,
			artifactId: issue.reviseArtifactId
		});
	}
	// AI writers of each side execute the revision tasks through the participant API.
	const executed = await Promise.all(
		(['A', 'B'] as const).map(async (role) => {
			const link = await call('POST', `${P}/participants`, ParticipantLink, {
				role,
				name: `${role.toLowerCase()}-repair-${round}-${Date.now().toString(36)}`,
				executorKind: 'ai',
				ttlSeconds: 3600
			});
			const tasks = (
				await call('GET', `${P}/tasks/mine`, TaskList, undefined, link.token)
			).items.filter((t) => t.state === 'pending' && t.type === 'revise_block');
			// One Block at a time per side: several problems in one Block revise sequentially.
			for (const task of tasks) {
				await executeTask({
					call,
					projectId: projectId ?? '',
					token: link.token,
					role,
					task,
					authStorage,
					modelRegistry,
					onError: (message) => console.log(`  ✗ ${message}`)
				});
				console.log(`  [${role}] revise_block done`);
			}
			return tasks.length;
		})
	);
	return executed.reduce((n, k) => n + k, 0);
}

if (!values['skip-extract']) {
	console.log('── extraction ──');
	extract([]);
}
if (!values['skip-audit']) {
	console.log('── continuity audit ──');
	console.log(`recorded ${await audit()} grounded finding(s)`);
	for (let round = 1; round <= Number(values['repair-rounds']); round++) {
		const revised = await repairRound(round);
		if (revised === 0) break;
		extract(['--only-stale']);
		console.log(`re-audit: ${await audit()} new finding(s)`);
	}
}

if (!values['skip-joins']) {
	console.log('── join review ──');
	const graph = await call('GET', `${P}/graph`, ProjectGraph);
	const { triangles } = await call('GET', `${P}/protocol`, ProtocolState);
	const existing = await call('GET', `${P}/connections`, ConnectionList);
	// Re-running replaces earlier unapproved AI suggestions; human and approved ones stay.
	for (const c of existing.items.filter(
		(c) => c.source === 'ai_review' && c.approvedBy === null && c.status === 'active'
	)) {
		await call('PATCH', `${P}/connections/${c.id}`, NarrativeConnection, { status: 'rejected' });
	}
	const proposals = await reviewJoins({ graph, triangles, authStorage, modelRegistry });
	for (const p of proposals) await call('POST', `${P}/connections`, NarrativeConnection, p);
	console.log(`recorded ${proposals.length} ai_review connections`);
}

const completion = await call('GET', `${P}/completion`, CompletionReport);
const auditReport = await call('GET', `${P}/audit`, AuditReport);
const issues = await call('GET', `${P}/issues`, IssueList);
const base = out.replace(/\.md$/, '');
run(['pnpm', '-s', 'tlon', 'story', projectId, '-o', out]);
run([
	'pnpm',
	'-s',
	'tlon',
	'story',
	projectId,
	'--annotations',
	'--organizer',
	'-o',
	`${base}-organizer.md`
]);
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
	`${base}-chronology.md`
]);
const open = issues.items.filter((i) => i.dismissal === null && i.severity !== 'info');
console.log(
	JSON.stringify(
		{
			open_blockers: open.filter((i) => i.severity === 'blocker').length,
			open_warnings: open.filter((i) => i.severity === 'warning').length,
			connected_fact_pairs: completion.connectedFactPairs,
			confirmed_cross_branch_causal_paths: completion.confirmedCrossBranchCausalPaths,
			open_questions: completion.openQuestions.length,
			chronology_conflicts: completion.chronologyConflicts,
			certifiable_as: completion.certifiableAs,
			isolation_verified: auditReport.isolationVerified,
			cross_scope_inputs: auditReport.tasks.reduce((n, t) => n + t.crossScopeInputIds.length, 0),
			deny_visible: auditReport.denyChecks.reduce((n, d) => n + d.visibleArtifactIds.length, 0),
			exports: [out, `${base}-organizer.md`, `${base}-chronology.md`]
		},
		null,
		2
	)
);
