# Block–Fact Fractal Narrative Engine — Part 2 of 2

> **Continuation of `BLOCK_FACT_ARCHITECTURE_PART_1.md`.** Original section numbering is preserved. **§19 and §25 are normative updates**: the core protocol is participant-agnostic, with human and AI executors interchangeable. Read before implementing.

## 9. Web product requirements (existing app evolution)

### 9.1 Keep current working surfaces

Preserve **Graph / Fractal / Timeline**, left Outline, inspector, agent principals, grants/disclosures, export, and existing authored stories. Upgrade data projections; do not redesign the app merely for aesthetics.

### 9.2 Graph view

- Node shapes/styles differentiate atomic Block, minimal Fact, FactAnchor, Triangle (hyperedge/connector), Composite Block, and candidate/rejected state.
- Color by originating generation role (A blue, B red, C yellow, derived local Block green when useful); **color is a visual attribute, not an ACL indicator**.
- Edges differentiate structural membership, causal, temporal, explicit contradiction, disclosure/dependency. Provide a legend and filters.
- Root selection, collapse nested composites, show external ports; allow opening an internal subgraph in-place or in focused view.
- Labels become readable on selection/zoom; don't render hundreds of unlabeled cells as the only story navigation.
- Avoid visual recursion depth implying chronology. Show generation stages separately.

### 9.3 Fractal / pyramid view

- Show initial A/B Blocks as stage 1 and first C Fact as stage 2.
- Label later continuation Blocks and C Facts with actual task `stage_index`; equal indices may appear on concurrent branches.
- Triangle previews show A–Fact–B without revealing scope-private content in an agent-POV view.
- A completed Triangle can be selected and **Compose into Block**; Block can then be linked with any other Block via another C Fact.
- Support non-uniform expansion, partial triangles, selected subtrees and nested composites; do **not** assume symmetric full binary tree.
- Show pending / accepted / failed / blocked tasks and C disclosures as separate overlays, not as narrative edges.

### 9.4 Timeline view

- Timeline sorts by explicitly known story chronology, not generation stage.
- Fact-only entities without story time appear as overlays/links rather than fabricated timed events.
- Composite Blocks render as summary intervals or grouped collapsible ranges.
- Overlaps and uncertain event order are explicit; distinguish “unknown” from “simultaneous.”

### 9.5 Inspector

For a Block: prose, one-line summary, local timeline, entry/exit assertions, relations, visibility, provenance, accepted status, parent composites, related Facts.

For a Fact: **short text at top**, kind, originating C task/stage, disclosures (human/admin only), linked Triangles, revisions, FactAnchor projections. Show a warning if the Fact looks like a plot outline.

For Triangle: two anchors (admin view), Fact, continuations, child Triangles, validation, convergence status, ability to compose or expand a specific gap.

For Composite: public interface summary, ports, member count, membership revision, conflicts, “open internal graph”, “refresh interface”, permissions. Do not reveal invisible members via counts in agent mode.

### 9.6 User journeys / UX acceptance

1. Create two independent Blocks manually or via isolated agents.
2. Select both → “Propose connecting Fact” → review minimal candidates.
3. Accept one Fact → create Triangle → approve disclosures to separate scopes.
4. Run side-specific continuations concurrently and inspect their results.
5. Select unresolved segment or a FactAnchor → “Expand narrative” with depth/cost controls.
6. Select Triangle or connected subgraph → “Compose into Block”.
7. Collapse to one node; link it to another composite through another Fact.
8. Open nested Block and inspect exact same immutable source artifacts.
9. Switch Graph/Fractal/Timeline without changing canonical graph.
10. Toggle agent-POV previews to verify isolation (backend-scoped queries).
11. Export as full authorized story, structure-only graph or agent-safe scoped package.

### 9.7 Visual diagnostics

Separate badges/inspector sections for `creative tension`, `continuity issue`, `temporal conflict`, `insufficient evidence`, `security boundary`. Never mark all contradictions with a single scary red error. Offer “ask C for alternative Fact” only where relevant.

---

## 10. Proposed API surface and event vocabulary

Keep current REST style or expose these operations via MCP adapters. Route names illustrative:

```text
POST   /projects/:id/blocks
POST   /projects/:id/facts/proposals
POST   /projects/:id/facts/:factId/accept
POST   /projects/:id/triangles
GET    /projects/:id/triangles/:triangleId
POST   /projects/:id/triangles/:triangleId/continue
POST   /projects/:id/triangles/:triangleId/reconcile
POST   /projects/:id/fact-anchors
POST   /projects/:id/composites
GET    /projects/:id/composites/:id/interface
GET    /projects/:id/composites/:id/members     [authorization-filtered]
POST   /projects/:id/composites/:id/refresh
GET    /projects/:id/views/graph
GET    /projects/:id/views/fractal
GET    /projects/:id/views/timeline
POST   /projects/:id/disclosures
POST   /projects/:id/disclosures/:id/revoke
POST   /projects/:id/runs
GET    /projects/:id/runs/:runId
POST   /projects/:id/runs/:runId/cancel
GET    /projects/:id/validation/:targetId
GET    /projects/:id/audit                       [privileged]
```

APIs MUST implement project-scoped authorization, version pins, idempotent writes, structured validation errors, cursor pagination and bounded graph traversals. Do not expose global entity existence or private counts to restricted principals.

Useful append-only domain events:

