import { TlonError, type Principal, type Project } from '@tlon/contracts';

import type { Db } from './db.ts';
import type { ServiceOptions } from './internal.ts';
import { createTlonService, type TlonService } from './service.ts';

/** Fixed id: re-running the seed is a no-op that returns the existing project. */
export const SEED_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SEED_ACCEPT_KEY = 'seed-earth-mars-v1';

/**
 * Earth/Mars example (ARCHITECTURE §2): A "born on Earth" contradicts B "born on Mars";
 * the expansion of that relation has one accepted bridge C. The two child relations
 * A→C and C→B are left unexpanded, ready for the next recursion level.
 *
 * Runs in one transaction (service calls nest as savepoints), so a failure leaves no
 * partial project behind and a re-run starts from scratch.
 */
export async function seedEarthMars(
	db: Db,
	principal: Principal,
	options: ServiceOptions = {}
): Promise<Project> {
	try {
		return await createTlonService(db, options).getProject(principal, SEED_PROJECT_ID);
	} catch (error) {
		if (!(error instanceof TlonError) || error.code !== 'PROJECT_NOT_FOUND') throw error;
	}
	return db.transaction((tx) => buildSeed(createTlonService(tx, options), principal));
}

async function buildSeed(service: TlonService, principal: Principal): Promise<Project> {
	const project = await service.createProject(
		principal,
		{ name: 'Earth / Mars', domain: 'NARRATIVE' },
		{ id: SEED_PROJECT_ID }
	);
	const a = await service.createArtifact(principal, project.id, {
		kind: 'FACT',
		title: 'The protagonist was born on Earth',
		body: 'Assertion recorded in an Earth archive.',
		status: 'ACCEPTED',
		structured: {
			subject: 'protagonist',
			predicate: 'born_on',
			object: 'Earth',
			perspective: 'Earth archive',
			epistemicStatus: 'CLAIM'
		}
	});
	const b = await service.createArtifact(principal, project.id, {
		kind: 'FACT',
		title: 'The protagonist was born on Mars',
		body: 'Assertion recorded in a Martian archive.',
		status: 'ACCEPTED',
		structured: {
			subject: 'protagonist',
			predicate: 'born_on',
			object: 'Mars',
			perspective: 'Martian archive',
			epistemicStatus: 'CLAIM'
		}
	});
	const relation = await service.createRelation(principal, project.id, {
		fromId: a.id,
		toId: b.id,
		type: 'contradicts'
	});
	const opened = await service.createExpansion(principal, project.id, {
		targetRelationId: relation.id
	});
	const withCandidate = await service.submitCandidate(principal, project.id, opened.expansion.id, {
		artifact: {
			kind: 'BRIDGE',
			title: 'Original on Earth, clone activated on Mars',
			body:
				'The original was born on Earth; a clone with the same legal identity was activated on Mars, ' +
				"where 'birth' is the registered activation event.",
			structured: {
				mechanism:
					'Identity split: a clone sharing the original’s legal identity was activated on Mars, ' +
					'and the Martian registry records that activation as the "birth".',
				assumptions: [
					'Human cloning with identity transfer exists in this world',
					'The clone inherited the original’s legal identity',
					"The Martian registry defines 'birth' as the activation event"
				],
				anchorReconciliation: {
					left: 'A stays true: the original was born on Earth.',
					right: "B stays true: on Mars, 'birth' means the registered activation of the clone."
				}
			}
		}
	});
	const candidate = withCandidate.candidates[0];
	if (!candidate) throw new TlonError('INTERNAL', 'seed candidate was not created');
	await service.acceptExpansion(principal, project.id, opened.expansion.id, SEED_ACCEPT_KEY, {
		candidateId: candidate.id
	});
	return service.getProject(principal, project.id);
}
