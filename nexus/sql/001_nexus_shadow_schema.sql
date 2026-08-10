-- NEXUS shadow control-plane schema v0.1
-- PREPARED ONLY. Do not apply to the live HGI capture database.
-- Intended for an isolated Supabase project or development branch.

begin;

create schema if not exists nexus;

create type nexus.job_state as enum (
  'READY','CLAIMED','RUNNING','DONE','WAITING_EXTERNAL','NEEDS_USER',
  'SCHEDULED','RETRY','FAILED','DEAD_LETTER'
);

create table nexus.workstreams (
  id uuid primary key default gen_random_uuid(),
  world text not null,
  title text not null,
  priority text not null default 'P2' check (priority in ('P0','P1','P2','P3')),
  status text not null default 'ACTIVE',
  authority_class text not null default 'A1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nexus.jobs (
  id uuid primary key default gen_random_uuid(),
  workstream_id uuid references nexus.workstreams(id) on delete cascade,
  type text not null,
  action_type text not null,
  state nexus.job_state not null default 'READY',
  priority text not null default 'P2' check (priority in ('P0','P1','P2','P3')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  idempotency_key text unique,
  expected_value numeric,
  unblock_leverage numeric,
  user_minutes_avoided numeric,
  estimated_cost_usd numeric,
  risk_score numeric,
  deadline_at timestamptz,
  scheduled_at timestamptz,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nexus_jobs_ready_idx on nexus.jobs (state, priority, deadline_at);
create index nexus_jobs_workstream_idx on nexus.jobs (workstream_id, state);

create table nexus.dependencies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references nexus.jobs(id) on delete cascade,
  dependency_type text not null,
  condition jsonb not null default '{}'::jsonb,
  satisfied boolean not null default false,
  satisfied_at timestamptz,
  next_check_at timestamptz,
  created_at timestamptz not null default now()
);

create table nexus.approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references nexus.jobs(id) on delete set null,
  approval_type text not null,
  fingerprint text not null unique,
  status text not null check (status in ('HELD','READY','APPROVED','REJECTED','EXPIRED','REVOKED')),
  evidence_cutoff_at timestamptz,
  expires_at timestamptz,
  approved_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table nexus.events (
  seq bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid(),
  workstream_id uuid references nexus.workstreams(id) on delete set null,
  job_id uuid references nexus.jobs(id) on delete set null,
  event_type text not null,
  event_time timestamptz not null,
  learned_time timestamptz not null default now(),
  source text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index nexus_events_event_id_idx on nexus.events(event_id);
create index nexus_events_job_seq_idx on nexus.events(job_id, seq);

create table nexus.connector_state (
  connector text primary key,
  read_cursor text,
  last_sync_at timestamptz,
  token_health text,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table nexus.cost_log (
  id bigint generated always as identity primary key,
  workstream_id uuid references nexus.workstreams(id) on delete set null,
  job_id uuid references nexus.jobs(id) on delete set null,
  provider text not null,
  model text,
  operation text not null,
  cost_usd numeric not null check (cost_usd >= 0),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Fail closed. No anon/authenticated policies are created in v0.1.
alter table nexus.workstreams enable row level security;
alter table nexus.jobs enable row level security;
alter table nexus.dependencies enable row level security;
alter table nexus.approvals enable row level security;
alter table nexus.events enable row level security;
alter table nexus.connector_state enable row level security;
alter table nexus.cost_log enable row level security;

revoke all on schema nexus from anon, authenticated;
revoke all on all tables in schema nexus from anon, authenticated;
revoke all on all sequences in schema nexus from anon, authenticated;

commit;
