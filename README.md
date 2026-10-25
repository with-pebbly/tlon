# Tlön

A participant-agnostic **Block–Fact** protocol for distributed creative collaboration
(design: [docs/BLOCK_FACT_ARCHITECTURE_PART_1.md](docs/BLOCK_FACT_ARCHITECTURE_PART_1.md),
[PART_2](docs/BLOCK_FACT_ARCHITECTURE_PART_2.md); mapping onto this codebase:
[ADR 0011](docs/adr/0011-block-fact-model.md), [ADR 0012](docs/adr/0012-participants-and-tasks.md)).
Participant **A** writes Blocks from one brief, **B** from another; neither ever sees the
other's Blocks. Mediator **C** sees both and publishes a **Fact** — a bare circumstance in
a couple of words («Корни хранят память», not «В корнях обнаружена неизвестная система
хранения памяти»). Each side continues locally from its own Block and that Fact; the
two continuations become the next gap. Any Triangle can be composed into a Block and
linked again with the same mechanism. Humans, AI agents and scripts take the same tasks
through the same API. The earlier full-scene "bridge" model ([ARCHITECTURE.md](ARCHITECTURE.md))
remains for old projects; its bridges are ordinary Blocks.

## Layout

| Path                 | Package           | Role                                                                                                                                         |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts` | `@tlon/contracts` | Zod schemas, inferred types, typed error codes, export format                                                                                |
| `packages/core`      | `@tlon/core`      | Pure domain logic: expansion depth/lineage, cycle checks, fractal tree, timeline, tensions, deterministic bridge suggester, bundle integrity |
| `packages/store`     | `@tlon/store`     | Drizzle schema + migrations, transactional domain service, Earth/Mars seed                                                                   |
| `apps/api`           | `@tlon/api`       | Fastify REST API over the store service                                                                                                      |
| `apps/cli`           | `@tlon/cli`       | `tlon` CLI: migrate, seed, projects, graph, export, import                                                                                   |
| `apps/web`           | `@tlon/web`       | SvelteKit SPA: Svelte Flow canvas, inspector, fractal and timeline views                                                                     |
| `docs/`              |                   | ADRs, data model, security model                                                                                                             |

## Requirements

- Node.js ≥ 24 (TypeScript runs natively, no build step for API/CLI)
- pnpm 11
- PostgreSQL 16 binaries (`brew install postgresql@16`) **or** Docker — or neither, using
  embedded PGlite (see below)

## Run locally

```sh
pnpm install
cp .env.example .env          # DATABASE_URL, API_PORT

pnpm db:start                 # project-local Postgres in ./.pgdata on 127.0.0.1:54329
# or: docker compose up -d

pnpm db:migrate               # apply migrations (the API also migrates on boot)
pnpm db:seed                  # Earth/Mars example project
pnpm dev                      # API on :3001 + web on http://localhost:5173
```

Zero-setup alternative without Postgres: set `DATABASE_URL=pglite:./.data/pglite` in
`.env` (embedded Postgres persisted to a directory; single process at a time — run CLI
commands while the API is stopped).

Stop the local cluster with `pnpm db:stop`.

## CLI

```sh
pnpm tlon projects
pnpm tlon graph <projectId>            # expansion tree + tension count
pnpm tlon export <projectId> -o story.tlon.json
pnpm tlon import story.tlon.json --name "Copy" --remap
```

## Checks

```sh
pnpm check    # tsc / svelte-check in every package
pnpm lint     # oxlint
pnpm test     # vitest: core invariants, store (PGlite), API (inject)
pnpm build    # web production build
```

## Migrations

Schema lives in `packages/store/src/schema.ts`. After changing it:

```sh
pnpm db:generate   # drizzle-kit → packages/store/migrations/*.sql (commit them)
pnpm db:migrate
```

## Protocol flow (humans, no LLM)

1. Open a project → **Protocol** → create participants A, B and C (human, AI or
   scripted). Each gets a link `http://localhost:5173/p#<token>`, shown once; send it to
   that person. There is no login: the link is the identity, kept in that browser tab only.
2. **Start a run** with two private briefs (A's and B's) and who accepts Facts
   (facilitator by default, or C itself).
3. A and B each see only their brief and write a seed Block. C then sees both Blocks and
   proposes up to 3 Facts (2–3 words, at most 4; the editor blocks longer ones). The
   facilitator accepts one; only that Fact is disclosed to A and B.
4. A writes what happens after its Block, B what happened before its Block. The triangle
   converges; **Open child gap** joins the two continuations for the next Fact.
5. **Compose…** turns a triangle into a composite Block that can be connected to any other
   Block (shift-select two nodes in the Graph → **Propose connecting Fact**).
