-- ============================================================
-- S172 ANTI-FABRICATION LAYER — OPTIONAL FOLLOW-UP MIGRATION
-- ============================================================
-- STATUS: NOT APPLIED. Do not run this without Christopher's explicit approval.
--
-- CLAUDE.md line 20: "Supabase project mfvfbeyjpwllndeuhldi is PRODUCTION.
-- Treat all database access as read-only unless Christopher explicitly approves
-- a write in the current session." No such approval was given, so the shipped
-- S172 implementation deliberately requires NO schema change:
--
--   * organism_memory writes keep the citation block inline in `observation`
--     and lift a provenance reference into the existing `source_url` column.
--   * opportunities writes persist prose with the block stripped, and store the
--     verified manifest in a companion organism_memory row
--     (agent='citation_manifest', memory_type='citation_manifest').
--
-- That works, but provenance is only queryable via JSON stored in a text column.
-- This migration is the cleaner end state if you want it later. Applying it does
-- NOT require code changes to ship first — the columns are additive and nullable,
-- so nothing breaks while they sit empty.
--
-- Review, then apply via the Supabase SQL editor or `supabase db push`.
-- ============================================================

-- 1. Structured citations on every memory row.
alter table public.organism_memory
  add column if not exists citations jsonb;

comment on column public.organism_memory.citations is
  'S172: array of quote-anchored citation objects. Shape: [{src,opp,field,quote,offset}]. '
  'src is one of opp_field|memory|kb|listing|file. Verified by substring match at write time.';

-- 2. Provenance for the two highest-risk opportunity fields.
alter table public.opportunities
  add column if not exists scope_analysis_citations jsonb,
  add column if not exists scope_analysis_gate      text,
  add column if not exists opi_citations            jsonb,
  add column if not exists opi_gate                 text;

comment on column public.opportunities.scope_analysis_gate is
  'S172 gate verdict recorded when scope_analysis was last written: ok | force_bypass | <reject code>.';
comment on column public.opportunities.opi_gate is
  'S172 gate verdict for the last opi_score write. "ungrounded" marks an intake score '
  'whose evidence span could not be matched against the listing stub.';

-- 3. Indexes for the coverage queries this layer is meant to make answerable:
--    "what fraction of memory rows are cited?" / "which opportunities carry
--    ungrounded scores?"
create index if not exists organism_memory_citations_idx
  on public.organism_memory using gin (citations);

create index if not exists opportunities_scope_gate_idx
  on public.opportunities (scope_analysis_gate)
  where scope_analysis_gate is not null;

-- 4. Coverage view — the metric that says whether the disease is receding.
--    Baseline measured 2026-07-26: 719 of 10,008 rows (7.2%) carried a source_url.
create or replace view public.v_citation_coverage as
select
  date_trunc('day', created_at)::date                                as day,
  agent,
  count(*)                                                           as rows_written,
  count(*) filter (where citations is not null
                     and jsonb_array_length(citations) > 0)          as rows_with_citations,
  count(*) filter (where source_url is not null and source_url <> '') as rows_with_source_url
from public.organism_memory
group by 1, 2;

comment on view public.v_citation_coverage is
  'S172: per-agent, per-day citation coverage. Use to decide when CITATION_ENFORCE '
  'can safely move from priority to global.';
