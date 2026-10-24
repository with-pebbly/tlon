# Fractal Narrative Engine — Architecture & Implementation Blueprint

> **Status:** Superseded for new work by the Block–Fact protocol (docs/BLOCK_FACT_ARCHITECTURE_PART_1.md, ADR 0011, ADR 0012). Kept as the design of the legacy full-scene bridge model, which remains supported for existing projects.

## 0. Executive summary

Fractal Narrative Engine (FNE) is a **general-purpose, recursively expandable system for generating, linking, versioning and visualizing structured artifacts**. Storytelling is the first application, not a hard constraint on the engine.

Two independently produced artifacts, `A` and `B`, may disagree. Instead of overwriting either, a **Bridge** operation produces a third artifact `C` that explains how both can be true in a coherent interpretation or transition. The resulting intervals `(A,C)` and `(C,B)` can be expanded recursively. Any bridge can itself become an independent arc; relationships can be decomposed again without losing provenance.

**Non-negotiable principle:** contradiction is potential creative input, not automatically an error. An explanation may reinterpret facts via perspective, time, identity, scope, or unreliable narration, but must never silently delete or rewrite immutable source assertions.

**Build now:** create/edit structured artifacts; link them with typed, explicit relationships; invoke a deterministic local bridge-placeholder workflow (manual bridge creation first); render and navigate the evolving graph on the web; persist revisions and derivation history.

**Build next:** agent skills and a scoped, server-mediated Artifact Gateway where agent A reads/writes A-owned material, agent B reads/writes B-owned material, and agent C can inspect the complete working graph and selectively disclose/publish approved context to A/B. Access policies must be enforced by the gateway, not prompt instructions.

---

## 1. Product principles and boundaries

1. **Artifacts first, prose second.** Every meaningful fact, hypothesis, event, scene, character state, constraint or explanation is a first-class typed artifact with an ID and metadata.
2. **Relations are first-class.** A relation has type, direction, evidence, provenance, validation status and may itself be an expansion target.
3. **Recursive bridging.** A pair or relation can be subdivided into a sequence or explanation graph; parent relationships are retained for navigation.
4. **Independent invention.** A and B can produce mutually surprising artifacts because neither sees the other side by default.
5. **Selective information flow.** C observes all and creates a mediated shared view. A/B do not receive each other's private raw artifacts, tool outputs or memories directly.
6. **Non-destructive revision.** Original assertions stay in append-only revisions; accepted interpretations are separate artifacts/claims.
7. **Explainability.** Every generated node records who/what produced it, which inputs were visible, and why it was accepted.
8. **Human steering.** Users can pin constraints, approve/reject bridges, lock artifacts, control expansion depth and stop runaway generation.
9. **Domain-agnostic core.** Story narratives first; future domains (quests, worldbuilding, planning) define specialized schemas and validators.
10. **Untrusted agent output.** Generated text and cross-agent context are data, never instructions to change roles, ACLs or permissions.

### Important distinctions

- **Compatibility is not objective factual truth.** For fictional stories, C may invent a narrative interpretation. For real-world/technical claims, bridge text is a hypothesis until independently verified with sources.
- **A bridge is not proof.** Validator should distinguish `syntactically_valid`, `locally_coherent`, `globally_consistent`, `narratively_effective`, and `externally_verified`.
- **The structure is not always a tree.** Recursive decomposition gives a tree of *expansion records*, while semantic artifacts form a directed multigraph (sometimes cyclic); the chronology view can be linearized separately.

---

## 2. Core example

Starting artifacts:

- `A`: "The protagonist was born on Earth." (assertion in an Earth archive).
- `B`: "The protagonist was born on Mars." (assertion in a Martian archive).

A proposed `C`: "The original was born on Earth; a clone with the same legal identity was activated on Mars, where 'birth' is the registered activation event."

C preserves A and B as statements with different **referents / meanings of 'birth'**, and creates additional world assumptions. These assumptions should be recorded explicitly, scored and eventually corroborated through later scenes.

Recursive expansions:

- `bridge(A, C)`: Who authorized the clone and why?
- `bridge(C, B)`: How did the clone acquire that legal identity?
- `bridge(reason_clone, authorization)`: An entire sub-arc.

