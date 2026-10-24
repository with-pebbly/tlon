# ADR 0012 — Participant-neutral tasks (human-first)

- Status: accepted
- Date: 2026-10-25
- Source: BLOCK_FACT_ARCHITECTURE_PART_2 §19–§25 (normative)

## Decisions

- **One protocol, interchangeable executors.** Humans, AI and scripted executors are
  participant principals (`executor_kind`) with role A, B or C in one project. They
  claim the same `protocol_tasks`, read the same server-assembled `TaskView` and submit
  the same `TaskSubmission`. The core (`packages/contracts`, `packages/core`,
  `packages/store`, `apps/api`) imports no model SDK; AI lives only in
  `packages/agents` as an adapter that calls the public task API with a participant
  token.
- **Task views are least-privilege projections.** `seed_block` → the side's own brief;
  `propose_fact` (C) → both endpoint Blocks + Fact policy; `advance_block` (A/B) → own
  Block, own-scope chain, the disclosed Fact and a direction. Never the opposite
  Block, the Triangle, stage position, global goal or C's rationale.
- **Facilitator = the local operator** (tokenless on localhost, ADR 0007): creates
  participants and their links, starts runs with side-private briefs, opens gaps,
  reviews Fact candidates (default policy `facilitator`, configurable `mediator`),
  composes. Facilitator tooling is a different projection from participant views.
- **Human participants** open a personal link (`/p#<token>`); the web app keeps the
  token in `sessionStorage` and every request carries it, so the server — not the UI —
  enforces what they see. There is no login screen (owner decision, ADR 0007).
  Consequence (§19.7, procedural realism): on a shared machine a participant could open
  the facilitator UI; for a real workshop each participant uses their own device and
  the API must not be exposed beyond the facilitator's network without real auth.
- **Scheduling.** With `autoSchedule`, the server opens the next task when inputs are
  ready: both seeds → C's first `propose_fact` (stage 2); accepted Fact → the two
  `advance_block` tasks; both continuations → triangle `converged`. Opening child gaps
  and composing are facilitator (or AI orchestrator) decisions. Every submit is
  idempotent by key.
- **Out of scope for this step** (§25 scope discipline): groups with several members and
  voting, consent/research mode, websockets.
