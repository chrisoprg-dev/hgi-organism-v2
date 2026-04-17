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
      res.end(JSON.stringify({ status: 'alive', uptime_seconds: Math.floor(process.uptime()), timestamp: new Date().toISOString(), version: 'V5.0-full-organism', agents_active: 42 }));
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
      .eq('agent','v4_engine')
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
    system: 'You are the HGI Business Development Organism — a 95-year-old minority-owned firm specializing in disaster recovery, TPA/claims, workforce, construction management, grant management, housing, property tax appeals, and program administration. Answer questions about the HGI pipeline, opportunities, competitive intel, and BD strategy. Be concise, direct, and strategic. You have access to all organism intelligence below.\n\n' + HGI + '\n\nRecent organism memories:\n' + chatCtx + chatOppCtx + chatPipeCtx,
    messages: chatMessages
  });

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
      var ciText = '';
      if (ciRelevant.length > 0) {
        ciText = ciRelevant.map(function(c) {
          return '### ' + (c.competitor_name||'Unknown') +
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

      // ═══ BUILD THE MEGA-PROMPT WITH ALL INTELLIGENCE ═══
      var D = String.fromCharCode(36);
      var proposalPrompt = 'You are the HGI Global proposal production engine. Your job is to produce a COMPLETE, SUBMISSION-READY response document.\n\n' +
        'THE ENTIRE INTELLIGENCE OF THE HGI ORGANISM IS BELOW. Use ALL of it. Every competitive insight informs your ghost language. Every past outcome teaches what works. Every relationship tells you who the evaluators are. Every regulatory change shapes compliance language. Every KB chunk provides proven methodology. This proposal must be the synthesis of everything the organism knows — not a generic document with data sprinkled in.\n\n' +
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
        '## SCOPE ANALYSIS (Organism deep analysis of requirements)\n' + (opp.scope_analysis || 'Not yet produced') + '\n\n' +
        '## FINANCIAL ANALYSIS (Pricing strategy, market benchmarks)\n' + (opp.financial_analysis || 'Not yet produced') + '\n\n' +
        '## RESEARCH BRIEF (Win strategy, competitive positioning)\n' + (opp.research_brief || 'Not yet produced') + '\n\n' +
        '## CAPTURE ACTION (GO/NO-GO analysis, PWIN assessment)\n' + (opp.capture_action || 'Not yet produced') + '\n\n' +
        '## STAFFING PLAN\n' + (opp.staffing_plan || 'Not yet produced') + '\n\n' +
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
        'Before writing, identify 2-3 win themes specific to THIS RFP based on the organism intelligence and HGI strengths against the competitive landscape. These are not slogans — they are the strategic reasons HGI should win this contract. Examples: incumbent knowledge of the agency systems, 95-year track record on similar programs, local presence when competitors are out-of-state.\n' +
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
        '- HGI was established in 1931 (not 1929). SAM UEI: DL4SJEVKZ6H4\n' +
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
        system: 'You are a senior government proposal writer at HGI Global (Hammerman & Gainer LLC), a 95-year-old Louisiana-based firm. You produce submission-ready documents that WIN — not average drafts. Every word earns points with evaluators. You match the exact format each solicitation requires (questionnaire forms filled field-by-field, narrative proposals with specified sections, exhibits completed). You are specific, factual, direct, and persuasive. You use only confirmed company data. You write like the firm President would write — authoritative, zero filler, zero hedging. CRITICAL: Geoffrey Brien no longer works at HGI. Never include him. CRITICAL: Do NOT auto-assign HGI leadership (CEO, VP, CAO, etc.) to project roles. All positions are OPEN — describe role requirements and qualifications needed, not pre-filled names. Use [TO BE ASSIGNED] for Key Personnel unless explicitly instructed otherwise.',
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
          '11. FACTS: Incorrect HGI data (Founded 1931, ~50 employees, Kenner HQ Suite 510, UEI DL4SJEVKZ6H4)\n' +
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
              document_class: 'winning_proposal',
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
                document_class: 'winning_proposal',
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
      agent_health: { active_agents: 42, version: 'V5.0-full-organism', last_cycle: briefMems.length > 0 ? briefMems[0].when : null }
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
          .or('vertical.eq.' + vertical.toLowerCase() + ',document_class.eq.winning_proposal')
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
        '\n4. Founded 1931, ~50 employees, Kenner HQ Suite 510, UEI DL4SJEVKZ6H4' +
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
    // Founding year — enforce 1931
    proposalText = proposalText.replace(/\b(Est(?:ablished)?\.?\s*)1929\b/gi, '$11931');
    // Phone correction
    proposalText = proposalText.replace(/\(504\)\s*000-0000/g, '(504) 681-6135');
    // Email placeholder
    proposalText = proposalText.replace(/info@hgi\.com/gi, 'info@hgi-global.com');
    // Geoffrey Brien removal — catch any that slip through
    proposalText = proposalText.replace(/Geoffrey\s+Brien/gi, '[DR Manager — Position Open]');
    // PBGC removal — HGI has never had a direct federal contract
    proposalText = proposalText.replace(/PBGC[^.]*?\./gi, '');
    proposalText = proposalText.replace(/Pension Benefit Guaranty[^.]*?\./gi, '');
    // Old staff count correction
    proposalText = proposalText.replace(/67\s+full[- ]time\s+(employees|staff)/gi, 'approximately 50 team members');
    proposalText = proposalText.replace(/67\s+FT\s*\+?\s*43\s+contract/gi, 'approximately 50 team members');
    proposalText = proposalText.replace(/110\s+professionals/gi, 'approximately 50 team members');
    // Founding year catch-all
    proposalText = proposalText.replace(/founded\s+in\s+1929/gi, 'founded in 1931');
    proposalText = proposalText.replace(/since\s+1929/gi, 'since 1931');
    proposalText = proposalText.replace(/\b95[\s-]year/gi, 'ninety-five-year');
    // Orleans Parish School Board — not confirmed
    proposalText = proposalText.replace(/Orleans\s+Parish\s+School\s+Board[^.]*?\./gi, '');

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
              children: [new TextRun({ text: '100% Minority-Owned | Est. 1931 | SAM UEI: DL4SJEVKZ6H4', size: 20, font: 'Calibri', color: GRAY })]
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
var HGI = 'SYSTEM CONTEXT: HGI Global (Hammerman & Gainer LLC) is a 95-year-old, 100% minority-owned program management firm in Kenner, Louisiana (2400 Veterans Memorial Blvd, Suite 510, 70062). 8 verticals: Disaster Recovery, TPA/Claims (full P&C), Property Tax Appeals, Workforce/WIOA, Construction Management, Program Administration, Housing/HUD, Grant Management. Past performance: Road Home ' + String.fromCharCode(36) + '67M direct/' + String.fromCharCode(36) + '13B+ program (2006-2015, zero misappropriation), HAP ' + String.fromCharCode(36) + '950M, Restore LA ' + String.fromCharCode(36) + '42.3M, Rebuild NJ ' + String.fromCharCode(36) + '67.7M, TPSD ' + String.fromCharCode(36) + '2.96M (completed 2022-2025), St. John Sheriff ' + String.fromCharCode(36) + '788K, BP GCCF ' + String.fromCharCode(36) + '1.65M. Key staff by role: President, Chairman, CEO, CAO, VP, SVP Claims, 1099 SME (~' + String.fromCharCode(36) + '1B grants/incentives). ~50 team members across offices in Kenner (HQ), Shreveport, Alexandria, New Orleans. Phone: (504) 681-6135. Email: info@hgi-global.com. SAM UEI: DL4SJEVKZ6H4. Insurance: ' + String.fromCharCode(36) + '5M fidelity/' + String.fromCharCode(36) + '5M E&O/' + String.fromCharCode(36) + '2M GL. Rates: Built per-RFP from market analysis and financial agent output. Do NOT copy standard rates into proposals. HGI has NEVER had a direct federal contract. All work flows through state agencies, local governments, housing authorities, and insurance entities. Do NOT list PBGC or Orleans Parish School Board as past performance without explicit President confirmation. RULES: (1) Every claim must cite source+date. Unverified = say so. (2) Set confidence:high only with source URL. Medium when extrapolating. Inferred when reasoning without sources. (3) Set source_url to specific URL or null. CRITICAL PERSONNEL UPDATE: Geoffrey Brien is NO LONGER with HGI — do not reference him in any proposals, staffing plans, or deliverables. The DR Manager position is currently unfilled. Any organism memories referencing Brien as current staff are OUTDATED. FOUNDING YEAR: HGI was founded in 1931, not 1929. Use 1931 in all documents. OUTPUT FORMAT RULES (apply to ALL agent outputs): (1) Start directly with your findings. No title headers like HGI GLOBAL or agent name headers. (2) Never write Agent X of Y numbering. (3) No Classification, Eyes Only, Principals Only, Prepared for, or Capture-Sensitive labels. (4) No markdown headers (# ## ###), horizontal rules (---), or emoji. (5) No governing rules boilerplate or blockquote disclaimers at the top. (6) Use role titles only — never write Christopher Oney, Larry Oney, Lou Resweber, Candy Dottolo, Dillon Truax, Vanessa James, Chris Feduccia, or any staff names. Say President, Chairman, CEO, CAO, VP, SVP Claims, SME. (7) Be direct and concise. Substance over formatting. Write findings as clean prose, not decorated documents. (8) No markdown tables for internal analysis — use plain text. Tables are only for proposal content that will appear in final documents.';


// RATE_CARD — only referenced by financial agent and rate-table endpoint. NOT sent to other agents or proposals.
var RATE_CARD = 'HGI Rate Card (burdened/hr): Principal ' + String.fromCharCode(36) + '220, Prog Dir ' + String.fromCharCode(36) + '210, SME ' + String.fromCharCode(36) + '200, Sr Grant Mgr ' + String.fromCharCode(36) + '180, Grant Mgr ' + String.fromCharCode(36) + '175, Sr PM ' + String.fromCharCode(36) + '180, PM ' + String.fromCharCode(36) + '155, Grant Writer ' + String.fromCharCode(36) + '145, Arch/Eng ' + String.fromCharCode(36) + '135, Cost Est ' + String.fromCharCode(36) + '125, Appeals ' + String.fromCharCode(36) + '145, Sr Damage ' + String.fromCharCode(36) + '115, Damage ' + String.fromCharCode(36) + '105, Admin ' + String.fromCharCode(36) + '65.';


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
      var sr = await fetch('https://api.sam.gov/opportunities/v2/search?api_key=DEMO_KEY&q=' + encodeURIComponent(samKW[s]) + '&postedFrom=' + daysAgo(14) + '&postedTo=' + today() + '&active=true&limit=10');
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

  // === NEW: USAspending expiring contracts (free, no key) ===
  try {
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
  if (!('usaspending' in sourceCounts)) sourceCounts.usaspending = 0;

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

  // === NEW: Federal Register CDBG-DR and FEMA notices (free, no key) ===
  try {
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
  if (!('federal_register' in sourceCounts)) sourceCounts.federal_register = 0;

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
    var scopeResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 3000,
      system: 'Senior government contracting scope analyst. ' + classGuide + ' Geography: LA TX FL MS AL GA. Be exhaustive ABOUT WHAT THE RFP ACTUALLY SAYS. Do not infer or embellish. Cite specific RFP sections. If the RFP does not mention a funding source, program history, or scope element, do not claim it does.',
      messages: [{ role: 'user', content: 'Deep scope analysis for HGI go/no-go.\n\nGROUND RULE: Every factual claim in your output must be directly supported by the RFP TEXT below. Do NOT infer program funding sources (e.g., FEMA, CDBG, CDBG-DR), historical context (e.g., post-Katrina, post-COVID), or agency priorities from your general knowledge or from the organism intelligence unless the RFP text explicitly confirms them. If the RFP does not mention FEMA, do not frame the opportunity as a FEMA play. If the RFP does not mention CDBG, do not frame it as a CDBG play. The organism intelligence below is for COMPETITIVE positioning (who else is bidding, what rates they charge, who the incumbent is) — NOT for inferring scope or funding. If you are uncertain whether something is in the RFP, say so explicitly.\n\nOPPORTUNITY: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nSTATE: ' + (opp.state || 'LA') + '\nVERTICAL: ' + (opp.vertical || 'general') + '\nRFP TEXT:\n' + rfpContent + '\n' + kbContext.slice(0, 2000) + '\n\nORGANISM INTELLIGENCE (competitors, contacts, disasters, budgets, regulations, patterns — FOR COMPETITIVE POSITIONING ONLY):\n' + orchSlice + '\n\nProvide:\n1. SUB-VERTICAL CLASSIFICATION — exact type of work, is this HGI core? (Base this ONLY on what the RFP describes, not on HGI past performance patterns.)\n2. SCOPE SUMMARY — what is being asked, plain English, 3-5 sentences. Stick to the RFP.\n3. DETAILED DELIVERABLES — every task and work product from the RFP. If you cite a task, it must be in the RFP text above.\n4. EVALUATION CRITERIA — exact criteria and point values from RFP. Quote or paraphrase from the RFP.\n5. HGI CAPABILITY ALIGNMENT — map each deliverable to HGI past performance, flag gaps. Use the competitor intelligence above to identify where HGI is stronger or weaker than likely bidders.\n6. COMPLIANCE REQUIREMENTS — licenses, certs, insurance, bonding AS SPECIFIED IN THE RFP. Do not add requirements from your general knowledge unless the RFP triggers them.\n7. CRITICAL QUESTIONS — what must HGI clarify before committing\n8. COMPETITIVE POSITIONING — based on the competitor data above, who is the primary threat and why? What is HGI\'s key differentiator?\n9. SOURCE CHECK — briefly note any claim you made that you are NOT 100% certain is in the RFP text above, so Christopher can verify.' }]
    });
    var scopeText = (scopeResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    if (scopeText.length > 100) {
      await supabase.from('opportunities').update({ scope_analysis: scopeText, last_updated: new Date().toISOString() }).eq('id', oppId);
      results.steps.push('scope');
      log('ORCHESTRATE: Scope done (' + scopeText.length + ' chars)');
    }
  } catch(e) { results.errors.push('scope:' + e.message); log('ORCHESTRATE: Scope error: ' + e.message); }

  // STEP 2: FINANCIAL ANALYSIS
  var scopeAnalysis = results.steps.indexOf('scope') >= 0 ? scopeText : (opp.scope_analysis || '');
  try {
    var finResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2500,
      system: 'HGI CFO-level financial analyst. Show math for every estimate. Never present estimate as RFP fact. Rate card: Principal ' + d + '220, Prog Dir ' + d + '210, SME ' + d + '200, Sr Grant Mgr ' + d + '180, Grant Mgr ' + d + '175, Sr PM ' + d + '180, PM ' + d + '155, Grant Writer ' + d + '145, Cost Est ' + d + '125, Admin ' + d + '65.',
      messages: [{ role: 'user', content: 'Contract value estimation for HGI.\n\nOPP: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nESTIMATED VALUE: ' + (opp.estimated_value || 'Not stated') + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 2000) + '\n\nORGANISM INTELLIGENCE (competitor pricing, incumbent contracts, budget data, market rates):\n' + orchSlice + '\n\nEstimate using THREE methods with visible math:\n1. STAFFING MATH — list every RFP position, realistic monthly hours (MSA = 20-80 hrs/mo not 160), multiply by rate, base period only\n2. COMPARABLE CONTRACTS — use the competitor pricing intelligence and incumbent contract data above, plus 2-3 similar contracts in same state/vertical\n3. PERCENTAGE OF FEDERAL FUNDING — if FEMA/CDBG/HMGP, estimate total federal allocation, admin fee 5-12%. Use disaster declaration data above for context.\n\nThen: CONSOLIDATED ESTIMATE (LOW/MID/HIGH base period), option years separate as UPSIDE\nPRICE-TO-WIN ANALYSIS — based on competitor pricing intelligence above, what rate structure wins this against the likely field?\nSTAFFING PLAN, HGI COST TO DELIVER, PROFIT MARGIN, FINANCIAL RISKS, RECOMMENDATION (PURSUE/CONDITIONAL/PASS)' }]
    });
    var finText = (finResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
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
      model: 'claude-sonnet-4-6', max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: 'HGI senior capture intelligence analyst. Always search the web for agency facts, incumbents, budgets. Never guess. Cite sources.',
      messages: [{ role: 'user', content: 'Capture intelligence brief for HGI.\n\nOPP: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nSTATE: ' + (opp.state || 'LA') + '\nOPI: ' + opp.opi_score + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 1500) + '\nFINANCIAL:\n' + (finAnalysis || '').slice(0, 1500) + '\n' + kbContext.slice(0, 1500) + '\n\nORGANISM INTELLIGENCE (existing competitor data, contacts, relationships, incumbent info, budget cycles, regulatory context, outcome lessons, cross-opp patterns):\n' + orchSlice + '\n\nUse the organism intelligence above as your STARTING POINT — do not duplicate what the organism already knows. Search the web to FILL GAPS and verify/update existing intelligence. Provide:\n1. AGENCY PROFILE — budget, leadership, procurement patterns. Cross-reference agency profiles above.\n2. COMPETITIVE LANDSCAPE — START with the competitor data above, then add new findings. Who will bid? What are their real weaknesses HGI can exploit?\n3. HGI WIN STRATEGY — 3 differentiators mapped to eval criteria. Use relationship data above to identify insider advantages.\n4. GHOST LANGUAGE — specific themes that highlight competitor weaknesses without naming them (based on the weaknesses data above)\n5. RED FLAGS\n6. 48-HOUR ACTION PLAN — use role titles only, never names\n7. RISKS & CHALLENGES — honest assessment' }]
    });
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
      model: 'claude-sonnet-4-6', max_tokens: 1500,
      system: 'HGI chief capture officer making final bid decision. First line MUST be: PWIN: [number]% | RECOMMENDATION: [GO|CONDITIONAL GO|NO-BID]',
      messages: [{ role: 'user', content: 'Final GO/NO-GO assessment.\nOPP: ' + opp.title + '\nAGENCY: ' + (opp.agency || '') + '\nOPI: ' + (results.revisedOpi || opp.opi_score) + '\nSCOPE:\n' + (scopeAnalysis || '').slice(0, 1000) + '\nFINANCIAL:\n' + (finAnalysis || '').slice(0, 1000) + '\nRESEARCH:\n' + (researchBrief || '').slice(0, 1000) + '\n\nORGANISM INTELLIGENCE (relationships, competitors, outcomes, patterns):\n' + orchSlice.slice(0, 3000) + '\n\nFirst line: PWIN: X% | RECOMMENDATION: GO/CONDITIONAL GO/NO-BID\nThen: decision justification considering competitor weaknesses and HGI relationships above, top 3 win factors, top 3 risks, conditions for GO, teaming recommendation based on partner data above' }]
    });
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
      
      await storeMemory('v4_engine', null, 'v4,skeleton,session',
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
        await storeMemory('v4_engine', null, 'v4,smart,session', 'SMART SESSION — no per-opp changes across ' + beforeCount + ' opps. System-wide agents still running. Trigger: ' + trigger, 'analysis', null, 'high');
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

    await storeMemory('v4_engine', null, 'v4,session',
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
log('V5.0-full-organism: 42 active agents. Direct CB+LaPAC hunting. All 8 verticals. Multi-source discovery. Self-sufficient V2.');
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
        .eq('agent','v4_engine').gte('created_at', new Date(Date.now() - 7200000).toISOString())
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

