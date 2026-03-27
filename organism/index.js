// HGI Living Organism V2 — Multi-Agent Intelligence Session Engine
// Phase 3: 6 agents wired — Intelligence, Financial, Winnability, CRM, Quality Gate, Self-Awareness
// 47 agents total. One shared brain. All into all.

import http from 'http';
import { createClient } from '@supabase/supabase-js';

process.on('unhandledRejection', (r) => log('UNHANDLED: ' + (r instanceof Error ? r.message : String(r)).slice(0,150)));
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + e.message.slice(0,150)));

import Anthropic from '@anthropic-ai/sdk';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const AK = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

const supabase = createClient(SB_URL, SB_KEY);
const anthropic = new Anthropic({ apiKey: AK });

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
      res.end(JSON.stringify({ status: 'alive', uptime_seconds: Math.floor(process.uptime()), timestamp: new Date().toISOString(), version: 'V2.10.0-phase1-interface', agents_active: 47 }));
      return;
    }

    if (url === '/run-session' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ triggered: true }));
      setImmediate(() => runSession('manual').catch(e => log('Session error: ' + e.message)));
      return;
    }

    if (url === '/api/pipeline') {
      const r = await supabase.from('opportunities').select('id,title,agency,vertical,opi_score,stage,status,due_date,estimated_value,capture_action,scope_analysis,research_brief,staffing_plan,financial_analysis,source_url,outcome').eq('status','active').order('opi_score', { ascending: false }).limit(20);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.data || []));
      return;
    }

    if (url === '/api/briefing') {
      const r = await supabase.from('organism_memory').select('observation,agent,created_at').eq('agent','dashboard_agent').order('created_at', { ascending: false }).limit(1);
      const brief = (r.data && r.data[0]) ? r.data[0].observation : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ briefing: brief }));
      return;
    }

    if (url === '/api/memories') {
      const r = await supabase.from('organism_memory').select('agent,observation,memory_type,created_at,opportunity_id').neq('memory_type','decision_point').order('created_at', { ascending: false }).limit(30);
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

    if (url === '/' || url === '/dashboard') {
      const html = getInterface();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive', uptime: Math.floor(process.uptime()) }));

  } catch (err) {
    log('REQUEST_ERROR: ' + err.message + ' url=' + (req.url || '?'));
    try { if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } } catch(e2) {}
  }
});

server.listen(PORT, () => log('Health server listening on port ' + PORT));

function log(msg) { console.log('[' + new Date().toISOString() + '] [ORGANISM] ' + msg); }

async function storeMemory(agent, oppId, tags, observation, memType) {
  try {
    await supabase.from('organism_memory').insert({
      id: agent + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      agent: agent, opportunity_id: oppId || null,
      entity_tags: tags, observation: observation,
      memory_type: memType || 'analysis',
      created_at: new Date().toISOString()
    });
  } catch(e) { log('Memory error: ' + e.message); }
}

async function claudeCall(system, prompt, maxTokens) {
  var response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 1200,
    system: system,
    messages: [{ role: 'user', content: prompt }]
  });
  return (response.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
}

async function loadState() {
  log('Loading system state...');
  var results = await Promise.all([
    supabase.from('opportunities').select('*').eq('status','active').order('opi_score', { ascending: false }).limit(10),
    supabase.from('organism_memory').select('*').neq('memory_type','decision_point').order('created_at', { ascending: false }).limit(100),
    supabase.from('competitive_intelligence').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('relationship_graph').select('*').order('updated_at', { ascending: false }).limit(50),
  ]);
  var state = { pipeline: results[0].data||[], memories: results[1].data||[], competitive: results[2].data||[], relationships: results[3].data||[] };
  log('State loaded: ' + state.pipeline.length + ' opps | ' + state.memories.length + ' memories | ' + state.competitive.length + ' comp intel | ' + state.relationships.length + ' relationships');
  return state;
}

function buildCtx(state) {
  var memText = state.memories.slice(0,30).map(function(m) { return '[' + (m.agent||'?') + ']: ' + (m.observation||'').slice(0,200); }).join('\n\n');
  var compText = state.competitive.slice(0,15).map(function(c) { return (c.competitor_name||'?') + ' | ' + (c.agency||'') + ': ' + (c.strategic_notes||'').slice(0,120); }).join('\n');
  var relText = state.relationships.slice(0,15).map(function(r) { return (r.contact_name||'?') + ' | ' + (r.organization||'') + ' | ' + (r.relationship_strength||'cold'); }).join('\n');
  return { memText: memText, compText: compText, relText: relText };
}

function oppBase(opp) {
  return 'OPPORTUNITY: ' + (opp.title||'unknown') +
    '\nAgency: ' + (opp.agency||'unknown') +
    '\nVertical: ' + (opp.vertical||'unknown') +
    '\nOPI: ' + (opp.opi_score||0) + ' | Stage: ' + (opp.stage||'identified') +
    '\nDue: ' + (opp.due_date||'TBD') + ' | Est Value: ' + (opp.estimated_value||'unknown') +
    '\nScope: ' + (opp.scope_analysis||'').slice(0,500) +
    '\nResearch Brief: ' + (opp.research_brief||'').slice(0,600);
}

function getInterface() {
  var d = [
    "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\">",
    "<title>HGI Organism V2</title>",
    "<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap\" rel=\"stylesheet\">",
    "<style>",
    "*{margin:0;padding:0;box-sizing:border-box}",
    ":root{--navy:#1B2A4A;--gold:#C8A55A;--cream:#F8F6F1;--warm:#E8E4DC;--text:#2C2C2C;--muted:#6B6B6B;--green:#2D7A4F}",
    "body{font-family:Inter,sans-serif;background:var(--cream);color:var(--text);display:flex;flex-direction:column;min-height:100vh}",
    ".sb{width:240px;background:var(--navy);min-height:100vh;position:fixed;left:0;top:0;bottom:0;display:flex;flex-direction:column;z-index:100}",
    ".lg{padding:22px 20px;border-bottom:1px solid rgba(200,165,90,0.3)}",
    ".lg h1{font-family:Cormorant Garamond,serif;color:var(--gold);font-size:18px;font-weight:600}",
    ".lg p{color:rgba(255,255,255,0.45);font-size:11px;margin-top:3px}",
    ".nav{flex:1;padding:12px 0;overflow-y:auto}",
    ".ns{padding:8px 16px 4px;color:rgba(200,165,90,0.55);font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase}",
    ".ni{display:flex;align-items:center;gap:10px;padding:9px 20px;color:rgba(255,255,255,0.6);font-size:13px;cursor:pointer;border-left:3px solid transparent;transition:all 0.15s}",
    ".ni:hover{color:#fff;background:rgba(255,255,255,0.06)} .ni.act{color:var(--gold);border-left-color:var(--gold);background:rgba(200,165,90,0.1)}",
    ".dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:0.5;flex-shrink:0}",
    ".sf{padding:14px 20px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(255,255,255,0.35)}",
    ".sd{width:7px;height:7px;border-radius:50%;background:#2D7A4F;box-shadow:0 0 6px #2D7A4F}",
    ".main{margin-left:240px;flex:1;display:flex;flex-direction:column}",
    ".tb{background:#fff;border-bottom:1px solid var(--warm);padding:0 32px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}",
    ".tv{font-family:Cormorant Garamond,serif;font-size:20px;font-weight:600;color:var(--navy)} .tm{display:flex;align-items:center;gap:14px} .tt{font-size:12px;color:var(--muted)}",
    ".rb{background:var(--gold);color:var(--navy);border:none;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer}",
    ".ct{flex:1;padding:28px 32px;padding-bottom:80px}",
    ".bc{background:#fff;border-radius:12px;padding:24px 28px;margin-bottom:20px;border-left:4px solid var(--gold);box-shadow:0 2px 8px rgba(0,0,0,0.06)}",
    ".bl{font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold);margin-bottom:10px}",
    ".bt{font-family:Cormorant Garamond,serif;font-size:18px;line-height:1.6;color:var(--navy);font-weight:500}",
    ".bm{margin-top:10px;font-size:11px;color:var(--muted)}",
    ".ps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}",
    ".pb{background:#fff;border-radius:10px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,0.05);border-top:3px solid var(--gold)}",
    ".pbl{font-size:10px;font-weight:600;text-transform:uppercase;color:var(--muted)} .pbv{font-size:22px;font-weight:600;color:var(--navy);margin-top:4px} .pbs{font-size:11px;color:var(--muted);margin-top:2px}",
    ".two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}",
    ".card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 2px 6px rgba(0,0,0,0.05)}",
    ".oc{background:#fff;border-radius:10px;padding:14px 18px;margin-bottom:9px;box-shadow:0 1px 4px rgba(0,0,0,0.06);cursor:pointer;border-left:3px solid transparent;transition:all 0.15s}",
    ".oc:hover{border-left-color:var(--gold)} .ot{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:4px}",
    ".om{display:flex;gap:7px;align-items:center;flex-wrap:wrap} .ob{display:inline-flex;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}",
    ".oh{background:#E8F5EE;color:var(--green)} .om2{background:#FFF8E7;color:#B8860B} .olw{background:#FDEAEA;color:#C0392B}",
    ".sbdg{font-size:10px;color:var(--muted);background:var(--warm);padding:2px 7px;border-radius:10px} .db{font-size:10px;color:var(--muted)}",
    ".mi{padding:11px 0;border-bottom:1px solid var(--warm)} .mi:last-child{border-bottom:none}",
    ".ma{font-size:10px;font-weight:600;color:var(--gold);text-transform:uppercase} .mt{font-size:12px;color:var(--text);line-height:1.5;margin-top:2px} .md{font-size:10px;color:var(--muted);margin-top:2px}",
    ".dp{background:#fff;border-radius:10px;padding:20px;box-shadow:0 2px 6px rgba(0,0,0,0.05);display:none;margin-top:20px} .dp.vis{display:block}",
    ".dtt{font-family:Cormorant Garamond,serif;font-size:20px;font-weight:600;color:var(--navy);margin-bottom:14px}",
    ".dsl{font-size:10px;font-weight:600;text-transform:uppercase;color:var(--gold);margin-bottom:6px;margin-top:14px} .dtx{font-size:12px;line-height:1.6;color:var(--text)}",
    ".ib{background:#fff;border-top:1px solid var(--warm);padding:12px 32px;display:flex;gap:10px;align-items:center;position:fixed;bottom:0;left:240px;right:0;z-index:99}",
    ".inp{flex:1;border:1px solid var(--warm);border-radius:8px;padding:9px 15px;font-size:13px;outline:none} .inp:focus{border-color:var(--gold)}",
    ".sbtn{background:var(--navy);color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer}",
    ".ra{display:none;background:var(--navy);color:rgba(255,255,255,0.9);border-radius:10px;padding:14px 18px;margin-bottom:14px;font-size:13px;line-height:1.6}",
    ".sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px} .st{font-size:10px;font-weight:600;text-transform:uppercase;color:var(--muted)}",
    ".ld{color:var(--muted);font-size:12px;font-style:italic}",
    ".coming{text-align:center;padding:80px 40px;color:var(--muted)} .coming h2{font-family:Cormorant Garamond,serif;font-size:28px;color:var(--navy);margin-bottom:10px}",
    "</style></head><body>",
    "<nav class=\"sb\"><div class=\"lg\"><h1>HGI Organism</h1><p>V2 &bull; 47 Agents Active</p></div><div class=\"nav\">",
    "<div class=\"ns\">Command</div>",
    "<div class=\"ni act\" onclick=\"sv(this,'dash')\"><span class=\"dot\"></span>Dashboard</div>",
    "<div class=\"ni\" onclick=\"sv(this,'pipe')\"><span class=\"dot\"></span>Pipeline Tracker</div>",
    "<div class=\"ns\">Intelligence</div>",
    "<div class=\"ni\" onclick=\"sv(this,'disc')\"><span class=\"dot\"></span>Opportunity Discovery</div>",
    "<div class=\"ni\" onclick=\"sv(this,'res')\"><span class=\"dot\"></span>Research &amp; Analysis</div>",
    "<div class=\"ni\" onclick=\"sv(this,'win')\"><span class=\"dot\"></span>Winnability Scoring</div>",
    "<div class=\"ns\">Proposal</div>",
    "<div class=\"ni\" onclick=\"sv(this,'prop')\"><span class=\"dot\"></span>Proposal Engine</div>",
    "<div class=\"ni\" onclick=\"sv(this,'fin')\"><span class=\"dot\"></span>Financial &amp; Pricing</div>",
    "<div class=\"ni\" onclick=\"sv(this,'staff')\"><span class=\"dot\"></span>Recruiting &amp; Bench</div>",
    "<div class=\"ns\">Operations</div>",
    "<div class=\"ni\" onclick=\"sv(this,'crm')\"><span class=\"dot\"></span>Relationship Intelligence</div>",
    "<div class=\"ni\" onclick=\"sv(this,'cont')\"><span class=\"dot\"></span>Content Engine</div>",
    "<div class=\"ni\" onclick=\"sv(this,'kb')\"><span class=\"dot\"></span>Knowledge Base</div>",
    "<div class=\"ns\">Leadership</div>",
    "<div class=\"ni\" onclick=\"sv(this,'dig')\"><span class=\"dot\"></span>Weekly Digest</div>",
    "<div class=\"ni\" onclick=\"sv(this,'exec')\"><span class=\"dot\"></span>Executive Brief</div>",
    "<div class=\"ns\">System</div>",
    "<div class=\"ni\" onclick=\"sv(this,'scan')\"><span class=\"dot\"></span>Pipeline Scanner</div>",
    "<div class=\"ni\" onclick=\"sv(this,'scr')\"><span class=\"dot\"></span>Scraper Insights</div>",
    "<div class=\"ni\" onclick=\"sv(this,'chat')\"><span class=\"dot\"></span>System Chat</div>",
    "</div><div class=\"sf\"><div class=\"sd\"></div>Organism Active &bull; 47 Agents</div></nav>",
    "<div class=\"main\">",
    "<div class=\"tb\"><div class=\"tv\" id=\"vt\">Morning Briefing</div><div class=\"tm\"><span class=\"tt\" id=\"lc\"></span><button class=\"rb\" onclick=\"rs()\">Run Session Now</button></div></div>",
    "<div class=\"ct\" id=\"mv\"><div class=\"ld\">Loading organism intelligence...</div></div></div>",
    "<div class=\"ib\"><input class=\"inp\" id=\"ci\" placeholder=\"Ask the organism anything...\" onkeydown=\"if(event.key==='Enter')sc()\"><button class=\"sbtn\" onclick=\"sc()\">Send</button></div>"
  ].join("");
  d += "<script>var B=window.location.origin,pp=[],mm=[],so=null;";
  d += "function ut(){var n=new Date(),el=document.getElementById('lc');if(el)el.textContent=n.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' '+n.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}setInterval(ut,1000);ut();";
  d += "function opc(o){var pi=o.opi_score||0,pc=pi>=80?'oh':pi>=65?'om2':'olw',dd=o.due_date?new Date(o.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';return '<div class=\"oc\" onclick=\"selO('+JSON.stringify(o.id)+')\">'+'<div class=\"ot\">'+( o.title||'')+'</div>'+'<div class=\"om\"><span class=\"ob '+pc+'\">OPI '+pi+'</span><span class=\"sbdg\">'+( o.stage||'identified')+'</span>'+(dd&&o.stage!=='submitted'&&o.stage!=='watching'?'<span class=\"db\">Due '+dd+'</span>':o.stage==='submitted'?'<span class=\"db\">Submitted</span>':o.stage==='watching'?'<span class=\"db\">Watching</span>':'')+'</div></div>';}";
  d += "function selO(id){var o=pp.find(function(p){return p.id===id;});if(!o)return;so=o;var dp=document.getElementById('det');if(!dp)return;dp.className='dp vis';dp.innerHTML='<div class=\"dtt\">'+o.title+'</div>';dp.scrollIntoView({behavior:'smooth',block:'nearest'});}";
  d += "function rd(brief){var t1=pp.filter(function(o){return o.opi_score>=75;}).length,pur=pp.filter(function(o){return o.stage==='pursuing'||o.stage==='proposal';}).length,bt=brief||'The organism is working across '+pp.length+' active opportunities. '+t1+' are Tier 1 (OPI 75+). '+pur+' in pursuit or proposal stage.',mv=document.getElementById('mv');if(!mv)return;mv.innerHTML='<div class=\"bc\"><div class=\"bl\">Morning Briefing</div><div class=\"bt\">'+(function(s){s=(s||'').replace(/^DASHBOARD:\s*/,'');s=s.replace(/#+\s*([^\n]+)/g,'<b>$1</b>');s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');s=s.replace(/\n-{3,}\n/g,'<hr>');s=s.replace(/\n[-*]\s+/g,'<br>• ');s=s.replace(/\n/g,'<br>');return s.slice(0,2000);})(bt)+'</div><div class=\"bm\">47 agents active</div></div>'+'<div class=\"ps\"><div class=\"pb\"><div class=\"pbl\">Active Opps</div><div class=\"pbv\">'+pp.length+'</div></div><div class=\"pb\"><div class=\"pbl\">Tier 1 OPI 75+</div><div class=\"pbv\">'+t1+'</div></div><div class=\"pb\"><div class=\"pbl\">In Pursuit</div><div class=\"pbv\">'+pur+'</div></div></div>'+'<div class=\"two\"><div><div class=\"sh\"><div class=\"st\">Active Pipeline</div></div>'+pp.map(opc).join('')+'</div><div><div class=\"sh\"><div class=\"st\">Organism Activity</div></div><div class=\"card\" style=\"max-height:480px;overflow-y:auto\">'+mm.slice(0,15).map(function(m){return'<div class=\"mi\"><div class=\"ma\">'+m.agent+'</div><div class=\"mt\">'+m.observation.slice(0,160)+'</div></div>';}).join('')+'</div></div></div>'+'<div id=\"det\" class=\"dp\"></div><div id=\"ra\" class=\"ra\"></div>'}";
  d += "function la(){Promise.all([fetch(B+'/api/pipeline').then(function(r){return r.json();}),fetch(B+'/api/memories').then(function(r){return r.json();}),fetch(B+'/api/briefing').then(function(r){return r.json();})]).then(function(res){pp=res[0]||[];mm=res[1]||[];rd((res[2]||{}).briefing);}).catch(function(e){var mv=document.getElementById('mv');if(mv)mv.innerHTML='<div class=\"ld\">Error: '+e.message+'</div>';});}";
  d += "function sv(el,v){document.querySelectorAll('.ni').forEach(function(n){n.classList.remove('act');});el.classList.add('act');var vt=document.getElementById('vt');if(vt)vt.textContent={dash:'Morning Briefing',pipe:'Pipeline Tracker',disc:'Opportunity Discovery',res:'Research & Analysis',win:'Winnability Scoring',prop:'Proposal Engine',fin:'Financial & Pricing',staff:'Recruiting & Bench',crm:'Relationship Intelligence',cont:'Content Engine',kb:'Knowledge Base',dig:'Weekly Digest',exec:'Executive Brief',scan:'Pipeline Scanner',scr:'Scraper Insights',chat:'System Chat'}[v]||v;if(v==='dash'){la();return;}var mv=document.getElementById('mv');if(v==='pipe'){if(mv)mv.innerHTML=pp.map(opc).join('')+'<div id=\"det\" class=\"dp\" style=\"margin-top:20px\"></div>';return;}if(mv)mv.innerHTML='<div class=\"coming\"><h2>Coming in Phase 2</h2><p>This module is being built in the next sprint.</p></div>';}";
  d += "function rs(){var btn=document.querySelector('.rb');if(btn){btn.textContent='Running...';btn.disabled=true;}fetch(B+'/run-session',{method:'POST'}).then(function(){if(btn){btn.textContent='Done!';setTimeout(function(){btn.textContent='Run Session Now';btn.disabled=false;},3000);}}).catch(function(){if(btn){btn.textContent='Error';btn.disabled=false;}});}";
  d += "function sc(){var inp=document.getElementById('ci'),msg=inp?inp.value.trim():'';if(!msg)return;if(inp)inp.value='';var ra=document.getElementById('ra');if(!ra)return;ra.style.display='block';ra.textContent='Thinking...';fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:800,system:'You are the HGI Organism, 47 agents as one brain for HGI Global. Be direct and strategic.',messages:[{role:'user',content:msg}]})}).then(function(r){return r.json();}).then(function(d){var t=(d.content||[]).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');if(ra)ra.textContent=t||'No response.';}).catch(function(e){if(ra)ra.textContent='Error: '+e.message;});}";
  d += "la();<\/script></body></html>";
  return d;
}