```text
block.created | block.revised | block.accepted
fact.proposed | fact.accepted | fact.rejected | fact.projected
triangle.created | triangle.continuation_added | triangle.converged | triangle.validated
composite.created | composite.revised | composite.view_collapsed
scope.created | disclosure.published | disclosure.revoked
run.started | task.queued | task.completed | task.failed | run.cancelled
validation.issue_opened | validation.issue_resolved
```

A render-only `view_collapsed` event may be ephemeral/local UI state instead of a canonical domain event; make that distinction in implementation.

---

## 11. Engineering decisions and failure modes

### 11.1 One unified Block abstraction, but not one single persistence blob

Keep atomic/composite Block interfaces compatible while preserving **type-safe references** to Facts/Triangles/relations. “Everything can act as a Block” does not mean all records have the same meaning or that an untyped generic node store suffices.

### 11.2 Why Triangle is a hyperedge/association, not a literal three-way timeline

`(A,F,B)` associates two events through a Fact, but C Fact need not occur _between_ A/B as a chronological event. If Fact is a person, object or world law, it may have no timestamp. The Triangle's rendering should not falsely insert it as a story beat.

### 11.3 “Every triangle is a Block” is a compositional contract

A Triangle is Block-like via `compose`, with a well-defined interface and review status. It isn't a claim that every random association is a complete good scene. This nuance prevents accidental validation bypass.

### 11.4 Two operations previously called “bridge”

Legacy: `bridge` generated **a complete intervening event / scene**.  
New: mediator `connect` generates **a short Fact**, while writer `advance` creates actual narrative Blocks.  
Both may coexist during migration under explicitly separate names. Do not automatically reinterpret legacy narrative bridges as Facts.

### 11.5 Boundary ownership and hidden destination

The orchestrator may know two endpoints to schedule C. A/B writing contexts may not receive both endpoints. If a writer can ask C “what happens at the end?” and get the answer through a helper tool, the isolation model is broken. C should publish minimal Facts instead of intended explanations or hidden endpoints.

### 11.6 Composite refresh is not automatic cascade rewrite

If a child changes, mark parent summary potentially stale; offer explicit refresh/review that creates a **new revision**. Never silently mutate ancestors or sibling Blocks in a background job.

### 11.7 Physical limits aren't universal story rules

Strong fiction may include unusual science or unreliable narrators. A validator should flag low-support physical transitions and suggest what explanation is missing, not overwrite established user-authored speculative facts.

### 11.8 Cost/performance guardrails

- Cache authorized, revision-keyed projections only within proper scope.
- Batch mediator inspections without mixing side-agent contexts.
- Defer expensive global semantic checks; prioritize local deterministic assertions.
- Graph views use paged incremental loading, virtualization/LOD and bounded neighborhood queries.
- Put per-gap cap on candidate Facts, continuations, nested expansion and token budget.
- Record useful metrics: accepted Facts, successful Triangle closure, fraction needing repair, disclosure violations (must be zero), tokens/accepted Block, user edit rate, subjective narrative quality.

---

## 12. Implementation roadmap (small, verifiable PRs)

### M0 — codebase audit + ADRs (do first)

**Deliver:** map current artifact schema/relation statuses, API ACL paths, agent principals, disclosure grant mechanics, export, UI read models; identify which prior RFC decisions are already implemented. Document migration and rollout plan. No speculative rewrite.

### M1 — canonical Block/Fact/Triangle semantics (no LLM required)

**Deliver:** typed domain module, persisted short Fact, Triangle, FactAnchor projection, revisions; local CRUD and adapters for legacy long bridges. Seed scripted fixture with stage-1 A/B + stage-2 C Fact.

### M2 — operations + secure gateway

**Deliver:** `connect`, `advance` persistence, grants, exact scope projections; negative isolation tests; access-filtered graph/search/export/websocket; audit trail. Use manual/test agent output initially.

### M3 — Web semantics and composer

**Deliver:** Fact/Block/Triangle-specific graph rendering, stage labels, nested composite creation/opening, correct Timeline treatment for atemporal Facts, scoped inspector and disclosure UI; no child deletion on collapse.

### M4 — agent skills and staged orchestration

**Deliver:** fact mediator skill and block writer skills, provider adapter, persisted generation DAG, concurrency, retries, scoped prompts, cancellation, stage 1/2 workflow, child-gap recursion with budget and stop conditions.

### M5 — validation and editorial controls

**Deliver:** deterministic time/state checks, LLM review for narrative ambiguity, human overrides, issue types, repair loop, provenance and evidence spans, Lighthouse regression fixtures.

### M6 — research and benchmark

**Deliver:** blinded quality comparison versus single-agent linear writing and conventional narrative interpolation on the same seeds/budget; ablations for Fact shortness, A/B isolation, C mediation, recursion, composition. Capture human-rated surprise, causal coherence, drama, budget and revision cost.

**Sequencing caveat:** M2 access enforcement is required _before_ production LLM scopes; M3 may be built partly in parallel with M2 but must not simulate security with frontend state.

---

## 13. Acceptance tests (machine verifiable wherever possible)

### 13.1 Semantic/model tests

- [ ] A Block can be atomic or composite and is still accepted as a `connect` endpoint.
- [ ] A Fact never silently stores a long-form scene; the API returns policy errors or marks it `needs_review`.
- [ ] A Fact with no time does not appear as a fabricated timed scene in Timeline.
- [ ] A Triangle has two valid anchor refs + one versioned Fact ref; its status can be incomplete.
- [ ] A FactAnchor points back to the original Fact revision; no destructive conversion.
- [ ] An A/Fact and B/Fact continuation produces **new Block identities**, not mutations to existing anchors.
- [ ] A writer can meaningfully incorporate a Fact without knowing the other Block.
- [ ] Relations distinguish chronological, causal, membership and contradiction types.

