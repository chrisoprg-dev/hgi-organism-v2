# HGI ORGANISM V2 Ã¢ÂÂ COMPLETE INTERFACE BUILD SPECIFICATION
**Living document. Updated after each module review. This is the authoritative build spec.**
Last updated: Session 44, March 26, 2026

---

## FOUNDATIONAL PRINCIPLES (NON-NEGOTIABLE)

1. **Preserve everything from V1.** Every module, every tab, every field, every function behind every button. Nothing deleted. Everything improved.
2. **New visual design.** Not V1 reskinned. World-class, stunning, HGI gold and navy. Real SVGs, real data visualizations, real graphics. Looks like a $100M enterprise platform.
3. **Served from Railway.** Same server as the organism brain. No Vercel. No separate hosting. One URL: hgi-organism-v2-production.up.railway.app
4. **Every data point is interactive.** Not just numbers Ã¢ÂÂ every label, status, field, score, name, date, percentage, badge. Hover or click anything and the organism has something to say, suggest, or explain about it.
5. **Conversational interaction everywhere.** Built into every view. Not a separate chat tab. Ask "why is this scored 72" from the pipeline view, it answers there.
6. **Organism output drives every view.** Modules display what the organism produced, not raw database fields.
7. **Christopher only.** No team access until he approves.
8. **Multi-user permissions designed after core works for Christopher.** Lou (read-only exec view), Dillon (proposal editing), Candy (signature authority).

---

## MODULE INVENTORY (18 total Ã¢ÂÂ all carry forward)

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
- TODAY'S PRIORITY briefing strip (organism's top recommendation Ã¢ÂÂ currently rendering raw JSON with backticks, BROKEN)
- Pipeline counters: Active, Tier 1, Pursuing, In Proposal, Submitted, Stale, New Today
- ORGANISM STATUS section: agent health bar (colored dots, 13 Live / 5 Partial / 2 Planned), last think timestamp, Think Now button
- PENDING DECISIONS preview (shows 4 of 20 decisions in compact list)
- THIS WEEK section (opportunities needing action this week Ã¢ÂÂ filter logic too narrow, misses April deadlines)
- ORGANISM DECISIONS full list (20 cards) Ã¢ÂÂ each card has:
  - Decision title
  - Priority badge: CRITICAL / HIGH / MEDIUM
  - Action type badge: SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST
  - Full paragraph with specific instructions (names, phone numbers, dates, exact steps)
  - Expand/collapse arrow
- SCRAPER STATUS panel: each source with status (LIVE/DELAYED/UNKNOWN/SETUP), last run time, run count
- QUICK START shortcuts: New RFP landed, Check pipeline, Draft proposal, Weekly digest
- WIN PATH: stage labels (Discover Ã¢ÂÂ Score Ã¢ÂÂ Research Ã¢ÂÂ Workflow Ã¢ÂÂ Proposal Ã¢ÂÂ Red Team Ã¢ÂÂ Export Ã¢ÂÂ Submit Ã¢ÂÂ WIN)
- KEY PAST PERFORMANCE listing in sidebar footer

### What Works Ã¢ÂÂ Keep:
- Organism Decisions cards are excellent. Specific, actionable, named contacts, exact dates, three-type badge system (SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST). This is the core of what makes V2 different from V1.
- Pipeline counters Ã¢ÂÂ real and accurate
- Scraper Status concept Ã¢ÂÂ right information, needs fixing
- Win Path concept Ã¢ÂÂ right idea, needs live opportunity markers
- Three-tier priority system (CRITICAL/HIGH/MEDIUM)

### What's Broken Ã¢ÂÂ Fix:
- TODAY'S PRIORITY renders raw JSON with backticks. Must parse and render as clean natural language prose. This is the first thing seen at login Ã¢ÂÂ cannot look broken.
- Organism Status dot bar has no tooltips or labels. No way to know which dot = which agent. Every dot must be identified on hover.
- "Last think: 08:01 AM" Ã¢ÂÂ 5-hour gap visible when organism is supposed to always be thinking. Show gap time and make it meaningful.
- THIS WEEK filter too narrow Ã¢ÂÂ shows only 1 opportunity. Should show "next 30 days with pending action" not just current calendar week.
- PENDING DECISIONS preview (4 items) is redundant with full ORGANISM DECISIONS list (20 items) below it. Seeing same data twice, twice the scroll.
- Central Bidding DELAYED, Alabama/Georgia SETUP (never run) Ã¢ÂÂ needs more than a status label. Needs one-click fix action.
- Quick Start shortcuts are static/generic. Should be dynamic and context-aware based on what's actually pending.
- Win Path shows no live opportunity markers Ã¢ÂÂ just stage labels. No data on it.