var HGI = 'HGI Global (Hammerman and Gainer LLC). ~95 years. 100pct minority-owned. 67 FT + 43 contract professionals. SAM UEI: DL4SJEVKZ6H4. ' +
  'Insurance: $5M fidelity bond, $5M E+O, $2M GL. ' +
  'Verticals: Disaster Recovery, TPA/Claims, Property Tax Appeals, Workforce/WIOA, Construction Management, Program Administration, Housing/HUD, Grant Management. ' +
  'Past perf (use exact figures, never inflate): Road Home $67M direct/$13B+ program (2006-2015), HAP $950M, Restore Louisiana $42.3M, Rebuild NJ $67.7M, TPSD $2.96M COMPLETED 2022-2025 (PAST TENSE ONLY - never call active or current), St. John Sheriff $788K, BP GCCF $1.65M (2010-2013). ' +
  'NO current FEMA PA contract. NO current direct federal contract. All work through state/local/housing agencies. ' +
  'Named staff: Louis Resweber (Program Director), Berron (PA SME), April Gloston (HM Specialist), Klunk (Financial/Grant Specialist), Wiltz (Documentation Manager), Julie Lawson (PM). ' +
  'Rates (fully burdened/hr): Principal $220, Program Director $210, SME $200, Sr Grant Mgr $180, Grant Mgr $175, Sr PM $180, PM $155, Grant Writer $145, Architect/Engineer $135, Cost Estimator $125, Appeals Specialist $145, Sr Damage Assessor $115, Damage Assessor $105, Admin Support $65. ' +
  'CRITICAL: Never fabricate staff counts beyond what is confirmed. Never state TPSD is active or current. Never claim a federal contract exists.';

