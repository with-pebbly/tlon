# Security model

Decision record: [ADR 0007](adr/0007-artifact-gateway.md). Policy source:
`packages/core/src/visibility.ts`.

## Principals

| Principal   | How it authenticates              | Sees by default   | Can do                                                                 |
| ----------- | --------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| Local human | no token, loopback socket only    | whole project     | everything, incl. agent admin, review, export/import                   |
| A / B       | bearer token bound to one project | own private scope | create/edit own artifacts, propose relations between visible artifacts |
| C           | bearer token                      | whole project     | open expansions, submit candidates, propose disclosures                |
| VALIDATOR   | bearer token                      | whole project     | read only                                                              |

Tokens are short-lived, stored as SHA-256 hashes, revocable per token or by disabling
the principal. Invalid tokens never fall back to human access.

## Guarantees

- Every read is filtered in SQL by the visibility predicate; hidden artifacts look
  nonexistent (same code, same message), relations require both endpoints visible, A/B
  get no expansions, counts or hidden provenance.
- Agents are pinned to their project and their creation scope.
- C→A/B information flows only through human-published disclosures, which create a
  new C-owned artifact; source artifacts stay hidden. Revocation is prospective — text an
  agent already read cannot be erased from its context.
- Artifact content is data: it cannot change roles, scopes or grants.
- Logs, errors and audit metadata carry IDs only; the `Authorization` header is redacted.

These properties are covered by `apps/api/test/isolation.test.ts` (ARCHITECTURE §9).

## Not yet covered

- Human authentication beyond loopback (single-operator deployment only).
- Rate limits and budgets per agent (M4 run ledger).
