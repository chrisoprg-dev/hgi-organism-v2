// ============================================================
// S172 — CITATION GATE TEST HARNESS
// ------------------------------------------------------------
// Run: node organism/citations.test.mjs   (or: npm test)
// No database, no API key, no network. Pure-function tests only.
//
// This repo has no test framework (package.json had a single "start" script and
// zero devDependencies), so this is a self-contained runner in the same spirit
// as the existing /api/test-citation-verifier harness at index.js:7319.
// Exits non-zero on any failure so CI or a pre-commit hook can gate on it.
// ============================================================

import {
  evaluateWrite,
  parseCitationBlock,
  validateCitationShape,
  verifyQuoteAnchors,
  normalizeForMatch,
  quoteAppearsIn,
  buildCitationBlock,
  resolveEnforceMode,
  primarySourceUrl,
  GATE_CODES,
  MIN_QUOTE_CHARS
} from './citations.js';

var passed = 0, failed = 0;
var rows = [];

function check(name, cond, detail) {
  if (cond) { passed++; rows.push(['PASS', name, '']); }
  else { failed++; rows.push(['FAIL', name, detail || '']); }
}

function expectCode(name, result, wantAllow, wantCode) {
  var ok = (result.allow === wantAllow) && (wantCode === null || result.code === wantCode);
  check(name, ok, 'got allow=' + result.allow + ' code=' + result.code +
        ' want allow=' + wantAllow + ' code=' + wantCode + (result.reason ? ' | reason: ' + String(result.reason).slice(0, 160) : ''));
}

// ------------------------------------------------------------
// FIXTURE — real production data, pulled read-only 2026-07-26 from
// opportunities.rfp_text for:
//   centralbid-rfp62990748-george-county-rfp-real-and-personal-property-appraisal-professional-
// This is a Central Bidding listing for PROPERTY APPRAISAL for the Tax Assessor.
// It contains ZERO occurrences of "CDBG". Its stored scope_analysis nonetheless
// discusses CDBG-DR framing, and rfp_document_retrieved is false.
// This is the exact class of failure CLAUDE.md documents.
// ------------------------------------------------------------
var GEORGE_COUNTY_ID = 'centralbid-rfp62990748-george-county-rfp-real-and-personal-property-appraisal-professional-';
var GEORGE_COUNTY_RFP_TEXT =
  'Home Central Bidding My CP Contact Us Create New Logout (HGIGLOBAL) Central Bidding Time: ' +
  'Fri Jul 17 2026 01:02:52 GMT+0000 (Coordinated Universal Time) George County RFP Real and ' +
  'Personal Property Appraisal Professional Services (APS) Mississippi > George County RFP: 62990748 ' +
  'Listing Information/Advertisement REQUEST FOR PROPOSALS George County RFP #APS-2026-01 Real and ' +
  'Personal Property Appraisal Professional Services (APS) This Request for Proposals (“RFP”), ' +
  'issued by the George County Board of Supervisors, is to solicit proposals from qualified and ' +
  'experienced contractor(s) who is capable of performing appraisal and maintenance of Real and ' +
  'Personal property, preparing and correcting related records/data of properties in George County ' +
  'for the Tax Assessor for a two-year term contract, with the option to extend the contract for ' +
  'one year, if the Board chooses. Notice is hereby given that';

var GC_SOURCES = {
  oppId: GEORGE_COUNTY_ID,
  fields: { rfp_text: GEORGE_COUNTY_RFP_TEXT, title: 'George County RFP Real and Personal Property Appraisal Professional Services' },
  listing: 'George County RFP Real and Personal Property Appraisal Professional Services (APS) | George County Board of Supervisors'
};

function withBlock(prose, cites) { return prose + '\n\n' + buildCitationBlock(cites); }

// ============================================================
// A — uncited payload is REJECTED
// ============================================================
expectCode('A. uncited scope_analysis is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: 'This engagement is a CDBG-DR funded disaster recovery program administration effort.',
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  false, GATE_CODES.NO_CITATIONS);

