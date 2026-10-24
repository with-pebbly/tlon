import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { api, ApiError, isApiError } from '$lib/api';
import { loadLayoutChoice, saveLayoutChoice, type GraphLayout } from '$lib/graph/positions';
import {
	LOCAL_HUMAN,
	OPEN_EXPANSION_STATUSES,
	type AcceptExpansionInput,
	type AcceptExpansionResult,
	type Artifact,
	type ArtifactKind,
	type ArtifactStatus,
	type CreateArtifactInput,
	type CreateRelationInput,
	type Expansion,
	type ExpansionCandidate,
	type ExpansionDetail,
	type ProjectGraph,
	type Relation,
	type SubmitCandidateInput,
	type UpdateArtifactInput,
	type UpdateRelationInput,
	type AgentPrincipal,
	type CreateAgentInput,
	type Disclosure,
	type Grant,
	type IssuedToken,
	type ReviewDisclosureInput
} from '@tlon/contracts';
import { buildFractalTree, buildTimeline, detectTensions } from '@tlon/core';
import { SvelteSet } from 'svelte/reactivity';

export type SelectionType = 'artifact' | 'relation' | 'expansion';
export type Selection = { type: SelectionType; id: string } | null;
export type ViewName = 'graph' | 'fractal' | 'timeline';

export const VIEWS: readonly ViewName[] = ['graph', 'fractal', 'timeline'];
const SELECTION_TYPE: Record<string, SelectionType> = {
	artifact: 'artifact',
	relation: 'relation',
	expansion: 'expansion'
};

/** Parses the `sel=<type>:<id>` URL parameter. */
export function parseSelection(raw: string | null): Selection {
	if (!raw) return null;
	const at = raw.indexOf(':');
	if (at <= 0) return null;
	const name = raw.slice(0, at);
	const type = Object.hasOwn(SELECTION_TYPE, name) ? SELECTION_TYPE[name] : undefined;
	const id = raw.slice(at + 1);
	return type && id !== '' ? { type, id } : null;
}

export class Filters {
	/** Empty set = no kind restriction. */
	kinds = new SvelteSet<ArtifactKind>();
	/** Empty set = no status restriction. */
	statuses = new SvelteSet<ArtifactStatus>();
	query = $state('');
	showRejected = $state(false);
	showCandidates = $state(true);
	showCollapsedEdges = $state(false);

	get active(): boolean {
		return this.kinds.size > 0 || this.statuses.size > 0 || this.query.trim() !== '';
	}

	reset() {
		this.kinds.clear();
		this.statuses.clear();
		this.query = '';
	}
}

/** UI-only state hidden by "Collapse subtree" on an accepted expansion. */
type CollapsedView = {
	artifactIds: Set<string>;
	relationIds: Set<string>;
	expansionIds: Set<string>;
};

export class Workspace {
	readonly projectId: string;

	graph = $state.raw<ProjectGraph | null>(null);
	loadError = $state.raw<ApiError | null>(null);
	loading = $state(false);
	/** Number of in-flight mutations (drives disabled buttons). */
	pending = $state(0);
	/** Increments on every successful graph fetch; dependents re-fetch on change. */
	revision = $state(0);

	filters = new Filters();
	/** Accepted expansion IDs whose produced subtree is hidden (UI only, never persisted). */
	collapsed = new SvelteSet<string>();
	/** Artifacts highlighted by "Show provenance". */
	highlight = $state.raw<{ relationId: string; artifactIds: Set<string> } | null>(null);
	/** Bumped to ask the graph canvas to center an artifact. */
	focusRequest = $state.raw<{ artifactId: string; at: number } | null>(null);
	newArtifactOpen = $state(false);
	/** Graph view layout, remembered per project in localStorage. */
	graphLayout: GraphLayout;

	/** Artifact Gateway admin data (HUMAN only); loaded separately from the graph. */
	agents = $state.raw<AgentPrincipal[]>([]);
	grants = $state.raw<Grant[]>([]);
	disclosures = $state.raw<Disclosure[]>([]);
	gatewayError = $state.raw<ApiError | null>(null);
	gatewayLoading = $state(false);
	/** Open gateway modal: agent admin (+ grants) or the disclosure review queue. */
	gatewayPanel = $state<'agents' | 'disclosures' | null>(null);

