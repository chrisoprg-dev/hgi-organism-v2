================================================================
HGI ORGANISM V2 — SESSION 49 HANDOFF
Date: March 27, 2026 | Next Session: Session 50
================================================================

══════════════════════════════════════════════════════════════
MANDATORY SESSION START — READ THIS EVERY SINGLE SESSION
══════════════════════════════════════════════════════════════

STEP 1: call recent_chats (n=5-10). Read every message.
STEP 2: READ EVERY MEMORY RULE WORD FOR WORD. Not skim. READ.
STEP 3: Synthesize current state.
STEP 4: Start gif_creator recording BEFORE touching anything.
         Christopher watches work happen live — not screenshots.
         STEP 5: Only then begin work.

         NO SHORTCUTS. NO PATCHES. FIND ROOT CAUSE FIRST.
         Know it will work before you start. Show proof not assertions.
         Read the file before editing it. Every single time.

         ================================================================
         CURRENT STATE — Session 49 End
         ================================================================

         SERVER: UP — hgi-organism-v2-production.up.railway.app
         HEALTH: 47 agents active
         DASHBOARD: LOADS but stuck on "Loading organism intelligence..."
                    la() data fetch not firing — root cause not yet found
                    INTERFACE: Architectural fix deployed — interface.html now a
                               standalone file, index.js reads it with readFileSync
                                          The d+= string escaping crash class is CLOSED forever

                                          PROBLEM TO SOLVE FIRST IN SESSION 50:
                                          The la() function in interface.html is not firing on load.
                                          interface.html was extracted from a broken commit — it contains
                                          the broken regex (obs.match) from the crashed version.
                                          CORRECT APPROACH: Go back to commit da4af6d6 (last known good
                                          dashboard load), extract that clean interface, rewrite
                                          interface.html properly formatted with readable code.
                                          DO NOT patch the current broken interface.html.
                                          Restore from known good state, then move forward.

                                          ================================================================
                                          WHAT WAS DONE THIS SESSION
                                          ================================================================

                                          ARCHITECTURAL FIX (permanent):
                                          - interface.html created as standalone file in organism/
                                          - index.js now uses fs.readFileSync to serve it
                                          - The entire d+= string array pattern is gone from index.js
                                          - index.js is 19,000 chars lighter
                                          - No more escape sequence crashes. Ever.

                                          NEW RULES ADDED THIS SESSION:
                                          1. gif_creator recording starts BEFORE any work begins
                                          2. All work must be visible on screen as it happens
                                          3. No invisible console work — Christopher watches live
                                          4. Handoff doc written visibly on GitHub at session end

                                          SESSION COMMITS:
                                          - 8af42dd4: P1a pipeline fields + P1c KPI + P1e stages + P1f
                                          - 88104da2: Organism Decisions Panel
                                          - 1362fbf2: P1f regex fix attempt (still had backslash-n issue)
                                          - da4af6d6: String.fromCharCode(10) fix (last good load)
                                          - b8938d3b: Briefing tables + decision cards (BROKE server)
                                          - 9b5274cb: interface.html created
                                          - 7f0683ae: index.js switched to readFileSync

                                          LAST KNOWN GOOD COMMIT WHERE DASHBOARD LOADED DATA:
                                          da4af6d6 — this is the baseline to restore from

                                          ================================================================
                                          CREDENTIALS
                                          ================================================================

                                          V2 URL: hgi-organism-v2-production.up.railway.app
                                          PAT: stored in Claude memory as "hgi-organism-v2-deploy-3" — retrieve from memory, expires Jun 25 2026
                                                                                    Railway project: d1c788de-c13b-4a2c-a76b-3d09f7f82145
                                          Railway service: f504bc76-8a64-49de-a4c0-04e515d7f9e4
                                          Railway env: 7ef1f3c8-197f-43f0-b63a-c78cd44d280a
                                          Supabase: mfvfbeyjpwllndeuhldi (shared V1+V2)
                                          V1 URL: hgi-capture-system.vercel.app (DO NOT TOUCH)

                                          DEPLOY METHOD (only thing that works):
                                          serviceConnect + githubRepoDeploy together via Railway GraphQL
                                          with credentials:include from Railway tab (session cookie auth)

                                          ================================================================
                                          PHASE STATUS
                                          ================================================================

                                          Phase 1: COMPLETE
                                          Phase 2A: ~20% done — display layer partial, clickability ZERO
                                          Phase 2B: NOT STARTED (requires 2A complete)
                                          Phase 3: NOT STARTED
                                          Phase 4: NOT STARTED

                                          13 of 16 modules are stubs showing "Coming in Phase 2"
                                          Dashboard partially shows data when working
                                          Nothing is clickable — no detail drawers, no approve buttons

                                          ================================================================
                                          END SESSION 49
                                          ================================================================
