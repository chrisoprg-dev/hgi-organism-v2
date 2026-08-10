# NEXUS Connector Acceptance — 2026-08-09

Status: read-only acceptance only. No external writes authorized or performed.

## Verified in current ChatGPT execution environment

- Outlook: profile read; Drafts folder discovery; Sent Items folder discovery; exact reimbursement draft located; recipient fields/body/attachment metadata readable; no matching Sent Items message found at acceptance time.
- Gmail: label counts readable; draft inventory readable.
- Google Drive: NEXUS artifacts discoverable; Always-On Runtime Blueprint readable.
- Google Calendar: calendar inventory readable.
- GitHub: `chrisoprg-dev/hgi-organism-v2` repository readable and writable through an isolated branch; main untouched.
- Supabase: `hgi-capture` production project metadata and table inventory readable. No schema or data mutation performed.

## Current boundaries

- The ChatGPT connector credentials are not inherited by the Railway runtime.
- No connector secret is copied into repository code, Library state, logs, or database rows.
- External writes remain fail-closed in the NEXUS shadow runtime.
- The connected Supabase project is HGI production and is not approved as the personal/cross-domain NEXUS durable store.
- Sites private-sign-in bypass-token rotation remains a separate provider-control gate.

## Next acceptance units

1. Provision an isolated NEXUS Supabase project or development branch after cost/organization approval.
2. Apply `nexus/sql/001_nexus_shadow_schema.sql` only there.
3. Add a durable-store adapter and restart/idempotency tests.
4. Add least-privilege read-only connector adapters for the always-on runtime using independently provisioned OAuth, never ChatGPT connector credentials.
5. Complete true cross-device/session-expiry acceptance on the private Command Center.
6. Complete a positive sent-present receipt only after a future exact approved send.
