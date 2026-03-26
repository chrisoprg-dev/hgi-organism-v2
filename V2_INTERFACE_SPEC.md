# HGI ORGANISM V2 ÃÂ¢ÃÂÃÂ COMPLETE INTERFACE BUILD SPECIFICATION
**Living document. Updated after each module review. This is the authoritative build spec.**
Last updated: Session 44, March 26, 2026

---

## FOUNDATIONAL PRINCIPLES (NON-NEGOTIABLE)

1. **Preserve everything from V1.** Every module, every tab, every field, every function behind every button. Nothing deleted. Everything improved.
2. **New visual design.** Not V1 reskinned. World-class, stunning, HGI gold and navy. Real SVGs, real data visualizations, real graphics. Looks like a $100M enterprise platform.
3. **Served from Railway.** Same server as the organism brain. No Vercel. No separate hosting. One URL: hgi-organism-v2-production.up.railway.app
4. **Every data point is interactive.** Not just numbers ÃÂ¢ÃÂÃÂ every label, status, field, score, name, date, percentage, badge. Hover or click anything and the organism has something to say, suggest, or explain about it.
5. **Conversational interaction everywhere.** Built into every view. Not a separate chat tab. Ask "why is this scored 72" from the pipeline view, it answers there.
6. **Organism output drives every view.** Modules display what the organism produced, not raw database fields.
7. **Christopher only.** No team access until he approves.
8. **Multi-user permissions designed after core works for Christopher.** Lou (read-only exec view), Dillon (proposal editing), Candy (signature authority).

---

## MODULE INVENTORY (18 total ÃÂ¢ÃÂÃÂ all carry forward)

Sidebar order as in V1:
1. Dashboard
2. Full Workflow
3. Opportunity Discovery
4. Pipeline Scanner
5. Pipeline Tracker
6. Opportunity Brief
7. Research & Analysis
8. Winnability Scoring
9. Proposal Engine
10. Financial & Pricing
11. Recruiting & Bench
12. Relationship Intelligence
13. Content Engine
14. Weekly Digest
15. Executive Brief
16. Scraper Insights
17. Knowledge Base
18. System Chat

---

## MODULE 1: DASHBOARD

### What V1 Has (complete inventory):
- Personalized greeting with live date/time
- TODAY'S PRIORITY briefing strip (organism's top recommendation ÃÂ¢ÃÂÃÂ currently rendering raw JSON with backticks, BROKEN)
- Pipeline counters: Active, Tier 1, Pursuing, In Proposal, Submitted, Stale, New Today
- ORGANISM STATUS section: agent health bar (colored dots, 13 Live / 5 Partial / 2 Planned), last think timestamp, Think Now button
- PENDING DECISIONS preview (shows 4 of 20 decisions in compact list)
- THIS WEEK section (opportunities needing action this week ÃÂ¢ÃÂÃÂ filter logic too narrow, misses April deadlines)
- ORGANISM DECISIONS full list (20 cards) ÃÂ¢ÃÂÃÂ each card has:
  - Decision title
  - Priority badge: CRITICAL / HIGH / MEDIUM
  - Action type badge: SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST
  - Full paragraph with specific instructions (names, phone numbers, dates, exact steps)
  - Expand/collapse arrow
- SCRAPER STATUS panel: each source with status (LIVE/DELAYED/UNKNOWN/SETUP), last run time, run count
- QUICK START shortcuts: New RFP landed, Check pipeline, Draft proposal, Weekly digest
- WIN PATH: stage labels (Discover ÃÂ¢ÃÂÃÂ Score ÃÂ¢ÃÂÃÂ Research ÃÂ¢ÃÂÃÂ Workflow ÃÂ¢ÃÂÃÂ Proposal ÃÂ¢ÃÂÃÂ Red Team ÃÂ¢ÃÂÃÂ Export ÃÂ¢ÃÂÃÂ Submit ÃÂ¢ÃÂÃÂ WIN)
- KEY PAST PERFORMANCE listing in sidebar footer

### What Works ÃÂ¢ÃÂÃÂ Keep:
- Organism Decisions cards are excellent. Specific, actionable, named contacts, exact dates, three-type badge system (SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST). This is the core of what makes V2 different from V1.
- Pipeline counters ÃÂ¢ÃÂÃÂ real and accurate
- Scraper Status concept ÃÂ¢ÃÂÃÂ right information, needs fixing
- Win Path concept ÃÂ¢ÃÂÃÂ right idea, needs live opportunity markers
- Three-tier priority system (CRITICAL/HIGH/MEDIUM)