A single expansion can produce multiple candidate C nodes. Humans or evaluators may choose one, fork alternatives, or combine them without rewriting the origins.

---

## 3. Data model: semantic graph + expansion tree + access views

### 3.1 Semantic graph

Let `G = (V, E)`, where `V` contains artifacts and `E` contains typed relations. A link can be `precedes`, `causes`, `enables`, `contradicts`, `explains`, `references`, `same_identity_as`, `believed_by`, or `derived_from`. Keep `relation.type` extensible.

Not all artifact pairs are chronologically adjacent. A `BRIDGE` artifact may describe an intermediate event, an explanatory rule, or a multi-step mini-arc. Do **not** assume C is always a timestamped midpoint.

### 3.2 Expansion records

An expansion targets an edge or ordered pair `(leftArtifactId, rightArtifactId)` and produces an accepted candidate C and optionally relations. Track:

- `parentExpansionId` (nullable), `targetRelationId` (nullable)
- `leftArtifactId`, `rightArtifactId`, `bridgeArtifactIds[]`
- child intervals: `(A,C)` and `(C,B)` **only when an ordered transition is meaningful**
- `depth`, `status`, `attempts`, `selectedCandidateId`, `authorId`, `runId`

Alternative candidates are separate artifacts or proposal records, not competing silent edits to the same artifact. Guard against unbounded recursive expansion, duplicates and graph cycles.

### 3.3 Three distinct state layers

- **Canonical graph:** globally stored, versioned artifacts + relationships and provenance; not globally readable.
- **Agent views:** policy-filtered projections (`A`, `B`, `C`), generated by the gateway; A/B views include their own artifacts and specifically shared C materials only.
- **Presentation view:** UI projection of what the *authorized human* can see; choose tree, DAG, timeline, or canvas layouts. Never infer agent permission from what the human UI renders.

### 3.4 Suggested TypeScript contracts

```ts
type UUID = string;
type Role = 'HUMAN' | 'A' | 'B' | 'C' | 'VALIDATOR';
type ArtifactKind =
  | 'FACT' | 'EVENT' | 'STATE' | 'BELIEF' | 'GOAL'
  | 'CONSTRAINT' | 'BRIDGE' | 'ARC' | 'SCENE' | 'NOTE';
type ArtifactStatus = 'DRAFT' | 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';

type Artifact = {
  id: UUID;
  projectId: UUID;
  kind: ArtifactKind;
  title: string;
  body: string; // markdown; untrusted content
  structured: Record<string, unknown>; // validated per kind with Zod
  status: ArtifactStatus;
  creatorRole: Role;
  ownerScope: 'A_PRIVATE' | 'B_PRIVATE' | 'C_SHARED' | 'PROJECT_PUBLIC';
  createdAt: string;
  updatedAt: string;
  headRevisionId: UUID;
  locked: boolean;
};

type Relation = {
  id: UUID;
  projectId: UUID;
  fromId: UUID;
  toId: UUID;
  type: string;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED';
  expansionId?: UUID;
  provenanceArtifactIds: UUID[];
};

type Expansion = {
  id: UUID;
  projectId: UUID;
  targetRelationId?: UUID;
  leftArtifactId: UUID;
  rightArtifactId: UUID;
  parentExpansionId?: UUID;
  bridgeArtifactIds: UUID[];
  selectedBridgeArtifactId?: UUID;
  depth: number;
  status: 'PENDING' | 'GENERATING' | 'REVIEW' | 'ACCEPTED' | 'FAILED' | 'CANCELLED';
};

type ArtifactRevision = {
  id: UUID;
  artifactId: UUID;
  version: number;
  body: string;
  structured: Record<string, unknown>;
  actorId: string;
  createdAt: string;
  reason?: string;
};
```

Implementation note: `ownerScope` alone is not enough for fine-grained agent sharing. Use a separate ACL/grant table and explicit disclosure records; avoid embedding sensitive A/B text in global `structured` fields, logs, trace labels, search indexes or vector stores.

### 3.5 Domain-specific structure (narrative plugin)

