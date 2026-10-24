# ADR 0005 — Ownership and the authorization seam for M3

- Status: accepted
- Date: 2026-10-24

## Context

M0–M2 are single-user and must not ship agents, yet §7 requires a gateway that enforces
isolation server-side. Retro-fitting authorization into unscoped queries is the risk.

## Decision

- Every store-service method takes a `Principal` first and calls one `authorize`
  function (project membership; deny by default). Every query is scoped by `project_id`.
- The API resolves the principal in one place (`resolvePrincipal`). In M0–M2 it always
  returns `LOCAL_HUMAN`; the creating principal becomes the project's `OWNER` member.
- Artifacts carry `owner_scope` and `creator_role`; artifact reads filter by
  `visibleScopesFor(principal)` (`@tlon/core`). Only HUMAN principals exist today, so the
  filter is a pass-through, but the code path is the one M3 tightens.
- New artifacts and bridge candidates default to `PROJECT_PUBLIC` in M0–M2.
- Error messages, logs and audit metadata contain IDs only, never titles or bodies.

## Deferred to M3

Per-agent short-lived tokens, `grants` and `disclosures` tables, policy-filtered
search/traversal without count leakage, and the isolation test suite of §9.
