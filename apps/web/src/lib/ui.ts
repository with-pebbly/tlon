import type { AgentRole, ArtifactKind, ArtifactStatus, OwnerScope } from '@tlon/contracts';

/**
 * Visual category of an artifact (legend): semantic facts, explanations (BRIDGE kind),
 * unpublished candidates (PENDING candidates of open expansions), accepted bridges and
 * rejected artifacts.
 */
export type ArtifactCategory = 'fact' | 'explanation' | 'candidate' | 'bridge' | 'rejected';

export function artifactCategory(
	artifact: { id: string; kind: ArtifactKind; status: ArtifactStatus },
	pendingCandidateIds: ReadonlySet<string>,
	acceptedBridgeIds: ReadonlySet<string>
): ArtifactCategory {
	if (artifact.status === 'REJECTED') return 'rejected';
	if (pendingCandidateIds.has(artifact.id)) return 'candidate';
	if (acceptedBridgeIds.has(artifact.id)) return 'bridge';
	if (artifact.kind === 'BRIDGE') return 'explanation';
	return 'fact';
}

export const CATEGORY_LABEL: Record<ArtifactCategory, string> = {
	fact: 'Semantic fact',
	explanation: 'Explanation (bridge kind)',
	candidate: 'Unpublished candidate',
	bridge: 'Accepted bridge',
	rejected: 'Rejected'
};

/** Card classes per category; candidates are dashed, rejected are faded. */
export const CATEGORY_CARD: Record<ArtifactCategory, string> = {
	fact: 'border-zinc-300 bg-white',
	explanation: 'border-sky-300 bg-sky-50/60',
	candidate: 'border-dashed border-accent-500 bg-accent-50/70',
	bridge: 'border-accent-500 bg-white ring-2 ring-accent-100',
	rejected: 'border-dashed border-zinc-300 bg-zinc-100 opacity-60'
};

export const KIND_BADGE: Record<ArtifactKind, string> = {
	FACT: 'border-zinc-300 bg-zinc-100 text-zinc-700',
	EVENT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
	STATE: 'border-teal-200 bg-teal-50 text-teal-700',
	BELIEF: 'border-violet-200 bg-violet-50 text-violet-700',
	GOAL: 'border-lime-200 bg-lime-50 text-lime-700',
	CONSTRAINT: 'border-rose-200 bg-rose-50 text-rose-700',
	BRIDGE: 'border-accent-200 bg-accent-50 text-accent-700',
	ARC: 'border-orange-200 bg-orange-50 text-orange-700',
	SCENE: 'border-cyan-200 bg-cyan-50 text-cyan-700',
	NOTE: 'border-stone-200 bg-stone-50 text-stone-600'
};

export const STATUS_TEXT: Record<ArtifactStatus, string> = {
	DRAFT: 'text-zinc-500',
	PROPOSED: 'text-accent-600',
	ACCEPTED: 'text-emerald-700',
	REJECTED: 'text-zinc-400 line-through',
	SUPERSEDED: 'text-zinc-400'
};

/** Short owner-scope label used on badges (A / B / C / Public). */
export const SCOPE_SHORT: Record<OwnerScope, string> = {
	A_PRIVATE: 'A',
	B_PRIVATE: 'B',
	C_SHARED: 'C',
	PROJECT_PUBLIC: 'Public'
};

export const SCOPE_LABEL: Record<OwnerScope, string> = {
	A_PRIVATE: 'A private',
	B_PRIVATE: 'B private',
	C_SHARED: 'C shared',
	PROJECT_PUBLIC: 'Public'
};

export const SCOPE_DESCRIPTION: Record<OwnerScope, string> = {
	A_PRIVATE: 'Visible to role A, C, validators and humans — never to B',
	B_PRIVATE: 'Visible to role B, C, validators and humans — never to A',
	C_SHARED: 'Visible to C, validators and humans; A/B only through a READ grant (disclosure)',
	PROJECT_PUBLIC: 'Visible to C, validators and humans (A/B only see their own scope)'
};

export const SCOPE_BADGE: Record<OwnerScope, string> = {
	A_PRIVATE: 'border-sky-300 bg-sky-50 text-sky-800',
	B_PRIVATE: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800',
	C_SHARED: 'border-amber-300 bg-amber-50 text-amber-800',
	PROJECT_PUBLIC: 'border-zinc-300 bg-white text-zinc-600'
};

/** Pyramid cell corner mark per owner scope; public cells carry no mark. */
export const SCOPE_CORNER: Record<OwnerScope, string | null> = {
	A_PRIVATE: 'bg-sky-500',
	B_PRIVATE: 'bg-fuchsia-500',
	C_SHARED: 'bg-amber-500',
	PROJECT_PUBLIC: null
};

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
	A: 'A — private reasoner',
	B: 'B — private reasoner',
	C: 'C — bridge / discloser',
	VALIDATOR: 'Validator — read-only'
};

export const shortId = (id: string) => id.slice(0, 8);

export function formatTime(iso: string): string {
	const date = new Date(iso);
	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}
