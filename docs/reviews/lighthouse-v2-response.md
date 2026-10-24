# Response to LIGHTHOUSE_V2_REVIEW

Review: [../LIGHTHOUSE_V2_REVIEW.md](../LIGHTHOUSE_V2_REVIEW.md) · Story:
[../samples/lighthouse-v2-annotated.md](../samples/lighthouse-v2-annotated.md) · Full
issue list after re-validation: [../samples/lighthouse-v2-issues.md](../samples/lighthouse-v2-issues.md)
(project `dd195709-c943-45ba-a480-5fc1338ffd16`).

## Where each defect originated

Traced in the stored graph (expansions, relations, annotations), not inferred from prose.

| Finding                                   | Origin                               | Evidence                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2-01 replayed call / double wake (11–15) | **Generation** + **validation miss** | Bridge #12 (depth 2, between #10 and #15) narrated the whole call and the waking; the finer bridges #13/#14 later generated inside #12→#15 re-staged them. C's self-declared contracts used synonym keys (`ilse_marrow.awake` vs `ilse_marrow.status=asleep`) and omitted "call ended", so the gate had nothing to compare. |
| V2-02 frozen countdown (16–19)            | Generation + validation miss         | Reserve recorded as words (`four_minutes`, `critical`, `three_minutes`) under three different keys; no numeric/time model.                                                                                                                                                                                                  |
| V2-03 bridge 20 after its left anchor     | **Generation** + validation miss     | Placement is correct (#20 is the bridge of #19→#21, in-order traversal); C wrote content that belongs before #19. No beat time and no "not yet committed" precondition existed.                                                                                                                                             |
| V2-04 flare / position                    | Generation                           | Not detected (see "Not covered").                                                                                                                                                                                                                                                                                           |
| V2-05 spoon                               | Ambiguous text                       | The extractor reads #27 as narrating the removal (`spoon.removed_from_gear`), so no gap is reported.                                                                                                                                                                                                                        |
| V2-06 vote vs next-day release            | Generation                           | Not detected reliably: the extractor dates #30 to the same day in some runs.                                                                                                                                                                                                                                                |
| V2-07/08                                  | Editorial                            | Out of scope for state validation.                                                                                                                                                                                                                                                                                          |

**Insertion/ordering and export were correct.** Story order is the in-order traversal of
expansion trees; every bridge sits between its anchors.

## What changed

1. **Independent verifier.** Candidates are no longer judged on C's own contract: before
   accept, a read-only VALIDATOR session re-extracts each candidate's contract from its
   prose with its neighbours' contracts and the project vocabulary
   (`packages/agents/src/extraction.ts`); the operator stores it as the candidate's
   latest `extracted` annotation, and the existing accept gate checks it.
2. **Richer contracts** (`packages/contracts/src/validation.ts`): beat time (`day`,
   `minute`, tolerance, flashback flag), unique and repeatable events, numeric values with
   `unit` and `monotonic` direction, preconditions about what has _not yet_ happened.
3. **New validator rules** (`packages/core/src/continuity.ts`): `temporal_order`
   (out-of-order beats; bridge far from its anchor in time), `duplicate_event`,
   `monotonic_violation` (wrong direction or a countdown that freezes while time passes),
   `missing_transition` (state differs across unnarrated beats → warning, not blocker).
   Creative tensions between independent anchors stay `info`.
4. **Runner repair loop** (`packages/agents/src/run.ts`): on a gate refusal every pending
   candidate of the interval is rejected, C repairs up to `--max-repairs` (default 2),
   the rest is reported as `unresolved_intervals`; C gets the shared vocabulary and the
   instruction to stay strictly inside the interval. Nothing is force-accepted.
5. **Regression suite** `packages/core/test/v2-regressions.test.ts`: V2-01, V2-01b,
   V2-02, V2-03 (+ flashback allowed), V2-04, V2-05, V2-06, CREATIVE-01/02/03,
   IMMUTABLE-01. ACL-01 is covered by the API suite (A gets 403 on `/issues` and never
   sees annotations of B artifacts).

## Detection on the real V2 data (independent extraction)

| Case                               | Result                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2-01 call continues after hang-up | detected (#12↔#13 `charter_office_call.state`)                                                                                                          |
| V2-01b double wake                 | detected (#14↔#15 `ilse.awake`)                                                                                                                         |
| V2-02 frozen reserve               | detected (#16↔#17 `hover_reserve.remaining`)                                                                                                            |
| V2-03 dialogue after commitment    | detected (#19↔#20 `thalassas_promise.landing`)                                                                                                          |
| V2-04 flare/position               | not detected                                                                                                                                            |
| V2-05 spoon                        | not reported (text read as narrating removal)                                                                                                           |
| V2-06 next day                     | not detected in the last run                                                                                                                            |
| Extra findings                     | #4↔#5 Ilse falls asleep twice; #12/#14/#15/#16 location and frost resets inside the same broken 11–16 stretch — plausible, not yet confirmed by a human |

The regression fixtures prove the rules detect every listed case when the contract states
it; on real prose, detection is bounded by extraction quality, which varies between runs.

## Not covered yet

- **Movement/space** (V2-04): a location change is accepted as an effect; there is no
  adjacency model to call a move a teleport.
- **Extraction stability**: contracts are LLM-extracted and unreviewed; two runs can name
  states differently. Vocabulary reuse and human review in the State tab mitigate it.
- **Plausibility reviewer** (V2-07) and narrative-value scoring beyond `redundancy`
  and STOP (V2-08).
- Existing accepted records are not rewritten; the V2 issues stay visible until a human
  regenerates or dismisses them.
