# NEXUS Shadow Runtime v0.1

This directory is an isolated, feature-flagged control-plane slice for NEXUS. It does not modify the existing HGI capture execution path.

## Safety defaults

- `NEXUS_ENABLED` defaults to `false`.
- Shadow mode defaults to `true`.
- External writes are always disabled in this slice.
- Unknown action types fail closed.
- Reserved actions such as email sending, filings, money movement, trading, production changes, credential grants, and legal-rights changes require user authority and are not executable here.

## Current components

- `config.js` — fail-closed runtime configuration.
- `policy.js` — explicit auto-allowed versus reserved action matrix.
- `scheduler.js` — deterministic priority/WIP scoring and selection.
- `worker.js` — one-tick worker loop for dependency promotion, selection, policy gating, execution, and durable-result handoff.
- `shadow-store.js` — in-memory acceptance store only; not production persistence.
- `connectors/base.js` — read-only connector contract with a physically blocked write path.
- `shadow.test.mjs` — acceptance tests for disabled-by-default behavior, reserved-action blocking, WIP ordering, safe-work advancement, and connector write blocking.

## Acceptance command

```bash
node --test nexus/shadow.test.mjs
```

## Deliberately not included yet

- No production database migration.
- No Railway deployment change.
- No Supabase credential or schema change.
- No Gmail/Outlook/Drive/Calendar credential ingestion.
- No external-effect execution.
- No merge into `main` without explicit review/approval.

The next implementation unit is a durable isolated store plus read-only connector adapters and health/heartbeat output, still under shadow mode.
