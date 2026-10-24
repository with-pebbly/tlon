# ADR 0009 — Composite artifacts

- Status: accepted
- Date: 2026-10-24
- Spec: [COMPOSITE_ARTIFACTS_SPEC.md](../COMPOSITE_ARTIFACTS_SPEC.md)

## Decision

- **One artifact model.** A composite is an ordinary artifact with
  `composition = 'COMPOSITE'` (new column, default `ATOMIC`; existing rows need no
  content migration). `kind` stays the narrative label (default `ARC`), so levels
  (scene/arc/act/story) are labels, not storage types. Composites take part in
  relations, expansions (`Bridge(M, N)`), disclosures and revisions exactly like
  atomic artifacts — the bridge pipeline is unchanged.
- **Versioned definition.** `composite_definitions` (one row per definition version,
  bound to the composite artifact revision created with it) holds the public contract
  (summary, entry/exit conditions, invariants, key claims citing member revisions,
  open questions) and the boundary (entries/exits). `composite_members` pins each
  member's revision and display order; `composite_relation_members` snapshots the
  internal semantic edges. Revising a definition always appends a new artifact
  revision, so the existing pinned-anchor mechanism marks dependent bridges stale.
- **Membership ≠ semantics.** Membership exists only in composite tables; relation
  types `contains`/`member_of`/`part_of` are reserved. Boundary relations are never
  rewritten; the UI shows derived, explicitly labelled _aggregated_ edges
  (`collapseComposites` in `@tlon/core`).
- **DAG membership.** A member may belong to several composites (no copy). A
  definition that would make a composite contain itself transitively fails with
  `MEMBERSHIP_CYCLE`.
- **Access.** A composite has its own scope; reading it never grants its members.
  Every member, relation and nested composite is filtered by the caller's visibility
  — hidden ones are omitted without ids or counts. Composing requires reading every
  member (else `ARTIFACT_NOT_FOUND`). The composite's audience must be contained in
  every member's audience (`SCOPE_LEAK` otherwise), so composition never launders
  A/B-private material to the other side; A/B only reach a composite through a grant.
- **Stale bridges.** Expansions expose derived `staleSides` when an anchor's head
  revision moved past the pinned one after acceptance. Nothing is rewritten.
- **Archive, never delete.** `ARCHIVED` status retires a composite; members and
  relations are untouched.
- **Collapse/Open are UI state** (local, per project); **Compose** is the domain write.

## Consequences

- The pyramid layout treats an open composite as its members inside a frame; a
  bridge anchored on it resolves to its boundary (left anchor → exits, right anchor →
  entries), so `Bridge(M, N)` sits between M's exit and N's entry and the story export
  reads in order.
- Export bundles carry `compositeDefinitions` (additive, defaults to empty).
