/**
 * Regression set from the user review of «Белки начали массово мигрировать» (frozen as
 * docs/samples/belki-v1/project-analyzed.tlon.json: the generated story before repair,
 * with its extracted annotations and grounded audit findings). Every defect the review
 * listed must stay visible after import: two P0 identity/addressee contradictions, the
 * death-date conflict, the impossible letter count, the chronology order and the
 * certification level.
 */
import { readFile } from 'node:fs/promises';

import type {
	CompletionReport,
	ImportResult,
	IssueList,
	ProjectGraph,
	ProtocolState,
	ValidationIssue
} from '@tlon/contracts';
import { chronologicalOrder, compareBeatTime, storyBeats } from '@tlon/core';
import { createTestService, type TestService } from '@tlon/store/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';

let t: TestService;
let app: FastifyInstance;
let projectId: string;
let issues: ValidationIssue[];
let number: Map<string, number>;
let graph: ProjectGraph;
let protocol: ProtocolState;

async function get<T>(url: string): Promise<T> {
	const res = await app.inject({ method: 'GET', url: `/api${url}` });
	expect(res.statusCode).toBe(200);
	return JSON.parse(res.body) as T;
}

const blocks = (issue: ValidationIssue) =>
	issue.artifactIds.map((id) => number.get(id)).toSorted((a, b) => (a ?? 0) - (b ?? 0));
const quoted = (issue: ValidationIssue, fragment: string) =>
	issue.evidence.some((e) => e.quote.includes(fragment));

beforeAll(async () => {
	t = await createTestService();
	app = buildApp({ service: t.service });
	const bundle = await readFile(
		new URL('../../../docs/samples/belki-v1/project-analyzed.tlon.json', import.meta.url),
		'utf8'
	);
	const res = await app.inject({
		method: 'POST',
		url: '/api/projects/import?remapIds=true',
		payload: JSON.parse(bundle) as object
	});
	expect(res.statusCode).toBe(201);
	projectId = (JSON.parse(res.body) as ImportResult).projectId;
	graph = await get<ProjectGraph>(`/projects/${projectId}/graph`);
	protocol = await get<ProtocolState>(`/projects/${projectId}/protocol`);
	number = new Map(
		storyBeats({ ...graph, triangles: protocol.triangles }).map((b) => [b.artifact.id, b.index])
	);
	issues = (await get<IssueList>(`/projects/${projectId}/issues`)).items.filter(
		(i) => i.dismissal === null
	);
}, 60_000);

afterAll(async () => {
	await app.close();
	await t.close();
});

describe('«Белки» v1 regression (user review)', () => {
	it('P0: Ривка, Yakov’s mother, later Рива, the letter writer’s wife (#17 vs #21–22)', () => {
		const hit = issues.find(
			(i) =>
				i.kind === 'identity_conflict' &&
				i.severity === 'blocker' &&
				quoted(i, 'Матери, Ривке Шульман') &&
				quoted(i, 'Муж Ривы')
		);
		expect(hit?.source).toBe('audit');
		expect(blocks(hit!)).toEqual(expect.arrayContaining([17, 21]));
	});

	it('P0: Ганна’s reply goes to Моисей Аронович though Яков Моисеевич wrote (#22 vs #23)', () => {
		const replay = issues.find(
			(i) =>
				i.kind === 'fact_conflict' && i.source === 'replay' && i.stateKey?.endsWith('.addressee')
		);
		expect(replay?.severity).toBe('blocker');
		expect(blocks(replay!)).toEqual([22, 23]);
		expect(issues.some((i) => i.source === 'audit' && quoted(i, 'Моисею Ароновичу Шульману'))).toBe(
			true
		);
	});

	it('P1: the family’s death is November 1941 in #20 and September 1941 in #23', () => {
		const replay = issues.find(
			(i) => i.kind === 'fact_conflict' && i.source === 'replay' && blocks(i).join() === '20,23'
		);
		expect(replay?.severity).toBe('blocker');
		expect(
			issues.some(
				(i) =>
					i.source === 'audit' && quoted(i, 'в ноябре сорок первого') && quoted(i, 'в сентябре')
			)
		).toBe(true);
	});

	it('P1: nine letters seen in July although the ninth arrived on 21 August (#22 vs #19–20)', () => {
		const hit = issues.find(
			(i) =>
				i.kind === 'temporal_order' && quoted(i, 'ещё в июле') && quoted(i, '21 августа 1944 года')
		);
		expect(hit?.severity).toBe('blocker');
		expect(blocks(hit!)).toEqual(expect.arrayContaining([20, 22]));
	});

	it('P1: the chronology view puts January #17 before August #19', () => {
		const transitions = new Map(graph.transitions.map((x) => [x.artifactId, x.transition]));
		const { dated } = chronologicalOrder(
			storyBeats({ ...graph, triangles: protocol.triangles }),
			transitions
		);
		const order = dated.map((e) => e.beat.index);
		// Decided by the calendar month, not by the presentation-order fallback.
		const idOf = (n: number) => [...number].find(([, k]) => k === n)?.[0] ?? '';
		const t17 = transitions.get(idOf(17))?.time;
		const t19 = transitions.get(idOf(19))?.time;
		expect(t17 && t19 ? compareBeatTime(t17, t19) : null).toMatchObject({ component: 'month' });
		expect(t17 && t19 ? compareBeatTime(t17, t19)?.delta : 0).toBeLessThan(0);
		expect(order.indexOf(17)).toBeGreaterThanOrEqual(0);
		expect(order.indexOf(17)).toBeLessThan(order.indexOf(19));
	});

	it('P1: no policy is certifiable while these contradictions are open', async () => {
		const report = await get<CompletionReport>(
			`/projects/${projectId}/completion?policy=exploratory`
		);
		expect(report.certifiable).toBe(false);
		expect(report.certifiableAs).toEqual({
			exploratory: false,
			coherent_open_mystery: false,
			causally_connected: false,
			resolved: false
		});
		expect(report.blockers).toBeGreaterThanOrEqual(4);
	});
});
