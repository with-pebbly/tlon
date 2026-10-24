# ADR 0001 — Stack: SvelteKit web, Fastify API, Node 24 native TypeScript

- Status: accepted
- Date: 2026-10-24

## Context

ARCHITECTURE.md §5 suggests React + Vite + React Flow + TanStack Query/Zustand and
NestJS or Fastify. The project owner requires SvelteKit for the frontend and Node +
TypeScript for everything else (API, CLI, tooling).

## Decision

- **Web:** SvelteKit 2 + Svelte 5 runes as a client-only SPA (`adapter-static`,
  `ssr = false`). Graph canvas: `@xyflow/svelte` (Svelte Flow — the same xyflow engine
  as React Flow). Layout: `elkjs` (`layered`). Server state is a runes class that
  re-fetches the project graph after each mutation; UI state (selection, filters,
  collapsed subtrees, dragged positions) is local. TanStack Query/Zustand are not
  needed at this size.
- **API:** Fastify 5 (§5 allows it "for smaller MVP"). Routes are a thin adapter over
  the store service; validation uses the shared Zod contracts.
- **CLI:** `commander`, same store service as the API (migrate, seed, projects, graph,
  export, import).
- **Runtime:** Node 24 runs `.ts` sources directly (native type stripping). Packages
  export `src/index.ts`; there is no server build step. Constraints: `.ts` import
  extensions and erasable syntax only (`erasableSyntaxOnly` in `tsconfig.base.json`).
  `tsc --noEmit` is the type gate.
- **Monorepo:** pnpm workspaces + Turborepo; oxlint + oxfmt (pebbly conventions).

## Consequences

- No transpile step for API/CLI; stack traces point at real source lines.
- TS features that need emit (enums, namespaces, parameter properties) are unavailable.
- `packages/ui` from §11 is omitted until a second web consumer exists.
