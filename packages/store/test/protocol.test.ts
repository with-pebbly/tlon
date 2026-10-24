import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestService, type TestService } from '../src/testing.ts';
import { P, expectCode, makeAgent } from './helpers.ts';

let t: TestService;

beforeAll(async () => {
	t = await createTestService();
});
afterAll(() => t.close());

describe('participants and legacy compatibility', () => {
	it('legacy agents default to executorKind ai; participants default to human', async () => {
		const project = await t.service.createProject(P, { name: 'legacy', domain: 'GENERIC' });
		const agent = await t.service.createAgent(P, project.id, { role: 'A', name: 'old-style' });
		expect(agent.executorKind).toBe('ai');
		const link = await t.service.createParticipant(P, project.id, { role: 'B', name: 'person' });
		expect(link).toMatchObject({ role: 'B', executorKind: 'human' });
		expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now());
		const principal = await t.service.authenticateToken(link.token);
		expect(principal).toMatchObject({ role: 'B', kind: 'AGENT', projectId: project.id });
		await expectCode(
			t.service.createParticipant(P, project.id, { role: 'B', name: 'person' }),
			'INVALID_STATE'
		);
		await expectCode(
			t.service.createParticipant(principal, project.id, { role: 'A', name: 'x' }),
			'FORBIDDEN'
		);
	});

	it('an export without protocol arrays imports and exports as an empty protocol', async () => {
		const project = await t.service.createProject(P, { name: 'old bundle', domain: 'GENERIC' });
		await t.service.createArtifact(P, project.id, { kind: 'EVENT', title: 'one' });
		const bundle = await t.service.exportProject(P, project.id);
		expect(bundle.triangles).toEqual([]);
		const old: Record<string, unknown> = { ...bundle };
		for (const key of [
			'runs',
			'triangles',
			'tasks',
			'factCandidates',
			'factRationales',
			'factAnchors'
		]) {
			delete old[key];
		}
		const result = await t.service.importAsNewProject(P, old, { remapIds: true });
		const state = await t.service.getProtocol(P, result.projectId);
		expect(state).toEqual({ runs: [], triangles: [], tasks: [], factAnchors: [] });
	});

	it('protocol surfaces are closed to A, B and (partly) VALIDATOR', async () => {
		const project = await t.service.createProject(P, { name: 'acl', domain: 'GENERIC' });
		const a = await makeAgent(t.service, project.id, 'A');
		const v = await makeAgent(t.service, project.id, 'VALIDATOR');
		await expectCode(t.service.getProtocol(a.principal, project.id), 'FORBIDDEN');
		await expectCode(
			t.service.startRun(a.principal, project.id, { briefA: 'a', briefB: 'b' }),
			'FORBIDDEN'
		);
		await expectCode(t.service.listTasks(v.principal, project.id), 'FORBIDDEN');
		await expectCode(t.service.listMyTasks(v.principal, project.id), 'FORBIDDEN');
		expect(await t.service.getProtocol(v.principal, project.id)).toEqual({
			runs: [],
			triangles: [],
			tasks: [],
			factAnchors: []
		});
	});
});
