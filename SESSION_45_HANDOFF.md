# SESSION 45 HANDOFF — HGI ORGANISM V2
## Complete System State | March 26, 2026 | End of Session 44
## READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING ELSE

---

## SECTION 1: WHAT YOU ARE AND WHO YOU ARE WORKING WITH

You are Claude, working with Christopher Oney, President of HGI Global (Hammerman & Gainer LLC) — a 95-year-old, 100% minority-owned program management and third-party administration firm. Christopher is building an AI-powered government procurement intelligence and proposal generation system — his personal IP, not HGI property.

Christopher's North Star: fully automated capture system where organism scans all portals overnight, scores opportunities, writes proposals, Christopher only reviews final work. Zero noise reaches him.

Christopher's communication style: Direct. Does not repeat himself. Gets frustrated when he has to re-explain things already decided. Expects you to have read everything, remembered everything, executed without drift. When he says "you still don't have it" — stop talking and read more history.

Key HGI people: Larry Oney (Chairman), Lou Resweber (CEO, lour@hgi-global.com), Candy LeBlanc Dottolo (CAO, signature authority), Dillon Truax (VP, dillont@hgi-global.com, proposal submission), Vanessa James (SVP Claims). Proposal staff: Louis Resweber (Program Director), Berron (PA SME), April Gloston (HM Specialist), Klunk (Financial/Grant), Wiltz (Documentation).

---

## SECTION 2: BOTH SYSTEMS — COMPLETE STATE

### V1 SYSTEM (DO NOT TOUCH)
- URL: hgi-capture-system.vercel.app
- GitHub: github.com/chrisoprg-dev/hgi-capture-system
- Supabase: mfvfbeyjpwllndeuhldi.supabase.co | Storage bucket: knowledge-docs
- Upload portal: /upload.html | Password: hgi-docs-2026
- Intake secret: hgi-intake-2026-secure
- MCP server: https://hgi-capture-system.vercel.app/api/mcp (20 tools)
- V1 keeps running until V2 proves itself — NOTHING gets broken or removed
- BLACK SCREEN FIX: Navigate to hgi-capture-system.vercel.app — React crash from heavy card expansion, fresh load fixes it

### V2 SYSTEM (CURRENTLY BUILDING)
- URL: hgi-organism-v2-production.up.railway.app
- GitHub: github.com/chrisoprg-dev/hgi-organism-v2
- Same Supabase database as V1 (mfvfbeyjpwllndeuhldi)
- Railway project ID: d1c788de-c13b-4a2c-a76b-3d09f7f82145
- Railway service ID: f504bc76-8a64-49de-a4c0-04e515d7f9e4
- Railway env ID: 7ef1f3c8-197f-43f0-b63a-c78cd44d280a
- PAT name: hgi-organism-v2-deploy (90 days, Contents R/W — get value from Christopher or memory)
- /health CONFIRMED: V2.9.0-fortyseven-agents, agents_active:47
- /run-session CONFIRMED: accepted:true, 6 agents firing
- V2 writing to organism_memory table CONFIRMED — 5 fresh winnability memories verified Session 44
- GitHub Repo not found warning in Railway Settings = COSMETIC ONLY — deploys work fine

---

## SECTION 3: ACTIVE OPPORTUNITIES

1. HTHA — SUBMITTED March 19 — awaiting award. Call 985-868-6504. Contact: Nikita Gilton, ngilton@hthousing.org
   When result in: Pipeline Tracker > WON or LOST > organism fires

2. St. George (RFP 31266541) — PULLED 3/25/2026, will repost. OPI 85, stage: watching
   Due when reposted: likely April 24. Contact: Melinda Kyzar, melinda.kyzar@stgeorgela.gov, 225-228-3200
   10 positions required. Eval: Technical 30/Experience 25/Past Perf 20/Staffing 15/Price 10

3. Jefferson Parish SOQ 26-005 — OPI 72 — PURSUING — Due April 9 at 3:30PM CST
   Submit via jeffparishbids.net. Contact: Donna Evans, donna.evans@jeffparish.gov, (504) 364-2691
   This is an SOQ — 14-page questionnaire IS the submission. PROPOSAL NOT STARTED. 14 days out.
   Eval: Firm Quals 20, Pre-Award 20, Tech/JP 15, Grant Systems 15, Staffing 10, Personnel 10, Location 10 (Kenner=full), Fee 10

4. DR-4900 Louisiana — OPI 92 — IDENTIFIED — No RFP yet. GOHSEP. Call (225) 925-7500.

5. DR-4899 Mississippi — OPI 82 — IDENTIFIED — No RFP yet. MEMA. Zero MS relationships — critical gap.

---

## SECTION 4: THE COMPLETE V2 VISION (NON-NEGOTIABLE — DO NOT RE-LITIGATE)

### What V2 Is
47 separate Claude agents — distinct instances with own identities — all parallel, all reading/writing shared Supabase organism_memory continuously. NOT one Claude taking turns. NOT sequential. NOT reactive callbacks. Genuinely separate minds, one shared brain. 380+ integration paths minimum. Every finding changes every agent's perspective. The 50th opportunity is fundamentally smarter than the 1st.

