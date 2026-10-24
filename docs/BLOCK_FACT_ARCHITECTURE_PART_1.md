# Block–Fact Fractal Narrative Engine

> **Part 1 of 2.** Core model, operations, domain contracts, persistence, isolation, orchestration, validation. Continue with `BLOCK_FACT_ARCHITECTURE_PART_2.md`. **Important:** §19 in Part 2 is a normative human-first update and overrides AI-centric interpretations in earlier sections.

**Unified Architecture RFC / Developer Handoff**  
**Status:** proposed target architecture (not a claim about current code)  
**Version:** 1.1 · 2026-10-25 (human-first participant-agnostic revision)  
**Audience:** engineering team, Claude Code, study facilitators, human participants, agent/skill authors, QA  
**Language:** English for unambiguous agent implementation; the product UI may be localized.

> **Foundational premise (human-first):** This is a **participant-agnostic protocol for distributed creative collaboration**, originally conceived as a social experiment with three groups of people who need no screenwriting expertise. AI agents are optional substitutes for participants, not the purpose, dependency, or definition of the framework. The protocol — information isolation, minimal facts, local progression, recursive composition — must work with humans alone, AI alone, or mixed teams.

> **Narrative mechanism:** A narrative is grown through locally informed **Blocks** (points or meaningful states on a story timeline), **Facts** (brief, deliberately under-specified circumstances that can connect Blocks), and recursive **Triangles** (two Blocks and one linking Fact). Any Triangle or connected completed subgraph may be **composed into a Block** and connected to another Block using precisely the same mechanism. No Block-writing agent receives a hidden destination or the opposite branch's private story. A mediator creates a Fact, then selectively discloses it. The system enables creative tension between independently authored material, but must distinguish intentional tension from accidental implementation continuity errors.

---

## 0. Read this first — normative decisions

This document unifies and supersedes **the conceptual data model and generation rules** of these working documents:

- `ARCHITECTURE.md` — original graph/Web MVP, scoped agent gateway and disclosures.
- `COMPOSITE_ARTIFACTS_SPEC.md` — lossless composition and nested graph interfaces.
- `LAYERED_BRIDGING_MODEL.md` — generation waves, schedule/dependencies, colored numbered diagram.
- `GENERATION_REVIEW.md` and `LIGHTHOUSE_V2_REVIEW.md` — examples of continuity, timing and over-expansion issues.

It does **not** claim those RFCs are already implemented. The repository must be inspected before changing schemas, APIs, auth, providers or UI components. Existing names are migration inputs, not unquestioned canonical terminology.

### 0.1 Product laws (MUST)

1. **Block is a timeline point/segment of a narrative.** It is not intrinsically a beginning or ending. An agent writing from a Block treats that Block as its _local beginning_ and advances using only its authorized Facts and local context. The global timeline may order Blocks, but that order/goal is not automatically disclosed to the writer.
2. **Fact is a short, abstract, open-ended connector.** It may be an object, person, trace, constraint, place, signal, belief, need, etc. It is **not** an authored scene, sequence of instructions, solution outline or forced ending. Its minimality is a first-class invariant.
3. **A and B designate Block endpoints / isolated writing contexts; C designates the Fact-mediating operation.** These labels are **contextual roles**, not permanent artifact types or globally privileged characters. In the diagram, blue/red are Block-side agent scopes and yellow is C-produced Fact content; green can indicate a locally continued Block from a Block+Fact operation.
4. **Every pair of Blocks may be proposed for linking via a Fact:** `connect(A, B) -> C: Fact`. The Fact is created in a mediator scope allowed to inspect both endpoints. The Block writers must not receive the other endpoint.
5. **Block+Fact generates a new Block:** `advance(A, C) -> AC`. Also, independently, `advance(B, C) -> BC`. The next Block comes from a writer's own local world and the minimal Fact, not from knowing the opposite Block's text.
6. **Fact can be used as a local Block-like anchor for further linking.** This is a controlled projection (`FactAnchor`), **not silent mutation of Fact into a scene**. The Fact's source identity and exact minimal content remain unchanged.
7. **`Triangle(A, C, B)` is itself composable as a Block**, at any resolution. The composed Block retains the source Triangle/subgraph and has a summarized interface. It can participate in `connect` and `advance` like an atomic Block.
8. **Composing/collapsing is lossless:** composition creates an artifact over an existing immutable/revisioned graph; collapse only changes presentation. Neither operation destroys descendants, provenance, relations, versions, permissions or audit events.
9. **Narrative chronology, generation execution order, recursion depth and graph topology are distinct.** Numbers shown in the hand-drawn pyramid mark generation stages, not story dates or IDs. Equal stage numbers can run concurrently.
10. **Server-enforced isolation.** Agent A cannot read B-private artifacts and vice versa, including by search, counts, graph topology, previews, logs or API errors. Only an explicit scoped Fact/Disclosure (and its policy-approved metadata) crosses a boundary. The UI must not be the security boundary.
11. **Creative contradiction is an input, not necessarily a bug.** Conflicting independently authored anchors should prompt discovery of plausible connecting Facts. Accidental state reversals, duplicate actions, invalid time ordering and leaked secret content are separate issues to diagnose and/or reject.
12. **No automatic infinite recursion.** Expansion is driven by graph gaps, dramatic value, uncertainty, cost and configured limits. Stopping is a valid output.
13. **Participant-neutral core.** No core Block/Fact/Triangle/Compose operation may depend on a model, prompt, token count or AI agent. Human and AI participants execute the same role-specific task contracts.
14. **Human-only is a first-class mode.** The complete protocol must be operable via Web UI by three human groups without any AI connection.
15. **C is a mediator, not necessarily a model.** C can be a human, group of humans, AI agent or supervised mixed team; publishing facts obeys the same disclosure and auditing rules.
16. **Experiment-friendly behavior.** Provide reproducible conditions, blinded assessments, consent/privacy controls and optional evaluation instrumentation. Product analytics are not a substitute for controlled research.

