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

### Human login (admin token)

All `/api` routes except `GET /api/health` and `POST /api/session` need a credential; there
is no loopback shortcut (agent processes run on the same machine). The human credential is
the admin secret: set `TLON_ADMIN_TOKEN` (≥ 32 chars) in `.env`, or leave it unset and the API
generates `tlon_admin_…` on first boot into `.data/admin-token` (mode 0600; only the path is
logged). Use it as `Authorization: Bearer $(cat .data/admin-token)`, or log in for a cookie:

```sh
curl -c jar -H 'content-type: application/json' \
  -d "{\"token\":\"$(cat .data/admin-token)\"}" http://127.0.0.1:3001/api/session
curl -b jar http://127.0.0.1:3001/api/whoami          # GET works with the cookie alone
curl -b jar -H 'x-tlon-csrf: 1' -X POST ...           # cookie mutations need the CSRF header
```

Sessions last 12 h and live in API memory (a restart invalidates them).

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

## API

REST under `/api`, contracts in `packages/contracts/src/api.ts`. Edits use
`If-Match: <headRevisionId>`; accepting a bridge requires `Idempotency-Key`. Errors are
`{ "error": { "code", "message", "details?" } }` with codes in
`packages/contracts/src/errors.ts`.

## Decisions

See [docs/adr](docs/adr): stack (SvelteKit/Fastify/Node native TS), PostgreSQL +
Drizzle + PGlite, narrative schema v1, bridge acceptance, ownership/authorization seam,
graph vs expansion view.