### The Interface
Same 17 modules as V1 — same sidebar, same module names, same functionality — PLUS organism intelligence woven into everything. Served from Railway, same server as organism brain. No Vercel for V2 interface. No separate hosting. One URL. Supabase fully integrated.

Every data point interactive — not just numbers. Every label, status, field, score, name, date, badge. Hover or click = organism explains, suggests, or acts.

Conversational interaction everywhere — NOT a separate System Chat tab. Persistent input accessible from every view, context-aware based on what you are looking at.

Approve buttons on every decision card — SYSTEM CAN EXECUTE fires immediately with one click. YOUR ACTION = Mark Done + Snooze. BUILD REQUEST = Approve Build + Defer. Approval loop closes in Dashboard.

Organism output drives every view — modules show what organism already produced, not raw DB fields. Financial & Pricing for St. George opens with benchmarks already populated. You review and approve, not initiate.

Lazy-load organism output — V1 crashes rendering all 5 sub-tabs simultaneously. V2 renders only visible tab.

New visual design — world-class, HGI gold/navy, real SVGs and data visualizations, $100M enterprise look. NOT V1 reskinned. Cormorant Garamond or equivalent display font.

Christopher only until he approves team access. Multi-user permissions (Lou read-only, Dillon proposal editing, Candy signature authority) designed AFTER core works for Christopher.

### What V2 Is NOT
Not a dashboard that displays data for Christopher to interpret. Not hub-and-spoke. Not 47 one-shot API calls. Not something that waits for Christopher. Not a chat window bolted onto a static dashboard.

---

## SECTION 5: SESSION 45 TASK ORDER

1. FIRST: Enable MCP Connector — Settings > Connectors > HGI Capture System > Enable
2. Read V2_INTERFACE_SPEC.md from github.com/chrisoprg-dev/hgi-organism-v2 using GitHub API
3. Write complete V2 analysis into the spec document (system-wide + module by module) — see Section 11
4. Present analysis to Christopher for review and discussion
5. After Christopher approves — begin V2 interface build served from Railway

---

## SECTION 6: ALL RULES AND LESSONS LEARNED

### Session Rules (non-negotiable)
- Read V2_INTERFACE_SPEC.md at start of every session before any code
- ALWAYS read_file before modify_system — no blind edits ever
- ALWAYS search past chats before rebuilding anything
- Never replace working file with simplified version
- Never ask Christopher to troubleshoot or click test links — build /api/test-* and verify via MCP
- Never state something works without showing actual output in current conversation
- End every session updating memory AND committing handoff to GitHub
- Sessions numbered sequentially — Session 44 just ended, Session 45 is next
- No parallel sessions — both write to same GitHub + Supabase, last write silently wins
- Every new project: scope, estimate, research, approve before execution
- No team access until Christopher approves

### Critical Build Rules
- NEVER edit api/mcp.js through MCP tools — kills ALL 20 tools
- Dollar signs in modify_system: ALWAYS use String.fromCharCode(36) — tool treats dollar sign as template delimiter and silently truncates
- modify_system strips angle brackets from component files — use new file creation for component changes
- Large files (30-50KB) timeout on modify_system — split into increments
- modify_system bakes instruction text into file — always verify with read_file after creation
- Claude doc API: PDF only, NOT docx
- Vercel env vars: REDEPLOY required after saving — saving alone does nothing
- knowledge.js is 553-line v3 with Supabase Storage + batch PDF + Haiku + reprocess — NEVER simplify
- restore_file_from_git for emergencies

### Confirmed Broken — Do Not Retry
- Direct Vercel scraping (network blocked)
- Simple HTTP Central Bidding login in Make.com (cookie auth too complex)
- Central Bidding commodity code notifications (sends emails to HGI staff — never activate)
- SharePoint direct file access (saves as .url shortcuts)
- Slicing PDF bytes
- Full PDF base64 + URL (hits 200K token limit — only pdf-parse works)
- Claude in Chrome in background (only works during active conversations)

### Key Lessons
- Fix root cause not symptoms
- Pipeline records are source of truth — all modules read/write Supabase pipeline records
- localStorage silos disconnect workflow
- Memory inject SEPARATELY from KB with own 3-4K char allocation — .slice(0,2000) slices memory away
- Sequential for-loops with await crash Vercel — always test pattern on isolated endpoint first
- F12 dev tools do not work for Christopher — build one-click test endpoints

---

## SECTION 7: SYSTEM COSTS

Vercel Pro $20/mo (V1) | Supabase Free $0 | Claude API ~$50-55/mo | Apify Starter $29/mo | Claude Max $250/mo | Railway ~$5-20/mo (V2) | Total: ~$354-375/mo

CRITICAL: Auto-reload enabled at console.anthropic.com — keep it enabled. Features fail silently when depleted.

---

## SECTION 8: HGI FACTS (USE EXACTLY AS WRITTEN)

