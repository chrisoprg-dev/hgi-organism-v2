// ============================================================
// S172 — ANTI-FABRICATION LAYER: QUOTE-ANCHORED CITATION GATE
// ------------------------------------------------------------
// CLAUDE.md prime directive: NO UNCITED CLAIMS. Any agent output that states
// a fact about an opportunity MUST cite the source (opportunity id + field,
// memory row id, or file) the claim came from.
//
// WHY THIS EXISTS (the failure this fixes):
// The organism already DETECTS fabrication and then saves it anyway.
//   index.js ~17756  Haiku fact-checker returns verdict CONTAMINATED
//   index.js ~17759  code prepends a "⚠️ FACT-CHECK" banner to the text
//   index.js ~17773  .update({ scope_analysis: ... }) runs unconditionally
// Same shape in the L6/S132 citation verifier: it rewrites sentences and
// counts flags, but no caller ever reads flagged_count to gate the write.
// Session 106 OPSB bug (documented at index.js:17723): scope analyst invented
// "post-Katrina FEMA PA + CDBG-DR program" for an RFP with zero CDBG mentions.
// Measured 2026-07-26 against production: 16 of 48 opportunities carrying a
// scope_analysis had it written while rfp_document_retrieved = false, and
// 9,289 of 10,008 organism_memory rows (92.8%) carry no source_url at all.
//
// THE MECHANISM — quote-anchored citations verified by substring match.
// Every citation must carry a VERBATIM quote from the source it names. We then
// check that the quote actually occurs in that source. This is deliberately
// NOT another model call:
//   - deterministic: same input always yields the same verdict
//   - free: zero tokens, so it cannot trip the S142/session cost breakers
//   - unfakeable: a model that invents a claim must also invent a quote, and
//     an invented quote fails indexOf(). It cannot be argued out of a rejection
//     the way a Haiku fact-check opinion can.
//
// DESIGN CONSTRAINTS HONORED:
//   - Pure module. No supabase handle, no anthropic import, no network, no I/O.
//     Everything here is testable with `node organism/citations.test.mjs` and
//     no API key. Callers in index.js own all persistence.
//   - No exceptions for policy decisions. Returns the house {ok,error} /
//     {allow,reason} shape used by validateStage (index.js:120) and
//     refetchRFPCorpus (index.js:17197).
//   - Does not weaken S170, the cost breakers, the S119 fact-check 409 gate,
//     or the S166 H9 RFP-validity gate. This runs in addition to them.
// ============================================================

// Source kinds. Extends the evidence_anchor_type precedent at index.js:10455
// (['hgi_pp','competitive_intel','fact_check','org_memory','naics','rate_card']).
export var CITATION_SRC_KINDS = ['opp_field', 'memory', 'kb', 'listing', 'file'];

// Opportunity columns an agent may legitimately cite as evidence. Deliberately
// excludes the analysis columns an agent WRITES (scope_analysis, financial_analysis,
// staffing_plan, capture_*). Citing those would let one fabrication launder itself
// into evidence for the next — which is exactly how the OPI rescore at index.js:18000
// inherits a bad scope. opi_rationale is absent because no such column exists.
export var CITABLE_OPP_FIELDS = [
  'rfp_text', 'title', 'agency', 'description', 'documents',
  'solicitation_number', 'naics', 'due_date', 'estimated_value', 'source_url', 'rfp_requirements'
];

export var GATE_CODES = {
  OK: 'ok',
  GATE_OFF: 'gate_off',
  BYPASS: 'force_bypass',
  NO_CITATIONS: 'no_citations',
  PARSE_ERROR: 'parse_error',
  BAD_SHAPE: 'bad_shape',
  QUOTE_TOO_SHORT: 'quote_too_short',
  QUOTE_NOT_FOUND: 'quote_not_found',
  UNKNOWN_SOURCE: 'unknown_source',
  UNVERIFIED_NO_SOURCE: 'unverified_no_source',
  RFP_NOT_RETRIEVED: 'rfp_not_retrieved',
  FACT_CHECK_CONTAMINATED: 'fact_check_contaminated'
};

