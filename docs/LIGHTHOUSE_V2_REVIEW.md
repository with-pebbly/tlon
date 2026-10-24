# Generation Review — _The Lighthouse on a Planet with No Sea_ (V2)

**Status:** Actionable engineering review  
**Audience:** Fractal Narrative Engine / agent orchestration / Web UI developers  
**Source:** `lighthouse-v2-annotated.md` (30 beats: 6 authored anchors, 24 generated bridges; maximum depth 4)  
**Scope:** Narrative continuity, bridge integration, state tracking, agent validation, and regression coverage. This is a review of the **exported story**, not a claim that particular validators or orchestration features are absent from the codebase.

## Executive summary

**V2 succeeds at the core creative experiment.** Independently specified maritime distress and science-fiction ark scenarios are reconciled by a strong bridge: an ark uses a salvaged coaster autopilot broadcasting under the old coaster's name. Further generated bridges develop a coherent theme around a useless lighthouse, an unsigned petition, a soup spoon, and finally the first actual water in the basin. The bridge generator is adding story value rather than merely inserting filler.

**However, the exported beat sequence has critical integration failures.** Several inserted bridges narrate events before their left anchors, restart a call after it ended, or contradict physical/time state established by adjacent beats. The next priority is **validated insertion and ordered state continuity**, not greater depth.

The system must preserve _productive contradiction between independent anchors_ while rejecting _accidental continuity regression introduced by a generated bridge_. Do not flatten every creative tension into an error.

## What worked — preserve these behaviors

1. **Identity reconciliation (beats 6, 15, 19):** the `Margarethe Holm` distress call and the `Thalassa's Promise` ark become one vessel through the reused sea-lander autopilot and its inherited radio identity. This is a valuable cross-anchor explanatory bridge.
2. **Long-range setup/payoff (beats 2, 17–19, 29–30):** the petition to discontinue the lighthouse and the mundane soup spoon are introduced early and used as moral and mechanical devices later. The petition becomes a paper boat before the ballast release.
3. **Causal escalation (beats 18–25):** the reflected frost creates a false sea; the improvised lens tilt creates a physical vulnerability; the berth flare creates a target. These are productive new constraints, even though some transitions are currently inconsistent.
4. **Thematic closure (beat 30):** the light built for a sea that never arrived finally shines over real water. Preserve this capacity to build themes across distant nodes.
5. **Lower expansion depth:** 30 beats/depth 4 instead of V1's 37/depth 5. The exported story is more focused, but this is an editorial judgment from a single example, not an established quantitative result.

## Findings

Severity definitions: **P0** = current sequence contradicts established event order/state; **P1** = material continuity or spatial ambiguity; **P2** = plausibility or editorial quality improvement. Beat numbers refer to the current V2 export, _not stable internal IDs_.

### V2-01 — P0 — Replayed telephone interaction and duplicated waking sequence (beats 11–15)

**Evidence:**

- Beat **11** takes Odile to the telephone on the second landing and ends after eleven rings.
- Beat **12** begins again with Odile going **down to the watch room** to lift the land telephone, then **thanks the clerk and hangs up**, and finally goes to **wake Ilse by the shoulders**.
- Beat **13** starts _inside the still-active phone call_: "The clerk is already closing the call" / "Odile doesn't hang up", and keeps the line open.
- Beat **14** opens with the phone receiver dropping on its cord; **Ilse awakens and opens her door**.
- Beat **15** restarts with "Odile wakes her grandmother" and introduces a different retrieval path for the Notice to Mariners (chart-table drawer versus the deed box obtained in beat 14).

**Why this is a defect:** the ordered final story places an already-ended call immediately before the same call continuing, and repeats the wake-up. These are not purposeful disagreements between independently authored anchors; they are incompatible bridge joins.

**Recommended behavior:** validate each insertion against the **left and right boundary state**: active call, location of characters, sleep/wake state, possession/location of documents. Either regenerate the bridging segment with both boundaries, or reconcile/restructure the enclosing segment with explicit permission and provenance. Do not silently rewrite authored anchors.

**Regression acceptance:** An automated join check must flag at least `telephone.call_active: false → true without redial`, `Ilse.awake: true → woke again without sleep`, and conflicting placement of phone/Notice.