Narrative facts optionally define: `subject`, `predicate`, `object`, `worldTime`, `location`, `perspective`, `speaker`, `epistemicStatus` (`WORLD_FACT | CHARACTER_BELIEF | CLAIM | RUMOR | HYPOTHESIS`), `characters`, `prerequisites`, `effects`, `assumptions`, `dramaticFunction`. Contradictions must be evaluated against time, referent, scope and epistemic status. Store claims and character beliefs separately from canonical world facts.

---

## 4. Bridge algorithm and recursion

### Invariants

- The exact revisions of source anchors are recorded at bridge creation.
- Bridging does not mutate or delete A/B.
- Every proposed C specifies its mechanism, explicit assumptions and how each anchor remains true / meaningfully reconcilable.
- Rejected candidates remain available in audit history, hidden from canonical accepted view.
- Expansion stops when a human or policy declares the link sufficiently explained; **not** when everything has reached some arbitrary count.

### Basic algorithm

```ts
async function expand(link: Link, ctx: ExpansionContext): Promise<ExpansionResult> {
  assert(ctx.depth < ctx.maxDepth);
  assert(ctx.budget.remaining > 0);
  assert(!ctx.visitedRelations.has(link.id));

  const candidates = await proposeBridges(link, ctx); // manual in MVP; C agent later
  const scored = await validateAndRank(candidates, link, ctx);
  const winner = await selectCandidate(scored, ctx.approvalPolicy);
  if (!winner) return { status: 'REVIEW', candidates: scored };

  const expansion = await commitAtomically(link, winner, ctx);
  // Child links are expansion *opportunities*, not automatically spawned jobs.
  return { status: 'ACCEPTED', expansionId: expansion.id };
}
```

### Scoring (initially heuristic / human, not pretend-objective)

- Anchor preservation and explainability
- Local coherence with A/C/B
- Global compatibility with visible story constraints
- Character and thematic/dramatic contribution
- Novelty and avoidance of stock explanations
- Cost of extra assumptions / retcons
- Provenance and certainty

A good bridge is an intelligible *creative reconciliation*, not necessarily a scientifically true one.

### Controlling complexity

Default safe policies: `maxDepth = 5`, `maxCandidates = 3`, `maxNodesPerRun = 100`, `maxConcurrentJobs = 2`, configurable per project. Detect duplicate or semantically identical nodes; make expand idempotent by key `(targetRelationId, revision IDs, operation options)`; cap retries; support cancel/resume; never auto-expand all leaves indefinitely.

**Complexity:** full binary subdivision creates `2^d - 1` bridges at depth `d` (plus 2 anchors). Prefer selective expansion, priority queues and user-directed focus.

---

## 5. Web MVP (Phase 1): artifacts + graph editing

**Acceptance objective:** a user creates a project, creates A and B, links them, inserts C between them, recursively expands an A→C or C→B relation, views the expansion hierarchy and edits artifacts without losing links or revisions.

### User journeys

1. Create a project; select `Narrative` schema or `Generic`.
2. Create two artifact cards with title, body, kind and optional structured fields.
3. Connect A→B with a named relation.
4. Select relation → `Expand / Bridge` → create C manually or from a mock deterministic suggestion.
5. Confirm C; create relations A→C and C→B; retain original parent as a collapsed semantic edge / expansion provenance.
6. Expand any child relation recursively.
7. Inspect graph or expansion-tree view; click node to open inspector, edit and see revision history.
8. Pin or lock an artifact; inspect contradictory claims without automatically treating them as fatal errors.
9. Persist data; reload; export/import versioned JSON without broken references.

### UI structure

- **Left rail:** projects, outline/tree, artifact filters, saved perspectives.
- **Center canvas:** React Flow (`@xyflow/react`) graph; expand/collapse by depth, fit view, minimap, pan/zoom; use ELK.js/Dagre for automatic layout where appropriate.
- **Right inspector:** artifact fields, relations, revisions, creation/visibility source, linked expansions, assumptions.
- **Top bar:** project actions, selected view (`Graph | Fractal | Timeline`), search, undo/redo (start with local UI undo or explicit revision restore), export.
- **Edge interactions:** `Expand`, `Propose bridge`, `Show provenance`, `Collapse subtree`.
- **Graph legend:** distinguish semantic facts, explanations, unpublished candidates, accepted bridges; show edge direction.