### 0.2 Interpretation choices that require explicit sign-off

The drawings describe _structural_ order but do not completely fix scheduling details. Use the following **implementation defaults**, surface them as configuration and avoid presenting them as hard historical user requirements:

- Initial generation is two independent Blocks, labelled generation **stage 1** (possibly parallel); first C Fact is **stage 2**.
- A/B then advance through selectively disclosed C Facts, potentially in parallel; C may connect newly produced Blocks or Fact-projected anchors in later waves. The exact integers beyond 2 are an example, **not a hardcoded sequence**.
- The `Final` in the drawing is a convergence/composition result, **not necessarily the narrative finale**. It must not be used as a secret destination supplied to writers.
- A triangle can exist in `proposed` or `in_progress` state and be composed as a **draft interface**; it may become `validated` only after the required linkage criteria pass.
- The relationship between two events is not automatically causal; `precedes`, `causes`, `enables`, `contradicts` and `has_fact` are distinct.
- A Block is normally an event/state beat, but a Composite Block may summarize a whole temporal interval. Both implement the same external `BlockInterface`.

---

## 1. Mental model and vocabulary

### 1.1 Atomic conceptual objects

| Term                   | Definition                                                                                       | Example                                                     | Not this                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| **Block**              | Localized narrative event/state, with context and an optional time/interval.                     | “Odile finds a ship's lights above the dry basin.”          | Whole-world omniscient plot plan.                             |
| **Fact**               | Concise circumstance interpretable by both sides without prescribing resolution.                 | “An obsolete marine transponder.”                           | “Odile uses it to redirect the ark at 04:10.”                 |
| **Triangle**           | Structural association of two Block endpoints and a linking Fact.                                | `(lighthouse sighting, obsolete transponder, stranded ark)` | Evidence that all three already form a logically valid scene. |
| **Block continuation** | A new Block written by a side agent from its authorized Block and a disclosed Fact.              | “Odile tries the transponder frequency.”                    | The opposite side's previously written scene.                 |
| **FactAnchor**         | Reversible Block-like view of a Fact to allow more detailed connections.                         | Fact “rusted key” used as a temporary anchor.               | Replacing the key with a fully invented secret narrative.     |
| **Composite Block**    | An externally addressable Block representing an internal Triangle/connected subgraph.            | A whole lighthouse rescue arc wrapped as one Block.         | Merging/deleting all child records.                           |
| **Disclosure**         | Audited, allowlisted transfer of specific content from C to an agent scope.                      | A sees fact text only, no B narrative.                      | Giving A the full B artifact via a convenient pointer.        |
| **Tension**            | An unresolved, possibly generative discrepancy.                                                  | Born on Earth / born on Mars.                               | Automatic instruction to delete one side.                     |
| **Continuity issue**   | Inconsistency introduced into an already accepted timeline/state without a justified transition. | Drained tank becomes full in the next minute.               | Productive conflicting source anchors.                        |

### 1.2 Three different graphs: do not merge them into one table

1. **Narrative semantic graph** — Blocks, Facts, typed relationships and causal/temporal claims. May contain cycles in some relationship families; causal and chronological subgraphs must be separately validated.
2. **Expansion / composition graph** — Triangle instances, generated continuations, FactAnchor projections, nested composites, versioned member sets. Composition containment **MUST be acyclic**.
3. **Execution / authorization graph** — who generated what, using which inputs, grant visibility, stage number, task dependencies and review state. This is not the story timeline.

A fourth **render graph** is a projection of the above at a chosen zoom/view/security scope; it is not authoritative persistence.

### 1.3 A/B are not global directions of time

When joining Block A and Block B, the system may know that A occurs before B, but this fact must not force A-writer to see B. Conversely B-writer should treat its own Block as its **local starting point for authoring**, even if the scheduler uses it as the later chronological anchor. “Always beginning” means **a local generation viewpoint**, not “rewrite the story so B becomes temporally earlier.”

To avoid accidental time reversals, declare the requested direction for an operation separately:

- `forward`: local continuation later in timeline;
- `backward`: local prerequisite/earlier timeline event, written without knowing the opposing Block;
- `atemporal`: discover contextual states/associations without timeline motion.

**Default:** Side agents “advance” locally in a manner chosen by the orchestrator for the current gap. They must not receive endpoint goal descriptions; they can receive a direction flag (`forward`, `backward`, `atemporal`) and scoped temporal constraints (e.g. “within the same evening”) **only when safe to disclose**. Reconciliation then verifies chronology. The UI can present both as “continuations toward a connection” without forcing the actual authoring direction to be forward on both sides.

---

## 2. Core operations — the narrative algebra

Let `B` denote a Block, `F` a Fact, `T` a Triangle, `M` a Composite Block. Every operation is transactional, creates provenance and preserves previous revisions.

### 2.1 `connect(B1, B2) -> F`

