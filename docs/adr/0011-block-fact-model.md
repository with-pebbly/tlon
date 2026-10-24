# ADR 0011 — Block–Fact model on top of the existing graph

- Status: accepted
- Date: 2026-10-25
- Source: [BLOCK_FACT_ARCHITECTURE_PART_1.md](../BLOCK_FACT_ARCHITECTURE_PART_1.md),
  [PART_2](../BLOCK_FACT_ARCHITECTURE_PART_2.md) (supersedes the conceptual model of
  ARCHITECTURE.md / COMPOSITE_ARTIFACTS_SPEC.md; reviews remain fixtures)

## Inventory (M0/H0)

| RFC concept            | Existing code before this ADR                                  | Decision                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Block (atomic)         | `artifacts` (+ revisions, scopes, locks)                       | **Is** an artifact with `artifact_class = BLOCK` (default for every existing row).                                                                                                                                                              |
| Composite Block        | `composition = COMPOSITE` + `composite_definitions` (ADR 0009) | Unchanged; a composite may now contain Facts and Triangle members.                                                                                                                                                                              |
| Legacy bridge          | `expansions` + accepted `BRIDGE` artifact = a full scene       | Kept as is (legacy, read-only in new runs). Its artifacts are **Blocks**, never reinterpreted as Facts (§5.3, §11.4).                                                                                                                           |
| Fact                   | —                                                              | New `artifact_class = FACT` artifact: `title` holds the ≤ 160-char text, `fact_kind` typed, body empty. Revisions, scopes, grants and audit come for free. Mediator rationale lives in `fact_rationales` (HUMAN/C only), never in the artifact. |
| Triangle               | — (expansions were the closest)                                | New `triangles` table: left/right anchor revisions, fact revision (nullable while proposed), status, `stage_index`, `depth`, parent triangle; `triangle_continuations`; `fact_candidates`. Readable by HUMAN/C/VALIDATOR only.                  |
| FactAnchor             | —                                                              | `fact_anchors` row (persisted when a Fact becomes an anchor, §16.5).                                                                                                                                                                            |
| Disclosure             | `disclosures` + `grants` (ADR 0007)                            | Fact disclosure = READ grant on the exact Fact artifact + a `disclosures` record (`fact_only`), so it appears in the existing review UI. No copy, no opposite ids.                                                                              |
| Participants           | `agent_principals` + tokens                                    | Same table, new `executor_kind` (`human`/`ai`/`scripted`). A human participant is a principal with a link token — no fake agent.                                                                                                                |
| Tasks / runs           | runner-local state                                             | New `protocol_runs` (config + side briefs, facilitator-only) and `protocol_tasks` (type, role, assignee, state, stage, depth, triangle, side, direction, results, idempotency).                                                                 |
| Graph/Fractal/Timeline | expansions-based pyramid                                       | Pyramid also draws Triangles (Fact apex over its anchors, stage labels); Facts are never story beats or timeline events.                                                                                                                        |
| Validation (ADR 0010)  | transitions/issues on Blocks                                   | Unchanged, applies to Blocks; Facts are atemporal.                                                                                                                                                                                              |

## Decisions

- **Operations** map to server endpoints with the RFC's disambiguated names:
  `connect` (open a gap → C `propose_fact` task), accept a Fact candidate (→ Triangle
  gets its Fact, `fact_only` disclosures to the advancing sides, `advance_block` tasks),
  `advance` (a side submits a new Block in its own scope, linked to its anchor and the
  Fact), `projectFact` (FactAnchor), `compose` (existing composites; a Triangle
  selection = anchors + Fact + continuations + their relations). `collapseView` stays
  UI-only.
- **Fact policy** (`lintFactText`): hard cap 160 characters and a single statement are
  submit-time errors; word range and directive phrasing are warnings shown to the
  writer/facilitator.
- **Stage / depth / time are separate fields.** Seeds are stage 1, the first C Fact
  stage 2, continuations stage = fact stage + 1, a new gap's Fact = max(anchor stages)
  - 1. `depth` is the triangle hierarchy. Story time stays in Block contracts.
- **Directions.** Default for a gap: the left side advances `forward`, the right side
  `backward` (writes a prerequisite), both without seeing the other endpoint (§1.3).
- **Legacy runner** (`packages/agents/src/run.ts`, full-scene bridges) is kept only for
  old projects; new runs use the protocol runner.
