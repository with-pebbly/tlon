import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { api, ApiError, isApiError } from '$lib/api';
import { EMPTY_TRANSITION, issueTone, pairKey, TONE_RANK, type IssueTone } from '$lib/continuity';
import {
	loadOpenComposites,
	nestingLevels,
	parentIndex,
	saveOpenComposites
} from '$lib/graph/composites';
import { loadLayoutChoice, saveLayoutChoice, type GraphLayout } from '$lib/graph/positions';
import { SCOPE_SHORT } from '$lib/ui';
import {
	LOCAL_HUMAN,
	OPEN_EXPANSION_STATUSES,
	type AcceptExpansionInput,
	type AcceptExpansionResult,
	type Artifact,
	type ArtifactKind,
	type ArtifactStatus,
	type CompositeSummary,
	type CompositeView,
	type CreateArtifactInput,
	type CreateCompositeInput,
	type CreateRelationInput,
	type Expansion,
	type ExpansionCandidate,
	type ExpansionDetail,
	type ProjectGraph,
	type Relation,
	type ReviseCompositeInput,
	type SubmitCandidateInput,
	type UpdateArtifactInput,
	type UpdateRelationInput,
	type AgentPrincipal,
	type CreateAgentInput,
	type Disclosure,
	type Grant,
	type IssuedToken,
	type ReviewDisclosureInput,
	type DismissIssueInput,
	type IssueList,
	type ContinuityFinding,
	type CreateFindingInput,
	type RequestRevisionInput,
	type Task,
	type TransitionInput,
	type ValidationIssue,
	type AgentRole,
	type ConnectInput,
	type ExecutorKind,
	type ParticipantLink,
	type ProtocolState,
	type Run,
	type StartRunInput,
	type Triangle,
	type TriangleDetail,
	type TriangleStatus,
	type CompletionPolicy,
	type CreateConnectionInput,
	type NarrativeConnection,
	type UpdateConnectionInput
} from '@tlon/contracts';
import {
	buildFractalTree,
	buildTimeline,
	collapseComposites,
	detectTensions,
	membershipIndex,
	transitiveMembers,
	validateContinuity,
	type AggregatedEdge
} from '@tlon/core';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

/** Highlight label of the Issues panel's "unannotated beats" link (toggles it). */
export const UNANNOTATED_LABEL = 'unannotated beats';

/** 'aggregate' = a virtual `agg:<from>:<to>` edge standing in for hidden relations. */
export type SelectionType = 'artifact' | 'relation' | 'expansion' | 'aggregate' | 'triangle';
export type Selection = { type: SelectionType; id: string } | null;
export type ViewName = 'graph' | 'fractal' | 'timeline';

