import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFractalTree, countAcceptedBridges } from '@tlon/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase, openDatabase } from '../src/db.ts';
import { SEED_PROJECT_ID, seedEarthMars } from '../src/seed.ts';
import { createTlonService } from '../src/service.ts';
import { createTestService, type TestService } from '../src/testing.ts';
import { expandTree, expectCode, P, seedPair } from './helpers.ts';

let t: TestService;
beforeEach(async () => {
	t = await createTestService();
});
afterEach(async () => {
	await t.close();
});

async function populated() {
	const { service } = t;
	const pair = await seedPair(service);
	await expandTree(service, pair.project.id, pair.relation, 2);
	const bundle = await service.exportProject(P, pair.project.id);
	return { ...pair, bundle };
}

describe('export / import', () => {
	it('round-trips into a fresh project with remapped ids, preserving topology and provenance', async () => {
		const { service } = t;
		const { project, bundle } = await populated();
		expect(bundle.format).toBe('tlon.export');
		expect(bundle.artifacts).toHaveLength(2 + 3);

		const copy = await service.createProject(P, { name: 'copy', domain: 'GENERIC' });
		const result = await service.importProject(P, copy.id, bundle, { remapIds: true });
		expect(result).toMatchObject({
			projectId: copy.id,
			artifacts: 5,
			relations: 7,
			expansions: 3,
			remapped: true
		});

		const original = await service.getGraph(P, project.id);
		const imported = await service.getGraph(P, copy.id);
		const originalIds = new Set(original.artifacts.map((a) => a.id));
		expect(imported.artifacts.some((a) => originalIds.has(a.id))).toBe(false);
		expect(imported.artifacts.map((a) => a.title).sort()).toEqual(
			original.artifacts.map((a) => a.title).sort()
		);

		const tree = buildFractalTree(imported);
		expect(tree).toHaveLength(1);
		expect(countAcceptedBridges(tree[0]!)).toBe(3);
		const importedIds = new Set(imported.artifacts.map((a) => a.id));
		for (const relation of imported.relations.filter((r) => r.expansionId !== null)) {
			expect(relation.provenanceArtifactIds).toHaveLength(3);
			expect(relation.provenanceArtifactIds.every((id) => importedIds.has(id))).toBe(true);
		}
		for (const artifact of imported.artifacts) {
			expect(artifact.projectId).toBe(copy.id);
			const revisions = await service.listRevisions(P, copy.id, artifact.id);
			expect(revisions.items[0]?.id).toBe(artifact.headRevisionId);
		}
		expect(imported.expansions.map((e) => e.depth).sort()).toEqual([1, 2, 2]);
	});

	it('preserves ids when importing into another database', async () => {
		const { bundle } = await populated();
		const other = await createTestService();
		try {
			const target = await other.service.createProject(P, { name: 'elsewhere' });
			await other.service.importProject(P, target.id, bundle, {});
			const graph = await other.service.getGraph(P, target.id);
			expect(graph.artifacts.map((a) => a.id).sort()).toEqual(
				bundle.artifacts.map((a) => a.id).sort()
			);
			expect(graph.relations.map((r) => r.id).sort()).toEqual(
				bundle.relations.map((r) => r.id).sort()
			);
			expect(graph.expansions.map((e) => e.id).sort()).toEqual(
				bundle.expansions.map((e) => e.id).sort()
			);
			const exported = await other.service.exportProject(P, target.id);
			expect(exported.artifacts.map((a) => a.headRevisionId).sort()).toEqual(
				bundle.artifacts.map((a) => a.headRevisionId).sort()
			);
		} finally {
			await other.close();
		}
	});

	it('refuses id collisions, non-empty targets, broken references and unknown versions', async () => {
		const { service } = t;
		const { bundle } = await populated();
		const fresh = await service.createProject(P, { name: 'fresh' });
		await expectCode(service.importProject(P, fresh.id, bundle, {}), 'ID_CONFLICT');

		const filled = await service.importProject(P, fresh.id, bundle, { remapIds: true });
		expect(filled.artifacts).toBe(5);
		await expectCode(
			service.importProject(P, fresh.id, bundle, { remapIds: true }),
			'IMPORT_TARGET_NOT_EMPTY'
		);

		const target = await service.createProject(P, { name: 'target' });
		const broken = { ...bundle, artifacts: bundle.artifacts.slice(1) };
		await expect(
			service.importProject(P, target.id, broken, { remapIds: true })
		).rejects.toMatchObject({
			code: 'MISSING_REFERENCE'
		});
		await expectCode(
			service.importProject(P, target.id, { ...bundle, version: 2 }, { remapIds: true }),
			'UNSUPPORTED_EXPORT_VERSION'
		);
		await expectCode(service.importProject(P, target.id, { nope: true }, {}), 'VALIDATION_FAILED');
		// nothing was written by the failed attempts
		expect((await service.getGraph(P, target.id)).artifacts).toHaveLength(0);
	});
});