// ── AGENT 1: INTELLIGENCE ENGINE ──────────────────────────────────
async function agentIntelligence(opp, ctx) {
  log('INTEL: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nCOMP INTEL STORE:\n' + ctx.compText +
    '\n\nRELATIONSHIPS:\n' + ctx.relText +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,1000) +
    '\n\nMISSION: (1) Named competitors most likely to bid and why each is a threat (2) Incumbent if known (3) Agency procurement patterns (4) HGI strongest angle (5) Intelligence gaps (6) Single highest-leverage action THIS WEEK (7) Updated PWIN 0-100pct. Be specific. Real money on the line.';
  var out = await claudeCall('You are HGI Intelligence Engine, agent 1 of 47. Competitive analyst. Your findings compound across all 46 others. Every competitor weakness you identify becomes a proposal differentiation strategy. Every pricing pattern you surface becomes the cost exhibit foundation. Your output is the raw material the Proposal Writer turns into a winning bid. Never fabricate.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('INTEL complete: ' + out.length + ' chars');
  await storeMemory('intelligence_engine', opp.id, (opp.agency||'') + ',competitive_intel', 'INTEL - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'competitive_intel');
  await supabase.from('opportunities').update({ research_brief: out.slice(0,60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'intelligence_engine', opp: opp.title, chars: out.length };
}

// ── AGENT 2: FINANCIAL ANALYST ────────────────────────────────────
async function agentFinancial(opp, ctx) {
  log('FINANCIAL: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nCOMP INTEL (includes pricing data from Intelligence Engine):\n' + ctx.compText +
    '\n\nMEMORY (includes Intel Engine findings):\n' + ctx.memText.slice(0,1200) +
    '\n\nMISSION: (1) Real comparable contract award amounts - name agency, amount, period, scope (2) Does our current estimated value match market reality? (3) Price-to-win recommendation based on competitive field (4) Three independent pricing methods with visible math - staffing-based, comp-based, pct-of-program (5) LOW/MID/HIGH range clearly labeled (6) Base period only - option years shown separately as upside (7) Any pricing risks for this specific agency type.';
  var out = await claudeCall('You are HGI Financial Agent, agent 2 of 47. Your pricing benchmarks and three-method visible math model become the proposal cost exhibit. You determine whether HGI bids at, above, or below market for this specific evaluator. Without your numbers the proposal has no pricing section. CFO-level analyst. You read what the Intelligence Engine found and build on it. Show your math. Never fabricate dollar amounts.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('FINANCIAL complete: ' + out.length + ' chars');
  await storeMemory('financial_agent', opp.id, (opp.agency||'') + ',pricing_benchmark', 'FINANCIAL - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'pricing_benchmark');
  await supabase.from('opportunities').update({ financial_analysis: out.slice(0,60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'financial_agent', opp: opp.title, chars: out.length };
}

// ── AGENT 3: WINNABILITY ──────────────────────────────────────────
async function agentWinnability(opp, ctx) {
  log('WINNABILITY: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nINTEL ENGINE FINDINGS (read before scoring):\n' + ctx.memText.slice(0,1000) +
    '\n\nFINANCIAL ANALYSIS:\n' + (opp.financial_analysis||'not yet available').slice(0,400) +
    '\n\nMISSION: You are HGI Winnability Agent, agent 3 of 47. Senior BD director with real budget on the line. Every PWIN action you recommend is a specific proposal improvement. Your competitive positioning matrix shapes how the proposal differentiates from IEM, CDR Maguire, and Tetra Tech. PWIN under 45% means the proposal needs structural changes before submission. (1) Score HGI against each eval criterion vs ACTUAL named competitors from intel findings (2) What specific weaknesses in the current pursuit would cost the most points (3) What would flip this to NO-BID? What would raise PWIN by 10+ points? (4) Are we priced to win given the competitive field? (5) FINAL: PWIN X pct | GO / CONDITIONAL GO / NO-BID | EVERY action that would increase PWIN ranked by impact.';
  var out = await claudeCall('You are HGI Winnability Agent, agent 3 of 47. Senior BD director. You read Intel and Financial findings and make the real bid decision. Be ruthless and specific.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('WINNABILITY complete: ' + out.length + ' chars');
  await storeMemory('winnability_agent', opp.id, (opp.agency||'') + ',winnability,pwin', 'WINNABILITY - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'winnability');
  await supabase.from('opportunities').update({ capture_action: out.slice(0,60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'winnability_agent', opp: opp.title, chars: out.length };
}

// ── AGENT 4: CRM / RELATIONSHIP ───────────────────────────────────
async function agentCRM(opp, ctx) {
  log('CRM: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nRELATIONSHIP GRAPH:\n' + ctx.relText +
    '\n\nINTEL FINDINGS:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: (1) Named decision-makers - who evaluates and awards this contract (2) Relationship status - do we know anyone at this agency? How warm? (3) Who specifically at HGI should call or email this week - name, role, what to say, what outcome to drive (4) Cross-agency connections - do we know anyone who knows someone here (5) Best outreach approach given agency culture and procurement stage (6) What relationship move would most improve our competitive position before deadline.';
  var out = await claudeCall('You are HGI CRM Agent, agent 4 of 47. Your intel feeds the transmittal letter. A warm relationship with the evaluator is the most powerful proposal advantage in government contracting. Zero relationships means the proposal lands cold. Every contact you warm before submission is worth more than any written section. Relationship intelligence specialist. You find the humans behind the procurement and tell HGI exactly who to call and what to say.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('CRM complete: ' + out.length + ' chars');
  await storeMemory('crm_agent', opp.id, (opp.agency||'') + ',contacts,relationship', 'CRM - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'relationship');
  try {
    await supabase.from('relationship_graph').insert({ id: 'crm-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), organization: opp.agency||'', notes: out.slice(0,1500), relationship_strength: 'cold', source_agent: 'crm_agent', opportunity_id: opp.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  } catch(e) {}
  return { agent: 'crm_agent', opp: opp.title, chars: out.length };
}

// ── AGENT 5: QUALITY GATE ─────────────────────────────────────────
async function agentQualityGate(opp, ctx) {
  if ((opp.staffing_plan||'').length < 100 && (opp.scope_analysis||'').length < 200) return null;
  log('QUALITY GATE: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nPROPOSAL DRAFT (if exists):\n' + (opp.staffing_plan||'No proposal draft yet').slice(0,20000) +
    '\n\nWINNABILITY FINDINGS:\n' + (opp.capture_action||'').slice(0,400) +
    '\n\nMISSION: Score this pursuit like an evaluator. (1) For EACH eval criterion in the scope analysis, score current state 1-10 and state specifically what would raise it (2) Every RFP requirement NOT yet addressed by name (3) Required positions - named with real people and rates, or TBD placeholder? (4) Past performance - 3 refs with full contact info? Relevance to THIS RFP stated? (5) Required exhibits/forms - complete, missing, needs signature? (6) VERDICT: Estimated score out of 100 | GO/CONDITIONAL GO/NO-GO | ALL deficiencies ranked by point impact.';
  var out = await claudeCall('You are HGI Quality Gate Agent, agent 5 of 47. Your compliance audit IS the proposal compliance matrix exhibit. Every gap you find is a potential automatic disqualification before scoring begins. Missing items do not cost points — they end the pursuit before the evaluator reads a single word. Senior proposal compliance reviewer. You score proposals like an evaluator would. Be ruthless. Name the section, name the gap, name the points at risk.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('QUALITY GATE complete: ' + out.length + ' chars');
  await storeMemory('quality_gate', opp.id, (opp.agency||'') + ',quality_gate,compliance', 'QUALITY GATE - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'analysis');
  return { agent: 'quality_gate', opp: opp.title, chars: out.length };
}

// ── AGENT 6: SELF-AWARENESS (runs last, sees everything) ──────────
async function agentSelfAwareness(state, sessionResults, ctx) {
  log('SELF-AWARENESS: analyzing full session output...');
  var resultsSummary = sessionResults.map(function(r) { return (r ? r.agent + ' completed ' + r.chars + ' chars on ' + (r.opp||'?').slice(0,40) : 'agent skipped'); }).join('\n');
  var prompt = HGI +
    '\n\nSESSION RESULTS (all agents that just ran):\n' + resultsSummary +
    '\n\nPIPELINE STATUS:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' OPI:' + o.opi_score + ' ' + (o.stage||'?'); }).join('\n') +
    '\n\nACCUMULATED MEMORY (' + state.memories.length + ' total):\n' + ctx.memText.slice(0,1500) +
    '\n\nMISSION: You see the full picture - every agent result, every memory, every opportunity. (1) What patterns are emerging across all opportunities that individual agents missed? (2) Which agents produced highest-value intelligence this session? (3) What single improvement to the organism would most improve HGI win rates? (4) What data gaps are costing HGI the most right now? (5) Any contradictions between agents - where did Intel and Winnability disagree? (6) The one thing Christopher must do this week to most improve competitive position across the entire pipeline.';
  var out = await claudeCall('You are HGI Self-Awareness Engine, agent 6 of 47. You run last and see everything all 46 other agents produced. Your single highest-leverage improvement recommendation must always be framed in terms of what would most improve the next proposal — not system hygiene in the abstract, but what specifically makes the next submission score higher. You identify patterns no individual agent can see. You are the organism reflecting on itself.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('SELF-AWARENESS complete: ' + out.length + ' chars');
  await storeMemory('self_awareness', null, 'system_health,self_assessment,patterns', 'SELF-AWARENESS SESSION COMPLETE:\n' + out, 'pattern');
  return { agent: 'self_awareness', chars: out.length };
}


// ── AGENT 7: DISCOVERY AGENT ──────────────────────────────────────
async function agentDiscovery(state, ctx) {
  log('DISCOVERY: scanning for pre-solicitation signals...');
  var oppSummary = state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | ' + (o.vertical||'') + ' | OPI:' + o.opi_score; }).join('\n');
  var prompt = HGI + '\n\nACTIVE PIPELINE:\n' + oppSummary + '\n\nMEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: (1) Pre-solicitation signals - budget appropriations, agency announcements suggesting upcoming RFPs in HGI verticals (2) Sources HGI is NOT monitoring that carry procurement in disaster recovery, TPA/claims, workforce, housing, grant management (3) Agencies in LA/TX/FL/MS/AL/GA with expiring contracts in HGI verticals - prime recompete targets (4) FEMA disaster declarations in last 30 days that will generate recovery procurement (5) Market signals - budget cycles, legislative action, federal funding announcements that predict future HGI opportunities (6) Single highest-value new opportunity source HGI should add right now.';
  var out = await claudeCall('You are HGI Discovery Agent, agent 7 of 47. Every signal you surface is a pre-solicitation window — time to build relationships, shape the procurement, and position HGI before competitors know an RFP is coming. Early positioning is the most powerful proposal advantage that cannot be written in on submission day. You find what is coming before it is posted. Your findings feed every other agent.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('DISCOVERY complete: ' + out.length + ' chars');
  await storeMemory('discovery_agent', null, 'discovery,pre_solicitation,market_signals', 'DISCOVERY:\n' + out, 'pattern');
  return { agent: 'discovery_agent', chars: out.length };
}

// ── AGENT 8: PIPELINE SCANNER ─────────────────────────────────────
async function agentPipelineScanner(state, ctx) {
  log('PIPELINE SCANNER: health check...');
  var today = new Date();
  var health = state.pipeline.map(function(o) {
    var daysLeft = o.due_date ? Math.ceil((new Date(o.due_date) - today) / 86400000) : null;
    return (o.title||'?').slice(0,50) + ' | Stage:' + (o.stage||'?') + ' | Days:' + (daysLeft !== null ? daysLeft : 'unknown') + ' | OPI:' + o.opi_score + ' | Proposal:' + (o.staffing_plan||'').length + 'chars';
  }).join('\n');
  var prompt = HGI + '\n\nPIPELINE STATUS:\n' + health + '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: (1) Flag any opportunity within 14 days of deadline without complete proposal (2) Flag any GO opportunity stuck in same stage 7+ days (3) OPI scores inconsistent with what organism now knows (4) Deadline conflicts where two opportunities require simultaneous proposal work (5) Pipeline health score 1-10 with reasoning (6) Single most urgent action to prevent missed deadline or lost opportunity.';
  var out = await claudeCall('You are HGI Pipeline Scanner, agent 8 of 47. Your alerts ensure no proposal submission window closes without HGI attempting it. A missed deadline is a lost contract — the proposal that never got submitted. Deadline management is proposal management. You watch deadlines and anomalies. You flag everything needing immediate action.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('PIPELINE SCANNER complete: ' + out.length + ' chars');
  await storeMemory('pipeline_scanner', null, 'pipeline_health,deadlines', 'PIPELINE SCANNER:\n' + out, 'analysis');
  return { agent: 'pipeline_scanner', chars: out.length };
}

// ── AGENT 9: OPI CALIBRATION ──────────────────────────────────────
async function agentOPICalibration(state, ctx) {
  log('OPI CALIBRATION: reviewing scores...');
  var oppList = state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | ' + (o.vertical||'') + ' | Stage:' + (o.stage||'?') + ' | Proposal:' + (o.staffing_plan||'').length + 'chars'; }).join('\n');
  var prompt = HGI + '\n\nOPPORTUNITIES WITH CURRENT OPI SCORES:\n' + oppList + '\n\nINTELLIGENCE AND WINNABILITY FINDINGS:\n' + ctx.memText.slice(0,1500) +
    '\n\nMISSION: Based on everything the organism now knows, (1) For each opportunity - does current OPI reflect full competitive picture? Recommend adjustment with specific reasoning (2) Which OPI factors are consistently over/under-weighted (3) Single addition to OPI scoring model that would most improve accuracy (4) Any opportunity that should be escalated to NO-BID based on what agents found today.';
  var out = await claudeCall('You are HGI OPI Calibration Agent, agent 9 of 47. Your calibration determines which opportunities get full proposal effort and which get passed. Accurate OPI means HGI puts its proposal resources into winnable contracts and does not waste BD investment on long shots. You refine scoring accuracy. Every recalibration makes future scoring smarter.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('OPI CALIBRATION complete: ' + out.length + ' chars');
  await storeMemory('scanner_opi', null, 'opi_calibration,scoring', 'OPI CALIBRATION:\n' + out, 'pattern');
  return { agent: 'scanner_opi', chars: out.length };
}

// ── AGENT 10: CONTENT ENGINE ──────────────────────────────────────
async function agentContentEngine(state, ctx) {
  log('CONTENT ENGINE: analyzing proposal language...');
  var drafts = state.pipeline.filter(function(o) { return (o.staffing_plan||'').length > 200; }).map(function(o) { return (o.title||'?').slice(0,40) + ':\n' + (o.staffing_plan||'').slice(0,400); }).join('\n\n---\n\n');
  if (!drafts) { log('CONTENT ENGINE: no drafts to review'); return null; }
  var prompt = HGI + '\n\nPROPOSAL DRAFT EXCERPTS:\n' + drafts +
    '\n\nMISSION: (1) Which sections have strongest evaluator-ready language and why (2) Which sections read like generic AI output - rewrite them specifically (3) Domain-specific terminology each proposal should be using but is not (4) Before/after rewrites for every passage needing improvement (5) Flag every passive voice sentence and rewrite it (6) Single highest-impact language improvement across all drafts.';
  var out = await claudeCall('You are HGI Content Engine, agent 10 of 47. Your voice library is how every future proposal sounds. You enforce active voice, evidence-backed claims, and HGI-specific proof points. When you rewrite a sentence you are directly improving the proposal score. You make every sentence the most persuasive evaluator-friendly language possible. You optimize for scores not style.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('CONTENT ENGINE complete: ' + out.length + ' chars');
  await storeMemory('content_engine', null, 'voice,style,proposal_language', 'CONTENT ENGINE:\n' + out, 'pattern');
  return { agent: 'content_engine', chars: out.length };
}

// ── AGENT 11: RECRUITING AND BENCH ───────────────────────────────
async function agentRecruiting(state, ctx) {
  log('RECRUITING: staffing gap analysis...');
  var oppCtx = state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | ' + (o.vertical||'') + ' | Stage:' + (o.stage||'') + ' | Due:' + (o.due_date||'TBD'); }).join('\n');
  var prompt = HGI + '\n\nACTIVE PURSUITS:\n' + oppCtx +
    '\n\nHGI NAMED STAFF: Louis Resweber (Program Director), Berron (PA SME), April Gloston (HM Specialist), Klunk (Financial/Grant), Wiltz (Documentation Manager).' +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: (1) For each pursuit - required positions vs available named staff, identify gaps (2) Where teaming is needed (3) Recurring gaps across multiple pursuits simultaneously (4) Certifications or qualifications HGI lacks that cost points (5) Single recruiting or teaming action before next deadline (6) Any pursuit where staffing gap alone should trigger NO-BID.';
  var out = await claudeCall('You are HGI Recruiting and Bench Agent, agent 11 of 47. Every staffing gap you fill is a proposal weakness eliminated. Named personnel with real qualifications beats TBD every time. You go to market to find candidates so the proposal has real names, not placeholders. You track staffing gaps before they block bids. You flag before it is too late.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('RECRUITING complete: ' + out.length + ' chars');
  await storeMemory('recruiting_bench', null, 'staffing,bench,gaps', 'RECRUITING:\n' + out, 'analysis');
  return { agent: 'recruiting_bench', chars: out.length };
}

// ── AGENT 12: KNOWLEDGE BASE AGENT ───────────────────────────────
async function agentKnowledgeBase(state, ctx) {
  log('KB AGENT: gap analysis...');
  var verticals = state.pipeline.map(function(o) { return o.vertical || 'unknown'; }).join(', ');
  var prompt = HGI + '\n\nACTIVE PIPELINE VERTICALS: ' + verticals +
    '\n\nKB STATUS: 21 docs, 350+ chunks. Strong: GOHSEP(149), TPCIGA(94), HTHA v4(22). Weak: 6 image-PDFs minimal extraction, 2 docx zero chunks.' +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: (1) Which pursuits are weakest on KB-supported past performance (2) HGI business lines with NO KB coverage - mediation, settlement admin, staff aug, call centers, DEI (3) Critical past performance documentation missing across verticals (4) Technical methodology gaps hurting proposal quality now (5) Single document Lou Resweber should send next and exactly what gap it fills (6) KB health score 1-10 for each active pursuit vertical.';
  var out = await claudeCall('You are HGI Knowledge Base Agent, agent 12 of 47. KB gaps are proposal scoring risks. When the organism has no documentation for a required methodology the proposal cannot prove its claims to evaluators. Every document you ingest is ammunition for the next proposal. Every gap you identify is a specific proposal weakness that must be addressed before submission. You identify missing institutional knowledge. Every gap you find and fill makes future proposals stronger.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('KB AGENT complete: ' + out.length + ' chars');
  await storeMemory('knowledge_base_agent', null, 'kb_gaps,kb_health', 'KB AGENT:\n' + out, 'pattern');
  return { agent: 'knowledge_base_agent', chars: out.length };
}

// ── AGENT 13: SCRAPER INSIGHTS ────────────────────────────────────
async function agentScraperInsights(state, ctx) {
  log('SCRAPER INSIGHTS: source analysis...');
  var sourceBreakdown = state.pipeline.map(function(o) { return (o.title||'?').slice(0,40) + ' | Source:' + (o.source||'unknown') + ' | OPI:' + o.opi_score; }).join('\n');
  var prompt = HGI + '\n\nPIPELINE BY SOURCE:\n' + sourceBreakdown +
    '\n\nACTIVE SOURCES: Central Bidding (8AM+8PM CST), LaPAC (every 6min), SAM.gov (every 12hr), Grants.gov (4x daily).' +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,500) +
    '\n\nMISSION: (1) Which sources produce GO-quality vs noise (2) Source gaps - portals in LA/TX/FL/MS/AL/GA carrying HGI vertical work not currently monitored (3) Keyword gaps causing HGI business lines to generate zero results (4) Any source showing degradation signs (5) Single highest-ROI new source to add given active pipeline verticals.';
  var out = await claudeCall('You are HGI Scraper Insights Agent, agent 13 of 47. Source health directly determines proposal volume. If Central Bidding goes down or LaPAC stops yielding the proposal pipeline dries up. You protect the organism from source failures and identify where new proposal opportunities are being missed. You track source yield and identify where opportunities are being missed.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('SCRAPER INSIGHTS complete: ' + out.length + ' chars');
  await storeMemory('scraper_insights', null, 'scraper_health,source_roi', 'SCRAPER INSIGHTS:\n' + out, 'pattern');
  return { agent: 'scraper_insights', chars: out.length };
}

// ── AGENT 14: EXECUTIVE BRIEF ─────────────────────────────────────
async function agentExecutiveBrief(state, ctx) {
  log('EXECUTIVE BRIEF: preparing for Lou and Larry...');
  var pipelineSummary = state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | Due:' + (o.due_date||'TBD') + ' | Stage:' + (o.stage||'?'); }).join('\n');
  var prompt = HGI + '\n\nPIPELINE:\n' + pipelineSummary + '\n\nINTELLIGENCE THIS SESSION:\n' + ctx.memText.slice(0,1500) +
    '\n\nMISSION: Brief Lou Resweber (CEO) and Larry Oney (Chairman). Concise. No noise. Decisions not status. (1) Pipeline summary - total opps, combined estimated value, realistic win probability weighted by OPI (2) Decisions needed from Lou or Larry this week specifically - name decision, deadline, stakes (3) Opportunities needing executive-level relationship intervention (4) Where HGI is most likely to win this quarter and why (5) Single biggest risk to revenue right now (6) What needs their visibility that has not been surfaced yet.';
  var out = await claudeCall('You are HGI Executive Brief Agent, agent 14 of 47. Your briefings give Lou and Larry the context to provide relationship intelligence that feeds proposal strategy. When Lou knows someone at a target agency that becomes the transmittal letter. Leadership intelligence is proposal intelligence. You brief the CEO and Chairman. Concise. Actionable. Every word earns its place.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('EXECUTIVE BRIEF complete: ' + out.length + ' chars');
  await storeMemory('executive_brief_agent', null, 'executive_brief,digest', 'EXECUTIVE BRIEF:\n' + out, 'analysis');
  return { agent: 'executive_brief_agent', chars: out.length };
}

// ── AGENT 15: PROPOSAL WRITER ─────────────────────────────────────
async function agentProposalWriter(opp, ctx) {
  if ((opp.staffing_plan||'').length < 300) return null;
  log('PROPOSAL WRITER: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nCURRENT PROPOSAL DRAFT:\n' + (opp.staffing_plan||'').slice(0,20000) +
    '\n\nQUALITY GATE AND INTEL CONTEXT:\n' + ctx.memText.slice(0,600) +
    '\n\nCRITICAL ACCURACY RULES — VIOLATIONS DISQUALIFY THE PROPOSAL:\n' +
    '- TPSD (Terrebonne Parish School District) contract was COMPLETED 2022-2025. Never write it as active or current.\n' +
    '- No current direct federal contract exists. Do not claim one.\n' +
    '- Staff counts: use only confirmed numbers (67 FT + 43 contract). Do not inflate.\n' +
    '- All rates must match the HGI rate card exactly. Do not invent rates.\n' +
    '- Named personnel must come from the confirmed HGI staff list. No invented names.\n' +
    '\n\nMISSION: Rewrite the weakest sections into submission-ready language. (1) Score each section 1-10 against the eval criterion (2) For EVERY section scoring below 8: write the complete improved section — full paragraphs, not notes or descriptions (3) Use FEMA PA, CDBG-DR, HMGP domain terminology precisely (4) Every claim must reference specific HGI past performance with dollar amounts (5) Show why HGI beats the named competitors on each criterion (6) Output improved sections in order — do not just describe what should change, write it.';
  var out = await claudeCall('You are HGI Proposal Writer, agent 15 of 47. You ARE the proposal. Every other agent exists to feed you. You take competitive intel, pricing benchmarks, relationship context, staffing assignments, KB evidence, and quality gate findings — and turn them into submission-ready sections that score maximum points on each evaluation criterion. Best language wins regardless of source. You write complete submission-ready proposal sections. Never fabricate facts, staff, or contract values. TPSD is completed 2022-2025, never active. Write to win with verified facts.', prompt, 8000);
  if (!out || out.length < 100) return null;
  log('PROPOSAL WRITER complete: ' + out.length + ' chars');
  await storeMemory('proposal_agent', opp.id, (opp.agency||'') + ',proposal_improvement', 'PROPOSAL WRITER - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'pattern');
  return { agent: 'proposal_agent', opp: opp.title, chars: out.length };
}


// ── AGENT 16: RED TEAM ────────────────────────────────────────────
async function agentRedTeam(opp, ctx) {
  if ((opp.staffing_plan||'').length < 300) return null;
  log('RED TEAM: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nPROPOSAL DRAFT TO ATTACK:\n' + (opp.staffing_plan||'').slice(0,20000) +
    '\n\nCOMPETITOR CONTEXT:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: You are HGI Red Team Agent, agent 16 of 47. You ARE the evaluation committee for a competitor firm. Your score is the proposal estimated evaluation outcome before it reaches the real committee. Every weakness you find before submission is a weakness that can be fixed. Every weakness you miss is points lost on evaluation day. Your job is to find every reason NOT to select HGI. ' +
    '(1) Score each section as a skeptical evaluator would - where do you find weaknesses, vague claims, unsubstantiated assertions ' +
    '(2) Where does the proposal make claims it cannot back up with evidence ' +
    '(3) What questions would you ask in an oral presentation to expose weaknesses ' +
    '(4) Where does the technical approach feel generic or copied vs tailored to this specific agency ' +
    '(5) What would CDR Maguire or Tetra Tech write in their proposal that would score higher on each criterion ' +
    '(6) The three most fatal weaknesses that would cause an evaluator to rank HGI below a competitor.';
  var out = await claudeCall('You are HGI Red Team Agent, agent 16 of 47. You attack HGI proposals from the evaluator perspective. You find weaknesses before competitors do. Ruthless. Specific. No mercy.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('RED TEAM complete: ' + out.length + ' chars');
  await storeMemory('red_team', opp.id, (opp.agency||'') + ',red_team,adversarial', 'RED TEAM - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'analysis');
  return { agent: 'red_team', opp: opp.title, chars: out.length };
}

// ── AGENT 17: BRIEF AGENT ─────────────────────────────────────────
async function agentBrief(opp, ctx) {
  if ((opp.stage||'') !== 'proposal' && (opp.stage||'') !== 'pursuing') return null;
  log('BRIEF: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nCURRENT INTEL AND WINNABILITY:\n' + (opp.research_brief||'').slice(0,600) + '\n' + (opp.capture_action||'').slice(0,400) +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Team briefing for the HGI pursuit team. Functional roles only, never personal names in the brief. ' +
    '(1) Where we stand - proposal status, key gaps still open right now ' +
    '(2) What changed since last brief based on new intelligence ' +
    '(3) Open items that must be resolved before submission with owner role and deadline ' +
    '(4) What each functional role must do THIS WEEK - Program Director, PA SME, Financial Specialist, Documentation Manager, HM Specialist ' +
    '(5) Win confidence and why - honest assessment ' +
    '(6) Single most important thing the team must get right to win.';
  var out = await claudeCall('You are HGI Brief Agent, agent 17 of 47. Your team briefings ensure the humans writing, reviewing, and submitting the proposal are aligned on strategy, positioning, and what the evaluator actually cares about. A misaligned team produces a disjointed proposal. You produce clear team briefings. Functional. Actionable. Every bullet drives a specific action by a specific role.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('BRIEF complete: ' + out.length + ' chars');
  await storeMemory('brief_agent', opp.id, (opp.agency||'') + ',briefing,team', 'BRIEF - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'analysis');
  return { agent: 'brief_agent', opp: opp.title, chars: out.length };
}

// ── AGENT 18: OPPORTUNITY BRIEF (deep single-opp dossier) ─────────
async function agentOppBrief(opp, ctx) {
  log('OPP BRIEF: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nFINANCIAL ANALYSIS:\n' + (opp.financial_analysis||'').slice(0,400) +
    '\n\nWINNABILITY:\n' + (opp.capture_action||'').slice(0,400) +
    '\n\nFULL ORGANISM INTELLIGENCE ON THIS OPPORTUNITY:\n' + ctx.memText.slice(0,1500) +
    '\n\nMISSION: Produce the deepest possible single-opportunity dossier. This is the complete picture of everything the organism knows. ' +
    '(1) Everything known about this agency - budget, leadership, procurement history, relationships, past awards ' +
    '(2) Full competitive field with specific threat levels - who will beat us and exactly how ' +
    '(3) HGI strengths and vulnerabilities mapped to each eval criterion with point values ' +
    '(4) Financial picture - are we priced to win, what is market range ' +
    '(5) Relationship map - who we know, who we need to know, who could help ' +
    '(6) Critical path to submission - every remaining milestone, owner role, deadline ' +
    '(7) Honest probability of winning and what would change it.';
  var out = await claudeCall('You are HGI Opportunity Brief Agent, agent 18 of 47. Your dossier is the proposal launch pad. Every finding you synthesize about the agency, the evaluators, the competitive field, and HGI positioning feeds directly into proposal section strategy. The GO decision from your brief triggers the full proposal cascade. You produce the complete dossier on a single opportunity. Everything the organism knows synthesized into one coherent picture.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('OPP BRIEF complete: ' + out.length + ' chars');
  await storeMemory('opportunity_brief_agent', opp.id, (opp.agency||'') + ',opportunity_brief,dossier', 'OPP BRIEF - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'analysis');
  return { agent: 'opportunity_brief_agent', opp: opp.title, chars: out.length };
}

// ── AGENT 19: DISASTER DECLARATION MONITOR ────────────────────────
async function agentDisasterMonitor(state, ctx) {
  log('DISASTER MONITOR: scanning for FEMA declarations...');
  var prompt = HGI +
    '\n\nACTIVE PIPELINE:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | ' + (o.vertical||'') + ' | OPI:' + o.opi_score; }).join('\n') +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: HGI is a disaster recovery firm with $13B+ in program management experience. FEMA disaster declarations are our top lead source. ' +
    '(1) Any new FEMA major disaster declarations in LA/TX/FL/MS/AL/GA in the last 30 days - DR number, state, declaration date, disaster type, estimated damage ' +
    '(2) For each declaration - timeline for when recovery procurement will be issued (typically 90-180 days after declaration) ' +
    '(3) Which HGI services would be needed - FEMA PA Cat A-G, HMGP 404/406, IA, CDBG-DR, financial compliance ' +
    '(4) Who is the state recovery office contact for each declaration ' +
    '(5) Any incumbent contractors likely to be in place that HGI must displace ' +
    '(6) Priority ranking of declarations by HGI opportunity value - which should we pursue first and why.';
  var out = await claudeCall('You are HGI Disaster Declaration Monitor, agent 19 of 47. Each FEMA declaration is a pre-solicitation window — CDBG-DR and FEMA PA contracts follow within months. Early positioning before the RFP drops is the most powerful proposal advantage. You alert HGI so relationships can be built and technical approaches drafted before competitors know the procurement exists. FEMA declarations are your primary signal. You track them in real time and brief HGI immediately when recovery procurement is approaching.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('DISASTER MONITOR complete: ' + out.length + ' chars');
  await storeMemory('disaster_monitor', null, 'fema,disaster_declaration,recovery_procurement', 'DISASTER MONITOR:\n' + out, 'pattern');
  return { agent: 'disaster_monitor', chars: out.length };
}

// ── AGENT 20: DASHBOARD AGENT (morning briefing) ──────────────────
async function agentDashboard(state, ctx) {
  log('DASHBOARD: morning briefing for Christopher...');
  var pipelineHealth = state.pipeline.map(function(o) {
    return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | Stage:' + (o.stage||'?') + ' | Due:' + (o.due_date||'?');
  }).join('\n');
  var prompt = HGI +
    '\n\nPIPELINE (' + state.pipeline.length + ' opportunities):\n' + pipelineHealth +
    '\n\nORGANISM BRAIN (' + state.memories.length + ' accumulated memories):\n' + ctx.memText.slice(0,1500) +
    '\n\nMISSION: Morning briefing for Christopher Oney (President). He reviews this first thing each day. Give him exactly what he needs to make decisions - nothing more. ' +
    '(1) Organism health - is everything running, any agent failures, any data quality issues ' +
    '(2) Which opportunities need Christopher today vs running fine autonomously ' +
    '(3) Single most important thing Christopher must do today for the pipeline ' +
    '(4) Biggest competitive threat that emerged overnight ' +
    '(5) Any opportunity where the organism recommends changing stage or priority ' +
    '(6) What the organism learned today that changes our strategy.';
  var out = await claudeCall('You are HGI Dashboard Agent, agent 20 of 47. Every decision you surface must connect to a proposal outcome — deadlines approaching, compliance gaps found, relationships to warm, pricing intelligence acquired. If it does not affect a proposal it does not belong in the morning briefing. You write the morning briefing for Christopher. Crisp. Prioritized. Only what requires his attention. Everything else runs itself.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('DASHBOARD complete: ' + out.length + ' chars');
  await storeMemory('dashboard_agent', null, 'dashboard,morning_brief,christopher', 'DASHBOARD:\n' + out, 'analysis');
  return { agent: 'dashboard_agent', chars: out.length };
}

// ── AGENT 21: DESIGN VISUAL ───────────────────────────────────────
async function agentDesignVisual(state, ctx) {
  log('DESIGN VISUAL: format recommendations...');
  var proposalOpps = state.pipeline.filter(function(o) { return (o.staffing_plan||'').length > 200; });
  if (proposalOpps.length === 0) { log('DESIGN VISUAL: no proposals to review'); return null; }
  var oppList = proposalOpps.map(function(o) { return (o.title||'?').slice(0,50) + ' | Due:' + (o.due_date||'TBD') + ' | Agency:' + (o.agency||''); }).join('\n');
  var prompt = HGI +
    '\n\nACTIVE PROPOSALS:\n' + oppList +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nHGI BRAND: Gold and navy color scheme. Professional typography. Must look like a firm that manages billion-dollar programs. ' +
    '\n\nMISSION: (1) For each active proposal - specific visual structure that would impress evaluators: tables, org charts, compliance matrices, process diagrams, timeline graphics ' +
    '(2) Where in each proposal would a visual element replace 300+ words of text and score higher ' +
    '(3) Brand standards enforcement - what in the current drafts violates HGI professional standards ' +
    '(4) Visual differentiators vs the specific competitors identified in organism memory ' +
    '(5) Single highest-priority visual improvement that would move the most evaluation points.';
  var out = await claudeCall('You are HGI Design Visual Agent, agent 21 of 47. Your graphics are evaluator weapons — coverage matrices that make scoring HGI easy, deployment timelines that show readiness, org charts built from the actual staffing plan, past performance proof tiles with metrics in bold numerals. A proposal that looks professional scores higher before the evaluator reads a word. You make HGI proposals look like they came from a firm that manages billion-dollar programs. Every visual choice is a scoring decision.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('DESIGN VISUAL complete: ' + out.length + ' chars');
  await storeMemory('design_visual', null, 'visual,branding,format', 'DESIGN VISUAL:\n' + out, 'pattern');
  return { agent: 'design_visual', chars: out.length };
}

// ── AGENT 22: TEAMING PARTNER RADAR ──────────────────────────────
async function agentTeaming(state, ctx) {
  log('TEAMING: partner analysis...');
  var oppCtx = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 65; }).map(function(o) {
    return (o.title||'?').slice(0,50) + ' | ' + (o.vertical||'') + ' | OPI:' + o.opi_score + ' | Scope:' + (o.scope_analysis||'').slice(0,150);
  }).join('\n');
  var prompt = HGI +
    '\n\nACTIVE HIGH-PRIORITY PURSUITS:\n' + oppCtx +
    '\n\nRECRUITING GAPS FROM ORGANISM MEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: (1) For each active pursuit - should HGI prime, sub, or team as equals? Based on scope requirements and competitive landscape. ' +
    '(2) Specific capability gaps that require a teaming partner - name the gap, name potential firms that fill it in LA/TX/FL/MS ' +
    '(3) Certifications HGI lacks that a teaming partner could provide - 8(a), SDVOSB, WOSB, HUBZone ' +
    '(4) Competitors who might make better teaming partners than adversaries on specific pursuits ' +
    '(5) Any opportunity where NOT teaming is a competitive disadvantage ' +
    '(6) Single most valuable teaming relationship HGI should establish this quarter.';
  var out = await claudeCall('You are HGI Teaming Partner Radar, agent 22 of 47. You identify when HGI should prime vs sub vs team, and who the right partners are. You turn competitors into force multipliers.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('TEAMING complete: ' + out.length + ' chars');
  await storeMemory('teaming_agent', null, 'teaming,partners,certifications', 'TEAMING:\n' + out, 'pattern');
  return { agent: 'teaming_agent', chars: out.length };
}


// ── AGENT 23: SOURCE EXPANSION ────────────────────────────────────
async function agentSourceExpansion(state, ctx) {
  log('SOURCE EXPANSION: finding new opportunity sources...');
  var verticals = [...new Set(state.pipeline.map(function(o) { return o.vertical||'unknown'; }))].join(', ');
  var prompt = HGI + '\n\nACTIVE PIPELINE VERTICALS: ' + verticals +
    '\n\nCURRENT SOURCES: Central Bidding (Louisiana), LaPAC (Louisiana), SAM.gov, Grants.gov.' +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: HGI operates in LA/TX/FL/MS/AL/GA. Identify procurement portals, agency websites, and data sources that carry HGI-vertical work that we are NOT yet monitoring. ' +
    '(1) State procurement portals in TX/FL/MS/AL/GA equivalent to LaPAC - name the portal, URL, what it carries ' +
    '(2) Insurance regulatory bodies and guaranty associations that post TPA and claims administration work ' +
    '(3) Housing authority networks and HUD portals for housing program administration work ' +
    '(4) Workforce development boards posting WIOA administration contracts ' +
    '(5) FEMA and state emergency management procurement channels beyond SAM.gov ' +
    '(6) Top 3 new sources ranked by expected HGI opportunity yield - specific URL, registration requirements, how to access.';
  var out = await claudeCall('You are HGI Source Expansion Agent, agent 23 of 47. Every new portal you identify and access is a new stream of proposals. When HGI has no Mississippi sources DR-4899 produces zero pipeline. You find where agencies post procurements HGI is not yet monitoring and build the coverage that makes the pipeline comprehensive., agent 23 of 47. You actively find new opportunity sources. You do not wait for Christopher to find them. You research, identify, and recommend.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('SOURCE EXPANSION complete: ' + out.length + ' chars');
  await storeMemory('source_expansion', null, 'source_expansion,new_portals,market_coverage', 'SOURCE EXPANSION:\n' + out, 'pattern');
  return { agent: 'source_expansion', chars: out.length };
}

// ── AGENT 24: CONTRACT EXPIRATION MONITOR ─────────────────────────
async function agentContractExpiration(state, ctx) {
  log('CONTRACT EXPIRATION: scanning for recompete opportunities...');
  var oppAgencies = state.pipeline.map(function(o) { return o.agency||''; }).filter(Boolean).join(', ');
  var prompt = HGI + '\n\nACTIVE PIPELINE AGENCIES: ' + oppAgencies +
    '\n\nKNOWN COMPETITORS: CDR Maguire, Tetra Tech/AMR, IEM, Hagerty Consulting, Tetra Tech EM.' +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Find contracts expiring in the next 6-18 months that HGI should be positioned to win. ' +
    '(1) Known competitor contracts in LA/TX/FL/MS/AL/GA in HGI verticals expiring in next 6 months - agency, incumbent, contract value, expiration date ' +
    '(2) Same for 6-18 month window - these are relationship-building targets now ' +
    '(3) HGI past performance contracts that could be recompeted - agencies that have worked with HGI before ' +
    '(4) Recompete strategy for highest-value expiring contracts - what relationship moves to make now ' +
    '(5) Single highest-value recompete target HGI should begin pursuing immediately.';
  var out = await claudeCall('You are HGI Contract Expiration Monitor, agent 24 of 47. Recompetes are HGIs highest-PWIN opportunities. The work is known, the relationships are warm, and the incumbent advantage flips to the challenger when the contract expires. Every expiration you track is a future proposal HGI can start positioning for today., agent 24 of 47. You watch competitor contracts expiring and position HGI to win recompetes before they are posted.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('CONTRACT EXPIRATION complete: ' + out.length + ' chars');
  await storeMemory('contract_expiration', null, 'recompete,expiring_contracts,competitive_positioning', 'CONTRACT EXPIRATION:\n' + out, 'pattern');
  return { agent: 'contract_expiration', chars: out.length };
}

// ── AGENT 25: BUDGET CYCLE INTELLIGENCE ──────────────────────────
async function agentBudgetCycle(state, ctx) {
  log('BUDGET CYCLE: pre-solicitation signal analysis...');
  var prompt = HGI + '\n\nACTIVE PIPELINE:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | ' + (o.vertical||'') + ' | ' + (o.agency||''); }).join('\n') +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Budget cycles and appropriations predict procurement 6-18 months ahead. ' +
    '(1) Federal appropriations relevant to HGI verticals - CDBG-DR allocations, FEMA PA funding, BRIC grants, HUD allocations - what has been appropriated and not yet procured ' +
    '(2) State budget cycles in LA/TX/FL/MS/AL/GA - which states are in active budget season, what is funded for HGI vertical work ' +
    '(3) Disaster supplemental appropriations in Congress - any pending legislation that would generate HGI work ' +
    '(4) FEMA BRIC and HMGP funding announcements that predict hazard mitigation procurement ' +
    '(5) Timeline - for each identified funding signal, when will procurement likely be issued ' +
    '(6) Single highest-value budget signal that HGI should be positioning for right now.';
  var out = await claudeCall('You are HGI Budget Cycle Intelligence Agent, agent 25 of 47. Budget allocations are the earliest possible signal — 6 to 18 months before an RFP drops. You give HGI the longest possible runway to build relationships and shape the procurement before competitors know it exists. Every allocation you surface is a future proposal., agent 25 of 47. You read budget signals 6-18 months ahead of procurement. You brief HGI before opportunities are posted.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('BUDGET CYCLE complete: ' + out.length + ' chars');
  await storeMemory('budget_cycle', null, 'budget_cycle,appropriations,pre_solicitation', 'BUDGET CYCLE:\n' + out, 'pattern');
  return { agent: 'budget_cycle', chars: out.length };
}

// ── AGENT 26: LOSS ANALYSIS ENGINE ───────────────────────────────
async function agentLossAnalysis(state, ctx) {
  log('LOSS ANALYSIS: studying outcomes...');
  var prompt = HGI +
    '\n\nHGI KNOWN PAST PERFORMANCE (wins): Road Home $67M, HAP $950M, Restore Louisiana $42.3M, Rebuild NJ $67.7M, TPSD $2.96M, St. John Sheriff $788K, BP GCCF $1.65M.' +
    '\n\nMEMORY (includes competitive intel and winnability findings):\n' + ctx.memText.slice(0,1200) +
    '\n\nACTIVE PIPELINE:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | Stage:' + (o.stage||'?'); }).join('\n') +
    '\n\nMISSION: Build a competitive pricing and win pattern database from everything the organism knows. ' +
    '(1) Based on organism intelligence - what patterns predict wins vs losses for HGI in its verticals ' +
    '(2) Pricing patterns - where does HGI typically price vs market and how does that affect outcomes ' +
    '(3) Evaluation criterion patterns - which criteria does HGI consistently score well or poorly on ' +
    '(4) Competitor patterns - which competitors has HGI faced and what are their winning strategies ' +
    '(5) Relationship patterns - how much does pre-existing agency relationship predict win probability ' +
    '(6) Single most important pattern finding that should change how HGI pursues opportunities.';
  var out = await claudeCall('You are HGI Loss Analysis Engine, agent 26 of 47. Every loss teaches the proposal writer something. Who won, at what price, with what positioning — this intelligence makes the 5th proposal in a vertical dramatically better than the 1st. Your patterns are embedded into every future proposal before it is drafted. You extract patterns from wins and losses to make every future bid smarter. Every outcome teaches the organism.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('LOSS ANALYSIS complete: ' + out.length + ' chars');
  await storeMemory('loss_analysis', null, 'win_loss_patterns,pricing_patterns,competitive_patterns', 'LOSS ANALYSIS:\n' + out, 'pattern');
  return { agent: 'loss_analysis', chars: out.length };
}

// ── AGENT 27: WIN RATE ANALYTICS ──────────────────────────────────
async function agentWinRateAnalytics(state, ctx) {
  log('WIN RATE ANALYTICS: OPI calibration from patterns...');
  var oppScores = state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | PWIN from winnability:' + ((o.capture_action||'').match(/PWIN[:s]+(d+)/i)||['','unknown'])[1] + 'pct'; }).join('\n');
  var prompt = HGI +
    '\n\nCURRENT PIPELINE WITH OPI AND PWIN:\n' + oppScores +
    '\n\nMEMORY (includes loss analysis and competitive patterns):\n' + ctx.memText.slice(0,1200) +
    '\n\nMISSION: Calibrate the organism scoring models against reality. ' +
    '(1) Compare OPI scores to Winnability Agent PWIN estimates - are they aligned or contradictory? Where is the biggest gap? ' +
    '(2) Which OPI factors are most predictive of actual win probability based on everything the organism knows ' +
    '(3) What OPI score threshold should reliably trigger GO vs NO-BID for HGI given its specific strengths ' +
    '(4) Recommended adjustments to OPI weights for HGI specific context - disaster recovery firm, minority-owned, Louisiana base ' +
    '(5) Confidence interval on each active opportunity PWIN - what is realistic best case vs worst case ' +
    '(6) Expected win rate this quarter based on current pipeline - number of wins, estimated revenue.';
  var out = await claudeCall('You are HGI Win Rate Analytics Agent, agent 27 of 47. Your calibration ensures OPI scores accurately predict which proposals will win. When OPI says 75% and the win rate is 30% the proposal resources are being misallocated. Accurate scoring means HGI puts full proposal effort into the right opportunities. You calibrate the organism scoring models. Your findings make OPI and PWIN increasingly accurate over time.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('WIN RATE ANALYTICS complete: ' + out.length + ' chars');
  await storeMemory('win_rate_analytics', null, 'win_rate,opi_calibration,pwin_accuracy', 'WIN RATE ANALYTICS:\n' + out, 'pattern');
  return { agent: 'win_rate_analytics', chars: out.length };
}

// ── AGENT 28: REGULATORY CHANGE MONITOR ──────────────────────────
async function agentRegulatoryMonitor(state, ctx) {
  log('REGULATORY MONITOR: scanning for rule changes...');
  var prompt = HGI +
    '\n\nACTIVE PIPELINE VERTICALS: Disaster Recovery, TPA/Claims, Workforce/WIOA, Housing/HUD, Grant Management.' +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Regulatory and policy changes reshape procurement requirements and create competitive advantages for firms that adapt first. ' +
    '(1) FEMA PA and HMGP regulation changes in the last 90 days that affect how disaster recovery contracts are structured or evaluated ' +
    '(2) CDBG-DR policy updates from HUD that change program administration requirements ' +
    '(3) WIOA reauthorization status and any changes to workforce program administration requirements ' +
    '(4) State insurance regulatory changes in LA/TX/FL/MS that affect TPA and claims administration contracts ' +
    '(5) Any new federal requirements (Davis-Bacon, Build America Buy America, equity requirements) that affect HGI proposal content ' +
    '(6) Single regulatory change that most significantly affects HGI competitive positioning right now.';
  var out = await claudeCall('You are HGI Regulatory Change Monitor, agent 28 of 47. Regulatory changes reshape what evaluators score. A new FEMA PA policy means every proposal technical approach must be updated. You ensure HGIs proposals cite current regulations — an outdated cite is a scored weakness in every technical section. You watch FEMA, HUD, DOL, and state regulations. You brief HGI before competitors adapt.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('REGULATORY MONITOR complete: ' + out.length + ' chars');
  await storeMemory('regulatory_monitor', null, 'regulatory_changes,fema,hud,wioa,compliance', 'REGULATORY MONITOR:\n' + out, 'pattern');
  return { agent: 'regulatory_monitor', chars: out.length };
}

// ── AGENT 29: OUTREACH AUTOMATION ─────────────────────────────────
async function agentOutreachAutomation(state, ctx) {
  log('OUTREACH AUTOMATION: drafting targeted outreach...');
  var activeHighOPI = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 72; });
  if (activeHighOPI.length === 0) return null;
  var oppCtx = activeHighOPI.map(function(o) { return (o.title||'?').slice(0,50) + ' | Agency:' + (o.agency||'') + ' | Due:' + (o.due_date||'TBD') + ' | Stage:' + (o.stage||'?'); }).join('\n');
  var prompt = HGI +
    '\n\nHIGH-PRIORITY OPPORTUNITIES (OPI 72+):\n' + oppCtx +
    '\n\nRELATIONSHIP GRAPH:\n' + ctx.relText +
    '\n\nCRM INTELLIGENCE FROM MEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: Draft specific outreach for each high-priority opportunity. Not templates - actual ready-to-send messages. ' +
    '(1) For each opportunity - who to contact, their role, their email if known from relationship graph ' +
    '(2) Specific email or call script for each contact - reference something specific about their agency, not generic ' +
    '(3) Timing recommendation - when to reach out relative to submission deadline ' +
    '(4) What to ask for or offer in the outreach - site visit, pre-proposal meeting, past performance references ' +
    '(5) Follow-up sequence if no response - 3-touch approach with specific messaging ' +
    '(6) Single highest-leverage outreach that would most improve competitive position this week.';
  var out = await claudeCall('You are HGI Outreach Automation Agent, agent 29 of 47. Your outreach drafts become the relationships that make proposals land warm instead of cold. A pre-submission conversation with the evaluating officer is worth more proposal points than any written section. You turn intelligence into action before the submission deadline. You draft specific ready-to-send outreach for every high-priority opportunity. No templates. Real messages to real people.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('OUTREACH AUTOMATION complete: ' + out.length + ' chars');
  await storeMemory('outreach_automation', null, 'outreach,contact_strategy,relationship_building', 'OUTREACH AUTOMATION:\n' + out, 'pattern');
  return { agent: 'outreach_automation', chars: out.length };
}

// ── AGENT 30: LEARNING LOOP ───────────────────────────────────────
async function agentLearningLoop(state, ctx) {
  log('LEARNING LOOP: encoding session learnings...');
  var sessionSummary = state.memories.slice(0,20).map(function(m) {
    return '[' + (m.agent||'?') + ']: ' + (m.observation||'').slice(0,150);
  }).join('\n\n');
  var prompt = HGI +
    '\n\nSESSION INTELLIGENCE PRODUCED TODAY:\n' + sessionSummary +
    '\n\nPIPELINE STATUS:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | Stage:' + (o.stage||'?'); }).join('\n') +
    '\n\nMISSION: Encode the most important learnings from this session into permanent organism memory. ' +
    '(1) What are the 3-5 most important facts the organism learned today that should permanently change how it operates ' +
    '(2) Which agent produced the single most valuable insight and what was it ' +
    '(3) What should every agent read before the next session to be smarter ' +
    '(4) Any finding that contradicts previous organism beliefs - what needs to be unlearned ' +
    '(5) Recommended changes to agent prompts or behavior based on today session quality ' +
    '(6) One-sentence summary of the organism state today vs where it needs to be - how far to $100M capture capability.';
  var out = await claudeCall('You are HGI Learning Loop Agent, agent 30 of 47. Every session teaches the organism what makes proposals win. Your encodings compound — the 10th proposal in a vertical is dramatically better than the 1st because you captured what the 1st through 9th taught. Edit distance from Christopher decreases with every cycle you process. You make the organism smarter after every session. Your encodings compound. The 50th session must be fundamentally smarter than the first.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('LEARNING LOOP complete: ' + out.length + ' chars');
  await storeMemory('learning_loop', null, 'learning,session_summary,organism_improvement', 'LEARNING LOOP:\n' + out, 'pattern');
  return { agent: 'learning_loop', chars: out.length };
}


// ── AGENT 31: PROPOSAL ASSEMBLY ───────────────────────────────────
async function agentProposalAssembly(opp, ctx) {
  if ((opp.staffing_plan||'').length < 300) return null;
  log('PROPOSAL ASSEMBLY: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI + '\n\n' + oppBase(opp) +
    '\n\nCURRENT PROPOSAL DRAFT:\n' + (opp.staffing_plan||'').slice(0,2000) +
    '\n\nFINANCIAL ANALYSIS:\n' + (opp.financial_analysis||'').slice(0,400) +
    '\n\nQUALITY GATE FINDINGS:\n' + ctx.memText.slice(0,400) +
    '\n\nMISSION: Build the complete submission checklist and package structure. ' +
    '(1) Complete section-by-section table of contents with page number targets for this specific RFP ' +
    '(2) Exhibits checklist - for each required exhibit (A through J or as specified), current status: complete, needs signature, needs notarization, missing entirely ' +
    '(3) Cover letter requirements - who signs, what it must contain, format requirements ' +
    '(4) Submission format requirements - electronic via Central Bidding, hard copies count and deadline, binding requirements ' +
    '(5) Final review checklist - the 10 things to verify before Dillon Truax submits ' +
    '(6) Critical path to submission - tasks, owners by role, deadlines in reverse order from due date.';
  var out = await claudeCall('You are HGI Proposal Assembly Agent, agent 31 of 47. You ensure the complete proposal package is submission-ready — every exhibit, certification, attachment, and hard copy requirement. A technically superior proposal that fails on submission requirements is disqualified before scoring begins. You are the last line of defense before the deadline. You build the complete submission package checklist. Nothing gets missed. Dillon Truax gets a complete, organized package ready to submit.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('PROPOSAL ASSEMBLY complete: ' + out.length + ' chars');
  await storeMemory('proposal_assembly', opp.id, (opp.agency||'') + ',proposal_assembly,submission', 'PROPOSAL ASSEMBLY - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'analysis');
  return { agent: 'proposal_assembly', opp: opp.title, chars: out.length };
}

// ── AGENT 32: AMENDMENT TRACKER ───────────────────────────────────
async function agentAmendmentTracker(state, ctx) {
  log('AMENDMENT TRACKER: monitoring for RFP changes...');
  var activeOpps = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 65 && (o.stage||'') !== 'submitted'; });
  if (activeOpps.length === 0) return null;
  var oppList = activeOpps.map(function(o) { return (o.title||'?').slice(0,50) + ' | Due:' + (o.due_date||'TBD') + ' | Source:' + (o.source||'unknown') + ' | Posted:' + (o.discovered_at||'unknown').slice(0,10); }).join('\n');
  var prompt = HGI + '\n\nACTIVE RFPS BEING MONITORED:\n' + oppList +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: RFP amendments and addenda change proposal requirements after posting. Missing them is a disqualification risk. ' +
    '(1) For each active RFP - what is the addendum/amendment check process for that portal (Central Bidding, LaPAC, agency website) ' +
    '(2) Common amendment types that affect HGI proposals - scope clarifications, deadline extensions, evaluation criterion changes, exhibit revisions ' +
    '(3) How frequently to check each source for amendments before the deadline ' +
    '(4) What to do when an amendment is found - who gets notified, what sections of the proposal must be updated ' +
    '(5) Any known amendments or clarifications to current active RFPs based on organism intelligence ' +
    '(6) Amendment monitoring protocol recommendation for HGI capture team.';
  var out = await claudeCall('You are HGI Amendment Tracker Agent, agent 32 of 47. An addendum that changes evaluation criteria or scope after HGIs draft is written means the proposal must be updated immediately. Missing an amendment is a compliance failure that can result in disqualification on a proposal that would otherwise have won. You monitor active RFPs for changes after posting. A missed amendment is a missed win. You catch everything.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('AMENDMENT TRACKER complete: ' + out.length + ' chars');
  await storeMemory('amendment_tracker', null, 'amendments,rfp_changes,addenda', 'AMENDMENT TRACKER:\n' + out, 'analysis');
  return { agent: 'amendment_tracker', chars: out.length };
}

// ── AGENT 33: POST-AWARD AGENT ────────────────────────────────────
async function agentPostAward(state, ctx) {
  log('POST-AWARD: checking for mobilization needs...');
  var submittedOpps = state.pipeline.filter(function(o) { return (o.stage||'') === 'submitted' || (o.outcome||'') === 'won'; });
  if (submittedOpps.length === 0) { log('POST-AWARD: no submitted or won opportunities'); return null; }
  var oppList = submittedOpps.map(function(o) { return (o.title||'?').slice(0,50) + ' | Stage:' + (o.stage||'?') + ' | Outcome:' + (o.outcome||'pending'); }).join('\n');
  var prompt = HGI + '\n\nSUBMITTED OR WON OPPORTUNITIES:\n' + oppList +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Post-award work determines whether HGI gets paid and builds past performance. ' +
    '(1) For any won opportunity - 30-day mobilization checklist: key personnel confirmation, insurance certificates, bonding if required, contract execution steps ' +
    '(2) CPARS/PPQ setup - who is the contracting officer, when does first evaluation occur, what metrics matter ' +
    '(3) Subcontractor agreements if teaming was used - what needs to be executed before work starts ' +
    '(4) Past performance documentation plan - how to capture this contract for future proposals ' +
    '(5) For submitted but not yet awarded - award timeline expectations, protest risk assessment, debriefing request strategy if lost ' +
    '(6) Any outstanding items from the submission that could affect award (Best and Final Offer likelihood, oral presentation request).';
  var out = await claudeCall('You are HGI Post-Award Agent, agent 33 of 47. You make sure wins become past performance that makes the next proposal stronger. The contract HGI is executing today is the reference that wins the proposal next year. Every deliverable completed, every milestone documented, every PPQ submitted builds the institutional proof library for future bids. You make sure wins become revenue and past performance. You activate the moment a contract is awarded.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('POST-AWARD complete: ' + out.length + ' chars');
  await storeMemory('post_award', null, 'post_award,mobilization,cpars,past_performance', 'POST-AWARD:\n' + out, 'analysis');
  return { agent: 'post_award', chars: out.length };
}

// ── AGENT 34: ORAL PREP AGENT ─────────────────────────────────────
async function agentOralPrep(state, ctx) {
  log('ORAL PREP: checking for presentation needs...');
  var proposalOpps = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 72 && ((o.staffing_plan||'').length > 300 || (o.stage||'') === 'proposal'); });
  if (proposalOpps.length === 0) return null;
  var oppList = proposalOpps.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | Due:' + (o.due_date||'TBD'); }).join('\n');
  var prompt = HGI + '\n\nHIGH-PRIORITY PROPOSAL OPPORTUNITIES:\n' + oppList +
    '\n\nINTEL AND COMPETITIVE CONTEXT:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: Many government contracts include oral presentations after written proposals. Prepare HGI now. ' +
    '(1) Which of these opportunities is likely to include an oral presentation round based on agency patterns and contract value ' +
    '(2) For each likely oral - the 5 questions the evaluation committee will almost certainly ask ' +
    '(3) HGI strongest talking points that should be woven into every answer ' +
    '(4) The weakness or concern the evaluators will probe - how to address it confidently without dwelling ' +
    '(5) Who from HGI should present for each opportunity and what role each person plays ' +
    '(6) Preparation timeline - how many practice sessions, what format, who plays evaluator.';
  var out = await claudeCall('You are HGI Oral Prep Agent, agent 34 of 47. When a proposal advances to oral presentations the written score resets and HGI must win again in person. Jefferson Parish weights oral presentations at 40 points. You prepare the team before they are asked — evaluator likely questions, talking points, competitive positioning for live Q&A. The proposal that wins in writing must also win in the room. You prepare HGI for oral presentations before they are requested. The team that rehearses wins.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('ORAL PREP complete: ' + out.length + ' chars');
  await storeMemory('oral_prep', null, 'oral_presentation,interview_prep,evaluation_committee', 'ORAL PREP:\n' + out, 'pattern');
  return { agent: 'oral_prep', chars: out.length };
}

// ── AGENT 35: MOBILE NOTIFICATIONS ───────────────────────────────
async function agentMobileNotifications(state, ctx) {
  log('MOBILE NOTIFICATIONS: identifying urgent alerts...');
  var today = new Date();
  var urgentOpps = state.pipeline.filter(function(o) {
    var days = o.due_date ? Math.ceil((new Date(o.due_date) - today) / 86400000) : null;
    return days !== null && days <= 14 && (o.opi_score||0) >= 65;
  });
  var prompt = HGI +
    '\n\nOPPORTUNITIES WITHIN 14 DAYS:\n' + urgentOpps.map(function(o) {
      var days = Math.ceil((new Date(o.due_date) - today) / 86400000);
      return (o.title||'?').slice(0,50) + ' | ' + days + ' DAYS | OPI:' + o.opi_score + ' | Stage:' + (o.stage||'?') + ' | Proposal:' + (o.staffing_plan||'').length + 'chars';
    }).join('\n') +
    '\n\nSESSION INTELLIGENCE:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: Determine what requires immediate notification to Christopher vs what can wait for morning briefing. ' +
    '(1) IMMEDIATE ALERT (notify now, not tomorrow): any finding that requires action within 24 hours ' +
    '(2) URGENT (morning briefing priority): findings that require action within 72 hours ' +
    '(3) For each immediate alert - exact message to send Christopher on his phone, 2 sentences max, what to do and why now ' +
    '(4) Any competitor intelligence that changes HGI strategy and must be acted on today ' +
    '(5) Deadline risk - any opportunity where current proposal completeness vs days remaining is a red flag ' +
    '(6) Is anything mission-critical enough to wake someone up for right now.';
  var out = await claudeCall('You are HGI Mobile Notifications Agent, agent 35 of 47. You protect HGI from missing proposal-critical deadlines and time-sensitive opportunities. A declaration overnight means positioning starts at 6am not the following Monday. A submission deadline change means the proposal team needs to know immediately. You are the organism emergency alert system for proposal windows. You decide what cannot wait until morning. You protect HGI from missing deadlines and critical intelligence.', prompt, 800);
  if (!out || out.length < 100) return null;
  log('MOBILE NOTIFICATIONS complete: ' + out.length + ' chars');
  await storeMemory('mobile_notifications', null, 'alerts,urgent,deadline_risk', 'MOBILE NOTIFICATIONS:\n' + out, 'analysis');
  return { agent: 'mobile_notifications', chars: out.length };
}

// ── AGENT 36: ENTREPRENEURIAL INTELLIGENCE ────────────────────────
async function agentEntrepreneurial(state, ctx) {
  log('ENTREPRENEURIAL: scanning for venture signals...');
  var prompt = HGI +
    '\n\nHGI CURRENT PIPELINE AND CAPABILITIES:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | ' + (o.vertical||'') + ' | OPI:' + o.opi_score; }).join('\n') +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: HGI has 95 years of program management expertise and a $100M growth vision. Beyond government contracts, what business opportunities does HGI have? ' +
    '(1) Adjacent commercial markets where HGI disaster recovery and claims expertise creates competitive advantage - insurance tech, climate resilience consulting, private sector risk management ' +
    '(2) IP and product opportunities - proprietary methodologies HGI could package and license, software tools built from capture system that could be productized ' +
    '(3) Geographic expansion signals - markets outside LA/TX/FL/MS/AL/GA where HGI capabilities are undersupplied ' +
    '(4) Partnership or acquisition opportunities - firms that would extend HGI capabilities and be accretive to revenue ' +
    '(5) Federal market penetration - HGI has had ONE direct federal contract (PBGC). What is the pathway to more direct federal work? ' +
    '(6) Single highest-ROI entrepreneurial opportunity for HGI to pursue this year outside of government capture.';
  var out = await claudeCall('You are HGI Entrepreneurial Intelligence Agent, agent 36 of 47. You see beyond the current RFP cycle to the relationships, markets, and positioning that build HGIs 100M enterprise. Every strategic move you recommend creates conditions where future proposals land with incumbent advantage instead of cold outreach. You see HGI not just as a government contractor but as a platform for a $100M enterprise. You find the opportunities beyond the pipeline.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('ENTREPRENEURIAL complete: ' + out.length + ' chars');
  await storeMemory('entrepreneurial_agent', null, 'entrepreneurial,commercial_markets,federal_expansion,growth', 'ENTREPRENEURIAL:\n' + out, 'pattern');
  return { agent: 'entrepreneurial_agent', chars: out.length };
}

// ── AGENT 37: EXEC BRIEFING MODE (Lou + Larry formatted) ──────────
async function agentExecBriefingMode(state, ctx) {
  log('EXEC BRIEFING MODE: Lou and Larry formatted report...');
  var pipelineValue = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 65; }).reduce(function(sum, o) {
    var val = parseFloat((o.estimated_value||'0').replace(/[^0-9.]/g,'')) || 0;
    return sum + val;
  }, 0);
  var prompt = HGI +
    '\n\nPIPELINE SUMMARY:\n' + state.pipeline.map(function(o) { return (o.title||'?').slice(0,50) + ' | OPI:' + o.opi_score + ' | Due:' + (o.due_date||'TBD') + ' | Stage:' + (o.stage||'?') + ' | Value:' + (o.estimated_value||'unknown'); }).join('\n') +
    '\n\nTOTAL ADDRESSABLE PIPELINE: approximately ' + pipelineValue.toLocaleString() + ' in estimated values' +
    '\n\nSESSION INTELLIGENCE SUMMARY:\n' + ctx.memText.slice(0,1200) +
    '\n\nMISSION: Produce a clean, executive-ready briefing for Lou Resweber (CEO) and Larry Oney (Chairman). They are not involved in daily capture operations. They need the business picture. ' +
    '(1) PIPELINE SNAPSHOT: total opportunities, realistic revenue at risk this quarter, expected wins based on PWIN ' +
    '(2) STRATEGIC WINS: what is going well in the capture program - strengths emerging ' +
    '(3) STRATEGIC RISKS: what could derail revenue targets - honest assessment ' +
    '(4) DECISIONS REQUIRED: exactly what Lou or Larry need to decide or act on this week with full context ' +
    '(5) COMPETITIVE LANDSCAPE: major shifts in competitive environment they should know ' +
    '(6) PATH TO $100M: current trajectory vs $100M enterprise goal - are we on track, what needs to change.' +
    '\n\nFormat this as a clean executive brief - headers, no jargon, no technical details. They read this on their phone.';
  var out = await claudeCall('You are HGI Exec Briefing Mode Agent, agent 37 of 47. When Larry knows a former colleague at GOHSEP that relationship goes into the transmittal letter. When Lou has a read on the evaluation committee that shapes the proposal tone. Leadership input is proposal input. You surface the decisions only Lou and Larry can make. THE FINAL AGENT. You produce the executive report for the CEO and Chairman. Clean. Strategic. Decision-ready. This is what the entire organism produces for leadership.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('EXEC BRIEFING MODE complete: ' + out.length + ' chars');
  log('ALL 37 AGENTS COMPLETE. THE ORGANISM IS FULLY ALIVE.');
  await storeMemory('exec_briefing_mode', null, 'executive_brief,ceo,chairman,strategic_summary', 'EXEC BRIEFING MODE - FULL ORGANISM SESSION COMPLETE:\n' + out, 'analysis');
  return { agent: 'exec_briefing_mode', chars: out.length };
}


// ── AGENT 38: HUNTING AGENT ───────────────────────────────────────
// The organism's front door. Goes and gets opportunities from every source.
// Central Bidding is the #1 source — it has produced ALL real HGI pipeline opps.
// Also discovers new sources autonomously.

async function agentHunting(state, ctx) {
  // AGENT 38 OF 47 — HUNTING AGENT
  // Identity: I feed the proposal pipeline. Central Bidding is my primary source — the only portal
  // that has produced real HGI pipeline opportunities. I also systematically check LaPAC, SAM.gov,
  // and Grants.gov. Beyond fixed portals I autonomously discover new sources — identifying where
  // agencies in HGI verticals post procurements HGI is not yet monitoring, researching access methods,
  // and adding them to the rotation. Every opportunity I qualify is a potential proposal. I run first
  // in every session and every 6 hours independently so new opportunities enter the pipeline before
  // all other agents fire their analysis. Without me there is nothing for the other 46 agents to work
  // on and no proposals to write.
  log('HUNTING AGENT: hitting all procurement portals...');

  var newOpps = [];
  var existingTitles = state.pipeline.map(function(o) { return (o.title||'').toLowerCase().slice(0,50); });

  function isDupe(title) {
    var t = (title||'').toLowerCase().slice(0,50);
    return existingTitles.some(function(e) {
      var words = t.split(' ').filter(function(w) { return w.length > 4; });
      if (!words.length) return false;
      var hits = words.filter(function(w) { return e.includes(w); }).length;
      return hits / words.length >= 0.5;
    });
  }

  function today() { return new Date().toISOString().slice(0,10).replace(/-/g, '/'); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10).replace(/-/g,'/'); }

  // ── SOURCE 1: CENTRAL BIDDING (primary — only source producing real HGI opps) ──
  // Authenticated via Apify actor — organism calls Apify to trigger a fresh run
  // and reads the most recent results from hunt_runs (populated by the Vercel scraper)
  log('HUNTING: reading Central Bidding results from Vercel pipeline...');
  var cbFound = 0;
  try {
    var cbResp = await supabase.from('hunt_runs')
      .select('*')
      .eq('source', 'centralbidding')
      .order('run_at', { ascending: false })
      .limit(10);
    var cbRuns = cbResp.data || [];
    for (var i = 0; i < cbRuns.length; i++) {
      try {
        var runStatus = JSON.parse(cbRuns[i].status || '{}');
        var opps = runStatus.opportunities || runStatus.results || [];
        for (var j = 0; j < opps.length; j++) {
          var o = opps[j];
          var title = o.title || o.name || '';
          if (title && !isDupe(title)) {
            newOpps.push({ title: title, agency: o.agency || o.entity || 'Louisiana Agency', source: 'centralbidding', source_url: o.url || o.link || 'https://www.centralauctionhouse.com', description: (o.description||o.summary||'').slice(0,500), due_date: o.due_date || o.closeDate || null, vertical: null });
            cbFound++;
          }
        }
      } catch(e) {}
    }
    // Also trigger Apify to run a fresh Central Bidding scrape
    try {
      await fetch('https://api.apify.com/v2/acts/my-actor/runs?token=' + AK.split('-')[0], { method: 'POST' });
    } catch(e) {}
  } catch(e) { log('HUNTING Central Bidding error: ' + e.message); }
  log('HUNTING: Central Bidding found ' + cbFound + ' candidates');

  // ── SOURCE 2: LAPAC (Louisiana) ────────────────────────────────
  var lapacKW = ['program management','professional services','disaster recovery','housing','workforce','grant','consulting','administrative','claims'];
  var lapacFound = 0;
  for (var lk = 0; lk < lapacKW.length; lk++) {
    try {
      var lr = await fetch('https://wwwcfts.doa.la.gov/lascts/rest/solicitations?keyword=' + encodeURIComponent(lapacKW[lk]) + '&status=OPEN&rows=10', { headers: { Accept: 'application/json' } });
      if (lr.ok) {
        var ld = await lr.json();
        var lopps = Array.isArray(ld) ? ld : (ld.solicitations || ld.results || []);
        for (var lp = 0; lp < lopps.length; lp++) {
          var lo = lopps[lp];
          var lt = lo.title || lo.solicitationTitle || '';
          if (lt && !isDupe(lt)) {
            newOpps.push({ title: lt, agency: lo.agency || lo.agencyName || 'Louisiana State Agency', source: 'lapac', source_url: lo.url || 'https://wwwcfts.doa.la.gov', description: (lo.description||lt).slice(0,500), due_date: lo.dueDate || lo.closingDate || null, vertical: null });
            lapacFound++;
          }
        }
      }
    } catch(e) {}
  }
  log('HUNTING: LaPAC found ' + lapacFound + ' candidates');

  // ── SOURCE 3: SAM.GOV (federal, state/local) ───────────────────
  var samKW = ['disaster recovery program management','grant administration','claims administration','housing authority administration','workforce WIOA','TPA third party administrator','FEMA public assistance','CDBG-DR','hazard mitigation'];
  var samFound = 0;
  for (var sk = 0; sk < samKW.length; sk++) {
    try {
      var sr = await fetch('https://api.sam.gov/opportunities/v2/search?api_key=DEMO_KEY&q=' + encodeURIComponent(samKW[sk]) + '&postedFrom=' + daysAgo(14) + '&postedTo=' + today() + '&ptype=o,p,k&active=true&limit=10');
      if (sr.ok) {
        var sd = await sr.json();
        var sops = sd.opportunitiesData || [];
        for (var si = 0; si < sops.length; si++) {
          var so = sops[si];
          if (so.title && !isDupe(so.title)) {
            newOpps.push({ title: so.title, agency: so.fullParentPathName || so.organizationCode || 'Federal', source: 'sam_gov', source_url: 'https://sam.gov/opp/' + so.opportunityId, description: (so.description||'').slice(0,500), due_date: so.responseDeadLine || null, vertical: null });
            samFound++;
          }
        }
      }
    } catch(e) {}
  }
  log('HUNTING: SAM.gov found ' + samFound + ' candidates');

  // ── SOURCE 4: GRANTS.GOV ───────────────────────────────────────
  var grantsFound = 0;
  try {
    var gr = await fetch('https://api.grants.gov/v1/api/search2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: 'disaster recovery OR housing program OR workforce development OR grant management OR claims administration', rows: 20, oppStatuses: 'forecasted|posted', startRecordNum: 0 }) });
    if (gr.ok) {
      var gd = await gr.json();
      var gops = (gd.data && gd.data.oppHits) ? gd.data.oppHits : [];
      for (var gi = 0; gi < gops.length; gi++) {
        var go = gops[gi];
        if (go.oppTitle && !isDupe(go.oppTitle)) {
          newOpps.push({ title: go.oppTitle, agency: go.agencyName || 'Federal', source: 'grants_gov', source_url: 'https://grants.gov/search-grants?oppNumber=' + go.number, description: (go.synopsis||'').slice(0,500), due_date: go.closeDate || null, vertical: 'grant' });
          grantsFound++;
        }
      }
    }
  } catch(e) { log('HUNTING Grants.gov error: ' + e.message); }
  log('HUNTING: Grants.gov found ' + grantsFound + ' candidates');

  // ── SOURCE 5: AUTONOMOUS NEW SOURCE DISCOVERY ─────────────────
  // The organism researches and identifies new portals it should be hitting
  log('HUNTING: discovering new sources autonomously...');
  try {
    var discoverPrompt = HGI +
      '\n\nCURRENT SOURCES BEING MONITORED: Central Bidding (Louisiana), LaPAC (Louisiana), SAM.gov, Grants.gov.' +
      '\n\nCURRENT PIPELINE VERTICALS: ' + [...new Set(state.pipeline.map(function(o){return o.vertical||'unknown';}))].join(', ') +
      '\n\nMEMORY:\n' + ctx.memText.slice(0,400) +
      '\n\nMISSION: HGI operates in LA/TX/FL/MS/AL/GA. What specific procurement portals are we NOT monitoring that carry HGI-vertical work? ' +
      'Respond in JSON only. No markdown. Format: {"new_sources":[{"name":"portal name","url":"https://...","what_it_carries":"description","how_to_access":"public API or registration required","priority":"high/medium/low"}],"missing_keywords":["keyword1","keyword2"]}' +
      '\nLimit to top 5 new sources. Focus on: TX/FL/MS/AL/GA state portals, insurance regulatory bodies, housing authority networks, FEMA direct channels.';

    var discoverResp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: discoverPrompt }]
    });
    var discoverText = (discoverResp.content||[]).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('').replace(/json|/gi,'').trim();
    var discovery = JSON.parse(discoverText);
    if (discovery.new_sources && discovery.new_sources.length > 0) {
      log('HUNTING: Discovered ' + discovery.new_sources.length + ' new source candidates');
      await storeMemory('hunting_agent', null, 'new_sources,source_discovery', 'NEW SOURCE DISCOVERY:\n' + discovery.new_sources.map(function(s){ return s.priority.toUpperCase() + ': ' + s.name + ' (' + s.url + ') - ' + s.what_it_carries; }).join('\n'), 'pattern');

      // Actually try to hit any high-priority sources with public APIs
      for (var ns = 0; ns < discovery.new_sources.length; ns++) {
        var src = discovery.new_sources[ns];
        if (src.priority === 'high' && src.how_to_access === 'public API') {
          try {
            var nsResp = await fetch(src.url + (src.url.includes('?') ? '&' : '?') + 'keyword=program+management&rows=10', { headers: { Accept: 'application/json' } });
            if (nsResp.ok) {
              var nsData = await nsResp.json();
              var nsOpps = nsData.results || nsData.data || nsData.opportunities || [];
              nsOpps.slice(0,5).forEach(function(no) {
                var nt = no.title || no.name || '';
                if (nt && !isDupe(nt)) {
                  newOpps.push({ title: nt, agency: no.agency || src.name, source: 'new_source_' + src.name.replace(/s/g,'_').toLowerCase(), source_url: src.url, description: (no.description||'').slice(0,300), due_date: no.dueDate || null, vertical: null });
                  log('HUNTING: New source ' + src.name + ' yielded: ' + nt.slice(0,40));
                }
              });
            }
          } catch(e) {}
        }
      }
    }
  } catch(e) { log('HUNTING source discovery error: ' + e.message); }

  log('HUNTING: Total raw candidates: ' + newOpps.length + '. Scoring with OPI model...');

  if (newOpps.length === 0) {
    await storeMemory('hunting_agent', null, 'hunting,no_candidates', 'HUNTING: No new candidates found. Sources checked: Central Bidding, LaPAC, SAM.gov, Grants.gov + autonomous discovery.', 'analysis');
    return { agent: 'hunting_agent', chars: 100, new_opps: 0 };
  }

  // ── SCORE EACH CANDIDATE ──────────────────────────────────────
  var qualified = [];
  var deduped = newOpps.filter(function(o, idx, arr) {
    return arr.findIndex(function(x) { return x.title.slice(0,40) === o.title.slice(0,40); }) === idx;
  });

  for (var c = 0; c < Math.min(deduped.length, 20); c++) {
    var cand = deduped[c];
    try {
      var sp = HGI +
        '\nOPPORTUNITY: Title: ' + cand.title + '\nAgency: ' + cand.agency + '\nSource: ' + cand.source + '\nDescription: ' + (cand.description||'no description') + '\nDue: ' + (cand.due_date||'unknown') +
        '\n\nRespond in JSON only. No markdown: {"opi":NUMBER,"vertical":"disaster|tpa|workforce|housing|construction|grant|federal|general|FILTER","capture_action":"GO or WATCH or NO-BID","why":"one sentence","estimated_value":"range or unknown"}' +
        '\nUse FILTER for: physical construction, healthcare benefits, IT/software, education, food service, janitorial, utilities, or anything clearly outside HGI capabilities.';

      var sr2 = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: sp }]
      });

      var st = (sr2.content||[]).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('').replace(/json|/gi,'').trim();
      var score = JSON.parse(st);

      if (score.vertical === 'FILTER' || score.opi < 45) {
        log('HUNTING: FILTERED ' + cand.title.slice(0,40) + ' OPI:' + score.opi);
        continue;
      }

      log('HUNTING: QUALIFIED OPI:' + score.opi + ' ' + score.vertical + ' | ' + cand.title.slice(0,45));

      var newId = cand.source + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
      await supabase.from('opportunities').insert({
        id: newId,
        title: cand.title,
        agency: cand.agency,
        vertical: score.vertical,
        opi_score: score.opi,
        status: 'active',
        stage: 'identified',
        source: cand.source,
        source_url: cand.source_url,
        estimated_value: score.estimated_value || 'unknown',
        due_date: cand.due_date || null,
        capture_action: score.capture_action + ': ' + score.why,
        discovered_at: new Date().toISOString(),
        last_updated: new Date().toISOString()
      });

      qualified.push({ title: cand.title, opi: score.opi, vertical: score.vertical, agency: cand.agency, source: cand.source });

    } catch(e) { log('HUNTING score error: ' + e.message); }
  }

  log('HUNTING AGENT COMPLETE: ' + qualified.length + '/' + deduped.length + ' qualified and added to pipeline');
  qualified.forEach(function(q) { log('  + OPI:' + q.opi + ' ' + q.vertical + ' [' + q.source + '] ' + q.title.slice(0,50)); });

  await storeMemory('hunting_agent', null,
    'hunting,pipeline_growth,new_opportunities',
    'HUNTING COMPLETE: Checked Central Bidding + LaPAC + SAM.gov + Grants.gov + autonomous discovery. Raw candidates: ' + deduped.length + '. Qualified and added to pipeline: ' + qualified.length + '.\n' +
    qualified.map(function(q){ return '[' + q.source + '] OPI:' + q.opi + ' ' + q.vertical + ' | ' + q.title.slice(0,55); }).join('\n'),
    'analysis'
  );

  return { agent: 'hunting_agent', chars: 300, new_opps: qualified.length };
}


// ── AGENT 39: STAFFING PLAN AGENT ────────────────────────────────
// Builds the actual named personnel table — real people, real rates, real quals
async function agentStaffingPlan(opp, ctx) {
  if ((opp.scope_analysis||'').length < 100) return null;
  log('STAFFING PLAN: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI +
    '\n\nOPPORTUNITY SCOPE AND REQUIRED POSITIONS:\n' + (opp.scope_analysis||'').slice(0,1500) +
    '\n\nHGI NAMED STAFF — ASSIGN THESE REAL PEOPLE TO REAL POSITIONS. NO TBD ALLOWED:\n' +
    'Louis Resweber - Program Director / Senior PM, 25+ years program management, active FEMA PA experience, TPSD Hurricane Ida recovery lead\n' +
    'Berron - PA SME, FEMA Public Assistance Category A-G technical specialist, PW development, Grants Portal, GOHSEP coordination\n' +
    'April Gloston - HM Specialist, Hazard Mitigation 404/406, BRIC applications, BCA analysis, flood mitigation\n' +
    'Klunk - Financial/Grant Specialist, CDBG-DR compliance, 2 CFR Part 200, federal financial management, audit support\n' +
    'Wiltz - Documentation Manager, federal records management, compliance documentation, closeout files\n' +
    'Julie Lawson - PM, project coordination, schedule management, stakeholder reporting\n' +
    'Christopher J. Oney - President/Principal, executive sponsor, available for escalation, GOHSEP/FEMA Region VI relationships\n' +
    'RULE: Assign named staff above to required RFP positions first. Only use TBD for positions where NO named staff can fill the role, and explain the gap.\n' +
    '\n\nHGI RATE CARD (fully burdened per hour):\n' +
    'Principal $220 | Program Director $210 | SME $200 | Sr PM $180 | PM $155 | Sr Grant Mgr $180 | Grant Mgr $175 | Grant Writer $145 | Architect/Engineer $135 | Cost Estimator $125 | Appeals Specialist $145 | Sr Damage Assessor $115 | Damage Assessor $105 | Admin Support $65\n' +
    '\n\nMEMORY (includes recruiting gaps):\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Build the complete staffing plan for this specific RFP. ' +
    '(1) For each required position in the scope analysis - assign the best available named HGI staff member with their qualifications and hourly rate ' +
    '(2) For positions HGI cannot fill with named staff - identify the gap, recommend the role type, and note teaming or recruiting needed ' +
    '(3) Build the organizational chart structure showing reporting relationships ' +
    '(4) Calculate total annual staffing cost at proposed hours for base year ' +
    '(5) Write the personnel qualifications narrative for each named position - specific to THIS RFP requirements not generic ' +
    '(6) Flag any position where a TBD or placeholder would cost points and recommend how to address it before submission.';
  var out = await claudeCall('You are HGI Staffing Plan Agent, agent 39 of 47. Your staffing plan IS a proposal section. Named personnel with documented qualifications that evaluators score against required positions. A TBD in the staffing plan is a scored weakness. A named credentialed person with past performance on exactly this contract type is a scored strength. You match real HGI people to real RFP positions. You write personnel narratives that score. Named people with real qualifications beat TBD every time.', prompt, 8000);
  if (!out || out.length < 100) return null;
  log('STAFFING PLAN complete: ' + out.length + ' chars');
  await storeMemory('staffing_plan_agent', opp.id, (opp.agency||'') + ',staffing,personnel', 'STAFFING PLAN - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'analysis');
  await supabase.from('opportunities').update({ staffing_plan: out.slice(0,60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'staffing_plan_agent', opp: opp.title, chars: out.length };
}

// ── AGENT 40: UNSOLICITED PROPOSAL AGENT ─────────────────────────
// Shapes procurement before it is posted — the offensive move
async function agentUnsolicited(state, ctx) {
  log('UNSOLICITED: identifying pre-solicitation shaping opportunities...');
  var pastPerf = 'Road Home $67M, HAP $950M, Restore Louisiana $42.3M, Rebuild NJ $67.7M, TPSD $2.96M completed 2022-2025, St. John Sheriff $788K, BP GCCF $1.65M';
  var prompt = HGI +
    '\n\nHGI PAST PERFORMANCE (agencies that know us):\n' + pastPerf +
    '\n\nCURRENT PIPELINE:\n' + state.pipeline.map(function(o){return (o.title||'?').slice(0,50)+' | '+o.agency;}).join('\n') +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: HGI has 95 years of relationships. The best RFP is one HGI helped shape before it was written. ' +
    '(1) Identify 3-5 agencies HGI has worked with before where current program conditions suggest upcoming procurement - budget approvals, program expansions, leadership changes, performance issues with incumbents ' +
    '(2) For each - draft the concept of a targeted capability statement or white paper HGI should send now to shape the upcoming solicitation in HGIs favor ' +
    '(3) Identify the specific person at each agency to send it to based on relationship graph and CRM intelligence ' +
    '(4) Timing recommendation - when to send, what to follow up with, and how to position for pre-proposal meeting ' +
    '(5) Any active disaster declarations or federal funding announcements where HGI should proactively reach out to state emergency management before procurement is posted ' +
    '(6) Single highest-value unsolicited move HGI can make this month.';
  var out = await claudeCall('You are HGI Unsolicited Proposal Agent, agent 40 of 47. You play offense — you shape procurements before they become RFPs. The NOLA Grant Services pursuit exists because you identified the 2B water infrastructure crisis before any solicitation. An unsolicited proposal that shapes the RFP wins the competitive bid that follows. You play offense. You shape procurement before it is posted. You turn HGI relationships into competitive advantage before competitors even know the RFP exists.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('UNSOLICITED complete: ' + out.length + ' chars');
  await storeMemory('unsolicited_agent', null, 'unsolicited,pre_solicitation,relationship_leverage', 'UNSOLICITED:\n' + out, 'pattern');
  return { agent: 'unsolicited_agent', chars: out.length };
}

// ── AGENT 41: RECOMPETE AGENT (HGI own contracts) ────────────────
// Manages HGI existing contracts approaching recompete
async function agentRecompete(state, ctx) {
  log('RECOMPETE: monitoring HGI contract recompetes...');
  var prompt = HGI +
    '\n\nHGI PAST CONTRACTS:\n' +
    'Road Home Program - completed 2015, Louisiana Office of Community Development\n' +
    'HAP - Hurricane housing assistance, multiple states\n' +
    'Restore Louisiana - $42.3M, GOHSEP, completed\n' +
    'TPSD Terrebonne Parish School Board - $2.96M, completed 2022-2025\n' +
    'St. John Sheriff - $788K\n' +
    'BP GCCF - $1.65M, 2010-2013\n' +
    'Rebuild NJ - $67.7M\n' +
    '\n\nCURRENT PIPELINE:\n' + state.pipeline.map(function(o){return (o.title||'?').slice(0,50)+' | '+o.agency+' | '+o.stage;}).join('\n') +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: HGIs best opportunities are with agencies that already know and trust them. ' +
    '(1) For each past HGI contract - what is the current status of that program? Is it still running under a new contract? Who won it after HGI? ' +
    '(2) Which past HGI clients have new or ongoing program needs that could generate new work - follow-on contracts, program expansions, new disaster events ' +
    '(3) TPSD completed 2025 - what is the next procurement opportunity with Terrebonne Parish School Board? ' +
    '(4) Any past HGI client agencies that have upcoming RFPs NOT currently in the pipeline ' +
    '(5) Relationship maintenance recommendations - which past clients should HGI be touching base with now before they post ' +
    '(6) Single highest-value recompete or follow-on opportunity from past clients HGI should be actively pursuing.';
  var out = await claudeCall('You are HGI Recompete Agent, agent 41 of 47. Recompetes are HGIs highest-probability proposals. The work is known, the relationships are established, and the past performance narrative writes itself. You identify recompete windows 6 to 12 months out so HGI has maximum time to strengthen relationships and write a proposal that demonstrates incumbency advantage. You mine HGIs 95-year history for the next contract. Past clients are the warmest leads. You turn relationships into revenue.', prompt, 1000);
  if (!out || out.length < 100) return null;
  log('RECOMPETE complete: ' + out.length + ' chars');
  await storeMemory('recompete_agent', null, 'recompete,past_clients,follow_on', 'RECOMPETE:\n' + out, 'pattern');
  return { agent: 'recompete_agent', chars: out.length };
}

// ── AGENT 42: COMPETITOR DEEP DIVE ───────────────────────────────
// Builds permanent profiles on each named competitor — compounds over time
async function agentCompetitorDeepDive(state, ctx) {
  log('COMPETITOR DEEP DIVE: building competitor profiles...');
  var prompt = HGI +
    '\n\nKNOWN COMPETITORS IN HGI MARKETS:\n' +
    'CDR Maguire - Louisiana dominant, FEMA PA specialist, primary threat\n' +
    'Tetra Tech/AMR - national firm, deep FEMA relationships, high capacity\n' +
    'IEM Inc - Louisiana-based, emergency management, FEMA PA\n' +
    'Hagerty Consulting - national, FEMA PA, grant management\n' +
    'Innovative Emergency Management - Louisiana, smaller firm\n' +
    '\n\nACTIVE PIPELINE (these agencies will receive competitor bids):\n' + state.pipeline.map(function(o){return (o.title||'?').slice(0,50)+' | '+o.agency+' | OPI:'+o.opi_score;}).join('\n') +
    '\n\nCOMPETITIVE INTEL STORE:\n' + ctx.compText +
    '\n\nMEMORY:\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: Build and update permanent competitor intelligence profiles. ' +
    '(1) For each named competitor - current known strengths, weaknesses, key personnel, recent wins and losses, pricing patterns ' +
    '(2) Which competitor is the primary threat on each active HGI pipeline opportunity and why ' +
    '(3) Any recent competitor news - new hires, lost contracts, performance issues, strategic pivots that create opportunity for HGI ' +
    '(4) Where each competitor is WEAK that HGI is STRONG - this is the wedge strategy for each pursuit ' +
    '(5) Any new competitors entering HGI markets that are not yet on the radar ' +
    '(6) Single most actionable competitive intelligence finding that changes HGI strategy today.';
  var out = await claudeCall('You are HGI Competitor Deep Dive Agent, agent 42 of 47. Your competitor profiles are the proposals differentiation engine. When you know CDR Maguire prices Program Directors at 195/hr in Louisiana HGI can price strategically. When you know IEMs technical approach tends toward generic templates HGIs proposal counters with Louisiana-specific methodology. Every competitor insight you store makes the next proposal sharper. You build permanent competitor profiles that compound over time. Every finding makes the next session smarter. You know the enemy better than they know themselves.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('COMPETITOR DEEP DIVE complete: ' + out.length + ' chars');
  await storeMemory('competitor_deep_dive', null, 'competitors,CDR_Maguire,Tetra_Tech,IEM,Hagerty,competitive_profiles', 'COMPETITOR DEEP DIVE:\n' + out, 'competitive_intel');
  return { agent: 'competitor_deep_dive', chars: out.length };
}

// ── AGENT 43: AGENCY PROFILE AGENT ───────────────────────────────
// Deep dossier on each agency in the pipeline — compounds over sessions
async function agentAgencyProfile(state, ctx) {
  log('AGENCY PROFILE: building agency dossiers...');
  var agencies = [...new Set(state.pipeline.filter(function(o){return (o.opi_score||0)>=65;}).map(function(o){return o.agency||'unknown';}))];
  if (!agencies.length) return null;
  var prompt = HGI +
    '\n\nAGENCIES IN ACTIVE PIPELINE:\n' + agencies.join('\n') +
    '\n\nCURRENT INTELLIGENCE:\n' + ctx.memText.slice(0,1200) +
    '\n\nRELATIONSHIP GRAPH:\n' + ctx.relText +
    '\n\nMISSION: Build deep profiles on every agency HGI is currently pursuing. This compounds over sessions. ' +
    '(1) For each agency - budget size, annual procurement volume, organizational structure, key leadership names and titles ' +
    '(2) Procurement patterns - do they favor best value or low price? How do they weight past performance? Do they rebid or sole source? ' +
    '(3) Political and policy context - who are the elected officials or appointees overseeing this agency, what are their priorities ' +
    '(4) HGI relationship history with this agency - any past work, known contacts, warm or cold ' +
    '(5) What this agency specifically values in a contractor based on past award patterns ' +
    '(6) Single most important agency-specific insight that should change how HGI writes its proposal for this agency.';
  var out = await claudeCall('You are HGI Agency Profile Agent, agent 43 of 47. Every agency has priorities, pain points, and preferences that shape what they score. A St. George evaluator is asking: do these people understand MY specific disaster situation — DR-4277, DR-4611, DR-4817? Your agency intelligence makes proposals feel personal rather than templated. That distinction wins evaluator points. You build deep agency intelligence that makes every proposal more targeted. You know what each agency wants before they publish the RFP.', prompt, 1500);
  if (!out || out.length < 100) return null;
  log('AGENCY PROFILE complete: ' + out.length + ' chars');
  await storeMemory('agency_profile_agent', null, agencies.join(',') + ',agency_intelligence', 'AGENCY PROFILE:\n' + out, 'analysis');
  return { agent: 'agency_profile_agent', chars: out.length };
}

// ── AGENT 44: PRICE-TO-WIN ────────────────────────────────────────
// Dedicated to one thing: the exact number to submit to win
async function agentPriceToWin(opp, ctx) {
  if ((opp.opi_score||0) < 65) return null;
  log('PRICE-TO-WIN: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI +
    '\n\n' + oppBase(opp) +
    '\n\nFINANCIAL ANALYSIS ALREADY PRODUCED:\n' + (opp.financial_analysis||'not yet produced').slice(0,600) +
    '\n\nCOMPETITOR PRICING INTEL:\n' + ctx.compText +
    '\n\nMEMORY (includes pricing benchmarks from past sessions):\n' + ctx.memText.slice(0,800) +
    '\n\nMISSION: Give HGI the exact number. Not a range. The price to win. ' +
    '(1) Pull every comparable contract award for this agency type and scope from organism memory and web intelligence - name each comp with agency, amount, period, scope ' +
    '(2) What did CDR Maguire, Tetra Tech, or IEM charge for similar work at similar agencies ' +
    '(3) Is this agency a lowest-price-technically-acceptable buyer or best-value? What is the price premium they have historically paid for quality ' +
    '(4) Given the competitive field for THIS specific opportunity - what is the price that beats likely competitors while maintaining margin ' +
    '(5) Calculate from three independent methods: (a) staffing hours x rates, (b) comparable contract benchmarks, (c) percentage of total program funding ' +
    '(6) THE NUMBER: single recommended total bid price with brief rationale. Base period only. Show option year pricing separately.';
  var out = await claudeCall('You are HGI Price-to-Win Agent, agent 44 of 47. You give one number — the right number derived from comparable awards, competitor pricing patterns, and this specific agencys price sensitivity. That number becomes the pricing exhibit in the proposal. Wrong pricing loses contracts that the technical volume won. You give one number. The right number. The number that beats competitors and wins the contract. You are the difference between a winning bid and a losing one.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('PRICE-TO-WIN complete: ' + out.length + ' chars');
  await storeMemory('price_to_win', opp.id, (opp.agency||'') + ',price_to_win,pricing_strategy', 'PRICE-TO-WIN - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'pricing_benchmark');
  return { agent: 'price_to_win', opp: opp.title, chars: out.length };
}

// ── AGENT 45: SUBCONTRACTOR DATABASE ─────────────────────────────
// Builds and maintains the bench of subs and teaming partners
async function agentSubcontractorDatabase(state, ctx) {
  log('SUBCONTRACTOR DB: building vendor bench...');
  var gaps = state.pipeline.filter(function(o){return (o.opi_score||0)>=65;}).map(function(o){return (o.title||'?').slice(0,50)+' | vertical:'+o.vertical;}).join('\n');
  var prompt = HGI +
    '\n\nACTIVE PURSUITS NEEDING SUBCONTRACTORS:\n' + gaps +
    '\n\nKNOWN CAPABILITY GAPS FROM MEMORY:\n' + ctx.memText.slice(0,600) +
    '\n\nMISSION: Build and maintain a living subcontractor and teaming partner database. ' +
    '(1) For each active pursuit - what subcontractor capabilities are needed that HGI does not have in-house: environmental compliance, historic preservation, construction cost estimation, GPC-certified grant management, SDVOSB/8(a)/WOSB certifications ' +
    '(2) Identify specific firms by name for each gap: Louisiana-based firms in SAM.gov contractor registry, SBA certified firms, state vendor registries in LA/TX/FL/MS ' +
    '(3) For each recommended firm - capability alignment, certifications, known past performance in HGI verticals, strategic fit score ' +
    '(4) Any firms HGI has teamed with before that should be on retainer for future pursuits ' +
    '(5) Any certification gaps (8a, SDVOSB, HUBZONE) where having a certified teaming partner would unlock set-aside opportunities HGI currently cannot pursue ' +
    '(6) Single most valuable new teaming relationship HGI should establish before the next major deadline.';
  var out = await claudeCall('You are HGI Subcontractor Database Agent, agent 45 of 47. Every teaming partner and subcontractor you identify is a specific proposal weakness being eliminated. No Mississippi relationships? A Mississippi-based firm with MEMA access named in the proposal fixes that. No Construction Manager? You find credentialed candidates before the submission deadline. You build the bench that fills the gaps. Every capability HGI lacks, you find someone who has it. You make HGI bigger than it is on every single bid.', prompt, 1200);
  if (!out || out.length < 100) return null;
  log('SUBCONTRACTOR DB complete: ' + out.length + ' chars');
  await storeMemory('subcontractor_db', null, 'subcontractors,teaming,vendor_bench,certifications', 'SUBCONTRACTOR DB:\n' + out, 'pattern');
  return { agent: 'subcontractor_db', chars: out.length };
}

// ── AGENT 46: ENHANCED CONTENT ENGINE ────────────────────────────
// Full V1 content engine — active voice tracking, style guide, winning language library
async function agentContentEngineV2(state, ctx) {
  log('CONTENT ENGINE V2: deep language analysis...');
  var allDrafts = state.pipeline.filter(function(o){return (o.staffing_plan||'').length>200;}).map(function(o){
    return '=== ' + (o.title||'?').slice(0,40) + ' ===\n' + (o.staffing_plan||'').slice(0,600);
  }).join('\n\n');
  if (!allDrafts) { log('CONTENT ENGINE V2: no drafts'); return null; }
  var prompt = HGI +
    '\n\nALL CURRENT PROPOSAL DRAFTS:\n' + allDrafts +
    '\n\nMEMORY (includes past content patterns):\n' + ctx.memText.slice(0,600) +
    '\n\nHGI VOICE STANDARDS: Active voice 75%+ target. Lead with outcomes not activities. Quantify everything. Reference HGI specific past performance not generic claims. Every claim needs evidence.\n' +
    '\n\nMISSION: Full content quality audit and improvement. ' +
    '(1) ACTIVE VOICE AUDIT: scan every sentence. Flag every passive construction. Rewrite each one. Count active vs passive ratio per proposal. ' +
    '(2) EVIDENCE AUDIT: every claim must be backed by a specific number, project, or verifiable fact. Flag every unsubstantiated assertion. Provide the specific evidence that should replace it from HGI past performance. ' +
    '(3) DIFFERENTIATION AUDIT: where does the proposal sound like every other firm? Identify the 5 most generic sentences and rewrite them to be specifically HGI. ' +
    '(4) TERMINOLOGY AUDIT: is the proposal using the most current domain terminology for this vertical? FEMA PA terminology, CDBG-DR language, WIOA regulatory language, housing program terms. Flag outdated or incorrect terminology. ' +
    '(5) WINNING LANGUAGE LIBRARY: extract the 5 strongest sentences from all current drafts that should be preserved and used as templates in future proposals. ' +
    '(6) SINGLE HIGHEST IMPACT REWRITE: take the one sentence across all drafts that is weakest and costing the most points, and show the before/after.';
  var out = await claudeCall('You are HGI Content Engine V2, agent 46 of 47. You enforce HGI voice standards across every proposal section. Active voice. Evidence-backed claims. Differentiated language only HGI can write. AI-sounding generic language loses to specific credentialed Louisiana-rooted language that proves HGI has actually done this work. Every sentence you improve moves the proposal score higher. You enforce HGI voice standards. Active voice. Evidence-backed claims. Differentiated language. You build the winning language library that makes every future proposal stronger than the last.', prompt, 2000);
  if (!out || out.length < 100) return null;
  log('CONTENT ENGINE V2 complete: ' + out.length + ' chars');
  await storeMemory('content_engine_v2', null, 'voice,active_voice,winning_language,style_guide', 'CONTENT ENGINE V2:\n' + out, 'pattern');
  return { agent: 'content_engine_v2', chars: out.length };
}

// ── AGENT 47: ENHANCED FINANCIAL + PRICING ───────────────────────
// Full V1 financial — USAspending data, agency pricing patterns, HGI pricing history
async function agentFinancialV2(opp, ctx) {
  log('FINANCIAL V2: ' + (opp.title||'?').slice(0,50));
  var prompt = HGI +
    '\n\n' + oppBase(opp) +
    '\n\nEXISTING FINANCIAL ANALYSIS:\n' + (opp.financial_analysis||'not yet run').slice(0,400) +
    '\n\nCOMPETITOR PRICING INTEL:\n' + ctx.compText +
    '\n\nMEMORY (includes past award benchmarks):\n' + ctx.memText.slice(0,1000) +
    '\n\nMISSION: Complete financial intelligence and pricing model. ' +
    '(1) MARKET RATE ANALYSIS: from USAspending.gov and organism memory - list every comparable contract award for this agency type, scope, and geography. Name agency, awardee, amount, period, and scope for each. Minimum 5 comps. ' +
    '(2) AGENCY BUDGET CONTEXT: what is this agency total annual budget? What percentage typically goes to professional services contracts of this type? ' +
    '(3) PRICING PATTERN: does this agency historically award to lowest price technically acceptable or best value? What is the premium they have paid for quality in past awards? ' +
    '(4) STAFFING-BASED MODEL: build from the ground up using HGI rate card. Show hours per position per month, rates, total annual cost, overhead, fee, and grand total for base year. ' +
    '(5) THREE METHODS with visible math: (a) staffing-based bottom-up, (b) comparable contract top-down, (c) percentage of total program funding. Show all three calculations. ' +
    '(6) FINAL RECOMMENDATION: LOW/MID/HIGH range with rationale. Recommended bid price. Option year pricing. Any pricing risks specific to this agency.';
  var out = await claudeCall('You are HGI Financial V2 Agent, agent 47 of 47. Your three independent pricing methods with visible math — staffing math, comparable contracts, percentage of program funding — become the proposal pricing exhibit the evaluator scores. Base period only, option years shown separately, LOW/MID/HIGH range clearly labeled. Your numbers ARE the cost proposal. You build the complete financial picture. USAspending benchmarks. Agency patterns. Three independent methods. Visible math. The pricing model that wins.', prompt, 6000);
  if (!out || out.length < 100) return null;
  log('FINANCIAL V2 complete: ' + out.length + ' chars');
  await storeMemory('financial_v2', opp.id, (opp.agency||'') + ',financial_v2,pricing_model', 'FINANCIAL V2 - ' + (opp.title||'').slice(0,50) + ':\n' + out, 'pricing_benchmark');
  await supabase.from('opportunities').update({ financial_analysis: out.slice(0,60000), last_updated: new Date().toISOString() }).eq('id', opp.id);
  return { agent: 'financial_v2', opp: opp.title, chars: out.length };
}

// ── SESSION ────────────────────────────────────────────────────────
async function runSession(trigger) {
  var id = 'v2-' + Date.now();
  log('=== SESSION START: ' + id + ' | trigger: ' + trigger + ' | 6 agents ===');

  try {
    var state = await loadState();

    if (state.pipeline.length === 0) {
      log('No pipeline records. Session complete.');
      await storeMemory('v2_engine', null, 'v2,session', 'V2 SESSION - no pipeline. Trigger: ' + trigger, 'analysis');
      return;
    }

    log('Pipeline (' + state.pipeline.length + ' opps):');
    state.pipeline.forEach(function(o) { log('  OPI:' + o.opi_score + ' | ' + (o.stage||'?') + ' | ' + (o.title||'').slice(0,55)); });

    var ctx = buildCtx(state);
    var activeOpps = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 65; });
    var allResults = [];

    // HUNTING AGENT fires first — finds and adds new opportunities before analysis runs
    log('HUNTING for new opportunities across all portals...');
    try { var rHunt = await agentHunting(state, ctx); if (rHunt) { allResults.push(rHunt); if (rHunt.new_opps > 0) { log('HUNTING added ' + rHunt.new_opps + ' new opportunities — refreshing pipeline...'); var freshPipeline = await supabase.from('opportunities').select('*').eq('status','active').order('opi_score', { ascending: false }).limit(10); if (freshPipeline.data) { state.pipeline = freshPipeline.data; activeOpps = state.pipeline.filter(function(o) { return (o.opi_score||0) >= 65; }); } } } } catch(e) { log('Hunting error: ' + e.message); }

    log('Firing agents on ' + activeOpps.length + ' opportunities OPI 65+...');

    for (var i = 0; i < activeOpps.length; i++) {
      var opp = activeOpps[i];
      log('--- Opportunity ' + (i+1) + '/' + activeOpps.length + ': ' + (opp.title||'?').slice(0,50) + ' ---');

      // Fire agents sequentially per opportunity so each builds on prior
      try { var r1 = await agentIntelligence(opp, ctx); if (r1) allResults.push(r1); } catch(e) { log('Intel error: ' + e.message); }

      // Refresh opp record so financial sees intel findings
      try { var fresh = await supabase.from('opportunities').select('*').eq('id', opp.id).single(); if (fresh.data) opp = fresh.data; } catch(e) {}

      try { var r2 = await agentFinancial(opp, ctx); if (r2) allResults.push(r2); } catch(e) { log('Financial error: ' + e.message); }
      try { var r3 = await agentWinnability(opp, ctx); if (r3) allResults.push(r3); } catch(e) { log('Winnability error: ' + e.message); }
      try { var r4 = await agentCRM(opp, ctx); if (r4) allResults.push(r4); } catch(e) { log('CRM error: ' + e.message); }
      try { var r5 = await agentQualityGate(opp, ctx); if (r5) allResults.push(r5); } catch(e) { log('QualityGate error: ' + e.message); }
    }

    // System-wide agents (run once, see full pipeline)
    log('--- System-wide agents ---');
    try { var rD = await agentDiscovery(state, ctx); if (rD) allResults.push(rD); } catch(e) { log('Discovery error: ' + e.message); }
    try { var rPS = await agentPipelineScanner(state, ctx); if (rPS) allResults.push(rPS); } catch(e) { log('PipelineScanner error: ' + e.message); }
    try { var rOPI = await agentOPICalibration(state, ctx); if (rOPI) allResults.push(rOPI); } catch(e) { log('OPICalibration error: ' + e.message); }
    try { var rCE = await agentContentEngine(state, ctx); if (rCE) allResults.push(rCE); } catch(e) { log('ContentEngine error: ' + e.message); }
    try { var rRec = await agentRecruiting(state, ctx); if (rRec) allResults.push(rRec); } catch(e) { log('Recruiting error: ' + e.message); }
    try { var rKB = await agentKnowledgeBase(state, ctx); if (rKB) allResults.push(rKB); } catch(e) { log('KB error: ' + e.message); }
    try { var rSI = await agentScraperInsights(state, ctx); if (rSI) allResults.push(rSI); } catch(e) { log('ScraperInsights error: ' + e.message); }
    try { var rEB = await agentExecutiveBrief(state, ctx); if (rEB) allResults.push(rEB); } catch(e) { log('ExecBrief error: ' + e.message); }
    try { var rDM = await agentDisasterMonitor(state, ctx); if (rDM) allResults.push(rDM); } catch(e) { log('DisasterMonitor error: ' + e.message); }
    try { var rDB = await agentDashboard(state, ctx); if (rDB) allResults.push(rDB); } catch(e) { log('Dashboard error: ' + e.message); }
    try { var rDV = await agentDesignVisual(state, ctx); if (rDV) allResults.push(rDV); } catch(e) { log('DesignVisual error: ' + e.message); }
    try { var rTM = await agentTeaming(state, ctx); if (rTM) allResults.push(rTM); } catch(e) { log('Teaming error: ' + e.message); }
    try { var rSE = await agentSourceExpansion(state, ctx); if (rSE) allResults.push(rSE); } catch(e) { log('SourceExpansion error: ' + e.message); }
    try { var rCE2 = await agentContractExpiration(state, ctx); if (rCE2) allResults.push(rCE2); } catch(e) { log('ContractExpiration error: ' + e.message); }
    try { var rBC = await agentBudgetCycle(state, ctx); if (rBC) allResults.push(rBC); } catch(e) { log('BudgetCycle error: ' + e.message); }
    try { var rLA = await agentLossAnalysis(state, ctx); if (rLA) allResults.push(rLA); } catch(e) { log('LossAnalysis error: ' + e.message); }
    try { var rWR = await agentWinRateAnalytics(state, ctx); if (rWR) allResults.push(rWR); } catch(e) { log('WinRate error: ' + e.message); }
    try { var rRM = await agentRegulatoryMonitor(state, ctx); if (rRM) allResults.push(rRM); } catch(e) { log('RegulatoryMonitor error: ' + e.message); }
    try { var rOA = await agentOutreachAutomation(state, ctx); if (rOA) allResults.push(rOA); } catch(e) { log('Outreach error: ' + e.message); }
    try { var rLL = await agentLearningLoop(state, ctx); if (rLL) allResults.push(rLL); } catch(e) { log('LearningLoop error: ' + e.message); }
    try { var rAT = await agentAmendmentTracker(state, ctx); if (rAT) allResults.push(rAT); } catch(e) { log('AmendmentTracker error: ' + e.message); }
    try { var rMN = await agentMobileNotifications(state, ctx); if (rMN) allResults.push(rMN); } catch(e) { log('MobileNotifications error: ' + e.message); }
    try { var rEI = await agentEntrepreneurial(state, ctx); if (rEI) allResults.push(rEI); } catch(e) { log('Entrepreneurial error: ' + e.message); }
    try { var rEM = await agentExecBriefingMode(state, ctx); if (rEM) allResults.push(rEM); } catch(e) { log('ExecBriefingMode error: ' + e.message); }
    try { var rUn = await agentUnsolicited(state, ctx); if (rUn) allResults.push(rUn); } catch(e) { log('Unsolicited error: ' + e.message); }
    try { var rRC = await agentRecompete(state, ctx); if (rRC) allResults.push(rRC); } catch(e) { log('Recompete error: ' + e.message); }
    try { var rCD = await agentCompetitorDeepDive(state, ctx); if (rCD) allResults.push(rCD); } catch(e) { log('CompetitorDeepDive error: ' + e.message); }
    try { var rAP = await agentAgencyProfile(state, ctx); if (rAP) allResults.push(rAP); } catch(e) { log('AgencyProfile error: ' + e.message); }
    try { var rSD = await agentSubcontractorDatabase(state, ctx); if (rSD) allResults.push(rSD); } catch(e) { log('SubcontractorDB error: ' + e.message); }
    try { var rCEV2 = await agentContentEngineV2(state, ctx); if (rCEV2) allResults.push(rCEV2); } catch(e) { log('ContentEngineV2 error: ' + e.message); }

    // Proposal writer fires on proposal-stage opps
    for (var pw = 0; pw < activeOpps.length; pw++) {
      try { var rPW = await agentProposalWriter(activeOpps[pw], ctx); if (rPW) allResults.push(rPW); } catch(e) { log('ProposalWriter error: ' + e.message); }
      try { var rRT = await agentRedTeam(activeOpps[pw], ctx); if (rRT) allResults.push(rRT); } catch(e) { log('RedTeam error: ' + e.message); }
      try { var rBr = await agentBrief(activeOpps[pw], ctx); if (rBr) allResults.push(rBr); } catch(e) { log('Brief error: ' + e.message); }
      try { var rOB = await agentOppBrief(activeOpps[pw], ctx); if (rOB) allResults.push(rOB); } catch(e) { log('OppBrief error: ' + e.message); }
      try { var rPA = await agentProposalAssembly(activeOpps[pw], ctx); if (rPA) allResults.push(rPA); } catch(e) { log('ProposalAssembly error: ' + e.message); }
      try { var rSP = await agentStaffingPlan(activeOpps[pw], ctx); if (rSP) allResults.push(rSP); } catch(e) { log('StaffingPlan error: ' + e.message); }
      try { var rPTW = await agentPriceToWin(activeOpps[pw], ctx); if (rPTW) allResults.push(rPTW); } catch(e) { log('PriceToWin error: ' + e.message); }
      try { var rFV2 = await agentFinancialV2(activeOpps[pw], ctx); if (rFV2) allResults.push(rFV2); } catch(e) { log('FinancialV2 error: ' + e.message); }
      try { var rPO = await agentPostAward(state, ctx); if (rPO) allResults.push(rPO); } catch(e) { log('PostAward error: ' + e.message); }
      try { var rOP = await agentOralPrep(state, ctx); if (rOP) allResults.push(rOP); } catch(e) { log('OralPrep error: ' + e.message); }
    }

    // Self-awareness runs last — sees everything
    try { var rSA = await agentSelfAwareness(state, allResults, ctx); if (rSA) allResults.push(rSA); } catch(e) { log('SelfAwareness error: ' + e.message); }

    await storeMemory('v2_engine', null, 'v2,session,phase3',
      'V2 SESSION - trigger:' + trigger + ' pipeline:' + state.pipeline.length + ' agents_completed:' + allResults.length + ' uptime:' + Math.floor(process.uptime()) + 's',
      'analysis'
    );

    log('=== SESSION COMPLETE: ' + id + ' | ' + allResults.length + ' agent outputs ===');
    log('Completed: ' + allResults.map(function(r) { return r.agent + '(' + r.chars + ')'; }).join(', '));

  } catch(e) {
    log('SESSION ERROR: ' + e.message);
  }
}

log('==========================================================');
log('HGI LIVING ORGANISM V2 - STARTING');
log('47 agents active. All into all.');
log('V2.9.0-fortyseven-agents. One shared brain.');
log('This server never sleeps. It never times out.');
log('==========================================================');

setTimeout(function() { runSession('startup').catch(console.error); }, 3000);

setInterval(function() {
  var hour = new Date().getUTCHours();
  var min = new Date().getUTCMinutes();
  if (hour === 12 && min === 0) {
    log('Daily 6AM CST session firing');
    runSession('scheduled_daily').catch(console.error);
  }
}, 60000);

log('Startup complete. V2.9.0 — 47 agents. Session in 3s...');