Web graph is an exploration tool. Avoid tying persisted data to canvas x/y coordinates: save optional layout per user/view separately.

### Suggested stack

| Layer | Recommendation | Rationale |
|---|---|---|
| App | React + TypeScript + Vite | Fast MVP and familiar component ecosystem |
| Graph UI | `@xyflow/react` | Nodes/edges, selection, interaction |
| Layout | `elkjs` | Hierarchical and directed graph layout |
| API | NestJS + Zod at shared boundaries (or Fastify for smaller MVP) | Explicit modular services; choose one |
| DB | PostgreSQL + Drizzle ORM | Referential integrity, revisions, transactions |
| State/data | TanStack Query + Zustand | Server state vs UI selection/state |
| Workers (later) | Postgres-backed jobs first, then dedicated queue if needed | Avoid premature infra |
| Monorepo | pnpm workspaces + Turborepo (optional) | Shared schemas and SDK |

MVP must function with **no LLM API keys**. Agent providers are pluggable integrations, not dependencies of graph editing.

---

## 6. API surface (minimum)

REST is sufficient initially. Server validates project membership, object ownership and all relation endpoints on every request.

```http
POST   /api/projects
GET    /api/projects/:projectId/graph
POST   /api/projects/:projectId/artifacts
GET    /api/projects/:projectId/artifacts/:id
PATCH  /api/projects/:projectId/artifacts/:id  (If-Match revision)
GET    /api/projects/:projectId/artifacts/:id/revisions
POST   /api/projects/:projectId/relations
POST   /api/projects/:projectId/expansions
POST   /api/projects/:projectId/expansions/:id/candidates
POST   /api/projects/:projectId/expansions/:id/accept
POST   /api/projects/:projectId/expansions/:id/reject
GET    /api/projects/:projectId/expansions/:id
GET    /api/projects/:projectId/export
POST   /api/projects/:projectId/import
```

API contracts: typed error codes, pagination for large graphs, idempotency keys for expansion acceptance, transactional commit of bridge + links + revisions, optimistic concurrency for editing. Validate no cross-project edges. Return an API-filtered projection rather than raw DB rows.

### Relational schema sketch

- `projects(id, name, domain, settings_json, created_at)`
- `members(id, project_id, user_id, role)`
- `artifacts(id, project_id, kind, title, body, structured_json, status, owner_scope, head_revision_id, locked, created_at, updated_at)`
- `artifact_revisions(id, artifact_id, version, snapshot_json, actor_id, reason, created_at)`
- `relations(id, project_id, from_id, to_id, type, status, expansion_id, created_at)`
- `expansions(id, project_id, target_relation_id, left_id, right_id, parent_expansion_id, selected_bridge_id, depth, status, created_at)`
- `expansion_candidates(id, expansion_id, artifact_id, score_json, review_status)`
- `agent_runs(id, project_id, role, status, input_manifest_hash, output_manifest_hash, model, budget_json, created_at)`
- `grants(id, project_id, grantee_principal_id, artifact_id, permission, created_by, expires_at)`
- `disclosures(id, project_id, from_principal, to_principal, source_artifact_id, shared_artifact_id, source_revision_id, redaction_json, created_at)`
- `audit_events(id, project_id, actor, operation, subject_id, outcome, metadata_json, created_at)`

Add indexes on project ID, artifact endpoints, parent expansion ID, status and revisions. Avoid full-table data exposure in query methods.

---

## 7. Phase 2: isolated multi-agent writing

### 7.1 Roles

**A / Forward author**
- Can read A-private artifacts and C-published shared artifacts explicitly granted to A.
- Can create/edit only A-owned draft artifacts, propose edges to visible nodes and send proposals to C.
- Cannot list B's private artifact IDs, titles, revisions, run traces, vector embeddings or raw output.

**B / Backward author**
- Symmetric to A; isolated from A-private data.

**C / Bridge coordinator**
- Can see all A and B artifacts (within the specific project) and accepted canonical context.
- Creates bridging artifacts and candidates, ranks competing explanations, initiates approved expansions.
- Publishes **purpose-built shared artifacts or sanitized summaries** separately to A and B; may grant exact C-shared artifacts via auditable disclosure.
- Cannot bypass project isolation or grant permissions outside authorized project scope.