### 13.2 Composition tests

- [ ] Compose an accepted Triangle into M; connect M to N via a new C Fact.
- [ ] Nest M and N inside another composite and reopen all descendants with same IDs/revisions.
- [ ] Compose does not increase member access rights or expose hidden titles via member counts.
- [ ] Collapse/open view changes presentation only; never destroys graph records.
- [ ] Edited child marks parent summary stale; explicit refresh creates new revision.
- [ ] Reject cyclic composite containment (direct and indirect) atomically.
- [ ] External relations maintain provenance/typed ports; do not fabricate `causes`.
- [ ] Concurrent compose on same source revision handles optimistic conflicts safely.

### 13.3 Agent isolation tests — security gate

- [ ] A cannot retrieve B Block by known ID, search phrase, graph traversal, export, websocket subscription or relation preview.
- [ ] B cannot retrieve A by symmetric mechanisms.
- [ ] C with correct project/scope privilege reads both Blocks; C from another project cannot.
- [ ] A reads C Fact only with approved exact-version disclosure.
- [ ] A Fact disclosure never includes opposite title/summary/IDs/private reasoning.
- [ ] Revoked/expired grant cannot be fetched again; running session invalidation behavior documented.
- [ ] Composite membership projection cannot leak opposite scope.
- [ ] Admin UI and agent POV are served with different server-approved projections.
- [ ] Untrusted Block prose cannot override tools/auth through prompt injection.
- [ ] A/B provider traces and exports cannot contain opposing private source text.

### 13.4 Generation run tests

- [ ] Stage 1 seeds two independent Blocks in independent scopes.
- [ ] Stage 2 C Fact only starts after both required input revisions are available.
- [ ] A/B continuation tasks run in parallel once separate grants are issued.
- [ ] Same `stage_index` is supported for multiple independent tasks.
- [ ] `stage_index`, story time and expansion depth are stored in distinct fields and never used interchangeably.
- [ ] Task retry and network retry cannot duplicate accepted artifact commits.
- [ ] Budget/depth exhaustion stops with a comprehensible unresolved status.
- [ ] Scheduler supports asymmetric branch depth and uneven expansion.
- [ ] A partially filled Triangle can be saved and revisited without pretending convergence.
- [ ] Cancelled runs cannot keep issuing new scoped read tokens.

### 13.5 Continuity, creative tension and narrative QA

- [ ] Earth/Mars apparent contradiction produces possible _connecting Facts_ and is not rejected solely for being different.
- [ ] Already drained resource does not reappear without an explicit state-changing event; report offending span.
- [ ] Timestamp/deadline conflicts are flagged; numeric units are preserved.
- [ ] A “shutter vs metal screen” ambiguity is not automatically declared impossible if both could coexist.
- [ ] Recursion stops on low-drama micro-actions when value threshold/budget is reached.
- [ ] A Fact with a fully specified required plot outcome is rejected as too directive.
- [ ] An unreliable narrator's belief may disagree with objective state without automatic repair.
- [ ] Human may accept an unresolved creative mystery and compose it with visible status.

### 13.6 UI tests

- [ ] Graph displays distinct short Fact nodes vs authored Block scene nodes.
- [ ] Fractal shows stage 1 endpoints, stage 2 first C Fact, later generated stages and concurrency.
- [ ] Timeline uses story chronology rather than generation order.
- [ ] Compose selection -> create composite -> collapse -> connect composite -> reopen descendants works end-to-end.
- [ ] Scoped agent preview contains no metadata/tooltip/hidden component with opposing private content.
- [ ] Validation UI visually separates creative tension from continuity bug.
- [ ] Old lighthouse projects remain loadable after migration, with legacy bridge types preserved.

---

## 14. Canonical demonstration fixture

Use a **small structured fixture** so developers can implement without expensive provider calls:

```yaml
project: terra-vs-mars
run:
  generation_mode: block_fact
  max_depth: 3
stage_1:
  block_A:
    scope: A
    text: 'A woman remembers being born on Earth.'
  block_B:
    scope: B
    text: 'Her official birth record lists Mars.'
stage_2:
  fact_C:
    scope: C
    kind: document
    text: 'A sealed duplicate birth certificate.'
  disclosures:
    - to: A
      payload: fact_only
    - to: B
      payload: fact_only
stage_3:
  continuation_A:
    scope: A
    text: "She finds a registrar's seal she recognizes from childhood."
  continuation_B:
    scope: B
    text: 'The Martian archive refuses to release the second certificate.'
next:
  mediator_action: propose_child_fact_or_converge
  can_compose_triangle: true
```

Tests must verify A continuation's provider input does not contain the Martian source Block; B continuation's input does not contain Earth's source Block. C may read both, but the only cross-scope delivered information is the minimal certificate Fact. Compose the Triangle and use it as one endpoint in another run, verify lossless opening.

### 14.1 Second fixture — nested story composition