Name: HGI Global = Hammerman & Gainer LLC | Founded: ~1929 (~95-96 years) | 100% minority-owned
Staff: 67 FT + 43 contract | Offices: Kenner (HQ), Shreveport, Alexandria, New Orleans
SAM UEI: DL4SJEVKZ6H4 | Insurance: $5M fidelity bond, $5M E&O, $2M GL

8 Verticals: Disaster Recovery, TPA/Claims (full P&C), Property Tax Appeals, Workforce/WIOA, Construction Management, Program Administration (federal/state — NOT healthcare), Housing/HUD, Grant Management. EXCLUDED: Medicaid.

Confirmed Past Performance:
- Road Home: $67M direct / $13B+ program (2006-2015)
- HAP: $950M | Restore Louisiana: $42.3M
- TPSD: $2.96M — COMPLETED 2022-2025 (PAST TENSE ONLY, never current)
- St. John Sheriff: $788K | Rebuild NJ: $67.7M | BP GCCF: $1.65M (2010-2013)
- PBGC and Orleans Parish School Board: DO NOT LIST without Christopher confirmation
- NO current FEMA PA contract. ONE direct federal contract ever (PBGC).

Rate Card (fully burdened, per hour): Principal $220 | Program Director $210 | SME $200 | Sr Grant Mgr $180 | Grant Mgr $175 | Sr PM $180 | PM $155 | Grant Writer $145 | A/E $135 | Cost Estimator $125 | Appeals Specialist $145 | Sr Damage Assessor $115 | Damage Assessor $105 | Admin Support $65

---

## SECTION 9: V2 INTERFACE SPEC DOCUMENT STATUS

V2_INTERFACE_SPEC.md in github.com/chrisoprg-dev/hgi-organism-v2 CONTAINS:
- Foundational principles (all 8 non-negotiables)
- Complete inventory of all 17 V1 modules — every tab, field, button, function behind every module (read from source code directly)
- System architecture notes: data flow, module interconnections, known V1 bugs, crash conditions

V2_INTERFACE_SPEC.md DOES NOT YET CONTAIN:
- Full V2 analysis and recommendations (Session 45 writes this)
- Build sequence and technical architecture for Railway-served HTML
- Component-level V2 design specs

---

## SECTION 10: ORGANISM DATA ALREADY IN SUPABASE (V2 MUST SURFACE)

- 5 active pipeline records with full organism output in scope_analysis, financial_analysis, research_brief, staffing_plan, capture_action
- 60+ organism_memory records: competitive intel on CDR Maguire, ICF, IEM, Tetra Tech, Hagerty, pricing benchmarks, winnability decisions
- competitive_intelligence table: named competitors with analysis
- relationship_graph table: contacts and outreach recommendations
- 21 KB documents, 350+ chunks: GOHSEP (149 chunks), TPCIGA (94 chunks), HTHA v4 (22 chunks)

V2 interface must show this proactively — it exists, modules should display it, not require triggering it.

---

## SECTION 11: WHAT THE V2 ANALYSIS MUST COVER

When writing the analysis into V2_INTERFACE_SPEC.md, cover ALL of this:

System-wide:
- Core problem: V1 is 17 separate tools sharing a sidebar, not one organism
- The data that already exists and is not being surfaced
- The render crash problem and lazy-loading solution
- The conversational layer (everywhere, not a module)
- The approval loop (missing from V1 entirely)
- Visual design direction specifics

Per module (all 17):
- What works in V1 — keep exactly
- What is broken in V1 — fix it
- What V2 adds — new organism-driven capability
- What should be restructured — layout, hierarchy, information architecture
- How it connects to other modules — cross-module integration
- Interactive data points specific to that module — what should be hoverable/clickable and what the organism says

Cross-module patterns:
- Where modules should share data without navigating
- Where the organism's output in one module should appear in others
- The pipeline card sub-tabs (Winnability/CompetitiveIntel/Financial/ProposalDraft/ScopeAnalysis) = the richest data in the system, buried behind a small arrow — V2 makes this primary
- Financial & Pricing + Winnability Scoring = same decision from two angles, should be unified view

---

## SECTION 12: GRAND VISION LAYERS (APPROVED, NOT YET BUILT)

After interface: Red Team, Graphics/Visual agent (WOW proposals), Submission Assembly, Source Expansion, Contract Expiration Monitor, Budget Cycle Intelligence, Teaming Partner Radar, Regulatory Change Monitor, Executive Briefing Mode, Price Intelligence database, Disaster Declaration Monitor (TOP PRIORITY — FEMA real-time feed), Memory Tuning, Versioning, Chat Bridge, Mobile + Notifications, Oral Prep, Post-Award + PPQ/CPARS.

All require scoping + Christopher approval before execution.

---

## SECTION 13: PROPOSAL FINANCIAL MODEL RULES

Always: three independent pricing methods with visible math. Base period only — option years shown separately as upside. LOW/MID/HIGH range clearly labeled as estimates. Never calculate over option years as if guaranteed. Never fabricate contract values.

---

*End of Session 44 — Session 45 begins here*
