# HGI ORGANISM V2 — COMPLETE INTERFACE BUILD SPECIFICATION
**Living document. Updated after each module review. This is the authoritative build spec.**
Last updated: Session 44, March 26, 2026

---

## FOUNDATIONAL PRINCIPLES (NON-NEGOTIABLE)

1. **Preserve everything from V1.** Every module, every tab, every field, every function behind every button. Nothing deleted. Everything improved.
2. **New visual design.** Not V1 reskinned. World-class, stunning, HGI gold and navy. Real SVGs, real data visualizations, real graphics. Looks like a $100M enterprise platform.
3. **Served from Railway.** Same server as the organism brain. No Vercel. No separate hosting. One URL: hgi-organism-v2-production.up.railway.app
4. **Every data point is interactive.** Not just numbers — every label, status, field, score, name, date, percentage, badge. Hover or click anything and the organism has something to say, suggest, or explain about it.
5. **Conversational interaction everywhere.** Built into every view. Not a separate chat tab. Ask "why is this scored 72" from the pipeline view, it answers there.
6. **Organism output drives every view.** Modules display what the organism produced, not raw database fields.
7. **Christopher only.** No team access until he approves.
8. **Multi-user permissions designed after core works for Christopher.** Lou (read-only exec view), Dillon (proposal editing), Candy (signature authority).

---

## MODULE INVENTORY (18 total — all carry forward)

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
- TODAY'S PRIORITY briefing strip (organism's top recommendation — currently rendering raw JSON with backticks, BROKEN)
- Pipeline counters: Active, Tier 1, Pursuing, In Proposal, Submitted, Stale, New Today
- ORGANISM STATUS section: agent health bar (colored dots, 13 Live / 5 Partial / 2 Planned), last think timestamp, Think Now button
- PENDING DECISIONS preview (shows 4 of 20 decisions in compact list)
- THIS WEEK section (opportunities needing action this week — filter logic too narrow, misses April deadlines)
- ORGANISM DECISIONS full list (20 cards) — each card has:
  - Decision title
  - Priority badge: CRITICAL / HIGH / MEDIUM
  - Action type badge: SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST
  - Full paragraph with specific instructions (names, phone numbers, dates, exact steps)
  - Expand/collapse arrow
- SCRAPER STATUS panel: each source with status (LIVE/DELAYED/UNKNOWN/SETUP), last run time, run count
- QUICK START shortcuts: New RFP landed, Check pipeline, Draft proposal, Weekly digest
- WIN PATH: stage labels (Discover → Score → Research → Workflow → Proposal → Red Team → Export → Submit → WIN)
- KEY PAST PERFORMANCE listing in sidebar footer

### What Works — Keep:
- Organism Decisions cards are excellent. Specific, actionable, named contacts, exact dates, three-type badge system (SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST). This is the core of what makes V2 different from V1.
- Pipeline counters — real and accurate
- Scraper Status concept — right information, needs fixing
- Win Path concept — right idea, needs live opportunity markers
- Three-tier priority system (CRITICAL/HIGH/MEDIUM)

### What's Broken — Fix:
- TODAY'S PRIORITY renders raw JSON with backticks. Must parse and render as clean natural language prose. This is the first thing seen at login — cannot look broken.
- Organism Status dot bar has no tooltips or labels. No way to know which dot = which agent. Every dot must be identified on hover.
- "Last think: 08:01 AM" — 5-hour gap visible when organism is supposed to always be thinking. Show gap time and make it meaningful.
- THIS WEEK filter too narrow — shows only 1 opportunity. Should show "next 30 days with pending action" not just current calendar week.
- PENDING DECISIONS preview (4 items) is redundant with full ORGANISM DECISIONS list (20 items) below it. Seeing same data twice, twice the scroll.
- Central Bidding DELAYED, Alabama/Georgia SETUP (never run) — needs more than a status label. Needs one-click fix action.
- Quick Start shortcuts are static/generic. Should be dynamic and context-aware based on what's actually pending.
- Win Path shows no live opportunity markers — just stage labels. No data on it.

### V2 Improvements — Add:
1. TODAY'S PRIORITY renders as clean prose briefing: what changed overnight, what needs you today, what organism is working on. 3-4 sentences max. No JSON.
2. APPROVE button on every SYSTEM CAN EXECUTE card — one click triggers execution. MARK DONE + SNOOZE on YOUR ACTION cards. APPROVE BUILD + DEFER on BUILD REQUEST cards. The approval loop must close in the Dashboard.
3. Revenue at stake: "HGI has $X active pipeline. These N pursuits = X% of annual target." Prominent, always visible.
4. Decision history: what was approved yesterday, what organism executed, what the outcome was.
5. Conversational input embedded in Dashboard — natural language field: "Ask the organism anything or give it a direction." Not a link to System Chat — right there on Dashboard.
6. Win Path becomes live visual with each active opportunity plotted as a marker at its current stage.
7. Organism agent health dots each identified and clickable — shows that agent's last output and current status.

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
- Dashboard is the organism's control center. Every module feeds decisions into it. Approvals on the Dashboard trigger execution in the corresponding module. The feedback loop: module produces data → dashboard surfaces decision → Christopher approves → organism executes → result returns to dashboard. This loop is missing in V1. V2 must complete it.

---

## MODULES 2-18: TO BE DOCUMENTED DURING REVIEW SESSION

