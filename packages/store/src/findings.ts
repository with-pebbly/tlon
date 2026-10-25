import {
	type ContinuityFinding,
	CreateFindingInput,
	type FindingList,
	TlonError,
	type Principal
} from '@tlon/contracts';
import { inArray } from 'drizzle-orm';

import { audit, authorize, parseInput, type Ctx } from './internal.ts';
import { loadFindings, selectArtifacts, toFinding } from './projections.ts';
import { artifacts, continuityFindings } from './schema.ts';

/** Curly, guillemet and straight double quotes all compare as one mark. */
const QUOTE_MARKS = /[«»„“”"]/g;

/** Whitespace runs collapse and quote marks unify, so a copied quote survives re-wrapping. */
const normalise = (text: string): string =>
	text.replace(QUOTE_MARKS, '"').replace(/\s+/g, ' ').trim();

export function findingMethods(ctx: Ctx) {
	const { db } = ctx;
	return {
		async listFindings(principal: Principal, projectId: string): Promise<FindingList> {
			await authorize(db, principal, projectId, 'finding.read');
			return { items: await loadFindings(db, projectId) };
		},

		async createFinding(
			principal: Principal,
			projectId: string,
			input: unknown
		): Promise<ContinuityFinding> {
			return db.transaction(async (tx) => {
				await authorize(tx, principal, projectId, 'finding.write');
				const data = parseInput(CreateFindingInput, input);
				const artifactIds = [...new Set(data.artifactIds)];
				if (data.reviseArtifactId !== undefined && !artifactIds.includes(data.reviseArtifactId)) {
					throw new TlonError('VALIDATION_FAILED', 'reviseArtifactId must be one of artifactIds', {
						artifactId: data.reviseArtifactId
					});
				}
				const stray = data.evidence.filter((e) => !artifactIds.includes(e.artifactId));
				if (stray.length > 0) {
					throw new TlonError(
						'VALIDATION_FAILED',
						'evidence must cite one of the finding artifacts',
						{
							artifactIds: [...new Set(stray.map((e) => e.artifactId))]
						}
					);
				}
				const found = await selectArtifacts(
					ctx,
					tx,
					principal,
					projectId,
					inArray(artifacts.id, artifactIds)
				);
				const byId = new Map(found.map((a) => [a.id, a]));
				const missing = artifactIds.filter((id) => !byId.has(id));
				if (missing.length > 0) {
					throw new TlonError('ARTIFACT_NOT_FOUND', 'artifact not found', { artifactIds: missing });
				}
				// Grounding: the quote must appear verbatim in the head title or body of its Block.
				const evidence: Array<{ artifactId: string; revisionId: string; quote: string }> = [];
				const ungrounded: Array<{ artifactId: string; quote: string }> = [];
				for (const e of data.evidence) {
					const artifact = byId.get(e.artifactId);
					const quote = normalise(e.quote);
					if (
						artifact !== undefined &&
						(normalise(artifact.title).includes(quote) || normalise(artifact.body).includes(quote))
					) {
						evidence.push({
							artifactId: e.artifactId,
							revisionId: artifact.headRevisionId,
							quote: e.quote
						});
					} else {
						ungrounded.push({ artifactId: e.artifactId, quote: e.quote });
					}
				}
				if (ungrounded.length > 0) {
					throw new TlonError('UNGROUNDED_QUOTE', 'a quote does not occur in the cited Block', {
						ungrounded
					});
				}
				const heads = new Map(found.map((a) => [a.id, a.headRevisionId]));
				const [row] = await tx
					.insert(continuityFindings)
					.values({
						id: ctx.newId(),
						projectId,
						kind: data.kind,
						severity: data.severity,
						artifactIds,
						explanation: data.explanation,
						evidence,
						source: data.source,
						reviseArtifactId: data.reviseArtifactId ?? null,
						actorId: principal.id,
						createdAt: ctx.now()
					})
					.returning();
				if (!row) throw new TlonError('INTERNAL', 'finding insert returned no row');
				await audit(ctx, tx, principal, projectId, 'finding.create', row.id, {
					kind: row.kind,
					severity: row.severity,
					source: row.source,
					artifacts: artifactIds.length
				});
				return toFinding(row, heads);
			});
		}
	};
}