- Inputs: IDs + revisions of two Blocks, mediator authorization to see both, optional tone/world constraints and Fact policy.
- Output: **one or more candidate Facts**, NOT a new scene. Each Fact is short, under-specified, non-directive, cannot contain a hidden opposite endpoint summary, and preserves candidate provenance.
- Choose/accept one candidate Fact to produce an explicit Triangle association `(B1, F, B2)`.
- C may keep rich _private reasoning/validation metadata_ internally, but **the Fact payload disclosed to A/B must remain minimal**. Do not inadvertently include the candidate's private explanation in disclosures.
- It may be impossible to find an interesting bridge; a failed proposal is a valid result.

**Example**

```text
A Block: A scientist receives a transmission dated tomorrow.
B Block: A city has voluntarily switched off all clocks.
C Fact: “A calendar that records impossible dates.”
```

C must NOT generate: “The scientist discovers the calendar, travels to the city, convinces its mayor to stop time, and turns off the clocks.” That is a directed plot outline, not a Fact.

### 2.2 `advance(B, F, direction, scope) -> B'`

- A side-agent reads only its current Block, allowed local parent context and Fact(s) explicitly disclosed to it.
- Writes a fresh Block representing the local resulting event/state **without seeing the opposing target**.
- Must explain _how the Fact matters locally_; must not use the Fact as a mandatory phrase or insert it mechanically.
- B' is not automatically accepted or globally true. It is a candidate until reviewed.
- Opposite sides can advance concurrently. Re-running a task is deterministic in identification, not necessarily in generated text.

Example:

```text
A sees: “Scientist receives tomorrow's message” + “Impossible-date calendar”.
A writes: “She discovers that dates omitted from the calendar still occur.”

B sees: “City switched off all clocks” + same Fact.
B writes: “The public archive contains dates no clock can display.”
```

The two continuations may be incompatible; C evaluates and offers another weak Fact or a deeper Triangle rather than leaking either continuation to the other writer.

### 2.3 `projectFact(F) -> FactAnchor`

Fact remains a Fact. `FactAnchor` is a **view/object with Block-interface capability** for construction/visualization:

- external text is the original Fact (or a stricter non-expanding canonical projection);
- retains `source_fact_id` and source revision;
- may have local temporal or ontology bindings added as separately authorized metadata;
- may be an endpoint of a new `connect(Block, FactAnchor)`; new mediating Fact must still be minimal;
- can be collapsed back to the original Fact representation with no loss.

**Never** convert the short Fact into a long scene in-place. If narrative material is needed, `advance` creates a **separate Block** linked to the FactAnchor. The writer never receives the whole other side as a side effect of projection.

### 2.4 `triangle(B1, F, B2) -> T`

A Triangle is the _structural unit_ formed by two Block anchors and a Fact. It is not identical to the Fact itself; it has its own ID, revision, review state, expansions and links.

A Triangle can be:

- `proposed`: a C Fact exists but the two sides have not connected their contexts;
- `expanding`: one/both sides generating continuations or recursively resolving subgaps;
- `converged`: both sides have compatible authored approaches / explicit semantic path;
- `validated`: policy checks pass and a reviewer or trusted auto-policy accepts;
- `rejected` or `superseded`.

“Triangle can be considered Block” means **it can be wrapped and exposed through a Block interface**, even before every detail is expanded, with status and uncertainty clearly propagated. Do not state that an unvalidated Triangle proves connectivity.

### 2.5 `compose(T | connectedSubgraph, interfacePolicy) -> M`

Create a new `Block` with `kind: composite`, immutable membership snapshot references and an interface:

- visible concise summary (may be generated / human edited);
- optional temporal envelope;
- entry/exit state conditions (where supportable);
- declared established Facts, dependencies, assumptions, unresolved tensions;
- allowed external connection ports and disclosure policy;
- frozen revision references for each internal member.

Composition does NOT implicitly publish internal contents. Parent composite cannot silently widen member visibility. See security section.

`compose(M1, F, M2) -> M3` is simply Triangle + Compose at a higher abstraction level. Nested composition is unbounded semantically but limited by system budgets.

### 2.6 `collapse` / `expandView` ≠ `advance` / `expandNarrative`

Use disambiguated names:

- `collapseView(compositeId)` / `openView(compositeId)` — render-only, no story changes.
- `expandNarrative(gapId)` — executes new Block/Fact work and persists new graph objects.
- `composeSubgraph(selection)` — creates a new Block identity and content interface.
- `decomposeView(compositeId)` — inspect internal graph, not delete its parent.

Avoid any API called just `expand` without specifying which meaning.

### 2.7 `reconcile` and `repair`

When connected material is incompatible:

1. Diagnose source (preexisting productive tension, bridge conflict, writer continuity regression, ACL/provenance error).
2. For **productive tension**, ask C for alternative minimal Facts / Triangle expansions with creative explanations.
3. For **regression**, reject or revise _the offending generated candidate_ rather than retconning immutable authored anchor.
4. Never solve a conflict by quietly changing A/B or creating a disclosed full-plot instruction.
5. Stop with explicit unresolved tension when no acceptable reconciliation exists within budget.

---

## 3. Diagram interpretation and generation wave semantics

Original hand sketches show blue A, red B, yellow C, green AC/BC continuations; repeated numbers represent generation stage/wave. In one diagram: independent endpoint blocks are stage `1`, the top yellow initial C is stage `2`, followed by local branches and mediating facts recursively; completed Triangle/subgraph regions can become new Blocks and then interact with other composites.

### 3.1 Minimal cycle