### What's Broken ÃÂ¢ÃÂÃÂ Fix:
- TODAY'S PRIORITY renders raw JSON with backticks. Must parse and render as clean natural language prose. This is the first thing seen at login ÃÂ¢ÃÂÃÂ cannot look broken.
- Organism Status dot bar has no tooltips or labels. No way to know which dot = which agent. Every dot must be identified on hover.
- "Last think: 08:01 AM" ÃÂ¢ÃÂÃÂ 5-hour gap visible when organism is supposed to always be thinking. Show gap time and make it meaningful.
- THIS WEEK filter too narrow ÃÂ¢ÃÂÃÂ shows only 1 opportunity. Should show "next 30 days with pending action" not just current calendar week.
- PENDING DECISIONS preview (4 items) is redundant with full ORGANISM DECISIONS list (20 items) below it. Seeing same data twice, twice the scroll.
- Central Bidding DELAYED, Alabama/Georgia SETUP (never run) ÃÂ¢ÃÂÃÂ needs more than a status label. Needs one-click fix action.
- Quick Start shortcuts are static/generic. Should be dynamic and context-aware based on what's actually pending.
- Win Path shows no live opportunity markers ÃÂ¢ÃÂÃÂ just stage labels. No data on it.

### V2 Improvements ÃÂ¢ÃÂÃÂ Add:
1. TODAY'S PRIORITY renders as clean prose briefing: what changed overnight, what needs you today, what organism is working on. 3-4 sentences max. No JSON.
2. APPROVE button on every SYSTEM CAN EXECUTE card ÃÂ¢ÃÂÃÂ one click triggers execution. MARK DONE + SNOOZE on YOUR ACTION cards. APPROVE BUILD + DEFER on BUILD REQUEST cards. The approval loop must close in the Dashboard.
3. Revenue at stake: "HGI has $X active pipeline. These N pursuits = X% of annual target." Prominent, always visible.
4. Decision history: what was approved yesterday, what organism executed, what the outcome was.
5. Conversational input embedded in Dashboard ÃÂ¢ÃÂÃÂ natural language field: "Ask the organism anything or give it a direction." Not a link to System Chat ÃÂ¢ÃÂÃÂ right there on Dashboard.
6. Win Path becomes live visual with each active opportunity plotted as a marker at its current stage.
7. Organism agent health dots each identified and clickable ÃÂ¢ÃÂÃÂ shows that agent's last output and current status.

### V2 Layout Restructure:
- TOP: Briefing strip (clean prose, 3-4 sentences)
- ROW 2: Pipeline counters (same as V1, clickable to filter)
- MAIN AREA: Two columns
  - LEFT: YOUR ACTION items only, sorted by deadline urgency
  - RIGHT: SYSTEM CAN EXECUTE items, sorted by impact
- BELOW: BUILD REQUEST items in compact separate section (system improvements, not operational decisions)
- BELOW: Win Path with live opportunity markers
- FOOTER STRIP: Scraper Status + Agent health, always visible

### How It Fits the System:
- Dashboard is the organism's control center. Every module feeds decisions into it. Approvals on the Dashboard trigger execution in the corresponding module. The feedback loop: module produces data ÃÂ¢ÃÂÃÂ dashboard surfaces decision ÃÂ¢ÃÂÃÂ Christopher approves ÃÂ¢ÃÂÃÂ organism executes ÃÂ¢ÃÂÃÂ result returns to dashboard. This loop is missing in V1. V2 must complete it.

---

## MODULES 2-18: TO BE DOCUMENTED DURING REVIEW SESSION



---

## MODULE 2: FULL WORKFLOW

### What V1 Has (complete inventory):
- Subtitle: "RFP Decomposition Ã¢ÂÂ Executive Brief + OPI Ã¢ÂÂ Proposal Package"
- Opportunity selector at top: shows all 5 active pipeline opportunities with OPI scores and agency Ã¢ÂÂ click to load existing opp
- New opportunity entry form (below selector):
  - OPPORTUNITY TITLE (text field)
  - AGENCY (text field)
  - KNOWN INCUMBENT (text field)
  - RFP URL (optional) (text field)
  - RELATIONSHIP INTEL / CONTEXT (large textarea Ã¢ÂÂ known relationships, budget intel, political context)
  - RFP / SOLICITATION TEXT section:
    - Upload PDF / Word / TXT button
    - Large paste area: "Paste RFP text here, or upload a file above..."
  - Step 1: Analyze RFP button (gold, prominent)
