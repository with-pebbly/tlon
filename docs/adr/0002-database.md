# ADR 0002 — PostgreSQL + Drizzle ORM; PGlite for tests and zero-setup mode

- Status: accepted
- Date: 2026-10-24

## Context

§5/§6 require referential integrity, transactional bridge commits, append-only
revisions and optimistic concurrency. Tests must exercise the same SQL without a
running server.

## Decision

- PostgreSQL 16 is the system of record; Drizzle ORM defines the schema
  (`packages/store/src/schema.ts`), drizzle-kit generates SQL migrations into
  `packages/store/migrations` (committed).
- The same migrations run on **PGlite** (Postgres compiled to WASM): `pglite:memory`
  for tests, `pglite:<dir>` as an optional zero-setup local database.
- Same-project integrity is enforced twice: in the service (typed
  `CROSS_PROJECT_REFERENCE`) and in the database via composite foreign keys
  `(project_id, from_id) → artifacts(project_id, id)`.
- Optimistic concurrency: `UPDATE … WHERE head_revision_id = $ifMatch`.
- Acceptance idempotency: expansion row lock (`SELECT … FOR UPDATE`) plus a unique
  `(project_id, accept_idempotency_key)` index.
- `grants`, `disclosures`, `agent_runs` from §6 are deferred to M3/M4 (no dead tables).

## Consequences

- `pnpm db:start` runs a project-local cluster (`scripts/pg-local.sh`, port 54329);
  `docker compose up -d` is an equivalent alternative.
- PGlite is single-connection; it is fine for tests and a single local user, not for
  concurrent multi-user deployments.