6. Facts are drawn as yellow apexes over their two Blocks; stage numbers are generation
   waves, not story time. **Story** exports the Blocks in reading order with the Facts
   listed separately.

AI participants use the same task API: `pnpm agents --start "…" --end "…" [--target 24]
[--max-depth 11] [--review] [--out story.md]` creates the project, AI participants and a
run, executes every task in an isolated session that sees only its task view, checks
isolation and writes the story. `--review` stops after C's first candidates so a human
facilitator chooses. The previous full-scene bridge runner is `pnpm agents:legacy`.

### After a run: joins, completion, isolation (organizer only)

A shared Fact links two Blocks; it is never read as causality. The facilitator's
**Protocol → Completion** panel (and `tlon completion|audit <projectId>`) shows:

- **Connections**: thematic echo, causal hypothesis, causal canon, open mystery. AI review
  only proposes; canon and "intentional open mystery" are human approvals. Rejecting a
  connection removes that interpretation only.
- **Completion report**: connected Fact pairs, confirmed cross-branch causal paths
  (`unknown` until a human records one), open questions, chronology conflicts.
  **Certify** a policy (`exploratory`, `coherent_open_mystery`, `causally_connected`,
  `resolved`); certification is refused with reasons when the policy isn't met.
- **Isolation audit**: per task, the IDs it was served (input manifest), plus server-side
  deny checks of every A/B participant against the other side's Blocks.
- **Continuity issues**: computed from annotations (state replay, timeless facts such as
  kinship, authorship and past dates, calendar order) and **findings** reported by a
  continuity audit or a facilitator. A finding must quote the Blocks verbatim; the server
  rejects quotes that aren't in the text. **Request revision** sends a side-local issue to
  the side that owns it as a `revise_block` task: that writer sees only their own line and
  the quoted problem, and the revision becomes a new version of the same Block.

