# Generation Review — The Hesper Point Light

**Status:** Engineering review / actionable feedback  
**Source:** `lighthouse-story-annotated.md` (37 beats: 6 authored anchors, 31 generated bridges, maximum depth 5)  
**Audience:** Fractal narrative engine developer / Claude Code  
**Scope:** Evaluation of this one generated story and recommendations for the next implementation iteration. This is not a benchmark or a claim about the system's average performance.

## Executive summary

The engine successfully inserted 31 intermediate beats around six authored anchors, including long causal connections across generations. Several objects and motifs (the founder's ledger, the radio, the mercury-float lens, the empty sea-state column) recur and matter later. The generated middle provides a plausible reason for the later keeper's choice and preserves the authored endpoints in broad outline.

**Critical defect:** a generated bridge changes the mercury drain to an **open/draining** state, and the immediately following bridge treats it as **not yet opened / FULL**. This is a continuity violation introduced during refinement, not a productive contradiction between independently authored anchors.

**Design recommendation:** Preserve contradiction-driven creativity when bridging independently created anchors, but validate the _committed chronological path_ after each accepted expansion. Reject, revise, or deliberately explain mutually exclusive states before publishing a path as coherent. Do not silently rewrite authored anchors.

## Observed positives

1. **Long-range causal inheritance:** the ship delivers the lens and mercury in beat 19; the lens, keeper instructions, and mercury limitation motivate Odile's decision in beats 27–35.
2. **Thematic payoff:** a lighthouse awaiting a sea ultimately guides a vessel bearing the material that begins filling the basin (beats 1, 19, 35–37).
3. **Variable temporal resolution:** generations (beats 19–21), hours (21–23), and seconds (24–35) can all be represented within the same expansion mechanism.
4. **Useful audit material:** bridge annotations explicitly include `Mechanism` and `Assumes`; these should become structured, queryable provenance, not disappear into prose.

## Findings

### P0 — Mercury-drain state resets across adjacent beats

**Evidence:**

- **Beat 31**, `03:39: The drain cock is seized...`: after using a winding crank as a lever, Odile turns the plug a quarter-turn. This is not necessarily fully open yet.
- **Beat 33**, `03:40: Odile stops the lens...`: **"The plug comes free all at once"**, mercury audibly drains, and **"The silver thread in the sight tube leaves Bertil's scratch and starts sliding down."** The lens is then stopped and starts tipping.
- **Beat 34**, `One hand on the glass, one reaching for the crank`: **"the silver thread sits on the FULL scratch"**; Odile reaches for the crank and **pulls** to open the bath.
- **Beat 35**, authored B anchor: Odile opens the drain and the lens tilts.

**Impact:** Both beat 33 and beat 34 attempt to perform or initiate the decisive drain transition. A coherent ordered reading cannot both have the level falling in beat 33 and still at FULL in beat 34 without an explicit replenishment/reset event (none appears).

**Expected:** one unambiguous drain transition, consistent with beat 35, with each finer beat refining the transition rather than duplicating or contradicting it.

**Fix:** model physical state transitions on the edge/path; on generation, check `preconditions` and `effects` against the predecessor's post-state and successor's required pre-state. A bridge which consumes an event reserved for the right anchor should fail the boundary check or be marked as an alternative, not accepted inline.

**Regression test:** generate/insert a bridge immediately before an anchor that opens a sealed valve. The inserted beat may show reaching, bracing, unlocking or a failed attempt; it must not claim the valve has already drained while its next beat expects FULL.

### P1 — Competing signaling mechanisms with unclear handoff

**Evidence:**

- **Beat 7:** canvas daylight curtain is available, and Bertil takes it to signal.
- **Beat 8:** a separate hinged brass `eclipse screen` and lever is introduced for signaling, tested with its safety catch on.
- **Beat 9:** Bertil uses the **curtain** for the first eclipse.
- **Beat 10:** Bertil oils and tests the **screen's pivot/lever** to transmit reliable strokes.
- **Beat 11:** the three shutters are emitted, but their actual apparatus is unspecified.

**Classification:** **ambiguity/continuity risk, not proven impossibility.** Both devices may coexist. The missing piece is which device performs the final action and why the setup alternates.

**Fix:** maintain explicit `instrument_used` / `object_state` when an intermediate beat prepares an action; require the next beat to consume the preparation or explain the change.

### P1 — Narrative value diminishes at maximum depth

**Evidence:** beats **24–26** separately refine seconds of radio-carrier reception; beats **28–34** repeatedly revisit a short interval around the drain-cock decision. Some contribute useful details (signal meter, cock seizure, harbor bearing), but some primarily restate motions or delay an already established outcome.

**Impact:** automatic binary subdivision can optimize for local transitional plausibility while diluting pacing and disproportionally expanding unimportant micro-actions.

**Fix:** use semantic expansion budgets, not depth alone. Score prospective expansions for **new causal information**, **character choice**, **dramatic reversal**, **unresolved conflict**, **time-span/importance**, and **redundancy**. Support `STOP: sufficient detail` as a successful outcome, and allow uneven depths.

**Acceptance criterion:** at a chosen narrative resolution, the engine may keep a short transition as one edge without generating another full prose beat.

### P2 — Continuity assertions need provenance and confidence

**Evidence:** annotations introduce numerous new world facts such as the third keeper's translation sheet (beat 8), the lamp's signal mechanism (8–10), Mags's succession/habits (20–23), the cracked sump (31), and the `HBR` direction marking (32).

These are legitimate inventions, not bugs. But an `Assumes` line currently looks similar whether it is sourced from an anchor, inherited from an accepted prior bridge, or newly invented to justify the current beat.

**Fix:** distinguish:

- `canonical_anchor`: explicitly asserted by an original A/B or human-authored block;
- `committed_generated`: accepted and established by a bridge;
- `proposal`: newly hypothesized for this candidate;
- `character_belief`: may be false without invalidating objective world state;
- `unknown`: not established.

A later bridge must not silently treat a proposal as a universally established fact before acceptance.

### P2 — Story-world calendar and position assumptions deserve explicit checking

**Evidence:** broad chronology (Year 212; roughly 61 years later) mostly aligns; directional phrases involving westward ship sightings and later eastward harbor orientation can coexist because they describe different events. Do not file these as bugs without a concrete coordinate contradiction. The core requirement is to make temporal and spatial claims inspectable, rather than assume every unusual statement is wrong.

## Core semantic rule: contradictions are not all the same

**Keep:** contradictions between separately authored or independently generated facts that the mediator C is tasked with reconciling. They are creative constraints, not automatic errors. C may propose memory manipulation, a missing event, an unreliable narrator, a change of identity, etc. Explanations should be made explicit.

**Check:** contradictions caused by two successive _accepted_ bridges occupying incompatible states on the same committed path, particularly when the next anchor requires a known state.

**Represent:** `tension` (intentionally unresolved) vs `continuity_violation` (accepted path incompatible) vs `perspective_conflict` (different narrators/beliefs) vs `unknown`. A validator must not flatten all four into one generic contradiction score.

## Recommended state/contract model

The existing artifact/relation/expansion data structures can be extended; do **not** refactor persistence blindly before inspecting the repository.

```ts
interface NarrativeAssertion {
	id: string;
	subjectId: string;
	predicate: string; // e.g. 'mercury_bath.level'
	value: string | number | boolean;
	validDuring?: { start?: string; end?: string };
	epistemicMode: 'world' | 'belief' | 'rumor' | 'hypothesis';
	provenance: 'canonical_anchor' | 'committed_generated' | 'proposal';
	sourceArtifactId: string;
}

interface NarrativeTransition {
	artifactId: string;
	preconditions: NarrativeAssertion[];
	effects: NarrativeAssertion[];
	unresolvedAssumptions: NarrativeAssertion[];
}

interface ValidationIssue {
	kind:
		| 'continuity_violation'
		| 'anchor_violation'
		| 'tension'
		| 'perspective_conflict'
		| 'redundancy'
		| 'unknown';
	severity: 'blocker' | 'warning' | 'info';
	artifactIds: string[];
	explanation: string;
	suggestedAction?: 'revise_bridge' | 'request_c_resolution' | 'mark_intentional' | 'keep_as_is';
}
```

Store physical state at the appropriate granularity: before beat 33 the cock may be `partially_unlocked` while level is `FULL`; after discharge starts the level must be `falling`. A single boolean `open` is likely insufficient.

## Proposed validation pipeline

1. **Generate candidate C bridge** using only the permitted information for the selected pair/subgraph.
2. **Extract assertions:** entities, physical states, time windows, knowledge/beliefs, preconditions/effects, newly invented assumptions, with provenance.
3. **Check both anchors:** verify the candidate connects the left endpoint to the right endpoint and does not consume the right endpoint's defining event prematurely.
4. **Check accepted path:** replay transitions through the affected ordered narrative slice; detect duplicate irreversible events, state regressions, temporal inversions, and object/identity mismatch.
5. **Classify issues:** creative tension vs committed-continuity violation; do not auto-resolve every tension.
6. **Review/commit:** accept, regenerate, or ask C for a _new explicit reconciliation artifact_. Track the decision and changes.
7. **Revalidate impacted neighbors/ancestors** when an expansion or composite artifact changes. Use dependency graph/dirty-set invalidation, not necessarily a full-graph scan each time.

> **Security reminder:** the validator's access must be explicit. A/B isolation must remain server-enforced. If C can inspect all artifacts, only C should prepare permitted disclosures to A or B. Validation output must not leak opposite-side private text or undisclosed metadata.

## Expand / Compose interaction

The recent **composite artifact** concept is highly relevant:

- **Expand:** insert a mediating C artifact between two connected nodes, preserving the original endpoint facts and provenance.
- **Compose:** create a composite artifact with immutable/versioned references to an internal subgraph; export a short interface (entry/exit state, asserted facts, requirements, unresolved tensions).
- **Collapse:** UI-only hide/show internal detail; it must not be conflated with Compose or delete internal relations.
- **Compositional consistency:** when connecting two composites, validate their **boundary contracts** first; only inspect nested internals when needed and authorized.

This review recommends validating the current linearized sample before using composite-to-composite bridges as the next experimental demonstration.

## Suggested Web UI changes

- **Issues panel:** type, severity, affected artifact IDs and a concise conflict explanation.
- **Graph/Fractal overlay:** highlight edges whose committed state contracts do not match; differentiate from interesting creative tensions.
- **State inspector:** selected artifact's incoming world state, effects, assumptions, and provenance.
- **Compare neighbors:** show the transition from previous to current to next beat, alongside the right anchor that may be prematurely consumed.
- **Actions:** `Request C reconciliation`, `Regenerate bridge`, `Mark perspective-dependent`, `Dismiss with reason`.
- **Expand/Collapse composite:** present inner graph and summary/boundary interface, without confusing visual folding with semantic composition.

## Implementation priorities

### Milestone 1 — Guard correctness (P0)

- [ ] Parse/represent beat preconditions and effects, even if initially LLM-extracted with human review.
- [ ] Add two-sided boundary validation when accepting generated bridges.
- [ ] Catch the beat 33 → 34 mercury reset and duplicate drain attempt.
- [ ] Revalidate local neighbors after any insertion or regeneration.
- [ ] Preserve the 6 authored anchors as immutable unless explicitly changed by the user.

### Milestone 2 — Preserve creative latitude (P1)

- [ ] Separate intentional tension and perspective conflict from hard continuity violations.
- [ ] Let C propose a bridge that deliberately reconciles independent contradictions.
- [ ] Introduce meaningfulness/novel-information scoring and a stop-expansion option.
- [ ] Track which physical device is prepared/used for the beat 7–11 lamp signal.

### Milestone 3 — Composition and UX (P2)

- [ ] Formalize composite boundary contracts and nested dependency invalidation.
- [ ] Surface issues in Graph, Fractal and Timeline views.
- [ ] Keep A/B reads isolated, with deliberate C disclosures and no leaks through API or issue metadata.
- [ ] Export annotated narrative **plus** machine-readable state/provenance reports.

## Acceptance / regression scenarios

1. **Drain sequence:** beat 33 reports `mercury_bath.level = falling`; next beat reports `FULL` without refill ⇒ **blocker**.
2. **Right-anchor ownership:** bridge depicts irreversible drain before authored B says she opens it ⇒ **boundary warning/blocker**, depending on whether the bridge merely overlaps or contradicts endpoint state.
3. **Creative birth paradox:** A claims Earth birthplace, B claims Mars birthplace; C proposes cloning or inaccurate records ⇒ **valid candidate explanation**, not a blind rejection.
4. **Unreliable witness:** one character believes `X`, another believes `not X` ⇒ **perspective conflict** unless narrated as mutually exclusive objective truths.
5. **Lamp device:** curtain and eclipse screen coexist ⇒ **allowed** if use/handoff is explained; warning if preparations are abandoned without reason.
6. **Budget:** low-information micro-bridge at depth 5 ⇒ system can **stop** without marking an error.
7. **Composite round trip:** `Compose(subgraph)` then expand view must retain stable child identities, relations, versions, and boundary constraints.
8. **Permission enforcement:** A must not see B-only narrative or hidden findings, including through validation, exports, search and disclosures not granted by C.

## What NOT to do

- Do not label all source contradictions as faults; the method depends on generating explanations for them.
- Do not assume narrative plausibility can be fully proven by a deterministic validator; structured rules catch hard state conflicts, LLM critics offer additional qualitative signals.
- Do not silently mutate authored anchors or accepted historical versions.
- Do not force every edge to depth 5; pacing is a distinct optimization target.
- Do not conflate `collapse` (presentation) with `compose` (new semantic artifact).

## Developer handoff prompt

> Review `lighthouse-story-annotated.md` alongside `GENERATION_REVIEW.md`, `ARCHITECTURE.md`, and `COMPOSITE_ARTIFACTS_SPEC.md`. Inspect the existing graph, artifact storage, expansion, authorization, and UI implementations before changing schemas. First reproduce the mercury continuity regression around beats 31–35. Implement the smallest robust boundary-contract / state-transition validation path that catches it, while preserving C's ability to creatively reconcile independent source contradictions. Add tests and a simple issue surfacing mechanism in the web UI. Then propose a staged plan for semantic composition and adaptive expansion depth. Do not rewrite the authored A/B anchors or silently change existing accepted records.

---

**Evidence basis:** All story-specific statements above are grounded in the supplied `lighthouse-story-annotated.md`. Severity, architecture, state model and tests are **engineering recommendations**, not verified behavior of the existing codebase. The screenshots show UI features but do not establish their implementation or security guarantees.
