import type { ExportBundle } from '@tlon/contracts';

export type BundleIssue = { path: string; message: string; ref?: string };

/**
 * Referential integrity of an export bundle. Reports IDs only — never artifact text —
 * so issues are safe to log and return to clients.
 */
export function findBundleIntegrityIssues(bundle: ExportBundle): BundleIssue[] {
	const issues: BundleIssue[] = [];
	const artifactIds = new Set<string>();
	const revisionById = new Map<string, string>();
	const relationIds = new Set<string>();
	const expansionById = new Map<string, ExportBundle['expansions'][number]>();
	const dup = (kind: string, id: string) =>
		issues.push({ path: kind, message: `duplicate ${kind} id`, ref: id });

	for (const a of bundle.artifacts) {
		if (artifactIds.has(a.id)) dup('artifacts', a.id);
		artifactIds.add(a.id);
	}
	for (const rev of bundle.revisions) {
		if (revisionById.has(rev.id)) dup('revisions', rev.id);
		revisionById.set(rev.id, rev.artifactId);
		if (!artifactIds.has(rev.artifactId)) {
			issues.push({
				path: `revisions.${rev.id}.artifactId`,
				message: 'unknown artifact',
				ref: rev.artifactId
			});
		}
	}
	for (const a of bundle.artifacts) {
		if (revisionById.get(a.headRevisionId) !== a.id) {
			issues.push({
				path: `artifacts.${a.id}.headRevisionId`,
				message: 'head revision missing or belongs to another artifact',
				ref: a.headRevisionId
			});
		}
	}
	for (const e of bundle.expansions) {
		if (expansionById.has(e.id)) dup('expansions', e.id);
		expansionById.set(e.id, e);
	}
	for (const r of bundle.relations) {
		if (relationIds.has(r.id)) dup('relations', r.id);
		relationIds.add(r.id);
		for (const [key, ref] of [
			['fromId', r.fromId],
			['toId', r.toId],
			...r.provenanceArtifactIds.map((p) => ['provenanceArtifactIds', p] as const)
		] as const) {
			if (!artifactIds.has(ref)) {
				issues.push({ path: `relations.${r.id}.${key}`, message: 'unknown artifact', ref });
			}
		}
		if (r.expansionId !== null && !expansionById.has(r.expansionId)) {
			issues.push({
				path: `relations.${r.id}.expansionId`,
				message: 'unknown expansion',
				ref: r.expansionId
			});
		}
	}
	for (const e of bundle.expansions) {
		const artifactRefs: Array<[string, string | null]> = [
			['leftArtifactId', e.leftArtifactId],
			['rightArtifactId', e.rightArtifactId],
			['selectedBridgeArtifactId', e.selectedBridgeArtifactId],
			...e.bridgeArtifactIds.map((id) => ['bridgeArtifactIds', id] as [string, string])
		];
		for (const [key, ref] of artifactRefs) {
			if (ref !== null && !artifactIds.has(ref)) {
				issues.push({ path: `expansions.${e.id}.${key}`, message: 'unknown artifact', ref });
			}
		}
		if (revisionById.get(e.leftRevisionId) !== e.leftArtifactId) {
			issues.push({
				path: `expansions.${e.id}.leftRevisionId`,
				message: 'pinned revision mismatch',
				ref: e.leftRevisionId
			});
		}
		if (revisionById.get(e.rightRevisionId) !== e.rightArtifactId) {
			issues.push({
				path: `expansions.${e.id}.rightRevisionId`,
				message: 'pinned revision mismatch',
				ref: e.rightRevisionId
			});
		}
		if (e.targetRelationId !== null && !relationIds.has(e.targetRelationId)) {
			issues.push({
				path: `expansions.${e.id}.targetRelationId`,
				message: 'unknown relation',
				ref: e.targetRelationId
			});
		}
		if (e.parentExpansionId !== null && !expansionById.has(e.parentExpansionId)) {
			issues.push({
				path: `expansions.${e.id}.parentExpansionId`,
				message: 'unknown expansion',
				ref: e.parentExpansionId
			});
		}
	}
	// Parent chains must terminate (expansion records form a forest).
	for (const e of bundle.expansions) {
		const seen = new Set<string>();
		let cursor: string | null = e.id;
		while (cursor !== null && expansionById.has(cursor)) {
			if (seen.has(cursor)) {
				issues.push({
					path: `expansions.${e.id}.parentExpansionId`,
					message: 'expansion parent cycle',
					ref: cursor
				});
				break;
			}
			seen.add(cursor);
			cursor = expansionById.get(cursor)?.parentExpansionId ?? null;
		}
	}
	for (const c of bundle.candidates) {
		const expansion = expansionById.get(c.expansionId);
		if (!expansion) {
			issues.push({
				path: `candidates.${c.id}.expansionId`,
				message: 'unknown expansion',
				ref: c.expansionId
			});
		} else if (!expansion.bridgeArtifactIds.includes(c.artifactId)) {
			issues.push({
				path: `candidates.${c.id}.artifactId`,
				message: 'candidate not listed on its expansion',
				ref: c.artifactId
			});
		}
		if (!artifactIds.has(c.artifactId)) {
			issues.push({
				path: `candidates.${c.id}.artifactId`,
				message: 'unknown artifact',
				ref: c.artifactId
			});
		}
	}

	const definitionIds = new Set<string>();
	for (const d of bundle.compositeDefinitions) {
		if (definitionIds.has(d.id)) dup('compositeDefinitions', d.id);
		definitionIds.add(d.id);
		const at = `compositeDefinitions.${d.id}`;
		if (!artifactIds.has(d.compositeArtifactId)) {
			issues.push({
				path: `${at}.compositeArtifactId`,
				message: 'unknown artifact',
				ref: d.compositeArtifactId
			});
		}
		if (revisionById.get(d.artifactRevisionId) !== d.compositeArtifactId) {
			issues.push({
				path: `${at}.artifactRevisionId`,
				message: 'revision mismatch',
				ref: d.artifactRevisionId
			});
		}
		const memberIds = new Set(d.members.map((m) => m.artifactId));
		for (const m of d.members) {
			if (revisionById.get(m.pinnedRevisionId) !== m.artifactId) {
				issues.push({
					path: `${at}.members`,
					message: 'pinned member revision mismatch',
					ref: m.pinnedRevisionId
				});
			}
		}
		for (const r of d.memberRelationIds) {
			if (!relationIds.has(r))
				issues.push({ path: `${at}.memberRelationIds`, message: 'unknown relation', ref: r });
		}
		for (const ref of [...d.boundary.entries, ...d.boundary.exits]) {
			if (!memberIds.has(ref))
				issues.push({ path: `${at}.boundary`, message: 'boundary is not a member', ref });
		}
		for (const claim of [
			...d.contract.entryConditions,
			...d.contract.exitConditions,
			...d.contract.invariants,
			...d.contract.keyClaims
		]) {
			if (revisionById.get(claim.sourceRevisionId) !== claim.sourceArtifactId) {
				issues.push({
					path: `${at}.contract`,
					message: 'claim source revision mismatch',
					ref: claim.sourceRevisionId
				});
			}
		}
	}
	for (const t of bundle.transitions) {
		if (revisionById.get(t.artifactRevisionId) !== t.artifactId) {
			issues.push({
				path: `transitions.${t.id}.artifactRevisionId`,
				message: 'annotation revision mismatch',
				ref: t.artifactRevisionId
			});
		}
	}
	return issues;
}

