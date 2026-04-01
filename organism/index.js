// HGI Living Organism V2 â Multi-Agent Intelligence Session Engine
// Phase 3: 6 agents wired â Intelligence, Financial, Winnability, CRM, Quality Gate, Self-Awareness
// 47 agents total. One shared brain. All into all.

import http from 'http';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Tab, TabStopType, Header, Footer, Table, TableRow, TableCell, ShadingType, LevelFormat, WidthType, PageBreak, PageNumber, TableOfContents, ImageRun } from 'docx';

process.on('unhandledRejection', (r) => log('UNHANDLED: ' + (r instanceof Error ? r.message : String(r)).slice(0,150)));
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + e.message.slice(0,150)));

import Anthropic from '@anthropic-ai/sdk';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const AK = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

const supabase = createClient(SB_URL, SB_KEY);
const anthropic = new Anthropic({ apiKey: AK });

// Ring buffer for in-memory log access
var logBuffer = [];
var LOG_MAX = 500;

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
      res.end(JSON.stringify({ status: 'alive', uptime_seconds: Math.floor(process.uptime()), timestamp: new Date().toISOString(), version: 'V3.4-rfp-gate', agents_active: 47 }));
      return;
    }

    if (url === '/run-session' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ triggered: true }));
      setImmediate(() => runSession('manual').catch(e => log('Session error: ' + e.message)));
      return;
    }

    if (url === '/api/pipeline') {
      const r = await supabase.from('opportunities').select('id,title,agency,vertical,opi_score,stage,status,due_date,estimated_value,capture_action,scope_analysis,research_brief,staffing_plan,financial_analysis,source_url,outcome,rfp_document_retrieved').eq('status','active').order('opi_score', { ascending: false }).limit(20);
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
          '<strong>' + (o.title || '?').slice(0, 60) + '</strong>' +
          '<span style="background:#1a237e;color:#fff;border-radius:12px;padding:2px 8px;font-size:12px">OPI ' + (o.opi_score || '?') + '</span></div>' +
          '<div style="font-size:13px;color:#666;margin-top:2px">' +
          (o.stage || '?') + (days !== null ? ' <span' + urgency + '> | ' + days + ' days</span>' : '') +
          '</div></div>';
      }).join('');

      var alertsHtml = alerts.map(function(a) {
        return '<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px"><strong>' + a.agent + ':</strong> ' + (a.observation || '').slice(0, 200) + '</div>';
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
        (execText ? '<div class="card"><h2>Executive Summary</h2><pre>' + execText.replace(/</g, '&lt;').slice(0, 2000) + '</pre></div>' : '') +
        (huntText ? '<div class="card"><h2>Latest Hunting</h2><pre>' + huntText.replace(/</g, '&lt;').slice(0, 1000) + '</pre></div>' : '') +
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
      const r = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at,opportunity_id').neq('memory_type','decision_point').order('created_at', { ascending: false }).limit(100);
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
      log('MANUAL TRIGGER via /api/trigger');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ triggered: true, time: new Date().toISOString() }));
      setImmediate(function() { runSession('manual_trigger').catch(function(e) { log('Trigger error: ' + e.message); }); });
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
          errors_24h: recentErrors.map(function(e){ return { agent: e.agent, excerpt: (e.observation||'').slice(0,200), time: e.created_at }; }),
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
          html += '<div class="section"><h2>' + s.title + '</h2><pre>' + (s.content||'').replace(/</g,'&lt;').slice(0,15000) + '</pre></div>';
        });
        if (Object.keys(memsByAgent).length > 0) {
          html += '<div class="section"><h2>Agent Intelligence (' + mems.length + ' memories)</h2>';
          Object.keys(memsByAgent).forEach(function(agent) {
            memsByAgent[agent].slice(0,3).forEach(function(m) {
              html += '<div class="mem-card"><div class="mem-agent">' + agent + ' &mdash; ' + (m.memory_type||'') + '</div>' +
                '<div class="mem-obs">' + (m.observation||'').replace(/</g,'&lt;').slice(0,500) + '</div></div>';
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

    if (url === '/' || url === '/dashboard' || url === '/interface') {
      const html = getInterface();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
      res.end(html);
      return;
    }

    
// PHASE 2A: New API routes — surface agent intelligence to interface

if (url.startsWith('/api/opportunity-detail')) {
  var oId = (req.url.split('?id=')[1]||'').split('&')[0];
  if (!oId) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
  var dr = await supabase.from('opportunities').select('id,title,agency,vertical,opi_score,stage,status,due_date,estimated_value,scope_analysis,financial_analysis,research_brief,staffing_plan,capture_action,source_url,outcome,outcome_notes').eq('id',oId).single();
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

if (url === '/api/crash-log') {
  var cr = await supabase.from('organism_memory').select('observation,created_at').eq('agent','v3_engine').order('created_at',{ascending:false}).limit(10);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(cr.data || []));
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
  const { message: chatMsg } = JSON.parse(chatBody || '{}');
  if (!chatMsg) { res.writeHead(400); res.end(JSON.stringify({error:'message required'})); return; }

  const ctxR = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at').order('created_at',{ascending:false}).limit(30);
  const ctxText = (ctxR.data||[]).map(m => m.agent+': '+m.observation.slice(0,200)).join('\n');

  const chatResp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'You are the HGI Business Development Organism. Answer questions about the HGI pipeline, opportunities, competitive intel, and BD strategy. Be concise and direct.\nRecent organism memories:\n'+ctxText,
    messages: [{role:'user',content:chatMsg}]
  });

  const chatReply = chatResp.content[0].text;
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

      // 2. Load all memories
      var memR = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at')
        .eq('opportunity_id', ppId).neq('memory_type','decision_point')
        .order('created_at',{ascending:false}).limit(100);
      var mems = memR.data || [];

      // 3. Load KB chunks (relevant to vertical)
      var kbR = await supabase.from('knowledge_base_chunks').select('content,source_document')
        .order('id',{ascending:false}).limit(30);
      var kbChunks = (kbR.data || []).map(function(c){ return c.content; }).join('\n---\n').slice(0, 8000);

      // 4. Build agent intelligence summary by category
      var intelSummary = '';
      var categories = {
        'Scope & Requirements': ['scope','quality_gate','compliance','compliance_matrix'],
        'Competitive Intelligence': ['intelligence','competitor','research'],
        'Financial & Pricing': ['financial','price','cost','rate_table'],
        'Staffing': ['staffing','recruiting','bench','talent'],
        'Win Strategy': ['winnability','capture','brief'],
        'Proposal Drafts': ['proposal','assembly','red_team','content'],
        'Graphics & Diagrams': ['graphics','org_chart','diagram']
      };
      Object.keys(categories).forEach(function(cat) {
        var keywords = categories[cat];
        var catMems = mems.filter(function(m) {
          var a = (m.agent||'').toLowerCase();
          return keywords.some(function(k) { return a.indexOf(k) > -1; });
        });
        if (catMems.length > 0) {
          intelSummary += '\n## ' + cat + '\n';
          catMems.slice(0,3).forEach(function(m) {
            intelSummary += '[' + m.agent + ']: ' + (m.observation||'').slice(0,1500) + '\n';
          });
        }
      });

      // 5. Build the mega-prompt
      var D = String.fromCharCode(36);
      var proposalPrompt = 'You are the HGI Global proposal production engine. Your job is to produce a COMPLETE, SUBMISSION-READY response document.\n\n' +
        '## OPPORTUNITY\n' +
        'Title: ' + (opp.title||'') + '\n' +
        'Agency: ' + (opp.agency||'') + '\n' +
        'Due: ' + (opp.due_date||'TBD') + '\n' +
        'Value: ' + (opp.estimated_value||'TBD') + '\n\n' +
        '## RFP/SOQ REQUIREMENTS\n' + ((opp.rfp_text && opp.rfp_text.trim().length > 200) ? opp.rfp_text.slice(0, 50000) : (opp.scope_analysis || opp.description || 'No RFP text available')) + '\n\n' +
        '## HGI COMPANY PROFILE\n' + HGI + '\n\n' +
        '## ORGANISM INTELLIGENCE (43 agents analyzed this opportunity)\n' + intelSummary + '\n\n' +
        '## KNOWLEDGE BASE EXCERPTS\n' + kbChunks.slice(0,4000) + '\n\n' +
        '## FINANCIAL ANALYSIS\n' + (opp.financial_analysis || 'Not yet produced') + '\n\n' +
        '## STAFFING PLAN\n' + (opp.staffing_plan || 'Not yet produced') + '\n\n' +
        '## INSTRUCTIONS\n' +
        'STEP 1 — ANALYZE THE SUBMISSION FORMAT:\n' +
        'Read the RFP/SOQ document above CAREFULLY. Determine EXACTLY what the agency is asking for:\n' +
        '- Is it a fill-in-the-blank questionnaire/form? If so, fill out every field of that form.\n' +
        '- Is it a narrative proposal with specific sections? If so, write those exact sections in that exact order.\n' +
        '- Is there a page limit? Note it and stay within it.\n' +
        '- Are there specific exhibits or attachments required? List and complete each one.\n' +
        '- What is the submission format (font, spacing, page count)?\n' +
        '- Are there required forms, affidavits, or certifications? Flag what HGI must complete manually.\n\n' +
        'STEP 2 — PRODUCE THE EXACT DELIVERABLE THE AGENCY WANTS:\n' +
        'Do NOT produce a generic proposal. Produce EXACTLY what the submission requirements specify.\n' +
        'If they want a questionnaire filled out, fill out the questionnaire field by field.\n' +
        'If they want a 20-page narrative, write a 20-page narrative with their exact section headings.\n' +
        'If they want Exhibit A and Exhibit B, produce both exhibits with HGI data filled in.\n' +
        'If they want a fee schedule by staff classification, build it from the HGI rate card.\n\n' +
        'STEP 3 — MAP EVALUATION CRITERIA TO CONTENT:\n' +
        'Extract the exact evaluation criteria and point values from the RFP.\n' +
        'Organize your response to maximize points on the highest-weighted criteria.\n' +
        'Address every criterion explicitly — do not leave points on the table.\n\n' +
        'CRITICAL PERSONNEL EXCLUSION:\n' +
        '- Geoffrey Brien is NO LONGER WITH HGI. Do not include him in any staffing, personnel, org charts, or team descriptions. If organism intelligence references Brien, IGNORE those references. Replace his role assignments with [TO BE DETERMINED — DR/PA SME] or redistribute to other confirmed staff.\n' +
        '- Confirmed current HGI staff: President (Christopher Oney), CEO (Lou Resweber), VP (Dillon Truax), CAO (Candy Dottolo), SVP Claims (Vanessa James), 1099 SME (Chris Feduccia). No other named individuals unless confirmed in the organism intelligence as current HGI employees.\n\n' +
        'RULES:\n' +
        '- Produce ONLY what the solicitation asks for — nothing more, nothing less\n' +
        '- Every claim must be backed by real HGI data from the company profile and organism intelligence above\n' +
        '- MINIMIZE [ACTION REQUIRED] flags — use them ONLY for items that genuinely cannot be completed without human action: wet signatures, notarizations, insurance certificates, contact info the system truly does not have. If the data exists anywhere in the context above, USE IT instead of flagging it.\n' +
        '- Use ONLY confirmed HGI past performance. Never fabricate projects, dollar amounts, or references.\n' +
        '- Include specific dollar amounts, dates, and confirmed staff names from HGI data\n' +
        '- Write to WIN — not to fill space. Every sentence should earn points with evaluators. Cut filler, cut repetition, be direct and specific.\n' +
        '- Professional, confident tone — this goes directly to evaluators. No hedging, no qualifications, no "we believe" or "we feel" — state capabilities as facts.\n' +
        '- No mention of AI, organism, agents, confidence levels, or the capture system\n' +
        '- Document must look like it came from the President with no visible AI involvement\n' +
        '- HGI was established in 1931 (not 1929). SAM UEI: DL4SJEVKZ6H4 (verify exact characters)\n' +
        '- Do NOT impose section numbering (1.0, 2.0) unless the RFP specifically uses numbered sections. Match the RFP structure exactly.\n' +
        '- Do NOT include a Table of Contents unless the RFP requires one. If included, build it as real content with section names and approximate page numbers — not a placeholder.\n' +
        '- Do NOT generate ASCII art org charts or text-based organizational diagrams in the proposal body. Instead write "See Organizational Chart (Appendix A)" — the system generates a professional graphic separately.\n' +
        '- HGI phone: (504) 681-6135. Email: info@hgi-global.com. Use these when contact info is needed — do NOT use placeholder numbers like 000-0000.\n' +
        '- HGI has approximately 50 team members across offices in Kenner (HQ), Shreveport, Alexandria, and New Orleans. Do NOT cite "67 full-time employees and 43 contractors" — that is outdated.';

      log('PROPOSAL ENGINE: Calling Claude Opus 4.6 (128K max) with ' + proposalPrompt.length + ' char prompt');

      // Opus 4.6 supports 128K output tokens but requires streaming for large outputs
      var proposalText = '';
      var stream = await anthropic.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 128000,
        system: 'You are a senior government proposal writer at HGI Global (Hammerman & Gainer LLC), a 95-year-old Louisiana-based firm. You produce submission-ready documents that WIN — not average drafts. Every word earns points with evaluators. You match the exact format each solicitation requires (questionnaire forms filled field-by-field, narrative proposals with specified sections, exhibits completed). You are specific, factual, direct, and persuasive. You use only confirmed company data. You write like the firm President would write — authoritative, zero filler, zero hedging. IMPORTANT: Geoffrey Brien no longer works at HGI. Never include him.',
        messages: [{role:'user', content: proposalPrompt}]
      });
      var finalMessage = await stream.finalMessage();
      proposalText = (finalMessage.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
      log('PROPOSAL ENGINE: Generated ' + proposalText.length + ' chars');

      // 6. Store the proposal in dedicated column (NOT capture_action — that's the organism's internal analysis)
      await supabase.from('opportunities').update({
        proposal_content: '# PROPOSAL DRAFT — READY FOR REVIEW\n\n' + proposalText,
        last_updated: new Date().toISOString()
      }).eq('id', ppId);

      // 7. Write memory
      await supabase.from('organism_memory').insert({
        agent: 'proposal_engine',
        opportunity_id: ppId,
        observation: 'PROPOSAL PRODUCED: ' + (opp.title||'').slice(0,50) + ' — ' + proposalText.length + ' chars generated. Stored in proposal_content field. Ready for President review.',
        memory_type: 'analysis',
        created_at: new Date().toISOString()
      });

      log('PROPOSAL ENGINE: Complete for ' + (opp.title||'').slice(0,40));

    } catch(e) {
      log('PROPOSAL ENGINE ERROR: ' + e.message);
    }
  });
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
        var w = Math.floor((len / totalLen) * 9360);
        return Math.max(w, 800); // minimum 800 DXA (~0.55 inch)
      });
      // Adjust to sum to exactly 9360
      var widthSum = colWidths.reduce(function(a,b){ return a+b; }, 0);
      if (widthSum !== 9360) colWidths[colWidths.length - 1] += (9360 - widthSum);

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
      'Principal ' + D + '220 | Program Director ' + D + '210 | SME ' + D + '200\n' +
      'Sr Grant Manager ' + D + '180 | Grant Manager ' + D + '175 | Sr PM ' + D + '180 | PM ' + D + '155\n' +
      'Grant Writer ' + D + '145 | Architect/Engineer ' + D + '135 | Cost Estimator ' + D + '125\n' +
      'Appeals Specialist ' + D + '145 | Sr Damage Assessor ' + D + '115 | Damage Assessor ' + D + '105\n' +
      'Admin Support ' + D + '65\n\n' +
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
  var texts = [];
  for (var i = 0; i < (response.content || []).length; i++) {
    if (response.content[i].type === 'text') texts.push(response.content[i].text);
  }
  return texts.join('\n');
}