export var CITATION_BLOCK_OPEN = '<!--HGI-CITATIONS v1';
export var CITATION_BLOCK_CLOSE = '-->';

// A quote shorter than this proves nothing — "the" or "services" occurs in every
// RFP. 24 chars (post-normalization) is long enough that a matching span is
// meaningful evidence rather than coincidence.
export var MIN_QUOTE_CHARS = 24;

// Targets that hard-reject under CITATION_ENFORCE=priority. These are the paths
// where fabrication has actually caused damage: scope_analysis is the CDBG
// incident itself, and opi_score is downstream of it via the STEP 4 rescore.
export var PRIORITY_TARGETS = [
  'scope_analysis', 'opi_score', 'financial_analysis', 'staffing_plan'
];

// ------------------------------------------------------------
// Prompt contract. Injected into agent system prompts so agents EMIT the block.
// Enforcement without emission just blocks every write, so these ship together.
// ------------------------------------------------------------
export var CITATION_PROMPT_CONTRACT =
  'SOURCE CITATION CONTRACT (S172 — MANDATORY, YOUR OUTPUT IS REJECTED WITHOUT IT):\n' +
  'After your analysis, append a citation block in exactly this format:\n' +
  '<!--HGI-CITATIONS v1\n' +
  '[{"src":"opp_field","opp":"<opportunity id>","field":"rfp_text","quote":"<verbatim span copied from the RFP text>"}]\n' +
  '-->\n' +
  'RULES:\n' +
  '- Every substantive factual claim you make about this opportunity must be backed by at least one citation.\n' +
  '- "quote" must be copied CHARACTER-FOR-CHARACTER from the source. It is checked by exact substring match. Do not paraphrase, summarize, correct typos, or reflow it.\n' +
  '- Each quote must be at least ' + MIN_QUOTE_CHARS + ' characters.\n' +
  '- Valid "field" values: ' + CITABLE_OPP_FIELDS.join(', ') + '.\n' +
  '- If the RFP text does not support a claim, DO NOT MAKE THE CLAIM. Omitting an unsupported claim is always correct. Inventing a quote to justify one is the worst possible outcome.\n' +
  '- If you cannot ground your analysis in the source at all, return only the citation block with an empty array and state plainly that the source is insufficient.\n';

// ------------------------------------------------------------
// Text normalization for quote matching.
// Tolerates the cosmetic drift a model introduces when copying a span, without
// tolerating semantic change. Curly quotes matter here: scraped Central Bidding
// RFP text is full of U+201C/U+201D, and models routinely emit straight quotes.
// ------------------------------------------------------------
export function normalizeForMatch(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Returns {found:bool, offset:number} — offset is into the NORMALIZED haystack.
export function quoteAppearsIn(quote, haystack) {
  var nq = normalizeForMatch(quote);
  var nh = normalizeForMatch(haystack);
  if (!nq || !nh) return { found: false, offset: -1 };
  var idx = nh.indexOf(nq);
  return { found: idx >= 0, offset: idx };
}

// ------------------------------------------------------------
// parseCitationBlock — pull the trailing block out of an agent payload.
// Returns { citations, cleanText, hadBlock, parseError }.
// cleanText is the payload with the block removed, so opportunities.* prose
// columns stay clean for the ~30 downstream readers of scope_analysis.
// ------------------------------------------------------------
export function parseCitationBlock(text) {
  var out = { citations: [], cleanText: (text === null || text === undefined) ? '' : String(text), hadBlock: false, parseError: null };
  if (!out.cleanText) return out;

  var open = out.cleanText.lastIndexOf(CITATION_BLOCK_OPEN);
  if (open < 0) return out;

  var close = out.cleanText.indexOf(CITATION_BLOCK_CLOSE, open + CITATION_BLOCK_OPEN.length);
  if (close < 0) {
    // Opening marker with no terminator — almost always a max_tokens truncation.
    // Treat as an error, never as "no citations": a truncated block means we do
    // not know what the agent intended to claim.
    out.hadBlock = true;
    out.parseError = 'unterminated citation block (likely truncated output)';
    return out;
  }

  var inner = out.cleanText.slice(open + CITATION_BLOCK_OPEN.length, close).trim();
  out.hadBlock = true;
  out.cleanText = (out.cleanText.slice(0, open) + out.cleanText.slice(close + CITATION_BLOCK_CLOSE.length)).trim();

  // Same strip-and-slice idiom used ~101 times in index.js (canonical version
  // in verifyOneCitationStructured, index.js:12967).
  var cleaned = inner.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  var fb = cleaned.indexOf('[');
  var lb = cleaned.lastIndexOf(']');
  if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);

  var parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (pe) {
    out.parseError = 'citation block is not valid JSON: ' + (pe.message || '').slice(0, 120);
    return out;
  }
  if (!Array.isArray(parsed)) {
    out.parseError = 'citation block must be a JSON array';
    return out;
  }
  out.citations = parsed;
  return out;
}

