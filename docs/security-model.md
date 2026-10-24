# Security model

## Today (M0–M2)

- Single local user. The API binds to `127.0.0.1` and resolves every request to the
  `LOCAL_HUMAN` principal; there is no authentication. Do not expose the API on a
  public interface.
- Every service call is authorised against project membership and scoped by
  `project_id`; artifact reads pass through `visibleScopesFor(principal)`.
- Artifact text is untrusted data: the web UI renders it as text (no HTML injection),
  and logs, errors and audit metadata carry IDs only.
- Import validates the whole bundle (schema + referential integrity) before writing.

## Planned (M3, ARCHITECTURE.md §7.2 / §9)

- Authenticated principals with per-agent short-lived tokens; `principalId` never taken
  from request parameters.
- `grants` and `disclosures` tables; C→A/B disclosures create new C-owned artifacts
  with pinned source revisions.
- Gateway authorisation on every list/read/search/traverse/export, without leaking
  hidden endpoints or counts.
- The §9 isolation suite (A cannot read B, forged IDs fail, revocation is prospective,
  prompt injection cannot widen access) must pass before any live agent runs.
