"use strict";

// ==============================================
// COMMAND SYSTEM + FORCE LOG
// ==============================================
// Keep this as an unconditional assignment: the command console must always
// use this logger, even if another script has created window.log first.
window.log = function(msg, type = 'info') {
  const out = document.getElementById('termLog');
  if (!out) {
    console.warn('[LOG] termLog not found in HTML');
    return;
  }
  const line = document.createElement('div');
  line.style.cssText = 'padding:2px 4px;font-family:monospace;font-size:11px;line-height:1.4;border-bottom:1px solid #222;';
  line.style.color = type === 'warn' ? '#ffcc00' : type === 'error' ? '#ff5555' : '#88ff88';
  line.textContent = `[${String(type).toUpperCase()}] ${msg}`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
};

// The DOM may not exist yet when this script is parsed, so show the startup
// message after the page is ready as well as immediately when possible.
function logStartupReady() {
  window.log('✅ Log system ready — you should see this line!', 'ok');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', logStartupReady, { once: true });
} else {
  logStartupReady();
}

window.State = window.State || {
  fixtures: [], selected: new Set(), groups: [], cues: [],
  current: { intensity: 100, hue: 0, sat: 0, strobe: 0, master: 100, pan: 128, tilt: 128 },
  currentCue: -1, fixtureStates: new Map()
};

function updateControlsForSelection() {
  if (typeof window.buildControls === 'function') window.buildControls();
  if (typeof window.updateColourWheel === 'function') window.updateColourWheel();
}

// FIX: expand "1 thru 10", "1-10", "1–10" and comma lists into actual fixture numbers.
function parseSelection(str) {
  if (!str) return [];
  const input = String(str).trim().toLowerCase().replace(/–/g, '-');
  const nums = new Set();
  for (const token of input.split(/\s*,\s*/).filter(Boolean)) {
    const range = token.match(/^\s*(\d+)\s*(?:thru|through|-)\s*(\d+)\s*$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      const step = a <= b ? 1 : -1;
      for (let n = a; ; n += step) {
        nums.add(n);
        if (n === b) break;
      }
      continue;
    }
    for (const part of token.split(/\s+/)) {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0) nums.add(n);
    }
  }
  return [...nums].sort((a, b) => a - b);
}

// FIX: console fixture numbers are not necessarily array indexes.
function getFixtureByNumber(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return null;
  return State.fixtures.find(f => Number(f?.fixtureNumber) === n) || State.fixtures[n - 1] || null;
}

function selectFixtureNumbers(numbers) {
  const selected = new Set();
  for (const number of numbers) {
    const fixture = getFixtureByNumber(number);
    if (fixture) selected.add(fixture.id);
  }
  State.selected = selected;
  return selected.size;
}

window.Chases = window.Chases || {};
window.ActiveChase = window.ActiveChase || null;

const FrozenColours = {
  elsa:{hue:210,sat:70}, ice:{hue:195,sat:60}, snow:{hue:200,sat:20}, sky:{hue:220,sat:50},
  aurora:{hue:280,sat:65}, castle:{hue:45,sat:40}, kristoff:{hue:30,sat:60}, sven:{hue:25,sat:70},
  olaf:{hue:50,sat:80}, forest:{hue:140,sat:55}, night:{hue:260,sat:45}
};
const cueColours = {
  red:{hue:0,sat:100},green:{hue:120,sat:100},blue:{hue:240,sat:100},white:{hue:0,sat:0},
  yellow:{hue:60,sat:100},cyan:{hue:180,sat:100},magenta:{hue:300,sat:100},orange:{hue:30,sat:100},...FrozenColours
};

