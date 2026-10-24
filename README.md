# Tlön

Recursively expandable graph of structured artifacts. Two artifacts that disagree are
not overwritten: a **bridge** artifact C explains how both can hold, and the new
intervals A→C and C→B can be bridged again. Design: [ARCHITECTURE.md](ARCHITECTURE.md)
(written as "Fractal Narrative Engine"; Tlön is the product name).
This repository implements milestones **M0–M2** (artifacts, relations, revisions,
manual recursive bridging, graph/fractal/timeline views, export/import). No LLM keys,
agents or MCP are involved yet.

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

## Primary flow

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

## Decisions

See [docs/adr](docs/adr): stack (SvelteKit/Fastify/Node native TS), PostgreSQL +
Drizzle + PGlite, narrative schema v1, bridge acceptance, ownership/authorization seam,
graph vs expansion view.
