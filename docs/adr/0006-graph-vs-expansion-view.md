# ADR 0006 — Semantic graph vs expansion tree vs presentation

- Status: accepted
- Date: 2026-10-24

## Decision

- **Semantic graph** (artifacts + relations) is a directed multigraph and may be cyclic,
  except for `precedes` and `derived_from`, which are kept acyclic (`CYCLE_DETECTED`).
- **Expansion tree** is derived from expansion records: roots are relations not produced
  by an expansion; an accepted expansion contributes its two child relations as
  children. `buildFractalTree` in `@tlon/core` computes it for the web _Fractal_ view and
  the CLI `graph` command.
- **Timeline** linearises each root interval by flattening its expansion tree
  (`left … C … right`). It is a reading order, not a claim that C is a chronological
  midpoint (§13).
- **Presentation:** the web canvas hides collapsed parent edges and rejected candidates by
  default. Node positions come from ELK; positions a user drags are stored in browser
  `localStorage` per project and view, never in the canonical graph.