// ============================================================
// B — properly cited payload PASSES
// ============================================================
var bResult = evaluateWrite({
  target: 'scope_analysis',
  text: withBlock(
    'George County seeks a contractor to appraise and maintain real and personal property records for the Tax Assessor. Two-year term with a one-year extension option.',
    [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
       quote: 'performing appraisal and maintenance of Real and Personal property' }]),
  sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
});
expectCode('B. verbatim-quoted scope_analysis passes', bResult, true, GATE_CODES.OK);
check('B2. clean text has citation block stripped',
  bResult.cleanText.indexOf('HGI-CITATIONS') < 0 && bResult.cleanText.indexOf('Tax Assessor') > 0,
  'cleanText=' + bResult.cleanText.slice(0, 120));
check('B3. manifest produced with 1 verified anchor',
  bResult.manifest !== null && bResult.stats.verified === 1 && bResult.stats.failed === 0,
  JSON.stringify(bResult.stats));

// ============================================================
// C — fabricated quote is REJECTED (the core anti-fabrication property)
// ============================================================
expectCode('C. citation with a quote absent from the source is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('This is a CDBG-DR housing recovery program.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
         quote: 'funded through the Community Development Block Grant Disaster Recovery program' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  false, GATE_CODES.QUOTE_NOT_FOUND);

// ============================================================
// D — THE CDBG REGRESSION, against real production RFP text
// ============================================================
check('D0. fixture genuinely contains no CDBG mention',
  GEORGE_COUNTY_RFP_TEXT.toLowerCase().indexOf('cdbg') < 0,
  'fixture unexpectedly mentions CDBG');

expectCode('D1. CDBG framing with no citation is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: '## SUB-VERTICAL CLASSIFICATION\nThis is a CDBG-DR / FEMA Public Assistance funded recovery engagement following recent Gulf Coast storm activity.',
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  false, GATE_CODES.NO_CITATIONS);

expectCode('D2. CDBG framing with an invented supporting quote is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('This is a CDBG-DR funded engagement administered under HUD rules.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
         quote: 'the County shall administer CDBG-DR funds in accordance with HUD requirements' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  false, GATE_CODES.QUOTE_NOT_FOUND);

expectCode('D3. same opportunity, honest appraisal framing, passes',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Operational mass appraisal for the George County Tax Assessor. Not a grant-funded program.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
         quote: 'preparing and correcting related records/data of properties in George County for the Tax Assessor' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  true, GATE_CODES.OK);

// ============================================================
// E — scope written before the RFP was retrieved is REJECTED
// ============================================================
expectCode('E. rfp_document_retrieved=false blocks the write',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Appraisal services for the Tax Assessor.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
         quote: 'performing appraisal and maintenance of Real and Personal property' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: false
  }),
  false, GATE_CODES.RFP_NOT_RETRIEVED);

// ============================================================
// F — malformed / truncated citation block is REJECTED (never treated as "uncited")
// ============================================================
expectCode('F1. unterminated citation block is a parse error',
  evaluateWrite({
    target: 'scope_analysis',
    text: 'Analysis text.\n\n<!--HGI-CITATIONS v1\n[{"src":"opp_field","opp":"x","field":"rfp_text","quote":"trunc',
    sources: GC_SOURCES, mode: 'priority'
  }),
  false, GATE_CODES.PARSE_ERROR);

expectCode('F2. non-JSON citation block is a parse error',
  evaluateWrite({
    target: 'scope_analysis',
    text: 'Analysis.\n\n<!--HGI-CITATIONS v1\nnot json at all\n-->',
    sources: GC_SOURCES, mode: 'priority'
  }),
  false, GATE_CODES.PARSE_ERROR);

expectCode('F3. empty citation array is rejected',
  evaluateWrite({
    target: 'scope_analysis', text: withBlock('Analysis.', []),
    sources: GC_SOURCES, mode: 'priority'
  }),
  false, GATE_CODES.NO_CITATIONS);

expectCode('F4. bad src enum is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Analysis.', [{ src: 'vibes', quote: 'something long enough to pass the floor' }]),
    sources: GC_SOURCES, mode: 'priority'
  }),
  false, GATE_CODES.BAD_SHAPE);