### V2 Improvements Ã¢ÂÂ Add:
1. TODAY'S PRIORITY renders as clean prose briefing: what changed overnight, what needs you today, what organism is working on. 3-4 sentences max. No JSON.
2. APPROVE button on every SYSTEM CAN EXECUTE card Ã¢ÂÂ one click triggers execution. MARK DONE + SNOOZE on YOUR ACTION cards. APPROVE BUILD + DEFER on BUILD REQUEST cards. The approval loop must close in the Dashboard.
3. Revenue at stake: "HGI has $X active pipeline. These N pursuits = X% of annual target." Prominent, always visible.
4. Decision history: what was approved yesterday, what organism executed, what the outcome was.
5. Conversational input embedded in Dashboard Ã¢ÂÂ natural language field: "Ask the organism anything or give it a direction." Not a link to System Chat Ã¢ÂÂ right there on Dashboard.
6. Win Path becomes live visual with each active opportunity plotted as a marker at its current stage.
7. Organism agent health dots each identified and clickable Ã¢ÂÂ shows that agent's last output and current status.

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
- Dashboard is the organism's control center. Every module feeds decisions into it. Approvals on the Dashboard trigger execution in the corresponding module. The feedback loop: module produces data Ã¢ÂÂ dashboard surfaces decision Ã¢ÂÂ Christopher approves Ã¢ÂÂ organism executes Ã¢ÂÂ result returns to dashboard. This loop is missing in V1. V2 must complete it.

---

## MODULES 2-18: TO BE DOCUMENTED DURING REVIEW SESSION



---

## MODULE 2: FULL WORKFLOW

### What V1 Has (complete inventory):
- Subtitle: "RFP Decomposition â Executive Brief + OPI â Proposal Package"
- Opportunity selector at top: shows all 5 active pipeline opportunities with OPI scores and agency â click to load existing opp
- New opportunity entry form (below selector):
  - OPPORTUNITY TITLE (text field)
  - AGENCY (text field)
  - KNOWN INCUMBENT (text field)
  - RFP URL (optional) (text field)
  - RELATIONSHIP INTEL / CONTEXT (large textarea â known relationships, budget intel, political context)
  - RFP / SOLICITATION TEXT section:
    - Upload PDF / Word / TXT button
    - Large paste area: "Paste RFP text here, or upload a file above..."
  - Step 1: Analyze RFP button (gold, prominent)
- Steps 2+ appear after Step 1 runs (not visible until triggered â need to run to document)

### Notes:
- This is the primary intake workflow for new opportunities
- Connects to the full orchestration pipeline: RFP â scope analysis â OPI â executive brief â proposal package
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

**Tab 1 â Hunt Engine:**
- Section header: "HUNT ENGINE â Scans all HGI verticals simultaneously"
- ACTIVE VERTICALS toggles: Disaster Recovery/CDBG-DR, TPA/Claims/Insurance, Workforce & Social Services, Health & Human Services, Infrastructure & Capital, Property Tax Appeals, Federal Agencies (each toggleable on/off)
- PRIORITY STATES toggles: LA, TX, FL, MS, AL, GA, Federal
- Run Full Hunt Now button (gold)
- Refresh from Database button
- Explanation text: auto-runs 7am daily
- TOP OPPORTUNITIES section below â shows all results with IMMEDIATE/ACTIVE badge, TIER_1 badge, vertical tag, OPI score, organism analysis paragraph, â Workflow button, ? button, + Track button

**Tab 2 â Results (5):**
- Filters: Vertical dropdown (All/each vertical), State dropdown, Sort By (OPI/Urgency/Contract Value/Immediate Only)
- "5 of 5 shown"
- Full opportunity cards with: status badge, tier badge, vertical tag, title, agency, state, estimated value, due date, organism analysis paragraph, OPI score, Details expand, Workflow button, Track button, Source button