export function buildCitationBlock(citations) {
  return CITATION_BLOCK_OPEN + '\n' + JSON.stringify(citations || [], null, 0) + '\n' + CITATION_BLOCK_CLOSE;
}

// ------------------------------------------------------------
// validateCitationShape — enum / required-field check. No source access.
// ------------------------------------------------------------
export function validateCitationShape(citations) {
  var errors = [];
  if (!Array.isArray(citations)) return { ok: false, errors: ['citations must be an array'] };

  for (var i = 0; i < citations.length; i++) {
    var c = citations[i];
    var tag = 'citation[' + i + ']';
    if (!c || typeof c !== 'object') { errors.push(tag + ': not an object'); continue; }
    if (CITATION_SRC_KINDS.indexOf(c.src) < 0) {
      errors.push(tag + ': src must be one of ' + CITATION_SRC_KINDS.join('|') + ' (got ' + JSON.stringify(c.src) + ')');
      continue;
    }
    if (c.src === 'opp_field') {
      if (!c.opp || typeof c.opp !== 'string') errors.push(tag + ': opp_field requires "opp" (opportunity id)');
      if (CITABLE_OPP_FIELDS.indexOf(c.field) < 0) {
        errors.push(tag + ': field must be one of ' + CITABLE_OPP_FIELDS.join('|') + ' (got ' + JSON.stringify(c.field) + ')');
      }
      if (!c.quote || typeof c.quote !== 'string') errors.push(tag + ': opp_field requires a verbatim "quote"');
    } else if (c.src === 'listing') {
      if (!c.quote || typeof c.quote !== 'string') errors.push(tag + ': listing requires a verbatim "quote"');
    } else if (c.src === 'memory' || c.src === 'kb') {
      if (!c.id || typeof c.id !== 'string') errors.push(tag + ': ' + c.src + ' requires "id"');
    } else if (c.src === 'file') {
      if (!c.path || typeof c.path !== 'string') errors.push(tag + ': file requires "path"');
    }
  }
  return { ok: errors.length === 0, errors: errors };
}