// ============================================================
// G — trivially short quote is REJECTED
// ============================================================
expectCode('G. quote under the ' + MIN_QUOTE_CHARS + '-char floor is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Appraisal work.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text', quote: 'appraisal' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  false, GATE_CODES.QUOTE_TOO_SHORT);

// ============================================================
// H — force bypass is allowed and flagged
// ============================================================
var hResult = evaluateWrite({
  target: 'scope_analysis', text: 'Uncited claim.',
  sources: GC_SOURCES, mode: 'priority', force: true
});
check('H. force:true allows the write and flags the bypass',
  hResult.allow === true && hResult.bypass === true && hResult.wouldReject === true,
  JSON.stringify({ allow: hResult.allow, bypass: hResult.bypass, wouldReject: hResult.wouldReject }));

// ============================================================
// I — audit mode never blocks but records the would-be rejection
// ============================================================
var iResult = evaluateWrite({
  target: 'scope_analysis', text: 'Uncited claim.', sources: GC_SOURCES, mode: 'audit'
});
check('I1. audit mode allows but sets would_reject',
  iResult.allow === true && iResult.wouldReject === true && iResult.code === GATE_CODES.NO_CITATIONS,
  JSON.stringify({ allow: iResult.allow, wouldReject: iResult.wouldReject, code: iResult.code }));

var iOff = evaluateWrite({ target: 'scope_analysis', text: 'Uncited.', sources: GC_SOURCES, mode: 'off' });
check('I2. off mode short-circuits', iOff.allow === true && iOff.code === GATE_CODES.GATE_OFF, iOff.code);

var iNonPriority = evaluateWrite({ target: 'research_brief', text: 'Uncited.', sources: GC_SOURCES, mode: 'priority' });
check('I3. non-priority target is audit-only under priority mode',
  iNonPriority.allow === true && iNonPriority.wouldReject === true && iNonPriority.enforced === false,
  JSON.stringify({ allow: iNonPriority.allow, enforced: iNonPriority.enforced }));

var iGlobal = evaluateWrite({ target: 'research_brief', text: 'Uncited.', sources: GC_SOURCES, mode: 'global' });
check('I4. same target blocks under global mode',
  iGlobal.allow === false && iGlobal.enforced === true,
  JSON.stringify({ allow: iGlobal.allow, enforced: iGlobal.enforced }));

// ============================================================
// J — cross-opportunity citation is REJECTED
// (recruiting_bench invented conflicting solicitations — CLAUDE.md line 9)
// ============================================================
expectCode('J. citing a different opportunity than the write target is rejected',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Analysis.',
      [{ src: 'opp_field', opp: 'some-other-opportunity-id', field: 'rfp_text',
         quote: 'performing appraisal and maintenance of Real and Personal property' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true
  }),
  false, GATE_CODES.UNKNOWN_SOURCE);

// ============================================================
// K — CONTAMINATED fact-check verdict now BLOCKS (previously banner-and-save)
// ============================================================
expectCode('K. CONTAMINATED fact-check verdict blocks the write',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Analysis.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
         quote: 'performing appraisal and maintenance of Real and Personal property' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true,
    factCheckVerdict: 'CONTAMINATED'
  }),
  false, GATE_CODES.FACT_CHECK_CONTAMINATED);

expectCode('K2. FLAGGED verdict does not block (matches existing S119 policy)',
  evaluateWrite({
    target: 'scope_analysis',
    text: withBlock('Analysis.',
      [{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text',
         quote: 'performing appraisal and maintenance of Real and Personal property' }]),
    sources: GC_SOURCES, mode: 'priority', requireRfpRetrieved: true, rfpDocumentRetrieved: true,
    factCheckVerdict: 'FLAGGED'
  }),
  true, GATE_CODES.OK);

// ============================================================
// L — normalization: curly quotes / whitespace drift tolerated, meaning is not
// ============================================================
check('L1. curly-quote and whitespace drift still matches',
  quoteAppearsIn('This Request for Proposals ("RFP"),   issued by the George County Board', GEORGE_COUNTY_RFP_TEXT).found,
  'normalized match failed');
