# ADR 0004 — Bridge acceptance protocol

- Status: accepted
- Date: 2026-10-24

## Decision

1. **Open** — `POST /expansions` on a relation (or ordered pair) pins the anchors'
   current head revision IDs. Depth = parent depth + 1, where the parent is the
   expansion that produced the target relation; `depth ≤ settings.maxDepth`. At most one
   open expansion per relation (`DUPLICATE_EXPANSION`); an expanded relation cannot be
   expanded again (`ALREADY_EXPANDED`) — alternatives are candidates, not parallel
   expansions.
2. **Propose** — candidates are new `PROPOSED` artifacts (or an existing artifact that is
   not an anchor of the expansion or its lineage → otherwise `CYCLE_DETECTED`), capped by
   `settings.maxCandidates`. The C proposal is manual or pre-filled by the deterministic
   `suggestBridge` placeholder; no LLM is involved.
3. **Accept** (human, MVP) — one transaction under a row lock:
   - requires `Idempotency-Key`; replaying the same key with the same request
     fingerprint returns the stored result (`replayed: true`) and writes nothing; the same
     key with a different request → `IDEMPOTENCY_KEY_REUSED`; another key →
     `ALREADY_ACCEPTED`;
   - anchors must still be at the pinned revisions (`STALE_ANCHOR_REVISION`);
   - bridge → `ACCEPTED`; other pending candidates → `NOT_SELECTED`, their artifacts →
     `REJECTED` (kept in history, hidden from the canonical view);
   - creates child relations `left → C` and `C → right` (default type `bridges`,
     overridable) carrying `expansion_id` and provenance `[left, C, right]`;
   - the original relation is kept as a collapsed parent edge (`expandedByExpansionId`).
   - Anchors are never modified.
4. **Recurse** — child relations are expansion opportunities only; nothing is
   auto-expanded.

## Consequences

- Full binary subdivision to depth d produces 2^d − 1 bridges (tested at d = 3).
- Editing an anchor while an expansion is open forces a deliberate re-open (cancel +
  expand), so a bridge always cites the exact text it reconciles.