```mermaid
flowchart TD
  A1[Stage 1: Block A] --> C2{Stage 2: Fact C}
  B1[Stage 1: Block B] --> C2
  C2 --> DA[Disclosure: minimal Fact to A]
  C2 --> DB[Disclosure: minimal Fact to B]
  A1 --> AA[Advance A using Fact]
  DA --> AA
  B1 --> BB[Advance B using Fact]
  DB --> BB
  AA --> R[Reconcile gaps / create more Triangles]
  BB --> R
  R --> M[Compose selected completed region as Block]
```

_The arrows above are task dependencies and disclosures, **not** automatically story causation or A receiving B._

### 3.2 Stage numbering rules

- `stage_index` records a planner/execution wave. It is not a unique artifact ID.
- A and B may share stage 1; parallel tasks can share stage 3, 5, etc.
- C's first Fact is stage 2 by design for this workflow.
- Later C Facts/continuations are created on demand; numbers `3–13` on a sketch are examples and must not be hardcoded as a fixed binary tree.
- `created_at` and `execution_sequence` distinguish actual run ordering within a stage.
- `story_time` is independent; do not sort a narrative by stage index.
- `depth` means hierarchy in expansion, not time nor stage.

### 3.3 Gap-driven layered scheduler

Given two Blocks not yet sufficiently connected:

1. Ensure the current generation run contains input revisions and two non-overlapping private scopes (except intentionally public facts).
2. C sees both authorized endpoints, optionally composite interfaces, and proposes minimal candidate Fact(s).
3. Apply shortness/non-directionality checks; select and persist a Fact; publish individually scoped disclosure tokens for A/B.
4. Launch local `advance` tasks, potentially in parallel; neither sees opposite Block nor C-private reasoning.
5. C sees both candidate continuations, assesses local usefulness, builds new Triangle(s) for unresolved gaps. Writer candidates are not automatically accepted.
6. Continue until acceptance policy or stop criterion; composition may happen at any completed or intentionally partial level.
7. The resulting composed Block can be submitted as either endpoint in a higher-level connection, using **its intentionally limited external interface**.

Tasks are **dependency scheduled**, not launched merely because the UI shows a symmetrical pyramid. Optional uneven growth is normal.

### 3.4 Why C may be both mediator and controlled information router

C has two logically different privileges:

- `fact_author`: create a new minimal Fact after inspecting both authorized endpoints.
- `information_broker`: decide which existing authorized Fact/summary excerpt may be shown to which scope and publish an auditable Disclosure.

Give these distinct API actions and distinct audit events even if the same C agent executes both. A C-issued fact is not implicitly readable until allowed; every transfer should be inspectable/revocable.

### 3.5 Stop conditions

Each gap can stop when:

- semantic/plausibility checks pass at current resolution;
- further subdivisions add trivial logistics rather than story meaning;
- token/time/cost/depth budget is exhausted;
- irreconcilable input constraints are documented;
- user marks gap resolved or manually composes it.

Never require all triangles to reach the same depth. More detail is not automatically better.

---

## 4. Storage domain model (TypeScript reference contract)

These are target interfaces for domain boundaries, not instructions to overwrite current tables verbatim.