describe('importAsNewProject', () => {
	it('rolls back on ID_CONFLICT and succeeds with remap', async () => {
		const { service } = t;
		const { bundle } = await populated();
		const before = (await service.listProjects(P)).items.length;
		await expectCode(service.importAsNewProject(P, bundle, {}), 'ID_CONFLICT');
		expect((await service.listProjects(P)).items).toHaveLength(before);
		const result = await service.importAsNewProject(P, bundle, { remapIds: true, name: 'Fresh' });
		expect(result.artifacts).toBe(5);
		const items = (await service.listProjects(P)).items;
		expect(items).toHaveLength(before + 1);
		expect(items.find((p) => p.id === result.projectId)?.name).toBe('Fresh');
	});
});

describe('seed', () => {
	it('creates the Earth/Mars project once and is idempotent', async () => {
		const { service, handle } = t;
		const first = await seedEarthMars(handle.db, P);
		const second = await seedEarthMars(handle.db, P);
		expect(first.id).toBe(SEED_PROJECT_ID);
		expect(second.id).toBe(SEED_PROJECT_ID);
		const graph = await service.getGraph(P, SEED_PROJECT_ID);
		expect(graph.artifacts).toHaveLength(3);
		expect(graph.relations.map((r) => r.type).sort()).toEqual([
			'bridges',
			'bridges',
			'contradicts'
		]);
		expect(graph.expansions).toHaveLength(1);
		expect(graph.expansions[0]?.status).toBe('ACCEPTED');
		expect((await service.listProjects(P)).items).toHaveLength(1);
	});

	it('leaves no partial project when it fails midway, and a re-run completes', async () => {
		const { service, handle } = t;
		let calls = 0;
		const failingIds = () => {
			calls += 1;
			if (calls === 6) throw new Error('simulated crash');
			return randomUUID();
		};
		await expect(seedEarthMars(handle.db, P, { newId: failingIds })).rejects.toThrow(
			'simulated crash'
		);
		expect(calls).toBeGreaterThanOrEqual(6);
		expect((await service.listProjects(P)).items).toHaveLength(0);
		await seedEarthMars(handle.db, P);
		expect((await service.getGraph(P, SEED_PROJECT_ID)).artifacts).toHaveLength(3);
	});
});

describe('persistence', () => {
	it('data written to a pglite directory survives close and reopen', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'tlon-store-'));
		try {
			const url = `pglite:${dir}`;
			const first = await openDatabase(url);
			await migrateDatabase(first);
			const project = await createTlonService(first.db).createProject(P, { name: 'persisted' });
			await first.close();

			const second = await openDatabase(url);
			await migrateDatabase(second); // migrating twice is a no-op
			const projects = await createTlonService(second.db).listProjects(P);
			expect(projects.items.map((p) => p.id)).toEqual([project.id]);
			await second.close();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