### V2-02 — P0 — Non-monotonic countdown and inconsistent timestamps (beats 16–19)

**Evidence:**

- Beat **16**, 03:52: hover reserve **9 minutes**; 03:59: reserve **4 minutes**.
- Beat **17**, 04:07: still **4 minutes**.
- Beat **18**, after the Article 1 answer: **3 minutes 40 seconds**.
- Beat **19**, 04:10: Ilse tilts the lamp and the ark commits to landing 40 seconds later.

**Why this is a defect:** a strictly decreasing reserve is held at four minutes across approximately eight elapsed minutes without a stated replenishment, pause, or different definition of "reserve." The clock isn't merely imprecise: the specific facts cannot all stand as written.

**Recommended behavior:** capture numerically constrained facts as typed state (`timestamp`, `remaining_hover_seconds`, `fuel_condition`, `measurement_basis`), propagate across boundaries, and check interval arithmetic. If figures are estimates, encode tolerances and provenance instead of assuming exactness.

**Regression acceptance:** Insertions causing unexplained reserve increase or implausible flatlining must fail continuity validation; proposed fixes should point to the exact incompatible events.

### V2-03 — P0 — Bridge 20 occurs narratively before its left anchor (beats 19–20)

**Evidence:** Beat **19** has Ilse already tilting the lamp at **04:10**, revealing the false sea and triggering the landing commitment after forty seconds. Beat **20**, which follows it in the export, describes a human asking whether the surface is water and Ilse saying **"The light will show you the sea"**; its own mechanism note says it "doesn't stage it yet" and "runs the hover clock down toward the 04:10 commit."

**Why this is a defect:** the bridge’s intended chronological slot is _before_ the authored event, but it appears _after_ it. The mechanism annotation explicitly corroborates the mismatch. This looks like a bridge-placement / anchoring defect, not just prose phrasing.

**Recommended behavior:** store event-relative temporal constraints independently of display order (`before`, `after`, `during`, `overlaps`, absolute window); prevent accepting or exporting a bridge if its mechanism implies it precedes the left boundary. Allow the agent to return `cannot_bridge_with_current_order` rather than forcing an insertion.

**Regression acceptance:** A pre-commitment radio discussion may not be ordered after `landing_committed = true` unless it is explicitly framed as a flashback.

### V2-04 — P1 — Flare placement and character position diverge (beats 21–23)

**Evidence:** Beat **21**: Odile plants a **hand flare forty metres from the tower door** and runs back. Beat **22** refers to her "still at the berth lamp on the **gallery rail**". Beat **23** then has her enter the lamp room from the flare.

**Why this matters:** the flare should remain at the berth mark on the salt, while Odile's location changes. This suggests confusion between `object.location` and `character.location`, and between the first flare and an unspecified second signal.

**Recommended behavior:** separate each entity’s current location and possession, plus stable object IDs (`flare_1`, `flare_2`). If an additional gallery lamp is intended, introduce it explicitly.

**Regression acceptance:** A ground flare must not teleport to the gallery; entering the lamp room must have a valid movement transition.

### V2-05 — P1 — Lens/spoon state conflicts near the handoff (beats 26–27)

**Evidence:** Beat **26** states Ilse **leaves the soup spoon wedged in the tilt gear** after the landing, so the downward beam remains lit. Beat **27** has Ilse showing Doornik "what was left of the soup spoon when they **finally let the gear go**". The intervening removal/gear restoration is not narrated; the beat 27 annotation says the lamp was kept pointed down **until after the landing**, which does not resolve the exact transition.

**Assessment:** This is a **missing state transition**, not an absolute impossibility: the spoon could be removed between beats. But the generation should either include that transition or phrase the scene consistently, especially because the physical artifact and ongoing beam position matter to the plot.

**Recommended behavior:** require a state-change event for `spoon: wedged → removed` and `lens: depressed → restored/free`, or mark an explicit ellipsis with a bounded transition.

### V2-06 — P1 — Timeline ambiguity between vote and next-day release (beats 28–30)

**Evidence:** Beat **28** explicitly puts the vote at **eleven**; beat **29** describes noon as imminent when Doornik reaches the valve; authored beat **30** labels the release **"The following day, noon to dusk"**.

