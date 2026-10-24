# ADR 0008 — Isolated agent runner on the omp SDK (M4, first slice)

- Status: accepted
- Date: 2026-10-24

## Decision

- `packages/agents` runs A, B and C as separate in-process omp SDK sessions (Bun),
  each created with `createAgentSession` and:
  - `SessionManager.inMemory()`, a private `AgentRegistry`, `bindProcessState: false`;
  - `Settings.isolated({ memory.backend: off, autolearn.enabled: false })` — omp
    long-term memory is a shared store and would otherwise be a side channel between
    agents;
  - `restrictToolNames: true` with only gateway tools (`customTools` +
    `allowRestrictedCustomTools`), no MCP/LSP/extensions/skills/context files, an empty
    temp `cwd`;
  - its own gateway token; tools never filter data themselves.
- Tool surface follows §7.4: `artifact_list_visible`, `artifact_create`,
  `relation_propose` for A/B; C additionally gets `expansion_propose`,
  `expansion_submit_candidate`, `disclosure_publish`.
- **Run policy: one recursive tree.** A writes the opening, B the ending (in parallel,
  isolated). C then bridges the A→B seam and, round after round, every open child
  interval level by level up to `--max-depth` (default 5, ≤ 31 bridges), until the
  scenario reaches `--target` blocks (default 30). Intervals inside an author's own
  chain are not bridged, so the result is one fractal rather than a line of small
  triangles. Finally C briefs A and B through disclosures.
- **Approval.** By default the orchestrator accepts each bridge and publishes each
  disclosure as the operator, with an explicit `reason` recorded in the revision and
  audit trail; `--review` stops after C's first proposals for human review instead.
- The orchestrator provisions principals/tokens as the operator and finally checks
  isolation with the agents' own tokens: both authors must have produced artifacts,
  and every hidden artifact must be absent from the other author's graph and search and
  return 404 on direct and revision reads (exit code 1 otherwise). Tool errors are
  logged per agent.

## Not yet (rest of M4)

Run ledger (`agent_runs`, input/output manifests, costs), budgets, idempotency per run,
a second round where A/B continue from published disclosures, VALIDATOR runs.
