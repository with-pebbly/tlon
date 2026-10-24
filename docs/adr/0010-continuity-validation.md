# ADR 0010 — Continuity validation of the committed path

- Status: accepted
- Date: 2026-10-24
- Source: [GENERATION_REVIEW.md](../GENERATION_REVIEW.md) (screenwriter review of
  `docs/samples/lighthouse-story-annotated.md`)

## Context

In the Hesper Point scenario, bridge 33 drains the mercury bath and bridge 34 — accepted
later between 33 and the B anchor 35 — still reads the level as FULL and opens the drain
again. Both were locally plausible; nothing checked the accepted path as a whole.

## Decision

- **State contracts beside artifacts.** A beat's `Transition` (preconditions, effects,
  invented assumptions; each an `Assertion` with subject/predicate/value, epistemic mode,
  `irreversible`, `preparation`) is stored in `transition_annotations`, pinned to an
  exact artifact revision and append-only. Annotating never edits the artifact, so
  authored anchors and accepted records stay untouched and no bridge goes stale.
  Values are canonical tokens (`full`, `falling`); prose detail goes into `note`.
- **Provenance is derived, not declared:** authored anchors → `canonical_anchor`,
  accepted bridges → `committed_generated`, candidates → `proposal`.
- **One deterministic validator** (`validateContinuity` in `@tlon/core`) replays world
  state along the story order (`storyBeats`) and classifies conflicts:
  `continuity_violation` and `anchor_violation` (blockers), `tension` between
  independently authored anchors and `perspective_conflict` between belief holders
  (creative input, info), `abandoned_preparation`, `stale_annotation` (warnings),
  `redundancy` (info, suggests stopping). It only judges stated contracts; beats without
  annotations are reported as unannotated, never guessed.
- **Accept gate.** Accepting a bridge runs `candidateIssues` (issues the candidate would
  add). Non-dismissed blockers refuse the accept with `CONTINUITY_VIOLATION`; only a
  human can accept anyway with `acknowledgeIssues` (recorded in the revision reason and
  audit). Agents (C) submit candidates with their own state contracts.
- **Annotations for existing material** come from a read-only VALIDATOR session
  (`packages/agents/src/extract.ts`); the operator stores them as `extracted`,
  unreviewed. Humans review/edit them in the State inspector.
- **Adaptive depth.** C may `interval_stop` an interval ("sufficient detail") instead of
  bridging; the runner stops offering it, ending below the block target is not a
  failure, and rejected candidates are resubmitted once with the validator's findings.
- **Access.** Issues are computed on the caller-visible graph; `validation.read` is
  HUMAN/C/VALIDATOR only, so A/B never receive findings about hidden material. Gate
  details carry issue keys and ids, not prose.

## Consequences

- Validation quality equals annotation quality: an extractor that uses inconsistent
  keys or free-text values produces false positives. The vocabulary rule and the
  review flag exist for that reason.
- Not modelled yet: semantic novelty scoring beyond `redundancy`, temporal/spatial
  coordinates, dependency-based revalidation (the whole path is replayed, which is cheap
  at current sizes).