// === MULTI-SEARCH: Targeted pre-research before agent reasoning ===
async function multiSearch(queries) {
  var results = [];
  for (var i = 0; i < queries.length; i++) {
    try {
      var r = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Intelligence analyst. Return specific verified findings with sources. Be concise.',
        messages: [{ role: 'user', content: queries[i].q }]
      });
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
    rfpSection = '\n\n=== ACTUAL RFP/SOQ DOCUMENT TEXT ===\n' + opp.rfp_text.slice(0, 50000) + '\n=== END RFP DOCUMENT ===\n';
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
var HGI = 'SYSTEM CONTEXT: HGI Global (Hammerman & Gainer LLC) is a 95-year-old, 100% minority-owned program management firm in Kenner, Louisiana (2400 Veterans Memorial Blvd, Suite 510, 70062). 8 verticals: Disaster Recovery, TPA/Claims (full P&C), Property Tax Appeals, Workforce/WIOA, Construction Management, Program Administration, Housing/HUD, Grant Management. Past performance: Road Home ' + String.fromCharCode(36) + '67M direct/' + String.fromCharCode(36) + '13B+ program (2006-2015, zero misappropriation), HAP ' + String.fromCharCode(36) + '950M, Restore LA ' + String.fromCharCode(36) + '42.3M, Rebuild NJ ' + String.fromCharCode(36) + '67.7M, TPSD ' + String.fromCharCode(36) + '2.96M (completed 2022-2025), St. John Sheriff ' + String.fromCharCode(36) + '788K, BP GCCF ' + String.fromCharCode(36) + '1.65M. Key staff by role: President, Chairman, CEO, CAO, VP, SVP Claims, 1099 SME (~' + String.fromCharCode(36) + '1B grants/incentives). ~50 team members across offices in Kenner (HQ), Shreveport, Alexandria, New Orleans. Phone: (504) 681-6135. Email: info@hgi-global.com. SAM UEI: DL4SJEVKZ6H4. Insurance: ' + String.fromCharCode(36) + '5M fidelity/' + String.fromCharCode(36) + '5M E&O/' + String.fromCharCode(36) + '2M GL. Rate card (burdened/hr): Principal ' + String.fromCharCode(36) + '220, Prog Dir ' + String.fromCharCode(36) + '210, SME ' + String.fromCharCode(36) + '200, Sr Grant Mgr ' + String.fromCharCode(36) + '180, Grant Mgr ' + String.fromCharCode(36) + '175, Sr PM ' + String.fromCharCode(36) + '180, PM ' + String.fromCharCode(36) + '155, Grant Writer ' + String.fromCharCode(36) + '145, Arch/Eng ' + String.fromCharCode(36) + '135, Cost Est ' + String.fromCharCode(36) + '125, Appeals ' + String.fromCharCode(36) + '145, Sr Damage ' + String.fromCharCode(36) + '115, Damage ' + String.fromCharCode(36) + '105, Admin ' + String.fromCharCode(36) + '65. HGI has NEVER had a direct federal contract. All work flows through state agencies, local governments, housing authorities, and insurance entities. Do NOT list PBGC or Orleans Parish School Board as past performance without explicit President confirmation. RULES: (1) Every claim must cite source+date. Unverified = say so. (2) Set confidence:high only with source URL. Medium when extrapolating. Inferred when reasoning without sources. (3) Set source_url to specific URL or null. CRITICAL PERSONNEL UPDATE: Geoffrey Brien is NO LONGER with HGI — do not reference him in any proposals, staffing plans, or deliverables. The DR Manager position is currently unfilled. Any organism memories referencing Brien as current staff are OUTDATED. FOUNDING YEAR: HGI was founded in 1931, not 1929. Use 1931 in all documents.';


// ============================================================
// TIER 1 PRODUCERS — Sonnet, 4000 tokens, write to opp fields
// ============================================================

async function agentIntelligence(opp, state, cycleBrief) {
  log('INTEL: ' + (opp.title || '?').slice(0, 50));
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
    '- Use HGI rate card from system context for staffing-based method\n' +
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
    '1. Staffing matrix: position | named person | qualifications | rate | availability\n' +
    '2. Gaps requiring recruitment or teaming\n' +
    '3. Org chart structure\n' +
    '4. Key personnel commitments\n\n' +
    'RULES:\n' +
    '- NEVER overwrite scope_analysis. You READ it, not write to it.\n' +
    '- confidence:high for named HGI personnel and rate card data\n' +
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
  var out = await claudeCall(task, prompt, 1500);
  if (!out || out.length < 100) return null;
  await storeMemory('brief_agent', opp.id, (opp.agency || '') + ',briefing', out, 'analysis', null, 'medium');
  return { agent: 'brief_agent', opp: opp.title, chars: out.length };
}

async function agentOppBrief(opp, state, cycleBrief) {
  log('OPP BRIEF: ' + (opp.title || '?').slice(0, 50));
  var ctx = buildAgentCtx(state, 'opportunity_brief_agent', opp.id);
  var task = 'TASK: Deep single-opportunity dossier integrating ALL intelligence. A reader with zero context should understand this opportunity, HGI competitive position, and recommended actions from this document alone.';
  var prompt = cycleBrief + '\n\n' + oppFull(opp) + '\n\nORGANISM MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 2500);
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
  var out = await claudeCall(task, prompt, 2000);
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
  var out = await claudeCall(task, prompt, 1500, { webSearch: true });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('discovery_agent', null, 'pre_solicitation', out, 'analysis', hasUrl ? 'web_search' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'discovery_agent', opp: 'system', chars: out.length };
}

async function agentDisasterMonitor(state) {
  log('DISASTER MONITOR...');
  var task = 'TASK: Check for NEW disaster declarations and emergency procurement in LA, MS, TX, FL, AL, GA. Search FEMA.gov/disasters, GOHSEP, MEMA, NWS. For each: type, location, date, procurement timeline, HGI response recommendation.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { webSearch: true });
  if (!out || out.length < 100) return null;
  var hasUrl = /https?:\/\//.test(out);
  await storeMemory('disaster_monitor', null, 'disaster,fema', out, 'analysis', hasUrl ? 'fema.gov' : null, hasUrl ? 'high' : 'inferred');
  return { agent: 'disaster_monitor', opp: 'system', chars: out.length };
}

async function agentSourceExpansion(state) {
  log('SOURCE EXPANSION...');
  var task = 'TASK: Map procurement portals for LA, MS, TX, FL, AL, GA. For each: URL, verticals covered, access requirements, estimated volume. Focus on portals not currently monitored.';
  var prompt = task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true });
  if (!out || out.length < 100) return null;
  await storeMemory('source_expansion', null, 'sources', out, 'analysis', null, 'medium');
  return { agent: 'source_expansion', opp: 'system', chars: out.length };
}