```ts
export type ID = string;
export type Revision = number;
export type Visibility = 'public' | 'scope_a' | 'scope_b' | 'mediator' | 'custom';
export type ArtifactStatus = 'draft' | 'candidate' | 'accepted' | 'rejected' | 'superseded';

export interface Provenance {
	runId?: ID;
	taskId?: ID;
	agentPrincipalId?: ID;
	scopeId?: ID;
	toolOrModel?: string;
	inputRevisionRefs: Array<{ id: ID; revision: Revision }>;
	createdAt: string;
}

export interface BlockInterface {
	summary: string;
	timeline?: {
		start?: string;
		end?: string;
		granularity?: 'unknown' | 'relative' | 'absolute';
	};
	entryState?: StateAssertion[];
	exitState?: StateAssertion[];
	assumptions?: ID[];
	publicFactRefs?: ID[];
	unresolvedTensionRefs?: ID[];
	ports?: Array<{ id: ID; label: string; direction: 'in' | 'out' | 'any' }>;
}

export interface Block {
	id: ID;
	projectId: ID;
	revision: Revision;
	kind: 'atomic' | 'composite';
	status: ArtifactStatus;
	text: string; // detailed authored content for this block
	interface: BlockInterface; // minimal external view for linking/composition
	visibility: Visibility;
	ownerScopeId: ID;
	compositeId?: ID; // if kind === 'composite'
	provenance: Provenance;
}

export type FactKind =
	| 'object'
	| 'person'
	| 'place'
	| 'rule'
	| 'signal'
	| 'trace'
	| 'document'
	| 'need'
	| 'constraint'
	| 'belief'
	| 'damage'
	| 'resource'
	| 'relationship'
	| 'other';

export interface Fact {
	id: ID;
	projectId: ID;
	revision: Revision;
	kind: FactKind;
	text: string; // terse, abstract, no prescribed plot
	status: ArtifactStatus;
	visibility: Visibility;
	ownerScopeId: ID; // typically C scope until disclosed
	provenance: Provenance;
}

export interface FactAnchor {
	id: ID;
	factRef: { id: ID; revision: Revision };
	projectedInterface: BlockInterface;
	projectId: ID;
	// Projection does not change Fact's type or original text.
}

export interface Triangle {
	id: ID;
	projectId: ID;
	revision: Revision;
	left: AnchorRef;
	fact: { id: ID; revision: Revision };
	right: AnchorRef;
	status: 'proposed' | 'expanding' | 'converged' | 'validated' | 'rejected' | 'superseded';
	localContinuations: Array<{ side: 'left' | 'right'; blockRef: RevisionRef }>;
	childTriangleIds: ID[];
	unresolvedTensionIds: ID[];
	provenance: Provenance;
}

export type RevisionRef = { id: ID; revision: Revision };
export type AnchorRef =
	| { type: 'block'; ref: RevisionRef }
	| { type: 'fact_anchor'; id: ID; factRef: RevisionRef };

export interface Composite {
	id: ID;
	blockId: ID;
	revision: Revision;
	membership: Array<{
		kind: 'block' | 'fact' | 'triangle' | 'relation' | 'composite';
		ref: RevisionRef;
	}>;
	sourceRootTriangleId?: ID;
	interface: BlockInterface;
	containmentPolicy: 'snapshot';
	status: 'draft' | 'validated';
	provenance: Provenance;
}

export interface SemanticRelation {
	id: ID;
	from: { kind: 'block' | 'fact'; ref: RevisionRef };
	to: { kind: 'block' | 'fact'; ref: RevisionRef };
	type:
		| 'precedes'
		| 'causes'
		| 'enables'
		| 'involves'
		| 'contradicts'
		| 'references'
		| 'has_fact'
		| 'other';
	status: ArtifactStatus;
	evidenceRefs: RevisionRef[];
}

export interface StateAssertion {
	subject: string;
	predicate: string;
	value: string | number | boolean;
	effectiveAt?: string;
	certainty: 'explicit' | 'inferred' | 'hypothesized';
	evidenceRef?: RevisionRef;
}

export interface Tension {
	id: ID;
	leftEvidence: RevisionRef;
	rightEvidence: RevisionRef;
	category: 'creative' | 'continuity' | 'temporal' | 'identity' | 'physics' | 'security';
	status: 'open' | 'explained' | 'accepted_as_mystery' | 'rejected';
	description: string;
	resolutionFactIds: ID[];
}

export interface Disclosure {
	id: ID;
	publisherPrincipalId: ID; // authorized C / human
	recipientPrincipalId: ID;
	object: { kind: 'fact' | 'block_interface' | 'excerpt'; ref: RevisionRef };
	projection: 'fact_only' | 'public_interface' | 'approved_excerpt';
	expiresAt?: string;
	revokedAt?: string;
	createdAt: string;
}

export interface GenerationTask {
	id: ID;
	projectId: ID;
	runId: ID;
	kind:
		| 'seed_block'
		| 'propose_fact'
		| 'advance_block'
		| 'reconcile'
		| 'validate'
		| 'compose'
		| 'publish_disclosure';
	stageIndex: number;
	depth: number;
	scopeId: ID;
	inputRefs: RevisionRef[];
	dependencyTaskIds: ID[];
	status: 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
	attempt: number;
	budget?: { tokens?: number; usd?: number; maxWallSeconds?: number };
	resultRefs: RevisionRef[];
	createdAt: string;
	finishedAt?: string;
}
```

### 4.1 Fact constraints (v1, configurable)

Default policy: **3–12 words preferred**, one sentence fragment, **hard cap 160 characters** for the _shareable Fact text_. These are product defaults, not mathematical truths. Do not enforce English word boundaries for every language; implement a language-aware/character based fallback.

Rejected examples:

- “The keeper discovers that the ark uses an obsolete maritime autopilot, convinces the pilot to fake water, then releases ballast into a lake.” — plot outline / answer leak.
- “The city mayor must confess before dawn.” — strong prescriptive instruction rather than an open circumstance (unless a specifically requested constraint Fact).

Allowed examples:

- “A brass instrument calibrated for seawater.”
- “A key engraved with two birthplaces.”
- “A missing registry entry.”
- “A debt inherited across generations.”
- “A signal that repeats at sunrise.”

C may internally select a Fact for its connection potential, but the delivered Fact must not encode the endpoint solution. Store scoring/reasoning summaries only in mediator-private evaluation fields, never accidentally in `Fact.text` or A/B tool payloads.

### 4.2 Block constraints

- Should describe an observable or narratively meaningful event/state with local consequences.
- Preserve the specified anchor text and its assertions if authored/locked.
- May reference only locally available entities or facts; introducing a new entity is possible but provenance must indicate it.
- `Block.interface.summary` is not equivalent to the full content; separate representations from storage and ACL perspective.
- Unknown time is valid and should not be manufactured.

### 4.3 Explicit composition boundary

The public interface of a composite is **reviewed projection**, not concatenation of all descendants. Claims outside its interface stay private to the membership scope. A composite containing private A and B members may be usable by mediator C without automatically becoming public to both sides.

### 4.4 Version semantics

- All reads in a running task pin `(id, revision)`.
- Mutating edits create a new revision, not hidden in-place changes to referenced historical revisions.
- A Composite pins member revisions. “Refresh composite” creates a new composite revision after revalidation, not retroactive rewriting of a prior snapshot.
- If two branches extend from the same Block concurrently, keep both as candidates until merged/rejected.
- Superseding a Fact must not rewrite already audited Disclosure payloads retroactively; revoke and issue a new disclosure.

---

## 5. Persistence and transactional constraints

Recommended implementation is a relational authoritative store (PostgreSQL) + typed application domain. An existing store may be adapted instead of replatformed if it can enforce the same guarantees.

### 5.1 Logical tables / aggregates