1. Three Fact/Block layers form a lighthouse rescue Triangle and nested continuations.
2. Human composes it as `RescueArc` with an interface (summary, temporal envelope, established state, unresolved constraints).
3. Another independent composer builds `SettlementArc`.
4. C sees the **interfaces** of both arcs and proposes “A ledger with a missing year.”
5. A writer continuing `RescueArc` receives only its own interface + fact grant, never the entire private SettlementArc.
6. Both continuations can join into a bigger Triangle, then a `PlanetHistory` Composite Block.
7. Original story beats and internal relations still exist and can be opened exactly.

---

## 15. Non-goals / explicitly deferred

- Automatically proving every fictional fact mathematically or physically possible.
- Generating unrestricted full-length books in one unbounded agent run.
- Treating numeric stage sequence as canonical timeline ordering.
- Giving all agents full knowledge to simplify quality.
- Converting every legacy long-form bridge into a Fact.
- Replacing working backend/UI stacks before repository inspection.
- Exposing raw internal graph access to third-party agents.
- Automatically publishing private subgraphs merely because they appear within a composite.
- Auto-smoothing every contradiction into a safe but boring explanation.

---

## 16. Open design questions — choose defaults and document ADRs

These are deliberate questions; don't silently make up user decisions:

1. Can C present Fact candidates to a human at every wave or should project policy auto-accept some of them? Default: first wave human review, automatic optional later.
2. Are Block-level Facts multiple per continuation? Default: one primary disclosed Fact, optionally 2–3 already-public local Facts.
3. Is a Triangle allowed to comprise composite endpoints representing different times/locations? Default: yes; interval/interface review required.
4. Should a C mediator receive full nested internals by default when connecting composites? Default: only reviewed interfaces; explicit deeper authorized retrieval when needed.
5. Should `FactAnchor` be persisted or computed? Default: persisted if referenced by child Triangle; ephemeral if used only for rendering.
6. Are A/B direction flags chosen by human or scheduler? Default: scheduler proposes based on known gap; humans override; flags are no-leak.
7. How to represent branch merging where multiple Facts connect the same Blocks? Default: different Triangle candidates, explicit alternative status; never overwrite accepted options.
8. How much world-rule context is genuinely public to both writers? Default: project-approved global lore only; opposite-private new lore never auto-published.
9. Which validator approvals block publishing vs produce non-blocking warnings? Default: security/structural failures block, hard continuity fail can block acceptance, speculative drama/physics stays advisory.

Record decisions in `docs/adr/` with dates; config schema must reflect chosen options.

---

## 17. Direct instruction for Claude Code / developer

> **Task: implement the Block–Fact Fractal Narrative model in the existing project.** Read this RFC and the prior documents, then inspect the actual repository. First produce a short current-state inventory and migration/PR plan; do **not** assume the old bridge entity already means “minimal Fact.” Preserve Graph, Fractal, Timeline, current artifacts/relations, principals, disclosures and exports.
>
> Implement typed Block/Fact/Triangle/FactAnchor/Composite domain objects with versioned provenance. A and B must write only locally from their own Block and a minimal disclosed C Fact; C can read both Block endpoints and publishes explicit versioned grants. Add stage-1 independent seeds and stage-2 initial Fact generation, then dependency-scheduled local continuations with asymmetric recursive subgaps. Add lossless composition of any Triangle/connected subgraph into a new Block, capable of participating in the same workflow recursively. Use server-enforced ACL throughout graph, search, export, streaming and agent tool calls. Preserve existing legacy long-form bridges as narrative Blocks. Upgrade UI views and add negative isolation tests, regression fixtures, and validation of real continuity defects without suppressing productive creative tension.
>
> Deliver in small PRs with runnable migrations, API tests, UI tests and updated docs. Report the exact files changed, design tradeoffs and unmet acceptance criteria. No destructive schema rewrite or fake client-only isolation.

### Suggested first implementation PR

1. Inventory + ADR defining **Block vs Fact vs legacy Bridge**.
2. Add `Fact` validation and `Triangle` persistence with versions and migration.
3. Add a manual minimal Fact insertion flow and an example Triangle in Graph/Fractal.
4. Add a complete server ACL negative test suite before connecting a real provider.
5. Demonstrate two Blocks joined by a Fact, independently created continuations, composition into one Block, then a second-level connection — all without an LLM.

Once this works, agent skills and provider orchestration become replaceable adapters to a tested domain engine rather than the source of truth.

---

## 18. One-page summary for future contributors

**Entities:** `Block` (point/segment in story), `Fact` (minimal open connector), `Triangle` (two anchors + Fact), `FactAnchor` (non-destructive Block-like Fact projection), `CompositeBlock` (lossless composed story subgraph).  
**Primitives:** `connect(Block,Block)->Fact`; `advance(Block,Fact)->Block`; `projectFact(Fact)->FactAnchor`; `compose(Triangle/Subgraph)->Block`; `collapseView` is UI only.  
**Execution:** independent A/B seeds → C first Fact (stage 2) → scoped disclosures → A/B local continuations → recursive child gaps → selective composition and higher-level linking.  
**Safety:** C may access both; A/B never see each other; all read models and agent tools enforce backend ACL.  
**Creativity:** preserve contradictory anchors as prompts for new Facts; distinguish accidental continuity bugs.  
**Scale:** persist graph + expansion/composition + execution/ACL separately, pin revisions, limit depth/cost, expose nested graphs in Web.  
**MVP acceptance:** manual end-to-end `A+B -> C fact -> AC/BC blocks -> Triangle -> Composite Block -> second Triangle` with complete provenance, isolation and reversible views.

---