async function agentContractExpiration(state) {
  log('CONTRACT EXPIRATION...');
  var ctx = buildAgentCtx(state, 'contract_expiration', null);
  var task = 'TASK: Search USAspending and state portals for expiring contracts in HGI verticals. Recompete window = 6-12 months before expiration. For each: holder, agency, value, end date, recompete timeline.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true });
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
  var out = await claudeCall(task, prompt, 1200, { webSearch: true });
  if (!out || out.length < 100) return null;
  await storeMemory('amendment_tracker', null, 'amendments', out, 'analysis', null, 'medium');
  return { agent: 'amendment_tracker', opp: 'system', chars: out.length };
}

async function agentRegulatoryMonitor(state) {
  log('REGULATORY MONITOR...');
  var task = 'TASK: Search Federal Register, FEMA policy updates, HUD notices, LA legislature for regulatory changes affecting HGI verticals. For each: change, effective date, impact, recommended response.';
  var prompt = task;
  var out = await claudeCall(task, prompt, 1200, { webSearch: true });
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
  var out = await claudeCall(task, prompt, 1500, { webSearch: true });
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
  var out = await claudeCall(task, prompt, 1200, { webSearch: true });
  if (!out || out.length < 100) return null;
  await storeMemory('recompete_agent', null, 'recompete', out, 'analysis', null, 'medium');
  return { agent: 'recompete_agent', opp: 'system', chars: out.length };
}