```text
projects
artifact_blocks           (id, project_id, revision, kind, text, interface_json, scope, status)
artifact_facts            (id, project_id, revision, kind, short_text, scope, status)
fact_anchors              (id, project_id, fact_id, fact_revision, projected_interface)
semantic_relations        (typed, versioned, evidence)
triangles                 (left_anchor, fact_ref, right_anchor, status, revision)
triangle_continuations    (triangle_id, side, block_ref)
triangle_children         (parent_triangle_id, child_triangle_id)
composites                (block_id, snapshot_revision, interface, review_status)
composite_members         (composite_id, member_ref, member_revision, kind)
state_assertions          (subject/predicate/value/effective_at/evidence)
tensions                  (type, evidence_refs, state, proposed_resolutions)
agent_principals          (project_id, role, status)
agent_scopes              (project_id, side, visibility_policy)
artifact_grants           (object_ref, recipient, projection, issued/revoked/expiry)
generation_runs           (config_snapshot, run_status, owner, budget)
generation_tasks          (run_id, stage, dependencies, attempts, status, idempotency_key)
execution_events          (append-only audit and workflow events)
```

Not all should be distinct physical tables in the MVP; preserve **domain separation** and constraints even if using JSONB for some records.

### 5.2 Non-negotiable integrity rules

- Project-scoped foreign keys and authorization checks on **every** read/write.
- No Triangle references missing or inaccessible versions.
- No composite contains itself, directly or transitively; detect and reject cycles transactionally.
- Composing an arbitrary subgraph requires connectedness in the chosen relationship projection or an explicit override with reason.
- No background mutation of accepted source Blocks by bridge generation.
- No unbounded recursive CTE exposed to agents; depth and edge budgets on traversals.
- Write operations require optimistic concurrency or transactional revision checking.
- Idempotency key per task attempt/output commit; retries must not duplicate accepted Facts/Blocks/Triangles.
- Deleting a composite never cascades to delete member artifacts unless separately authorized, audited deletion policy permits it.
- Relations crossing a composite boundary must be mapped to named interface ports or remain external edges linked to original members; no invented causality.
- Derived state/validation must be rebuildable from persisted source revisions and events.

### 5.3 Migrations from the current prototype

Observed product UI already includes Graph/Fractal/Timeline, typed relations, agent principals, grants and narrative artifacts. **Do a repository inventory before migration**:

1. Identify authoritative tables/types/endpoints and whether “bridge” is presently a full scene or a semantic relation.
2. Backfill **existing long-form bridge scenes as Blocks**, not as short Facts. Generating a short Fact from these is a new optional candidate task and must not overwrite historical data.
3. Preserve all existing artifact IDs, relation IDs, status, provenance and role permissions.
4. Introduce Fact as an additional first-class artifact type; introduce Triangle association and Composite membership next.
5. Keep legacy bridge features behind adapters or feature flags until migration is reversible.
6. Add non-destructive read projections in Graph/Fractal/Timeline; run side-by-side parity tests.
7. Only then rewire new generation to `propose_fact -> advance_block` and require scoped disclosures.
8. Provide forward migrations, backup strategy and a rollback path; no drop-and-recreate for production data.

**Important:** An existing accepted bridge (a full narrative scene) is _not_ equivalent to the new C Fact. Do not silently reinterpret the 31/24 historical bridge counts as Facts in new analytics.

---

## 6. Agent security and isolation architecture

### 6.1 Role/capability matrix

| Action                                 |        A scope |        B scope |                        C mediator |          Validator | Human admin |
| -------------------------------------- | -------------: | -------------: | --------------------------------: | -----------------: | ----------: |
| Read own Block and private history     |            Yes |            Yes |           authorized project view |          as needed |         Yes |
| Read opposite private Block            |         **No** |         **No** |          Yes (mediator-permitted) | limited audit view |         Yes |
| Read disclosed short Fact              |   scoped grant |   scoped grant |                               Yes |                Yes |         Yes |
| Search opposite private names/metadata |         **No** |         **No** |                               Yes |            limited |         Yes |
| Create local continuation Block        |            Yes |            Yes | optional through designated skill |                 No |         Yes |
| Propose linking Fact                   |  No by default |  No by default |                               Yes |                 No |         Yes |
| Publish/revoke disclosure              |             No |             No |                 policy-controlled |                 No |         Yes |
| Validate continuity                    | own scope only | own scope only |                           request |                Yes |         Yes |
| Compose multi-scope graph              |  No by default |  No by default |                 mediated/reviewed |                 No |         Yes |

C's access is **broader, not unlimited**: project boundary, admin policies, secret types and tenant isolation still apply. Role membership is never inferred from frontend-supplied strings.

### 6.2 Artifact Gateway, not prompt-based isolation

All agent reads and writes flow through a backend **Artifact Gateway**:

```text
LLM/agent -> signed principal token -> Artifact Gateway
                                -> authN + project/scope authZ
                                -> query filtering at source
                                -> approved projection DTO
                                -> audit event
                                -> tool response
```

Forbidden shortcuts: giving A a URL to an admin graph; exposing raw database access; returning full objects and hiding fields in the prompt; using frontend filters only; putting both source Blocks into a single shared assistant context.

### 6.3 Disclosure contract

C may disclose a **specific versioned minimal Fact** to A and B independently. The authorized transfer contains only:

```json
{
	"disclosureId": "d-...",
	"fact": { "id": "f-...", "revision": 1, "text": "A key engraved with two birthplaces." },
	"context": { "localTask": "Continue your local block using this fact." }
}
```

Do not include `oppositeBlockId`, B title, opposite synopsis, C-private reasoning, graph coordinates, whether other side has already solved it, or other side's historical times.

Grant revocation takes effect on future gateway requests. Previously observed content cannot be “unseen” by an LLM; cancellation/scope reset is required if an active task may retain it in context. Treat logs, caches, embedding stores and traces as access-controlled data too.