**Assessment:** It is possible for the wardroom vote to occur the previous day and the discharge to occur the next noon, but the immediate setup in beat 29 is written as if it directly precedes the noon release. The bridge needs to establish the overnight interval or the exported timeline should reflect it. Avoid treating the authored timestamp as expendable.

**Regression acceptance:** the final timeline unambiguously distinguishes the vote day, intervening night, and next-day ballast release.

### V2-07 — P2 — Physical mechanism of the 11 km slide needs framing (beats 24–25)

**Evidence:** Beat **24** suggests thrusters cut off one or two metres above the surface and mentions the ark at roughly eleven kilometres from the tower. Authored beat **25** requires an **11 km belly-first skid**, hull intact, stopping exactly **40 m** from the lighthouse.

**Assessment:** This may be a demanding authored SF constraint, **not a generated continuity defect**. The system should find an explicit braking/terrain/landing mechanism or present the physics as speculative; it should not overwrite B's fixed outcome. Avoid making unsupported numeric assertions about ship dimensions or speeds.

**Recommended behavior:** add an optional plausibility reviewer that reports mechanisms requiring additional explanation without hard-blocking speculative fiction.

### V2-08 — P2 — Excessive local expansion / repeated exposition

**Evidence:** A few bridges replay dialogue or bookkeeping rather than shifting causal state (most notably the overlapping phone sequence). More broadly, depth alone is not a good measure of literary value.

**Recommended behavior:** prioritize bridges according to causal gap, character change, novel constraints and setup/payoff potential; stop expanding when it would only restate adjacent beats. This is an optimization objective, not a blanket ban on quiet scenes.

## Architectural recommendations

### 1. Validate the join, not just the generated block

A bridge may be excellent alone while incompatible with both neighbors. Gate acceptance of `left → bridge → right` with:

- **Boundary extraction**: pre-/post-conditions for left, bridge, right, including location, time, resources, object ownership, active communications, character knowledge and immutable authored facts.
- **Local constraints**: no contradictory state transitions without an explanatory event; no duplicated unique action; time intervals compatible with ordered position.
- **Global regression**: recheck dependent accepted subgraphs, especially whenever a new bridge adds a fact about an object reused later.
- **Creative-tension policy**: anchor contradictions become **bridge objectives**; internally generated regressions become **repair/reject events** unless explicitly accepted as new mystery with coherent world-state semantics.

### 2. Model events and intervals, not only prose strings

Suggested minimal _illustrative_ contracts (adapt to existing types):

```ts
type NarrativeEvent = {
	artifactId: string;
	authored: boolean;
	time?: { earliest?: string; latest?: string; precision?: 'exact' | 'approx' };
	preconditions: StateAssertion[];
	effects: StateAssertion[];
	dependencies: string[];
};

type StateAssertion = {
	entityId: string;
	property: string;
	value: string | number | boolean;
	certainty: 'established' | 'inferred' | 'proposed';
	sourceArtifactId: string;
};

type ContinuityIssue = {
	code: 'TEMPORAL' | 'STATE' | 'LOCATION' | 'DUPLICATION' | 'CAUSAL_ORDER';
	severity: 'error' | 'warning';
	artifactIds: string[];
	explanation: string;
	suggestedAction: 'repair_bridge' | 'reorder' | 'request_explanation' | 'review';
};
```

A `StateAssertion` needs **scope/time** in a real implementation (e.g. its validity interval), and contradictory _beliefs_ must not be equated with contradictory _world facts_. Avoid implementing these simplified example types as the entire domain model.

### 3. Do not turn C into an unrestricted author of the full canon

- A/B remain isolated according to their granted views.
- C may inspect both boundary interfaces and global canon **under its approved privileges**, propose bridging events and request additional disclosures.
- Independent verifier checks the candidate against policy-visible canon; reports issues without leaking other agents' hidden details.
- Fixes occur via versioned revisions with provenance; no invisible edits to authored anchors.
- Never assume C can disclose _everything_ by default. Use explicit, auditable grants and least-privilege projection.

### 4. Introduce bounded repair loops

Pipeline proposal:

```text
Generate candidate bridge
  → Extract state assertions + event/time constraints
  → Validate (left, candidate, right) and global dependents
  → ACCEPT with provenance / REPAIR bridge / REJECT with diagnostics
  → If repair budget exhausted: escalate to user or leave gap unresolved
```