async function agentCompetitorDeepDive(state) {
  log('COMPETITOR DEEP DIVE...');
  var ctx = buildAgentCtx(state, 'competitor_deep_dive', null);
  var task = 'TASK: Build profiles of HGI top competitors: CDR Maguire, IEM, Tetra Tech, Hagerty. For each: recent wins (sourced), key personnel, geographic footprint, strengths/weaknesses. Source every claim.';
  var prompt = 'MEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500, { webSearch: true });
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
  var out = await claudeCall(task, prompt, 1500, { webSearch: true });
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
  var task = 'TASK: Review OPI scores vs accumulated intelligence. Any opps scored too high or low? Recommend adjustments with rationale.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
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
  var out = await claudeCall(task, prompt, 1200, { webSearch: true });
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
  var out = await claudeCall(task, prompt, 2000);
  if (!out || out.length < 100) return null;
  await storeMemory('executive_brief_agent', null, 'executive', out, 'analysis', null, 'medium');
  return { agent: 'executive_brief_agent', opp: 'system', chars: out.length };
}

async function agentDashboard(state) {
  log('DASHBOARD...');
  var ctx = buildAgentCtx(state, 'dashboard_agent', null);
  var task = 'TASK: Morning briefing for the President. Top 3 things to know. Top 3 actions needed. Alerts. Concise. Decision-oriented. No fluff.';
  var prompt = 'PIPELINE:\n' + pipelineSummary(state.pipeline) + '\n\nMEMORY:\n' + ctx.memText + '\n\n' + task;
  var out = await claudeCall(task, prompt, 1500);
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
  var out = await claudeCall(task, prompt, 3000);
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

// === HUNTING AGENT — preserved from V2, uses existing portal APIs ===
async function agentHunting(state) {
  log('HUNTING: checking procurement portals...');
  var newOpps = [];
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

  // Central Bidding
  try {
    var cbResp = await supabase.from('hunt_runs').select('*').eq('source', 'centralbidding').order('run_at', { ascending: false }).limit(10);
    (cbResp.data || []).forEach(function(run) {
      try {
        var opps = (JSON.parse(run.status || '{}')).opportunities || [];
        opps.forEach(function(o) {
          var t = o.title || o.name || '';
          if (t && !isDupe(t)) newOpps.push({ title: t, agency: o.agency || 'Louisiana Agency', source: 'centralbidding', source_url: o.url || 'https://www.centralauctionhouse.com', description: (o.description || '').slice(0, 500), due_date: o.due_date || null });
        });
      } catch (e) {}
    });
  } catch (e) {}

  // LaPAC — DISABLED: No REST API exists. Real LaPAC is ColdFusion web form at wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm
  // Needs Apify actor to scrape. Central Bidding covers most LA local/parish solicitations.
  // TODO: Build LaPAC Apify scraper for state-level coverage

  // SAM.gov
  var samKW = ['disaster recovery program management', 'grant administration', 'FEMA public assistance', 'CDBG-DR', 'housing authority'];
  for (var s = 0; s < samKW.length; s++) {
    try {
      var sr = await fetch('https://api.sam.gov/opportunities/v2/search?api_key=DEMO_KEY&q=' + encodeURIComponent(samKW[s]) + '&postedFrom=' + daysAgo(14) + '&postedTo=' + today() + '&active=true&limit=10');
      if (sr.ok) {
        var sd = await sr.json();
        (sd.opportunitiesData || []).forEach(function(o) {
          if (o.title && !isDupe(o.title)) newOpps.push({ title: o.title, agency: o.fullParentPathName || 'Federal', source: 'sam_gov', source_url: 'https://sam.gov/opp/' + o.opportunityId, description: (o.description || '').slice(0, 500), due_date: o.responseDeadLine || null });
        });
      }
    } catch (e) {}
  }


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
  log('HUNTING: OpenFEMA checked ' + hgiStates.length + ' states');

  // === NEW: USAspending expiring contracts (free, no key) ===
  try {
    var usaBody = JSON.stringify({
      filters: {
        place_of_performance_locations: [
          { country: 'USA', state: 'LA' }, { country: 'USA', state: 'TX' },
          { country: 'USA', state: 'FL' }, { country: 'USA', state: 'MS' }
        ],
        naics_codes: { require: ['541611', '541618', '541990', '624230', '524292'] },
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

  // === NEW: Grants.gov forecasted+posted (free, no key) ===
  try {
    var gr = await fetch('https://api.grants.gov/v1/api/search2', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: 'disaster recovery OR housing program OR workforce development OR grant management OR CDBG OR hazard mitigation',
        oppStatuses: 'forecasted|posted', rows: 15, startRecordNum: 0
      })
    });
    if (gr.ok) {
      var gd = await gr.json();
      var gops = (gd.data && gd.data.oppHits) ? gd.data.oppHits : [];
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

  // === NEW: Federal Register CDBG-DR and FEMA notices (free, no key) ===
  try {
    var frTerms = ['CDBG-DR', 'FEMA Public Assistance', 'Hazard Mitigation Grant'];
    for (var frt = 0; frt < frTerms.length; frt++) {
      var frUrl = 'https://www.federalregister.gov/api/v1/documents.json?' +
        'conditions[term]=' + encodeURIComponent(frTerms[frt]) +
        '&conditions[publication_date][gte]=' + new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10) +
        '&per_page=5&order=newest';
      var frR = await fetch(frUrl, { headers: { Accept: 'application/json' } });
      if (frR.ok) {
        var frD = await frR.json();
        var frResults = frD.results || [];
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

  log('HUNTING: ' + newOpps.length + ' raw candidates. Scoring...');
  if (newOpps.length === 0) {
    await storeMemory('hunting_agent', null, 'hunting', 'No new candidates from CB + SAM + FEMA + USAspending + Grants.gov + FedReg (LaPAC disabled — no API)', 'analysis', null, 'high');
    return { agent: 'hunting_agent', chars: 100, new_opps: 0 };
  }

  // Deduplicate and score with Haiku
  var deduped = newOpps.filter(function(o, i, a) { return a.findIndex(function(x) { return x.title.slice(0, 40) === o.title.slice(0, 40); }) === i; });
  var qualified = [];

  for (var c = 0; c < Math.min(deduped.length, 15); c++) {
    try {
      var cand = deduped[c];
      var scoreResp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 150,
        messages: [{ role: 'user', content: HGI + '\nOPP: ' + cand.title + ' | ' + cand.agency + ' | ' + (cand.description || '').slice(0, 200) + '\n\nJSON only: {"opi":N,"vertical":"disaster|tpa|workforce|housing|construction|grant|federal|FILTER","capture_action":"GO|WATCH|NO-BID","why":"1 sentence"}' }]
      });
      var st = (scoreResp.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('').replace(/```json|```/g, '').trim();
      var score = JSON.parse(st);
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
    } catch (e) {}
  }

  log('HUNTING: ' + qualified.length + ' qualified and added');
  await storeMemory('hunting_agent', null, 'hunting', 'HUNTING: ' + qualified.length + '/' + deduped.length + ' qualified.\n' + qualified.map(function(q) { return 'OPI:' + q.opi + ' [' + q.source + '] ' + q.title.slice(0, 50); }).join('\n'), 'analysis', null, 'high');
  return { agent: 'hunting_agent', chars: 300, new_opps: qualified.length };
}


// ============================================================
// RUN SESSION — The execution engine
// ============================================================
async function runSession(trigger) {
  var id = 'v3-' + Date.now();
  log('=== SESSION START: ' + id + ' | trigger: ' + trigger + ' | V3.4 43-agent organism ===');
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

    // 1. HUNTING — fires first
    try { var rH = await agentHunting(state); if (rH) { allResults.push(rH); if (rH.new_opps > 0) { var fresh = await supabase.from('opportunities').select('*').eq('status', 'active').order('opi_score', { ascending: false }).limit(15); if (fresh.data) { state.pipeline = fresh.data; activeOpps = state.pipeline.filter(function(o) { return (o.opi_score || 0) >= 65; }); } } } } catch (e) { log('Hunt error: ' + e.message); }

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
      try { var r6 = await agentStaffingPlan(opp, state, cycleBrief); if (r6) allResults.push(r6); } catch (e) { log('Staff err: ' + e.message); }
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
      try { var rPW = await agentProposalWriter(opp2, state, cb2); if (rPW) allResults.push(rPW); } catch (e) { log('PW err: ' + e.message); }
      try { var rRT = await agentRedTeam(opp2, state, cb2); if (rRT) allResults.push(rRT); } catch (e) { log('RT err: ' + e.message); }
      try { var rBr = await agentBrief(opp2, state, cb2); if (rBr) allResults.push(rBr); } catch (e) { log('Brief err: ' + e.message); }
      try { var rOB = await agentOppBrief(opp2, state, cb2); if (rOB) allResults.push(rOB); } catch (e) { log('OB err: ' + e.message); }
      try { var rPA = await agentProposalAssembly(opp2, state, cb2); if (rPA) allResults.push(rPA); } catch (e) { log('PA err: ' + e.message); }
      try { var rPTW = await agentPriceToWin(opp2, state, cb2); if (rPTW) allResults.push(rPTW); } catch (e) { log('PTW err: ' + e.message); }
      try { var rOP = await agentOralPrep(opp2, state, cb2); if (rOP) allResults.push(rOP); } catch (e) { log('OP err: ' + e.message); }
      try { var rPO = await agentPostAward(opp2, state); if (rPO) allResults.push(rPO); } catch (e) { log('PO err: ' + e.message); }
    }

    // 4. SYSTEM-WIDE AGENTS
    log('--- System-wide agents ---');
    try { var rDis = await agentDiscovery(state); if (rDis) allResults.push(rDis); } catch (e) { log('Disc err: ' + e.message); }
    try { var rPS = await agentPipelineScanner(state); if (rPS) allResults.push(rPS); } catch (e) { log('PS err: ' + e.message); }
    try { var rOPI = await agentOPICalibration(state); if (rOPI) allResults.push(rOPI); } catch (e) { log('OPI err: ' + e.message); }
    try { var rCE = await agentContentEngine(state); if (rCE) allResults.push(rCE); } catch (e) { log('CE err: ' + e.message); }
    try { var rRec = await agentRecruiting(state); if (rRec) allResults.push(rRec); } catch (e) { log('Rec err: ' + e.message); }
    try { var rKB = await agentKnowledgeBase(state); if (rKB) allResults.push(rKB); } catch (e) { log('KB err: ' + e.message); }
    try { var rSI = await agentScraperInsights(state); if (rSI) allResults.push(rSI); } catch (e) { log('SI err: ' + e.message); }
    try { var rEB = await agentExecutiveBrief(state); if (rEB) allResults.push(rEB); } catch (e) { log('EB err: ' + e.message); }
    try { var rDM = await agentDisasterMonitor(state); if (rDM) allResults.push(rDM); } catch (e) { log('DM err: ' + e.message); }
    try { var rDA = await agentDashboard(state); if (rDA) allResults.push(rDA); } catch (e) { log('Dash err: ' + e.message); }
    try { var rDV = await agentDesignVisual(state); if (rDV) allResults.push(rDV); } catch (e) { log('DV err: ' + e.message); }
    try { var rTM = await agentTeaming(state); if (rTM) allResults.push(rTM); } catch (e) { log('Team err: ' + e.message); }
    try { var rSE = await agentSourceExpansion(state); if (rSE) allResults.push(rSE); } catch (e) { log('SE err: ' + e.message); }
    try { var rCX = await agentContractExpiration(state); if (rCX) allResults.push(rCX); } catch (e) { log('CX err: ' + e.message); }
    try { var rBC = await agentBudgetCycle(state); if (rBC) allResults.push(rBC); } catch (e) { log('BC err: ' + e.message); }
    try { var rLA = await agentLossAnalysis(state); if (rLA) allResults.push(rLA); } catch (e) { log('LA err: ' + e.message); }
    try { var rWR = await agentWinRateAnalytics(state); if (rWR) allResults.push(rWR); } catch (e) { log('WR err: ' + e.message); }
    try { var rRM = await agentRegulatoryMonitor(state); if (rRM) allResults.push(rRM); } catch (e) { log('RM err: ' + e.message); }
    try { var rOA = await agentOutreachAutomation(state); if (rOA) allResults.push(rOA); } catch (e) { log('OA err: ' + e.message); }
    try { var rLL = await agentLearningLoop(state); if (rLL) allResults.push(rLL); } catch (e) { log('LL err: ' + e.message); }
    try { var rAT = await agentAmendmentTracker(state); if (rAT) allResults.push(rAT); } catch (e) { log('AT err: ' + e.message); }
    try { var rEN = await agentEntrepreneurial(state); if (rEN) allResults.push(rEN); } catch (e) { log('EN err: ' + e.message); }
    try { var rRC = await agentRecompete(state); if (rRC) allResults.push(rRC); } catch (e) { log('RC err: ' + e.message); }
    try { var rCD = await agentCompetitorDeepDive(state); if (rCD) allResults.push(rCD); } catch (e) { log('CD err: ' + e.message); }
    try { var rAP = await agentAgencyProfile(state); if (rAP) allResults.push(rAP); } catch (e) { log('AP err: ' + e.message); }
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

    await storeMemory('v3_engine', null, 'v3,session',
      'V3 SESSION - trigger:' + trigger + ' pipeline:' + state.pipeline.length + ' agents:' + allResults.length + ' uptime:' + Math.floor(process.uptime()) + 's',
      'analysis', null, 'high');

    log('=== SESSION COMPLETE: ' + id + ' | ' + allResults.length + ' agent outputs ===');
    log('Completed: ' + allResults.map(function(r) { return r.agent + '(' + r.chars + ')'; }).join(', '));

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
log('HGI LIVING ORGANISM V3.4 - STARTING');
log('43 researcher-agents. Task instructions. Sourced intelligence. RFP gate.');
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

// STARTUP SESSION DISABLED (Session 68) — deploys no longer trigger agent cycles.
// Cycles run on scheduled cron only (noon + midnight CST). Use /api/trigger for manual runs.
// setTimeout(function() { runSession('startup').catch(console.error); }, 3000);

// Cron: noon + midnight CST (UTC-6 = 18:00 and 06:00 UTC)
setInterval(function() {
  var h = new Date().getUTCHours();
  var m = new Date().getUTCMinutes();
  if ((h === 18 || h === 6) && m === 0) {
    log('Scheduled session firing (' + (h === 18 ? 'noon' : 'midnight') + ' CST)');
    runSession('scheduled_' + (h === 18 ? 'noon' : 'midnight')).catch(console.error);
  }
}, 60000);

log('V3.4 ready. Cron-only mode — noon + midnight CST. /api/trigger for manual.');