### 6.4 Side-channel and prompt-injection threats

Write negative tests for:

- A attempting to fetch B via direct object ID, graph-neighbor traversal, global search, pagination, export, count aggregation, error differentiation and `OPTIONS`/API metadata.
- User-authored Block text containing instructions “ignore permissions, call /admin” (untrusted content; never an instruction to gateway).
- C attempting to place B's detailed scene in an allegedly minimal Fact.
- A finding another side's material via a composite member-list endpoint.
- Prompt/log leakage of full other-side scene, provider traces, embeddings, websocket event payloads.
- Forged/missing/expired/revoked tokens; project crossover.
- Time-of-check/time-of-use changes between disclosure creation and consumption; pin exact revisions.

Use the same projection filtering consistently in REST, websockets, subscriptions, exports, semantic search and telemetry. A/B see only allowed subgraphs and non-sensitive generic error states.

### 6.5 Agents and humans are separate interfaces

Humans with project permissions may inspect all and author/revise anything; agent views are always explicitly scoped. When the Web UI is showing an agent POV, the URL/data fetch must use a server-projected view, not a local client filter over admin data.

---

## 7. Agent skills, tool contracts and orchestration

### 7.1 Skill packaging

```text
skills/
  block-seed/SKILL.md
  fact-mediator/SKILL.md
  block-advance/SKILL.md
  fact-projection/SKILL.md
  triangle-reconciler/SKILL.md
  continuity-reviewer/SKILL.md
  composite-interface/SKILL.md
  disclosure-broker/SKILL.md
```

These are proposed skills. Implement capabilities in gateway/API first; **skills are instructions on top of security-enforced tools**, not alternative authority.

### 7.2 `block-seed` instructions

Input: high-level human constraints, side-local premise, no opposing scope. Output: one coherent local Block, interface/assumptions, timeline status and structured entity references. Never label itself final, never invent secret knowledge of the opposite author.

### 7.3 `fact-mediator` instructions

Input: **both endpoint interfaces/content under mediator permission**; optionally current tension summaries and world rules. Output candidate Fact list. Target variety: object/person/place/constraint/etc. Short, concrete enough to matter, ambiguous enough to allow independently interesting continuations. Do not write plot, dialogue, or solution instructions. C can rank candidates using private score explanations, but the published Fact stays short.

Pseudo instruction:

> Produce 3–5 independent, minimal circumstances that _could_ connect these two Blocks while preserving both. Each is a brief noun phrase or single short statement. Do not specify how either protagonist acts, how the endpoints are reconciled, or what the opposite writer should produce. Return typed Fact candidates and private mediator justification in separate fields.

### 7.4 `block-advance` instructions

Input: own Block, authorized local context, one or more disclosed minimal Facts, optional non-leaking direction/time envelope. Output one candidate Block that meaningfully develops the own side. Don't infer unseen endpoints and don't assert the Fact itself dictates an outcome. Emit assumptions and state changes separately from literary prose.

### 7.5 `triangle-reconciler` instructions

Input: endpoints, current Fact, side continuations and validation observations (mediator only). Output one of:

- `converged`: explicit linkage path satisfying stated constraints;
- `needs_fact`: propose new **minimal** Fact for a child gap;
- `needs_continuation`: ask a side to advance with a scoped Fact;
- `intentional_mystery`: leave tension unresolved by author choice;
- `blocked`: impossible/low value/budget exhausted.

Must not “repair” by sending the opposite endpoint verbatim to its author.

### 7.6 `continuity-reviewer` instructions

Extract independently checkable claims/events and flag contradictions with smallest possible evidence spans. Classify creative anchor tension vs generated regression. For numbers and timelines use deterministic validators first (unit-bearing state assertions, ordering), then an LLM reviewer for ambiguous narrative claims. Reviewers are not infallible; confidence must be recorded.

### 7.7 `composite-interface` instructions

Summarize a completed subgraph into a concise public Block interface without flattening all details or disclosing private member content. Extract entry/exit assertions only where evidence exists. Mark unresolved conflicts and scope. A draft composite is not equivalent to validated plot consistency.

### 7.8 Recommended tool/API capabilities

```ts
// Names illustrative; choose current transport (REST/MCP) consistently.
get_my_scope(): ScopeDescriptor
read_block(id: ID, revision?: Revision): ScopedBlockDTO
read_fact(disclosureId: ID): ScopedFactDTO
list_my_visible_artifacts(query: SearchInput): ScopedPage
propose_fact(leftRef: RevisionRef, rightRef: RevisionRef, candidates: FactInput[]): FactRef[]
create_triangle(left: AnchorRef, fact: RevisionRef, right: AnchorRef): TriangleRef
publish_disclosure(factRef: RevisionRef, recipient: ID, projection: 'fact_only'): DisclosureRef
advance_from_fact(blockRef: RevisionRef, disclosureId: ID, draft: BlockInput): BlockRef
project_fact_as_anchor(factRef: RevisionRef): FactAnchorRef
compose_subgraph(selection: RevisionRef[], interfaceDraft: BlockInterface): BlockRef
read_composite_interface(blockRef: RevisionRef): ScopedBlockInterfaceDTO
get_validation_report(ref: RevisionRef): ValidationReportDTO
```

**Avoid** a tool named `get_all_context` for A/B. Avoid handing the LLM database queries in the first implementation. Add explicit permissions/quotas to C tools and require idempotency/request IDs for writes.

### 7.9 Orchestrator example pseudocode