const commandDefs = [
  {cmd:'artnet',hint:''},{cmd:'clear',hint:''},{cmd:'release',hint:''},{cmd:'blackout',hint:''},{cmd:'full',hint:''},
  {cmd:'all',hint:'[25/50/75/half]'},{cmd:'group',hint:'[number] = [fixtures] / [name] / at [value] / colour [name]'},
  {cmd:'delete group',hint:'[name]'},{cmd:'record cue',hint:'[number] [name]'},{cmd:'delete cue',hint:'[number]'},
  {cmd:'update cue',hint:'[number] / name [name] / fade [seconds] / follow [seconds|off]'},{cmd:'rename cue',hint:'[number] [name]'},
  {cmd:'follow cue',hint:'[number] [seconds/off]'},{cmd:'copy cue',hint:'[from] to [to] [name]'},{cmd:'move cue',hint:'[from] to [to]'},
  {cmd:'cue',hint:'[number]'},{cmd:'fade',hint:'[number] [seconds]'},{cmd:'go',hint:'[number]'},{cmd:'next',hint:''},
  {cmd:'back',hint:''},{cmd:'previous',hint:''},{cmd:'prev',hint:''},{cmd:'at',hint:'[0-100]'},{cmd:'colour',hint:'[name]'},
  {cmd:'color',hint:'[name]'},{cmd:'strobe',hint:'[0-255/off]'},{cmd:'reset',hint:''},{cmd:'visualizer',hint:''},{cmd:'viz',hint:''},
  {cmd:'list groups',hint:''},{cmd:'list cues',hint:''},{cmd:'status',hint:''},{cmd:'chase',hint:'[number] = [cue numbers] speed [ms]'},
  {cmd:'run chase',hint:'[number]'},{cmd:'stop chase',hint:''},{cmd:'halt chase',hint:''},{cmd:'new chase',hint:''}
];

let autocompleteMatches = [];
function getAutocompleteList() {
  const names = (window.State?.groups || []).map(g => String(g.name).toLowerCase());
  return [...new Set([...commandDefs.map(c=>c.cmd), ...Object.keys(cueColours), ...names])].sort();
}
function getSyntaxHint(input) {
  const lower = String(input).toLowerCase().trim();
  const match = commandDefs.find(c => lower.startsWith(c.cmd) || c.cmd.startsWith(lower));
  return match ? match.hint : '';
}
function setupAutocomplete(inputId='cmdInput') {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.autocompleteReady === '1') return;
  input.dataset.autocompleteReady = '1';
  const wrap = document.createElement('div');
  wrap.id = 'cmdAutocompleteWrap';
  wrap.style.cssText = 'position:relative;display:block;width:100%;height:100%;';
  input.parentNode.insertBefore(wrap,input); wrap.appendChild(input);
  input.style.position='relative'; input.style.zIndex='10';
  const hint=document.createElement('span'); hint.id='cmdHint';
  hint.style.cssText='position:absolute;inset:0;padding:inherit;margin:inherit;border:inherit;text-align:left;pointer-events:none;color:rgba(160,160,160,.45);font:inherit;letter-spacing:inherit;white-space:nowrap;overflow:hidden;display:flex;align-items:center;gap:18px;z-index:5;';
  wrap.appendChild(hint);
  const syncPadding=()=>{const s=getComputedStyle(input);hint.style.padding=s.padding;hint.style.textIndent=s.textIndent;};
  setTimeout(syncPadding,10);
  input.addEventListener('input',()=>{
    const val=input.value.trimStart().toLowerCase(); hint.textContent=''; autocompleteMatches=[]; if(!val)return;
    autocompleteMatches=getAutocompleteList().filter(c=>c.startsWith(val)); const syntax=getSyntaxHint(val);
    if(autocompleteMatches.length){hint.textContent=''; autocompleteMatches.forEach(m=>{const s=document.createElement('span');s.textContent=m.slice(val.length);hint.appendChild(s);}); if(syntax){const s=document.createElement('span');s.style.color='rgba(100,180,255,.5)';s.textContent=' '+syntax;hint.appendChild(s);}}
    else if(syntax){const s=document.createElement('span');s.style.color='rgba(100,180,255,.5)';s.textContent=syntax;hint.appendChild(s);}
  });
  input.addEventListener('keydown',e=>{
    if(e.key==='Tab'&&autocompleteMatches.length){e.preventDefault();input.value=autocompleteMatches[0]+' ';input.dispatchEvent(new Event('input'));setTimeout(()=>input.focus(),0);}
    if(e.key==='Escape'){hint.textContent='';autocompleteMatches=[];}
  });
}

function waitForState(cb,tries=0){
  if(window.State&&Array.isArray(window.State.fixtures))return cb();
  if(tries>100)return console.error('[INIT] State never loaded!');
  setTimeout(()=>waitForState(cb,tries+1),50);
}
window.addEventListener('load',()=>waitForState(()=>setupAutocomplete()));