**Tab 3 â Retrieve Docs:**
- Header: "DOCUMENT RETRIEVAL ENGINE â Paste any RFP URL"
- URL paste field + Retrieve button
- Works with: SAM.gov, LaPAC, Texas SmartBuy, Florida Vendor Directory, agency websites, direct PDF links, any public procurement URL
- FETCH FROM HUNT RESULTS section: lists all 5 hunted opps with their source URLs and individual Retrieve buttons

**Tab 4 â Signals:**
- DISASTER SIGNALS section: "Recent declarations and events that will trigger FEMA PA/CDBG-DR RFP waves" â shows "Run Hunt to generate signals" (empty)
- FUNDING SIGNALS section: "HUD, FEMA, Treasury, USDA allocations that haven't produced RFPs yet â early warning" â shows "Run Hunt to generate signals" (empty)

**Tab 5 â Sources & Config:**
- MONITORED SOURCES table: SAM.gov (Active), State Procurement Portals (Active), Insurance Associations (Active), Municipal & Parish (Active), Federal Grant Signals (Active), Disaster & Funding Signals (Active)
- STATE AGENCY WATCH LIST: full list for LA, TX, FL, MS, AL, GA â specific agencies named per state (GOHSEP, OCD-DRU, LHC, MEMA, Texas GLO, Florida DEO, FDEM, etc.)
- HUNT FREQUENCY explanation
- Pro tip text



---

## MODULE 4: PIPELINE SCANNER

### What V1 Has (complete inventory):
- Title: "Live Pipeline Scanner" — subtitle: "SAM.gov · LaPAC · Texas SmartBuy · Gulf Coast portals"
- Run Live Scan button (top right)
- 2 Tabs:
  - **Pipeline tab**: Empty state — shows "Run First Scan" button with spinner icon. No results loaded.
  - **Recompetes tab**: Not yet clicked/documented
- MANUAL PORTALS section: link buttons — SAM.gov, LaPAC, Texas SmartBuy, FEMA Procurement, HUD CDBG-DR
- Note: This module appears largely non-functional/empty in current V1 state

---

## MODULE 5: PIPELINE TRACKER

### What V1 Has (complete inventory):
- Title: "Pipeline Tracker — 5 opportunities tracked"
- Buttons: "Clean Test Data" (top right), "+ Add Opportunity" (gold, top right)
- Filter tabs: All (5) | Identified (2) | Pursuing (1) | Submitted (1)
- Note: Missing "In Proposal" and "Won/Lost" filter tabs

**5 Opportunity Cards — each shows:**
- Title (truncated)
- Agency · vertical tag (disaster/federal)
- Stage progress bar: Discovered › Scored › Workflow Done › Drafting › Submitted › WON (completed stages shown with ✓, current stage with ▶)
- Due date (if set)
- OPI Score — Tier badge (gold)
- Stage badge (IDENTIFIED / PURSUING / SUBMITTED)
- Expand arrow (▼/▲)

**Expanded card reveals (OPPORTUNITY DETAILS):**
- Agency, Type, OPI Score, Added date, Source (View Original RFP ↗ link)
- STAGE — MOVE TO STAGE dropdown: Identified / Qualifying / Pursuing / Proposal / Submitted / Won / Lost
- Organism analysis paragraph (full text from organism)
- ORGANISM INTELLIGENCE sub-tabs:
  - **Winnability** — full competitive scoring matrix, head-to-head vs named competitors, criterion-by-criterion breakdown with narrative, weakness analysis ranked by point loss, capture strategy
  - **Competitive Intel** — (tab visible, content not yet read)
  - **Financial** — (tab visible, content not yet read)
  - **Proposal Draft** — (tab visible, content not yet read)
  - **Scope Analysis** — (tab visible, content not yet read)
- "Get Capture Strategy" button
- "Edit" button
- "Delete" button

### Critical observation:
The expanded pipeline card is actually a deep intelligence hub — 5 sub-tabs of organism output. This is the richest data view in the whole system and it's hidden behind a small ▼ arrow on a list card. Most users would never know this depth exists.