**Validator** (optional distinct principal)
- Can read project-wide canonical material, check internal inconsistencies, analyze assumptions, flag problems and score proposals.
- Cannot silently rewrite source facts or publish to A/B.

**Human**
- Final authority over project settings, review, locks, sharing policies and acceptance when in manual approval mode.

### 7.2 Critical design: Artifact Gateway

Do **not** secure this system by telling Claude “ignore other side.” Implement a server-side **Artifact Gateway** with authenticated principal, project scope and authorization middleware on **every** list/read/search/write/link/export operation.

```text
               Human web client (project owner)
                           |
                   Project API / Auth
                           |
                  Artifact Gateway
                /       |          \
       A scoped view   C all      B scoped view
          |           view            |
       Agent A       Agent C        Agent B
          \            |             /
           \      C disclosure       /
            \     service/API       /
                 Postgres + audit
```

Separate **identity** from prompt role: each agent gets its own short-lived token and `principalId`, not a client-supplied `role=A` field. Write actions verify ownership server-side. Search and traversal must authorize every node and edge before returning it. Consider edge-existence and count leakage; do not return hidden endpoints or global counts to A/B. Deny by default.

### 7.3 Disclosure protocol

1. A submits an artifact to gateway; private by default.
2. B independently submits its artifact; private by default.
3. C queries a C-authorized global project view.
4. C creates `BRIDGE` candidate and optional `SHARED_CONTEXT` message, citing exact input revisions.
5. Policy/human approves publication; disclosure creates a **new C-owned shared artifact** (`sharedArtifactId`) or explicit read grant, with source revision pinned.
6. A receives only the C→A disclosure; B only C→B. Neither receives each other's raw private artifacts by accident.
7. A/B produce new artifacts in response; C reconciles recursively.

**Design choice:** C can share synthesized facts from the other side *when intentionally approved*; “isolated” means no *direct uncontrolled* access, not an absolute guarantee that no B-derived information can reach A through C.

### 7.4 Skill packaging

Create machine-readable agent skills only after the gateway contract works. Each role gets a separate skill with explicit purpose, permitted tools, expected output format and stop conditions.

```text
skills/
  common/artifact-schema.md
  a-forward/SKILL.md
  b-backward/SKILL.md
  c-bridge/SKILL.md
  validator/SKILL.md
  orchestrator/SKILL.md
```

Suggested tools (gateway-proxied; also suitable as MCP server tools):

```text
artifact.list_visible(projectId, cursor?, filters?)
artifact.read(projectId, artifactId)
artifact.create(projectId, kind, payload)
artifact.propose_revision(projectId, artifactId, baseRevision, patch)
relation.list_visible(projectId, artifactId?)
relation.propose(projectId, fromId, toId, type)
expansion.propose(projectId, leftId, rightId, context)
expansion.submit_candidate(projectId, expansionId, candidate)
expansion.review(projectId, expansionId, decision)
disclosure.publish(projectId, destinationPrincipal, sourceRefs, sharedPayload)
audit.get_own(projectId, cursor?)
```

**Never expose the same general-purpose database or filesystem tool to all agent roles.** Agent tools should each delegate to gateway authorization. A/B must not be able to call `disclosure.publish`; C cannot impersonate A/B; review privileges depend on policy.

### 7.5 Agent execution lifecycle

`QUEUED → RUNNING → OUTPUT_PENDING_REVIEW → ACCEPTED | REJECTED | FAILED | CANCELLED`

- Orchestrator creates a run with `projectId`, `role`, allowed artifact IDs, token/budget limits and idempotency key.
- Gateway produces a policy-filtered immutable **input manifest** with exact revision hashes.
- Worker launches a context-isolated agent session (distinct tool token and memory). Do not reuse A's conversation history in B.
- Agent writes structured proposals, not direct canonical commits.
- Validator checks format, access, anchors and assumptions; human/C approves depending on configured policy.
- Commit transactionally; record costs, input/output manifest hashes and run provenance.

Security warning: LLM text, artifact bodies and C-shared summaries are untrusted. Apply strict tool ACLs, output validation, bounded recursion, rate limits, secret redaction, and test malicious artifact content explicitly.