Use configurable `maxRepairAttempts`, validator confidence and issue budgets. Track accepted/rejected candidates for debugging.

### 5. Make violations inspectable in Web UI

- Overlay error/warning indicators on graph edges and specific bridge nodes.
- Clicking an issue shows the conflicting assertions, source artifacts, exact spans, and temporal order.
- Offer actions **Regenerate Bridge**, **Reorder if valid**, **Add Explanatory Arc**, and **Mark Intentional** (with rationale), respecting authored-node immutability and access control.
- Timeline view should visualize events with uncertainty ranges, not just a fabricated fixed point.
- In composite artifacts, collapse visual nodes but retain validation lineage and issue counts; expanding reveals affected descendants.

## Prioritized implementation plan

| Stage | Priority | Deliverable                                | Completion check                                                |
| ----- | -------- | ------------------------------------------ | --------------------------------------------------------------- |
| 1     | P0       | Event/boundary extraction + join validator | Detects V2-01, V2-02, V2-03 with exact beat evidence            |
| 2     | P0       | Validator-gated bridge acceptance          | Broken transitions cannot silently enter the accepted graph     |
| 3     | P1       | Entity/location/possession ledger          | Flags flare and spoon issues with scoped assertions             |
| 4     | P1       | Temporal intervals / day boundaries        | Flags next-day mismatch without inventing missing events        |
| 5     | P1       | UI diagnostics and bounded regeneration    | User sees why an insertion failed and can act on it             |
| 6     | P2       | Narrative-value and plausibility scoring   | Reduces repetitive filler while keeping meaningful setup/payoff |

## Regression fixture suite

Create an immutable fixture from `lighthouse-v2-annotated.md` and keep its original 6 authored anchors separately. Suggested cases:

```text
V2-01: phone is hung up, next beat continues same call                 → FLAG
V2-01b: grandmother awakens twice without intervening sleep           → FLAG
V2-02: hover reserve 4 min at 03:59 and 4 min at 04:07                → FLAG
V2-03: pre-commitment dialogue inserted after committed landing       → FLAG
V2-04: ground flare becomes gallery-rail berth lamp                   → FLAG/WARN
V2-05: spoon is removed with no transition after remaining wedged     → WARN
V2-06: next-day release immediately follows same-day noon setup       → WARN
CREATIVE-01: 'coaster' name reconciled with ark autopilot identity     → ALLOW
CREATIVE-02: no sea initially, water eventually released into basin    → ALLOW
CREATIVE-03: different characters hold incompatible beliefs           → ALLOW
IMMUTABLE-01: bridge attempts to overwrite authored landing outcome   → REJECT
ACL-01: A queries unpublished B-only artifacts through diagnostics    → DENY
```

Use golden fixtures to test **detection**, not force one particular prose rewrite. Record false positives separately.

## Developer handoff / Claude Code task

> Review `lighthouse-v2-annotated.md` against the current Fractal Narrative Engine codebase. First trace how bridge candidates are positioned, accepted, and serialized into narrative order. Reproduce issues V2-01 through V2-06 with fixtures, preserving the six authored anchors. Implement the smallest end-to-end boundary-state and temporal-order checks that reject clear regressions before acceptance, and expose diagnostics through existing API/UI patterns. Maintain A/B isolation, C's authorized disclosure model, bridge provenance, and compatibility with composite artifacts. Prefer targeted additions to a parallel replacement architecture. Add tests, document remaining unsupported cases, and report whether each defect originates in generation, insertion, validation, or export. Do not silently rewrite the source story or claim an issue is fixed without a passing regression test.

## Important limitations

- This review was conducted **from the exported annotated story**, not the application’s internal graph, run logs, prompt templates or database. Root causes remain hypotheses until traced in code.
- Descriptions such as "P0" indicate severity for the **story-integrity pipeline**, not that production code or security has been independently audited.
- Some ambiguity may disappear if the underlying artifact graph stores additional explicit transitions that the prose export omitted. If so, fix export ordering/selection rather than fabricating new narrative events.
- The literary strengths and weaknesses are qualitative assessments based on this one sample; rigorous model comparison requires repeated runs and blind evaluation.