## 19. FOUNDATIONAL UPDATE — human-first, participant-agnostic collaboration protocol (NORMATIVE)

### 19.1 Historical motivation and objective

The **original concept predates this agent implementation**: assemble three groups of people who **do not know how to write screenplays**, do not know the other group's private material, and ask them to co-create a scenario using only the framework's communication protocol. A/B independently author Blocks, C sees both and publishes intentionally minimal Facts; local writers continue using those Facts, and the resulting Triangles recursively compose and expand. This is a **social experiment and a creative collaboration protocol** first, _not_ an LLM optimization trick.

The arrival of capable agents made it possible to substitute automated executors for human participants, conduct inexpensive iterations and automate repetitive operations. **That substitution changes the executor, not the algorithm.** The framework MUST remain fully useful if all model integrations are disabled.

#### Primary question

> Can people with no screenplay-writing experience, each operating with bounded local knowledge, jointly produce an interesting, causally coherent and intricate story because of the _structure of the collaboration_, without any individual participant knowing the complete story?

#### Separate research questions (do not conflate)

1. Does the protocol produce a different or better output than unrestricted group collaboration, controlling for effort and conditions?
2. What effect does isolating participants' information have on novelty and causal coherence?
3. What effect does using _short, open-ended C Facts_ have compared with verbose explanations?
4. Can useful, surprising relationships emerge without anyone designing the full global plot?
5. Does recursive composition help larger groups scale without requiring global story knowledge?
6. Do human-only, agent-only and mixed-author modes differ in quality, process and participant experience?

None of these hypotheses has been proven by existing lighthouse generations; those are system demonstrations, not a controlled human study.

### 19.2 Non-negotiable architecture boundary

```text
                  WEB HUMAN WORKSPACE       AGENT / AUTOMATION RUNNER
                          |                            |
                          v                            v
                  HumanParticipantAdapter       AIParticipantAdapter
                          |                            |
                          +-------------+--------------+
                                        |
                                Task / Submission API
                                        |
                              Participant-neutral CORE
                    Block · Fact · Triangle · Compose · ACL
                                        |
                           Event store / persistence / views
```

**Core** must know identities, role permissions, revisions, submissions, validation and state transitions. It MUST NOT import model SDKs, prompts or provider response types. Adapters can require their own infrastructure, but no domain operation should require AI credentials or a running inference provider.

Use identical _logical_ tasks across human/AI adapters (`SeedBlock`, `ProposeFact`, `AdvanceBlock`, `ReviewTriangle`, `ComposeSubgraph`). Submission payloads must be independently validated by the server. The UI may expose ergonomic differences (human editing, timeouts; model retries), but must not change semantic rules or privileges.

### 19.3 People, groups, roles and scopes are different concepts

- **Participant**: an individual person or an automated executor with an authenticated identity.
- **Group**: a collaboration unit of one or more participants. A/B/C are _roles assigned to a group for a particular gap/run_, not hard-coded permanent organizations.
- **Assignment**: one participant/group, one task and one isolated scope, with expiry and permissions.
- **Authored contribution**: a submitted Block, Fact, review, vote or editorial choice, with attributable provenance.
- **Mediator**: actor with explicit C permissions for the given gap; can be human or AI.
- **Facilitator / experiment organizer**: manages study conditions and schedules, but must not invisibly rewrite authored stories or secretly leak information to A/B.
- **Reviewer**: may see complete outputs for evaluation under a separate access policy; not automatically permitted to inject facts into active writing tasks.

Do not model a three-person human C group as three agents each holding a system-wide admin token. Grant narrowly scoped C visibility via the same gateway and record all use.

### 19.4 Interface contracts (illustrative TypeScript)

```ts
export type ExecutorKind = 'human' | 'ai' | 'scripted';
export type GenerationRole = 'A' | 'B' | 'C';

export interface ParticipantIdentity {
	id: string;
	executorKind: ExecutorKind;
	displayName: string; // privacy-safe pseudonym can be used
	active: boolean;
}

export interface GroupMembership {
	groupId: string;
	participantId: string;
	membershipRole: 'member' | 'facilitator';
}

export interface ScopedAssignment {
	id: string;
	runId: string;
	groupId: string;
	role: GenerationRole;
	gapId: string;
	accessScopeId: string;
	taskId: string;
	taskType:
		| 'seed_block'
		| 'propose_fact'
		| 'advance_block'
		| 'review_triangle'
		| 'compose_subgraph';
	state: 'pending' | 'claimed' | 'submitted' | 'approved' | 'rejected' | 'expired' | 'cancelled';
	assignedAt: string;
	expiresAt?: string;
}

export interface ParticipantSubmission<T> {
	taskId: string;
	assignmentId: string;
	authorParticipantId: string;
	payload: T;
	baseRevision: string;
	idempotencyKey: string;
	submittedAt: string;
}

export interface ParticipantAdapter {
	kind: ExecutorKind;
	deliver(task: AuthorizedTaskView): Promise<void>;
	// Human: queue/UI notification; AI: provider invocation; scripted: test harness.
	// A submission must go through the same trusted gateway.
}
```

`AuthorizedTaskView` MUST be assembled server-side from the same least-privilege policy used for agents. Never serialize the full story graph into a task and merely hide fields in UI. A human's ability to open a browser must not confer elevated narrative permissions.

### 19.5 Human-only end-to-end operation (required)