- Steps 2+ appear after Step 1 runs (not visible until triggered Ã¢ÂÂ need to run to document)

### Notes:
- This is the primary intake workflow for new opportunities
- Connects to the full orchestration pipeline: RFP Ã¢ÂÂ scope analysis Ã¢ÂÂ OPI Ã¢ÂÂ executive brief Ã¢ÂÂ proposal package
- The upload function accepts PDF/Word/TXT
- Existing opportunities can be reloaded to continue workflow

---

## MODULE 3: OPPORTUNITY DISCOVERY

### What V1 Has (complete inventory):

**Header stats bar:**
- Total Hunted: 5
- Tier 1: 5
- Immediate Action: 2
- Saved to Tracker: 0
- Signals: 0
- Last Hunt: timestamp

**5 Tabs:**

**Tab 1 Ã¢ÂÂ Hunt Engine:**
- Section header: "HUNT ENGINE Ã¢ÂÂ Scans all HGI verticals simultaneously"
- ACTIVE VERTICALS toggles: Disaster Recovery/CDBG-DR, TPA/Claims/Insurance, Workforce & Social Services, Health & Human Services, Infrastructure & Capital, Property Tax Appeals, Federal Agencies (each toggleable on/off)
- PRIORITY STATES toggles: LA, TX, FL, MS, AL, GA, Federal
- Run Full Hunt Now button (gold)
- Refresh from Database button
- Explanation text: auto-runs 7am daily
- TOP OPPORTUNITIES section below Ã¢ÂÂ shows all results with IMMEDIATE/ACTIVE badge, TIER_1 badge, vertical tag, OPI score, organism analysis paragraph, Ã¢ÂÂ Workflow button, ? button, + Track button

**Tab 2 Ã¢ÂÂ Results (5):**
- Filters: Vertical dropdown (All/each vertical), State dropdown, Sort By (OPI/Urgency/Contract Value/Immediate Only)
- "5 of 5 shown"
- Full opportunity cards with: status badge, tier badge, vertical tag, title, agency, state, estimated value, due date, organism analysis paragraph, OPI score, Details expand, Workflow button, Track button, Source button

**Tab 3 Ã¢ÂÂ Retrieve Docs:**
- Header: "DOCUMENT RETRIEVAL ENGINE Ã¢ÂÂ Paste any RFP URL"
- URL paste field + Retrieve button
- Works with: SAM.gov, LaPAC, Texas SmartBuy, Florida Vendor Directory, agency websites, direct PDF links, any public procurement URL
- FETCH FROM HUNT RESULTS section: lists all 5 hunted opps with their source URLs and individual Retrieve buttons

**Tab 4 Ã¢ÂÂ Signals:**
- DISASTER SIGNALS section: "Recent declarations and events that will trigger FEMA PA/CDBG-DR RFP waves" Ã¢ÂÂ shows "Run Hunt to generate signals" (empty)
- FUNDING SIGNALS section: "HUD, FEMA, Treasury, USDA allocations that haven't produced RFPs yet Ã¢ÂÂ early warning" Ã¢ÂÂ shows "Run Hunt to generate signals" (empty)

**Tab 5 Ã¢ÂÂ Sources & Config:**
- MONITORED SOURCES table: SAM.gov (Active), State Procurement Portals (Active), Insurance Associations (Active), Municipal & Parish (Active), Federal Grant Signals (Active), Disaster & Funding Signals (Active)
- STATE AGENCY WATCH LIST: full list for LA, TX, FL, MS, AL, GA Ã¢ÂÂ specific agencies named per state (GOHSEP, OCD-DRU, LHC, MEMA, Texas GLO, Florida DEO, FDEM, etc.)
- HUNT FREQUENCY explanation
- Pro tip text



---

## MODULE 4: PIPELINE SCANNER

### What V1 Has (complete inventory):
- Title: "Live Pipeline Scanner" â subtitle: "SAM.gov Â· LaPAC Â· Texas SmartBuy Â· Gulf Coast portals"
- Run Live Scan button (top right)
- 2 Tabs:
  - **Pipeline tab**: Empty state â shows "Run First Scan" button with spinner icon. No results loaded.
  - **Recompetes tab**: Not yet clicked/documented
