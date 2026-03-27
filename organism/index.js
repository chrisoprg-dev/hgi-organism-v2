function getInterface() {
  var css = '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    ':root{--navy:#1B2A4A;--gold:#C8A55A;--cream:#F8F6F1;--warm:#E8E4DC;--text:#2C2C2C;--muted:#6B6B6B;--green:#2D7A4F}' +
    'body{font-family:Inter,sans-serif;background:var(--cream);color:var(--text);display:flex;flex-direction:column;min-height:100vh}' +
    '.sb{width:240px;background:var(--navy);min-height:100vh;position:fixed;left:0;top:0;bottom:0;display:flex;flex-direction:column;z-index:100}' +
    '.lg{padding:22px 20px;border-bottom:1px solid rgba(200,165,90,0.3)}' +
    '.lg h1{font-family:Cormorant Garamond,serif;color:var(--gold);font-size:18px;font-weight:600}' +
    '.lg p{color:rgba(255,255,255,0.45);font-size:11px;margin-top:3px}' +
    '.nav{flex:1;padding:12px 0;overflow-y:auto}' +
    '.ns{padding:8px 16px 4px;color:rgba(200,165,90,0.55);font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase}' +
    '.ni{display:flex;align-items:center;gap:10px;padding:9px 20px;color:rgba(255,255,255,0.6);font-size:13px;cursor:pointer;border-left:3px solid transparent;transition:all 0.15s}' +
    '.ni:hover{color:#fff;background:rgba(255,255,255,0.06)}' +
    '.ni.act{color:var(--gold);border-left-color:var(--gold);background:rgba(200,165,90,0.1)}' +
    '.dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:0.5;flex-shrink:0}' +
    '.sf{padding:14px 20px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(255,255,255,0.35)}' +
    '.sd{width:7px;height:7px;border-radius:50%;background:#2D7A4F;box-shadow:0 0 6px #2D7A4F}' +
    '.main{margin-left:240px;flex:1;display:flex;flex-direction:column}' +
    '.tb{background:#fff;border-bottom:1px solid var(--warm);padding:0 32px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}' +
    '.tv{font-family:Cormorant Garamond,serif;font-size:20px;font-weight:600;color:var(--navy)}' +
    '.rb{background:var(--gold);color:var(--navy);border:none;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer}' +
    '.rb:hover{opacity:0.85}.tm{display:flex;align-items:center;gap:14px}.tt{font-size:12px;color:var(--muted)}' +
    '.ct{flex:1;padding:28px 32px;padding-bottom:80px}' +
    '.bc{background:#fff;border-radius:12px;padding:24px 28px;margin-bottom:20px;border-left:4px solid var(--gold);box-shadow:0 2px 8px rgba(0,0,0,0.06)}' +
    '.bl{font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold);margin-bottom:10px}' +
    '.bt{font-family:Cormorant Garamond,serif;font-size:18px;line-height:1.6;color:var(--navy);font-weight:500}' +
    '.bm{margin-top:10px;font-size:11px;color:var(--muted)}' +
    '.ps{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}' +
    '.pb{background:#fff;border-radius:10px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,0.05);border-top:3px solid var(--gold)}' +
    '.pbl{font-size:10px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:var(--muted)}' +
    '.pbv{font-size:22px;font-weight:600;color:var(--navy);margin-top:4px;font-family:Cormorant Garamond,serif}' +
    '.pbs{font-size:11px;color:var(--muted);margin-top:2px}' +
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}' +
    '.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
    '.st{font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}' +
    '.card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 2px 6px rgba(0,0,0,0.05)}' +
    '.oc{background:#fff;border-radius:10px;padding:14px 18px;margin-bottom:9px;box-shadow:0 1px 4px rgba(0,0,0,0.06);cursor:pointer;border-left:3px solid transparent;transition:all 0.15s}' +
    '.oc:hover{border-left-color:var(--gold)}.ot{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:4px}' +
    '.om{display:flex;gap:7px;align-items:center;flex-wrap:wrap}' +
    '.ob{display:inline-flex;align-items:center;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}' +
    '.oh{background:#E8F5EE;color:var(--green)}.om2{background:#FFF8E7;color:#B8860B}.olw{background:#FDEAEA;color:#C0392B}' +
    '.sbdg{font-size:10px;color:var(--muted);background:var(--warm);padding:2px 7px;border-radius:10px;text-transform:uppercase}' +
    '.db{font-size:10px;color:var(--muted)}' +
    '.mi{padding:11px 0;border-bottom:1px solid var(--warm)}.mi:last-child{border-bottom:none}' +
    '.ma{font-size:10px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:0.5px}' +
    '.mt{font-size:12px;color:var(--text);line-height:1.5;margin-top:2px}.md{font-size:10px;color:var(--muted);margin-top:2px}' +
    '.dp{background:#fff;border-radius:10px;padding:20px;box-shadow:0 2px 6px rgba(0,0,0,0.05);display:none;margin-top:20px}' +
    '.dp.vis{display:block}.dtt{font-family:Cormorant Garamond,serif;font-size:20px;font-weight:600;color:var(--navy);margin-bottom:14px}' +
    '.dsl{font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin-bottom:6px;margin-top:14px}' +
    '.dtx{font-size:12px;line-height:1.6;color:var(--text)}' +
    '.ib{background:#fff;border-top:1px solid var(--warm);padding:12px 32px;display:flex;gap:10px;align-items:center;position:fixed;bottom:0;left:240px;right:0;z-index:99}' +
    '.inp{flex:1;border:1px solid var(--warm);border-radius:8px;padding:9px 15px;font-size:13px;font-family:Inter,sans-serif;outline:none}' +
    '.inp:focus{border-color:var(--gold)}.sbtn{background:var(--navy);color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer}' +
    '.ra{display:none;background:var(--navy);color:rgba(255,255,255,0.9);border-radius:10px;padding:14px 18px;margin-bottom:14px;font-size:13px;line-height:1.6}' +
    '.coming{text-align:center;padding:80px 40px;color:var(--muted)}.coming h2{font-family:Cormorant Garamond,serif;font-size:28px;color:var(--navy);margin-bottom:10px}' +
    '.ld{color:var(--muted);font-size:12px;font-style:italic}</style>';
  var nav = '<nav class="sb"><div class="lg"><h1>HGI Organism</h1><p>V2 &bull; 47 Agents Active</p></div><div class="nav">' +
    '<div class="ns">Command</div>' +
    '<div class="ni act" onclick="sv(this,String.fromCharCode(100,97,115,104))"><span class="dot"></span>Dashboard</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(112,105,112,101))"><span class="dot"></span>Pipeline Tracker</div>' +
    '<div class="ns">Intelligence</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(100,105,115,99))"><span class="dot"></span>Opportunity Discovery</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(114,101,115))"><span class="dot"></span>Research &amp; Analysis</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(119,105,110))"><span class="dot"></span>Winnability Scoring</div>' +
    '<div class="ns">Proposal</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(112,114,111,112))"><span class="dot"></span>Proposal Engine</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(102,105,110))"><span class="dot"></span>Financial &amp; Pricing</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(115,116,97,102,102))"><span class="dot"></span>Recruiting &amp; Bench</div>' +
    '<div class="ns">Operations</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(99,114,109))"><span class="dot"></span>Relationship Intelligence</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(99,111,110,116))"><span class="dot"></span>Content Engine</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(107,98))"><span class="dot"></span>Knowledge Base</div>' +
    '<div class="ns">Leadership</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(100,105,103))"><span class="dot"></span>Weekly Digest</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(101,120,101,99))"><span class="dot"></span>Executive Brief</div>' +
    '<div class="ns">System</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(115,99,97,110))"><span class="dot"></span>Pipeline Scanner</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(115,99,114))"><span class="dot"></span>Scraper Insights</div>' +
    '<div class="ni" onclick="sv(this,String.fromCharCode(99,104,97,116))"><span class="dot"></span>System Chat</div>' +
    '</div><div class="sf"><div class="sd"></div>Organism Active &bull; 47 Agents</div></nav>';
  var body = '<div class="main"><div class="tb"><div class="tv" id="vt">Morning Briefing</div><div class="tm"><span class="tt" id="lc"></span><button class="rb" onclick="rs()">Run Session Now</button></div></div><div class="ct" id="mv"><div class="ld">Loading organism intelligence...</div></div></div>';
  var input = '<div class="ib"><input class="inp" id="ci" placeholder="Ask the organism anything..." onkeydown="if(event.key===String.fromCharCode(69,110,116,101,114))sc()"><button class="sbtn" onclick="sc()">Send</button></div>';
  
  var js = '<script>' +
    'var B=window.location.origin,pp=[],mm=[],so=null;' +
    'function ut(){var n=new Date(),el=document.getElementById("lc");if(el)el.textContent=n.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})+" "+n.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});}setInterval(ut,1000);ut();' +
    'function opc(o){var pi=o.opi_score||0,pc=pi>=80?"oh":pi>=65?"om2":"olw",dd=o.due_date?new Date(o.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"",title=(o.title||"").slice(0,65),stage=o.stage||"identified",id=JSON.stringify(o.id);return "<div class=\"oc\" onclick=\"selO("+id+")\" ><div class=\"ot\">"+title+"</div><div class=\"om\"><span class=\"ob "+pc+"\">OPI "+pi+"</span><span class=\"sbdg\">"+stage+"</span>"+(dd?"<span class=\"db\">Due "+dd+"</span>":"")+"</div></div>";}' +
    'function selO(id){var o=pp.find(function(p){return p.id===id;});if(!o)return;so=o;var dp=document.getElementById("det");if(!dp)return;dp.className="dp vis";var left=o.scope_analysis?"<div class=\"dsl\">Scope Analysis</div><div class=\"dtx\">"+o.scope_analysis.slice(0,400)+"...</div>":"",right=o.research_brief?"<div class=\"dsl\">Research Brief</div><div class=\"dtx\">"+o.research_brief.slice(0,400)+"...</div>":"";var am=mm.filter(function(m){return m.opportunity_id===id;}).slice(0,4);if(am.length)right+="<div class=\"dsl\">Agent Intel</div>"+am.map(function(m){return"<div class=\"mi\"><div class=\"ma\">"+m.agent+"</div><div class=\"mt\">"+m.observation.slice(0,150)+"</div></div>";}).join("");dp.innerHTML="<div class=\"dtt\">"+(o.title||"")+"</div><div style=\"display:grid;grid-template-columns:1fr 1fr;gap:16px\"><div>"+left+"</div><div>"+right+"</div></div>";dp.scrollIntoView({behavior:"smooth",block:"nearest"});}' +
    'function rd(brief){var tv=pp.reduce(function(s,o){return s+(parseFloat((o.estimated_value||"").replace(/[^0-9.]/g,""))||0);},0),wv=pp.reduce(function(s,o){return s+(parseFloat((o.estimated_value||"").replace(/[^0-9.]/g,""))||0)*((o.opi_score||50)/100);},0),pur=pp.filter(function(o){return o.stage==="pursuing"||o.stage==="proposal";}).length,t1=pp.filter(function(o){return o.opi_score>=75;}).length,bt=brief||"The organism has been working overnight across "+pp.length+" active opportunities. "+t1+" are Tier 1 (OPI 75+). "+pur+" in active pursuit or proposal stage.",mv=document.getElementById("mv");if(!mv)return;mv.innerHTML="<div class=\"bc\"><div class=\"bl\">Morning Briefing</div><div class=\"bt\">"+bt.slice(0,500)+"</div><div class=\"bm\">dashboard_agent &bull; 47 agents active</div></div>"+"<div class=\"ps\"><div class=\"pb\"><div class=\"pbl\">Active Opps</div><div class=\"pbv\">"+pp.length+"</div><div class=\"pbs\">in pipeline</div></div><div class=\"pb\"><div class=\"pbl\">Tier 1 OPI 75+</div><div class=\"pbv\">"+t1+"</div><div class=\"pbs\">high priority</div></div><div class=\"pb\"><div class=\"pbl\">In Pursuit</div><div class=\"pbv\">"+pur+"</div><div class=\"pbs\">active proposals</div></div><div class=\"pb\"><div class=\"pbl\">Pipeline Value</div><div class=\"pbv\">$"+(tv>0.1?tv.toFixed(1):"-")+"M</div><div class=\"pbs\">total estimated</div></div><div class=\"pb\"><div class=\"pbl\">Weighted Revenue</div><div class=\"pbv\">$"+(wv>0.1?wv.toFixed(1):"-")+"M</div><div class=\"pbs\">probability-adj</div></div></div>"+"<div class=\"two\"><div><div class=\"sh\"><div class=\"st\">Active Pipeline ("+pp.length+")</div></div>"+pp.map(opc).join("")+"</div><div><div class=\"sh\"><div class=\"st\">Organism Activity</div></div><div class=\"card\" style=\"max-height:480px;overflow-y:auto\">"+mm.slice(0,15).map(function(m){return"<div class=\"mi\"><div class=\"ma\">"+m.agent+"</div><div class=\"mt\">"+m.observation.slice(0,160)+"</div><div class=\"md\">"+new Date(m.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+"</div></div>";}).join("")+"</div></div></div>"+"<div id=\"det\" class=\"dp\"></div><div id=\"ra\" class=\"ra\"></div><div style=\"height:60px\"></div>";}' +
    'function la(){Promise.all([fetch(B+"/api/pipeline").then(function(r){return r.json();}),fetch(B+"/api/memories").then(function(r){return r.json();}),fetch(B+"/api/briefing").then(function(r){return r.json();})]).then(function(res){pp=res[0]||[];mm=res[1]||[];rd((res[2]||{}).briefing);}).catch(function(e){var mv=document.getElementById("mv");if(mv)mv.innerHTML="<div class=\"ld\">Error: "+e.message+"</div>";});}' +
    'function sv(el,v){document.querySelectorAll(".ni").forEach(function(n){n.classList.remove("act");});el.classList.add("act");var tmap={dash:"Morning Briefing",pipe:"Pipeline Tracker",disc:"Opportunity Discovery",res:"Research & Analysis",win:"Winnability Scoring",prop:"Proposal Engine",fin:"Financial & Pricing",staff:"Recruiting & Bench",crm:"Relationship Intelligence",cont:"Content Engine",kb:"Knowledge Base",dig:"Weekly Digest",exec:"Executive Brief",scan:"Pipeline Scanner",scr:"Scraper Insights",chat:"System Chat"},vt=document.getElementById("vt");if(vt)vt.textContent=tmap[v]||v;if(v==="dash"){la();return;}if(v==="pipe"){var mv=document.getElementById("mv");if(mv)mv.innerHTML="<div class=\"sh\"><div class=\"st\">All Opportunities ("+pp.length+")</div></div>"+pp.map(opc).join("")+"<div id=\"det\" class=\"dp\" style=\"margin-top:20px\"></div>";return;}var mv=document.getElementById("mv");if(mv)mv.innerHTML="<div class=\"coming\"><h2>Coming in Phase 2</h2><p>This module is being built in the next sprint.</p></div>";}' +
    'function rs(){var btn=document.querySelector(".rb");if(btn){btn.textContent="Running...";btn.disabled=true;}fetch(B+"/run-session",{method:"POST"}).then(function(){if(btn){btn.textContent="Done!";setTimeout(function(){btn.textContent="Run Session Now";btn.disabled=false;},3000);}}).catch(function(){if(btn){btn.textContent="Error";btn.disabled=false;}});}' +
    'function sc(){var inp=document.getElementById("ci"),msg=inp?inp.value.trim():"";if(!msg)return;if(inp)inp.value="";var ra=document.getElementById("ra");if(!ra)return;ra.style.display="block";ra.textContent="Thinking...";var ctx=so?"Current opportunity: "+so.title+" (OPI "+so.opi_score+"). ":"",pc=pp.slice(0,5).map(function(o){return o.title.slice(0,40)+" OPI:"+o.opi_score;}).join(", ");fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:800,system:"You are the HGI Organism, 47 agents as one brain for HGI Global. Pipeline: "+pc+". "+ctx+"Be direct and strategic.",messages:[{role:"user",content:msg}]})}).then(function(r){return r.json();}).then(function(d){var t=(d.content||[]).filter(function(b){return b.type==="text";}).map(function(b){return b.text;}).join("");if(ra)ra.textContent=t||"No response.";}).catch(function(e){if(ra)ra.textContent="Error: "+e.message;});}' +
    'la();' +
    '</script>';
  
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>HGI Organism V2</title><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">' + css + '</head><body>' + nav + body + input + js + '</body></html>';
}

