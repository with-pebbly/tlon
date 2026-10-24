# Block–Fact Generation Review — «Старик посадил дерево (2)»

**Audience:** engineering team / Claude Code  
**Source:** `старик-посадил-дерево-2-annotated.md`  
**Scope:** one exported run of the _new_ Block–Fact architecture, assessed as a **plot-construction protocol**, **not** a finished novella, literary screenplay, or prose-style test.  
**Status:** review and proposed changes, **not** evidence of runtime behavior beyond the export.

## 0. Executive verdict

**The new architecture appears to have materially changed the type of output:** it produced two locally developing chains linked by short mediator Facts rather than long bridging scenes. It supports multiple interpretations of deliberately sparse facts. That is a meaningful design signal.

**However, this export does not yet demonstrate a completed causally joined story.** The output shows correspondence of motifs and suggestive echoes between A and B, but does not prove whether the elderly man's household, the abandoned compound, the counted knocks, the brick marks, and sector D-4's collapsing micro-universe participate in one causal chain. They _may_; the text leaves this unresolved. A protocol should distinguish (a) **a valid, deliberately unresolved mystery**, (b) **a thematic correspondence**, and (c) **a verified causal bridge**.

**Priority:** implement structural and contract-level validation, not automatic explanation of every mystery. Preserve isolation and under-specified Fact C. Do **not** resolve anomalies by letting C silently dictate a plot, and do **not** require every echo to be explained before a story can be useful.

### What the export actually confirms

