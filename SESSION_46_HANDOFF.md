# SESSION 46 HANDOFF — HGI ORGANISM V2
## March 27, 2026 | Start next session with both connectors enabled

---

## WHAT SESSION 46 ACCOMPLISHED

1. Read all repo docs word for word before touching anything: V2_INTERFACE_SPEC.md, SESSION_45_HANDOFF.md, V2_ANALYSIS_COMPLETE.md

2. Committed V2_ANALYSIS_COMPLETE.md to repo — now persists between sessions

3. Created new GitHub PAT: hgi-organism-v2-deploy-2 (expires Jun 25 2026, Contents R/W on hgi-organism-v2 repo)

4. Rewrote all 47 agent identities with proposal-centric framing — committed to organism/index.js (d291735)
   - Every agent now explicitly states what their output feeds into in the proposal
   - All agent counts updated from "of 37" to "of 47"
   - Hunting Agent given full identity (previously had NO_IDENTITY_FOUND)

5. Hunting Agent identity: Central Bidding is PRIMARY source (only portal that has produced real HGI opportunities). Also hits LaPAC, SAM.gov, Grants.gov. Autonomously discovers new sources. Runs first in every session and every 6 hours independently. Without it there is nothing for the other 46 agents to work on and no proposals to write.

---

## SESSION 47 TASK ORDER

### FIRST: Confirm Railway deployed the new agent prompts
Navigate to hgi-organism-v2-production.up.railway.app/health — should still show V2.9.0-fortyseven-agents
Trigger a /run-session POST and watch organism_memory for proposal-centric output language

### SECOND: Begin V2 interface build — Phase 1
Per V2_ANALYSIS_COMPLETE.md Phase 1 sequence:
1. Railway server serves HTML at root URL (currently just returns JSON)
2. Morning briefing — organism speaks as senior capture director, clean prose
3. Decision cards with approval buttons (SYSTEM CAN EXECUTE / YOUR ACTION / BUILD REQUEST)
4. Pipeline overview with probability-weighted revenue
5. Persistent conversational input bar
6. Sidebar navigation to all 18 modules (skeleton)
7. Opportunity Intelligence View — click any opportunity, see everything

### STANDING RULES (non-negotiable)
- Search past chats BEFORE questioning any confirmed system state
- read_file before modify_system — always
- NEVER edit api/mcp.js through MCP
- No parallel sessions
- End every session committing handoff to repo
- Dollar signs in modify_system: String.fromCharCode(36)
- V2 repo access: Chrome + GitHub API (PAT above). read_file only reads V1.
- Never state something works without showing actual proof

---

## SYSTEM STATE

### V1 (DO NOT TOUCH)
- URL: hgi-capture-system.vercel.app
- MCP: 20 tools, all working
- GitHub: github.com/chrisoprg-dev/hgi-capture-system

### V2
- URL: hgi-organism-v2-production.up.railway.app
- GitHub: github.com/chrisoprg-dev/hgi-organism-v2
- Latest commit: d291735 — Session 46 agent rewrites
- /health: V2.9.0-fortyseven-agents, agents_active:47
- Same Supabase as V1 (mfvfbeyjpwllndeuhldi)
- GitHub PAT: hgi-organism-v2-deploy-2 (get value from Christopher)

### Pipeline (6 active)
- HTHA: submitted, awaiting award. Call 985-868-6504.
- St. George (RFP 31266541): OPI 85, watching — pulled 3/25, will repost. Due ~April 24.
- Jefferson Parish SOQ 26-005: OPI 72, due April 9 at 3:30PM CST. NOT STARTED. 13 days out.
- DR-4900 Louisiana: OPI 92, identified, no RFP yet.
- DR-4899 Mississippi: OPI 82, identified, no RFP yet.
- NOLA Grant Services: OPI 88, unsolicited pursuit.

---

END SESSION 46 — SESSION 47 BEGINS HERE