/**
 * Consistently replaces every entity ID (and the project ID) in a bundle. Used for
 * "import as copy" into a database that already holds the original IDs.
 */
export function remapBundleIds(
	bundle: ExportBundle,
	newId: () => string,
	projectId: string
): ExportBundle {
	const map = new Map<string, string>();
	const id = (old: string) => {
		let next = map.get(old);
		if (!next) {
			next = newId();
			map.set(old, next);
		}
		return next;
	};
	const optional = (old: string | null) => (old === null ? null : id(old));

	return {
		...bundle,
		project: { ...bundle.project, id: projectId },
		artifacts: bundle.artifacts.map((a) => ({
			...a,
			id: id(a.id),
			projectId,
			headRevisionId: id(a.headRevisionId)
		})),
		revisions: bundle.revisions.map((r) => ({ ...r, id: id(r.id), artifactId: id(r.artifactId) })),
		relations: bundle.relations.map((r) => ({
			...r,
			id: id(r.id),
			projectId,
			fromId: id(r.fromId),
			toId: id(r.toId),
			expansionId: optional(r.expansionId),
			expandedByExpansionId: optional(r.expandedByExpansionId),
			provenanceArtifactIds: r.provenanceArtifactIds.map(id)
		})),
		expansions: bundle.expansions.map((e) => ({
			...e,
			id: id(e.id),
			projectId,
			targetRelationId: optional(e.targetRelationId),
			leftArtifactId: id(e.leftArtifactId),
			rightArtifactId: id(e.rightArtifactId),
			leftRevisionId: id(e.leftRevisionId),
			rightRevisionId: id(e.rightRevisionId),
			parentExpansionId: optional(e.parentExpansionId),
			bridgeArtifactIds: e.bridgeArtifactIds.map(id),
			selectedBridgeArtifactId: optional(e.selectedBridgeArtifactId),
			childRelationIds: e.childRelationIds.map(id)
		})),
		candidates: bundle.candidates.map((c) => ({
			...c,
			id: id(c.id),
			expansionId: id(c.expansionId),
			artifactId: id(c.artifactId)
		})),
		compositeDefinitions: bundle.compositeDefinitions.map((d) => {
			const claim = (c: (typeof d.contract.keyClaims)[number]) => ({
				...c,
				sourceArtifactId: id(c.sourceArtifactId),
				sourceRevisionId: id(c.sourceRevisionId)
			});
			return {
				...d,
				id: id(d.id),
				compositeArtifactId: id(d.compositeArtifactId),
				artifactRevisionId: id(d.artifactRevisionId),
				members: d.members.map((m) => ({
					...m,
					artifactId: id(m.artifactId),
					pinnedRevisionId: id(m.pinnedRevisionId)
				})),
				memberRelationIds: d.memberRelationIds.map(id),
				boundary: { entries: d.boundary.entries.map(id), exits: d.boundary.exits.map(id) },
				contract: {
					...d.contract,
					entryConditions: d.contract.entryConditions.map(claim),
					exitConditions: d.contract.exitConditions.map(claim),
					invariants: d.contract.invariants.map(claim),
					keyClaims: d.contract.keyClaims.map(claim)
				}
			};
		}),
		transitions: bundle.transitions.map((t) => ({
			...t,
			id: id(t.id),
			artifactId: id(t.artifactId),
			artifactRevisionId: id(t.artifactRevisionId)
		}))
	};
}
