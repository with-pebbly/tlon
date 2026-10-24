# ADR 0003 — Narrative schema v1 and bridge structure

- Status: accepted
- Date: 2026-10-24

## Decision

- Projects choose a domain: `NARRATIVE` or `GENERIC`.
- `structured` is a JSON object (≤ 64 KB) validated by `parseStructured(domain, kind, …)`
  in `@tlon/contracts`:
  - `NARRATIVE`: optional §3.5 fields (`subject`, `predicate`, `object`, `worldTime`,
    `location`, `perspective`, `speaker`, `epistemicStatus`, `characters`,
    `prerequisites`, `effects`, `assumptions`, `dramaticFunction`). Unknown keys are kept
    so domain packs can extend without migrations.
  - `BRIDGE` (any domain) and every expansion candidate: `mechanism`, `assumptions[]`,
    `anchorReconciliation.{left,right}` are mandatory — §4 invariant "every proposed C
    specifies its mechanism, explicit assumptions and how each anchor remains true".
- Claims and beliefs are distinguished by `epistemicStatus`, not by separate tables.
- Contradictions are surfaced by `detectTensions` (explicit `contradicts` relations and
  facts with equal subject+predicate but different object), listing the qualifiers that
  differ (time, perspective, speaker, location, epistemic status). They are prompts, never
  validation errors.

## Consequences

- A user-created `BRIDGE` artifact outside an expansion must also state its mechanism.
- Schema evolution of narrative fields is additive; breaking changes need a new
  `schemaVersion` key and an ADR.