	/** Idempotency keys for accept requests not yet confirmed by the server. */
	#acceptKeys = new Map<string, string>();

	constructor(projectId: string) {
		this.projectId = projectId;
		this.graphLayout = $state(loadLayoutChoice(projectId));
	}

	// ── URL-backed view and selection ──────────────────────────────────────────

	view = $derived.by<ViewName>(() => {
		const raw = page.url.searchParams.get('view');
		return VIEWS.includes(raw as ViewName) ? (raw as ViewName) : 'graph';
	});

	selection = $derived(parseSelection(page.url.searchParams.get('sel')));

	#navigate(mutate: (params: URLSearchParams) => void, replaceState: boolean) {
		const url = new URL(page.url);
		mutate(url.searchParams);
		// The path goes through resolve(); only the query string (view/selection) is appended.
		return goto(`${resolve('/projects/[projectId]', { projectId: this.projectId })}${url.search}`, {
			replaceState,
			keepFocus: true,
			noScroll: true
		});
	}

	select(selection: Selection) {
		return this.#navigate((params) => {
			if (selection) params.set('sel', `${selection.type}:${selection.id}`);
			else params.delete('sel');
		}, true);
	}

	setView(view: ViewName) {
		return this.#navigate((params) => params.set('view', view), false);
	}

	focusArtifact(artifactId: string) {
		this.focusRequest = { artifactId, at: Date.now() };
		return this.select({ type: 'artifact', id: artifactId });
	}

	setGraphLayout(layout: GraphLayout) {
		this.graphLayout = layout;
		saveLayoutChoice(this.projectId, layout);
	}

	// ── Derived indexes ─────────────────────────────────────────────────────────

	project = $derived(this.graph?.project ?? null);
	artifacts = $derived(this.graph?.artifacts ?? []);
	relations = $derived(this.graph?.relations ?? []);
	expansions = $derived(this.graph?.expansions ?? []);

	artifactsById = $derived(new Map(this.artifacts.map((a) => [a.id, a])));
	relationsById = $derived(new Map(this.relations.map((r) => [r.id, r])));
	expansionsById = $derived(new Map(this.expansions.map((e) => [e.id, e])));

	agentsById = $derived(new Map(this.agents.map((a) => [a.id, a])));
	pendingDisclosures = $derived(this.disclosures.filter((d) => d.status === 'PENDING'));
	/** Published disclosure that produced a given C_SHARED artifact (its provenance). */
	disclosureBySharedArtifact = $derived(
		new Map(
			this.disclosures
				.filter((d) => d.sharedArtifactId !== null)
				.map((d) => [d.sharedArtifactId as string, d])
		)
	);

	candidatesByExpansion = $derived.by(() => {
		const map = new Map<string, ExpansionCandidate[]>();
		for (const c of this.graph?.candidates ?? []) {
			const list = map.get(c.expansionId);
			if (list) list.push(c);
			else map.set(c.expansionId, [c]);
		}
		return map;
	});

	expansionsByTarget = $derived.by(() => {
		const map = new Map<string, Expansion[]>();
		for (const e of this.expansions) {
			if (e.targetRelationId === null) continue;
			const list = map.get(e.targetRelationId);
			if (list) list.push(e);
			else map.set(e.targetRelationId, [e]);
		}
		return map;
	});

	/** Artifact IDs that are PENDING candidates of a still-open expansion (unpublished C). */
	pendingCandidateIds = $derived.by(() => {
		const ids = new Set<string>();
		for (const c of this.graph?.candidates ?? []) {
			const expansion = this.expansionsById.get(c.expansionId);
			if (c.reviewStatus === 'PENDING' && expansion && isOpen(expansion)) ids.add(c.artifactId);
		}
		return ids;
	});

	/** Artifact IDs that are the selected bridge of an accepted expansion. */
	acceptedBridgeIds = $derived(
		new Set(
			this.expansions
				.filter((e) => e.status === 'ACCEPTED' && e.selectedBridgeArtifactId !== null)
				.map((e) => e.selectedBridgeArtifactId as string)
		)
	);

	fractal = $derived(buildFractalTree({ relations: this.relations, expansions: this.expansions }));
	timeline = $derived(buildTimeline({ relations: this.relations, expansions: this.expansions }));
	tensions = $derived(
		detectTensions({
			artifacts: this.artifacts,
			relations: this.relations,
			expansions: this.expansions
		})
	);

	collapsedView = $derived.by<CollapsedView>(() => {
		const view: CollapsedView = {
			artifactIds: new Set(),
			relationIds: new Set(),
			expansionIds: new Set()
		};
		if (this.collapsed.size === 0) return view;
		const candidateArtifacts = new Set<string>();
		const hideExpansion = (expansion: Expansion) => {
			if (view.expansionIds.has(expansion.id)) return;
			view.expansionIds.add(expansion.id);
			for (const c of this.candidatesByExpansion.get(expansion.id) ?? []) {
				candidateArtifacts.add(c.artifactId);
			}
			if (expansion.selectedBridgeArtifactId)
				candidateArtifacts.add(expansion.selectedBridgeArtifactId);
			for (const r of this.relations) {
				if (r.expansionId !== expansion.id || view.relationIds.has(r.id)) continue;
				view.relationIds.add(r.id);
				for (const child of this.expansionsByTarget.get(r.id) ?? []) hideExpansion(child);
			}
		};
		for (const id of this.collapsed) {
			const expansion = this.expansionsById.get(id);
			if (expansion) hideExpansion(expansion);
		}
		// An artifact stays visible if anything outside the collapsed subtree still links to it.
		const stillLinked = new Set<string>();
		for (const r of this.relations) {
			if (view.relationIds.has(r.id)) continue;
			stillLinked.add(r.fromId);
			stillLinked.add(r.toId);
		}
		for (const id of candidateArtifacts) if (!stillLinked.has(id)) view.artifactIds.add(id);
		return view;
	});

	/** Artifacts shown on canvases after filters, toggles and UI-only collapse. */
	visibleArtifacts = $derived.by(() => {
		const f = this.filters;
		const query = f.query.trim().toLowerCase();
		return this.artifacts.filter((a) => {
			if (a.status === 'REJECTED' && !f.showRejected) return false;
			if (this.pendingCandidateIds.has(a.id) && !f.showCandidates) return false;
			if (this.collapsedView.artifactIds.has(a.id)) return false;
			if (f.kinds.size > 0 && !f.kinds.has(a.kind)) return false;
			if (f.statuses.size > 0 && !f.statuses.has(a.status)) return false;
			if (query !== '' && !`${a.title}\n${a.body}`.toLowerCase().includes(query)) return false;
			return true;
		});
	});

	visibleArtifactIds = $derived(new Set(this.visibleArtifacts.map((a) => a.id)));

	/**
	 * A relation is a "collapsed parent edge" when an accepted expansion subdivides it.
	 * Hidden by default; always shown when the user collapsed that expansion's subtree.
	 */
	visibleRelations = $derived(
		this.relations.filter((r) => {
			if (!this.visibleArtifactIds.has(r.fromId) || !this.visibleArtifactIds.has(r.toId))
				return false;
			if (r.status === 'REJECTED' && !this.filters.showRejected) return false;
			if (this.collapsedView.relationIds.has(r.id)) return false;
			if (r.expandedByExpansionId !== null) {
				return this.filters.showCollapsedEdges || this.collapsed.has(r.expandedByExpansionId);
			}
			return true;
		})
	);

	// ── Queries ─────────────────────────────────────────────────────────────────

	candidatesOf(expansionId: string): ExpansionCandidate[] {
		return this.candidatesByExpansion.get(expansionId) ?? [];
	}

	/** Expansions where the artifact is an anchor (left/right) or a submitted bridge. */
	expansionsInvolving(
		artifactId: string
	): { expansion: Expansion; role: 'left' | 'right' | 'bridge' }[] {
		const out: { expansion: Expansion; role: 'left' | 'right' | 'bridge' }[] = [];
		for (const e of this.expansions) {
			if (e.leftArtifactId === artifactId) out.push({ expansion: e, role: 'left' });
			else if (e.rightArtifactId === artifactId) out.push({ expansion: e, role: 'right' });
			else if (e.bridgeArtifactIds.includes(artifactId)) out.push({ expansion: e, role: 'bridge' });
		}
		return out;
	}

	openExpansionFor(relationId: string): Expansion | null {
		return (this.expansionsByTarget.get(relationId) ?? []).find(isOpen) ?? null;
	}

	acceptedExpansionFor(relationId: string): Expansion | null {
		return (
			(this.expansionsByTarget.get(relationId) ?? []).find((e) => e.status === 'ACCEPTED') ?? null
		);
	}

	title(artifactId: string): string {
		return this.artifactsById.get(artifactId)?.title ?? artifactId.slice(0, 8);
	}

	/** "A · scout" for agent principals; the raw id (shortened) for anything else. */
	principalLabel(principalId: string): string {
		const agent = this.agentsById.get(principalId);
		if (agent) return `${agent.role} · ${agent.name}`;
		return principalId === LOCAL_HUMAN.id ? 'human' : principalId.slice(0, 8);
	}

	// ── Loading ─────────────────────────────────────────────────────────────────

	async reload() {
		this.loading = true;
		try {
			this.graph = await api.getGraph(this.projectId);
			this.loadError = null;
			this.revision++;
		} catch (error) {
			this.loadError = isApiError(error) ? error : new ApiError('BAD_RESPONSE', 0, String(error));
			throw error;
		} finally {
			this.loading = false;
		}
	}

	/** Runs a mutation, then re-fetches the whole graph (simple and always consistent). */
	async #mutate<T>(action: () => Promise<T>): Promise<T> {
		this.pending++;
		try {
			const result = await action();
			await this.reload();
			return result;
		} finally {
			this.pending--;
		}
	}

	/** Agents, grants and disclosures in one round; the graph is unaffected. */
	async reloadGateway() {
		this.gatewayLoading = true;
		try {
			const [agents, grants, disclosures] = await Promise.all([
				api.listAgents(this.projectId),
				api.listGrants(this.projectId),
				api.listDisclosures(this.projectId)
			]);
			this.agents = agents.items;
			this.grants = grants.items;
			this.disclosures = disclosures.items;
			this.gatewayError = null;
		} catch (error) {
			this.gatewayError = isApiError(error)
				? error
				: new ApiError('BAD_RESPONSE', 0, String(error));
			throw error;
		} finally {
			this.gatewayLoading = false;
		}
	}

	/** Runs a gateway admin mutation, then re-fetches the gateway lists. */
	async #mutateGateway<T>(action: () => Promise<T>): Promise<T> {
		this.pending++;
		try {
			const result = await action();
			await this.reloadGateway();
			return result;
		} finally {
			this.pending--;
		}
	}

	// ── Mutations ───────────────────────────────────────────────────────────────

	async createArtifact(input: CreateArtifactInput): Promise<Artifact> {
		const artifact = await this.#mutate(() => api.createArtifact(this.projectId, input));
		await this.focusArtifact(artifact.id);
		return artifact;
	}

	updateArtifact(artifact: Pick<Artifact, 'id' | 'headRevisionId'>, input: UpdateArtifactInput) {
		return this.#mutate(() =>
			api.updateArtifact(this.projectId, artifact.id, artifact.headRevisionId, input)
		);
	}

	async createRelation(input: CreateRelationInput): Promise<Relation> {
		const relation = await this.#mutate(() => api.createRelation(this.projectId, input));
		await this.select({ type: 'relation', id: relation.id });
		return relation;
	}

	updateRelation(relationId: string, input: UpdateRelationInput) {
		return this.#mutate(() => api.updateRelation(this.projectId, relationId, input));
	}

	/**
	 * Expand / Bridge a relation. An already-open expansion on it is reused
	 * (DUPLICATE_EXPANSION carries its id) instead of surfacing as a failure.
	 */
	async expandRelation(relationId: string): Promise<string> {
		let expansionId: string;
		try {
			const detail = await this.#mutate(() =>
				api.createExpansion(this.projectId, { targetRelationId: relationId })
			);
			expansionId = detail.expansion.id;
		} catch (error) {
			const alreadyExpanded = isApiError(error) && error.code === 'ALREADY_EXPANDED';
			const existing =
				existingExpansionId(error) ??
				(alreadyExpanded ? (this.acceptedExpansionFor(relationId)?.id ?? null) : null);
			if (!existing) throw error;
			expansionId = existing;
		}
		await this.select({ type: 'expansion', id: expansionId });
		return expansionId;
	}

	submitCandidate(expansionId: string, input: SubmitCandidateInput): Promise<ExpansionDetail> {
		return this.#mutate(() => api.submitCandidate(this.projectId, expansionId, input));
	}

	/**
	 * Accept a candidate. The idempotency key is minted once per distinct accept request
	 * and reused on every retry until the server confirms, so a lost response can be
	 * replayed safely.
	 */
	async accept(expansionId: string, input: AcceptExpansionInput): Promise<AcceptExpansionResult> {
		const requestKey = `${expansionId}|${JSON.stringify(input)}`;
		let key = this.#acceptKeys.get(requestKey);
		if (!key) {
			key = crypto.randomUUID();
			this.#acceptKeys.set(requestKey, key);
		}
		const idempotencyKey = key;
		const result = await this.#mutate(() =>
			api.acceptExpansion(this.projectId, expansionId, idempotencyKey, input)
		);
		this.#acceptKeys.delete(requestKey);
		await this.select({ type: 'artifact', id: result.bridge.id });
		return result;
	}

	reject(expansionId: string, candidateId?: string, reason?: string) {
		return this.#mutate(() =>
			api.rejectExpansion(this.projectId, expansionId, {
				...(candidateId ? { candidateId } : {}),
				...(reason ? { reason } : {})
			})
		);
	}

	// ── Artifact Gateway admin (HUMAN) ──────────────────────────────────────────

	createAgent(input: CreateAgentInput): Promise<AgentPrincipal> {
		return this.#mutateGateway(() => api.createAgent(this.projectId, input));
	}

	/** Disabling revokes every token of the principal (there is no token list endpoint). */
	disableAgent(principalId: string): Promise<AgentPrincipal> {
		return this.#mutateGateway(() => api.disableAgent(this.projectId, principalId));
	}

	/** The returned plaintext token is never stored in workspace state. */
	async issueToken(principalId: string, ttlSeconds: number): Promise<IssuedToken> {
		this.pending++;
		try {
			return await api.issueToken(this.projectId, principalId, { ttlSeconds });
		} finally {
			this.pending--;
		}
	}

	revokeToken(principalId: string, tokenId: string): Promise<undefined> {
		return this.#mutateGateway(() => api.revokeToken(this.projectId, principalId, tokenId));
	}

	revokeGrant(grantId: string): Promise<Grant> {
		return this.#mutateGateway(() => api.revokeGrant(this.projectId, grantId));
	}

	/** PUBLISH creates a new C_SHARED artifact, so the graph is re-fetched as well. */
	async reviewDisclosure(disclosureId: string, input: ReviewDisclosureInput): Promise<Disclosure> {
		const disclosure = await this.#mutateGateway(() =>
			api.reviewDisclosure(this.projectId, disclosureId, input)
		);
		if (disclosure.sharedArtifactId !== null) await this.reload();
		return disclosure;
	}

	// ── UI-only actions ─────────────────────────────────────────────────────────

	toggleCollapse(expansionId: string) {
		if (this.collapsed.has(expansionId)) this.collapsed.delete(expansionId);
		else this.collapsed.add(expansionId);
	}

	showProvenance(relation: Relation) {
		if (this.highlight?.relationId === relation.id) {
			this.highlight = null;
			return;
		}
		const ids = new Set(relation.provenanceArtifactIds);
		if (relation.expansionId) {
			const expansion = this.expansionsById.get(relation.expansionId);
			if (expansion) {
				ids.add(expansion.leftArtifactId);
				ids.add(expansion.rightArtifactId);
				if (expansion.selectedBridgeArtifactId) ids.add(expansion.selectedBridgeArtifactId);
			}
		}
		this.highlight = { relationId: relation.id, artifactIds: ids };
	}
}

export function isOpen(expansion: Pick<Expansion, 'status'>): boolean {
	return OPEN_EXPANSION_STATUSES.includes(expansion.status);
}

function existingExpansionId(error: unknown): string | null {
	if (!isApiError(error) || error.code !== 'DUPLICATE_EXPANSION') return null;
	const details = error.details;
	if (!details || typeof details !== 'object' || !('expansionId' in details)) return null;
	return typeof details.expansionId === 'string' ? details.expansionId : null;
}