- MANUAL PORTALS section: link buttons â SAM.gov, LaPAC, Texas SmartBuy, FEMA Procurement, HUD CDBG-DR
- Note: This module appears largely non-functional/empty in current V1 state

---

## MODULE 5: PIPELINE TRACKER

### What V1 Has (complete inventory):
- Title: "Pipeline Tracker â 5 opportunities tracked"
- Buttons: "Clean Test Data" (top right), "+ Add Opportunity" (gold, top right)
- Filter tabs: All (5) | Identified (2) | Pursuing (1) | Submitted (1)
- Note: Missing "In Proposal" and "Won/Lost" filter tabs

**5 Opportunity Cards â each shows:**
- Title (truncated)
- Agency Â· vertical tag (disaster/federal)
- Stage progress bar: Discovered âº Scored âº Workflow Done âº Drafting âº Submitted âº WON (completed stages shown with â, current stage with â¶)
- Due date (if set)
- OPI Score â Tier badge (gold)
- Stage badge (IDENTIFIED / PURSUING / SUBMITTED)
- Expand arrow (â¼/â²)

**Expanded card reveals (OPPORTUNITY DETAILS):**
- Agency, Type, OPI Score, Added date, Source (View Original RFP â link)
- STAGE â MOVE TO STAGE dropdown: Identified / Qualifying / Pursuing / Proposal / Submitted / Won / Lost
- Organism analysis paragraph (full text from organism)
- ORGANISM INTELLIGENCE sub-tabs:
  - **Winnability** â full competitive scoring matrix, head-to-head vs named competitors, criterion-by-criterion breakdown with narrative, weakness analysis ranked by point loss, capture strategy
  - **Competitive Intel** â (tab visible, content not yet read)
  - **Financial** â (tab visible, content not yet read)
  - **Proposal Draft** â (tab visible, content not yet read)
  - **Scope Analysis** â (tab visible, content not yet read)
- "Get Capture Strategy" button
- "Edit" button
- "Delete" button

### Critical observation:
The expanded pipeline card is actually a deep intelligence hub â 5 sub-tabs of organism output. This is the richest data view in the whole system and it's hidden behind a small â¼ arrow on a list card. Most users would never know this depth exists.



---

## MODULE 6: OPPORTUNITY BRIEF

### What V1 Has (complete inventory):
- Subtitle: "Complete go/no-go decision view — one screen, everything you need"
- Opportunity selector pills at top (all active opps with OPI score, auto-selects first)
- **Header card** (gold left border): Title, Agency, OPI badge, urgency badge, vertical badge, HGI fit badge, days left countdown (color-coded: red ≤7, orange ≤14, gold ≤30, green >30), large OPI number, FULLY ANALYZED / PRELIMINARY SCORE indicator, due date, View Source button
- **Executive Summary card**: Description text + Scope Analysis sub-section (blue border), HGI Fit Analysis section
- **Go/No-Go Decision Factors card** (green border): Two-column layout — WHY HGI WINS list (green left border items) + KEY REQUIREMENTS list (orange left border items), CAPTURE ACTION section (gold border), Incumbent + Recompete indicators
- **Scope Analysis card** (blue border — from orchestrator): Full scope analysis rendered as markdown
- **Financial Analysis card** (green border — from orchestrator): Financial & staffing analysis
- **Research Brief card** (orange border — from orchestrator): Competitive intelligence
- **Scope of Work card**: Bulleted scope items, Re-Analyze Scope + Full Vetting button
- **Decision Actions card**: Re-Run Full Analysis (green), Run Full Research, Score Winnability, Start Proposal →, Open Source Document
- Dynamic output areas: Research output (CAPTURE INTELLIGENCE BRIEF), Winnability output (PWIN + OPI ANALYSIS), Orchestration result (steps completed, Pwin%, recommendation, duration)

### Key observations:
- This is the deepest single-opportunity view in the system
- Pulls from ALL orchestrator fields: scope_analysis, financial_analysis, research_brief, capture_action, staffing_plan
- Actions trigger live Claude calls that write back to Supabase
- Export to .docx available on research and winnability outputs

---

## MODULE 7: RESEARCH & ANALYSIS