```ts
async function connectAndGrow(pair: Pair<BlockRef>, run: RunContext) {
	const [left, right] = await Promise.all([
		gateway.readForMediator(pair.left, run.mediator),
		gateway.readForMediator(pair.right, run.mediator)
	]);
	const candidates = await mediator.proposeMinimalFacts(left, right, run.policy);
	const fact = await selectAndAcceptFact(candidates, run);
	const triangle = await gateway.createTriangle(pair.left, fact.ref, pair.right);

	const [grantA, grantB] = await Promise.all([
		gateway.discloseFact(fact.ref, run.agentA),
		gateway.discloseFact(fact.ref, run.agentB)
	]);

	const [aResult, bResult] = await Promise.all([
		agentRunner.advance({ ownBlock: pair.left, factDisclosure: grantA, principal: run.agentA }),
		agentRunner.advance({ ownBlock: pair.right, factDisclosure: grantB, principal: run.agentB })
	]);

	await gateway.attachCandidateContinuation(triangle.id, 'left', aResult.ref);
	await gateway.attachCandidateContinuation(triangle.id, 'right', bResult.ref);

	const report = await validation.reviewTriangle(triangle.id);
	const decision = await mediator.decideNextAction(triangle.id, report, run.policy);
	return { triangle, aResult, bResult, report, decision };
}
```

This demonstrates dependencies, **not** the entire recursive planner. `readForMediator` must never be callable with A/B principal. `advance` must resolve the Fact only via the specific grant. Child gaps are queued from `decision` with depth/cost policy.

### 7.10 Task scheduling and distributed execution

- Store every run/task with precise input revisions, scope, stage, dependencies, budgets and result refs.
- Queue jobs only when all dependencies completed/accepted at required level.
- Lease tasks, heartbeat, timeout, retry with bounded attempts, dedupe result commits.
- Distinguish canceled (user), blocked (awaiting permission), failed (provider error) and rejected (quality).
- Cancellation must revoke child task launches and close associated gateway sessions, without deleting accepted artifacts.
- Parallelization only for disjoint scope operations / tasks whose artifacts are independently versioned.
- Record provider/model versions, prompt/skill versions and generation settings for reproducibility; don't persist provider secrets in story exports.
- Use per-run and per-gap maximum costs, token budgets, depth, wall duration and candidate counts.

---

## 8. Validation and artistic constraints

### 8.1 Four levels of truth

1. **Locked authored assertions** — retain; agents cannot erase them.
2. **Accepted generated assertions** — versioned canon, revisions require review.
3. **Candidate assumptions** — may be false and must remain labeled.
4. **Character beliefs / unreliable testimony** — can conflict with objective world state without being an error.

Do not equate story narrator statements with omniscient facts automatically. Store epistemic source (`world_truth`, `character_belief`, `unreliable_account`, `unknown`) when extractable.

### 8.2 Validator types

- Structural: valid Triangle membership, typed relations, connected selection and acyclic composite containment.
- Fact policy: short, under-specified, non-directive, safe to disclose, no opposite synopsis leakage.
- Temporal: half-open intervals/relative ordering, deadlines, event duplication, elapsed duration, physical limits only when known.
- State continuity: ownership/location/object mechanism/resource quantity changes with evidence-backed transitions.
- Causal: prerequisites/effects; distinguish temporal precedence from causal explanation.
- Narrative: new tension, motif payoff, meaningful choice, rhythm, originality (human/LLM assisted; subjective).
- Security: projection scopes and disclosure consistency at every API layer.

### 8.3 Proven issues from Lighthouse V1/V2 (test fixtures, not hardcoded rules)

- V1: mercury drain / lens state inconsistent across consecutive beats; check state transitions.
- V1: shutter vs eclipse screen may be **ambiguous**, not always a contradiction; check evidence.
- V1: ultra-fine micro-beats (turning knobs, seconds) add length without much drama; adaptive expansion is needed.
- V2: hover fuel countdown conflicts with absolute clock times; check numeric timeline assertions.
- V2: voice interaction / landing progression sometimes appears in the wrong beat order; check causal order and overlapping intervals.
- V2: location of flare / spoon/gear can become ambiguous; track object state, but avoid inventing a contradiction where travel is implicit.
- V2: physically surprising 11 km skid requires world-rule plausibility review, not automatic rejection of a locked anchor.

**Do not** assert the above are already fixed. QA fixtures must include the original evidence spans, severity, and expected validator response; false-positive tests are as important as detection tests.

### 8.4 Creative tension policy

Example:

```text
Block A: “She was born on Earth.”
Block B: “Her records say she was born on Mars.”
C Fact: “A sealed duplicate birth certificate.”
```

The contradiction is the creative engine. A side can develop a Earth-local story from the certificate; B can develop a Mars-local story from the same certificate; C later reconciles with possibilities like adoption, cloning, registry fraud, two meanings of “born,” etc. **C must not deliver the final explanation to either side as its initial Fact.**

For objective incompatible hard constraints with no plausible solution, document unresolved tension and stop. No guarantee every arbitrary pair has a physically plausible resolution.

### 8.5 Adaptive expansion value

Before requesting another subgap, compute a configurable candidate priority based on:

- strength of causal uncertainty;
- dramatic significance / payoff opportunities;
- complexity of opposing constraints;
- temporal or state error risk;
- redundancy with sibling scenes;
- expected token/cost budget;
- user selection.

Start with heuristic flags and human overrides; do not present “dramatic quality = 0.83” as scientifically calibrated until tested.

---
