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
- The orchestrator provisions principals/tokens as the operator, runs A and B in
  parallel, then C, and finally checks isolation through the gateway with the agents'
  own tokens (exit code 1 on any leak). The human reviews bridges and disclosures in
  the web UI.

## Not yet (rest of M4)

Run ledger (`agent_runs`, input/output manifests, costs), budgets, idempotency per run,
a second round where A/B continue from published disclosures, VALIDATOR runs.