// ------------------------------------------------------------
// verifyQuoteAnchors — the actual anti-fabrication check.
//
// sources shape (all optional; whatever the caller has in hand):
//   {
//     oppId:   '<id>',
//     fields:  { rfp_text: '...', title: '...', ... },
//     listing: '<title + agency + description stub>',
//     memoryIds: ['...'],
//     kbIds:     ['...'],
//     filePaths: ['...']
//   }
// ------------------------------------------------------------
export function verifyQuoteAnchors(citations, sources) {
  var src = sources || {};
  var fields = src.fields || {};
  var results = [];

  for (var i = 0; i < (citations || []).length; i++) {
    var c = citations[i];
    var r = { index: i, src: c && c.src, ok: false, code: null, detail: null, offset: -1 };

    if (!c || typeof c !== 'object') {
      r.code = GATE_CODES.BAD_SHAPE; r.detail = 'not an object'; results.push(r); continue;
    }

    if (c.src === 'opp_field' || c.src === 'listing') {
      var haystack;
      if (c.src === 'listing') {
        haystack = src.listing || '';
      } else {
        // Guard against a citation naming a different opportunity than the one
        // being written. Cross-opportunity evidence is how recruiting_bench
        // produced conflicting solicitations (CLAUDE.md, line 9).
        if (src.oppId && c.opp && c.opp !== src.oppId) {
          r.code = GATE_CODES.UNKNOWN_SOURCE;
          r.detail = 'cites opportunity ' + String(c.opp).slice(0, 60) + ' but write targets ' + String(src.oppId).slice(0, 60);
          results.push(r); continue;
        }
        // Callers that hold no source text (e.g. storeMemory, which receives only
        // prose) cannot have their quotes anchored. Rather than fail them — which
        // would punish agents for citing correctly — or silently pass them as
        // "verified", mark them UNVERIFIED and surface that in stats. Presence and
        // shape are still enforced. Do not confuse this with verification.
        if (!src.fields) {
          r.ok = true; r.code = GATE_CODES.UNVERIFIED_NO_SOURCE; r.unverified = true;
          r.detail = 'no source text supplied to the gate — shape checked, quote NOT anchored';
          results.push(r); continue;
        }
        haystack = fields[c.field];
        if (haystack === undefined || haystack === null) {
          r.code = GATE_CODES.UNKNOWN_SOURCE;
          r.detail = 'source field "' + String(c.field).slice(0, 40) + '" was not supplied to the gate';
          results.push(r); continue;
        }
      }

      var nq = normalizeForMatch(c.quote);
      if (nq.length < MIN_QUOTE_CHARS) {
        r.code = GATE_CODES.QUOTE_TOO_SHORT;
        r.detail = 'quote is ' + nq.length + ' normalized chars, minimum is ' + MIN_QUOTE_CHARS;
        results.push(r); continue;
      }

      var hit = quoteAppearsIn(c.quote, haystack);
      if (!hit.found) {
        r.code = GATE_CODES.QUOTE_NOT_FOUND;
        r.detail = 'quote does not occur in ' + (c.src === 'listing' ? 'listing stub' : String(c.field)) +
                   ': "' + String(c.quote).slice(0, 80) + '"';
        results.push(r); continue;
      }
      r.ok = true; r.code = GATE_CODES.OK; r.offset = hit.offset;
      results.push(r); continue;
    }

    if (c.src === 'memory' || c.src === 'kb' || c.src === 'file') {
      var known = c.src === 'memory' ? (src.memoryIds || [])
                : c.src === 'kb'     ? (src.kbIds || [])
                                     : (src.filePaths || []);
      var needle = c.src === 'file' ? c.path : c.id;
      // Existence is only enforced when the caller supplied a universe to check
      // against. Absent that, shape validation is all we can honestly assert —
      // this module does no I/O, so it must not pretend to have verified one.
      if (known.length > 0 && known.indexOf(needle) < 0) {
        r.code = GATE_CODES.UNKNOWN_SOURCE;
        r.detail = c.src + ' "' + String(needle).slice(0, 60) + '" not found among supplied ids';
        results.push(r); continue;
      }
      if (c.quote) {
        var mq = normalizeForMatch(c.quote);
        if (mq.length < MIN_QUOTE_CHARS) {
          r.code = GATE_CODES.QUOTE_TOO_SHORT;
          r.detail = 'quote is ' + mq.length + ' normalized chars, minimum is ' + MIN_QUOTE_CHARS;
          results.push(r); continue;
        }
        var body = (src.memoryBodies || {})[needle];
        if (body !== undefined && body !== null) {
          var mhit = quoteAppearsIn(c.quote, body);
          if (!mhit.found) {
            r.code = GATE_CODES.QUOTE_NOT_FOUND;
            r.detail = 'quote does not occur in ' + c.src + ' ' + String(needle).slice(0, 40);
            results.push(r); continue;
          }
          r.offset = mhit.offset;
        }
      }
      r.ok = true; r.code = GATE_CODES.OK;
      results.push(r); continue;
    }

    r.code = GATE_CODES.BAD_SHAPE;
    r.detail = 'unknown src ' + JSON.stringify(c.src);
    results.push(r);
  }
  return results;
}