function setIntensityUI(v){
  const intEl=document.getElementById('intensity'), valEl=document.getElementById('intVal') || document.getElementById('intensityVal');
  if(intEl)intEl.value=v; if(valEl)valEl.textContent=v+'%';
}
function selectGroup(grp){
  State.selected.clear(); let found=0;
  (grp.members||[]).forEach(n=>{const f=getFixtureByNumber(n);if(f){State.selected.add(f.id);found++;}});
  renderFixtures?.(); updateControlsForSelection(); updateDMX?.();
  return found;
}
function applyColour(col){Object.assign(State.current,col);fadeTo?.(col,300);updateDMX?.();renderFixtures?.();updateControlsForSelection();}
function applyLevel(v){Object.assign(State.current,{intensity:v});fadeTo?.({intensity:v},300);updateDMX?.();setIntensityUI(v);renderFixtures?.();updateControlsForSelection();}

function parseCommand(cmd){
  console.log('[COMMAND] Received:',JSON.stringify(cmd));
  if(!cmd||!String(cmd).trim())return log('Empty command','warn');
  if(!window.State||!Array.isArray(window.State.fixtures))return log('System still starting — wait 1 second','warn');
  const c=String(cmd).trim().toLowerCase(); let m,g,ch;

  if (c === 'new chase') {
  const btn = document.getElementById('btnSaveChase');

  if (!btn) {
    return log('New Chase button not found', 'warn');
  }

  btn.click();
  return log('New Chase menu opened', 'ok');
}

  if(/^(visualizer|viz)$/.test(c)){window.open('visualizer.html','_blank','width=1280,height=800,menubar=no,toolbar=no');return log('Visualizer opened in new window','ok');}
  if(c==='artnet'){document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelector('[data-page="settings"]')?.classList.add('active');document.getElementById('page-settings')?.classList.add('active');return log('Opened Art-Net Settings','ok');}
  if(/^(clear|release)$/.test(c)){State.selected.clear();renderFixtures?.();return log('Cleared selection','ok');}
  if(c==='blackout'){fadeTo?.({intensity:0,strobe:0},500);Object.assign(State.current,{intensity:0,strobe:0});setIntensityUI(0);updateDMX?.();return log('Blackout — all lights off','ok');}
  if(/^(full|all)$/.test(c)){fadeTo?.({intensity:100,strobe:0},500);Object.assign(State.current,{intensity:100,strobe:0});setIntensityUI(100);updateDMX?.();return log('Full On — all lights 100%','ok');}
  if(c==='all half')applyLevel(50),log('All @ 50%','ok');
  else if(c==='all 25')applyLevel(25),log('All @ 25%','ok');
  else if(c==='all 75')applyLevel(75),log('All @ 75%','ok');
  else if(c==='reset'){State.current={intensity:100,hue:0,sat:0,strobe:0,master:100,pan:128,tilt:128};updateDMX?.();return log('Reset to default','ok');}
  else if(c==='status')return log(`Selected: ${State.selected.size} | Groups: ${State.groups.length} | Cues: ${State.cues.length}`,'ok');
  else if(c==='list groups')return log(State.groups.map(g=>g.name).join(', ')||'No groups saved','ok');
  else if(c==='list cues')return log(State.cues.map((q,i)=>q?`${i+1}: ${q.name||'Cue'} (${q.fade??800}ms${q.followEnabled?' · Follow '+(q.follow??0)+'s':''})`:`${i+1}: [empty]`).join(', ')||'No cues saved','ok');
  else {
    const namedGrp=State.groups.find(x=>String(x.name).toLowerCase()===c);
    if(namedGrp){const found=selectGroup(namedGrp);return log(`Selected "${namedGrp.name}": ${found}/${namedGrp.members.length}`,'ok');}

    if(g=c.match(/^group\s+(\d+)\s*=\s*(.+)$/)){
      const num=Number(g[1]),members=parseSelection(g[2]);
      if(!members.length)return log('No valid fixture numbers','warn');
      const existing=State.groups.find(x=>x.name===`Group ${num}`);
      existing?existing.members=members:State.groups.push({name:`Group ${num}`,members});
      renderGroups?.();return log(`Group ${num} saved: ${members.join(', ')}`,'ok');
    }
    if(g=c.match(/^group\s+(\d+)\s+name\s+(.+)$/)){
      const num=Number(g[1]),name=g[2].trim(),grp=State.groups.find(x=>x.name===`Group ${num}`);
      if(!grp)return log(`Group ${num} not found — create it first`,'warn'); if(!name)return log('Name cannot be empty','warn');
      grp.name=name;renderGroups?.();return log(`Group ${num} renamed → "${name}"`,'ok');
    }
    if(g=c.match(/^delete\s+group\s+(.+)$/)){
      const name=g[1].trim(),idx=State.groups.findIndex(x=>String(x.name).toLowerCase()===name.toLowerCase()||x.name===`Group ${name}`);
      if(idx<0)return log(`Group "${name}" not found`,'warn');State.groups.splice(idx,1);renderGroups?.();return log(`Deleted group: ${name}`,'ok');
    }
    if(g=c.match(/^group\s+(\d+)$/)){
      const name=`Group ${g[1]}`,grp=State.groups.find(x=>x.name===name);
      if(!grp)return log(`${name} not defined`,'warn');const found=selectGroup(grp);if(!found)return log('No fixtures found — check patch numbers','warn');
      setIntensityUI(State.current.intensity??100);return log(`Selected ${name}: ${found}/${grp.members.length}`,'ok');
    }
    if(g=c.match(/^group\s+(\d+)\s+at\s+(\d+\.?\d*)$/)){
      const grp=State.groups.find(x=>x.name===`Group ${g[1]}`);if(!grp)return log('Group not found','warn');selectGroup(grp);const v=Math.max(0,Math.min(100,Number(g[2])));applyLevel(v);return log(`Group ${g[1]} @ ${v}%`,'ok');
    }
    if(g=c.match(/^group\s+(\d+)\s+colou?r\s+(\w+)$/)){
      const grp=State.groups.find(x=>x.name===`Group ${g[1]}`),col=cueColours[g[2]];if(!grp)return log('Group not found','warn');if(!col)return log(`Unknown colour: ${g[2]}`,'warn');selectGroup(grp);applyColour(col);return log(`Group ${g[1]} → ${g[2]}`,'ok');
    }
    if(g=c.match(/^(.*?)\s+at\s+(\d+\.?\d*)$/)){
      const grp=State.groups.find(x=>String(x.name).toLowerCase()===g[1].trim().toLowerCase());if(!grp)return log(`Group "${g[1].trim()}" not found`,'warn');const v=Math.max(0,Math.min(100,Number(g[2])));selectGroup(grp);applyLevel(v);return log(`"${grp.name}" @ ${v}%`,'ok');
    }
    if(g=c.match(/^(.*?)\s+colou?r\s+(\w+)$/)){
      const grp=State.groups.find(x=>String(x.name).toLowerCase()===g[1].trim().toLowerCase()),col=cueColours[g[2]];if(!grp)return log(`Group "${g[1].trim()}" not found`,'warn');if(!col)return log(`Unknown colour: ${g[2]}`,'warn');selectGroup(grp);applyColour(col);return log(`"${grp.name}" → ${g[2]}`,'ok');
    }
    if(ch=c.match(/^chase\s+(\d+)\s*=\s*((?:\d+\s*,\s*)*\d+)\s+speed\s+(\d+)$/)){
      const id=Number(ch[1]),cues=ch[2].split(',').map(Number).filter(n=>!isNaN(n)),spd=Math.max(100,Number(ch[3]));
      Chases[id]={cues,speed:spd,idx:0};return log(`Chase ${id} = Cues ${cues.join(', ')} @ ${spd}ms`,'ok');
    }
    if(/^run\s+chase\s+(\d+)$/.test(c)){
      const id=Number(RegExp.$1);if(!Chases[id])return log(`Chase ${id} not found`,'warn');if(ActiveChase)clearInterval(ActiveChase);
      ActiveChase=setInterval(()=>{const o=Chases[id];if(!o)return clearInterval(ActiveChase);const t=o.cues[o.idx];if(State.cues[t-1])goToCue(t-1);o.idx=(o.idx+1)%o.cues.length;},Chases[id].speed);
      return log(`Running Chase ${id}`,'ok');
    }
    if(/^(stop|halt)\s+chase$/.test(c)){if(ActiveChase)clearInterval(ActiveChase);ActiveChase=null;return log('Chase stopped','ok');}

    const rec=c.match(/^record\s+cue\s+((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))(?:\s+(.+))?$/);
    if(rec){const cues=parseSelection(rec[1]),nm=rec[3]?.trim()||'Cue';cues.forEach((n)=>recordCue(n,cues.length>1?`${nm} ${n}`:nm));return log(`Recorded: ${cues.join(', ')}`,'ok');}
    const delcue=c.match(/^delete\s+cue\s+((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))$/);
    if(delcue){const nums=parseSelection(delcue[1]);nums.forEach(n=>deleteCue(n));return log(`Deleted cues: ${nums.join(', ')}`,'ok');}

    const setfade=c.match(/^fade\s+(\d+)\s+(\d*\.?\d+)$/);
    if(setfade){const cueNum=Number(setfade[1]),sec=parseFloat(setfade[2]);if(sec<0)return log('Fade time cannot be negative','warn');const idx=cueNum-1;if(!State.cues[idx])return log(`Cue ${cueNum} not found`,'warn');State.cues[idx].fade=Math.round(sec*1000);renderCues?.();return log(`Cue ${cueNum} fade set to ${sec}s = ${State.cues[idx].fade}ms`,'ok');}
    const quickfade=c.match(/^fade\s+(\d+)$/);
    if(quickfade){const n=Number(quickfade[1]),idx=n-1;if(!State.cues[idx])return log(`Cue ${n} not found`,'warn');goToCue(idx);return log(`Fading to Cue ${n} (${State.cues[idx].fade??800}ms)`,'ok');}
    if(/^go\s+(\d+)$/.test(c)){const n=Number(RegExp.$1),idx=n-1;if(!State.cues[idx])return log(`Cue ${n} not found`,'warn');goToCue(idx);return;}
    if(/^(go|next)$/.test(c)){if(!State.cues.length)return log('No cues saved','warn');const nxt=(State.currentCue<0||State.currentCue>=State.cues.length-1)?0:State.currentCue+1;goToCue(nxt);return;}
    if(/^(back|previous|prev)$/.test(c)){if(!State.cues.length)return log('No cues saved','warn');const prv=State.currentCue<=0?State.cues.length-1:State.currentCue-1;goToCue(prv);return;}

    const selm=c.match(/^((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))$/);
    if(selm){const count=selectFixtureNumbers(parseSelection(selm[1]));if(count){renderFixtures?.();return log(`Selected ${count} fixture(s)`,'ok');}}

    const atv=c.match(/at\s+(\d+\.?\d*)/);
    if(atv&&State.selected.size){const v=Math.max(0,Math.min(100,parseFloat(atv[1])));applyLevel(v);return log(`@ ${v}%`,'ok');}
    const colm=c.match(/(red|green|blue|white|yellow|cyan|magenta|orange|elsa|ice|snow|sky|aurora|castle|kristoff|sven|olaf|forest|night)/);
    if(colm&&State.selected.size){applyColour(cueColours[colm[1]]);return log(`Colour: ${colm[1]}`,'ok');}
    const stbm=c.match(/strobe\s+(\d+|off)/);
    if(stbm&&State.selected.size){const v=stbm[1]==='off'?0:Math.max(0,Math.min(255,Number(stbm[1])));State.current.strobe=v;updateDMX?.();return log(v===0?'Strobe off':`Strobe ${v}`,'ok');}
    return log(`Unknown command: ${cmd} — type "status" to see what's loaded`,'warn');
  }
}

