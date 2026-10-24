import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentTokens, artifacts, auditEvents, disclosures, grants } from '../src/schema.ts';
import { createTestService, type TestService } from '../src/testing.ts';
import { expectCode, makeAgent, P } from './helpers.ts';

const T0 = Date.parse('2026-01-01T00:00:00Z');
let clock: number;
let forcedId: string | null;
let t: TestService;

beforeEach(async () => {
	clock = T0;
	forcedId = null;
	t = await createTestService({
		now: () => new Date(clock),
		newId: () => forcedId ?? randomUUID()
	});
});
afterEach(async () => {
	await t.close();
});

/** Project with A, B, C agents; A owns a1 (A_PRIVATE), B owns b1 (B_PRIVATE). */
async function world() {
	const { service } = t;
	const project = await service.createProject(P, { name: 'gw', domain: 'GENERIC' });
	const a = await makeAgent(service, project.id, 'A');
	const b = await makeAgent(service, project.id, 'B');
	const c = await makeAgent(service, project.id, 'C');
	const a1 = await service.createArtifact(a.principal, project.id, { kind: 'NOTE', title: 'a1' });
	const b1 = await service.createArtifact(b.principal, project.id, {
		kind: 'NOTE',
		title: 'b1 secret',
		body: 'b1 secret body'
	});
	return { service, project, a, b, c, a1, b1 };
}

const payload = {
	kind: 'NOTE' as const,
	title: 'shared summary',
	body: 'sanitized',
	structured: {}
};

