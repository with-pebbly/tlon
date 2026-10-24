# ADR 0007 — Artifact Gateway (M3)

- Status: accepted
- Date: 2026-10-24

## Context

§7.2 requires isolation between agents A and B enforced server-side, not by prompts.
M0–M2 resolved every request to `LOCAL_HUMAN`.

## Decision

- **Identity.** Agent principals (`agent_principals`) are bound to one project and hold
  one role (A, B, C, VALIDATOR). The human mints short-lived bearer tokens
  (`tlon_<secret>`, default TTL 1 h, max 24 h); only `sha256(token)` is stored. The
  role always comes from the principal record; role/principal fields in requests are
  ignored.
- **Human access.** A request without a token is the local operator only when the TCP
  peer is loopback (proxy headers are ignored). Real human authentication is out of
  scope until multi-user (§10 non-goal).
- **Policy in one place.** `@tlon/core/visibility.ts` defines visible scopes,
  creation/write scopes and the role → action matrix. The store applies one SQL
  visibility predicate (scope ∈ visible scopes ∨ active READ grant) to every artifact,
  relation, revision, list, search and graph read.
- **Deny without leaking.** Invisible artifacts are indistinguishable from nonexistent
  ones (`ARTIFACT_NOT_FOUND`); relations need both endpoints visible; A/B never see
  expansions, global counts, or hidden provenance IDs. Foreign projects answer
  `PROJECT_NOT_FOUND`. Disallowed actions answer `FORBIDDEN`.
- **Default visibility.** A sees only `A_PRIVATE`, B only `B_PRIVATE` — including no
  `PROJECT_PUBLIC` canon: anything else reaches them through grants. C and VALIDATOR
  see the whole project; VALIDATOR cannot write.
- **Disclosure.** C proposes (`PENDING`) a purpose-built payload citing pinned source
  revisions; the human publishes. Publishing creates a new `C_SHARED` artifact and a
  READ grant for the destination on that artifact only — never on the sources.
  Revocation is prospective.
- **Approval policy (MVP).** Only the human accepts/rejects bridges and disclosures.
- **Audit.** Denials and mutations are recorded with IDs only; `GET /audit/own`.

## Consequences

- M4 agent tools are thin wrappers over these endpoints with a per-run token; no tool
  needs its own filtering.
- Bridges accepted between private anchors are visible to C/human only until disclosed.