---

## 8. Phase 3: automated orchestration

A minimal state machine:

```text
CREATED
  → A_DRAFTED + B_DRAFTED [parallel, isolated]
  → C_BRIDGE_PROPOSALS
  → REVIEW
  → ACCEPTED_BRIDGE
  → CHILD_RELATIONS_READY
  → SELECTIVE_RECURSION or COMPLETE
```

For each selected child link, dispatch the appropriate role(s) with only visible anchor/context; C is the mediator for cross-scope context. Do not promise that A and B can read both raw anchor artifacts: when an anchor is private to the other role, C must publish a scoped representation that expresses the bridging task without exposing unauthorized source.

Scheduling: explicit user-selected intervals first. Later consider priority = narrative significance × inconsistency/uncertainty × user focus ÷ estimated cost; apply depth/budget/concurrency limits. Parallel work requires per-artifact revision locks and conflict resolution at accept time.

### Working with multiple candidates

C can generate `k` reconciliations and branch the graph into scenarios. Candidates are isolated until accepted. The user can compare assumptions, dramatic value and impacted relations. Accepting one candidate must not make alternatives invisible in history or silently cross-contaminate A/B memories.

---

## 9. Validation, tests, observability

### Correctness testing

- Creating C between A/B retains source revision IDs and creates inspectable child links.
- Depth-3 expansion results in expected expansion topology when all branches are expanded.
- Repeated accept with same idempotency key never duplicates nodes.
- Cycles, missing references, cross-project links and stale revisions fail with typed errors.
- Export/import preserves stable IDs, order-independent graph relationships and provenance.
- UI remains usable with 100, 1,000 and 10,000 artifacts (viewport culling / pagination at scale).

### Isolation tests (non-negotiable before live agents)

- A token cannot GET, list, search, traverse, export or infer B-private artifacts.
- B token cannot read A-private artifacts.
- C can access all **within authorized project only**, not other projects.
- A forged role or artifactId in tool parameters does not bypass ACLs.
- Shared C→A summary does not implicitly grant the underlying B artifact.
- Revoked grants remove access on subsequent requests; previously seen text cannot be erased from model context, so revocation is prospective.
- Prompt injection in an artifact cannot cause unauthorized gateway reads or token disclosure.
- Logs, errors, graph counts and autocomplete never leak private material.

### Quality evaluation

Use test story seeds with deliberately conflicting anchors. Compare single-model linear generation, shared-context multi-agent generation and isolated recursive bridging. Human-blind scoring: anchor preservation, internal consistency, novelty, coherence, character motivation, dramatic payoff. Track latency, token costs, and number of additional assumptions. Do not equate LLM judge scores with scientific proof.

### Observability

Per expansion: source revision hashes, candidate count, accepted/rejected result, validator findings, visible-input manifest, tokens/cost/latency, scope/disclosure history. Structured logs must **omit private full text** by default.

---

## 10. Phased delivery plan

### Milestone M0 — scaffold + decision records
- Set up `apps/web`, `apps/api`, `packages/contracts`, `packages/core`, `packages/ui`.
- Document decisions: DB/ORM, narrative schema v1, bridge acceptance, ownership, graph vs expansion view.
- Create shared Zod schemas; migrate database; seed example Earth/Mars case.

### Milestone M1 — structured artifact CRUD
- Projects, artifact kinds, revisions, locks, basic relations.
- Backend validations and API integration tests.
- Artifact list + editor in browser.

### Milestone M2 — graph and recursive bridging **(first usable demo)**
- Interactive graph + inspector + ELK layout.
- Manual create C, accept between A/B, create child links and expansion record.
- Recursive expansion from any child relation.
- Persist, reload, export/import; show graph/fractal hierarchy.

### Milestone M3 — secure agent gateway
- Principal and project auth; per-agent tokens; ACL/grants and disclosures.
- Policy-filtered read/list/search/write; comprehensive isolation tests.
- Human UI can show scopes and disclosure provenance.

### Milestone M4 — agent skills + provider adapter
- Role-specific skills, gateway MCP tools, provider-neutral runner.
- Run ledger, input manifests, constrained outputs, budgets and review queue.
- First isolated A/B parallel generation and C bridge proposals.