- Header states **24 beats, 24 authored, 0 bridges, max depth 0**. These are exporter labels; they do **not** by themselves prove 24 distinct human authors or how many LLM calls ran.
- Beats **#1–#12** are marked **author A**; **#13–#24** are marked **author B**.
- **11 mediator Facts**, stages **2–22** in increments of 2, each mapping a pair of block indices (#1 ↔ #24 through #11 ↔ #14).
- No explicit Triangle/composition events, agent ACL evidence, disclosure logs, revisions, final reconciliation report, or orchestration trace appear in the document. Do not assert those operations happened or failed solely from their absence in this export.

## 1. Assessment by objective

| Dimension                            | Assessment                                                     | Evidence and qualification                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Minimal mediator Facts               | **Promising**                                                  | 11 short objects/rules/traces/needs rather than 11 full narrative scenes.                                                                                                            |
| Locally coherent A branch            | **Good**                                                       | Apple tree → missing bud → brick stamp → family/compound → floor warmth/count → memorial candles.                                                                                    |
| Locally coherent B branch            | **Mostly good**                                                | Historic compound and brick transfer → modern research site and counting anomaly → chamber seven. B is displayed in reverse-event exploration order, not straightforward chronology. |
| Surprise / divergent interpretations | **Strong**                                                     | “Counting loses one” becomes A's missing bud and B's detector dead time / signal mismatch.                                                                                           |
| Object/state handoffs                | **Uneven**                                                     | Several objects have precise local state; cross-branch equivalence is usually implied rather than established.                                                                       |
| Historical chronology                | **Needs explicit normalisation**                               | Several decades and two different characters called Прохор; easy for reviewers and machines to conflate.                                                                             |
| Global causal joining                | **Unproven**                                                   | No on-page mechanism connects the old man's counted phenomena to the experimental chamber's collapse.                                                                                |
| Human-first participant independence | **Not assessable**                                             | Export does not contain agent visibility/ACL or interaction trace.                                                                                                                   |
| Story readiness                      | **Promising mystery outline, not yet a proven integrated arc** | May be intentionally open-ended; do not force an answer prematurely.                                                                                                                 |

**Important:** this is not a scientific A/B result. There is one visible run, no controlled prompts or comparable scoring protocol, and no external reader panel.

## 2. Evidence map: A and B

### A / beats #1–#12

1. **#1:** elder plants an Antonovka sapling; finds 17 brick pieces; bucket remains by fence.
2. **#2:** keeps one piece with a stamp; discards the other 16.
3. **#3:** counts 11 buds, then 10; suspects an animal; protects sapling with mesh.
4. **#4–#5:** matching stamps on intact brick and saved fragment; identifies archaic letter **ять**.
5. **#6–#7:** family memory traces bricks to a former monastic compound; finds more stamped brick in his house's north foundation.
6. **#8–#10:** father's warning “Пол не поднимать”; unusually warm board; ten recurring knocks matching ten buds.
7. **#11–#12:** anonymous old-style prayer for ten unnamed people; ten candles; ten coins placed on the warm floorboard.

### B / beats #13–#24 (display order ≠ chronological order)

1. **#13:** a woman pays a deacon to commemorate two sisters, one listed for the dead while reportedly alive; an unfinished instruction mentions transferring payment.
2. **#14–#15:** an unsigned note asks stove-builder **Прохор Дятлов** to move warm marked bricks underneath the north-wall floor in **1957**; an anomalous counting voice follows his work.
3. **#16–#17:** late 1957 to spring 1958: apprentice / carpenter encounters warm floorboards and counting; a warning “Пол не поднимать” appears **on a floorboard**.
4. **#18:** in **1963**, **Прохор Аверьянов**, explicitly Efim's grandfather, repairs the compound north wall; one variety of bricks has circular glyphs with three marks; direct touch produces a memory disturbance.
5. **#19–#20:** in **1930–1931**, **Ефим Лукич Сорокин** is warned about bricks retaining contact-memory; materials from the dismantled compound build a boiler house; the bricks described here bear a two-letter mark with ять and a year.
6. **#21–#24:** modern demolition of the boiler house precedes abnormal signals at sector D-4; Lilia hears 17, detector records 16/15; a miniature universe collapses in chamber seven.

**Warning for implementations:** The story presents B scenes in a nonchronological order: a causal reconstruction must not blindly follow file order. Also #15 and #18 describe **different people named Прохор**, with different surnames and different dates. In particular, #17's “spring 1958, five years before Prokhor” is compatible with the **1963 Прохор Аверьянов** in #18. It is **not** by itself a contradiction, and the previous casual review conflating them should be discarded.

## 3. Verified and potential issues

The categories below intentionally separate actual defects from unresolved questions. **Do not transform a hypothesis into canon without author/mediator approval.**

### ISSUE-01 — Connections risk being thematic rather than causal

**Severity:** P1 for _completed-story certification_; P2 for an open-ended mystery draft.  
**Evidence:** Fact “Семнадцать осколков кирпича” links #1 and #24; #1 contains 17 brick fragments; #23 records 17 audible impulses; #24 contains a miniature-universe collapse. The reader is not shown why these would be the same physical phenomenon, nor why the old man's location is causally implicated in D-4.  
**Risk:** graph reports connectedness while narrative semantics remain unverified.  
**Fix:** Represent `fact_link`, `thematic_echo`, `hypothesized_cause`, `established_cause`, and `open_mystery` separately. A Fact link is not automatically a causal edge. Add a non-spoiler completeness report listing unresolved inter-branch questions.  
**Do not:** invent a mandatory explanation such as “the house sits inside chamber seven.” The supplied text does not say that.

### ISSUE-02 — Stage relationship differs from apparent local consequences

**Severity:** P1 for observability/diagnostics.  
**Evidence:** Mediator stage 2 “Семнадцать осколков кирпича” lists #1 ↔ #24, but the explicit **17-count signal** appears in #23, not #24 (which refers to it retrospectively). More broadly, mapping Fact → endpoints alone does not explain how that Fact influenced each intermediate block.  
**Risk:** readers and validator infer a direct relationship from endpoints that is actually mediated across their local descendants.  
**Fix:** Store `factId`, `sourceBlockId`, `targetBlockId`, `influenceSpan`, `localEvidence`, and `realizationStatus` independently. Export both the authorized endpoint contract and the observed realization evidence.  
**Acceptance:** link to #24 can be valid through #23 if provenance proves #23 lies within B's authorized expansion span; report it as indirect, not mismatched.

### ISSUE-03 — The “ten” vs “seventeen” counts have no demonstrated relation

**Severity:** P2 / intentional-mystery candidate.  
**Evidence:** A counts ten remaining buds and ten knocks (#3, #10–#12). B listens to 17 versus 16/15 impulses (#22–#24). B's historic account also involves counting bricks, but not ten (#15–#17).  
**Risk:** numerical parallels are treated as convergence, although the numerically relevant entities are different.  
**Fix:** Track measured quantity with a semantic key (`bud_count`, `knock_count`, `audible_pulse_count`, `detector_pulse_count`, `brick_count`), instrument, time, and confidence. Do not unify values just because a mediator Fact uses the word “счёт.”

### ISSUE-04 — Identical-looking marks may not identify identical bricks

**Severity:** P2 continuity/canon ambiguity.  
**Evidence:** A discovers stamped **К + ять** family bricks (#4–#7). B's compound wall in #18 carries **a circle with three short strokes**, while #20 and #21 describe a **two-letter stamp with ять and a year**.  
**Risk:** a continuity checker falsely treats stamps as contradictory, or the generator carelessly claims they are identical.  
**Fix:** Model at least `markFamily`, `physicalForm`, `inscription`, `origin`, `location`, `observationTime`. These may be distinct stamp families on distinct brick batches. Their equivalence remains **unresolved**, not false.

### ISSUE-05 — “Пол не поднимать” occurs in two different locations

**Severity:** P2 identity ambiguity.  
**Evidence:** A #8: warning in father's handwriting on **the inside of the pantry door**. B #17: warning scratched **on a middle floorboard** of the compound.  
**Risk:** falsely merging objects/locations because phrase matches.  
**Fix:** Keep inscription instances independent. They can share `text` and `motifId` while having distinct `surface`, `authorAttribution`, `time`, `place`, and `evidence`.

### ISSUE-06 — Multi-era chronology and repeated names need validation, not forced linearisation

**Severity:** P1 engineering; P2 current narrative.  
**Evidence:** B's presentation visits 1957, 1958, 1963, 1930, 1931, then the research era. Two different Прохор characters are identifiable by surnames. #13's “eleven winters before the church was boarded up” cannot be assigned an absolute year without establishing the closure date.  
**Risk:** wrong continuity flags, accidentally merged people, chronological contradictions in later expansions.  
**Fix:** temporal entity registry with exact, relative, and unknown dates; timeline graph separate from generation order and display order; per-character stable IDs. Avoid guessing absolute dates for #13.

### ISSUE-07 — Experimental facility needs a stronger event/state contract

**Severity:** P1 for future expansion.  
**Evidence:** B #21–#24 associates demolition, instrument anomalies, and a collapse inside chamber seven, but it is not explicit whether sector D-4's measurement is of chamber seven, an adjacent detector, or a correlated external signal. Chamber universe was growing for 11 weeks; D-4 impulses are documented for three nights, and are lost at collapse.  
**Risk:** future branches fabricate a deterministic causal model despite insufficient observables.  
**Fix:** expose a scoped scientific-event timeline with `sampledSystem`, `measuringInstrument`, `location`, `signalFirstObservedAt`, `collapseAt`, `evidenceOfCausation`, `hypotheses`. All hypotheses may remain undecided.

### ISSUE-08 — No clear completion/stop condition for dramatic resolution

**Severity:** P1 product.  
**Evidence:** The ending currently shows Lilia withholding a signal printout after the collapse (#24), while A closes with memorial candles (#12). These are evocative endpoints but do not establish the relationship between the two chains.  
**Risk:** declaring “story complete” because 11 Facts exist, or expanding indefinitely to explain everything.  
**Fix:** configurable exit policy: `exploratory`, `coherent_open_mystery`, `causally_connected`, `resolved`. Completion is a declared contract, not inferred from zero remaining graph edges. Allow writers to choose the desired level of mystery.

### ISSUE-09 — Story graph may overreward motif reuse

**Severity:** P2.  
**Evidence:** recurring stamped brick, northern wall, warm floor, counting, old-script note, memorial payment.  
**Risk:** agents maximize literal reuse of mediator phrases, generating a chain of echoes rather than escalating stakes or meaningful character decisions.  
**Fix:** nonbinding evaluator for `new_decision`, `irreversible_change`, `new_constraint`, `stake_shift`, `revelation`, `causal_dependency`. Support quiet atmospheric beats; do not require each block to contain action.

### ISSUE-10 — No proof of execution isolation in this artifact

**Severity:** P0 **security assurance** (not proof of a breach).  
**Evidence:** the annotated story contains outputs and Fact pairs but no prompts, context manifests, grants, or ACL audit.  
**Risk:** reviewers infer a human-first/agent-neutral secure process from a well-shaped export.  
**Fix:** produce optional privacy-safe audit summaries: agent role, permitted input artifact IDs, disclosure grant IDs, generation stage, deny-test outcome. Never export forbidden raw context or secrets.

## 4. Proposed implementation changes

### 4.1 Distinguish connection semantics

```ts
export type NarrativeConnectionKind =
	| 'fact_link' // C supplies a shared minimal circumstance
	| 'thematic_echo' // motif similarity, no asserted causality
	| 'causal_hypothesis' // proposed explanation, not canon
	| 'causal_canon' // approved causal relation
	| 'open_mystery'; // deliberately left unresolved

export interface ConnectionEvidence {
	connectionId: string;
	kind: NarrativeConnectionKind;
	factId?: string;
	endpointBlockIds: [string, string];
	realizedByBlockIds: string[]; // may include later descendants
	approvedBy?: string; // person or authorized participant ID
	confidence?: 'explicit' | 'inferred' | 'unknown';
	storyTimelineRef?: string;
}
```

**Normative:** `fact_link` **MUST NOT** be interpreted as `causal_canon`. Promoting it requires explicit evidence or editorial authorization. A writer can preserve a mystery on purpose.

### 4.2 Separate four independent orders

- **Narrative chronology:** when something happens in the fictional world.
- **Presentation order:** where it appears in the exported outline.
- **Generation stage:** when mediator/author tasks occur, including parallel tasks.
- **Composition nesting depth:** structural containment, unrelated to chronology and stage.

The export may choose any order, but **MUST label the one being displayed** and support chronological view without mutating content.

### 4.3 Add scoped observation and identity registries

```ts
interface StoryObservation {
	id: string;
	subjectId: string; // ten buds ≠ seventeen impulses
	attribute: string; // count, temperature, inscription, etc.
	value: string | number;
	unit?: string;
	observerBlockId: string;
	timeRef?: string;
	epistemicStatus: 'observed' | 'reported' | 'hypothesized';
}
```

Keep identity separate from matching prose. Two people named Прохор and two warnings with identical text **MUST NOT** be merged unless there is grounded evidence.

### 4.4 Mediator policy: short Fact, no dictated solution

C should supply a **minimal, deliberately under-specified circumstance**. It is a creative interface, not a full bridge scene or a hidden master outline. A and B should realize it locally from their permitted contexts. When global review discovers an unresolved edge, it can recommend a new linking attempt, expose alternatives, or accept an open mystery. It must not invisibly rewrite existing author decisions.

### 4.5 Lightweight “completion report”

Export alongside a story, optionally:

```yaml
completion_policy: coherent_open_mystery
connected_fact_pairs: 11
confirmed_cross_branch_causal_paths: unknown
open_questions:
  - How, if at all, do the household's ten knocks relate to D-4's seventeen pulses?
  - Do the orchard bricks and the facility's bricks share a documented source?
  - What relationship, if any, joins the memorial requests and chamber seven?
chronology_conflicts_confirmed: 0 # for the highlighted cases; not a full automated proof
isolation_verified_from_export: false
```

`unknown` must be preserved when the system lacks evidence. The report is optional and may be **organizer-only** if it would violate A/B visibility boundaries.

## 5. Acceptance tests (developer-ready)

| ID    | Test                                                          | Expected result                                                               |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| BF-01 | Parse 24 authored beats + 11 Facts                            | Preserve originals and stage labels; do not synthesize bridge scenes.         |
| BF-02 | Register two Прохор characters from #15 and #18               | Distinct entities despite same first name.                                    |
| BF-03 | Check “1958, five years before Прохор” against #18's 1963     | No false chronology error.                                                    |
| BF-04 | Evaluate #13's church-closure relative date                   | Leave absolute date unknown.                                                  |
| BF-05 | Compare warning inscription at A #8 vs B #17                  | Same wording, separate physical locations/instances.                          |
| BF-06 | Compare circle/three-line stamp #18 vs ять stamps #20/#21     | Distinct or unresolved marks; no forced merge.                                |
| BF-07 | Compare A's ten knocks vs B's 17 audible pulses               | Distinct counted quantities; no auto-equality.                                |
| BF-08 | Inspect Fact connecting #1 ↔ #24                              | Maintain source endpoints and record possible realization via #23.            |
| BF-09 | Request “story complete” with required causal linkage         | Block certification or flag unresolved joins; no fabricated cause.            |
| BF-10 | Request “coherent open mystery” finish                        | Permit explicit intentional ambiguity after editorial review.                 |
| BF-11 | Generate chronological projection of B                        | Reorder metadata/view only; never rewrite scenes.                             |
| BF-12 | Export author's stage and mediator context manifest           | Expose authorized ID-level evidence only; never disclose forbidden artifacts. |
| BF-13 | Deny A access to undisclosed B content by API/search/export   | Server enforces ACL, not client hiding.                                       |
| BF-14 | Composite a selected branch into a Block then fork a spin-off | Preserve member artifacts, provenance, scoped canon and snapshot version.     |
| BF-15 | Allow author to reject an inferred causal interpretation      | Retain Fact and local texts; remove rejected hypothesis only.                 |
| BF-16 | Test human-only A/B/C completion with no model configuration  | Entire protocol works without an LLM provider.                                |

## 6. Prioritized engineering plan

**P0 — Audit foundation:** emit actor-scoped input manifests and verify server-side isolation; never expose forbidden prompts or counterpart artifacts. This is an assurance requirement, not an assertion of current leakage.

**P1 — Semantic integrity:** implement chronology and identity registries, scoped observations, link-vs-cause distinction, and explicit completion policies. Add fixtures for all numbered cases above.

**P2 — Narrative diagnostics:** introduce optional signal for repetitive motif reuse versus meaningful story-state changes. Keep it advisory so slow mystery scenes stay viable.

**P2 — Experiment readiness:** preserve model-independent participant abstraction and log consent-appropriate activity metrics for human-only, AI-only and hybrid runs, without making the storytelling core require an LLM.

## 7. What NOT to fix automatically

1. **Do not explain the paranormal phenomenon by fiat.** The reader may be meant to remain uncertain about the old man's house and chamber seven.
2. **Do not equate “17 bricks,” “17 sounds” and “10 knocks.”** Equality of numbers or motifs is not causality.
3. **Do not turn a Fact into a scene-length command.** Short facts are the architectural experiment.
4. **Do not collapse distinct characters or objects based on names, quotes or similar inscriptions.**
5. **Do not use linear prose order as a time axis.** Recursion and retrospective narratives require separate ordering metadata.
6. **Do not polish literary prose as a surrogate for fixing the causal graph.** The project aims at a reusable plot skeleton; dialogue and final artistic expression belong to the eventual writer.
7. **Do not equate zero exported bridges / depth zero with absence of mediation.** Eleven mediating Facts are explicitly present.

## 8. Suggested next experiment

Use identical initial seed Blocks, provider/model setup where relevant, controlled token/person-time budgets, and three protocols:

1. Previous long-bridge architecture.
2. Current minimal-Fact architecture.
3. Minimal-Fact architecture plus **nonintrusive completion review** (no forced global explanation).

Evaluate, blinded where possible, with the same rubric: _unexpected useful connections, internal continuity, independently verifiable causal joins, meaningful decisions, productive unresolved mysteries, and revision cost_. For the original social hypothesis, repeat with volunteer **human-only** groups, documenting how information isolation works in practice.

**Success is not “every loose end explained.”** Success is that an author can select an arc or Composite Block, invent a destination Block, and receive a structurally usable, canon-aware continuation while retaining creative control and deliberate ambiguity.

---

## Developer handoff

Treat this document as a **focused review and test fixture**, not a replacement for `BLOCK_FACT_ARCHITECTURE_PART_1.md` and `BLOCK_FACT_ARCHITECTURE_PART_2.md`.

1. Audit current exports, schema, stage semantics, and ACL behavior against the original architectural documents.
2. Reproduce the highlighted cases using the 24-beat source file.
3. Implement fixes as additive semantic metadata / validation with migrations that preserve every authored Block and Fact.
4. Add regression tests, including **negative tests for false positives** (the two Прохор characters and intentional motif reuse).
5. Preserve human-first, participant-agnostic execution and safe, selective mediator disclosures.

**Bottom line:** the new system is better at generating independently meaningful local material and suggestive cross-branch motifs. Its next engineering milestone is **honest evidence of cross-branch semantic joining, with explicit allowance for unresolved mystery**, not a return to all-knowing bridge generation.