// ------------------------------------------------------------
// evaluateWrite — THE GATE. Pure; the caller performs (or skips) the write.
//
// opts:
//   target   string   e.g. 'scope_analysis' | 'opi_score' | 'organism_memory'
//   text     string   the agent payload, citation block included
//   sources  object   see verifyQuoteAnchors
//   mode     string   'off' | 'audit' | 'priority' | 'global'  (CITATION_ENFORCE)
//   force    bool     operator override; always allowed, always audit-logged
//   requireRfpRetrieved bool
//   rfpDocumentRetrieved bool
//   factCheckVerdict     'CLEAN'|'FLAGGED'|'CONTAMINATED'|null
//   priorityTargets      string[]  (defaults to PRIORITY_TARGETS)
//
// returns:
//   { allow, code, reason, enforced, wouldReject, bypass,
//     cleanText, citations, anchors, manifest, stats }
// ------------------------------------------------------------
export function evaluateWrite(opts) {
  var o = opts || {};
  var target = o.target || 'unknown';
  var mode = o.mode || 'priority';
  var priority = o.priorityTargets || PRIORITY_TARGETS;

  var parsed = parseCitationBlock(o.text);
  var base = {
    allow: true,
    code: GATE_CODES.OK,
    reason: null,
    target: target,
    mode: mode,
    enforced: false,
    wouldReject: false,
    bypass: false,
    cleanText: parsed.cleanText,
    citations: parsed.citations,
    anchors: [],
    manifest: null,
    stats: { total: 0, verified: 0, unverified: 0, failed: 0 }
  };

  if (mode === 'off') {
    base.code = GATE_CODES.GATE_OFF;
    base.reason = 'citation gate disabled (CITATION_ENFORCE=off)';
    return base;
  }

  var enforced = (mode === 'global') || (mode === 'priority' && priority.indexOf(target) >= 0);
  base.enforced = enforced;

  var failures = [];

  // --- Structural prechecks. These are about the WRITE CONTEXT, not content,
  // so they run first and produce the most actionable rejection code.

  // The CDBG precondition. orchestrateOpp never reads rfp_document_retrieved
  // (confirmed absent across index.js:17614-18032); it reads opp.rfp_text with
  // no minimum length, so an empty RFP still fires the scope prompt and the
  // model fills the vacuum from HGI knowledge base + organism intelligence.
  if (o.requireRfpRetrieved && o.rfpDocumentRetrieved !== true) {
    failures.push({
      code: GATE_CODES.RFP_NOT_RETRIEVED,
      detail: 'rfp_document_retrieved is not true — refusing to persist analysis derived from an unretrieved RFP'
    });
  }

  // Honor the existing Haiku fact-checker's own verdict instead of discarding it.
  // Today index.js:17759 prepends a banner and saves anyway; this is the line
  // that turns that detection into a rejection.
  if (o.factCheckVerdict && String(o.factCheckVerdict).toUpperCase() === 'CONTAMINATED') {
    failures.push({
      code: GATE_CODES.FACT_CHECK_CONTAMINATED,
      detail: 'fact-checker returned CONTAMINATED — claims not supported by RFP text'
    });
  }

  // --- Content checks.
  if (parsed.parseError) {
    failures.push({ code: GATE_CODES.PARSE_ERROR, detail: parsed.parseError });
  } else if (!parsed.hadBlock || parsed.citations.length === 0) {
    failures.push({
      code: GATE_CODES.NO_CITATIONS,
      detail: parsed.hadBlock ? 'citation block present but empty' : 'no HGI-CITATIONS block in output'
    });
  } else {
    var shape = validateCitationShape(parsed.citations);
    if (!shape.ok) {
      failures.push({ code: GATE_CODES.BAD_SHAPE, detail: shape.errors.slice(0, 5).join('; ') });
    } else {
      var anchors = verifyQuoteAnchors(parsed.citations, o.sources);
      base.anchors = anchors;
      var bad = anchors.filter(function (a) { return !a.ok; });
      var unver = anchors.filter(function (a) { return a.ok && a.unverified; }).length;
      base.stats = {
        total: anchors.length,
        verified: anchors.length - bad.length - unver,
        unverified: unver,
        failed: bad.length
      };
      if (bad.length > 0) {
        // Report the first failing anchor's code so the caller logs something
        // specific ("quote_not_found") rather than a generic failure.
        failures.push({
          code: bad[0].code,
          detail: bad.length + ' of ' + anchors.length + ' citations failed verification: ' +
                  bad.slice(0, 3).map(function (b) { return '[' + b.index + '] ' + b.detail; }).join(' | ')
        });
      }
    }
  }

  if (failures.length === 0) {
    base.manifest = {
      target: target,
      opportunity_id: (o.sources && o.sources.oppId) || null,
      citations: parsed.citations,
      anchors: base.anchors,
      verified_at: new Date().toISOString(),
      gate_version: 's172_v1'
    };
    return base;
  }

  base.reason = failures.map(function (f) { return f.detail; }).join(' || ');
  base.code = failures[0].code;

  // force bypass — house convention (S143, index.js:1434-1455): every guard has
  // one and every use of it is audit-logged by the caller.
  if (o.force) {
    base.allow = true;
    base.bypass = true;
    base.wouldReject = true;
    return base;
  }

  if (!enforced) {
    // audit mode, or a non-priority target under CITATION_ENFORCE=priority.
    base.allow = true;
    base.wouldReject = true;
    return base;
  }

  base.allow = false;
  return base;
}