1. A facilitator creates a story project and invites participants to distinct private A, B and C workspaces.
2. A and B independently submit their initial Blocks (generation stage 1), without seeing the other workspace or global plot.
3. The server opens a C mediation task showing both Blocks (stage 2). C members propose **brief, deliberately non-directive Facts** and may vote/select one under run policy.
4. C publishes the chosen Fact through an audited disclosure to the appropriate A/B scopes. No opposite Block text or hidden summary is sent.
5. A and B independently draft their own next Blocks using only their Block, local canon and the disclosed Fact. They **do not learn their global position or the target Block**.
6. A facilitator or scheduler detects remaining structural gaps; C proposes further Facts and A/B continue locally. Tasks may be parallelized when independent.
7. A Triangle is inspected for possible coherence, then may be composed into a Composite Block, retaining the internal graph and provenance.
8. Composites can serve as new Block endpoints to repeat the same protocol at higher levels.
9. Facilitators may stop a branch, request an explanation for a tension, or choose among alternatives. Rejections and editor interventions remain logged.
10. The final story can be exported with an optional attribution view, and readers can inspect the narrative graph without gaining access to participants' hidden working documents.

**Acceptance:** with AI integration disabled and no agent keys configured, a team of humans can complete steps 1–10 from the Web UI. No fake agent principal is needed to represent a human user.

### 19.6 Group collaboration policy

A group may comprise several people. Members of _the same group_ can be allowed to see and discuss their group-scoped submissions. Cross-group communications A↔B remain disallowed for an isolated run; C's curated Fact disclosures are the only normal boundary crossing. The system should support at least these per-task group resolution policies:

- `single_author` — one designated person submits.
- `proposal_vote` — members separately propose; group votes, then one submission is accepted.
- `collaborative_draft` — shared draft within one scope, frozen on submission.

The collaboration mode is specified by the run and recorded for later analysis. Changing group membership does not grant retroactive access across unrelated scopes. A person accidentally assigned both A and B within an isolated experiment is a **protocol violation**, not something an ACL alone can prevent from contaminating the study.

### 19.7 Human information boundaries and procedural realism

Technical restrictions can prevent app/API disclosure; they cannot erase what people already know or stop off-platform discussion. Therefore:

- require separate tasks and participant assignment checks;
- prohibit cross-side membership **within the same isolated run** by default;
- present clear do-not-share study instructions if applicable;
- allow facilitators to mark suspected contamination without publicly accusing participants;
- measure accidental information leaks via surveys/checkpoints, without surveillance or invasive monitoring;
- never claim perfect psychological isolation, even when server ACL is perfect.

A/B participants should not see counts, opposite usernames, timestamps, graph positions, future step names, global goal labels or C's source rationale if those reveal the opposite side. A human-run participant view must be different from the facilitator's overview. Explicitly test side channels in real Web flows.

---

## 20. WEB PRODUCT — human creative workspace, not merely agent-debug UI

### 20.1 Required user-facing workspaces

**Participant task inbox:** assigned writing/mediation/review tasks, their statuses, claim/submit flows, permitted time budgets and allowed context. For A/B, show _only_ local Block(s), disclosed Fact(s), and relevant approved local canon. For C, display the two endpoints, selectable context and a Fact proposal editor with word/length feedback and a reminder to avoid prescribing a plot.

**Group workspace:** within-group proposals, review/voting if enabled, conflict handling and author attribution. Shared editing is optional for MVP; durable draft/version semantics are not.

**Facilitator dashboard:** create groups, assign roles, start/pause runs, select mediation policy, inspect task readiness, approve disclosure requests, manage composition, inspect study quality and export. Only facilitators/authorized auditors see the global execution graph.

**Reader / graph:** Graph, Fractal, Timeline and composed artifact exploration continue to work. Public reading mode should provide a coherent story without internal private author prompts, identities or unresolved private drafts unless expressly published.

### 20.2 Human UX requirements

- Auto-save draft with revision conflicts handled explicitly.
- Accessible Block and Fact editors; Fact length linting must be advisory on drafting and validated at submit time.
- Clear distinction: **Fact is a constraint/circumstance, not a draft of the next scene.**
- Show locally actionable feedback, e.g. `This fact specifies a resolution; make it shorter/more open-ended`.
- Draft lock/submission acknowledgment, review/reopen/resubmit workflow; no silent overwrite.
- Keep task metadata separate from story chronology. Stage 2 is initial C Fact, never “the second scene”.
- Mobile-friendly task entry is recommended, but graph manipulation can remain desktop-first initially.
- Screen readers, keyboard controls and color-independent role labels. Blue/red/yellow cannot be the only communication of roles.
- Ability to collapse any completed Triangle/subgraph into a Composite Block, then open its source again losslessly.

### 20.3 Human-first delivery order (overrides AI-first interpretations)

1. Implement participant, group, assignment and submitted-contribution domain paths with mocked/scripted actors.
2. Build the smallest Web task inbox + authoring forms for A/B/C, backed by the same scope gateway.
3. Finish a human-only `Block A + Block B → short Fact C → continuations → Triangle → Composite` run.
4. Add within-group proposal/vote handling if the first human experiment requires multiple people per side.
5. Only then attach AI adapters to the _same_ task lifecycle; no domain fork and no special `agentFact` type.

This ordering does not require throwing away already implemented agent principals. Provide a shared **ActorPrincipal** permission layer or a clearly audited adapter from human user identities and current agent principals to the same scoped capability checks. Preserve existing IDs and disclosures.

---

