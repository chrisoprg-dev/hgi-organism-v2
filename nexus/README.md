# NEXUS Shadow Runtime v0.1

This directory is the isolated, feature-flagged code slice that preceded and now complements the promoted NEXUS Operating Spine v1. It does not modify the existing HGI capture execution path and remains on the isolated `nexus-core-shadow-v0.1` branch; `main` is untouched.

## Safety defaults

- `NEXUS_ENABLED` defaults to `false`.
- Shadow mode defaults to `true`.
- External writes are always disabled in this slice.
- Unknown action types fail closed.
- Reserved actions such as email sending, filings, money movement, trading, production changes, credential grants, and legal-rights changes require user authority and are not executable here.

## Branch components

- `config.js` — fail-closed runtime configuration.
- `policy.js` — explicit auto-allowed versus reserved action matrix.
- `scheduler.js` — deterministic priority/WIP scoring and selection.
- `worker.js` — one-tick worker loop for dependency promotion, selection, policy gating, execution, and durable-result handoff.
- `shadow-store.js` — in-memory branch acceptance store; retained for local/shadow tests, not canonical persistence.
- `connectors/base.js` — read-only connector contract with a physically blocked write path.
- `shadow.test.mjs` — acceptance tests for disabled-by-default behavior, reserved-action blocking, WIP ordering, safe-work advancement, and connector write blocking.
- `OPERATING_SPINE_ACCEPTANCE.md` — evidence for the promoted durable operating spine.

## Durable operating spine now live

The dedicated Supabase project `nexus-core` (`mmlqcssvnjuzzwqkpvqy`) now contains the promoted **NEXUS Operating Spine v1** for internal capability/canary control. Canonical runtime objects are:

- `public.nexus_capability_candidates`
- `public.nexus_jobs`
- `public.nexus_job_events`
- `public.nexus_canary_runs`
- `public.nexus_interface_spine_summary`

The durable spine enforces idempotency, bounded leases, expired-lease recovery, retry/dead-letter handling, legal lifecycle transitions, physical blocking of reserved external actions, evidence-backed `DONE`, and secure-passed-canary gating before `PROMOTED`.

The promotion canary passed **20/20** deterministic/adversarial tests. See `OPERATING_SPINE_ACCEPTANCE.md` for IDs and evidence.

## Acceptance command for this branch slice

```bash
node --test nexus/shadow.test.mjs
```

## Current boundaries

- No Railway deployment change from this branch.
- No Gmail/Outlook/Drive/Calendar credential ingestion into this repository.
- No new credential or permission scope was added for Operating Spine v1.
- No external-effect execution is enabled by Operating Spine v1.
- No Command Center D1 migration or dual-write has occurred.
- Existing D1 control objects remain authoritative for their current scope.
- No merge into `main` without explicit review/approval.

## Mandatory future-canary rule

**REGISTER BEFORE EXECUTION.** Every future capability canary must first be represented by a deterministic candidate in the durable NEXUS Operating Spine and have a durable job before canary execution begins. Promotion requires measured and security evidence in the spine; it is not a narrative label.

The next runtime engineering unit is to connect bounded read-only worker adapters to the durable spine and then add provider/event sensors without relaxing the current external-write boundary.