### What V1 Has (complete inventory):
- Subtitle: "Select an opportunity — fields auto-populate from system intelligence"
- Opportunity selector (auto-populates all fields when opp selected)
- Status banner when existing research brief found (green — shows it exists, offer to regenerate)
- **Input form card**:
  - Agency / Client (text field)
  - Opportunity Type / Vertical (text field)
  - Known Competitors (text field — auto-populated from hgi_fit if competitors detected)
  - Additional Context (text field — first line of auto-populated context)
  - Generate Research Pack button
- Export .docx button (appears after generation)
- Output: CAPTURE INTELLIGENCE BRIEF (9 sections: Agency Profile, Funding Landscape, Competitive Intel, Relationship Map, HGI Win Strategy, Red Flags, Intel Gaps, 48-Hour Action Plan, Risks & Challenges)
- Writes research_brief back to Supabase on generation

---

## MODULE 8: WINNABILITY SCORING

### What V1 Has (complete inventory):
- Subtitle: "Select an opportunity — auto-loads scope, financial, and research intelligence"
- Opportunity selector (auto-populates all fields)
- Status banner when existing winnability assessment found
- **Two-column layout**:
  - LEFT — Opportunity Details card: Title, Agency, Est. Value, Type, Known Incumbent, Competitors, Teaming Needed, Revenue Timeline dropdown (Immediate/Near-term/Medium/Long-term)
  - RIGHT — Scoring Factors card: 3 sliders (HGI Past Performance Match 1-10, Budget Certainty 1-10, Timeline Feasibility 1-10), Additional Context textarea, Calculate Pwin + OPI button
- Export .docx button after generation
- Output: PWIN + OPI ANALYSIS (format: "PWIN: X% | RECOMMENDATION: GO/CONDITIONAL GO/NO-BID" as first line, then sub-scores, decision justification, win factors, risk factors, top 3 actions to increase Pwin, teaming recommendation)
- Win Simulation panel: Pwin%, OPI Recommended, Top 3 Actions (from separate /api/win-simulation call)
- Writes capture_action back to Supabase

---

## MODULE 9: PROPOSAL ENGINE

### What V1 Has (complete inventory):
- Header with section count badge, View Full Draft button, Compliance Scan button, Save to Tracker button, Clear button, Export .docx button (all conditional on sections existing)
- Subtitle: "Select a pipeline opportunity or paste RFP text manually"
- Opportunity selector (loads existing proposal draft from staffing_plan field if present)
- RFP status banner (green if loaded from workflow, orange warning if not)
- **3 View Tabs**:
  1. **Single Section**: RFP context textarea, Section dropdown (10 sections), Additional Context field, Generate button; Section pills with ✓ indicators (gold=selected, green=drafted); view/edit/regenerate individual sections
  2. **Auto Generate All**: RFP context textarea, context field, section checkboxes (Select All / Clear All), count + time estimate, Generate N Sections Automatically button
  3. **Draft Workspace**: All 10 sections listed, drafted ones show textarea with Regenerate/Improve/Red Team/Remove buttons, undrafted show "Generate →" links; Save to Tracker + Compliance Scan at top
- **Auto progress view** (during auto-gen): sequential status per section (waiting/generating/done/error), progress bar, Stop button
- **Compliance Scan panel**: scans all drafted sections against RFP requirements, shows requirements met, gaps, red flags, punch list
- **10 Proposal Sections**: Executive Summary, Technical Approach, Management Approach, Staffing Plan, Past Performance Matrix, Transition/Mobilization Plan, Pricing Narrative, Compliance Matrix, Clarifying Questions, Red Team Critique
- Writes proposal to staffing_plan field + fires proposal.section_drafted event to cascade

---

## MODULE 10: RECRUITING & BENCH

### What V1 Has (complete inventory):
- Header: "Recruiting & Bench — N bench members tracked · synced to cloud"
- Opportunity selector at top
- **3 Tabs**:
  1. **Bench tab**: Add Person button (opens form: Name, Role, Domain, Clearance/Certs, Location, Availability, Notes), bench member cards (grid layout — name, role, domain, location, availability, notes, Match to Opportunity button, Remove button), match output per person (AI analysis matching person to active pipeline opps), Staffing Gap Analysis section (paste RFP requirements, Analyze Gaps vs Bench button, AI output: required roles, bench coverage, gaps, recruiting profiles, teaming partners, mobilization timeline)
  2. **Auto-Recruit tab**: Role field, context textarea, 3 generation buttons: Generate Job Description / Generate LinkedIn Post / Generate Screening Questions; each generates separately with dedicated AI output
  3. **Outreach tab**: Opportunity name field, Draft All Outreach Emails button, per-person outreach email drafting with collapsed details view
