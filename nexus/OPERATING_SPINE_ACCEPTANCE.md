# NEXUS Operating Spine v1 — Acceptance Record

Date: 2026-08-11
Status: **PROMOTED for internal capability/canary control**

This record documents the first real NEXUS operating spine implemented in the dedicated Supabase project `nexus-core` (`mmlqcssvnjuzzwqkpvqy`). It does not enable external-effect execution and does not migrate or dual-write the Command Center D1 control store.

## Canonical runtime objects

- `public.nexus_capability_candidates` — durable capability lifecycle
- `public.nexus_jobs` — durable internal job queue
- `public.nexus_job_events` — immutable job lifecycle evidence
- `public.nexus_canary_runs` — measured canary and security results
- `public.nexus_interface_spine_summary` — sanitized read model
- `public.nexus_system_status['operating_spine']` — canonical current status

## Deterministic runtime controls

- unique idempotency key per job
- atomic claim with bounded lease
- worker identity bound to start/complete
- automatic expired-lease recovery every five minutes
- retry and dead-letter states
- database-enforced state-transition rules
- reserved external actions physically blocked from CLAIMED/RUNNING/DONE
- `DONE` requires `acceptance.passed=true` plus evidence
- capability `PROMOTED` requires a corresponding `PASSED` canary with `security_result.passed=true`
- row-level security enabled on all four spine tables
- `anon` and `authenticated` table reads revoked

## Acceptance canary

Candidate: `nexus_operating_spine_v1`
Canary ID: `f81f8c82-b7a6-45d7-9c3d-548e44d554ad`
Evaluation job: `83c8d6bb-c73c-42cc-83b3-bdd3fa9b6d17`

Result: **20/20 PASS**

Test coverage:

1. four spine tables exist
2. RLS enabled on all spine tables
3. anon denied spine reads
4. authenticated denied spine reads
5. lease-recovery cron active
6. capability candidate registers durably
7. registration creates a READY job
8. duplicate registration does not duplicate the job
9. idempotency key uniqueness enforced
10. claim creates a valid lease and attempt count
11. claimed job starts under the matching worker
12. false DONE without acceptance/evidence is blocked
13. evidence-backed DONE succeeds
14. claim/start/complete events persist
15. reserved external action is blocked
16. candidate lifecycle reaches PROMOTE_READY through legal transitions
17. promotion without a passed secure canary is blocked
18. passed secure canary permits promotion
19. expired lease recovers to RETRY
20. exhausted lease recovers to DEAD_LETTER

The first self-test attempt also exposed a dependency defect: control receipts require the component to exist in `nexus_component_registry`. The transaction rolled back; `nexus_operating_spine` was registered; the unchanged test was rerun and passed 20/20. This is retained as evidence that the test path can fail closed rather than produce a false pass.

## Health/read-only verification

`nexus-command-center-health` was extended to schema `nexus-command-center-health/v3` to expose only sanitized operating-spine status/summary data. A database-originated `pg_net` GET returned:

- HTTP: `200`
- Content-Type: `application/json; charset=utf-8`
- schema: `nexus-command-center-health/v3`
- operating spine state: `PROMOTED`
- promoted candidates: `1`
- ready jobs: `0`
- active jobs: `0`
- dead-letter jobs: `0`

## Future-canary rule

**REGISTER BEFORE EXECUTION.**

Every future capability canary must first have a deterministic `candidate_key` in `nexus_capability_candidates` and a durable `nexus_jobs` record before canary work begins. Promotion is a database state reached only after measured/security evidence, not a narrative label.

The `Nexus Capability Watch` and `NEXUS Action Runner` automations were updated to enforce this path.

## Preserved boundaries

- no new credentials
- no plugin installation
- no permission expansion
- no spending
- no external communications or writes
- no trading, filing, account changes, or commitments
- no D1 migration
- no D1 dual-write
- existing Command Center D1 control objects remain authoritative for their current scope
- GitHub `main` remains untouched; this record is on the isolated `nexus-core-shadow-v0.1` branch
