================================================================
HGI ORGANISM V2 — SESSION 50 HANDOFF
Date: March 27, 2026 | Next Session: Session 51
================================================================

MANDATORY SESSION START:
STEP 1: call recent_chats (n=5-10). Read every message.
STEP 2: READ EVERY MEMORY RULE WORD FOR WORD.
STEP 3: Synthesize current state.
STEP 4: Navigate to live site FIRST — all work visible in browser.
STEP 5: Only then begin work.

================================================================
SESSION 50 — WHAT WAS DONE
================================================================

FIXED: interface.html restored from da4af6d6 (was broken 3-line file).

PHASE 2A COMPLETED THIS SESSION:

index.js — 4 new API routes (commit 29db28b1):
  /api/opportunity-detail?id=   full opp record ALL Supabase fields
  /api/opportunity-memories?id= all organism_memory for one opp
  /api/opportunity-intel?id=    competitive_intelligence for one opp
  /api/hunt-stats               scraper run history (50 records)

interface.html — Full detail drawer (commits 277ffcf + de7f72de):
  Click ANY pipeline card — drawer opens — 5 tabs:
  Tab 1 Overview: stage, est value, capture action, source link
  Tab 2 Scope & Research: scope_analysis, research_brief, financial_analysis
  Tab 3 Proposal Draft: staffing_plan field content
  Tab 4 Memories (N): ALL organism_memory records for that opp
  Tab 5 Competitive (N): competitive_intelligence table records

VERIFIED WORKING (network + DOM confirmed):
  All 3 new endpoints return 200
  NOLA opp drawer: 50 organism memories now visible
  competitive_intelligence table: 0 records (agents not writing there)
  Drawer: 5 tabs, 5 panels, open/close, tab switching all working

================================================================
CURRENT SYSTEM STATE
================================================================

URL: hgi-organism-v2-production.up.railway.app — UP, 47 agents
ACTIVE DEPLOY: Fix detail drawer (de7f72de) — Deployment successful

MODULES WORKING:
  Dashboard — briefing, KPIs, pipeline cards, activity, decisions
  Pipeline Tracker — clickable cards with full intelligence drawer

MODULES STILL STUB (13):
  Opportunity Discovery, Research & Analysis, Winnability Scoring,
  Proposal Engine, Financial & Pricing, Recruiting & Bench,
  Relationship Intelligence, Content Engine, Knowledge Base,
  Weekly Digest, Executive Brief, Pipeline Scanner, Scraper Insights
  System Chat — renders but wired to generic Claude not organism memory

KEY FINDING: competitive_intelligence table is EMPTY for all opps.
Intelligence_engine agent output is going somewhere else (likely
organism_memory with memory_type=competitive_intel). Need to verify
and update the Competitive tab filter accordingly.

================================================================
SESSION 51 PRIORITIES
================================================================

1. Walk every pipeline card with Christopher watching (Phase 2B start).
   Click each opp. Check each tab. Document what is populated vs empty.

2. Fix Competitive tab — check if intel is in organism_memory instead
   of competitive_intelligence table. Filter by memory_type if so.

3. Wire System Chat to organism memory (highest value stub fix).
   /api/chat must inject relevant organism_memory before Claude call.

4. Wire Scraper Insights module to /api/hunt-stats (route already built).

================================================================
CREDENTIALS — stored in Claude memory, not repeated here.
V2 URL: hgi-organism-v2-production.up.railway.app
GitHub: github.com/chrisoprg-dev/hgi-organism-v2
PAT name: hgi-organism-v2-deploy-3 (expires Jun 25 2026)
Railway project: d1c788de / service: f504bc76 / env: 7ef1f3c8
Supabase: mfvfbeyjpwllndeuhldi (shared V1+V2)
V1 URL: hgi-capture-system.vercel.app (DO NOT TOUCH)

DEPLOY METHOD (confirmed working this session):
serviceConnect(id, input:{repo,branch}) THEN
githubRepoDeploy(input:{projectId,repo,branch,environmentId})
Both via Railway GraphQL with credentials:include from Railway tab.

================================================================
END SESSION 50 — NEXT: Session 51
================================================================