(function installCueProgrammingCommands(){
  const originalParseCommand = window.parseCommand || parseCommand;
  const cloneCueValue = value => {
    if(value===undefined)return value;
    try{return structuredClone(value);}catch(_){}
    try{return JSON.parse(JSON.stringify(value));}catch(_){return value;}
  };
  const cueExists=n=>Number.isInteger(Number(n))&&Number(n)>=1&&!!State.cues[Number(n)-1];
  const cueAt=n=>State.cues[Number(n)-1];
  const cueRefresh=()=>{if(typeof renderCues==='function')renderCues();if(typeof window.updateInspectorList==='function')window.updateInspectorList();};
  window.parseCommand=function(rawCommand){
    const c=String(rawCommand||'').trim().toLowerCase();let m;
    if((m=c.match(/^update\s+cue\s+(\d+)$/))){const n=Number(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');return updateCue(n)?log(`Updated Cue ${n} from current programmer state`,'ok'):undefined;}
    if((m=c.match(/^update\s+cue\s+(\d+)\s+name\s+(.+)$/))){const n=Number(m[1]),name=m[2].trim();if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(!name)return log('Cue name cannot be empty','warn');return updateCue(n,{name})?log(`Cue ${n} renamed → "${name}"`,'ok'):undefined;}
    if((m=c.match(/^rename\s+cue\s+(\d+)\s+(.+)$/))){const n=Number(m[1]),name=m[2].trim();if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(!name)return log('Cue name cannot be empty','warn');cueAt(n).name=name;cueRefresh();return log(`Cue ${n} renamed → "${name}"`,'ok');}
    if((m=c.match(/^update\s+cue\s+(\d+)\s+fade\s+(\d*\.?\d+)$/))){const n=Number(m[1]),sec=Number(m[2]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(!Number.isFinite(sec)||sec<0)return log('Fade time cannot be negative','warn');return updateCue(n,{fade:Math.round(sec*1000)})?log(`Cue ${n} fade updated to ${sec}s`,'ok'):undefined;}
    if((m=c.match(/^update\s+cue\s+(\d+)\s+follow\s+(off|\d*\.?\d+)$/))){const n=Number(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(m[2]==='off')return updateCue(n,{follow:0,followEnabled:false})?log(`Cue ${n} follow disabled`,'ok'):undefined;const seconds=Number(m[2]);if(!Number.isFinite(seconds)||seconds<0)return log('Follow time cannot be negative','warn');return updateCue(n,{follow:seconds,followEnabled:true})?log(`Cue ${n} follow set to ${seconds}s`,'ok'):undefined;}
    if((m=c.match(/^follow\s+cue\s+(\d+)\s+(off|\d*\.?\d+)$/))){const n=Number(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(m[2]==='off'){cueAt(n).follow=0;cueAt(n).followEnabled=false;cueRefresh();return log(`Cue ${n} follow disabled`,'ok');}const seconds=Number(m[2]);if(!Number.isFinite(seconds)||seconds<0)return log('Follow time cannot be negative','warn');cueAt(n).follow=seconds;cueAt(n).followEnabled=true;cueRefresh();return log(`Cue ${n} follow set to ${seconds}s`,'ok');}
    if((m=c.match(/^copy\s+cue\s+(\d+)\s+to\s+(\d+)(?:\s+(.+))?$/))){const from=Number(m[1]),to=Number(m[2]);if(!cueExists(from))return log(`Cue ${from} not found`,'warn');if(to<1)return log('Destination cue must be 1 or higher','warn');const source=cueAt(from),copy=cloneCueValue(source);if(!copy)return log(`Could not copy Cue ${from}`,'warn');copy.name=(m[3]||source.name||`Cue ${to}`).trim()||`Cue ${to}`;while(State.cues.length<to)State.cues.push(null);State.cues[to-1]=copy;cueRefresh();return log(`Copied Cue ${from} → Cue ${to}`,'ok');}
    if((m=c.match(/^move\s+cue\s+(\d+)\s+to\s+(\d+)$/))){const from=Number(m[1]),to=Number(m[2]);if(!cueExists(from))return log(`Cue ${from} not found`,'warn');if(to<1)return log('Destination cue must be 1 or higher','warn');while(State.cues.length<to)State.cues.push(null);const moved=State.cues[from-1];State.cues[to-1]=moved;State.cues[from-1]=null;if(State.currentCue===from-1)State.currentCue=to-1;cueRefresh();return log(`Moved Cue ${from} → Cue ${to}`,'ok');}
    if((m=c.match(/^cue\s+(\d+)(?:\s+go)?$/))){const n=Number(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');return goToCue(n-1);}
    return originalParseCommand(rawCommand);
  };
})();