describe('disclosure publish transaction', () => {
	it('creates the C_SHARED artifact, grants only it to the destination and never the sources', async () => {
		const { service, project, a, b, c, b1 } = await world();
		const proposed = await service.proposeDisclosure(c.principal, project.id, {
			destinationPrincipalId: a.agentId,
			sourceRefs: [{ artifactId: b1.id, revisionId: b1.headRevisionId }],
			sharedPayload: payload
		});
		expect(proposed.status).toBe('PENDING');
		expect(proposed.fromPrincipalId).toBe(c.principal.id);
		expect(await service.listArtifacts(a.principal, project.id)).toMatchObject({
			items: [{ title: 'a1' }]
		});

		const published = await service.reviewDisclosure(P, project.id, proposed.id, {
			decision: 'PUBLISH'
		});
		expect(published).toMatchObject({ status: 'PUBLISHED', reviewedBy: P.id });
		const sharedId = published.sharedArtifactId as string;

		const shared = await service.getArtifact(a.principal, project.id, sharedId);
		expect(shared).toMatchObject({
			ownerScope: 'C_SHARED',
			creatorRole: 'C',
			status: 'ACCEPTED',
			title: 'shared summary',
			version: 1
		});
		const revisions = await service.listRevisions(a.principal, project.id, sharedId);
		expect(revisions.items.map((r) => r.reason)).toEqual([`disclosure ${proposed.id}`]);

		const rows = await t.handle.db.select().from(grants);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			granteePrincipalId: a.agentId,
			artifactId: sharedId,
			permission: 'READ',
			revokedAt: null
		});

		// Source stays hidden for A; B never sees the shared artifact.
		await expectCode(service.getArtifact(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');
		await expectCode(service.listRevisions(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');
		await expectCode(service.getArtifact(b.principal, project.id, sharedId), 'ARTIFACT_NOT_FOUND');
		const aList = await service.listArtifacts(a.principal, project.id);
		expect(aList.items.map((x) => x.id).sort()).toEqual([sharedId, aList.items[0]!.id].sort());
		expect(aList.items.map((x) => x.id)).not.toContain(b1.id);

		// A sees its inbound disclosure without the cited sources or redaction note.
		const inbound = await service.listDisclosures(a.principal, project.id);
		expect(inbound.items).toHaveLength(1);
		expect(inbound.items[0]).toMatchObject({ sourceRefs: [], redactionNote: null });
		expect((await service.listDisclosures(b.principal, project.id)).items).toEqual([]);
		expect((await service.listDisclosures(c.principal, project.id)).items[0]!.sourceRefs).toEqual([
			{ artifactId: b1.id, revisionId: b1.headRevisionId }
		]);
	});

	it('rolls everything back when a step fails and can be retried', async () => {
		const { service, project, a, c, a1, b1 } = await world();
		const proposed = await service.proposeDisclosure(c.principal, project.id, {
			destinationPrincipalId: a.agentId,
			sourceRefs: [{ artifactId: b1.id, revisionId: b1.headRevisionId }],
			sharedPayload: payload
		});
		const before = (await t.handle.db.select().from(artifacts)).length;

		// Every generated id collides with an existing revision id → the revision insert fails
		// after the artifact insert, so the whole publish must roll back.
		forcedId = a1.headRevisionId;
		await expect(
			service.reviewDisclosure(P, project.id, proposed.id, { decision: 'PUBLISH' })
		).rejects.toBeDefined();
		forcedId = null;

		expect((await t.handle.db.select().from(artifacts)).length).toBe(before);
		expect(await t.handle.db.select().from(grants)).toEqual([]);
		const [row] = await t.handle.db
			.select()
			.from(disclosures)
			.where(eq(disclosures.id, proposed.id));
		expect(row).toMatchObject({ status: 'PENDING', sharedArtifactId: null, reviewedBy: null });

		const published = await service.reviewDisclosure(P, project.id, proposed.id, {
			decision: 'PUBLISH'
		});
		expect(published.status).toBe('PUBLISHED');
		expect(await t.handle.db.select().from(grants)).toHaveLength(1);
	});

	it('is human-only, final, and REJECT shares nothing', async () => {
		const { service, project, a, c, b1 } = await world();
		const proposed = await service.proposeDisclosure(c.principal, project.id, {
			destinationPrincipalId: a.agentId,
			sourceRefs: [{ artifactId: b1.id, revisionId: b1.headRevisionId }],
			sharedPayload: payload
		});
		await expectCode(
			service.reviewDisclosure(c.principal, project.id, proposed.id, { decision: 'PUBLISH' }),
			'FORBIDDEN'
		);
		await expectCode(
			service.reviewDisclosure(a.principal, project.id, proposed.id, { decision: 'PUBLISH' }),
			'FORBIDDEN'
		);
		const rejected = await service.reviewDisclosure(P, project.id, proposed.id, {
			decision: 'REJECT',
			reason: 'too revealing'
		});
		expect(rejected).toMatchObject({ status: 'REJECTED', sharedArtifactId: null });
		expect(await t.handle.db.select().from(grants)).toEqual([]);
		expect((await service.listDisclosures(a.principal, project.id)).items).toEqual([]);
		await expectCode(
			service.reviewDisclosure(P, project.id, proposed.id, { decision: 'PUBLISH' }),
			'INVALID_STATE'
		);
		await expectCode(
			service.reviewDisclosure(P, project.id, randomUUID(), { decision: 'PUBLISH' }),
			'DISCLOSURE_NOT_FOUND'
		);
	});

	it('validates destination and pinned source revisions on propose', async () => {
		const { service, project, a, c, a1, b1 } = await world();
		const other = await service.createProject(P, { name: 'other', domain: 'GENERIC' });
		const foreign = await makeAgent(service, other.id, 'A');
		const sourceRefs = [{ artifactId: b1.id, revisionId: b1.headRevisionId }];

		await expectCode(
			service.proposeDisclosure(c.principal, project.id, {
				destinationPrincipalId: c.agentId,
				sourceRefs,
				sharedPayload: payload
			}),
			'VALIDATION_FAILED'
		);
		await expectCode(
			service.proposeDisclosure(c.principal, project.id, {
				destinationPrincipalId: foreign.agentId,
				sourceRefs,
				sharedPayload: payload
			}),
			'PRINCIPAL_NOT_FOUND'
		);
		// A revision of a different artifact is not a pin of b1.
		await expectCode(
			service.proposeDisclosure(c.principal, project.id, {
				destinationPrincipalId: a.agentId,
				sourceRefs: [{ artifactId: b1.id, revisionId: a1.headRevisionId }],
				sharedPayload: payload
			}),
			'REVISION_NOT_FOUND'
		);
		await expectCode(
			service.proposeDisclosure(c.principal, project.id, {
				destinationPrincipalId: a.agentId,
				sourceRefs: [{ artifactId: randomUUID(), revisionId: randomUUID() }],
				sharedPayload: payload
			}),
			'ARTIFACT_NOT_FOUND'
		);
		await expectCode(
			service.proposeDisclosure(a.principal, project.id, {
				destinationPrincipalId: a.agentId,
				sourceRefs,
				sharedPayload: payload
			}),
			'FORBIDDEN'
		);
	});
});

describe('grants', () => {
	it('revocation and expiry are prospective and immediate', async () => {
		const { service, project, a, b1 } = await world();
		await expectCode(service.getArtifact(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');

		const grant = await service.createGrant(P, project.id, {
			granteePrincipalId: a.agentId,
			artifactId: b1.id
		});
		expect((await service.getArtifact(a.principal, project.id, b1.id)).id).toBe(b1.id);
		expect((await service.listArtifacts(a.principal, project.id)).items.map((x) => x.id)).toContain(
			b1.id
		);
		// Readable but not writable: the grant is READ only.
		await expectCode(
			service.updateArtifact(a.principal, project.id, b1.id, b1.headRevisionId, { title: 'x' }),
			'FORBIDDEN'
		);

		const revoked = await service.revokeGrant(P, project.id, grant.id);
		expect(revoked.revokedAt).not.toBeNull();
		await expectCode(service.getArtifact(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');
		await expectCode(service.listRevisions(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');
		expect(
			(await service.listArtifacts(a.principal, project.id)).items.map((x) => x.id)
		).not.toContain(b1.id);
		// Revoking twice keeps the first timestamp.
		expect((await service.revokeGrant(P, project.id, grant.id)).revokedAt).toBe(revoked.revokedAt);

		const expiring = await service.createGrant(P, project.id, {
			granteePrincipalId: a.agentId,
			artifactId: b1.id,
			expiresAt: new Date(clock + 60_000).toISOString()
		});
		expect((await service.getArtifact(a.principal, project.id, b1.id)).id).toBe(b1.id);
		clock += 120_000;
		await expectCode(service.getArtifact(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');
		expect((await service.listGrants(P, project.id)).items.map((g) => g.id)).toEqual([
			grant.id,
			expiring.id
		]);
		await expectCode(service.revokeGrant(P, project.id, randomUUID()), 'GRANT_NOT_FOUND');
	});

	it('is human-only and needs an existing artifact and agent of the same project', async () => {
		const { service, project, a, c, b1 } = await world();
		await expectCode(
			service.createGrant(c.principal, project.id, {
				granteePrincipalId: a.agentId,
				artifactId: b1.id
			}),
			'FORBIDDEN'
		);
		await expectCode(service.listGrants(a.principal, project.id), 'FORBIDDEN');
		await expectCode(
			service.createGrant(P, project.id, {
				granteePrincipalId: a.agentId,
				artifactId: randomUUID()
			}),
			'ARTIFACT_NOT_FOUND'
		);
		await expectCode(
			service.createGrant(P, project.id, { granteePrincipalId: randomUUID(), artifactId: b1.id }),
			'PRINCIPAL_NOT_FOUND'
		);
	});
});

describe('agent principals and tokens', () => {
	it('stores only the sha256 of a token and authenticates by it', async () => {
		const { service, project, a } = await world();
		const [stored] = await t.handle.db
			.select()
			.from(agentTokens)
			.where(eq(agentTokens.id, a.tokenId));
		expect(stored?.tokenHash).toBe(createHash('sha256').update(a.token).digest('hex'));
		expect(stored?.tokenHash).not.toContain(a.token);
		expect(a.principal).toEqual({
			id: a.agentId,
			kind: 'AGENT',
			role: 'A',
			projectId: project.id
		});
		await expectCode(service.authenticateToken('tlon_nope'), 'UNAUTHENTICATED');
		await expectCode(service.authenticateToken('not-a-token'), 'UNAUTHENTICATED');
	});

	it('expires, revokes and disables with identical UNAUTHENTICATED errors', async () => {
		const { service, project, a, b } = await world();
		const short = await service.issueToken(P, project.id, a.agentId, { ttlSeconds: 60 });
		await service.authenticateToken(short.token);
		clock += 61_000;
		await expectCode(service.authenticateToken(short.token), 'UNAUTHENTICATED');

		await service.revokeToken(P, project.id, a.agentId, a.tokenId);
		await expectCode(service.authenticateToken(a.token), 'UNAUTHENTICATED');

		const disabled = await service.disableAgent(P, project.id, b.agentId);
		expect(disabled.disabledAt).not.toBeNull();
		await expectCode(service.authenticateToken(b.token), 'UNAUTHENTICATED');
		await expectCode(service.issueToken(P, project.id, b.agentId, {}), 'INVALID_STATE');
		await expectCode(service.createAgent(P, project.id, { role: 'A', name: 'a' }), 'INVALID_STATE');
	});

	it('limits agent admin to humans and binds agents to their project', async () => {
		const { service, project, a, c } = await world();
		const other = await service.createProject(P, { name: 'other', domain: 'GENERIC' });
		await expectCode(service.listAgents(a.principal, project.id), 'FORBIDDEN');
		await expectCode(
			service.createAgent(c.principal, project.id, { role: 'A', name: 'x' }),
			'FORBIDDEN'
		);
		await expectCode(service.listAgents(c.principal, other.id), 'PROJECT_NOT_FOUND');
		await expectCode(service.createProject(c.principal, { name: 'nope' }), 'FORBIDDEN');
		expect((await service.listProjects(c.principal)).items.map((p) => p.id)).toEqual([project.id]);
		expect((await service.listAgents(P, project.id)).items.map((x) => x.role)).toEqual([
			'A',
			'B',
			'C'
		]);
		expect(await service.whoami(c.principal)).toEqual({
			principalId: c.agentId,
			kind: 'AGENT',
			role: 'C',
			projectId: project.id
		});
	});
});

describe('audit', () => {
	it('records denials and hidden reads of the actor and exposes them newest first', async () => {
		const { service, project, a, b1 } = await world();
		await expectCode(service.getArtifact(a.principal, project.id, b1.id), 'ARTIFACT_NOT_FOUND');
		await expectCode(service.exportProject(a.principal, project.id), 'FORBIDDEN');
		await expectCode(service.getArtifact(a.principal, randomUUID(), b1.id), 'PROJECT_NOT_FOUND');

		const page = await service.listOwnAudit(a.principal, project.id, { limit: 100 });
		const byOutcome = page.items.map((e) => [e.operation, e.outcome]);
		expect(byOutcome).toEqual(
			expect.arrayContaining([
				['getArtifact', 'HIDDEN'],
				['exportProject', 'DENIED'],
				['artifact.create', 'SUCCESS']
			])
		);
		const times = page.items.map((e) => e.createdAt);
		expect([...times].sort().reverse()).toEqual(times);
		const hidden = page.items.find(
			(e) => e.operation === 'getArtifact' && e.metadata.code === 'ARTIFACT_NOT_FOUND'
		);
		expect(hidden?.subjectId).toBe(b1.id);
		expect(hidden?.metadata).toEqual({ code: 'ARTIFACT_NOT_FOUND' });
		// Only IDs: no titles or bodies anywhere in the trail.
		expect(JSON.stringify(page)).not.toContain('b1 secret');

		const first = await service.listOwnAudit(a.principal, project.id, { limit: 1 });
		expect(first.items).toHaveLength(1);
		const second = await service.listOwnAudit(a.principal, project.id, {
			limit: 1,
			cursor: first.nextCursor
		});
		expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
		// Another actor never sees these events.
		expect(
			(await service.listOwnAudit(P, project.id)).items.every(
				(e) => e.operation !== 'exportProject'
			)
		).toBe(true);
		const rows = await t.handle.db.select().from(auditEvents);
		expect(rows.some((r) => r.actorId === a.principal.id && r.outcome === 'DENIED')).toBe(true);
	});

	it('records unauthenticated attempts without any credential material', async () => {
		const { service } = await world();
		await expectCode(service.authenticateToken('tlon_secret-value'), 'UNAUTHENTICATED');
		await service.recordUnauthenticated('no_credentials');
		const rows = await t.handle.db.select().from(auditEvents);
		const denied = rows.filter((r) => r.outcome === 'UNAUTHENTICATED');
		expect(denied.map((r) => r.metadata)).toEqual([
			{ reason: 'unknown' },
			{ reason: 'no_credentials' }
		]);
		expect(JSON.stringify(rows)).not.toContain('secret-value');
	});
});