- Synced to Supabase /api/bench (with localStorage fallback)



---

## MODULE 11: RELATIONSHIP INTELLIGENCE (CRM)

### What V1 Has (complete inventory):
- Title: "Relationship Intelligence — N contacts tracked · synced to cloud · sorted by longest overdue"
- + Add Contact button
- Search bar (filters by name or agency)
- Agency filter dropdown (all agencies in system)
- Add/Edit Contact form (opens on button click): Name*, Title, Agency*, Vertical, Email, Phone, Relationship Strength dropdown (Cold/Warm/Hot), Last Contact date, Notes textarea
- Contact cards (vertical list, sorted by oldest last contact first):
  - Left border color coded by relationship strength (green=Hot, gold=Warm, grey=Cold)
  - Name, relationship strength badge, vertical badge, "Needs Contact" warning badge (if >30 days or never)
  - Title · Agency
  - Email, Phone, Last Contact + days since
  - Notes (italic)
  - 4 action buttons: Log Contact (opens prompt for quick note, updates last_contact), AI Brief (generates relationship intelligence), Edit, Remove
  - AI Brief output: What this person cares about, HGI talking points tailored to this contact, approach strategy, opportunities to discuss, relationship building recommendations
- Synced to Supabase /api/contacts (with localStorage fallback)

---

## MODULE 12: CONTENT ENGINE

### What V1 Has (complete inventory):
- Subtitle: "Thought Leadership · Past Performance · Teaming · Disaster Response"
- 4 Tabs:
  1. **Thought Leadership**: Topic field, Audience field, Format dropdown (Article 600-800 words / LinkedIn Post / Capability Statement / White Paper Outline), Generate Content button, AI output
  2. **PPQ Generator**: Agency field, Vertical dropdown, Evaluation Criteria field, RFP Context textarea, Two buttons: Generate PPQ Responses + Match Best Past Performance, AI output
  3. **Teaming Radar**: Opportunity Title, Agency, Vertical dropdown, Set-Aside field, Estimated Value, Scope textarea, Analyze Teaming Strategy button, AI output
  4. **Disaster Protocol**: Disaster Name, State dropdown (LA/TX/FL/MS/AL/GA), Incident Type dropdown (Hurricane/Flood/Tornado/Wildfire/Other), Declaration Date, Estimated Damage, Generate Full Disaster Response Package button — generates 4 outputs: 48-Hour Brief, Procurement Opportunities, Outreach Letter, 90-Day Capture Timeline

---

## MODULE 13: WEEKLY DIGEST

### What V1 Has (complete inventory):
- Subtitle: "AI-generated capture intelligence brief for HGI leadership — pulls live pipeline data"
- Pipeline count banner (green if pipeline has active opps)
- Special Focus Areas field (optional — e.g. "FEMA PA recompetes, Texas TPA")
- Generate This Week Digest button
- Export .docx button (appears after generation)
- AI output: 6 sections — Executive Summary, Hot Opportunities (top 3 to pursue NOW), Recompete Watchlist, Upcoming Deadlines, This Week Capture Priorities, Market Intelligence
- Archived Digests section: list of last 10 generated digests by date, clickable to reload that digest (stored in localStorage)

---

## MODULE 14: EXECUTIVE BRIEF

### What V1 Has (complete inventory):
- Title: "Executive Intelligence Brief"
- Description: "Read-only intelligence dashboard for HGI leadership. Share the link below with Lou and Larry."
- Link button: "Open Executive Brief →" (links to /api/executive-brief?format=html — opens in new tab)
- Direct URL display: https://hgi-capture-system.vercel.app/api/executive-brief?format=html
- NOTE: This is effectively a placeholder — no real component, just a link to a separate API-generated HTML page
- The actual content is generated by /api/executive-brief and includes pipeline status, top opportunities, organism decisions, and system health — but this module itself is minimal

---

## MODULE 15: SCRAPER INSIGHTS (ScraperInsights.js)