check('L2. semantically altered quote does not match',
  !quoteAppearsIn('This Request for Proposals ("RFP"), issued by the Jackson County Board', GEORGE_COUNTY_RFP_TEXT).found,
  'altered quote incorrectly matched');
check('L3. normalizeForMatch collapses whitespace and case',
  normalizeForMatch('  Hello   WORLD \n ') === 'hello world', normalizeForMatch('  Hello   WORLD \n '));

// ============================================================
// M — listing-source citations (intake scorer has no RFP text at all)
// ============================================================
expectCode('M1. listing citation verified against the stub passes',
  evaluateWrite({
    target: 'opi_score',
    text: withBlock('Appraisal services opportunity, tax_appeals adjacent.',
      [{ src: 'listing', quote: 'Real and Personal Property Appraisal Professional Services' }]),
    sources: GC_SOURCES, mode: 'priority'
  }),
  true, GATE_CODES.OK);

expectCode('M2. listing citation with invented quote is rejected',
  evaluateWrite({
    target: 'opi_score',
    text: withBlock('Disaster recovery opportunity.',
      [{ src: 'listing', quote: 'CDBG-DR disaster recovery program management services' }]),
    sources: GC_SOURCES, mode: 'priority'
  }),
  false, GATE_CODES.QUOTE_NOT_FOUND);

// ============================================================
// N — unit checks on helpers
// ============================================================
var pb = parseCitationBlock(withBlock('Body text here.', [{ src: 'listing', quote: 'x'.repeat(30) }]));
check('N1. parseCitationBlock round-trips', pb.hadBlock && pb.citations.length === 1 && pb.cleanText === 'Body text here.', JSON.stringify(pb).slice(0, 160));
check('N2. parseCitationBlock on plain text', (function () { var r = parseCitationBlock('no block'); return !r.hadBlock && r.citations.length === 0 && r.cleanText === 'no block'; })(), 'plain-text parse wrong');
check('N3. parseCitationBlock handles null', (function () { var r = parseCitationBlock(null); return !r.hadBlock && r.cleanText === ''; })(), 'null parse wrong');
check('N4. validateCitationShape rejects missing quote',
  !validateCitationShape([{ src: 'opp_field', opp: 'a', field: 'rfp_text' }]).ok, 'should require quote');
check('N5. validateCitationShape rejects non-citable field',
  !validateCitationShape([{ src: 'opp_field', opp: 'a', field: 'scope_analysis', quote: 'y'.repeat(30) }]).ok,
  'scope_analysis must not be citable as evidence');
check('N6. resolveEnforceMode defaults safely',
  resolveEnforceMode(undefined) === 'priority' && resolveEnforceMode('GLOBAL') === 'global' && resolveEnforceMode('nonsense') === 'priority',
  'mode resolution wrong');
check('N7. primarySourceUrl derives a structured ref',
  primarySourceUrl([{ src: 'opp_field', opp: 'abc', field: 'rfp_text', quote: 'z'.repeat(30) }]) === 'opp://abc#rfp_text',
  primarySourceUrl([{ src: 'opp_field', opp: 'abc', field: 'rfp_text' }]));
check('N8. verifyQuoteAnchors reports per-citation offsets',
  (function () {
    var a = verifyQuoteAnchors([{ src: 'opp_field', opp: GEORGE_COUNTY_ID, field: 'rfp_text', quote: 'George County Board of Supervisors' }], GC_SOURCES);
    return a.length === 1 && a[0].ok === true && a[0].offset > 0;
  })(), 'anchor offset not reported');

// ============================================================
// REPORT
// ============================================================
var wCol = 0;
rows.forEach(function (r) { if (r[1].length > wCol) wCol = r[1].length; });
console.log('\n  S172 CITATION GATE — TEST RESULTS\n  ' + '='.repeat(wCol + 12));
rows.forEach(function (r) {
  console.log('  ' + (r[0] === 'PASS' ? 'PASS' : 'FAIL') + '  ' + r[1].padEnd(wCol) + (r[2] ? '   <- ' + r[2] : ''));
});
console.log('  ' + '='.repeat(wCol + 12));
console.log('  ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed === 0 ? 0 : 1);