// ------------------------------------------------------------
// Helpers for callers in index.js.
// ------------------------------------------------------------

// Normalize the env var once, tolerating unset/garbage by falling back to the
// shipped default rather than silently disabling the gate.
export function resolveEnforceMode(raw) {
  var v = String(raw || '').trim().toLowerCase();
  if (v === 'off' || v === 'audit' || v === 'priority' || v === 'global') return v;
  return 'priority';
}

// Primary source_url for an organism_memory row, so the 7.2%-sourced number has
// a path upward. Prefers a real URL, then a structured opp_field reference.
export function primarySourceUrl(citations, fallbackUrl) {
  var list = citations || [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c && typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) return c.url;
  }
  for (var j = 0; j < list.length; j++) {
    var d = list[j];
    if (d && d.src === 'opp_field' && d.opp && d.field) return 'opp://' + d.opp + '#' + d.field;
    if (d && d.src === 'memory' && d.id) return 'memory://' + d.id;
    if (d && d.src === 'kb' && d.id) return 'kb://' + d.id;
  }
  return fallbackUrl || null;
}

// One-line summary for log(). Matches the house "key=value, key=value" idiom.
export function gateSummary(result) {
  var r = result || {};
  return 'target=' + r.target +
         ' mode=' + r.mode +
         ' allow=' + r.allow +
         ' code=' + r.code +
         ' enforced=' + r.enforced +
         (r.bypass ? ' BYPASS=true' : '') +
         (r.wouldReject ? ' would_reject=true' : '') +
         ' cites=' + ((r.stats && r.stats.total) || 0) +
         ' verified=' + ((r.stats && r.stats.verified) || 0) +
         ' unverified=' + ((r.stats && r.stats.unverified) || 0) +
         ' failed=' + ((r.stats && r.stats.failed) || 0);
}