export const VIEWS: readonly ViewName[] = ['graph', 'fractal', 'timeline'];
const SELECTION_TYPE: Record<string, SelectionType> = {
	artifact: 'artifact',
	relation: 'relation',
	expansion: 'expansion',
	aggregate: 'aggregate',
	triangle: 'triangle'
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
	/** ARCHIVED artifacts (retired composites) are hidden unless this is on. */
	showArchived = $state(false);
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

/**
 * What a canvas draws after filters, Fractal drill-in scope and composite collapse
 * (`collapseComposites`). Open composites stay in `artifacts` (relations may end on
 * them) but are drawn as frames, not cards.
 */
export type CanvasModel = {
	artifacts: Artifact[];
	relations: Relation[];
	expansions: Expansion[];
	/** Composites inside the drawn scope (head definitions). */
	composites: CompositeSummary[];
	/** Hidden member → the collapsed composite standing in for it. */
	representative: ReadonlyMap<string, string>;
	aggregatedEdges: AggregatedEdge[];
	/** Open composites with at least one drawn member: rendered as frames. */
	frames: CompositeSummary[];
	/** Ids drawn as cards/cells (everything in `artifacts` except frames). */
	nodeIds: Set<string>;
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
	/**
	 * Artifacts highlighted on canvases: "Show provenance" of a relation, or a list from the
	 * Issues panel (unannotated beats, beats of an issue). `label` names it in the banner.
	 */
	highlight = $state.raw<{
		relationId: string | null;
		artifactIds: Set<string>;
		label: string;
	} | null>(null);
	/** Bumped to ask the graph canvas to center an artifact. */
	focusRequest = $state.raw<{ artifactId: string; at: number } | null>(null);
	newArtifactOpen = $state(false);
	/** Graph view layout, remembered per project in localStorage. */
	graphLayout: GraphLayout;
	/** Composites drawn open (frame around members); UI only, per project in localStorage. */
	openComposites: SvelteSet<string>;
	/** Canvas multi-selection (shift-click / shift-drag box) feeding "Compose selection". */
	multi = new SvelteSet<string>();
	/** Member ids of the open Compose drawer; null = closed. */
	composeMemberIds = $state.raw<string[] | null>(null);
	/** Fractal drill-in path as navigated (outermost first); deep links fall back to parents. */
	#trail = $state.raw<string[]>([]);

	/** Artifact Gateway admin data (HUMAN only); loaded separately from the graph. */
	agents = $state.raw<AgentPrincipal[]>([]);
	grants = $state.raw<Grant[]>([]);
	disclosures = $state.raw<Disclosure[]>([]);
	gatewayError = $state.raw<ApiError | null>(null);
	gatewayLoading = $state(false);
	/** Open gateway modal: agent admin (+ grants) or the disclosure review queue. */
	gatewayPanel = $state<'agents' | 'disclosures' | null>(null);

	/** Continuity issues of the committed path (server-computed, dismissals merged). */
	issueList = $state.raw<IssueList | null>(null);
	issuesError = $state.raw<ApiError | null>(null);
	/** Artifact inspector tab, kept across selections so "open State" sticks. */
	artifactTab = $state<'details' | 'state'>('details');
	/** Open "Compare neighbours" view: the centre beat and the state key to highlight. */
	compare = $state.raw<{ artifactId: string; stateKey: string | null } | null>(null);
	/**
	 * Revision tasks requested from this page: issue key → `revise_block` task id. UI only;
	 * the task itself lives on the protocol task board (`tasks`).
	 */
	revisionTaskByIssue = new SvelteMap<string, string>();

	/** Block–Fact protocol state (`GET /protocol`), loaded beside the graph. */
	protocol = $state.raw<ProtocolState | null>(null);
	protocolError = $state.raw<ApiError | null>(null);
	/** Candidates and tasks per triangle (`GET /triangles/:id`), refreshed with the protocol. */
	triangleDetails = $state.raw(new Map<string, TriangleDetail>());
	/**
	 * Narrative connections (organizer-only, protocol page). Loaded on demand by
	 * `reloadConnections`; `connectionsRevision` bumps after every change so the
	 * completion report re-fetches.
	 */
	connections = $state.raw<NarrativeConnection[]>([]);
	connectionsError = $state.raw<ApiError | null>(null);
	connectionsRevision = $state(0);

	/** Idempotency keys for accept requests not yet confirmed by the server. */
	#acceptKeys = new Map<string, string>();

	constructor(projectId: string) {
		this.projectId = projectId;
		this.graphLayout = $state(loadLayoutChoice(projectId));
		this.openComposites = new SvelteSet(loadOpenComposites(projectId));
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

	/** Centers an artifact; one hidden behind collapsed composites is revealed first. */
	focusArtifact(artifactId: string) {
		// Each pass opens the outermost collapsed composite hiding it; nesting is bounded.
		for (let pass = 0; pass < 32; pass++) {
			const representative = this.canvas.representative.get(artifactId);
			if (representative === undefined) break;
			this.openComposites.add(representative);
		}
		saveOpenComposites(this.projectId, this.openComposites);
		this.focusRequest = { artifactId, at: Date.now() };
		return this.select({ type: 'artifact', id: artifactId });
	}

	// ── Fractal drill-in (`?in=<compositeId>`) ──────────────────────────────────

	fractalIn = $derived.by<string | null>(() => {
		const raw = page.url.searchParams.get('in');
		return raw !== null && this.compositesById.has(raw) ? raw : null;
	});

	/** Drill-in path ending at `fractalIn`: the navigated trail, else the first-parent chain. */
	breadcrumbs = $derived.by<string[]>(() => {
		const current = this.fractalIn;
		if (current === null) return [];
		const at = this.#trail.lastIndexOf(current);
		if (at >= 0) return this.#trail.slice(0, at + 1);
		const chain = [current];
		let cursor = current;
		for (;;) {
			const parent = (this.parentsOf.get(cursor) ?? []).find(
				(id) => !chain.includes(id) && this.compositesById.has(id)
			);
			if (parent === undefined) break;
			chain.unshift(parent);
			cursor = parent;
		}
		return chain;
	});

	/** Double-click on a composite: show only its transitive members in the Fractal view. */
	enterComposite(compositeId: string) {
		const crumbs = this.view === 'fractal' ? this.breadcrumbs : [];
		const parent = crumbs.at(-1);
		const nested =
			parent !== undefined &&
			(this.compositesById.get(parent)?.memberArtifactIds.includes(compositeId) ?? false);
		this.#trail = nested ? [...crumbs, compositeId] : [compositeId];
		return this.#navigate((params) => {
			params.set('view', 'fractal');
			params.set('in', compositeId);
		}, false);
	}

	/** Breadcrumb target: a composite on the current path, or null for the whole project. */
	exitTo(compositeId: string | null) {
		return this.#navigate((params) => {
			if (compositeId === null) params.delete('in');
			else params.set('in', compositeId);
		}, false);
	}

	/** Esc in a drilled-in Fractal view: one level up. */
	exitComposite() {
		return this.exitTo(this.breadcrumbs.at(-2) ?? null);
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

	/** Head definitions of visible composites (archived ones included; filters decide). */
	composites = $derived(this.graph?.composites ?? []);
	compositesById = $derived(new Map(this.composites.map((c) => [c.artifactId, c])));
	membership = $derived(membershipIndex(this.composites));
	/** Member → composites listing it directly (a member may belong to several). */
	parentsOf = $derived(parentIndex(this.composites));
	/** Composite → nesting level (1 = composite of atomic artifacts). */
	compositeLevels = $derived(nestingLevels(this.membership));
	/** Accepted bridges whose anchors moved past the pinned revisions. */
	staleBridgeIds = $derived(
		new Set(
			this.expansions
				.filter((e) => e.status === 'ACCEPTED' && e.staleSides.length > 0)
				.flatMap((e) => (e.selectedBridgeArtifactId ? [e.selectedBridgeArtifactId] : []))
		)
	);

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

	// ── Block–Fact protocol ─────────────────────────────────────────────────────

	runs = $derived<Run[]>(this.protocol?.runs ?? []);
	triangles = $derived<Triangle[]>(this.protocol?.triangles ?? []);
	tasks = $derived(this.protocol?.tasks ?? []);
	trianglesById = $derived(new Map(this.triangles.map((t) => [t.id, t])));
	/** Completion policy the current run aims for; runs started before it existed are exploratory. */
	completionPolicy = $derived<CompletionPolicy>(
		this.runs[0]?.config.completionPolicy ?? 'exploratory'
	);

	/**
	 * Generation stage per artifact: the stage of the task that produced it (seed = 1),
	 * for a Fact the stage of its triangle. Blocks made outside the protocol have none.
	 */
	stageByArtifact = $derived.by(() => {
		const map = new Map<string, number>();
		for (const task of this.tasks) {
			for (const ref of task.resultRefs) map.set(ref.artifactId, task.stageIndex);
		}
		for (const t of this.triangles) {
			if (t.fact) map.set(t.fact.artifactId, t.stageIndex);
		}
		return map;
	});

	/** Triangles an artifact takes part in: as an anchor, the Fact, a candidate or a continuation. */
	trianglesByArtifact = $derived.by(() => {
		const map = new Map<string, Triangle[]>();
		const add = (id: string, t: Triangle) => {
			const list = map.get(id) ?? [];
			if (!list.includes(t)) list.push(t);
			map.set(id, list);
		};
		for (const t of this.triangles) {
			add(t.left.artifactId, t);
			add(t.right.artifactId, t);
			if (t.fact) add(t.fact.artifactId, t);
			for (const c of t.continuations) add(c.block.artifactId, t);
			for (const c of this.triangleDetails.get(t.id)?.candidates ?? []) add(c.fact.artifactId, t);
		}
		return map;
	});

	fractal = $derived(buildFractalTree({ relations: this.relations, expansions: this.expansions }));
	/** FACT artifacts (Block–Fact connectors): never story beats, never on the timeline. */
	factArtifacts = $derived(this.artifacts.filter((a) => a.artifactClass === 'FACT'));
	factIds = $derived(new Set(this.factArtifacts.map((a) => a.id)));
	/** Threads read through Blocks only: relations touching a Fact are atemporal. */
	timeline = $derived(
		buildTimeline({
			relations: this.relations.filter(
				(r) => !this.factIds.has(r.fromId) && !this.factIds.has(r.toId)
			),
			expansions: this.expansions
		})
	);
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
			if (a.status === 'ARCHIVED' && !f.showArchived) return false;
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
	 * Relations passing the toggles, regardless of endpoint visibility. A relation is a
	 * "collapsed parent edge" when an accepted expansion subdivides it: hidden by default,
	 * always shown when the user collapsed that expansion's subtree.
	 */
	shownRelations = $derived(
		this.relations.filter((r) => {
			if (r.status === 'REJECTED' && !this.filters.showRejected) return false;
			if (this.collapsedView.relationIds.has(r.id)) return false;
			if (r.expandedByExpansionId !== null) {
				return this.filters.showCollapsedEdges || this.collapsed.has(r.expandedByExpansionId);
			}
			return true;
		})
	);

	/** Scope of the drilled-in composite: its transitive members plus their expansions' bridges. */
	fractalScope = $derived.by<Set<string> | null>(() => {
		const inId = this.view === 'fractal' ? this.fractalIn : null;
		if (inId === null) return null;
		const scope = transitiveMembers(inId, this.membership);
		// Bridges and candidates between in-scope anchors belong to the scope too; nested
		// expansions on their child relations are picked up by iterating to a fixpoint.
		for (let grew = true; grew;) {
			grew = false;
			for (const e of this.expansions) {
				if (!scope.has(e.leftArtifactId) || !scope.has(e.rightArtifactId)) continue;
				for (const id of [e.selectedBridgeArtifactId, ...e.bridgeArtifactIds]) {
					if (id !== null && !scope.has(id)) {
						scope.add(id);
						grew = true;
					}
				}
			}
		}
		return scope;
	});

	/**
	 * Canvas pipeline: filters → drill-in scope → `collapseComposites(open set)`. Hidden or
	 * archived composites drop out of `composites`, so their members surface on their own.
	 */
	canvas = $derived.by<CanvasModel>(() => {
		const scope = this.fractalScope;
		const inScope = (id: string) => scope === null || scope.has(id);
		const artifacts = this.visibleArtifacts.filter((a) => inScope(a.id));
		const ids = new Set(artifacts.map((a) => a.id));
		const collapsed = collapseComposites(
			{
				artifacts,
				relations: this.shownRelations.filter((r) => inScope(r.fromId) && inScope(r.toId)),
				expansions: this.expansions.filter(
					(e) => inScope(e.leftArtifactId) && inScope(e.rightArtifactId)
				),
				composites: this.composites.filter((c) => ids.has(c.artifactId))
			},
			this.openComposites
		);
		const drawn = new Set(collapsed.artifacts.map((a) => a.id));
		const frames = collapsed.composites.filter(
			(c) =>
				drawn.has(c.artifactId) &&
				this.openComposites.has(c.artifactId) &&
				c.memberArtifactIds.some((m) => drawn.has(m))
		);
		const nodeIds = new Set(drawn);
		for (const frame of frames) nodeIds.delete(frame.artifactId);
		return {
			artifacts: collapsed.artifacts,
			relations: collapsed.relations.filter((r) => drawn.has(r.fromId) && drawn.has(r.toId)),
			expansions: collapsed.expansions,
			composites: collapsed.composites,
			representative: collapsed.representative,
			aggregatedEdges: collapsed.aggregatedEdges.filter(
				(e) => drawn.has(e.fromId) && drawn.has(e.toId)
			),
			frames,
			nodeIds
		};
	});

	aggregatedById = $derived(new Map(this.canvas.aggregatedEdges.map((e) => [e.id, e])));

	// ── Continuity validation ───────────────────────────────────────────────────

	/** Latest state annotation per visible artifact. */
	transitionsByArtifact = $derived(
		new Map((this.graph?.transitions ?? []).map((t) => [t.artifactId, t]))
	);

	/**
	 * The graph as the server validates it (no composites; only expansions between visible
	 * anchors), so beat numbers and replay order match the issue list.
	 */
	validationGraph = $derived.by(() => {
		const graph = this.graph;
		if (!graph) return null;
		return {
			project: graph.project,
			artifacts: graph.artifacts,
			relations: graph.relations,
			expansions: graph.expansions.filter(
				(e) => this.artifactsById.has(e.leftArtifactId) && this.artifactsById.has(e.rightArtifactId)
			)
		};
	});

	/** Committed reading path (story order) as `validateContinuity` replays it. */
	storyPath = $derived(
		this.validationGraph
			? validateContinuity(this.validationGraph, this.transitionsByArtifact).path
			: []
	);
	/** Artifact → 1-based beat number on the story path (as `storyBeats` numbers it). */
	beatIndex = $derived(new Map(this.storyPath.map((id, i) => [id, i + 1])));

	issues = $derived(this.issueList?.items ?? []);
	openIssues = $derived(this.issues.filter((i) => i.dismissal === null));
	dismissedIssues = $derived(this.issues.filter((i) => i.dismissal !== null));
	blockerCount = $derived(this.openIssues.filter((i) => i.severity === 'blocker').length);
	unannotatedIds = $derived(this.issueList?.unannotatedArtifactIds ?? []);

	/** Strongest open-issue tone per artifact; info-only issues draw nothing on canvases. */
	issueToneByArtifact = $derived.by(() => {
		const map = new Map<string, IssueTone>();
		for (const issue of this.openIssues) {
			const tone = issueTone(issue);
			if (tone === 'info') continue;
			for (const id of issue.artifactIds) {
				const current = map.get(id);
				if (!current || TONE_RANK[tone] > TONE_RANK[current]) map.set(id, tone);
			}
		}
		return map;
	});

	/** Strongest open-issue tone per unordered artifact pair (edges between issue beats). */
	issueToneByPair = $derived.by(() => {
		const map = new Map<string, IssueTone>();
		for (const issue of this.openIssues) {
			const tone = issueTone(issue);
			if (tone === 'info') continue;
			issue.artifactIds.forEach((a, i) => {
				for (const b of issue.artifactIds.slice(i + 1)) {
					const key = pairKey(a, b);
					const current = map.get(key);
					if (!current || TONE_RANK[tone] > TONE_RANK[current]) map.set(key, tone);
				}
			});
		}
		return map;
	});

	// ── Queries ─────────────────────────────────────────────────────────────────

	candidatesOf(expansionId: string): ExpansionCandidate[] {
		return this.candidatesByExpansion.get(expansionId) ?? [];
	}

	/** Open issues an artifact takes part in. */
	issuesOf(artifactId: string): ValidationIssue[] {
		return this.openIssues.filter((i) => i.artifactIds.includes(artifactId));
	}

	/** Ids in story order; beats off the path go last. */
	inStoryOrder(ids: readonly string[]): string[] {
		const at = (id: string) => this.beatIndex.get(id) ?? Number.MAX_SAFE_INTEGER;
		return ids.toSorted((a, b) => at(a) - at(b));
	}

	/** Expansion whose bridge is this artifact: accepted, else a candidate of an open one. */
	bridgeExpansionOf(artifactId: string): Expansion | null {
		return (
			this.expansions.find(
				(e) => e.status === 'ACCEPTED' && e.selectedBridgeArtifactId === artifactId
			) ??
			this.expansions.find((e) => isOpen(e) && e.bridgeArtifactIds.includes(artifactId)) ??
			null
		);
	}

	/**
	 * Story path through an artifact: the committed path, or for a pending candidate the
	 * path as if it were accepted. Null when the artifact is on neither.
	 */
	pathThrough(artifactId: string): { path: string[]; hypothetical: boolean } | null {
		if (this.beatIndex.has(artifactId)) return { path: this.storyPath, hypothetical: false };
		const graph = this.validationGraph;
		const expansion = this.expansions.find(
			(e) => isOpen(e) && e.bridgeArtifactIds.includes(artifactId)
		);
		if (!graph || !expansion) return null;
		const { path } = validateContinuity(graph, this.transitionsByArtifact, {
			expansionId: expansion.id,
			artifactId,
			transition: this.transitionsByArtifact.get(artifactId)?.transition ?? EMPTY_TRANSITION
		});
		return path.includes(artifactId) ? { path, hypothetical: true } : null;
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

	/** "Title (A)": a Block with the side that owns it (organizer views only). */
	blockLabel(artifactId: string): string {
		const artifact = this.artifactsById.get(artifactId);
		return artifact
			? `${artifact.title} (${SCOPE_SHORT[artifact.ownerScope]})`
			: artifactId.slice(0, 8);
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
			const [graph] = await Promise.all([
				api.getGraph(this.projectId),
				this.reloadIssues(),
				this.reloadProtocol()
			]);
			this.graph = graph;
			this.loadError = null;
			this.revision++;
		} catch (error) {
			this.loadError = isApiError(error) ? error : new ApiError('BAD_RESPONSE', 0, String(error));
			throw error;
		} finally {
			this.loading = false;
		}
	}

	/** Loads beside the graph; a failure is shown in the Issues panel and never blocks the graph. */
	async reloadIssues() {
		try {
			this.issueList = await api.listIssues(this.projectId);
			this.issuesError = null;
		} catch (error) {
			this.issuesError = isApiError(error) ? error : new ApiError('BAD_RESPONSE', 0, String(error));
		}
	}

	/**
	 * Protocol state plus every triangle's detail (candidates, tasks). A failure is kept
	 * in `protocolError` and never blocks the graph.
	 */
	async reloadProtocol() {
		try {
			const protocol = await api.getProtocol(this.projectId);
			const details = await Promise.all(
				protocol.triangles.map((t) => api.getTriangle(this.projectId, t.id))
			);
			this.protocol = protocol;
			this.triangleDetails = new Map(details.map((d) => [d.triangle.id, d]));
			this.protocolError = null;
		} catch (error) {
			this.protocolError = isApiError(error)
				? error
				: new ApiError('BAD_RESPONSE', 0, String(error));
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

	/** New human annotation of the head revision; a moved head fails with STALE_REVISION. */
	putTransition(
		artifact: Pick<Artifact, 'id' | 'headRevisionId'>,
		transition: TransitionInput,
		reviewed: boolean
	) {
		return this.#mutate(() =>
			api.putTransition(this.projectId, artifact.id, {
				artifactRevisionId: artifact.headRevisionId,
				transition,
				source: 'human',
				reviewed
			})
		);
	}

	/** Dismissal changes only the issue list, which the server returns recomputed. */
	async dismissIssue(input: DismissIssueInput): Promise<IssueList> {
		this.pending++;
		try {
			const list = await api.dismissIssue(this.projectId, input);
			this.issueList = list;
			this.issuesError = null;
			return list;
		} finally {
			this.pending--;
		}
	}

	/**
	 * "Request C reconciliation": opens the expansion on the relation linking the issue's
	 * two beats (creating one when none exists). Without a relation both beats become the
	 * multi-selection. A one-beat issue pairs its beat with the next one on the path.
	 */
	async requestReconciliation(issue: ValidationIssue): Promise<'expansion' | 'selected' | null> {
		const [left, second] = this.inStoryOrder(issue.artifactIds);
		if (left === undefined) return null;
		const right = second ?? this.storyPath[this.storyPath.indexOf(left) + 1];
		if (right === undefined || right === left) return null;
		const linking = this.relations.filter(
			(r) =>
				r.status !== 'REJECTED' &&
				((r.fromId === left && r.toId === right) || (r.fromId === right && r.toId === left))
		);
		const relation = linking.find((r) => r.fromId === left) ?? linking[0];
		if (relation) {
			const existing = relation.expandedByExpansionId ?? this.openExpansionFor(relation.id)?.id;
			if (existing) await this.select({ type: 'expansion', id: existing });
			else await this.expandRelation(relation.id);
			return 'expansion';
		}
		this.multi.clear();
		this.multi.add(left);
		this.multi.add(right);
		this.highlight = {
			relationId: null,
			artifactIds: new Set([left, right]),
			label: 'issue beats'
		};
		this.focusRequest = { artifactId: left, at: Date.now() };
		return 'selected';
	}

	/** Records a grounded facilitator finding; it joins the open issues as `source: human`. */
	async createFinding(input: CreateFindingInput): Promise<ContinuityFinding> {
		this.pending++;
		try {
			const finding = await api.createFinding(this.projectId, input);
			await this.reloadIssues();
			return finding;
		} finally {
			this.pending--;
		}
	}

	/** Sends one Block of a side-local issue back to its owning side as a `revise_block` task. */
	async requestRevision(input: RequestRevisionInput): Promise<Task> {
		this.pending++;
		try {
			const task = await api.requestRevision(this.projectId, input);
			this.revisionTaskByIssue.set(input.issueKey, task.id);
			await this.reloadProtocol();
			return task;
		} finally {
			this.pending--;
		}
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

	// ── Composite artifacts ─────────────────────────────────────────────────────

	async createComposite(input: CreateCompositeInput): Promise<CompositeView> {
		const view = await this.#mutate(() => api.createComposite(this.projectId, input));
		this.multi.clear();
		this.composeMemberIds = null;
		await this.select({ type: 'artifact', id: view.artifact.id });
		return view;
	}

	reviseComposite(compositeId: string, input: ReviseCompositeInput): Promise<CompositeView> {
		return this.#mutate(() => api.reviseComposite(this.projectId, compositeId, input));
	}

	archiveComposite(compositeId: string, reason?: string): Promise<Artifact> {
		return this.#mutate(() => api.archiveComposite(this.projectId, compositeId, reason));
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

	// ── Block–Fact protocol (facilitator) ───────────────────────────────────────

	/** Creates a participant and its link token; the token is returned, never stored here. */
	async createParticipant(input: {
		role: AgentRole;
		name: string;
		executorKind: ExecutorKind;
		ttlSeconds?: number;
	}): Promise<ParticipantLink> {
		return this.#mutateGateway(() => api.createParticipant(this.projectId, input));
	}

	startRun(input: StartRunInput): Promise<Run> {
		return this.#mutate(() => api.startRun(this.projectId, input));
	}

	acceptFact(triangleId: string, candidateId: string): Promise<TriangleDetail> {
		return this.#mutate(() => api.acceptFact(this.projectId, triangleId, candidateId));
	}

	setTriangleStatus(
		triangleId: string,
		status: Extract<TriangleStatus, 'validated' | 'rejected' | 'superseded'>
	): Promise<TriangleDetail> {
		return this.#mutate(() => api.setTriangleStatus(this.projectId, triangleId, status));
	}

	/**
	 * Opens a gap between two anchors (a child gap when `parentTriangleId` is set). Two
	 * anchors of the same private side are refused (SAME_SIDE_GAP); the error is reworded
	 * so the facilitator sees why.
	 */
	async connect(input: ConnectInput): Promise<TriangleDetail> {
		let detail: TriangleDetail;
		try {
			detail = await this.#mutate(() => api.connect(this.projectId, input));
		} catch (error) {
			if (!isApiError(error) || error.code !== 'SAME_SIDE_GAP') throw error;
			const { details } = error;
			const side =
				typeof details === 'object' &&
				details !== null &&
				'side' in details &&
				(details.side === 'A' || details.side === 'B')
					? details.side
					: 'the same side';
			throw new ApiError(
				error.code,
				error.status,
				`Both Blocks belong to ${side} — a gap joins A's material with B's. Pick one Block from each side.`,
				details
			);
		}
		this.multi.clear();
		return detail;
	}

	composeTriangle(
		triangleId: string,
		input: { title: string; summary?: string }
	): Promise<CompositeView> {
		return this.#mutate(() => api.composeTriangle(this.projectId, triangleId, input));
	}

	// ── Narrative connections (organizer-only) ──────────────────────────────────

	async reloadConnections() {
		try {
			this.connections = (await api.listConnections(this.projectId)).items;
			this.connectionsError = null;
		} catch (error) {
			this.connectionsError = isApiError(error)
				? error
				: new ApiError('BAD_RESPONSE', 0, String(error));
		}
	}

	/** Runs a connection change, then re-fetches the list and bumps `connectionsRevision`. */
	async #mutateConnections<T>(action: () => Promise<T>): Promise<T> {
		this.pending++;
		try {
			const result = await action();
			await this.reloadConnections();
			this.connectionsRevision++;
			return result;
		} finally {
			this.pending--;
		}
	}

	createConnection(input: CreateConnectionInput): Promise<NarrativeConnection> {
		return this.#mutateConnections(() => api.createConnection(this.projectId, input));
	}

	/** Rejecting removes only the interpretation; the Fact and the texts stay. */
	updateConnection(
		connectionId: string,
		input: UpdateConnectionInput
	): Promise<NarrativeConnection> {
		return this.#mutateConnections(() => api.updateConnection(this.projectId, connectionId, input));
	}

	// ── UI-only actions ─────────────────────────────────────────────────────────

	toggleCollapse(expansionId: string) {
		if (this.collapsed.has(expansionId)) this.collapsed.delete(expansionId);
		else this.collapsed.add(expansionId);
	}

	/** Open = draw the composite as a frame around its members (UI only). */
	setCompositeOpen(compositeId: string, open: boolean) {
		if (open) this.openComposites.add(compositeId);
		else this.openComposites.delete(compositeId);
		saveOpenComposites(this.projectId, this.openComposites);
	}

	/** Toggles the artifact highlight of a relation's provenance. */
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
		this.highlight = { relationId: relation.id, artifactIds: ids, label: 'provenance' };
	}

	/** Toggles the highlight of beats validation cannot see (no transition annotation). */
	showUnannotated() {
		if (this.highlight?.label === UNANNOTATED_LABEL) {
			this.highlight = null;
			return;
		}
		this.highlight = {
			relationId: null,
			artifactIds: new Set(this.unannotatedIds),
			label: UNANNOTATED_LABEL
		};
	}

	/** Opens an artifact's inspector on the State tab. */
	inspectState(artifactId: string) {
		this.artifactTab = 'state';
		return this.focusArtifact(artifactId);
	}

	/** Canvas edge (or its label) clicked: maps the drawn edge id to a selection. */
	selectEdge(edgeId: string) {
		// Fanned-out copies of one edge carry a `#n` suffix.
		const id = edgeId.split('#')[0] ?? edgeId;
		// Synthetic triangle sides are `tri:<expansion or triangle id>:<apexId>:<anchorId>`.
		if (id.startsWith('tri:')) {
			const gapId = id.slice(4, id.indexOf(':', 4));
			return this.select({
				type: this.trianglesById.has(gapId) ? 'triangle' : 'expansion',
				id: gapId
			});
		}
		if (id.startsWith('gap:')) return this.select({ type: 'triangle', id: id.slice(4) });
		if (id.startsWith('agg:')) return this.select({ type: 'aggregate', id });
		if (id.startsWith('preview:')) return;
		return this.select({ type: 'relation', id });
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