`pnpm analyze --project <id> --out story.md [--repair-rounds 2]` runs the per-side
extraction (calendar dates, timeless facts, entities with stable ids), a grounded
continuity audit per side, the repair loop (only Blocks the auditor judged to deviate from
the rest of their line are revised, by that side's writer, then re-checked), the AI join
review, and writes the reader story, `-organizer.md` and `-chronology.md`. `pnpm agents`
runs it automatically. `docs/samples/belki-v1/` keeps a frozen story with known defects;
`apps/api/test/regression-belki.test.ts` checks they stay detected.

Protected mode: set `TLON_OPERATOR_TOKEN` to disable tokenless operator access. Without
it a participant on the same machine could open facilitator pages, so isolation between
humans holds only across machines.

## Primary flow (legacy bridges)

1. Create a project (Narrative or Generic) or open the seeded _Earth / Mars_ project.
2. Add artifacts A and B; drag from A to B to create a relation (e.g. `contradicts`).
3. Select the relation → **Expand / Bridge** → write C or press **Suggest**
   (deterministic placeholder) → **Submit** → **Accept**.
4. A→C and C→B appear as new relations; the original edge collapses. Expand either one
   again — recursion depth is limited by project settings (default 5).
5. Inspect any node: revisions (restore any version), relations, expansion lineage.
   Lock or pin artifacts; contradictions are listed under _Tensions_ as prompts.
6. Reload — everything is persisted. Export/import JSON from the top bar or CLI.
7. Continuity: the top-bar badge counts blockers; the overview's _Issues_ panel groups
   them by kind (blockers red, warnings amber, tensions/perspective conflicts in the
   creative tension style) with Compare neighbours, Request C reconciliation, Regenerate
   bridge and dismiss/mark actions; the same tones ring nodes and stroke edges on the
   Graph/Fractal canvases. An artifact's _State_ tab shows the incoming world state on the
   story path and edits its transition annotation; _Issues report_ downloads the open
   issues as Markdown with story beat numbers.

## API

REST under `/api`, contracts in `packages/contracts/src/api.ts`. Edits use
`If-Match: <headRevisionId>`; accepting a bridge requires `Idempotency-Key`. Errors are
`{ "error": { "code", "message", "details?" } }` with codes in
`packages/contracts/src/errors.ts`.

Composite artifacts (ADR 0009) live under `/api/projects/:projectId/composites`:
`POST /composites` (compose a selection → `CompositeView`, 201),
`GET /composites/:id?depth=N` (recursive open, members/relations/claims filtered per
caller), `POST /composites/:id/revisions` (new definition version; requires
`expectedDefinitionVersion`, `STALE_DEFINITION` 409 otherwise),
`GET /composites/:id/revisions` and `POST /composites/:id/archive` (`{ reason? }`).
Bridges between composites (`Bridge(M, N)`) and expanding any relation reuse the
existing `POST /expansions` endpoint — there are no separate `/bridges` or
`/relations/:id/expand` routes. `GET /graph` adds `composites` and per-expansion
`staleSides`; the export bundle carries `compositeDefinitions`.

Continuity validation (`docs/GENERATION_REVIEW.md`) stores per-beat state contracts as
append-only **transition annotations** beside the artifact, so annotating an anchor never
creates a revision or stales its bridges:

- `PUT /artifacts/:id/transition` (`{ artifactRevisionId, transition, source?, reviewed? }`
  → `TransitionAnnotation`, 201). `artifactRevisionId` must be the head revision
  (`STALE_REVISION` 409); agents write only inside their own scope; the VALIDATOR cannot.
  `GET /graph` and the export bundle carry `transitions` (latest per visible artifact /
  full history).
- `POST /expansions/:id/candidates` accepts an optional `transition`, stored as an `author`
  annotation of the candidate's revision; each candidate in `ExpansionDetail` lists the
  `issues` it would add to the committed path (computed on the caller-visible graph; only
  for roles with `validation.read`: human, C, VALIDATOR).
- `POST /expansions/:id/accept` refuses with `CONTINUITY_VIOLATION` 409
  (`details.issues`: `key`, `kind`, `severity`, `artifactIds`, `stateKey` — no prose) when
  the candidate adds non-dismissed blocker issues. Only a human can proceed, by sending
  `acknowledgeIssues` (text); the acknowledgement is recorded in the bridge revision reason
  and the audit event (issue keys only). Idempotent replays never re-run the gate.
- `GET /issues` → `IssueList` (human, C, VALIDATOR); `POST /issues/dismiss`
  (`{ key, resolution, reason }`, human only) records a resolution that sticks to the
  stable issue key across recomputation and returns the updated list.

Block–Fact protocol (ADR 0011/0012; contracts in `packages/contracts/src/protocol.ts`).
Humans, AI and scripted executors are the same kind of participant principal
(`executorKind` is recorded, never used for permissions) and claim the same tasks:

- `POST /participants` (human; `{ role, name, executorKind?, ttlSeconds? }` → `ParticipantLink`
  with a one-time `token`, 201; default link lifetime 24 h, max 7 days). `/agents` keeps
  working and now takes/returns `executorKind` (default `ai`).
- `POST /runs` (`{ briefA, briefB, config? }` → `Run`, 201) creates the two `seed_block`
  tasks; `GET /runs`, `GET /tasks` (human). Briefs and runs are facilitator-only.
- `GET /tasks/mine` (A/B/C: assigned to me or claimable by my role; A/B get a scrubbed task
  without run/triangle/side/stage), `GET /tasks/:id/view` (`TaskView` assembled server-side;
  every artifact in it passes the normal visibility predicate), `POST /tasks/:id/submit`
  (`{ submission, idempotencyKey }` → `{ task, warnings, replayed }`; claims the task; the
  same key replays the first result). Another participant's task is `TASK_NOT_FOUND`.
- Scheduling (`autoSchedule`): both seeds → root Triangle (stage 2, depth 1) + C's
  `propose_fact`; accepted Fact → two `advance_block` tasks (stage + 1); both
  continuations → Triangle `converged`.
- `POST /triangles/:id/accept-fact` (`{ candidateId }`; human, or C when the run's
  `factReview` is `mediator`) accepts one candidate, rejects the rest, links both anchors
  to the Fact (`has_fact`) and discloses **only the Fact** (READ grant + a `fact_only`
  disclosure) to the advancing side's participants.
- `POST /connect` (human or C; `{ left, right, parentTriangleId?, runId?, advance? }`,
  `viaFact: true` anchors a Fact through a persisted FactAnchor) opens a gap
  (`DEPTH_LIMIT_EXCEEDED` past the run's `maxDepth`); `GET /triangles/:id`,
  `POST /triangles/:id/status`, `POST /triangles/:id/compose` (`{ title, summary? }` →
  `CompositeView` of anchors + Fact + continuations), `POST /fact-anchors`,
  `GET /protocol` (human: everything; C: triangles + its tasks; VALIDATOR: triangles),
  `GET /facts/:id/rationale` (human/C: the mediator-private justification).
- Facts are `artifactClass: 'FACT'` artifacts (`title` = ≤ 160-char single statement,
  empty body, `factKind`); only the protocol or a human creates them. The export bundle
  carries optional `runs`, `triangles`, `tasks`, `factCandidates`, `factRationales` and
  `factAnchors` (older bundles import with none; task assignees are dropped on import).

## Decisions

See [docs/adr](docs/adr): stack (SvelteKit/Fastify/Node native TS), PostgreSQL +
Drizzle + PGlite, narrative schema v1, bridge acceptance, ownership/authorization seam,
graph vs expansion view.