## 21. EXPERIMENT DESIGN — optional research mode, explicitly not a claim of efficacy

### 21.1 Study conditions

For an initial pilot, recruit consenting adult volunteers with little/no screenwriting experience (self-report, do not misrepresent professional eligibility). Three proposed conditions:

| Condition                    | Information & production protocol                                                                               | Purpose                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Fractal human-only**       | A/B separated; C gets both endpoints and publishes minimal Facts; recursive local continuation and composition. | Test full original idea.                                                     |
| **Open collaboration**       | Comparable participants coauthor with shared context, similar duration and task objectives.                     | Comparison with ordinary group writing.                                      |
| **Separated, no C mediator** | Isolated groups contribute locally under a predetermined neutral coordination rule.                             | Probe the mediator's contribution; define the neutral rule before the study. |

This is a **proposal**, not a user-specified immutable research design. A small feasibility pilot can precede a powered study. Match writing time, group sizes, seed difficulty, language, story length, facilitator interventions and access to writing tools where possible. Run conditions on multiple randomized seed pairs. Do not confuse the number of Blocks or token length with literary quality.

### 21.2 Primary and secondary measures

- **Human-blinded story quality**: overall interest, coherence, perceived originality, character development and thematic payoff; use a documented rubric, independent raters and randomized anonymized outputs.
- **Process**: task completion, time to accepted Triangle, number of revision cycles, rejected/accepted Facts, number of escalations, completion rate, density of reused Facts, accidental continuity issues.
- **Knowledge asymmetry**: brief voluntary post-task questions about what each participant believed the other story was; avoid leaking actual answer during active work.
- **Collaboration experience**: agency, creativity, confusion, engagement, and willingness to participate again.
- **Study integrity**: assignment overlap, known outside communication, disallowed exposures and facilitator interventions.
- **Cost and feasibility**: staff time, tooling overhead, and, in AI conditions only, inference spending.

Ratings should be interpreted as estimates under study constraints. Do not prelabel the protocol “better”, “emergent”, “scientifically proven” or “revolutionary”.

### 21.3 Consent and privacy

Present understandable consent information: story is jointly authored; other participants may view specified submissions; evaluators may read anonymized exports; participation is voluntary; explain retention, withdrawal policy and possible publication of outputs. If participants might be paired with AI, disclose the possibility in consent. If masking exact partner identity is part of a protocol, seek appropriate ethics guidance rather than implying uninformed deception is acceptable.

For safety and practicality:

- use pseudonyms or participant IDs in public exports;
- separate study identity/contact information from creative artifacts;
- keep facilitator-only annotations out of participants' views;
- restrict exports to explicitly allowed data;
- allow participant contributions to be removed from publication as policy permits, distinguishing this from immutable internal audit retention;
- set retention, deletion and access requests policy _before_ recruiting;
- do not infer or collect sensitive traits unless strictly necessary and appropriately consented.

A formal publication study may require institutional or independent ethics review depending on jurisdiction and institution; a casual creative workshop still deserves informed, respectful consent.

### 21.4 Reproducibility fields (per run)

```ts
interface ExperimentRunConfig {
	protocolVersion: string;
	condition: 'fractal_isolated' | 'open_collaboration' | 'isolated_no_mediator' | 'custom';
	participantMode: 'human_only' | 'ai_only' | 'mixed';
	seedSetId: string;
	randomizationSeed?: string;
	groupSizes: { A: number; B: number; C: number };
	factWordLimit: number;
	maxDepth: number;
	targetTaskMinutes?: number;
	reviewPolicy: 'facilitator' | 'group_vote' | 'auto';
	consentPolicyVersion?: string;
	rubricVersion?: string;
}
```

Reproducibility means recording conditions and decision history. Human results are not expected to regenerate bit-for-bit. LLM randomness should be separately captured when an AI adapter is enabled.

---

## 22. AGENT/AI SUPPORT — optional plugin layer

### 22.1 Adapter equivalence

AI participants submit the same `ParticipantSubmission<Block | Fact | Review>` to the same gateway as humans. The adapter translates an authorized task into a prompt, invokes a model and returns a candidate submission. The server then enforces word limits, scope, provenance, validation and state transitions. This prevents prompt behavior from silently changing the semantics of the protocol.

**No special powers for AI:** a model with A authorization cannot search B via MCP, REST, project graph export, side metadata or shared logs. A human assigned A has the same semantic boundary. C accesses both only when given a mediator task and can publish only the approved Fact disclosure. Model providers and human writers must not receive private material through telemetry, tool traces or reviewer views unintentionally.

### 22.2 Mixed-mode assignment examples

- `A: humans, B: humans, C: human` — original social experiment.
- `A: AI, B: AI, C: AI` — synthetic testbed.
- `A: humans, B: AI, C: human` — mixed collaboration.
- `A: human, B: human, C: AI` — mediator suggestion workflow with human acceptance.

Mixed mode must preserve the **same Block–Fact rules**, but outcomes from mixed and human-only runs must be analyzed separately unless comparison is planned. Humans remain the authors of their own submitted text; model-assisted edits and facilitator rewrites should be attributed.

### 22.3 Failure and manual fallback

If no model credentials exist or the model provider fails, pending AI assignments should be reassignable to a consenting human or scripted test participant without changing graph entities. Existing accepted contributions remain intact, and rerun must not duplicate submissions. Do not automatically share private opposite-side context during reassignment.

---

## 23. ROADMAP ADDENDUM — deliver the original human experiment first