### Milestone M5 — orchestrated recursion + research benchmark
- Worker queue, selective recursion, branching candidates, validator.
- Human approval flows, cost/quality dashboards, regression benchmark.

**Explicit non-goals of M0–M2:** automatic agents, true multi-user collaboration, arbitrary script execution, real-world factual verification, semantic vector retrieval, realtime sync, full screenplay formatting.

---

## 11. Suggested repository layout

```text
fractal-narrative/
├── apps/
│   ├── web/                     # React canvas, editor, inspector
│   └── api/                     # REST gateway and domain modules
├── packages/
│   ├── contracts/               # Zod + inferred TS types
│   ├── core/                    # Pure graph/expansion domain logic
│   ├── ui/                      # Shared app components (optional)
│   ├── agent-sdk/               # Future scoped tool SDK
│   └── evaluation/              # Future benchmarking harness
├── skills/                      # Future role-specific skill prompts
│   ├── a-forward/
│   ├── b-backward/
│   ├── c-bridge/
│   ├── validator/
│   └── orchestrator/
├── docs/
│   ├── adr/
│   ├── security-model.md
│   ├── data-model.md
│   └── evaluation.md
└── ARCHITECTURE.md
```

---

## 12. First Claude Code implementation instruction

Paste the following into Claude Code after placing this file at the repository root:

> Read `ARCHITECTURE.md` fully. Implement milestones M0–M2 only. First inspect the existing repository and reuse its conventions; do not overwrite user code. Build a runnable monorepo with React + TypeScript web, PostgreSQL API, shared Zod types, artifact CRUD with revisions, typed relations, expansion records and a React Flow canvas. The primary user flow must be: create project → add A/B → link them → insert bridge C → accept → automatically create A→C and C→B expansion opportunities → recursively expand either child → inspect/edit nodes and reload without losing data. Seed the Earth/Mars example. Implement tests for graph invariants, stale revisions and idempotent bridge acceptance. Include a README with local run commands and migrations. Do not add agents, provider APIs or MCP yet. Preserve authorization boundaries in the domain/API design so they can be introduced at M3. Ask only if an existing repository constraint makes implementation impossible; otherwise make sensible engineering choices and document them as ADRs.

### Definition of done for first demo

- [ ] Starts locally with documented commands.
- [ ] A and B can be created and linked in the browser.
- [ ] C can be inserted as a new artifact between them without rewriting anchors.
- [ ] Child links can each be expanded again (depth ≥ 3 tested).
- [ ] Node and relationship inspector shows revision and expansion lineage.
- [ ] Changes survive refresh and API restart.
- [ ] Invalid cross-project references and duplicate accepts are rejected.
- [ ] No LLM key required.
- [ ] Automated tests cover expansion integrity and basic persistence.

---

## 13. Open design decisions (defaults until evidence changes)

| Question | Initial decision |
|---|---|
| Is C always in the middle of time? | No. It may be an explanation, identity mapping, revelation or intermediate event. |
| Must every artifact have one parent? | No. Semantic graph may share nodes across arcs; expansion provenance stays explicit. |
| Does C send A/B full counterpart text? | Not by default; only deliberate scoped disclosures. |
| Can agents edit canonical graph directly? | No; they propose, gateway validates and commits. |
| Who selects successful C? | Human for MVP; configurable C + validator review later. |
| Is contradiction a bug? | No; unresolved contradiction is a prompt for explanation, but an accepted story may still have intentionally unresolved mysteries. |
| How are source facts protected? | Immutable revision history + pinned anchor revisions. |
| What about factual correctness? | Separate evidence-based verification for non-fiction; invented bridges are not factual verification. |
| How to stop recursion? | Human-directed expansion + depth, budget, novelty and coherence limits. |

## 14. Beyond MVP

Possible extensions: scene/act export, narrative timelines, character knowledge graphs, world-state simulation, graph diff/merge, branch comparison, user-controlled arc expansion, replayable generation histories, real-time collaboration, citations to external facts, domain-specific artifact packs and plugin adapters. Each extension should reuse the same graph, policy gateway, provenance and disclosure semantics.
