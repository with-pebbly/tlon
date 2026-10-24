import { LOCAL_HUMAN, type Artifact, type ExpansionDetail, type Relation } from '@tlon/contracts';
import { expect } from 'vitest';

import type { TlonService } from '../src/service.ts';

export const P = LOCAL_HUMAN;

export async function expectCode(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
}

export function bridgeInput(title: string) {
	return {
		artifact: {
			title,
			body: `body of ${title}`,
			structured: {
				mechanism: `mechanism of ${title}`,
				assumptions: ['an assumption'],
				anchorReconciliation: { left: 'left stays true', right: 'right stays true' }
			}
		}
	};
}

export async function fact(
	service: TlonService,
	projectId: string,
	title: string
): Promise<Artifact> {
	return service.createArtifact(P, projectId, { kind: 'FACT', title, status: 'ACCEPTED' });
}

/** Project with anchors A,B and an accepted `contradicts` relation A→B. */
export async function seedPair(service: TlonService, settings?: Record<string, number>) {
	const project = await service.createProject(P, { name: 'test', domain: 'GENERIC', settings });
	const a = await fact(service, project.id, 'A');
	const b = await fact(service, project.id, 'B');
	const relation = await service.createRelation(P, project.id, {
		fromId: a.id,
		toId: b.id,
		type: 'contradicts'
	});
	return { project, a, b, relation };
}

let keyCounter = 0;
export const nextKey = () => `idem-key-${++keyCounter}-${Math.random().toString(36).slice(2, 8)}`;

/** Opens an expansion on `relationId`, submits one candidate and accepts it. */
export async function expandOnce(
	service: TlonService,
	projectId: string,
	relationId: string,
	title: string
) {
	const opened = await service.createExpansion(P, projectId, { targetRelationId: relationId });
	const withCandidate = await service.submitCandidate(
		P,
		projectId,
		opened.expansion.id,
		bridgeInput(title)
	);
	const candidate = withCandidate.candidates[0];
	if (!candidate) throw new Error('candidate missing');
	return service.acceptExpansion(P, projectId, opened.expansion.id, nextKey(), {
		candidateId: candidate.id
	});
}

/** Fully expands a relation `levels` deep; returns accepted expansion ids. */
export async function expandTree(
	service: TlonService,
	projectId: string,
	relation: Relation,
	levels: number,
	prefix = 'C'
): Promise<string[]> {
	if (levels === 0) return [];
	const result = await expandOnce(service, projectId, relation.id, `${prefix}`);
	const ids = [result.expansion.id];
	for (const [index, child] of result.childRelations.entries()) {
		ids.push(...(await expandTree(service, projectId, child, levels - 1, `${prefix}${index}`)));
	}
	return ids;
}

export type Detail = ExpansionDetail;
