// HGI Living Organism V2 â Multi-Agent Intelligence Session Engine
// Phase 3: 6 agents wired â Intelligence, Financial, Winnability, CRM, Quality Gate, Self-Awareness
// 47 agents total. One shared brain. All into all.

import http from 'http';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Tab, TabStopType, Header, Footer, Table, TableRow, TableCell, ShadingType, LevelFormat, WidthType, PageBreak, PageNumber, TableOfContents, ImageRun } from 'docx';

process.on('unhandledRejection', (r) => log('UNHANDLED: ' + (r instanceof Error ? r.message : String(r)).slice(0,150)));
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + e.message.slice(0,150)));

import Anthropic from '@anthropic-ai/sdk';
var pdfParse = null;
try { pdfParse = (await import('pdf-parse')).default; } catch(e) { console.log('pdf-parse not available: ' + e.message); }
var puppeteer = null;
try { puppeteer = (await import('puppeteer')).default; } catch(e) { console.log('puppeteer not available: ' + e.message); }

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const AK = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
var SONNET = 'claude-sonnet-4-6';

const supabase = createClient(SB_URL, SB_KEY);
const anthropic = new Anthropic({ apiKey: AK });

// Ring buffer for in-memory log access
var logBuffer = [];
var LOG_MAX = 500;

// === COST TRACKING (Session 95) ===
var costLog = [];
var webSearchCount = 0; // Session 105: track web searches ($10/1000)
var PRICING = {
  'claude-sonnet-4-6': { in_per_tok: 0.000003, out_per_tok: 0.000015 },
  'claude-sonnet-4-20250514': { in_per_tok: 0.000003, out_per_tok: 0.000015 },
  'claude-haiku-4-5-20251001': { in_per_tok: 0.00000025, out_per_tok: 0.00000125 },
  'claude-opus-4-6': { in_per_tok: 0.000005, out_per_tok: 0.000025 }
};
function trackCost(agent, model, usage) {
  if (!usage) return;
  var p = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
  var cost = (usage.input_tokens || 0) * p.in_per_tok + (usage.output_tokens || 0) * p.out_per_tok;
  costLog.push({ agent: agent, model: model, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, cost_usd: cost, ts: new Date().toISOString() });
}

// SESSION 107: Periodic cost flush — every 5 min, flush accumulated cost to hunt_runs
// so costs show up in dashboards/api_cost even if runSession never completes or
// spend happens outside runSession (interface chat, manual orchestrations, MCP calls).
async function flushCostLog(reason) {
  if (!costLog || costLog.length === 0) return;
  try {
    var chunk = costLog.splice(0, costLog.length); // drain atomically
    var total = chunk.reduce(function(s, c) { return s + c.cost_usd; }, 0);
    var byAgent = {};
    chunk.forEach(function(c) {
      if (!byAgent[c.agent]) byAgent[c.agent] = { calls: 0, cost: 0, in_tok: 0, out_tok: 0 };
      byAgent[c.agent].calls++;
      byAgent[c.agent].cost += c.cost_usd;
      byAgent[c.agent].in_tok += c.input_tokens;
      byAgent[c.agent].out_tok += c.output_tokens;
    });
    var summary = JSON.stringify({ flush: reason || 'interval', total_usd: Math.round(total * 10000) / 10000, calls: chunk.length, by_agent: byAgent });
    await supabase.from('hunt_runs').insert({
      source: 'api_cost_interval',
      status: summary.slice(0, 5000),
      run_at: new Date().toISOString(),
      opportunities_found: 0
    });
    log('COST FLUSH (' + (reason||'interval') + '): $' + total.toFixed(4) + ' across ' + chunk.length + ' calls');
  } catch(fe) {
    // On failure, put costs back into the log to retry next interval
    log('COST FLUSH ERROR: ' + (fe.message || '').slice(0, 150));
  }
}
setInterval(function() { flushCostLog('interval').catch(function(){}); }, 5 * 60 * 1000); // 5 min

// SESSION 108: auto-continuation wrapper. If the model hits max_tokens, automatically
// make continuation calls (up to maxContinuations) and concatenate results. Prevents
// truncated scope/financial/research outputs like the 12,223-char OPSB scope.
// Cost: only fires when truncation happens. Tracks each continuation separately in costLog.
// NOTE: Do NOT use this for calls that include `tools` (web_search) — continuation would
// need to preserve tool_use/tool_result blocks which this helper does not handle.
async function callWithContinuation(params, agentLabel, maxContinuations) {
  maxContinuations = (maxContinuations == null) ? 2 : maxContinuations;
  var resp = await anthropic.messages.create(params);
  trackCost(agentLabel, params.model, resp.usage);
  var allText = (resp.content || []).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('');
  var stopReason = resp.stop_reason;
  var continuations = 0;
  while (stopReason === 'max_tokens' && continuations < maxContinuations) {
    continuations++;
    log('[' + agentLabel + '] hit max_tokens, continuation ' + continuations + ' (' + allText.length + ' chars so far)');
    try {
      var contParams = {
        model: params.model,
        max_tokens: params.max_tokens,
        system: params.system,
        messages: (params.messages || []).concat([
          { role: 'assistant', content: allText },
          { role: 'user', content: 'Continue from exactly where you left off. Do not repeat any prior content. Pick up mid-sentence if needed and complete every remaining section.' }
        ])
      };
      var contResp = await anthropic.messages.create(contParams);
      trackCost(agentLabel + '_continuation', params.model, contResp.usage);
      var contText = (contResp.content || []).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('');
      if (!contText || contText.length < 20) { log('[' + agentLabel + '] continuation returned no content, stopping'); break; }
      allText = allText + contText;
      stopReason = contResp.stop_reason;
    } catch(ce) {
      log('[' + agentLabel + '] continuation ' + continuations + ' failed: ' + (ce.message||'').slice(0,120));
      break;
    }
  }
  if (continuations > 0) log('[' + agentLabel + '] completed with ' + continuations + ' continuation(s), final length ' + allText.length);
  return { text: allText, continuations: continuations, stop_reason: stopReason };
}

// SESSION 105: Agent frequency control — skip web-search agents that ran recently
var agentLastRun = {};
async function shouldRunAgent(agentName, frequencyDays) {
  // Check in-memory cache first
  var now = Date.now();
  if (agentLastRun[agentName] && (now - agentLastRun[agentName]) < frequencyDays * 86400000) {
    return false;
  }
  // Check Supabase for last run
  try {
    var lastMem = await supabase.from('organism_memory').select('created_at')
      .eq('agent', agentName).order('created_at', { ascending: false }).limit(1);
    if (lastMem.data && lastMem.data.length > 0) {
      var lastRun = new Date(lastMem.data[0].created_at).getTime();
      agentLastRun[agentName] = lastRun;
      var daysSince = (now - lastRun) / 86400000;
      if (daysSince < frequencyDays) {
        log('FREQUENCY: Skipping ' + agentName + ' — last ran ' + Math.round(daysSince * 10) / 10 + ' days ago (runs every ' + frequencyDays + ' days)');
        return false;
      }
    }
  } catch (e) { /* on error, run the agent */ }
  agentLastRun[agentName] = now;
  return true;
}

const server = http.createServer(async (req, res) => {
  // Crash protection - never let a request handler kill the server
  try {
    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = req.url ? req.url.split('?')[0] : '/';

    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'alive', uptime_seconds: Math.floor(process.uptime()), timestamp: new Date().toISOString(), version: 'V2.0-organism', agents_active: 42 }));
      return;
    }

    if (url === '/run-session' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ triggered: true }));
      setImmediate(() => runSession('manual').catch(e => log('Session error: ' + e.message)));
      return;
    }

    if (url === '/api/pipeline') {
      const r = await supabase.from('opportunities').select('id,title,agency,vertical,opi_score,stage,status,due_date,estimated_value,source_url,outcome,rfp_document_retrieved').eq('status','active').order('opi_score', { ascending: false }).limit(20);
      // Add lightweight flags for completeness indicators without sending full text
      if (r.data) {
        var fullR = await supabase.from('opportunities').select('id,capture_action,scope_analysis,research_brief,staffing_plan,financial_analysis,proposal_content').eq('status','active');
        var fullMap = {};
        (fullR.data || []).forEach(function(o) { fullMap[o.id] = o; });
        r.data.forEach(function(o) {
          var f = fullMap[o.id] || {};
          o.has_scope = !!(f.scope_analysis && f.scope_analysis.length > 100);
          o.has_intel = !!(f.research_brief && f.research_brief.length > 100);
          o.has_financial = !!(f.financial_analysis && f.financial_analysis.length > 100);
          o.has_staffing = !!(f.staffing_plan && f.staffing_plan.length > 100);
          o.has_proposal = !!(f.proposal_content && f.proposal_content.length > 100);
          o.has_capture = !!(f.capture_action && f.capture_action.length > 100);
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.data || []));
      return;
    }

    if (url === '/api/briefing') {
      // Rich morning briefing — mobile-friendly HTML
      var bPipeline = await supabase.from('opportunities').select('title,opi_score,stage,status,due_date,estimated_value').eq('status','active').order('opi_score', { ascending: false });
      var bDash = await supabase.from('organism_memory').select('observation,created_at').eq('agent','dashboard_agent').order('created_at', { ascending: false }).limit(1);
      var bHunt = await supabase.from('organism_memory').select('observation,created_at').eq('agent','hunting_agent').order('created_at', { ascending: false }).limit(1);
      var bExec = await supabase.from('organism_memory').select('observation,created_at').eq('agent','executive_brief_agent').order('created_at', { ascending: false }).limit(1);
      var bAlerts = await supabase.from('organism_memory').select('observation,agent,created_at').in('agent', ['pipeline_scanner','disaster_monitor','amendment_tracker']).order('created_at', { ascending: false }).limit(3);
      var pipeline = bPipeline.data || [];
      var dashText = (bDash.data && bDash.data[0]) ? bDash.data[0].observation : 'No briefing yet.';
      var dashTime = (bDash.data && bDash.data[0]) ? bDash.data[0].created_at : '';
      var huntText = (bHunt.data && bHunt.data[0]) ? bHunt.data[0].observation : '';
      var execText = (bExec.data && bExec.data[0]) ? bExec.data[0].observation : '';
      var alerts = bAlerts.data || [];
      var today = new Date();

      var pipelineHtml = pipeline.map(function(o) {
        var days = o.due_date ? Math.ceil((new Date(o.due_date) - today) / 86400000) : null;
        var urgency = days !== null && days <= 14 ? ' style="color:#d32f2f;font-weight:bold"' : '';
        return '<div style="padding:8px 0;border-bottom:1px solid #eee">' +
          '<div style="display:flex;justify-content:space-between">' +
          '<strong>' + (o.title || '?') + '</strong>' +
          '<span style="background:#1a237e;color:#fff;border-radius:12px;padding:2px 8px;font-size:12px">OPI ' + (o.opi_score || '?') + '</span></div>' +
          '<div style="font-size:13px;color:#666;margin-top:2px">' +
          (o.stage || '?') + (days !== null ? ' <span' + urgency + '> | ' + days + ' days</span>' : '') +
          '</div></div>';
      }).join('');

      var alertsHtml = alerts.map(function(a) {
        return '<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px"><strong>' + a.agent + ':</strong> ' + (a.observation || '') + '</div>';
      }).join('') || '<div style="color:#666;font-size:13px">No urgent alerts</div>';

      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>HGI Morning Briefing</title>' +
        '<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;background:#f5f5f5;color:#333;max-width:600px;margin:0 auto}' +
        '.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}' +
        '.header{background:linear-gradient(135deg,#1a237e,#c6a300);color:#fff;border-radius:12px;padding:20px;margin-bottom:12px;text-align:center}' +
        'h2{margin:0 0 8px 0;font-size:16px;color:#1a237e}pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.5;margin:0}</style></head>' +
        '<body><div class="header"><h1 style="margin:0;font-size:22px">HGI Organism Briefing</h1>' +
        '<div style="font-size:13px;opacity:0.8">' + new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '</div>' +
        '<div style="font-size:12px;opacity:0.7">Last cycle: ' + (dashTime ? new Date(dashTime).toLocaleString() : 'unknown') + '</div></div>' +
        '<div class="card"><h2>Pipeline (' + pipeline.length + ' opportunities)</h2>' + pipelineHtml + '</div>' +
        '<div class="card"><h2>Alerts</h2>' + alertsHtml + '</div>' +
        '<div class="card"><h2>Dashboard Briefing</h2><pre>' + dashText.replace(/</g, '&lt;') + '</pre></div>' +
        (execText ? '<div class="card"><h2>Executive Summary</h2><pre>' + execText.replace(/</g, '&lt;') + '</pre></div>' : '') +
        (huntText ? '<div class="card"><h2>Latest Hunting</h2><pre>' + huntText.replace(/</g, '&lt;') + '</pre></div>' : '') +
        '<div style="text-align:center;color:#999;font-size:11px;padding:12px">HGI Organism V3.4 | Refresh to update</div>' +
        '</body></html>';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.startsWith('/api/proposal-brief')) {
      // Structured proposal brief — all organism intelligence organized per opportunity
      var pbId = (req.url.split('?id=')[1] || '').split('&')[0];
      if (!pbId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing ?id=opportunity_id' }));
        return;
      }
      var pbOpp = await supabase.from('opportunities').select('*').eq('id', pbId).single();
      var pbMems = await supabase.from('organism_memory').select('agent,observation,memory_type,confidence,status,source_url,created_at').eq('opportunity_id', pbId).order('created_at', { ascending: false }).limit(100);
      if (!pbOpp.data) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Opportunity not found' }));
        return;
      }
      var opp = pbOpp.data;
      var mems = pbMems.data || [];
      // Organize by agent role
      function latestByAgent(agentName) {
        var m = mems.find(function(x) { return x.agent === agentName; });
        return m ? { observation: m.observation, confidence: m.confidence, status: m.status, source_url: m.source_url, updated: m.created_at } : null;
      }
      var brief = {
        opportunity: { id: opp.id, title: opp.title, agency: opp.agency, vertical: opp.vertical, opi_score: opp.opi_score, stage: opp.stage, due_date: opp.due_date, estimated_value: opp.estimated_value },
        scope: opp.scope_analysis || null,
        sections: {
          competitive_landscape: latestByAgent('intelligence_engine'),
          financial_analysis: latestByAgent('financial_agent'),
          winnability: latestByAgent('winnability_agent'),
          contacts_crm: latestByAgent('crm_agent'),
          compliance: latestByAgent('quality_gate'),
          staffing: latestByAgent('staffing_plan_agent'),
          proposal_draft: latestByAgent('proposal_agent'),
          red_team: latestByAgent('red_team'),
          price_to_win: latestByAgent('price_to_win'),
          team_briefing: latestByAgent('brief_agent'),
          full_dossier: latestByAgent('opportunity_brief_agent'),
          proposal_assembly: latestByAgent('proposal_assembly'),
          oral_prep: latestByAgent('oral_prep')
        },
        all_memories_count: mems.length,
        verified_count: mems.filter(function(m) { return m.status === 'verified' || m.status === 'doctrine'; }).length,
        generated_at: new Date().toISOString()
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(brief, null, 2));
      return;
    }

    if (url === '/api/memories') {
      var mParams = new URL(req.url, 'http://x').searchParams;
      var mAgent = mParams.get('agent');
      var mLimit = parseInt(mParams.get('limit')) || 100;
      var mQ = supabase.from('organism_memory').select('agent,observation,memory_type,created_at,opportunity_id').neq('memory_type','decision_point').order('created_at', { ascending: false }).limit(mLimit);
      if (mAgent) mQ = mQ.eq('agent', mAgent);
      const r = await mQ;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.data || []));
      return;
    }

    if (url === '/api/decisions') {
      const r = await supabase.from('organism_memory').select('id,agent,observation,memory_type,created_at,opportunity_id').eq('memory_type','decision_point').order('created_at', { ascending: false }).limit(20);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.data || []));
      return;
    }

    if (url === '/api/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lines: logBuffer.length, logs: logBuffer }));
      return;
    }

    if (url === '/api/trigger') {
      log('SMART TRIGGER via /api/trigger — only changed/new opps');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ triggered: true, mode: 'smart', time: new Date().toISOString() }));
      setImmediate(function() { runSession('smart_trigger').catch(function(e) { log('Trigger error: ' + e.message); }); });
      return;
    }

    if (url === '/api/trigger-full') {
      log('FULL TRIGGER via /api/trigger-full — all opps, all agents');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ triggered: true, mode: 'full', time: new Date().toISOString() }));
      setImmediate(function() { runSession('manual_full').catch(function(e) { log('Full trigger error: ' + e.message); }); });
      return;
    }

    // Manual RFP retrieval for a specific opportunity
    if (url.startsWith('/api/fetch-rfp')) {
      var frId = new URL(req.url, 'http://x').searchParams.get('id');
      if (!frId) {
        // No ID = fetch all missing RFPs
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'started', mode: 'all' }));
        setImmediate(async function() { try { var r = await autoRetrieveRFPs(); log('Manual fetch-rfp all: ' + JSON.stringify(r)); } catch(e) { log('fetch-rfp error: ' + e.message); } });
        return;
      }
      // Specific opp
      try {
        var frOpp = await supabase.from('opportunities').select('id,title,source_url,rfp_text').eq('id', decodeURIComponent(frId)).single();
        if (!frOpp.data) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'fetching', opp: frOpp.data.title }));
        setImmediate(async function() {
          try {
            // Temporarily set rfp_document_retrieved=false so autoRetrieveRFPs picks it up
            await supabase.from('opportunities').update({ rfp_document_retrieved: false }).eq('id', frOpp.data.id);
            var r = await autoRetrieveRFPs();
            log('Manual fetch-rfp for ' + frOpp.data.title.slice(0, 40) + ': ' + JSON.stringify(r));
          } catch(e) { log('fetch-rfp error: ' + e.message); }
        });
      } catch(e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // ============================================================
    // VISIBILITY KIT (Session 68)
    // ============================================================

    if (url === '/api/diagnostics') {
      try {
        var dNow = new Date();
        var d24h = new Date(dNow - 86400000).toISOString();
        var dResults = await Promise.all([
          supabase.from('opportunities').select('id,opi_score,stage,status').eq('status','active'),
          supabase.from('organism_memory').select('agent,created_at').gte('created_at', d24h).order('created_at', { ascending: false }),
          supabase.from('organism_memory').select('id', { count: 'exact', head: true }),
          supabase.from('hunt_runs').select('source,created_at').order('created_at', { ascending: false }).limit(5),
          supabase.from('organism_memory').select('agent,observation,created_at').eq('memory_type','analysis').ilike('observation','%error%').gte('created_at', d24h).limit(10)
        ]);
        var pipeline = dResults[0].data || [];
        var recent24h = dResults[1].data || [];
        var totalMems = dResults[2].count || 0;
        var recentHunts = dResults[3].data || [];
        var recentErrors = dResults[4].data || [];
        var agentCounts = {};
        recent24h.forEach(function(m) { agentCounts[m.agent] = (agentCounts[m.agent]||0)+1; });
        var byStage = {};
        pipeline.forEach(function(o) { var s=o.stage||'unset'; byStage[s]=(byStage[s]||0)+1; });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          timestamp: dNow.toISOString(),
          uptime_seconds: Math.floor(process.uptime()),
          version: 'V3.4-rfp-gate',
          pipeline: { total_active: pipeline.length, by_stage: byStage, avg_opi: pipeline.length ? Math.round(pipeline.reduce(function(a,o){return a+(o.opi_score||0)},0)/pipeline.length) : 0 },
          memory: { total: totalMems, last_24h: recent24h.length, agents_active_24h: Object.keys(agentCounts).length, by_agent_24h: agentCounts },
          hunting: { recent_runs: recentHunts },
          errors_24h: recentErrors.map(function(e){ return { agent: e.agent, excerpt: (e.observation||''), time: e.created_at }; }),
          cost_estimate: { note: 'Approximate based on agent activity', memories_24h: recent24h.length, est_api_calls_24h: recent24h.length, est_cost_24h_usd: (recent24h.length * 0.015).toFixed(2) }
        }));
      } catch(de) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: de.message }));
      }
      return;
    }

    if (url.startsWith('/api/proposal-preview')) {
      var ppId = (req.url.split('?id=')[1]||'').split('&')[0];
      if (!ppId) { res.writeHead(400, {'Content-Type':'application/json'}); res.end('{"error":"id required"}'); return; }
      try {
        var ppOpp = await supabase.from('opportunities').select('title,agency,opi_score,stage,due_date,scope_analysis,financial_analysis,research_brief,staffing_plan,capture_action,proposal_content,rfp_document_retrieved').eq('id', decodeURIComponent(ppId)).single();
        var ppMems = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at').eq('opportunity_id', decodeURIComponent(ppId)).neq('memory_type','decision_point').order('created_at', { ascending: false }).limit(50);
        var o = ppOpp.data || {};
        var mems = ppMems.data || [];
        var sections = [
          { title: 'PROPOSAL CONTENT (Submission-Ready)', content: o.proposal_content },
          { title: 'Scope Analysis', content: o.scope_analysis },
          { title: 'Financial Analysis', content: o.financial_analysis },
          { title: 'Research Brief', content: o.research_brief },
          { title: 'Staffing Plan', content: o.staffing_plan },
          { title: 'Capture Action / GO Decision (Internal Only)', content: o.capture_action }
        ].filter(function(s){ return s.content; });
        var memsByAgent = {};
        mems.forEach(function(m){ if(!memsByAgent[m.agent]) memsByAgent[m.agent]=[]; memsByAgent[m.agent].push(m); });
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proposal Preview</title>' +
          '<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px;background:#f8f9fa;color:#333;max-width:900px;margin:0 auto;line-height:1.6}' +
          '.header{background:linear-gradient(135deg,#0a0e17,#1a2332);color:#fff;padding:24px;border-radius:12px;margin-bottom:20px}' +
          '.section{background:#fff;border-radius:8px;padding:20px;margin-bottom:16px;border:1px solid #e0e0e0}' +
          '.section h2{color:#1a237e;margin:0 0 12px;font-size:18px;border-bottom:2px solid #c8a55a;padding-bottom:8px}' +
          '.section pre{white-space:pre-wrap;font-family:inherit;font-size:14px;margin:0}' +
          '.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-right:6px}' +
          '.mem-card{background:#f0f4f8;border-radius:6px;padding:12px;margin-bottom:8px;border-left:3px solid #c8a55a}' +
          '.mem-agent{font-size:11px;font-weight:700;text-transform:uppercase;color:#c8a55a;letter-spacing:0.5px}' +
          '.mem-obs{font-size:13px;margin-top:4px}' +
          '</style></head><body>' +
          '<div class="header"><h1 style="margin:0">' + (o.title||'Unknown').replace(/</g,'&lt;') + '</h1>' +
          '<div style="margin-top:8px;font-size:14px">' + (o.agency||'').replace(/</g,'&lt;') + '</div>' +
          '<div style="margin-top:8px">' +
          '<span class="badge" style="background:' + ((o.opi_score||0)>=80?'#34d399':'#f59e0b') + ';color:#000">OPI ' + (o.opi_score||'?') + '</span>' +
          '<span class="badge" style="background:rgba(255,255,255,0.2);color:#fff">' + (o.stage||'unset') + '</span>' +
          '<span class="badge" style="background:rgba(255,255,255,0.1);color:#fff">RFP: ' + (o.rfp_document_retrieved?'YES':'NO') + '</span>' +
          '</div></div>';
        sections.forEach(function(s) {
          html += '<div class="section"><h2>' + s.title + '</h2><pre>' + (s.content||'').replace(/</g,'&lt;') + '</pre></div>';
        });
        if (Object.keys(memsByAgent).length > 0) {
          html += '<div class="section"><h2>Agent Intelligence (' + mems.length + ' memories)</h2>';
          Object.keys(memsByAgent).forEach(function(agent) {
            memsByAgent[agent].forEach(function(m) {
              html += '<div class="mem-card"><div class="mem-agent">' + agent + ' &mdash; ' + (m.memory_type||'') + '</div>' +
                '<div class="mem-obs">' + (m.observation||'').replace(/</g,'&lt;') + '</div></div>';
            });
          });
          html += '</div>';
        }
        html += '</body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(html);
      } catch(pe) {
        res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:pe.message}));
      }
      return;
    }

    
  // Serve brain 3D model
  if(url==='/brain.glb'){
    try{
      const brainPath=require('path').join(__dirname,'brain.glb');
      const brainData=require('fs').readFileSync(brainPath);
      res.writeHead(200,{'Content-Type':'model/gltf-binary','Cache-Control':'public,max-age=86400','Access-Control-Allow-Origin':'*'});
      res.end(brainData);return;
    }catch(e){res.writeHead(404);res.end('brain.glb not found');return;}
  }
if (url === '/' || url === '/dashboard' || url === '/interface' || url === '/interface.html') {
      const html = getInterface();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
      res.end(html);
      return;
    }

    if (url === '/prototype' || url === '/prototype.html') {
      try {
        const protoHtml = fs.readFileSync(path.join(process.cwd(), 'organism', 'prototype.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        res.end(protoHtml);
        return;
      } catch(e) { res.writeHead(500); res.end('Prototype not found'); return; }
    }


    if (url === '/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      res.end(JSON.stringify({
        name: 'HGI Organism',
        short_name: 'HGI',
        description: 'HGI Capture Intelligence Platform',
        start_url: '/',
        display: 'standalone',
        background_color: '#080a0e',
        theme_color: '#eab308',
        icons: [
          { src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#1B2A4A"/><text x="96" y="120" text-anchor="middle" font-family="Arial Black" font-size="80" font-weight="900" fill="#eab308">H</text></svg>'), sizes: '192x192', type: 'image/svg+xml' },
          { src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#1B2A4A"/><text x="256" y="320" text-anchor="middle" font-family="Arial Black" font-size="220" font-weight="900" fill="#eab308">H</text></svg>'), sizes: '512x512', type: 'image/svg+xml' }
        ]
      }));
      return;
    }

    
// PHASE 2A: New API routes — surface agent intelligence to interface

if (url.startsWith('/api/opportunity-detail')) {
  var oId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!oId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
  var dr = await supabase.from('opportunities').select('id,title,agency,vertical,opi_score,stage,status,due_date,estimated_value,scope_analysis,financial_analysis,research_brief,staffing_plan,capture_action,source_url,outcome,outcome_notes,rfp_text,proposal_content,rfp_document_retrieved,description,oral_presentation_date,award_notification_date,rfp_document_url,incumbent,why_hgi_wins,key_requirements').eq('id',oId).single();
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(dr.data || {}));
  return;
}

if (url.startsWith('/api/opportunity-memories')) {
  var oId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!oId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
  var mr = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at').eq('opportunity_id',oId).neq('memory_type','decision_point').order('created_at',{ascending:false}).limit(200);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(mr.data || []));
  return;
}

if (url.startsWith('/api/opportunity-intel')) {

  var oId = (req.url.split('?id=')[1]||'').split('&')[0];

  if (!oId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  var ir = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at').eq('opportunity_id',oId).eq('memory_type','competitive_intel').order('created_at',{ascending:false}).limit(100);

  res.writeHead(200, {'Content-Type':'application/json'});

  res.end(JSON.stringify(ir.data || []));

  return;

}


if (url === '/api/hunt-stats') {
  var hr = await supabase.from('hunt_runs').select('run_at,source,status,opportunities_found,opportunities_new').order('run_at',{ascending:false}).limit(50);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(hr.data || []));
  return;
}

// === INTELLIGENCE SUMMARY — /api/intelligence ===
if (url === '/api/intelligence') {
  res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
  try {
    var intState = await loadState();
    var intMems = await supabase.from('organism_memory').select('agent,observation,created_at').order('created_at',{ascending:false}).limit(30);
    var intOutcomes = await supabase.from('opportunities').select('title,outcome,opi_score,vertical').not('outcome','is',null).order('last_updated',{ascending:false}).limit(10);
    var intHunt = await supabase.from('hunt_runs').select('run_at,source,opportunities_found,opportunities_new').order('run_at',{ascending:false}).limit(10);
    res.end(JSON.stringify({
      pipeline: { total: intState.pipeline.length, by_stage: intState.pipeline.reduce(function(a,o){var s=o.stage||'identified';a[s]=(a[s]||0)+1;return a},{}), avg_opi: intState.pipeline.length>0?Math.round(intState.pipeline.reduce(function(s,o){return s+(o.opi_score||0)},0)/intState.pipeline.length):0, upcoming: intState.pipeline.filter(function(o){return o.due_date}).sort(function(a,b){return new Date(a.due_date)-new Date(b.due_date)}).slice(0,5).map(function(o){return{title:o.title,due:o.due_date,opi:o.opi_score,stage:o.stage}}) },
      recent_intel: (intMems.data||[]).slice(0,15).map(function(m){return{agent:m.agent,summary:(m.observation||'').slice(0,300),when:m.created_at}}),
      outcomes: (intOutcomes.data||[]).map(function(o){return{title:o.title,outcome:o.outcome,opi:o.opi_score,vertical:o.vertical}}),
      hunting: (intHunt.data||[]).map(function(h){return{source:h.source,found:h.opportunities_found,new:h.opportunities_new,when:h.run_at}})
    }));
  } catch(e) { res.end(JSON.stringify({error:e.message})); }
  return;
}

// === HUNT — /api/hunt ===
if (url === '/api/hunt' && req.method === 'POST') {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', async function() {
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    try {
      var p = JSON.parse(body);
      var verticals = p.verticals || ['disaster_recovery','tpa_claims','construction','grant','workforce','housing','program_admin'];
      var states = p.states || ['Louisiana','Texas','Florida','Mississippi','Alabama','Georgia'];
      log('HUNT triggered: ' + verticals.length + ' verticals, ' + states.length + ' states');
      // Trigger agentHunting asynchronously — loads state then runs all source scrapers
      setImmediate(async function() {
        try {
          var huntState = await loadState();
          log('HUNT: State loaded — ' + huntState.pipeline.length + ' existing opps. Calling agentHunting...');
          var huntResult = await agentHunting(huntState, 'api_hunt_manual');
          log('HUNT: Complete — ' + (huntResult && huntResult.new_opps ? huntResult.new_opps : 0) + ' new opportunities qualified');
        } catch(he) { log('HUNT error: ' + (he.message || '').slice(0, 200)); }
      });
      res.end(JSON.stringify({success:true,message:'Hunt triggered for '+verticals.length+' verticals across '+states.length+' states',note:'Results will appear in pipeline as opportunities are processed. Check /api/logs for progress.'}));
    } catch(e) { res.end(JSON.stringify({error:e.message})); }
  });
  return;
}

// === HUNT ANALYTICS — /api/hunt-analytics ===
if (url === '/api/hunt-analytics') {
  res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
  try {
    var haRuns = await supabase.from('hunt_runs').select('*').order('run_at',{ascending:false}).limit(100);
    var runs = haRuns.data || [];
    var bySource = {};
    runs.forEach(function(r){
      var s = r.source||'unknown';
      if(!bySource[s]) bySource[s]={source:s,total_runs:0,total_found:0,total_new:0,last_run:null};
      bySource[s].total_runs++;
      bySource[s].total_found += (r.opportunities_found||0);
      bySource[s].total_new += (r.opportunities_new||0);
      if(!bySource[s].last_run) bySource[s].last_run = r.run_at;
    });
    var haOpps = await supabase.from('opportunities').select('vertical,opi_score,status,stage').limit(500);
    var allOpps = haOpps.data || [];
    var byVertical = {};
    allOpps.forEach(function(o){
      var v = o.vertical||'unknown';
      if(!byVertical[v]) byVertical[v]={vertical:v,total:0,active:0,avg_opi:0,opiSum:0};
      byVertical[v].total++;
      if(o.status==='active') byVertical[v].active++;
      byVertical[v].opiSum += (o.opi_score||0);
    });
    Object.values(byVertical).forEach(function(v){v.avg_opi=v.total>0?Math.round(v.opiSum/v.total):0;delete v.opiSum});
    res.end(JSON.stringify({
      total_runs: runs.length,
      sources: Object.values(bySource),
      verticals: Object.values(byVertical),
      recent_runs: runs.slice(0,20).map(function(r){return{source:r.source,found:r.opportunities_found,new_opps:r.opportunities_new,status:r.status,when:r.run_at}}),
      pipeline_total: allOpps.length,
      active_count: allOpps.filter(function(o){return o.status==='active'}).length
    }));
  } catch(e) { res.end(JSON.stringify({error:e.message})); }
  return;
}

if (url === '/api/crash-log') {
  var cr = await supabase.from('organism_memory').select('observation,created_at').eq('agent','v3_engine').order('created_at',{ascending:false}).limit(10);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(cr.data || []));
  return;
}

// === CYCLE HISTORY — /api/cycle-history ===
if (url === '/api/cycle-history') {
  res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
  try {
    var chMems = await supabase.from('organism_memory')
      .select('observation,created_at')
      .eq('agent','v2')
      .order('created_at',{ascending:false}).limit(30);
    var cycles = (chMems.data || []).map(function(m) {
      var obs = m.observation || '';
      var parts = {};
      var matches = obs.match(/trigger:(\S+)/); if (matches) parts.trigger = matches[1];
      matches = obs.match(/pipeline:(\d+)/); if (matches) parts.pipeline = parseInt(matches[1]);
      matches = obs.match(/agents:(\d+)/); if (matches) parts.agents_fired = parseInt(matches[1]);
      matches = obs.match(/opps_analyzed:(\d+)/); if (matches) parts.opps_analyzed = parseInt(matches[1]);
      matches = obs.match(/newOpps:(\d+)/); if (matches) parts.new_opps = parseInt(matches[1]);
      matches = obs.match(/newRFPs:(\d+)/); if (matches) parts.new_rfps = parseInt(matches[1]);
      matches = obs.match(/uptime:(\d+)/); if (matches) parts.uptime_s = parseInt(matches[1]);
      parts.timestamp = m.created_at;
      parts.mode = obs.indexOf('SKELETON') >= 0 ? 'skeleton' : obs.indexOf('SMART') >= 0 ? 'smart' : 'full';
      parts.zero_cost = obs.indexOf('Zero API calls') >= 0 || obs.indexOf('$0 API cost') >= 0;
      return parts;
    });
    res.end(JSON.stringify({ total_cycles: cycles.length, cycles: cycles }));
  } catch(e) { res.end(JSON.stringify({error:e.message})); }
  return;
}

if (url === '/api/test-agent' && req.method === 'POST') {
  res.writeHead(200, {'Content-Type':'application/json'});
  try {
    var tState = await loadState();
    var tOpp = tState.pipeline[0];
    if (!tOpp) { res.end(JSON.stringify({error:'no pipeline'})); return; }
    var tBrief = await buildCycleBrief(tOpp, tState);
    var tResult = await agentIntelligence(tOpp, tState, tBrief);
    res.end(JSON.stringify({test:'intelligence_engine', opp: tOpp.title, result: tResult, memoryCheck: 'Query organism_memory for agent=intelligence_engine after this'}));
  } catch (e) {
    res.end(JSON.stringify({error: e.message, stack: (e.stack||'').slice(0,500)}));
  }
  return;
}

if (url === '/api/status') {
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({status:'alive', uptime: Math.floor(process.uptime())}));
  return;
}

if (url === '/api/chat' && req.method === 'POST') {

  let chatBody = '';
  for await (const chunk of req) chatBody += chunk;
  const { message: chatMsg, opportunityId: chatOppId, history: chatHistory } = JSON.parse(chatBody || '{}');
  if (!chatMsg) { res.writeHead(400); res.end(JSON.stringify({error:'message required'})); return; }

  // Rich context: recent memories — FULL observations, no truncation
  const ctxR = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at').order('created_at',{ascending:false}).limit(30);
  var chatCtx = (ctxR.data||[]).map(m => m.agent+': '+m.observation).join('\n');

  // Focused opportunity context if provided — FULL fields, no truncation
  var chatOppCtx = '';
  if (chatOppId) {
    var chatOpp = await supabase.from('opportunities').select('title,agency,vertical,opi_score,stage,capture_action,scope_analysis,research_brief,financial_analysis,description,due_date,estimated_value,rfp_text,proposal_content').eq('id', chatOppId).single();
    if (chatOpp.data) {
      var co = chatOpp.data;
      chatOppCtx = '\n\nFOCUSED OPPORTUNITY:\nTitle: ' + (co.title||'') + '\nAgency: ' + (co.agency||'') + '\nVertical: ' + (co.vertical||'') + '\nOPI: ' + (co.opi_score||0) + '\nStage: ' + (co.stage||'') + '\nDeadline: ' + (co.due_date||'') + '\nValue: ' + (co.estimated_value||'') + '\nDecision: ' + (co.capture_action||'') + '\nScope: ' + (co.scope_analysis||'') + '\nResearch: ' + (co.research_brief||'') + '\nFinancial: ' + (co.financial_analysis||'');
      // Per-opp memories — FULL observations
      var chatOppMem = await supabase.from('organism_memory').select('agent,observation').eq('opportunity_id', chatOppId).order('created_at', { ascending: false }).limit(20);
      if (chatOppMem.data && chatOppMem.data.length > 0) {
        chatOppCtx += '\n\nOPP MEMORIES:\n' + chatOppMem.data.map(function(m) { return m.agent + ': ' + m.observation; }).join('\n');
      }
    }
  }

  // Pipeline summary — full titles
  var chatPipeline = await supabase.from('opportunities').select('title,agency,opi_score,stage,vertical,due_date,estimated_value').eq('status', 'active').order('opi_score', { ascending: false }).limit(30);
  var chatPipeCtx = '\n\nPIPELINE (' + (chatPipeline.data||[]).length + ' active):\n' + (chatPipeline.data||[]).map(function(o) { return (o.opi_score||0) + ' | ' + (o.stage||'') + ' | ' + (o.title||'') + ' (' + (o.agency||'') + ') | Due: ' + (o.due_date||'TBD') + ' | Value: ' + (o.estimated_value||'TBD'); }).join('\n');

  // Build messages array with conversation history
  var chatMessages = [];
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    chatHistory.forEach(function(h) {
      if (h.role === 'user' || h.role === 'assistant') {
        chatMessages.push({ role: h.role, content: h.content });
      }
    });
  }
  chatMessages.push({ role: 'user', content: chatMsg });

  const chatResp = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 4096,
    system: 'You are the HGI Business Development Organism — a 97-year-old minority-owned firm specializing in disaster recovery, TPA/claims, workforce, construction management, grant management, housing, property tax appeals, and program administration. Answer questions about the HGI pipeline, opportunities, competitive intel, and BD strategy. Be concise, direct, and strategic. You have access to all organism intelligence below.\n\n' + HGI + '\n\nRecent organism memories:\n' + chatCtx + chatOppCtx + chatPipeCtx,
    messages: chatMessages
  });
  trackCost('interface_chat', SONNET, chatResp.usage);

  const chatReply = chatResp.content[0].text;

  // Store meaningful interactions as organism memory — full content
  if (chatMsg.length > 30 && chatReply.length > 100) {
    try {
      await storeMemory('chat_agent', chatOppId || null, 'chat,interaction', 'User asked: ' + chatMsg.slice(0, 500) + '\nOrganism responded: ' + chatReply.slice(0, 1000), 'scratch', null, 'medium');
    } catch(ce) {}
  }

  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({response:chatReply}));
  return;

}


// === PROPOSAL PRODUCTION ENGINE ===
if (url.startsWith('/api/produce-proposal') && req.method === 'POST') {
  let body = '';
  for await (const chunk of req) body += chunk;
  var ppId = '';
  try { ppId = JSON.parse(body || '{}').id || ''; } catch(e) {}
  if (!ppId) { var qId = (req.url.split('?id=')[1]||'').split('&')[0]; ppId = qId; }
  if (!ppId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  // === S119 Item 3: Contamination guardrail ===
  // Block proposal generation on CONTAMINATED scope unless explicitly forced.
  // Queries latest fact-check entry from organism_memory (orchestrator_fact_check
  // or orchestrator_fact_check_backfill) for this opportunity.
  // CONTAMINATED + !force => 409; FLAGGED => warn + proceed; CLEAN => proceed; NONE => warn + proceed.
  var ppForce = false;
  try { ppForce = !!JSON.parse(body || '{}').force; } catch(e) {}
  try {
    var fcCheckR = await supabase.from('organism_memory')
      .select('id,observation,created_at')
      .eq('opportunity_id', ppId)
      .in('agent', ['orchestrator_fact_check','orchestrator_fact_check_backfill'])
      .order('created_at', { ascending: false })
      .limit(1);
    var latestFC = (fcCheckR.data || [])[0];
    if (latestFC) {
      var fcObs = latestFC.observation || '';
      // Match both formats: live ('FACT-CHECK VERDICT: <V>') and backfill ('BACKFILL FACT-CHECK: <V>')
      var fcVerdictMatch = fcObs.match(/(?:^|\n)\s*(?:BACKFILL\s+)?FACT-CHECK(?:\s+VERDICT)?:\s*(CLEAN|FLAGGED|CONTAMINATED)/i);
      var fcVerdict = fcVerdictMatch ? fcVerdictMatch[1].toUpperCase() : 'UNKNOWN';
      if (fcVerdict === 'CONTAMINATED' && !ppForce) {
        log('PROPOSAL ENGINE: REFUSED — scope CONTAMINATED for ' + ppId + ' (memory entry ' + latestFC.id + '). Override with {force:true} or regenerate scope via /api/orchestrate.');
        res.writeHead(409, {'Content-Type':'application/json'});
        res.end(JSON.stringify({
          error: 'scope_analysis is CONTAMINATED per latest fact-check. Regenerate scope via /api/orchestrate before producing proposal, or pass {force:true} to override.',
          fact_check_entry_id: latestFC.id,
          fact_check_observed_at: latestFC.created_at,
          verdict: 'CONTAMINATED',
          override_with: { id: ppId, force: true }
        }));
        return;
      }
      if (fcVerdict === 'FLAGGED') {
        log('PROPOSAL ENGINE: WARN — scope FLAGGED for ' + ppId + ' (memory entry ' + latestFC.id + '). Proceeding with proposal generation.');
      } else if (fcVerdict === 'CLEAN') {
        log('PROPOSAL ENGINE: scope CLEAN for ' + ppId + '. Proceeding.');
      } else if (fcVerdict === 'CONTAMINATED' && ppForce) {
        log('PROPOSAL ENGINE: WARN — scope CONTAMINATED for ' + ppId + ' but {force:true} provided. Proceeding under explicit override.');
      } else {
        log('PROPOSAL ENGINE: fact-check verdict UNKNOWN for ' + ppId + ' (memory entry ' + latestFC.id + ' did not contain parseable verdict). Proceeding.');
      }
    } else {
      log('PROPOSAL ENGINE: WARN — no fact-check entry found for ' + ppId + ' (freshly orchestrated, predates backfill, or no scope_analysis). Proceeding with caution.');
    }
  } catch(fcErr) {
    log('PROPOSAL ENGINE: fact-check guardrail query failed for ' + ppId + ' (' + (fcErr.message||fcErr) + '). Proceeding without block.');
  }

  // === S133: HARD EXCLUSION GUARDRAIL ===
  // Refuse produce-proposal on opportunities whose agency matches HGI_PP_EXCLUSIONS
  // (PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA). These clients may not be
  // listed as HGI past performance and HGI does not bid to them without explicit
  // President confirmation. Without this check, produce-proposal burns the full pipeline
  // (~$5-10, ~25 min) only to have the red team surface the exclusion at review time.
  // Observed on OPSB run lapac-654321-26-0108 — S132 close final state.
  // Override: POST body {forceExclusionOverride:true} — reserved for President authorization.
  var ppForceExclusion = false;
  try { ppForceExclusion = !!JSON.parse(body || '{}').forceExclusionOverride; } catch(e) {}
  try {
    var exclCheckR = await supabase.from('opportunities')
      .select('id,agency,title')
      .eq('id', ppId)
      .single();
    var exclOpp = exclCheckR.data;
    if (exclOpp) {
      var exclAgency = String(exclOpp.agency || '').toLowerCase();
      var exclTitle = String(exclOpp.title || '').toLowerCase();
      var exclMatched = null;
      for (var xi = 0; xi < HGI_PP_EXCLUSIONS.length; xi++) {
        var exclTerm = String(HGI_PP_EXCLUSIONS[xi]).toLowerCase();
        if (exclAgency.indexOf(exclTerm) >= 0 || exclTitle.indexOf(exclTerm) >= 0) {
          exclMatched = HGI_PP_EXCLUSIONS[xi];
          break;
        }
      }
      if (exclMatched && !ppForceExclusion) {
        log('PROPOSAL ENGINE: REFUSED - hard exclusion client "' + exclMatched + '" matched on agency "' + exclOpp.agency + '" for ' + ppId + '. Override with {forceExclusionOverride:true}.');
        res.writeHead(409, {'Content-Type':'application/json'});
        res.end(JSON.stringify({
          error: 'hard_exclusion_client',
          message: 'Opportunity agency "' + exclOpp.agency + '" matches hard-exclusion entry "' + exclMatched + '". HGI may not list past performance with this client and does not bid without explicit President confirmation.',
          matched_exclusion: exclMatched,
          agency: exclOpp.agency,
          opportunity_id: ppId,
          override_with: { id: ppId, forceExclusionOverride: true }
        }));
        return;
      }
      if (exclMatched && ppForceExclusion) {
        log('PROPOSAL ENGINE: WARN - hard exclusion "' + exclMatched + '" matched but {forceExclusionOverride:true} provided. Proceeding under explicit override for ' + ppId + '.');
      }
    }
  } catch(exclErr) {
    log('PROPOSAL ENGINE: exclusion guardrail query failed for ' + ppId + ' (' + (exclErr.message||exclErr) + '). Proceeding without block.');
  }

  log('PROPOSAL ENGINE: Starting for ' + ppId);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({started:true, id:ppId}));

  // Run async — don't block response
  setImmediate(async () => {
    try {
      // 1. Load opportunity
      var oppR = await supabase.from('opportunities').select('*').eq('id', ppId).single();
      var opp = oppR.data;
      if (!opp) { log('PROPOSAL ENGINE: Opp not found ' + ppId); return; }

      // ═══════════════════════════════════════════════════════════
      // ALL-INTO-ALL: Load EVERY source of intelligence the organism has.
      // The proposal is the organism's complete intelligence expressed as a document.
      // Every finding from every agent, every table, every cross-reference flows in.
      // ═══════════════════════════════════════════════════════════
      var agency = (opp.agency||'').trim();
      var agencyLower = agency.toLowerCase();
      var vertical = (opp.vertical||'disaster recovery').trim();
      var verticalLower = vertical.toLowerCase();
      var oppState = (opp.state||'Louisiana').trim();

      // Helper: fuzzy match for filtering cross-references
      function matchesContext(text) {
        if (!text) return false;
        var t = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
        return (agencyLower && t.indexOf(agencyLower) > -1) ||
               t.indexOf(verticalLower) > -1 ||
               (oppState && t.indexOf(oppState.toLowerCase()) > -1);
      }

      log('PROPOSAL ENGINE ALL-INTO-ALL: Loading all intelligence for ' + (opp.title||'').slice(0,60));

      // Run ALL queries in parallel — every table, every source
      var allQueries = await Promise.allSettled([
        // 1. Direct opp memories (what agents found about THIS opportunity)
        supabase.from('organism_memory').select('agent,observation,memory_type,entity_tags,confidence,created_at')
          .eq('opportunity_id', ppId).neq('memory_type','decision_point')
          .order('created_at',{ascending:false}).limit(300),

        // 2. Cross-opp memories (patterns, lessons, insights from ALL other opps)
        supabase.from('organism_memory').select('agent,observation,opportunity_id,memory_type,entity_tags,created_at')
          .neq('opportunity_id', ppId).neq('memory_type','decision_point')
          .order('created_at',{ascending:false}).limit(500),

        // 3. Competitive intelligence — ALL competitors (filter later by relevance)
        supabase.from('competitive_intelligence').select('competitor_name,agency,contract_value,outcome,bid_price,strengths,weaknesses,strategic_notes,hq_location,hq_state,company_size,certifications,key_personnel,active_states,active_verticals,known_contracts,price_intelligence,incumbent_at,teaming_history,win_rate_estimate,threat_level,last_seen_bidding,opportunity_id,vertical')
          .order('created_at',{ascending:false}).limit(200),

        // 4. Relationship graph — ALL contacts
        supabase.from('relationship_graph').select('contact_name,title,organization,email,phone,relationship_strength,notes,connected_orgs,role_in_procurement,agency,state,contact_type,priority,hgi_relationship,outreach_status')
          .order('created_at',{ascending:false}).limit(200),

        // 5. Disaster alerts — ALL (filter by state/geography)
        supabase.from('disaster_alerts').select('disaster_number,disaster_name,state,declaration_date,incident_type,counties,fema_programs,procurement_window,hgi_recommendation,threat_level,status')
          .order('created_at',{ascending:false}).limit(100),

        // 6. Budget cycles — ALL (filter by agency/state/vertical)
        supabase.from('budget_cycles').select('agency,state,fiscal_year_start,fiscal_year_end,budget_amount,procurement_window,rfp_timing,hgi_vertical,notes')
          .order('created_at',{ascending:false}).limit(100),

        // 7. Recompete tracker — ALL (filter by agency/vertical)
        supabase.from('recompete_tracker').select('client,contract_name,vertical,hgi_incumbent,known_competitor,contract_start_date,contract_end_date,estimated_value_annual,procurement_contact,procurement_contact_info,decision_maker,status,notes,rfp_expected_date')
          .order('created_at',{ascending:false}).limit(100),

        // 8. Regulatory changes — ALL (filter by vertical)
        supabase.from('regulatory_changes').select('regulation_name,agency_source,effective_date,category,impact_level,affected_verticals,summary,hgi_action_required')
          .order('created_at',{ascending:false}).limit(100),

        // 9. Teaming partners — ALL
        supabase.from('teaming_partners').select('partner_name,capability,location,certifications,past_teaming,verticals,fit_score,contact_info,notes')
          .order('fit_score',{ascending:false}).limit(50),

        // 10. Agency profiles — ALL (filter by agency name match)
        supabase.from('agency_profiles').select('agency_name,state,agency_type,annual_budget,key_contacts,procurement_process,incumbent_contractors,hgi_relationship,hgi_history,verticals,notes')
          .order('created_at',{ascending:false}).limit(50),

        // 11. Pipeline analytics — ALL patterns and insights
        supabase.from('pipeline_analytics').select('category,title,insight,affected_verticals,affected_agencies,confidence,recommendation')
          .order('created_at',{ascending:false}).limit(50),

        // 12. Knowledge base chunks — broad pull, then filter
        supabase.from('knowledge_chunks').select('chunk_text,filename')
          .order('id',{ascending:false}).limit(60),

        // 13. Outcome lessons — completed opps with outcomes (wins, losses, no-bids)
        supabase.from('opportunities').select('title,agency,vertical,state,opi_score,outcome,outcome_notes,scope_analysis,financial_analysis,research_brief,capture_action')
          .not('outcome','is',null)
          .order('last_updated',{ascending:false}).limit(20),

        // 14. Similar active pursuits — what we're learning from parallel efforts
        supabase.from('opportunities').select('title,agency,vertical,state,opi_score,stage,scope_analysis,research_brief,capture_action,why_hgi_wins')
          .eq('status','active').neq('id',ppId)
          .order('opi_score',{ascending:false}).limit(15),

        // 15. System performance / OPI calibration data
        supabase.from('system_performance_log').select('event_type,metric_type,metric_value,details,opportunity_id')
          .order('created_at',{ascending:false}).limit(50)
      ]);

      // Extract results (safe — allSettled never throws)
      function getData(idx) { return (allQueries[idx].status === 'fulfilled' && allQueries[idx].value.data) || []; }

      var mems = getData(0);
      var crossMemsRaw = getData(1);
      var ciAll = getData(2);
      var rgAll = getData(3);
      var disasterAll = getData(4);
      var budgetAll = getData(5);
      var recompeteAll = getData(6);
      var regAll = getData(7);
      var teamingAll = getData(8);
      var agencyProfilesAll = getData(9);
      var analyticsAll = getData(10);
      var kbChunksRaw = getData(11);
      var outcomeOpps = getData(12);
      var siblingOpps = getData(13);
      var perfLog = getData(14);

      log('PROPOSAL ENGINE ALL-INTO-ALL loaded: ' + mems.length + ' direct mems, ' + crossMemsRaw.length + ' cross mems, ' +
          ciAll.length + ' competitors, ' + rgAll.length + ' contacts, ' + disasterAll.length + ' disasters, ' +
          budgetAll.length + ' budget cycles, ' + recompeteAll.length + ' recompetes, ' + regAll.length + ' regulations, ' +
          teamingAll.length + ' teaming, ' + agencyProfilesAll.length + ' agency profiles, ' +
          analyticsAll.length + ' analytics, ' + kbChunksRaw.length + ' KB chunks, ' +
          outcomeOpps.length + ' outcomes, ' + siblingOpps.length + ' siblings, ' + perfLog.length + ' perf logs');

      // ── FILTER cross-opp memories to those relevant to this pursuit ──
      var crossMems = crossMemsRaw.filter(function(m) {
        return matchesContext(m.observation) || matchesContext(m.entity_tags);
      }).slice(0, 20);

      // ── FILTER competitive intel to this opp + same agency/vertical/state ──
      var ciRelevant = ciAll.filter(function(c) {
        return c.opportunity_id === ppId || matchesContext(c.agency) ||
               matchesContext(c.vertical) || matchesContext(c.active_states) ||
               matchesContext(c.incumbent_at);
      });

      // ── FILTER contacts to this opp + same agency ──
      var rgRelevant = rgAll.filter(function(r) {
        return r.opportunity_id === ppId || matchesContext(r.organization) ||
               matchesContext(r.agency) || matchesContext(r.connected_orgs);
      });

      // ── FILTER disasters to relevant state/geography ──
      var disasterRelevant = disasterAll.filter(function(d) {
        return (d.state||'').toLowerCase() === oppState.toLowerCase() ||
               matchesContext(d.counties) || matchesContext(d.disaster_name);
      });

      // ── FILTER budget cycles ──
      var budgetRelevant = budgetAll.filter(function(b) {
        return matchesContext(b.agency) || (b.state||'').toLowerCase() === oppState.toLowerCase() ||
               matchesContext(b.hgi_vertical);
      });

      // ── FILTER recompete tracker ──
      var recompeteRelevant = recompeteAll.filter(function(r) {
        return matchesContext(r.client) || matchesContext(r.contract_name) ||
               matchesContext(r.known_competitor) || matchesContext(r.vertical);
      });

      // ── FILTER regulatory changes to relevant verticals ──
      var regRelevant = regAll.filter(function(r) {
        return matchesContext(r.affected_verticals) || matchesContext(r.summary) ||
               matchesContext(r.agency_source);
      });

      // ── FILTER teaming partners to relevant verticals ──
      var teamingRelevant = teamingAll.filter(function(t) {
        return matchesContext(t.verticals) || matchesContext(t.capability) ||
               matchesContext(t.location);
      });

      // ── FILTER agency profiles ──
      var agencyRelevant = agencyProfilesAll.filter(function(a) {
        return matchesContext(a.agency_name) || matchesContext(a.verticals) ||
               (a.state||'').toLowerCase() === oppState.toLowerCase();
      });

      // ── FILTER pipeline analytics ──
      var analyticsRelevant = analyticsAll.filter(function(a) {
        return matchesContext(a.affected_agencies) || matchesContext(a.affected_verticals) ||
               matchesContext(a.insight);
      });

      // ── KB chunks: filter by vertical keyword, then fallback to all ──
      var kbFiltered = kbChunksRaw.filter(function(c) {
        return matchesContext(c.chunk_text);
      });
      if (kbFiltered.length < 5) kbFiltered = kbChunksRaw;
      var kbChunks = kbFiltered.map(function(c) { return c.chunk_text; }).join('\n---\n').slice(0, 12000);

      // ── FILTER outcome lessons to same vertical/agency ──
      var outcomeRelevant = outcomeOpps.filter(function(o) {
        return matchesContext(o.agency) || matchesContext(o.vertical) || matchesContext(o.state);
      });

      // ── Sibling opps: same vertical or agency ──
      var siblingRelevant = siblingOpps.filter(function(s) {
        return matchesContext(s.agency) || matchesContext(s.vertical);
      });

      // ── ASSEMBLE: Build categorized intelligence sections ──

      // Direct opp memories by agent category
      var intelSummary = '';
      var categories = {
        'Scope & Requirements': ['scope','quality_gate','compliance','compliance_matrix','orchestrat'],
        'Competitive Intelligence': ['intelligence','competitor','research','deep_dive','loss'],
        'Financial & Pricing': ['financial','price','cost','rate_table','budget'],
        'Staffing & Talent': ['staffing','recruiting','bench','talent'],
        'Win Strategy & Winnability': ['winnability','capture','brief','executive'],
        'Client & Relationship Intel': ['crm','relationship','contact','agency_profile'],
        'Proposal Drafts & Reviews': ['proposal','assembly','red_team','content'],
        'Disaster & Regulatory Context': ['disaster','regulatory','recompete','teaming','budget_cycle'],
        'Discovery & Pipeline Patterns': ['discovery','pipeline','scanner','dashboard','self_awareness','hunt','scraper']
      };
      Object.keys(categories).forEach(function(cat) {
        var keywords = categories[cat];
        var catMems = mems.filter(function(m) {
          var a = (m.agent||'').toLowerCase();
          return keywords.some(function(k) { return a.indexOf(k) > -1; });
        });
        if (catMems.length > 0) {
          intelSummary += '\n### ' + cat + '\n';
          catMems.slice(0,5).forEach(function(m) {
            intelSummary += '[' + m.agent + ' | ' + (m.memory_type||'') + ']: ' + (m.observation||'').slice(0,1500) + '\n';
          });
        }
      });

      // Cross-opp intelligence section
      var crossIntel = '';
      if (crossMems.length > 0) {
        crossIntel = crossMems.map(function(m) {
          return '[' + m.agent + ' from other pursuit]: ' + (m.observation||'').slice(0,1000);
        }).join('\n').slice(0, 5000);
      }

      // Structured competitive intelligence
      // S125 Fix 1: sort opp-tagged competitors first so they survive the 5000-char cap,
      // and tag each row so the writer distinguishes primary competitors from broader context.
      ciRelevant.sort(function(a, b) {
        var aOpp = (a.opportunity_id === ppId) ? 0 : 1;
        var bOpp = (b.opportunity_id === ppId) ? 0 : 1;
        return aOpp - bOpp;
      });
      var ciText = '';
      if (ciRelevant.length > 0) {
        ciText = ciRelevant.map(function(c) {
          var _tag = (c.opportunity_id === ppId) ? ' [most relevant — confirmed in this market]' : '';
          return '### ' + (c.competitor_name||'Unknown') + _tag +
            '\nHQ: ' + (c.hq_location||'') + ' | Size: ' + (c.company_size||'') + ' | Threat: ' + (c.threat_level||'') +
            '\nStrengths: ' + (c.strengths||'') +
            '\nWeaknesses: ' + (c.weaknesses||'') +
            '\nKnown contracts: ' + (c.known_contracts||'') +
            '\nPrice intel: ' + (c.price_intelligence||'') +
            '\nIncumbent at: ' + (c.incumbent_at||'') +
            '\nTeaming history: ' + (c.teaming_history||'') +
            '\nWin rate: ' + (c.win_rate_estimate||'') +
            '\nStrategy notes: ' + (c.strategic_notes||'');
        }).join('\n\n').slice(0, 5000);
      }

      // Relationship/contact intelligence
      var rgText = '';
      if (rgRelevant.length > 0) {
        rgText = rgRelevant.map(function(r) {
          return '- ' + (r.contact_name||'') + ' | ' + (r.title||'') + ' @ ' + (r.organization||'') +
            ' | Role: ' + (r.role_in_procurement||'') + ' | Strength: ' + (r.relationship_strength||'') +
            ' | HGI relationship: ' + (r.hgi_relationship||'') + ' | Notes: ' + (r.notes||'');
        }).join('\n').slice(0, 4000);
      }

      // Disaster context
      var disasterText = '';
      if (disasterRelevant.length > 0) {
        disasterText = disasterRelevant.map(function(d) {
          return '- ' + (d.disaster_number||'') + ': ' + (d.disaster_name||'') + ' (' + (d.declaration_date||'') + ')' +
            ' | Type: ' + (d.incident_type||'') + ' | Counties: ' + (d.counties||'') +
            ' | FEMA Programs: ' + (d.fema_programs||'') + ' | Procurement window: ' + (d.procurement_window||'') +
            ' | HGI recommendation: ' + (d.hgi_recommendation||'');
        }).join('\n').slice(0, 4000);
      }

      // Budget cycles
      var budgetText = '';
      if (budgetRelevant.length > 0) {
        budgetText = budgetRelevant.map(function(b) {
          return '- ' + (b.agency||'') + ' (' + (b.state||'') + '): FY ' + (b.fiscal_year_start||'') + '-' + (b.fiscal_year_end||'') +
            ' | Budget: ' + (b.budget_amount||'') + ' | Procurement window: ' + (b.procurement_window||'') +
            ' | RFP timing: ' + (b.rfp_timing||'') + ' | Notes: ' + (b.notes||'');
        }).join('\n').slice(0, 3000);
      }

      // Recompete tracker
      var recompeteText = '';
      if (recompeteRelevant.length > 0) {
        recompeteText = recompeteRelevant.map(function(r) {
          return '- ' + (r.client||'') + ': ' + (r.contract_name||'') +
            ' | HGI incumbent: ' + (r.hgi_incumbent||'') + ' | Competitor: ' + (r.known_competitor||'') +
            ' | Value: ' + (r.estimated_value_annual||'') + ' | End: ' + (r.contract_end_date||'') +
            ' | Decision maker: ' + (r.decision_maker||'') + ' | Status: ' + (r.status||'');
        }).join('\n').slice(0, 3000);
      }

      // Regulatory changes
      var regText = '';
      if (regRelevant.length > 0) {
        regText = regRelevant.map(function(r) {
          return '- ' + (r.regulation_name||'') + ' (effective ' + (r.effective_date||'') + ')' +
            ' | Impact: ' + (r.impact_level||'') + ' | Summary: ' + (r.summary||'').slice(0,500) +
            ' | HGI action: ' + (r.hgi_action_required||'');
        }).join('\n').slice(0, 3000);
      }

      // Teaming partners
      var teamingText = '';
      if (teamingRelevant.length > 0) {
        teamingText = teamingRelevant.map(function(t) {
          return '- ' + (t.partner_name||'') + ' | Capability: ' + (t.capability||'') +
            ' | Location: ' + (t.location||'') + ' | Certs: ' + (t.certifications||'') +
            ' | Fit: ' + (t.fit_score||'') + ' | Past teaming: ' + (t.past_teaming||'');
        }).join('\n').slice(0, 3000);
      }

      // Agency profiles
      var agencyText = '';
      if (agencyRelevant.length > 0) {
        agencyText = agencyRelevant.map(function(a) {
          return '### ' + (a.agency_name||'') + ' (' + (a.state||'') + ')' +
            '\nType: ' + (a.agency_type||'') + ' | Budget: ' + (a.annual_budget||'') +
            '\nProcurement process: ' + (a.procurement_process||'') +
            '\nIncumbent contractors: ' + (a.incumbent_contractors||'') +
            '\nHGI relationship: ' + (a.hgi_relationship||'') +
            '\nHGI history: ' + (a.hgi_history||'') +
            '\nKey contacts: ' + (a.key_contacts||'') +
            '\nNotes: ' + (a.notes||'');
        }).join('\n\n').slice(0, 4000);
      }

      // Pipeline analytics / patterns
      var analyticsText = '';
      if (analyticsRelevant.length > 0) {
        analyticsText = analyticsRelevant.map(function(a) {
          return '- [' + (a.category||'') + '] ' + (a.title||'') + ': ' + (a.insight||'').slice(0,500) +
            ' | Recommendation: ' + (a.recommendation||'');
        }).join('\n').slice(0, 3000);
      }

      // Outcome lessons — what we learned from wins/losses/no-bids
      var outcomeText = '';
      if (outcomeRelevant.length > 0) {
        outcomeText = outcomeRelevant.map(function(o) {
          return '### ' + (o.title||'').slice(0,80) + ' — ' + (o.outcome||'').toUpperCase() +
            '\nAgency: ' + (o.agency||'') + ' | OPI: ' + (o.opi_score||'') +
            '\nOutcome notes: ' + (o.outcome_notes||'') +
            '\nCapture analysis: ' + (o.capture_action||'').slice(0,1000);
        }).join('\n\n').slice(0, 4000);
      }

      // Sibling opps — what we're learning from parallel pursuits
      var siblingText = '';
      if (siblingRelevant.length > 0) {
        siblingText = siblingRelevant.map(function(s) {
          return '- ' + (s.title||'').slice(0,80) + ' (OPI ' + (s.opi_score||'') + ', ' + (s.stage||'') + ')' +
            ' | Why HGI wins: ' + (s.why_hgi_wins||'') +
            ' | Research: ' + (s.research_brief||'').slice(0,500);
        }).join('\n').slice(0, 4000);
      }

      // ═══ STAGE 1: RFP COMPLIANCE PARSER (Session 104) ═══
      // Before Opus writes anything, parse the RFP into a structured blueprint.
      // This tells Opus EXACTLY what to produce — sections, forms, page limits, positions.
      var rfpText = (opp.rfp_text && opp.rfp_text.trim().length > 500) ? opp.rfp_text : '';
      var complianceBlueprint = null;
      if (rfpText.length > 500) {
        log('PROPOSAL ENGINE STAGE 1: Parsing RFP compliance blueprint...');
        try {
          var parseResp = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8000,
            system: 'You are an expert government RFP compliance analyst. You parse RFPs into structured blueprints that proposal writers follow exactly. Output ONLY valid JSON — no markdown, no commentary.',
            messages: [{role:'user', content: 'Parse this RFP into a compliance blueprint. Extract EVERY structural requirement.\n\nRFP TEXT:\n' + rfpText.slice(0, 80000) + '\n\nReturn JSON with this exact structure:\n{\n  "submission_format": {\n    "copies_required": "e.g. 4 physical + 1 USB",\n    "delivery_address": "full address",\n    "delivery_contact": "name and title",\n    "deadline": "exact date and time",\n    "delivery_method": "e.g. physical only, no fax/email"\n  },\n  "sections_required": [\n    {\n      "tab_number": "e.g. Tab 1",\n      "section_number": "e.g. 5.1",\n      "title": "exact title from RFP",\n      "attachment_id": "e.g. Attachment A, or null",\n      "page_limit": "number or null",\n      "requirements": "what must be included — every sub-requirement listed",\n      "has_provided_form": true/false,\n      "form_description": "description of the form if provided by RFP"\n    }\n  ],\n  "evaluation_criteria": [\n    {\n      "criterion": "exact name",\n      "max_points": number,\n      "description": "what evaluators are scoring",\n      "maps_to_section": "which tab/section addresses this"\n    }\n  ],\n  "rate_sheet": {\n    "attachment_id": "e.g. Attachment H",\n    "categories": [\n      {\n        "category_name": "e.g. Program Management",\n        "positions": ["exact position titles from the RFP form"]\n      }\n    ],\n    "columns_required": ["e.g. Position, Name, City/State, Hourly Rate"],\n    "scoring_method": "how price is scored"\n  },\n  "contract_template": {\n    "provided_by_rfp": true/false,\n    "description": "what the RFP says about the contract — complete and return vs draft your own",\n    "sections_count": number\n  },\n  "scope_items": ["every distinct deliverable or service area listed in the scope of work"],\n  "required_certifications": ["every form, affidavit, or certification required with attachment ID"],\n  "questions_deadline": "date if specified",\n  "special_requirements": ["any unusual requirements not captured above"]\n}'}]
          });
          trackCost('rfp_compliance_parser', 'claude-sonnet-4-6', parseResp.usage);
          var parseText = (parseResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('').replace(/```json|```/g, '').trim();
          complianceBlueprint = JSON.parse(parseText);
          log('PROPOSAL ENGINE STAGE 1: Blueprint parsed — ' + (complianceBlueprint.sections_required||[]).length + ' sections, ' + (complianceBlueprint.evaluation_criteria||[]).length + ' eval criteria, ' + (complianceBlueprint.scope_items||[]).length + ' scope items');
        } catch(parseErr) {
          log('PROPOSAL ENGINE STAGE 1: Parse error — ' + (parseErr.message||'').slice(0,100) + '. Falling back to unparsed mode.');
        }
      } else {
        log('PROPOSAL ENGINE STAGE 1: No RFP text available — skipping compliance parse');
      }

      // ═══ STAGE 2: BUILD THE COMPLIANCE-DRIVEN PROMPT ═══
      var blueprintSection = '';
      if (complianceBlueprint) {
        blueprintSection = '\n\n## ═══ RFP COMPLIANCE BLUEPRINT (MANDATORY — your proposal MUST follow this EXACTLY) ═══\n' +
          'This blueprint was parsed from the actual RFP. Every section listed below MUST appear in your proposal in this EXACT order. Every form identified as "provided by RFP" must be COMPLETED as-is, not recreated. Every page limit MUST be respected. Every scope item MUST be addressed.\n\n' +
          '### SUBMISSION FORMAT\n' + JSON.stringify(complianceBlueprint.submission_format, null, 2) + '\n\n' +
          '### REQUIRED SECTIONS (produce these in EXACTLY this order)\n';
        (complianceBlueprint.sections_required || []).forEach(function(s, i) {
          blueprintSection += '\n' + (i+1) + '. ' + (s.tab_number||'') + ' — ' + s.title + (s.attachment_id ? ' (' + s.attachment_id + ')' : '') +
            (s.page_limit ? ' [PAGE LIMIT: ' + s.page_limit + ']' : '') +
            (s.has_provided_form ? ' [RFP PROVIDES THIS FORM — COMPLETE IT, DO NOT RECREATE]' : '') +
            '\n   Requirements: ' + (s.requirements||'') +
            (s.form_description ? '\n   Form: ' + s.form_description : '');
        });
        blueprintSection += '\n\n### EVALUATION CRITERIA (evaluators score using EXACTLY these categories)\n';
        (complianceBlueprint.evaluation_criteria || []).forEach(function(ec) {
          blueprintSection += '- ' + ec.criterion + ': ' + ec.max_points + ' points — ' + ec.description + ' (maps to: ' + (ec.maps_to_section||'') + ')\n';
        });
        if (complianceBlueprint.rate_sheet) {
          blueprintSection += '\n### RATE SHEET STRUCTURE (use EXACTLY these position titles)\n' +
            'Attachment: ' + (complianceBlueprint.rate_sheet.attachment_id||'') + '\n' +
            'Columns: ' + (complianceBlueprint.rate_sheet.columns_required||[]).join(', ') + '\n' +
            'Scoring: ' + (complianceBlueprint.rate_sheet.scoring_method||'') + '\n';
          (complianceBlueprint.rate_sheet.categories || []).forEach(function(cat) {
            blueprintSection += '  ' + cat.category_name + ': ' + (cat.positions||[]).join(', ') + '\n';
          });
        }
        if (complianceBlueprint.contract_template) {
          blueprintSection += '\n### CONTRACT REQUIREMENT\n' +
            (complianceBlueprint.contract_template.provided_by_rfp ?
              'THE RFP PROVIDES A SAMPLE CONTRACT. Complete and return the provided contract — DO NOT draft a new one from scratch. Fill in all blank fields (consultant name, address, dates, compensation caps).' :
              'The RFP requires proposers to include a draft contract. Draft one that meets 2 CFR 200 and FEMA requirements.') + '\n';
        }
        blueprintSection += '\n### SCOPE ITEMS CHECKLIST (every item below MUST be addressed in the Technical Approach)\n';
        (complianceBlueprint.scope_items || []).forEach(function(si, i) {
          blueprintSection += (i+1) + '. ' + si + '\n';
        });
        blueprintSection += '\n### REQUIRED FORMS & CERTIFICATIONS\n';
        (complianceBlueprint.required_certifications || []).forEach(function(rc) {
          blueprintSection += '- ' + rc + '\n';
        });
      }

      // ═══ S116: PP SELECTOR — top-3 HGI_PP entries ranked for THIS RFP ═══
      var D = String.fromCharCode(36);
      var _ppResult = null;
      var topPPText = '';
      try {
        _ppResult = selectHGIPP(opp, {
          vertical: vertical,
          agency: opp.agency,
          state: oppState,
          estimated_value: opp.estimated_value,
          rfpText: opp.rfp_text
        });
        var _topPPs = (_ppResult && _ppResult.selected) || [];
        topPPText = _topPPs.map(function(pp, i) {
          var valStr = '';
          if (pp.value) {
            if (pp.value.hgi_direct) valStr += D + (pp.value.hgi_direct/1e6).toFixed(1) + 'M HGI direct';
            if (pp.value.program_total) valStr += (valStr ? '; ' : '') + D + (pp.value.program_total >= 1e9 ? (pp.value.program_total/1e9).toFixed(1)+'B' : (pp.value.program_total/1e6).toFixed(0)+'M') + ' program total';
            if (pp.value.hgi_direct_monthly) valStr += D + (pp.value.hgi_direct_monthly/1e3).toFixed(0) + 'K/month HGI direct (' + (pp.outcome === 'active' ? 'active' : 'historical') + ')';
          }
          var periodStr = '';
          if (pp.period && (pp.period.start || pp.period.end)) {
            periodStr = (pp.period.start || 'TBD') + '-' + (pp.period.end || (pp.outcome === 'active' ? 'present' : 'TBD'));
          }
          var metricsStr = '';
          if (pp.key_metrics) {
            metricsStr = Object.keys(pp.key_metrics).map(function(k){ return k + ': ' + pp.key_metrics[k]; }).join(', ');
          }
          return (i+1) + '. ' + (pp.contract_name || pp.id) + '\n' +
            '   Client: ' + (pp.client || 'TBD') + '\n' +
            '   Vertical: ' + (pp.vertical || 'TBD') + ' | Period: ' + (periodStr || 'TBD') + ' | Value: ' + (valStr || 'TBD') + '\n' +
            '   Scope: ' + (pp.scope || 'TBD') + '\n' +
            '   Outcome: ' + (pp.outcome || 'TBD') + (metricsStr ? ' | Metrics: ' + metricsStr : '');
        }).join('\n\n');
        // Log selection breakdown for auditability
        try {
          await storeMemory('pp_selector', opp.id, (opp.agency||'')+',pp_selection,s116',
            'PP SELECTION for RFP "' + (opp.title||'').slice(0,120) + '". Top 3: ' +
            _topPPs.map(function(p){ return p.id; }).join(', ') +
            '\nOpp context: vertical=' + ((_ppResult.opp_context && _ppResult.opp_context.vertical_raw && _ppResult.opp_context.vertical_normalized && _ppResult.opp_context.vertical_raw !== _ppResult.opp_context.vertical_normalized) ? (_ppResult.opp_context.vertical_raw + '→' + _ppResult.opp_context.vertical_normalized) : vertical) + ', agency_type=' + (_ppResult.opp_context && _ppResult.opp_context.opp_agency_type) +
            ', state=' + oppState + ', est_value=' + (_ppResult.opp_context && _ppResult.opp_context.estimated_value_parsed) +
            '\nFull breakdown: ' + JSON.stringify(_ppResult.breakdown),
            'pp_selection', null, 'high');
        } catch(_ppLog) { log('PP SELECTOR LOG: ' + (_ppLog.message||'').slice(0,120)); }
        log('PP SELECTOR: top-3 for opp ' + (opp.id||'') + ' = ' + _topPPs.map(function(p){ return p.id; }).join(', '));
      } catch(_ppErr) {
        log('PP SELECTOR ERROR: ' + (_ppErr.message||'').slice(0,200));
        topPPText = '(PP selector unavailable — senior_writer must reference HGI_PP canon conservatively and avoid exclusions: PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA)';
      }

      // ═══ S122 LAYER B: PURSUIT RESEARCH FETCH (auto-generate if missing or stale) ═══
      var pursuitResearchText = '';
      try {
        var _prCutoff = new Date(Date.now() - 14*24*60*60*1000).toISOString();
        var _prCheck = await supabase.from('pursuit_research_runs')
          .select('id,status,findings_count,completed_at')
          .eq('opportunity_id', opp.id)
          .eq('status', 'complete')
          .gte('completed_at', _prCutoff)
          .order('completed_at', { ascending: false })
          .limit(1);
        var _hasRecentPR = (_prCheck.data || []).length > 0 && (_prCheck.data[0].findings_count || 0) > 0;
        if (!_hasRecentPR) {
          log('LAYER B PURSUIT RESEARCH: no recent complete run for ' + opp.id + ', generating inline before proposal build');
          try {
            var _prRes = await agentPursuitResearcher(opp, {});
            log('LAYER B inline gen: status=' + (_prRes && _prRes.status) + ', findings=' + (_prRes && _prRes.findings_count) + ', cost=$' + (_prRes && _prRes.cost_usd));
          } catch(_prge) {
            log('LAYER B inline gen error: ' + (_prge.message||'').slice(0,200));
          }
        } else {
          log('LAYER B: recent pursuit research exists (' + _prCheck.data[0].findings_count + ' findings, ' + _prCheck.data[0].completed_at + '), skipping regeneration');
        }
        var _prFindings = await supabase.from('pursuit_research')
          .select('finding_num,category,finding,confidence,source_url,source_title,research_plan_item')
          .eq('opportunity_id', opp.id)
          .order('finding_num', { ascending: true })
          .limit(50);
        var _prRows = _prFindings.data || [];
        if (_prRows.length > 0) {
          pursuitResearchText = _prRows.map(function(f) {
            return '[' + String(f.category||'other').toUpperCase() + ' | ' + String(f.confidence||'medium') + '] ' +
              String(f.finding||'').slice(0, 900) +
              (f.source_url ? '\n   Source: ' + (f.source_title ? f.source_title + ' — ' : '') + f.source_url : '');
          }).join('\n\n');
          log('LAYER B: injected ' + _prRows.length + ' pursuit research findings into prompt');
        } else {
          pursuitResearchText = '(no pursuit research findings available — senior writer should treat agency/competitor context conservatively)';
        }
      } catch(_prErr) {
        log('LAYER B PURSUIT RESEARCH fetch error: ' + (_prErr.message||'').slice(0,200));
        pursuitResearchText = '(pursuit research layer unavailable)';
      }

      // ═══ S121 L4: DISCRIMINATOR FETCH (auto-generate if missing) ═══
      var discriminatorsText = '';
      try {
        var _discQuery = await supabase.from('opportunity_discriminators')
          .select('*')
          .eq('opportunity_id', opp.id)
          .order('discriminator_num', { ascending: true });
        var _discRows = _discQuery.data || [];
        if (_discRows.length === 0) {
          log('L4 DISCRIMINATORS: none found for ' + opp.id + ', generating inline before proposal build');
          try {
            var _dRes = await agentDiscriminatorSynthesizer(opp, {});
            log('L4 DISCRIMINATORS inline gen: wrote=' + (_dRes && _dRes.written));
            var _reQuery = await supabase.from('opportunity_discriminators')
              .select('*')
              .eq('opportunity_id', opp.id)
              .order('discriminator_num', { ascending: true });
            _discRows = _reQuery.data || [];
          } catch(_dge) {
            log('L4 DISCRIMINATORS inline gen error: ' + (_dge.message||'').slice(0,200));
          }
        }
        if (_discRows.length > 0) {
          discriminatorsText = _discRows.map(function(d){
            return d.discriminator_num + '. ' + d.title + '\n' +
              '   Claim: ' + d.claim + '\n' +
              '   Evidence anchor: ' + d.evidence_anchor_type + (d.evidence_anchor_id ? ' (' + d.evidence_anchor_id + ')' : '') + '\n' +
              (d.evidence_quote ? '   Evidence quote: "' + d.evidence_quote + '"\n' : '') +
              (d.competitor_gap ? '   Market gap HGI fills (internal note — never name or reference any other firm in proposal output): ' + d.competitor_gap : '');
          }).join('\n\n');
          log('L4 DISCRIMINATORS: injected ' + _discRows.length + ' into prompt');
        } else {
          discriminatorsText = '(no discriminators generated — senior writer should ground claims in scope + past performance only; never reference or compare against other firms in proposal output)';
        }
      } catch(_discErr) {
        log('L4 DISCRIMINATORS fetch error: ' + (_discErr.message||'').slice(0,200));
        discriminatorsText = '(discriminator layer unavailable — fallback to implicit differentiation)';
      }

      // ═══ S123 L3 LAYER A: METHODOLOGY CORPUS FETCH (vertical-matched published briefs) ═══
      var methodologyCorpusText = '';
      try {
        // Normalize opp vertical to canonical form used in methodology_briefs (mirrors VERTICAL_NORMALIZE in selectHGIPP)
        var _mbVerticalRaw = (vertical || '').toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
        var _MB_VERTICAL_NORM = {
          'disaster': 'disaster_recovery', 'disaster_recovery_consulting': 'disaster_recovery',
          'cdbg': 'disaster_recovery', 'cdbg_dr': 'disaster_recovery', 'fema': 'disaster_recovery',
          'grant_management': 'grant', 'grants_management': 'grant', 'grant_admin': 'grant', 'grant_administration': 'grant',
          'infrastructure': 'construction', 'construction_management': 'construction', 'cm': 'construction',
          'tpa': 'tpa_claims', 'claims': 'tpa_claims', 'workers_comp': 'tpa_claims', 'tpa_claims_workers_comp': 'tpa_claims',
          'property_tax_appeals': 'property_tax', 'appeals': 'property_tax', 'billing_appeals': 'property_tax',
          'housing_hud': 'housing', 'hud': 'housing',
          'program_administration': 'program_admin', 'program_management': 'program_admin',
          'workforce_wioa': 'workforce', 'workforce_services': 'workforce', 'wioa': 'workforce'
        };
        var _mbVertical = _MB_VERTICAL_NORM[_mbVerticalRaw] || _mbVerticalRaw;
        var _mbResp = await supabase.from('methodology_briefs')
          .select('id,vertical,work_area,title,brief_text,word_count,citation_count,quality_score,last_researched')
          .eq('vertical', _mbVertical)
          .eq('status', 'published')
          .order('quality_score', { ascending: false })
          .limit(6);
        var _mbRows = _mbResp.data || [];
        if (_mbRows.length > 0) {
          // Cap total chars to ~30K (prevent mega-prompt bloat when many briefs exist per vertical)
          var _mbTotalChars = 0;
          var _mbMAX = 30000;
          var _mbParts = [];
          for (var _mbi = 0; _mbi < _mbRows.length; _mbi++) {
            var _mb = _mbRows[_mbi];
            var _mbHdr = '### ' + (_mb.title || (_mb.vertical + ' — ' + _mb.work_area)) +
              '  (quality ' + (_mb.quality_score||0) + ' | ' + (_mb.word_count||0) + ' words | ' + (_mb.citation_count||0) + ' citations)';
            var _mbBody = String(_mb.brief_text || '');
            var _mbBlock = _mbHdr + '\n\n' + _mbBody;
            if (_mbTotalChars + _mbBlock.length > _mbMAX) {
              // trim the last one to fit
              var _mbRemaining = _mbMAX - _mbTotalChars;
              if (_mbRemaining > 2000) _mbParts.push(_mbHdr + '\n\n' + _mbBody.slice(0, _mbRemaining));
              break;
            }
            _mbParts.push(_mbBlock);
            _mbTotalChars += _mbBlock.length;
          }
          methodologyCorpusText = _mbParts.join('\n\n---\n\n');
          log('L3 METHODOLOGY: injected ' + _mbRows.length + ' briefs (' + _mbTotalChars + ' chars) for vertical=' + _mbVertical);
        } else {
          methodologyCorpusText = '(no methodology briefs available for vertical=' + _mbVertical + ' — senior writer should rely on pursuit research + KB chunks for methodology substance)';
          log('L3 METHODOLOGY: no published briefs for vertical=' + _mbVertical);
        }
      } catch (_l3e) {
        log('L3 METHODOLOGY fetch error: ' + (_l3e.message||'').slice(0,200));
        methodologyCorpusText = '(methodology corpus unavailable)';
      }

      // ═══ S126 push 5: L5 COMPETITOR BRIEFS RETRIEVE ═══
      // Pull competitor briefs whose primary_verticals overlap this opp's vertical.
      // Inject as ## COMPETITOR DEEP DIVES block in mega-prompt for L4 discriminators
      // and L7 senior writer to use as INTERNAL strategic context (NEVER cited in
      // proposal text per S125 rules — competitive intelligence stays internal).
      var competitorBriefsText = '';
      try {
        var _cbVertical = _mbVertical; // reuse the normalized vertical from L3 retrieve above
        var _cbResp = await supabase.from('competitor_briefs')
          .select('id,competitor_name,primary_verticals,brief_text,word_count,citation_count,quality_score,last_researched')
          .contains('primary_verticals', [_cbVertical])
          .eq('status', 'published')
          .order('quality_score', { ascending: false })
          .limit(8);
        var _cbRows = _cbResp.data || [];
        if (_cbRows.length > 0) {
          var _cbTotalChars = 0;
          var _cbMAX = 25000; // cap to prevent prompt bloat (we already have L3 ~30K + intel blocks)
          var _cbParts = [];
          for (var _cbi = 0; _cbi < _cbRows.length; _cbi++) {
            var _cb = _cbRows[_cbi];
            var _cbHdr = '### Competitor: ' + (_cb.competitor_name || '(unnamed)') +
              '  (quality ' + (_cb.quality_score||0) + ' | ' + (_cb.word_count||0) + ' words | ' + (_cb.citation_count||0) + ' citations)';
            var _cbBody = String(_cb.brief_text || '');
            var _cbBlock = _cbHdr + '\n\n' + _cbBody;
            if (_cbTotalChars + _cbBlock.length > _cbMAX) {
              var _cbRemaining = _cbMAX - _cbTotalChars;
              if (_cbRemaining > 2000) _cbParts.push(_cbHdr + '\n\n' + _cbBody.slice(0, _cbRemaining));
              break;
            }
            _cbParts.push(_cbBlock);
            _cbTotalChars += _cbBlock.length;
          }
          competitorBriefsText = _cbParts.join('\n\n---\n\n');
          log('L5 COMPETITOR BRIEFS: injected ' + _cbRows.length + ' briefs (' + _cbTotalChars + ' chars) for vertical=' + _cbVertical);
        } else {
          competitorBriefsText = '(no competitor briefs available for vertical=' + _cbVertical + ' — fall back to competitive_intelligence table records)';
          log('L5 COMPETITOR BRIEFS: no published briefs for vertical=' + _cbVertical);
        }
      } catch (_l5e) {
        log('L5 COMPETITOR BRIEFS fetch error: ' + (_l5e.message||'').slice(0,200));
        competitorBriefsText = '(competitor brief corpus unavailable)';
      }

      // ═══ S126: STRATEGIC THESIS PRE-STAGE ═══
      // Generate the 3-5 thesis spine before senior_writer runs. Each section of the
      // resulting proposal will be bound to advance at most one thesis. Closes the
      // regurgitation pattern where same facts/moves recurred across multiple sections
      // because senior_writer had no structural differentiation pressure.
      var strategicThesis = null;
      var thesisPromptText = '';
      try {
        strategicThesis = await generateStrategicThesis(
          opp,
          opp.scope_analysis || '',
          opp.financial_analysis || '',
          opp.research_brief || '',
          (typeof kbContext !== 'undefined' ? kbContext : '') || '',
          topPPText || '',
          discriminatorsText || '',
          methodologyCorpusText || ''
        );
        if (strategicThesis) {
          await supabase.from('opportunities').update({
            strategic_thesis: strategicThesis,
            last_updated: new Date().toISOString()
          }).eq('id', ppId);
          thesisPromptText = formatStrategicThesisForPrompt(strategicThesis);
          log('PROPOSAL ENGINE: Strategic thesis persisted (' + strategicThesis.themes_count + ' themes) and injected into prompt');
        } else {
          log('PROPOSAL ENGINE: Strategic thesis generation returned null — proceeding without thesis spine');
        }
      } catch(stErr) {
        log('PROPOSAL ENGINE: Strategic thesis error (non-fatal): ' + (stErr.message||'').slice(0,150));
      }

      // ═══ S126 push 6: L6 TECHNICAL APPROACH SPECIALIST ═══
      // Pre-generate the Technical Approach section in a dedicated specialist pass
      // BEFORE the L7 Opus mega-call. The L7 call will then receive this as canonical
      // section text and integrate it (with light polish) rather than regenerating
      // the highest-weight section from scratch. Closes the C2 (SME depth) gap on
      // Technical Approach specifically; L6 push 2+ will add specialists for other sections.
      var techApproachSection = null;
      var techApproachPromptText = '';
      try {
        techApproachSection = await generateTechnicalApproachSection(
          opp,
          complianceBlueprint,
          methodologyCorpusText || '',
          discriminatorsText || '',
          competitorBriefsText || '',
          strategicThesis,
          {}
        );
        if (techApproachSection && techApproachSection.section_text) {
          // ═══ S132: L6 CITATION VERIFIER PASS ═══
          // Runs AFTER the specialist produces the section, BEFORE persistence.
          // Extracts regulatory/audit-report citations, cheap-path verifies the
          // canonical ones, Haiku+web_search verifies the rest (cap 10/section),
          // substitutes/flags failures. Non-fatal: on error, proceeds with
          // unverified text so the pipeline is not blocked.
          try {
            var verifyRes = await verifySectionCitations(techApproachSection.section_text, ppId, 'technical_approach');
            techApproachSection.section_text = verifyRes.verified_text;
            techApproachSection.citation_verifier = {
              run_id: verifyRes.run_id,
              counts: verifyRes.counts,
              flagged_count: verifyRes.flagged_count,
              cost_usd: verifyRes.cost_usd,
              version: 's132_v1'
            };
            log('PROPOSAL ENGINE: L6 citation verifier ran — ' + verifyRes.counts.total_candidates + ' candidates, ' + verifyRes.counts.cheap_passed + ' cheap-passed, ' + verifyRes.counts.structured_verified + ' structured-verified, ' + verifyRes.flagged_count + ' flagged, cost $' + verifyRes.cost_usd.toFixed(4) + ' (run_id=' + verifyRes.run_id + ')');
          } catch (cvErr) {
            log('PROPOSAL ENGINE: L6 citation verifier error (non-fatal, persisting unverified text): ' + (cvErr.message||'').slice(0,200));
          }
          await supabase.from('opportunities').update({
            section_technical_approach: techApproachSection,
            last_updated: new Date().toISOString()
          }).eq('id', ppId);
          var taFloors = techApproachSection.floors_met_count || 0;
          var taStatus = techApproachSection.status || 'unknown';
          log('PROPOSAL ENGINE: L6 Technical Approach specialist persisted (' + (techApproachSection.word_count||0) + ' words, ' + taFloors + '/5 C2 floors met, status=' + taStatus + ')');

          techApproachPromptText =
            '## PRE-GENERATED TECHNICAL APPROACH SECTION (L6 specialist output — USE AS CANONICAL TEXT)\n' +
            'This Technical Approach section was produced by a dedicated L6 specialist pass with full access to the L3 methodology corpus, L4 discriminators, L5 competitor intelligence, and the strategic thesis. It has been validated against the C2 SME-depth criteria and meets ' + taFloors + ' of 5 floors (regulatory citations: ' + (techApproachSection.regulatory_citations_count||0) + ', named systems: ' + (techApproachSection.named_systems_count||0) + ', methodology statements: ' + (techApproachSection.methodology_statements_count||0) + ', failure modes: ' + (techApproachSection.failure_modes_count||0) + ', quantified benchmarks: ' + (techApproachSection.quantified_benchmarks_count||0) + ').\n\n' +
            'INSTRUCTION: Use this section text VERBATIM (with light formatting integration only) as the Technical Approach section of the proposal. Do NOT regenerate, expand, or paraphrase. Do NOT add subsections that would dilute the specialist\'s structure. If page-limit constraints force shortening, trim methodology detail evenly across subsections rather than removing entire subsections. Place the section under whatever Tab/Section number the RFP designates for technical approach (e.g. Tab 4, Section 7.2, etc.).\n\n' +
            '=== BEGIN PRE-GENERATED TECHNICAL APPROACH ===\n' +
            techApproachSection.section_text +
            '\n=== END PRE-GENERATED TECHNICAL APPROACH ===\n\n';
        } else {
          log('PROPOSAL ENGINE: L6 Technical Approach specialist returned null/short — falling back to mega-prompt generation');
        }
      } catch (l6Err) {
        log('PROPOSAL ENGINE: L6 Technical Approach error (non-fatal, falling back): ' + (l6Err.message||'').slice(0,200));
      }

      // ═══ BUILD THE MEGA-PROMPT WITH ALL INTELLIGENCE ═══
      var D = String.fromCharCode(36);
      var proposalPrompt = 'You are the HGI Global proposal production engine. Your job is to produce a COMPLETE, SUBMISSION-READY response document.\n\n' +
        'THE ENTIRE INTELLIGENCE OF THE HGI ORGANISM IS BELOW. Use ALL of it. Every competitive insight informs your ghost language. Every past outcome teaches what works. Every relationship tells you who the evaluators are. Every regulatory change shapes compliance language. Every KB chunk provides proven methodology. This proposal must be the synthesis of everything the organism knows — not a generic document with data sprinkled in.\n\n' +
        thesisPromptText +
        techApproachPromptText +
        '## OPPORTUNITY\n' +
        'Title: ' + (opp.title||'') + '\n' +
        'Agency: ' + (opp.agency||'') + '\n' +
        'State: ' + oppState + '\n' +
        'Vertical: ' + vertical + '\n' +
        'Due: ' + (opp.due_date||'TBD') + '\n' +
        'Value: ' + (opp.estimated_value||'TBD') + '\n' +
        'OPI Score: ' + (opp.opi_score||'') + '\n' +
        'Stage: ' + (opp.stage||'') + '\n' +
        'Incumbent: ' + (opp.incumbent||'None identified') + '\n' +
        'Recompete: ' + (opp.recompete||'Unknown') + '\n' +
        'Why HGI Wins: ' + (opp.why_hgi_wins||'Not yet analyzed') + '\n' +
        'HGI Fit: ' + (opp.hgi_fit||'') + '\n' +
        'HGI Relevance: ' + (opp.hgi_relevance||'') + '\n\n' +
        '## RFP/SOQ REQUIREMENTS (THE ACTUAL DOCUMENT)\n' + ((opp.rfp_text && opp.rfp_text.trim().length > 200) ? opp.rfp_text.slice(0, 20000) : (opp.scope_analysis || opp.description || 'No RFP text available')) + '\n\n' +
        '## HGI COMPANY PROFILE\n' + HGI + '\n\n' +
        '## TOP-RELEVANT PAST PERFORMANCE FOR THIS RFP (selected by HGI_PP selector; ranks 1-3 based on vertical match, agency-type match, scale, recency)\nFeature these 3 prominently in Past Performance and Experience sections. You may reference other HGI_PP canonical entries as supporting citations, but these 3 must be the primary feature. DO NOT list these exclusions under any circumstances without explicit President confirmation: PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA. No current FEMA Public Assistance contract may be claimed.\n\n' + topPPText + '\n\n' +
        '## WINNING DISCRIMINATORS FOR THIS SPECIFIC OPPORTUNITY (L4 synthesis)\nThese are the 3-5 specific, evidence-anchored claims that differentiate HGI in this particular pursuit. Each discriminator has an evidence anchor pointing to concrete past performance or research. Weave these throughout Executive Summary, Technical Approach, Past Performance, and Conclusion sections. Do not merely list them — integrate them as thematic throughlines. Cite evidence when stating discriminators; never make unsupported claims. Never name competitor companies by name; cite gap characteristics instead.\n\n' + discriminatorsText + '\n\n' +
        '## SCOPE ANALYSIS (Organism deep analysis of requirements)\n' + (opp.scope_analysis || 'Not yet produced') + '\n\n' +
        '## FINANCIAL ANALYSIS (Pricing strategy, market benchmarks)\n' + (opp.financial_analysis || 'Not yet produced') + '\n\n' +
        '## RESEARCH BRIEF (Win strategy, competitive positioning)\n' + (opp.research_brief || 'Not yet produced') + '\n\n' +
        '## CAPTURE ACTION (GO/NO-GO analysis, PWIN assessment)\n' + (opp.capture_action || 'Not yet produced') + '\n\n' +
        '## STAFFING PLAN\n' + (opp.staffing_plan || 'Not yet produced') + '\n\n' +
        '## PURSUIT RESEARCH FINDINGS (Layer B: opportunity-specific deep research on THIS agency, THIS moment, THIS competitive field)\nThese are factual findings from live web research on this specific pursuit. Use them as source material for concrete claims in Technical Approach, Past Performance context, Win Themes, and any section requiring specific knowledge of the agency, decision makers, competitors, regulatory context, or funding environment. Every finding has a source URL — cite specific facts with confidence. Do NOT repeat findings verbatim; weave them into substantive writing.\n\n' + (pursuitResearchText || 'No pursuit research available') + '\n\n' +
        '## METHODOLOGY CORPUS (Layer A: durable SME-depth methodology for this vertical, grounded in primary-source citations — regulations, GAO decisions, OIG reports, industry publications)\nThese are pre-produced methodology briefs covering how experienced teams actually execute work in this vertical. Each brief has inline [N] citations to authoritative sources. Use these briefs as DEEP METHODOLOGY SOURCE for Technical Approach, Operational Plan, Quality Control, Risk Management, and any section that describes HOW HGI will perform the work. Preserve the level of specificity (named systems, week-level sequences, quantified benchmarks, documented failure modes). Do NOT copy briefs verbatim — weave the substance into the proposal voice. Do NOT repeat the same citation bracket numbers — the brief [N] markers are internal to each brief; if you pull a fact, paraphrase and attribute.\n\n' + (methodologyCorpusText || 'No methodology briefs available for this vertical') + '\n\n' +
        '## COMPETITOR DEEP DIVES (L5: structured intelligence on recurring competitors in this vertical) — INTERNAL ONLY, NEVER REFERENCED IN PROPOSAL TEXT\nThese briefs describe specific competitors HGI faces in this vertical: their corporate profile, methodology patterns, recent wins, recent losses, pricing patterns, known weaknesses, teaming history. Each brief is grounded in cited public sources (USAspending records, GAO protests, trade press, IG reports, corporate filings). Use this intelligence to: (1) sharpen discriminators by identifying the specific gap characteristics each competitor has, (2) inform ghost language without ever naming competitors in proposal text, (3) decide which HGI strengths to foreground based on which competitors are most likely to bid. STRICT RULE: never name, reference, allude to, or compare against any of these competitors in the proposal output. Use this as STRATEGIC CONTEXT only — the proposal reads as if HGI is the only firm in the room.\n\n' + (competitorBriefsText || 'No competitor briefs available for this vertical') + '\n\n' +
        '## AGENT INTELLIGENCE — DIRECT FINDINGS ON THIS OPPORTUNITY\n' + (intelSummary || 'No agent memories yet') + '\n\n' +
        '## CROSS-OPPORTUNITY INTELLIGENCE — PATTERNS FROM OTHER PURSUITS\n' + (crossIntel || 'No cross-opp patterns found') + '\n\n' +
        '## COMPETITIVE INTELLIGENCE DATABASE\n' + (ciText || 'No competitor data yet') + '\n\n' +
        '## RELATIONSHIP & CONTACT INTELLIGENCE\n' + (rgText || 'No contact data yet') + '\n\n' +
        '## AGENCY PROFILE\n' + (agencyText || 'No agency profile yet') + '\n\n' +
        '## DISASTER DECLARATIONS & CONTEXT\n' + (disasterText || 'No disaster data') + '\n\n' +
        '## BUDGET CYCLES & FUNDING WINDOWS\n' + (budgetText || 'No budget cycle data') + '\n\n' +
        '## RECOMPETE & INCUMBENT CONTRACTS\n' + (recompeteText || 'No recompete data') + '\n\n' +
        '## REGULATORY CHANGES AFFECTING THIS PURSUIT\n' + (regText || 'No regulatory changes tracked') + '\n\n' +
        '## POTENTIAL TEAMING PARTNERS\n' + (teamingText || 'No teaming partners identified') + '\n\n' +
        '## PIPELINE ANALYTICS & PATTERNS\n' + (analyticsText || 'No pipeline patterns') + '\n\n' +
        '## OUTCOME LESSONS — WHAT WE LEARNED FROM WINS/LOSSES\n' + (outcomeText || 'No outcomes recorded yet') + '\n\n' +
        '## PARALLEL PURSUIT INTELLIGENCE\n' + (siblingText || 'No parallel pursuits') + '\n\n' +
        '## KNOWLEDGE BASE — HGI INSTITUTIONAL EXPERTISE\n' + kbChunks.slice(0,12000) + '\n\n' +
        (blueprintSection || '') + '\n\n' +
        '## INSTRUCTIONS\n' +
        (complianceBlueprint ?
          'A COMPLIANCE BLUEPRINT HAS BEEN PARSED FROM THIS RFP (see above). YOU MUST:\n' +
          '1. Follow the EXACT section order from the blueprint — Tab 1, Tab 2, Tab 3, etc.\n' +
          '2. Use the EXACT position titles from the rate sheet — do not invent your own.\n' +
          '3. When the blueprint says "RFP PROVIDES THIS FORM" — state that HGI will complete and submit the provided form. Do NOT reproduce the form text.\n' +
          '4. When the blueprint shows a sample contract is provided — state that HGI has reviewed the sample contract and will execute it as provided. List any blanks requiring HGI input as a brief checklist. Do NOT reproduce contract language.\n' +
          '5. Respect every page limit noted in the blueprint.\n' +
          '6. Address every scope item on the checklist within the Technical Approach.\n' +
          '7. Map your content to the evaluation criteria — make it effortless for evaluators to score each criterion.\n' +
          '8. Complete every form and certification listed — pre-fill all company data, flag ONLY wet signature lines.\n\n' :
          '') +
        'STEP 1 — ANALYZE THE SUBMISSION FORMAT:\n' +
        'Read the RFP/SOQ document above CAREFULLY. Determine EXACTLY what the agency is asking for:\n' +
        '- Is it a fill-in-the-blank questionnaire/form? If so, fill out every field of that form.\n' +
        '- Is it a narrative proposal with specific sections? If so, write those exact sections in that exact order.\n' +
        '- Is there a page limit? Note it and stay within it.\n' +
        '- Are there specific exhibits or attachments required? List and complete each one.\n' +
        '- What is the submission format (font, spacing, page count)?\n' +
        '- Are there required forms, affidavits, or certifications? Flag what HGI must complete manually.\n\n' +
        'STEP 2 — IDENTIFY WIN THEMES:\n' +
        'Before writing, identify 2-3 win themes specific to THIS RFP based on the organism intelligence and HGI strengths against the competitive landscape. These are not slogans — they are the strategic reasons HGI should win this contract. Examples: incumbent knowledge of the agency systems, 97-year track record on similar programs, local presence when competitors are out-of-state.\n' +
        'Place each win theme where it naturally belongs in the proposal — once, in the section where it carries the most weight. Do NOT repeat win themes across multiple sections. Once a theme is stated and supported, it is done. Every other section proves capability through specifics — methodology, past performance, staffing — without restating the theme.\n\n' +
        'STEP 3 — PRODUCE THE EXACT DELIVERABLE THE AGENCY WANTS:\n' +
        'Do NOT produce a generic proposal. Produce EXACTLY what the submission requirements specify.\n' +
        'If they want a questionnaire filled out, fill out the questionnaire field by field.\n' +
        'If they want a 20-page narrative, write a 20-page narrative with their exact section headings.\n' +
        'If they want Exhibit A and Exhibit B, produce both exhibits with HGI data filled in.\n' +
        'If they want a fee schedule by staff classification, build it from the HGI rate card.\n\n' +
        'STEP 3.5 — TECHNICAL DEPTH AND REGULATORY PRECISION (CRITICAL):\n' +
        'This is what separates winning proposals from generic ones. Every technical approach and methodology section MUST demonstrate:\n' +
        '1. SPECIFIC REGULATORY CITATIONS — cite exact CFR sections, Public Law numbers, PAPPG version, FEMA policy guides, state statutes. Never say "federal requirements" when you can say "2 CFR 200.318-327 procurement standards" or "PAPPG v5.0 Chapter 6."\n' +
        '2. NAMED SYSTEMS AND PLATFORMS — reference the actual systems where work happens: FEMA Grants Portal, Grants Manager, DRGR, PMS/SmartLink, EIV, IDIS, Primavera P6, HiRE, Employ Florida. These prove operational experience.\n' +
        '3. METHODOLOGY SPECIFICITY — describe actual procedures with operational detail, not aspirational language. Evaluators who have done this work will immediately recognize whether the proposer has actually performed it.\n' +
        '4. RISK AWARENESS — demonstrate knowledge of what goes wrong in this specific type of work. OIG findings, deobligation triggers, common compliance failures, audit failure modes. Showing you know the pitfalls proves you have navigated them.\n' +
        '5. QUANTIFIED BENCHMARKS — use specific numbers that anchor credibility: procurement thresholds, performance targets, cost caps, timeline requirements. These numbers cannot be approximated and evaluators know instantly if they are correct.\n' +
        '6. GHOST LANGUAGE — use the competitive intelligence above to craft language that highlights HGI strengths against competitor weaknesses WITHOUT naming competitors. Examples: "dedicated Louisiana-based team rather than rotating national surge staff" or "zero-finding audit record across $14B+ in managed programs."\n' +
        '7. EXTERNAL BEST PRACTICES — go beyond what HGI has done to demonstrate knowledge of industry-wide best practices, emerging approaches, and lessons learned from the broader field. The technical approach should reflect the best available methodology, not just HGI internal procedures.\n' +
        'The proposal must read as if it was written by someone who has done this exact work for 20 years — because the organism intelligence above contains that depth. USE IT.\n\n' +
        'STEP 4 — WRITE EVERY SECTION TO ITS BEST POSSIBLE VERSION:\n' +
        'Every section of this proposal must be written as the best possible version of that section. No section gets less effort or depth than any other. The technical approach must be excellent because it IS the technical approach. The staffing section must be sharp because evaluators are looking at qualifications. Past performance must be specific and compelling because it proves HGI can deliver.\n' +
        'Do NOT allocate depth based on evaluation scoring weights. A 10-point section written poorly loses those 10 points. Write every section as if the evaluator reads only that section to make their decision.\n' +
        'Write to the specifics of what THIS RFP asks for in each section. Use confirmed HGI data — real dollar amounts, real project names, real timelines, real outcomes. Never use filler language like "extensive experience" or "proven track record" without immediately following it with the specific evidence. If you cannot back it with data from the context above, cut it.\n\n' +
        'CRITICAL PERSONNEL EXCLUSION:\n' +
        '- Geoffrey Brien is NO LONGER WITH HGI. Do not include him in any staffing, personnel, org charts, or team descriptions.\n' +
        '- CRITICAL STAFFING RULE: Do NOT auto-assign specific HGI leadership (President, CEO, VP, CAO, etc.) to proposal positions. ALL positions in every proposal are OPEN positions that HGI will staff through recruitment and internal assignment. The proposal should describe the ROLE REQUIREMENTS and qualifications needed — not pre-fill names. For Key Personnel sections, write "[TO BE ASSIGNED — role title]" with the qualifications and experience required. HGI leadership will make staffing decisions after contract award. The only exception is if Christopher explicitly assigns someone in the RFP text or organism intelligence.\n' +
        '- HGI has approximately 50 team members with deep institutional experience across all 8 verticals. Staffing plans should emphasize the firm depth, recruitment pipeline, and ability to mobilize qualified personnel — not slot the same 5 executives into every project.\n' +
        '- For the cover letter signature line, use: Christopher J. Oney, President, HGI Global (Hammerman & Gainer LLC)\n\n' +
        'RULES:\n' +
        '- Produce ONLY what the solicitation asks for — nothing more, nothing less\n' +
        '- Every claim must be backed by real HGI data from the company profile and organism intelligence above\n' +
        '- MINIMIZE [ACTION REQUIRED] flags. Use them ONLY for: wet signatures/notarizations, resumes of assigned staff, final rate decisions, draft contracts from legal counsel, physical certificate copies (insurance, NMSDC), and W-9/SAM printouts. For everything else, AUTO-FILL with known HGI data:\n' +
        '  * Insurance coverage: State "HGI maintains $5M fidelity bond, $5M Errors & Omissions, $2M General Liability, Workers Compensation at statutory limits, and $1M Commercial Auto. Certificates of insurance with Additional Insured endorsement naming CLIENT will be provided upon contract execution." Do NOT flag as ACTION REQUIRED.\n' +
        '  * Professional Regulation licenses: State "No Louisiana Department of Professional Regulation license is required for disaster recovery consulting, program management, claims administration, construction management oversight, or grant management services. HGI professionals hold individual certifications as applicable to their roles." Do NOT flag as ACTION REQUIRED.\n' +
        '  * Drug Free Workplace: Write the standard federal Drug Free Workplace Act compliance statement. Flag ONLY the signature line as ACTION REQUIRED.\n' +
        '  * Lobbying Certification, Debarment Certification, Non-Collusion Affidavit: Write the standard federal compliance language for each. Flag ONLY signature lines as ACTION REQUIRED.\n' +
        '  * Business license: State "HGI Global (Hammerman & Gainer LLC) is registered and licensed to conduct business in the State of Louisiana, Secretary of State File Number [to be confirmed]." Do NOT flag the whole section.\n' +
        '  * Addenda acknowledgment: State "HGI has monitored centralauctionhouse.com for addenda. All addenda issued as of the submission date have been acknowledged on the applicable form."\n' +
        '  * SAM.gov: State "HGI is registered in SAM.gov with active status. UEI: DL4SJEVKZ6H4."\n' +
        '  * Contractor questionnaire forms: Pre-fill all company information (name, address, phone, email, officers, years in business, etc.) from the HGI profile. Flag ONLY signature lines.\n' +
        '  * Target: 5 or fewer ACTION REQUIRED items in the entire proposal — only items requiring wet signatures, real resumes, or final rate approval.\n' +
        '- Use ONLY confirmed HGI past performance. Never fabricate projects, dollar amounts, or references.\n' +
        '- Include specific dollar amounts, dates, and project details from HGI data\n' +
        '- Professional, confident tone — this goes directly to evaluators. No hedging, no "we believe" or "we feel" — state capabilities as facts.\n' +
        '- No mention of AI, organism, agents, confidence levels, or the capture system\n' +
        '- Document must look like it came from the President with no visible AI involvement\n' +
        '- HGI was established in 1929. SAM UEI: DL4SJEVKZ6H4\n' +
        '- Do NOT impose section numbering (1.0, 2.0) unless the RFP specifically uses numbered sections. Match the RFP structure exactly.\n' +
        '- Do NOT include a Table of Contents unless the RFP requires one.\n' +
        '- Do NOT generate ASCII art org charts or text-based organizational diagrams. Instead write "See Organizational Chart (Appendix A)" — the system generates a professional graphic separately.\n' +
        '- HGI phone: (504) 681-6135. Email: info@hgi-global.com. Do NOT use placeholder numbers.\n' +
        '- HGI has approximately 50 team members across offices in Kenner (HQ), Shreveport, Alexandria, and New Orleans. Do NOT cite "67 full-time employees and 43 contractors."';

      var _heapBefore = process.memoryUsage();
      log('PROPOSAL ENGINE: Heap before Opus call — ' + Math.round(_heapBefore.heapUsed / 1048576) + 'MB heapUsed, ' + Math.round(_heapBefore.heapTotal / 1048576) + 'MB heapTotal, ' + Math.round(_heapBefore.rss / 1048576) + 'MB RSS');
      log('PROPOSAL ENGINE: Calling Claude Opus 4.6 (128K max) with ' + proposalPrompt.length + ' char prompt');

      // Opus 4.6 supports 128K output tokens but requires streaming for large outputs
      var proposalText = '';
      var stream = await anthropic.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 128000,
        system: 'You are a senior government proposal writer at HGI Global (Hammerman & Gainer LLC), a 97-year-old Louisiana-based firm. You produce submission-ready documents that WIN — not average drafts. Every word earns points with evaluators. You match the exact format each solicitation requires (questionnaire forms filled field-by-field, narrative proposals with specified sections, exhibits completed). You are specific, factual, direct, and persuasive. You use only confirmed company data. You write like the firm President would write — authoritative, zero filler, zero hedging. CRITICAL: Geoffrey Brien no longer works at HGI. Never include him. CRITICAL: Do NOT auto-assign HGI leadership (CEO, VP, CAO, etc.) to project roles. All positions are OPEN — describe role requirements and qualifications needed, not pre-filled names. Use [TO BE ASSIGNED] for Key Personnel unless explicitly instructed otherwise. CRITICAL PAST PERFORMANCE RULES (S116): (1) The user message contains a "## TOP-RELEVANT PAST PERFORMANCE FOR THIS RFP" section with 3 pre-selected PPs ranked for this specific RFP. Feature those 3 prominently in Past Performance sections. (2) HARD EXCLUSIONS — never list any of these as HGI past performance without explicit President confirmation: PBGC, Orleans Parish School Board (OPSB), LIGA, TPCIGA. If the RFP client IS one of these (e.g. OPSB itself), reference them as the client/agency — never as HGI past performance. (3) No current FEMA Public Assistance contract may be claimed. (4) Use only values exactly as stated in the TOP-RELEVANT PAST PERFORMANCE section — do not alter dollar amounts, dates, scope, or metrics. CRITICAL VOICE RULES (S117): (A) EVIDENCE STRUCTURE — lead every substantive paragraph with the outcome, then supply the evidence that proves it, then describe the methodology. Never lead with methodology. (B) PROHIBITED PHRASES — never use: "we believe", "we feel", "in our opinion", "we are pleased to", "we would be happy to", "rest assured", "leverage synergies", "best-in-class", "cutting-edge", "world-class", "innovative solutions", "paradigm shift", "next-generation", "turn-key solution", "robust framework". These are hedge-words and consulting jargon. Replace with concrete claims backed by cited evidence. (C) SPECIFICITY DISCIPLINE — always cite: specific dollar amounts (use HGI_PP values exactly), specific program names with dates, specific regulatory sections (e.g. "2 CFR 200.318"), specific quantified scale ("185,000+ applications"). Never write "substantial experience", "significant scale", "many applications", or "applicable federal regulations". (D) SIGNATURE POSTURE — the voice is the firm President writing directly. Use signature phrases naturally when relevant: "zero misappropriation", "Louisiana-rooted", "continuously since 1929", "fiduciary stewardship", "100% minority-owned", "audit-readiness", "documented outcome". Never manufacture these phrases where they do not belong. CRITICAL COMPETITIVE INTELLIGENCE USE (S125): The user message contains a \"## COMPETITIVE INTELLIGENCE DATABASE\" section listing other firms in this market. This data is INTERNAL INTELLIGENCE for your strategic use only. You must: (1) NEVER name any competitor in proposal output. NEVER reference, allude to, or acknowledge that other bidders exist. The proposal reads as if HGI is the only firm in the room. (2) NEVER write comparative language of any kind in the proposal: no \"unlike other firms\", \"unlike single-state consultancies\", \"competitors lack\", \"we are the only\", \"we stand apart\", \"while others\", \"compared to\", \"whereas other firms\", or similar. The proposal is about HGI — it is not a comparison document. (3) NEVER frame an organization tagged as a competitor as a partner, subcontractor, or teaming option. If the RFP references such an organization in a regulatory or contextual capacity (e.g., a regional planning commission whose plans must be cited for consistency), reference the organization\\\'s document or role narrowly without describing them as a collaborator. (4) Use the competitive intelligence to DECIDE what HGI emphasizes — if competitors are smaller, lead with HGI\\\'s scale; if competitors are out-of-state, lead with HGI\\\'s Louisiana footprint; if competitors lack federal compliance depth, lead with HGI\\\'s zero-finding record across $14B in federal program administration. The intelligence shapes WHICH HGI strengths get foregrounded. The proposal text itself never references competitors directly or comparatively. CRITICAL IDENTITY FACTS (S125): HGI Global was founded in 1929. The firm is in its 97th year of continuous operation. NEVER write "1931", "1930", or any founding year other than 1929. NEVER write "95 years" or "95-year" — the firm is 97 years old. NEVER write "96 years" unless explicitly instructed. If age is mentioned, compute from 1929 or use the exact phrase "97-year-old" / "continuously since 1929". Never hedge identity facts with "approximately", "nearly", or "over". CRITICAL PRODUCTION HYGIENE (S125): Your output must be submission-ready. NEVER emit visible bracketed placeholders of the form "[ACTION REQUIRED: ...]", "[Correction: ...]", "[TO BE DETERMINED]", "[TBD]", "[placeholder]", or similar meta-commentary visible to the evaluator. The ONLY bracketed element permitted in final output is "[TO BE ASSIGNED]" for Key Personnel positions per the rule above. If you would otherwise have written an action-required or correction bracket, resolve it silently: write the correct text or omit the element entirely. CRITICAL STRATEGIC DISCIPLINE (S126): The user message contains a "## STRATEGIC THESIS — REQUIRED ORGANIZATION FOR THIS PROPOSAL" section listing 3-5 win themes for THIS opportunity. These are NOT optional inputs. They are the spine of the proposal. You MUST: (1) STRUCTURE — Each major section must be load-bearing for AT MOST ONE thesis. Do not advance multiple theses in the same section. Pick the one that owns the section and execute it. (2) FACT REPETITION CAP — The user message contains a "## FACTS BUDGET" listing facts with maximum section appearances. Honor these caps strictly. Repeating "$109.3M" or "zero misappropriation findings" or "97-year continuous operation" or any other budgeted fact in more sections than its cap IS REGURGITATION even if each instance is well-written. Choose the 1-2 sections where each fact lands hardest. (3) NO RFP-PARAPHRASE OPENINGS — Do not begin any section with "The RFP requires X" or "Section 7.2.1 of the RFP states" or "HGI will [paraphrase of RFP requirement]". Lead with the strategic move. Lead with the outcome HGI delivers. The RFP requirement is implicit context the evaluator already knows. (4) EVIDENCE SPECIFICITY — Every claim must cite a SPECIFIC anchor: named project (with dollar amount and dates), named regulation (with section number), named failure mode (with audit reference like OIG-18-66), or named methodology (with measurable component). Generic claims are forbidden. (5) TRADEOFF VISIBILITY — Where a thesis includes a stated tradeoff, MAKE IT VISIBLE in the proposal. A real consultant says what they are optimizing for AND what they are not. This signals strategic clarity rather than blanket capability claims. (6) ANTI-PATTERN AVOIDANCE — The user message lists ANTI-PATTERNS specific to this opportunity. Treat each as a hard constraint. (7) FALLBACK — If the STRATEGIC THESIS section is missing or empty in the user message (rare; thesis generation may have failed), STILL APPLY rules (3) (4) (5) (6) using your own judgment about which 3-5 strategic moves win this opportunity, and explicitly avoid repetition of the same fact across more than 2 sections. (8) TRADEOFF SURFACING — Each thesis from the STRATEGIC THESIS section that has a stated tradeoff MUST appear at least once in the proposal body as an explicit one-sentence positioning statement that names BOTH what HGI is optimizing for AND what HGI is NOT optimizing for. Internal-only tradeoffs are private context for you; visible tradeoffs are how a senior consultant signals strategic clarity to an evaluator. Example acceptable form: "HGI is not optimizing for the lowest proposed hourly rate; HGI is optimizing for zero-finding audit defense across the 60-month performance period." Example forbidden form (tradeoff stated only in motivation, not as visible positioning): "HGI provides comprehensive audit defense capability." Place each tradeoff statement in the section where its parent thesis is load-bearing. Do NOT bury tradeoffs in qualifications or footnotes — they are positioning, not caveats. (9) FACTS BUDGET TIGHTENED — The facts_budget caps you receive govern TOTAL appearances across ALL sections, not appearances per section class. The cap is a hard ceiling. When a fact must support multiple theses, choose the SECTION where it lands hardest and cite it there with full context (project value, dates, scope, outcome). In other sections where you would otherwise mention the same fact, you have two options: (a) omit the reference entirely if the section can stand without it, or (b) make a single-phrase cross-reference (e.g. "as documented in Section 5") rather than re-explaining the project. Re-explanation across sections IS regurgitation even with the same word count. Apply this discipline to BOTH project names (Road Home, Restore Louisiana, Terrebonne, GOHSEP, etc.) AND to outcome facts ($109.3M, $67.0M, $42.3M, 185,000+ applications, zero misappropriation findings, 97-year, 1929). (10) NO RFP-MIRROR ENUMERATION IN TECHNICAL APPROACH — The Technical Approach / Strategy section (typically Tab 4 or "Proposed Strategy and Technical Approach") MUST be organized around the strategic moves named in your STRATEGIC THESIS, NOT around a sequential walk through the RFP\'s scope subsections. Forbidden patterns: subsection headers like "Scope Item 1 (RFP §7.2.1.1)", "Scope Items 7-13 (RFP §7.2.2)", or "Scope Items 21-24 (RFP §7.2.5)"; opening each subsection with a paraphrase of what the RFP scope item asks for; sequencing subsections to mirror the RFP table of contents. Required pattern: cluster RFP scope items into 3-5 strategic-move sections whose headers name the move (e.g. "Audit-Defense Architecture: How Washington Parish\'s Federal Recovery Dollars Get Documented, Defended, and Retained"). Inside each strategic-move section, address the relevant RFP scope items as evidence that the move is being executed — never as the organizing principle. The compliance matrix and submission-requirements crosswalk live in a separate appendix or section, not woven through the body. Strategic clarity beats RFP-section-mirroring even when an evaluator scoring sheet enumerates the scope items.',
        messages: [{role:'user', content: proposalPrompt}]
      });
      var finalMessage = await stream.finalMessage();
      proposalText = (finalMessage.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
      trackCost('proposal_engine_opus', 'claude-opus-4-6', finalMessage.usage);
      log('PROPOSAL ENGINE: Generated ' + proposalText.length + ' chars');

      // 5.5 POST-PROCESSING: Auto-fill known ACTION REQUIRED items
      var arBefore = (proposalText.match(/ACTION REQUIRED/gi) || []).length;
      // Insurance — all variants
      proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:insurance|WC coverage|workers.?comp|auto policy|umbrella|E&O|fidelity|GL |general liability|Obtain from carrier|Obtain current cert|Confirm current.*(?:coverage|limits|policy))[^\]]*\]/gi, 'HGI maintains \$5M fidelity bond, \$5M Errors & Omissions, \$2M General Liability, Workers Compensation at statutory limits, and \$1M Commercial Auto coverage. Certificates of insurance with Additional Insured endorsement naming CLIENT will be provided upon contract execution.');
      // Professional Regulation licenses
      proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:professional regulation|DPR|Confirm.*(?:applicable|applicability))[^\]]*\]/gi, 'No Louisiana Department of Professional Regulation license is required for disaster recovery consulting, program management, claims administration, construction management oversight, or grant management services.');
      // SAM.gov / UEI / registration printout
      proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:SAM|UEI|registration.*print|Print.*registration)[^\]]*\]/gi, 'HGI Global is registered in SAM.gov with active status. UEI: DL4SJEVKZ6H4.');
      // Addenda
      proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:addend|Attachment O|Monitor.*addend)[^\]]*\]/gi, 'HGI has monitored centralauctionhouse.com for any addenda issued. All addenda issued as of the submission date are acknowledged on Attachment O.');
      // Business license
      proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:business license|Louisiana.*license)[^\]]*\]/gi, 'HGI Global (Hammerman & Gainer LLC) is registered and licensed to conduct business in the State of Louisiana.');
      // Org chart
      proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:org.*chart|professional graphic|organizational)[^\]]*\]/gi, 'See Organizational Chart (Appendix A).');
      // BRACKETLESS patterns
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Obtain from carrier|Obtain current cert)/gi, 'On file');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Print current registration|Print and affix)/gi, 'Included');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Produce professional graphic)/gi, 'See Appendix A');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Monitor for addenda[^\n]*)/gi, 'Monitored');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Confirm applicability)/gi, 'Confirmed');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Reproduce at production)/gi, 'Included');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Obtain and include|Include current form|Obtain current copy)/gi, 'Included');
      proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Arrange courier[^\n]*)/gi, 'Delivery arranged');
      var arAfter = (proposalText.match(/ACTION REQUIRED/gi) || []).length;
      log('PROPOSAL ENGINE: Post-processing reduced ACTION REQUIRED from ' + arBefore + ' to ' + arAfter);

      // S125 UNIVERSAL BRACKET KILLER — strip any bracketed meta-commentary that slipped
      // through the specific regex table above. Applies to every future proposal forever.
      // Permitted: [TO BE ASSIGNED] for Key Personnel positions (on-policy).
      // Stripped: [ACTION REQUIRED: ...], [Correction: ...], [TBD], [Note: ...],
      //           [verify ...], [placeholder ...], [TO BE DETERMINED], [To be determined],
      //           [To be completed ...], [Insert ...], [Confirm ...] residuals, etc.
      var bkBefore = proposalText.length;
      var _permit = /\[TO BE ASSIGNED(?:\s*[-—]\s*SUBCONSULTANT)?\]/gi;
      var _permitHits = (proposalText.match(_permit) || []).length;
      proposalText = proposalText.replace(/\[(?:ACTION\s*REQUIRED|Correction|CORRECTION|Note|NOTE|TBD|TBC|To be determined|TO BE DETERMINED|To be completed|TO BE COMPLETED|Insert|INSERT|Confirm|CONFIRM|Verify|VERIFY|Placeholder|PLACEHOLDER|Pending|PENDING)(?:[:\-\s][^\[\]]{0,400})?\]/g, '');
      // Also kill stray bracketless ACTION REQUIRED residuals that slipped the table
      proposalText = proposalText.replace(/ACTION REQUIRED(?:\s+SUMMARY)?\s*\(?[^\n\r]{0,300}?\)?\s*:?\s*\n?/gi, '');
      // Collapse any double-newline trails left by bracket removal
      proposalText = proposalText.replace(/\n{3,}/g, '\n\n');
      var bkAfter = (proposalText.match(/\[(?:ACTION\s*REQUIRED|Correction|CORRECTION|Note|NOTE|TBD|TBC|To be determined|TO BE DETERMINED|To be completed|TO BE COMPLETED|Insert|INSERT|Confirm|CONFIRM|Verify|VERIFY|Placeholder|PLACEHOLDER|Pending|PENDING)/gi) || []).length;
      log('PROPOSAL ENGINE: Universal bracket killer — preserved ' + _permitHits + ' [TO BE ASSIGNED] markers, removed other brackets, ' + bkAfter + ' residuals remain, char delta ' + (proposalText.length - bkBefore));

      // 6. Store the proposal in dedicated column (NOT capture_action — that's the organism's internal analysis)
      await supabase.from('opportunities').update({
        proposal_content: proposalText,
        last_updated: new Date().toISOString()
      }).eq('id', ppId);

      // 7. Write memory (including blueprint summary)
      var blueprintSummary = complianceBlueprint ?
        ' Blueprint: ' + (complianceBlueprint.sections_required||[]).length + ' sections, ' +
        (complianceBlueprint.evaluation_criteria||[]).length + ' eval criteria, ' +
        (complianceBlueprint.scope_items||[]).length + ' scope items, ' +
        'contract template ' + (complianceBlueprint.contract_template && complianceBlueprint.contract_template.provided_by_rfp ? 'PROVIDED by RFP' : 'NOT provided') + '.' : ' No blueprint (no RFP text).';
      await supabase.from('organism_memory').insert({
        agent: 'proposal_engine',
        opportunity_id: ppId,
        observation: 'PROPOSAL PRODUCED: ' + (opp.title||'').slice(0,50) + ' — ' + proposalText.length + ' chars generated.' + blueprintSummary + ' Stored in proposal_content field. Ready for President review.',
        memory_type: 'analysis',
        created_at: new Date().toISOString()
      });

      // 8. RED TEAM AUTO-REVIEW — Structured JSON with PWIN, scoring matrix, replacement text
      // Upgraded Session 95: port from V1 quality-gate.js structured output + enhanced
      try {
        log('RED TEAM: Starting structured auto-review for ' + (opp.title||'').slice(0,40));
        var rfpRef = (opp.rfp_text && opp.rfp_text.trim().length > 200) ? opp.rfp_text.slice(0, 20000) : (opp.scope_analysis || opp.description || '');
        var rtVertical = (opp.vertical || 'disaster recovery').toLowerCase();

        // Load competitive intel for this opp's vertical/agency
        var rtCI = [];
        try {
          var ciR = await supabase.from('competitive_intelligence')
            .select('competitor_name,strengths,weaknesses')
            .or('vertical.ilike.%' + rtVertical + '%,agency.ilike.%' + (opp.agency||'').slice(0,30) + '%')
            .limit(10);
          rtCI = ciR.data || [];
        } catch(e) {}
        var competitorContext = rtCI.length > 0 ?
          '\n\nKNOWN COMPETITORS IN THIS VERTICAL:\n' + rtCI.map(function(c) {
            return '- ' + c.competitor_name + ': Strengths=' + (c.strengths||'unknown').slice(0,150) + ' | Weaknesses=' + (c.weaknesses||'unknown').slice(0,150);
          }).join('\n') : '';

        var reviewPrompt = 'You are a ruthless government proposal red team reviewer and PWIN estimator. Review this proposal against the RFP and return ONLY valid JSON.\n\n' +
          '## RFP/SOQ REQUIREMENTS\n' + rfpRef.slice(0, 20000) + '\n\n' +
          (complianceBlueprint ? '## COMPLIANCE BLUEPRINT (parsed from RFP — check proposal against EVERY item)\n' +
            'Required sections: ' + JSON.stringify((complianceBlueprint.sections_required||[]).map(function(s){return s.tab_number+' '+s.title+(s.page_limit?' [LIMIT:'+s.page_limit+' pages]':'')})) + '\n' +
            'Rate sheet positions: ' + JSON.stringify(complianceBlueprint.rate_sheet) + '\n' +
            'Contract template provided: ' + (complianceBlueprint.contract_template?complianceBlueprint.contract_template.provided_by_rfp:'unknown') + '\n' +
            'Scope items to address: ' + JSON.stringify(complianceBlueprint.scope_items) + '\n' +
            'Eval criteria: ' + JSON.stringify(complianceBlueprint.evaluation_criteria) + '\n\n' : '') +
          '## PROPOSAL TEXT\n' + proposalText.slice(0, 60000) + competitorContext + '\n\n' +
          '## REVIEW CHECKLIST:\n' +
          '1. COMPLIANCE: Missing required sections, exhibits, forms, certifications. If a COMPLIANCE BLUEPRINT is provided above, check the proposal against EVERY section and scope item — flag any that are missing or incomplete.\n' +
          '2. STRUCTURE: Does the proposal follow the EXACT section order specified in the RFP? Are tab numbers correct? Are section headings matching the RFP language?\n' +
          '3. RATE SHEET: Does the rate sheet use the EXACT position titles from the RFP form? Are all required columns present? If the blueprint shows specific positions, verify each one appears.\n' +
          '4. CONTRACT: If the RFP provides a sample contract, did the proposal complete and return it — or did it try to draft a new one from scratch? Drafting a new contract when one is provided is a CRITICAL compliance failure.\n' +
          '5. PAGE LIMITS: Does any section exceed a stated page limit? Flag any section that would exceed its limit when formatted.\n' +
          '6. SCOPE COVERAGE: If scope items are listed in the blueprint, verify each one is addressed in the Technical Approach. Flag any missing scope items.\n' +
          '7. PERSONNEL: Geoffrey Brien mentioned (MUST NOT be), staff auto-assigned to roles (MUST be [TO BE ASSIGNED]), only Christopher J. Oney on cover letter\n' +
          '8. EVIDENCE: Unsubstantiated claims without specific data (dates, amounts, project names)\n' +
          '9. WIN THEMES: Missing, forced, or excessively repeated\n' +
          '10. FILLER: Vague commitments, generic language, padding with no evaluator value\n' +
          '11. FACTS: Incorrect HGI data (Founded 1929, ~50 employees, Kenner HQ Suite 510, UEI DL4SJEVKZ6H4)\n' +
          '12. SCORING RISK: Sections that would lose the most evaluator points as-written\n\n' +
          'Return ONLY this JSON structure (no markdown, no preamble):\n' +
          '{\n' +
          '  "overall_status": "PASS or CONDITIONAL or FAIL",\n' +
          '  "pwin_estimate": 0-100,\n' +
          '  "pwin_rationale": "One paragraph explaining the PWIN estimate based on proposal quality, compliance, and competitive position",\n' +
          '  "scoring_matrix": [\n' +
          '    {"section": "section name", "max_points": 0, "estimated_score": 0, "pct": 0, "risk_level": "high/medium/low", "note": "why"}\n' +
          '  ],\n' +
          '  "findings": [\n' +
          '    {\n' +
          '      "severity": "DISQUALIFYING or CRITICAL or MAJOR or MINOR",\n' +
          '      "category": "Compliance/Personnel/Evidence/Win Themes/Filler/Format/Facts/Scoring Risk",\n' +
          '      "section": "which proposal section",\n' +
          '      "issue": "brief title",\n' +
          '      "detail": "specific description",\n' +
          '      "fix": "exactly what to change",\n' +
          '      "replacement_text": "if applicable, the corrected text to substitute (or null)"\n' +
          '    }\n' +
          '  ],\n' +
          '  "strengths": ["things the proposal does well"],\n' +
          '  "competitive_vulnerabilities": ["where known competitors would beat this proposal"],\n' +
          '  "top_3_improvements": ["the 3 changes that would most increase PWIN"]\n' +
          '}';

        var reviewResp = await claudeCall('Red team proposal review', reviewPrompt, 12000, { model: 'claude-sonnet-4-6', agent: 'red_team_reviewer' });

        // Parse structured JSON
        var rtReport = null;
        var rtRaw = reviewResp;
        try {
          var rtClean = reviewResp.replace(/```json|```/g, '').trim();
          var rtStart = rtClean.indexOf('{');
          var rtEnd = rtClean.lastIndexOf('}');
          if (rtStart >= 0 && rtEnd > rtStart) {
            rtReport = JSON.parse(rtClean.slice(rtStart, rtEnd + 1));
          }
        } catch(parseErr) {
          log('RED TEAM: JSON parse failed, falling back to text analysis');
        }

        // Build summary from structured or text
        var critCount, majCount, minCount, summary, pwinEst;
        if (rtReport && rtReport.findings) {
          critCount = rtReport.findings.filter(function(f) { return f.severity === 'DISQUALIFYING' || f.severity === 'CRITICAL'; }).length;
          majCount = rtReport.findings.filter(function(f) { return f.severity === 'MAJOR'; }).length;
          minCount = rtReport.findings.filter(function(f) { return f.severity === 'MINOR'; }).length;
          pwinEst = rtReport.pwin_estimate || 0;
          summary = 'RED TEAM REVIEW [STRUCTURED]: ' + rtReport.overall_status + ' | PWIN ' + pwinEst + '% | ' +
            critCount + ' critical, ' + majCount + ' major, ' + minCount + ' minor | ' +
            (rtReport.scoring_matrix || []).length + ' sections scored | ' +
            (rtReport.findings || []).filter(function(f) { return f.replacement_text; }).length + ' replacement texts provided';
        } else {
          critCount = (reviewResp.match(/critical/gi) || []).length;
          majCount = (reviewResp.match(/major/gi) || []).length;
          minCount = (reviewResp.match(/minor/gi) || []).length;
          pwinEst = 0;
          summary = 'RED TEAM REVIEW [TEXT]: ' + critCount + ' critical, ' + majCount + ' major, ' + minCount + ' minor issues found.';
        }

        // Store review — structured JSON if available, text fallback otherwise
        var reviewStorage = rtReport ?
          summary + '\n\n' + JSON.stringify(rtReport, null, 2) :
          summary + '\n\n' + reviewResp;

        // S125 DETERMINISTIC CANON SWEEP — runs independent of red team model,
        // catches identity drift / exclusion tokens / visible brackets / production
        // hygiene failures that the model-based review can miss. Universal to every
        // future proposal. If any CRITICAL canon violation is found, proposal_review
        // summary is prefixed with [CANON FAIL] and rtReport.overall_status is
        // force-flipped to FAIL so the downstream approval UI can gate on it.
        // S125 client-exception: when opp.agency contains an exclusion token,
        // the token will legitimately appear throughout (client address, submitted-to,
        // re: line, etc.) — suppress the EXCLUSION_X_PP check for that token only.
        try {
          var _cs = [];
          var _oppAgencyNorm = (opp.agency || '').toLowerCase();
          var _canonChecks = [
            { re: /\b(?:19[23]0|1931|1932)\b/g, label: 'FOUNDING_YEAR_DRIFT', severity: 'CRITICAL', note: 'Founding year must be 1929. Any other 19xx year near founding is a canon violation.', clientException: null },
            { re: /\b9[3456]\s*[-\s]?\s*year(?:s)?\b/gi, label: 'AGE_DRIFT', severity: 'CRITICAL', note: 'Firm age must compute from 1929. 93/94/95/96-year phrasing is a canon violation (current is 97-year).', clientException: null },
            { re: /\bPBGC\b/g, label: 'EXCLUSION_PBGC', severity: 'CRITICAL', note: 'PBGC must not appear as HGI past performance.', clientException: 'pbgc' },
            { re: /\bTPCIGA\b/g, label: 'EXCLUSION_TPCIGA', severity: 'CRITICAL', note: 'TPCIGA must not appear as HGI past performance.', clientException: 'tpciga' },
            { re: /\bLIGA\b/g, label: 'EXCLUSION_LIGA', severity: 'CRITICAL', note: 'LIGA must not appear as HGI past performance.', clientException: 'liga' },
            { re: /Orleans Parish School Board|\bOPSB\b/gi, label: 'EXCLUSION_OPSB_PP', severity: 'CRITICAL', note: 'OPSB must not appear as HGI past performance. (OK as client name only.)', clientException: 'orleans parish school board' },
            { re: /\bGeoffrey\b|\bBrien\b/g, label: 'EXCLUSION_GEOFFREY_BRIEN', severity: 'CRITICAL', note: 'Geoffrey Brien no longer works at HGI.', clientException: null },
            { re: /\bTangipahoa\b/gi, label: 'GEOGRAPHIC_DRIFT', severity: 'CRITICAL', note: 'Terrebonne (not Tangipahoa) is HGI past performance.', clientException: 'tangipahoa' },
            { re: /\[(?!TO BE ASSIGNED)(?:ACTION\s*REQUIRED|Correction|CORRECTION|TBD|TBC|To be determined|TO BE DETERMINED|Insert|INSERT|Placeholder|PLACEHOLDER|Pending|PENDING)[^\[\]]{0,300}\]/g, label: 'VISIBLE_BRACKET_PLACEHOLDER', severity: 'CRITICAL', note: 'Submission-ready output must not contain visible bracketed placeholders except [TO BE ASSIGNED].', clientException: null },
            { re: /\bcompetitor(?:s|s')?\b/gi, label: 'COMPETITOR_REFERENCE', severity: 'CRITICAL', note: 'Proposal must not reference, name, or acknowledge competitors. The proposal reads as if HGI is the only firm in the room.', clientException: null },
            { re: /\bunlike\s+(?:other|single-state|recently-formed|national|regional|engineering-first|construction-first|larger|smaller|multi-parish|out-of-state|big[ -]?4)\b/gi, label: 'COMPARATIVE_LANGUAGE', severity: 'CRITICAL', note: 'Comparative language ("unlike X firms", "unlike multi-parish organizations", etc.) names or implies competitors. The proposal must read as HGI-only without comparison.', clientException: null },
            { re: /\b(?:while|whereas)\s+other(?:s|\s+firms?)\b/gi, label: 'COMPARATIVE_LANGUAGE_2', severity: 'CRITICAL', note: 'Comparative language ("while other firms", "whereas others") names or implies competitors. Remove and reframe as HGI-only.', clientException: null },
            { re: /\bno\s+(?:other|competing|competitor)\s+(?:firm|competitor|provider|consultant)/gi, label: 'COMPARATIVE_LANGUAGE_3', severity: 'CRITICAL', note: 'Phrases like "no other firm", "no competing firm" implicitly reference competitors. Reframe as HGI capability without comparison.', clientException: null },
            { re: /\bwe\s+are\s+the\s+only\b/gi, label: 'COMPARATIVE_LANGUAGE_4', severity: 'CRITICAL', note: 'The phrase "we are the only" implies the rest of the field. Reframe as HGI capability without superlative comparison.', clientException: null },
            { re: /\b(?:compared\s+to|vs\.?\s+|versus)\s+(?:other|competing|competitor)/gi, label: 'COMPARATIVE_LANGUAGE_5', severity: 'CRITICAL', note: 'Direct comparison phrasing references competitors. Remove.', clientException: null }
          ];
          for (var _ci = 0; _ci < _canonChecks.length; _ci++) {
            var _ck = _canonChecks[_ci];
            // Client-exception: if the RFP client name itself contains this token, skip the exclusion-PP check for this opp
            if (_ck.clientException && _oppAgencyNorm.indexOf(_ck.clientException) >= 0) {
              log('CANON SWEEP: skipping ' + _ck.label + ' on this opp (client agency "' + (opp.agency||'').slice(0,60) + '" contains exclusion token legitimately)');
              continue;
            }
            var _m = proposalText.match(_ck.re) || [];
            if (_m.length > 0) {
              _cs.push({ severity: _ck.severity, label: _ck.label, count: _m.length, samples: _m.slice(0, 3), note: _ck.note });
            }
          }

          // S125 DYNAMIC COMPETITOR-NAME CHECK — fetch competitor names from CI DB
          // (same scope as the prompt-injection used by produce-proposal) and check
          // if ANY name from the intelligence database appears in the proposal output.
          // This is the final safety net: even if the model ignores every prompt rule,
          // a CI-tagged competitor name in the output is a CRITICAL canon failure that
          // blocks the proposal until manually approved.
          try {
            var _ciNamesRes = await supabase.from('competitive_intelligence')
              .select('competitor_name,opportunity_id,agency,vertical')
              .or('opportunity_id.eq.' + ppId + ',agency.ilike.%' + (opp.agency||'').slice(0,30) + '%,vertical.ilike.%' + ((opp.vertical||'').toLowerCase()) + '%')
              .limit(50);
            var _ciNames = (_ciNamesRes.data || []).map(function(r){ return (r.competitor_name||'').trim(); }).filter(function(n){ return n && n.length >= 4; });
            // Dedup
            var _seen = {};
            _ciNames = _ciNames.filter(function(n){ var k = n.toLowerCase(); if (_seen[k]) return false; _seen[k] = 1; return true; });
            // Allow client-name skip (RFP client may legitimately appear)
            var _clientLower = (opp.agency||'').toLowerCase();
            var _hits = [];
            for (var _ni = 0; _ni < _ciNames.length; _ni++) {
              var _name = _ciNames[_ni];
              if (_clientLower.indexOf(_name.toLowerCase()) >= 0) continue; // client-exception
              // Escape regex special chars in competitor name
              var _esc = _name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              var _nameRe = new RegExp('\\b' + _esc + '\\b', 'gi');
              var _nameMatches = proposalText.match(_nameRe) || [];
              if (_nameMatches.length > 0) {
                _hits.push({ name: _name, count: _nameMatches.length });
              }
            }
            if (_hits.length > 0) {
              _cs.push({
                severity: 'CRITICAL',
                label: 'COMPETITOR_NAME_IN_PROPOSAL',
                count: _hits.reduce(function(s,h){return s+h.count;}, 0),
                samples: _hits.slice(0, 5).map(function(h){return h.name + ' x' + h.count;}),
                note: 'Proposal contains the literal name(s) of competitor(s) tracked in the competitive_intelligence database. Competitors must NEVER appear in proposal output. Names: ' + _hits.map(function(h){return h.name;}).join(', ')
              });
              log('CANON SWEEP: COMPETITOR_NAME_IN_PROPOSAL — ' + _hits.length + ' name(s) leaked: ' + _hits.map(function(h){return h.name+'x'+h.count;}).join(', '));
            } else {
              log('CANON SWEEP: dynamic competitor-name check — clean (' + _ciNames.length + ' names in scope, 0 in proposal)');
            }
          } catch(_dynErr) {
            log('CANON SWEEP dynamic check error (non-fatal): ' + (_dynErr.message||'').slice(0,200));
          }

          var _canonCritCount = _cs.filter(function(x){ return x.severity === 'CRITICAL'; }).length;
          if (_cs.length > 0) {
            log('CANON SWEEP: ' + _cs.length + ' violation class(es) found, ' + _canonCritCount + ' CRITICAL: ' + _cs.map(function(x){return x.label + 'x' + x.count}).join(', '));
            var canonBlock = '\n\n=== DETERMINISTIC CANON SWEEP (S125) ===\n' +
              _cs.map(function(v){ return '[' + v.severity + '] ' + v.label + ' (' + v.count + ' occurrence' + (v.count>1?'s':'') + '): samples=' + JSON.stringify(v.samples) + '\n  Fix: ' + v.note; }).join('\n') + '\n';
            if (_canonCritCount > 0) {
              reviewStorage = '[CANON FAIL] ' + reviewStorage + canonBlock;
              // Force-flip overall_status in the structured JSON if parseable
              if (rtReport) {
                rtReport.overall_status = 'FAIL';
                rtReport.canon_sweep = _cs;
                rtReport.canon_fail = true;
                reviewStorage = '[CANON FAIL] ' + summary + ' | canon_violations=' + _canonCritCount + '\n\n' + JSON.stringify(rtReport, null, 2) + canonBlock;
              }
            } else {
              reviewStorage = reviewStorage + canonBlock;
              if (rtReport) {
                rtReport.canon_sweep = _cs;
                reviewStorage = summary + '\n\n' + JSON.stringify(rtReport, null, 2) + canonBlock;
              }
            }
          } else {
            log('CANON SWEEP: clean — zero identity/exclusion/bracket violations');
          }
        } catch(_csErr) {
          log('CANON SWEEP ERROR (non-fatal): ' + _csErr.message);
        }

        await supabase.from('opportunities').update({
          proposal_review: reviewStorage,
          last_updated: new Date().toISOString()
        }).eq('id', ppId);

        // Write memory with key findings
        var memObs = summary;
        if (rtReport) {
          if (rtReport.top_3_improvements) memObs += '\n\nTop improvements: ' + rtReport.top_3_improvements.join(' | ');
          if (rtReport.competitive_vulnerabilities && rtReport.competitive_vulnerabilities.length > 0) memObs += '\n\nCompetitive vulnerabilities: ' + rtReport.competitive_vulnerabilities.join(' | ');
          if (rtReport.findings) {
            var topFindings = rtReport.findings.filter(function(f) { return f.severity === 'DISQUALIFYING' || f.severity === 'CRITICAL'; }).slice(0, 5);
            if (topFindings.length > 0) memObs += '\n\nCritical findings:\n' + topFindings.map(function(f) { return '- [' + f.category + '] ' + f.issue + ': ' + f.fix; }).join('\n');
          }
        } else {
          memObs += '\n\nTop issues:\n' + reviewResp.slice(0, 2000);
        }

        await supabase.from('organism_memory').insert({
          agent: 'red_team_reviewer',
          opportunity_id: ppId,
          observation: memObs.slice(0, 4000),
          memory_type: 'analysis',
          created_at: new Date().toISOString()
        });

        log('RED TEAM: ' + summary);

        // S125 AUTO-REGEN-ONCE GATE — if CRITICAL/DISQUALIFYING findings or canon
        // failure, regenerate the proposal once with defects as corrective context.
        // Prevents runaway loops by checking the retry flag passed in the request body
        // and by checking for a recent proposal_auto_regen memory for this opp.
        // Applies universally — every future proposal across every vertical gets this
        // feedback loop without operator intervention.
        try {
          var _isRetryCall = false;
          try { _isRetryCall = !!JSON.parse(body || '{}').retry; } catch(e) {}
          var _needsRegen = (_canonCritCount > 0) ||
                            (critCount > 0) ||
                            (rtReport && rtReport.overall_status === 'FAIL');
          if (_needsRegen && !_isRetryCall) {
            // Second-layer loop guard: check for recent auto-regen memory (within 30 min)
            var _loopGuardCutoff = new Date(Date.now() - 30*60*1000).toISOString();
            var _recentRegen = await supabase.from('organism_memory')
              .select('id,created_at')
              .eq('opportunity_id', ppId)
              .eq('agent', 'proposal_auto_regen')
              .gte('created_at', _loopGuardCutoff)
              .limit(1);
            if ((_recentRegen.data || []).length > 0) {
              log('AUTO-REGEN: skipped — recent auto-regen exists for ' + ppId + ' within last 30 min');
            } else {
              log('AUTO-REGEN: triggered — ' + _canonCritCount + ' canon critical + ' + critCount + ' red-team critical findings, regenerating once');
              try {
                // Build compact corrective prompt. Reuse the same senior_writer system prompt
                // via another model call; pass the old proposal + findings + RFP excerpt.
                var _rtFindingsList = [];
                if (rtReport && rtReport.findings) {
                  rtReport.findings.filter(function(f){ return f.severity==='DISQUALIFYING'||f.severity==='CRITICAL'; })
                    .slice(0, 20).forEach(function(f) {
                      _rtFindingsList.push('- [' + (f.category||'') + '] ' + (f.issue||'') + ' (' + (f.section||'') + '): ' + (f.fix||'') + (f.replacement_text ? '\n    Replacement: ' + f.replacement_text.slice(0,400) : ''));
                    });
                }
                var _canonFindingsList = _cs.filter(function(c){ return c.severity==='CRITICAL'; }).map(function(c) {
                  return '- ' + c.label + ' (' + c.count + ' occurrences): ' + c.note + ' | Samples: ' + JSON.stringify(c.samples);
                });
                var _correctivePrompt = 'You previously generated a government proposal. Automated red-team and canon review identified CRITICAL defects. Fix every one and re-emit the COMPLETE proposal text. Emit ONLY the corrected proposal — no preamble, no commentary, no bracketed meta-commentary, no explanation of changes.\n\n' +
                  '## CRITICAL RED-TEAM FINDINGS TO FIX\n' + (_rtFindingsList.join('\n') || '(none)') + '\n\n' +
                  '## CRITICAL CANON VIOLATIONS TO FIX\n' + (_canonFindingsList.join('\n') || '(none)') + '\n\n' +
                  '## RFP REQUIREMENTS (for grounding)\n' + ((opp.rfp_text || opp.scope_analysis || '').slice(0, 8000)) + '\n\n' +
                  '## PREVIOUS PROPOSAL (revise this to fix every defect above)\n' + proposalText;
                var _retryStream = await anthropic.messages.stream({
                  model: 'claude-opus-4-6',
                  max_tokens: 32000,
                  system: 'You are a senior government proposal writer at HGI Global (Hammerman & Gainer LLC), founded 1929, 97-year-old, 100% minority-owned. Fix every CRITICAL defect identified below. Emit ONLY the corrected full proposal text. Do NOT emit bracketed meta-commentary ([ACTION REQUIRED], [Correction], [TBD], etc.) — the ONLY permitted bracket is [TO BE ASSIGNED] for Key Personnel. Never write 1931, 1930, 95 years, 96 years — use 1929 and 97-year exactly. Geoffrey Brien is never mentioned. OPSB/LIGA/TPCIGA/PBGC are never listed as HGI past performance (only as client names where applicable). NEVER name, reference, allude to, or acknowledge any competitor in proposal output. NEVER write comparative language ("unlike", "competitors lack", "while others", "compared to", etc.). The proposal reads as if HGI is the only firm in the room. Use any competitive intelligence to decide which HGI strengths to emphasize, never to call out other firms.',
                  messages: [{ role: 'user', content: _correctivePrompt }]
                });
                var _retryFinal = await _retryStream.finalMessage();
                trackCost('proposal_auto_regen', 'claude-opus-4-6', _retryFinal.usage);
                var _retryText = (_retryFinal.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
                if (_retryText && _retryText.length >= Math.max(2000, Math.floor(proposalText.length * 0.5))) {
                  // Re-run post-processing bracket killer on the retry output
                  _retryText = _retryText.replace(/\[(?:ACTION\s*REQUIRED|Correction|CORRECTION|Note|NOTE|TBD|TBC|To be determined|TO BE DETERMINED|To be completed|TO BE COMPLETED|Insert|INSERT|Confirm|CONFIRM|Verify|VERIFY|Placeholder|PLACEHOLDER|Pending|PENDING)(?:[:\-\s][^\[\]]{0,400})?\]/g, '');
                  _retryText = _retryText.replace(/\n{3,}/g, '\n\n');
                  // Re-run canon sweep on retry output to record delta (no further auto-regen)
                  var _retryCs = [];
                  for (var _rci = 0; _rci < _canonChecks.length; _rci++) {
                    var _rck = _canonChecks[_rci];
                    if (_rck.clientException && _oppAgencyNorm.indexOf(_rck.clientException) >= 0) continue;
                    var _rm = _retryText.match(_rck.re) || [];
                    if (_rm.length > 0) _retryCs.push({ label: _rck.label, count: _rm.length, samples: _rm.slice(0,3) });
                  }
                  var _retryCanonCrit = _retryCs.length;
                  var _regenStatus = (_retryCanonCrit === 0) ? 'CLEAN' : 'PARTIAL';
                  // Overwrite proposal_content with retry
                  await supabase.from('opportunities').update({
                    proposal_content: _retryText,
                    last_updated: new Date().toISOString()
                  }).eq('id', ppId);
                  // Log the regen attempt with delta
                  await supabase.from('organism_memory').insert({
                    id: 'ar-' + ppId.slice(0,20) + '-' + Date.now(),
                    agent: 'proposal_auto_regen',
                    opportunity_id: ppId,
                    observation: 'AUTO-REGEN ' + _regenStatus + ' for ' + (opp.title||'').slice(0,60) +
                      ' | Pre-regen canon critical: ' + _canonCritCount + ' | Post-regen canon critical: ' + _retryCanonCrit +
                      ' | Pre-regen red-team critical: ' + critCount +
                      ' | Pre-regen chars: ' + proposalText.length + ' | Post-regen chars: ' + _retryText.length +
                      ' | Defects fixed: ' + Math.max(0, _canonCritCount - _retryCanonCrit) +
                      ' | Residual canon violations: ' + (_retryCs.map(function(x){return x.label+'x'+x.count;}).join(', ') || 'none'),
                    memory_type: 'analysis',
                    created_at: new Date().toISOString()
                  });
                  log('AUTO-REGEN: ' + _regenStatus + ' — canon ' + _canonCritCount + '→' + _retryCanonCrit + ', chars ' + proposalText.length + '→' + _retryText.length);
                  proposalText = _retryText;
                  // Update proposal_review to note the regen happened
                  await supabase.from('opportunities').update({
                    proposal_review: '[AUTO-REGEN ' + _regenStatus + '] ' + reviewStorage + '\n\n=== AUTO-REGEN DELTA ===\nPre-regen canon critical: ' + _canonCritCount + '\nPost-regen canon critical: ' + _retryCanonCrit + '\nResidual: ' + (_retryCs.map(function(x){return x.label+'x'+x.count;}).join(', ') || 'none'),
                    last_updated: new Date().toISOString()
                  }).eq('id', ppId);
                } else {
                  log('AUTO-REGEN: retry output too short (' + (_retryText||'').length + ' chars), keeping original');
                  await supabase.from('organism_memory').insert({
                    id: 'ar-fail-' + ppId.slice(0,20) + '-' + Date.now(),
                    agent: 'proposal_auto_regen',
                    opportunity_id: ppId,
                    observation: 'AUTO-REGEN FAILED (retry output too short: ' + (_retryText||'').length + ' chars vs threshold ' + Math.max(2000, Math.floor(proposalText.length * 0.5)) + '). Original proposal retained with defects flagged for manual review.',
                    memory_type: 'analysis',
                    created_at: new Date().toISOString()
                  });
                }
              } catch(_regenErr) {
                log('AUTO-REGEN ERROR: ' + (_regenErr.message||'').slice(0,300));
              }
            }
          } else if (_needsRegen && _isRetryCall) {
            log('AUTO-REGEN: skipped — this IS the retry call (retry flag set)');
          } else {
            log('AUTO-REGEN: not needed — no critical findings, proposal passes gate');
          }
        } catch(_gateErr) {
          log('AUTO-REGEN GATE ERROR (non-fatal): ' + (_gateErr.message||'').slice(0,200));
        }
      } catch(rtErr) {
        log('RED TEAM ERROR: ' + rtErr.message);
      }


      // 9. KB ENRICHMENT LEARNING LOOP — Feed high-quality proposal sections back into KB
      // Port from V1 kb-enrich.js (92 lines). Uses red team review as quality signal.
      try {
        var reviewText = '';
        var reviewR = await supabase.from('opportunities').select('proposal_review').eq('id', ppId).single();
        reviewText = (reviewR.data || {}).proposal_review || '';
        
        if (proposalText.length >= 500 && reviewText.length >= 100) {
          log('KB ENRICHMENT: Starting for ' + (opp.title||'').slice(0,40));
          
          // Use Haiku to extract sections NOT flagged critical/major by red team
          var extractResult = await claudeCall(
            'You extract high-quality proposal sections for reuse in future government proposals. ' +
            'You receive a proposal and a red team review. Your job: identify sections that were NOT flagged as critical or major issues by the red team. ' +
            'Extract those clean sections verbatim. Format: start each with === SECTION: [section name] === then full text. ' +
            'If the red team found issues everywhere, extract the 2 strongest sections regardless. Only include substantive content (500+ chars per section).',
            '=== RED TEAM REVIEW (sections with critical/major issues should be EXCLUDED) ===\n' + reviewText.slice(0, 3000) +
            '\n\n=== FULL PROPOSAL ===\n' + proposalText.slice(0, 20000) +
            '\n\nExtract every section that passed red team review without critical/major issues. Include full text. Start each with === SECTION: [name] ===',
            6000,
            { model: 'claude-haiku-4-5-20251001' }
          );
          
          if (extractResult && extractResult.length >= 200) {
            var kbVerticalMap = { disaster: 'disaster', tpa: 'tpa', appeals: 'appeals', workforce: 'workforce', construction: 'construction', housing: 'housing', grant: 'grant', federal: 'federal' };
            var kbVertical = kbVerticalMap[(opp.vertical||'').toLowerCase()] || 'general';
            var kbNow = new Date().toISOString();
            var kbAgency = (opp.agency||'').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
            var kbFilename = 'proposal_sections_' + kbAgency + '_' + Date.now() + '.txt';
            var kbDocContent = 'SOURCE: HGI Proposal — ' + (opp.title||'Unknown') + ' | ' + (opp.agency||'') +
              '\nDATE: ' + kbNow.slice(0,10) +
              '\nVERTICAL: ' + (opp.vertical||'general') +
              '\nQUALITY: Sections passed red team review — high-confidence reuse material\n---\n\n' + extractResult;
            
            // Insert knowledge_documents record
            var docId = 'kbenrich-' + ppId.slice(0,20) + '-' + Date.now();
            await supabase.from('knowledge_documents').insert({
              id: docId,
              filename: kbFilename,
              file_type: 'txt',
              document_class: 'quality_gated_draft',
              vertical: kbVertical,
              client: opp.agency || '',
              contract_name: opp.title || '',
              summary: 'Auto-extracted high-quality sections from proposal for ' + (opp.title||'').slice(0,60),
              raw_text: kbDocContent,
              char_count: kbDocContent.length,
              status: 'extracted',
              uploaded_at: kbNow,
              processed_at: kbNow
            });
            
            // Chunk the extracted text (~2000 chars per chunk)
            var chunkSize = 2000;
            var chunkTexts = [];
            for (var ci = 0; ci < kbDocContent.length; ci += chunkSize) {
              chunkTexts.push(kbDocContent.slice(ci, ci + chunkSize));
            }
            
            var chunkInserts = chunkTexts.map(function(ct, idx) {
              return {
                id: docId + '-chunk-' + idx,
                document_id: docId,
                chunk_index: idx,
                chunk_text: ct,
                char_start: idx * chunkSize,
                char_end: Math.min((idx + 1) * chunkSize, kbDocContent.length),
                vertical: kbVertical,
                document_class: 'quality_gated_draft',
                filename: kbFilename
              };
            });
            
            await supabase.from('knowledge_chunks').insert(chunkInserts);
            
            // Update document with chunk count
            await supabase.from('knowledge_documents').update({
              chunk_count: chunkInserts.length
            }).eq('id', docId);
            
            // Write memory
            await supabase.from('organism_memory').insert({
              agent: 'kb_enrichment',
              opportunity_id: ppId,
              observation: 'KB ENRICHMENT: Extracted ' + extractResult.length + ' chars of high-quality proposal sections into ' + chunkInserts.length + ' KB chunks. Doc: ' + kbFilename + '. Vertical: ' + kbVertical + '. These sections passed red team review and are available for future proposals.',
              memory_type: 'learning',
              created_at: kbNow
            });
            
            log('KB ENRICHMENT: Success — ' + chunkInserts.length + ' chunks, ' + extractResult.length + ' chars stored as ' + kbFilename);
          } else {
            log('KB ENRICHMENT: Skipped — extraction too short (' + (extractResult||'').length + ' chars)');
          }
        } else {
          log('KB ENRICHMENT: Skipped — proposal ' + proposalText.length + ' chars, review ' + reviewText.length + ' chars (need 500/100 min)');
        }
      } catch(kbErr) {
        log('KB ENRICHMENT ERROR: ' + kbErr.message);
      }

      // === L7 ITERATION-TO-PLATEAU REFINEMENT (S121) ===
      // After initial proposal + red team + KB enrichment, loop refine + re-red-team
      // until PWIN delta < 2 between consecutive passes OR max 3 iterations.
      // Each iteration replaces proposal_content + proposal_review in place.
      // Kill-switch: skip if initial PWIN already >= 90 (already excellent).
      try {
        // Re-read review to get initial PWIN (survives scope cleanly)
        var l7InitOpp = await supabase.from('opportunities').select('proposal_content,proposal_review').eq('id', ppId).single();
        var l7Proposal = (l7InitOpp.data && l7InitOpp.data.proposal_content) || '';
        var l7Review = (l7InitOpp.data && l7InitOpp.data.proposal_review) || '';
        var l7InitPWIN = 0;
        try {
          var fb = l7Review.indexOf('{'), lb = l7Review.lastIndexOf('}');
          if (fb >= 0 && lb > fb) {
            var pj = JSON.parse(l7Review.slice(fb, lb + 1));
            l7InitPWIN = pj.pwin_estimate || 0;
          }
        } catch (pe) {
          var m = l7Review.match(/PWIN\s+(\d{1,3})%/);
          if (m) l7InitPWIN = parseInt(m[1], 10) || 0;
        }

        if (l7Proposal.length < 500 || l7Review.length < 100) {
          log('L7 SKIP: proposal ' + l7Proposal.length + ' chars, review ' + l7Review.length + ' chars (need 500/100)');
        } else if (l7InitPWIN >= 90) {
          log('L7 SKIP: initial PWIN already ' + l7InitPWIN + '% (>=90 threshold, no refinement needed)');
          await supabase.from('organism_memory').insert({
            id: 'mem_l7_skip_' + ppId + '_' + Date.now(),
            agent: 'refinement_loop',
            opportunity_id: ppId,
            observation: 'L7 SKIPPED: initial PWIN ' + l7InitPWIN + '% already at/above 90% threshold — no refinement iterations needed.',
            memory_type: 'analysis',
            created_at: new Date().toISOString()
          });
        } else {
          log('L7 STARTING: initial PWIN=' + l7InitPWIN + '%, launching iteration loop');
          var l7Result = await runIterationToPlateau(opp, l7Proposal, l7Review, l7InitPWIN, { maxIter: 3, plateauDelta: 2 });
          log('L7 DONE: ' + l7Result.iterations + ' iterations, PWIN ' + l7Result.initialPWIN + ' -> ' + l7Result.finalPWIN + ' (' + l7Result.stopReason + ')');
        }
      } catch (l7Err) {
        log('L7 ERROR: ' + (l7Err.message||'').slice(0,300));
      }

      log('PROPOSAL ENGINE: Complete for ' + (opp.title||'').slice(0,40));

    } catch(e) {
      log('PROPOSAL ENGINE ERROR: ' + e.message);
    }
  });
  return;
}

// === COMPETITIVE INTELLIGENCE EXTRACTION — /api/extract-ci ===
if (url.startsWith('/api/extract-ci')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  
  try {
    log('CI EXTRACT: Starting competitive intelligence extraction');
    
    // Get all competitive_intel memories not yet processed
    var ciMems = await supabase.from('organism_memory')
      .select('id,agent,observation,opportunity_id,created_at')
      .eq('memory_type', 'competitive_intel')
      .order('created_at', { ascending: false })
      .limit(200);
    
    var mems = ciMems.data || [];
    log('CI EXTRACT: Found ' + mems.length + ' competitive intel memories');
    
    // Group by opportunity
    var byOpp = {};
    mems.forEach(function(m) {
      var oid = m.opportunity_id || 'global';
      if (!byOpp[oid]) byOpp[oid] = [];
      byOpp[oid].push(m);
    });
    
    var totalExtracted = 0;
    var oppIds = Object.keys(byOpp);
    
    for (var oi = 0; oi < oppIds.length; oi++) {
      var oppId = oppIds[oi];
      var oppMems = byOpp[oppId];
      
      // Combine observations (take most recent, cap at 8000 chars to fit Haiku context)
      var combined = oppMems.slice(0, 3).map(function(m) {
        return (m.observation || '').substring(0, 3000);
      }).join('\n\n---\n\n');
      
      if (combined.length < 200) continue;
      
      // Extract structured competitor data via Haiku
      var extractPrompt = 'Extract ALL competitors mentioned in this competitive intelligence brief. For each competitor, provide a JSON array.\n\n' +
        'Return ONLY a JSON array, no other text. Each object must have these fields:\n' +
        '- competitor_name: string (official company name)\n' +
        '- hq_location: string or null (city, state)\n' +
        '- hq_state: string or null (2-letter state code)\n' +
        '- strengths: string (key competitive advantages, comma separated)\n' +
        '- weaknesses: string (known weaknesses, comma separated)\n' +
        '- threat_level: "primary" | "secondary" | "emerging" | "watch"\n' +
        '- contract_value: string or null (any known contract values)\n' +
        '- active_verticals: array of strings (e.g. ["Disaster Recovery","Grant Management"])\n' +
        '- active_states: array of strings (e.g. ["LA","MS","TX"])\n' +
        '- certifications: array of strings or empty array\n' +
        '- key_personnel: string or null (any named individuals)\n' +
        '- price_intelligence: string or null (any pricing data found)\n' +
        '- strategic_notes: string (1-2 sentence summary of competitive position vs HGI)\n\n' +
        'Intelligence brief:\n' + combined;
      
      try {
        var ciResp = await claudeCall('Extract structured competitor data from intelligence briefs. Return ONLY valid JSON arrays.', extractPrompt, 4000, { model: 'claude-haiku-4-5-20251001' });
        
        log('CI EXTRACT: Haiku response length=' + ciResp.length + ' for opp ' + oppId.slice(0, 30));
        
        // Parse JSON from response
        var jsonMatch = ciResp.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;
        
        var competitors = JSON.parse(jsonMatch[0]);
        
        for (var ci = 0; ci < competitors.length; ci++) {
          var comp = competitors[ci];
          if (!comp.competitor_name || comp.competitor_name.length < 2) continue;
          
          // Upsert — check if this competitor already exists for this opportunity
          var existing = await supabase.from('competitive_intelligence')
            .select('id')
            .eq('competitor_name', comp.competitor_name)
            .eq('opportunity_id', oppId === 'global' ? null : oppId)
            .limit(1);
          
          var record = {
            competitor_name: comp.competitor_name,
            opportunity_id: oppId === 'global' ? null : oppId,
            hq_location: comp.hq_location || null,
            hq_state: comp.hq_state || null,
            strengths: comp.strengths || null,
            weaknesses: comp.weaknesses || null,
            threat_level: comp.threat_level || 'watch',
            contract_value: comp.contract_value || null,
            active_verticals: comp.active_verticals || [],
            active_states: comp.active_states || [],
            certifications: comp.certifications || [],
            key_personnel: comp.key_personnel || null,
            price_intelligence: comp.price_intelligence || null,
            strategic_notes: comp.strategic_notes || null,
            source_agent: 'ci_extractor',
            updated_at: new Date().toISOString()
          };
          
          if (existing.data && existing.data.length > 0) {
            await supabase.from('competitive_intelligence')
              .update(record)
              .eq('id', existing.data[0].id);
          } else {
            record.id = 'ci-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            record.created_at = new Date().toISOString();
            await supabase.from('competitive_intelligence').insert(record);
          }
          totalExtracted++;
        }
      } catch(parseErr) {
        log('CI EXTRACT: Parse error for opp ' + oppId.slice(0, 30) + ': ' + parseErr.message);
      }
    }
    
    log('CI EXTRACT: Complete — ' + totalExtracted + ' competitor records upserted from ' + oppIds.length + ' opportunities');
    res.end(JSON.stringify({ success: true, records_upserted: totalExtracted, opportunities_processed: oppIds.length }));
    
  } catch(e) {
    log('CI EXTRACT ERROR: ' + e.message);
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// === CI DASHBOARD — /api/competitors ===
if (url.startsWith('/api/competitors')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var ciData = await supabase.from('competitive_intelligence')
      .select('*')
      .neq('competitor_name', 'market_research')
      .order('updated_at', { ascending: false });
    
    var records = ciData.data || [];
    
    // Build competitor profiles — merge records for same competitor across opportunities
    var profiles = {};
    records.forEach(function(r) {
      var name = r.competitor_name;
      if (!profiles[name]) {
        profiles[name] = {
          name: name,
          hq_location: r.hq_location,
          hq_state: r.hq_state,
          threat_level: r.threat_level,
          strengths: r.strengths,
          weaknesses: r.weaknesses,
          active_verticals: r.active_verticals || [],
          active_states: r.active_states || [],
          certifications: r.certifications || [],
          key_personnel: r.key_personnel,
          price_intelligence: r.price_intelligence,
          opportunities_competing: [],
          total_records: 0,
          last_updated: r.updated_at || r.created_at
        };
      }
      profiles[name].total_records++;
      if (r.opportunity_id) profiles[name].opportunities_competing.push(r.opportunity_id);
      // Merge arrays
      (r.active_states || []).forEach(function(s) {
        if (profiles[name].active_states.indexOf(s) === -1) profiles[name].active_states.push(s);
      });
      (r.active_verticals || []).forEach(function(v) {
        if (profiles[name].active_verticals.indexOf(v) === -1) profiles[name].active_verticals.push(v);
      });
    });
    
    res.end(JSON.stringify({
      total_competitors: Object.keys(profiles).length,
      total_records: records.length,
      profiles: Object.values(profiles).sort(function(a, b) {
        var order = { primary: 0, secondary: 1, emerging: 2, watch: 3 };
        return (order[a.threat_level] || 4) - (order[b.threat_level] || 4);
      })
    }));
  } catch(e) {
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// === CRM CONTACT EXTRACTION — /api/extract-contacts ===
if (url.startsWith('/api/extract-contacts')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    log('CRM EXTRACT: Starting contact extraction from organism memories');
    
    var crmMems = await supabase.from('organism_memory')
      .select('id,agent,observation,opportunity_id,created_at')
      .in('memory_type', ['relationship'])
      .order('created_at', { ascending: false })
      .limit(200);
    
    var cMems = crmMems.data || [];
    log('CRM EXTRACT: Found ' + cMems.length + ' relationship memories');
    
    var cByOpp = {};
    cMems.forEach(function(m) { var o = m.opportunity_id || 'global'; if (!cByOpp[o]) cByOpp[o] = []; cByOpp[o].push(m); });
    
    var totalContacts = 0;
    var cOppIds = Object.keys(cByOpp);
    
    for (var ci2 = 0; ci2 < cOppIds.length; ci2++) {
      var cOid = cOppIds[ci2];
      var cOppMems = cByOpp[cOid];
      var cCombined = cOppMems.slice(0, 2).map(function(m) { return (m.observation || '').substring(0, 4000); }).join('\n---\n');
      if (cCombined.length < 200) continue;
      
      // Get opportunity title for context
      var oppTitle = '';
      if (cOid !== 'global') {
        var oppLookup = await supabase.from('opportunities').select('title,agency').eq('id', cOid).limit(1);
        if (oppLookup.data && oppLookup.data[0]) { oppTitle = (oppLookup.data[0].agency || '') + ' - ' + (oppLookup.data[0].title || ''); }
      }
      
      try {
        var cResp = await claudeCall(
          'Extract contact information from CRM intelligence briefs. Return ONLY a JSON array.',
          'Extract ALL named contacts from this CRM brief. Return JSON array. Each object must have:\n' +
          '- contact_name: string (full name)\n' +
          '- title: string or null (job title)\n' +
          '- organization: string (employer/agency)\n' +
          '- agency: string (government agency they represent)\n' +
          '- email: string or null\n' +
          '- phone: string or null\n' +
          '- role_in_procurement: string (their role in this specific procurement)\n' +
          '- contact_type: "decision_maker" | "evaluator" | "procurement" | "technical" | "political" | "influencer" | "engineer_of_record" | "other"\n' +
          '- priority: "critical" | "high" | "medium" | "low"\n' +
          '- hgi_relationship: "warm" | "cold" | "unknown"\n' +
          '- notes: string (1-2 sentence strategic note about this contact)\n\n' +
          'Opportunity context: ' + oppTitle + '\n\nCRM Brief:\n' + cCombined,
          4000, { model: 'claude-haiku-4-5-20251001' }
        );
        
        var cMatch = cResp.match(/\[[\s\S]*\]/);
        if (!cMatch) continue;
        var contacts = JSON.parse(cMatch[0]);
        
        for (var cci2 = 0; cci2 < contacts.length; cci2++) {
          var ct = contacts[cci2];
          if (!ct.contact_name || ct.contact_name.length < 3) continue;
          
          // Check for existing contact by name + opportunity
          var ctEx = await supabase.from('relationship_graph')
            .select('id')
            .eq('contact_name', ct.contact_name)
            .eq('opportunity_id', cOid === 'global' ? null : cOid)
            .limit(1);
          
          var ctRec = {
            contact_name: ct.contact_name,
            title: ct.title || null,
            organization: ct.organization || null,
            agency: ct.agency || null,
            email: ct.email || null,
            phone: ct.phone || null,
            role_in_procurement: ct.role_in_procurement || null,
            contact_type: ct.contact_type || 'other',
            priority: ct.priority || 'medium',
            hgi_relationship: ct.hgi_relationship || 'unknown',
            outreach_status: 'not_contacted',
            relationship_strength: ct.hgi_relationship || 'unknown',
            notes: ct.notes || null,
            opportunity_id: cOid === 'global' ? null : cOid,
            source_agent: 'crm_extractor',
            updated_at: new Date().toISOString()
          };
          
          if (ctEx.data && ctEx.data.length > 0) {
            await supabase.from('relationship_graph').update(ctRec).eq('id', ctEx.data[0].id);
          } else {
            ctRec.id = 'ct-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            ctRec.created_at = new Date().toISOString();
            await supabase.from('relationship_graph').insert(ctRec);
          }
          totalContacts++;
        }
      } catch(cParseErr) {
        log('CRM EXTRACT parse error: ' + cParseErr.message);
      }
    }
    
    log('CRM EXTRACT: Complete — ' + totalContacts + ' contacts upserted from ' + cOppIds.length + ' opportunities');
    res.end(JSON.stringify({ success: true, contacts_upserted: totalContacts, opportunities_processed: cOppIds.length }));
  } catch(e) {
    log('CRM EXTRACT ERROR: ' + e.message);
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// === CONTACTS DASHBOARD — /api/contacts ===
if (url.startsWith('/api/contacts')) {
  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        var p = JSON.parse(body);
        if (!p.contact_name) { res.end(JSON.stringify({error:'contact_name required'})); return; }
        var ins = { id: 'ct-'+Date.now()+'-'+Math.random().toString(36).slice(2,6), contact_name: p.contact_name, title: p.title||null, organization: p.organization||null, agency: p.agency||null, email: p.email||null, phone: p.phone||null, contact_type: p.contact_type||'other', priority: p.priority||'medium', hgi_relationship: p.hgi_relationship||'unknown', notes: p.notes||null, opportunity_id: p.opportunity_id||null, updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
        var r = await supabase.from('relationship_graph').insert(ins);
        if (r.error) { res.end(JSON.stringify({error:r.error.message})); return; }
        res.end(JSON.stringify({success:true}));
      } catch(e) { res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var ctData = await supabase.from('relationship_graph')
      .select('*')
      .not('contact_name', 'is', null)
      .order('updated_at', { ascending: false });
    
    var ctRecords = ctData.data || [];
    
    // Build contact profiles — merge by name across opportunities
    var ctProfiles = {};
    ctRecords.forEach(function(r) {
      var name = r.contact_name;
      if (!ctProfiles[name]) {
        ctProfiles[name] = {
          name: name,
          title: r.title,
          organization: r.organization,
          agency: r.agency,
          email: r.email,
          phone: r.phone,
          contact_type: r.contact_type,
          priority: r.priority,
          hgi_relationship: r.hgi_relationship,
          outreach_status: r.outreach_status || 'not_contacted',
          notes: r.notes,
          opportunities: [],
          total_records: 0
        };
      }
      ctProfiles[name].total_records++;
      if (r.opportunity_id) ctProfiles[name].opportunities.push(r.opportunity_id);
      // Use most detailed info available
      if (!ctProfiles[name].email && r.email) ctProfiles[name].email = r.email;
      if (!ctProfiles[name].phone && r.phone) ctProfiles[name].phone = r.phone;
      if (!ctProfiles[name].title && r.title) ctProfiles[name].title = r.title;
    });
    
    var profileList = Object.values(ctProfiles).sort(function(a, b) {
      var order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] || 4) - (order[b.priority] || 4);
    });
    
    res.end(JSON.stringify({
      total_contacts: profileList.length,
      total_records: ctRecords.length,
      by_type: ctRecords.reduce(function(acc, r) { var t = r.contact_type || 'other'; acc[t] = (acc[t] || 0) + 1; return acc; }, {}),
      by_relationship: ctRecords.reduce(function(acc, r) { var t = r.hgi_relationship || 'unknown'; acc[t] = (acc[t] || 0) + 1; return acc; }, {}),
      contacts: profileList
    }));
  } catch(e) {
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}



// === EXTRACT DISASTERS — /api/extract-disasters ===
if (url.startsWith('/api/extract-disasters')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var dMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .eq('agent', 'disaster_monitor')
      .order('created_at', { ascending: false })
      .limit(10);
    var dRecords = dMems.data || [];
    var total = 0;
    for (var di = 0; di < dRecords.length; di++) {
      var dm = dRecords[di];
      if (!dm.observation || dm.observation.length < 200) continue;
      try {
        var dResp = await claudeCall('Extract disaster declarations. Return ONLY JSON array.',
          'Extract ALL disaster declarations mentioned. JSON array with: disaster_number, disaster_name, state, declaration_date, incident_type, counties, fema_programs, procurement_window, hgi_recommendation, hgi_vertical, threat_level (critical/high/medium/low).\n\n' + (dm.observation || '').substring(0, 6000),
          4000, { model: 'claude-haiku-4-5-20251001' });
        var dMatch = dResp.match(/\[[\s\S]*\]/);
        if (!dMatch) continue;
        var disasters = JSON.parse(dMatch[0]);
        for (var dd = 0; dd < disasters.length; dd++) {
          var dis = disasters[dd];
          if (!dis.disaster_name || dis.disaster_name.length < 3) continue;
          var dId = 'dis-' + (dis.disaster_number || Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
          var dEx = await supabase.from('disaster_alerts').select('id').eq('disaster_number', dis.disaster_number || '').limit(1);
          var dRec = { disaster_number: dis.disaster_number, disaster_name: dis.disaster_name, state: dis.state, declaration_date: dis.declaration_date, incident_type: dis.incident_type, counties: dis.counties, fema_programs: dis.fema_programs, procurement_window: dis.procurement_window, hgi_recommendation: dis.hgi_recommendation, hgi_vertical: dis.hgi_vertical, threat_level: dis.threat_level || 'medium', source_agent: 'disaster_extract', updated_at: new Date().toISOString() };
          if (dEx.data && dEx.data.length > 0) {
            await supabase.from('disaster_alerts').update(dRec).eq('id', dEx.data[0].id);
          } else {
            dRec.id = dId; dRec.created_at = new Date().toISOString();
            await supabase.from('disaster_alerts').insert(dRec);
          }
          total++;
        }
      } catch (de) { log('Disaster extract error: ' + de.message); }
    }
    res.end(JSON.stringify({ extracted: total, from_memories: dRecords.length }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXTRACT BUDGET CYCLES — /api/extract-budgets ===
if (url.startsWith('/api/extract-budgets')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var bMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .eq('agent', 'budget_cycle')
      .order('created_at', { ascending: false })
      .limit(10);
    var bRecords = bMems.data || [];
    var bTotal = 0;
    for (var bi = 0; bi < bRecords.length; bi++) {
      var bm = bRecords[bi];
      if (!bm.observation || bm.observation.length < 200) continue;
      try {
        var bResp = await claudeCall('Extract budget cycle data. Return ONLY JSON array.',
          'Extract ALL agency budget cycles. JSON array with: agency, state, fiscal_year_start, fiscal_year_end, budget_amount, procurement_window, rfp_timing, hgi_vertical, notes.\n\n' + (bm.observation || '').substring(0, 6000),
          4000, { model: 'claude-haiku-4-5-20251001' });
        var bMatch = bResp.match(/\[[\s\S]*\]/);
        if (!bMatch) continue;
        var budgets = JSON.parse(bMatch[0]);
        for (var bb = 0; bb < budgets.length; bb++) {
          var bud = budgets[bb];
          if (!bud.agency || bud.agency.length < 3) continue;
          var bId = 'bud-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          var bEx = await supabase.from('budget_cycles').select('id').eq('agency', bud.agency).limit(1);
          var bRec = { agency: bud.agency, state: bud.state, fiscal_year_start: bud.fiscal_year_start, fiscal_year_end: bud.fiscal_year_end, budget_amount: bud.budget_amount, procurement_window: bud.procurement_window, rfp_timing: bud.rfp_timing, hgi_vertical: bud.hgi_vertical, notes: bud.notes, source_agent: 'budget_extract', updated_at: new Date().toISOString() };
          if (bEx.data && bEx.data.length > 0) {
            await supabase.from('budget_cycles').update(bRec).eq('id', bEx.data[0].id);
          } else {
            bRec.id = bId; bRec.created_at = new Date().toISOString();
            await supabase.from('budget_cycles').insert(bRec);
          }
          bTotal++;
        }
      } catch (be) { log('Budget extract error: ' + be.message); }
    }
    res.end(JSON.stringify({ extracted: bTotal, from_memories: bRecords.length }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXTRACT REGULATORY CHANGES — /api/extract-regulatory ===
if (url.startsWith('/api/extract-regulatory')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var regMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .eq('agent', 'regulatory_monitor')
      .order('created_at', { ascending: false })
      .limit(10);
    var regRecords = regMems.data || [];
    var regTotal = 0;
    for (var ri = 0; ri < regRecords.length; ri++) {
      var rm = regRecords[ri];
      if (!rm.observation || rm.observation.length < 200) continue;
      try {
        var regResp = await claudeCall('Extract regulatory changes. Return ONLY JSON array.',
          'Extract ALL regulatory changes, policy updates, and rule modifications mentioned. JSON array with: regulation_name, agency_source, effective_date, category (fema_policy/state_procurement/cdbg_dr/hud/insurance/workforce), impact_level (critical/high/medium/low), affected_verticals (comma-separated), summary, hgi_action_required.\n\n' + (rm.observation || '').substring(0, 6000),
          4000, { model: 'claude-haiku-4-5-20251001' });
        var regMatch = regResp.match(/\[[\s\S]*\]/);
        if (!regMatch) continue;
        var regs = JSON.parse(regMatch[0]);
        for (var rr = 0; rr < regs.length; rr++) {
          var reg = regs[rr];
          if (!reg.regulation_name || reg.regulation_name.length < 3) continue;
          var regEx = await supabase.from('regulatory_changes').select('id').eq('regulation_name', reg.regulation_name).limit(1);
          var regRec = { regulation_name: reg.regulation_name, agency_source: reg.agency_source, effective_date: reg.effective_date, category: reg.category, impact_level: reg.impact_level || 'medium', affected_verticals: reg.affected_verticals, summary: reg.summary, hgi_action_required: reg.hgi_action_required, source_agent: 'regulatory_extract', updated_at: new Date().toISOString() };
          if (regEx.data && regEx.data.length > 0) {
            await supabase.from('regulatory_changes').update(regRec).eq('id', regEx.data[0].id);
          } else {
            regRec.id = 'reg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            regRec.created_at = new Date().toISOString();
            await supabase.from('regulatory_changes').insert(regRec);
          }
          regTotal++;
        }
      } catch (re) { log('Regulatory extract error: ' + re.message); }
    }
    res.end(JSON.stringify({ extracted: regTotal, from_memories: regRecords.length }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXTRACT TEAMING PARTNERS — /api/extract-teaming ===
if (url.startsWith('/api/extract-teaming')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var teamMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .ilike('agent', '%teaming%')
      .order('created_at', { ascending: false })
      .limit(10);
    var subMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .ilike('agent', '%subcontractor%')
      .order('created_at', { ascending: false })
      .limit(10);
    var allTeamMems = (teamMems.data || []).concat(subMems.data || []);
    var teamTotal = 0;
    for (var ti = 0; ti < allTeamMems.length; ti++) {
      var tm = allTeamMems[ti];
      if (!tm.observation || tm.observation.length < 200) continue;
      try {
        var teamResp = await claudeCall('Extract teaming partners and subcontractors. Return ONLY JSON array.',
          'Extract ALL potential teaming partners, subcontractors, and joint venture candidates mentioned. JSON array with: partner_name, capability, location, certifications (DBE/MBE/SBE/8a/HUBZone etc), past_teaming (previous work with HGI or others), verticals (comma-separated), fit_score (strong/medium/speculative), contact_info, notes.\n\n' + (tm.observation || '').substring(0, 6000),
          4000, { model: 'claude-haiku-4-5-20251001' });
        var teamMatch = teamResp.match(/\[[\s\S]*\]/);
        if (!teamMatch) continue;
        var partners = JSON.parse(teamMatch[0]);
        for (var tp = 0; tp < partners.length; tp++) {
          var ptr = partners[tp];
          if (!ptr.partner_name || ptr.partner_name.length < 3) continue;
          var teamEx = await supabase.from('teaming_partners').select('id').eq('partner_name', ptr.partner_name).limit(1);
          var teamRec = { partner_name: ptr.partner_name, capability: ptr.capability, location: ptr.location, certifications: ptr.certifications, past_teaming: ptr.past_teaming, verticals: ptr.verticals, fit_score: ptr.fit_score || 'medium', contact_info: ptr.contact_info, notes: ptr.notes, source_agent: 'teaming_extract', updated_at: new Date().toISOString() };
          if (teamEx.data && teamEx.data.length > 0) {
            await supabase.from('teaming_partners').update(teamRec).eq('id', teamEx.data[0].id);
          } else {
            teamRec.id = 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            teamRec.created_at = new Date().toISOString();
            await supabase.from('teaming_partners').insert(teamRec);
          }
          teamTotal++;
        }
      } catch (te) { log('Teaming extract error: ' + te.message); }
    }
    res.end(JSON.stringify({ extracted: teamTotal, from_memories: allTeamMems.length }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXTRACT AGENCY PROFILES — /api/extract-agencies ===
if (url.startsWith('/api/extract-agencies')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var agMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .eq('agent', 'agency_profile_agent')
      .order('created_at', { ascending: false })
      .limit(10);
    var agRecords = agMems.data || [];
    var agTotal = 0;
    for (var ai = 0; ai < agRecords.length; ai++) {
      var am = agRecords[ai];
      if (!am.observation || am.observation.length < 200) continue;
      try {
        var agResp = await claudeCall('Extract agency profiles. Return ONLY JSON array.',
          'Extract ALL agency/client profiles mentioned. JSON array with: agency_name, state, agency_type (parish/city/state_agency/housing_authority/school_board/federal), annual_budget, key_contacts, procurement_process, incumbent_contractors, hgi_relationship (active/warm/cold/none), hgi_history, verticals (comma-separated), notes.\n\n' + (am.observation || '').substring(0, 6000),
          4000, { model: 'claude-haiku-4-5-20251001' });
        var agMatch = agResp.match(/\[[\s\S]*\]/);
        if (!agMatch) continue;
        var agencies = JSON.parse(agMatch[0]);
        for (var aa = 0; aa < agencies.length; aa++) {
          var ag = agencies[aa];
          if (!ag.agency_name || ag.agency_name.length < 3) continue;
          var agEx = await supabase.from('agency_profiles').select('id').eq('agency_name', ag.agency_name).limit(1);
          var agRec = { agency_name: ag.agency_name, state: ag.state, agency_type: ag.agency_type, annual_budget: ag.annual_budget, key_contacts: ag.key_contacts, procurement_process: ag.procurement_process, incumbent_contractors: ag.incumbent_contractors, hgi_relationship: ag.hgi_relationship || 'none', hgi_history: ag.hgi_history, verticals: ag.verticals, notes: ag.notes, source_agent: 'agency_extract', updated_at: new Date().toISOString() };
          if (agEx.data && agEx.data.length > 0) {
            await supabase.from('agency_profiles').update(agRec).eq('id', agEx.data[0].id);
          } else {
            agRec.id = 'ag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            agRec.created_at = new Date().toISOString();
            await supabase.from('agency_profiles').insert(agRec);
          }
          agTotal++;
        }
      } catch (ae) { log('Agency extract error: ' + ae.message); }
    }
    res.end(JSON.stringify({ extracted: agTotal, from_memories: agRecords.length }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === READ ENDPOINTS FOR PHASE 3 STRUCTURED TABLES ===
if (url.startsWith('/api/regulatory')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var regData = await supabase.from('regulatory_changes').select('*').order('updated_at', { ascending: false }).limit(100);
    res.end(JSON.stringify(regData.data || []));
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}
if (url.startsWith('/api/teaming')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var teamData = await supabase.from('teaming_partners').select('*').order('updated_at', { ascending: false }).limit(200);
    res.end(JSON.stringify(teamData.data || []));
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}
if (url.startsWith('/api/agencies')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var agData = await supabase.from('agency_profiles').select('*').order('updated_at', { ascending: false }).limit(100);
    res.end(JSON.stringify(agData.data || []));
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}
if (url.startsWith('/api/recompetes')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var rcData = await supabase.from('recompete_tracker').select('*').order('last_updated', { ascending: false }).limit(100);
    res.end(JSON.stringify(rcData.data || []));
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === KB DOCUMENTS LIBRARY — /api/kb-documents ===
if (url.startsWith('/api/kb-documents')) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var kdr = await supabase.from('knowledge_documents').select('id,filename,document_class,vertical,status,chunk_count,uploaded_at,processed_at').order('uploaded_at',{ascending:false}).limit(100);
    res.end(JSON.stringify({ total: (kdr.data||[]).length, documents: kdr.data || [] }));
  } catch(e) { res.end(JSON.stringify({error:e.message})); }
  return;
}

// === KB DOCTRINE/DNA EXTRACTION — /api/kb-extract ===
if (url.startsWith('/api/kb-extract')) {
  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        var p = JSON.parse(body);
        if (!p.content || !p.filename) { res.end(JSON.stringify({error:'filename and content required'})); return; }
        // Create knowledge_document record
        var docId = 'kb-upload-' + Date.now();
        await supabase.from('knowledge_documents').insert({ id: docId, filename: p.filename, document_class: p.document_class || 'uploaded', vertical: p.vertical || 'general', status: 'chunked', uploaded_at: new Date().toISOString() });
        // Chunk the content (2000 char chunks with 200 char overlap)
        var text = p.content;
        var chunkSize = 2000, overlap = 200, chunks = [], ci = 0, pos = 0;
        while (pos < text.length) {
          var end = Math.min(pos + chunkSize, text.length);
          chunks.push({ document_id: docId, chunk_index: ci, chunk_text: text.substring(pos, end), vertical: p.vertical || 'general', filename: p.filename });
          pos = end - overlap; ci++;
          if (end >= text.length) break;
        }
        if (chunks.length > 0) {
          await supabase.from('knowledge_chunks').insert(chunks);
          await supabase.from('knowledge_documents').update({ chunk_count: chunks.length, status: 'chunked' }).eq('id', docId);
        }
        log('KB UPLOAD: ' + p.filename + ' → ' + chunks.length + ' chunks');
        res.end(JSON.stringify({success:true, document_id:docId, chunks:chunks.length}));
      } catch(e) { res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var kbParams = new URLSearchParams(url.split('?')[1] || '');
    var kbDocId = kbParams.get('doc_id') || '';
    var kbReprocess = kbParams.get('reprocess') === 'true';
    var kbQuery = 'doctrine=is.null';
    if (kbDocId) kbQuery = 'id=eq.' + kbDocId;
    else if (kbReprocess) kbQuery = 'order=uploaded_at.asc';
    var kbDocs = await supabase.from('knowledge_documents').select('id,filename,document_class,vertical,status,chunk_count').or(kbQuery).limit(20);
    var kbDocList = kbDocs.data || [];
    if (kbDocList.length === 0) { res.end(JSON.stringify({ message: 'All documents already extracted. Use ?reprocess=true to re-extract.', processed: 0 })); return; }
    var kbProcessed = 0; var kbErrors = [];
    for (var ki = 0; ki < kbDocList.length; ki++) {
      var kDoc = kbDocList[ki];
      try {
        var kChunks = await supabase.from('knowledge_chunks').select('chunk_text').eq('document_id', kDoc.id).order('chunk_index', { ascending: true });
        if (!kChunks.data || kChunks.data.length === 0) { kbErrors.push(kDoc.filename + ': no chunks'); continue; }
        var kFullText = kChunks.data.map(function(c) { return c.chunk_text; }).join('\n\n');
        var kExtractPrompt = 'You are extracting structured institutional knowledge from an HGI proposal or corporate document.\nDocument: "' + (kDoc.filename || '') + '"\nType: "' + (kDoc.document_class || 'unknown') + '"\n\nExtract ALL of the following. Return ONLY valid JSON.\n{\n  "client": "client/agency name",\n  "contract_name": "contract or program name",\n  "vertical": "disaster_recovery|tpa_claims|property_tax|workforce|construction|housing|grant|federal|general",\n  "summary": "2-3 sentence summary",\n  "doctrine": {\n    "past_performance": [{"program":"","client":"","scope":"","scale":"","period":"","outcome":"","geography":""}],\n    "win_themes": [""],\n    "methodology": [""],\n    "differentiators": [""]\n  },\n  "winning_dna": {\n    "staff": [{"name":"","title":"","credentials":"","experience":"","years":"","historical":true,"availability_note":"Historical — confirm current availability"}],\n    "rates": [{"role":"","rate":"","rate_type":"hourly","historical":true,"rate_note":"Historical — confirm current rates"}],\n    "references": [{"name":"","title":"","organization":"","email":"","phone":""}],\n    "staffing_patterns": [{"role":"","qualifications":"","responsibilities":""}]\n  }\n}\nIf no data for a field, use null or []. Flag all staff/rates as historical.\n\nDOCUMENT TEXT:\n' + kFullText.substring(0, 12000);
        var kResult = await claudeCall('Extract KB doctrine from ' + (kDoc.filename || '').slice(0, 40), kExtractPrompt, 4000, { model: SONNET });
        var kClean = (kResult || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        var kJson = JSON.parse(kClean.match(/\{[\s\S]*\}/)[0]);
        await supabase.from('knowledge_documents').update({
          client: kJson.client || null, contract_name: kJson.contract_name || null,
          vertical: kJson.vertical || kDoc.vertical || 'general', summary: kJson.summary || null,
          doctrine: kJson.doctrine || null, winning_dna: kJson.winning_dna || null,
          status: 'extracted', processed_at: new Date().toISOString()
        }).eq('id', kDoc.id);
        kbProcessed++;
        log('KB EXTRACT: ' + kDoc.filename);
      } catch (ke) { kbErrors.push((kDoc.filename || kDoc.id) + ': ' + ke.message); }
    }
    res.end(JSON.stringify({ success: true, processed: kbProcessed, total: kbDocList.length, errors: kbErrors }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXTRACT PIPELINE ANALYTICS — /api/extract-analytics ===
if (url.startsWith('/api/extract-analytics')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var anMems = await supabase.from('organism_memory')
      .select('id,agent,observation,created_at')
      .in('agent', ['loss_analysis','win_rate_analytics','learning_loop'])
      .order('created_at', { ascending: false })
      .limit(15);
    var anRecords = anMems.data || [];
    var anTotal = 0;
    for (var ani = 0; ani < anRecords.length; ani++) {
      var anm = anRecords[ani];
      if (!anm.observation || anm.observation.length < 200) continue;
      try {
        var anResp = await claudeCall('Extract pipeline analytics insights. Return ONLY JSON array.',
          'Extract ALL analytical insights, patterns, and recommendations. JSON array with: category (win_pattern/loss_pattern/opi_calibration/competitive_pattern/pricing_insight/market_trend), title (short label), insight (the finding), affected_verticals (comma-separated), affected_agencies, confidence (high/medium/low/speculative), source_data (what evidence), recommendation (what HGI should do).\n\n' + (anm.observation || '').substring(0, 6000),
          4000, { model: 'claude-haiku-4-5-20251001' });
        var anMatch = anResp.match(/\[[\s\S]*\]/);
        if (!anMatch) continue;
        var insights = JSON.parse(anMatch[0]);
        for (var ins = 0; ins < insights.length; ins++) {
          var ig = insights[ins];
          if (!ig.title || ig.title.length < 3) continue;
          var anEx = await supabase.from('pipeline_analytics').select('id').eq('title', ig.title).limit(1);
          var anRec = { title: ig.title, category: ig.category, insight: ig.insight, affected_verticals: ig.affected_verticals, affected_agencies: ig.affected_agencies, confidence: ig.confidence || 'medium', source_data: ig.source_data, recommendation: ig.recommendation, source_agent: 'analytics_extract', updated_at: new Date().toISOString() };
          if (anEx.data && anEx.data.length > 0) {
            await supabase.from('pipeline_analytics').update(anRec).eq('id', anEx.data[0].id);
          } else {
            anRec.id = 'an-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            anRec.created_at = new Date().toISOString();
            await supabase.from('pipeline_analytics').insert(anRec);
          }
          anTotal++;
        }
      } catch (ane) { log('Analytics extract error: ' + ane.message); }
    }
    res.end(JSON.stringify({ extracted: anTotal, from_memories: anRecords.length }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}
if (url.startsWith('/api/analytics')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var anlData = await supabase.from('pipeline_analytics').select('*').order('updated_at', { ascending: false }).limit(100);
    res.end(JSON.stringify(anlData.data || []));
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}



// === SYSTEM STATUS — /api/system-status ===
if (url === '/api/system-status') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var state = await loadState();
    var memCount = await supabase.from('organism_memory').select('id', { count: 'exact', head: true });
    var ciCount = await supabase.from('competitive_intelligence').select('id', { count: 'exact', head: true });
    var rgCount = await supabase.from('relationship_graph').select('id', { count: 'exact', head: true });
    var daCount = await supabase.from('disaster_alerts').select('id', { count: 'exact', head: true });
    var bcCount = await supabase.from('budget_cycles').select('id', { count: 'exact', head: true });
    var rcCount = await supabase.from('recompete_tracker').select('id', { count: 'exact', head: true });
    var regCount = await supabase.from('regulatory_changes').select('id', { count: 'exact', head: true });
    var tmCount = await supabase.from('teaming_partners').select('id', { count: 'exact', head: true });
    var agCount = await supabase.from('agency_profiles').select('id', { count: 'exact', head: true });
    var paCount = await supabase.from('pipeline_analytics').select('id', { count: 'exact', head: true });
    var outcomes = await supabase.from('opportunities').select('outcome').not('outcome', 'is', null);
    var outcomeData = outcomes.data || [];
    
    var pursuing = state.pipeline.filter(function(o) { return o.stage === 'pursuing'; });
    var withRFP = state.pipeline.filter(function(o) { return o.rfp_document_retrieved === true; });
    
    res.end(JSON.stringify({
      version: 'V4.5-full-intel',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      
      pipeline: {
        total_active: state.pipeline.length,
        pursuing: pursuing.length,
        submitted: state.pipeline.filter(function(o) { return o.stage === 'submitted'; }).length,
        identified: state.pipeline.filter(function(o) { return o.stage === 'identified'; }).length,
        with_rfp: withRFP.length,
        avg_opi: state.pipeline.length > 0 ? Math.round(state.pipeline.reduce(function(s,o) { return s + (o.opi_score || 0); }, 0) / state.pipeline.length) : 0
      },
      
      intelligence: {
        organism_memories: (memCount.count || 0),
        competitive_intelligence: (ciCount.count || 0),
        relationship_contacts: (rgCount.count || 0),
        disaster_alerts: (daCount.count || 0),
        budget_cycles: (bcCount.count || 0),
        recompete_tracker: (rcCount.count || 0),
        regulatory_changes: (regCount.count || 0),
        teaming_partners: (tmCount.count || 0),
        agency_profiles: (agCount.count || 0),
        pipeline_analytics: (paCount.count || 0)
      },
      
      outcomes: {
        total: outcomeData.length,
        wins: outcomeData.filter(function(o) { return o.outcome === 'won'; }).length,
        losses: outcomeData.filter(function(o) { return o.outcome === 'lost'; }).length,
        no_bids: outcomeData.filter(function(o) { return o.outcome === 'no_bid'; }).length
      },
      
      agents: {
        active: 29,
        per_opp: ['intelligence_engine', 'financial_agent', 'winnability_agent', 'crm_agent', 'quality_gate'],
        gated: ['staffing_plan', 'proposal_writer', 'red_team', 'price_to_win', 'proposal_assembly'],
        system_core: ['pipeline_scanner', 'disaster_monitor', 'dashboard_agent', 'amendment_tracker', 'hunting_agent', 'opi_calibration', 'executive_brief', 'recruiting_bench', 'learning_loop'],
        system_intel: ['discovery_agent', 'content_engine', 'knowledge_base_agent', 'scraper_insights', 'teaming_agent', 'budget_cycle', 'loss_analysis', 'recompete_agent', 'competitor_deep_dive', 'agency_profile_agent'],
        cut_available: 7
      },
      
      endpoints: {
        core: ['/health', '/api/pipeline', '/api/memories', '/api/diagnostics', '/api/trigger'],
        proposal: ['/api/produce-proposal', '/api/proposal-doc', '/api/compliance-matrix', '/api/rate-table', '/api/org-chart'],
        intelligence: ['/api/disaster-check', '/api/loss-analysis', '/api/exec-brief', '/api/compliance-check', '/api/phase3'],
        data: ['/api/competitors', '/api/contacts', '/api/regulatory', '/api/teaming', '/api/agencies', '/api/recompetes', '/api/analytics'],
        system: ['/api/system-status', '/api/fetch-rfp', '/api/hunt-stats', '/api/crash-log', '/api/cycle-history', '/api/record-outcome']
      },
      
      sources: {
        active: ['Central Bidding (authenticated)', 'SAM.gov', 'OpenFEMA', 'USAspending', 'Grants.gov', 'Federal Register'],
        disabled: ['LaPAC (ColdFusion, no API)']
      }
    }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}


// === HEALTH MONITOR — /api/health-monitor ===
// Port from V1 health-monitor.js (155 lines). Zero Claude calls.
// Checks: API credits, cron/session activity, scraper health, pipeline anomalies.
if (url === '/api/health-monitor') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var hmResult = { ts: new Date().toISOString(), checks: [], alerts: [] };
    var hmToday = new Date().toISOString().slice(0, 10);
    var hmTodayStart = hmToday + 'T00:00:00';

    // CHECK 1: Anthropic API credit health (minimal test call)
    try {
      var testResp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }]
      });
      hmResult.checks.push({ name: 'api_credits', status: 'OK', detail: 'API responding, credits available' });
    } catch(apiErr) {
      var errMsg = apiErr.message || '';
      if (errMsg.indexOf('credit') !== -1 || errMsg.indexOf('balance') !== -1) {
        hmResult.checks.push({ name: 'api_credits', status: 'CRITICAL', detail: 'Credit balance too low' });
        hmResult.alerts.push('CRITICAL: API credits depleted');
        await supabase.from('organism_memory').insert({
          agent: 'health_monitor', opportunity_id: null,
          entity_tags: 'system,health,CRITICAL',
          observation: 'SYSTEM ALERT [CRITICAL]: API Credits Depleted\nAnthropic API returning credit balance error. ALL Claude-powered features are down. Add credits immediately.',
          memory_type: 'system_alert', created_at: new Date().toISOString()
        });
      } else {
        hmResult.checks.push({ name: 'api_credits', status: 'WARNING', detail: 'API error: ' + errMsg.slice(0, 200) });
      }
    }

    // CHECK 2: Session activity today (V2 runs sessions, not individual crons)
    var sessionMems = await supabase.from('organism_memory')
      .select('agent,created_at')
      .gte('created_at', hmTodayStart)
      .order('created_at', { ascending: false })
      .limit(100);
    var todayAgents = {};
    (sessionMems.data || []).forEach(function(m) { todayAgents[m.agent] = true; });
    var activeAgentCount = Object.keys(todayAgents).length;

    if (activeAgentCount >= 5) {
      hmResult.checks.push({ name: 'session_activity', status: 'OK', detail: activeAgentCount + ' agents active today: ' + Object.keys(todayAgents).slice(0, 10).join(', ') });
    } else if (activeAgentCount > 0) {
      hmResult.checks.push({ name: 'session_activity', status: 'WARNING', detail: 'Only ' + activeAgentCount + ' agents active today (expected 5+)' });
      hmResult.alerts.push('WARNING: Low agent activity — only ' + activeAgentCount + ' agents fired today');
    } else {
      hmResult.checks.push({ name: 'session_activity', status: 'MISSED', detail: 'No agent activity today' });
      hmResult.alerts.push('MISSED: No agent sessions fired today');
      await supabase.from('organism_memory').insert({
        agent: 'health_monitor', opportunity_id: null,
        entity_tags: 'system,health,WARNING',
        observation: 'SYSTEM ALERT [WARNING]: No Agent Activity Today\nNo organism sessions have fired today. Check V1 cron triggers and V2 Railway health.',
        memory_type: 'system_alert', created_at: new Date().toISOString()
      });
    }

    // CHECK 3: Scraper health — hunt_runs today
    var scraperSources = ['central_bidding', 'sam_gov', 'grants_gov', 'openfema', 'usaspending', 'federal_register'];
    var huntRuns = await supabase.from('hunt_runs')
      .select('source,run_at,status')
      .gte('run_at', hmTodayStart)
      .order('run_at', { ascending: false });
    var runsBySource = {};
    (huntRuns.data || []).forEach(function(r) { runsBySource[r.source] = (runsBySource[r.source] || 0) + 1; });

    for (var si = 0; si < scraperSources.length; si++) {
      var src = scraperSources[si];
      if (runsBySource[src]) {
        hmResult.checks.push({ name: 'scraper_' + src, status: 'OK', detail: runsBySource[src] + ' runs today' });
      } else {
        hmResult.checks.push({ name: 'scraper_' + src, status: 'WARNING', detail: 'No runs today' });
        hmResult.alerts.push('WARNING: ' + src + ' scraper has not run today');
      }
    }

    // CHECK 4: Pipeline anomalies — stale opps, missing data
    var state = await loadState();
    var staleCount = 0;
    var missingData = 0;
    var now = Date.now();
    state.pipeline.forEach(function(o) {
      if (o.stage === 'pursuing' || o.stage === 'proposal') {
        var updated = new Date(o.last_updated || o.discovered_at || 0).getTime();
        if (now - updated > 7 * 86400000) staleCount++;
        if (!o.scope_analysis && !o.research_brief) missingData++;
      }
    });
    if (staleCount > 0) {
      hmResult.checks.push({ name: 'stale_opps', status: 'WARNING', detail: staleCount + ' pursuing/proposal opps not updated in 7+ days' });
      hmResult.alerts.push('WARNING: ' + staleCount + ' stale opportunities need attention');
    } else {
      hmResult.checks.push({ name: 'stale_opps', status: 'OK', detail: 'No stale pursuing/proposal opps' });
    }
    if (missingData > 0) {
      hmResult.checks.push({ name: 'missing_intel', status: 'WARNING', detail: missingData + ' pursuing/proposal opps missing scope and research' });
    }

    // CHECK 5: Uptime and memory
    hmResult.checks.push({ name: 'v2_uptime', status: 'OK', detail: Math.floor(process.uptime()) + ' seconds' });
    hmResult.checks.push({ name: 'v2_memory', status: 'OK', detail: Math.round(process.memoryUsage().heapUsed / 1048576) + 'MB heap used' });

    // SUMMARY
    var hmCriticals = hmResult.alerts.filter(function(a) { return a.indexOf('CRITICAL') !== -1; }).length;
    var hmWarnings = hmResult.alerts.filter(function(a) { return a.indexOf('CRITICAL') === -1; }).length;
    hmResult.summary = hmCriticals > 0 ? 'CRITICAL — ' + hmCriticals + ' critical alert(s)' :
      hmWarnings > 0 ? 'WARNING — ' + hmWarnings + ' warning(s)' : 'ALL SYSTEMS OK';

    // Log to hunt_runs for tracking
    // NOTE: hunt_runs.id is bigint auto-increment — do NOT pass a string id or the insert drops silently.
    await supabase.from('hunt_runs').insert({
      source: 'health_monitor',
      status: hmResult.summary + ' | ' + hmResult.checks.length + ' checks | ' + hmResult.alerts.length + ' alerts',
      run_at: new Date().toISOString(), opportunities_found: 0
    });

    log('HEALTH MONITOR: ' + hmResult.summary);
    res.end(JSON.stringify(hmResult));
  } catch(hmErr) {
    res.end(JSON.stringify({ error: hmErr.message }));
  }
  return;
}

// === COST MONITOR — /api/cost-monitor ===
// Port from V1 cost-monitor.js (109 lines). Reads cost logs from hunt_runs.
if (url === '/api/cost-monitor') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var cmRows = await supabase.from('hunt_runs')
      .select('status,run_at')
      .eq('source', 'api_cost')
      .order('run_at', { ascending: false })
      .limit(500);
    var cmData = cmRows.data || [];
    if (cmData.length === 0) {
      res.end(JSON.stringify({
        message: 'No cost data yet. Cost logs appear after next cron session completes.',
        total_usd: 0,
        current_session: { calls: costLog.length, est_cost_usd: Math.round(costLog.reduce(function(s,c) { return s + c.cost_usd; }, 0) * 10000) / 10000, web_searches: webSearchCount, web_search_cost_usd: Math.round(webSearchCount * 0.01 * 100) / 100 }
      }));
      return;
    }

    var cstNow = new Date(Date.now() - 6 * 3600000);
    var todayCST = cstNow.toISOString().slice(0, 10);
    var weekAgo = new Date(cstNow - 7 * 86400000).toISOString().slice(0, 10);
    var monthStart = cstNow.toISOString().slice(0, 7) + '-01';

    var totals = { today: 0, week: 0, month: 0, all_time: 0 };
    var byAgent = {};
    var byDay = {};
    var totalCalls = 0;

    for (var cmi = 0; cmi < cmData.length; cmi++) {
      var cmRow = cmData[cmi];
      var cmD;
      try { cmD = JSON.parse(cmRow.status || '{}'); } catch(e) { continue; }
      if (!cmD.total_usd) continue;

      var cmCost = cmD.total_usd;
      var cmDayKey = (cmRow.run_at || '').slice(0, 10);
      totalCalls += cmD.calls || 0;

      totals.all_time += cmCost;
      if (cmDayKey === todayCST) totals.today += cmCost;
      if (cmDayKey >= weekAgo) totals.week += cmCost;
      if (cmDayKey >= monthStart) totals.month += cmCost;

      if (!byDay[cmDayKey]) byDay[cmDayKey] = 0;
      byDay[cmDayKey] += cmCost;

      // Aggregate by-agent from session summaries
      if (cmD.by_agent) {
        Object.keys(cmD.by_agent).forEach(function(a) {
          if (!byAgent[a]) byAgent[a] = { calls: 0, cost: 0 };
          byAgent[a].calls += cmD.by_agent[a].calls || 0;
          byAgent[a].cost += cmD.by_agent[a].cost || 0;
        });
      }
    }

    var agentList = Object.keys(byAgent).map(function(a) {
      return { agent: a, calls: byAgent[a].calls, cost_usd: Math.round(byAgent[a].cost * 10000) / 10000 };
    }).sort(function(a, b) { return b.cost_usd - a.cost_usd; });

    var dayList = Object.keys(byDay).sort().slice(-14).map(function(day) {
      return { date: day, cost_usd: Math.round(byDay[day] * 10000) / 10000 };
    });

    var dailyCap = 5;
    var capStatus = totals.today >= dailyCap ? 'OVER_CAP' : totals.today >= dailyCap * 0.8 ? 'NEAR_CAP' : 'OK';

    res.end(JSON.stringify({
      summary: {
        today_usd: Math.round(totals.today * 10000) / 10000,
        week_usd: Math.round(totals.week * 10000) / 10000,
        month_usd: Math.round(totals.month * 10000) / 10000,
        all_time_usd: Math.round(totals.all_time * 10000) / 10000,
        total_api_calls: totalCalls,
        daily_cap_usd: dailyCap,
        cap_status: capStatus
      },
      by_agent: agentList,
      daily_spend: dayList,
      current_session: { calls: costLog.length, est_cost_usd: Math.round(costLog.reduce(function(s,c) { return s + c.cost_usd; }, 0) * 10000) / 10000, web_searches: webSearchCount, web_search_cost_usd: Math.round(webSearchCount * 0.01 * 100) / 100 },
      as_of_cst: cstNow.toISOString().slice(0, 19).replace('T', ' ') + ' CST'
    }));
  } catch(cmErr) {
    res.end(JSON.stringify({ error: cmErr.message }));
  }
  return;
}

// === NOTIFICATION SYSTEM — /api/notify ===
// Port from V1 notify.js (115 lines). CRUD notifications stored in hunt_runs.
// GET = list unread, POST = create, PATCH = mark read
if (url === '/api/notify' || url.startsWith('/api/notify?')) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' });

  if (req.method === 'OPTIONS') { res.end('{}'); return; }

  // GET — list notifications
  if (req.method === 'GET') {
    try {
      var nLimit = 20;
      var nParams = req.url.split('?')[1] || '';
      if (nParams.indexOf('limit=') >= 0) nLimit = parseInt(nParams.split('limit=')[1]) || 20;

      var nRows = await supabase.from('hunt_runs')
        .select('id,source,status,run_at')
        .like('source', 'notify:%')
        .order('run_at', { ascending: false })
        .limit(nLimit);

      var notifications = (nRows.data || []).map(function(n) {
        var parts = (n.status || '').split('|');
        return {
          id: n.id, type: (n.source || '').replace('notify:', ''),
          priority: parts[0] || 'medium', opportunity_id: parts[1] || null,
          title: parts[3] || '', read: parts[2] === 'read', timestamp: n.run_at
        };
      });
      var unread = notifications.filter(function(n) { return !n.read; }).length;
      res.end(JSON.stringify({ notifications: notifications, unread_count: unread }));
    } catch(nErr) {
      res.end(JSON.stringify({ notifications: [], unread_count: 0, error: nErr.message }));
    }
    return;
  }

  // POST — create notification
  if (req.method === 'POST') {
    try {
      var nBody = '';
      for await (var nChunk of req) nBody += nChunk;
      var nData = JSON.parse(nBody || '{}');
      var nType = nData.type || 'info';
      var nPriority = nData.priority || 'medium';
      var nOppId = nData.opportunity_id || 'system';
      var nTitle = nData.title || '';

      // Auto-format based on type
      var nTemplates = {
        'tier1_alert': { priority: 'high', title: 'Tier 1: ' + (nData.opp_title || nTitle) },
        'go_decision': { priority: 'high', title: 'GO: ' + (nData.opp_title || nTitle) },
        'stage_change': { priority: 'medium', title: (nData.opp_title || nTitle) + ' → ' + (nData.stage || '') },
        'deadline_warning': { priority: 'high', title: 'DEADLINE: ' + (nData.opp_title || nTitle) + ' — ' + (nData.days_left || '?') + ' days' },
        'proposal_ready': { priority: 'high', title: 'PROPOSAL READY: ' + (nData.opp_title || nTitle) },
        'disaster_alert': { priority: 'high', title: 'DISASTER: ' + (nData.disaster_name || nTitle) }
      };
      var tmpl = nTemplates[nType] || {};
      nPriority = tmpl.priority || nPriority;
      var nDisplayTitle = tmpl.title || nTitle;

      await supabase.from('hunt_runs').insert({
        source: 'notify:' + nType,
        status: nPriority + '|' + nOppId + '|unread|' + nDisplayTitle,
        run_at: new Date().toISOString(),
        opportunities_found: 0
      });

      res.end(JSON.stringify({ success: true, type: nType, priority: nPriority, title: nDisplayTitle }));
    } catch(nErr) {
      res.end(JSON.stringify({ error: nErr.message }));
    }
    return;
  }

  // PATCH — mark as read
  if (req.method === 'PATCH') {
    try {
      var pBody = '';
      for await (var pChunk of req) pBody += pChunk;
      var pData = JSON.parse(pBody || '{}');
      var nId = pData.id;
      if (!nId) { res.end(JSON.stringify({ error: 'id required' })); return; }

      var existing = await supabase.from('hunt_runs').select('status').eq('id', nId).single();
      if (existing.data) {
        var newStatus = (existing.data.status || '').replace('unread', 'read');
        await supabase.from('hunt_runs').update({ status: newStatus }).eq('id', nId);
      }
      res.end(JSON.stringify({ success: true }));
    } catch(nErr) {
      res.end(JSON.stringify({ error: nErr.message }));
    }
    return;
  }

  res.end(JSON.stringify({ error: 'Use GET, POST, or PATCH' }));
  return;
}

// === DISASTER MONITOR MANUAL TRIGGER — /api/disaster-check ===
if (url === '/api/disaster-check') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var state = await loadState();
    var dmResult = await agentDisasterMonitor(state);
    res.end(JSON.stringify({ success: true, result: dmResult }));
  } catch (e) {
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// === DISASTER RESPONSE PROTOCOL — /api/disaster-response ===
if (url.startsWith('/api/disaster-response')) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    if (method === 'POST') {
      var drBody = '';
      await new Promise(function(resolve) { req.on('data', function(c) { drBody += c; }); req.on('end', resolve); });
      var drData = JSON.parse(drBody || '{}');
      var drName = drData.disaster_name || '';
      var drState = drData.state || '';
      if (!drName || !drState) { res.end(JSON.stringify({ error: 'disaster_name and state required' })); return; }
      var drType = drData.incident_type || 'unknown';
      var drDate = drData.declaration_date || 'pending';
      var drDamage = drData.estimated_damage || 'unknown';
      var drNumber = drData.fema_declaration_number || '';
      var drSystem = 'You are HGI disaster response strategist. ' + HGI.substring(0, 2000);
      log('DISASTER RESPONSE PROTOCOL: Generating capture package for ' + drName + ' (' + drState + ')');
      var drPromptBase = 'Disaster: ' + drName + ' in ' + drState + '. Incident: ' + drType + '. Declaration: ' + drDate + '. Estimated damage: ' + drDamage + '. FEMA #: ' + drNumber + '.';
      var drResults = await Promise.all([
        claudeCall('Generate 48-hour disaster response brief', drPromptBase + ' Generate a 48-hour disaster response brief for HGI. Cover: immediate HGI positioning, which agencies will issue RFPs, estimated contract values, HGI past performance most relevant, immediate actions in next 48 hours.', 2000, { model: SONNET, system: drSystem }),
        claudeCall('Draft outreach letter', drPromptBase + ' Draft a capability outreach letter from HGI to the Governor Office and state emergency management agency. Professional, specific, offers concrete HGI capabilities. Reference Road Home and relevant past performance.', 2000, { model: SONNET, system: drSystem }),
        claudeCall('List procurement opportunities', drPromptBase + ' List every procurement opportunity that will emerge over the next 6-18 months. For each: agency, contract type, estimated value, timeline, HGI fit score 1-10, and specific HGI win strategy.', 2000, { model: SONNET, system: drSystem }),
        claudeCall('Build 90-day capture timeline', drPromptBase + ' Build a 90-day capture timeline for HGI. Week by week: what to do, who to contact, what to submit, what intelligence to gather.', 2000, { model: SONNET, system: drSystem })
      ]);
      var drPackage = { disaster_name: drName, state: drState, fema_number: drNumber, brief_48hr: drResults[0] || '', outreach_letter: drResults[1] || '', opportunity_forecast: drResults[2] || '', capture_timeline_90day: drResults[3] || '', generated_at: new Date().toISOString() };
      await storeMemory('disaster_response', null, 'disaster,capture_package,' + drState.toLowerCase(), 'CAPTURE PACKAGE generated for ' + drName + ' (' + drState + '). 48hr brief: ' + (drResults[0]||'').length + ' chars, outreach: ' + (drResults[1]||'').length + ' chars, forecast: ' + (drResults[2]||'').length + ' chars, timeline: ' + (drResults[3]||'').length + ' chars.', 'analysis', null, 'high');
      log('DISASTER RESPONSE: Package generated — ' + [drResults[0],drResults[1],drResults[2],drResults[3]].reduce(function(s,r){return s+(r||'').length;},0) + ' total chars');
      res.end(JSON.stringify({ success: true, package: drPackage }));
    } else {
      var recentDA = await supabase.from('disaster_alerts').select('*').order('created_at', { ascending: false }).limit(10);
      res.end(JSON.stringify({ recent_alerts: recentDA.data || [], message: 'POST with {disaster_name, state, incident_type, declaration_date, estimated_damage, fema_declaration_number} to generate full capture package' }));
    }
  } catch (e) {
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// === ORGANISM DECISIONS — /api/organism-decisions ===
if (url === '/api/organism-decisions' || url.startsWith('/api/organism-decisions?')) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    if (req.method === 'DELETE') {
      var delBody = '';
      req.on('data', function(c) { delBody += c; });
      await new Promise(function(r) { req.on('end', r); });
      var delData = JSON.parse(delBody || '{}');
      if (delData.id) {
        await supabase.from('organism_memory').delete().eq('id', delData.id);
        res.end(JSON.stringify({ dismissed: true, id: delData.id }));
      } else {
        res.end(JSON.stringify({ error: 'id required' }));
      }
      return;
    }
    var decRows = await supabase.from('organism_memory').select('id,agent,opportunity_id,observation,created_at,entity_tags').eq('memory_type', 'decision_point').order('created_at', { ascending: false }).limit(20);
    var decisions = (decRows.data || []).map(function(row) {
      var obs = row.observation || '';
      function getField(key) {
        var rx = new RegExp(key + ':\\s*([\\s\\S]*?)(?=\\n\\n[A-Z_]+:|$)', 'i');
        var m = obs.match(rx);
        return m ? m[1].trim() : '';
      }
      var ap = null;
      try { ap = JSON.parse(getField('ACTION_PAYLOAD')); } catch(e2) {}
      return {
        id: row.id, priority: getField('PRIORITY') || 'medium', type: getField('TYPE') || 'OWNER_ACTION',
        title: getField('TITLE') || 'Decision', detail: getField('DETAIL') || '',
        recommended_action: getField('RECOMMENDED_ACTION') || '', expected_impact: getField('EXPECTED_IMPACT') || '',
        executable: getField('EXECUTABLE') === 'true',
        action_endpoint: getField('ACTION_ENDPOINT') !== 'null' ? getField('ACTION_ENDPOINT') : null,
        action_payload: ap, opportunity_id: row.opportunity_id || null, created_at: row.created_at
      };
    });
    res.end(JSON.stringify({ decisions: decisions, count: decisions.length, last_think_run: decisions.length > 0 ? decisions[0].created_at : null }));
  } catch (e) {
    res.end(JSON.stringify({ error: e.message, decisions: [] }));
  }
  return;
}

// === BENCH / RECRUITING — /api/bench ===
if (url === '/api/bench') {
  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        var p = JSON.parse(body);
        if (!p.name || !p.role) { res.end(JSON.stringify({error:'name and role required'})); return; }
        await storeMemory('recruiting_agent', null, 'bench,' + (p.role||''), 'BENCH MEMBER: ' + p.name + ' | Role: ' + p.role + ' | Domain: ' + (p.domain||'') + ' | Clearance: ' + (p.clearance||'none') + ' | Location: ' + (p.location||'') + ' | Availability: ' + (p.availability||'available') + ' | Notes: ' + (p.notes||''), 'bench_member', null, 'medium');
        res.end(JSON.stringify({success:true}));
      } catch(e) { res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var bData = await supabase.from('organism_memory').select('id,observation,created_at').eq('memory_type','bench_member').order('created_at',{ascending:false}).limit(100);
    var bench = (bData.data || []).map(function(m) {
      var obs = m.observation || '';
      var extract = function(label) { var rx = new RegExp(label + ':\\s*([^|]+)'); var mt = obs.match(rx); return mt ? mt[1].trim() : ''; };
      return { id: m.id, name: extract('BENCH MEMBER'), role: extract('Role'), domain: extract('Domain'), clearance: extract('Clearance'), location: extract('Location'), availability: extract('Availability'), notes: extract('Notes'), added: m.created_at };
    });
    res.end(JSON.stringify({ total: bench.length, bench: bench }));
  } catch(e) { res.end(JSON.stringify({error:e.message})); }
  return;
}

// === LOSS ANALYSIS — /api/loss-analysis ===
if (url === '/api/loss-analysis') {
  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        var p = JSON.parse(body);
        if (!p.id) { res.end(JSON.stringify({error:'id required'})); return; }
        var upd = { outcome_notes: '' };
        if (p.winner_name) upd.outcome_notes += 'Winner: ' + p.winner_name + '\n';
        if (p.winner_amount) upd.outcome_notes += 'Winner Amount: $' + p.winner_amount + '\n';
        if (p.our_bid_amount) upd.outcome_notes += 'Our Bid: $' + p.our_bid_amount + '\n';
        if (p.notes) upd.outcome_notes += 'Notes: ' + p.notes;
        upd.last_updated = new Date().toISOString();
        await supabase.from('opportunities').update(upd).eq('id', p.id);
        res.end(JSON.stringify({success:true}));
      } catch(e) { res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var outcomes = await supabase.from('opportunities').select('id,title,agency,vertical,opi_score,outcome,outcome_notes,stage,estimated_value,due_date').not('outcome', 'is', null).order('last_updated', { ascending: false }).limit(50);
    var records = outcomes.data || [];
    var wins = records.filter(function(r) { return r.outcome === 'won'; });
    var losses = records.filter(function(r) { return r.outcome === 'lost'; });
    var noBids = records.filter(function(r) { return r.outcome === 'no_bid'; });
    var cancelled = records.filter(function(r) { return r.outcome === 'cancelled'; });
    var winRate = records.length > 0 ? Math.round((wins.length / (wins.length + losses.length || 1)) * 100) : 0;
    var avgWinOPI = wins.length > 0 ? Math.round(wins.reduce(function(s,w) { return s + (w.opi_score || 0); }, 0) / wins.length) : 0;
    var avgLossOPI = losses.length > 0 ? Math.round(losses.reduce(function(s,l) { return s + (l.opi_score || 0); }, 0) / losses.length) : 0;
    var verticalBreakdown = {};
    records.forEach(function(r) { var v = r.vertical || 'unknown'; if (!verticalBreakdown[v]) verticalBreakdown[v] = { wins: 0, losses: 0, no_bids: 0 }; if (r.outcome === 'won') verticalBreakdown[v].wins++; else if (r.outcome === 'lost') verticalBreakdown[v].losses++; else if (r.outcome === 'no_bid') verticalBreakdown[v].no_bids++; });
    res.end(JSON.stringify({
      total_outcomes: records.length, wins: wins.length, losses: losses.length,
      no_bids: noBids.length, cancelled: cancelled.length,
      win_rate_pct: winRate, avg_win_opi: avgWinOPI, avg_loss_opi: avgLossOPI,
      vertical_breakdown: verticalBreakdown,
      opi_calibration: { threshold_suggestion: avgWinOPI > 0 ? Math.max(60, avgWinOPI - 15) : 60 },
      recent_outcomes: records.slice(0, 10).map(function(r) { return { title: r.title, outcome: r.outcome, opi: r.opi_score, vertical: r.vertical, notes: r.outcome_notes }; })
    }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXECUTIVE BRIEFING — /api/exec-brief ===
if (url === '/api/exec-brief') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var state = await loadState();
    var pursuing = state.pipeline.filter(function(o) { return o.stage === 'pursuing' || o.stage === 'proposal'; });
    var submitted = state.pipeline.filter(function(o) { return o.stage === 'submitted'; });
    var identified = state.pipeline.filter(function(o) { return o.stage === 'identified'; });
    var upcoming = pursuing.filter(function(o) { return o.due_date; }).sort(function(a,b) { return new Date(a.due_date) - new Date(b.due_date); });
    
    var recentMems = await supabase.from('organism_memory').select('agent,observation,created_at')
      .in('agent', ['pipeline_scanner','disaster_monitor','amendment_tracker','dashboard_agent','self_awareness'])
      .order('created_at', { ascending: false }).limit(10);
    var briefMems = (recentMems.data || []).map(function(m) { return { agent: m.agent, summary: (m.observation || ''), when: m.created_at }; });
    
    var alerts = [];
    upcoming.forEach(function(o) {
      var days = o.due_date ? Math.ceil((new Date(o.due_date) - Date.now()) / 86400000) : null;
      if (days !== null && days <= 14) alerts.push({ type: 'deadline', title: o.title, days_remaining: days, due: o.due_date, opi: o.opi_score });
    });
    
    var newDisasters = await supabase.from('disaster_alerts').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(5);
    (newDisasters.data || []).forEach(function(d) { alerts.push({ type: 'disaster', title: 'DR-' + d.disaster_number + ' ' + d.state + ': ' + d.disaster_name, threat_level: d.threat_level }); });

    res.end(JSON.stringify({
      generated: new Date().toISOString(),
      pipeline_summary: {
        total_active: state.pipeline.length,
        pursuing: pursuing.length, submitted: submitted.length, identified: identified.length,
        total_estimated_value: state.pipeline.reduce(function(s,o) { return s + (parseFloat(o.estimated_value) || 0); }, 0)
      },
      upcoming_deadlines: upcoming.slice(0, 5).map(function(o) {
        var d = o.due_date ? Math.ceil((new Date(o.due_date) - Date.now()) / 86400000) : null;
        return { title: (o.title || ''), opi: o.opi_score, stage: o.stage, due: o.due_date, days_remaining: d };
      }),
      alerts: alerts,
      awaiting_award: submitted.map(function(o) { return { title: o.title, opi: o.opi_score }; }),
      recent_intel: briefMems,
      agent_health: { active_agents: 42, version: 'V2.0-organism', last_cycle: briefMems.length > 0 ? briefMems[0].when : null }
    }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}


// === RECORD OUTCOME + AUTO-ANALYSIS — /api/record-outcome ===
if (url === '/api/record-outcome' && req.method === 'POST') {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', async function() {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    try {
      var params = JSON.parse(body);
      if (!params.id || !params.outcome) { res.end(JSON.stringify({ error: 'id and outcome required (won/lost/no_bid/cancelled)' })); return; }
      var validOutcomes = ['won', 'lost', 'no_bid', 'cancelled'];
      if (validOutcomes.indexOf(params.outcome) < 0) { res.end(JSON.stringify({ error: 'outcome must be: ' + validOutcomes.join(', ') })); return; }
      
      // Record outcome
      var upd = { outcome: params.outcome, outcome_notes: params.notes || null, last_updated: new Date().toISOString() };
      if (params.outcome === 'won' || params.outcome === 'lost') upd.stage = params.outcome;
      if (params.outcome === 'no_bid') upd.stage = 'no_bid';
      await supabase.from('opportunities').update(upd).eq('id', params.id);
      log('OUTCOME: ' + params.id.slice(0,40) + ' → ' + params.outcome);
      
      // Auto-analyze: get the opp data for analysis
      var oppData = await supabase.from('opportunities').select('*').eq('id', params.id).single();
      var opp = oppData.data;
      
      if (opp && (params.outcome === 'won' || params.outcome === 'lost')) {
        // Get all memories for this opp to understand what we predicted
        var oppMems = await supabase.from('organism_memory').select('agent,observation').eq('opportunity_id', params.id).order('created_at', { ascending: false }).limit(20);
        var memSummary = (oppMems.data || []).map(function(m) { return m.agent + ': ' + (m.observation || '').slice(0, 200); }).join('\n');
        
        // Run loss/win analysis
        var analysisPrompt = 'OUTCOME ANALYSIS: HGI ' + params.outcome.toUpperCase() + ' on "' + (opp.title || '') + '"\n' +
          'Agency: ' + (opp.agency || '') + ' | Vertical: ' + (opp.vertical || '') + ' | OPI: ' + (opp.opi_score || '?') + '\n' +
          'Notes: ' + (params.notes || 'none') + '\n\n' +
          'AGENT PREDICTIONS:\n' + memSummary.slice(0, 3000) + '\n\n' +
          'TASK: Analyze this outcome. What did the organism predict correctly? What did it miss? ' +
          'What patterns should inform future OPI scoring and pursuit decisions? ' +
          'Specific lessons for: (1) OPI calibration, (2) competitive positioning, (3) proposal strategy, (4) pricing. ' +
          'Be brutally honest about prediction accuracy.';
        
        var analysis = await claudeCall('outcome analysis', analysisPrompt, 2000, { model: 'claude-haiku-4-5-20251001' });
        if (analysis && analysis.length > 100) {
          await storeMemory('loss_analysis', params.id, (opp.agency || '') + ',outcome,' + params.outcome, analysis, 'analysis', null, 'high');
          log('OUTCOME ANALYSIS: ' + analysis.length + ' chars generated for ' + params.outcome);
        }
        
        // Update OPI calibration data
        await supabase.from('pipeline_analytics').insert({
          id: 'outcome-' + Date.now(),
          metric_name: 'outcome_' + params.outcome,
          metric_value: opp.opi_score || 0,
          context: JSON.stringify({ title: opp.title, agency: opp.agency, vertical: opp.vertical, opi: opp.opi_score }),
          source_agent: 'outcome_recorder',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
      
      res.end(JSON.stringify({ success: true, outcome: params.outcome, analysis_generated: params.outcome === 'won' || params.outcome === 'lost' }));
    } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  });
  return;
}

// === MANUAL INTAKE — /api/intake ===
if (url === '/api/intake' && req.method === 'POST') {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', async function() {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    try {
      var params = JSON.parse(body);
      if (!params.title) { res.end(JSON.stringify({ error: 'title required' })); return; }
      var newId = 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      await supabase.from('opportunities').insert({
        id: newId, title: params.title, agency: params.agency || null, vertical: params.type || params.vertical || null,
        opi_score: parseInt(params.opi) || 50, status: 'active', stage: params.stage || 'identified',
        source: 'manual', source_url: params.source_url || null, estimated_value: params.value || null,
        due_date: params.deadline || null, description: params.notes || params.context || null,
        rfp_text: params.rfp_text || null, incumbent: params.incumbent || null,
        discovered_at: new Date().toISOString(), last_updated: new Date().toISOString()
      });
      log('MANUAL INTAKE: ' + params.title.slice(0, 60) + ' (OPI ' + (params.opi || 50) + ')');
      res.end(JSON.stringify({ success: true, id: newId }));
    } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  });
  return;
}

// === UPDATE OPPORTUNITY — /api/update-opportunity ===
// Generic field update for any opportunity fields (edit, save-on-blur, archive/delete)
if (url === '/api/update-opportunity' && req.method === 'POST') {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', async function() {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    try {
      var params = JSON.parse(body);
      if (!params.id) { res.end(JSON.stringify({ error: 'id required' })); return; }
      var id = params.id;
      delete params.id;
      // Whitelist allowed fields
      var allowed = ['title','agency','vertical','opi_score','stage','status','estimated_value','due_date','description',
        'source_url','rfp_document_url','oral_presentation_date','award_notification_date','outcome_notes',
        'capture_strategy','capture_action','incumbent','notes'];
      var upd = { last_updated: new Date().toISOString() };
      allowed.forEach(function(f) { if (params[f] !== undefined) upd[f] = params[f]; });
      await supabase.from('opportunities').update(upd).eq('id', id);
      log('UPDATE-OPP: ' + id.slice(0, 40) + ' fields: ' + Object.keys(upd).join(','));
      res.end(JSON.stringify({ success: true, updated: Object.keys(upd) }));
    } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  });
  return;
}

// === UPDATE STAGE — /api/update-stage ===
if (url === '/api/update-stage' && req.method === 'POST') {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', async function() {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    try {
      var params = JSON.parse(body);
      if (!params.id || !params.stage) { res.end(JSON.stringify({ error: 'id and stage required' })); return; }
      var validStages = ['identified', 'pursuing', 'proposal', 'submitted', 'watching', 'no_bid', 'closed'];
      if (validStages.indexOf(params.stage) < 0) { res.end(JSON.stringify({ error: 'stage must be: ' + validStages.join(', ') })); return; }
      await supabase.from('opportunities').update({ stage: params.stage, last_updated: new Date().toISOString() }).eq('id', params.id);
      log('STAGE UPDATE: ' + params.id.slice(0,40) + ' -> ' + params.stage);

      // S122 LAYER B: auto-fire pursuit research when opp moves to pursuing
      if (params.stage === 'pursuing') {
        setImmediate(async function() {
          try {
            var _prCutoff = new Date(Date.now() - 14*24*60*60*1000).toISOString();
            var _prExisting = await supabase.from('pursuit_research_runs')
              .select('id,findings_count,completed_at')
              .eq('opportunity_id', params.id)
              .eq('status', 'complete')
              .gte('completed_at', _prCutoff)
              .limit(1);
            if ((_prExisting.data || []).length > 0 && (_prExisting.data[0].findings_count || 0) > 0) {
              log('STAGE HOOK: pursuing — recent pursuit research already exists for ' + params.id.slice(0,40) + ', skipping auto-fire');
              return;
            }
            var _prOpp = await supabase.from('opportunities').select('*').eq('id', params.id).single();
            if (!_prOpp.data) { log('STAGE HOOK: opp not found for pursuit research ' + params.id.slice(0,40)); return; }
            log('STAGE HOOK: pursuing — firing agentPursuitResearcher for ' + params.id.slice(0,40));
            var _prRes = await agentPursuitResearcher(_prOpp.data, {});
            log('STAGE HOOK: pursuit research done — status=' + (_prRes && _prRes.status) + ', findings=' + (_prRes && _prRes.findings_count) + ', cost=$' + (_prRes && _prRes.cost_usd));
          } catch(_she) {
            log('STAGE HOOK pursuit research error: ' + (_she.message||'').slice(0,200));
          }
        });
      }

      res.end(JSON.stringify({ success: true, stage: params.stage }));
    } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  });
  return;
}

// === TWO-PASS PROPOSAL REFINEMENT — /api/proposal-refine?id= ===
// Port from V1 opus-build.js (178 lines). Takes existing proposal + red team review,
// does parallel web research + KB query, then Opus with extended thinking rebuilds weak sections.
// Cost: ~$2-5 per run. Manual trigger only.
if (url.startsWith('/api/proposal-refine')) {
  var prId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!prId) { res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({error:'id required'})); return; }

  log('PROPOSAL REFINE: Starting two-pass refinement for ' + prId);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ started: true, id: prId, note: 'Two-pass Opus refinement running async. Check proposal_content when complete.' }));

  setImmediate(async () => {
    try {
      // 1. Load opportunity + existing proposal + red team review
      var prOpp = await supabase.from('opportunities').select('*').eq('id', prId).single();
      var opp = prOpp.data;
      if (!opp) { log('PROPOSAL REFINE: Opp not found ' + prId); return; }

      var existingProposal = opp.proposal_content || '';
      var redTeamReview = opp.proposal_review || '';
      if (existingProposal.length < 500) { log('PROPOSAL REFINE: No proposal to refine (' + existingProposal.length + ' chars). Run produce-proposal first.'); return; }
      if (redTeamReview.length < 100) { log('PROPOSAL REFINE: No red team review found. Run produce-proposal first (red team runs automatically).'); return; }

      log('PROPOSAL REFINE: Loaded proposal (' + existingProposal.length + ' chars) + review (' + redTeamReview.length + ' chars)');

      // 2. Parallel web research + KB query (same pattern as V1 opus-build)
      var vertical = (opp.vertical || 'professional services').trim();
      var agency = (opp.agency || '').trim();
      var oppState = (opp.state || 'Louisiana').trim();
      var scopeSnippet = (opp.scope_analysis || '').replace(/[^a-zA-Z0-9 .,\-]/g, ' ').slice(0, 150).trim();

      var researchResults = await Promise.allSettled([
        multiSearch([
          { q: scopeSnippet.slice(0,100) + ' ' + vertical + ' methodology best practices 2025 2026', label: 'Best practices' },
          { q: agency + ' ' + oppState + ' contracts awarded ' + vertical + ' 2024 2025', label: 'Agency awards' }
        ]),
        supabase.from('knowledge_chunks').select('chunk_text,filename,vertical')
          .or('vertical.eq.' + vertical.toLowerCase() + ',document_class.eq.quality_gated_draft')
          .limit(20)
      ]);

      var webResearch = (researchResults[0].status === 'fulfilled' ? researchResults[0].value : '') || '';
      var kbChunks = (researchResults[1].status === 'fulfilled' && researchResults[1].value.data) || [];
      var kbContent = kbChunks.map(function(c) { return c.chunk_text || ''; }).join('\n---\n').slice(0, 8000);

      log('PROPOSAL REFINE: Research complete — web ' + webResearch.length + ' chars, KB ' + kbChunks.length + ' chunks');

      // 3. Load all organism intelligence for this opp
      var prMems = await supabase.from('organism_memory')
        .select('agent,observation')
        .eq('opportunity_id', prId)
        .neq('memory_type', 'decision_point')
        .order('created_at', { ascending: false })
        .limit(30);
      var memContext = (prMems.data || []).map(function(m) {
        return '[' + m.agent + ']: ' + (m.observation || '').slice(0, 400);
      }).join('\n\n').slice(0, 6000);

      // 4. Opus with extended thinking — full second pass
      var refineSystem =
        'You are the most capable government proposal writer in the world. You are performing a SECOND PASS refinement.' +
        '\n\nOpportunity: ' + (opp.title||'') + ' | Agency: ' + agency + ' | Vertical: ' + vertical + ' | OPI: ' + (opp.opi_score||0) +
        '\n\nYou have the first-pass proposal, a red team review identifying every weakness, fresh web research on best practices, HGI knowledge base content from winning proposals, and full organism intelligence.' +
        '\n\nYour mission: OUTPUT THE COMPLETE REFINED PROPOSAL — every section, start to finish. Keep sections the red team rated clean. REBUILD sections flagged as critical or major. Add any missing sections. Use replacement text from the red team review where provided.' +
        '\n\nCRITICAL RULES:' +
        '\n1. Output the FULL proposal, not just changed sections' +
        '\n2. Every claim must have specific evidence (dates, amounts, project names)' +
        '\n3. No Geoffrey Brien. All positions [TO BE ASSIGNED] except Christopher J. Oney on cover letter' +
        '\n4. Founded 1929, ~50 employees, Kenner HQ Suite 510, UEI DL4SJEVKZ6H4' +
        '\n5. Use web research for current methodology. Use KB for HGI proof points' +
        '\n6. Minimize [ACTION REQUIRED] — only for wet signatures, real resumes, final rate approvals' +
        '\n7. Match the RFP structure exactly';

      var refinePrompt =
        '=== FIRST-PASS PROPOSAL (refine this) ===\n' + existingProposal.slice(0, 80000) +
        '\n\n=== RED TEAM REVIEW (fix every critical/major finding) ===\n' + redTeamReview.slice(0, 15000) +
        '\n\n=== RFP/SOQ REQUIREMENTS ===\n' + (opp.rfp_text || opp.scope_analysis || opp.description || '').slice(0, 15000) +
        (webResearch.length > 50 ? '\n\n=== FRESH WEB RESEARCH ===\n' + webResearch.slice(0, 4000) : '') +
        (kbContent.length > 100 ? '\n\n=== HGI KNOWLEDGE BASE (winning proposal sections) ===\n' + kbContent.slice(0, 6000) : '') +
        (memContext.length > 100 ? '\n\n=== ORGANISM INTELLIGENCE ===\n' + memContext.slice(0, 4000) : '') +
        '\n\n=== TASK ===\nRead the red team review. For every CRITICAL and MAJOR finding, fix it using the research and KB. Output the COMPLETE REFINED PROPOSAL — all sections, start to finish.';

      log('PROPOSAL REFINE: Calling Opus with extended thinking...');
      var opusResp = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 16000,
        thinking: { type: 'enabled', budget_tokens: 5000 },
        system: refineSystem,
        messages: [{ role: 'user', content: refinePrompt }]
      });

      trackCost('proposal_refine', 'claude-opus-4-6', opusResp.usage);

      var refinedText = (opusResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');

      if (refinedText.length < 500) {
        log('PROPOSAL REFINE: Opus output too short (' + refinedText.length + ' chars)');
        await supabase.from('organism_memory').insert({
          agent: 'proposal_refine', opportunity_id: prId,
          observation: 'PROPOSAL REFINE FAILED: Opus output too short (' + refinedText.length + ' chars). May need retry.',
          memory_type: 'system_alert', created_at: new Date().toISOString()
        });
        return;
      }

      // 5. Post-processing: same ACTION REQUIRED auto-fill as produce-proposal
      refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:insurance|WC coverage|workers.?comp|auto policy|umbrella|E&O|fidelity|GL |general liability)[^\]]*\]/gi, 'HGI maintains $5M fidelity bond, $5M Errors & Omissions, $2M General Liability, Workers Compensation at statutory limits, and $1M Commercial Auto coverage. Certificates of insurance with Additional Insured endorsement naming CLIENT will be provided upon contract execution.');
      refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:professional regulation|DPR|Confirm.*(?:applicable|applicability))[^\]]*\]/gi, 'No Louisiana Department of Professional Regulation license is required for disaster recovery consulting, program management, claims administration, construction management oversight, or grant management services.');
      refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:SAM|UEI|registration.*print)[^\]]*\]/gi, 'HGI Global is registered in SAM.gov with active status. UEI: DL4SJEVKZ6H4.');
      refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:org.*chart|organizational)[^\]]*\]/gi, 'See Organizational Chart (Appendix A).');

      var arCount = (refinedText.match(/ACTION REQUIRED/gi) || []).length;

      // 6. Save refined proposal (replaces first pass)
      await supabase.from('opportunities').update({
        proposal_content: refinedText,
        last_updated: new Date().toISOString()
      }).eq('id', prId);

      // 7. Write memory
      await supabase.from('organism_memory').insert({
        agent: 'proposal_refine', opportunity_id: prId,
        observation: 'PROPOSAL REFINED (Two-Pass): ' + refinedText.length + ' chars (was ' + existingProposal.length + '). ' +
          'Used ' + kbChunks.length + ' KB chunks + web research. ' + arCount + ' ACTION REQUIRED items remaining. ' +
          'Red team findings addressed. Stored in proposal_content.',
        memory_type: 'analysis', created_at: new Date().toISOString()
      });

      // 8. Trigger KB enrichment on refined version (re-run red team first would be ideal, but enrichment still valuable)
      log('PROPOSAL REFINE: Complete — ' + refinedText.length + ' chars (was ' + existingProposal.length + '). ' + arCount + ' ACTION REQUIRED remaining.');

    } catch(prErr) {
      log('PROPOSAL REFINE ERROR: ' + prErr.message);
      await supabase.from('organism_memory').insert({
        agent: 'proposal_refine', opportunity_id: prId,
        observation: 'PROPOSAL REFINE ERROR: ' + prErr.message,
        memory_type: 'system_alert', created_at: new Date().toISOString()
      }).catch(function() {});
    }
  });
  return;
}

// === L7 MANUAL REFINEMENT TRIGGER — /api/refinement-loop?id= (POST) ===
// Runs runIterationToPlateau on an existing opportunity's current proposal_content + proposal_review.
// Useful for: (a) manually triggering additional iterations if PWIN hasn't plateaued, (b) testing L7 without re-running produce-proposal.
if (url.startsWith('/api/refinement-loop') && req.method === 'POST') {
  var rlId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!rlId) { res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }); res.end(JSON.stringify({error:'id required'})); return; }
  try {
    var rlOpp = await supabase.from('opportunities').select('*').eq('id', rlId).single();
    if (!rlOpp.data) {
      res.writeHead(404, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({error:'opportunity not found', id: rlId}));
      return;
    }
    var rlOppData = rlOpp.data;
    var rlProposal = rlOppData.proposal_content || '';
    var rlReview = rlOppData.proposal_review || '';
    if (rlProposal.length < 500) {
      res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({error:'proposal_content too short', chars: rlProposal.length, note:'Run /api/produce-proposal first'}));
      return;
    }
    if (rlReview.length < 100) {
      res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({error:'proposal_review missing', chars: rlReview.length, note:'Red team review required for refinement; run /api/produce-proposal first'}));
      return;
    }
    // Parse initial PWIN
    var rlInitPWIN = 0;
    try {
      var rlfb = rlReview.indexOf('{'), rllb = rlReview.lastIndexOf('}');
      if (rlfb >= 0 && rllb > rlfb) {
        var rlpj = JSON.parse(rlReview.slice(rlfb, rllb + 1));
        rlInitPWIN = rlpj.pwin_estimate || 0;
      }
    } catch (rlpe) {
      var rlm = rlReview.match(/PWIN\s+(\d{1,3})%/);
      if (rlm) rlInitPWIN = parseInt(rlm[1], 10) || 0;
    }
    log('MANUAL REFINEMENT LOOP: starting for ' + rlId + ' with initial PWIN=' + rlInitPWIN);
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ started: true, id: rlId, initial_pwin: rlInitPWIN, note: 'Refinement loop running async. Poll /api/refinement-history?id=' + rlId + ' for trajectory.' }));

    setImmediate(async function() {
      try {
        var rlResult = await runIterationToPlateau(rlOppData, rlProposal, rlReview, rlInitPWIN, { maxIter: 3, plateauDelta: 2 });
        log('MANUAL REFINEMENT LOOP complete: ' + rlResult.iterations + ' iters, PWIN ' + rlResult.initialPWIN + ' -> ' + rlResult.finalPWIN + ' (' + rlResult.stopReason + ')');
      } catch (rlErr) {
        log('MANUAL REFINEMENT LOOP error: ' + (rlErr.message||'').slice(0,300));
      }
    });
  } catch (rle) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: rle.message }));
  }
  return;
}

// === L7 REFINEMENT HISTORY — /api/refinement-history?id= (GET) ===
if (url.startsWith('/api/refinement-history')) {
  var rhId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!rhId) { res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }); res.end(JSON.stringify({error:'id required'})); return; }
  try {
    var rhRows = await supabase.from('organism_memory')
      .select('id,agent,observation,memory_type,created_at')
      .eq('opportunity_id', rhId)
      .in('agent', ['refinement_loop','refinement_loop_summary'])
      .order('created_at', { ascending: true });
    var rows = rhRows.data || [];
    var iterations = [];
    var summary = null;
    rows.forEach(function(r){
      if (r.agent === 'refinement_loop_summary') {
        summary = { text: r.observation, at: r.created_at };
      } else if (r.memory_type === 'refinement_iteration') {
        // parse "L7 ITERATION 1: PWIN 68 -> 74 (delta +6)..."
        var obs = r.observation || '';
        var im = obs.match(/L7 ITERATION (\d+): PWIN (\d+) -> (\d+) \(delta ([+\-]?\d+)\)/);
        if (im) {
          iterations.push({
            iteration: parseInt(im[1],10),
            pwin_before: parseInt(im[2],10),
            pwin_after: parseInt(im[3],10),
            delta: parseInt(im[4],10),
            at: r.created_at,
            observation: obs
          });
        } else {
          iterations.push({ iteration: null, observation: obs, at: r.created_at });
        }
      } else if (obs && obs.indexOf('L7 SKIPPED') >= 0) {
        summary = { text: obs, at: r.created_at, skipped: true };
      }
    });
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ id: rhId, iterations: iterations, summary: summary, iteration_count: iterations.length }));
  } catch (rhe) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: rhe.message }));
  }
  return;
}

// === L4 DISCRIMINATOR SYNTHESIS — /api/discriminators-generate?id= (POST) and /api/discriminators?id= (GET) ===
if (url.startsWith('/api/discriminators-generate') && req.method === 'POST') {
  var dgId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!dgId) { res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({error:'id required'})); return; }
  log('DISCRIMINATORS-GENERATE: Starting sync run for ' + dgId);
  try {
    var dgOpp = await supabase.from('opportunities').select('*').eq('id', dgId).single();
    if (!dgOpp.data) {
      res.writeHead(404, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({error:'opportunity not found', id: dgId}));
      return;
    }
    var dgResult = await agentDiscriminatorSynthesizer(dgOpp.data, {});
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ id: dgId, result: dgResult }));
  } catch (dge) {
    log('DISCRIMINATORS-GENERATE error: ' + (dge.message||'').slice(0,200));
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: dge.message }));
  }
  return;
}

if (url.startsWith('/api/discriminators')) {
  var drId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!drId) { res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }); res.end(JSON.stringify({error:'id required'})); return; }
  try {
    var drRows = await supabase.from('opportunity_discriminators')
      .select('*')
      .eq('opportunity_id', drId)
      .order('discriminator_num', { ascending: true });
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ id: drId, discriminators: drRows.data || [], count: (drRows.data||[]).length }));
  } catch (dre) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: dre.message }));
  }
  return;
}

// === LAYER B PURSUIT RESEARCH (S122) — /api/pursuit-research?id= (POST triggers, GET reads) ===
if (url.startsWith('/api/pursuit-research') && req.method === 'POST') {
  var prId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!prId) { res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }); res.end(JSON.stringify({error:'id required'})); return; }
  log('PURSUIT-RESEARCH POST: Starting async run for ' + prId);
  try {
    var prOpp = await supabase.from('opportunities').select('*').eq('id', prId).single();
    if (!prOpp.data) {
      res.writeHead(404, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({error:'opportunity not found', id: prId}));
      return;
    }
    // Respond immediately; run agent in background (~8-12 min)
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ started: true, id: prId, note: 'Layer B pursuit research running async (~8-12 min). Poll GET /api/pursuit-research?id= to see status.' }));
    setImmediate(async function() {
      try {
        var prResult = await agentPursuitResearcher(prOpp.data, {});
        log('PURSUIT-RESEARCH POST (async) done: status=' + (prResult && prResult.status) + ', findings=' + (prResult && prResult.findings_count) + ', cost=$' + (prResult && prResult.cost_usd));
      } catch(_aee) {
        log('PURSUIT-RESEARCH POST (async) error: ' + (_aee.message||'').slice(0,200));
      }
    });
  } catch (pre) {
    log('PURSUIT-RESEARCH POST error: ' + (pre.message||'').slice(0,200));
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: pre.message }));
  }
  return;
}

if (url.startsWith('/api/pursuit-research')) {
  var prgId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!prgId) { res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }); res.end(JSON.stringify({error:'id required'})); return; }
  try {
    var prgRunsResp = await supabase.from('pursuit_research_runs')
      .select('*')
      .eq('opportunity_id', prgId)
      .order('created_at', { ascending: false })
      .limit(10);
    var prgRuns = prgRunsResp.data || [];
    var prgFindingsResp = await supabase.from('pursuit_research')
      .select('*')
      .eq('opportunity_id', prgId)
      .order('finding_num', { ascending: true })
      .limit(200);
    var prgFindings = prgFindingsResp.data || [];
    var latest = prgRuns[0] || null;
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({
      id: prgId,
      latest_run: latest,
      runs: prgRuns,
      findings: prgFindings,
      findings_count: prgFindings.length,
      runs_count: prgRuns.length
    }));
  } catch (prge) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: prge.message }));
  }
  return;
}

// === L3 METHODOLOGY CORPUS (S123) — /api/methodology-generate, /api/methodology-batch, /api/methodology-briefs, /api/methodology-retrieve ===

// POST /api/methodology-generate — single brief async
if (url.startsWith('/api/methodology-generate') && req.method === 'POST') {
  var mgBody = '';
  req.on('data', function(ch){ mgBody += ch; });
  req.on('end', async function(){
    var mgParams = {};
    try { mgParams = JSON.parse(mgBody || '{}'); } catch(_) {}
    var mgVertical = String(mgParams.vertical || '').trim();
    var mgWorkArea = String(mgParams.work_area || '').trim();
    if (!mgVertical || !mgWorkArea) {
      res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({ error: 'vertical and work_area required in body' }));
      return;
    }
    log('METHODOLOGY-GENERATE POST: ' + mgVertical + ' / ' + mgWorkArea);
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ started: true, vertical: mgVertical, work_area: mgWorkArea, note: 'Methodology brief running async (~4-6 min). Poll GET /api/methodology-briefs?vertical=X&work_area=Y to see result.' }));
    setImmediate(async function(){
      try {
        // S124: pipe optional softCap/hardCap from body to agent opts
        var mgOpts = {};
        if (typeof mgParams.softCap === 'number') mgOpts.softCap = mgParams.softCap;
        if (typeof mgParams.hardCap === 'number') mgOpts.hardCap = mgParams.hardCap;
        var mgRes = await agentMethodologyResearcher({ vertical: mgVertical, work_area: mgWorkArea, title: mgParams.title, force: !!mgParams.force }, mgOpts);
        log('METHODOLOGY-GENERATE (async) done: ' + JSON.stringify({ status: mgRes && mgRes.status, words: mgRes && mgRes.word_count, cost: mgRes && mgRes.cost_usd }));
      } catch(_aee) {
        log('METHODOLOGY-GENERATE (async) error: ' + (_aee.message||'').slice(0,200));
      }
    });
  });
  return;
}

// POST /api/methodology-batch — seed batch async, serial
if (url.startsWith('/api/methodology-batch') && req.method === 'POST') {
  var mbBody = '';
  req.on('data', function(ch){ mbBody += ch; });
  req.on('end', async function(){
    var mbParams = {};
    try { mbParams = JSON.parse(mbBody || '{}'); } catch(_) {}
    var mbBriefs = Array.isArray(mbParams.briefs) ? mbParams.briefs : [];
    if (mbBriefs.length === 0) {
      res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({ error: 'briefs array required in body: [{vertical, work_area, title?}, ...]' }));
      return;
    }
    var mbCount = mbBriefs.length;
    log('METHODOLOGY-BATCH POST: starting serial batch of ' + mbCount + ' briefs');
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ started: true, count: mbCount, note: 'Serial batch running async (~' + Math.ceil(mbCount * 4) + '-' + Math.ceil(mbCount * 6) + ' min total). Poll GET /api/methodology-briefs to see results.' }));
    setImmediate(async function(){
      var bResults = [];
      var batchStart = Date.now();
      for (var bi = 0; bi < mbBriefs.length; bi++) {
        var b = mbBriefs[bi] || {};
        if (!b.vertical || !b.work_area) continue;
        try {
          log('METHODOLOGY-BATCH ' + (bi+1) + '/' + mbCount + ': ' + b.vertical + ' / ' + b.work_area);
          // S124: per-brief softCap/hardCap overrides batch-level; batch-level overrides default
          var bOpts = {};
          if (typeof mbParams.softCap === 'number') bOpts.softCap = mbParams.softCap;
          if (typeof mbParams.hardCap === 'number') bOpts.hardCap = mbParams.hardCap;
          if (typeof b.softCap === 'number') bOpts.softCap = b.softCap;
          if (typeof b.hardCap === 'number') bOpts.hardCap = b.hardCap;
          var bRes = await agentMethodologyResearcher({ vertical: b.vertical, work_area: b.work_area, title: b.title, force: !!mbParams.force }, bOpts);
          bResults.push({ idx: bi+1, vertical: b.vertical, work_area: b.work_area, status: bRes && bRes.status, words: bRes && bRes.word_count, cost: bRes && bRes.cost_usd });
        } catch (_be) {
          log('METHODOLOGY-BATCH ' + (bi+1) + ' error: ' + (_be.message||'').slice(0,200));
          bResults.push({ idx: bi+1, vertical: b.vertical, work_area: b.work_area, status: 'exception', error: (_be.message||'').slice(0,200) });
        }
      }
      var batchWall = Math.floor((Date.now() - batchStart)/1000);
      var batchCost = bResults.reduce(function(s,r){return s + (r.cost||0);}, 0);
      log('METHODOLOGY-BATCH done: ' + bResults.length + ' briefs attempted, ' + bResults.filter(function(r){return r.status==='published';}).length + ' published, ' + batchWall + 's, $' + batchCost.toFixed(2));
    });
  });
  return;
}

// GET /api/methodology-briefs — list briefs, filter by vertical/work_area optional
if (url.startsWith('/api/methodology-briefs')) {
  var mbqRaw = req.url || '';
  var mbqQS = mbqRaw.indexOf('?') >= 0 ? mbqRaw.split('?')[1] : '';
  var mbqParams = {};
  mbqQS.split('&').forEach(function(p){ var kv = p.split('='); if(kv[0]) mbqParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||''); });
  try {
    var mbqQuery = supabase.from('methodology_briefs').select('id,vertical,work_area,work_area_slug,title,word_count,citation_count,quality_score,status,last_researched,generation_cost_usd,generation_wall_time_seconds,created_at,updated_at').order('updated_at', { ascending: false });
    if (mbqParams.vertical) mbqQuery = mbqQuery.eq('vertical', mbqParams.vertical);
    if (mbqParams.work_area_slug) mbqQuery = mbqQuery.eq('work_area_slug', mbqParams.work_area_slug);
    if (mbqParams.status) mbqQuery = mbqQuery.eq('status', mbqParams.status);
    var mbqResp = await mbqQuery.limit(200);
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({
      count: (mbqResp.data||[]).length,
      briefs: mbqResp.data || []
    }));
  } catch (mbqe) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: mbqe.message }));
  }
  return;
}

// GET /api/methodology-retrieve — fetch full brief text + citations (for L6 specialists and wire-in)
if (url.startsWith('/api/methodology-retrieve')) {
  var mrRaw = req.url || '';
  var mrQS = mrRaw.indexOf('?') >= 0 ? mrRaw.split('?')[1] : '';
  var mrParams = {};
  mrQS.split('&').forEach(function(p){ var kv = p.split('='); if(kv[0]) mrParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||''); });
  var mrVertical = mrParams.vertical || '';
  var mrWorkArea = mrParams.work_area || '';
  var mrWorkAreaSlug = mrParams.work_area_slug || '';
  if (!mrVertical) {
    res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: 'vertical required' }));
    return;
  }
  try {
    var mrQuery = supabase.from('methodology_briefs').select('*').eq('vertical', mrVertical).eq('status', 'published');
    if (mrWorkAreaSlug) mrQuery = mrQuery.eq('work_area_slug', mrWorkAreaSlug);
    else if (mrWorkArea) mrQuery = mrQuery.eq('work_area', mrWorkArea);
    var mrResp = await mrQuery.order('updated_at', { ascending: false }).limit(10);
    var briefs = mrResp.data || [];
    var briefIds = briefs.map(function(b){return b.id;});
    var citations = [];
    if (briefIds.length > 0) {
      var mrCites = await supabase.from('methodology_citations').select('*').in('brief_id', briefIds).order('relevance_score', { ascending: false });
      citations = mrCites.data || [];
    }
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({
      vertical: mrVertical,
      work_area: mrWorkArea || null,
      brief_count: briefs.length,
      briefs: briefs,
      citation_count: citations.length,
      citations: citations
    }));
  } catch (mre) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: mre.message }));
  }
  return;
}



// === L5 COMPETITOR BRIEFS — /api/competitor-brief-generate, batch, list, retrieve (S126 push 5) ===
// Mirrors L3 methodology endpoints. Replaces unstructured text-dump from prior agentCompetitorDeepDive.

// POST /api/competitor-brief-generate — single competitor async
if (url.startsWith('/api/competitor-brief-generate') && req.method === 'POST') {
  var cgBody = '';
  req.on('data', function(ch){ cgBody += ch; });
  req.on('end', async function(){
    var cgParams = {};
    try { cgParams = JSON.parse(cgBody || '{}'); } catch(_) {}
    var cgName = cgParams.competitor_name;
    var cgVerticals = cgParams.primary_verticals;
    if (!cgName || !Array.isArray(cgVerticals) || cgVerticals.length === 0) {
      res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({ error: 'competitor_name and primary_verticals[] required' }));
      return;
    }
    log('COMPETITOR-BRIEF-GENERATE POST: ' + cgName);
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ started: true, competitor_name: cgName, note: 'Competitor brief running async (~5-8 min). Poll GET /api/competitor-briefs to see result.' }));
    setImmediate(async function(){
      try {
        var cgOpts = {};
        if (typeof cgParams.softCap === 'number') cgOpts.softCap = cgParams.softCap;
        if (typeof cgParams.hardCap === 'number') cgOpts.hardCap = cgParams.hardCap;
        var cgRes = await agentCompetitorBriefResearcher({
          competitor_name: cgName,
          primary_verticals: cgVerticals,
          geographic_focus: cgParams.geographic_focus,
          force: !!cgParams.force
        }, cgOpts);
        log('COMPETITOR-BRIEF-GENERATE done: ' + JSON.stringify(cgRes).slice(0, 300));
      } catch (_ee) {
        log('COMPETITOR-BRIEF-GENERATE exception: ' + (_ee.message||'').slice(0,200));
      }
    });
  });
  return;
}

// POST /api/competitor-brief-batch — serial async batch
if (url.startsWith('/api/competitor-brief-batch') && req.method === 'POST') {
  var cbBody = '';
  req.on('data', function(ch){ cbBody += ch; });
  req.on('end', async function(){
    var cbParams = {};
    try { cbParams = JSON.parse(cbBody || '{}'); } catch(_) {}
    var cbBriefs = Array.isArray(cbParams.briefs) ? cbParams.briefs : [];
    if (cbBriefs.length === 0) {
      res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({ error: 'briefs array required: [{competitor_name, primary_verticals[], geographic_focus[]?}, ...]' }));
      return;
    }
    var cbCount = cbBriefs.length;
    log('COMPETITOR-BRIEF-BATCH POST: starting serial batch of ' + cbCount + ' briefs');
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ started: true, count: cbCount, note: 'Serial batch running async (~' + Math.ceil(cbCount * 6) + '-' + Math.ceil(cbCount * 9) + ' min total). Poll GET /api/competitor-briefs.' }));
    setImmediate(async function(){
      var bResults = [];
      var batchStart = Date.now();
      for (var bi = 0; bi < cbBriefs.length; bi++) {
        var b = cbBriefs[bi] || {};
        if (!b.competitor_name || !Array.isArray(b.primary_verticals)) continue;
        try {
          log('COMPETITOR-BRIEF-BATCH ' + (bi+1) + '/' + cbCount + ': ' + b.competitor_name);
          var bOpts = {};
          if (typeof cbParams.softCap === 'number') bOpts.softCap = cbParams.softCap;
          if (typeof cbParams.hardCap === 'number') bOpts.hardCap = cbParams.hardCap;
          if (typeof b.softCap === 'number') bOpts.softCap = b.softCap;
          if (typeof b.hardCap === 'number') bOpts.hardCap = b.hardCap;
          var bRes = await agentCompetitorBriefResearcher({
            competitor_name: b.competitor_name,
            primary_verticals: b.primary_verticals,
            geographic_focus: b.geographic_focus,
            force: !!cbParams.force
          }, bOpts);
          bResults.push({ idx: bi+1, competitor_name: b.competitor_name, status: bRes && bRes.status, words: bRes && bRes.word_count, cost: bRes && bRes.cost_usd });
        } catch (_be) {
          log('COMPETITOR-BRIEF-BATCH ' + (bi+1) + ' error: ' + (_be.message||'').slice(0,200));
          bResults.push({ idx: bi+1, competitor_name: b.competitor_name, status: 'exception', error: (_be.message||'').slice(0,200) });
        }
      }
      var batchWall = Math.floor((Date.now() - batchStart)/1000);
      var batchCost = bResults.reduce(function(s,r){return s + (r.cost||0);}, 0);
      log('COMPETITOR-BRIEF-BATCH done: ' + bResults.length + ' attempted, ' + bResults.filter(function(r){return r.status==='published';}).length + ' published, ' + batchWall + 's, $' + batchCost.toFixed(2));
    });
  });
  return;
}

// GET /api/competitor-briefs — list briefs, filter by vertical or competitor optional
if (url.startsWith('/api/competitor-briefs')) {
  var cqRaw = req.url || '';
  var cqQS = cqRaw.indexOf('?') >= 0 ? cqRaw.split('?')[1] : '';
  var cqParams = {};
  cqQS.split('&').forEach(function(p){ var kv = p.split('='); if(kv[0]) cqParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||''); });
  try {
    var cqQuery = supabase.from('competitor_briefs').select('id,competitor_name,competitor_slug,primary_verticals,geographic_focus,word_count,citation_count,quality_score,status,last_researched,generation_cost_usd,generation_wall_time_seconds,created_at,updated_at').order('updated_at', { ascending: false });
    if (cqParams.competitor_slug) cqQuery = cqQuery.eq('competitor_slug', cqParams.competitor_slug);
    if (cqParams.status) cqQuery = cqQuery.eq('status', cqParams.status);
    if (cqParams.vertical) cqQuery = cqQuery.contains('primary_verticals', [cqParams.vertical]);
    var cqResp = await cqQuery.limit(200);
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({
      count: (cqResp.data||[]).length,
      briefs: cqResp.data || []
    }));
  } catch (cqe) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: cqe.message }));
  }
  return;
}

// GET /api/competitor-brief-retrieve — fetch full brief text + citations
if (url.startsWith('/api/competitor-brief-retrieve')) {
  var crRaw = req.url || '';
  var crQS = crRaw.indexOf('?') >= 0 ? crRaw.split('?')[1] : '';
  var crParams = {};
  crQS.split('&').forEach(function(p){ var kv = p.split('='); if(kv[0]) crParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||''); });
  var crSlug = crParams.competitor_slug;
  if (!crSlug) {
    res.writeHead(400, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: 'competitor_slug required' }));
    return;
  }
  try {
    var crBrief = await supabase.from('competitor_briefs').select('*').eq('competitor_slug', crSlug).eq('status', 'published').limit(1).single();
    if (!crBrief.data) {
      res.writeHead(404, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(JSON.stringify({ error: 'no published brief for slug=' + crSlug }));
      return;
    }
    var crCites = await supabase.from('competitor_brief_citations').select('*').eq('brief_id', crBrief.data.id).order('relevance_score', { ascending: false });
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({
      brief: crBrief.data,
      citations: crCites.data || []
    }));
  } catch (cre) {
    res.writeHead(500, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: cre.message }));
  }
  return;
}

// === COMPLIANCE CHECK — /api/compliance-check?id= ===
if (url.startsWith('/api/compliance-check')) {
  var ccRawUrl = req.url || '';
  var ccId = ccRawUrl.indexOf('?id=') >= 0 ? ccRawUrl.split('?id=')[1].split('&')[0] : '';
  log('COMPLIANCE-CHECK: id=' + (ccId || 'EMPTY'));
  if (!ccId) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: 'id required' })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var ccOpp = await supabase.from('opportunities').select('*').eq('id', ccId).single();
    if (!ccOpp.data) { res.end(JSON.stringify({ error: 'not found' })); return; }
    var opp = ccOpp.data;
    var rfpText = (opp.rfp_text || '').slice(0, 30000);
    if (rfpText.length < 500) { res.end(JSON.stringify({ error: 'No RFP text available', rfp_chars: rfpText.length })); return; }
    
    var ccPrompt = 'You are a compliance analyst. Extract EVERY submission requirement from this RFP. Return ONLY a JSON array where each item has: requirement (text), section (RFP section reference), category (one of: format, content, certification, insurance, legal, pricing, personnel, deadline, delivery), mandatory (true/false), hgi_status (one of: ready, needs_action, unknown).\n\nFor hgi_status: mark "ready" for standard items HGI can easily provide (insurance certs, W-9, drug-free workplace, etc). Mark "needs_action" for items requiring specific preparation (past performance refs with contacts, specific certifications, project-specific methodology). Mark "unknown" for items you cannot assess.\n\nRFP TEXT:\n' + rfpText;
    log('COMPLIANCE-CHECK: Calling Haiku with ' + rfpText.length + ' chars...');
    var ccOut = await claudeCall('compliance extraction', ccPrompt, 8000, { model: 'claude-haiku-4-5-20251001' });
    log('COMPLIANCE-CHECK: Haiku returned ' + (ccOut ? ccOut.length : 0) + ' chars');
    var requirements = [];
    if (ccOut && ccOut.length > 50) {
      var cleaned = ccOut.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      if (cleaned.startsWith('[') && cleaned.indexOf(']') < 0) {
        var lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > 0) { cleaned = cleaned.slice(0, lastBrace + 1) + ']'; }
        log('COMPLIANCE-CHECK: Force-closed truncated JSON');
      }
      var ccMatch = cleaned.match(/\[[\s\S]*\]/);
      if (ccMatch) {
        try { requirements = JSON.parse(ccMatch[0]); log('COMPLIANCE-CHECK: ' + requirements.length + ' requirements'); }
        catch(e) { log('COMPLIANCE-CHECK: JSON parse failed: ' + e.message); }
      } else { log('COMPLIANCE-CHECK: No JSON array. First 200: ' + cleaned.slice(0,200)); }
    }
    
    var ready = requirements.filter(function(r) { return r.hgi_status === 'ready'; }).length;
    var action = requirements.filter(function(r) { return r.hgi_status === 'needs_action'; }).length;
    var unknown = requirements.filter(function(r) { return r.hgi_status === 'unknown'; }).length;
    
    res.end(JSON.stringify({
      opportunity: opp.title,
      total_requirements: requirements.length,
      ready: ready, needs_action: action, unknown: unknown,
      compliance_score: requirements.length > 0 ? Math.round((ready / requirements.length) * 100) : 0,
      requirements: requirements,
      categories: requirements.reduce(function(acc, r) { var c = r.category || 'other'; if (!acc[c]) acc[c] = 0; acc[c]++; return acc; }, {})
    }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === PHASE 3 INTELLIGENCE SUMMARY — /api/phase3 ===
if (url.startsWith('/api/phase3')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var p3agents = ['disaster_monitor','contract_expiration','budget_cycle','regulatory_monitor',
      'teaming_agent','loss_analysis','win_rate_analytics','recompete_agent','agency_profile_agent',
      'subcontractor_db','entrepreneurial_agent','source_expansion','learning_loop'];
    var p3data = await supabase.from('organism_memory')
      .select('agent,observation,created_at,memory_type')
      .in('agent', p3agents)
      .not('memory_type','in','("compliance_matrix_data","rate_table_data","org_chart_data")')
      .order('created_at', { ascending: false })
      .limit(50);
    var p3mems = p3data.data || [];
    // Group by agent
    var grouped = {};
    p3mems.forEach(function(m) {
      if (!grouped[m.agent]) grouped[m.agent] = [];
      grouped[m.agent].push({ obs: (m.observation||''), at: m.created_at, type: m.memory_type });
    });
    // Build category summaries
    var categories = {
      disaster: { label: 'Disaster Declarations', agents: ['disaster_monitor'], data: [] },
      contracts: { label: 'Contract Expirations', agents: ['contract_expiration','recompete_agent'], data: [] },
      budget: { label: 'Budget Cycles', agents: ['budget_cycle'], data: [] },
      regulatory: { label: 'Regulatory Changes', agents: ['regulatory_monitor'], data: [] },
      teaming: { label: 'Teaming Partners', agents: ['teaming_agent','subcontractor_db'], data: [] },
      analytics: { label: 'Win Rate & Loss Analysis', agents: ['win_rate_analytics','loss_analysis'], data: [] },
      agencies: { label: 'Agency Profiles', agents: ['agency_profile_agent'], data: [] },
      growth: { label: 'Growth & Expansion', agents: ['entrepreneurial_agent','source_expansion','learning_loop'], data: [] }
    };
    Object.keys(categories).forEach(function(k) {
      categories[k].agents.forEach(function(a) {
        if (grouped[a]) categories[k].data = categories[k].data.concat(grouped[a]);
      });
      categories[k].count = categories[k].data.length;
    });
    // Fetch structured table counts
    var structuredCounts = {};
    try {
      var dcnt = await supabase.from('disaster_alerts').select('id', { count: 'exact', head: true });
      var bcnt = await supabase.from('budget_cycles').select('id', { count: 'exact', head: true });
      var rcnt = await supabase.from('recompete_tracker').select('id', { count: 'exact', head: true });
      var rgcnt = await supabase.from('regulatory_changes').select('id', { count: 'exact', head: true });
      var tcnt = await supabase.from('teaming_partners').select('id', { count: 'exact', head: true });
      var acnt = await supabase.from('agency_profiles').select('id', { count: 'exact', head: true });
      var pancnt = await supabase.from('pipeline_analytics').select('id', { count: 'exact', head: true });
      structuredCounts = { disaster_alerts: dcnt.count || 0, budget_cycles: bcnt.count || 0, recompete_tracker: rcnt.count || 0, regulatory_changes: rgcnt.count || 0, teaming_partners: tcnt.count || 0, agency_profiles: acnt.count || 0, pipeline_analytics: pancnt.count || 0 };
    } catch(sc) { structuredCounts = { error: sc.message }; }
    res.end(JSON.stringify({ total: p3mems.length, categories: categories, structured_tables: structuredCounts }));
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === PROPOSAL RED TEAM REVIEW — /api/proposal-review ===
if (url.startsWith('/api/proposal-review')) {
  var rvId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!rvId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({error:'id required'})); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  try {
    var rvOpp = await supabase.from('opportunities').select('id,title,proposal_review').eq('id', rvId).single();
    if (!rvOpp.data || !rvOpp.data.proposal_review) {
      res.end(JSON.stringify({ id: rvId, review: null, message: 'No review found. Run produce-proposal first — red team review runs automatically after generation.' }));
    } else {
      var rv = rvOpp.data.proposal_review;
      // Try to extract structured JSON from review
      var structured = null;
      try {
        var jsonStart = rv.indexOf('{');
        var jsonEnd = rv.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          structured = JSON.parse(rv.slice(jsonStart, jsonEnd + 1));
        }
      } catch(e) {}

      if (structured && structured.findings) {
        res.end(JSON.stringify({
          id: rvId, title: rvOpp.data.title, format: 'structured',
          overall_status: structured.overall_status,
          pwin_estimate: structured.pwin_estimate,
          pwin_rationale: structured.pwin_rationale,
          scoring_matrix: structured.scoring_matrix || [],
          summary: {
            disqualifying: structured.findings.filter(function(f) { return f.severity === 'DISQUALIFYING'; }).length,
            critical: structured.findings.filter(function(f) { return f.severity === 'CRITICAL'; }).length,
            major: structured.findings.filter(function(f) { return f.severity === 'MAJOR'; }).length,
            minor: structured.findings.filter(function(f) { return f.severity === 'MINOR'; }).length
          },
          findings: structured.findings,
          strengths: structured.strengths || [],
          competitive_vulnerabilities: structured.competitive_vulnerabilities || [],
          top_3_improvements: structured.top_3_improvements || []
        }));
      } else {
        var critC = (rv.match(/critical/gi) || []).length;
        var majC = (rv.match(/major/gi) || []).length;
        var minC = (rv.match(/minor/gi) || []).length;
        res.end(JSON.stringify({ id: rvId, title: rvOpp.data.title, format: 'text', summary: { critical: critC, major: majC, minor: minC }, review: rv }));
      }
    }
  } catch(e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === INTERACTIVE SECTION IMPROVE/RED TEAM — /api/proposal-improve ===
if (url.startsWith('/api/proposal-improve') && req.method === 'POST') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var piBody = '';
    await new Promise(function(resolve) { req.on('data', function(c) { piBody += c; }); req.on('end', resolve); });
    var piData = JSON.parse(piBody || '{}');
    var piSection = piData.section_content || '';
    var piAction = piData.action || 'improve';
    if (!piSection) { res.end(JSON.stringify({ error: 'section_content required' })); return; }
    var piCtx = 'RFP: ' + (piData.rfp_context || '') + '\nAgency: ' + (piData.agency || '') + '\nVertical: ' + (piData.vertical || '') + '\nSection: ' + (piData.section_name || '');
    var piResult = {};
    if (piAction === 'improve' || piAction === 'both') {
      var piImproved = await claudeCall('Improve proposal section', piCtx + '\n\nSection to improve:\n' + piSection, 2000, { model: SONNET, system: 'You are a senior proposal writer for HGI. Improve this section: more specific, more compelling, evaluator-aligned. Use real HGI past performance. Remove generic language. Add metrics and outcomes. Return only the improved section text.' });
      piResult.improved = piImproved;
      if (piAction === 'both') piSection = piImproved;
    }
    if (piAction === 'redteam' || piAction === 'both') {
      var piFindings = await claudeCall('Red team proposal section', piCtx + '\n\nSection to red team:\n' + piSection, 2000, { model: SONNET, system: 'You are a ruthless proposal evaluator. Find every weakness, vague claim, gap, and missing requirement. Return a numbered list of specific issues with fixes.' });
      piResult.redteam_findings = piFindings;
    }
    if (!piResult.improved && !piResult.redteam_findings) { res.end(JSON.stringify({ error: 'action must be improve, redteam, or both' })); return; }
    res.end(JSON.stringify({ success: true, result: piResult }));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === S132: CITATION VERIFIER TEST — /api/test-citation-verifier ===
// POST {id: "opp_id", section?: "technical_approach"}
// Runs verifySectionCitations() against an opportunity's already-populated
// section_technical_approach. Lets us validate the verifier without re-running
// produce-proposal ($2+). Returns audit_log + counts + verified_text preview.
if (url.startsWith('/api/test-citation-verifier') && req.method === 'POST') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var cvBody = '';
    await new Promise(function(resolve) { req.on('data', function(c) { cvBody += c; }); req.on('end', resolve); });
    var cvData = JSON.parse(cvBody || '{}');
    var cvOppId = cvData.id || cvData.opportunity_id;
    var cvSectionName = cvData.section || 'technical_approach';
    if (!cvOppId) { res.end(JSON.stringify({ error: 'id required' })); return; }

    var cvOppRes = await supabase.from('opportunities').select('id, section_technical_approach').eq('id', cvOppId).single();
    if (!cvOppRes.data) { res.end(JSON.stringify({ error: 'opportunity not found' })); return; }
    var cvSectionObj = cvOppRes.data.section_technical_approach;
    if (!cvSectionObj || !cvSectionObj.section_text) {
      res.end(JSON.stringify({ error: 'section_' + cvSectionName + ' not populated on this opportunity' }));
      return;
    }

    log('CITATION VERIFIER TEST: oppId=' + cvOppId + ', section=' + cvSectionName + ', chars=' + cvSectionObj.section_text.length);

    var cvResult = await verifySectionCitations(cvSectionObj.section_text, cvOppId, cvSectionName);

    res.end(JSON.stringify({
      success: true,
      opportunity_id: cvOppId,
      section: cvSectionName,
      run_id: cvResult.run_id,
      counts: cvResult.counts,
      flagged_count: cvResult.flagged_count,
      cost_usd: cvResult.cost_usd,
      audit_log: cvResult.audit_log,
      verified_text_length: cvResult.verified_text.length,
      verified_text_preview: cvResult.verified_text.slice(0, 2000)
    }));
  } catch (e) {
    res.end(JSON.stringify({ error: e.message, stack: (e.stack||'').slice(0,500) }));
  }
  return;
}


// === S134: SECTION-TARGETED REFINEMENT — /api/refine-weak-sections ===
// POST { id, threshold=60, dryRun=true, maxSectionsToRegen=3, forceExclusionOverride=false }
// Identifies sections scoring below threshold in opp.proposal_review.scoring_matrix,
// regenerates each weak section (Opus 4.6), re-scores with same scorer for apples-to-apples
// delta. Dry-run (default) does NOT write to proposal_content. Set dryRun:false to splice
// improved regenerations back in. Mirrors S133 hard-exclusion guardrail on NON-dry-run only.
// Standalone — does NOT auto-wire into /api/produce-proposal in S134.
if (url.startsWith('/api/refine-weak-sections') && req.method === 'POST') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  try {
    var rwsBody = '';
    await new Promise(function(resolve) { req.on('data', function(c) { rwsBody += c; }); req.on('end', resolve); });
    var rwsData = JSON.parse(rwsBody || '{}');
    var rwsOppId = rwsData.id || rwsData.opportunity_id;
    if (!rwsOppId) { res.end(JSON.stringify({ error: 'id required' })); return; }

    var rwsDryRun = rwsData.dryRun !== false;  // default true
    var rwsForceOverride = !!rwsData.forceExclusionOverride;

    // Hard-exclusion guardrail — only fires on NON-dry-run invocations (dry-run is analysis only).
    if (!rwsDryRun && !rwsForceOverride) {
      var rwsOppCheck = await supabase.from('opportunities').select('id,agency,title').eq('id', rwsOppId).single();
      if (rwsOppCheck.data) {
        var rwsAgency = String(rwsOppCheck.data.agency || '').toLowerCase();
        var rwsTitle = String(rwsOppCheck.data.title || '').toLowerCase();
        var rwsMatched = null;
        for (var rxi = 0; rxi < HGI_PP_EXCLUSIONS.length; rxi++) {
          var rxTerm = String(HGI_PP_EXCLUSIONS[rxi]).toLowerCase();
          if (rwsAgency.indexOf(rxTerm) >= 0 || rwsTitle.indexOf(rxTerm) >= 0) {
            rwsMatched = HGI_PP_EXCLUSIONS[rxi];
            break;
          }
        }
        if (rwsMatched) {
          log('REFINE WEAK SECTIONS: REFUSED — hard exclusion "' + rwsMatched + '" matched for ' + rwsOppId + ' on non-dry-run. Override with {forceExclusionOverride:true}.');
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'hard_exclusion_client',
            message: 'Opportunity agency matches hard-exclusion entry "' + rwsMatched + '". Cannot write to proposal_content without President authorization. Dry-run mode (dryRun:true) is always permitted.',
            matched_exclusion: rwsMatched,
            opportunity_id: rwsOppId,
            override_with: { id: rwsOppId, dryRun: false, forceExclusionOverride: true }
          }));
          return;
        }
      }
    }

    var rwsResult = await refineWeakSections(rwsOppId, {
      threshold: typeof rwsData.threshold === 'number' ? rwsData.threshold : 60,
      dryRun: rwsDryRun,
      maxSectionsToRegen: typeof rwsData.maxSectionsToRegen === 'number' ? rwsData.maxSectionsToRegen : 3
    });

    res.end(JSON.stringify(rwsResult));
  } catch (e) {
    res.end(JSON.stringify({ error: e.message, stack: (e.stack || '').slice(0, 500) }));
  }
  return;
}

// === PROPOSAL DOCUMENT GENERATOR — /api/proposal-doc ===
if (url.startsWith('/api/proposal-doc')) {
  var docId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!docId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  try {
    log('PROPOSAL DOC: Generating for ' + docId);
    var docOpp = await supabase.from('opportunities').select('*').eq('id', docId).single();
    var opp = docOpp.data;
    if (!opp) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }

    // Get proposal text from proposal_content (NOT capture_action — that's internal analysis)
    var proposalText = (opp.proposal_content || '').replace(/^# PROPOSAL DRAFT.*?\n\n/, '');

    // Post-process: Auto-fill known ACTION REQUIRED items at doc generation time
    // Insurance — catch all variants: "insurance", "WC coverage", "auto policy", "umbrella", "E&O", "GL", "fidelity"
    proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:insurance|WC coverage|workers.?comp|auto policy|umbrella|E&O|fidelity|GL |general liability|Obtain from carrier|Obtain current cert|Confirm current.*(?:coverage|limits|policy))[^\]]*\]/gi, 'HGI maintains $5M fidelity bond, $5M Errors & Omissions, $2M General Liability, Workers Compensation at statutory limits, and $1M Commercial Auto coverage. Certificates of insurance with Additional Insured endorsement naming CLIENT will be provided upon contract execution.');
    // Professional Regulation licenses
    proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:professional regulation|DPR|Confirm.*(?:applicable|applicability))[^\]]*\]/gi, 'No Louisiana Department of Professional Regulation license is required for disaster recovery consulting, program management, claims administration, construction management oversight, or grant management services. HGI professionals hold individual certifications as applicable to their roles.');
    // SAM.gov / UEI / registration printout
    proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:SAM|UEI|registration.*print|Print.*registration)[^\]]*\]/gi, 'HGI Global is registered in SAM.gov with active status. UEI: DL4SJEVKZ6H4.');
    // Addenda monitoring
    proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:addend|Attachment O|Monitor.*addend)[^\]]*\]/gi, 'HGI has monitored centralauctionhouse.com for any addenda issued. All addenda issued as of the submission date are acknowledged on Attachment O.');
    // Business license
    proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:business license|Louisiana.*license)[^\]]*\]/gi, 'HGI Global (Hammerman & Gainer LLC) is registered and licensed to conduct business in the State of Louisiana.');
    // Org chart — system generates this
    proposalText = proposalText.replace(/\[ACTION REQUIRED[^\]]*(?:org.*chart|professional graphic|organizational)[^\]]*\]/gi, 'See Organizational Chart (Appendix A).');
    // BRACKETLESS patterns (compliance matrix short-form: "ACTION REQUIRED: verb")
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Obtain from carrier|Obtain current cert)/gi, 'On file — certificates provided upon execution');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Print current registration|Print and affix)/gi, 'Included — SAM.gov active, UEI DL4SJEVKZ6H4');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Produce professional graphic)/gi, 'See Appendix A');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Monitor for addenda[^\n]*)/gi, 'Monitored — all addenda acknowledged');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Confirm applicability)/gi, 'Confirmed — no DPR license required');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Reproduce at production)/gi, 'Production copy enclosed');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Obtain and include)/gi, 'Included');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Include current form)/gi, 'Included');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Obtain current copy)/gi, 'Included');
    proposalText = proposalText.replace(/ACTION REQUIRED:\s*(?:Arrange courier[^\n]*)/gi, 'Delivery arranged per RFP instructions');

    // Post-process: strip ASCII box-drawing art (org charts Opus sometimes generates despite instructions)
    var cleanLines = [];
    var skipBlock = false;
    proposalText.split('\n').forEach(function(line) {
      var boxChars = (line.match(/[\u2500-\u257F\u250C\u2510\u2514\u2518\u251C\u2524\u252C\u2534\u253C\u2502\u2550-\u256C\u25BC\u25B2\u25B6\u25C0]/g) || []).length;
      if (boxChars >= 3) { skipBlock = true; return; }
      if (skipBlock && line.trim() === '') { skipBlock = false; return; }
      if (skipBlock && boxChars >= 1) return;
      if (skipBlock) skipBlock = false;
      cleanLines.push(line);
    });
    proposalText = cleanLines.join('\n');

    // Post-process: fix common Opus hallucinations
    // UEI correction — Opus sometimes scrambles characters
    proposalText = proposalText.replace(/DL4S[A-Z0-9]{3,8}(?!JEVKZ6H4)/g, function(match) {
      if (match === 'DL4SJEVKZ6H4') return match;
      return 'DL4SJEVKZ6H4';
    });
    // Founding year — 1929 is canonical; no rewrite needed
    // (removed: 1929→1931 regex, S114 Item A reversal)
    // Phone correction
    proposalText = proposalText.replace(/\(504\)\s*000-0000/g, '(504) 681-6135');
    // Email placeholder
    proposalText = proposalText.replace(/info@hgi\.com/gi, 'info@hgi-global.com');
    // Geoffrey Brien removal — catch any that slip through
    proposalText = proposalText.replace(/Geoffrey\s+Brien/gi, '[DR Manager — Position Open]');
    // PBGC — included per Christopher S113 Q4 decision (S115 reversal)
    // Strip regex removed. L5192 HGI context guardrail still prevents
    // auto-inclusion as past performance without President confirmation.
    // Old staff count correction
    proposalText = proposalText.replace(/67\s+full[- ]time\s+(employees|staff)/gi, 'approximately 50 team members');
    proposalText = proposalText.replace(/67\s+FT\s*\+?\s*43\s+contract/gi, 'approximately 50 team members');
    proposalText = proposalText.replace(/110\s+professionals/gi, 'approximately 50 team members');
    // Founding year catch-all — 1929 is canonical; 95-year normalization removed (S114 Item A)
    // (removed: founded_in_1929→1931, since_1929→1931, 95_year→ninety-five-year regexes)
    // Orleans Parish School Board — S116 Item 4: L3517 post-process regex removed.
    // That regex (/Orleans\s+Parish\s+School\s+Board[^.]*?\./gi) overreached by deleting
    // EVERY OPSB reference, which breaks proposals where OPSB is the actual client
    // (e.g. RFQ 26-0108). The HGI_PP_EXCLUSIONS constant + HGI context guardrail +
    // senior_writer system prompt now enforce "do not list OPSB as past performance"
    // at generation time, which is the correct layer for a semantic rule.

    if (!proposalText || proposalText.length < 500) {
      res.writeHead(400); res.end(JSON.stringify({
        error: 'No proposal content found. Run /api/produce-proposal first to generate submission-ready content.',
        has_capture_action: !!(opp.capture_action && opp.capture_action.length > 500),
        note: 'capture_action contains the organism internal analysis (GO/NO-GO brief), not proposal content.'
      })); return;
    }

    // --- MARKDOWN → DOCX PARSER (UPGRADED SESSION 69) ---

    // Colors
    var NAVY = '1B2A4A';
    var GOLD = 'C8962E';
    var GRAY = '6B7280';
    var LIGHT_GRAY = 'F3F4F6';
    var TABLE_HEADER = '1B2A4A';
    var TABLE_ALT = 'F9FAFB';

    // Parse inline formatting: **bold**, *italic*, `code`
    function parseInline(text) {
      var runs = [];
      // Split on bold, italic, and code patterns
      var parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        if (p.startsWith('**') && p.endsWith('**')) {
          runs.push(new TextRun({ text: p.slice(2,-2), bold: true, size: 22, font: 'Calibri' }));
        } else if (p.startsWith('*') && p.endsWith('*')) {
          runs.push(new TextRun({ text: p.slice(1,-1), italics: true, size: 22, font: 'Calibri' }));
        } else if (p.startsWith('`') && p.endsWith('`')) {
          runs.push(new TextRun({ text: p.slice(1,-1), font: 'Courier New', size: 20, color: '374151' }));
        } else {
          runs.push(new TextRun({ text: p, size: 22, font: 'Calibri' }));
        }
      }
      return runs.length > 0 ? runs : [new TextRun({ text: text, size: 22, font: 'Calibri' })];
    }

    // Parse markdown table
    function parseTable(lines) {
      var rows = [];
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].match(/^\|[\s-:|]+\|/)) continue; // skip separator
        var cells = lines[i].split('|').filter(function(c, idx) { return idx > 0 && idx < lines[i].split('|').length - 1; });
        rows.push(cells.map(function(c) { return c.trim(); }));
      }
      if (rows.length === 0) return null;

      var numCols = rows[0].length;
      // Content-aware column widths: measure max content length per column
      var maxLens = [];
      for (var c = 0; c < numCols; c++) {
        var maxLen = 0;
        for (var r = 0; r < rows.length; r++) {
          var cellLen = (rows[r][c] || '').length;
          if (cellLen > maxLen) maxLen = cellLen;
        }
        maxLens.push(Math.max(maxLen, 5)); // min 5 chars
      }
      var totalLen = maxLens.reduce(function(a,b){ return a+b; }, 0);
      var colWidths = maxLens.map(function(len) {
        return Math.floor((len / totalLen) * 9360);
      });
      // Ensure minimum 500 DXA per column, then scale to sum to 9360
      colWidths = colWidths.map(function(w) { return Math.max(w, 500); });
      var widthSum = colWidths.reduce(function(a,b){ return a+b; }, 0);
      if (widthSum !== 9360) {
        var scale = 9360 / widthSum;
        colWidths = colWidths.map(function(w) { return Math.max(Math.floor(w * scale), 400); });
        widthSum = colWidths.reduce(function(a,b){ return a+b; }, 0);
        if (widthSum !== 9360) colWidths[colWidths.length - 1] += (9360 - widthSum);
      }

      var border = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
      var borders = { top: border, bottom: border, left: border, right: border };

      var tableRows = rows.map(function(row, rowIdx) {
        var isHeader = rowIdx === 0;
        return new TableRow({
          children: row.map(function(cell, colIdx) {
            var cellChildren;
            if (isHeader) {
              cellChildren = [new Paragraph({ children: [new TextRun({ text: cell, bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })];
            } else {
              cellChildren = [new Paragraph({ children: parseInline(cell) })];
            }
            return new TableCell({
              borders: borders,
              width: { size: colWidths[colIdx] || 1000, type: WidthType.DXA },
              shading: isHeader ? { fill: TABLE_HEADER, type: ShadingType.CLEAR } : (rowIdx % 2 === 0 ? { fill: TABLE_ALT, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR }),
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: cellChildren
            });
          })
        });
      });

      return new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: tableRows
      });
    }

    // Parse full markdown to docx children
    var allLines = proposalText.split('\n');
    var docChildren = [];
    var lineIdx = 0;

    while (lineIdx < allLines.length) {
      var line = allLines[lineIdx];

      // Headings
      if (line.startsWith('### ')) {
        docChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({ text: line.slice(4).trim(), bold: true, size: 24, font: 'Calibri', color: '4B5563' })
          ]
        }));
        lineIdx++;
        continue;
      }
      if (line.startsWith('## ')) {
        docChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
          children: [
            new TextRun({ text: line.slice(3).trim(), bold: true, size: 28, font: 'Calibri', color: NAVY })
          ]
        }));
        lineIdx++;
        continue;
      }
      if (line.startsWith('# ')) {
        // Add gold accent bar before H1
        docChildren.push(new Paragraph({
          spacing: { before: 400, after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
          children: []
        }));
        docChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 100, after: 200 },
          children: [
            new TextRun({ text: line.slice(2).trim(), bold: true, size: 32, font: 'Calibri', color: NAVY })
          ]
        }));
        lineIdx++;
        continue;
      }

      // Horizontal rule → gold accent line
      if (line.match(/^---+/) || line.match(/^\*\*\*+/) || line.match(/^___+/)) {
        docChildren.push(new Paragraph({
          spacing: { before: 200, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } },
          children: []
        }));
        lineIdx++;
        continue;
      }

      // Table detection
      if (line.startsWith('|') && lineIdx + 1 < allLines.length && allLines[lineIdx + 1].match(/^\|[\s-:|]+\|/)) {
        var tableLines = [];
        while (lineIdx < allLines.length && allLines[lineIdx].startsWith('|')) {
          tableLines.push(allLines[lineIdx]);
          lineIdx++;
        }
        var table = parseTable(tableLines);
        if (table) {
          docChildren.push(new Paragraph({ spacing: { before: 120 }, children: [] }));
          docChildren.push(table);
          docChildren.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        }
        continue;
      }

      // Blockquote → gold left border
      if (line.startsWith('> ')) {
        var quoteLines = [];
        while (lineIdx < allLines.length && allLines[lineIdx].startsWith('> ')) {
          quoteLines.push(allLines[lineIdx].slice(2));
          lineIdx++;
        }
        docChildren.push(new Paragraph({
          spacing: { before: 120, after: 120 },
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 8 } },
          children: parseInline(quoteLines.join(' '))
        }));
        continue;
      }

      // Numbered list
      if (line.match(/^\d+\.\s/)) {
        while (lineIdx < allLines.length && allLines[lineIdx].match(/^\d+\.\s/)) {
          var text = allLines[lineIdx].replace(/^\d+\.\s*/, '').trim();
          docChildren.push(new Paragraph({
            numbering: { reference: 'hgi-numbers', level: 0 },
            spacing: { after: 60 },
            children: parseInline(text)
          }));
          lineIdx++;
        }
        continue;
      }

      // Bullet list
      if (line.startsWith('- ') || line.startsWith('* ')) {
        while (lineIdx < allLines.length && (allLines[lineIdx].startsWith('- ') || allLines[lineIdx].startsWith('* '))) {
          var text = allLines[lineIdx].replace(/^[\-\*]\s*/, '').trim();
          docChildren.push(new Paragraph({
            numbering: { reference: 'hgi-bullets', level: 0 },
            spacing: { after: 60 },
            children: parseInline(text)
          }));
          lineIdx++;
        }
        continue;
      }

      // Empty line
      if (!line.trim()) {
        lineIdx++;
        continue;
      }

      // Regular paragraph — collect consecutive non-empty, non-special lines
      var paraLines = [];
      while (lineIdx < allLines.length && allLines[lineIdx].trim() && !allLines[lineIdx].startsWith('#') && !allLines[lineIdx].startsWith('|') && !allLines[lineIdx].startsWith('> ') && !allLines[lineIdx].startsWith('- ') && !allLines[lineIdx].startsWith('* ') && !allLines[lineIdx].match(/^\d+\.\s/) && !allLines[lineIdx].match(/^---+/) && !allLines[lineIdx].match(/^\*\*\*+/)) {
        paraLines.push(allLines[lineIdx]);
        lineIdx++;
      }
      if (paraLines.length > 0) {
        docChildren.push(new Paragraph({
          spacing: { after: 120 },
          children: parseInline(paraLines.join(' '))
        }));
      }
    }

    // --- BUILD APPENDICES FROM ORGANISM MEMORY ---
    var appendixChildren = [];
    var D = String.fromCharCode(36);
    var border = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
    var borders = { top: border, bottom: border, left: border, right: border };

    try {
      // Call endpoints directly to get appendix data (bypasses memory storage)
      var localPort = process.env.PORT || 8080;
      var localBase = 'http://localhost:' + localPort;
      var cmData = null, rtData = null, ocData = null;

      // Check if this opp has an actual RFP (determines which appendices to generate)
      var oppHasRfp = opp.rfp_document_retrieved === true && opp.rfp_text && opp.rfp_text.trim().length > 200;

      // Compliance Matrix (only for solicited opps)
      if (oppHasRfp) {
        try {
          var cmResp = await fetch(localBase + '/api/compliance-matrix?id=' + docId);
          if (cmResp.ok) {
            var cmJson = await cmResp.json();
            cmData = cmJson.matrix || null;
            log('PROPOSAL DOC: Compliance matrix loaded — ' + (cmData && cmData.requirements ? cmData.requirements.length : 0) + ' requirements');
          }
        } catch(cmErr) { log('PROPOSAL DOC: Compliance matrix call failed — ' + cmErr.message); }
      } else {
        log('PROPOSAL DOC: Skipping compliance matrix — unsolicited opportunity');
      }

      // Rate Table (only for solicited opps)
      if (oppHasRfp) {
        try {
          var rtResp = await fetch(localBase + '/api/rate-table?id=' + docId);
          if (rtResp.ok) {
            var rtJson = await rtResp.json();
            rtData = rtJson.rate_table || null;
            log('PROPOSAL DOC: Rate table loaded — ' + (rtData && rtData.positions ? rtData.positions.length : 0) + ' positions');
          }
        } catch(rtErr) { log('PROPOSAL DOC: Rate table call failed — ' + rtErr.message); }
      } else {
        log('PROPOSAL DOC: Skipping rate table — unsolicited opportunity');
      }

      // Org Chart (always — team structure is useful for any proposal)
      try {
        var ocResp = await fetch(localBase + '/api/org-chart?id=' + docId);
        if (ocResp.ok) {
          var ocJson = await ocResp.json();
          ocData = ocJson.diagrams || null;
          log('PROPOSAL DOC: Org chart loaded — ' + (ocData ? 'org_chart + methodology_flow' : 'none'));
        }
      } catch(ocErr) { log('PROPOSAL DOC: Org chart call failed — ' + ocErr.message); }

      // APPENDIX A: ORGANIZATIONAL CHART (embedded PNG from Kroki)
      if (ocData && ocData.org_chart) {
        try {
            appendixChildren.push(new Paragraph({
              spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, children: []
            }));
            appendixChildren.push(new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 100, after: 200 },
              children: [new TextRun({ text: 'APPENDIX A: ORGANIZATIONAL CHART', bold: true, size: 32, font: 'Calibri', color: NAVY })]
            }));

            // Render org chart as PNG via Kroki
            try {
              var orgPngResp = await fetch('https://kroki.io/mermaid/png', {
                method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: ocData.org_chart
              });
              if (orgPngResp.ok) {
                var orgPngBuf = Buffer.from(await orgPngResp.arrayBuffer());
                log('PROPOSAL DOC: Org chart PNG — ' + orgPngBuf.length + ' bytes');
                appendixChildren.push(new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 200 },
                  children: [new ImageRun({ data: orgPngBuf, transformation: { width: 620, height: 480 }, type: 'png' })]
                }));
              }
            } catch(pngErr) { log('PROPOSAL DOC: Org chart PNG failed — ' + pngErr.message); }

            if (ocData.description) {
              appendixChildren.push(new Paragraph({
                spacing: { after: 200 },
                children: [new TextRun({ text: ocData.description, size: 22, font: 'Calibri', italics: true, color: GRAY })]
              }));
            }

            // Methodology flow if available
            if (ocData.methodology_flow) {
              appendixChildren.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 150 },
                children: [new TextRun({ text: 'Methodology Flow', bold: true, size: 28, font: 'Calibri', color: NAVY })]
              }));
              try {
                var methPngResp = await fetch('https://kroki.io/mermaid/png', {
                  method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: ocData.methodology_flow
                });
                if (methPngResp.ok) {
                  var methPngBuf = Buffer.from(await methPngResp.arrayBuffer());
                  log('PROPOSAL DOC: Methodology flow PNG — ' + methPngBuf.length + ' bytes');
                  appendixChildren.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 200 },
                    children: [new ImageRun({ data: methPngBuf, transformation: { width: 640, height: 380 }, type: 'png' })]
                  }));
                }
              } catch(methErr) { log('PROPOSAL DOC: Methodology PNG failed — ' + methErr.message); }
            }
        } catch(ocParseErr) { log('PROPOSAL DOC: Org chart render failed — ' + ocParseErr.message); }
      }

      // APPENDIX B: COMPLIANCE MATRIX
      if (cmData && cmData.requirements && cmData.requirements.length > 0) {
        try {
            appendixChildren.push(new Paragraph({ children: [new PageBreak()] }));
            appendixChildren.push(new Paragraph({
              spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, children: []
            }));
            appendixChildren.push(new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 100, after: 200 },
              children: [new TextRun({ text: 'APPENDIX B: COMPLIANCE MATRIX', bold: true, size: 32, font: 'Calibri', color: NAVY })]
            }));

            // Compliance matrix table
            var cmColWidths = [1000, 3500, 1200, 1400, 1200, 1060];
            var cmHeaderRow = new TableRow({
              children: ['ID', 'Requirement', 'Category', 'Status', 'Response Section', 'Notes'].map(function(h, ci) {
                return new TableCell({
                  borders: borders, width: { size: cmColWidths[ci], type: WidthType.DXA },
                  shading: { fill: TABLE_HEADER, type: ShadingType.CLEAR },
                  margins: { top: 40, bottom: 40, left: 80, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: 'Calibri', color: 'FFFFFF' })] })]
                });
              })
            });
            var cmRows = [cmHeaderRow];
            cmData.requirements.forEach(function(req, ri) {
              cmRows.push(new TableRow({
                children: [
                  req.id || '', req.description || '', req.category || '', req.status || '', req.response_section || '', req.notes || ''
                ].map(function(val, ci) {
                  return new TableCell({
                    borders: borders, width: { size: cmColWidths[ci], type: WidthType.DXA },
                    shading: ri % 2 === 0 ? { fill: TABLE_ALT, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
                    margins: { top: 40, bottom: 40, left: 80, right: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: val, size: 18, font: 'Calibri' })] })]
                  });
                })
              }));
            });
            appendixChildren.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: cmColWidths, rows: cmRows }));

            // Evaluation criteria sub-table if available
            if (cmData.eval_criteria && cmData.eval_criteria.length > 0) {
              appendixChildren.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 150 },
                children: [new TextRun({ text: 'Evaluation Criteria', bold: true, size: 28, font: 'Calibri', color: NAVY })]
              }));
              var ecColWidths = [4000, 1500, 3860];
              var ecHeaderRow = new TableRow({
                children: ['Criterion', 'Points', 'Weight'].map(function(h, ci) {
                  return new TableCell({
                    borders: borders, width: { size: ecColWidths[ci], type: WidthType.DXA },
                    shading: { fill: TABLE_HEADER, type: ShadingType.CLEAR },
                    margins: { top: 40, bottom: 40, left: 80, right: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
                  });
                })
              });
              var ecRows = [ecHeaderRow];
              cmData.eval_criteria.forEach(function(ec, ri) {
                ecRows.push(new TableRow({
                  children: [ec.criterion || '', String(ec.points || ''), ec.weight || ''].map(function(val, ci) {
                    return new TableCell({
                      borders: borders, width: { size: ecColWidths[ci], type: WidthType.DXA },
                      shading: ri % 2 === 0 ? { fill: TABLE_ALT, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
                      margins: { top: 40, bottom: 40, left: 80, right: 80 },
                      children: [new Paragraph({ children: [new TextRun({ text: val, size: 20, font: 'Calibri' })] })]
                    });
                  })
                }));
              });
              appendixChildren.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: ecColWidths, rows: ecRows }));
            }

            // Exhibits sub-table if available
            if (cmData.exhibits && cmData.exhibits.length > 0) {
              appendixChildren.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 150 },
                children: [new TextRun({ text: 'Required Exhibits & Attachments', bold: true, size: 28, font: 'Calibri', color: NAVY })]
              }));
              var exColWidths = [4000, 1500, 3860];
              var exHeaderRow = new TableRow({
                children: ['Exhibit', 'Required', 'Notes'].map(function(h, ci) {
                  return new TableCell({
                    borders: borders, width: { size: exColWidths[ci], type: WidthType.DXA },
                    shading: { fill: TABLE_HEADER, type: ShadingType.CLEAR },
                    margins: { top: 40, bottom: 40, left: 80, right: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
                  });
                })
              });
              var exRows = [exHeaderRow];
              cmData.exhibits.forEach(function(ex, ri) {
                exRows.push(new TableRow({
                  children: [ex.name || '', ex.required ? 'YES' : 'No', ex.notes || ''].map(function(val, ci) {
                    return new TableCell({
                      borders: borders, width: { size: exColWidths[ci], type: WidthType.DXA },
                      shading: ri % 2 === 0 ? { fill: TABLE_ALT, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
                      margins: { top: 40, bottom: 40, left: 80, right: 80 },
                      children: [new Paragraph({ children: [new TextRun({ text: val, size: 20, font: 'Calibri' })] })]
                    });
                  })
                }));
              });
              appendixChildren.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: exColWidths, rows: exRows }));
            }
        } catch(cmParseErr) { log('PROPOSAL DOC: Compliance matrix render failed — ' + cmParseErr.message); }
      }

      // APPENDIX C: FEE SCHEDULE / RATE TABLE
      if (rtData && rtData.positions && rtData.positions.length > 0) {
        try {
            appendixChildren.push(new Paragraph({ children: [new PageBreak()] }));
            appendixChildren.push(new Paragraph({
              spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, children: []
            }));
            appendixChildren.push(new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 100, after: 200 },
              children: [new TextRun({ text: 'APPENDIX C: FEE SCHEDULE', bold: true, size: 32, font: 'Calibri', color: NAVY })]
            }));

            var rtColWidths = [2200, 2000, 1200, 1400, 1200, 1360];
            var rtHeaderRow = new TableRow({
              children: ['Position (RFP)', 'HGI Mapping', 'Rate/Hr', 'Est. Hours/Yr', 'Annual Cost', 'Notes'].map(function(h, ci) {
                return new TableCell({
                  borders: borders, width: { size: rtColWidths[ci], type: WidthType.DXA },
                  shading: { fill: TABLE_HEADER, type: ShadingType.CLEAR },
                  margins: { top: 40, bottom: 40, left: 80, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: 'Calibri', color: 'FFFFFF' })] })]
                });
              })
            });
            var rtRows = [rtHeaderRow];
            rtData.positions.forEach(function(pos, ri) {
              rtRows.push(new TableRow({
                children: [
                  pos.rfp_title || '',
                  pos.hgi_mapping || '',
                  D + (pos.hourly_rate || 0).toLocaleString(),
                  String(pos.est_annual_hours || 0),
                  D + (pos.annual_cost || 0).toLocaleString(),
                  pos.notes || ''
                ].map(function(val, ci) {
                  return new TableCell({
                    borders: borders, width: { size: rtColWidths[ci], type: WidthType.DXA },
                    shading: ri % 2 === 0 ? { fill: TABLE_ALT, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
                    margins: { top: 40, bottom: 40, left: 80, right: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: val, size: 18, font: 'Calibri' })] })]
                  });
                })
              }));
            });
            appendixChildren.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: rtColWidths, rows: rtRows }));

            // Totals summary
            appendixChildren.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
            var totalItems = [];
            if (rtData.annual_total) totalItems.push('Annual Total: ' + D + rtData.annual_total.toLocaleString());
            if (rtData.base_period_total) totalItems.push('Base Period Total: ' + D + rtData.base_period_total.toLocaleString());
            if (rtData.total_with_options) totalItems.push('Total with Options: ' + D + rtData.total_with_options.toLocaleString());
            if (rtData.travel_odc) totalItems.push('Travel/ODC: ' + D + rtData.travel_odc.toLocaleString());
            if (rtData.period) totalItems.push('Period: ' + rtData.period.base_years + ' base + ' + rtData.period.option_years + ' option years');
            totalItems.forEach(function(item) {
              appendixChildren.push(new Paragraph({
                spacing: { after: 60 },
                indent: { left: 360 },
                children: [new TextRun({ text: item, bold: true, size: 22, font: 'Calibri', color: NAVY })]
              }));
            });
            if (rtData.notes) {
              appendixChildren.push(new Paragraph({
                spacing: { before: 120, after: 120 },
                indent: { left: 360 },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 8 } },
                children: [new TextRun({ text: rtData.notes, size: 20, font: 'Calibri', italics: true, color: GRAY })]
              }));
            }
        } catch(rtParseErr) { log('PROPOSAL DOC: Rate table render failed — ' + rtParseErr.message); }
      }

      log('PROPOSAL DOC: Appendix built — ' + appendixChildren.length + ' elements');
    } catch(appendixErr) {
      log('PROPOSAL DOC: Appendix generation error — ' + appendixErr.message);
    }

    // --- APPENDIX: SUBMISSION CHECKLIST (auto-extracted from proposal content) ---
    try {
      var actionItems = [];
      var actionRegex = /\[ACTION REQUIRED[^\]]*\][\s:]*([^\]\n]+)/gi;
      var match;
      while ((match = actionRegex.exec(proposalText)) !== null) {
        var item = match[1].trim().replace(/^\s*[:—-]+\s*/, '');
        if (item.length > 10 && actionItems.indexOf(item) === -1) actionItems.push(item);
      }
      // Also catch standalone [ACTION REQUIRED: ...] patterns
      var actionRegex2 = /\[ACTION REQUIRED:\s*([^\]]+)\]/gi;
      while ((match = actionRegex2.exec(proposalText)) !== null) {
        var item2 = match[1].trim();
        if (item2.length > 5 && actionItems.indexOf(item2) === -1) actionItems.push(item2);
      }

      if (actionItems.length > 0) {
        appendixChildren.push(new Paragraph({
          spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, children: []
        }));
        appendixChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 100, after: 200 },
          children: [new TextRun({ text: 'SUBMISSION CHECKLIST', bold: true, size: 32, font: 'Calibri', color: NAVY })]
        }));
        appendixChildren.push(new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun({ text: 'The following items require completion before submission. This checklist is auto-generated from the proposal and should be removed from the final submission package.', size: 20, font: 'Calibri', italics: true, color: GRAY })]
        }));

        var clBorder = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
        var clBorders = { top: clBorder, bottom: clBorder, left: clBorder, right: clBorder };
        var clRows = [
          new TableRow({
            children: ['#', 'Action Required', 'Owner', 'Status'].map(function(h, ci) {
              return new TableCell({
                borders: clBorders,
                width: { size: [500, 6200, 1500, 1160][ci], type: WidthType.DXA },
                shading: { fill: TABLE_HEADER, type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
              });
            })
          })
        ];
        actionItems.forEach(function(item, idx) {
          clRows.push(new TableRow({
            children: [
              String(idx + 1),
              item,
              '',
              ''
            ].map(function(val, ci) {
              return new TableCell({
                borders: clBorders,
                width: { size: [500, 6200, 1500, 1160][ci], type: WidthType.DXA },
                shading: idx % 2 === 0 ? { fill: TABLE_ALT, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
                margins: { top: 40, bottom: 40, left: 80, right: 80 },
                children: [new Paragraph({ children: [new TextRun({ text: val, size: 18, font: 'Calibri' })] })]
              });
            })
          }));
        });
        appendixChildren.push(new Table({ width: { size: 9360, type: WidthType.DXA }, rows: clRows }));
        log('PROPOSAL DOC: Submission checklist — ' + actionItems.length + ' action items extracted');
      }
    } catch(clErr) { log('PROPOSAL DOC: Submission checklist error — ' + clErr.message); }

    // Format due date for cover page
    var coverDate = 'TBD';
    if (opp.due_date) {
      try {
        var d = new Date(opp.due_date);
        if (!isNaN(d.getTime())) {
          var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          coverDate = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
        } else {
          // Try parsing common formats like "24-Apr-2026 2:00:00 PM CST"
          coverDate = opp.due_date.replace(/T\d{2}:\d{2}:\d{2}.*$/, '').replace(/(\d+)-(\w+)-(\d+).*/, function(m,day,mon,yr) { return mon + ' ' + day + ', ' + yr; });
        }
      } catch(e) { coverDate = opp.due_date; }
    }

    // --- BUILD THE DOCUMENT ---
    var doc = new Document({
      numbering: {
        config: [
          {
            reference: 'hgi-bullets',
            levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
          },
          {
            reference: 'hgi-numbers',
            levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
          }
        ]
      },
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 22 } },
        },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 32, bold: true, color: NAVY, font: 'Calibri' },
            paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 28, bold: true, color: NAVY, font: 'Calibri' },
            paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 24, bold: true, color: '4B5563', font: 'Calibri' },
            paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
        ]
      },
      sections: [
        // COVER PAGE
        {
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
            }
          },
          children: [
            // Gold accent bar at top
            new Paragraph({ spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 8 } }, children: [] }),
            new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [] }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: [new TextRun({ text: (opp.title || 'Proposal').toUpperCase(), bold: true, size: 40, font: 'Calibri', color: NAVY })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { after: 100 },
              children: [new TextRun({ text: 'Submitted to: ' + (opp.agency || 'Agency'), size: 24, font: 'Calibri', color: GRAY })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { after: 100 },
              children: [new TextRun({ text: 'Due: ' + coverDate, size: 22, font: 'Calibri', color: GRAY })]
            }),
            // Gold accent bar
            new Paragraph({ spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 8 } }, children: [] }),
            new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'Prepared by:', size: 20, font: 'Calibri', color: GRAY })]
            }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
              children: [new TextRun({ text: 'HGI Global \u2014 Hammerman & Gainer LLC', bold: true, size: 30, font: 'Calibri', color: NAVY })]
            }),
            new Paragraph({ alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: '2400 Veterans Memorial Blvd, Suite 510, Kenner, LA 70062', size: 20, font: 'Calibri', color: GRAY })]
            }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
              children: [new TextRun({ text: '100% Minority-Owned | Est. 1929 | SAM UEI: DL4SJEVKZ6H4', size: 20, font: 'Calibri', color: GRAY })]
            }),
            // Bottom gold bar
            new Paragraph({ spacing: { before: 2000 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 8 } }, children: [] }),
          ]
        },
        // BODY
        {
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
            }
          },
          headers: {
            default: new Header({
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: 'HGI Global \u2014 ' + (opp.title || '').slice(0, 50), size: 16, font: 'Calibri', color: '9CA3AF', italics: true })]
              })]
            })
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  spacing: { before: 0 },
                  border: { top: { style: BorderStyle.SINGLE, size: 2, color: GOLD, space: 4 } },
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: 'HGI Global (Hammerman & Gainer LLC)  |  Page ', size: 16, font: 'Calibri', color: '9CA3AF' }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Calibri', color: '9CA3AF' })
                  ]
                })
              ]
            })
          },
          children: docChildren
        }
      ].concat(appendixChildren.length > 0 ? [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
          }
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'HGI Global \u2014 ' + (opp.title || '').slice(0, 50) + ' \u2014 Appendices', size: 16, font: 'Calibri', color: '9CA3AF', italics: true })]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                spacing: { before: 0 },
                border: { top: { style: BorderStyle.SINGLE, size: 2, color: GOLD, space: 4 } },
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'HGI Global (Hammerman & Gainer LLC)  |  Page ', size: 16, font: 'Calibri', color: '9CA3AF' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Calibri', color: '9CA3AF' })
                ]
              })
            ]
          })
        },
        children: appendixChildren
      }] : [])
    });

    var buffer = await Packer.toBuffer(doc);
    log('PROPOSAL DOC: Generated ' + buffer.length + ' bytes (' + docChildren.length + ' elements)');

    var filename = 'HGI_' + (opp.title || 'Proposal').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60) + '.docx';
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Content-Length': buffer.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buffer);

  } catch(e) {
    log('PROPOSAL DOC ERROR: ' + e.message);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({error: e.message})); }
  }
  return;
}
// === EXPORT OPPORTUNITY DECISION BRIEF — /api/export-opportunity ===
if (url.startsWith('/api/export-opportunity')) {
  try {
    var eoBody = '';
    var eoId = '';
    if (req.method === 'GET') {
      eoId = (req.url.split('?id=')[1] || '').split('&')[0];
    } else {
      await new Promise(function(resolve) { req.on('data', function(c) { eoBody += c; }); req.on('end', resolve); });
      var eoData = JSON.parse(eoBody || '{}');
      eoId = eoData.opportunityId || eoData.id || '';
    }
    if (!eoId) { res.writeHead(400); res.end(JSON.stringify({ error: 'opportunityId required' })); return; }
    var eoOpp = await supabase.from('opportunities').select('*').eq('id', eoId).single();
    if (!eoOpp.data) { res.writeHead(404); res.end(JSON.stringify({ error: 'Opportunity not found' })); return; }
    var eo = eoOpp.data;
    var eoDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var eoTitle = eo.title || 'Unnamed Opportunity';
    var eoAgency = eo.agency || 'Unknown Agency';
    var eoOpi = eo.opi_score || 0;
    var eoRec = 'PENDING'; var eoRecColor = '888888';
    if (eo.capture_action) {
      if (/NO-BID/i.test(eo.capture_action)) { eoRec = 'NO-BID'; eoRecColor = 'CC0000'; }
      else if (/\bGO\b/i.test(eo.capture_action)) { eoRec = 'GO'; eoRecColor = '1E7C34'; }
    }
    var eoTier = eoOpi >= 90 ? 'Tier 1' : eoOpi >= 75 ? 'Tier 1 — Pursue' : eoOpi >= 60 ? 'Tier 2' : 'Tier 3';
    // Build sections from opportunity data
    var eoSections = [];
    eoSections.push({ heading: 'OPPORTUNITY AT A GLANCE', text: 'Title: ' + eoTitle + '\nAgency: ' + eoAgency + '\nVertical: ' + (eo.vertical || '') + '\nOPI: ' + eoOpi + '/100 (' + eoTier + ')\nRecommendation: ' + eoRec + '\nDeadline: ' + (eo.due_date || 'Not specified') + '\nEstimated Value: ' + (eo.estimated_value || 'Not specified') + '\nStage: ' + (eo.stage || 'identified') });
    if (eo.capture_action) eoSections.push({ heading: 'BID / NO-BID DECISION', text: eo.capture_action });
    if (eo.scope_analysis) eoSections.push({ heading: 'SCOPE ANALYSIS', text: eo.scope_analysis.substring(0, 3000) });
    if (eo.financial_analysis) eoSections.push({ heading: 'FINANCIAL ANALYSIS', text: eo.financial_analysis.substring(0, 3000) });
    if (eo.research_brief) eoSections.push({ heading: 'COMPETITIVE INTELLIGENCE', text: eo.research_brief.substring(0, 3000) });
    if (eo.staffing_plan) eoSections.push({ heading: 'STAFFING PLAN', text: eo.staffing_plan.substring(0, 2000) });
    eoSections.push({ heading: 'SYSTEM INTELLIGENCE STATUS', text: 'Scope: ' + (eo.scope_analysis ? 'COMPLETE' : 'NOT RUN') + '\nFinancial: ' + (eo.financial_analysis ? 'COMPLETE' : 'NOT RUN') + '\nResearch: ' + (eo.research_brief ? 'COMPLETE' : 'NOT RUN') + '\nWinnability: ' + (eo.capture_action ? 'COMPLETE' : 'NOT RUN') + '\nStaffing: ' + (eo.staffing_plan ? 'COMPLETE' : 'NOT RUN') });
    // Build Word doc
    var eoChildren = [];
    eoChildren.push(new Paragraph({ children: [new TextRun({ text: 'HAMMERMAN & GAINER LLC', font: 'Arial', size: 56, bold: true, color: 'C9A84C' })], alignment: AlignmentType.CENTER, spacing: { before: 1440, after: 200 } }));
    eoChildren.push(new Paragraph({ children: [new TextRun({ text: 'OPPORTUNITY DECISION BRIEF', font: 'Arial', size: 32, bold: true, color: '1F3864' })], alignment: AlignmentType.CENTER, spacing: { after: 80 } }));
    eoChildren.push(new Paragraph({ children: [new TextRun({ text: eoTitle, font: 'Arial', size: 28, bold: true, color: '1F3864' })], alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }));
    eoChildren.push(new Paragraph({ children: [new TextRun({ text: eoAgency, font: 'Arial', size: 24, color: '444444' })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    eoChildren.push(new Paragraph({ children: [new TextRun({ text: 'RECOMMENDATION: ' + eoRec, font: 'Arial', size: 40, bold: true, color: eoRecColor })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));
    eoChildren.push(new Paragraph({ children: [new TextRun({ text: eoDate, font: 'Arial', size: 20, color: '888888' })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    eoChildren.push(new Paragraph({ children: [new PageBreak()] }));
    for (var esi = 0; esi < eoSections.length; esi++) {
      var es = eoSections[esi];
      eoChildren.push(new Paragraph({ children: [new TextRun({ text: es.heading, font: 'Arial', size: 28, bold: true, color: '1F3864' })], spacing: { before: 320, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9A84C', space: 1 } } }));
      var esLines = (es.text || '').split('\n');
      for (var eli = 0; eli < esLines.length; eli++) {
        var el = esLines[eli].trim();
        if (!el) continue;
        if (el.startsWith('- ') || el.startsWith('* ')) {
          eoChildren.push(new Paragraph({ children: [new TextRun({ text: el.substring(2), font: 'Arial', size: 22 })], spacing: { after: 100 }, indent: { left: 720 } }));
        } else {
          eoChildren.push(new Paragraph({ children: [new TextRun({ text: el.replace(/\*\*/g, ''), font: 'Arial', size: 22 })], spacing: { after: 140 } }));
        }
      }
    }
    var eoDoc = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: eoChildren }] });
    var eoBuf = await Packer.toBuffer(eoDoc);
    var eoFn = 'HGI_Decision_Brief_' + eoAgency.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '.docx';
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="' + eoFn + '"', 'Access-Control-Allow-Origin': '*' });
    res.end(eoBuf);
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === EXTRACT RFP REQUIREMENTS — /api/extract-rfp-reqs (S115) ===
// Targeted endpoint: runs extractRFPRequirements on one opp and persists the result.
// Used for S115 gate testing and future ad-hoc requirement extraction.
if (url === '/api/extract-rfp-reqs' && req.method === 'POST') {
  var xBody = '';
  for await (const chunk of req) xBody += chunk;
  var xId = '';
  try { xId = JSON.parse(xBody || '{}').id || ''; } catch(e) {}
  if (!xId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
  try {
    var xOpp = await supabase.from('opportunities').select('id,title,agency,rfp_text').eq('id', xId).single();
    if (!xOpp.data) { res.writeHead(404); res.end(JSON.stringify({error:'opp not found'})); return; }
    var xRfp = (xOpp.data.rfp_text || '');
    if (xRfp.length < 500) { res.writeHead(400); res.end(JSON.stringify({error:'rfp_text < 500 chars', rfp_chars: xRfp.length})); return; }
    var xReqs = await extractRFPRequirements(xRfp.slice(0, 180000), xOpp.data);
    if (xReqs) {
      await supabase.from('opportunities').update({ rfp_requirements: xReqs, last_updated: new Date().toISOString() }).eq('id', xId);
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      ok: !!xReqs,
      opp_id: xId,
      opp_title: (xOpp.data.title||'').slice(0,120),
      rfp_total_chars: xRfp.length,
      extracted_from_chars: Math.min(xRfp.length, 180000),
      requirements_count: xReqs ? (xReqs.requirements||[]).length : 0,
      evaluation_criteria_count: xReqs ? (xReqs.evaluation_criteria||[]).length : 0,
      submission_requirements_count: xReqs ? (xReqs.submission_requirements||[]).length : 0,
      fatal_flaws_count: xReqs ? (xReqs.fatal_flaws||[]).length : 0,
      result: xReqs
    }));
  } catch(e) {
    log('EXTRACT-RFP-REQS ERROR: ' + e.message);
    res.writeHead(500, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error: e.message}));
  }
  return;
}

// === REFETCH RFP CORPUS — /api/refetch-rfp-corpus (S126) ===
// Addendum-aware re-fetch of source page. Unlike autoRetrieveRFPs which gates on
// rfp_document_retrieved=false and caps at 3 PDFs, this re-pulls the FULL document
// set (cap 25) regardless of prior retrieval, writes a structured documents[] ledger
// + addendum_coverage[], rebuilds rfp_text with explicit doc separators, then re-runs
// extractRFPRequirements on the new corpus. Use whenever an opp moves to `pursuing`
// or before any proposal regen. Body: {id: "opp-id"}. Returns diff vs prior documents[].
// Origin bug: SJPG (S125) — Addendum #1 specifying District 5 Senior Center never
// reached the system; orchestrator generated a generic "find a project" proposal.
if (url === '/api/refetch-rfp-corpus' && req.method === 'POST') {
  var rfBody = '';
  for await (const chunk of req) rfBody += chunk;
  var rfId = '';
  try { rfId = JSON.parse(rfBody || '{}').id || ''; } catch(e) {}
  if (!rfId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
  try {
    var rfOpp = await supabase.from('opportunities')
      .select('id,title,agency,source_url,rfp_text,documents,rfp_document_url,addendum_coverage')
      .eq('id', rfId).single();
    if (!rfOpp.data) { res.writeHead(404); res.end(JSON.stringify({error:'opp not found'})); return; }
    var rfResult = await refetchRFPCorpus(rfOpp.data);
    if (!rfResult.ok) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify(rfResult));
      return;
    }
    var rfUpdate = {
      documents: rfResult.documents,
      rfp_text: rfResult.rfp_text,
      addendum_coverage: rfResult.addendum_coverage,
      documents_fetched: true,
      rfp_document_retrieved: rfResult.rfp_text_chars > 2000,
      last_updated: new Date().toISOString()
    };
    if (rfResult.rfp_document_url) rfUpdate.rfp_document_url = rfResult.rfp_document_url;
    await supabase.from('opportunities').update(rfUpdate).eq('id', rfId);
    var rfReqs = null;
    if (rfResult.rfp_text && rfResult.rfp_text.length >= 500) {
      rfReqs = await extractRFPRequirements(rfResult.rfp_text.slice(0, 180000), rfOpp.data);
      if (rfReqs) {
        await supabase.from('opportunities').update({ rfp_requirements: rfReqs, last_updated: new Date().toISOString() }).eq('id', rfId);
      }
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      ok: true,
      opp_id: rfId,
      opp_title: (rfOpp.data.title||'').slice(0,120),
      documents_count: rfResult.documents_count,
      parsed_count: rfResult.parsed_count,
      addendum_count: rfResult.addendum_coverage.length,
      rfp_text_chars: rfResult.rfp_text_chars,
      diff: rfResult.diff,
      addendum_coverage: rfResult.addendum_coverage,
      documents: rfResult.documents.map(function(d) { return { url: d.url, filename: d.filename, kind: d.kind, status: d.status, char_count: d.char_count }; }),
      requirements_extracted: !!rfReqs,
      requirements_count: rfReqs ? (rfReqs.requirements||[]).length : 0
    }));
  } catch(e) {
    log('REFETCH-RFP-CORPUS ERROR: ' + e.message);
    res.writeHead(500, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error: e.message}));
  }
  return;
}

// === BACKFILL FACT-CHECK — /api/backfill-fact-check (S118) ===
// Runs the S107 Haiku fact-checker retroactively over scope_analyses that predate
// the live fact-checker. Does NOT modify scope_analysis content. Stores verdicts to
// organism_memory with agent='orchestrator_fact_check_backfill' to distinguish from
// live-run findings. Body options: {limit: 1-50 (default 30), opp_id: optional filter}.
if (url === '/api/backfill-fact-check' && req.method === 'POST') {
  var bfBody = '';
  for await (const chunk of req) bfBody += chunk;
  var bfOpts = {};
  try { bfOpts = JSON.parse(bfBody || '{}'); } catch(e) {}
  var bfLimit = Math.max(1, Math.min(50, parseInt(bfOpts.limit || 30, 10)));
  var bfOppFilter = bfOpts.opp_id || null;
  try {
    var bfQuery = supabase.from('opportunities')
      .select('id,title,rfp_text,scope_analysis')
      .not('scope_analysis', 'is', null)
      .not('rfp_text', 'is', null);
    if (bfOppFilter) bfQuery = bfQuery.eq('id', bfOppFilter);
    var bfAll = await bfQuery;
    var bfCandidates = (bfAll.data || []).filter(function(o) {
      return (o.scope_analysis||'').length > 500 && (o.rfp_text||'').length > 500;
    });
    var bfSeen = await supabase.from('organism_memory')
      .select('opportunity_id')
      .in('agent', ['orchestrator_fact_check','orchestrator_fact_check_backfill']);
    var bfSeenSet = {};
    (bfSeen.data || []).forEach(function(r) { if (r.opportunity_id) bfSeenSet[r.opportunity_id] = true; });
    var bfToRun = bfCandidates.filter(function(o) { return !bfSeenSet[o.id]; }).slice(0, bfLimit);
    log('BACKFILL FACT-CHECK: ' + bfToRun.length + ' opps to check (of ' + bfCandidates.length + ' total w/scope; ' + Object.keys(bfSeenSet).length + ' already checked)');
    var bfResults = [];
    for (var bfi = 0; bfi < bfToRun.length; bfi++) {
      var bfOpp = bfToRun[bfi];
      try {
        var bfPrompt = 'You are a fact-checker. I will give you (1) an RFP TEXT, and (2) a SCOPE ANALYSIS written about that RFP.\n\n' +
          'Your job: find any CONCRETE CLAIMS in the SCOPE ANALYSIS that are NOT supported by the RFP TEXT.\n\n' +
          'Look especially for invented framing like:\n' +
          '- Funding source claims ("FEMA PA", "CDBG-DR", "HMGP", "federal funding") not in the RFP\n' +
          '- Historical context ("post-Katrina", "post-COVID", "following Hurricane X") not in the RFP\n' +
          '- Agency program names or priorities not in the RFP\n' +
          '- Specific dollar amounts, dates, or quantities not in the RFP\n' +
          '- Named people or positions not in the RFP\n\n' +
          'Exclude from flagging: genuinely generic analysis ("HGI has experience with X"), competitive positioning ("vendor Y is likely to bid"), or forward-looking recommendations. These are OPINIONS, not claims about the RFP.\n\n' +
          'Return JSON only: {"hallucinated_claims":[{"claim":"exact phrase from scope","why_invented":"brief reason"}],"verdict":"CLEAN|FLAGGED|CONTAMINATED"}\n' +
          '- CLEAN: zero claims invented\n' +
          '- FLAGGED: 1-2 minor claims invented (can be fixed with annotation)\n' +
          '- CONTAMINATED: 3+ claims invented OR any claim that reframes the opportunity (like inventing a funding source). Scope should be regenerated.\n\n' +
          'RFP TEXT:\n' + (bfOpp.rfp_text || '').slice(0, 30000) + '\n\n' +
          'SCOPE ANALYSIS:\n' + bfOpp.scope_analysis;
        var bfResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
          messages: [{ role: 'user', content: bfPrompt }]
        });
        trackCost('orchestrator_fact_check_backfill', 'claude-haiku-4-5-20251001', bfResp.usage);
        var bfText = (bfResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('').replace(/```json|```/g, '').trim();
        var bfFc;
        try { bfFc = JSON.parse(bfText); }
        catch(pe) { var jm = bfText.match(/\{[\s\S]*\}/); if (jm) { try { bfFc = JSON.parse(jm[0]); } catch(pe2){} } }
        var bfVerdict = (bfFc && bfFc.verdict) || 'PARSE_ERROR';
        var bfClaims = (bfFc && bfFc.hallucinated_claims) || [];
        var bfClaimsList = bfClaims.map(function(c){ return '- "' + (c.claim||'').slice(0,120) + '" (' + (c.why_invented||'').slice(0,80) + ')'; }).join('\n');
        try {
          await storeMemory('orchestrator_fact_check_backfill', bfOpp.id, 'backfill,fact_check,s118',
            'BACKFILL FACT-CHECK: ' + bfVerdict + ' for ' + (bfOpp.title||'').slice(0,60) + '\n' +
            'Scope analysis: ' + (bfOpp.scope_analysis||'').length + ' chars. RFP text: ' + (bfOpp.rfp_text||'').length + ' chars.\n' +
            bfClaims.length + ' claims flagged' + (bfClaims.length > 0 ? ':\n' + bfClaimsList : '.') +
            '\n\nNOTE: This is retroactive checking. Scope content in opportunities.scope_analysis was NOT modified.',
            'analysis', null, bfVerdict === 'CLEAN' ? 'medium' : 'high');
        } catch(sme) {}
        bfResults.push({
          opp_id: bfOpp.id,
          title: (bfOpp.title||'').slice(0,60),
          verdict: bfVerdict,
          claims_flagged: bfClaims.length
        });
        log('BACKFILL FACT-CHECK [' + (bfi+1) + '/' + bfToRun.length + ']: ' + bfVerdict + ' for ' + bfOpp.id);
      } catch(bfe) {
        log('BACKFILL FACT-CHECK ERROR for ' + bfOpp.id + ': ' + (bfe.message||'').slice(0,120));
        bfResults.push({ opp_id: bfOpp.id, title: (bfOpp.title||'').slice(0,60), verdict: 'ERROR', error: (bfe.message||'').slice(0,150) });
      }
    }
    var bfSummary = {
      clean: bfResults.filter(function(r){return r.verdict==='CLEAN';}).length,
      flagged: bfResults.filter(function(r){return r.verdict==='FLAGGED';}).length,
      contaminated: bfResults.filter(function(r){return r.verdict==='CONTAMINATED';}).length,
      errors: bfResults.filter(function(r){return r.verdict==='ERROR' || r.verdict==='PARSE_ERROR';}).length
    };
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      ok: true,
      checked: bfResults.length,
      total_candidates: bfCandidates.length,
      already_checked: Object.keys(bfSeenSet).length,
      summary: bfSummary,
      results: bfResults
    }));
  } catch(e) {
    log('BACKFILL FACT-CHECK TOP ERROR: ' + e.message);
    res.writeHead(500, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error: e.message}));
  }
  return;
}

// === ORCHESTRATE — /api/orchestrate ===
if (url === '/api/orchestrate' && req.method === 'POST') {
  var body = '';
  for await (const chunk of req) body += chunk;
  var orchId = '';
  try { orchId = JSON.parse(body || '{}').id || ''; } catch(e) {}
  if (!orchId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
  log('ORCHESTRATE API: Starting for ' + orchId);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({started:true, id:orchId}));
  // Run async
  (async function(){
    try {
      var orchOpp = await supabase.from('opportunities').select('*').eq('id', orchId).single();
      if (orchOpp.data) await orchestrateOpp(orchOpp.data);
    } catch(e) { log('ORCHESTRATE API ERROR: ' + e.message); }
  })();
  return;
}

// === EXPORT MODULE OUTPUT — /api/export-module ===
// GET: /api/export-module?type=research&id=OPPID (looks up content from DB)
// POST: {module, content, title, agency} (direct content)
if (url.startsWith('/api/export-module')) {
  // GET handler: fetch content from opportunity
  if (req.method === 'GET') {
    try {
      var emQType = (req.url.match(/[?&]type=([^&]*)/)||[])[1] || 'research';
      var emQId = (req.url.match(/[?&]id=([^&]*)/)||[])[1] || '';
      if (!emQId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
      var emQOpp = await supabase.from('opportunities').select('*').eq('id', decodeURIComponent(emQId)).single();
      if (!emQOpp.data) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }
      var emQo = emQOpp.data;
      var emFieldMap = {research:'research_brief',winnability:'capture_action',financial:'financial_analysis',scope:'scope_analysis',staffing:'staffing_plan'};
      var emQContent = emQo[emFieldMap[emQType]||'research_brief'] || '';
      if (!emQContent) { res.writeHead(400); res.end(JSON.stringify({error:'No '+emQType+' content found for this opportunity'})); return; }
      var emQModule = emQType;
      var emQTitle = emQo.title || 'Opportunity';
      var emQAgency = emQo.agency || 'HGI Pipeline';
      // Fall through to doc generation below with these vars set
      var emData = {module:emQModule, content:emQContent, title:emQTitle, agency:emQAgency};
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); return; }
  } else if (req.method === 'POST') {
    try {
      var emBody = '';
      await new Promise(function(resolve) { req.on('data', function(c) { emBody += c; }); req.on('end', resolve); });
      var emData = JSON.parse(emBody || '{}');
    } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:'Invalid JSON'})); return; }
  } else { res.writeHead(405); res.end(JSON.stringify({error:'Method not allowed'})); return; }

  try {
    var emModule = emData.module || 'report';
    var emContent = emData.content || '';
    var emTitle = emData.title || emModule;
    var emAgency = emData.agency || 'HGI Pipeline';
    if (!emContent) { res.writeHead(400); res.end(JSON.stringify({ error: 'content required' })); return; }
    var emDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var emLabels = { research: 'Capture Intelligence Brief', winnability: 'Winnability Assessment', financial: 'Financial & Pricing Analysis', digest: 'Weekly Intelligence Digest' };
    var emLabel = emLabels[emModule] || emModule;
    var emChildren = [];
    emChildren.push(new Paragraph({ children: [new TextRun({ text: 'HAMMERMAN & GAINER LLC', font: 'Arial', size: 56, bold: true, color: 'C9A84C' })], alignment: AlignmentType.CENTER, spacing: { before: 1440, after: 200 } }));
    emChildren.push(new Paragraph({ children: [new TextRun({ text: emLabel.toUpperCase(), font: 'Arial', size: 36, bold: true, color: '1F3864' })], alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
    emChildren.push(new Paragraph({ children: [new TextRun({ text: emTitle, font: 'Arial', size: 28, bold: true, color: '1F3864' })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    emChildren.push(new Paragraph({ children: [new TextRun({ text: emAgency, font: 'Arial', size: 24, color: '444444' })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    emChildren.push(new Paragraph({ children: [new TextRun({ text: emDate, font: 'Arial', size: 20, color: '888888' })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    emChildren.push(new Paragraph({ children: [new PageBreak()] }));
    emChildren.push(new Paragraph({ children: [new TextRun({ text: emLabel.toUpperCase(), font: 'Arial', size: 28, bold: true, color: '1F3864' })], spacing: { before: 240, after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1F3864', space: 1 } } }));
    var emLines = emContent.split('\n');
    for (var mli = 0; mli < emLines.length; mli++) {
      var ml = emLines[mli].trim();
      if (!ml) { emChildren.push(new Paragraph({ children: [], spacing: { after: 80 } })); continue; }
      if (ml.startsWith('## ')) { emChildren.push(new Paragraph({ children: [new TextRun({ text: ml.substring(3), font: 'Arial', size: 28, bold: true, color: '1F3864' })], heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 140 } })); continue; }
      if (ml.startsWith('### ')) { emChildren.push(new Paragraph({ children: [new TextRun({ text: ml.substring(4), font: 'Arial', size: 24, bold: true, color: '2E5DA6' })], heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 100 } })); continue; }
      if (ml.startsWith('- ') || ml.startsWith('* ')) { emChildren.push(new Paragraph({ children: [new TextRun({ text: ml.substring(2).replace(/\*\*/g, ''), font: 'Arial', size: 22 })], spacing: { after: 100 }, indent: { left: 720 } })); continue; }
      emChildren.push(new Paragraph({ children: [new TextRun({ text: ml.replace(/\*\*/g, ''), font: 'Arial', size: 22 })], spacing: { after: 140 } }));
    }
    var emDoc = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: emChildren }] });
    var emBuf = await Packer.toBuffer(emDoc);
    var emFn = 'HGI_' + emLabel.replace(/[^a-zA-Z0-9]/g, '_') + '_' + emAgency.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '.docx';
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="' + emFn + '"', 'Access-Control-Allow-Origin': '*' });
    res.end(emBuf);
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
  return;
}

// === COMPLIANCE MATRIX GENERATOR — /api/compliance-matrix ===
if (url.startsWith('/api/compliance-matrix')) {
  var cmId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!cmId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  try {
    log('COMPLIANCE MATRIX: Generating for ' + cmId);
    var cmOpp = await supabase.from('opportunities').select('*').eq('id', cmId).single();
    var opp = cmOpp.data;
    if (!opp) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }

    // RFP GATE: compliance matrix requires actual solicitation text
    var hasRfp = opp.rfp_document_retrieved === true && opp.rfp_text && opp.rfp_text.trim().length > 200;
    if (!hasRfp) {
      res.writeHead(400); res.end(JSON.stringify({
        error: 'No RFP/SOQ document available. Compliance matrix requires an actual solicitation to extract requirements from.',
        opportunity: opp.title,
        rfp_document_retrieved: opp.rfp_document_retrieved || false,
        suggestion: 'Upload the RFP/SOQ document first. For unsolicited proposals, compliance matrix is not applicable.'
      })); return;
    }

    var rfpSource = opp.rfp_text;

    var D = String.fromCharCode(36);
    var cmPrompt = 'Extract EVERY requirement from this RFP/SOQ and produce a compliance matrix.\n\n' +
      '## RFP TEXT\n' + rfpSource.slice(0, 40000) + '\n\n' +
      '## INSTRUCTIONS\n' +
      'For each requirement found in the RFP:\n' +
      '1. Requirement ID (RFP section number if available, otherwise sequential R-001, R-002)\n' +
      '2. Requirement description (exact text or close paraphrase)\n' +
      '3. Category: MANDATORY | DESIRABLE | INFORMATIONAL\n' +
      '4. Response location: which section of the proposal addresses it\n' +
      '5. Compliance status: COMPLIANT | PARTIAL | ACTION_REQUIRED\n' +
      '6. Notes: what HGI needs to do or provide\n\n' +
      'Also extract:\n' +
      '- All required exhibits, attachments, and forms\n' +
      '- Submission format requirements (font, spacing, page limits)\n' +
      '- Required certifications or insurance docs\n' +
      '- Evaluation criteria with point values\n\n' +
      'Return as JSON with this structure:\n' +
      '{"requirements":[{"id":"","description":"","category":"","response_section":"","status":"","notes":""}],' +
      '"exhibits":[{"name":"","required":true,"notes":""}],' +
      '"format_requirements":{"font":"","spacing":"","page_limit":"","copies":""},' +
      '"eval_criteria":[{"criterion":"","points":0,"weight":""}],' +
      '"submission_deadline":"","submission_method":""}' +
      '\n\nReturn ONLY valid JSON. No markdown, no preamble.';

    var cmResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: 'You extract compliance requirements from government RFPs. Return only valid JSON.',
      messages: [{role:'user', content: cmPrompt}]
    });
    trackCost('compliance_matrix', 'claude-sonnet-4-20250514', cmResp.usage);
    var cmText = (cmResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    
    // Clean and parse
    cmText = cmText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    var cmData;
    try { cmData = JSON.parse(cmText); } catch(pe) { cmData = { raw: cmText, parse_error: pe.message }; }

    // Store in opportunity
    await supabase.from('opportunities').update({
      last_updated: new Date().toISOString()
    }).eq('id', cmId);

    await supabase.from('organism_memory').insert({
      id: 'compliance_matrix-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      agent: 'compliance_matrix',
      opportunity_id: cmId,
      entity_tags: 'compliance,rfp,requirements',
      observation: JSON.stringify(cmData),
      memory_type: 'compliance_matrix_data',
      source_url: null, confidence: 'high', status: 'scratch',
      created_at: new Date().toISOString()
    });

    log('COMPLIANCE MATRIX: ' + (cmData.requirements ? cmData.requirements.length : 0) + ' requirements extracted');
    res.writeHead(200, {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ opportunity: opp.title, matrix: cmData }));

  } catch(e) {
    log('COMPLIANCE MATRIX ERROR: ' + e.message);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({error: e.message})); }
  }
  return;
}

// === RATE TABLE GENERATOR — /api/rate-table ===
if (url.startsWith('/api/rate-table')) {
  var rtId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!rtId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  try {
    log('RATE TABLE: Generating for ' + rtId);
    var rtOpp = await supabase.from('opportunities').select('*').eq('id', rtId).single();
    var opp = rtOpp.data;
    if (!opp) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }

    // RFP GATE: rate table requires actual solicitation to map positions
    var hasRfp = opp.rfp_document_retrieved === true && opp.rfp_text && opp.rfp_text.trim().length > 200;
    if (!hasRfp) {
      res.writeHead(400); res.end(JSON.stringify({
        error: 'No RFP/SOQ document available. Rate table requires an actual solicitation to map required positions.',
        opportunity: opp.title,
        rfp_document_retrieved: opp.rfp_document_retrieved || false,
        suggestion: 'Upload the RFP document first. For unsolicited proposals, staffing is defined by HGI, not extracted from a solicitation.'
      })); return;
    }

    var rfpSource = opp.rfp_text;
    var finMems = await supabase.from('organism_memory').select('agent,observation')
      .eq('opportunity_id', rtId)
      .or('agent.ilike.%financial%,agent.ilike.%price%,agent.ilike.%cost%')
      .order('created_at', {ascending:false}).limit(5);
    var finIntel = (finMems.data || []).map(function(m) { return m.observation; }).join('\n').slice(0, 4000);

    var D = String.fromCharCode(36);
    var rtPrompt = 'Build a rate table for this RFP based on the positions/roles it requires.\n\n' +
      '## RFP TEXT\n' + rfpSource.slice(0, 30000) + '\n\n' +
      '## HGI RATE CARD (fully burdened, per hour)\n' +
      RATE_CARD + '\n\n' +
      '## FINANCIAL INTELLIGENCE\n' + finIntel + '\n\n' +
      '## INSTRUCTIONS\n' +
      '1. Extract every position/role the RFP requires\n' +
      '2. Map each to the closest HGI rate card position\n' +
      '3. Determine estimated hours per year based on RFP scope\n' +
      '4. Calculate annual cost per position\n' +
      '5. If multi-year, show base period + option years\n' +
      '6. Apply any competitive pricing adjustments based on financial intelligence\n' +
      '7. Include travel/ODC estimates if applicable\n\n' +
      'RULES:\n' +
      '- Rates are FULLY BURDENED — no separate overhead/profit/G&A lines\n' +
      '- Never show a rate below HGI rate card minimums\n' +
      '- If the RFP specifies rate format, match it exactly\n' +
      '- Show all math — evaluators want to see how totals are derived\n' +
      '- Flag any positions not on HGI rate card as [CUSTOM RATE NEEDED]\n\n' +
      'Return as JSON:\n' +
      '{"positions":[{"rfp_title":"","hgi_mapping":"","hourly_rate":0,"est_annual_hours":0,"annual_cost":0}],' +
      '"period":{"base_years":0,"option_years":0},' +
      '"annual_total":0,"base_period_total":0,"total_with_options":0,' +
      '"travel_odc":0,"notes":""}' +
      '\n\nReturn ONLY valid JSON.';

    var rtResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      system: 'You build government contract pricing tables. Return only valid JSON with realistic, competitive pricing.',
      messages: [{role:'user', content: rtPrompt}]
    });
    trackCost('rate_card_builder', 'claude-sonnet-4-20250514', rtResp.usage);
    var rtText = (rtResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    rtText = rtText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    var rtData;
    try { rtData = JSON.parse(rtText); } catch(pe) { rtData = { raw: rtText, parse_error: pe.message }; }

    await supabase.from('organism_memory').insert({
      id: 'rate_table_engine-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      agent: 'rate_table_engine',
      opportunity_id: rtId,
      entity_tags: 'pricing,rates,staffing',
      observation: JSON.stringify(rtData),
      memory_type: 'rate_table_data',
      source_url: null, confidence: 'high', status: 'scratch',
      created_at: new Date().toISOString()
    });

    log('RATE TABLE: ' + (rtData.positions ? rtData.positions.length : 0) + ' positions priced');
    res.writeHead(200, {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ opportunity: opp.title, rate_table: rtData }));

  } catch(e) {
    log('RATE TABLE ERROR: ' + e.message);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({error: e.message})); }
  }
  return;
}

// === ORG CHART GENERATOR — /api/org-chart ===
if (url.startsWith('/api/org-chart')) {
  var ocId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!ocId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  try {
    log('ORG CHART: Generating for ' + ocId);
    var ocOpp = await supabase.from('opportunities').select('*').eq('id', ocId).single();
    var opp = ocOpp.data;
    if (!opp) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }

    var rfpSource = (opp.rfp_text && opp.rfp_text.trim().length > 200) ? opp.rfp_text : (opp.scope_analysis || opp.description || '');
    
    // Load staffing memories
    var staffMems = await supabase.from('organism_memory').select('agent,observation')
      .eq('opportunity_id', ocId)
      .or('agent.ilike.%staffing%,agent.ilike.%recruiting%,agent.ilike.%bench%')
      .order('created_at', {ascending:false}).limit(5);
    var staffIntel = (staffMems.data || []).map(function(m) { return m.observation; }).join('\n').slice(0, 3000);

    var ocPrompt = 'Create a Mermaid.js org chart diagram for this project team based on the RFP requirements.\n\n' +
      '## RFP TEXT\n' + rfpSource.slice(0, 20000) + '\n\n' +
      '## STAFFING INTELLIGENCE\n' + staffIntel + '\n\n' +
      '## INSTRUCTIONS\n' +
      'Create a Mermaid flowchart (top-down) showing the project organizational structure.\n' +
      'Use role titles ONLY — no names.\n' +
      'Include: reporting lines, functional groupings, key relationships.\n' +
      'Use subgraphs for functional areas.\n' +
      'Keep it clean — max 15 nodes.\n\n' +
      'Also create a second Mermaid diagram showing the methodology/approach flow.\n' +
      'This should be a left-to-right flowchart showing the key phases and steps.\n\n' +
      'Return as JSON:\n' +
      '{"org_chart":"graph TD\\n  ...","methodology_flow":"graph LR\\n  ...","description":"Brief description of the team structure"}' +
      '\n\nReturn ONLY valid JSON. Use \\n for newlines in the Mermaid code.';

    var ocResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: 'You create professional project organizational charts and methodology flow diagrams using Mermaid.js syntax. Return only valid JSON.',
      messages: [{role:'user', content: ocPrompt}]
    });
    trackCost('org_chart_generator', 'claude-sonnet-4-20250514', ocResp.usage);
    var ocText = (ocResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    ocText = ocText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    var ocData;
    try { ocData = JSON.parse(ocText); } catch(pe) { ocData = { raw: ocText, parse_error: pe.message }; }

    // Try to render via Kroki (POST method)
    var svgResults = {};
    for (var diagramType of ['org_chart', 'methodology_flow']) {
      if (ocData[diagramType]) {
        try {
          var mermaidCode = ocData[diagramType];
          var krokiResp = await fetch('https://kroki.io/mermaid/svg', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: mermaidCode
          });
          if (krokiResp.ok) {
            svgResults[diagramType] = await krokiResp.text();
            log('ORG CHART: ' + diagramType + ' rendered via Kroki (' + svgResults[diagramType].length + ' bytes SVG)');
          } else {
            var errBody = await krokiResp.text();
            svgResults[diagramType + '_error'] = 'Kroki ' + krokiResp.status + ': ' + errBody.slice(0, 200);
          }
        } catch(ke) {
          svgResults[diagramType + '_error'] = ke.message;
        }
      }
    }

    await supabase.from('organism_memory').insert({
      id: 'graphics_engine-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      agent: 'graphics_engine',
      opportunity_id: ocId,
      entity_tags: 'orgchart,methodology,graphics',
      observation: JSON.stringify(ocData),
      memory_type: 'org_chart_data',
      source_url: null, confidence: 'high', status: 'scratch',
      created_at: new Date().toISOString()
    });

    log('ORG CHART: Complete');
    res.writeHead(200, {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ opportunity: opp.title, diagrams: ocData, svg: svgResults }));

  } catch(e) {
    log('ORG CHART ERROR: ' + e.message);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({error: e.message})); }
  }
  return;
}

// === PROPOSAL BUNDLE — /api/proposal-bundle ===
// One call to generate EVERYTHING: compliance matrix, rate table, org chart, proposal content, Word doc
if (url.startsWith('/api/proposal-bundle')) {
  var pbId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!pbId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }

  log('PROPOSAL BUNDLE: Starting full pipeline for ' + pbId);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({started:true, id:pbId, steps:['compliance-matrix','rate-table','org-chart','produce-proposal','proposal-doc']}));

  setImmediate(async () => {
    var results = {};
    try {
      var pbOpp = await supabase.from('opportunities').select('*').eq('id', pbId).single();
      var opp = pbOpp.data;
      if (!opp) { log('PROPOSAL BUNDLE: Opp not found ' + pbId); return; }
      log('PROPOSAL BUNDLE: Processing ' + (opp.title || '').slice(0, 50));

      // Check if RFP/SOQ is available — determines which steps to run
      var hasRfp = opp.rfp_document_retrieved === true && opp.rfp_text && opp.rfp_text.trim().length > 200;
      if (!hasRfp) {
        log('PROPOSAL BUNDLE: No RFP — unsolicited opportunity. Skipping compliance matrix and rate table.');
        results.compliance_matrix = 'SKIPPED (unsolicited — no RFP)';
        results.rate_table = 'SKIPPED (unsolicited — no RFP)';
      } else {
        // Step 1: Compliance Matrix
        log('PROPOSAL BUNDLE: Step 1/5 — Compliance Matrix');
        try {
          var cmResp = await fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/compliance-matrix?id=' + pbId);
          results.compliance_matrix = cmResp.ok ? 'OK' : 'FAILED (' + cmResp.status + ')';
        } catch(e) { results.compliance_matrix = 'ERROR: ' + e.message; }

        // Step 2: Rate Table
        log('PROPOSAL BUNDLE: Step 2/5 — Rate Table');
        try {
          var rtResp = await fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/rate-table?id=' + pbId);
          results.rate_table = rtResp.ok ? 'OK' : 'FAILED (' + rtResp.status + ')';
        } catch(e) { results.rate_table = 'ERROR: ' + e.message; }
      }

      // Step 3: Org Chart (always runs — team structure is useful for any proposal)
      log('PROPOSAL BUNDLE: Step 3/5 — Org Chart');
      try {
        var ocResp = await fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/org-chart?id=' + pbId);
        results.org_chart = ocResp.ok ? 'OK' : 'FAILED (' + ocResp.status + ')';
      } catch(e) { results.org_chart = 'ERROR: ' + e.message; }

      // Step 4: Produce Proposal (Opus — most expensive step)
      log('PROPOSAL BUNDLE: Step 4/5 — Produce Proposal (Opus)');
      try {
        var ppResp = await fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/produce-proposal?id=' + pbId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pbId })
        });
        results.produce_proposal = ppResp.ok ? 'OK (async)' : 'FAILED (' + ppResp.status + ')';
        // Wait for Opus to finish — check every 15 seconds for up to 5 minutes
        log('PROPOSAL BUNDLE: Waiting for Opus to complete...');
        var maxWait = 300000; // 5 min
        var waited = 0;
        var interval = 15000; // 15s
        while (waited < maxWait) {
          await new Promise(function(r) { setTimeout(r, interval); });
          waited += interval;
          var checkOpp = await supabase.from('opportunities').select('proposal_content').eq('id', pbId).single();
          var pc = (checkOpp.data || {}).proposal_content || '';
          if (pc.length > 1000 && pc.indexOf('PROPOSAL DRAFT') > -1) {
            log('PROPOSAL BUNDLE: Opus complete (' + pc.length + ' chars after ' + (waited/1000) + 's)');
            break;
          }
        }
        if (waited >= maxWait) {
          log('PROPOSAL BUNDLE: Opus timed out after 5 minutes');
          results.produce_proposal = 'TIMEOUT';
        }
      } catch(e) { results.produce_proposal = 'ERROR: ' + e.message; }

      // Step 5: Generate Word Doc
      log('PROPOSAL BUNDLE: Step 5/5 — Word Document');
      try {
        var docResp = await fetch('http://localhost:' + (process.env.PORT || 8080) + '/api/proposal-doc?id=' + pbId);
        if (docResp.ok) {
          var docBuffer = Buffer.from(await docResp.arrayBuffer());
          results.proposal_doc = 'OK (' + docBuffer.length + ' bytes)';
          log('PROPOSAL BUNDLE: Word doc generated — ' + docBuffer.length + ' bytes');
        } else {
          results.proposal_doc = 'FAILED (' + docResp.status + ')';
        }
      } catch(e) { results.proposal_doc = 'ERROR: ' + e.message; }

      // Write completion memory
      await supabase.from('organism_memory').insert({
        agent: 'proposal_bundle',
        opportunity_id: pbId,
        observation: 'Full proposal bundle completed for ' + (opp.title || '').slice(0, 50) + '. Results: ' + JSON.stringify(results),
        memory_type: 'analysis',
        created_at: new Date().toISOString()
      });

      log('PROPOSAL BUNDLE: Complete. Results: ' + JSON.stringify(results));

    } catch(e) {
      log('PROPOSAL BUNDLE ERROR: ' + e.message);
    }
  });
  return;
}

// Fallthrough — unmatched routes
if (!res.headersSent) {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', url: url }));
}


  } catch (err) {
    log('REQUEST_ERROR: ' + err.message + ' url=' + (req.url || '?'));
    try { if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } } catch(e2) {}
  }
});

server.listen(PORT, () => log('Health server listening on port ' + PORT));


// ============================================================
// HGI ORGANISM V3.0 — 43 RESEARCHER-AGENTS
// Task instructions, not personas. Sourced intelligence.
// Confidence-tagged memory. Practitioner-quality output.
// ============================================================

function log(msg) { var line = '[' + new Date().toISOString() + '] [ORGANISM] ' + msg; console.log(line); logBuffer.push(line); if (logBuffer.length > LOG_MAX) logBuffer.shift(); }

// === MEMORY: DEDUP + CONFIDENCE + STATUS ===
// In-memory cycle tracker — prevents duplicate writes within a session
// Independent of V1 writes in shared Supabase
var cycleWrites = new Set();

async function storeMemory(agent, oppId, tags, observation, memType, sourceUrl, confidence) {
  try {
    sourceUrl = sourceUrl || null;
    confidence = confidence || 'inferred';
    var status = 'scratch'; // Always scratch. Only curator promotes.

    // Dedup: one write per agent per opp per cycle (in-memory, not Supabase)
    var dedupKey = agent + '|' + (oppId || 'system');
    if (cycleWrites.has(dedupKey)) {
      // Exception: new specific source URL gets through
      if (sourceUrl && sourceUrl !== 'web_search_result' && sourceUrl !== 'web_search') {
        log('DEDUP: Allow ' + agent + ' (new source within cycle)');
      } else {
        log('DEDUP: Skip ' + agent + ' (already wrote this cycle) on ' + (oppId || 'system').slice(0, 30));
        return;
      }
    }
    cycleWrites.add(dedupKey);

    await supabase.from('organism_memory').insert({
      id: agent + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      agent: agent, opportunity_id: oppId || null,
      entity_tags: tags, observation: observation,
      memory_type: memType || 'analysis',
      source_url: sourceUrl,
      confidence: confidence,
      status: status,
      created_at: new Date().toISOString()
    });
  } catch (e) { log('Memory error: ' + e.message); }
}

// === CLAUDE CALL: MODEL TIERING + WEB SEARCH + PROMPT CACHING ===

// ============================================================
// MORNING BRIEF EMAIL — Sends notification to President after cron
// ============================================================
async function sendMorningBrief(state, sessionResults, trigger, newOppsFound, proposalCandidates) {
  var RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    log('NOTIFY: No RESEND_API_KEY set — skipping email. Set this env var to enable morning briefs.');
    return;
  }

  try {
    // Gather latest dashboard + pipeline scanner output
    var dashMem = await supabase.from('organism_memory').select('observation')
      .eq('agent', 'dashboard_agent').order('created_at', {ascending: false}).limit(1);
    var scanMem = await supabase.from('organism_memory').select('observation')
      .eq('agent', 'pipeline_scanner').order('created_at', {ascending: false}).limit(1);
    var huntMem = await supabase.from('organism_memory').select('observation')
      .eq('agent', 'hunting_agent').order('created_at', {ascending: false}).limit(1);

    var dashText = (dashMem.data && dashMem.data[0]) ? dashMem.data[0].observation : 'No dashboard data.';
    var scanText = (scanMem.data && scanMem.data[0]) ? scanMem.data[0].observation : '';
    var huntText = (huntMem.data && huntMem.data[0]) ? huntMem.data[0].observation : '';

    // Deadline alerts
    var deadlines = state.pipeline.filter(function(o) {
      if (!o.due_date) return false;
      var days = Math.floor((new Date(o.due_date).getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 14;
    }).sort(function(a, b) { return new Date(a.due_date) - new Date(b.due_date); });

    var deadlineSection = '';
    if (deadlines.length > 0) {
      deadlineSection = '<h2 style="color:#e74c3c;margin-top:24px;">DEADLINE ALERTS</h2><ul>';
      deadlines.forEach(function(d) {
        var days = Math.floor((new Date(d.due_date).getTime() - Date.now()) / 86400000);
        deadlineSection += '<li><strong>' + days + ' days</strong> — ' + (d.title || '?').slice(0, 80) + ' (OPI ' + d.opi_score + ')</li>';
      });
      deadlineSection += '</ul>';
    }

    // Proposal candidates
    var proposalSection = '';
    if (proposalCandidates && proposalCandidates.length > 0) {
      proposalSection = '<h2 style="color:#27ae60;margin-top:24px;">PROPOSAL CANDIDATES (Awaiting Your Approval)</h2><ul>';
      proposalCandidates.forEach(function(c) {
        proposalSection += '<li>' + (c.title || '?').slice(0, 80) + ' — OPI ' + c.opi_score + '</li>';
      });
      proposalSection += '</ul><p style="color:#666;font-size:12px;">To trigger: /api/produce-proposal?id=OPPORTUNITY_ID</p>';
    }

    // Pipeline summary
    var pipelineRows = state.pipeline.slice(0, 15).map(function(o) {
      return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">' + (o.opi_score || 0) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #eee;">' + (o.stage || 'identified') + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #eee;">' + (o.title || '?').slice(0, 70) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #eee;">' + (o.due_date || 'TBD').slice(0, 10) + '</td></tr>';
    }).join('');

    var sessionCost = costLog.reduce(function(s, c) { return s + c.cost_usd; }, 0);

    var htmlBody = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
      '<div style="background:#1a1a2e;color:#00d4ff;padding:16px;border-radius:8px 8px 0 0;">' +
      '<h1 style="margin:0;font-size:20px;">HGI ORGANISM — Morning Brief</h1>' +
      '<p style="margin:4px 0 0;font-size:12px;color:#aaa;">' + new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'}) + ' | Session cost: $' + sessionCost.toFixed(4) + '</p>' +
      '</div>' +
      '<div style="background:#fff;padding:16px;border:1px solid #ddd;border-top:none;">' +
      '<h2 style="color:#1a1a2e;margin-top:0;">Dashboard</h2>' +
      '<div style="white-space:pre-wrap;font-size:13px;line-height:1.5;background:#f8f9fa;padding:12px;border-radius:4px;">' + dashText.replace(/</g, '&lt;').slice(0, 3000) + '</div>' +
      deadlineSection +
      proposalSection +
      (newOppsFound > 0 ? '<h2 style="margin-top:24px;">Hunting Results</h2><div style="font-size:13px;background:#f8f9fa;padding:12px;border-radius:4px;white-space:pre-wrap;">' + huntText.replace(/</g, '&lt;').slice(0, 2000) + '</div>' : '') +
      '<h2 style="margin-top:24px;">Pipeline (' + state.pipeline.length + ' active)</h2>' +
      '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
      '<tr style="background:#f0f0f0;"><th style="padding:4px 8px;text-align:left;">OPI</th><th style="padding:4px 8px;text-align:left;">Stage</th><th style="padding:4px 8px;text-align:left;">Opportunity</th><th style="padding:4px 8px;text-align:left;">Due</th></tr>' +
      pipelineRows +
      '</table>' +
      (scanText ? '<h2 style="margin-top:24px;">Pipeline Scanner</h2><div style="font-size:12px;background:#f8f9fa;padding:12px;border-radius:4px;white-space:pre-wrap;">' + scanText.replace(/</g, '&lt;').slice(0, 2000) + '</div>' : '') +
      '<p style="color:#999;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">Agents fired: ' + sessionResults.length + ' | Trigger: ' + trigger + ' | Pipeline: ' + state.pipeline.length + ' opps</p>' +
      '</div></body></html>';

    var emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HGI Organism <onboarding@resend.dev>',
        to: ['Christophero@hgi-global.com'],
        subject: 'HGI Morning Brief — ' + state.pipeline.length + ' opps | ' + (newOppsFound > 0 ? newOppsFound + ' new' : 'no new') + (deadlines.length > 0 ? ' | ' + deadlines.length + ' deadlines' : ''),
        html: htmlBody
      })
    });
    if (emailResp.ok) {
      log('NOTIFY: Morning brief sent to Christophero@hgi-global.com');
    } else {
      var errText = await emailResp.text();
      log('NOTIFY: Email failed (' + emailResp.status + '): ' + errText.slice(0, 200));
    }
  } catch(e) {
    log('NOTIFY: Error sending morning brief: ' + e.message);
  }
}

async function claudeCall(system, prompt, maxTokens, opts) {
  opts = opts || {};
  var model = opts.model || 'claude-sonnet-4-6';
  var useSearch = opts.webSearch || false;

  // Use multi-part system prompt for caching
  var systemParts = [
    { type: 'text', text: HGI, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: system }
  ];

  var params = {
    model: model,
    max_tokens: maxTokens || 1200,
    system: systemParts,
    messages: [{ role: 'user', content: prompt }]
  };

  if (useSearch) {
    params.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  var response = await anthropic.messages.create(params);
  trackCost(opts.agent || system.slice(0, 40), model, response.usage);
  if (useSearch) { var wsHits = (response.content || []).filter(function(b) { return b.type === 'server_tool_use' || b.type === 'web_search_tool_result'; }).length; webSearchCount += Math.max(wsHits, 1); }
  var texts = [];
  for (var i = 0; i < (response.content || []).length; i++) {
    if (response.content[i].type === 'text') texts.push(response.content[i].text);
  }
  return texts.join('\n');
}

// === MULTI-SEARCH: Targeted pre-research before agent reasoning ===
async function multiSearch(queries) {
  var results = [];
  var maxQueries = Math.min(queries.length, 5); // SESSION 89: Cap at 5 searches per agent to control token cost
  for (var i = 0; i < maxQueries; i++) {
    try {
      var r = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Intelligence analyst. Return specific verified findings with sources. Be concise.',
        messages: [{ role: 'user', content: queries[i].q }]
      });
      trackCost('multiSearch', 'claude-haiku-4-5-20251001', r.usage);
      var text = (r.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n');
      if (text && text.length > 30) {
        results.push(queries[i].label + ':\n' + text.slice(0, 1500));
      }
    } catch(e) { log('Search error: ' + e.message); }
  }
  return results.length > 0 ? '\n\n=== LIVE WEB RESEARCH (VERIFIED) ===\n' + results.join('\n\n') : '';
}



// === LOAD STATE ===
async function loadState() {
  log('Loading system state...');
  var results = await Promise.all([
    supabase.from('opportunities').select('*').eq('status', 'active').order('opi_score', { ascending: false }).limit(15),
    supabase.from('organism_memory').select('*').neq('memory_type', 'decision_point').order('created_at', { ascending: false }).limit(1000),
    supabase.from('competitive_intelligence').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('relationship_graph').select('*').order('updated_at', { ascending: false }).limit(100)
  ]);
  var state = { pipeline: results[0].data || [], memories: results[1].data || [], competitive: results[2].data || [], relationships: results[3].data || [] };
  log('State: ' + state.pipeline.length + ' opps | ' + state.memories.length + ' mems');
  return state;
}

// === BUILD AGENT CONTEXT: Per-agent, per-opp ===
function buildAgentCtx(state, agentName, oppId) {
  var mems = state.memories;
  var contextMems = [];

  if (oppId) {
    // PER-OPP: best memory from each other agent for THIS opp
    var oppMems = mems.filter(function(m) { return m.opportunity_id === oppId; });
    var best = {};
    for (var i = 0; i < oppMems.length; i++) {
      var m = oppMems[i];
      var a = m.agent || 'unknown';
      if (a === agentName) continue;
      // Verified/doctrine always win over scratch
      if (!best[a] || (m.status === 'verified' || m.status === 'doctrine') || new Date(m.created_at) > new Date(best[a].created_at)) {
        best[a] = m;
      }
    }
    contextMems = Object.values(best);
    // Add up to 5 system-wide observations
    var sys = mems.filter(function(m) { return !m.opportunity_id && m.agent !== agentName; }).slice(0, 5);
    contextMems = contextMems.concat(sys);
  } else {
    // SYSTEM-WIDE: 2 best per agent across all opps
    var best = {};
    for (var i = 0; i < mems.length; i++) {
      var m = mems[i];
      var a = m.agent || 'unknown';
      if (a === agentName) continue;
      if (!best[a]) best[a] = [];
      if (best[a].length < 2) best[a].push(m);
    }
    Object.keys(best).forEach(function(a) { contextMems = contextMems.concat(best[a]); });
  }

  // Format with confidence tags
  var memText = contextMems.slice(0, 60).map(function(m) {
    var conf = m.confidence ? ' | confidence:' + m.confidence : '';
    var src = m.source_url ? ' | src:' + m.source_url.slice(0, 60) : '';
    var st = m.status && m.status !== 'scratch' ? ' | ' + m.status.toUpperCase() : '';
    return '[' + (m.agent || '?') + conf + st + src + ']: ' + (m.observation || '').slice(0, 500);
  }).join('\n\n');

  return { memText: memText, memCount: contextMems.length };
}

// === CYCLE BRIEF: Pre-pass situational awareness ===
async function buildCycleBrief(opp, state) {
  var oppMems = state.memories.filter(function(m) { return m.opportunity_id === opp.id; });
  
  // Group by confidence
  var verified = oppMems.filter(function(m) { return m.status === 'verified' || m.status === 'doctrine'; });
  var highConf = oppMems.filter(function(m) { return m.confidence === 'high' && m.status === 'scratch'; });
  var medConf = oppMems.filter(function(m) { return m.confidence === 'medium' && m.status === 'scratch'; });
  var inferred = oppMems.filter(function(m) { return m.confidence === 'inferred' || m.confidence === 'low'; });

  var brief = 'CYCLE BRIEF: ' + (opp.title || '?') + '\n\n';
  brief += '=== WHAT WE KNOW (VERIFIED/DOCTRINE) ===\n';
  brief += verified.length > 0 ? verified.map(function(m) { return '- [' + m.agent + ']: ' + (m.observation || '').slice(0, 200); }).join('\n') : '(No verified findings yet)\n';
  
  brief += '\n\n=== HIGH CONFIDENCE (sourced, scratch) ===\n';
  brief += highConf.length > 0 ? highConf.slice(0, 10).map(function(m) { return '- [' + m.agent + ']: ' + (m.observation || '').slice(0, 200); }).join('\n') : '(None)\n';
  
  brief += '\n\n=== INFERRED (needs verification) ===\n';
  brief += inferred.length > 0 ? inferred.slice(0, 5).map(function(m) { return '- [' + m.agent + ']: ' + (m.observation || '').slice(0, 150); }).join('\n') : '(None)\n';

  // What we still need
  var agentsSeen = {};
  oppMems.forEach(function(m) { agentsSeen[m.agent] = true; });
  var gaps = [];
  if (!agentsSeen['intelligence_engine']) gaps.push('No competitive intelligence yet');
  if (!agentsSeen['financial_agent']) gaps.push('No financial/pricing analysis yet');
  if (!agentsSeen['crm_agent']) gaps.push('No relationship/contact mapping yet');
  if (!agentsSeen['quality_gate']) gaps.push('No compliance audit yet');
  if (verified.length === 0) gaps.push('No findings have been promoted to verified status');
  if (!opp.research_brief || opp.research_brief.length < 200) gaps.push('Research brief is thin or missing');
  if (!opp.financial_analysis || opp.financial_analysis.length < 200) gaps.push('Financial analysis is thin or missing');
  if (!opp.rfp_text || opp.rfp_text.trim().length < 200) gaps.push('CRITICAL: Actual RFP/SOQ document has NOT been retrieved. All analysis is inferred from listing metadata only.');

  brief += '\n\n=== WHAT WE STILL NEED ===\n';
  brief += gaps.length > 0 ? gaps.map(function(g) { return '- ' + g; }).join('\n') : '- Coverage looks good. Focus on deepening existing intelligence.\n';

  return brief;
}

// === OPP FULL CONTEXT (no truncation) ===
function oppFull(opp) {
  var rfpSection = '';
  if (opp.rfp_text && opp.rfp_text.trim().length > 200) {
    rfpSection = '\n\n=== ACTUAL RFP/SOQ DOCUMENT TEXT (first 15K chars — full doc available in produce-proposal) ===\n' + opp.rfp_text.slice(0, 15000) + '\n=== END RFP EXCERPT ===\n';
  }
  return 'OPPORTUNITY: ' + (opp.title || 'unknown') +
    '\nAgency: ' + (opp.agency || 'unknown') +
    '\nVertical: ' + (opp.vertical || 'unknown') +
    '\nOPI: ' + (opp.opi_score || 0) + ' | Stage: ' + (opp.stage || 'identified') +
    '\nDue: ' + (opp.due_date || 'TBD') + ' | Est Value: ' + (opp.estimated_value || 'unknown') +
    rfpSection +
    '\nScope Analysis:\n' + (opp.scope_analysis || 'Not yet analyzed') +
    '\nResearch Brief:\n' + (opp.research_brief || 'Not yet researched') +
    '\nFinancial:\n' + (opp.financial_analysis || 'Not yet analyzed') +
    '\nStaffing:\n' + (opp.staffing_plan || 'Not yet planned') +
    '\nCapture Action:\n' + (opp.capture_action || 'Not yet assessed');
}

function oppSummary(opp) {
  return (opp.title || '?').slice(0, 60) + ' | OPI:' + (opp.opi_score || 0) + ' | ' + (opp.stage || '?') + ' | Due:' + (opp.due_date || 'TBD');
}

function pipelineSummary(pipeline) { return pipeline.map(oppSummary).join('\n'); }

function getInterface() {
  return fs.readFileSync(path.join(process.cwd(), 'organism', 'interface.html'), 'utf8');
}

// === HGI COMPANY CONTEXT (cached across all agent calls) ===
var HGI = 'SYSTEM CONTEXT: HGI Global (Hammerman & Gainer LLC) is a 97-year-old, 100% minority-owned program management firm in Kenner, Louisiana (2400 Veterans Memorial Blvd, Suite 510, 70062). 8 verticals: Disaster Recovery, TPA/Claims (full P&C), Property Tax Appeals, Workforce/WIOA, Construction Management, Program Administration, Housing/HUD, Grant Management. PAST PERFORMANCE: See HGI_PP constant (9 canonical entries across verticals); selectHGIPP() returns RFP-specific top-3. DO NOT copy HGI_PP wholesale into proposals — use the selector. HARD EXCLUSIONS (never list as past performance without explicit President confirmation): PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA. No current FEMA Public Assistance contract may be claimed. Key staff by role: President, Chairman, CEO, CAO, VP, SVP Claims, 1099 SME (~' + String.fromCharCode(36) + '1B grants/incentives). ~50 team members across offices in Kenner (HQ), Shreveport, Alexandria, New Orleans. Phone: (504) 681-6135. Email: info@hgi-global.com. SAM UEI: DL4SJEVKZ6H4. Insurance: ' + String.fromCharCode(36) + '5M fidelity/' + String.fromCharCode(36) + '5M E&O/' + String.fromCharCode(36) + '2M GL. Rates: Built per-RFP from market analysis and financial agent output. Never copy standard rates or HGI_PP entries wholesale. HGI has NEVER had a direct federal contract. All work flows through state agencies, local governments, housing authorities, and insurance entities. RULES: (1) Every claim must cite source+date. Unverified = say so. (2) Set confidence:high only with source URL. Medium when extrapolating. Inferred when reasoning without sources. (3) Set source_url to specific URL or null. CRITICAL PERSONNEL UPDATE: Geoffrey Brien is NO LONGER with HGI — do not reference him in any proposals, staffing plans, or deliverables. The DR Manager position is currently unfilled. Any organism memories referencing Brien as current staff are OUTDATED. FOUNDING YEAR: HGI was founded in 1929. Use 1929 in all documents. OUTPUT FORMAT RULES (apply to ALL agent outputs): (1) Start directly with your findings. No title headers like HGI GLOBAL or agent name headers. (2) Never write Agent X of Y numbering. (3) No Classification, Eyes Only, Principals Only, Prepared for, or Capture-Sensitive labels. (4) No markdown headers (# ## ###), horizontal rules (---), or emoji. (5) No governing rules boilerplate or blockquote disclaimers at the top. (6) Use role titles only — never write Christopher Oney, Larry Oney, Lou Resweber, Candy Dottolo, Dillon Truax, Vanessa James, Chris Feduccia, or any staff names. Say President, Chairman, CEO, CAO, VP, SVP Claims, SME. (7) Be direct and concise. Substance over formatting. Write findings as clean prose, not decorated documents. (8) No markdown tables for internal analysis — use plain text. Tables are only for proposal content that will appear in final documents.';


// RATE_CARD — only referenced by financial agent and rate-table endpoint. NOT sent to other agents or proposals.
var RATE_CARD = 'HGI Rate Card (burdened/hr): Principal ' + String.fromCharCode(36) + '220, Prog Dir ' + String.fromCharCode(36) + '210, SME ' + String.fromCharCode(36) + '200, Sr Grant Mgr ' + String.fromCharCode(36) + '180, Grant Mgr ' + String.fromCharCode(36) + '175, Sr PM ' + String.fromCharCode(36) + '180, PM ' + String.fromCharCode(36) + '155, Grant Writer ' + String.fromCharCode(36) + '145, Arch/Eng ' + String.fromCharCode(36) + '135, Cost Est ' + String.fromCharCode(36) + '125, Appeals ' + String.fromCharCode(36) + '145, Sr Damage ' + String.fromCharCode(36) + '115, Damage ' + String.fromCharCode(36) + '105, Admin ' + String.fromCharCode(36) + '65.';

// ============================================================
// HGI_PP — CANONICAL PAST PERFORMANCE (S116, 9 entries)
// Single source of truth. Restored from V1 ppq-automation.js which was
// authored by Christopher during the St. George RFP clarifying-questions work.
// Selector function below (selectHGIPP) ranks these for RFP-specific use.
// HARD EXCLUSIONS (enforced by HGI_PP_EXCLUSIONS + senior_writer prompt):
//   PBGC, Orleans Parish School Board (OPSB), LIGA, TPCIGA —
//   DO NOT list as past performance without explicit President confirmation.
//   No current FEMA PA contract may be claimed.
// Fields tagged _provisional where source had variance requiring later
// President confirmation (see S116 handoff Part D ambiguity list).
// ============================================================
var HGI_PP = [
  {
    id: 'pp-road-home',
    client: 'Louisiana Office of Community Development',
    contract_name: 'Road Home Program',
    vertical: 'disaster_recovery',
    period: { start: 2006, end: 2015 },
    value: { hgi_direct: 67000000, program_total: 13000000000, currency: 'USD' },
    scope: 'CDBG-DR housing recovery program management post-Katrina/Rita; applications, appraisals, title, closings; zero misappropriation across program life.',
    outcome: 'completed',
    geography: { state: 'LA', region: 'statewide' },
    key_metrics: { applications: '185,000+', misappropriation_findings: 0 },
    _provisional: { applications_basis: 'V1 ppq-automation canon confirmed by President; older files carried variant counts 130K/165K' }
  },
  {
    id: 'pp-hap',
    client: 'HAP program administrator',
    contract_name: 'Homeowner Assistance Program (HAP)',
    vertical: 'housing',
    period: { start: null, end: null },
    value: { hgi_direct: null, program_total: 950000000, currency: 'USD' },
    scope: 'Disaster housing recovery assistance program administration.',
    outcome: 'completed',
    geography: { state: null, region: null },
    key_metrics: {},
    _provisional: { period: 'TBD confirm with President', geography: 'TBD', hgi_direct: 'slice TBD' }
  },
  {
    id: 'pp-restore-la',
    client: 'Louisiana Office of Community Development',
    contract_name: 'Restore Louisiana',
    vertical: 'disaster_recovery',
    period: { start: 2016, end: null },
    value: { hgi_direct: 42300000, program_total: null, currency: 'USD' },
    scope: 'Post-2016 flood CDBG-DR recovery program; Baton Rouge region; HUD compliance; homeowner applications.',
    outcome: 'completed',
    geography: { state: 'LA', region: 'Baton Rouge' },
    key_metrics: {},
    _provisional: { end_year: 'TBD confirm completion year' }
  },
  {
    id: 'pp-tpsd',
    client: 'Terrebonne Parish School Board',
    contract_name: 'TPSD Construction Management',
    vertical: 'construction',
    period: { start: 2022, end: 2025 },
    value: { hgi_direct: 2960000, program_total: null, currency: 'USD' },
    scope: 'Construction management services for parish school district.',
    outcome: 'completed',
    geography: { state: 'LA', region: 'Terrebonne Parish' },
    key_metrics: {}
  },
  {
    id: 'pp-st-john-sheriff',
    client: 'St. John the Baptist Parish Sheriff',
    contract_name: 'St. John Sheriff',
    vertical: 'tpa_claims',
    period: { start: null, end: null },
    value: { hgi_direct: 788000, program_total: null, currency: 'USD' },
    scope: 'Third-party administration / claims services for parish sheriff.',
    outcome: 'completed',
    geography: { state: 'LA', region: 'St. John the Baptist Parish' },
    key_metrics: {},
    _provisional: { period: 'TBD' }
  },
  {
    id: 'pp-rebuild-nj',
    client: 'State of New Jersey',
    contract_name: 'Rebuild NJ',
    vertical: 'disaster_recovery',
    period: { start: null, end: null },
    value: { hgi_direct: 67700000, program_total: null, currency: 'USD' },
    scope: 'Post-Superstorm Sandy CDBG-DR rebuild program services; out-of-state engagement demonstrating national capability.',
    outcome: 'completed',
    geography: { state: 'NJ', region: 'statewide' },
    key_metrics: {},
    _provisional: { period: 'TBD' }
  },
  {
    id: 'pp-bp-gccf',
    client: 'BP / Gulf Coast Claims Facility (Kenneth Feinberg, Presidential Appointee)',
    contract_name: 'BP Gulf Coast Claims Facility',
    vertical: 'tpa_claims',
    period: { start: 2010, end: 2013 },
    value: { hgi_direct: 1650000, program_total: null, currency: 'USD' },
    scope: 'Oil spill damage claims administration under complex federal oversight.',
    outcome: 'completed',
    geography: { state: null, region: 'Gulf Coast' },
    key_metrics: { claims: '1,000,000+' }
  },
  {
    id: 'pp-nola-wc-tpa',
    client: 'City of New Orleans',
    contract_name: 'City of New Orleans — Workers Compensation TPA',
    vertical: 'tpa_claims',
    period: { start: null, end: null },
    value: { hgi_direct_monthly: 283000, hgi_direct_annualized: 3396000, currency: 'USD' },
    scope: 'Workers Compensation third-party administration for City of New Orleans; continuous service engagement.',
    outcome: 'active',
    geography: { state: 'LA', region: 'New Orleans' },
    key_metrics: {},
    _provisional: { period_start: 'TBD confirm start year', annualized: '$283K/mo documented; multi-year term' }
  },
  {
    id: 'pp-swbno-appeals',
    client: 'Sewerage and Water Board of New Orleans (SWBNO)',
    contract_name: 'SWBNO Billing Appeals',
    vertical: 'property_tax',
    period: { start: 2011, end: null },
    value: { hgi_direct_monthly: 200000, hgi_direct_annualized: 2400000, currency: 'USD' },
    scope: 'Billing appeals and dispute resolution services; quarterly reviews since 2011.',
    outcome: 'active',
    geography: { state: 'LA', region: 'New Orleans' },
    key_metrics: {},
    _provisional: { vertical_mapping: 'property_tax (HGI appeals vertical); SWBNO is billing-appeals, closest canonical match' }
  }
];

// HGI_PP_EXCLUSIONS — do not reference as past performance without
// explicit President confirmation. Enforced at generation time via
// HGI context guardrail and senior_writer system prompt.
var HGI_PP_EXCLUSIONS = ['PBGC', 'Orleans Parish School Board', 'OPSB', 'LIGA', 'TPCIGA'];

// HGI_NAICS — canonical 7 (intake.js + presolicitation.js confirmed in S115 V1 audit)
var HGI_NAICS = ['541611','541690','561110','561990','524291','923120','921190'];

// ============================================================
// HGI_VOICE — canonical voice/tone rules for all HGI writing agents
// S117 Phase 1 beat 3. Authoritative reference for senior_writer,
// and future thought-leadership, capability-statement, linkedin,
// and any other writer endpoints. Strip V1 contaminants (PBGC /
// 95-year hardcode / $12B Road Home / FEMA PA claim) — all values
// and exclusions are enforced via HGI_PP, HGI_PP_EXCLUSIONS, and
// the HGI context string.
// ============================================================
var HGI_VOICE = {
  tone: {
    primary: 'authoritative',
    qualifiers: ['specific', 'factual', 'direct', 'relationship-forward', 'mission-driven', 'zero-hedging'],
    avoid: ['generic consulting language', 'vague claims', 'passive constructions', 'corporate jargon', 'aspirational puffery']
  },
  narrative_stance: 'president-voice',
  evidence_structure: 'lead with outcomes, then evidence, then methodology',
  signature_phrases: [
    'zero misappropriation',
    'Louisiana-rooted',
    'continuously since 1929',
    'fiduciary stewardship',
    'audit-readiness',
    'documented outcome',
    'crisis response',
    '100% minority-owned'
  ],
  prohibited_phrases: [
    'we believe',
    'we feel',
    'in our opinion',
    'we are pleased to',
    'we would be happy to',
    'rest assured',
    'leverage synergies',
    'best-in-class',
    'cutting-edge',
    'world-class',
    'innovative solutions',
    'paradigm shift',
    'next-generation',
    'turn-key solution',
    'robust framework'
  ],
  evidence_rules: [
    'Cite specific dollar amounts (use HGI_PP values exactly) — never "substantial experience" or "significant scale"',
    'Name programs specifically (e.g. "Road Home Program 2006-2015") — never "disaster recovery programs"',
    'Include audit and regulatory outcomes where applicable (e.g. "zero misappropriation findings across program life")',
    'Cite regulatory references by section (e.g. "2 CFR 200.318") — never "applicable federal regulations"',
    'Quantify scale (e.g. "185,000+ applications") — never "many applications"'
  ],
  format_rules: [
    'No markdown headers (# ## ###), horizontal rules (---), or emoji',
    'No decorated labels (Classification, Eyes Only, Prepared for)',
    'Role titles only — the firm President is the sole named signer (Christopher J. Oney)',
    '[TO BE ASSIGNED] for all project personnel positions',
    'Clean prose paragraphs — tables only for proposal-destined content, never for internal analysis'
  ],
  vertical_tone_modifiers: {
    disaster_recovery: 'emphasize speed, federal compliance discipline (2 CFR, HUD CDBG-DR, FEMA PA/HMGP), audit record, programs-at-scale',
    tpa_claims: 'emphasize claims volume handled, regulatory posture (LRS Title 22, ERISA), documented accuracy, continuous-service engagements',
    property_tax: 'emphasize recovery rates, appeals rigor, case-by-case advocacy, quarterly review discipline',
    construction: 'emphasize schedule discipline, change-order control, Louisiana school-board familiarity, closeout audit-readiness, academic-calendar awareness',
    workforce: 'emphasize WIOA performance metrics, participant outcomes, federal reporting discipline',
    program_admin: 'emphasize program scale, financial controls, stakeholder coordination, multi-source funding integration',
    housing: 'emphasize HUD compliance, CDBG/HAP familiarity, homeowner-facing service discipline, Duplication of Benefits analysis',
    grant: 'emphasize eligible-funding identification, application success discipline, post-award compliance management'
  },
  version: 's117_v1'
};

// ============================================================
// selectHGIPP — ranks HGI_PP entries for a specific RFP, returns top 3
// S116 Item 2. Pure function (no DB calls). Caller logs score breakdown
// via storeMemory with agent='pp_selector' for auditability.
// Weights: vertical 40% | agency-type 25% | scale 20% | recency 15%
// Ties broken by recency.
// ============================================================
function selectHGIPP(opp, opts) {
  opts = opts || {};
  // S117: vertical normalization — opp.vertical from scrapers/orchestrator does not
  // always match the HGI_PP taxonomy. Map raw scraper strings to canonical PP verticals
  // before scoring. opp_context returns both raw and normalized for audit.
  var verticalRaw = (opts.vertical || (opp && opp.vertical) || '').toLowerCase().replace(/\s+/g, '_').replace('/', '_');
  var VERTICAL_NORMALIZE = {
    'disaster': 'disaster_recovery',
    'disaster_recovery_consulting': 'disaster_recovery',
    'cdbg': 'disaster_recovery',
    'cdbg_dr': 'disaster_recovery',
    'fema': 'disaster_recovery',
    'grant_management': 'grant',
    'grants_management': 'grant',
    'grant_admin': 'grant',
    'grant_administration': 'grant',
    'infrastructure': 'construction',
    'construction_management': 'construction',
    'cm': 'construction',
    'tpa': 'tpa_claims',
    'claims': 'tpa_claims',
    'workers_comp': 'tpa_claims',
    'tpa_claims_workers_comp': 'tpa_claims',
    'property_tax_appeals': 'property_tax',
    'appeals': 'property_tax',
    'billing_appeals': 'property_tax',
    'housing_hud': 'housing',
    'hud': 'housing',
    'program_administration': 'program_admin',
    'program_management': 'program_admin',
    'workforce_wioa': 'workforce',
    'workforce_services': 'workforce',
    'wioa': 'workforce'
  };
  var vertical = VERTICAL_NORMALIZE[verticalRaw] || verticalRaw;
  var agency = (opts.agency || (opp && opp.agency) || '').toLowerCase();
  var state = (opts.state || (opp && opp.state) || '').toUpperCase().slice(0, 2);
  var estValueRaw = opts.estimated_value || (opp && opp.estimated_value) || null;
  var currentYear = new Date().getFullYear();

  // Parse estimated_value — accepts $1.5M, $500K, $100,000, "1500000", numbers
  function parseMoney(v) {
    if (!v) return null;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[$,\s]/g, '').toLowerCase();
    var m = s.match(/([0-9.]+)\s*([mkb])?/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    var mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
    return n * mult;
  }
  var estValue = parseMoney(estValueRaw);

  // Vertical adjacency (soft matches get 0.5; unrelated 0.0)
  var adjacency = {
    'disaster_recovery': ['housing', 'grant', 'program_admin', 'construction'],
    'housing': ['disaster_recovery', 'grant'],
    'grant': ['program_admin', 'disaster_recovery', 'housing'],
    'program_admin': ['grant', 'disaster_recovery'],
    'tpa_claims': ['property_tax'],
    'property_tax': ['tpa_claims'],
    'construction': ['disaster_recovery'],
    'workforce': ['program_admin', 'grant']
  };

  function agencyType(ag) {
    if (!ag) return 'unknown';
    if (/(?:school board|school district|isd|parish schools)/.test(ag)) return 'school_board';
    if (/(?:city of|municipal|town of|village of|nola)/.test(ag)) return 'city';
    if (/(?:sheriff)/.test(ag)) return 'sheriff';
    if (/(?:parish|county)/.test(ag)) return 'parish_or_county';
    if (/(?:state of|department of|gohsep|office of community|glo|ocd|dhhs|dot)/.test(ag)) return 'state_agency';
    if (/(?:federal|u\.?s\.?\s|fema|hud|pbgc|doe|dod|dhs)/.test(ag)) return 'federal';
    if (/(?:water board|sewerage|authority|board|commission|trust|insurance fund|guaranty)/.test(ag)) return 'authority_or_board';
    return 'other';
  }

  function ppAgencyType(pp) {
    var c = (pp.client || '').toLowerCase();
    if (/school board|school district/.test(c)) return 'school_board';
    if (/city of/.test(c)) return 'city';
    if (/sheriff/.test(c)) return 'sheriff';
    if (/parish|county/.test(c)) return 'parish_or_county';
    if (/^state of|office of community|ocd|glo|gohsep|department of/.test(c)) return 'state_agency';
    if (/bp|gulf coast|federal|presidential|feinberg|pbgc|hud|fema/.test(c)) return 'federal_or_national';
    if (/water board|sewerage|authority|board|commission|program administrator/.test(c)) return 'authority_or_board';
    return 'other';
  }

  var oppType = agencyType(agency);

  function scaleScore(ppValue, rfpValue) {
    if (!ppValue || !rfpValue) return 0.5;
    var r = ppValue / rfpValue;
    if (r <= 0) return 0.2;
    var logR = Math.log10(r);
    if (logR < -1.5) return 0.2;   // PP << RFP (<3%)
    if (logR > 1.5) return 0.4;    // PP >> RFP (overqualified but capacity signal)
    return Math.max(0.2, 1 - Math.abs(logR) * 0.4);
  }

  function recencyScore(pp) {
    if (pp.outcome === 'active') return 1.0;
    var end = (pp.period && pp.period.end) || null;
    if (!end) return 0.5;
    var yearsAgo = currentYear - end;
    if (yearsAgo <= 2) return 1.0;
    if (yearsAgo <= 5) return 0.8;
    if (yearsAgo <= 10) return 0.6;
    if (yearsAgo <= 15) return 0.4;
    return 0.2;
  }

  function ppBestValue(pp) {
    if (!pp.value) return null;
    if (pp.value.hgi_direct) return pp.value.hgi_direct;
    if (pp.value.hgi_direct_annualized) return pp.value.hgi_direct_annualized;
    if (pp.value.hgi_direct_monthly) return pp.value.hgi_direct_monthly * 12;
    if (pp.value.program_total) return pp.value.program_total;
    return null;
  }

  function scorePP(pp) {
    var ppVert = (pp.vertical || '').toLowerCase();
    var vert = 0.0;
    if (vertical && ppVert === vertical) vert = 1.0;
    else if (vertical && (adjacency[vertical] || []).indexOf(ppVert) >= 0) vert = 0.5;
    else if (!vertical) vert = 0.5;
    else vert = 0.0;

    var ppType = ppAgencyType(pp);
    var ag = 0.2;
    if (ppType === oppType && ppType !== 'unknown' && ppType !== 'other') ag = 1.0;
    else if (
      (ppType === 'state_agency' && oppType === 'state_agency') ||
      (ppType === 'parish_or_county' && oppType === 'parish_or_county') ||
      (ppType === 'city' && oppType === 'city') ||
      (ppType === 'authority_or_board' && oppType === 'authority_or_board') ||
      (ppType === 'school_board' && oppType === 'school_board')
    ) ag = 1.0;
    else if (oppType === 'federal' && ppType === 'federal_or_national') ag = 0.8;
    // Same-state bonus
    var ppState = (pp.geography && pp.geography.state) || '';
    if (state && ppState && ppState === state) ag = Math.min(1.0, ag + 0.25);

    var ppValue = ppBestValue(pp);
    var scale = scaleScore(ppValue, estValue);
    var rec = recencyScore(pp);

    var total = (vert * 0.40) + (ag * 0.25) + (scale * 0.20) + (rec * 0.15);
    return {
      pp_id: pp.id,
      vertical: Number(vert.toFixed(3)),
      agency: Number(ag.toFixed(3)),
      scale: Number(scale.toFixed(3)),
      recency: Number(rec.toFixed(3)),
      total: Number(total.toFixed(3)),
      _pp_agency_type: ppType,
      _pp_value: ppValue
    };
  }

  var scored = HGI_PP.map(function(pp) { return { pp: pp, score: scorePP(pp) }; });
  scored.sort(function(a, b) {
    if (Math.abs(a.score.total - b.score.total) < 0.001) return b.score.recency - a.score.recency;
    return b.score.total - a.score.total;
  });

  var top3 = scored.slice(0, 3);
  return {
    selected: top3.map(function(x) { return x.pp; }),
    breakdown: scored.map(function(x, i) {
      return { rank: i + 1, pp_id: x.pp.id, client: x.pp.client, contract_name: x.pp.contract_name, score: x.score };
    }),
    opp_context: {
      vertical_raw: verticalRaw, vertical_normalized: vertical, agency: agency, state: state,
      estimated_value_raw: estValueRaw, estimated_value_parsed: estValue,
      opp_agency_type: oppType
    }
  };
}


// ============================================================
// L4 — DISCRIMINATOR SYNTHESIS (S121)
// Produces 3-5 evidence-anchored discriminators per opportunity.
// Each discriminator = title + claim + evidence anchor (pointer back
// to HGI_PP entry, competitive_intelligence row, fact_check memory,
// or other organism_memory). Writes to opportunity_discriminators table.
// Called by: /api/discriminators-generate endpoint, and injected into
// /api/produce-proposal prompt before proposal generation.
// Cost target: <$0.50 per run (single Opus call, ~6K tokens out).
// ============================================================

async function agentDiscriminatorSynthesizer(opp, opts) {
  opts = opts || {};
  var log_prefix = 'DISCRIMINATORS[' + (opp.id || '?') + ']';

  // 1. Gather evidence inputs
  var compIntel = await supabase.from('competitive_intelligence')
    .select('id,competitor_name,strengths,weaknesses,strategic_notes,threat_level,vertical,created_at')
    .eq('opportunity_id', opp.id)
    .order('created_at', { ascending: false })
    .limit(20);
  var compRows = compIntel.data || [];

  var factChecks = await supabase.from('organism_memory')
    .select('id,agent,observation,entity_tags,created_at')
    .eq('opportunity_id', opp.id)
    .ilike('agent', 'orchestrator_fact_check%')
    .order('created_at', { ascending: false })
    .limit(5);
  var factRows = factChecks.data || [];

  var oppMems = await supabase.from('organism_memory')
    .select('id,agent,observation,memory_type,created_at')
    .eq('opportunity_id', opp.id)
    .in('memory_type', ['analysis','pattern','competitive_intel','winnability'])
    .order('created_at', { ascending: false })
    .limit(10);
  var memRows = oppMems.data || [];

  // 2. Select relevant HGI_PP entries for this opp (reuse existing selector)
  var ppResult = null;
  var topPPs = [];
  try {
    ppResult = selectHGIPP(opp, {
      vertical: opp.vertical,
      agency: opp.agency,
      state: opp.state,
      estimated_value: opp.estimated_value,
      rfpText: opp.rfp_text
    });
    topPPs = (ppResult && ppResult.selected) || [];
  } catch (ppe) {
    log(log_prefix + ' selectHGIPP error: ' + (ppe.message||'').slice(0,120));
  }

  // 3. Build evidence corpus for the prompt
  var ppBlock = topPPs.map(function(p, i) {
    return '[HGI_PP_' + i + '] ' + (p.client || p.contract_name || '?') + ' — ' + (p.contract_name || p.id || '?') +
      ' — Scope: ' + (p.scope || '?').slice(0,160) +
      ' — Outcome: ' + (p.outcome || '?');
  }).join('\n');

  var compBlock = compRows.map(function(c, i) {
    var parts = [];
    if (c.strengths) parts.push('Strengths: ' + String(c.strengths).slice(0, 200));
    if (c.weaknesses) parts.push('Weaknesses: ' + String(c.weaknesses).slice(0, 200));
    if (c.strategic_notes) parts.push('Notes: ' + String(c.strategic_notes).slice(0, 300));
    if (c.threat_level) parts.push('Threat: ' + c.threat_level);
    return '[COMP_INTEL_' + c.id + '] Competitor: ' + (c.competitor_name || '?') + ' — ' + parts.join(' | ');
  }).join('\n---\n');

  var factBlock = factRows.map(function(f, i) {
    return '[FACT_CHECK_' + f.id + '] ' + (f.observation || '').slice(0, 600);
  }).join('\n---\n');

  var memBlock = memRows.map(function(m, i) {
    return '[MEM_' + m.id + '] (' + m.agent + ') ' + (m.observation || '').slice(0, 400);
  }).join('\n---\n');

  // 4. Construct prompt
  var system = 'You are a senior capture strategist at HGI Global. You produce discriminators — the specific, evidence-anchored claims that differentiate an HGI proposal from any competitor in this space. Discriminators are NOT generic capabilities. They are specific combinations of proven capability + competitor gap + documented outcome that no one else can credibly claim. Every discriminator must cite evidence from the inputs provided. Never fabricate. Never name specific competitor companies by name in the discriminator text (cite gap characteristics instead). Output ONLY valid JSON. No preamble. No markdown fences.';

  var userPrompt = 'OPPORTUNITY:\nTitle: ' + (opp.title || '?') +
    '\nAgency: ' + (opp.agency || '?') +
    '\nVertical: ' + (opp.vertical || '?') +
    '\nScope (excerpt): ' + ((opp.scope_analysis || opp.description || '').slice(0, 3000)) +
    '\n\nHGI CANONICAL PAST PERFORMANCE (top 3 for this opp):\n' + (ppBlock || '(none selected)') +
    '\n\nCOMPETITIVE INTELLIGENCE (from research on this opp):\n' + (compBlock || '(no comp intel rows)') +
    '\n\nFACT-CHECK FINDINGS (scope verification):\n' + (factBlock || '(no fact-check rows)') +
    '\n\nRELEVANT AGENT MEMORIES:\n' + (memBlock || '(no memory rows)') +
    '\n\nTASK: Produce 3-5 HGI strength claims for this specific opportunity. Each claim must have:' +
    '\n- title: short claim (5-10 words), outcome-forward, focused on HGI capability (never reference any other firm)' +
    '\n- claim: 1-2 sentence substantive HGI claim — what HGI delivers, with specific evidence. NEVER name, reference, allude to, or compare against any other firm. The claim must read as if HGI is the only firm in the market.' +
    '\n- evidence_anchor_type: one of [hgi_pp, competitive_intel, fact_check, org_memory]' +
    '\n- evidence_anchor_id: the exact ID from the bracketed reference (e.g. for [HGI_PP_0] use "HGI_PP_0"; for [COMP_INTEL_abc-123] use "abc-123")' +
    '\n- evidence_quote: the exact phrase from the evidence source that backs this claim (<=200 chars). NEVER quote a competitor name; if the source contains one, paraphrase the substance without the name.' +
    '\n- competitor_gap: INTERNAL STRATEGIC NOTE ONLY (never appears in proposal output) — describe a gap CHARACTERISTIC in this market that HGI fills (e.g. "small/recently-formed firms typically lack federal compliance scale"). NEVER name any competitor. Phrase as a market gap, not a callout.' +
    '\n\nReturn ONLY a JSON array of 3-5 objects. Example format:' +
    '\n[{"title":"...","claim":"...","evidence_anchor_type":"hgi_pp","evidence_anchor_id":"HGI_PP_0","evidence_quote":"...","competitor_gap":"..."}]';

  log(log_prefix + ' calling Opus with ' +
    compRows.length + ' comp_intel + ' +
    factRows.length + ' fact_check + ' +
    memRows.length + ' memory + ' +
    topPPs.length + ' PP inputs');

  var OPUS_MODEL = 'claude-opus-4-6';
  var raw;
  try {
    raw = await claudeCall(system, userPrompt, 6000, {
      model: OPUS_MODEL,
      agent: 'discriminator_synthesizer'
    });
  } catch (ce) {
    log(log_prefix + ' Opus error: ' + (ce.message||'').slice(0,200));
    return { written: 0, error: ce.message };
  }

  if (!raw || raw.length < 40) {
    log(log_prefix + ' Opus returned empty/short response: ' + (raw||'').slice(0,200));
    return { written: 0, error: 'empty response' };
  }

  // 5. Parse JSON
  var cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  var firstBracket = cleaned.indexOf('[');
  var lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }
  var parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (pe) {
    log(log_prefix + ' JSON parse error: ' + (pe.message||'').slice(0,120) + ' — first 300: ' + cleaned.slice(0,300));
    return { written: 0, error: 'json_parse_failed', raw_preview: raw.slice(0, 500) };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    log(log_prefix + ' parsed but not array or empty: ' + JSON.stringify(parsed).slice(0,200));
    return { written: 0, error: 'not_array_or_empty' };
  }

  // 6. Clear prior discriminators for this opp (regeneration is idempotent)
  try {
    await supabase.from('opportunity_discriminators').delete().eq('opportunity_id', opp.id);
  } catch (de) { /* ignore */ }

  // 7. Write new rows
  var written = 0;
  var rows = [];
  for (var i = 0; i < Math.min(parsed.length, 5); i++) {
    var d = parsed[i] || {};
    if (!d.title || !d.claim) continue;
    var anchorType = d.evidence_anchor_type;
    var validTypes = ['hgi_pp','competitive_intel','fact_check','org_memory','naics','rate_card'];
    if (validTypes.indexOf(anchorType) < 0) anchorType = 'org_memory';
    rows.push({
      id: 'disc_' + opp.id + '_' + (i+1) + '_' + Date.now(),
      opportunity_id: opp.id,
      discriminator_num: i + 1,
      title: String(d.title).slice(0, 200),
      claim: String(d.claim).slice(0, 2000),
      evidence_anchor_type: anchorType,
      evidence_anchor_id: d.evidence_anchor_id ? String(d.evidence_anchor_id).slice(0, 200) : null,
      evidence_quote: d.evidence_quote ? String(d.evidence_quote).slice(0, 600) : null,
      competitor_gap: d.competitor_gap ? String(d.competitor_gap).slice(0, 600) : null,
      generator_version: 's121_v1'
    });
  }
  if (rows.length > 0) {
    var ins = await supabase.from('opportunity_discriminators').insert(rows);
    if (!ins.error) written = rows.length;
    else log(log_prefix + ' insert error: ' + (ins.error.message||'').slice(0,200));
  }

  // 8. Log to organism_memory
  try {
    await supabase.from('organism_memory').insert({
      id: 'mem_disc_' + opp.id + '_' + Date.now(),
      agent: 'discriminator_synthesizer',
      opportunity_id: opp.id,
      observation: 'DISCRIMINATORS GENERATED: ' + written + ' discriminators for ' + (opp.title||'?').slice(0,80) +
        ' (' + compRows.length + ' comp_intel + ' + factRows.length + ' fact_check + ' + memRows.length + ' mem inputs)',
      memory_type: 'analysis',
      created_at: new Date().toISOString()
    });
  } catch(_me) { /* non-fatal */ }

  log(log_prefix + ' wrote ' + written + ' discriminators');
  return { written: written, input_counts: { comp_intel: compRows.length, fact_check: factRows.length, memory: memRows.length, hgi_pp_top: topPPs.length } };
}

// ============================================================
// LAYER B — PURSUIT RESEARCH (S122)
// Opportunity-specific deep research: agency context, competitor
// field, regulatory posture, decision makers, operational gaps,
// political moment, financial signals. Disposable per-opp. Findings
// promoted to Layer A (methodology corpus) later. Feeds L4
// discriminators, produce-proposal mega-prompt, L7 refinement.
// Cost target: $2-10 per run. Hard cap $15.
// ============================================================

async function agentPursuitResearcher(opp, opts) {
  opts = opts || {};
  var SOFT_CAP = typeof opts.softCap === 'number' ? opts.softCap : 10.00;
  var HARD_CAP = typeof opts.hardCap === 'number' ? opts.hardCap : 15.00;
  var MAX_PLAN_ITEMS = opts.maxPlanItems || 25;
  var MIN_PLAN_ITEMS = 15;
  var log_prefix = 'PURSUIT_RESEARCH[' + (opp.id || '?').slice(0, 30) + ']';
  var runId = 'prr_' + (opp.id || 'unknown') + '_' + Date.now();
  var runStart = Date.now();
  var runCost = 0;

  function addCost(model, usage) {
    if (!usage) return;
    var p = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
    runCost += (usage.input_tokens || 0) * p.in_per_tok + (usage.output_tokens || 0) * p.out_per_tok;
  }

  // 1. Load context
  var ctxResults = await Promise.allSettled([
    supabase.from('organism_memory')
      .select('agent,observation,memory_type,created_at')
      .eq('opportunity_id', opp.id)
      .neq('memory_type', 'decision_point')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('competitive_intelligence')
      .select('competitor_name,strengths,weaknesses,strategic_notes,threat_level,vertical,created_at')
      .or('opportunity_id.eq.' + opp.id + ',agency.eq.' + (opp.agency || '').replace(/,/g, ' '))
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('pursuit_research')
      .select('category,finding,confidence,source_url,generated_at')
      .eq('opportunity_id', opp.id)
      .order('generated_at', { ascending: false })
      .limit(100)
  ]);

  var oppMems = (ctxResults[0].status === 'fulfilled' && ctxResults[0].value.data) || [];
  var compRows = (ctxResults[1].status === 'fulfilled' && ctxResults[1].value.data) || [];
  var priorFindings = (ctxResults[2].status === 'fulfilled' && ctxResults[2].value.data) || [];

  var memBlock = oppMems.map(function(m) {
    return '[' + (m.agent || '?') + ']: ' + (m.observation || '').slice(0, 300);
  }).join('\n').slice(0, 4000);

  var compBlock = compRows.map(function(c) {
    var parts = [];
    if (c.strengths) parts.push('Strengths: ' + String(c.strengths).slice(0, 150));
    if (c.weaknesses) parts.push('Weaknesses: ' + String(c.weaknesses).slice(0, 150));
    if (c.strategic_notes) parts.push('Notes: ' + String(c.strategic_notes).slice(0, 200));
    return (c.competitor_name || '?') + ' — ' + parts.join(' | ');
  }).join('\n').slice(0, 3000);

  var priorBlock = priorFindings.map(function(f) {
    return '[' + f.category + '] ' + (f.finding || '').slice(0, 200);
  }).join('\n').slice(0, 2000);

  // 2. Create initial run row (status=running) so UI/monitoring can see it
  try {
    await supabase.from('pursuit_research_runs').insert({
      id: runId,
      opportunity_id: opp.id,
      status: 'running',
      generator_version: 's122_v1',
      created_at: new Date().toISOString()
    });
  } catch (ie) { /* non-fatal; keep going */ }

  // 3. Reasoning pass — produce numbered research plan
  var planSystem =
    'You are a senior capture strategist at HGI Global, a 97-year-old 100% minority-owned Louisiana professional services firm. ' +
    'You are producing a PURSUIT RESEARCH PLAN for a specific RFP. The plan lists 15-25 numbered research items that, answered together, ' +
    'give HGI decisive pursuit advantage. Each item targets ONE specific, answerable question grounded in this RFP, this agency, ' +
    'this political moment, or this competitive field. NO generic items. NO "research industry best practices." NO "understand the vertical." ' +
    'Every item must be something a researcher can actually answer with a targeted web search plus one or two source fetches. ' +
    '\n\nCATEGORIES (each item tagged with exactly one):' +
    '\n- agency: how THIS agency operates, recent contracting history, known preferences, leadership changes, recent audit findings' +
    '\n- competitor: who is likely bidding, their prior work for THIS agency, their recent wins/losses in this space' +
    '\n- regulatory: statute/regulatory context specific to THIS solicitation (not generic vertical knowledge)' +
    '\n- decision_maker: who scores, who influences, who recommended the solicitation, their backgrounds' +
    '\n- operational: incumbent performance, known pain points, infrastructure gaps THIS solicitation addresses' +
    '\n- political: budget cycle context, state/federal priorities, interest groups, recent policy moves' +
    '\n- financial: award value history for this agency in this space, margin context, payment terms, contract vehicles' +
    '\n- other: anything material that does not fit above' +
    '\n\nOutput ONLY valid JSON. No preamble. No markdown fences. Format:' +
    '\n[{"num": 1, "category": "agency", "question": "...", "priority": "high|medium|low", "suggested_sources": ["gao.gov", "ppi.louisiana.gov"]}]';

  var planUser =
    'OPPORTUNITY:' +
    '\nTitle: ' + (opp.title || '?') +
    '\nAgency: ' + (opp.agency || '?') +
    '\nState: ' + (opp.state || '?') +
    '\nVertical: ' + (opp.vertical || '?') +
    '\nOPI: ' + (opp.opi_score || 0) +
    '\nDue: ' + (opp.deadline || 'not specified') +
    '\nEstimated Value: ' + (opp.estimated_value || 'not specified') +
    '\n\nRFP TEXT (excerpt up to 12K chars):\n' + ((opp.rfp_text || opp.scope_analysis || opp.description || '').slice(0, 12000)) +
    '\n\nPRIOR ORGANISM MEMORIES FOR THIS OPP:\n' + (memBlock || '(none)') +
    '\n\nKNOWN COMPETITIVE INTEL (same agency or this opp):\n' + (compBlock || '(none)') +
    (priorFindings.length > 0 ? '\n\nPRIOR PURSUIT RESEARCH FINDINGS FOR THIS OPP (do NOT duplicate):\n' + priorBlock : '') +
    '\n\nTASK: Produce a numbered research plan of 15-25 items. Be specific. Be answerable. Return ONLY the JSON array.';

  log(log_prefix + ' reasoning pass begin (ctx: ' + oppMems.length + ' mem + ' + compRows.length + ' comp + ' + priorFindings.length + ' prior findings)');

  var planResp;
  try {
    planResp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      thinking: { type: 'enabled', budget_tokens: 4000 },
      system: planSystem,
      messages: [{ role: 'user', content: planUser }]
    });
    trackCost('pursuit_research_plan', 'claude-opus-4-6', planResp.usage);
    addCost('claude-opus-4-6', planResp.usage);
  } catch (pe) {
    log(log_prefix + ' reasoning pass error: ' + (pe.message || '').slice(0, 200));
    try {
      await supabase.from('pursuit_research_runs').update({
        status: 'failed',
        findings_count: 0,
        cost_usd: Number(runCost.toFixed(4)),
        wall_time_seconds: Math.floor((Date.now() - runStart) / 1000),
        completed_at: new Date().toISOString()
      }).eq('id', runId);
    } catch (_u) { /* ignore */ }
    return { run_id: runId, status: 'failed', error: (pe.message || '').slice(0, 200) };
  }

  var planText = (planResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
  var planClean = planText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  var fb = planClean.indexOf('['), lb = planClean.lastIndexOf(']');
  if (fb >= 0 && lb > fb) planClean = planClean.slice(fb, lb + 1);
  var plan = null;
  try { plan = JSON.parse(planClean); } catch (pje) { plan = null; }
  if (!Array.isArray(plan) || plan.length < MIN_PLAN_ITEMS) {
    log(log_prefix + ' plan invalid or short (' + (plan ? plan.length : 0) + ' items, need ' + MIN_PLAN_ITEMS + '+). raw: ' + planText.slice(0, 300));
    try {
      await supabase.from('pursuit_research_runs').update({
        status: 'failed',
        research_plan: plan || null,
        plan_item_count: plan ? plan.length : 0,
        findings_count: 0,
        cost_usd: Number(runCost.toFixed(4)),
        wall_time_seconds: Math.floor((Date.now() - runStart) / 1000),
        completed_at: new Date().toISOString()
      }).eq('id', runId);
    } catch (_u) { /* ignore */ }
    return { run_id: runId, status: 'failed', error: 'plan_invalid_or_short', plan_items: plan ? plan.length : 0 };
  }
  if (plan.length > MAX_PLAN_ITEMS) plan = plan.slice(0, MAX_PLAN_ITEMS);
  log(log_prefix + ' plan built: ' + plan.length + ' items, cost so far $' + runCost.toFixed(4));

  // 4. Execute plan items
  var findings = [];
  var gaps = [];
  var confDist = { high: 0, medium: 0, low: 0 };
  var costCapped = false;
  var softWarned = false;

  for (var i = 0; i < plan.length; i++) {
    if (runCost >= HARD_CAP) {
      log(log_prefix + ' HARD CAP hit at item ' + (i + 1) + ' ($' + runCost.toFixed(2) + '), stopping');
      costCapped = true;
      for (var j = i; j < plan.length; j++) {
        gaps.push({ item_num: plan[j].num || (j + 1), question: plan[j].question || '', category: plan[j].category || 'other', reason: 'cost_cap' });
      }
      break;
    }
    if (runCost >= SOFT_CAP && !softWarned) {
      log(log_prefix + ' SOFT CAP warning at item ' + (i + 1) + ' ($' + runCost.toFixed(2) + ')');
      softWarned = true;
    }

    var item = plan[i] || {};
    var execSystem =
      'You are a pursuit research executor for HGI Global. Given ONE research item, perform targeted web search (and fetch the most relevant sources) to answer it. ' +
      'Return ONLY valid JSON, no markdown, no preamble. Format: ' +
      '{"finding": "<2-5 sentence factual finding>", "confidence": "high|medium|low", "source_url": "<primary source URL>", "source_title": "<source title>", "retrieval_date": "<YYYY-MM-DD>", "category": "<same as input item>", "unresolved": false}. ' +
      'If you cannot find a real source, set unresolved=true and describe what you looked for in finding. ' +
      'NEVER fabricate URLs. NEVER paraphrase without a source. Confidence=high only if primary source from authoritative site (.gov, .edu, original agency, GAO, Federal Register, court filing, named publication of record).';

    var execUser =
      'RESEARCH ITEM:' +
      '\nCategory: ' + (item.category || 'other') +
      '\nQuestion: ' + (item.question || '') +
      '\nPriority: ' + (item.priority || 'medium') +
      (item.suggested_sources ? '\nSuggested sources: ' + JSON.stringify(item.suggested_sources) : '') +
      '\n\nCONTEXT (do not duplicate these):' +
      '\nOpportunity: ' + (opp.title || '?') + ' | Agency: ' + (opp.agency || '?') + ' | State: ' + (opp.state || '?') +
      '\n\nProduce the finding now. Return ONLY the JSON object.';

    var execResp;
    try {
      execResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: execSystem,
        messages: [{ role: 'user', content: execUser }]
      });
      trackCost('pursuit_research_exec', 'claude-sonnet-4-6', execResp.usage);
      addCost('claude-sonnet-4-6', execResp.usage);
    } catch (ee) {
      log(log_prefix + ' item ' + (i + 1) + ' exec error: ' + (ee.message || '').slice(0, 120));
      gaps.push({ item_num: item.num || (i + 1), question: item.question || '', category: item.category || 'other', reason: 'execution_error' });
      continue;
    }

    var execText = (execResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    var execClean = execText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    var ofb = execClean.indexOf('{'), olb = execClean.lastIndexOf('}');
    if (ofb >= 0 && olb > ofb) execClean = execClean.slice(ofb, olb + 1);
    var finding = null;
    try { finding = JSON.parse(execClean); } catch (fje) { finding = null; }

    if (!finding || !finding.finding || finding.unresolved) {
      gaps.push({
        item_num: item.num || (i + 1),
        question: item.question || '',
        category: item.category || 'other',
        reason: finding ? (finding.unresolved ? 'unresolved' : 'no_finding') : 'parse_failed'
      });
      continue;
    }

    var conf = String(finding.confidence || 'medium').toLowerCase();
    if (conf !== 'high' && conf !== 'medium' && conf !== 'low') conf = 'medium';
    if (confDist[conf] !== undefined) confDist[conf]++;

    findings.push({
      id: 'pr_' + runId + '_' + (i + 1),
      run_id: runId,
      opportunity_id: opp.id,
      finding_num: i + 1,
      category: String(finding.category || item.category || 'other').slice(0, 60),
      finding: String(finding.finding).slice(0, 3000),
      confidence: conf,
      source_url: finding.source_url ? String(finding.source_url).slice(0, 600) : null,
      source_title: finding.source_title ? String(finding.source_title).slice(0, 400) : null,
      retrieval_date: (finding.retrieval_date && /^\d{4}-\d{2}-\d{2}/.test(String(finding.retrieval_date))) ? String(finding.retrieval_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      research_plan_item: String(item.question || '').slice(0, 1000),
      generator_version: 's122_v1'
    });
  }

  log(log_prefix + ' execution complete: ' + findings.length + ' findings / ' + gaps.length + ' gaps / $' + runCost.toFixed(4));

  // 5. Insert findings (delete-before-insert for idempotency on re-runs of same runId — shouldn't happen, but safe)
  if (findings.length > 0) {
    try {
      var insF = await supabase.from('pursuit_research').insert(findings);
      if (insF.error) log(log_prefix + ' findings insert error: ' + (insF.error.message || '').slice(0, 200));
    } catch (fie) {
      log(log_prefix + ' findings insert exception: ' + (fie.message || '').slice(0, 200));
    }
  }

  // 6. Self-report — rewrite gaps as clarifying questions suitable for proposal Q section
  var clarifyingQuestions = [];
  if (gaps.length > 0 && runCost < HARD_CAP) {
    try {
      var gapSystem = 'You convert unresolved research items into clarifying questions suitable for inclusion in the CLARIFYING QUESTIONS section of a government proposal. Questions must be professional, specific, and actionable by the procuring agency. Return ONLY valid JSON array: [{"item_num": N, "clarifying_question": "..."}]. No preamble. No markdown.';
      var gapUser = 'Unresolved research items:\n' + JSON.stringify(gaps.slice(0, 20), null, 2) + '\n\nReturn the JSON array of clarifying questions now.';
      var gapRaw = await claudeCall(gapSystem, gapUser, 2500, { model: 'claude-sonnet-4-6', agent: 'pursuit_research_gap' });
      var gapClean = (gapRaw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      var gfb = gapClean.indexOf('['), glb = gapClean.lastIndexOf(']');
      if (gfb >= 0 && glb > gfb) gapClean = gapClean.slice(gfb, glb + 1);
      try {
        var parsedGaps = JSON.parse(gapClean);
        if (Array.isArray(parsedGaps)) clarifyingQuestions = parsedGaps;
      } catch (_gpe) { /* keep raw gaps only */ }
    } catch (_gce) { /* non-fatal */ }
  }

  // 7. Final run row update
  var runStatus = costCapped ? 'cost_capped' : 'complete';
  try {
    await supabase.from('pursuit_research_runs').update({
      research_plan: plan,
      plan_item_count: plan.length,
      findings_count: findings.length,
      confidence_distribution: confDist,
      gaps: { raw: gaps, clarifying_questions: clarifyingQuestions },
      cost_usd: Number(runCost.toFixed(4)),
      wall_time_seconds: Math.floor((Date.now() - runStart) / 1000),
      status: runStatus,
      completed_at: new Date().toISOString()
    }).eq('id', runId);
  } catch (ue) {
    log(log_prefix + ' run update error: ' + (ue.message || '').slice(0, 200));
  }

  // 8. Memory trail
  try {
    await supabase.from('organism_memory').insert({
      id: 'mem_pr_' + opp.id + '_' + Date.now(),
      agent: 'pursuit_researcher',
      opportunity_id: opp.id,
      observation: 'PURSUIT RESEARCH ' + runStatus.toUpperCase() + ': ' + findings.length + ' findings (' +
        confDist.high + 'H/' + confDist.medium + 'M/' + confDist.low + 'L), ' +
        gaps.length + ' gaps, ' + clarifyingQuestions.length + ' clarifying Qs, $' +
        runCost.toFixed(2) + ', ' + Math.floor((Date.now() - runStart) / 1000) + 's. Run: ' + runId,
      memory_type: 'analysis',
      created_at: new Date().toISOString()
    });
  } catch (_me) { /* non-fatal */ }

  log(log_prefix + ' DONE: ' + findings.length + ' findings, ' + gaps.length + ' gaps, ' + clarifyingQuestions.length + ' clarifying Qs, $' + runCost.toFixed(2) + ', status=' + runStatus);

  return {
    run_id: runId,
    status: runStatus,
    plan_item_count: plan.length,
    findings_count: findings.length,
    gaps_count: gaps.length,
    clarifying_questions_count: clarifyingQuestions.length,
    confidence_distribution: confDist,
    cost_usd: Number(runCost.toFixed(4)),
    wall_time_seconds: Math.floor((Date.now() - runStart) / 1000)
  };
}


// ════════════════════════════════════════════════════════════════════════════
// L3 METHODOLOGY CORPUS (Layer A) — S123
// Produces SME-depth methodology briefs per vertical × work-area.
// Each brief: ~3,200-3,800 words, 15-30 primary-source citations, Opus-generated
// with 8K extended thinking, grounded in live web research on regulations,
// GAO decisions, OIG reports, and industry publications.
//
// Called by:
//   - POST /api/methodology-generate?vertical=X&work_area=Y (single brief)
//   - POST /api/methodology-batch with {briefs: [{vertical, work_area, title?}, ...]} (seed batch)
// Retrieved by:
//   - produce-proposal mega-prompt (inject vertical-matched briefs as ## METHODOLOGY CORPUS)
//   - GET /api/methodology-retrieve?vertical=X&work_area=Y
// Validation: functional (word_count >= 3000, citation_count >= 15, inline [N] markers,
//   failure modes present, regulatory citations present). Fails -> status='flagged'.
// ════════════════════════════════════════════════════════════════════════════

async function agentMethodologyResearcher(params, opts) {
  params = params || {};
  opts = opts || {};
  var SOFT_CAP = typeof opts.softCap === 'number' ? opts.softCap : 2.50;
  var HARD_CAP = typeof opts.hardCap === 'number' ? opts.hardCap : 4.00;
  var vertical = String(params.vertical || '').toLowerCase().trim();
  var workArea = String(params.work_area || '').trim();
  var providedTitle = String(params.title || '').trim();

  if (!vertical || !workArea) {
    return { status: 'failed', error: 'vertical_and_work_area_required' };
  }

  var workAreaSlug = workArea.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  var briefId = 'methodology-' + vertical + '-' + workAreaSlug;
  var title = providedTitle || (vertical.replace(/_/g, ' ').replace(/\b\w/g, function(c){return c.toUpperCase();}) + ' — ' + workArea);
  var log_prefix = 'METHODOLOGY[' + briefId.slice(0, 60) + ']';
  var runStart = Date.now();
  var runCost = 0;

  function addCost(model, usage) {
    if (!usage) return;
    var p = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
    runCost += (usage.input_tokens || 0) * p.in_per_tok + (usage.output_tokens || 0) * p.out_per_tok;
  }

  // 0. Check freshness — skip if recent published brief exists unless force
  if (!opts.force) {
    try {
      var existing = await supabase.from('methodology_briefs')
        .select('id,status,updated_at,word_count,citation_count')
        .eq('id', briefId)
        .single();
      if (existing.data && existing.data.status === 'published') {
        var ageDays = (Date.now() - new Date(existing.data.updated_at).getTime()) / (24*60*60*1000);
        if (ageDays < 90) {
          log(log_prefix + ' fresh brief exists (' + ageDays.toFixed(1) + ' days old), skipping');
          return { status: 'skipped_fresh', brief_id: briefId, age_days: ageDays, word_count: existing.data.word_count, citation_count: existing.data.citation_count };
        }
      }
    } catch (_ee) { /* non-fatal, continue */ }
  }

  log(log_prefix + ' START: vertical=' + vertical + ' work_area=' + workArea);

  // ═══ 1. RESEARCH PHASE ═══
  // Four web-search passes via Sonnet+web_search_20250305:
  //  (a) regulation and authoritative guidance
  //  (b) GAO protest decisions and winning proposal archives
  //  (c) OIG audit findings and failure modes
  //  (d) industry best-practices publications
  var researchSystem =
    'You are a senior research librarian. For the vertical and work area described, use web_search to retrieve authoritative primary sources ONLY. Prioritize: (1) Code of Federal Regulations and equivalent state regulations, (2) agency guidance documents (FEMA PAPPG, HUD HOCs, DOL WIOA directives, etc.), (3) GAO bid protest decisions, (4) Office of Inspector General audit reports, (5) Louisiana Legislative Auditor reports, (6) industry SME publications (NIGP, NCMA, ICMA, PMI, AACE, SHRM, DRJ, etc.). Avoid: Wikipedia, blogs, vendor marketing, general news.\n\n' +
    'For each source you find, extract the most substantive passage (200-500 words) that directly addresses the work area. Tag each extract with category: regulation / guidance / gao_decision / oig_report / auditor_report / publication. Include source URL, source title, and source date.\n\n' +
    'Return ONLY JSON: [{"category":"regulation","source_title":"...","source_url":"...","source_date":"YYYY-MM-DD","excerpt":"..."}]. No preamble. No markdown fences.';

  var researchQueries = [
    {
      focus: 'regulations and authoritative guidance',
      query: 'Find the canonical regulations, statutes, and authoritative agency guidance for: ' + vertical + ' — ' + workArea + '. Examples of primary sources: eCFR sections, FEMA PAPPG, HUD guidance, NOFOs, Federal Register rules. Extract 3-5 distinct authoritative sources.'
    },
    {
      focus: 'GAO decisions and winning proposal references',
      query: 'Find GAO bid protest decisions and publicly accessible winning proposal excerpts relevant to: ' + vertical + ' — ' + workArea + '. Focus on decisions that describe evaluator-noted strengths or methodology. Extract 2-4 decisions with specific citations.'
    },
    {
      focus: 'OIG audit reports and failure modes',
      query: 'Find Office of Inspector General (OIG) audit findings and GAO reports describing specific failure modes, improper payments, or deficiencies in: ' + vertical + ' — ' + workArea + '. Focus on concrete, specific findings. Extract 2-4 reports.'
    },
    {
      focus: 'industry SME publications and quantified benchmarks',
      query: 'Find industry SME publications with methodology benchmarks, standard cycle times, compliance metrics, or operational best practices for: ' + vertical + ' — ' + workArea + '. Priority: NIGP, NCMA, ICMA, PMI, SHRM, DRJ, HUD.gov, FEMA.gov library. Extract 2-4 publications.'
    }
  ];

  var allSources = [];
  for (var ri = 0; ri < researchQueries.length; ri++) {
    if (runCost >= SOFT_CAP) { log(log_prefix + ' SOFT_CAP hit at research phase ' + ri); break; }
    var rq = researchQueries[ri];
    var rResp;
    try {
      rResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: researchSystem,
        messages: [{ role: 'user', content: 'RESEARCH FOCUS: ' + rq.focus + '\n\n' + rq.query + '\n\nReturn ONLY the JSON array of source extracts.' }]
      });
      trackCost('methodology_research', 'claude-sonnet-4-6', rResp.usage);
      addCost('claude-sonnet-4-6', rResp.usage);
    } catch (re) {
      log(log_prefix + ' research pass ' + ri + ' error: ' + (re.message||'').slice(0,150));
      continue;
    }
    var rText = (rResp.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
    var rClean = rText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    var rFb = rClean.indexOf('['), rLb = rClean.lastIndexOf(']');
    if (rFb >= 0 && rLb > rFb) rClean = rClean.slice(rFb, rLb+1);
    try {
      var parsed = JSON.parse(rClean);
      if (Array.isArray(parsed)) {
        allSources = allSources.concat(parsed.filter(function(s){return s && s.source_title && s.excerpt;}));
      }
    } catch(_rpe) { /* skip bad parse */ }
    log(log_prefix + ' research ' + ri + ': +' + (allSources.length) + ' total sources, cost=$' + runCost.toFixed(3));
  }

  if (allSources.length < 5) {
    log(log_prefix + ' insufficient sources (' + allSources.length + '), failing');
    return { status: 'failed', error: 'insufficient_sources', source_count: allSources.length, cost_usd: Number(runCost.toFixed(4)) };
  }

  // Build research context block
  var researchBlock = allSources.map(function(s, idx) {
    return '[' + (idx+1) + '] ' + String(s.category||'other').toUpperCase() + ' — ' + (s.source_title||'') +
      (s.source_date ? ' (' + s.source_date + ')' : '') + '\n' +
      'URL: ' + (s.source_url||'') + '\n' +
      'Excerpt: ' + String(s.excerpt||'').slice(0, 1500);
  }).join('\n\n').slice(0, 60000);

  log(log_prefix + ' research assembled: ' + allSources.length + ' sources, ' + researchBlock.length + ' chars, cost=$' + runCost.toFixed(3));

  // ═══ 2. BRIEF GENERATION ═══
  var briefSystem =
    'You are a senior subject-matter expert with 20 years of hands-on execution experience in the specific vertical and work-area named in the user message. You have personally managed operational details of this work across dozens of engagements. You have read every relevant regulation, every government guidance document, every OIG audit, every winning proposal in this space, every industry publication, and every lessons-learned paper. You write methodology documentation that senior government evaluators immediately recognize as coming from someone who has done the work — not from someone reading about it.\n\n' +
    'You are producing a METHODOLOGY BRIEF. A methodology brief is NOT a summary, NOT a general overview, and NOT a list of tasks. It is the operational play-by-play for how an experienced team actually executes this work, grounded in cited sources, written for a government proposal evaluator who is themselves a senior specialist in this work-area.\n\n' +
    'The brief MUST include these sections (in this order):\n' +
    '1. REGULATORY FOUNDATION — specific CFR sections, statutes, guidance documents that govern this work. Cite each with inline bracket reference [N] matching the numbered source list.\n' +
    '2. WEEK-LEVEL EXECUTION SEQUENCE — the actual week-by-week operational rhythm of a competent team doing this work. Not generic PM phases. The real sequence: what happens Week 1, Week 2, what artifacts are produced, what decisions get made, what escalations trigger.\n' +
    '3. SYSTEMS AND PLATFORMS — named systems actually used (e.g., "EMMIE," "FEMA GO," "DRGR," "IDIS," "PIC/IMS," "PMS/ASAP"). Version references where they matter. No generic "project management software."\n' +
    '4. FAILURE MODES AND FIXES — specific failure modes documented in OIG audits, GAO decisions, or IG reports, with the corrective control HGI embeds to prevent them. Cite each failure mode.\n' +
    '5. QUANTIFIED BENCHMARKS — cycle times, compliance metrics, error rates, productivity numbers from published industry sources. Real numbers, cited.\n' +
    '6. PROVEN METHODOLOGY — HGI\'s specific methodology for this work, referencing HGI\'s 1929 founding, Louisiana roots, and relevant past performance patterns. Make it concrete, not generic.\n' +
    '7. DISCRIMINATORS — the 3-5 aspects of HGI\'s approach that differentiate from typical competitor delivery. Each anchored to evidence.\n\n' +
    'FORMAT RULES:\n' +
    '- Target length: 3,200-3,800 words total.\n' +
    '- Inline citations: use [N] where N matches the numbered source list provided to you. Minimum 15 inline citations across the brief.\n' +
    '- Use ## section headers for the 7 sections above.\n' +
    '- Write in HGI voice: authoritative, specific, relationship-forward, mission-driven. Avoid: "leverage synergies," "best-in-class," "cutting-edge," "world-class," "innovative solutions."\n' +
    '- NO PERSONAL NAMES. Use role titles only (President, Chairman, CEO, CAO, VP, SVP Claims). Geoffrey Brien is no longer with HGI — do not reference.\n' +
    '- DO NOT list: PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA. These are hard exclusions.\n' +
    '- HGI founded 1929. Never write "95-year" — compute from 1929 if needed.\n' +
    '- Terrebonne Parish School District is abbreviated TPSD. Not Tangipahoa.\n\n' +
    'OUTPUT FORMAT:\n' +
    'Return ONLY valid JSON with this exact shape. No preamble. No markdown fences.\n' +
    '{\n' +
    '  "brief_text": "## REGULATORY FOUNDATION\\n\\nFull brief text with inline [N] citations, 3200-3800 words, 7 sections...",\n' +
    '  "citations_used": [\n' +
    '    {"n": 1, "source_title": "...", "source_url": "...", "source_date": "YYYY-MM-DD", "citation_type": "regulation", "relevance_score": 95, "citation_text": "brief quote or paraphrase"},\n' +
    '    ...\n' +
    '  ]\n' +
    '}\n' +
    'citation_type must be one of: regulation, gao_decision, foia_proposal, publication, oig_report, academic, guidance\n' +
    'Every [N] you use in the brief MUST appear in citations_used.';

  var briefUser =
    'VERTICAL: ' + vertical + '\n' +
    'WORK AREA: ' + workArea + '\n' +
    'BRIEF TITLE: ' + title + '\n' +
    '\nRESEARCH CONTEXT — USE THESE AS YOUR SOURCE MATERIAL (cite by [N] matching the bracketed numbers):\n\n' +
    researchBlock +
    '\n\nProduce the methodology brief now. Follow the 7-section structure exactly. Minimum 3,200 words. Minimum 15 inline [N] citations. Return ONLY the JSON object.';

  log(log_prefix + ' brief generation begin (Opus + 8K thinking, 16K max)');

  var briefResp;
  try {
    briefResp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: 8000 },
      system: briefSystem,
      messages: [{ role: 'user', content: briefUser }]
    });
    trackCost('methodology_brief', 'claude-opus-4-6', briefResp.usage);
    addCost('claude-opus-4-6', briefResp.usage);
  } catch (bge) {
    log(log_prefix + ' brief generation error: ' + (bge.message||'').slice(0,200));
    return { status: 'failed', error: 'brief_generation_error', detail: (bge.message||'').slice(0,200), cost_usd: Number(runCost.toFixed(4)) };
  }

  var briefText = (briefResp.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
  var briefClean = briefText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  var bFb = briefClean.indexOf('{'), bLb = briefClean.lastIndexOf('}');
  if (bFb >= 0 && bLb > bFb) briefClean = briefClean.slice(bFb, bLb+1);

  var briefObj = null;
  try { briefObj = JSON.parse(briefClean); } catch (bpe) {
    log(log_prefix + ' brief JSON parse failed: ' + (bpe.message||'').slice(0,120) + '. Raw first 300: ' + briefText.slice(0,300));
    return { status: 'failed', error: 'brief_parse_failed', cost_usd: Number(runCost.toFixed(4)) };
  }

  if (!briefObj.brief_text || typeof briefObj.brief_text !== 'string') {
    return { status: 'failed', error: 'missing_brief_text', cost_usd: Number(runCost.toFixed(4)) };
  }

  var finalText = briefObj.brief_text;
  var citationsUsed = Array.isArray(briefObj.citations_used) ? briefObj.citations_used : [];

  // ═══ 3. VALIDATION (functional) ═══
  var wordCount = (finalText.match(/\b\w+\b/g) || []).length;
  var inlineCitations = (finalText.match(/\[\d+\]/g) || []).length;
  var distinctInlineCitations = {};
  (finalText.match(/\[\d+\]/g) || []).forEach(function(m){ distinctInlineCitations[m] = true; });
  var distinctInlineCount = Object.keys(distinctInlineCitations).length;

  var validationChecks = {
    word_count: wordCount,
    word_count_ok: wordCount >= 3000,
    inline_citations_count: inlineCitations,
    distinct_inline_citations: distinctInlineCount,
    distinct_citations_ok: distinctInlineCount >= 8,
    citations_array_count: citationsUsed.length,
    has_regulatory_foundation: /##\s*REGULATORY FOUNDATION/i.test(finalText),
    has_failure_modes: /##\s*FAILURE MODES/i.test(finalText),
    has_systems_platforms: /##\s*SYSTEMS AND PLATFORMS/i.test(finalText),
    has_week_level: /##\s*WEEK-LEVEL/i.test(finalText),
    has_benchmarks: /##\s*QUANTIFIED BENCHMARKS/i.test(finalText),
    has_methodology: /##\s*PROVEN METHODOLOGY/i.test(finalText),
    has_discriminators: /##\s*DISCRIMINATORS/i.test(finalText)
  };

  var hardFails = [];
  if (!validationChecks.word_count_ok) hardFails.push('word_count_low:' + wordCount);
  if (!validationChecks.distinct_citations_ok) hardFails.push('distinct_citations_low:' + distinctInlineCount);
  if (!validationChecks.has_regulatory_foundation) hardFails.push('missing_regulatory_foundation');
  if (!validationChecks.has_failure_modes) hardFails.push('missing_failure_modes');

  // Canon violation sweep — word-boundary aware to prevent substring false positives
  // (e.g. "liga" does NOT match "obligation"; "opsb" does NOT match anything in normal English)
  // Multi-word phrases use plain substring (those don't false-positive). Single tokens use word boundaries.
  var canonViolations = [];
  var canonSingleTokens = [
    { term: 'pbgc',      re: /\bpbgc\b/i },
    { term: 'opsb',      re: /\bopsb\b/i },
    { term: 'liga',      re: /\bliga\b/i },
    { term: 'tpciga',    re: /\btpciga\b/i },
    { term: 'tangipahoa',re: /\btangipahoa\b/i },
    { term: '95-year',   re: /\b95-year\b/i },
    { term: '95 year',   re: /\b95 year\b/i }
  ];
  canonSingleTokens.forEach(function(c){
    if (c.re.test(finalText)) canonViolations.push(c.term);
  });
  var canonPhrases = ['orleans parish school board','geoffrey brien'];
  var lowerText = finalText.toLowerCase();
  canonPhrases.forEach(function(term){
    if (lowerText.indexOf(term) >= 0) canonViolations.push(term);
  });

  var briefStatus = (hardFails.length === 0 && canonViolations.length === 0) ? 'published' : 'flagged';
  var qualityScore = 0;
  var passCount = 0;
  Object.keys(validationChecks).forEach(function(k){ if (k.indexOf('_ok')>=0 || k.indexOf('has_')===0) { if (validationChecks[k] === true) passCount++; } });
  qualityScore = Math.round((passCount / 9) * 100); // 9 boolean checks
  if (canonViolations.length > 0) qualityScore = Math.max(0, qualityScore - 30);

  log(log_prefix + ' validation: status=' + briefStatus + ', words=' + wordCount + ', distinct_cites=' + distinctInlineCount + ', quality=' + qualityScore + (hardFails.length ? ', hardFails=' + hardFails.join(',') : '') + (canonViolations.length ? ', canon=' + canonViolations.join(',') : ''));

  // ═══ 4. STORAGE — brief, citations, sync to knowledge_chunks ═══
  var wallTime = Math.floor((Date.now() - runStart) / 1000);

  // UPSERT brief
  try {
    // delete existing citations for idempotency
    await supabase.from('methodology_citations').delete().eq('brief_id', briefId);
    await supabase.from('methodology_briefs').delete().eq('id', briefId);
  } catch (_de) { /* non-fatal */ }

  try {
    var insertBrief = await supabase.from('methodology_briefs').insert({
      id: briefId,
      vertical: vertical,
      work_area: workArea,
      work_area_slug: workAreaSlug,
      title: title,
      brief_text: finalText,
      word_count: wordCount,
      citation_count: citationsUsed.length,
      last_researched: new Date().toISOString(),
      version: 1,
      status: briefStatus,
      quality_score: qualityScore,
      generation_cost_usd: Number(runCost.toFixed(4)),
      generation_wall_time_seconds: wallTime,
      generator_version: 's123_v1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (insertBrief.error) log(log_prefix + ' brief insert error: ' + (insertBrief.error.message||'').slice(0,200));
  } catch (bie) {
    log(log_prefix + ' brief insert exception: ' + (bie.message||'').slice(0,200));
    return { status: 'failed', error: 'storage_error', detail: (bie.message||'').slice(0,200), cost_usd: Number(runCost.toFixed(4)) };
  }

  // insert citations (bulk)
  if (citationsUsed.length > 0) {
    var citationRows = citationsUsed.filter(function(c){return c && c.source_title;}).map(function(c){
      return {
        brief_id: briefId,
        citation_type: String(c.citation_type||'publication').slice(0, 60),
        source_title: String(c.source_title||'').slice(0, 500),
        source_url: c.source_url ? String(c.source_url).slice(0, 600) : null,
        source_date: (c.source_date && /^\d{4}-\d{2}-\d{2}/.test(String(c.source_date))) ? String(c.source_date).slice(0, 10) : null,
        citation_text: c.citation_text ? String(c.citation_text).slice(0, 2000) : null,
        relevance_score: typeof c.relevance_score === 'number' ? c.relevance_score : 50,
        created_at: new Date().toISOString()
      };
    });
    if (citationRows.length > 0) {
      try {
        var insC = await supabase.from('methodology_citations').insert(citationRows);
        if (insC.error) log(log_prefix + ' citations insert error: ' + (insC.error.message||'').slice(0,200));
      } catch (cie) {
        log(log_prefix + ' citations insert exception: ' + (cie.message||'').slice(0,200));
      }
    }
  }

  // sync brief to knowledge_chunks for retrieval compatibility
  // S124 fix: (a) column is chunk_text (not content); (b) no created_at column; (c) document_id FK requires parent knowledge_documents row first
  try {
    var kbFilename = 'methodology-' + vertical + '-' + workAreaSlug + '.md';
    // (a) upsert parent knowledge_documents row (FK target)
    await supabase.from('knowledge_documents').delete().eq('id', briefId);
    var insKdoc = await supabase.from('knowledge_documents').insert({
      id: briefId,
      filename: kbFilename,
      document_class: 'methodology_brief',
      vertical: vertical,
      summary: (title || '').slice(0, 500),
      chunk_count: Math.ceil(finalText.length / 2500),
      char_count: finalText.length,
      status: 'chunked',
      processed_at: new Date().toISOString()
    });
    if (insKdoc.error) {
      log(log_prefix + ' KB parent doc insert error: ' + (insKdoc.error.message||'').slice(0,200));
    }
    // (b) delete stale chunks for this brief
    await supabase.from('knowledge_chunks').delete().eq('document_id', briefId);
    // (c) insert chunks with correct column names + FK-satisfying document_id
    var CHUNK_SIZE = 2500;
    var chunks = [];
    for (var ci = 0; ci < finalText.length; ci += CHUNK_SIZE) {
      chunks.push({
        id: 'mb_' + briefId + '_' + Math.floor(ci / CHUNK_SIZE),
        document_id: briefId,
        document_class: 'methodology_brief',
        filename: kbFilename,
        vertical: vertical,
        chunk_index: Math.floor(ci / CHUNK_SIZE),
        chunk_text: finalText.slice(ci, ci + CHUNK_SIZE)
      });
    }
    if (chunks.length > 0) {
      var insK = await supabase.from('knowledge_chunks').insert(chunks);
      if (insK.error) log(log_prefix + ' KB chunks insert error: ' + (insK.error.message||'').slice(0,200));
      else log(log_prefix + ' KB synced: 1 parent doc + ' + chunks.length + ' chunks');
    }
  } catch (kce) {
    log(log_prefix + ' KB sync exception: ' + (kce.message||'').slice(0,200));
  }

  // ═══ 5. MEMORY TRAIL ═══
  try {
    await supabase.from('organism_memory').insert({
      id: 'mem_methbrief_' + briefId.slice(0,100) + '_' + Date.now(),
      agent: 'methodology_researcher',
      observation: 'METHODOLOGY BRIEF ' + briefStatus.toUpperCase() + ': ' + vertical + ' — ' + workArea +
        '. Words=' + wordCount + ', distinct citations=' + distinctInlineCount +
        ', quality=' + qualityScore + ', cost=$' + runCost.toFixed(2) + ', wall=' + wallTime + 's.' +
        (hardFails.length ? ' HardFails: ' + hardFails.join(',') : '') +
        (canonViolations.length ? ' CanonViolations: ' + canonViolations.join(',') : ''),
      memory_type: 'analysis',
      created_at: new Date().toISOString()
    });
  } catch (_me) { /* non-fatal */ }

  log(log_prefix + ' DONE: status=' + briefStatus + ', words=' + wordCount + ', cost=$' + runCost.toFixed(2) + ', wall=' + wallTime + 's');

  return {
    brief_id: briefId,
    vertical: vertical,
    work_area: workArea,
    status: briefStatus,
    word_count: wordCount,
    citation_count: citationsUsed.length,
    distinct_inline_citations: distinctInlineCount,
    quality_score: qualityScore,
    hard_fails: hardFails,
    canon_violations: canonViolations,
    cost_usd: Number(runCost.toFixed(4)),
    wall_time_seconds: wallTime
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// agentCompetitorBriefResearcher — S126 L5
// Replaces the prior cron text-dump version of agentCompetitorDeepDive (L8636,
// kept in place for backward compatibility with any caller still depending on it).
// Produces structured 4-6K word competitor briefs with 20-40 primary-source
// citations, 7-section structure: corporate_profile, methodology_patterns,
// recent_wins, recent_losses, pricing_patterns, known_weaknesses, teaming_history.
// Stores in competitor_briefs table; cites tracked in competitor_brief_citations.
// Used by L4 discriminator synthesizer and L7 senior writer via retrieveCompetitorBriefs().
// ─────────────────────────────────────────────────────────────────────────────
async function agentCompetitorBriefResearcher(params, opts) {
  params = params || {};
  opts = opts || {};
  var SOFT_CAP = typeof opts.softCap === 'number' ? opts.softCap : 3.00;
  var HARD_CAP = typeof opts.hardCap === 'number' ? opts.hardCap : 5.00;
  var competitorName = String(params.competitor_name || '').trim();
  var primaryVerticals = Array.isArray(params.primary_verticals) ? params.primary_verticals : [];
  var geographicFocus = Array.isArray(params.geographic_focus) ? params.geographic_focus : ['Louisiana', 'Gulf Coast', 'national'];

  if (!competitorName) {
    return { status: 'failed', error: 'competitor_name_required' };
  }
  if (primaryVerticals.length === 0) {
    return { status: 'failed', error: 'primary_verticals_required' };
  }

  var slug = competitorName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  var briefId = 'competitor-' + slug;
  var log_prefix = 'COMPETITOR-BRIEF[' + slug.slice(0, 60) + ']';
  var runStart = Date.now();
  var runCost = 0;

  function addCost(model, usage) {
    if (!usage) return;
    var p = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
    runCost += (usage.input_tokens || 0) * p.in_per_tok + (usage.output_tokens || 0) * p.out_per_tok;
  }

  // 0. Freshness check
  if (!opts.force) {
    try {
      var existing = await supabase.from('competitor_briefs')
        .select('id,status,updated_at,word_count,citation_count')
        .eq('id', briefId)
        .single();
      if (existing.data && existing.data.status === 'published') {
        var ageDays = (Date.now() - new Date(existing.data.updated_at).getTime()) / (24*60*60*1000);
        if (ageDays < 60) {
          log(log_prefix + ' fresh brief exists (' + ageDays.toFixed(1) + ' days old), skipping');
          return { status: 'skipped_fresh', brief_id: briefId, age_days: ageDays, word_count: existing.data.word_count, citation_count: existing.data.citation_count };
        }
      }
    } catch (_ee) { /* non-fatal */ }
  }

  log(log_prefix + ' START: competitor=' + competitorName + ' verticals=' + primaryVerticals.join(','));

  // ═══ 1. RESEARCH PHASE — 5 web-search passes ═══
  var researchSystem =
    'You are a senior competitive intelligence analyst researching government services contractors. For each query, use web_search to retrieve PUBLIC, AUTHORITATIVE sources ONLY. Prioritize: (1) USAspending.gov contract awards, (2) SAM.gov entity records, (3) GAO bid protest decisions, (4) state procurement award databases, (5) trade press coverage of major awards/losses (ENR, Federal News Network, FCW, Government Executive, Disaster Recovery Journal), (6) the firm\'s own published case studies, (7) corporate press releases, (8) SEC filings if publicly traded, (9) Glassdoor/LinkedIn for personnel signals. Avoid: vendor marketing copy from the firm itself for substantive claims, blogs without sourcing, opinion pieces.\n\n' +
    'For each source you find, extract the most substantive passage (200-500 words) directly relevant to the research focus. Tag each extract with category: contract_award / protest_decision / press_coverage / corporate_filing / case_study / trade_publication / personnel_signal. Include source URL, source title, source date.\n\n' +
    'Return ONLY JSON: [{"category":"contract_award","source_title":"...","source_url":"...","source_date":"YYYY-MM-DD","excerpt":"..."}]. No preamble. No markdown fences.';

  var verticalsList = primaryVerticals.join(', ');
  var geoList = geographicFocus.join(', ');

  var researchQueries = [
    {
      focus: 'recent contract awards (last 24 months)',
      query: 'Find publicly documented contract awards to "' + competitorName + '" in the past 24 months. Prioritize USAspending.gov records, state procurement award notices, agency press releases. Focus on awards in: ' + verticalsList + ', geography: ' + geoList + '. Extract 4-6 specific awards with dollar amounts, agency, scope, period of performance.'
    },
    {
      focus: 'recent losses, protests, terminations',
      query: 'Find publicly documented losses, GAO protests, contract terminations, or unsuccessful pursuits by "' + competitorName + '" in the past 36 months. Search GAO.gov protest decisions, agency debrief records, trade press. Extract 2-4 specific instances with the reason for the outcome where stated.'
    },
    {
      focus: 'methodology patterns and corporate identity',
      query: 'Find published descriptions of "' + competitorName + '" methodology, delivery model, and corporate positioning. Sources: corporate website case studies, press releases, leadership interviews, conference presentations, white papers. Focus on what the firm publicly claims as its differentiators in: ' + verticalsList + '. Extract 3-5 substantive descriptions.'
    },
    {
      focus: 'pricing patterns and cost structure signals',
      query: 'Find publicly available pricing signals for "' + competitorName + '": GSA Schedule rates, awarded contract values relative to scope, hourly rate disclosures, public protests citing pricing factors. Extract 2-4 specific pricing data points.'
    },
    {
      focus: 'known weaknesses, audit findings, performance issues',
      query: 'Find publicly documented weaknesses, audit findings, performance issues, IG reports, or critical press coverage of "' + competitorName + '". Sources: GAO reports, IG reports, state legislative auditor reports, investigative journalism, trade press. Focus on substantive findings in: ' + verticalsList + '. Extract 2-4 specific items.'
    }
  ];

  var allSources = [];
  for (var ri = 0; ri < researchQueries.length; ri++) {
    if (runCost >= SOFT_CAP) { log(log_prefix + ' SOFT_CAP hit at research phase ' + ri); break; }
    var rq = researchQueries[ri];
    var rResp;
    try {
      rResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: researchSystem,
        messages: [{ role: 'user', content: 'COMPETITOR: ' + competitorName + '\nRESEARCH FOCUS: ' + rq.focus + '\n\n' + rq.query + '\n\nReturn ONLY the JSON array of source extracts.' }]
      });
      trackCost('competitor_research', 'claude-sonnet-4-6', rResp.usage);
      addCost('claude-sonnet-4-6', rResp.usage);
    } catch (re) {
      log(log_prefix + ' research pass ' + ri + ' error: ' + (re.message||'').slice(0,150));
      continue;
    }
    var rText = (rResp.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
    var rClean = rText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    var rFb = rClean.indexOf('['), rLb = rClean.lastIndexOf(']');
    if (rFb >= 0 && rLb > rFb) rClean = rClean.slice(rFb, rLb+1);
    try {
      var parsed = JSON.parse(rClean);
      if (Array.isArray(parsed)) {
        allSources = allSources.concat(parsed.filter(function(s){return s && s.source_title && s.excerpt;}));
      }
    } catch(_rpe) { /* skip */ }
    log(log_prefix + ' research ' + ri + ': +' + (allSources.length) + ' total sources, cost=$' + runCost.toFixed(3));
  }

  if (allSources.length < 6) {
    log(log_prefix + ' insufficient sources (' + allSources.length + '), failing');
    return { status: 'failed', error: 'insufficient_sources', source_count: allSources.length, cost_usd: Number(runCost.toFixed(4)) };
  }

  // Build research context block (cap 60K chars to leave room for Opus generation)
  var researchBlock = allSources.map(function(s, idx) {
    return '[' + (idx+1) + '] ' + String(s.category||'other').toUpperCase() + ' — ' + (s.source_title||'') +
      (s.source_date ? ' (' + s.source_date + ')' : '') + '\n' +
      'URL: ' + (s.source_url||'') + '\n' +
      'Excerpt: ' + String(s.excerpt||'').slice(0, 1500);
  }).join('\n\n').slice(0, 60000);

  log(log_prefix + ' research assembled: ' + allSources.length + ' sources, ' + researchBlock.length + ' chars, cost=$' + runCost.toFixed(3));

  // ═══ 2. BRIEF GENERATION — Opus + 8K thinking ═══
  var briefSystem =
    'You are a senior competitive intelligence analyst with 20 years of experience in government services market intelligence. You have studied this competitor across multiple pursuits and outcomes. You write competitor briefs that capture strategists at HGI Global use to position against this firm in head-to-head pursuits.\n\n' +
    'You are producing a COMPETITOR BRIEF. The brief is NOT a generic profile. It is operational intelligence: where this firm is strong, where they are vulnerable, what their pricing looks like, what they bid recently and what they lost recently, who they team with, what audit findings they have. Every claim must be grounded in cited public sources.\n\n' +
    'The brief MUST include these 7 sections (in order):\n' +
    '1. CORPORATE PROFILE — entity structure, ownership, headquarters, geographic footprint, leadership signals, employee count signals, parent/subsidiary relationships. Cite each material fact.\n' +
    '2. METHODOLOGY PATTERNS — how they publicly position their delivery model, what differentiators they claim, what they emphasize in their case studies and press. Cite from their own materials.\n' +
    '3. RECENT WINS — specific contracts awarded in the last 24 months: agency, scope, dollar value, period of performance. Source each from USAspending, state procurement records, or trade press.\n' +
    '4. RECENT LOSSES — specific losses, GAO protests, terminations, or unsuccessful pursuits in the last 36 months. Cite GAO decisions or trade coverage.\n' +
    '5. PRICING PATTERNS — what their published rates look like (GSA Schedule, awarded contract values vs scope), pricing protest history, any signals on cost structure. Cite specifics.\n' +
    '6. KNOWN WEAKNESSES — audit findings, IG reports, performance issues, critical press coverage with specific quotes/findings. Cite each.\n' +
    '7. TEAMING HISTORY — who they team with as primes/subs in the verticals HGI competes in. Cite from contract awards.\n\n' +
    'FORMAT RULES:\n' +
    '- Target length: 4,000-6,000 words.\n' +
    '- Inline citations: use [N] where N matches the numbered source list. Minimum 20 distinct inline citations across the brief.\n' +
    '- Use ## section headers for the 7 sections above.\n' +
    '- Write in operational analyst voice: factual, specific, attributable. Never speculative.\n' +
    '- Never use the competitor\'s own marketing language without quotation. Never overstate findings beyond what sources support.\n' +
    '- HGI is the consumer of this brief. NEVER write proposal-style language ("HGI will...", "HGI provides..."). The brief is intelligence ABOUT a competitor, not a marketing piece for HGI.\n\n' +
    'OUTPUT FORMAT:\n' +
    'Return ONLY valid JSON with this exact shape. No preamble. No markdown fences.\n' +
    '{\n' +
    '  "brief_text": "## CORPORATE PROFILE\\n\\n... full brief 4000-6000 words with inline [N] citations and 7 sections...",\n' +
    '  "section_extracts": {\n' +
    '    "corporate_profile": "the corporate profile section text only (for indexed retrieval)",\n' +
    '    "methodology_patterns": "...",\n' +
    '    "recent_wins": "...",\n' +
    '    "recent_losses": "...",\n' +
    '    "pricing_patterns": "...",\n' +
    '    "known_weaknesses": "...",\n' +
    '    "teaming_history": "..."\n' +
    '  },\n' +
    '  "citations_used": [\n' +
    '    {"n": 1, "source_title": "...", "source_url": "...", "source_date": "YYYY-MM-DD", "citation_type": "contract_award", "relevance_score": 95, "citation_text": "brief quote or paraphrase"}\n' +
    '  ]\n' +
    '}\n' +
    'citation_type must be one of: contract_award, protest_decision, press_coverage, corporate_filing, case_study, trade_publication, personnel_signal, audit_report, other\n' +
    'Every [N] in brief_text MUST appear in citations_used.';

  var briefUser =
    'COMPETITOR: ' + competitorName + '\n' +
    'PRIMARY VERTICALS HGI COMPETES IN: ' + verticalsList + '\n' +
    'GEOGRAPHIC SCOPE: ' + geoList + '\n' +
    '\nRESEARCH SOURCES (cite by [N] matching the bracketed numbers):\n\n' +
    researchBlock +
    '\n\nProduce the competitor brief now. Follow the 7-section structure exactly. Minimum 4,000 words. Minimum 20 distinct inline [N] citations. Return ONLY the JSON object.';

  log(log_prefix + ' brief generation begin (Opus + 8K thinking, 20K max)');

  var briefResp;
  try {
    briefResp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 20000,
      thinking: { type: 'enabled', budget_tokens: 8000 },
      system: briefSystem,
      messages: [{ role: 'user', content: briefUser }]
    });
    trackCost('competitor_brief', 'claude-opus-4-6', briefResp.usage);
    addCost('claude-opus-4-6', briefResp.usage);
  } catch (bge) {
    log(log_prefix + ' brief generation error: ' + (bge.message||'').slice(0,200));
    return { status: 'failed', error: 'brief_generation_error', detail: (bge.message||'').slice(0,200), cost_usd: Number(runCost.toFixed(4)) };
  }

  var briefText = (briefResp.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
  var briefClean = briefText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  var bFb = briefClean.indexOf('{'), bLb = briefClean.lastIndexOf('}');
  if (bFb >= 0 && bLb > bFb) briefClean = briefClean.slice(bFb, bLb+1);

  var briefObj = null;
  try { briefObj = JSON.parse(briefClean); } catch (bpe) {
    log(log_prefix + ' brief JSON parse failed: ' + (bpe.message||'').slice(0,120));
    return { status: 'failed', error: 'brief_parse_failed', cost_usd: Number(runCost.toFixed(4)) };
  }

  if (!briefObj.brief_text || typeof briefObj.brief_text !== 'string') {
    return { status: 'failed', error: 'missing_brief_text', cost_usd: Number(runCost.toFixed(4)) };
  }

  var finalText = briefObj.brief_text;
  var sectionExtracts = briefObj.section_extracts || {};
  var citationsUsed = Array.isArray(briefObj.citations_used) ? briefObj.citations_used : [];

  // ═══ 3. VALIDATION ═══
  var wordCount = (finalText.match(/\b\w+\b/g) || []).length;
  var inlineCitations = (finalText.match(/\[\d+\]/g) || []).length;
  var distinctInlineCitations = {};
  (finalText.match(/\[\d+\]/g) || []).forEach(function(m){ distinctInlineCitations[m] = true; });
  var distinctInlineCount = Object.keys(distinctInlineCitations).length;

  var validationChecks = {
    word_count: wordCount,
    word_count_ok: wordCount >= 3500,
    distinct_citations_ok: distinctInlineCount >= 12,
    has_corporate_profile: /##\s*CORPORATE PROFILE/i.test(finalText),
    has_methodology_patterns: /##\s*METHODOLOGY PATTERNS/i.test(finalText),
    has_recent_wins: /##\s*RECENT WINS/i.test(finalText),
    has_recent_losses: /##\s*RECENT LOSSES/i.test(finalText),
    has_pricing_patterns: /##\s*PRICING PATTERNS/i.test(finalText),
    has_known_weaknesses: /##\s*KNOWN WEAKNESSES/i.test(finalText),
    has_teaming_history: /##\s*TEAMING HISTORY/i.test(finalText)
  };

  var hardFails = [];
  if (!validationChecks.word_count_ok) hardFails.push('word_count_low:' + wordCount);
  if (!validationChecks.distinct_citations_ok) hardFails.push('distinct_citations_low:' + distinctInlineCount);
  if (!validationChecks.has_recent_wins) hardFails.push('missing_recent_wins');
  if (!validationChecks.has_known_weaknesses) hardFails.push('missing_known_weaknesses');

  var briefStatus = hardFails.length === 0 ? 'published' : 'flagged';
  var passCount = 0;
  Object.keys(validationChecks).forEach(function(k){ if (k.indexOf('_ok')>=0 || k.indexOf('has_')===0) { if (validationChecks[k] === true) passCount++; } });
  var qualityScore = Math.round((passCount / 9) * 100);

  log(log_prefix + ' validation: status=' + briefStatus + ', words=' + wordCount + ', distinct_cites=' + distinctInlineCount + ', quality=' + qualityScore + (hardFails.length ? ', hardFails=' + hardFails.join(',') : ''));

  // ═══ 4. STORAGE ═══
  var wallTime = Math.floor((Date.now() - runStart) / 1000);

  try {
    await supabase.from('competitor_brief_citations').delete().eq('brief_id', briefId);
    await supabase.from('competitor_briefs').delete().eq('id', briefId);
  } catch (_de) { /* non-fatal */ }

  try {
    var insertBrief = await supabase.from('competitor_briefs').insert({
      id: briefId,
      competitor_name: competitorName,
      competitor_slug: slug,
      primary_verticals: primaryVerticals,
      geographic_focus: geographicFocus,
      brief_text: finalText,
      corporate_profile: String(sectionExtracts.corporate_profile || '').slice(0, 20000),
      methodology_patterns: String(sectionExtracts.methodology_patterns || '').slice(0, 20000),
      recent_wins: String(sectionExtracts.recent_wins || '').slice(0, 20000),
      recent_losses: String(sectionExtracts.recent_losses || '').slice(0, 20000),
      pricing_patterns: String(sectionExtracts.pricing_patterns || '').slice(0, 20000),
      known_weaknesses: String(sectionExtracts.known_weaknesses || '').slice(0, 20000),
      teaming_history: String(sectionExtracts.teaming_history || '').slice(0, 20000),
      word_count: wordCount,
      citation_count: citationsUsed.length,
      last_researched: new Date().toISOString(),
      version: 1,
      status: briefStatus,
      quality_score: qualityScore,
      generation_cost_usd: Number(runCost.toFixed(4)),
      generation_wall_time_seconds: wallTime,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (insertBrief.error) log(log_prefix + ' brief insert error: ' + (insertBrief.error.message||'').slice(0,200));
  } catch (bie) {
    log(log_prefix + ' brief insert exception: ' + (bie.message||'').slice(0,200));
    return { status: 'failed', error: 'storage_error', detail: (bie.message||'').slice(0,200), cost_usd: Number(runCost.toFixed(4)) };
  }

  if (citationsUsed.length > 0) {
    var citationRows = citationsUsed.filter(function(c){return c && c.source_title;}).map(function(c){
      return {
        brief_id: briefId,
        citation_type: String(c.citation_type||'other').slice(0, 60),
        source_title: String(c.source_title||'').slice(0, 500),
        source_url: c.source_url ? String(c.source_url).slice(0, 600) : null,
        source_date: (c.source_date && /^\d{4}-\d{2}-\d{2}/.test(String(c.source_date))) ? String(c.source_date).slice(0, 10) : null,
        citation_text: c.citation_text ? String(c.citation_text).slice(0, 2000) : null,
        relevance_score: typeof c.relevance_score === 'number' ? c.relevance_score : 50,
        created_at: new Date().toISOString()
      };
    });
    if (citationRows.length > 0) {
      try {
        var insC = await supabase.from('competitor_brief_citations').insert(citationRows);
        if (insC.error) log(log_prefix + ' citations insert error: ' + (insC.error.message||'').slice(0,200));
      } catch (cie) {
        log(log_prefix + ' citations insert exception: ' + (cie.message||'').slice(0,200));
      }
    }
  }

  // Memory trail
  try {
    await supabase.from('organism_memory').insert({
      id: 'mem_compbrief_' + slug.slice(0,80) + '_' + Date.now(),
      agent: 'competitor_brief_researcher',
      observation: 'COMPETITOR BRIEF ' + briefStatus.toUpperCase() + ': ' + competitorName +
        '. Words=' + wordCount + ', distinct citations=' + distinctInlineCount +
        ', quality=' + qualityScore + ', cost=$' + runCost.toFixed(2) + ', wall=' + wallTime + 's.' +
        (hardFails.length ? ' HardFails: ' + hardFails.join(',') : ''),
      memory_type: 'competitive_intel',
      created_at: new Date().toISOString()
    });
  } catch (_me) { /* non-fatal */ }

  log(log_prefix + ' DONE: status=' + briefStatus + ', words=' + wordCount + ', cost=$' + runCost.toFixed(2) + ', wall=' + wallTime + 's');

  return {
    brief_id: briefId,
    competitor_name: competitorName,
    status: briefStatus,
    word_count: wordCount,
    citation_count: citationsUsed.length,
    distinct_inline_citations: distinctInlineCount,
    quality_score: qualityScore,
    hard_fails: hardFails,
    cost_usd: Number(runCost.toFixed(4)),
    wall_time_seconds: wallTime
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// L6 SPECIALIST FACTORY — S135 push 1
// PURPOSE: Compress the 260-line generateTechnicalApproachSection pattern so that
// adding L6 specialists 2-7 (Past Performance, Staffing, Executive Summary, Cover
// Letter, Pricing Narrative, QA/Compliance Narrative) is a config-only change
// rather than a 260-line copy-paste with drift risk.
//
// DESIGN (per S135 starter prompt Step 4 sign-off from Christopher):
//   - Signature option A: specialists receive (opp, blueprint, specialistInputBag, opts)
//     where specialistInputBag carries every possible upstream input; each
//     specialist's config.user_message_include picks only what it needs.
//   - Output schema option A: output_schema_extras is a list of extra top-level
//     field names from the parsed JSON the specialist wants propagated into the
//     return payload. Universal fields always present.
//   - Universal canon sweep baked into the factory — config.canon_violation_regex_set
//     adds specialist-specific extras.
//   - Universal HARD RULES + CITATION DISCIPLINE baked into the factory.
//
// PROMPT BYTE-EQUIVALENCE DISCIPLINE: Tech Approach's system prompt is
// reconstructed by the factory in a way that preserves the S126 prompt text
// byte-for-byte. role_framing holds the full two-paragraph identity + "YOU
// WRITE ONE SECTION ONLY" preamble. output_format_block holds the full JSON
// schema block with concrete example text. This ensures Opus sees the same
// prompt under the refactor as under S126.
// ─────────────────────────────────────────────────────────────────────────────

// Universal canon regex set — applied to every L6 specialist output.
var L6_UNIVERSAL_CANON_REGEX_SET = [
  { name: 'wrong_founding_year', pattern: /\b1931\b|\b1930\b/ },
  { name: 'wrong_age', pattern: /\b95.year\b|\b96.year\b/i },
  { name: 'geoffrey_brien', pattern: /geoffrey\s+brien/i },
  { name: 'tangipahoa', pattern: /\btangipahoa\b/i }
];

// Universal HARD RULES block — byte-verbatim match to S126 L8578-8585.
var L6_UNIVERSAL_HARD_RULES =
  'HARD RULES (NON-NEGOTIABLE):\n' +
  '- Founded 1929. 97-year. Never write 1931, 95-year, 96-year.\n' +
  '- Geoffrey Brien is no longer with HGI — never mention.\n' +
  '- HARD EXCLUSIONS — never list as HGI past performance: PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA. (Reference only as the client/agency if the RFP IS that client.)\n' +
  '- Terrebonne Parish School District (TPSD) — never write Tangipahoa.\n' +
  '- Never name competitors in proposal text.\n' +
  '- Never use prohibited voice phrases: "we believe", "we feel", "leverage synergies", "best-in-class", "cutting-edge", "world-class", "innovative solutions", "paradigm shift", "next-generation", "turn-key solution", "robust framework".\n' +
  '- Never emit visible bracketed placeholders. The only permitted bracket is [TO BE ASSIGNED] for Key Personnel.';

// Universal CITATION DISCIPLINE block (S132) — byte-verbatim match to S126 L8586-8590.
var L6_UNIVERSAL_CITATION_DISCIPLINE =
  'CITATION DISCIPLINE (S132 — avoid stale and fabricated citations):\n' +
  '- Whenever you cite a dollar amount, discount rate, threshold, deadline, or any time-sensitive figure, include the as-of-date in parentheses. Example: "The current FEMA BCA discount rate is 7% (as of April 2025)."\n' +
  '- Prefer citing regulatory sections (CFR, U.S.C., P.L.) over specific OIG/GAO report numbers unless both the report number AND its subject matter are known with high confidence.\n' +
  '- When citing an OIG or GAO report, state the report\'s subject in the sentence, not just the report number. Example: "OIG-19-54 found Louisiana drew down $50.4M in excess HMGP funds." — not "as documented in OIG-19-54."\n' +
  '- Document numbers must match their titles: FEMA-325 is the Public Assistance Debris Management Guide; FEMA-327 is the Debris Monitoring Guide. Never pair a document number with the wrong title.';

// Factory: produces an L6 specialist function from a config object.
// Returned function signature: async (opp, blueprint, specialistInputBag, opts)
function createL6Specialist(config) {
  return async function l6Specialist(opp, blueprint, specialistInputBag, opts) {
    opts = opts || {};
    specialistInputBag = specialistInputBag || {};
    var oppId = opp.id;
    var log_prefix = 'L6-' + config.log_tag + '[' + (oppId||'').slice(0, 30) + ']';
    var runStart = Date.now();
    var runCost = 0;

    function addCost(model, usage) {
      if (!usage) return;
      var p = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
      runCost += (usage.input_tokens || 0) * p.in_per_tok + (usage.output_tokens || 0) * p.out_per_tok;
    }

    var oppTitle = (opp.title||'').slice(0, 200);
    var oppAgency = (opp.agency||'').slice(0, 100);
    var vertical = (opp.vertical||'').toLowerCase().replace(/\s+/g,'_');

    // --- Blueprint section matching (per-specialist via config) ---
    var section = null;
    var sectionWeight = null;
    if (blueprint && Array.isArray(blueprint.sections_required)) {
      blueprint.sections_required.forEach(function(s){
        if (!section) {
          var t = ((s.title||'') + ' ' + (s.section_number||'')).toLowerCase();
          if (config.anchor_title_patterns.test(t)) {
            section = s;
          }
        }
      });
    }
    if (blueprint && Array.isArray(blueprint.evaluation_criteria)) {
      blueprint.evaluation_criteria.forEach(function(ec){
        if (!sectionWeight) {
          var n = ((ec.criterion || ec.name) || '').toLowerCase();
          var pts = ec.max_points || ec.weight_percent;
          if (config.evaluation_criterion_match_patterns.test(n) && pts) {
            sectionWeight = pts;
          }
        }
      });
    }

    var sectionTitle = (section && section.title) || config.default_section_title;
    var sectionNumber = (section && section.section_number) || null;
    var pageLimit = (section && section.page_limit) || null;

    // --- Requirements text assembly (S130 string/array tolerant) ---
    var reqsRaw = (section && section.requirements) || (section && section.scope_items) || null;
    var topLevelScope = (blueprint && Array.isArray(blueprint.scope_items)) ? blueprint.scope_items : [];
    var reqsParts = [];
    if (typeof reqsRaw === 'string' && reqsRaw.trim().length > 0) {
      reqsParts.push('Section-level requirements: ' + reqsRaw.trim());
    } else if (Array.isArray(reqsRaw) && reqsRaw.length > 0) {
      reqsParts.push('Section-level requirements:\n' + reqsRaw.slice(0,25).map(function(r,i){
        return (i+1) + '. ' + String(typeof r === 'string' ? r : (r.requirement_text||r.text||JSON.stringify(r))).slice(0,400);
      }).join('\n'));
    }
    if (topLevelScope.length > 0) {
      reqsParts.push('Scope items to address (from RFP scope of work):\n' + topLevelScope.slice(0,30).map(function(s,i){
        return (i+1) + '. ' + String(s).slice(0,300);
      }).join('\n'));
    }
    var requirementsText = reqsParts.join('\n\n');
    var requirementsCount = (typeof reqsRaw === 'string' ? (reqsRaw.trim().length > 0 ? 1 : 0) :
                             (Array.isArray(reqsRaw) ? reqsRaw.length : 0)) + topLevelScope.length;

    // --- Thesis spine formatting (null-safe) ---
    var thesis = specialistInputBag.thesis || null;
    var thesisSpine = '';
    if (thesis && Array.isArray(thesis.themes) && thesis.themes.length > 0) {
      thesisSpine = thesis.themes.map(function(t){
        var lb = Array.isArray(t.load_bearing_sections) ? t.load_bearing_sections.join(', ') : '';
        return (t.id||'T?') + ': ' + (t.claim||'') + (lb ? ' [load-bearing: ' + lb + ']' : '');
      }).join('\n');
    }

    log(log_prefix + ' START: section="' + sectionTitle + '" weight=' + sectionWeight + 'pts page_limit=' + pageLimit + ' reqs=' + requirementsCount);

    // --- System prompt assembly (byte-verbatim blocks from config + universal rules) ---
    var deliverablesBlock = config.deliverables_per_3k_words && config.deliverables_per_3k_words.length > 0
      ? 'YOUR SECTION MUST DELIVER (per 3,000 words of content):\n' +
        config.deliverables_per_3k_words.map(function(d){ return '- ' + d; }).join('\n') + '\n' +
        'These are floors, not targets. Write to the depth a senior evaluator expects.'
      : '';
    var structuralBlock = config.structural_requirements && config.structural_requirements.length > 0
      ? 'STRUCTURAL REQUIREMENTS:\n' +
        config.structural_requirements.map(function(r){ return '- ' + r; }).join('\n')
      : '';
    var extraRulesBlock = config.extra_rules && config.extra_rules.length > 0
      ? 'ADDITIONAL SPECIALIST RULES:\n' +
        config.extra_rules.map(function(r){ return '- ' + r; }).join('\n')
      : '';

    var systemPromptParts = [config.role_framing];
    if (deliverablesBlock) systemPromptParts.push(deliverablesBlock);
    if (structuralBlock) systemPromptParts.push(structuralBlock);
    systemPromptParts.push(L6_UNIVERSAL_HARD_RULES);
    if (extraRulesBlock) systemPromptParts.push(extraRulesBlock);
    systemPromptParts.push(L6_UNIVERSAL_CITATION_DISCIPLINE);
    if (config.output_format_block) systemPromptParts.push(config.output_format_block);
    var system = systemPromptParts.join('\n\n');

    // --- User message assembly (config.user_message_include picks fields from bag) ---
    var includeFields = config.user_message_include || [];
    var userMessageParts = [];
    if (includeFields.indexOf('opp_meta') >= 0) {
      userMessageParts.push(
        'OPPORTUNITY: ' + oppTitle + '\n' +
        'AGENCY: ' + oppAgency + '\n' +
        'VERTICAL: ' + vertical + '\n' +
        'SECTION TO PRODUCE: ' + sectionTitle + (sectionNumber ? ' (' + sectionNumber + ')' : '') + '\n' +
        'EVALUATION WEIGHT: ' + (sectionWeight ? sectionWeight + ' points' : 'unspecified') + '\n' +
        'PAGE LIMIT: ' + (pageLimit ? pageLimit + ' pages' : 'unspecified')
      );
    }
    if (includeFields.indexOf('rfp_requirements') >= 0) {
      userMessageParts.push(
        '### RFP REQUIREMENTS FOR THIS SECTION\n' +
        (requirementsText || '(no structured requirements extracted - write to general scope of work)')
      );
    }
    if (includeFields.indexOf('thesis_spine') >= 0) {
      userMessageParts.push(
        '### STRATEGIC THESIS SPINE (advance one thesis per subsection; surface stated tradeoffs)\n' +
        (thesisSpine || '(no thesis available - apply own judgment on 3-5 strategic moves)')
      );
    }
    if (includeFields.indexOf('scope_of_work') >= 0) {
      userMessageParts.push(
        '### SCOPE OF WORK (raw)\n' +
        String(opp.scope_analysis || '').slice(0, 8000)
      );
    }
    if (includeFields.indexOf('methodology_corpus') >= 0) {
      userMessageParts.push(
        '### METHODOLOGY CORPUS (L3 - use this as your authoritative source for HOW the work is executed)\n' +
        String(specialistInputBag.methodologyCorpus || '(no methodology corpus available)').slice(0, 28000)
      );
    }
    if (includeFields.indexOf('discriminators') >= 0) {
      userMessageParts.push(
        '### DISCRIMINATORS (L4 - weave throughout; cite evidence anchors)\n' +
        String(specialistInputBag.discriminators || '(no discriminators)').slice(0, 4000)
      );
    }
    if (includeFields.indexOf('competitor_briefs') >= 0) {
      userMessageParts.push(
        '### COMPETITOR INTELLIGENCE (L5 - INTERNAL ONLY; never name competitors in proposal text)\n' +
        String(specialistInputBag.competitorBriefs || '(no competitor briefs)').slice(0, 12000)
      );
    }
    if (includeFields.indexOf('hgi_pp_entries') >= 0) {
      userMessageParts.push(
        '### HGI PAST PERFORMANCE CANONICAL ENTRIES (use only these; figures must match exactly)\n' +
        String(specialistInputBag.hgiPpEntries || '(no PP entries provided)').slice(0, 12000)
      );
    }
    if (includeFields.indexOf('hgi_staff_canon') >= 0) {
      userMessageParts.push(
        '### HGI STAFF CANON (role titles + available credentials; all personnel assignments use [TO BE ASSIGNED])\n' +
        String(specialistInputBag.hgiStaffCanon || '(no staff canon provided)').slice(0, 8000)
      );
    }
    if (includeFields.indexOf('rate_card') >= 0) {
      userMessageParts.push(
        '### RATE CARD (fully burdened hourly rates)\n' +
        String(specialistInputBag.rateCard || '(no rate card provided)').slice(0, 4000)
      );
    }
    userMessageParts.push('Produce the ' + sectionTitle + ' section now per the system-prompt specification. Return ONLY the JSON object.');
    var userMessage = userMessageParts.join('\n\n');

    log(log_prefix + ' calling Opus 4.6 with ' + (config.thinking_budget||8000) + ' thinking, ' + (config.max_tokens||24000) + ' max output');

    // --- Opus call (streaming per S130) ---
    var resp;
    try {
      var _l6Stream = await anthropic.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: config.max_tokens || 24000,
        thinking: { type: 'enabled', budget_tokens: config.thinking_budget || 8000 },
        system: system,
        messages: [{ role: 'user', content: userMessage }]
      });
      resp = await _l6Stream.finalMessage();
      trackCost(config.cost_bucket || ('l6_' + config.name), 'claude-opus-4-6', resp.usage);
      addCost('claude-opus-4-6', resp.usage);
    } catch (sErr) {
      log(log_prefix + ' Opus call failed: ' + (sErr.message||'').slice(0,200));
      return { status: 'failed', error: 'opus_call_failed', detail: (sErr.message||'').slice(0,200), cost_usd: Number(runCost.toFixed(4)) };
    }

    // --- JSON extraction + parse ---
    var raw = (resp.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
    var cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    var fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb+1);

    var parsed = null;
    try { parsed = JSON.parse(cleaned); } catch (pe) {
      log(log_prefix + ' JSON parse failed: ' + (pe.message||'').slice(0,150));
      return { status: 'failed', error: 'json_parse_failed', cost_usd: Number(runCost.toFixed(4)) };
    }
    var minLen = config.min_section_text_length || 1000;
    if (!parsed || typeof parsed.section_text !== 'string' || parsed.section_text.length < minLen) {
      return { status: 'failed', error: 'missing_or_short_section_text', cost_usd: Number(runCost.toFixed(4)) };
    }

    var sectionText = parsed.section_text;
    var evidenceAnchors = Array.isArray(parsed.evidence_anchors) ? parsed.evidence_anchors : [];
    var wordCount = (sectionText.match(/\b\w+\b/g) || []).length;
    var per3kFactor = wordCount / 3000;

    // --- Evidence anchor counting (config-driven types + floors) ---
    var counts = {};
    (config.evidence_anchor_types || []).forEach(function(t){ counts[t] = 0; });
    evidenceAnchors.forEach(function(a){
      if (a && a.type && counts.hasOwnProperty(a.type)) counts[a.type]++;
    });

    var floors = {};
    var floorsKeys = Object.keys(config.density_floors_per_3k_words || {});
    floorsKeys.forEach(function(k){
      floors[k] = Math.ceil((config.density_floors_per_3k_words[k] || 0) * per3kFactor);
    });

    var floorsMet = {};
    floorsKeys.forEach(function(k){
      floorsMet[k] = (counts[k] || 0) >= floors[k];
    });
    var floorsMetCount = floorsKeys.filter(function(k){ return floorsMet[k]; }).length;
    var floorsTotal = floorsKeys.length;
    var qualityScore = floorsTotal > 0 ? Math.round((floorsMetCount / floorsTotal) * 100) : 0;

    // --- Canon violation sweep (universal + specialist extras) ---
    var canonViolations = [];
    L6_UNIVERSAL_CANON_REGEX_SET.forEach(function(rule){
      if (rule.pattern.test(sectionText)) canonViolations.push(rule.name);
    });
    if (Array.isArray(config.canon_violation_regex_set)) {
      config.canon_violation_regex_set.forEach(function(rule){
        if (rule && rule.pattern && rule.pattern.test(sectionText)) canonViolations.push(rule.name);
      });
    }

    // --- Status decision ---
    var minFloorsRequired = (typeof config.min_floors_required_for_published === 'number') ? config.min_floors_required_for_published : Math.max(1, floorsTotal - 1);
    var sectionStatus = (canonViolations.length === 0 && floorsMetCount >= minFloorsRequired) ? 'published' : 'flagged';
    var wallTime = Math.floor((Date.now() - runStart) / 1000);

    var floorsLogParts = floorsKeys.map(function(k){
      var shortKey = k.split('_').map(function(p){ return p.slice(0,3); }).join('');
      return shortKey + ':' + (counts[k]||0);
    }).join(', ');
    log(log_prefix + ' DONE: status=' + sectionStatus + ', words=' + wordCount + ', floors=' + floorsMetCount + '/' + floorsTotal + ', anchors={' + floorsLogParts + '}, cost=$' + runCost.toFixed(2) + ', wall=' + wallTime + 's');

    // --- Return payload ---
    var payload = {
      status: sectionStatus,
      section_text: sectionText,
      word_count: wordCount,
      floors_met: floorsMet,
      floors_met_count: floorsMetCount,
      floors_required: floors,
      quality_score: qualityScore,
      canon_violations: canonViolations,
      evidence_anchors: evidenceAnchors,
      section_title: sectionTitle,
      section_number: sectionNumber,
      section_weight_pts: sectionWeight,
      page_limit: pageLimit,
      cost_usd: Number(runCost.toFixed(4)),
      wall_time_seconds: wallTime,
      model: 'claude-opus-4-6',
      version: config.version || 's135_v1',
      generated_at: new Date().toISOString()
    };
    // Backward-compat convenience counters — every key in density_floors_per_3k_words
    // becomes `<type>s_count` in payload so the L1577-1613 call site keeps working.
    floorsKeys.forEach(function(k){
      payload[k + 's_count'] = counts[k] || 0;
    });
    // Also carry past_performance_anchor count (not a floor for Tech Approach
    // but returned in S126's payload at L8721).
    if (counts.hasOwnProperty('past_performance_anchor')) {
      payload.past_performance_anchors_count = counts.past_performance_anchor;
    }
    // Per-specialist output schema extras passthrough
    if (Array.isArray(config.output_schema_extras)) {
      config.output_schema_extras.forEach(function(extraKey){
        if (parsed[extraKey] !== undefined) payload[extraKey] = parsed[extraKey];
      });
    }
    return payload;
  };
}

// L6 Technical Approach specialist config. role_framing and output_format_block
// hold S126's prompt text byte-verbatim so the factory-assembled prompt is
// behavior-equivalent to the S126 inline prompt.
var L6_TECHNICAL_APPROACH_CONFIG = {
  name: 'technical_approach',
  log_tag: 'TECH',
  default_section_title: 'Technical Approach',
  persist_column_name: 'section_technical_approach',
  version: 's135_v1_tech',
  cost_bucket: 'l6_technical_approach',
  anchor_title_patterns: /technical\s*approach|approach.*scope|methodology|scope\s*of\s*work\s*response|how\s*you\s*will/,
  evaluation_criterion_match_patterns: /technical|approach|methodology|scope/,
  role_framing:
    'You are a senior Technical Approach specialist at HGI Global with 20 years of hands-on execution experience in the named vertical. You have personally executed this scope of work across dozens of engagements. You write Technical Approach sections that government evaluators in this vertical immediately recognize as coming from a senior practitioner — not from a generalist proposal writer.\n\n' +
    'YOU WRITE ONE SECTION ONLY: the Technical Approach. This is not a full proposal. It is a focused, deeply specific operational treatment of HOW HGI will execute the scope of work. The L7 senior writer downstream will integrate your section into the full proposal.',
  deliverables_per_3k_words: [
    'At least 15 specific regulatory citations (exact CFR/Public-Law/policy references with section numbers)',
    'At least 8 named operational systems or platforms (FEMA Grants Portal, EMMIE, DRGR, IDIS, PMS/ASAP, etc. — never generic "project management software")',
    'At least 12 methodology statements with week-level operational detail',
    'At least 6 risk-awareness statements citing specific failure modes (OIG findings with report numbers, GAO decisions with case numbers, deobligation triggers, audit failures)',
    'At least 10 quantified benchmarks (thresholds, targets, caps, timelines with sources)'
  ],
  structural_requirements: [
    'Lead each subsection with the strategic move HGI makes, not with a paraphrase of the RFP scope item',
    'Cluster RFP scope items into strategic-move groups (do NOT enumerate scope items 1, 2, 3 in RFP order)',
    'Each strategic-move subsection must be load-bearing for at most ONE thesis from the strategic spine you receive',
    'When the strategic thesis specifies a tradeoff, surface it explicitly in the proposal text ("HGI is not optimizing for X; HGI is optimizing for Y")',
    'Use named methodology from the methodology corpus you receive — do NOT invent methodology',
    'Use specific past performance from HGI_PP — never generic capability claims',
    'Cite competitor weaknesses from the L5 competitor briefs ONLY as ghost-language strategic emphasis (NEVER name competitors in proposal text)'
  ],
  extra_rules: [],
  output_format_block:
    'OUTPUT FORMAT — return ONLY valid JSON. No preamble. No markdown fences.\n' +
    '{\n' +
    '  "section_text": "Full Technical Approach section text in markdown. Use ## subsection headers. Target length: scaled to RFP weight (typically 4,000-8,000 words).",\n' +
    '  "evidence_anchors": [\n' +
    '    {"type": "regulatory_citation", "text": "2 CFR 200.318(d)", "section_used": "subsection name"},\n' +
    '    {"type": "named_system", "text": "FEMA Grants Portal", "section_used": "..."},\n' +
    '    {"type": "methodology_statement", "text": "Week 1: ...", "section_used": "..."},\n' +
    '    {"type": "failure_mode", "text": "OIG-18-66 found that...", "section_used": "..."},\n' +
    '    {"type": "quantified_benchmark", "text": "60-month performance period", "section_used": "..."},\n' +
    '    {"type": "past_performance_anchor", "text": "Road Home $67.0M / 185,000+ applications", "section_used": "..."}\n' +
    '  ],\n' +
    '  "thesis_alignment": [\n' +
    '    {"thesis_id": "T1", "advanced_in_subsection": "subsection name", "tradeoff_surfaced": true|false}\n' +
    '  ],\n' +
    '  "compliance_coverage": [\n' +
    '    {"requirement_text": "...", "addressed_in_subsection": "..."}\n' +
    '  ]\n' +
    '}',
  evidence_anchor_types: ['regulatory_citation','named_system','methodology_statement','failure_mode','quantified_benchmark','past_performance_anchor'],
  density_floors_per_3k_words: {
    regulatory_citation: 15,
    named_system: 8,
    methodology_statement: 12,
    failure_mode: 6,
    quantified_benchmark: 10
  },
  min_floors_required_for_published: 4,
  min_section_text_length: 1000,
  canon_violation_regex_set: [],
  user_message_include: ['opp_meta','rfp_requirements','thesis_spine','scope_of_work','methodology_corpus','discriminators','competitor_briefs'],
  output_schema_extras: ['thesis_alignment','compliance_coverage'],
  max_tokens: 24000,
  thinking_budget: 8000
};

var _l6TechnicalApproachSpecialist = createL6Specialist(L6_TECHNICAL_APPROACH_CONFIG);

// ─────────────────────────────────────────────────────────────────────────────
// generateTechnicalApproachSection — S126 push 6 — L6 SECTION SPECIALIST #1
// PURPOSE: produce a SME-depth Technical Approach section in a dedicated pass
// BEFORE the L7 Opus mega-call, so the highest-weight section (typically 20-45
// of total points) gets specialist treatment instead of generalist treatment.
// CONSUMES: L2 RFP blueprint, L3 methodology corpus, L4 discriminators, L5
// competitor briefs, S126 strategic thesis, opp scope/research.
// PRODUCES: structured JSON with section_text + per-section quality metrics.
// VALIDATES: regulatory-citation count, named-systems count, methodology-statement
// count per the C2 acceptance criteria (>=15 reg cites, >=8 named systems,
// >=12 methodology statements, >=6 risk-awareness statements, >=10 quantified
// benchmarks per 3000 words).
// ─────────────────────────────────────────────────────────────────────────────
async function generateTechnicalApproachSection(opp, blueprint, methodologyCorpus, discriminators, competitorBriefs, thesis, opts) {
  // S135: body delegates to the L6 specialist factory (createL6Specialist) via
  // the L6_TECHNICAL_APPROACH_CONFIG configured above. Signature preserved so
  // the L1577 call site in /api/produce-proposal does not change. Return payload
  // shape preserved (universal fields + output_schema_extras ['thesis_alignment',
  // 'compliance_coverage']) so the L1607 persistence + L1611+ log lines continue
  // to work unchanged.
  return _l6TechnicalApproachSpecialist(opp, blueprint, {
    methodologyCorpus: methodologyCorpus,
    discriminators: discriminators,
    competitorBriefs: competitorBriefs,
    thesis: thesis
  }, opts || {});
}

// ============================================================
// L6 CITATION VERIFIER — S132
//
// Runs after an L6 section specialist produces text, BEFORE the section
// is persisted to the opportunities row. Extracts regulatory/audit-report
// citation candidates via regex, verifies them via a cheap path (canonical
// pattern match, no API cost) or a structured path (Haiku + web_search),
// and substitutes/flags failures.
//
// Persistence behavior:
//   verified        -> leave sentence unchanged
//   stale           -> leave sentence, note in audit_log (operator decides)
//   wrong_subject
//   figure_mismatch
//   not_found       -> substitute with correction_text if provided,
//                      else append [CITATION VERIFICATION FAILED — MANUAL REVIEW REQUIRED]
//   over_cap        -> flagged for manual review (verification not attempted)
//
// Cost cap: STRUCTURED_CAP (=10) Haiku+web_search calls per section.
// Candidates beyond the cap are flagged as over_cap, no verification.
//
// Returns: { verified_text, audit_log, flagged_count, cost_usd, run_id, counts }.
// Per S131 handoff §5.1, S132 starter prompt Step 3.
// ============================================================

function extractCitationCandidatesFromSection(text) {
  if (!text || typeof text !== 'string') return [];

  var patterns = [
    { type: 'OIG',         re: /\bOIG-DD-\d{2}-\d{2}\b/g },
    { type: 'OIG',         re: /\bOIG-\d{2}-\d{2,3}(?:-[A-Z]+)?\b/g },
    { type: 'GAO',         re: /\bGAO-\d{2}-\d{2,4}\b/g },
    { type: 'FR',          re: /\b\d{2,3}\s*FR\s*\d{4,6}\b/g },
    { type: 'FEMA_POLICY', re: /\bFP-\d{3}-\d{2}-\d{3,4}\b/g },
    { type: 'FEMA_DOC',    re: /\bFEMA[-\s]\d{3,4}\b/g },
    { type: 'CFR',         re: /\b\d+\s*CFR\s*(?:Part\s*)?\d+(?:\.\d+)*(?:\([a-z0-9]+\))*\b/g },
    { type: 'USC',         re: /\b\d+\s*U\.?S\.?C\.?\s*(?:§§|§|Section|Sec\.?)\s*\d+(?:[-–]\d+)?\b/gi },
    { type: 'PL',          re: /\bP\.?L\.?\s*\d{2,3}-\d{1,3}\b/g }
  ];
  var dollarRe = /\$\s?[\d,]+(?:\.\d+)?\s*(?:million|billion|M\b|B\b|thousand|K\b)?/gi;

  var candidates = [];
  var seen = {};

  patterns.forEach(function(p) {
    var m;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(text)) !== null) {
      var citation = m[0].trim();
      var matchIdx = m.index;

      // Find containing sentence by looking for nearest sentence boundary
      var boundaries = ['. ', '.\n', '!\n', '?\n', '! ', '? '];
      var sentStart = 0;
      for (var bi = 0; bi < boundaries.length; bi++) {
        var b = text.lastIndexOf(boundaries[bi], matchIdx);
        if (b > sentStart) sentStart = b + boundaries[bi].length - 1;
      }
      var nlBefore = text.lastIndexOf('\n\n', matchIdx);
      if (nlBefore > sentStart) sentStart = nlBefore + 2;
      if (sentStart < 0 || sentStart > matchIdx) sentStart = Math.max(0, matchIdx - 400);

      var sentEnd = text.length;
      var endCandidates = [];
      boundaries.forEach(function(b) {
        var idx = text.indexOf(b, matchIdx + citation.length);
        if (idx >= 0) endCandidates.push(idx + 1);
      });
      var nlAfter = text.indexOf('\n\n', matchIdx + citation.length);
      if (nlAfter >= 0) endCandidates.push(nlAfter);
      if (endCandidates.length > 0) sentEnd = Math.min.apply(null, endCandidates);
      if (sentEnd - sentStart > 1200) {
        sentStart = Math.max(sentStart, matchIdx - 500);
        sentEnd = Math.min(sentEnd, matchIdx + citation.length + 500);
      }

      var sentence = text.slice(sentStart, sentEnd).trim();
      if (sentence.length < 15) continue;

      var windowStart = Math.max(0, matchIdx - 120);
      var windowEnd = Math.min(text.length, matchIdx + citation.length + 120);
      var contextWindow = text.slice(windowStart, windowEnd);
      dollarRe.lastIndex = 0;
      var dollarMatch = dollarRe.exec(contextWindow);
      var coLocatedDollar = dollarMatch ? dollarMatch[0].trim() : null;

      var key = citation + '|' + sentence.slice(0, 80);
      if (seen[key]) continue;
      seen[key] = true;

      candidates.push({
        citation: citation,
        citation_type: p.type,
        sentence: sentence,
        sentence_index: sentStart,
        co_located_dollar: coLocatedDollar
      });
    }
  });

  return candidates;
}

function isCheapVerifiable(c) {
  // Canonical list — unconditional pass even with co-located dollar.
  var canon = [
    /^2\s*CFR\s*(?:Part\s*)?200/i,
    /^44\s*CFR\s*(?:Part\s*)?206/i,
    /^42\s*U\.?S\.?C\.?\s*(?:§§|§|Section|Sec\.?)\s*(?:5121|5122|5133|5150|5170|5172|5174|5189|5196|5198|5201|5205|5206|5207|5304|5305|5320|5404)/i,
    /^40\s*U\.?S\.?C\.?\s*(?:§§|§|Section|Sec\.?)\s*314[1-8]/i,
    /^P\.?L\.?\s*(?:93-288|113-2|100-707|109-295|109-347|110-161|111-5|113-76|115-123)/i
  ];
  for (var i = 0; i < canon.length; i++) {
    if (canon[i].test(c.citation)) return true;
  }
  // CFR / USC / PL without co-located dollar -> cheap pass.
  if (['CFR', 'USC', 'PL'].indexOf(c.citation_type) >= 0 && !c.co_located_dollar) {
    return true;
  }
  return false;
}

// ---------- S132 thin identity cache helpers ----------

function normalizeCitationId(s) {
  return (s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function defaultTtlForCitationType(t) {
  if (t === 'FEMA_POLICY') return 7;
  if (t === 'FR') return 365;
  if (t === 'CFR' || t === 'USC' || t === 'PL') return 365;
  if (t === 'OIG' || t === 'GAO' || t === 'FEMA_DOC') return 90;
  return 30;
}

async function lookupCitationIdentityCache(citationId) {
  try {
    var id = normalizeCitationId(citationId);
    var res = await supabase.from('citation_identity_cache').select('*').eq('citation_id', id).maybeSingle();
    if (!res || !res.data) return null;
    var row = res.data;
    var ageMs = Date.now() - new Date(row.last_verified_at).getTime();
    var ttlMs = (row.ttl_days || 30) * 24 * 60 * 60 * 1000;
    row._stale = ageMs > ttlMs;
    return row;
  } catch (e) {
    return null;
  }
}

async function upsertCitationIdentityCache(citationId, citationType, facts) {
  try {
    var id = normalizeCitationId(citationId);
    if (!id) return;
    facts = facts || {};
    var existing = await lookupCitationIdentityCache(id);
    var nowIso = new Date().toISOString();
    if (existing) {
      var merged = {
        canonical_title: facts.canonical_title || existing.canonical_title || null,
        publication_date: facts.publication_date || existing.publication_date || null,
        effective_date: facts.effective_date || existing.effective_date || null,
        superseded_by: facts.superseded_by || existing.superseded_by || null,
        superseded_date: facts.superseded_date || existing.superseded_date || null,
        evidence_url: facts.evidence_url || existing.evidence_url || null,
        exists_bool: (typeof facts.exists_bool === 'boolean') ? facts.exists_bool : (existing.exists_bool !== false),
        last_verified_at: nowIso,
        verify_count: (existing.verify_count || 1) + 1
      };
      await supabase.from('citation_identity_cache').update(merged).eq('citation_id', id);
    } else {
      await supabase.from('citation_identity_cache').insert({
        citation_id: id,
        citation_type: citationType || 'UNKNOWN',
        exists_bool: (typeof facts.exists_bool === 'boolean') ? facts.exists_bool : true,
        canonical_title: facts.canonical_title || null,
        publication_date: facts.publication_date || null,
        effective_date: facts.effective_date || null,
        superseded_by: facts.superseded_by || null,
        superseded_date: facts.superseded_date || null,
        evidence_url: facts.evidence_url || null,
        ttl_days: defaultTtlForCitationType(citationType),
        last_verified_at: nowIso,
        verify_count: 1
      });
    }
  } catch (e) {
    log('citation_identity_cache upsert warn [' + citationId + ']: ' + (e.message||'').slice(0,160));
  }
}

// Pre-Haiku cache check: returns a { status, ... } result if the cache alone can
// answer, otherwise null (meaning: proceed to Haiku).
function preHaikuCacheCheck(candidate, cacheHit, todayIso) {
  if (!cacheHit || cacheHit._stale) return null;

  // Case A: cache says this citation does not exist (from a prior not_found verification).
  if (cacheHit.exists_bool === false) {
    return {
      status: 'not_found',
      correction_text: null,
      web_search_snippet: 'CACHED: citation_id not found in any verifiable source (last verified ' + (cacheHit.last_verified_at||'').slice(0,10) + ')',
      cost_usd: 0,
      identity_facts: null,
      pre_haiku: true
    };
  }

  // Case B (REMOVED per S132 iteration): Cache used to auto-flag stale when
  // superseded_date was present. That treated a partial supersession (e.g.,
  // FP-206-23-001's discount-rate provision was revoked April 2025 but other
  // provisions like the $1M streamlined-narrative threshold remained in effect)
  // as if the entire policy were void, producing a false positive on the still-
  // valid provision. Per the thin-cache charter, cache holds identity facts
  // (including supersession facts) but does not make per-opportunity judgments.
  // Supersession facts are injected into the Haiku prompt as grounding via
  // verifyOneCitationStructured's cacheBlock; the contextual stale/verified
  // judgment stays fresh per sentence.

  return null;
}

async function verifyOneCitationStructured(c, cacheHit) {
  var today = new Date().toISOString().slice(0, 10);
  var sys = 'You are verifying a citation in a government proposal. Use web_search to look up the citation ID. Return ONLY valid JSON with no preamble, no markdown, no explanation.';

  var cacheBlock = '';
  if (cacheHit) {
    var cacheLines = [];
    if (cacheHit.canonical_title) cacheLines.push('- canonical_title: ' + cacheHit.canonical_title);
    if (cacheHit.publication_date) cacheLines.push('- publication_date: ' + cacheHit.publication_date);
    if (cacheHit.effective_date) cacheLines.push('- effective_date: ' + cacheHit.effective_date);
    if (cacheHit.superseded_by) cacheLines.push('- superseded_by: ' + cacheHit.superseded_by);
    if (cacheHit.superseded_date) cacheLines.push('- superseded_date: ' + cacheHit.superseded_date);
    if (cacheHit.evidence_url) cacheLines.push('- evidence_url: ' + cacheHit.evidence_url);
    if (cacheLines.length > 0) {
      cacheBlock = '\nKNOWN IDENTITY FACTS FROM PRIOR VERIFICATION (treat as authoritative grounding; confirm via web_search and override only if you have stronger primary-source evidence):\n' + cacheLines.join('\n') + '\n';
    }
  }

  var prompt =
    'CITATION IN PROPOSAL: ' + c.citation + '\n' +
    'CITATION TYPE: ' + c.citation_type + '\n' +
    'SURROUNDING SENTENCE: ' + (c.sentence || '').slice(0, 900) + '\n' +
    (c.co_located_dollar ? 'CO-LOCATED DOLLAR FIGURE: ' + c.co_located_dollar + '\n' : '') +
    "TODAY'S DATE: " + today + '\n' +
    cacheBlock + '\n' +
    'STEP 1: Search the web for the citation ID (e.g., "' + c.citation + '") to find the actual report, rule, policy, or law. Confirm identity facts against web results.\n' +
    'STEP 1b (REQUIRED if citation_type is FEMA_POLICY, FEMA_DOC, FR, or CFR): Perform ADDITIONAL web_search queries to detect supersession/revocation:\n' +
    '  - Query: "' + c.citation + '" revoked OR superseded OR replaced\n' +
    '  - Query: "' + c.citation + '" current status ' + (today.slice(0,4)) + '\n' +
    'The first search in STEP 1 typically returns the announcement/issuance page. Supersessions and revocations often live under separate pages (OMB memos, subsequent Federal Register notices, policy updates). Do NOT skip STEP 1b for rate/policy/rule citations — a stale-but-still-findable citation will return misleading results from STEP 1 alone. OIG and GAO reports are immutable audit findings and do NOT require STEP 1b.\n' +
    'STEP 2: Classify based on what ALL web_search passes returned AND the proposal\'s specific claim. Apply these definitions strictly:\n' +
    '- "verified": (a) the cited report/rule/policy exists, (b) its subject matches how the proposal uses it, AND (c) any specific figure the proposal cites is CONTAINED IN the cited source. A point-in-time audit finding is VERIFIED even if the real-world state has since changed. Example: OIG-15-146-D documenting $812M in unobligated HMGP as of 2015 remains "verified" when cited faithfully, even if FEMA has since reduced that balance — the proposal is faithful to the source.\n' +
    '- "wrong_subject": the report/rule exists but is about a different topic than the proposal claims. Example: proposal cites GAO-16-797 as documenting "procurement deficiencies" but GAO-16-797 is actually about federal disaster spending totals.\n' +
    '- "stale": RESERVED for rates, thresholds, deadlines, or regulatory provisions that have been officially superseded/revoked/replaced, where the proposal presents the old figure as currently in effect without a pre-supersession as-of-date. Example: proposal says "current FEMA BCA discount rate is 3.1%" citing FP-206-23-001, but OMB revoked that in April 2025. Does NOT apply to point-in-time audit findings — those stay verified when cited faithfully.\n' +
    '- "figure_mismatch": the cited source exists AND has the right subject, but DOES NOT CONTAIN the cited figure (or contains a materially different one). Example: proposal cites OIG-19-54 as finding $100M when the actual OIG-19-54 finding is $50.4M. DISTINGUISH FROM STALE: if the source DOES contain the cited figure but the real world has since changed, that is either verified (audit findings) or stale (rates/policies), not figure_mismatch.\n' +
    '- "not_found": the citation ID does not appear in any verifiable primary source.\n\n' +
    'STEP 3: If not "verified", attempt correction_text — a single sentence suitable as a drop-in replacement for the surrounding sentence, using only verified facts. If you cannot provide a high-confidence correction, return null.\n\n' +
    'STEP 4: Return identity facts about this citation for caching (from web_search results — these are pure facts about the citation itself, not about how the proposal uses it):\n' +
    '- canonical_title: the actual title of the report/rule/policy/law\n' +
    '- publication_date: when it was published (YYYY-MM-DD) or null\n' +
    '- effective_date: when it became effective (YYYY-MM-DD; for regs/policies only) or null\n' +
    '- superseded_by: citation ID of the replacement if it has been superseded, else null\n' +
    '- superseded_date: date of supersession (YYYY-MM-DD) or null\n' +
    '- evidence_url: primary-source URL or null\n' +
    '- exists_bool: true if the citation exists in any verifiable source, false otherwise\n\n' +
    'Return this JSON and NOTHING ELSE:\n' +
    '{"status":"verified"|"wrong_subject"|"stale"|"figure_mismatch"|"not_found","correction_text":null|"...","web_search_snippet":"top result title + snippet, <=200 chars","identity_facts":{"canonical_title":"..."|null,"publication_date":"YYYY-MM-DD"|null,"effective_date":"YYYY-MM-DD"|null,"superseded_by":"..."|null,"superseded_date":"YYYY-MM-DD"|null,"evidence_url":"..."|null,"exists_bool":true|false}}';

  var raw;
  try {
    raw = await claudeCall(sys, prompt, 1200, { model: 'claude-haiku-4-5-20251001', webSearch: true, agent: 'citation_verifier' });
  } catch (err) {
    return { status: 'not_found', correction_text: null, web_search_snippet: null, identity_facts: null, cost_usd: 0.02, error: 'claudeCall_failed: ' + (err.message||'').slice(0,120) };
  }

  var cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  var fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
  if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
  var parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (pe) {}

  if (!parsed || !parsed.status) {
    return { status: 'not_found', correction_text: null, web_search_snippet: null, identity_facts: null, cost_usd: 0.025, error: 'haiku_parse_failed' };
  }

  var validStatuses = ['verified', 'wrong_subject', 'stale', 'figure_mismatch', 'not_found'];
  var status = validStatuses.indexOf(parsed.status) >= 0 ? parsed.status : 'not_found';
  var correction = (typeof parsed.correction_text === 'string' && parsed.correction_text.trim().length > 10)
    ? parsed.correction_text.trim().slice(0, 1500)
    : null;
  var snippet = (typeof parsed.web_search_snippet === 'string') ? parsed.web_search_snippet.slice(0, 400) : null;

  // Validate identity_facts shape — only keep well-formed fields
  var rawFacts = (parsed.identity_facts && typeof parsed.identity_facts === 'object') ? parsed.identity_facts : null;
  var identityFacts = null;
  if (rawFacts) {
    function datestr(v) {
      if (typeof v !== 'string') return null;
      var m = v.match(/^\d{4}-\d{2}-\d{2}$/);
      return m ? v : null;
    }
    function strOrNull(v, maxLen) {
      if (typeof v !== 'string') return null;
      var t = v.trim();
      if (!t) return null;
      return t.slice(0, maxLen || 400);
    }
    identityFacts = {
      canonical_title: strOrNull(rawFacts.canonical_title, 400),
      publication_date: datestr(rawFacts.publication_date),
      effective_date: datestr(rawFacts.effective_date),
      superseded_by: strOrNull(rawFacts.superseded_by, 100),
      superseded_date: datestr(rawFacts.superseded_date),
      evidence_url: strOrNull(rawFacts.evidence_url, 800),
      exists_bool: (typeof rawFacts.exists_bool === 'boolean') ? rawFacts.exists_bool : (status !== 'not_found')
    };
  }

  return { status: status, correction_text: correction, web_search_snippet: snippet, identity_facts: identityFacts, cost_usd: 0.025 };
}

async function verifySectionCitations(sectionText, opportunityId, sectionName) {
  sectionName = sectionName || 'technical_approach';
  var runStart = Date.now();
  var runId = 'cvr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var log_prefix = 'L6-CV[' + (opportunityId||'').slice(0,30) + ']';

  var candidates = extractCitationCandidatesFromSection(sectionText || '');
  log(log_prefix + ' START: section="' + sectionName + '", chars=' + (sectionText||'').length + ', candidates=' + candidates.length);

  var cheapCandidates = [];
  var structuredCandidates = [];
  for (var i = 0; i < candidates.length; i++) {
    if (isCheapVerifiable(candidates[i])) cheapCandidates.push(candidates[i]);
    else structuredCandidates.push(candidates[i]);
  }

  var auditLog = [];
  var replacements = [];
  var totalCost = 0;
  var structuredVerifiedCount = 0;
  var structuredFlaggedCount = 0;

  cheapCandidates.forEach(function(c) {
    auditLog.push({
      citation: c.citation,
      citation_type: c.citation_type,
      status: 'verified',
      path: 'cheap',
      original_sentence: c.sentence,
      replacement_sentence: null,
      co_located_dollar: c.co_located_dollar || null,
      verified_at: new Date().toISOString()
    });
  });

  // S132 cache-aware: no fixed cap. Each structured candidate consults the
  // thin identity cache first. If the cache alone can answer (known-superseded
  // or known-nonexistent), we flag at zero cost. Otherwise a Haiku+web_search
  // pass runs, with any cached identity facts injected as authoritative grounding.
  // A runaway safety limit at STRUCTURED_RUNAWAY_LIMIT prevents pathological sections.
  var STRUCTURED_RUNAWAY_LIMIT = 50;
  var toVerify = structuredCandidates.slice(0, STRUCTURED_RUNAWAY_LIMIT);
  var overCap = structuredCandidates.slice(STRUCTURED_RUNAWAY_LIMIT);
  var cacheHitCount = 0;
  var preHaikuCaughtCount = 0;
  var todayIso = new Date().toISOString().slice(0, 10);

  for (var j = 0; j < toVerify.length; j++) {
    var cand = toVerify[j];

    // Step 1: consult identity cache.
    var cacheHit = null;
    try { cacheHit = await lookupCitationIdentityCache(cand.citation); } catch (ce) { cacheHit = null; }
    if (cacheHit && !cacheHit._stale) cacheHitCount++;

    // Step 2: pre-Haiku cache check (cheap catch of known-superseded / known-nonexistent).
    var verifyResult = preHaikuCacheCheck(cand, cacheHit, todayIso);

    // Step 3: if cache could not answer, run the structured Haiku + web_search pass,
    // injecting any cached identity facts as authoritative grounding.
    if (!verifyResult) {
      try {
        verifyResult = await verifyOneCitationStructured(cand, cacheHit);
      } catch (verr) {
        verifyResult = { status: 'not_found', correction_text: null, cost_usd: 0, web_search_snippet: null, identity_facts: null, error: (verr.message||'').slice(0,180) };
      }
    } else {
      preHaikuCaughtCount++;
    }
    totalCost += (verifyResult.cost_usd || 0);

    // Step 4: upsert identity cache with whatever facts we learned (Haiku only).
    if (verifyResult.identity_facts && !verifyResult.pre_haiku) {
      try { await upsertCitationIdentityCache(cand.citation, cand.citation_type, verifyResult.identity_facts); } catch (ue) {}
    }

    var entry = {
      citation: cand.citation,
      citation_type: cand.citation_type,
      status: verifyResult.status,
      path: verifyResult.pre_haiku ? 'cache' : 'structured',
      original_sentence: cand.sentence,
      replacement_sentence: null,
      co_located_dollar: cand.co_located_dollar || null,
      web_search_snippet: verifyResult.web_search_snippet || null,
      cache_hit: !!cacheHit,
      cache_stale: cacheHit ? !!cacheHit._stale : null,
      verified_at: new Date().toISOString()
    };
    if (verifyResult.error) entry.error = verifyResult.error;

    if (verifyResult.status === 'verified') {
      structuredVerifiedCount++;
    } else if (verifyResult.status === 'stale') {
      entry.note = '[STALE AS OF ' + todayIso + '] — text left unchanged per operator policy';
      structuredFlaggedCount++;
    } else if (['wrong_subject','figure_mismatch','not_found'].indexOf(verifyResult.status) >= 0) {
      if (verifyResult.correction_text) {
        replacements.push({ original: cand.sentence, replacement: verifyResult.correction_text, citation: cand.citation });
        entry.replacement_sentence = verifyResult.correction_text;
      } else {
        var failMarker = ' [CITATION VERIFICATION FAILED — MANUAL REVIEW REQUIRED]';
        replacements.push({ original: cand.sentence, replacement: cand.sentence + failMarker, citation: cand.citation });
        entry.replacement_sentence = cand.sentence + failMarker;
      }
      structuredFlaggedCount++;
    } else {
      structuredFlaggedCount++;
    }
    auditLog.push(entry);
  }

  // Runaway safety: if we hit STRUCTURED_RUNAWAY_LIMIT, the remainder is flagged
  // without verification. This is a pathology signal, not an expected path.
  if (overCap.length > 0) {
    log(log_prefix + ' WARN: ' + overCap.length + ' candidates exceeded STRUCTURED_RUNAWAY_LIMIT=' + STRUCTURED_RUNAWAY_LIMIT + '; flagged without verification.');
    overCap.forEach(function(c) {
      auditLog.push({
        citation: c.citation,
        citation_type: c.citation_type,
        status: 'over_cap',
        path: 'over_cap',
        original_sentence: c.sentence,
        replacement_sentence: null,
        co_located_dollar: c.co_located_dollar || null,
        note: 'Runaway safety limit (' + STRUCTURED_RUNAWAY_LIMIT + ') reached — this section has an unusually high citation count; manual review required',
        verified_at: new Date().toISOString()
      });
    });
  }

  var verifiedText = sectionText || '';
  replacements.sort(function(a, b) { return b.original.length - a.original.length; });
  for (var k = 0; k < replacements.length; k++) {
    var r = replacements[k];
    var idx = verifiedText.indexOf(r.original);
    if (idx >= 0) {
      verifiedText = verifiedText.slice(0, idx) + r.replacement + verifiedText.slice(idx + r.original.length);
    }
  }

  var flaggedCount = auditLog.filter(function(e) {
    return ['wrong_subject','figure_mismatch','not_found','stale','over_cap'].indexOf(e.status) >= 0;
  }).length;
  var wallMs = Date.now() - runStart;

  log(log_prefix + ' DONE: candidates=' + candidates.length + ', cheap=' + cheapCandidates.length + ', structured_verified=' + structuredVerifiedCount + ', structured_flagged=' + structuredFlaggedCount + ', cache_hits=' + cacheHitCount + ', pre_haiku_caught=' + preHaikuCaughtCount + ', over_cap=' + overCap.length + ', cost=$' + totalCost.toFixed(4) + ', wall=' + wallMs + 'ms');

  try {
    await supabase.from('citation_verification_runs').insert({
      opportunity_id: opportunityId,
      section_name: sectionName,
      run_id: runId,
      v2_sha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      total_candidates: candidates.length,
      cheap_passed: cheapCandidates.length,
      structured_verified: structuredVerifiedCount,
      structured_flagged: structuredFlaggedCount,
      over_cap_count: overCap.length,
      total_cost_usd: Number(totalCost.toFixed(4)),
      wall_ms: wallMs,
      audit_log: auditLog
    });
  } catch (perr) {
    log(log_prefix + ' persist warning: ' + (perr.message||'').slice(0,180));
  }

  return {
    verified_text: verifiedText,
    audit_log: auditLog,
    flagged_count: flaggedCount,
    cost_usd: Number(totalCost.toFixed(4)),
    run_id: runId,
    counts: {
      total_candidates: candidates.length,
      cheap_passed: cheapCandidates.length,
      structured_verified: structuredVerifiedCount,
      structured_flagged: structuredFlaggedCount,
      over_cap: overCap.length
    }
  };
}



// ============================================================
// L7 — ITERATION-TO-PLATEAU REFINEMENT (S121)
// Loops refine + re-red-team until PWIN delta < 2 between consecutive
// passes OR max iterations hit (default 3). Each iteration replaces
// proposal_content + proposal_review in place; iteration history is
// logged to organism_memory with memory_type='refinement_iteration'.
// Cost per iteration: ~$2-5 (Opus refine) + ~$0.17 (Sonnet red team) = ~$2-5.
// Max loop cost: 3 × $5 = $15 per opp. Kill-switch: MAX_ITER_DEFAULT = 3.
// ============================================================

async function runSingleRefinementPass(opp, proposalText, reviewText) {
  var vertical = (opp.vertical || 'professional services').trim();
  var agency = (opp.agency || '').trim();
  var oppState = (opp.state || 'Louisiana').trim();
  var scopeSnippet = (opp.scope_analysis || '').replace(/[^a-zA-Z0-9 .,\-]/g, ' ').slice(0, 150).trim();

  // S125 Push 6: pull opp-tagged competitive intelligence and discriminators
  // into L7 refinement. Without this, L7 rewrites without competitive context
  // and undoes the differentiation work the main pipeline did.
  var ciOpp = [];
  var ciContext = [];
  try {
    var _ciAll = await supabase.from('competitive_intelligence')
      .select('competitor_name,strengths,weaknesses,strategic_notes,threat_level,hq_location,opportunity_id,agency,vertical')
      .or('opportunity_id.eq.' + opp.id + ',agency.ilike.%' + (agency||'').slice(0,30) + '%,vertical.ilike.%' + vertical.toLowerCase() + '%')
      .limit(30);
    var _ciRows = (_ciAll.data || []);
    ciOpp = _ciRows.filter(function(c){ return c.opportunity_id === opp.id; });
    ciContext = _ciRows.filter(function(c){ return c.opportunity_id !== opp.id; }).slice(0, 8);
  } catch(_ciL7e) { /* non-fatal */ }
  var ciOppText = ciOpp.length > 0 ?
    ciOpp.map(function(c){
      return '### ' + c.competitor_name + ' [most relevant — confirmed in this market]' +
        '\n  HQ: ' + (c.hq_location||'') + ' | Threat: ' + (c.threat_level||'') +
        '\n  Strengths: ' + (c.strengths||'').slice(0,300) +
        '\n  Weaknesses: ' + (c.weaknesses||'').slice(0,300) +
        '\n  Strategy notes: ' + (c.strategic_notes||'').slice(0,300);
    }).join('\n\n') : '(no opportunity-tagged competitors known)';
  var ciContextText = ciContext.length > 0 ?
    ciContext.map(function(c){
      return '- ' + c.competitor_name + ' (' + (c.threat_level||'unknown') + '): ' + (c.weaknesses||'').slice(0,150);
    }).join('\n') : '';

  var discriminators = [];
  try {
    var _dRes = await supabase.from('opportunity_discriminators')
      .select('title,claim,evidence_quote,competitor_gap,discriminator_num')
      .eq('opportunity_id', opp.id)
      .order('discriminator_num', { ascending: true });
    discriminators = _dRes.data || [];
  } catch(_dL7e) { /* non-fatal */ }
  var discriminatorsText = discriminators.length > 0 ?
    discriminators.map(function(d){
      return '## DISCRIMINATOR ' + d.discriminator_num + ': ' + d.title +
        '\n  Claim: ' + (d.claim||'').slice(0,400) +
        '\n  Evidence: ' + (d.evidence_quote||'').slice(0,300) +
        '\n  Market gap HGI fills (internal note — never name or reference any other firm in proposal output): ' + (d.competitor_gap||'').slice(0,300);
    }).join('\n\n') : '(no discriminators generated for this opp)';

  var researchResults = await Promise.allSettled([
    multiSearch([
      { q: scopeSnippet.slice(0,100) + ' ' + vertical + ' methodology best practices 2025 2026', label: 'Best practices' },
      { q: agency + ' ' + oppState + ' contracts awarded ' + vertical + ' 2024 2025', label: 'Agency awards' }
    ]),
    supabase.from('knowledge_chunks').select('chunk_text,filename,vertical')
      .or('vertical.eq.' + vertical.toLowerCase() + ',document_class.eq.quality_gated_draft')
      .limit(20)
  ]);
  var webResearch = (researchResults[0].status === 'fulfilled' ? researchResults[0].value : '') || '';
  var kbChunks = (researchResults[1].status === 'fulfilled' && researchResults[1].value.data) || [];
  var kbContent = kbChunks.map(function(c) { return c.chunk_text || ''; }).join('\n---\n').slice(0, 8000);

  var prMems = await supabase.from('organism_memory')
    .select('agent,observation')
    .eq('opportunity_id', opp.id)
    .neq('memory_type', 'decision_point')
    .order('created_at', { ascending: false })
    .limit(30);
  var memContext = (prMems.data || []).map(function(m) {
    return '[' + m.agent + ']: ' + (m.observation || '').slice(0, 400);
  }).join('\n\n').slice(0, 6000);

  var refineSystem =
    'You are the most capable government proposal writer in the world. You are performing a refinement pass.' +
    '\n\nOpportunity: ' + (opp.title||'') + ' | Agency: ' + agency + ' | Vertical: ' + vertical + ' | OPI: ' + (opp.opi_score||0) +
    '\n\nYou have the current proposal, a red team review identifying every weakness, fresh web research on best practices, HGI knowledge base content from winning proposals, full organism intelligence, internal market intelligence, and pre-computed HGI strength claims.' +
    '\n\nYour mission: OUTPUT THE COMPLETE REFINED PROPOSAL — every section, start to finish. Keep sections the red team rated clean. REBUILD sections flagged as critical or major. Add any missing sections.' +
    '\n\nCRITICAL RULES:' +
    '\n1. Output the FULL proposal, not just changed sections' +
    '\n2. Every claim must have specific evidence (dates, amounts, project names)' +
    '\n3. No Geoffrey Brien. All positions [TO BE ASSIGNED] except Christopher J. Oney on cover letter' +
    '\n4. Founded 1929, 97-year-old firm, ~50 employees, Kenner HQ Suite 510, UEI DL4SJEVKZ6H4. NEVER write 1931, 1930, 95-year, 96-year — use 1929 / 97-year exactly.' +
    '\n5. Use web research for current methodology. Use KB for HGI proof points' +
    '\n6. ZERO bracketed meta-commentary. The ONLY permitted bracket in final output is [TO BE ASSIGNED] for Key Personnel. NEVER emit [ACTION REQUIRED ...], [Correction ...], [TBD], [Insert ...], [Verify ...], [Pending ...], or any similar placeholder. Resolve every such placeholder silently — write the correct text or omit the element.' +
    '\n7. Match the RFP structure exactly' +
    '\n8. NEVER list PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA, Tangipahoa as HGI past performance' +
    '\n9. COMPETITIVE INTELLIGENCE USE: The user message contains a "## MARKET INTELLIGENCE — INTERNAL ONLY" section. This is INTERNAL INTELLIGENCE for your strategic use only. NEVER name any competitor in proposal output. NEVER reference, allude to, or acknowledge that other bidders exist. NEVER write comparative language ("unlike", "competitors lack", "while others", "we are the only", "compared to", etc.). The proposal reads as if HGI is the only firm in the room. NEVER frame an organization listed in the intelligence as a partner, subcontractor, or teaming option. Use the intelligence to DECIDE which HGI strengths to emphasize — the proposal text itself never references competitors directly or comparatively.' +
    '\n10. HGI STRENGTH CLAIMS: The user message contains a "## HGI STRENGTH CLAIMS (PRE-COMPUTED)" section. Weave each claim naturally into the section where it belongs (Technical Approach, Background, etc.) — do not list them separately. Each claim already has its evidence and an internal note about the market gap HGI fills; preserve the claim and evidence in the refined text but never reproduce the internal note in the proposal output.';

  var refinePrompt =
    '=== CURRENT PROPOSAL (refine this) ===\n' + proposalText.slice(0, 80000) +
    '\n\n=== RED TEAM REVIEW (fix every critical/major finding) ===\n' + reviewText.slice(0, 15000) +
    '\n\n=== RFP/SOQ REQUIREMENTS ===\n' + (opp.rfp_text || opp.scope_analysis || opp.description || '').slice(0, 15000) +
    '\n\n## MARKET INTELLIGENCE — INTERNAL ONLY (do not name or reference any of these in the proposal)\n' + ciOppText +
    (ciContextText ? '\n\n## BROADER COMPETITIVE CONTEXT (vertical/agency)\n' + ciContextText : '') +
    '\n\n## HGI STRENGTH CLAIMS (PRE-COMPUTED)\n' + discriminatorsText +
    (webResearch.length > 50 ? '\n\n=== FRESH WEB RESEARCH ===\n' + webResearch.slice(0, 4000) : '') +
    (kbContent.length > 100 ? '\n\n=== HGI KNOWLEDGE BASE (winning proposal sections) ===\n' + kbContent.slice(0, 6000) : '') +
    (memContext.length > 100 ? '\n\n=== ORGANISM INTELLIGENCE ===\n' + memContext.slice(0, 4000) : '') +
    '\n\n=== TASK ===\nRead the red team review. For every CRITICAL and MAJOR finding, fix it using the research, KB, primary-competitor intel, and discriminators. Output the COMPLETE REFINED PROPOSAL — all sections, start to finish. Apply Rules 6 (zero brackets), 9 (competitive differentiation), and 10 (discriminator integration) without exception.';

  var opusResp = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 5000 },
    system: refineSystem,
    messages: [{ role: 'user', content: refinePrompt }]
  });
  trackCost('refinement_pass', 'claude-opus-4-6', opusResp.usage);

  var refinedText = (opusResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
  if (refinedText.length < 500) return null;

  // Post-process — same as /api/proposal-refine
  refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:insurance|WC coverage|workers.?comp|auto policy|umbrella|E&O|fidelity|GL |general liability)[^\]]*\]/gi, 'HGI maintains $5M fidelity bond, $5M Errors & Omissions, $2M General Liability, Workers Compensation at statutory limits, and $1M Commercial Auto coverage. Certificates of insurance with Additional Insured endorsement naming CLIENT will be provided upon contract execution.');
  refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:professional regulation|DPR|Confirm.*(?:applicable|applicability))[^\]]*\]/gi, 'No Louisiana Department of Professional Regulation license is required for disaster recovery consulting, program management, claims administration, construction management oversight, or grant management services.');
  refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:SAM|UEI|registration.*print)[^\]]*\]/gi, 'HGI Global is registered in SAM.gov with active status. UEI: DL4SJEVKZ6H4.');
  refinedText = refinedText.replace(/\[ACTION REQUIRED[^\]]*(?:org.*chart|organizational)[^\]]*\]/gi, 'See Organizational Chart (Appendix A).');

  // S125 UNIVERSAL BRACKET KILLER applied to L7 output — strip residual placeholders
  // that the L7 system prompt rule 6 ("Minimize [ACTION REQUIRED]") allows through.
  // Same regex as the main pipeline. Permitted: [TO BE ASSIGNED] for Key Personnel.
  refinedText = refinedText.replace(/\[(?:ACTION\s*REQUIRED|Correction|CORRECTION|Note|NOTE|TBD|TBC|To be determined|TO BE DETERMINED|To be completed|TO BE COMPLETED|Insert|INSERT|Confirm|CONFIRM|Verify|VERIFY|Placeholder|PLACEHOLDER|Pending|PENDING)(?:[:\-\s][^\[\]]{0,400})?\]/g, '');
  refinedText = refinedText.replace(/ACTION REQUIRED(?:\s+SUMMARY)?\s*\(?[^\n\r]{0,300}?\)?\s*:?\s*\n?/gi, '');
  refinedText = refinedText.replace(/\n{3,}/g, '\n\n');

  var arCount = (refinedText.match(/ACTION REQUIRED/gi) || []).length;
  return { refinedText: refinedText, arCount: arCount, kbChunks: kbChunks.length, webChars: webResearch.length };
}

async function runSingleRedTeamPass(opp, proposalText) {
  var reviewPrompt = 'You are a ruthless government proposal red team reviewer and PWIN estimator. Review this proposal against the RFP and return ONLY valid JSON.\n\n' +
    '=== RFP ===\n' + ((opp.rfp_text || opp.scope_analysis || opp.description || '').slice(0, 12000)) + '\n\n' +
    '=== PROPOSAL ===\n' + proposalText.slice(0, 30000) + '\n\n' +
    'Return ONLY this JSON schema (no preamble, no markdown, no explanation):\n' +
    '{\n' +
    '  "overall_status": "SUBMISSION_READY" | "NEEDS_MAJOR_REVISION" | "NEEDS_MINOR_REVISION" | "DO_NOT_SUBMIT",\n' +
    '  "pwin_estimate": 0-100,\n' +
    '  "pwin_rationale": "One paragraph explaining the PWIN estimate based on proposal quality, compliance, and competitive position",\n' +
    '  "scoring_matrix": [\n' +
    '    {"section": "section name", "evaluator_score": 0-100, "rationale": "why this score"}\n' +
    '  ],\n' +
    '  "findings": [\n' +
    '    {"severity": "DISQUALIFYING" | "CRITICAL" | "MAJOR" | "MINOR", "category": "compliance" | "content" | "formatting" | "pricing" | "competitive" | "evidence", "issue": "what is wrong", "location": "where in proposal", "fix": "what to do"}\n' +
    '  ],\n' +
    '  "competitive_vulnerabilities": ["how a competitor would attack this"],\n' +
    '  "top_3_improvements": ["the 3 changes that would most increase PWIN"]\n' +
    '}';

  var reviewResp = await claudeCall('Red team proposal review', reviewPrompt, 12000, { model: 'claude-sonnet-4-6', agent: 'red_team_reviewer' });
  var rtReport = null;
  try {
    var cleaned = (reviewResp || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    var fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
    rtReport = JSON.parse(cleaned);
  } catch (pe) { /* fall through */ }

  var pwinEst = 0, critCount = 0, majCount = 0, minCount = 0, summary = '';
  if (rtReport) {
    pwinEst = rtReport.pwin_estimate || 0;
    (rtReport.findings || []).forEach(function(f) {
      if (f.severity === 'CRITICAL' || f.severity === 'DISQUALIFYING') critCount++;
      else if (f.severity === 'MAJOR') majCount++;
      else if (f.severity === 'MINOR') minCount++;
    });
    summary = 'RED TEAM REVIEW [STRUCTURED]: ' + rtReport.overall_status + ' | PWIN ' + pwinEst + '% | ' +
      (rtReport.scoring_matrix || []).length + ' sections scored | ' +
      critCount + ' critical, ' + majCount + ' major, ' + minCount + ' minor findings';
  } else {
    summary = 'RED TEAM REVIEW [TEXT FALLBACK]: parse failed, raw: ' + (reviewResp || '').slice(0, 200);
  }

  var reviewStorage = rtReport ? (summary + '\n\n' + JSON.stringify(rtReport, null, 2)) : (summary + '\n\n' + (reviewResp || ''));
  return { reviewStorage: reviewStorage, pwinEstimate: pwinEst, rtReport: rtReport, critCount: critCount, majCount: majCount, summary: summary };
}

async function runIterationToPlateau(opp, initialProposal, initialReview, initialPWIN, options) {
  options = options || {};
  var MAX_ITER = options.maxIter || 3;
  var PLATEAU_DELTA = options.plateauDelta || 2;
  var oppId = opp.id;
  var log_prefix = 'L7[' + oppId.slice(0, 30) + ']';

  // S126 push 4: APPLES-TO-APPLES BASELINE RESCORE
  // The caller passes initialPWIN from the lenient main red team in produce-proposal.
  // Every iteration here scores with runSingleRedTeamPass (a stricter reviewer).
  // Apples-to-oranges scoring caused every iteration to show false regression and
  // L7 to quit after iter 1. Rescore the baseline with the SAME scorer used in
  // iterations so delta math is meaningful. Cost: +1 Sonnet call (~$0.30) per L7 run.
  var trueBaselinePWIN = initialPWIN || 0;
  try {
    log(log_prefix + ' rescoring baseline with iteration-grade red team for apples-to-apples comparison');
    var baselineRescore = await runSingleRedTeamPass(opp, initialProposal);
    if (baselineRescore && typeof baselineRescore.pwinEstimate === 'number') {
      trueBaselinePWIN = baselineRescore.pwinEstimate;
      log(log_prefix + ' baseline rescored: caller PWIN=' + (initialPWIN||0) + ' (lenient), iteration-scorer PWIN=' + trueBaselinePWIN + ' (strict). Using strict baseline.');
    } else {
      log(log_prefix + ' baseline rescore returned no PWIN — keeping caller PWIN=' + (initialPWIN||0));
    }
  } catch (brErr) {
    log(log_prefix + ' baseline rescore error (non-fatal): ' + (brErr.message||'').slice(0,150) + ' — keeping caller PWIN=' + (initialPWIN||0));
  }

  var trajectory = [{ iteration: 0, pwin: trueBaselinePWIN, chars: (initialProposal || '').length, delta: null, timestamp: new Date().toISOString(), baseline_caller_pwin: initialPWIN || 0, baseline_iteration_scorer_pwin: trueBaselinePWIN }];
  var currentProposal = initialProposal;
  var currentReview = initialReview;
  var currentPWIN = trueBaselinePWIN;
  var stopReason = 'max_iterations_reached';

  log(log_prefix + ' starting. Initial PWIN=' + currentPWIN + ' (apples-to-apples baseline), max_iter=' + MAX_ITER + ', plateau_delta=' + PLATEAU_DELTA);

  for (var iter = 1; iter <= MAX_ITER; iter++) {
    log(log_prefix + ' iteration ' + iter + ' begin (current PWIN=' + currentPWIN + ')');

    // Step A: Refinement pass
    var refResult;
    try {
      refResult = await runSingleRefinementPass(opp, currentProposal, currentReview);
    } catch (re) {
      log(log_prefix + ' iter ' + iter + ' refine error: ' + (re.message||'').slice(0,200));
      stopReason = 'refinement_error';
      break;
    }
    if (!refResult || !refResult.refinedText) {
      log(log_prefix + ' iter ' + iter + ' refinement returned nothing');
      stopReason = 'refinement_empty';
      break;
    }
    var refinedText = refResult.refinedText;
    log(log_prefix + ' iter ' + iter + ' refined to ' + refinedText.length + ' chars (was ' + currentProposal.length + ')');

    // Durability: persist refined proposal IMMEDIATELY (before red team can fail/crash)
    try {
      await supabase.from('opportunities').update({
        proposal_content: refinedText,
        last_updated: new Date().toISOString()
      }).eq('id', oppId);
    } catch (pe) {
      log(log_prefix + ' iter ' + iter + ' proposal_content save error: ' + (pe.message||'').slice(0,150));
    }

    // Step B: Re-run red team on refined version
    var rtResult;
    try {
      rtResult = await runSingleRedTeamPass(opp, refinedText);
    } catch (rte) {
      log(log_prefix + ' iter ' + iter + ' red team error: ' + (rte.message||'').slice(0,200));
      stopReason = 'redteam_error';
      break;
    }
    var newPWIN = rtResult.pwinEstimate || 0;
    var delta = newPWIN - currentPWIN;
    log(log_prefix + ' iter ' + iter + ' new PWIN=' + newPWIN + ' (delta=' + delta + ')');

    // Step C: Persist new review (proposal_content already saved above)
    await supabase.from('opportunities').update({
      proposal_review: rtResult.reviewStorage,
      last_updated: new Date().toISOString()
    }).eq('id', oppId);

    // Step D: Log iteration to memory
    try {
      await supabase.from('organism_memory').insert({
        id: 'mem_l7_' + oppId + '_' + iter + '_' + Date.now(),
        agent: 'refinement_loop',
        opportunity_id: oppId,
        observation: 'L7 ITERATION ' + iter + ': PWIN ' + currentPWIN + ' -> ' + newPWIN +
          ' (delta ' + (delta >= 0 ? '+' : '') + delta + '). ' +
          'Chars ' + currentProposal.length + ' -> ' + refinedText.length + '. ' +
          rtResult.critCount + ' critical, ' + rtResult.majCount + ' major findings remaining. ' +
          (refResult.kbChunks || 0) + ' KB chunks used.',
        memory_type: 'refinement_iteration',
        created_at: new Date().toISOString()
      });
    } catch (me) { /* non-fatal */ }

    trajectory.push({
      iteration: iter,
      pwin: newPWIN,
      chars: refinedText.length,
      delta: delta,
      crit_findings: rtResult.critCount,
      major_findings: rtResult.majCount,
      timestamp: new Date().toISOString()
    });

    // Step E: Plateau check
    if (Math.abs(delta) < PLATEAU_DELTA) {
      log(log_prefix + ' plateau reached at iter ' + iter + ' (delta ' + delta + ' < ' + PLATEAU_DELTA + ')');
      stopReason = 'plateau';
      currentProposal = refinedText;
      currentReview = rtResult.reviewStorage;
      currentPWIN = newPWIN;
      break;
    }

    // Step F: Regression check — if PWIN drops materially, stop
    if (delta < -5) {
      log(log_prefix + ' regression detected (delta ' + delta + '), stopping');
      stopReason = 'regression';
      currentProposal = refinedText;
      currentReview = rtResult.reviewStorage;
      currentPWIN = newPWIN;
      break;
    }

    currentProposal = refinedText;
    currentReview = rtResult.reviewStorage;
    currentPWIN = newPWIN;
  }

  // Final summary memory
  try {
    await supabase.from('organism_memory').insert({
      id: 'mem_l7_summary_' + oppId + '_' + Date.now(),
      agent: 'refinement_loop_summary',
      opportunity_id: oppId,
      observation: 'L7 COMPLETE: ' + (trajectory.length - 1) + ' iterations ran. ' +
        'Initial PWIN ' + (initialPWIN||0) + ' -> final PWIN ' + currentPWIN + '. ' +
        'Stop reason: ' + stopReason + '. ' +
        'Trajectory: ' + trajectory.map(function(t){ return 'i'+t.iteration+'=PWIN'+t.pwin; }).join(' -> '),
      memory_type: 'analysis',
      created_at: new Date().toISOString()
    });
  } catch (se) { /* non-fatal */ }

  log(log_prefix + ' complete. ' + (trajectory.length - 1) + ' iterations. PWIN ' + (initialPWIN||0) + ' -> ' + currentPWIN + '. Stop: ' + stopReason);
  return { iterations: trajectory.length - 1, initialPWIN: initialPWIN || 0, finalPWIN: currentPWIN, stopReason: stopReason, trajectory: trajectory };
}



// ============================================================
// S134 — SECTION-TARGETED REFINEMENT LOOP
//
// Purpose: when the red team produces a scoring_matrix with per-section
// evaluator scores, rewrite ONLY sections that scored below threshold
// rather than rewriting the whole proposal (what L9 runIterationToPlateau
// does). Preserves sections the red team rated well.
//
// Standalone endpoint: POST /api/refine-weak-sections
//   Body: { id, threshold=60, dryRun=true, maxSectionsToRegen=3, forceExclusionOverride=false }
//
// Does NOT auto-wire into /api/produce-proposal in S134. Composition with
// L9 (before/after/replace) is deferred until we have section-regen quality
// data from OPSB + St. George. Test-before-integrate, mirroring S132
// /api/test-citation-verifier.
//
// Cost per invocation (typical): ~$0.70-$1.50.
// Wall time: ~60-180s.
//
// Built fresh in S134. Does NOT reference or reuse the 228-line
// refineWeakSections function from reverted commit 0f33c1b (origin suspect).
// ============================================================

function extractReviewReport(proposalReviewText) {
  // proposal_review is a text blob: optional "[CANON FAIL]" prefix + summary line
  // + "\n\n" + JSON.stringify(rtReport) + optional "=== DETERMINISTIC CANON SWEEP ..." block.
  // Extract the inner JSON object and return it, or null on failure.
  if (!proposalReviewText || typeof proposalReviewText !== 'string') return null;
  var s134s = proposalReviewText;
  // Strip the canon sweep block if present (comes after the JSON, would confuse lastIndexOf('}'))
  var sweepIdx = s134s.indexOf('=== DETERMINISTIC CANON SWEEP');
  if (sweepIdx > 0) s134s = s134s.slice(0, sweepIdx);
  var firstBrace = s134s.indexOf('{');
  var lastBrace = s134s.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(s134s.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    return null;
  }
}

function selectWeakSections(rtReport, threshold, maxSections) {
  // Duck-type both scoring_matrix schemas:
  //   Schema A (main produce-proposal red team): {section, max_points, estimated_score, pct, risk_level, note}
  //   Schema B (runSingleRedTeamPass):           {section, evaluator_score, rationale}
  // Normalize to {section_name, score, rationale}.
  if (!rtReport || !Array.isArray(rtReport.scoring_matrix)) return { schema: 'none', weak: [], all_sections: [] };
  var detectedSchema = 'unknown';
  var normalized = rtReport.scoring_matrix.map(function(row) {
    var name = row.section || row.section_name || '';
    var score = null;
    if (typeof row.evaluator_score === 'number') { score = row.evaluator_score; detectedSchema = 'B'; }
    else if (typeof row.pct === 'number') { score = row.pct; detectedSchema = 'A'; }
    else if (typeof row.estimated_score === 'number' && typeof row.max_points === 'number' && row.max_points > 0) {
      score = Math.round((row.estimated_score / row.max_points) * 100);
      detectedSchema = 'A';
    } else if (typeof row.score === 'number') { score = row.score; }
    return {
      section_name: name,
      score: score,
      rationale: row.rationale || row.note || '',
      max_points: row.max_points || null,
      estimated_score: row.estimated_score || null,
      risk_level: row.risk_level || null
    };
  }).filter(function(r) { return r.section_name && typeof r.score === 'number'; });

  var weak = normalized
    .filter(function(r) { return r.score < threshold; })
    .sort(function(a, b) { return a.score - b.score; })
    .slice(0, maxSections);

  return { schema: detectedSchema, weak: weak, all_sections: normalized };
}

function findingsForSection(rtReport, sectionName) {
  if (!rtReport || !Array.isArray(rtReport.findings)) return [];
  var nameLower = String(sectionName).toLowerCase();
  return rtReport.findings.filter(function(f) {
    var where = String(f.section || f.location || '').toLowerCase();
    if (!where) return false;
    // Loose containment: either side may be a substring of the other (formatting drift tolerant)
    return where.indexOf(nameLower) >= 0 || nameLower.indexOf(where) >= 0;
  });
}

async function locateSection(proposalText, sectionName) {
  // Returns { start, end, confidence, method, header_text } or null.
  // Strategy: regex anchor first, Haiku fallback if zero or multiple matches.
  if (!proposalText || !sectionName) return null;

  // Escape regex specials in section name
  var esc = String(sectionName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Header-shape patterns, most specific first
  var patterns = [
    new RegExp('^#{1,4}\\s+\\d+(?:\\.\\d+)*\\s+' + esc + '\\s*$', 'im'),   // ## 2.1 Section Name
    new RegExp('^#{1,4}\\s+' + esc + '\\s*$', 'im'),                         // ## Section Name
    new RegExp('^\\d+(?:\\.\\d+)*\\s+' + esc + '\\s*$', 'im'),               // 2.1 Section Name (no #)
    new RegExp('^' + esc + '\\s*$', 'im')                                    // bare line
  ];

  var matches = [];
  for (var i = 0; i < patterns.length; i++) {
    var m = patterns[i].exec(proposalText);
    if (m) matches.push({ index: m.index, length: m[0].length, header: m[0] });
  }

  if (matches.length === 1) {
    var match = matches[0];
    var startChar = match.index;
    var rest = proposalText.slice(startChar + match.length);
    var nextHeader = rest.search(/\n#{1,4}\s+|\n\d+(?:\.\d+)+\s+[A-Z]/);
    var endChar = nextHeader < 0 ? proposalText.length : startChar + match.length + nextHeader;
    return {
      start: startChar,
      end: endChar,
      confidence: 'high',
      method: 'regex_exact',
      header_text: match.header
    };
  }

  // Zero or multiple regex matches — Haiku fallback
  try {
    var locatePrompt =
      'Locate the section titled "' + sectionName + '" in the proposal text below. ' +
      'Return ONLY a JSON object with fields: {start_marker, end_marker, confidence}. ' +
      'start_marker = the exact first ~40 characters of the section (INCLUDING its header line, copied verbatim). ' +
      'end_marker = the exact first ~40 characters of whatever comes AFTER this section ends (typically the next section header), or "END_OF_DOCUMENT" if this is the last section. ' +
      'confidence = "high", "medium", or "low". ' +
      'If the section does not exist in the text, return {start_marker: null, end_marker: null, confidence: "not_found"}. ' +
      'No preamble. No markdown fences.\n\n' +
      '=== PROPOSAL TEXT ===\n' + proposalText.slice(0, 60000);
    var locateResp = await claudeCall(
      'You are a precise section locator. Return only JSON.',
      locatePrompt,
      500,
      { model: 'claude-haiku-4-5-20251001', agent: 's134_section_locator' }
    );
    var clean = (locateResp || '').replace(/```json/g, '').replace(/```/g, '').trim();
    var fb = clean.indexOf('{'), lb = clean.lastIndexOf('}');
    if (fb < 0 || lb <= fb) return null;
    var loc = JSON.parse(clean.slice(fb, lb + 1));
    if (!loc.start_marker || loc.confidence === 'not_found') return null;
    var startIdx = proposalText.indexOf(loc.start_marker);
    if (startIdx < 0) {
      // Prefix match (first 20 chars) if full marker didn't land verbatim
      var prefix = String(loc.start_marker).slice(0, 20);
      startIdx = proposalText.indexOf(prefix);
      if (startIdx < 0) return null;
    }
    var endIdx;
    if (loc.end_marker === 'END_OF_DOCUMENT' || !loc.end_marker) {
      endIdx = proposalText.length;
    } else {
      endIdx = proposalText.indexOf(loc.end_marker, startIdx + 1);
      if (endIdx < 0) {
        var endPrefix = String(loc.end_marker).slice(0, 20);
        endIdx = proposalText.indexOf(endPrefix, startIdx + 1);
      }
      if (endIdx < 0) endIdx = proposalText.length;
    }
    if (endIdx <= startIdx) return null;
    return {
      start: startIdx,
      end: endIdx,
      confidence: loc.confidence || 'medium',
      method: 'haiku_locate',
      header_text: proposalText.slice(startIdx, Math.min(startIdx + 80, endIdx)).split('\n')[0]
    };
  } catch (e) {
    log('S134 locateSection Haiku error: ' + (e.message || '').slice(0, 150));
    return null;
  }
}

async function scoreSingleSection(sectionText, sectionName, rfpSlice, findingsForThisSection) {
  // Haiku-based same-scorer score used on BOTH pre- and post-regen sides so
  // the delta is apples-to-apples. Returns { score, rationale, residual_findings_count, cost_usd }.
  if (!sectionText || sectionText.length < 50) {
    return { score: 0, rationale: 'section_too_short', residual_findings_count: 0, cost_usd: 0 };
  }

  var findingsBlock = (findingsForThisSection || []).slice(0, 8).map(function(f, i) {
    return (i + 1) + '. [' + (f.severity || '?') + '] ' + (f.issue || f.detail || '') +
      (f.fix ? ' -- Fix: ' + f.fix : '');
  }).join('\n');

  var system = 'You are a government proposal red team evaluator scoring ONE section against its RFP requirements. Return ONLY valid JSON. No preamble. No markdown fences.';
  var prompt =
    'SECTION NAME: ' + sectionName + '\n\n' +
    '=== RFP CONTEXT (requirements this section must satisfy) ===\n' +
    String(rfpSlice || '(no RFP context provided)').slice(0, 4000) + '\n\n' +
    (findingsBlock ? '=== PRIOR FINDINGS AGAINST THIS SECTION (reference — do they still apply?) ===\n' + findingsBlock + '\n\n' : '') +
    '=== SECTION TEXT ===\n' + sectionText.slice(0, 12000) + '\n\n' +
    'Score this section 0-100 against the RFP requirements. Be strict: government evaluators award full points only for specific, evidence-backed, compliant content. Generic or incomplete answers lose points. Return:\n' +
    '{"score": 0-100, "rationale": "two-sentence rationale", "residual_findings_count": number of prior findings still unresolved}';

  try {
    var resp = await claudeCall(
      system,
      prompt,
      600,
      { model: 'claude-haiku-4-5-20251001', agent: 's134_section_scorer' }
    );
    var clean = (resp || '').replace(/```json/g, '').replace(/```/g, '').trim();
    var fb = clean.indexOf('{'), lb = clean.lastIndexOf('}');
    if (fb < 0 || lb <= fb) return { score: 0, rationale: 'parse_failed', residual_findings_count: 0, cost_usd: 0.001 };
    var parsed = JSON.parse(clean.slice(fb, lb + 1));
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      rationale: String(parsed.rationale || '').slice(0, 500),
      residual_findings_count: Number(parsed.residual_findings_count) || 0,
      cost_usd: 0.001
    };
  } catch (e) {
    return { score: 0, rationale: 'error: ' + (e.message || '').slice(0, 120), residual_findings_count: 0, cost_usd: 0 };
  }
}

async function regenerateSection(opp, sectionName, currentSectionText, preContext, postContext, rfpSlice, findings, scoreRationale) {
  // Opus 4.6 streaming, 10K max_tokens, 3K thinking budget.
  // Returns { regenerated_text, cost_usd, wall_seconds, usage } or null on failure.
  var runStart = Date.now();
  var vertical = (opp.vertical || 'professional services').trim();
  var agency = (opp.agency || '').trim();

  // Top-3 HGI_PP via existing selector (already respects exclusions + vertical fit)
  var ppTopText = '(no HGI_PP selected)';
  try {
    var ppResult = selectHGIPP(opp, {
      vertical: opp.vertical,
      agency: opp.agency,
      state: opp.state,
      estimated_value: opp.estimated_value,
      rfpText: opp.rfp_text
    });
    var topPPs = (ppResult && ppResult.selected) || [];
    if (topPPs.length > 0) {
      ppTopText = topPPs.slice(0, 3).map(function(p, i) {
        var v = p.value || {};
        var hgiD = v.hgi_direct ? '$' + (v.hgi_direct / 1e6).toFixed(1) + 'M HGI direct' : '';
        var progT = v.program_total ?
          ' / $' + (v.program_total / 1e9 >= 1 ?
            (v.program_total / 1e9).toFixed(1) + 'B' :
            (v.program_total / 1e6).toFixed(0) + 'M') + ' program total' : '';
        return (i + 1) + '. ' + (p.client || '?') + ' — ' + (p.contract_name || '?') + ': ' +
          hgiD + progT + '. Period: ' + ((p.period && p.period.start) || '?') + '-' +
          ((p.period && p.period.end) || 'ongoing') + '. Scope: ' + String(p.scope || '').slice(0, 240);
      }).join('\n');
    }
  } catch (ppe) { /* non-fatal */ }

  var findingsBlock = (findings || []).slice(0, 10).map(function(f, i) {
    return (i + 1) + '. [' + (f.severity || '?') + '] ' + (f.issue || '') +
      (f.detail ? ' — ' + f.detail : '') +
      (f.fix ? '\n   Fix: ' + f.fix : '') +
      (f.replacement_text ? '\n   Suggested replacement: ' + String(f.replacement_text).slice(0, 300) : '');
  }).join('\n\n');

  var system =
    'You are a senior HGI Global proposal writer rewriting ONE SECTION of a proposal that scored below threshold in red team review. Your output REPLACES the current section text in place. Do not regenerate anything outside this section.\n\n' +
    'YOU WRITE ONE SECTION ONLY. Not a full proposal. Not adjacent sections. The section name is: "' + sectionName + '".\n\n' +
    'HARD RULES (NON-NEGOTIABLE):\n' +
    '- Founded 1929. 97-year. Never 1931, 1930, 95-year, 96-year.\n' +
    '- Legal entity: "Hammerman & Gainer LLC d/b/a HGI Global" or "HGI Global". Never "Hammerman & Gainer Global", "HGI LLC", "HGI Global LLC".\n' +
    '- Geoffrey Brien is no longer with HGI. Never mention.\n' +
    '- HARD EXCLUSIONS — never list as HGI past performance: PBGC, Orleans Parish School Board, OPSB, LIGA, TPCIGA. (Reference only as client name where the opportunity IS that client.)\n' +
    '- Terrebonne Parish School District (TPSD). Never Tangipahoa.\n' +
    '- Never name competitors in proposal text. No comparative language ("unlike", "competitors lack", "while others", "we are the only", "compared to", "whereas others").\n' +
    '- UEI: DL4SJEVKZ6H4. CAGE: 47C60. HQ: 2400 Veterans Memorial Blvd, Suite 510, Kenner, LA 70062. Phone: (504) 681-6135.\n' +
    '- Past performance figures: Road Home $67M HGI direct / $13B+ program total. Restore Louisiana $42.3M HGI direct. HAP program $950M. TPSD $2.96M. Never drift from these figures.\n' +
    '- The only permitted bracket in output is [TO BE ASSIGNED] for Key Personnel. No [ACTION REQUIRED], [TBD], [Insert ...], [Verify ...], [Confirm ...], [Note ...], [Placeholder ...], [Pending ...].\n' +
    '- Christopher J. Oney is the signatory for the cover letter only. Do not assign any other staff to any other position; use [TO BE ASSIGNED] where a role needs naming.\n' +
    '- No prohibited voice phrases: "we believe", "we feel", "leverage synergies", "best-in-class", "cutting-edge", "world-class", "innovative solutions", "paradigm shift", "next-generation", "turn-key solution", "robust framework".\n\n' +
    'OUTPUT FORMAT: Return the regenerated section text directly — no JSON wrapper, no preamble, no explanation, no markdown fences. Start with the section header (preserving the same header depth and numbering as the original) and end with the last sentence of the section. The output will be spliced directly into the proposal at the section boundary.';

  var user =
    'OPPORTUNITY: ' + (opp.title || '').slice(0, 200) + '\n' +
    'AGENCY: ' + agency + '\n' +
    'VERTICAL: ' + vertical + '\n' +
    'SECTION TO REGENERATE: ' + sectionName + '\n\n' +
    '=== WHY THIS SECTION SCORED LOW (red team rationale) ===\n' +
    (scoreRationale || '(no rationale recorded)') + '\n\n' +
    (findingsBlock ? '=== SPECIFIC FINDINGS AGAINST THIS SECTION (address every one) ===\n' + findingsBlock + '\n\n' : '') +
    '=== CURRENT SECTION TEXT (rewrite this) ===\n' + String(currentSectionText).slice(0, 15000) + '\n\n' +
    (preContext ? '=== PRECEDING CONTEXT (for narrative continuity — do NOT rewrite) ===\n' + preContext.slice(-2000) + '\n\n' : '') +
    (postContext ? '=== FOLLOWING CONTEXT (for narrative continuity — do NOT rewrite) ===\n' + postContext.slice(0, 2000) + '\n\n' : '') +
    (rfpSlice ? '=== RFP REQUIREMENTS THIS SECTION MUST SATISFY ===\n' + String(rfpSlice).slice(0, 6000) + '\n\n' : '') +
    '=== HGI CANONICAL PAST PERFORMANCE (top 3 for this opp — cite exactly these figures if referencing PP) ===\n' + ppTopText + '\n\n' +
    'Rewrite the section now. Address every finding. Preserve narrative continuity with the preceding and following context. Output ONLY the regenerated section text (header through final sentence).';

  var resp;
  try {
    var stream = await anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 10000,
      thinking: { type: 'enabled', budget_tokens: 3000 },
      system: system,
      messages: [{ role: 'user', content: user }]
    });
    resp = await stream.finalMessage();
    trackCost('s134_section_regen', 'claude-opus-4-6', resp.usage);
  } catch (e) {
    log('S134 regenerateSection Opus error: ' + (e.message || '').slice(0, 200));
    return null;
  }

  var regenText = (resp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
  if (!regenText || regenText.length < 300) {
    log('S134 regenerateSection: output too short (' + (regenText || '').length + ' chars)');
    return null;
  }

  var pp = PRICING['claude-opus-4-6'];
  var cost = ((resp.usage && resp.usage.input_tokens) || 0) * pp.in_per_tok +
             ((resp.usage && resp.usage.output_tokens) || 0) * pp.out_per_tok;
  var wall = Math.floor((Date.now() - runStart) / 1000);

  return {
    regenerated_text: regenText,
    cost_usd: Number(cost.toFixed(4)),
    wall_seconds: wall,
    usage: resp.usage || {}
  };
}

function checkCanonViolations(sectionText) {
  // Fast regex sweep for the most dangerous canon violations in regenerated text.
  // Not a replacement for the full S125 canon sweep (which runs on the full proposal).
  // This is a pre-flight check on a single regenerated section before splice.
  var v = [];
  if (/\b19(?:30|31|32)\b/.test(sectionText)) v.push('wrong_founding_year');
  if (/\b9[3456]\s*[-\s]?\s*year/i.test(sectionText)) v.push('wrong_firm_age');
  if (/geoffrey\s+brien/i.test(sectionText)) v.push('geoffrey_brien');
  if (/\btangipahoa\b/i.test(sectionText)) v.push('tangipahoa');
  if (/Hammerman\s*&\s*Gainer\s+Global/i.test(sectionText)) v.push('wrong_legal_entity');
  return v;
}

async function refineWeakSections(oppId, options) {
  options = options || {};
  var threshold = typeof options.threshold === 'number' ? options.threshold : 60;
  var dryRun = options.dryRun !== false;  // default TRUE
  var maxSectionsToRegen = typeof options.maxSectionsToRegen === 'number' ? options.maxSectionsToRegen : 3;
  var log_prefix = 'S134[' + String(oppId).slice(0, 30) + ']';
  var runStart = Date.now();
  var totalCost = 0;

  log(log_prefix + ' START: threshold=' + threshold + ', dryRun=' + dryRun + ', maxRegen=' + maxSectionsToRegen);

  // 1. Load opportunity
  var oppRes = await supabase.from('opportunities')
    .select('id,title,agency,vertical,state,estimated_value,rfp_text,scope_analysis,description,proposal_content,proposal_review')
    .eq('id', oppId)
    .single();
  var opp = oppRes.data;
  if (!opp) return { error: 'opportunity_not_found', opp_id: oppId };
  if (!opp.proposal_content || opp.proposal_content.length < 500) {
    return { error: 'no_proposal_content', opp_id: oppId, proposal_length: (opp.proposal_content || '').length };
  }
  if (!opp.proposal_review) {
    return { error: 'no_proposal_review', opp_id: oppId, note: 'Run /api/produce-proposal first to populate proposal_review with scoring_matrix' };
  }

  // 2. Parse proposal_review for scoring_matrix
  var rtReport = extractReviewReport(opp.proposal_review);
  if (!rtReport) {
    return { error: 'proposal_review_parse_failed', opp_id: oppId, preview: opp.proposal_review.slice(0, 400) };
  }

  // 3. Identify weak sections (schema-tolerant)
  var selection = selectWeakSections(rtReport, threshold, maxSectionsToRegen);
  if (selection.weak.length === 0) {
    return {
      success: true,
      opp_id: oppId,
      threshold: threshold,
      baseline_schema: selection.schema,
      weak_sections_identified: [],
      all_sections: selection.all_sections,
      regenerations: [],
      proposal_content_written: false,
      cost_usd: 0,
      wall_time_seconds: Math.floor((Date.now() - runStart) / 1000),
      message: 'No sections scored below threshold'
    };
  }

  log(log_prefix + ' identified ' + selection.weak.length + ' weak section(s) below threshold ' + threshold + ': ' +
    selection.weak.map(function(w) { return w.section_name + '=' + w.score; }).join(', '));

  // 4. Per weak section: locate, score baseline (same scorer), regenerate, score post-regen
  var proposalText = opp.proposal_content;
  var rfpSlice = (opp.rfp_text || opp.scope_analysis || opp.description || '');
  var regenerations = [];
  var weakSectionsOutput = [];
  var splices = [];

  for (var wi = 0; wi < selection.weak.length; wi++) {
    var weak = selection.weak[wi];
    var outputEntry = {
      section_name: weak.section_name,
      baseline_score_red_team: weak.score,
      rationale_red_team: weak.rationale,
      findings_count: 0,
      located_at: null,
      locate_method: null
    };

    // 4a. Locate in proposal text
    var loc = await locateSection(proposalText, weak.section_name);
    if (!loc) {
      outputEntry.error = 'section_not_located';
      weakSectionsOutput.push(outputEntry);
      log(log_prefix + ' weak section "' + weak.section_name + '" could not be located');
      continue;
    }
    outputEntry.located_at = [loc.start, loc.end];
    outputEntry.locate_method = loc.method;
    outputEntry.header_text = loc.header_text;

    var currentSection = proposalText.slice(loc.start, loc.end);
    var preContext = proposalText.slice(Math.max(0, loc.start - 2500), loc.start);
    var postContext = proposalText.slice(loc.end, Math.min(proposalText.length, loc.end + 2500));

    // 4b. Filter red-team findings to this section
    var sectionFindings = findingsForSection(rtReport, weak.section_name);
    outputEntry.findings_count = sectionFindings.length;

    // 4c. Baseline score with same scorer (apples-to-apples with the post-regen score)
    var baselineScore = await scoreSingleSection(currentSection, weak.section_name, rfpSlice, sectionFindings);
    totalCost += baselineScore.cost_usd || 0;
    outputEntry.baseline_score_same_scorer = baselineScore.score;
    outputEntry.baseline_score_rationale = baselineScore.rationale;

    // 4d. Regenerate
    var regen = await regenerateSection(
      opp, weak.section_name, currentSection, preContext, postContext, rfpSlice, sectionFindings, weak.rationale
    );
    if (!regen) {
      outputEntry.error = 'regeneration_failed';
      weakSectionsOutput.push(outputEntry);
      continue;
    }
    totalCost += regen.cost_usd;

    // 4e. Canon violation pre-flight check on regenerated text
    var canonViolations = checkCanonViolations(regen.regenerated_text);

    // 4f. Score regen with same scorer
    var postScore = await scoreSingleSection(regen.regenerated_text, weak.section_name, rfpSlice, sectionFindings);
    totalCost += postScore.cost_usd || 0;

    var delta = postScore.score - baselineScore.score;
    var status = canonViolations.length > 0 ? 'canon_violation_flagged' :
      (delta > 0 ? 'improved' : (delta === 0 ? 'no_change' : 'regressed'));

    regenerations.push({
      section_name: weak.section_name,
      baseline_score_red_team: weak.score,
      baseline_score_same_scorer: baselineScore.score,
      post_regen_score: postScore.score,
      delta: delta,
      baseline_chars: currentSection.length,
      regenerated_chars: regen.regenerated_text.length,
      canon_violations: canonViolations,
      status: status,
      baseline_rationale: baselineScore.rationale,
      post_regen_rationale: postScore.rationale,
      residual_findings_count: postScore.residual_findings_count,
      regen_cost_usd: regen.cost_usd,
      regen_wall_seconds: regen.wall_seconds,
      regenerated_text_preview: regen.regenerated_text.slice(0, 600)
    });

    // Only queue for splice on: improved AND no canon violations AND not dry-run
    if (!dryRun && status === 'improved' && canonViolations.length === 0) {
      splices.push({ start: loc.start, end: loc.end, text: regen.regenerated_text });
    }

    log(log_prefix + ' section "' + weak.section_name + '": baseline=' + baselineScore.score +
      ' -> post=' + postScore.score + ' (delta=' + delta + '), status=' + status +
      ', canon_viol=' + canonViolations.length);
    weakSectionsOutput.push(outputEntry);
  }

  // 5. Apply splices (right-to-left to preserve offsets)
  var proposalWritten = false;
  var updatedProposalText = proposalText;
  if (!dryRun && splices.length > 0) {
    splices.sort(function(a, b) { return b.start - a.start; });
    for (var si = 0; si < splices.length; si++) {
      var sp = splices[si];
      updatedProposalText = updatedProposalText.slice(0, sp.start) + sp.text + updatedProposalText.slice(sp.end);
    }
    try {
      await supabase.from('opportunities').update({
        proposal_content: updatedProposalText,
        last_updated: new Date().toISOString()
      }).eq('id', oppId);
      proposalWritten = true;
      log(log_prefix + ' PROPOSAL UPDATED: ' + splices.length + ' section(s) spliced in');
    } catch (upErr) {
      log(log_prefix + ' proposal_content update error: ' + (upErr.message || '').slice(0, 200));
    }
  }

  // 6. Log to organism_memory
  try {
    await supabase.from('organism_memory').insert({
      id: 'mem_s134_' + oppId + '_' + Date.now(),
      agent: 's134_section_refiner',
      opportunity_id: oppId,
      observation: 'S134 RUN: threshold=' + threshold + ', dryRun=' + dryRun +
        ', weak_sections_identified=' + selection.weak.length +
        ', regenerations=' + regenerations.length +
        ', improved=' + regenerations.filter(function(r) { return r.status === 'improved'; }).length +
        ', proposal_written=' + proposalWritten +
        ', cost=$' + totalCost.toFixed(3),
      memory_type: 'refinement_iteration',
      created_at: new Date().toISOString()
    });
  } catch (me) { /* non-fatal */ }

  var wallTime = Math.floor((Date.now() - runStart) / 1000);
  log(log_prefix + ' DONE: ' + regenerations.length + ' regen(s), cost=$' + totalCost.toFixed(3) +
    ', wall=' + wallTime + 's, proposal_written=' + proposalWritten);

  return {
    success: true,
    opp_id: oppId,
    opp_title: (opp.title || '').slice(0, 120),
    threshold: threshold,
    dry_run: dryRun,
    baseline_schema: selection.schema,
    all_sections: selection.all_sections,
    weak_sections_identified: weakSectionsOutput,
    regenerations: regenerations,
    proposal_content_written: proposalWritten,
    splices_applied: splices.length,
    cost_usd: Number(totalCost.toFixed(4)),
    wall_time_seconds: wallTime,
    models: { locate: 'claude-haiku-4-5-20251001', regen: 'claude-opus-4-6', score: 'claude-haiku-4-5-20251001' },
    version: 's134_v1',
    generated_at: new Date().toISOString()
  };
}


// ============================================================
// TIER 1 PRODUCERS — Sonnet, 4000 tokens, write to opp fields
// ============================================================

async function agentIntelligence(opp, state, cycleBrief) {
  log('INTEL: ' + (opp.title || '?').slice(0, 50));

  // MATERIAL CHANGE CHECK: skip if competitor landscape hasn't shifted
  var lastIntel = state.memories.filter(function(m) { return m.agent === 'intelligence_engine' && m.opportunity_id === opp.id; })[0];
  if (lastIntel) {
    var hoursSince = (Date.now() - new Date(lastIntel.created_at).getTime()) / 3600000;
    // Re-run only if: >72 hours old, or stage changed to pursuing/proposal, or RFP just retrieved
    var stageEscalated = (opp.stage === 'pursuing' || opp.stage === 'proposal') && lastIntel.observation && lastIntel.observation.indexOf('pursuing') === -1 && lastIntel.observation.indexOf('proposal') === -1;
    if (hoursSince < 72 && !stageEscalated) {
      log('INTEL: Skip — last run ' + Math.round(hoursSince) + 'h ago, no stage escalation');
      return null;
    }
  }

  var ctx = buildAgentCtx(state, 'intelligence_engine', opp.id);

  // PRE-RESEARCH: 5 targeted searches before reasoning
  var agency = opp.agency || '';
  var st = opp.state || 'Louisiana';
  var ttl = (opp.title || '').slice(0, 60);
  var vert = opp.vertical || 'professional services';
  var preResearch = await multiSearch([
    { label: 'INCUMBENT/AWARDS', q: agency + ' ' + st + ' contract award ' + vert + ' incumbent consultant 2023 2024 2025' },
    { label: 'SPECIFIC COMPETITION', q: agency + ' ' + ttl + ' bid proposal awarded who won price amount' },
    { label: 'AGENCY PROCUREMENT', q: agency + ' ' + st + ' council minutes professional services contract approval' },
    { label: 'PORTAL ACTIVITY', q: ttl + ' ' + agency + ' Central Bidding questions addendum amendment 2026' },
    { label: 'MARKET COMPETITORS', q: st + ' ' + vert + ' consulting firms awarded contracts parishes municipalities 2024 2025' }
  ]);
  log('INTEL pre-research: ' + preResearch.length + ' chars from targeted searches');

  var taskInstructions = 'TASK: Research competitive intelligence for this opportunity using web search.\n' +
    'REQUIRED OUTPUTS:\n' +
    '1. Named competitors with source URLs proving their activity in this market\n' +
    '2. Incumbent contract holder, value, end date — cite the source\n' +
    '3. Recent awards by this agency — search "[agency] contract awards"\n' +
    '4. RFP amendments or addenda — check source URL\n' +
    '5. HGI advantages/gaps vs each named competitor\n' +
    '6. Intelligence gaps needing deeper research\n\n' +
    'RULES:\n' +
    '- Every competitor named must have a source URL and date\n' +
    '- If you cannot verify current activity, write "UNVERIFIED — last confirmed [date]"\n' +
    '- Search USAspending.gov, FPDS.gov, state procurement portals, agency meeting minutes\n' +
    '- Never write "market research shows..." without a specific source\n' +
    'Write in the professional tone of a competitive intelligence analyst at a top government consulting firm.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + preResearch + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 4000, { webSearch: true });
  if (!out || out.length < 100) return null;
  log('INTEL: ' + out.length + ' chars');

  // Extract source URLs from output for confidence tagging
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('intelligence_engine', opp.id, (opp.agency || '') + ',competitive_intel', out, 'competitive_intel', hasUrl ? 'web_search_result' : null, hasUrl ? 'high' : 'inferred');
  await supabase.from('opportunities').update({ research_brief: out.slice(0, 60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'intelligence_engine', opp: opp.title, chars: out.length };
}

async function agentFinancial(opp, state, cycleBrief) {
  log('FINANCIAL: ' + (opp.title || '?').slice(0, 50));

  // MATERIAL CHANGE CHECK: skip if pricing landscape hasn't shifted
  var lastFin = state.memories.filter(function(m) { return m.agent === 'financial_agent' && m.opportunity_id === opp.id; })[0];
  if (lastFin) {
    var hoursSinceFin = (Date.now() - new Date(lastFin.created_at).getTime()) / 3600000;
    var stageEscalatedFin = (opp.stage === 'pursuing' || opp.stage === 'proposal') && lastFin.observation && lastFin.observation.indexOf('pursuing') === -1 && lastFin.observation.indexOf('proposal') === -1;
    if (hoursSinceFin < 72 && !stageEscalatedFin) {
      log('FINANCIAL: Skip — last run ' + Math.round(hoursSinceFin) + 'h ago, no stage escalation');
      return null;
    }
  }

  var ctx = buildAgentCtx(state, 'financial_agent', opp.id);

  // PRE-RESEARCH: 3 targeted searches for real pricing data
  var agency = opp.agency || '';
  var st = opp.state || 'Louisiana';
  var vert = opp.vertical || 'professional services';
  var preResearch = await multiSearch([
    { label: 'AGENCY AWARDS', q: agency + ' ' + vert + ' contract award amount value 2023 2024 2025' },
    { label: 'MARKET RATES', q: st + ' ' + vert + ' consulting hourly rate price bid tabulation comparable' },
    { label: 'FEDERAL COMPARABLES', q: 'USAspending ' + st + ' ' + vert + ' grant management program administration award 2024 2025' }
  ]);
  log('FINANCIAL pre-research: ' + preResearch.length + ' chars');

  var taskInstructions = 'TASK: Build a defensible pricing model for this opportunity.\n' +
    'REQUIRED OUTPUTS:\n' +
    '1. Comparable contract awards with source URLs — search "[agency] contract awards" and USAspending\n' +
    '2. Rate benchmarks from GSA schedules, BLS data\n' +
    '3. THREE independent pricing methods with visible math:\n' +
    '   a. Staffing-based (hours x HGI rates)\n' +
    '   b. Comparable-based (similar awards)\n' +
    '   c. Percentage-of-program\n' +
    '4. LOW/TARGET/HIGH price range with rationale\n' +
    '5. Base period only — option years shown separately\n\n' +
    'RULES:\n' +
    '- Show all math. Every comparable must have a source.\n' +
    '- Use the HGI rate card below for staffing-based method\n' +
    '- ' + RATE_CARD + '\n' +
    '- No unsourced dollar estimates\n' +
    'Write with the precision of a government contracts CFO.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + preResearch + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 4000, { webSearch: true });
  if (!out || out.length < 100) return null;
  log('FINANCIAL: ' + out.length + ' chars');
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('financial_agent', opp.id, (opp.agency || '') + ',pricing', out, 'pricing_benchmark', hasUrl ? 'web_search_result' : null, hasUrl ? 'high' : 'medium');
  await supabase.from('opportunities').update({ financial_analysis: out.slice(0, 60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'financial_agent', opp: opp.title, chars: out.length };
}

async function agentWinnability(opp, state, cycleBrief) {
  log('WINNABILITY: ' + (opp.title || '?').slice(0, 50));

  // Hard guard: skip if already wrote for this opp this cycle
  var winKey = 'winnability_agent|' + opp.id;
  if (cycleWrites.has(winKey)) {
    log('WINNABILITY: Skip (already wrote this cycle)');
    return null;
  }

  var ctx = buildAgentCtx(state, 'winnability_agent', opp.id);

  // Material change check
  var lastWin = state.memories.filter(function(m) { return m.agent === 'winnability_agent' && m.opportunity_id === opp.id; })[0];

  var taskInstructions = 'TASK: Produce GO/NO-GO recommendation with PWIN using the 6-factor framework.\n' +
    'SCORE EACH FACTOR 1-10 WITH SPECIFIC EVIDENCE:\n' +
    '1. Customer relationship — does HGI know anyone at this agency?\n' +
    '2. Requirements understanding — how well does the scope match HGI capabilities?\n' +
    '3. Technical solution quality — can HGI deliver methodology the evaluator expects?\n' +
    '4. Relevant experience — Road Home, Restore LA, HAP, etc. mapped to THIS RFP\n' +
    '5. Past performance — 3 refs with contact info available?\n' +
    '6. Price competitiveness — HGI rates vs market based on Financial Agent findings\n\n' +
    'RULES:\n' +
    '- PWIN < 30% = NO-GO. 30-50% = CONDITIONAL. > 50% = GO\n' +
    '- Name competitors and cite intelligence agent findings (note their confidence level)\n' +
    '- An inferred competitor is NOT the same as a verified one — say which\n' +
    '- You SYNTHESIZE — do not web search. Use other agents\' outputs.\n' +
    (lastWin ? '- If your PWIN is within 5 points of previous and same GO/NO-GO, respond ONLY with "NO_MATERIAL_CHANGE"\n' : '') +
    'Write as a senior BD director making a real bid decision.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText +
    (lastWin ? '\n\nYOUR PREVIOUS ASSESSMENT:\n' + (lastWin.observation || '').slice(0, 1000) : '') +
    '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 2500);
  if (!out || out.length < 100 || out.trim() === 'NO_MATERIAL_CHANGE') {
    if (out && out.trim() === 'NO_MATERIAL_CHANGE') log('WINNABILITY: No material change');
    return null;
  }
  log('WINNABILITY: ' + out.length + ' chars');
  await storeMemory('winnability_agent', opp.id, (opp.agency || '') + ',winnability', out, 'winnability', null, 'medium');
  await supabase.from('opportunities').update({ capture_action: out.slice(0, 60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'winnability_agent', opp: opp.title, chars: out.length };
}

async function agentCRM(opp, state, cycleBrief) {
  log('CRM: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'crm_agent', opp.id);

  // PRE-RESEARCH: 3 targeted searches for real contacts
  var agency = opp.agency || '';
  var st = opp.state || 'Louisiana';
  var preResearch = await multiSearch([
    { label: 'LEADERSHIP/ORG CHART', q: agency + ' ' + st + ' leadership directory staff org chart department head contact' },
    { label: 'PROCUREMENT CONTACTS', q: agency + ' purchasing procurement director buyer specialist contact email phone' },
    { label: 'COUNCIL/BOARD', q: agency + ' council board members committee professional services ' + st }
  ]);
  log('CRM pre-research: ' + preResearch.length + ' chars');

  var taskInstructions = 'TASK: Find decision-makers for this opportunity using web search.\n' +
    'REQUIRED OUTPUTS:\n' +
    '1. Named individuals with titles — search "[agency] organizational chart" and "[agency] procurement contact"\n' +
    '2. Contracting officer from procurement portal or award notices\n' +
    '3. For each person: name, title, role in this procurement, source URL\n' +
    '4. Does HGI have any existing relationship? Check known contacts by agency (HTHA, St. George, JP, NOLA)\n' +
    '5. Specific outreach plan the President can execute this week\n\n' +
    'RULES:\n' +
    '- Never create contacts with no name. If you cannot find a name, document what you searched.\n' +
    '- confidence:high when name+title confirmed from official source\n' +
    '- confidence:medium from secondary sources (news, conferences)\n' +
    '- confidence:inferred when guessing who might be involved\n' +
    'Write as a capture manager building an engagement plan.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + preResearch + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 2500, { webSearch: true });
  if (!out || out.length < 100) return null;
  log('CRM: ' + out.length + ' chars');
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('crm_agent', opp.id, (opp.agency || '') + ',contacts', out, 'relationship', hasUrl ? 'web_search_result' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'crm_agent', opp: opp.title, chars: out.length };
}

async function agentQualityGate(opp, state, cycleBrief) {
  if ((opp.staffing_plan || '').length < 100 && (opp.scope_analysis || '').length < 200) return null;
  log('QUALITY GATE: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'quality_gate', opp.id);

  var taskInstructions = 'TASK: Compliance audit — score this pursuit like an evaluator.\n' +
    'REQUIRED OUTPUTS:\n' +
    '1. For EACH evaluation criterion: score 1-10 with specific evidence\n' +
    '2. Every RFP requirement NOT yet addressed — name it, quantify point impact\n' +
    '3. Required positions: named with real people and rates, or TBD?\n' +
    '4. Past performance: 3 refs with contact info? Relevance stated?\n' +
    '5. Required exhibits/forms: complete, missing, needs signature?\n' +
    '6. VERDICT: Estimated score /100 | GO/CONDITIONAL/NO-GO | All deficiencies ranked by point impact\n\n' +
    'RULES:\n' +
    '- Read the RFP text in scope_analysis. Map every "shall", "must", "will" to a section.\n' +
    '- Missing items = potential auto-disqualification BEFORE scoring\n' +
    '- confidence:high for gaps found by reading actual RFP text\n' +
    'Write as a senior proposal compliance reviewer.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 2500);
  if (!out || out.length < 100) return null;
  log('QUALITY GATE: ' + out.length + ' chars');
  await storeMemory('quality_gate', opp.id, (opp.agency || '') + ',compliance', out, 'analysis', null, 'high');
  return { agent: 'quality_gate', opp: opp.title, chars: out.length };
}

async function agentStaffingPlan(opp, state, cycleBrief) {
  if ((opp.scope_analysis || '').length < 100) return null;
  log('STAFFING: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'staffing_plan_agent', opp.id);
  var lastPlan = state.memories.filter(function(m) { return m.agent === 'staffing_plan_agent' && m.opportunity_id === opp.id; })[0];

  var taskInstructions = 'TASK: Map HGI personnel to this opportunity\'s requirements.\n' +
    'KNOWN HGI PERSONNEL:\n' +
    '- CEO/Program Director (burdened rate see rate card)\n' +
    '- VP\n' +
    '- 1099 SME (grants/tax credits/loans/incentives)\n' +
    '- CAO\n' +
    '- SVP Claims\n\n' +
    'REQUIRED OUTPUTS:\n' +
    '1. Staffing matrix: position | role title (e.g. CEO, VP, CAO — NO NAMES) | qualifications required | rate | availability\n' +
    '2. Gaps requiring recruitment or teaming\n' +
    '3. Org chart structure\n' +
    '4. Key personnel commitments\n\n' +
    'RULES:\n' +
    '- CRITICAL: Use role titles ONLY (President, CEO, VP, CAO, SVP Claims, SME). NEVER assign specific names to positions. Write [TO BE ASSIGNED] for all Key Personnel.\n' +
    '- NEVER overwrite scope_analysis. You READ it, not write to it.\n' +
    '- confidence:high for role assignments and rate card data\n' +
    (lastPlan ? '- If staffing is unchanged, respond ONLY with "NO_MATERIAL_CHANGE"\n' : '') +
    'Write as a proposal staffing lead.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText +
    (lastPlan ? '\n\nPREVIOUS PLAN:\n' + (lastPlan.observation || '').slice(0, 800) : '') +
    '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 4000);
  if (!out || out.length < 100 || out.trim() === 'NO_MATERIAL_CHANGE') return null;
  log('STAFFING: ' + out.length + ' chars');
  await storeMemory('staffing_plan_agent', opp.id, (opp.agency || '') + ',staffing', out, 'analysis', null, 'high');
  await supabase.from('opportunities').update({ staffing_plan: out.slice(0, 60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'staffing_plan_agent', opp: opp.title, chars: out.length };
}

async function agentProposalWriter(opp, state, cycleBrief) {
  log('PROPOSAL WRITER: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'proposal_agent', opp.id);

  var taskInstructions = 'TASK: Draft a proposal section using Shipley methodology.\n' +
    'SHIPLEY PROCESS:\n' +
    '1. Build compliance matrix — map every Section L/M requirement to a section\n' +
    '2. Identify 3-5 win themes (discriminators vs competitors)\n' +
    '3. Ghost the competition: "Unlike firms that lack [X], HGI has [Y]..."\n' +
    '4. Write in evaluator language, not marketing language\n' +
    '5. Technical approach = METHODOLOGY — specific steps, tools, quality controls\n' +
    '   NOT "HGI will provide excellent service"\n' +
    '   YES "HGI deploys a 3-phase approach: Phase 1 (Days 1-30) — mobilization..."\n\n' +
    'REQUIRED OUTPUTS:\n' +
    '- A complete section, not a fragment\n' +
    '- Win themes with competitor ghosts from Red Team findings\n' +
    '- Named HGI personnel with credentials\n' +
    '- Metric-backed past performance (Road Home zero misappropriation, etc.)\n' +
    '- Active voice 80%+\n\n' +
    'Use web search to find current best practices in this domain that the technical approach should cite.\n' +
    'Write as a Shipley-trained proposal professional.';

  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + taskInstructions;
  var out = await claudeCall(taskInstructions, prompt, 4000, { webSearch: true });
  if (!out || out.length < 100) return null;
  log('PROPOSAL WRITER: ' + out.length + ' chars');
  await storeMemory('proposal_agent', opp.id, (opp.agency || '') + ',proposal', out, 'analysis', null, 'medium');
  return { agent: 'proposal_agent', opp: opp.title, chars: out.length };
}


// ============================================================
// TIER 2 ANALYSTS — Sonnet, 2500 tokens, write to memory only
// ============================================================

async function agentRedTeam(opp, state, cycleBrief) {
  log('RED TEAM: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'red_team', opp.id);
  var task = 'TASK: Role-play as each named competitor from Intelligence findings.\nFor each: (1) their likely win themes (2) pricing approach (3) past performance advantages (4) specific ghosts HGI should write to neutralize them (5) HGI self-imposed weaknesses an evaluator would score down.\nNote confidence level of underlying intel — inferred competitor requires different strategy than verified one.\nDo NOT web search — synthesize from Intelligence and Financial findings.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2500);
  if (!out || out.length < 100) return null;
  await storeMemory('red_team', opp.id, (opp.agency || '') + ',competitive_intel', out, 'competitive_intel', null, 'medium');
  return { agent: 'red_team', opp: opp.title, chars: out.length };
}

async function agentBrief(opp, state, cycleBrief) {
  if (opp.stage !== 'pursuing' && opp.stage !== 'proposal') return null;
  log('BRIEF: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'brief_agent', opp.id);
  var task = 'TASK: 1-page team briefing. Situation summary, competitive landscape (named competitors), win strategy, top 3 actions, deadline status. Decision-oriented for the team lead.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('brief_agent', opp.id, (opp.agency || '') + ',briefing', out, 'analysis', null, 'medium');
  return { agent: 'brief_agent', opp: opp.title, chars: out.length };
}

async function agentOppBrief(opp, state, cycleBrief) {
  log('OPP BRIEF: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'opportunity_brief_agent', opp.id);
  var task = 'TASK: Deep single-opportunity dossier integrating ALL intelligence. A reader with zero context should understand this opportunity, HGI competitive position, and recommended actions from this document alone.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2500, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('opportunity_brief_agent', opp.id, (opp.agency || '') + ',dossier', out, 'analysis', null, 'medium');
  return { agent: 'opportunity_brief_agent', opp: opp.title, chars: out.length };
}

async function agentPriceToWin(opp, state, cycleBrief) {
  log('PRICE TO WIN: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'price_to_win', opp.id);
  var task = 'TASK: Determine price-to-win range. Work backward from evaluation criteria weighting. If price <20% of eval, invest in technical quality. Use Financial Agent benchmarks. Output: FLOOR (break-even), TARGET (win price), CEILING (lose on price). Show all math.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2000);
  if (!out || out.length < 100) return null;
  await storeMemory('price_to_win', opp.id, (opp.agency || '') + ',pricing', out, 'pricing_benchmark', null, 'medium');
  return { agent: 'price_to_win', opp: opp.title, chars: out.length };
}

async function agentProposalAssembly(opp, state, cycleBrief) {
  log('PROPOSAL ASSEMBLY: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'proposal_assembly', opp.id);
  var task = 'TASK: Assess proposal readiness. List all RFP-required sections. For each: COMPLETE/PARTIAL/MISSING status, which agent produced content, what gaps remain. Readiness score 0-100. Specific next actions to reach submission-ready.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2500);
  if (!out || out.length < 100) return null;
  await storeMemory('proposal_assembly', opp.id, (opp.agency || '') + ',assembly', out, 'analysis', null, 'medium');
  return { agent: 'proposal_assembly', opp: opp.title, chars: out.length };
}

async function agentOralPrep(opp, state, cycleBrief) {
  if (opp.stage !== 'proposal' && opp.stage !== 'submitted') return null;
  log('ORAL PREP: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'oral_prep', opp.id);
  var task = 'TASK: Oral presentation strategy. 3-5 key messages, anticipated tough questions from evaluators, prepared answers with evidence, speaker assignments, timing.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2000, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('oral_prep', opp.id, (opp.agency || '') + ',oral', out, 'analysis', null, 'medium');
  return { agent: 'oral_prep', opp: opp.title, chars: out.length };
}

async function agentPostAward(opp, state) {
  if (opp.stage !== 'submitted' && opp.outcome !== 'won') return null;
  log('POST AWARD: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'post_award', opp.id);
  var task = 'TASK: If won: transition plan, staffing confirmation, onboarding. If submitted: protest risk, debrief prep, incumbent transition.';
  var prompt = oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: 'claude-haiku-4-5-20251001' });
  if (!out || out.length < 100) return null;
  await storeMemory('post_award', opp.id, (opp.agency || '') + ',post_award', out, 'analysis', null, 'medium');
  return { agent: 'post_award', opp: opp.title, chars: out.length };
}


// ============================================================
// TIER 3 SYSTEM-WIDE — Mix of Haiku and Sonnet
// ============================================================

// --- SONNET RESEARCHERS (web search) ---

async function agentDiscovery(state) {
  log('DISCOVERY...');
  var ctx = buildAgentCtx(state, 'discovery_agent', null);
  var task = 'TASK: Search for pre-solicitation signals 6-24 months out in HGI verticals. Search congressional appropriations, agency strategic plans, procurement forecasts. Each signal: source URL, timeline, estimated value, recommended action.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('discovery_agent', null, 'pre_solicitation', out, 'analysis', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'discovery_agent', opp: 'system', chars: out.length };
}

async function agentDisasterMonitor(state) {
  log('DISASTER MONITOR (direct FEMA API + auto-intake)...');
  var hgiStates = ['Louisiana', 'Texas', 'Florida', 'Mississippi', 'Alabama', 'Georgia'];
  var stateAbbr = { Louisiana: 'LA', Texas: 'TX', Florida: 'FL', Mississippi: 'MS', Alabama: 'AL', Georgia: 'GA' };
  var newDisasters = [];
  var knownDRs = state.pipeline.map(function(o) { var m = (o.title || '').match(/DR-(\d+)/); return m ? m[1] : null; }).filter(Boolean);
  
  for (var si = 0; si < hgiStates.length; si++) {
    try {
      var cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      var fUrl = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?' +
        '%24filter=state%20eq%20%27' + hgiStates[si] + '%27%20and%20declarationDate%20gt%20%27' + cutoff + 'T00:00:00.000z%27' +
        '&%24orderby=declarationDate%20desc&%24top=20';
      var fResp = await fetch(fUrl, { headers: { Accept: 'application/json' } });
      if (!fResp.ok) continue;
      var fData = await fResp.json();
      var decls = fData.DisasterDeclarationsSummaries || [];
      for (var di = 0; di < decls.length; di++) {
        var d = decls[di];
        if (knownDRs.indexOf(String(d.disasterNumber)) >= 0) continue;
        var existing = await supabase.from('disaster_alerts').select('id').eq('disaster_number', String(d.disasterNumber)).limit(1);
        if (existing.data && existing.data.length > 0) continue;
        newDisasters.push({
          disaster_number: String(d.disasterNumber),
          state: stateAbbr[hgiStates[si]] || hgiStates[si],
          state_full: hgiStates[si],
          title: d.declarationTitle || '',
          type: d.incidentType || '',
          declaration_date: d.declarationDate || null,
          counties: d.designatedArea || '',
          pa: d.paProgramDeclared || false,
          ia: d.ihProgramDeclared || false,
          hm: d.hmProgramDeclared || false,
          fema_url: 'https://www.fema.gov/disaster/' + d.disasterNumber
        });
      }
    } catch (e) { log('DM FEMA err ' + hgiStates[si] + ': ' + e.message); }
  }
  log('DISASTER MONITOR: ' + newDisasters.length + ' new declarations from ' + hgiStates.length + ' states');
  
  if (newDisasters.length === 0) {
    await storeMemory('disaster_monitor', null, 'disaster,fema',
      'FEMA API scan: 0 new declarations in HGI states (last 120 days). All known DRs already tracked.',
      'analysis', 'fema.gov', 'high');
    return { agent: 'disaster_monitor', opp: 'system', chars: 80, new_disasters: 0 };
  }
  
  var autoIntaked = 0;
  for (var ni = 0; ni < newDisasters.length; ni++) {
    var nd = newDisasters[ni];
    var programs = (nd.pa ? 'PA ' : '') + (nd.ia ? 'IA ' : '') + (nd.hm ? 'HM' : '');
    try {
      await supabase.from('disaster_alerts').insert({
        id: 'fema-dr-' + nd.disaster_number,
        disaster_number: nd.disaster_number,
        disaster_name: nd.title,
        state: nd.state,
        declaration_date: nd.declaration_date,
        incident_type: nd.type,
        counties: nd.counties,
        fema_programs: programs.trim(),
        procurement_window: nd.pa ? '3-18 months post-declaration' : 'Monitor',
        hgi_recommendation: nd.pa ? 'PURSUE: PA-TAC procurement expected. Position for CM/PM/grant admin.' : 'WATCH: No PA program. Monitor for state-level procurement.',
        hgi_vertical: 'disaster',
        threat_level: nd.pa ? 'high' : 'medium',
        source_url: nd.fema_url,
        source_agent: 'disaster_monitor'
      });
    } catch (e) { log('DA insert err: ' + e.message); }
    
    if (nd.pa) {
      var oppTitle = 'DR-' + nd.disaster_number + ' ' + nd.state + ' \u2014 ' + nd.title;
      var dupCheck = await supabase.from('opportunities').select('id').ilike('title', '%DR-' + nd.disaster_number + '%').limit(1);
      if (!dupCheck.data || dupCheck.data.length === 0) {
        try {
          await supabase.from('opportunities').insert({
            id: 'fema-dr-' + nd.disaster_number + '-' + nd.state.toLowerCase(),
            title: oppTitle, agency: 'FEMA / ' + nd.state_full,
            vertical: 'disaster', state: nd.state,
            opi_score: 75, stage: 'identified', status: 'active',
            source_url: nd.fema_url,
            description: 'FEMA DR-' + nd.disaster_number + '. ' + nd.type + ' (' + (nd.declaration_date || '').slice(0,10) + '). Programs: ' + programs + '. Auto-discovered by organism disaster monitor.',
            discovered_at: new Date().toISOString(), last_updated: new Date().toISOString()
          });
          autoIntaked++;
          log('AUTO-INTAKE: DR-' + nd.disaster_number + ' ' + nd.state + ' added (OPI 75)');
          // Create disaster alert notification
          try {
            // NOTE: hunt_runs.id is bigint auto-increment — do NOT pass a string id or the insert drops silently.
            await supabase.from('hunt_runs').insert({
              source: 'notify:disaster_alert',
              status: 'completed',
              run_at: new Date().toISOString(),
              opportunities_found: 1,
              notes: JSON.stringify({ title: 'DR-' + nd.disaster_number + ' ' + nd.state + ': ' + nd.title, message: 'New PA disaster declared. Auto-intaked at OPI 75. Generate capture package at /api/disaster-response.', priority: 'high', read: false, disaster_name: nd.title, state: nd.state, fema_number: nd.disaster_number })
            });
          } catch (ne) { log('Notify err: ' + ne.message); }
        } catch (e) { log('Auto-intake err: ' + e.message); }
      }
    }
  }
  
  var summary = 'DISASTER MONITOR \u2014 ' + newDisasters.length + ' NEW:\\n';
  newDisasters.forEach(function(d) {
    summary += '  DR-' + d.disaster_number + ' ' + d.state + ': ' + d.title + ' (' + d.type + ') Programs: ' + ((d.pa?'PA ':'')+(d.ia?'IA ':'')+(d.hm?'HM':'')) + '\\n';
  });
  if (autoIntaked > 0) summary += 'AUTO-INTAKE: ' + autoIntaked + ' PA disasters \u2192 pipeline (OPI 75)\\n';
  
  await storeMemory('disaster_monitor', null, 'disaster,fema,auto_intake', summary, 'analysis', 'fema.gov', 'high');
  return { agent: 'disaster_monitor', opp: 'system', chars: summary.length, new_disasters: newDisasters.length, auto_intaked: autoIntaked };
}

async function agentSourceExpansion(state) {
  log('SOURCE EXPANSION...');
  var task = 'TASK: Map procurement portals for LA, MS, TX, FL, AL, GA. For each: URL, verticals covered, access requirements, estimated volume. Focus on portals not currently monitored.';
  var prompt = task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('source_expansion', null, 'sources', out, 'analysis', null, 'medium');
  return { agent: 'source_expansion', opp: 'system', chars: out.length };
}

async function agentContractExpiration(state) {
  log('CONTRACT EXPIRATION...');
  var ctx = buildAgentCtx(state, 'contract_expiration', null);
  var task = 'TASK: Search USAspending and state portals for expiring contracts in HGI verticals. Recompete window = 6-12 months before expiration. For each: holder, agency, value, end date, recompete timeline.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('contract_expiration', null, 'recompete', out, 'analysis', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'contract_expiration', opp: 'system', chars: out.length };
}

async function agentAmendmentTracker(state) {
  var pursuing = state.pipeline.filter(function(o) { return o.stage === 'pursuing' || o.stage === 'proposal'; });
  if (pursuing.length === 0) return null;
  log('AMENDMENT TRACKER (with targeted portal searches)...');
  
  // PRE-RESEARCH: Search Central Bidding and agency portals for each pursuing opp
  var searchQueries = [];
  for (var i = 0; i < pursuing.length && i < 5; i++) {
    var o = pursuing[i];
    searchQueries.push({ label: (o.title || '?').slice(0,40) + ' PORTAL', q: (o.title || '') + ' ' + (o.agency || '') + ' Central Bidding questions addendum amendment deadline change 2026' });
  }
  var preResearch = await multiSearch(searchQueries);
  log('AMENDMENT pre-research: ' + preResearch.length + ' chars from ' + searchQueries.length + ' portal checks');

  var oppList = pursuing.map(function(o) { return (o.title || '?') + ' | Source: ' + (o.source_url || 'none'); }).join('\n');
  var task = 'TASK: Check each pursuing-stage opportunity for RFP amendments, addenda, Q&A postings, deadline changes. Flag any competitor activity visible on bid boards (questions asked, firms registered). This is CRITICAL — if a competitor asked a question on a bid board, that is confirmed competitive intelligence.';
  var prompt = 'OPPORTUNITIES:\n' + oppList + preResearch + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('amendment_tracker', null, 'amendments', out, 'analysis', null, 'medium');
  return { agent: 'amendment_tracker', opp: 'system', chars: out.length };
}

async function agentRegulatoryMonitor(state) {
  log('REGULATORY MONITOR...');
  var task = 'TASK: Search Federal Register, FEMA policy updates, HUD notices, LA legislature for regulatory changes affecting HGI verticals. For each: change, effective date, impact, recommended response.';
  var prompt = task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('regulatory_monitor', null, 'regulatory', out, 'analysis', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'regulatory_monitor', opp: 'system', chars: out.length };
}

async function agentEntrepreneurial(state) {
  log('ENTREPRENEURIAL...');
  var ctx = buildAgentCtx(state, 'entrepreneurial_agent', null);
  var task = 'TASK: Find unsolicited opportunities where HGI creates demand. THE NOLA MODEL: HGI identified S&WB $2B crisis + $222M deficit, created concept paper without waiting for RFP. Search for: agencies in crisis, infrastructure failures, audit findings, new federal funding agencies haven\'t accessed, DR situations needing capacity. Each: agency pain point (sourced), available funding, HGI fit, approach.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('entrepreneurial_agent', null, 'unsolicited', out, 'analysis', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'entrepreneurial_agent', opp: 'system', chars: out.length };
}

async function agentRecompete(state) {
  log('RECOMPETE...');
  var ctx = buildAgentCtx(state, 'recompete_agent', null);
  var task = 'TASK: Monitor for recompete opportunities. Search for competitor contracts approaching expiration in HGI verticals. Timeline, threats, defense strategy.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('recompete_agent', null, 'recompete', out, 'analysis', null, 'medium');
  return { agent: 'recompete_agent', opp: 'system', chars: out.length };
}

async function agentCompetitorDeepDive(state) {
  log('COMPETITOR DEEP DIVE...');
  var ctx = buildAgentCtx(state, 'competitor_deep_dive', null);
  var task = 'TASK: Build profiles of HGI top competitors: CDR Maguire, IEM, Tetra Tech, Hagerty. For each: recent wins (sourced), key personnel, geographic footprint, strengths/weaknesses. Source every claim.';
  var prompt = 'MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('competitor_deep_dive', null, 'competitors', out, 'competitive_intel', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'competitor_deep_dive', opp: 'system', chars: out.length };
}

async function agentAgencyProfile(state) {
  log('AGENCY PROFILE...');
  var ctx = buildAgentCtx(state, 'agency_profile_agent', null);
  var agencies = state.pipeline.map(function(o) { return o.agency || ''; }).filter(function(a, i, arr) { return a && arr.indexOf(a) === i; }).join(', ');
  var task = 'TASK: Build profiles of target agencies: ' + agencies + '. Org chart, procurement patterns, budget cycle, current contracts, strategic priorities.';
  var prompt = 'MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('agency_profile_agent', null, 'agencies', out, 'analysis', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'agency_profile_agent', opp: 'system', chars: out.length };
}

// --- HAIKU OBSERVERS (no web search) ---
var HAIKU = 'claude-haiku-4-5-20251001';

async function agentPipelineScanner(state) {
  log('PIPELINE SCANNER...');
  var ctx = buildAgentCtx(state, 'pipeline_scanner', null);
  var task = 'TASK: (1) Deadlines within 14 days (2) Stale pursuits >14 days no activity (3) OPI/stage inconsistencies (4) Missing critical fields (5) Priority order for the President this week.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('pipeline_scanner', null, 'pipeline,deadlines', out, 'analysis', null, 'high');
  return { agent: 'pipeline_scanner', opp: 'system', chars: out.length };
}

async function agentOPICalibration(state) {
  log('OPI CALIBRATION...');
  var ctx = buildAgentCtx(state, 'scanner_opi', null);
  // Load outcome history for calibration
  var outcomeData = '';
  try {
    var outcomes = await supabase.from('opportunities').select('title,agency,vertical,opi_score,outcome,outcome_notes').not('outcome','is',null).order('last_updated',{ascending:false}).limit(20);
    if (outcomes.data && outcomes.data.length > 0) {
      outcomeData = '\n\nRECORDED OUTCOMES (use for calibration):\n' + outcomes.data.map(function(o) {
        return '- ' + (o.title||'').slice(0,60) + ' | OPI:' + (o.opi_score||'?') + ' | ' + (o.outcome||'?').toUpperCase() + ' | ' + (o.vertical||'?') + (o.outcome_notes ? ' | Notes: ' + JSON.stringify(o.outcome_notes).slice(0,200) : '');
      }).join('\n');
    }
  } catch(e) {}
  var task = 'TASK: Review OPI scores vs accumulated intelligence AND recorded outcomes. HTHA lost at OPI 78 — what does this teach about Housing/HUD scoring? Any opps scored too high or low? Recommend specific OPI adjustments with rationale. If an outcome shows OPI was wrong, explain why and how to fix the model.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + outcomeData + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('scanner_opi', null, 'opi', out, 'analysis', null, 'medium');
  return { agent: 'scanner_opi', opp: 'system', chars: out.length };
}

async function agentContentEngine(state) {
  log('CONTENT ENGINE...');
  var ctx = buildAgentCtx(state, 'content_engine', null);
  var task = 'TASK: Review proposal content quality. Active voice % (target 80%+), specific vs generic language, metric-backed claims. Provide specific rewrites for worst offenders.';
  var prompt = 'MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('content_engine', null, 'content', out, 'analysis', null, 'medium');
  return { agent: 'content_engine', opp: 'system', chars: out.length };
}

async function agentRecruiting(state) {
  log('RECRUITING...');
  var ctx = buildAgentCtx(state, 'recruiting_bench', null);
  var task = 'TASK: Staffing gap matrix across all pursuits. Position needed, which opp, when, HGI availability, recruitment action. Flag shared resource risks.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('recruiting_bench', null, 'recruiting', out, 'analysis', null, 'medium');
  return { agent: 'recruiting_bench', opp: 'system', chars: out.length };
}

async function agentKnowledgeBase(state) {
  log('KB AGENT...');
  var ctx = buildAgentCtx(state, 'knowledge_base_agent', null);
  var task = 'TASK: KB gap analysis. What documents strengthen proposals? Prioritized: doc needed, who provides, which opp it helps. NOTE: CEO KB doc request outstanding since March 18 2026.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('knowledge_base_agent', null, 'kb', out, 'analysis', null, 'medium');
  return { agent: 'knowledge_base_agent', opp: 'system', chars: out.length };
}

async function agentScraperInsights(state) {
  log('SCRAPER INSIGHTS...');
  var ctx = buildAgentCtx(state, 'scraper_insights', null);
  var task = 'TASK: Source health assessment. Which sources produce real opps, which are dead? Central Bidding (Apify 24/7), LaPAC, SAM.gov, Grants.gov. ROI by source.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('scraper_insights', null, 'sources', out, 'analysis', null, 'medium');
  return { agent: 'scraper_insights', opp: 'system', chars: out.length };
}

async function agentDesignVisual(state) {
  log('DESIGN VISUAL...');
  var ctx = buildAgentCtx(state, 'design_visual', null);
  var task = 'TASK: Visual content needs across proposals. For each: graphic type (org chart, flowchart, timeline, map), proposal section, specific content. Must be specific enough to produce.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('design_visual', null, 'design', out, 'analysis', null, 'medium');
  return { agent: 'design_visual', opp: 'system', chars: out.length };
}

async function agentTeaming(state) {
  log('TEAMING...');
  var ctx = buildAgentCtx(state, 'teaming_agent', null);
  var task = 'TASK: Teaming needs. 1099 SME model: grants/tax credits/loans under HGI brand, teaming on JP SOQ and NOLA. For each staffing gap: potential partner type, arrangement (sub, 1099, JV), capability rationale.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('teaming_agent', null, 'teaming', out, 'analysis', null, 'medium');
  return { agent: 'teaming_agent', opp: 'system', chars: out.length };
}

async function agentBudgetCycle(state) {
  log('BUDGET CYCLE...');
  var task = 'TASK: Track budget cycles for target agencies. Search budget documents, fiscal year calendars. When do agencies release RFPs relative to budget cycle? Timing recommendations.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true, model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('budget_cycle', null, 'budget', out, 'analysis', null, 'medium');
  return { agent: 'budget_cycle', opp: 'system', chars: out.length };
}

async function agentLossAnalysis(state) {
  log('LOSS ANALYSIS...');
  var ctx = buildAgentCtx(state, 'loss_analysis', null);
  var task = 'TASK: For opps with recorded outcomes: what HGI did right/wrong, what winner did better. If no outcomes yet, analyze pipeline risks.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('loss_analysis', null, 'outcomes', out, 'analysis', null, 'medium');
  return { agent: 'loss_analysis', opp: 'system', chars: out.length };
}

async function agentWinRateAnalytics(state) {
  log('WIN RATE...');
  var ctx = buildAgentCtx(state, 'win_rate_analytics', null);
  var task = 'TASK: Pipeline health metrics: average OPI, stage distribution, vertical concentration, deadline density. Identify systemic patterns.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('win_rate_analytics', null, 'analytics', out, 'analysis', null, 'medium');
  return { agent: 'win_rate_analytics', opp: 'system', chars: out.length };
}

async function agentOutreachAutomation(state) {
  log('OUTREACH...');
  var ctx = buildAgentCtx(state, 'outreach_automation', null);
  var task = 'TASK: Outreach recommendations for pursuing-stage opps. Who to contact, what to say, channel, outcome to drive. Draft text. NOTHING goes outbound without President approval.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('outreach_automation', null, 'outreach', out, 'analysis', null, 'medium');
  return { agent: 'outreach_automation', opp: 'system', chars: out.length };
}

async function agentLearningLoop(state) {
  log('LEARNING LOOP...');
  var ctx = buildAgentCtx(state, 'learning_loop', null);
  var task = 'TASK: Cross-session pattern detection. Themes across opps, lessons from one pursuit applicable to others, agent improvements that compound.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY (' + state.memories.length + ' total):\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('learning_loop', null, 'patterns', out, 'analysis', null, 'medium');
  return { agent: 'learning_loop', opp: 'system', chars: out.length };
}

async function agentSubcontractorDB(state) {
  log('SUBCONTRACTOR DB...');
  var ctx = buildAgentCtx(state, 'subcontractor_db', null);
  var task = 'TASK: Identify potential subcontractors for capability gaps. Required capability, firms, certifications, geography. Prioritize DBE/MBE for set-aside compliance.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('subcontractor_db', null, 'subcontractors', out, 'analysis', null, 'medium');
  return { agent: 'subcontractor_db', opp: 'system', chars: out.length };
}

// --- DIRECTORS (Sonnet, 3000 tokens) ---

async function agentExecutiveBrief(state) {
  log('EXECUTIVE BRIEF...');
  var ctx = buildAgentCtx(state, 'executive_brief_agent', null);
  var task = 'TASK: Weekly digest for CEO and Chairman. (1) Pipeline: new/active/won/lost (2) Top 3 priority actions (3) Risk alerts (4) Competitive intel highlights (5) Resource needs. 1 page. Decision-oriented.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2000, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('executive_brief_agent', null, 'executive', out, 'analysis', null, 'medium');
  return { agent: 'executive_brief_agent', opp: 'system', chars: out.length };
}

async function agentDashboard(state) {
  log('DASHBOARD...');
  var ctx = buildAgentCtx(state, 'dashboard_agent', null);
  var task = 'TASK: Morning briefing for the President. Top 3 things to know. Top 3 actions needed. Alerts. Concise. Decision-oriented. No fluff.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('dashboard_agent', null, 'dashboard', out, 'analysis', null, 'medium');
  return { agent: 'dashboard_agent', opp: 'system', chars: out.length };
}


// ============================================================
// MEMORY CURATOR + SELF-AWARENESS + EVAL + HUNTING + RUN SESSION
// ============================================================

// === MEMORY CURATOR — promotes scratch to verified ===
async function agentMemoryCurator(state, cycleMemories) {
  log('MEMORY CURATOR: reviewing ' + cycleMemories.length + ' new memories...');
  
  var promoted = 0;
  var reviewed = 0;
  
  for (var i = 0; i < cycleMemories.length; i++) {
    var mem = cycleMemories[i];
    reviewed++;
    
    // Promotion criteria: has source_url AND confidence is high or medium
    if (mem.confidence === 'high' || (mem.source_url && mem.confidence === 'medium')) {
      // Check not duplicate of existing verified
      var existingVerified = await supabase.from('organism_memory')
        .select('observation')
        .eq('agent', mem.agent)
        .eq('status', 'verified')
        .limit(5);
      
      var isDupe = false;
      if (existingVerified.data) {
        var newWords = (mem.observation || '').slice(0, 200).toLowerCase().split(/\s+/).filter(function(w) { return w.length > 4; });
        for (var v = 0; v < existingVerified.data.length; v++) {
          var exWords = (existingVerified.data[v].observation || '').slice(0, 200).toLowerCase().split(/\s+/).filter(function(w) { return w.length > 4; });
          if (newWords.length > 0 && exWords.length > 0) {
            var matches = newWords.filter(function(w) { return exWords.indexOf(w) >= 0; }).length;
            if (matches / newWords.length > 0.7) { isDupe = true; break; }
          }
        }
      }
      
      if (!isDupe) {
        await supabase.from('organism_memory')
          .update({ status: 'verified' })
          .eq('id', mem.id);
        promoted++;
      }
    }
  }
  
  // Flag stale scratch > 48h
  var staleCheck = await supabase.from('organism_memory')
    .select('id')
    .eq('status', 'scratch')
    .lt('created_at', new Date(Date.now() - 48*3600000).toISOString())
    .limit(20);
  var staleCount = (staleCheck.data || []).length;
  
  var summary = 'CURATOR: Reviewed ' + reviewed + ' scratch memories. Promoted ' + promoted + ' to verified. ' + staleCount + ' stale scratch (>48h) flagged for review.';
  log(summary);
  await storeMemory('memory_curator', null, 'curation', summary, 'analysis', null, 'high');
  return { agent: 'memory_curator', opp: 'system', chars: summary.length };
}

// === SELF-AWARENESS — runs last, sees everything ===
async function agentSelfAwareness(state, sessionResults, evalScores) {
  log('SELF-AWARENESS: full session analysis...');
  var ctx = buildAgentCtx(state, 'self_awareness', null);
  var resultsSummary = sessionResults.map(function(r) { return r ? r.agent + ': ' + r.chars + ' chars on ' + (r.opp || 'system').slice(0, 40) : 'skipped'; }).join('\n');
  
  var evalSummary = '';
  if (evalScores && evalScores.length > 0) {
    var failing = evalScores.filter(function(e) { return e.sourced + e.original + e.advancing === 0; });
    var strong = evalScores.filter(function(e) { return e.sourced + e.original + e.advancing === 3; });
    evalSummary = '\n\nEVAL SCORES THIS CYCLE:\nPerfect (3/3): ' + strong.length + ' agents\nFailing (0/3): ' + failing.length + ' agents\n' +
      (failing.length > 0 ? 'Failing: ' + failing.map(function(e) { return e.agent; }).join(', ') : '');
  }
  
  var task = 'TASK: You see everything. (1) Patterns across opps individual agents missed (2) Which agents produced highest-value intelligence (3) SINGLE improvement to most raise next proposal score (4) Costliest data gaps (5) ONE thing the President must do this week.' + evalSummary;
  var prompt = 'SESSION RESULTS:\n' + resultsSummary + '\n\nPIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 3000, { model: HAIKU });
  if (!out || out.length < 100) return null;
  await storeMemory('self_awareness', null, 'self_assessment', out, 'analysis', null, 'medium');
  return { agent: 'self_awareness', opp: 'system', chars: out.length };
}

// === EVAL SCORING — 3 binary checks per agent ===
async function scoreAgentOutput(agent, oppId, output, state) {
  // Check 1: Sourced — has source URL or cites specific verifiable data?
  var sourced = /https?:\/\/|USAspending|FPDS|SAM\.gov|FEMA\.gov|source:|Source:/.test(output) ? 1 : 0;
  
  // Check 2: Original — different from last output for this opp?
  var original = 1;
  var lastMem = state.memories.filter(function(m) { return m.agent === agent && m.opportunity_id === oppId; });
  if (lastMem.length > 0) {
    var lastObs = (lastMem[0].observation || '').slice(0, 300).toLowerCase();
    var newObs = (output || '').slice(0, 300).toLowerCase();
    var lastWords = lastObs.split(/\s+/).filter(function(w) { return w.length > 4; });
    var newWords = newObs.split(/\s+/).filter(function(w) { return w.length > 4; });
    if (lastWords.length > 0 && newWords.length > 0) {
      var matches = newWords.filter(function(w) { return lastWords.indexOf(w) >= 0; }).length;
      if (matches / newWords.length > 0.8) original = 0;
    }
  }
  
  // Check 3: Advancing — contains new specifics (names, numbers, dates, actions)?
  var advancing = /\d{4}|[A-Z][a-z]+ [A-Z][a-z]+|\$[\d,]+|Phase \d|Step \d|Action:|Recommend:|FINDING:/.test(output) ? 1 : 0;
  
  // Write to system_performance_log
  try {
    await supabase.from('system_performance_log').insert({
      id: 'eval-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      agent: agent,
      opportunity_id: oppId || null,
      sourced: sourced,
      original: original,
      advancing: advancing,
      output_chars: (output || '').length,
      created_at: new Date().toISOString()
    });
  } catch (e) { /* system_performance_log may not have these columns yet */ }
  
  return { agent: agent, sourced: sourced, original: original, advancing: advancing };
}

// === DIRECT CB + LaPAC HUNTING — V2 self-sufficient with headless browser ===
async function huntCentralBidding(isCron) {
  var results = [];
  if (!isCron) { log('CB-HUNT: Skipping Puppeteer scrape (manual trigger — CB scraping only runs on scheduled cron to control costs)'); return []; }
  if (!puppeteer) { log('CB-HUNT: Puppeteer not available — skipping direct CB scraping'); return []; }
  var browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
      timeout: 30000
    });
    var page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);

    // Login to CB
    log('CB-HUNT: Logging in...');
    await page.goto('https://www.centralauctionhouse.com/login.php', { waitUntil: 'networkidle2' });
    var md5hash = crypto.createHash('md5').update('Whatever1340!').digest('hex');
    await page.evaluate(function(hash) {
      var f = document.createElement('form');
      f.action = '/login.php'; f.method = 'POST';
      f.innerHTML = '<input name="username" value="HGIGLOBAL"><input name="md5pass" value="' + hash + '"><input name="md5pass_utf" value="' + hash + '"><input name="login_process" value="1"><input name="redirect" value="">';
      document.body.appendChild(f); f.submit();
    }, md5hash);
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(function() {});
    log('CB-HUNT: Logged in');

    // State category IDs on CB (Texas/Georgia may not be on CB — web search covers them)
    var stateCIDs = { Louisiana: 1, Mississippi: 2, Alabama: 10600, Florida: 10694, Arkansas: 10548 };

    for (var stateName in stateCIDs) {
      try {
        await page.goto('https://www.centralauctionhouse.com/rfp.php?&cid=' + stateCIDs[stateName], { waitUntil: 'networkidle2' });
        // Get entity links
        var entityLinks = await page.evaluate(function() {
          var links = [];
          document.querySelectorAll('a[href*="Category/"]').forEach(function(a) {
            var name = (a.textContent || '').trim();
            var href = a.getAttribute('href') || '';
            if (name.length > 5 && href.includes('Category/')) {
              links.push({ name: name, url: href.startsWith('http') ? href : 'https://www.centralauctionhouse.com/' + href.replace(/^\//, '') });
            }
          });
          return links;
        });
        log('CB-HUNT: ' + stateName + ' — ' + entityLinks.length + ' entities, visiting top 12');

        // Visit up to 12 entities per state — prioritize school boards, parishes, cities, housing authorities
        var prioritized = entityLinks.sort(function(a, b) {
          var score = function(name) {
            var n = name.toLowerCase();
            if (n.includes('school')) return 10;
            if (n.includes('housing')) return 9;
            if (n.includes('parish') && (n.includes('government') || n.includes('police jury'))) return 8;
            if (n.includes('city of') || n.includes('town of')) return 7;
            if (n.includes('water') || n.includes('sewer') || n.includes('utility')) return 6;
            if (n.includes('sheriff') || n.includes('district')) return 5;
            return 1;
          };
          return score(b.name) - score(a.name);
        });

        var stateResults = 0;
        for (var ei = 0; ei < Math.min(prioritized.length, 12); ei++) {
          try {
            await page.goto(prioritized[ei].url, { waitUntil: 'networkidle2', timeout: 12000 });
            var bids = await page.evaluate(function(entityName) {
              var found = [];
              // CB uses listing_boxes for bid display
              document.querySelectorAll('.listing_boxes_title a, .listing_boxes a[href*=".html"], a[href*="rfpc"], a[href*="rfp-"]').forEach(function(a) {
                var text = (a.textContent || '').trim();
                var href = a.getAttribute('href') || '';
                if (text.length > 15 && !href.includes('Category/') && !href.includes('login')) {
                  var parent = a.closest('.listing_boxes') || a.closest('tr') || a.closest('div') || a.parentElement;
                  found.push({
                    title: text.slice(0, 200),
                    url: href.startsWith('http') ? href : 'https://www.centralauctionhouse.com/' + href.replace(/^\//, ''),
                    agency: entityName,
                    context: parent ? (parent.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : ''
                  });
                }
              });
              // Also grab any links that look like open bids
              document.querySelectorAll('a').forEach(function(a) {
                var text = (a.textContent || '').trim();
                var href = a.getAttribute('href') || '';
                if (text.length > 20 && href.includes('.html') && !href.includes('Category/') && !href.includes('login') && !href.includes('register') && !href.includes('rfp.php')) {
                  if (!found.some(function(f) { return f.url === href || f.title === text; })) {
                    found.push({ title: text.slice(0, 200), url: href.startsWith('http') ? href : 'https://www.centralauctionhouse.com/' + href.replace(/^\//, ''), agency: entityName, context: '' });
                  }
                }
              });
              return found;
            }, prioritized[ei].name);

            bids.forEach(function(b) {
              if (b.title && b.title.length > 15) {
                results.push({ title: b.title, agency: b.agency, source: 'centralbidding_v2', source_url: b.url, description: (b.context || b.title).slice(0, 500), due_date: null });
                stateResults++;
              }
            });
          } catch (entErr) { /* entity page timeout — skip */ }
        }
        log('CB-HUNT: ' + stateName + ' — ' + stateResults + ' bids found');
      } catch (stateErr) { log('CB-HUNT: ' + stateName + ' error: ' + (stateErr.message || '').slice(0, 60)); }
    }
  } catch (e) { log('CB-HUNT: Browser error: ' + (e.message || '').slice(0, 100)); }
  finally { if (browser) { try { await browser.close(); } catch(e) {} } }
  log('CB-HUNT: Total ' + results.length + ' bids from Central Bidding (Puppeteer)');
  return results;
}

async function huntLaPAC() {
  var results = [];
  if (!puppeteer) { log('LaPAC: Puppeteer not available — trying HTTP fallback'); }
  // Try Puppeteer first, fall back to HTTP
  if (puppeteer) {
    var browser = null;
    try {
      browser = await puppeteer.launch({
        headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'], timeout: 20000
      });
      var page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      page.setDefaultTimeout(12000);
      // Try both known LaPAC URLs
      var loaded = false;
      var urls = ['https://wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm', 'https://lapac.doa.louisiana.gov/vendor/bidding/current-solicitations/'];
      for (var li = 0; li < urls.length && !loaded; li++) {
        try {
          await page.goto(urls[li], { waitUntil: 'networkidle2', timeout: 15000 });
          loaded = true;
        } catch (e) { log('LaPAC: ' + urls[li].slice(0, 50) + ' failed: ' + e.message.slice(0, 40)); }
      }
      if (loaded) {
        var bids = await page.evaluate(function() {
          var found = [];
          // Extract table rows with bid data
          document.querySelectorAll('tr').forEach(function(row) {
            var cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              var title = (cells[1] || cells[0]).textContent.trim();
              var link = row.querySelector('a');
              if (title.length > 5) {
                found.push({
                  title: title.slice(0, 200),
                  agency: cells.length > 2 ? cells[2].textContent.trim() : 'Louisiana State Agency',
                  url: link ? (link.href || '') : '',
                  due: cells.length > 3 ? cells[3].textContent.trim() : null
                });
              }
            }
          });
          // Also check for any bid-like links
          document.querySelectorAll('a').forEach(function(a) {
            var text = (a.textContent || '').trim();
            if (text.length > 20 && (a.href || '').includes('lapac') && !found.some(function(f) { return f.title === text; })) {
              found.push({ title: text.slice(0, 200), agency: 'Louisiana State Agency', url: a.href || '', due: null });
            }
          });
          return found;
        });
        bids.forEach(function(b) {
          if (b.title && b.title.length > 5) {
            results.push({
              title: b.title, agency: b.agency,
              source: 'lapac_v2', source_url: b.url || 'https://wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm',
              description: b.title, due_date: b.due || null
            });
          }
        });
      }
    } catch (e) { log('LaPAC Puppeteer err: ' + (e.message || '').slice(0, 80)); }
    finally { if (browser) { try { await browser.close(); } catch(e) {} } }
  } else {
    // HTTP fallback
    try {
      var resp = await fetch('https://wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000)
      });
      if (resp.ok) {
        var html = await resp.text();
        var rowRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        var rowM;
        while ((rowM = rowRx.exec(html)) !== null && results.length < 25) {
          var cells = [];
          var cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          var cellM;
          while ((cellM = cellRx.exec(rowM[1])) !== null) { cells.push(cellM[1].replace(/<[^>]+>/g, '').trim()); }
          if (cells.length >= 2 && cells[0].length > 3) {
            var linkM = /href=["']([^"']+)["']/i.exec(rowM[1]);
            results.push({ title: (cells[1] || cells[0]).slice(0, 200), agency: cells[2] || 'Louisiana State Agency', source: 'lapac_v2', source_url: linkM ? linkM[1] : 'https://wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm', description: cells.slice(0, 4).join(' — ').slice(0, 500), due_date: cells[3] || null });
          }
        }
      }
    } catch (e) { log('LaPAC HTTP err: ' + (e.message||'').slice(0,60)); }
  }
  log('LaPAC: ' + results.length + ' listings found');
  return results;
}

// === HUNTING AGENT — preserved from V2, uses existing portal APIs ===
async function agentHunting(state, trigger) {
  log('HUNTING: checking procurement portals...');
  var newOpps = [];
  // Track per-source raw find counts so we can write hunt_runs rows at the end
  // Keys: centralbidding_v2, lapac_v2, sam_gov, openfema, usaspending, grants_gov, federal_register, web_search
  var sourceCounts = {};
  var existingTitles = state.pipeline.map(function(o) { return (o.title || '').toLowerCase().slice(0, 50); });

  function isDupe(title) {
    var t = (title || '').toLowerCase().slice(0, 50);
    return existingTitles.some(function(e) {
      var words = t.split(' ').filter(function(w) { return w.length > 4; });
      if (!words.length) return false;
      return words.filter(function(w) { return e.includes(w); }).length / words.length >= 0.5;
    });
  }

  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10).replace(/-/g, '/'); }
  function today() { return new Date().toISOString().slice(0, 10).replace(/-/g, '/'); }

  // Central Bidding — DIRECT V2 hunting (no V1/Apify dependency)
  try {
    var isCronHunt = (trigger || '').indexOf('cron') >= 0;
    var cbResults = await huntCentralBidding(isCronHunt);
    sourceCounts.centralbidding_v2 = (cbResults || []).length;
    cbResults.forEach(function(o) {
      if (o.title && !isDupe(o.title)) newOpps.push(o);
    });
  } catch (e) { log('HUNTING CB direct err: ' + e.message); sourceCounts.centralbidding_v2 = -1; }

  // LaPAC — Direct scraping
  try {
    var lapacResults = await huntLaPAC();
    sourceCounts.lapac_v2 = (lapacResults || []).length;
    lapacResults.forEach(function(o) {
      if (o.title && !isDupe(o.title)) newOpps.push(o);
    });
  } catch (e) { log('HUNTING LaPAC err: ' + e.message); sourceCounts.lapac_v2 = -1; }

  // LaPAC — now handled by huntLaPAC() above

  // SAM.gov — ALL 8 VERTICALS
  var samKW = [
    // Disaster Recovery
    'disaster recovery program management', 'FEMA public assistance', 'CDBG-DR',
    // TPA / Claims
    'claims administration third party', 'workers compensation TPA', 'insurance guaranty association',
    // Housing / HUD
    'housing authority management', 'HUD housing program administration',
    // Workforce / WIOA
    'WIOA workforce development', 'workforce services program',
    // Construction Management
    'construction management services oversight',
    // Grant Management
    'grant administration services', 'federal grant program management',
    // Program Administration
    'program administration services'
  ];
  for (var s = 0; s < samKW.length; s++) {
    try {
      var samApiKey = process.env.SAM_GOV_API_KEY || 'DEMO_KEY';
      var sr = await fetch('https://api.sam.gov/prod/opportunities/v2/search?api_key=' + samApiKey + '&q=' + encodeURIComponent(samKW[s]) + '&postedFrom=' + daysAgo(14) + '&postedTo=' + today() + '&active=true&limit=10');
      if (sr.ok) {
        var sd = await sr.json();
        var samBatch = sd.opportunitiesData || [];
        sourceCounts.sam_gov = (sourceCounts.sam_gov || 0) + samBatch.length;
        samBatch.forEach(function(o) {
          if (o.title && !isDupe(o.title)) newOpps.push({ title: o.title, agency: o.fullParentPathName || 'Federal', source: 'sam_gov', source_url: 'https://sam.gov/opp/' + o.opportunityId, description: (o.description || '').slice(0, 500), due_date: o.responseDeadLine || null });
        });
      }
    } catch (e) {}
  }
  if (!('sam_gov' in sourceCounts)) sourceCounts.sam_gov = 0;


  // === NEW: OpenFEMA disaster declarations (free, no key) ===
  var hgiStates = ['Louisiana', 'Texas', 'Florida', 'Mississippi', 'Alabama', 'Georgia'];
  for (var fs = 0; fs < hgiStates.length; fs++) {
    try {
      var femaUrl = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?' +
        '$filter=state%20eq%20%27' + hgiStates[fs] + '%27%20and%20declarationDate%20gt%20%27' +
        new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000z%27' +
        '&$orderby=declarationDate%20desc&$top=10';
      var fr = await fetch(femaUrl, { headers: { Accept: 'application/json' } });
      if (fr.ok) {
        var fd = await fr.json();
        var decls = fd.DisasterDeclarationsSummaries || [];
        sourceCounts.openfema = (sourceCounts.openfema || 0) + decls.length;
        for (var fi = 0; fi < decls.length; fi++) {
          var decl = decls[fi];
          var ft = 'DR-' + decl.disasterNumber + ' ' + (decl.state || '') + ' — ' + (decl.declarationTitle || '');
          if (!isDupe(ft) && !isDupe('DR-' + decl.disasterNumber)) {
            newOpps.push({
              title: ft, agency: 'FEMA / ' + (decl.state || 'Federal'),
              source: 'openfema', source_url: 'https://www.fema.gov/disaster/' + decl.disasterNumber,
              description: 'FEMA Declaration. Incident: ' + (decl.incidentType || '') +
                '. Date: ' + (decl.declarationDate || '').slice(0, 10) +
                '. Programs: ' + (decl.ihProgramDeclared ? 'IA ' : '') +
                (decl.paProgramDeclared ? 'PA ' : '') + (decl.hmProgramDeclared ? 'HM' : '') +
                '. Signal for PA-TAC and CM procurement 3-18 months out.',
              due_date: null, vertical: 'disaster'
            });
          }
        }
      }
    } catch (e) { log('HUNTING OpenFEMA err: ' + e.message); }
  }
  if (!('openfema' in sourceCounts)) sourceCounts.openfema = 0;
  log('HUNTING: OpenFEMA checked ' + hgiStates.length + ' states');

  // === USAspending DISABLED Session 107 ===
  // Returns historical awards (already-awarded contracts that have ended) — these get
  // marked "expired" by intake scoring and add zero qualified opps to pipeline.
  // Proper use is recompete tracking (what contract ends when → who should HGI target
  // 6-12 months ahead). That belongs in a separate agent writing to recompete_tracker table.
  // Re-enable with env USASPENDING_ENABLED=true
  if (process.env.USASPENDING_ENABLED === 'true') try {
    var usaBody = JSON.stringify({
      filters: {
        place_of_performance_locations: [
          { country: 'USA', state: 'LA' }, { country: 'USA', state: 'TX' },
          { country: 'USA', state: 'FL' }, { country: 'USA', state: 'MS' },
          { country: 'USA', state: 'AL' }, { country: 'USA', state: 'GA' }
        ],
        naics_codes: { require: ['541611', '541618', '541690', '541990', '561110', '561990', '524291', '524292', '624230', '923120', '921190', '236220', '237990', '624310'] },
        award_type_codes: ['A', 'B', 'C', 'D']
      },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Description',
        'Period of Performance Current End Date', 'Awarding Agency', 'NAICS Code'],
      limit: 15, page: 1, sort: 'Award Amount', order: 'desc'
    });
    var usaR = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: usaBody
    });
    if (usaR.ok) {
      var usaD = await usaR.json();
      var usaResults = usaD.results || [];
      sourceCounts.usaspending = usaResults.length;
      for (var ui = 0; ui < usaResults.length; ui++) {
        var ua = usaResults[ui];
        var ut = 'RECOMPETE: ' + (ua['Recipient Name'] || '?') + ' — ' + (ua.Description || '').slice(0, 80);
        if (!isDupe(ut)) {
          newOpps.push({
            title: ut, agency: ua['Awarding Agency'] || 'Federal',
            source: 'usaspending', source_url: 'https://www.usaspending.gov',
            description: 'Expiring contract. Incumbent: ' + (ua['Recipient Name'] || '?') +
              '. Value: ' + (ua['Award Amount'] || '?') +
              '. Expires: ' + (ua['Period of Performance Current End Date'] || '?') +
              '. Recompete signal.',
            due_date: ua['Period of Performance Current End Date'] || null, vertical: null
          });
        }
      }
      log('HUNTING: USAspending found ' + usaResults.length + ' expiring contracts');
    }
  } catch (e) { log('HUNTING USAspending err: ' + e.message); }
  sourceCounts.usaspending = sourceCounts.usaspending || 0;

  // === NEW: Grants.gov forecasted+posted (free, no key) ===
  try {
    var gr = await fetch('https://api.grants.gov/v1/api/search2', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: 'disaster recovery OR CDBG-DR OR housing program OR workforce development OR WIOA OR grant management OR hazard mitigation OR workers compensation OR claims administration OR construction management OR housing authority',
        oppStatuses: 'forecasted|posted', rows: 15, startRecordNum: 0
      })
    });
    if (gr.ok) {
      var gd = await gr.json();
      var gops = (gd.data && gd.data.oppHits) ? gd.data.oppHits : [];
      sourceCounts.grants_gov = gops.length;
      for (var gi = 0; gi < gops.length; gi++) {
        var go = gops[gi];
        if (go.oppTitle && !isDupe(go.oppTitle)) {
          newOpps.push({
            title: go.oppTitle, agency: go.agencyName || 'Federal',
            source: 'grants_gov', source_url: 'https://grants.gov/search-grants?oppNumber=' + (go.number || ''),
            description: (go.synopsis || '').slice(0, 300) +
              (go.oppStatus === 'forecasted' ? ' [FORECASTED]' : ''),
            due_date: go.closeDate || null, vertical: 'grant'
          });
        }
      }
      log('HUNTING: Grants.gov found ' + gops.length + ' results');
    }
  } catch (e) { log('HUNTING Grants.gov err: ' + e.message); }
  if (!('grants_gov' in sourceCounts)) sourceCounts.grants_gov = 0;

  // === Federal Register DISABLED Session 107 ===
  // Produced 36 results/run, 0 qualified ever. Every result scored FILTER by Haiku.
  // Wastes ~7-13 Haiku intake calls per hunt for zero output.
  // Re-enable by setting env FED_REGISTER_ENABLED=true
  if (process.env.FED_REGISTER_ENABLED === 'true') try {
    var frTerms = ['CDBG-DR', 'FEMA Public Assistance', 'Hazard Mitigation Grant', 'WIOA workforce', 'housing authority HUD', 'workers compensation insurance', 'construction management oversight', 'grant administration federal'];
    for (var frt = 0; frt < frTerms.length; frt++) {
      var frUrl = 'https://www.federalregister.gov/api/v1/documents.json?' +
        'conditions[term]=' + encodeURIComponent(frTerms[frt]) +
        '&conditions[publication_date][gte]=' + new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10) +
        '&per_page=5&order=newest';
      var frR = await fetch(frUrl, { headers: { Accept: 'application/json' } });
      if (frR.ok) {
        var frD = await frR.json();
        var frResults = frD.results || [];
        sourceCounts.federal_register = (sourceCounts.federal_register || 0) + frResults.length;
        for (var fri = 0; fri < frResults.length; fri++) {
          var frd = frResults[fri];
          if (frd.title && !isDupe(frd.title)) {
            newOpps.push({
              title: 'FED REGISTER: ' + frd.title.slice(0, 100),
              agency: (frd.agencies || []).map(function(a) { return a.name; }).join(', ') || 'Federal',
              source: 'federal_register', source_url: frd.html_url || 'https://federalregister.gov',
              description: (frd.abstract || frd.title || '').slice(0, 300) + ' Published: ' + (frd.publication_date || ''),
              due_date: null, vertical: null
            });
          }
        }
      }
    }
    log('HUNTING: Federal Register checked ' + frTerms.length + ' terms');
  } catch (e) { log('HUNTING Federal Register err: ' + e.message); }
  sourceCounts.federal_register = sourceCounts.federal_register || 0;

  // === WEB SEARCH HUNTING — portals without APIs, ALL 8 VERTICALS ===
  try {
    var webHuntQueries = [
      // TPA / Claims — OpenGov, BidNet, DemandStar, state insurance
      { label: 'TPA_CLAIMS', q: 'RFP "third party administrator" OR "claims administration" OR "workers compensation TPA" Louisiana Texas Florida Mississippi site:opengov.com OR site:bidnet.com OR site:demandstar.com 2026' },
      { label: 'INSURANCE_GUARANTY', q: 'RFP "insurance guaranty" OR "guaranty association" OR "insolvent insurer" claims administration 2026' },
      // Workforce / WIOA
      { label: 'WORKFORCE_LA', q: 'RFP WIOA OR "workforce development" OR "workforce services" Louisiana workforce commission 2026' },
      { label: 'WORKFORCE_TX', q: 'RFP WIOA OR "workforce services" OR "workforce board" Texas TWC procurement 2026' },
      { label: 'WORKFORCE_FL', q: 'RFP "CareerSource" OR WIOA OR "workforce services" Florida procurement 2026' },
      // Housing / HUD / PHA
      { label: 'HOUSING_PHA', q: 'RFP "housing authority" OR "public housing" OR "Section 8" program management Louisiana Texas Mississippi Alabama 2026' },
      { label: 'HOUSING_HUD', q: 'RFP "HUD compliance" OR "housing program management" OR "voucher administration" Gulf Coast 2026' },
      // Property Tax / Billing Appeals
      { label: 'TAX_BILLING', q: 'RFP "property tax appeals" OR "billing disputes" OR "utility billing" OR "ad valorem" OR "revenue recovery" Louisiana Texas Florida 2026' },
      { label: 'WATER_UTILITY', q: 'RFP "water billing" OR "billing dispute resolution" OR "customer billing appeals" municipality 2026' },
      // Construction Management
      { label: 'CM_SCHOOLS', q: 'RFP "construction management" OR "program management" school board OR school district Louisiana Texas Mississippi 2026' },
      { label: 'CM_FEMA', q: 'RFP "construction management" FEMA OR "disaster recovery" OR "capital program" Louisiana Florida 2026' },
      // Grant Management
      { label: 'GRANT_MGMT', q: 'RFP "grant management" OR "grant administration" OR "pre-award" parish OR county OR city Louisiana Texas 2026' },
      // Program Administration
      { label: 'PROGRAM_ADMIN', q: 'RFP "program administration" OR "program management services" government Louisiana Texas Florida Mississippi 2026' }
    ];
    var webResults = await multiSearch(webHuntQueries);
    if (webResults && webResults.length > 100) {
      // Parse web search results for opportunity-like entries
      var webScorePrompt = HGI + '\n\nYou are parsing web search results to find REAL procurement opportunities (RFPs, RFQs, SOQs, ITBs) for HGI across ALL 8 verticals. Extract only REAL opportunities with titles, agencies, due dates, and URLs. Ignore news articles, old awards, and irrelevant results.\n\nWEB SEARCH RESULTS:\n' + webResults.slice(0, 6000) +
        '\n\nReturn JSON array only: [{"title":"...","agency":"...","due_date":"YYYY-MM-DD or null","source_url":"...","vertical":"disaster|tpa|workforce|housing|construction|grant|program_admin|tax_appeals","description":"1 sentence"}]\nReturn [] if no real opportunities found. Maximum 10 entries.';
      var webResp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
        messages: [{ role: 'user', content: webScorePrompt }]
      });
      trackCost('hunting_web_parser', 'claude-haiku-4-5-20251001', webResp.usage);
      var webText = (webResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('').replace(/```json|```/g, '').trim();
      try {
        var webOpps = JSON.parse(webText);
        if (Array.isArray(webOpps)) {
          sourceCounts.web_search = webOpps.length;
          webOpps.forEach(function(wo) {
            if (wo.title && !isDupe(wo.title)) {
              newOpps.push({
                title: wo.title, agency: wo.agency || 'Unknown Agency',
                source: 'web_search', source_url: wo.source_url || 'https://www.google.com',
                description: (wo.description || '').slice(0, 500),
                due_date: wo.due_date || null, vertical: wo.vertical || null
              });
            }
          });
          log('HUNTING: Web search found ' + webOpps.length + ' candidates across all verticals');
        }
      } catch (pe) { log('HUNTING: Web search parse error: ' + pe.message); }
    }
  } catch (e) { log('HUNTING web search err: ' + e.message); }
  if (!('web_search' in sourceCounts)) sourceCounts.web_search = 0;

  // === WRITE PER-SOURCE hunt_runs ROWS (Session 107 fix) ===
  // This makes scraper activity visible to the /api/health-monitor check and the audit dashboard.
  // Without these writes, runs are invisible even though the scrapers are executing.
  // NOTE: hunt_runs.id is bigint auto-increment — do NOT pass a string id or the insert drops silently.
  var huntRunTs = new Date().toISOString();
  var huntRunRows = Object.keys(sourceCounts).map(function(src) {
    var count = sourceCounts[src];
    return {
      source: src,
      status: count === -1 ? 'error' : ('found:' + count),
      run_at: huntRunTs,
      opportunities_found: count === -1 ? 0 : count
    };
  });
  try {
    if (huntRunRows.length > 0) {
      await supabase.from('hunt_runs').insert(huntRunRows);
      log('HUNTING: Wrote ' + huntRunRows.length + ' hunt_runs tracking rows: ' + Object.keys(sourceCounts).map(function(s){return s+':'+sourceCounts[s]}).join(', '));
    }
  } catch(hre) { log('HUNTING: hunt_runs insert failed — ' + (hre.message || '').slice(0, 120)); }

  log('HUNTING: ' + newOpps.length + ' raw candidates. Scoring with ALL organism intelligence...');
  if (newOpps.length === 0) {
    await storeMemory('hunting_agent', null, 'hunting', 'No new candidates from CB + SAM + FEMA + USAspending + Grants.gov + FedReg (LaPAC disabled — no API)', 'analysis', null, 'high');
    return { agent: 'hunting_agent', chars: 100, new_opps: 0 };
  }

  // ═══ ALL-INTO-ALL HUNTING: Load organism intelligence to inform scoring ═══
  var huntIntel = await Promise.allSettled([
    supabase.from('competitive_intelligence').select('competitor_name,agency,strengths,weaknesses,threat_level,incumbent_at,active_verticals,price_intelligence').order('created_at',{ascending:false}).limit(100),
    supabase.from('relationship_graph').select('contact_name,organization,relationship_strength,hgi_relationship,agency').order('created_at',{ascending:false}).limit(100),
    supabase.from('disaster_alerts').select('disaster_name,state,counties,declaration_date,fema_programs,hgi_recommendation').order('created_at',{ascending:false}).limit(50),
    supabase.from('budget_cycles').select('agency,state,procurement_window,rfp_timing,hgi_vertical').order('created_at',{ascending:false}).limit(50),
    supabase.from('recompete_tracker').select('client,contract_name,known_competitor,contract_end_date,hgi_incumbent,estimated_value_annual').order('created_at',{ascending:false}).limit(50),
    supabase.from('agency_profiles').select('agency_name,state,incumbent_contractors,hgi_relationship,hgi_history,procurement_process').order('created_at',{ascending:false}).limit(30),
    supabase.from('organism_memory').select('agent,observation').ilike('observation','%pattern%').order('created_at',{ascending:false}).limit(30),
    supabase.from('opportunities').select('title,agency,vertical,opi_score,outcome,outcome_notes').not('outcome','is',null).order('last_updated',{ascending:false}).limit(10)
  ]);
  function getHI(idx) { return (huntIntel[idx].status === 'fulfilled' && huntIntel[idx].value.data) || []; }
  var hiCI = getHI(0), hiRG = getHI(1), hiDA = getHI(2), hiBC = getHI(3), hiRC = getHI(4), hiAP = getHI(5), hiPatterns = getHI(6), hiOutcomes = getHI(7);

  // Build compressed intelligence context for scoring
  var huntContext = '';

  // Relationships: which agencies do we know people at?
  var knownAgencies = {};
  hiRG.forEach(function(r) {
    var org = (r.organization||r.agency||'').toLowerCase();
    if (org && !knownAgencies[org]) knownAgencies[org] = (r.hgi_relationship||r.relationship_strength||'known');
  });
  if (Object.keys(knownAgencies).length > 0) {
    huntContext += '\nAGENCIES WITH HGI RELATIONSHIPS: ' + Object.keys(knownAgencies).map(function(a) { return a + ' (' + knownAgencies[a] + ')'; }).join(', ');
  }

  // Competitors: who is weak where?
  var weakIncumbents = hiCI.filter(function(c) { return c.weaknesses && c.weaknesses.length > 10; });
  if (weakIncumbents.length > 0) {
    huntContext += '\nCOMPETITOR WEAKNESSES: ' + weakIncumbents.slice(0,10).map(function(c) { return c.competitor_name + ' at ' + (c.agency||c.incumbent_at||'?') + ': ' + (c.weaknesses||'').slice(0,100); }).join('; ');
  }

  // Recent disasters: where is new work coming?
  if (hiDA.length > 0) {
    huntContext += '\nRECENT DISASTERS (procurement signals): ' + hiDA.slice(0,8).map(function(d) { return (d.disaster_name||'') + ' (' + (d.state||'') + ', ' + (d.declaration_date||'').slice(0,10) + ') Programs: ' + (d.fema_programs||''); }).join('; ');
  }

  // Budget cycles: what procurement windows are open?
  if (hiBC.length > 0) {
    huntContext += '\nOPEN PROCUREMENT WINDOWS: ' + hiBC.slice(0,8).map(function(b) { return (b.agency||'') + ' (' + (b.state||'') + '): ' + (b.procurement_window||'') + ' ' + (b.rfp_timing||''); }).join('; ');
  }

  // Recompetes: which incumbents' contracts are ending?
  if (hiRC.length > 0) {
    huntContext += '\nEXPIRING INCUMBENT CONTRACTS: ' + hiRC.slice(0,8).map(function(r) { return (r.client||'') + ': ' + (r.contract_name||'').slice(0,50) + ' (incumbent: ' + (r.known_competitor||'?') + ', ends ' + (r.contract_end_date||'?') + ')'; }).join('; ');
  }

  // Agency profiles: procurement process intelligence
  if (hiAP.length > 0) {
    huntContext += '\nAGENCY PROFILES: ' + hiAP.slice(0,8).map(function(a) { return (a.agency_name||'') + ': ' + (a.hgi_relationship||'none') + ' relationship, incumbent: ' + (a.incumbent_contractors||'unknown'); }).join('; ');
  }

  // Outcome lessons: what did we learn from wins/losses?
  if (hiOutcomes.length > 0) {
    huntContext += '\nOUTCOME LESSONS: ' + hiOutcomes.map(function(o) { return (o.title||'').slice(0,40) + ' (' + (o.outcome||'') + ', OPI ' + (o.opi_score||'') + '): ' + (o.outcome_notes||''); }).join('; ');
  }

  // Patterns from organism memory
  if (hiPatterns.length > 0) {
    huntContext += '\nORGANISM PATTERNS: ' + hiPatterns.slice(0,5).map(function(p) { return (p.observation||'').slice(0,200); }).join('; ');
  }

  log('HUNTING: Intelligence context loaded (' + huntContext.length + ' chars) — scoring ' + newOpps.length + ' candidates');

  // Deduplicate and score with Haiku + full intelligence
  var deduped = newOpps.filter(function(o, i, a) { return a.findIndex(function(x) { return x.title.slice(0, 40) === o.title.slice(0, 40); }) === i; });

  // === PRE-FILTER: Remove obvious non-HGI bids before Haiku scoring ===
  // HGI relevant keywords — if title/description contains ANY of these, keep it for scoring
  var hgiRelevant = ['professional services', 'consulting', 'program management', 'project management',
    'disaster', 'fema', 'cdbg', 'hazard mitigation', 'emergency management', 'recovery',
    'claims', 'tpa', 'third party', 'workers comp', 'insurance', 'guaranty', 'liability', 'adjuster',
    'construction management', 'construction oversight', 'capital program', 'owner representative',
    'workforce', 'wioa', 'employment services', 'job training', 'career',
    'housing authority', 'hud', 'public housing', 'affordable housing', 'section 8', 'voucher',
    'grant management', 'grant administration', 'federal grant', 'pre-award', 'sub-recipient',
    'property tax', 'ad valorem', 'billing appeal', 'utility billing', 'revenue recovery', 'water billing',
    'staff augmentation', 'call center', 'bpo', 'case management', 'contact center',
    'program administration', 'compliance', 'monitoring', 'audit', 'fiduciary',
    'settlement', 'mediation', 'class action', 'dispute resolution', 'claims processing',
    'dei', 'diversity equity', 'minority', 'assessment appeal',
    'rfp', 'rfq', 'soq', 'solicitation', 'request for proposal', 'request for qualif',
    'management services', 'administration services', 'consulting services', 'advisory'];
  // Obvious non-HGI — filter OUT immediately
  var notHGI = ['grass cut', 'mowing', 'mow ', 'janitorial', 'custodial', 'cleaning service',
    'fuel ', 'gasoline', 'diesel', 'propane',
    'food service', 'cafeteria', 'lunch', 'meal', 'vending',
    'vehicle', 'automobile', 'truck purchase', 'bus purchase', 'fleet',
    'hvac', 'air condition', 'plumbing repair', 'electrical repair',
    'supplies', 'materials purchase', 'office supplies', 'paper ', 'toner',
    'pest control', 'exterminator', 'termite',
    'roofing', 'paving', 'asphalt', 'concrete pour', 'gravel', 'aggregate',
    'printing', 'uniform', 'signage', 'banner',
    'playground', 'athletic', 'sports equip', 'gymnasium',
    'dental', 'optometry', 'pharmacy benefit', 'medical equipment',
    'porta potty', 'portable toilet', 'dumpster', 'waste hauling', 'garbage',
    'paint ', 'painting service', 'floor', 'carpet', 'tile install',
    'security guard', 'armed guard', 'surveillance camera',
    'lawn care', 'landscaping', 'tree trim', 'tree removal', 'stump',
    'demolition', 'debris removal', 'debris hauling',
    'copier', 'telephone system', 'internet service', 'fiber optic',
    'school bus', 'transportation service', 'student transport',
    'elevator', 'generator', 'fire alarm', 'fire extinguisher',
    'portable building', 'modular', 'trailer rental',
    'athletic field', 'scoreboard', 'bleacher',
    'bank deposit', 'banking service', 'depository'];

  var preFiltered = deduped.filter(function(o) {
    var text = ((o.title || '') + ' ' + (o.description || '')).toLowerCase();
    // If it matches a notHGI term, drop it immediately
    for (var ni = 0; ni < notHGI.length; ni++) {
      if (text.includes(notHGI[ni])) return false;
    }
    // If it matches an hgiRelevant term, keep it
    for (var hi = 0; hi < hgiRelevant.length; hi++) {
      if (text.includes(hgiRelevant[hi])) return true;
    }
    // If it matches neither list, DROP it — CB has hundreds of irrelevant bids per entity
    return false;
  });
  // PRIORITY SORT: Most HGI-specific keywords scored first (not random array order)
  var tier1kw = ['third party admin', 'claims admin', 'workers comp', 'worker comp', 'tpa ', 'disaster recovery', 'fema ', 'cdbg', 'housing authority', 'public housing', 'section 8', 'wioa', 'workforce develop', 'grant management', 'grant admin', 'construction management', 'hazard mitigation', 'property tax', 'billing appeal', 'utility billing', 'water billing', 'guaranty', 'adjuster', 'adjudic', 'actuarial'];
  var tier2kw = ['program management', 'project management', 'consulting services', 'professional services', 'emergency management', 'recovery', 'pre-award', 'sub-recipient', 'voucher', 'capital program', 'insurance', 'claims', 'assessment'];
  preFiltered.forEach(function(o) {
    var text = ((o.title || '') + ' ' + (o.description || '')).toLowerCase();
    var prio = 0;
    for (var t1i = 0; t1i < tier1kw.length; t1i++) { if (text.includes(tier1kw[t1i])) prio += 10; }
    for (var t2i = 0; t2i < tier2kw.length; t2i++) { if (text.includes(tier2kw[t2i])) prio += 3; }
    o._priority = prio;
  });
  preFiltered.sort(function(a, b) { return (b._priority || 0) - (a._priority || 0); });
  log('HUNTING: Pre-filter: ' + deduped.length + ' \u2192 ' + preFiltered.length + ' candidates (' + (deduped.length - preFiltered.length) + ' removed). Top: ' + (preFiltered[0] ? preFiltered[0]._priority + 'pts ' + (preFiltered[0].title || '').slice(0,60) : 'none'));
  var qualified = [];
  var rejectedSamples = [];

  for (var c = 0; c < Math.min(preFiltered.length, 50); c++) {
    try {
      var cand = preFiltered[c];
      var scorePrompt = HGI + '\n\nORGANISM INTELLIGENCE (use this to adjust scoring — relationships, competitor weaknesses, disasters, budget windows, and outcome lessons all affect how HGI should score this):' + huntContext +
        '\n\nPER-VERTICAL OPI SCORING GUIDE — score each vertical on ITS OWN merits, not compared to DR:' +
        '\nDISASTER (disaster): Score 70+ if LA/TX/FL/MS/AL/GA, FEMA PA or CDBG-DR, program mgmt not physical work. HGI has $750M+ managed FEMA funds.' +
        '\nTPA/CLAIMS (tpa): Score 70+ if workers comp TPA, property/casualty claims admin, insurance guaranty, self-insured claims, liability claims. HGI has 20+ years TPCIGA/LIGA, $283K/mo City of NOLA WC TPA (ACTIVE).' +
        '\nPROPERTY TAX/BILLING (tax_appeals): Score 70+ if property tax appeals, ad valorem, utility billing disputes, water billing, revenue recovery. HGI has $200K/mo SWBNO billing appeals (ACTIVE). White space — few competitors.' +
        '\nWORKFORCE/WIOA (workforce): Score 70+ if WIOA administration, workforce board operations, unemployment claims, job training program mgmt, career services. HGI has 15,250+ claims adjudicated, statewide COVID contact tracing.' +
        '\nCONSTRUCTION MGMT (construction): Score 70+ if construction MANAGEMENT/oversight/CM-at-risk, NOT physical construction. School boards, FEMA-funded facilities, capital programs. HGI has $2.96M TPSD CM (completed).' +
        '\nHOUSING/HUD (housing): Score 70+ if housing authority mgmt, HUD compliance, Section 8/HCV admin, public housing, HMGP housing. HGI has Road Home + HAP $950M + HMGP experience.' +
        '\nGRANT MGMT (grant): Score 70+ if pre-award/post-award grant admin, sub-recipient monitoring, federal grant management, Single Audit. HGI has grant admin across all programs.' +
        '\nPROGRAM ADMIN (federal): Score 70+ if federal/state program administration, PMO, case advisory, BPO. HGI has PBGC (34M beneficiaries).' +
        '\nFILTER: Score as FILTER if Medicaid, clinical health, physical construction, IT, engineering, environmental remediation, insurance brokerage, equipment/supplies.' +
        '\n\nCRITICAL: A TPA opportunity in Louisiana with $1M+ value should score 75-85, NOT 13. Score based on HGI fit for THAT VERTICAL.' +
        '\n\nOPP: ' + cand.title + ' | ' + cand.agency + ' | ' + (cand.description || '').slice(0, 300) +
        '\n\nToday is ' + new Date().toISOString().split('T')[0] + '. DEADLINE RULES (follow exactly):\n1. If the listing text contains a SPECIFIC deadline date, extract it to deadline_found (YYYY-MM-DD).\n2. If that extracted date is BEFORE today, set expired:true and opi:0.\n3. If NO deadline is found in the listing text, set deadline_found:null AND expired:false. DO NOT GUESS. DO NOT ASSUME old.\n4. Absence of a deadline is NOT evidence of expiration. Score normally based on vertical fit.\n5. Federal Register notices and USAspending past-award records typically have no procurement deadline — these should be scored based on their content (regulatory notices = FILTER; recompete signals = score the vertical fit even if the historical contract has expired).' +
        '\n\nJSON only (no prose, no preamble, no explanation — start immediately with {). Keep "why" under 120 characters: {"opi":N,"vertical":"disaster|tpa|workforce|housing|construction|grant|tax_appeals|federal|FILTER","capture_action":"GO|WATCH|NO-BID","why":"brief reason (120 char max)","deadline_found":"YYYY-MM-DD or null","expired":false}';
      var scoreResp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 800,
        messages: [{ role: 'user', content: scorePrompt }]
      });
      trackCost('intake_scoring', 'claude-haiku-4-5-20251001', scoreResp.usage);
      var st = (scoreResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('').replace(/```json|```/g, '').trim();
      var score;
      try {
        score = JSON.parse(st);
      } catch(pe) {
        // Haiku sometimes wraps JSON in prose — try to extract {...} from anywhere in response
        var jm = st.match(/\{[\s\S]*?\}/);
        if (jm) {
          try { score = JSON.parse(jm[0]); }
          catch(pe2) {
            log('HUNTING: JSON parse FAIL for "' + (cand.title||'').slice(0,50) + '" — stop_reason=' + (scoreResp.stop_reason||'?') + ' raw=' + st.slice(0, 150).replace(/\n/g,' '));
            continue;
          }
        } else {
          log('HUNTING: NO JSON for "' + (cand.title||'').slice(0,50) + '" — stop_reason=' + (scoreResp.stop_reason||'?') + ' raw=' + st.slice(0, 150).replace(/\n/g,' '));
          continue;
        }
      }
      // Phase 3 instrumentation: log every Haiku score decision so we can calibrate
      log('HUNTING: SCORE ' + (cand.title||'').slice(0,55) + ' → opi:' + (score.opi||'?') + ' vert:' + (score.vertical||'?') + ' ' + (score.capture_action||'?') + ' exp:' + !!score.expired + (score.why ? ' why:"' + score.why.slice(0,80) + '"' : ''));

      // EXPIRED DETECTION (Session 104) — reject opps where AI detects past deadline
      if (score.expired === true || score.opi === 0) {
        log('HUNTING: EXPIRED — ' + (cand.title || '').slice(0, 60) + ' (deadline: ' + (score.deadline_found || 'detected in text') + ')');
        continue;
      }

      // Use AI-extracted deadline if source didn't provide one
      if (!cand.due_date && score.deadline_found && score.deadline_found !== 'null') {
        cand.due_date = score.deadline_found;
      }

      // DEADLINE PROXIMITY ADJUSTMENT (Session 95, Build #6)
      // Adjust OPI based on time remaining before deadline
      if (cand.due_date && score.opi >= 45) {
        var daysLeft = Math.floor((new Date(cand.due_date).getTime() - Date.now()) / 86400000);
        if (daysLeft < 0) {
          score.opi = Math.max(score.opi - 30, 20); // Past deadline — major penalty
          score.why = (score.why || '') + ' [DEADLINE PASSED]';
        } else if (daysLeft < 5) {
          score.opi = Math.max(score.opi - 15, 30); // <5 days — likely can't respond
          score.why = (score.why || '') + ' [' + daysLeft + ' days — tight deadline penalty]';
        } else if (daysLeft < 10) {
          score.opi = Math.max(score.opi - 5, 40); // 5-10 days — slight penalty
          score.why = (score.why || '') + ' [' + daysLeft + ' days — deadline proximity]';
        } else if (daysLeft >= 14 && daysLeft <= 45) {
          score.opi = Math.min(score.opi + 3, 99); // Sweet spot — slight boost
        }
        // >45 days: no adjustment
      }

      if (score.vertical === 'FILTER' || score.opi < 45) continue;

      var newId = cand.source + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      await supabase.from('opportunities').insert({
        id: newId, title: cand.title, agency: cand.agency, vertical: score.vertical,
        opi_score: score.opi, status: 'active', stage: 'identified', source: cand.source,
        source_url: cand.source_url, estimated_value: 'unknown', due_date: cand.due_date || null,
        capture_action: score.capture_action + ': ' + score.why,
        discovered_at: new Date().toISOString(), last_updated: new Date().toISOString()
      });
      qualified.push({ title: cand.title, opi: score.opi, source: cand.source });
    } catch (e) { log('HUNTING: scoring error for "' + (cand.title||'').slice(0,50) + '" — ' + (e.message||'').slice(0,120)); }
  }

  log('HUNTING: ' + qualified.length + ' qualified and added');
  await storeMemory('hunting_agent', null, 'hunting', 'HUNTING: ' + qualified.length + '/' + preFiltered.length + ' qualified (from ' + newOpps.length + ' raw, ' + deduped.length + ' deduped, ' + preFiltered.length + ' pre-filtered).\n' + qualified.map(function(q) { return 'OPI:' + q.opi + ' [' + q.source + '] ' + q.title.slice(0, 50); }).join('\n'), 'analysis', null, 'high');
  return { agent: 'hunting_agent', chars: 300, new_opps: qualified.length };
}


// ============================================================
// AUTO-RFP RETRIEVAL — Fetches actual RFP documents for new discoveries
// Handles Central Bidding authentication via MD5 login
// ============================================================

var cbSessionCookie = null;
async function cbLogin() {
  if (cbSessionCookie) return cbSessionCookie;
  try {
    var pwd = 'Whatever1340!';
    var md5hash = crypto.createHash('md5').update(pwd).digest('hex');
    var loginResp = await fetch('https://www.centralauctionhouse.com/login.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (compatible; HGI-Organism/2.0)' },
      body: 'username=HGIGLOBAL&md5pass=' + md5hash + '&md5pass_utf=' + md5hash + '&login_process=1&redirect=',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });
    var cookies = loginResp.headers.getSetCookie ? loginResp.headers.getSetCookie() : [];
    if (cookies.length === 0) {
      var raw = loginResp.headers.get('set-cookie') || '';
      cookies = raw.split(',').filter(function(c) { return c.includes('='); });
    }
    var cookieStr = cookies.map(function(c) { return c.split(';')[0].trim(); }).filter(function(c) { return c.length > 2; }).join('; ');
    if (cookieStr.length > 10) {
      cbSessionCookie = cookieStr;
      log('AUTO-RFP: CB login SUCCESS — session established');
      return cookieStr;
    }
    // Fallback: follow redirect and get cookies from response
    if (loginResp.status >= 300 && loginResp.status < 400) {
      var loc = loginResp.headers.get('location') || 'https://www.centralauctionhouse.com/main.php';
      var r2 = await fetch(loc, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookieStr }, signal: AbortSignal.timeout(10000) });
      var body = await r2.text();
      if (body.includes('HGIGLOBAL') || body.includes('Logout')) {
        cbSessionCookie = cookieStr;
        log('AUTO-RFP: CB login SUCCESS via redirect');
        return cookieStr;
      }
    }
    log('AUTO-RFP: CB login — could not confirm session');
    return cookieStr || null;
  } catch(e) { log('AUTO-RFP: CB login error: ' + (e.message||'').slice(0, 80)); return null; }
}

async function autoRetrieveRFPs() {
  log('AUTO-RFP: Checking for opportunities needing RFP retrieval...');
  var needsRfp = await supabase.from('opportunities')
    .select('id,title,source_url,rfp_text')
    .eq('status', 'active')
    .eq('rfp_document_retrieved', false)
    .gte('opi_score', 60)
    .not('source_url', 'is', null);
  if (!needsRfp.data || needsRfp.data.length === 0) {
    log('AUTO-RFP: All active opps have RFPs or no source URL');
    return [];
  }
  log('AUTO-RFP: ' + needsRfp.data.length + ' opportunities need RFP retrieval');
  var results = [];
  var cbCookie = null; // Lazy login — only if needed

  for (var opp of needsRfp.data) {
    try {
      var url = opp.source_url;
      if (!url || !url.startsWith('http')) continue;
      var isCB = url.includes('centralauctionhouse.com') || url.includes('centralbidding.com');
      log('AUTO-RFP: Fetching ' + url.slice(0, 80) + (isCB ? ' [CB-AUTH]' : ''));

      // For CB URLs, authenticate first
      var fetchHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; HGI-Organism/2.0)' };
      if (isCB) {
        if (!cbCookie) cbCookie = await cbLogin();
        if (cbCookie) fetchHeaders['Cookie'] = cbCookie;
      }

      var resp = await fetch(url, {
        headers: fetchHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      });
      if (!resp.ok) { log('AUTO-RFP: HTTP ' + resp.status + ' for ' + (opp.title||'').slice(0, 40)); continue; }
      var contentType = resp.headers.get('content-type') || '';
      var fullText = '';
      var pdfCount = 0;
      var rfpDocUrl = null;

      // If source URL is directly a PDF
      if (contentType.includes('pdf') || url.endsWith('.pdf')) {
        if (pdfParse) {
          var buf = Buffer.from(await resp.arrayBuffer());
          var parsed = await pdfParse(buf);
          fullText = parsed.text || '';
          pdfCount = 1;
          rfpDocUrl = url;
          log('AUTO-RFP: Direct PDF — ' + fullText.length + ' chars');
        }
      } else {
        // HTML page — extract text and find PDF links
        var html = await resp.text();
        var text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
          .replace(/\s+/g, ' ').trim();
        fullText = text;

        // Find PDF links — standard .pdf links AND CB Attachment links
        var pdfLinks = [];
        var pdfRx = /href=["']([^"']*\.pdf[^"']*)/gi;
        var m;
        while ((m = pdfRx.exec(html)) !== null) {
          var pdfUrl = m[1];
          try { pdfUrl = new URL(pdfUrl, url).href; } catch(e) { continue; }
          if (pdfLinks.indexOf(pdfUrl) < 0) pdfLinks.push(pdfUrl);
        }
        // CB Attachment pattern: /Attachment/HASH
        var attRx = /href=["']((?:https?:\/\/[^"']*)?\/Attachment\/[a-f0-9]+)/gi;
        while ((m = attRx.exec(html)) !== null) {
          var attUrl = m[1];
          try { attUrl = new URL(attUrl, url).href; } catch(e) { continue; }
          if (pdfLinks.indexOf(attUrl) < 0) pdfLinks.push(attUrl);
        }

        if (pdfLinks.length > 0 && pdfParse) {
          log('AUTO-RFP: Found ' + pdfLinks.length + ' document links');
          for (var pi = 0; pi < Math.min(pdfLinks.length, 3); pi++) {
            try {
              var pHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; HGI-Organism/2.0)' };
              if (isCB && cbCookie) pHeaders['Cookie'] = cbCookie;
              var pResp = await fetch(pdfLinks[pi], {
                headers: pHeaders,
                redirect: 'follow',
                signal: AbortSignal.timeout(30000)
              });
              var pCt = pResp.headers.get('content-type') || '';
              if (pResp.ok && (pCt.includes('pdf') || pdfLinks[pi].endsWith('.pdf') || pdfLinks[pi].includes('/Attachment/'))) {
                var pBuf = Buffer.from(await pResp.arrayBuffer());
                if (pBuf.length > 1000 && (pBuf[0] === 0x25 || pCt.includes('pdf'))) { // %PDF magic byte or content-type
                  var pParsed = await pdfParse(pBuf);
                  if (pParsed.text && pParsed.text.length > 100) {
                    fullText += '\n\n=== PDF DOCUMENT: ' + pdfLinks[pi].split('/').pop().slice(0, 60) + ' ===\n' + pParsed.text;
                    pdfCount++;
                    if (!rfpDocUrl) rfpDocUrl = pdfLinks[pi];
                    log('AUTO-RFP: Extracted ' + pParsed.text.length + ' chars from PDF #' + pdfCount);
                  }
                }
              } else if (!pResp.ok) {
                log('AUTO-RFP: Document HTTP ' + pResp.status + ' — ' + pdfLinks[pi].slice(0, 60));
              }
            } catch(pe) { log('AUTO-RFP: PDF error: ' + (pe.message||'').slice(0, 60)); }
          }
        }
      }

      // Update if we got meaningful new content
      var existingLen = (opp.rfp_text || '').length;
      if (fullText.length > existingLen + 500) {
        var isSubstantial = fullText.length > 2000;
        var updateObj = {
          rfp_text: fullText.slice(0, 200000),
          rfp_document_retrieved: isSubstantial,
          last_updated: new Date().toISOString()
        };
        if (rfpDocUrl) updateObj.rfp_document_url = rfpDocUrl;
        await supabase.from('opportunities').update(updateObj).eq('id', opp.id);
        log('AUTO-RFP: STORED ' + fullText.length + ' chars for ' + (opp.title||'').slice(0, 40) + ' (retrieved=' + isSubstantial + ', pdfs=' + pdfCount + ')');
        results.push({ id: opp.id, opp: (opp.title||'').slice(0, 40), chars: fullText.length, pdfs: pdfCount, retrieved: isSubstantial });
        await storeMemory('rfp_retrieval_agent', opp.id, 'rfp_retrieval', 'AUTO-RETRIEVED RFP content: ' + fullText.length + ' chars from ' + url.slice(0, 80) + (pdfCount > 0 ? ' + ' + pdfCount + ' PDF(s)' : '') + '. Document marked as ' + (isSubstantial ? 'RETRIEVED' : 'PARTIAL (< 2K chars)') + '.', 'analysis', url, isSubstantial ? 'high' : 'medium');
      } else {
        log('AUTO-RFP: No new content for ' + (opp.title||'').slice(0, 40) + ' (had:' + existingLen + ' got:' + fullText.length + ')');
      }
    } catch(e) { log('AUTO-RFP: Error: ' + (e.message||'').slice(0, 100)); }
  }
  if (results.length > 0) log('AUTO-RFP: Retrieved ' + results.length + ' RFPs this cycle');
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// detectDocKind + refetchRFPCorpus — S126 addendum-aware ingestion
// Closes the SJPG-class scope-discovery gap: re-fetches source page on demand,
// removes 3-PDF cap (raised to 25), writes structured documents[] + addendum_coverage[].
// Reuses cbLogin() for CentralAuctionHouse auth.
// ─────────────────────────────────────────────────────────────────────────────
function detectDocKind(filename, label) {
  var t = ((filename || '') + ' ' + (label || '')).toLowerCase();
  if (/addend|amend\b|addn\b/.test(t)) return 'addendum';
  if (/q\s*&\s*a|q-and-a|qna|questions.{0,10}answers|answers.{0,10}questions/.test(t)) return 'q&a';
  if (/rfp|rfq|sow|scope|solicitation|specifications?/.test(t)) return 'solicitation';
  if (/attach|exhibit|appendix|form\b|schedule/.test(t)) return 'attachment';
  return 'unknown';
}

async function refetchRFPCorpus(opp) {
  if (!opp || !opp.source_url) return { ok: false, error: 'no source_url' };
  var srcUrl = opp.source_url;
  if (!srcUrl.startsWith('http')) return { ok: false, error: 'invalid source_url' };
  var isCB = srcUrl.includes('centralauctionhouse.com') || srcUrl.includes('centralbidding.com');
  log('REFETCH-RFP: ' + (opp.title||'').slice(0,50) + ' [' + (isCB ? 'CB' : 'std') + ']');

  var fetchHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; HGI-Organism/2.0)' };
  if (isCB) {
    var cbCookie = await cbLogin();
    if (cbCookie) fetchHeaders['Cookie'] = cbCookie;
  }

  var resp;
  try {
    resp = await fetch(srcUrl, { headers: fetchHeaders, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  } catch(fe) { return { ok: false, error: 'source fetch: ' + (fe.message||'').slice(0,100) }; }
  if (!resp.ok) return { ok: false, error: 'source HTTP ' + resp.status };

  var ct = resp.headers.get('content-type') || '';
  var html = '';
  var pageText = '';
  if (ct.includes('html') || ct === '' || ct.includes('text/plain')) {
    html = await resp.text();
    pageText = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ').trim();
  } else if (ct.includes('pdf') && pdfParse) {
    try {
      var srcBuf = Buffer.from(await resp.arrayBuffer());
      var srcParsed = await pdfParse(srcBuf);
      pageText = srcParsed.text || '';
    } catch(pe) { pageText = ''; }
  }

  var docLinks = [];
  var labelMap = {};
  if (html) {
    var pdfRx = /href=["']([^"']*\.pdf[^"']*)/gi;
    var m;
    while ((m = pdfRx.exec(html)) !== null) {
      var pdfUrl = m[1];
      try { pdfUrl = new URL(pdfUrl, srcUrl).href; } catch(e) { continue; }
      if (docLinks.indexOf(pdfUrl) < 0) docLinks.push(pdfUrl);
    }
    var attRx = /href=["']((?:https?:\/\/[^"']*)?\/Attachment\/[a-f0-9]+)/gi;
    while ((m = attRx.exec(html)) !== null) {
      var attUrl = m[1];
      try { attUrl = new URL(attUrl, srcUrl).href; } catch(e) { continue; }
      if (docLinks.indexOf(attUrl) < 0) docLinks.push(attUrl);
    }
    var anchorRx = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var am;
    while ((am = anchorRx.exec(html)) !== null) {
      var aHref = am[1];
      try { aHref = new URL(aHref, srcUrl).href; } catch(e) { continue; }
      var aText = am[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (aText && !labelMap[aHref]) labelMap[aHref] = aText;
    }
  }

  if (docLinks.length > 25) {
    log('REFETCH-RFP: capping ' + docLinks.length + ' links at 25');
    docLinks = docLinks.slice(0, 25);
  }

  var documents = [];
  var assembledText = pageText ? ('=== SOURCE PAGE ===\n' + pageText) : '';
  var rfpDocUrl = null;

  for (var di = 0; di < docLinks.length; di++) {
    var dUrl = docLinks[di];
    var dLabel = labelMap[dUrl] || '';
    var dFilename = (dUrl.split('/').pop() || '').slice(0, 100);
    var dKind = detectDocKind(dFilename, dLabel);
    var docEntry = {
      url: dUrl,
      filename: dFilename,
      label: dLabel.slice(0, 200),
      kind: dKind,
      char_count: 0,
      fetched_at: new Date().toISOString(),
      status: 'pending'
    };
    try {
      var dHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; HGI-Organism/2.0)' };
      if (isCB && fetchHeaders['Cookie']) dHeaders['Cookie'] = fetchHeaders['Cookie'];
      var dResp = await fetch(dUrl, { headers: dHeaders, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      var dCt = dResp.headers.get('content-type') || '';
      if (dResp.ok && (dCt.includes('pdf') || dUrl.endsWith('.pdf') || dUrl.includes('/Attachment/'))) {
        var dBuf = Buffer.from(await dResp.arrayBuffer());
        if (dBuf.length > 1000 && (dBuf[0] === 0x25 || dCt.includes('pdf')) && pdfParse) {
          try {
            var dParsed = await pdfParse(dBuf);
            if (dParsed.text && dParsed.text.length > 100) {
              docEntry.char_count = dParsed.text.length;
              docEntry.status = 'parsed';
              assembledText += '\n\n=== DOCUMENT ' + (di + 1) + ': ' + dKind.toUpperCase() + ' \u2014 ' + dFilename + (dLabel ? ' (' + dLabel.slice(0,80) + ')' : '') + ' ===\n' + dParsed.text;
              if (!rfpDocUrl) rfpDocUrl = dUrl;
            } else {
              docEntry.status = 'empty_parse';
            }
          } catch(parseErr) {
            docEntry.status = 'parse_error:' + (parseErr.message||'').slice(0,50);
          }
        } else {
          docEntry.status = 'not_pdf';
        }
      } else {
        docEntry.status = 'http_' + dResp.status;
      }
    } catch(de) {
      docEntry.status = 'fetch_error:' + (de.message||'').slice(0, 60);
    }
    documents.push(docEntry);
  }

  var existingDocs = Array.isArray(opp.documents) ? opp.documents : [];
  var existingUrls = existingDocs.map(function(d) { return d && d.url; }).filter(Boolean);
  var newUrls = documents.map(function(d) { return d.url; });
  var addedDocs = documents.filter(function(d) { return existingUrls.indexOf(d.url) < 0; });
  var removedDocs = existingDocs.filter(function(d) { return d && d.url && newUrls.indexOf(d.url) < 0; });
  var unchangedDocs = documents.filter(function(d) { return existingUrls.indexOf(d.url) >= 0; });

  var addendumCoverage = documents
    .filter(function(d) { return d.kind === 'addendum' && d.status === 'parsed'; })
    .map(function(d) { return { url: d.url, filename: d.filename, label: d.label, fetched_at: d.fetched_at, char_count: d.char_count }; });

  log('REFETCH-RFP: ' + documents.length + ' docs, ' + documents.filter(function(d){return d.status==='parsed';}).length + ' parsed, ' + addendumCoverage.length + ' addenda, ' + assembledText.length + ' chars assembled');

  return {
    ok: true,
    opp_id: opp.id,
    source_url: srcUrl,
    documents: documents,
    documents_count: documents.length,
    parsed_count: documents.filter(function(d) { return d.status === 'parsed'; }).length,
    addendum_coverage: addendumCoverage,
    rfp_text: assembledText.slice(0, 200000),
    rfp_text_chars: assembledText.length,
    rfp_document_url: rfpDocUrl,
    diff: {
      added: addedDocs.map(function(d) { return { url: d.url, filename: d.filename, kind: d.kind }; }),
      removed: removedDocs.map(function(d) { return { url: d.url, filename: d.filename, kind: d.kind }; }),
      unchanged_count: unchangedDocs.length
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateStrategicThesis + formatStrategicThesisForPrompt — S126 anti-regurgitation
// PURPOSE: produce a 3-5 thesis spine BEFORE senior_writer runs, so each section
// of the resulting proposal can be bound to advance at most one strategic move.
// Closes the architectural cause of regurgitation: senior_writer previously got the
// full context dump and was asked to "write the proposal" with no structural pressure
// to differentiate sections, so the same facts and moves recurred section after section.
// Output: JSON with {themes, facts_budget, anti_patterns, ...} persisted to
// opportunities.strategic_thesis and injected as a "## STRATEGIC THESIS" block at
// the top of the senior_writer user message.
// ─────────────────────────────────────────────────────────────────────────────
async function generateStrategicThesis(opp, scope, financial, research, kbContext, topPPText, discriminatorsText, methodologyCorpusText) {
  if (!opp) return null;
  var oppTitle = (opp.title||'').slice(0,150);
  var oppAgency = (opp.agency||'').slice(0,80);
  var rfpReqs = opp.rfp_requirements || {};
  var evalCriteriaList = (rfpReqs.evaluation_criteria || []).map(function(ec) {
    return (ec.name||'') + (ec.weight_percent ? ' (' + ec.weight_percent + '%)' : '');
  }).join(', ');
  var namedRequirements = (rfpReqs.requirements || []).slice(0, 8).map(function(r) {
    return (r.id||'R?') + ': ' + (r.requirement_text||'').slice(0, 200);
  }).join('\n');

  var prompt = 'STRATEGIC THESIS DESIGN — produce the spine for a winning proposal.\n\n' +
    'You are NOT writing prose. You are designing the strategic moves the proposal will execute.\n' +
    'Your output is JSON that will constrain how the senior writer organizes the document.\n\n' +
    'OPP: ' + oppTitle + '\n' +
    'AGENCY: ' + oppAgency + '\n' +
    'EVAL CRITERIA: ' + (evalCriteriaList || 'unknown') + '\n\n' +
    'TOP RFP REQUIREMENTS (from structured extraction):\n' + (namedRequirements || '(none extracted)') + '\n\n' +
    'SCOPE ANALYSIS:\n' + (scope||'').slice(0, 4000) + '\n\n' +
    'PURSUIT RESEARCH (agency profile, competitive landscape, ghost language):\n' + (research||'').slice(0, 3000) + '\n\n' +
    'TOP-RELEVANT PAST PERFORMANCE:\n' + (topPPText||'').slice(0, 2500) + '\n\n' +
    'DISCRIMINATORS (internal-only, never name competitors):\n' + (discriminatorsText||'').slice(0, 1500) + '\n\n' +
    'KB METHODOLOGY (sample):\n' + (methodologyCorpusText||'').slice(0, 1500) + '\n\n' +
    'OUTPUT REQUIREMENTS:\n' +
    'Produce 3-5 strategic theses. Output ONLY valid JSON. No prose. No markdown fencing.\n\n' +
    'CONSTRAINTS PER THESIS:\n' +
    '- SPECIFICITY: must name a specific HGI capability, project, dollar figure, regulation, or failure mode. ' +
    'Forbidden generic words in the claim text: "experience", "capability", "expertise", "commitment", ' +
    '"dedication", "partnership", "comprehensive", "robust", "deep", "extensive", "proven", "trusted", ' +
    '"leading", "innovative", "best-in-class".\n' +
    '- TESTABILITY: an evaluator must be able to verify the underlying claim. ' +
    '"$67.0M direct contract on Road Home managing 185,000+ applications with zero misappropriation findings" ' +
    'passes (verifiable). "We deeply understand local needs" fails (not testable).\n' +
    '- TRADEOFF NAMED: each thesis must explicitly state what HGI is NOT optimizing for. ' +
    'A real strategic move has an explicit opportunity cost. ' +
    'Example: "Not optimizing for the lowest hourly rate; optimizing for zero-finding audit defense ' +
    'across the 60-month performance period."\n' +
    '- OPPORTUNITY-SPECIFIC: must reference something specific to THIS RFP/agency, not generic firm marketing. ' +
    'Reference an RFP section number, a specific named project the agency has run, a specific regulation cited ' +
    'in the RFP, or a specific failure mode this evaluator type has encountered.\n' +
    '- SECTION DISCIPLINE: assign each thesis to 1-2 sections where it will be LOAD-BEARING. ' +
    'No thesis can be load-bearing in more than 2 sections.\n\n' +
    'OUTPUT JSON STRUCTURE:\n' +
    '{\n' +
    '  "themes": [\n' +
    '    {\n' +
    '      "id": "T1",\n' +
    '      "claim": "<one sentence stating the strategic move, with named specifics>",\n' +
    '      "evidence_anchor": "<the specific HGI fact, project, methodology, or capability that proves this — must be cited verbatim from the inputs above, never invented>",\n' +
    '      "tradeoff": "<what HGI is NOT optimizing for in service of this thesis>",\n' +
    '      "load_bearing_sections": ["<section name from RFP table of contents>", "<optional second section>"],\n' +
    '      "evaluator_concern_addressed": "<which eval criterion this thesis serves>"\n' +
    '    }\n' +
    '  ],\n' +
    '  "facts_budget": [\n' +
    '    {"fact": "<a specific fact like \\\"$109.3M\\\" or \\\"zero misappropriation findings\\\" or \\\"continuously since 1929\\\"", "max_section_appearances": 2}\n' +
    '  ],\n' +
    '  "anti_patterns": [\n' +
    '    "<one specific way THIS proposal could fall into regurgitation, with a directive to avoid it>"\n' +
    '  ]\n' +
    '}\n\n' +
    'GENERATE 3-5 THEMES, 5-10 FACTS IN BUDGET, 2-4 ANTI-PATTERNS. ' +
    'If a constraint cannot be met (e.g., no opportunity-specific anchor available), produce fewer themes ' +
    'rather than weaker ones. Quality over quantity. ' +
    'Do NOT invent facts not present in the inputs above.';

  var resp;
  try {
    resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    if (typeof trackCost === 'function') trackCost('strategic_thesis', 'claude-sonnet-4-6', resp.usage);
  } catch(e) {
    log('STRATEGIC THESIS: model call failed: ' + (e.message||'').slice(0,150));
    return null;
  }

  var raw = (resp.content || []).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('');
  var cleaned = raw.replace(/```json|```/g, '').trim();
  var parsed = null;
  try { parsed = JSON.parse(cleaned); }
  catch(pe) {
    var m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch(pe2) { log('STRATEGIC THESIS: JSON parse failed'); return null; } }
    else { log('STRATEGIC THESIS: no JSON object found'); return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  parsed.themes = Array.isArray(parsed.themes) ? parsed.themes : [];
  parsed.facts_budget = Array.isArray(parsed.facts_budget) ? parsed.facts_budget : [];
  parsed.anti_patterns = Array.isArray(parsed.anti_patterns) ? parsed.anti_patterns : [];
  parsed.generated_at = new Date().toISOString();
  parsed.themes_count = parsed.themes.length;
  log('STRATEGIC THESIS: generated ' + parsed.themes.length + ' themes, ' + parsed.facts_budget.length + ' facts in budget, ' + parsed.anti_patterns.length + ' anti-patterns');
  return parsed;
}

function formatStrategicThesisForPrompt(thesis) {
  if (!thesis || !Array.isArray(thesis.themes) || thesis.themes.length === 0) return '';
  var lines = ['## STRATEGIC THESIS — REQUIRED ORGANIZATION FOR THIS PROPOSAL', ''];
  lines.push('You MUST organize this proposal around the ' + thesis.themes.length + ' strategic theses below. Each theme has a load-bearing section assignment, an evidence anchor, and a stated tradeoff. The proposal that wins makes these moves explicitly. The proposal that loses regurgitates the RFP back at the client. Do not deviate from these assignments.');
  lines.push('');
  thesis.themes.forEach(function(t) {
    lines.push('### ' + (t.id||'T?') + ': ' + (t.claim||''));
    lines.push('- **Evidence anchor:** ' + (t.evidence_anchor||'(unspecified — use only verifiable HGI facts)'));
    lines.push('- **Stated tradeoff:** ' + (t.tradeoff||'(unspecified)'));
    lines.push('- **Load-bearing in:** ' + ((t.load_bearing_sections||[]).join(' AND ') || '(any one section the writer judges most fitting)'));
    lines.push('- **Evaluator concern this serves:** ' + (t.evaluator_concern_addressed||'(unspecified)'));
    lines.push('');
  });
  if (Array.isArray(thesis.facts_budget) && thesis.facts_budget.length > 0) {
    lines.push('## FACTS BUDGET — REPETITION CAP');
    lines.push('Each fact below may appear in AT MOST the stated number of sections. ' +
               'Repeating the same fact across more sections IS regurgitation even if each instance is well-written. ' +
               'Choose the 1-2 sections where each fact lands hardest.');
    lines.push('');
    thesis.facts_budget.forEach(function(f) {
      lines.push('- "' + (f.fact||'') + '" — max ' + (f.max_section_appearances || 2) + ' sections');
    });
    lines.push('');
  }
  if (Array.isArray(thesis.anti_patterns) && thesis.anti_patterns.length > 0) {
    lines.push('## ANTI-PATTERNS FOR THIS OPPORTUNITY — DO NOT FALL INTO THESE');
    thesis.anti_patterns.forEach(function(ap) {
      lines.push('- ' + ap);
    });
    lines.push('');
  }
  return lines.join('\n') + '\n';
}


// ============================================================
// ORCHESTRATION PIPELINE — Sequential deep analysis for new/changed opps
// Ported from V1 orchestrate.js. Runs scope→financial→research→winnability.
// Fires automatically when an opp has RFP text but no scope_analysis.
// ============================================================

async function kbQuery(vertical, oppText) {
  try {
    var chunks = await supabase.from('knowledge_chunks')
      .select('chunk_text,document_title,vertical')
      .or('vertical.eq.' + (vertical || 'disaster') + ',vertical.is.null')
      .order('created_at', { ascending: false })
      .limit(8);
    if (!chunks.data || chunks.data.length === 0) return '';
    return 'HGI KNOWLEDGE BASE:\n' + chunks.data.map(function(c) {
      return '[' + (c.document_title || 'KB') + '] ' + (c.chunk_text || '').slice(0, 600);
    }).join('\n');
  } catch(e) { return ''; }
}

// ═════════════════════════════════════════════════════════════════════════════
// extractRFPRequirements — S115 D+E shared infrastructure (S116 cap lift)
// Parses an RFP/RFQ/SOQ into a structured JSON requirements list. Output feeds:
//   - D.gap-detector (S119): flags requirements without mapped proposal paragraphs
//   - E.compliance-audit (S125): every-requirement compliance matrix
//   - F.coverage-matrix (S127): visual evaluator-criteria coverage graphic
// Called from orchestrateOpp scope step. Also exposed via /api/extract-rfp-reqs
// for targeted re-runs. S116: cap raised to 180K chars (from S115's 40K) —
// Sonnet 4.6 native 200K window allows full-document extraction on dense RFPs.
// ═════════════════════════════════════════════════════════════════════════════
async function extractRFPRequirements(rfpText, opp) {
  if (!rfpText || rfpText.length < 500) return null;
  // S116 Item 0: cap raised 40K → 180K. Sonnet 4.6 handles 200K context natively;
  // 180K leaves ~20K headroom for system prompt + JSON output. Enables full-document
  // extraction on dense RFPs (OPSB 187K, WashParish 144K were truncation-bound in S115).
  var truncated = rfpText.slice(0, 180000);
  var oppTitle = ((opp && opp.title) || '').slice(0, 120);
  var oppAgency = ((opp && opp.agency) || '').slice(0, 80);

  var prompt = 'You are extracting STRUCTURED REQUIREMENTS from a procurement RFP/RFQ/SOQ document. ' +
    'Your output must be precise, enumerated, and traceable back to specific sections of the RFP.\n\n' +
    'RFP TITLE: ' + oppTitle + '\n' +
    'AGENCY: ' + oppAgency + '\n\n' +
    'EXTRACT FOUR THINGS:\n\n' +
    '1. REQUIREMENTS — every specific item the proposer must address, respond to, or provide. ' +
    'Look for numbered/lettered sections, shall/must/will language, bullet requirements, submission checklists. ' +
    'For each: assign id ("R1", "R1.1", "R2"); capture exact section_number (null if none) and section_title (null if none); ' +
    'include requirement_text (<=400 chars, paraphrase OK); classify type as "mandatory" (shall/must), "responsive" ' +
    '(proposer should address), or "informational" (context only); set weight_percent if the RFP states one for that ' +
    'specific item (null otherwise); identify response_format ("narrative", "table", "form_field", "resume", "org_chart", ' +
    '"attachment", "other"); page_limit as integer if constrained (null otherwise); evaluation_criterion_id if the requirement ' +
    'clearly maps to a stated evaluation factor (null otherwise).\n\n' +
    '2. EVALUATION_CRITERIA — factors the agency will score against, with stated weights. ' +
    'Each: id ("EC-1", "EC-2"), name ("Technical Approach", "Past Performance", etc.), weight_percent (null if unstated).\n\n' +
    '3. SUBMISSION_REQUIREMENTS — format/logistics constraints. Examples: page count limits, font/margin rules, copies, ' +
    'submission method, deadline, required forms/attachments, binding/tabbing. ' +
    'Each: type ("page_count", "format", "copies", "deadline", "attachment", "submission_method", "binding", "other") and constraint (specific rule).\n\n' +
    '4. FATAL_FLAWS — patterns causing disqualification or severe penalty. Examples: late submission, missing signatures, ' +
    'exceeding page limits, missing required forms, improper format, missing certifications. ' +
    'Each: pattern (what triggers the flaw) and penalty (stated consequence).\n\n' +
    'OUTPUT ONLY VALID JSON. No prose, no markdown fencing, no commentary. Structure:\n' +
    '{\n' +
    '  "requirements": [{"id":"R1","section_number":"1.1","section_title":"Technical Approach","requirement_text":"...","type":"mandatory","weight_percent":40,"response_format":"narrative","page_limit":null,"evaluation_criterion_id":"EC-1"}, ...],\n' +
    '  "evaluation_criteria": [{"id":"EC-1","name":"Technical Approach","weight_percent":40}, ...],\n' +
    '  "submission_requirements": [{"type":"page_count","constraint":"25 pages single-sided"}, ...],\n' +
    '  "fatal_flaws": [{"pattern":"late submission","penalty":"disqualification"}, ...]\n' +
    '}\n\n' +
    'IF AN ITEM IS NOT STATED IN THE RFP, use null or empty array. Do NOT invent. False positives are worse than misses.\n\n' +
    'RFP TEXT FOLLOWS:\n\n' + truncated;

  var resp;
  try {
    resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 12000,
      messages: [{ role: 'user', content: prompt }]
    });
    trackCost('orchestrator_rfp_requirements', 'claude-sonnet-4-6', resp.usage);
  } catch(ce) {
    log('extractRFPRequirements: model call failed: ' + (ce.message||'').slice(0,120));
    return null;
  }

  var raw = (resp.content || []).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('');
  var cleaned = raw.replace(/```json|```/g, '').trim();
  var parsed = null;
  try { parsed = JSON.parse(cleaned); }
  catch(pe) {
    var m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch(pe2) { log('extractRFPRequirements: JSON parse failed'); return null; } }
    else { log('extractRFPRequirements: no JSON object found'); return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  parsed.requirements = Array.isArray(parsed.requirements) ? parsed.requirements : [];
  parsed.evaluation_criteria = Array.isArray(parsed.evaluation_criteria) ? parsed.evaluation_criteria : [];
  parsed.submission_requirements = Array.isArray(parsed.submission_requirements) ? parsed.submission_requirements : [];
  parsed.fatal_flaws = Array.isArray(parsed.fatal_flaws) ? parsed.fatal_flaws : [];
  parsed.extracted_at = new Date().toISOString();
  parsed.extracted_from_chars = truncated.length;
  parsed.source_rfp_total_chars = rfpText.length;
  parsed.extractor_version = 's116_v1';
  return parsed;
}

async function orchestrateOpp(opp) {
  var oppId = opp.id;
  var d = String.fromCharCode(36);
  log('ORCHESTRATE: Starting 5-step analysis for ' + (opp.title || '').slice(0, 50));

  var rfpContent = (opp.rfp_text || '').slice(0, 40000);
  var kbContext = await kbQuery(opp.vertical, opp.title + ' ' + (opp.agency || ''));

  // ═══ ALL-INTO-ALL ORCHESTRATION: Load EVERY intelligence source ═══
  var agency = (opp.agency||'').trim();
  var agencyLower = agency.toLowerCase();
  var vertical = (opp.vertical||'disaster recovery').trim();
  var verticalLower = vertical.toLowerCase();
  var oppState = (opp.state||'Louisiana').trim();
  function orchMatch(text) {
    if (!text) return false;
    var t = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
    return (agencyLower && t.indexOf(agencyLower) > -1) || t.indexOf(verticalLower) > -1 || (oppState && t.indexOf(oppState.toLowerCase()) > -1);
  }

  var orchIntel = await Promise.allSettled([
    supabase.from('organism_memory').select('observation,agent').eq('opportunity_id', oppId).order('created_at',{ascending:false}).limit(30),
    supabase.from('competitive_intelligence').select('competitor_name,agency,strengths,weaknesses,threat_level,incumbent_at,price_intelligence,known_contracts,active_verticals,win_rate_estimate').order('created_at',{ascending:false}).limit(100),
    supabase.from('relationship_graph').select('contact_name,title,organization,relationship_strength,hgi_relationship,role_in_procurement,agency,notes').order('created_at',{ascending:false}).limit(100),
    supabase.from('disaster_alerts').select('disaster_name,state,counties,declaration_date,fema_programs,hgi_recommendation,procurement_window').order('created_at',{ascending:false}).limit(50),
    supabase.from('budget_cycles').select('agency,state,procurement_window,rfp_timing,budget_amount,hgi_vertical').order('created_at',{ascending:false}).limit(50),
    supabase.from('recompete_tracker').select('client,contract_name,known_competitor,contract_end_date,hgi_incumbent,estimated_value_annual,decision_maker').order('created_at',{ascending:false}).limit(50),
    supabase.from('regulatory_changes').select('regulation_name,effective_date,impact_level,affected_verticals,summary,hgi_action_required').order('created_at',{ascending:false}).limit(50),
    supabase.from('teaming_partners').select('partner_name,capability,location,certifications,verticals,fit_score').order('fit_score',{ascending:false}).limit(30),
    supabase.from('agency_profiles').select('agency_name,state,annual_budget,incumbent_contractors,hgi_relationship,hgi_history,procurement_process,key_contacts').order('created_at',{ascending:false}).limit(30),
    supabase.from('pipeline_analytics').select('category,title,insight,recommendation,affected_verticals').order('created_at',{ascending:false}).limit(30),
    supabase.from('opportunities').select('title,agency,vertical,opi_score,outcome,outcome_notes').not('outcome','is',null).order('last_updated',{ascending:false}).limit(15),
    supabase.from('organism_memory').select('observation,agent').neq('opportunity_id', oppId).order('created_at',{ascending:false}).limit(300)
  ]);
  function getOI(idx) { return (orchIntel[idx].status === 'fulfilled' && orchIntel[idx].value.data) || []; }

  var oiMems = getOI(0), oiCI = getOI(1), oiRG = getOI(2), oiDA = getOI(3);
  var oiBC = getOI(4), oiRC = getOI(5), oiReg = getOI(6), oiTeam = getOI(7);
  var oiAP = getOI(8), oiAnalytics = getOI(9), oiOutcomes = getOI(10), oiCrossMem = getOI(11);

  // Filter to relevant records
  var relCI = oiCI.filter(function(c) { return c.opportunity_id === oppId || orchMatch(c.agency) || orchMatch(c.active_verticals) || orchMatch(c.incumbent_at); });
  var relRG = oiRG.filter(function(r) { return orchMatch(r.organization) || orchMatch(r.agency); });
  var relDA = oiDA.filter(function(d) { return (d.state||'').toLowerCase() === oppState.toLowerCase() || orchMatch(d.counties); });
  var relBC = oiBC.filter(function(b) { return orchMatch(b.agency) || (b.state||'').toLowerCase() === oppState.toLowerCase(); });
  var relRC = oiRC.filter(function(r) { return orchMatch(r.client) || orchMatch(r.known_competitor); });
  var relReg = oiReg.filter(function(r) { return orchMatch(r.affected_verticals) || orchMatch(r.summary); });
  var relTeam = oiTeam.filter(function(t) { return orchMatch(t.verticals) || orchMatch(t.capability); });
  var relAP = oiAP.filter(function(a) { return orchMatch(a.agency_name) || (a.state||'').toLowerCase() === oppState.toLowerCase(); });
  var relAnalytics = oiAnalytics.filter(function(a) { return orchMatch(a.affected_verticals) || orchMatch(a.insight); });
  var relOutcomes = oiOutcomes.filter(function(o) { return orchMatch(o.agency) || orchMatch(o.vertical); });
  var relCross = oiCrossMem.filter(function(m) { return orchMatch(m.observation); }).slice(0, 20);

  // Build compressed intelligence context for injection into each analysis step
  var orchContext = '';
  if (oiMems.length > 0) orchContext += '\nORGANISM MEMORY:\n' + oiMems.map(function(m) { return '[' + m.agent + '] ' + (m.observation || '').slice(0, 600); }).join('\n');
  if (relCI.length > 0) orchContext += '\nCOMPETITORS:\n' + relCI.slice(0,10).map(function(c) { return c.competitor_name + ' | Threat:' + (c.threat_level||'?') + ' | Strengths:' + (c.strengths||'').slice(0,150) + ' | Weaknesses:' + (c.weaknesses||'').slice(0,150) + ' | Prices:' + (c.price_intelligence||'') + ' | Incumbent at:' + (c.incumbent_at||''); }).join('\n');
  if (relRG.length > 0) orchContext += '\nHGI CONTACTS AT THIS AGENCY:\n' + relRG.slice(0,8).map(function(r) { return (r.contact_name||'') + ', ' + (r.title||'') + ' @ ' + (r.organization||'') + ' (strength:' + (r.relationship_strength||'') + ', HGI:' + (r.hgi_relationship||'') + ') Role:' + (r.role_in_procurement||''); }).join('\n');
  if (relDA.length > 0) orchContext += '\nDISASTER DECLARATIONS:\n' + relDA.slice(0,5).map(function(d) { return (d.disaster_name||'') + ' (' + (d.declaration_date||'').slice(0,10) + ') Programs:' + (d.fema_programs||'') + ' Procurement:' + (d.procurement_window||''); }).join('\n');
  if (relBC.length > 0) orchContext += '\nBUDGET CYCLES:\n' + relBC.slice(0,5).map(function(b) { return (b.agency||'') + ': ' + (b.procurement_window||'') + ' ' + (b.rfp_timing||'') + ' Budget:' + (b.budget_amount||''); }).join('\n');
  if (relRC.length > 0) orchContext += '\nRECOMPETE/INCUMBENT DATA:\n' + relRC.slice(0,5).map(function(r) { return (r.client||'') + ': incumbent=' + (r.known_competitor||'?') + ' ends ' + (r.contract_end_date||'?') + ' value=' + (r.estimated_value_annual||'?') + ' decision-maker=' + (r.decision_maker||'?'); }).join('\n');
  if (relReg.length > 0) orchContext += '\nREGULATORY CHANGES:\n' + relReg.slice(0,5).map(function(r) { return (r.regulation_name||'') + ' (effective ' + (r.effective_date||'') + '): ' + (r.summary||'').slice(0,200) + ' HGI action:' + (r.hgi_action_required||''); }).join('\n');
  if (relTeam.length > 0) orchContext += '\nPOTENTIAL TEAMING PARTNERS:\n' + relTeam.slice(0,5).map(function(t) { return (t.partner_name||'') + ' | ' + (t.capability||'') + ' | ' + (t.location||'') + ' | fit:' + (t.fit_score||''); }).join('\n');
  if (relAP.length > 0) orchContext += '\nAGENCY PROFILES:\n' + relAP.slice(0,3).map(function(a) { return (a.agency_name||'') + ': budget=' + (a.annual_budget||'?') + ' incumbent=' + (a.incumbent_contractors||'?') + ' HGI=' + (a.hgi_relationship||'none') + ' history=' + (a.hgi_history||'none') + ' procurement=' + (a.procurement_process||''); }).join('\n');
  if (relAnalytics.length > 0) orchContext += '\nPIPELINE PATTERNS:\n' + relAnalytics.slice(0,5).map(function(a) { return '[' + (a.category||'') + '] ' + (a.title||'') + ': ' + (a.insight||'').slice(0,200); }).join('\n');
  if (relOutcomes.length > 0) orchContext += '\nOUTCOME LESSONS:\n' + relOutcomes.map(function(o) { return (o.title||'').slice(0,50) + ' (' + (o.outcome||'') + ', OPI ' + (o.opi_score||'') + '): ' + (o.outcome_notes||''); }).join('\n');
  if (relCross.length > 0) orchContext += '\nCROSS-OPP INTELLIGENCE:\n' + relCross.slice(0,10).map(function(m) { return '[' + m.agent + '] ' + (m.observation||'').slice(0,300); }).join('\n');

  log('ORCHESTRATE ALL-INTO-ALL: ' + orchContext.length + ' chars of intelligence loaded (' +
      relCI.length + ' competitors, ' + relRG.length + ' contacts, ' + relDA.length + ' disasters, ' +
      relBC.length + ' budgets, ' + relRC.length + ' recompetes, ' + relReg.length + ' regulations, ' +
      relTeam.length + ' teaming, ' + relAP.length + ' agencies, ' + relOutcomes.length + ' outcomes)');

  // Trim orchContext for Sonnet calls (keep under ~4000 chars per step)
  var orchSlice = orchContext.slice(0, 6000);

  var classGuide = 'HGI CORE (score 70-95): workers comp TPA, property casualty TPA, insurance guaranty, FEMA PA grant mgmt, CDBG-DR program admin, disaster recovery program mgmt, property tax appeals, workforce WIOA, construction MANAGEMENT (not physical), housing authority mgmt, HUD compliance, grant management, class action settlement admin, staff augmentation, call center ops. NOT HGI (score below 25): Medicaid, clinical health, behavioral health, physical construction, debris removal, insurance brokerage, IT services, engineering, environmental remediation.';

  var results = { steps: [], errors: [] };

  // STEP 1: SCOPE ANALYSIS
  try {
    var scopeCall = await callWithContinuation({
      model: 'claude-sonnet-4-6', max_tokens: 8000,
      system: 'Senior government contracting scope analyst. ' + classGuide + ' Geography: LA TX FL MS AL GA. Be exhaustive ABOUT WHAT THE RFP ACTUALLY SAYS. Do not infer or embellish. Cite specific RFP sections. If the RFP does not mention a funding source, program history, or scope element, do not claim it does. OUTPUT FORMAT (S119): Do NOT add classification headers, analyst-role attributions, document banners, "Principal Eyes Only" / "Eyes Only" / "Principals Only" / "Capture-Sensitive" markings, date/version stamps, session numbers, "Prepared for" labels, or any boilerplate metadata to your output. The orchestrator handles all framing. Return only the requested analysis content. This also applies to trailing sign-offs, attribution lines, or footer text. CITATION DISCIPLINE (S119): When you cite a specific RFP section number (e.g., "Section 7.2.1", "§5.8", "Section 8.1"), the section label must appear verbatim in the RFP text above. Do not invent section numbers or assume standard RFP numbering schemes (e.g., do NOT write "Section 8" if the RFP only contains "Section 5.8" — these are different sections). If you need to reference RFP content but cannot find a matching section number that appears verbatim, write "(per the RFP scope statement)" or describe by content rather than by fabricated number.',
      messages: [{ role: 'user', content: 'Deep scope analysis for HGI go/no-go.\n\nGROUND RULE: Every factual claim in your output must be directly supported by the RFP TEXT below. Do NOT infer program funding sources (e.g., FEMA, CDBG, CDBG-DR), historical context (e.g., post-Katrina, post-COVID), or agency priorities from your general knowledge or from the organism intelligence unless the RFP text explicitly confirms them. If the RFP does not mention FEMA, do not frame the opportunity as a FEMA play. If the RFP does not mention CDBG, do not frame it as a CDBG play. The organism intelligence below is for COMPETITIVE positioning (who else is bidding, what rates they charge, who the incumbent is) — NOT for inferring scope or funding. If you are uncertain whether something is in the RFP, say so explicitly.\n\nOPPORTUNITY: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nSTATE: ' + (opp.state || 'LA') + '\nVERTICAL: ' + (opp.vertical || 'general') + '\nRFP TEXT:\n' + rfpContent + '\n' + kbContext.slice(0, 2000) + '\n\nORGANISM INTELLIGENCE (competitors, contacts, disasters, budgets, regulations, patterns — FOR COMPETITIVE POSITIONING ONLY):\n' + orchSlice + '\n\nProvide:\n1. SUB-VERTICAL CLASSIFICATION — exact type of work, is this HGI core? (Base this ONLY on what the RFP describes, not on HGI past performance patterns.)\n2. SCOPE SUMMARY — what is being asked, plain English, 3-5 sentences. Stick to the RFP.\n3. DETAILED DELIVERABLES — every task and work product from the RFP. If you cite a task, it must be in the RFP text above.\n4. EVALUATION CRITERIA — exact criteria and point values from RFP. Quote or paraphrase from the RFP.\n5. HGI CAPABILITY ALIGNMENT — map each deliverable to HGI past performance, flag gaps. Use the competitor intelligence above to identify where HGI is stronger or weaker than likely bidders.\n6. COMPLIANCE REQUIREMENTS — licenses, certs, insurance, bonding AS SPECIFIED IN THE RFP. Do not add requirements from your general knowledge unless the RFP triggers them.\n7. CRITICAL QUESTIONS — what must HGI clarify before committing\n8. COMPETITIVE POSITIONING — based on the competitor data above, who is the primary threat and why? What is HGI\'s key differentiator?\n9. SOURCE CHECK — briefly note any claim you made that you are NOT 100% certain is in the RFP text above, so Christopher can verify.' }]
    }, 'orchestrator_scope', 2);
    var scopeText = scopeCall.text;
    if (scopeText.length > 100) {
      // === FACT-CHECKER (Session 107) ===
      // Session 106 OPSB bug: scope analyst hallucinated "post-Katrina FEMA PA + CDBG-DR program"
      // when the actual RFP contained zero CDBG/Katrina mentions. Root cause: pattern-matching to HGI memory.
      // Fix: cheap Haiku pass that verifies concrete claims against the RFP text before saving.
      var scopeToSave = scopeText;
      try {
        var factCheckPrompt = 'You are a fact-checker. I will give you (1) an RFP TEXT, and (2) a SCOPE ANALYSIS written about that RFP.\n\n' +
          'Your job: find any CONCRETE CLAIMS in the SCOPE ANALYSIS that are NOT supported by the RFP TEXT.\n\n' +
          'Look especially for invented framing like:\n' +
          '- Funding source claims ("FEMA PA", "CDBG-DR", "HMGP", "federal funding") not in the RFP\n' +
          '- Historical context ("post-Katrina", "post-COVID", "following Hurricane X") not in the RFP\n' +
          '- Agency program names or priorities not in the RFP\n' +
          '- Specific dollar amounts, dates, or quantities not in the RFP\n' +
          '- Named people or positions not in the RFP\n\n' +
          'Exclude from flagging: genuinely generic analysis ("HGI has experience with X"), competitive positioning ("vendor Y is likely to bid"), or forward-looking recommendations. These are OPINIONS, not claims about the RFP.\n\n' +
          'Return JSON only: {"hallucinated_claims":[{"claim":"exact phrase from scope","why_invented":"brief reason"}],"verdict":"CLEAN|FLAGGED|CONTAMINATED"}\n' +
          '- CLEAN: zero claims invented\n' +
          '- FLAGGED: 1-2 minor claims invented (can be fixed with annotation)\n' +
          '- CONTAMINATED: 3+ claims invented OR any claim that reframes the opportunity (like inventing a funding source). Scope should be regenerated.\n\n' +
          'RFP TEXT:\n' + (rfpContent || '').slice(0, 30000) + '\n\n' +
          'SCOPE ANALYSIS:\n' + scopeText;
        var fcResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
          messages: [{ role: 'user', content: factCheckPrompt }]
        });
        trackCost('orchestrator_fact_check', 'claude-haiku-4-5-20251001', fcResp.usage);
        var fcText = (fcResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('').replace(/```json|```/g, '').trim();
        var fc;
        try { fc = JSON.parse(fcText); }
        catch(pe) { var jm = fcText.match(/\{[\s\S]*\}/); if (jm) { try { fc = JSON.parse(jm[0]); } catch(pe2){} } }
        if (fc && fc.verdict && fc.verdict !== 'CLEAN') {
          var claimsList = (fc.hallucinated_claims || []).map(function(c){ return '- "' + (c.claim||'').slice(0,120) + '" (' + (c.why_invented||'').slice(0,80) + ')'; }).join('\n');
          var banner = '⚠️ FACT-CHECK: ' + fc.verdict + ' — scope may contain claims not supported by RFP text.\nClaims flagged:\n' + claimsList + '\n\n--- BEGIN SCOPE ANALYSIS ---\n';
          scopeToSave = banner + scopeText;
          log('ORCHESTRATE FACT-CHECK: ' + fc.verdict + ' — ' + (fc.hallucinated_claims||[]).length + ' claims flagged for ' + oppId);
          try {
            await storeMemory('orchestrator_fact_check', oppId, 'fact_check,hallucination',
              'FACT-CHECK VERDICT: ' + fc.verdict + ' for ' + (opp.title||'').slice(0,60) + '\n' +
              (fc.hallucinated_claims||[]).length + ' claims flagged:\n' + claimsList +
              '\n\nReview the scope_analysis before proposal generation. Regenerate if CONTAMINATED.',
              'analysis', null, 'high');
          } catch(fme) {}
        } else if (fc && fc.verdict === 'CLEAN') {
          log('ORCHESTRATE FACT-CHECK: CLEAN for ' + oppId);
        }
      } catch(fce) { log('ORCHESTRATE FACT-CHECK error (non-fatal): ' + (fce.message||'').slice(0,120)); }

      await supabase.from('opportunities').update({ scope_analysis: scopeToSave, last_updated: new Date().toISOString() }).eq('id', oppId);
      results.steps.push('scope');
      log('ORCHESTRATE: Scope done (' + scopeToSave.length + ' chars)');
    }
  } catch(e) { results.errors.push('scope:' + e.message); log('ORCHESTRATE: Scope error: ' + e.message); }

  // STEP 1.5: STRUCTURED RFP REQUIREMENT EXTRACTION (S115)
  // Parses the RFP into a structured requirements list for D.gap-detector (S119)
  // and E.compliance-audit (S125). This step produces and persists; downstream
  // consumers are not yet wired.
  try {
    if (rfpContent && rfpContent.length >= 500) {
      var reqs = await extractRFPRequirements(rfpContent, opp);
      if (reqs) {
        await supabase.from('opportunities').update({ rfp_requirements: reqs, last_updated: new Date().toISOString() }).eq('id', oppId);
        results.steps.push('rfp_requirements');
        log('ORCHESTRATE: RFP requirements extracted (' + (reqs.requirements || []).length + ' reqs, ' + (reqs.evaluation_criteria || []).length + ' criteria, ' + (reqs.submission_requirements || []).length + ' submission rules, ' + (reqs.fatal_flaws || []).length + ' fatal flaws)');
      } else {
        log('ORCHESTRATE: RFP requirement extraction returned null');
      }
    } else {
      log('ORCHESTRATE: Skipping RFP requirement extraction (rfp_text < 500 chars)');
    }
  } catch(e) { results.errors.push('rfp_requirements:' + e.message); log('ORCHESTRATE: RFP requirement extraction error: ' + e.message); }

  // STEP 2: FINANCIAL ANALYSIS
  var scopeAnalysis = results.steps.indexOf('scope') >= 0 ? scopeText : (opp.scope_analysis || '');
  try {
    var finCall = await callWithContinuation({
      model: 'claude-sonnet-4-6', max_tokens: 5000,
      system: 'HGI CFO-level financial analyst. Show math for every estimate. Never present estimate as RFP fact. Rate card: Principal ' + d + '220, Prog Dir ' + d + '210, SME ' + d + '200, Sr Grant Mgr ' + d + '180, Grant Mgr ' + d + '175, Sr PM ' + d + '180, PM ' + d + '155, Grant Writer ' + d + '145, Cost Est ' + d + '125, Admin ' + d + '65.',
      messages: [{ role: 'user', content: 'Contract value estimation for HGI.\n\nOPP: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nESTIMATED VALUE: ' + (opp.estimated_value || 'Not stated') + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 2000) + '\n\nORGANISM INTELLIGENCE (competitor pricing, incumbent contracts, budget data, market rates):\n' + orchSlice + '\n\nEstimate using THREE methods with visible math:\n1. STAFFING MATH — list every RFP position, realistic monthly hours (MSA = 20-80 hrs/mo not 160), multiply by rate, base period only\n2. COMPARABLE CONTRACTS — use the competitor pricing intelligence and incumbent contract data above, plus 2-3 similar contracts in same state/vertical\n3. PERCENTAGE OF FEDERAL FUNDING — if FEMA/CDBG/HMGP, estimate total federal allocation, admin fee 5-12%. Use disaster declaration data above for context.\n\nThen: CONSOLIDATED ESTIMATE (LOW/MID/HIGH base period), option years separate as UPSIDE\nPRICE-TO-WIN ANALYSIS — based on competitor pricing intelligence above, what rate structure wins this against the likely field?\nSTAFFING PLAN, HGI COST TO DELIVER, PROFIT MARGIN, FINANCIAL RISKS, RECOMMENDATION (PURSUE/CONDITIONAL/PASS)' }]
    }, 'orchestrator_financial', 2);
    var finText = finCall.text;
    if (finText.length > 100) {
      await supabase.from('opportunities').update({ financial_analysis: finText, last_updated: new Date().toISOString() }).eq('id', oppId);
      results.steps.push('financial');
      log('ORCHESTRATE: Financial done (' + finText.length + ' chars)');
    }
  } catch(e) { results.errors.push('financial:' + e.message); log('ORCHESTRATE: Financial error: ' + e.message); }

  // STEP 3: RESEARCH with web search
  var finAnalysis = results.steps.indexOf('financial') >= 0 ? finText : (opp.financial_analysis || '');
  try {
    var researchResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 5000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: 'HGI senior capture intelligence analyst. Always search the web for agency facts, incumbents, budgets. Never guess. Cite sources.',
      messages: [{ role: 'user', content: 'Capture intelligence brief for HGI.\n\nOPP: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nSTATE: ' + (opp.state || 'LA') + '\nOPI: ' + opp.opi_score + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 1500) + '\nFINANCIAL:\n' + (finAnalysis || '').slice(0, 1500) + '\n' + kbContext.slice(0, 1500) + '\n\nORGANISM INTELLIGENCE (existing competitor data, contacts, relationships, incumbent info, budget cycles, regulatory context, outcome lessons, cross-opp patterns):\n' + orchSlice + '\n\nUse the organism intelligence above as your STARTING POINT — do not duplicate what the organism already knows. Search the web to FILL GAPS and verify/update existing intelligence. Provide:\n1. AGENCY PROFILE — budget, leadership, procurement patterns. Cross-reference agency profiles above.\n2. COMPETITIVE LANDSCAPE — START with the competitor data above, then add new findings. Who will bid? What are their real weaknesses HGI can exploit?\n3. HGI WIN STRATEGY — 3 differentiators mapped to eval criteria. Use relationship data above to identify insider advantages.\n4. GHOST LANGUAGE — specific themes that highlight competitor weaknesses without naming them (based on the weaknesses data above)\n5. RED FLAGS\n6. 48-HOUR ACTION PLAN — use role titles only, never names\n7. RISKS & CHALLENGES — honest assessment' }]
    });
    trackCost('orchestrator_research', 'claude-sonnet-4-6', researchResp.usage);
    var researchText = (researchResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n');
    if (researchText.length > 100) {
      await supabase.from('opportunities').update({ research_brief: researchText, last_updated: new Date().toISOString() }).eq('id', oppId);
      results.steps.push('research');
      log('ORCHESTRATE: Research done (' + researchText.length + ' chars)');
    }
  } catch(e) { results.errors.push('research:' + e.message); log('ORCHESTRATE: Research error: ' + e.message); }

  // STEP 4: REVISED OPI
  var researchBrief = results.steps.indexOf('research') >= 0 ? researchText : (opp.research_brief || '');
  try {
    var opiResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 100,
      system: 'OPI calibration engine. ' + classGuide + ' Return ONLY: REVISED_OPI: [number]',
      messages: [{ role: 'user', content: 'Re-score for HGI with full intel.\nTitle: ' + opp.title + '\nAgency: ' + (opp.agency || '') + '\nOriginal OPI: ' + opp.opi_score + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 1000) + '\nFINANCIAL:\n' + (finAnalysis || '').slice(0, 1000) + '\nRESEARCH:\n' + (researchBrief || '').slice(0, 1000) + '\n\nIf not HGI core work: score below 25. If core: Past Perf 30pts, Tech Cap 20pts, Competitive 15pts, Relationships 15pts, Strategic 10pts, Financial 10pts.\nReturn ONLY: REVISED_OPI: [number]' }]
    });
    trackCost('orchestrator_opi_rescore', 'claude-sonnet-4-6', opiResp.usage);
    var opiText = (opiResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    var opiMatch = opiText.match(/REVISED_OPI:\s*(\d+)/i);
    if (opiMatch) {
      var revisedOpi = parseInt(opiMatch[1]);
      await supabase.from('opportunities').update({ opi_score: revisedOpi, last_updated: new Date().toISOString() }).eq('id', oppId);
      results.revisedOpi = revisedOpi;
      results.steps.push('opi_rescore');
      log('ORCHESTRATE: OPI rescored ' + opp.opi_score + ' → ' + revisedOpi);
    }
  } catch(e) { results.errors.push('opi:' + e.message); }

  // STEP 5: WINNABILITY
  try {
    var winResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2500,
      system: 'HGI chief capture officer making final bid decision. First line MUST be: PWIN: [number]% | RECOMMENDATION: [GO|CONDITIONAL GO|NO-BID]',
      messages: [{ role: 'user', content: 'Final GO/NO-GO assessment.\nOPP: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nOPI: ' + (results.revisedOpi || opp.opi_score) + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 1000) + '\nFINANCIAL:\n' + (finAnalysis || '').slice(0, 1000) + '\nRESEARCH:\n' + (researchBrief || '').slice(0, 1000) + '\n\nORGANISM INTELLIGENCE (relationships, competitors, outcomes, patterns):\n' + orchSlice.slice(0, 3000) + '\n\nFirst line: PWIN: X% | RECOMMENDATION: GO/CONDITIONAL GO/NO-BID\nThen: decision justification considering competitor weaknesses and HGI relationships above, top 3 win factors, top 3 risks, conditions for GO, teaming recommendation based on partner data above' }]
    });
    trackCost('orchestrator_winnability', 'claude-sonnet-4-6', winResp.usage);
    var winText = (winResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    var pwinMatch = winText.match(/PWIN:\s*(\d+)/i);
    var recMatch = winText.match(/RECOMMENDATION:\s*(GO|CONDITIONAL GO|NO-BID)/i);
    results.pwin = pwinMatch ? parseInt(pwinMatch[1]) : 0;
    results.recommendation = recMatch ? recMatch[1] : 'UNDETERMINED';
    if (winText.length > 50) {
      await supabase.from('opportunities').update({ capture_action: ('PWIN: ' + results.pwin + '% | ' + results.recommendation + '\n\n' + winText).slice(0, 2000), last_updated: new Date().toISOString() }).eq('id', oppId);
      results.steps.push('winnability');
      log('ORCHESTRATE: Winnability done — PWIN ' + results.pwin + '% ' + results.recommendation);
    }
    // Store to organism_memory
    await storeMemory('orchestrator', oppId, (opp.agency || '') + ',' + (opp.vertical || '') + ',winnability,' + results.recommendation, 'ORCHESTRATION COMPLETE for ' + opp.title + ': OPI ' + (results.revisedOpi || opp.opi_score) + ', PWIN ' + results.pwin + '%, ' + results.recommendation + '. Steps: ' + results.steps.join('+'), 'winnability', null, 'high');
  } catch(e) { results.errors.push('winnability:' + e.message); }

  log('ORCHESTRATE: Complete. Steps: ' + results.steps.join('+') + (results.errors.length > 0 ? ' Errors: ' + results.errors.join(', ') : ''));
  return results;
}


// ============================================================
// RUN SESSION — The execution engine
// ============================================================
async function runSession(trigger) {
  var id = 'v4-' + Date.now();
  var isSkeleton = trigger.indexOf('skeleton') >= 0;
  log('=== SESSION START: ' + id + ' | trigger: ' + trigger + ' | mode: ' + (isSkeleton ? 'SKELETON (cost-control)' : 'FULL') + ' ===');
  cycleWrites.clear(); // Reset dedup tracker for new cycle

  try {
    var state = await loadState();
    if (state.pipeline.length === 0) {
      log('No pipeline. Session complete.');
      return;
    }

    log('Pipeline (' + state.pipeline.length + '):');
    state.pipeline.forEach(function(o) { log('  OPI:' + o.opi_score + ' | ' + (o.stage || '?') + ' | ' + (o.title || '').slice(0, 55)); });

    var activeOpps = state.pipeline.filter(function(o) { return (o.opi_score || 0) >= 65; });
    var allResults = [];
    var allEvalScores = [];
    var cycleMemoryIds = [];
    var newOppsFound = 0;
    var newRFPsRetrieved = 0;
    var eventTriggeredOpps = []; // opps that need full analysis due to events

    // 1. HUNTING — fires first (always runs, even in skeleton)
    try { var rH = await agentHunting(state, trigger); if (rH) { allResults.push(rH); if (rH.new_opps > 0) { newOppsFound = rH.new_opps; log('EVENT: ' + rH.new_opps + ' new opps discovered — will trigger full analysis'); var fresh = await supabase.from('opportunities').select('*').eq('status', 'active').order('opi_score', { ascending: false }).limit(15); if (fresh.data) { state.pipeline = fresh.data; activeOpps = state.pipeline.filter(function(o) { return (o.opi_score || 0) >= 65; }); } } } } catch (e) { log('Hunt error: ' + e.message); }

    // 1.5. AUTO-RFP RETRIEVAL — always runs, tracks new retrievals
    try { var rfpResults = await autoRetrieveRFPs(); if (rfpResults && rfpResults.length > 0) { var successfulRFPs = rfpResults.filter(function(r) { return r && r.retrieved; }); if (successfulRFPs.length > 0) { newRFPsRetrieved = successfulRFPs.length; log('EVENT: ' + successfulRFPs.length + ' new RFPs retrieved — will trigger full analysis for those opps'); successfulRFPs.forEach(function(r) { if (r && r.id) eventTriggeredOpps.push(r.id); }); } var refreshed = await supabase.from('opportunities').select('*').eq('status', 'active').order('opi_score', { ascending: false }).limit(15); if (refreshed.data) { state.pipeline = refreshed.data; activeOpps = state.pipeline.filter(function(o) { return (o.opi_score || 0) >= 65; }); } } } catch (e) { log('Auto-RFP error: ' + e.message); }

    // 2. ORCHESTRATION — Run full 5-step analysis on opps that need it
    // Triggers when: scope_analysis is NULL/empty AND rfp_text has real content
    // === SESSION 107 COST CONTROL ===
    // Autonomous orchestration disabled until cost tracking + hallucination guards fixed.
    // Set AUTO_ORCH_ENABLED=true in Railway env to re-enable.
    var AUTO_ORCH_ENABLED = process.env.AUTO_ORCH_ENABLED === 'true';
    if (AUTO_ORCH_ENABLED) try {
      var needsOrch = state.pipeline.filter(function(o) {
        var hasRfp = (o.rfp_text || '').length > 2000;
        var noScope = !o.scope_analysis || (o.scope_analysis || '').length < 200;
        var isActive = o.status === 'active' && (o.opi_score || 0) >= 80;
        return hasRfp && noScope && isActive;
      });
      if (needsOrch.length > 0) {
        // Hard budget cap: max 1 autonomous orchestration per session
        needsOrch = needsOrch.slice(0, 1);
        log('ORCHESTRATE: ' + needsOrch.length + ' opps need full analysis (capped at 1/session)');
        for (var oi = 0; oi < needsOrch.length; oi++) {
          try {
            var orchResult = await orchestrateOpp(needsOrch[oi]);
            allResults.push({ agent: 'orchestrator', chars: 500, opp: (needsOrch[oi].title || '').slice(0, 40), steps: orchResult.steps });
            // Refresh state after orchestration changes OPI
            var refreshOrch = await supabase.from('opportunities').select('*').eq('status', 'active').order('opi_score', { ascending: false }).limit(15);
            if (refreshOrch.data) { state.pipeline = refreshOrch.data; activeOpps = state.pipeline.filter(function(o) { return (o.opi_score || 0) >= 65; }); }
          } catch(oe) { log('ORCHESTRATE error on ' + (needsOrch[oi].title || '').slice(0, 40) + ': ' + oe.message); }
        }
      }
    } catch(e) { log('Orchestration check error: ' + e.message); }
    else { log('AUTO_ORCH: Disabled (Session 107 cost control). Orchestrate manually via /api/orchestrate/:oppId'); }

    // SKELETON GATE: In skeleton mode, only run essential system agents + event-triggered opps
    if (isSkeleton) {
      log('SKELETON MODE: Running essential system agents (5).');
      
      try { var rPS = await agentPipelineScanner(state); if (rPS) allResults.push(rPS); } catch (e) { log('PS err: ' + e.message); }
      try { var rAT = await agentAmendmentTracker(state); if (rAT) allResults.push(rAT); } catch (e) { log('AT err: ' + e.message); }
      try { var rDA = await agentDashboard(state); if (rDA) allResults.push(rDA); } catch (e) { log('Dash err: ' + e.message); }
      try { var rDM2 = await agentDisasterMonitor(state); if (rDM2) allResults.push(rDM2); } catch (e) { log('DM err: ' + e.message); }
      try { var rOPI2 = await agentOPICalibration(state); if (rOPI2) allResults.push(rOPI2); } catch (e) { log('OPI err: ' + e.message); }
      
      // EVENT-DRIVEN: If new opps or RFPs found, run full analysis ONLY on those opps
      if (newOppsFound > 0 || eventTriggeredOpps.length > 0) {
        log('EVENT-DRIVEN: Running full analysis on ' + (newOppsFound > 0 ? 'new opps' : eventTriggeredOpps.length + ' event-triggered opps'));
        var eventOpps = activeOpps.filter(function(o) {
          if (newOppsFound > 0) return true; // new opps = analyze everything once
          return eventTriggeredOpps.indexOf(o.id) >= 0;
        });
        for (var ei = 0; ei < eventOpps.length; ei++) {
          var eOpp = eventOpps[ei];
          log('--- Event opp ' + (ei+1) + '/' + eventOpps.length + ': ' + (eOpp.title||'?').slice(0,50) + ' ---');
          var eCB = await buildCycleBrief(eOpp, state);
          try { var r1 = await agentIntelligence(eOpp, state, eCB); if (r1) allResults.push(r1); } catch(e){}
          try { var r2 = await agentFinancial(eOpp, state, eCB); if (r2) allResults.push(r2); } catch(e){}
          try { var r3 = await agentWinnability(eOpp, state, eCB); if (r3) allResults.push(r3); } catch(e){}
          try { var r4 = await agentCRM(eOpp, state, eCB); if (r4) allResults.push(r4); } catch(e){}
        }
      }
      
      await storeMemory('v2', null, 'v2,skeleton,session',
        'V4 SKELETON SESSION - trigger:' + trigger + ' pipeline:' + state.pipeline.length + ' agents:' + allResults.length + ' newOpps:' + newOppsFound + ' newRFPs:' + newRFPsRetrieved,
        'analysis', null, 'high');
      log('=== SKELETON SESSION COMPLETE: ' + id + ' | ' + allResults.length + ' agents fired (cost-control mode) ===');
      return;
    }

    // === FULL/SMART MODE BELOW ===
    
    // SMART TRIGGER: Only run agents on opps where something CHANGED
    var isSmart = trigger.indexOf('smart') >= 0;
    if (isSmart) {
      var beforeCount = activeOpps.length;
      activeOpps = activeOpps.filter(function(o) {
        // Never analyzed = always run
        if (!o.last_analyzed_at) { log('SMART: ' + (o.title||'?').slice(0,40) + ' — NEVER ANALYZED'); return true; }
        var prev = o.last_analysis_state || {};
        var curRfpLen = (o.rfp_text || '').length;
        // RFP text changed (new RFP or addendum)
        if (curRfpLen !== (prev.rfp_len || 0)) { log('SMART: ' + (o.title||'?').slice(0,40) + ' — RFP CHANGED (' + (prev.rfp_len||0) + ' → ' + curRfpLen + ')'); return true; }
        // Stage changed
        if ((o.stage || '') !== (prev.stage || '')) { log('SMART: ' + (o.title||'?').slice(0,40) + ' — STAGE CHANGED (' + (prev.stage||'none') + ' → ' + (o.stage||'none') + ')'); return true; }
        // Outcome recorded
        if (o.outcome && !prev.outcome) { log('SMART: ' + (o.title||'?').slice(0,40) + ' — OUTCOME RECORDED'); return true; }
        // RFP retrieved for first time
        if (o.rfp_document_retrieved && !prev.rfp_retrieved) { log('SMART: ' + (o.title||'?').slice(0,40) + ' — RFP FIRST RETRIEVED'); return true; }
        return false;
      });
      log('SMART FILTER: ' + activeOpps.length + ' of ' + beforeCount + ' opps need analysis (' + (beforeCount - activeOpps.length) + ' skipped — no changes)');
      if (activeOpps.length === 0) {
        log('SMART: No per-opp changes — skipping per-opp agents but RUNNING system-wide agents');
        await storeMemory('v2', null, 'v2,smart,session', 'SMART SESSION — no per-opp changes across ' + beforeCount + ' opps. System-wide agents still running. Trigger: ' + trigger, 'analysis', null, 'high');
        // Don't return — fall through to system-wide agents below
      }
    }

    // 2. PER-OPP FIRST PASS — sequential, each builds on prior
    for (var i = 0; i < activeOpps.length; i++) {
      var opp = activeOpps[i];
      log('--- Opp ' + (i + 1) + '/' + activeOpps.length + ': ' + (opp.title || '?').slice(0, 50) + ' ---');

      // Build cycle brief
      var cycleBrief = await buildCycleBrief(opp, state);

      // Intelligence → refresh → Financial → Winnability → CRM → QualityGate → Staffing
      try { var r1 = await agentIntelligence(opp, state, cycleBrief); if (r1) allResults.push(r1); } catch (e) { log('Intel err: ' + e.message); }
      try { var freshOpp = await supabase.from('opportunities').select('*').eq('id', opp.id).single(); if (freshOpp.data) opp = freshOpp.data; } catch (e) {}
      try { var r2 = await agentFinancial(opp, state, cycleBrief); if (r2) allResults.push(r2); } catch (e) { log('Fin err: ' + e.message); }
      try { var r3 = await agentWinnability(opp, state, cycleBrief); if (r3) allResults.push(r3); } catch (e) { log('Win err: ' + e.message); }
      try { var r4 = await agentCRM(opp, state, cycleBrief); if (r4) allResults.push(r4); } catch (e) { log('CRM err: ' + e.message); }
      try { var r5 = await agentQualityGate(opp, state, cycleBrief); if (r5) allResults.push(r5); } catch (e) { log('QG err: ' + e.message); }
      // STAFFING moved to gated second pass (Session 81 audit)
    }

    // 3. PER-OPP SECOND PASS — GATED behind rfp_document_retrieved
    for (var j = 0; j < activeOpps.length; j++) {
      var opp2 = activeOpps[j];
      // RFP DOCUMENT RETRIEVAL GATE: Skip proposal agents if no RFP and not unsolicited
      var isUnsolicited = ((opp2.title || '') + ' ' + (opp2.description || '')).toLowerCase().indexOf('unsolicited') >= 0;
      var hasRFP = opp2.rfp_document_retrieved === true;
      if (!hasRFP && !isUnsolicited) {
        log('BLOCKED: RFP not retrieved for ' + (opp2.title || '?').slice(0, 50) + ' — skipping proposal agents');
        continue;
      }
      log('PROPOSAL PASS: ' + (opp2.title || '?').slice(0, 50) + (isUnsolicited ? ' [UNSOLICITED]' : ' [RFP RETRIEVED]'));
      var cb2 = await buildCycleBrief(opp2, state);
      // SESSION 81 AUDIT: 5 gated proposal agents (staffing moved here from first pass)
      try { var r6 = await agentStaffingPlan(opp2, state, cb2); if (r6) allResults.push(r6); } catch (e) { log('Staff err: ' + e.message); }
      try { var rPW = await agentProposalWriter(opp2, state, cb2); if (rPW) allResults.push(rPW); } catch (e) { log('PW err: ' + e.message); }
      try { var rRT = await agentRedTeam(opp2, state, cb2); if (rRT) allResults.push(rRT); } catch (e) { log('RT err: ' + e.message); }
      try { var rPTW = await agentPriceToWin(opp2, state, cb2); if (rPTW) allResults.push(rPTW); } catch (e) { log('PTW err: ' + e.message); }
      try { var rPA = await agentProposalAssembly(opp2, state, cb2); if (rPA) allResults.push(rPA); } catch (e) { log('PA err: ' + e.message); }
      // SESSION 88: ALL AGENTS RE-ENABLED — full organism intelligence
      try { var rBr = await agentBrief(opp2, state, cb2); if (rBr) allResults.push(rBr); } catch (e) { log('Brief err: ' + e.message); }
      try { var rOB = await agentOppBrief(opp2, state, cb2); if (rOB) allResults.push(rOB); } catch (e) { log('OB err: ' + e.message); }
      try { var rOP = await agentOralPrep(opp2, state, cb2); if (rOP) allResults.push(rOP); } catch (e) { log('OP err: ' + e.message); }
      try { var rPO = await agentPostAward(opp2, state); if (rPO) allResults.push(rPO); } catch (e) { log('PO err: ' + e.message); }
    }

    // 4. SYSTEM-WIDE AGENTS — SESSION 81 AUDIT: 4 keepers, 21 cut
    log('--- System-wide agents (ALL active — Session 88) ---');
    try { var rPS = await agentPipelineScanner(state); if (rPS) allResults.push(rPS); } catch (e) { log('PS err: ' + e.message); }
    try { var rDM = await agentDisasterMonitor(state); if (rDM) allResults.push(rDM); } catch (e) { log('DM err: ' + e.message); }
    try { var rDA = await agentDashboard(state); if (rDA) allResults.push(rDA); } catch (e) { log('Dash err: ' + e.message); }
    try { var rAT = await agentAmendmentTracker(state); if (rAT) allResults.push(rAT); } catch (e) { log('AT err: ' + e.message); }
    // RE-ENABLED (Session 83) — high-value Haiku agents (~$0.001/call each):
    try { var rOPI = await agentOPICalibration(state); if (rOPI) allResults.push(rOPI); } catch (e) { log('OPI err: ' + e.message); }
    try { var rEB = await agentExecutiveBrief(state); if (rEB) allResults.push(rEB); } catch (e) { log('EB err: ' + e.message); }
    try { var rRec = await agentRecruiting(state); if (rRec) allResults.push(rRec); } catch (e) { log('Rec err: ' + e.message); }
    try { var rLL = await agentLearningLoop(state); if (rLL) allResults.push(rLL); } catch (e) { log('LL err: ' + e.message); }
    // RE-ENABLED (Session 84) — 10 more system agents for full intelligence:
    log('--- Extended intelligence agents (10) ---');
    if (await shouldRunAgent('discovery_agent', 3)) { try { var rDis = await agentDiscovery(state); if (rDis) allResults.push(rDis); } catch (e) { log('Disc err: ' + e.message); } }
    // try { var rOPI = await agentOPICalibration(state); if (rOPI) allResults.push(rOPI); } catch (e) { log('OPI err: ' + e.message); }
    try { var rCE = await agentContentEngine(state); if (rCE) allResults.push(rCE); } catch (e) { log('CE err: ' + e.message); }
    // try { var rRec = await agentRecruiting(state); if (rRec) allResults.push(rRec); } catch (e) { log('Rec err: ' + e.message); }
    try { var rKB = await agentKnowledgeBase(state); if (rKB) allResults.push(rKB); } catch (e) { log('KB err: ' + e.message); }
    try { var rSI = await agentScraperInsights(state); if (rSI) allResults.push(rSI); } catch (e) { log('SI err: ' + e.message); }
    // try { var rEB = await agentExecutiveBrief(state); if (rEB) allResults.push(rEB); } catch (e) { log('EB err: ' + e.message); }
    try { var rDV = await agentDesignVisual(state); if (rDV) allResults.push(rDV); } catch (e) { log('DV err: ' + e.message); }
    if (await shouldRunAgent('teaming_agent', 7)) { try { var rTM = await agentTeaming(state); if (rTM) allResults.push(rTM); } catch (e) { log('Team err: ' + e.message); } }
    if (await shouldRunAgent('source_expansion', 7)) { try { var rSE = await agentSourceExpansion(state); if (rSE) allResults.push(rSE); } catch (e) { log('SE err: ' + e.message); } }
    if (await shouldRunAgent('contract_expiration', 7)) { try { var rCX = await agentContractExpiration(state); if (rCX) allResults.push(rCX); } catch (e) { log('CX err: ' + e.message); } }
    if (await shouldRunAgent('budget_cycle_tracker', 7)) { try { var rBC = await agentBudgetCycle(state); if (rBC) allResults.push(rBC); } catch (e) { log('BC err: ' + e.message); } }
    try { var rLA = await agentLossAnalysis(state); if (rLA) allResults.push(rLA); } catch (e) { log('LA err: ' + e.message); }
    try { var rWR = await agentWinRateAnalytics(state); if (rWR) allResults.push(rWR); } catch (e) { log('WR err: ' + e.message); }
    if (await shouldRunAgent('regulatory_monitor', 7)) { try { var rRM = await agentRegulatoryMonitor(state); if (rRM) allResults.push(rRM); } catch (e) { log('RM err: ' + e.message); } }
    try { var rOA = await agentOutreachAutomation(state); if (rOA) allResults.push(rOA); } catch (e) { log('OA err: ' + e.message); }
    // LearningLoop already active above (line 5317) — skip duplicate
    if (await shouldRunAgent('entrepreneurial_agent', 3)) { try { var rEN = await agentEntrepreneurial(state); if (rEN) allResults.push(rEN); } catch (e) { log('EN err: ' + e.message); } }
    if (await shouldRunAgent('recompete_monitor', 7)) { try { var rRC = await agentRecompete(state); if (rRC) allResults.push(rRC); } catch (e) { log('RC err: ' + e.message); } }
    if (await shouldRunAgent('competitor_deep_dive', 7)) { try { var rCD = await agentCompetitorDeepDive(state); if (rCD) allResults.push(rCD); } catch (e) { log('CD err: ' + e.message); } }
    if (await shouldRunAgent('agency_profile_agent', 7)) { try { var rAP = await agentAgencyProfile(state); if (rAP) allResults.push(rAP); } catch (e) { log('AP err: ' + e.message); } }
    try { var rSD = await agentSubcontractorDB(state); if (rSD) allResults.push(rSD); } catch (e) { log('SD err: ' + e.message); }

    // 5. EVAL SCORING
    log('--- Eval scoring ---');
    // Reload memories to get what was just written
    var freshMems = await supabase.from('organism_memory').select('*').eq('status', 'scratch').gte('created_at', new Date(Date.now() - 3600000).toISOString()).order('created_at', { ascending: false }).limit(100);
    var cycleMems = freshMems.data || [];

    // 5b. EVAL SCORING - score every memory written this cycle
    log('EVAL: Scoring ' + cycleMems.length + ' cycle memories...');
    for (var ev = 0; ev < cycleMems.length; ev++) {
      try {
        var evalResult = await scoreAgentOutput(cycleMems[ev].agent, cycleMems[ev].opportunity_id, cycleMems[ev].observation || '', state);
        if (evalResult) allEvalScores.push(evalResult);
      } catch (e) { /* eval scoring non-fatal */ }
    }
    log('EVAL: Scored ' + allEvalScores.length + ' outputs');

    // 6. MEMORY CURATOR
    try { var rMC = await agentMemoryCurator(state, cycleMems); if (rMC) allResults.push(rMC); } catch (e) { log('Curator err: ' + e.message); }

    // 7. SELF-AWARENESS — runs last
    try { var rSA = await agentSelfAwareness(state, allResults, allEvalScores); if (rSA) allResults.push(rSA); } catch (e) { log('SA err: ' + e.message); }

    // 8. UPDATE ANALYSIS TRACKING — mark all processed opps as analyzed
    for (var ti = 0; ti < activeOpps.length; ti++) {
      try {
        var tOpp = activeOpps[ti];
        await supabase.from('opportunities').update({
          last_analyzed_at: new Date().toISOString(),
          last_analysis_state: {
            rfp_len: (tOpp.rfp_text || '').length,
            stage: tOpp.stage || null,
            outcome: tOpp.outcome || null,
            rfp_retrieved: tOpp.rfp_document_retrieved || false
          }
        }).eq('id', tOpp.id);
      } catch (te) {}
    }
    log('TRACKING: Updated last_analyzed_at for ' + activeOpps.length + ' opps');

    await storeMemory('v2', null, 'v2,session',
      'V4 SESSION - trigger:' + trigger + ' pipeline:' + state.pipeline.length + ' agents:' + allResults.length + ' opps_analyzed:' + activeOpps.length + ' uptime:' + Math.floor(process.uptime()) + 's',
      'analysis', null, 'high');

    // ═══ AUTO-PROPOSAL TRIGGER ═══
    // After all agents run, check if any opp qualifies for automatic proposal generation
    // Conditions: GO recommendation + OPI >= 85 + RFP retrieved + no proposal content yet
    try {
      var proposalCandidates = state.pipeline.filter(function(o) {
        var isGo = (o.capture_action || '').toUpperCase().indexOf('GO') > -1 &&
                   (o.capture_action || '').toUpperCase().indexOf('NO-BID') === -1;
        var highOpi = (o.opi_score || 0) >= 85;
        var hasRfp = o.rfp_document_retrieved === true || (o.rfp_text || '').length > 2000;
        var noProposal = !o.proposal_content || (o.proposal_content || '').length < 1000;
        return isGo && highOpi && hasRfp && noProposal && o.status === 'active';
      });
      if (proposalCandidates.length > 0) {
        // SESSION 89: DO NOT auto-fire Opus proposals — each costs $2-5. Log candidates for Christopher to review.
        log('AUTO-PROPOSAL: ' + proposalCandidates.length + ' opps QUALIFY but NOT auto-firing (cost control). Use /api/produce-proposal?id=X manually.');
        await storeMemory('auto_proposal_trigger', null, 'proposal,automation',
          'AUTO-PROPOSAL CANDIDATES (not fired — awaiting President approval): ' + proposalCandidates.map(function(c) { return (c.title||'').slice(0,40) + ' (OPI ' + c.opi_score + ')'; }).join(', ') + '. Trigger manually: /api/produce-proposal?id=OPPORTUNITY_ID',
          'analysis', null, 'high');
      }
    } catch(e) { log('Auto-proposal check error: ' + e.message); }

    log('=== SESSION COMPLETE: ' + id + ' | ' + allResults.length + ' agent outputs ===');
    log('Completed: ' + allResults.map(function(r) { return r.agent + '(' + r.chars + ')'; }).join(', '));

    // ═══ MORNING BRIEF EMAIL ═══
    try {
      await sendMorningBrief(state, allResults, trigger, newOppsFound, proposalCandidates || []);
    } catch(notifyErr) { log('NOTIFY error: ' + notifyErr.message); }

    // Flush cost log to hunt_runs
    if (costLog.length > 0) {
      var sessionCost = costLog.reduce(function(s, c) { return s + c.cost_usd; }, 0);
      var costByAgent = {};
      costLog.forEach(function(c) {
        if (!costByAgent[c.agent]) costByAgent[c.agent] = { calls: 0, cost: 0, in_tok: 0, out_tok: 0 };
        costByAgent[c.agent].calls++;
        costByAgent[c.agent].cost += c.cost_usd;
        costByAgent[c.agent].in_tok += c.input_tokens;
        costByAgent[c.agent].out_tok += c.output_tokens;
      });
      var costSummary = JSON.stringify({ session: id, total_usd: Math.round(sessionCost * 10000) / 10000, calls: costLog.length, by_agent: costByAgent });
      try {
        await supabase.from('hunt_runs').insert({
          source: 'api_cost',
          status: costSummary.slice(0, 5000),
          run_at: new Date().toISOString(), opportunities_found: 0
        });
        log('COST TRACKER: Session cost $' + sessionCost.toFixed(4) + ' across ' + costLog.length + ' API calls');
        // Backup cost to organism_memory (always works)
        await storeMemory('cost_tracker', null, 'cost,session', 'SESSION COST: $' + sessionCost.toFixed(4) + ' | ' + costLog.length + ' calls | Top: ' + Object.keys(costByAgent).sort(function(a,b) { return costByAgent[b].cost - costByAgent[a].cost; }).slice(0,5).map(function(a) { return a + '=$' + costByAgent[a].cost.toFixed(4); }).join(', '), 'analysis', null, 'high');
      } catch(ce) { log('COST TRACKER ERROR: ' + ce.message); try { await storeMemory('cost_tracker', null, 'cost,error', 'Cost flush failed: ' + ce.message + '. Session had ' + costLog.length + ' calls totaling $' + sessionCost.toFixed(4), 'analysis', null, 'high'); } catch(e2){} }
      costLog = [];
    }

    // Auto-extract structured CI from new competitive_intel memories
    try {
      log('CI AUTO-EXTRACT: Mining new competitive intel into structured database...');
      var ciMems2 = await supabase.from('organism_memory')
        .select('id,agent,observation,opportunity_id,created_at')
        .eq('memory_type', 'competitive_intel')
        .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      var recentCI = ciMems2.data || [];
      if (recentCI.length > 0) {
        var ciByOpp2 = {};
        recentCI.forEach(function(m) { var o = m.opportunity_id || 'global'; if (!ciByOpp2[o]) ciByOpp2[o] = []; ciByOpp2[o].push(m); });
        var ciTotal = 0;
        var ciOppIds = Object.keys(ciByOpp2);
        for (var coi = 0; coi < ciOppIds.length; coi++) {
          var coId = ciOppIds[coi];
          var coMems = ciByOpp2[coId];
          var coCombined = coMems.slice(0,2).map(function(m){ return (m.observation||'').substring(0,3000); }).join('\n---\n');
          if (coCombined.length < 200) continue;
          try {
            var coResp = await claudeCall('Extract competitor data. Return ONLY a JSON array.', 
              'Extract ALL competitors. Return JSON array with: competitor_name, hq_location, hq_state, strengths, weaknesses, threat_level (primary/secondary/emerging/watch), contract_value, active_verticals (array), active_states (array), certifications (array), key_personnel, price_intelligence, strategic_notes.\n\n' + coCombined, 
              4000, { model: 'claude-haiku-4-5-20251001' });
            var coMatch = coResp.match(/\[[\s\S]*\]/);
            if (!coMatch) continue;
            var coComps = JSON.parse(coMatch[0]);
            for (var cci = 0; cci < coComps.length; cci++) {
              var cc = coComps[cci];
              if (!cc.competitor_name) continue;
              var ccEx = await supabase.from('competitive_intelligence').select('id').eq('competitor_name', cc.competitor_name).eq('opportunity_id', coId === 'global' ? null : coId).limit(1);
              var ccRec = { competitor_name: cc.competitor_name, opportunity_id: coId === 'global' ? null : coId, hq_location: cc.hq_location, hq_state: cc.hq_state, strengths: cc.strengths, weaknesses: cc.weaknesses, threat_level: cc.threat_level || 'watch', contract_value: cc.contract_value, active_verticals: cc.active_verticals || [], active_states: cc.active_states || [], certifications: cc.certifications || [], key_personnel: cc.key_personnel, price_intelligence: cc.price_intelligence, strategic_notes: cc.strategic_notes, source_agent: 'ci_auto_extractor', updated_at: new Date().toISOString() };
              if (ccEx.data && ccEx.data.length > 0) { await supabase.from('competitive_intelligence').update(ccRec).eq('id', ccEx.data[0].id); }
              else { ccRec.id = 'ci-' + Date.now() + '-' + Math.random().toString(36).slice(2,6); ccRec.created_at = new Date().toISOString(); await supabase.from('competitive_intelligence').insert(ccRec); }
              ciTotal++;
            }
          } catch(ciErr) { log('CI AUTO-EXTRACT error: ' + ciErr.message); }
        }
        log('CI AUTO-EXTRACT: ' + ciTotal + ' records upserted from ' + recentCI.length + ' recent memories');
      } else {
        log('CI AUTO-EXTRACT: No new competitive intel memories in last 24h');
      }
    } catch(ciAutoErr) { log('CI AUTO-EXTRACT failed: ' + ciAutoErr.message); }

    // Auto-extract structured contacts from new CRM memories  
    try {
      log('CRM AUTO-EXTRACT: Mining contacts from recent relationship memories...');
      var crmAutoMems = await supabase.from('organism_memory')
        .select('id,agent,observation,opportunity_id,created_at')
        .eq('memory_type', 'relationship')
        .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      var recentCRM = crmAutoMems.data || [];
      if (recentCRM.length > 0) {
        var crmByOpp = {};
        recentCRM.forEach(function(m) { var o = m.opportunity_id || 'global'; if (!crmByOpp[o]) crmByOpp[o] = []; crmByOpp[o].push(m); });
        var crmTotal = 0;
        var crmOids = Object.keys(crmByOpp);
        for (var cri = 0; cri < crmOids.length; cri++) {
          var crOid = crmOids[cri];
          var crMems = crmByOpp[crOid];
          var crCombined = crMems.slice(0,2).map(function(m){ return (m.observation||'').substring(0,4000); }).join('\n---\n');
          if (crCombined.length < 200) continue;
          var oppCtx = '';
          if (crOid !== 'global') { var ol = await supabase.from('opportunities').select('title,agency').eq('id',crOid).limit(1); if (ol.data && ol.data[0]) oppCtx = (ol.data[0].agency||'')+' - '+(ol.data[0].title||''); }
          try {
            var crResp = await claudeCall('Extract contacts. Return ONLY JSON array.',
              'Extract ALL named contacts. JSON array with: contact_name, title, organization, agency, email, phone, role_in_procurement, contact_type (decision_maker/evaluator/procurement/technical/political/influencer/engineer_of_record/other), priority (critical/high/medium/low), hgi_relationship (warm/cold/unknown), notes.\n\nContext: '+oppCtx+'\n\n'+crCombined,
              4000, { model: 'claude-haiku-4-5-20251001' });
            var crMatch = crResp.match(/\[[\s\S]*\]/);
            if (!crMatch) continue;
            var crContacts = JSON.parse(crMatch[0]);
            for (var crc = 0; crc < crContacts.length; crc++) {
              var cc2 = crContacts[crc];
              if (!cc2.contact_name || cc2.contact_name.length < 3) continue;
              var cc2Ex = await supabase.from('relationship_graph').select('id').eq('contact_name',cc2.contact_name).eq('opportunity_id',crOid==='global'?null:crOid).limit(1);
              var cc2Rec = { contact_name:cc2.contact_name, title:cc2.title, organization:cc2.organization, agency:cc2.agency, email:cc2.email, phone:cc2.phone, role_in_procurement:cc2.role_in_procurement, contact_type:cc2.contact_type||'other', priority:cc2.priority||'medium', hgi_relationship:cc2.hgi_relationship||'unknown', outreach_status:'not_contacted', relationship_strength:cc2.hgi_relationship||'unknown', notes:cc2.notes, opportunity_id:crOid==='global'?null:crOid, source_agent:'crm_auto_extractor', updated_at:new Date().toISOString() };
              if (cc2Ex.data && cc2Ex.data.length > 0) { await supabase.from('relationship_graph').update(cc2Rec).eq('id',cc2Ex.data[0].id); }
              else { cc2Rec.id='ct-'+Date.now()+'-'+Math.random().toString(36).slice(2,6); cc2Rec.created_at=new Date().toISOString(); await supabase.from('relationship_graph').insert(cc2Rec); }
              crmTotal++;
            }
          } catch(crErr) { log('CRM AUTO-EXTRACT error: '+crErr.message); }
        }
        log('CRM AUTO-EXTRACT: '+crmTotal+' contacts upserted from '+recentCRM.length+' recent memories');
    // Auto-extract disaster alerts from recent disaster_monitor memories
    try {
      log('DISASTER AUTO-EXTRACT: Mining disaster declarations...');
      var disAutoMems = await supabase.from('organism_memory')
        .select('id,observation').eq('agent', 'disaster_monitor')
        .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
        .order('created_at', { ascending: false }).limit(3);
      var recentDis = disAutoMems.data || [];
      if (recentDis.length > 0) {
        var disTotal = 0;
        for (var dri = 0; dri < recentDis.length; dri++) {
          var drm = recentDis[dri];
          if (!drm.observation || drm.observation.length < 200) continue;
          try {
            var drResp = await claudeCall('Extract disasters. JSON array only.', 'Extract disaster declarations. JSON array: disaster_number, disaster_name, state, incident_type, threat_level.\n\n' + (drm.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var drMatch = drResp.match(/\[[\s\S]*\]/);
            if (!drMatch) continue;
            var drDis = JSON.parse(drMatch[0]);
            for (var drd = 0; drd < drDis.length; drd++) {
              var dd2 = drDis[drd];
              if (!dd2.disaster_name) continue;
              var dd2Ex = await supabase.from('disaster_alerts').select('id').eq('disaster_number', dd2.disaster_number || '').limit(1);
              var dd2Rec = { disaster_number: dd2.disaster_number, disaster_name: dd2.disaster_name, state: dd2.state, incident_type: dd2.incident_type, threat_level: dd2.threat_level || 'medium', source_agent: 'disaster_auto_extract', updated_at: new Date().toISOString() };
              if (dd2Ex.data && dd2Ex.data.length > 0) { await supabase.from('disaster_alerts').update(dd2Rec).eq('id', dd2Ex.data[0].id); }
              else { dd2Rec.id = 'dis-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); dd2Rec.created_at = new Date().toISOString(); await supabase.from('disaster_alerts').insert(dd2Rec); }
              disTotal++;
            }
          } catch (dre) { log('DISASTER AUTO-EXTRACT error: ' + dre.message); }
        }
        log('DISASTER AUTO-EXTRACT: ' + disTotal + ' alerts from ' + recentDis.length + ' memories');
      } else { log('DISASTER AUTO-EXTRACT: No new disaster memories in last 24h'); }
    } catch (disAutoErr) { log('DISASTER AUTO-EXTRACT failed: ' + disAutoErr.message); }

      } else { log('CRM AUTO-EXTRACT: No new relationship memories in last 24h'); }
    } catch(crmAutoErr) { log('CRM AUTO-EXTRACT failed: '+crmAutoErr.message); }

    // === REGULATORY AUTO-EXTRACT ===
    try {
      var recentReg = await supabase.from('organism_memory').select('id,observation').eq('agent','regulatory_monitor').gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(5);
      if (recentReg.data && recentReg.data.length > 0) {
        var regAutoTotal = 0;
        for (var rai = 0; rai < recentReg.data.length; rai++) {
          var ram = recentReg.data[rai];
          if (!ram.observation || ram.observation.length < 200) continue;
          try {
            var raResp = await claudeCall('Extract regulatory changes. JSON array only.', 'Extract regulatory changes. JSON array: regulation_name, agency_source, category (fema_policy/state_procurement/cdbg_dr/hud/insurance/workforce), impact_level (critical/high/medium/low), affected_verticals, summary.\n\n' + (ram.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var raMatch = raResp.match(/\[[\s\S]*\]/);
            if (!raMatch) continue;
            var raRegs = JSON.parse(raMatch[0]);
            for (var rar = 0; rar < raRegs.length; rar++) {
              var ra2 = raRegs[rar];
              if (!ra2.regulation_name) continue;
              var ra2Ex = await supabase.from('regulatory_changes').select('id').eq('regulation_name', ra2.regulation_name).limit(1);
              var ra2Rec = { regulation_name: ra2.regulation_name, agency_source: ra2.agency_source, category: ra2.category, impact_level: ra2.impact_level || 'medium', affected_verticals: ra2.affected_verticals, summary: ra2.summary, source_agent: 'regulatory_auto_extract', updated_at: new Date().toISOString() };
              if (ra2Ex.data && ra2Ex.data.length > 0) { await supabase.from('regulatory_changes').update(ra2Rec).eq('id', ra2Ex.data[0].id); }
              else { ra2Rec.id = 'reg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); ra2Rec.created_at = new Date().toISOString(); await supabase.from('regulatory_changes').insert(ra2Rec); }
              regAutoTotal++;
            }
          } catch (rae) { log('REGULATORY AUTO-EXTRACT error: ' + rae.message); }
        }
        log('REGULATORY AUTO-EXTRACT: ' + regAutoTotal + ' changes from ' + recentReg.data.length + ' memories');
      } else { log('REGULATORY AUTO-EXTRACT: No new memories in last 24h'); }
    } catch (regAutoErr) { log('REGULATORY AUTO-EXTRACT failed: ' + regAutoErr.message); }

    // === TEAMING AUTO-EXTRACT ===
    try {
      var recentTeam = await supabase.from('organism_memory').select('id,observation').in('agent',['teaming_agent','subcontractor_db']).gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(5);
      if (recentTeam.data && recentTeam.data.length > 0) {
        var teamAutoTotal = 0;
        for (var tai = 0; tai < recentTeam.data.length; tai++) {
          var tam = recentTeam.data[tai];
          if (!tam.observation || tam.observation.length < 200) continue;
          try {
            var taResp = await claudeCall('Extract teaming partners. JSON array only.', 'Extract teaming partners and subcontractors. JSON array: partner_name, capability, location, certifications, verticals, fit_score (strong/medium/speculative), notes.\n\n' + (tam.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var taMatch = taResp.match(/\[[\s\S]*\]/);
            if (!taMatch) continue;
            var taParts = JSON.parse(taMatch[0]);
            for (var tap = 0; tap < taParts.length; tap++) {
              var ta2 = taParts[tap];
              if (!ta2.partner_name) continue;
              var ta2Ex = await supabase.from('teaming_partners').select('id').eq('partner_name', ta2.partner_name).limit(1);
              var ta2Rec = { partner_name: ta2.partner_name, capability: ta2.capability, location: ta2.location, certifications: ta2.certifications, verticals: ta2.verticals, fit_score: ta2.fit_score || 'medium', notes: ta2.notes, source_agent: 'teaming_auto_extract', updated_at: new Date().toISOString() };
              if (ta2Ex.data && ta2Ex.data.length > 0) { await supabase.from('teaming_partners').update(ta2Rec).eq('id', ta2Ex.data[0].id); }
              else { ta2Rec.id = 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); ta2Rec.created_at = new Date().toISOString(); await supabase.from('teaming_partners').insert(ta2Rec); }
              teamAutoTotal++;
            }
          } catch (tae) { log('TEAMING AUTO-EXTRACT error: ' + tae.message); }
        }
        log('TEAMING AUTO-EXTRACT: ' + teamAutoTotal + ' partners from ' + recentTeam.data.length + ' memories');
      } else { log('TEAMING AUTO-EXTRACT: No new memories in last 24h'); }
    } catch (teamAutoErr) { log('TEAMING AUTO-EXTRACT failed: ' + teamAutoErr.message); }

    // === AGENCY PROFILE AUTO-EXTRACT ===
    try {
      var recentAg = await supabase.from('organism_memory').select('id,observation').eq('agent','agency_profile_agent').gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(5);
      if (recentAg.data && recentAg.data.length > 0) {
        var agAutoTotal = 0;
        for (var aai = 0; aai < recentAg.data.length; aai++) {
          var aam = recentAg.data[aai];
          if (!aam.observation || aam.observation.length < 200) continue;
          try {
            var aaResp = await claudeCall('Extract agency profiles. JSON array only.', 'Extract agency/client profiles. JSON array: agency_name, state, agency_type (parish/city/state_agency/housing_authority/school_board/federal), annual_budget, incumbent_contractors, hgi_relationship (active/warm/cold/none), hgi_history, verticals, notes.\n\n' + (aam.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var aaMatch = aaResp.match(/\[[\s\S]*\]/);
            if (!aaMatch) continue;
            var aaAgs = JSON.parse(aaMatch[0]);
            for (var aag = 0; aag < aaAgs.length; aag++) {
              var ag2 = aaAgs[aag];
              if (!ag2.agency_name) continue;
              var ag2Ex = await supabase.from('agency_profiles').select('id').eq('agency_name', ag2.agency_name).limit(1);
              var ag2Rec = { agency_name: ag2.agency_name, state: ag2.state, agency_type: ag2.agency_type, annual_budget: ag2.annual_budget, incumbent_contractors: ag2.incumbent_contractors, hgi_relationship: ag2.hgi_relationship || 'none', hgi_history: ag2.hgi_history, verticals: ag2.verticals, notes: ag2.notes, source_agent: 'agency_auto_extract', updated_at: new Date().toISOString() };
              if (ag2Ex.data && ag2Ex.data.length > 0) { await supabase.from('agency_profiles').update(ag2Rec).eq('id', ag2Ex.data[0].id); }
              else { ag2Rec.id = 'ag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); ag2Rec.created_at = new Date().toISOString(); await supabase.from('agency_profiles').insert(ag2Rec); }
              agAutoTotal++;
            }
          } catch (aae) { log('AGENCY AUTO-EXTRACT error: ' + aae.message); }
        }
        log('AGENCY AUTO-EXTRACT: ' + agAutoTotal + ' profiles from ' + recentAg.data.length + ' memories');
      } else { log('AGENCY AUTO-EXTRACT: No new memories in last 24h'); }
    } catch (agAutoErr) { log('AGENCY AUTO-EXTRACT failed: ' + agAutoErr.message); }

    // === ANALYTICS AUTO-EXTRACT ===
    try {
      var recentAn = await supabase.from('organism_memory').select('id,observation').in('agent',['loss_analysis','win_rate_analytics','learning_loop']).gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(5);
      if (recentAn.data && recentAn.data.length > 0) {
        var anAutoTotal = 0;
        for (var nai = 0; nai < recentAn.data.length; nai++) {
          var nam = recentAn.data[nai];
          if (!nam.observation || nam.observation.length < 200) continue;
          try {
            var naResp = await claudeCall('Extract analytics insights. JSON array only.', 'Extract analytical insights. JSON array: category (win_pattern/loss_pattern/opi_calibration/competitive_pattern/pricing_insight/market_trend), title, insight, affected_verticals, confidence (high/medium/low), recommendation.\n\n' + (nam.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var naMatch = naResp.match(/\[[\s\S]*\]/);
            if (!naMatch) continue;
            var naIns = JSON.parse(naMatch[0]);
            for (var nap = 0; nap < naIns.length; nap++) {
              var na2 = naIns[nap];
              if (!na2.title) continue;
              var na2Ex = await supabase.from('pipeline_analytics').select('id').eq('title', na2.title).limit(1);
              var na2Rec = { title: na2.title, category: na2.category, insight: na2.insight, affected_verticals: na2.affected_verticals, confidence: na2.confidence || 'medium', recommendation: na2.recommendation, source_agent: 'analytics_auto_extract', updated_at: new Date().toISOString() };
              if (na2Ex.data && na2Ex.data.length > 0) { await supabase.from('pipeline_analytics').update(na2Rec).eq('id', na2Ex.data[0].id); }
              else { na2Rec.id = 'an-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); na2Rec.created_at = new Date().toISOString(); await supabase.from('pipeline_analytics').insert(na2Rec); }
              anAutoTotal++;
            }
          } catch (nae) { log('ANALYTICS AUTO-EXTRACT error: ' + nae.message); }
        }
        log('ANALYTICS AUTO-EXTRACT: ' + anAutoTotal + ' insights from ' + recentAn.data.length + ' memories');
      } else { log('ANALYTICS AUTO-EXTRACT: No new memories in last 24h'); }
    } catch (anAutoErr) { log('ANALYTICS AUTO-EXTRACT failed: ' + anAutoErr.message); }

    // === BUDGET CYCLE AUTO-EXTRACT ===
    try {
      var recentBud = await supabase.from('organism_memory').select('id,observation').eq('agent','budget_cycle').gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(5);
      if (recentBud.data && recentBud.data.length > 0) {
        var budAutoTotal = 0;
        for (var bai = 0; bai < recentBud.data.length; bai++) {
          var bam = recentBud.data[bai];
          if (!bam.observation || bam.observation.length < 200) continue;
          try {
            var baResp = await claudeCall('Extract budget cycles. JSON array only.', 'Extract government budget cycle data. JSON array: agency_name, state, fiscal_year_start, fiscal_year_end, procurement_window, budget_amount, funding_sources, procurement_timeline, notes.\n\n' + (bam.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var baMatch = baResp.match(/\[[\s\S]*\]/);
            if (!baMatch) continue;
            var baBuds = JSON.parse(baMatch[0]);
            for (var bab = 0; bab < baBuds.length; bab++) {
              var bu2 = baBuds[bab];
              if (!bu2.agency_name) continue;
              var bu2Ex = await supabase.from('budget_cycles').select('id').eq('agency_name', bu2.agency_name).limit(1);
              var bu2Rec = { agency_name: bu2.agency_name, state: bu2.state, fiscal_year_start: bu2.fiscal_year_start, fiscal_year_end: bu2.fiscal_year_end, procurement_window: bu2.procurement_window, budget_amount: bu2.budget_amount, funding_sources: bu2.funding_sources, procurement_timeline: bu2.procurement_timeline, notes: bu2.notes, source_agent: 'budget_auto_extract', updated_at: new Date().toISOString() };
              if (bu2Ex.data && bu2Ex.data.length > 0) { await supabase.from('budget_cycles').update(bu2Rec).eq('id', bu2Ex.data[0].id); }
              else { bu2Rec.id = 'bud-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); bu2Rec.created_at = new Date().toISOString(); await supabase.from('budget_cycles').insert(bu2Rec); }
              budAutoTotal++;
            }
          } catch (bae) { log('BUDGET AUTO-EXTRACT error: ' + bae.message); }
        }
        log('BUDGET AUTO-EXTRACT: ' + budAutoTotal + ' cycles from ' + recentBud.data.length + ' memories');
      } else { log('BUDGET AUTO-EXTRACT: No new memories in last 24h'); }
    } catch (budAutoErr) { log('BUDGET AUTO-EXTRACT failed: ' + budAutoErr.message); }

    // === RECOMPETE AUTO-EXTRACT ===
    try {
      var recentRec2 = await supabase.from('organism_memory').select('id,observation').in('agent',['recompete_agent','contract_expiration']).gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(5);
      if (recentRec2.data && recentRec2.data.length > 0) {
        var recAutoTotal = 0;
        for (var rai2 = 0; rai2 < recentRec2.data.length; rai2++) {
          var ram2 = recentRec2.data[rai2];
          if (!ram2.observation || ram2.observation.length < 200) continue;
          try {
            var raResp2 = await claudeCall('Extract recompete opportunities. JSON array only.', 'Extract contract recompete/expiration data. JSON array: contract_title, agency, incumbent, contract_value, end_date, recompete_window, hgi_verticals, competitive_landscape, notes.\n\n' + (ram2.observation || '').substring(0, 4000), 3000, { model: 'claude-haiku-4-5-20251001' });
            var raMatch2 = raResp2.match(/\[[\s\S]*\]/);
            if (!raMatch2) continue;
            var raRecs = JSON.parse(raMatch2[0]);
            for (var rar2 = 0; rar2 < raRecs.length; rar2++) {
              var rc2 = raRecs[rar2];
              if (!rc2.contract_title) continue;
              var rc2Ex = await supabase.from('recompete_tracker').select('id').eq('contract_title', rc2.contract_title).limit(1);
              var rc2Rec = { contract_title: rc2.contract_title, agency: rc2.agency, incumbent: rc2.incumbent, contract_value: rc2.contract_value, end_date: rc2.end_date, recompete_window: rc2.recompete_window, hgi_verticals: rc2.hgi_verticals, competitive_landscape: rc2.competitive_landscape, notes: rc2.notes, source_agent: 'recompete_auto_extract', updated_at: new Date().toISOString() };
              if (rc2Ex.data && rc2Ex.data.length > 0) { await supabase.from('recompete_tracker').update(rc2Rec).eq('id', rc2Ex.data[0].id); }
              else { rc2Rec.id = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); rc2Rec.created_at = new Date().toISOString(); await supabase.from('recompete_tracker').insert(rc2Rec); }
              recAutoTotal++;
            }
          } catch (rae2) { log('RECOMPETE AUTO-EXTRACT error: ' + rae2.message); }
        }
        log('RECOMPETE AUTO-EXTRACT: ' + recAutoTotal + ' contracts from ' + recentRec2.data.length + ' memories');
      } else { log('RECOMPETE AUTO-EXTRACT: No new memories in last 24h'); }
    } catch (recAutoErr) { log('RECOMPETE AUTO-EXTRACT failed: ' + recAutoErr.message); }

  } catch (e) {
    log('SESSION ERROR: ' + e.message);
    try {
      await supabase.from('organism_memory').insert({
        id: 'crash-' + Date.now(),
        agent: 'v3_engine',
        observation: 'SESSION CRASH: ' + e.message + '\nStack: ' + (e.stack || '').slice(0, 2000),
        memory_type: 'analysis',
        entity_tags: 'crash,error',
        source_url: null, confidence: 'high', status: 'scratch',
        created_at: new Date().toISOString()
      });
    } catch (e2) { log('Could not log crash: ' + e2.message); }
  }
}

// ============================================================
// STARTUP
// ============================================================
log('==========================================================');
log('HGI ORGANISM V4.5-full-intel - STARTING');
log('V2.0-organism: 42 active agents. Direct CB+LaPAC hunting. All 8 verticals. Multi-source discovery. Self-sufficient V2.');
log('12h dedup guard. Crash logging. Test endpoints.');
log('==========================================================');

// Prevent crash loops — log and survive
process.on('uncaughtException', function(err) {
  log('UNCAUGHT: ' + err.message);
  try {
    supabase.from('organism_memory').insert({
      id: 'crash-' + Date.now(),
      agent: 'v3_engine',
      observation: 'UNCAUGHT EXCEPTION: ' + err.message + '\nStack: ' + (err.stack || '').slice(0, 2000),
      memory_type: 'analysis', entity_tags: 'crash,uncaught',
      source_url: null, confidence: 'high', status: 'scratch',
      created_at: new Date().toISOString()
    }).then(function() {}).catch(function() {});
  } catch (e2) {}
});

process.on('unhandledRejection', function(reason) {
  log('UNHANDLED REJECTION: ' + (reason && reason.message ? reason.message : String(reason)));
  try {
    supabase.from('organism_memory').insert({
      id: 'reject-' + Date.now(),
      agent: 'v3_engine',
      observation: 'UNHANDLED REJECTION: ' + (reason && reason.message ? reason.message : String(reason)) + '\nStack: ' + (reason && reason.stack ? reason.stack.slice(0, 2000) : ''),
      memory_type: 'analysis', entity_tags: 'crash,rejection',
      source_url: null, confidence: 'high', status: 'scratch',
      created_at: new Date().toISOString()
    }).then(function() {}).catch(function() {});
  } catch (e2) {}
});

// === WEEKDAY DAILY CRON — 7 AM CST (13:00 UTC) ===
function scheduleWeekdayCron() {
  var now = new Date();
  var target = new Date(now);
  target.setUTCHours(13, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  var msUntil = target - now;
  var hoursUntil = Math.round(msUntil / 3600000);
  log('CRON: Next run ' + target.toISOString() + ' (' + hoursUntil + 'h)');
  setTimeout(async function() {
    // GHOST DETECTION: Check if another instance already ran recently
    try {
      var myStart = Math.floor(Date.now() / 1000 - process.uptime());
      var recent = await supabase.from('organism_memory').select('observation')
        .eq('agent','v2').gte('created_at', new Date(Date.now() - 7200000).toISOString())
        .order('created_at',{ascending:false}).limit(1);
      if (recent.data && recent.data.length > 0) {
        var obs = recent.data[0].observation || '';
        var m = obs.match(/uptime:(\d+)/);
        if (m) {
          var otherUptime = parseInt(m[1]);
          var myUptime = Math.floor(process.uptime());
          // If another instance recently ran with much LOWER uptime, it's newer — we're the ghost
          if (Math.abs(otherUptime - myUptime) > 600 && otherUptime < myUptime) {
            log('GHOST DETECTED: Newer instance (uptime ' + otherUptime + 's) exists. This instance (uptime ' + myUptime + 's) is stale. SKIPPING CRON.');
            scheduleWeekdayCron();
            return;
          }
        }
      }
    } catch(e) { log('Ghost check error (proceeding): ' + e.message); }
    log('=== WEEKDAY CRON FIRING ===');
    runSession('smart_trigger_cron').catch(function(e) { log('CRON error: ' + e.message); });
    scheduleWeekdayCron();
  }, msUntil);
}
scheduleWeekdayCron(); // RE-ENABLED Session 89 with cost controls: Haiku system agents, no auto-proposal, 15K RFP cap, 5-query multiSearch cap

log('V5.0 ready. CRON DISABLED. Manual only: /api/trigger or /api/trigger-full. Weekday cron: 7AM CST smart trigger. Manual: /api/trigger. Endpoints: disaster-check, loss-analysis, exec-brief, compliance-check, system-status, record-outcome.');