The original M0–M6 roadmap remains a useful migration guide, but **the human-first acceptance gate takes priority over an agent-only demo**:

| Gate | Required deliverable                                             | Evidence                                                                                        |
| ---- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| H0   | Audit actual repo + ADR: protocol core independent of executors. | Dependency map; no model SDK imports in domain core.                                            |
| H1   | Human participant/group/assignment permission model.             | API contract and negative A/B isolation tests.                                                  |
| H2   | Human task inbox with seed, Fact and continuation editors.       | Web end-to-end run with no AI keys.                                                             |
| H3   | Human C mediation + Fact-only disclosure + group policy.         | Recorded audit events; opposite Block not visible in A/B.                                       |
| H4   | Recursive Triangle composition and readable public/story export. | Collapse/open round trip with source revisions preserved.                                       |
| H5   | Small, opt-in, human-only feasibility workshop.                  | Completion metrics and anonymized output with consent.                                          |
| H6   | AI and mixed-mode adapters through identical task contracts.     | Swappable executor tests, no schema/ACL fork.                                                   |
| H7   | Optional controlled comparison study.                            | Preregistered evaluation plan or internally documented rubric, blinded scoring and limitations. |

#### Integration into the existing M milestones

- **M0:** add participant-neutral ADR and existing human identity review.
- **M1–M2:** add a shared actor/permission model and non-model Task/Submission API alongside Block/Fact/Triangle.
- **M3:** make Graph/Fractal/Timeline _and_ human authoring workspaces available; editor-first usability over orchestration spectacle.
- **M4:** implement optional AI adapter only after human task contract is stable; do not hardwire the scheduler to model calls.
- **M5:** preserve creative tension and correct genuine continuity errors for both human and AI writing.
- **M6:** include actual human collaboration experiments, not just LLM-vs-LLM benchmarks.

---

## 24. ADDITIONAL ACCEPTANCE TESTS — mandatory for human-first compliance

### Functional / architecture

1. Start new run with `participantMode=human_only` and **zero AI credentials**; complete and export a short composed story.
2. Assign multiple humans to A, B and C; configure `proposal_vote` for C; accepted Fact follows configured policy.
3. Human A receives A Block + granted Fact, but no B text, B metadata, B identity or global target, from any UI/API/search/stream/export endpoint.
4. Human B is symmetrically isolated; authorization is identical to that used for AI B.
5. C mediator can inspect authorized endpoints and publish an audited, short Fact; attempting to disclose raw opposite Block fails.
6. A/B author Blocks from the same Fact independently, at matching stage number, with revisions pinned.
7. Compose a completed Triangle into a Block and then link that composite to a second Block with a new human-authored C Fact; original members open intact.
8. Replace an AI task executor with a human and vice versa, with identical task type and submission validation, without altering story domain tables.
9. Revoke a Fact grant; subsequent reads fail; previously authored submissions remain attributed and any revocation implications are clearly visible.
10. A/B cannot infer forbidden material from errors, counts, relation labels, notifications, collaborator lists or preview renderers.

### Study and responsible execution

11. Record experiment condition, protocol/rubric versions, facilitator interventions and participant mode without mixing runtime metrics with story timeline.
12. Export anonymized outputs for blind reviewers, excluding identity, private drafts and facilitator annotations by default.
13. Validate consent workflow/notice before enrolling a participant in research-mode runs; show publication/retention rules.
14. Facilitator can flag suspected cross-group contamination; the system logs the flag without auto-accusing authors or changing their source text.
15. Evaluate identical human A/B/C fixtures using a scripted adapter and Web humans; structural resulting schema is identical.
16. Ensure every human-only flow can be performed through accessible Web controls, not only via MCP or an admin API.

---

## 25. UPDATED DEVELOPER HANDOFF — overrides AI-centric readings of §17

> **Implement a participant-agnostic fractal narrative collaboration protocol, originally intended for three groups of non-screenwriter humans.** The product must allow humans to perform A/B Block authoring, C Fact mediation, recursive advancement and lossless Triangle/composite composition **without any LLM**. Keep existing architecture, artifact IDs, Graph/Fractal/Timeline, agent principals and disclosure security. Audit the repo first. Introduce a shared task/submission/assignment model and authenticated human workspaces; do not store the model prompt as the narrative source of truth. Once the human-only E2E flow works, plug agents into exactly the same contracts. Preserve strict A/B isolation from opposite Block and global destination, ensure C sends minimal non-directive facts only, and support optional human-only / agent-only / mixed runs. Provide group collaboration modes, optional ethics-aware research instrumentation, typed schemas, migrations, API and Web E2E tests, and an incrementally executable implementation plan. The project is **not** an “AI screenwriting app” by definition; AI is a replaceable participant adapter.

**Developer's first task:** read the entire RFC; inventory the codebase and existing user/session/agent auth. Write a concise ADR for the shared `Participant / Group / Assignment / Task / Submission` model and how it maps to Block–Fact permissions. Implement a minimal **human-only** story generation session with A/B isolated, C Fact-only disclosure, Triangle→Composite→next Triangle. Demonstrate it without AI credentials and with browser-network/API attempts to read opposite private content rejected by the server. Then integrate optional agent adapters and compare their output under the same protocol.

**Scope discipline:** do not implement the research platform, voting, statistics or participant recruitment as prerequisites for the first working human-only session unless product needs demand them. Research mode is a designed extension, not a reason to delay core creative collaboration.