### What V1 Has (complete inventory):
- Title: "Scraper Intelligence Dashboard — N runs logged · M total pipeline records"
- Refresh button
- 6 KPI stat boxes: Total Runs Logged, Active Pipeline, Tier 1 (OPI 75+), Tier 2 (OPI 60-74), Pending RFP, Low OPI Filtered
- 5 Tabs:
  1. **Overview**: Pipeline Conversion funnel (Total Ingested → Survived Filter → Tier 1 → Pursuing → Proposal) with bar charts + percentages; Scraper Activity (Central Bidding runs, LaPAC runs, cron runs, new opps found all time); Filtered Records — Worth a Second Look (specific flagged records with organism notes); Coverage Gaps — Sources Not Yet Active (Texas SmartBuy HIGH, SAM.gov MED, Louisiana Housing Corp MED, FL/MS portals LOW)
  2. **OPI Distribution**: Bar chart of pipeline by OPI bucket (90+, 80-89, 75-79, 60-74, 40-59, under 40) with calibration note
  3. **Sources**: Table of each source with total records, active, filtered, avg OPI, hit rate
  4. **Verticals**: Bar chart breakdown of active pipeline by vertical (disaster, tpa, workforce, health, infrastructure, tax_appeals, federal, unknown)
  5. **Run History**: Table of last 30 runs — timestamp, source, found, new, status

---

## MODULE 16: KNOWLEDGE BASE

### What V1 Has (complete inventory):
- Title: "Knowledge Base — N documents indexed"
- Subtitle: "Claude injects relevant doctrine into every analysis automatically"
- Refresh button
- 3 Tabs:
  1. **Upload Documents**: Size warning (50 pages max), drag-and-drop zone (PDF/DOCX/TXT), file queue with status indicators (pending/uploading/done/error), Upload N Files button, Clear Queue button — each queued item shows filename, size, status, extracted classification + vertical on completion
  2. **Search Gmail**: Search query field + Search Gmail button, 6 preset quick searches (HGI proposal attachments, Road Home, FEMA PA, past performance, staff bios, TPCIGA), results showing subject/from/date/snippet/attachments with "Has Attachments" badge
  3. **Document Library (N)**: Vertical filter buttons (all/disaster/tpa/appeals/workforce/health/infrastructure/federal/construction/general), document cards showing: status dot (green=processed, gold=processing, red=error), filename, vertical badge, document class badge, chunk count (color-coded), stored indicator, char count, summary, expandable details showing win themes/past performance/key stats/service lines/narrative summary/key personnel; Reprocess button for zero-chunk docs, Delete button per doc

---

## MODULE 17: SYSTEM CHAT

### What V1 Has (complete inventory):
- Title: "System Chat"
- Subtitle: "Ask questions about the pipeline, opportunities, or HGI capabilities"
- Quick action grid (2x2, shown only when no messages): Pipeline summary, What should I focus on today?, Competitive landscape, System status — each prefills the input with a full question
- Messages area: chat bubbles (user right/gold tint, assistant left/dark), auto-scroll to bottom, "Thinking..." loading state
- Memory toast: fixed notification when organism memory is updated from chat (green, bottom-right)
- Input: textarea (Enter to send, Shift+Enter for newline), Send button
- Connects to /api/chat-send with message + last 10 history + current opportunity ID
- Writes to organism memory on significant insights

---

## V1 SYSTEM ARCHITECTURE NOTES (for V2 reference)

### Data flow:
- Pipeline data lives in Supabase opportunities table
- Organism output in: scope_analysis, financial_analysis, research_brief, staffing_plan, capture_action fields
- Organism memory in organism_memory table (60+ records)
- Competitive intel in competitive_intelligence table
- CRM contacts in /api/contacts endpoint
- Bench in /api/bench endpoint
- KB docs in knowledge_base_documents + knowledge_base_chunks tables

### Module interconnections:
- usePipeline() hook shared across: Research, Winnability, Proposal, Financial, Recruiting, CRM
- sharedCtx object passed from Full Workflow → Research → Proposal (RFP text, decomposition, exec brief)
- Events fired to cascade.js on: proposal.section_drafted, stage changes, outcome recorded
- Notification bell polling /api/notify every 60 seconds
- All modules that produce analysis write back to Supabase via writeBack()

### Missing/stub modules in V1:
- Executive Brief: just a link to /api/executive-brief, no real component
- RelationshipIntelligence.js: doesn't exist as a separate file — it's CRM.js
- Pipeline Scanner: functional but empty (needs "Run First Scan" to populate)

### V1 crash issue documented:
- Expanding Pipeline Tracker cards with full organism output (large Winnability/Research text) causes React to crash
- Root cause: rendering massive markdown text in multiple sub-tabs simultaneously overwhelms the browser
- V2 must paginate / lazy-load heavy content rather than rendering all at once

