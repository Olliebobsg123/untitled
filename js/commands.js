"use strict";

// ==============================================
// FORCE LOG TO EXIST AND WORK NO MATTER WHAT
// ==============================================
window.log = function(msg, type = 'info') {

  const out = document.getElementById('termLog');
  if (!out) {
    console.warn("[LOG] termLog not found in HTML");
    return;
  }
  const line = document.createElement('div');
  line.style.cssText = "padding:2px 4px; font-family:monospace; font-size:11px; line-height:1.4; border-bottom:1px solid #222;";
  line.style.color = type === 'warn' ? '#ffcc00' : type === 'error' ? '#ff5555' : '#88ff88';
  line.textContent = `[${type.toUpperCase()}] ${msg}`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
};

log("✅ Log system ready — you should see this line!", "ok");

window.State = window.State || {
  fixtures: [],
  selected: new Set(),
  groups: [],
  cues: [],
  current: { intensity: 100, hue: 0, sat: 0, strobe: 0, master: 100, pan: 128, tilt: 128 },
  currentCue: -1,
  fixtureStates: new Map()
};

function updateControlsForSelection() {
  if (window.buildControls) buildControls();
  if (window.updateColourWheel) updateColourWheel();
}

function parseSelection(str) {
  if (!str) return [];
  const clean = str.replace(/thru|–|-/g, ' ').trim();
  const parts = clean.split(/[, ]+/).filter(Boolean);
  const nums = [];
  for (const p of parts) {
    if (!p) continue;
    const n = Number(p);
    if (!isNaN(n)) nums.push(n);
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

window.Chases = window.Chases || {};
window.ActiveChase = null;

const FrozenColours = {
  elsa:    { hue: 210, sat: 70 },
  ice:     { hue: 195, sat: 60 },
  snow:    { hue: 200, sat: 20 },
  sky:     { hue: 220, sat: 50 },
  aurora:  { hue: 280, sat: 65 },
  castle:  { hue: 45,  sat: 40 },
  kristoff:{ hue: 30,  sat: 60 },
  sven:    { hue: 25, sat: 70 },
  olaf:    { hue: 50, sat: 80 },
  forest:  { hue: 140, sat: 55 },
  night:   { hue: 260, sat: 45 }
};
const cueColours = {
  red:{hue:0,sat:100}, green:{hue:120,sat:100}, blue:{hue:240,sat:100},
  white:{hue:0,sat:0}, yellow:{hue:60,sat:100}, cyan:{hue:180,sat:100},
  magenta:{hue:300,sat:100}, orange:{hue:30,sat:100}, ...FrozenColours
};

// COMMAND LIST WITH SYNTAX HINTS
const commandDefs = [
  {cmd:"artnet", hint:""},
  {cmd:"clear", hint:""},
  {cmd:"release", hint:""},
  {cmd:"blackout", hint:""},
  {cmd:"full", hint:""},
  {cmd:"all", hint:"[25/50/75/half]"},
  {cmd:"group", hint:"[number] = [fixtures] / [name] / at [value] / colour [name]"},
  {cmd:"delete group", hint:"[name]"},
  {cmd:"record cue", hint:"[number] [name]"},
  {cmd:"delete cue", hint:"[number]"},
  {cmd:"update cue", hint:"[number] / name [name] / fade [seconds] / follow [seconds|off]"},
  {cmd:"rename cue", hint:"[number] [name]"},
  {cmd:"follow cue", hint:"[number] [seconds/off]"},
  {cmd:"copy cue", hint:"[from] to [to] [name]"},
  {cmd:"move cue", hint:"[from] to [to]"},
  {cmd:"cue", hint:"[number]"},
  {cmd:"fade", hint:"[number] [seconds]"},
  {cmd:"go", hint:"[number]"},
  {cmd:"next", hint:""},
  {cmd:"back", hint:""},
  {cmd:"previous", hint:""},
  {cmd:"prev", hint:""},
  {cmd:"at", hint:"[0-100]"},
  {cmd:"colour", hint:"[name]"},
  {cmd:"color", hint:"[name]"},
  {cmd:"strobe", hint:"[0-255/off]"},
  {cmd:"reset", hint:""},
  {cmd:"visualizer", hint:""},
  {cmd:"viz", hint:""},
  {cmd:"list groups", hint:""},
  {cmd:"list cues", hint:""},
  {cmd:"status", hint:""},
  {cmd:"chase", hint:"[number] = [cue numbers] speed [ms]"},
  {cmd:"run chase", hint:"[number]"},
  {cmd:"stop chase", hint:""},
  {cmd:"halt chase", hint:""}
];

let autocompleteMatches = [];
function getAutocompleteList() {
  const names = (window.State?.groups || []).map(g => g.name.toLowerCase());
  const cmds = commandDefs.map(c => c.cmd);
  return [...new Set([...cmds, ...Object.keys(cueColours), ...names])].sort();
}

function getSyntaxHint(input) {
  const lower = input.toLowerCase().trim();
  const match = commandDefs.find(c => lower.startsWith(c.cmd) || c.cmd.startsWith(lower));
  return match ? match.hint : "";
}

function setupAutocomplete(inputId = "cmdInput") {
  const input = document.getElementById(inputId);
  if (!input) return console.warn("[AUTOCOMPLETE] Input #" + inputId + " NOT FOUND");

  if (document.getElementById("cmdAutocompleteWrap")) {
    document.getElementById("cmdAutocompleteWrap").replaceWith(input);
  }
  const wrap = document.createElement("div");
  wrap.id = "cmdAutocompleteWrap";
  wrap.style.position = "relative";
  wrap.style.display = "block";
  wrap.style.width = "100%";
  wrap.style.height = "100%";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  input.style.position = "relative";
  input.style.zIndex = "10";

  const hint = document.createElement("span");
  hint.id = "cmdHint";
  hint.style.cssText = `
    position: absolute; inset: 0;
    padding: inherit; margin: inherit; border: inherit;
    text-align: left; pointer-events: none;
    color: rgba(160, 160, 160, 0.45);
    font: inherit; letter-spacing: inherit;
    white-space: nowrap; overflow: hidden;
    display: flex; align-items: center; gap: 18px;
    z-index: 5;
  `;
  wrap.appendChild(hint);

  const syncPadding = () => {
    const style = getComputedStyle(input);
    hint.style.padding = style.padding;
    hint.style.textIndent = style.textIndent;
  };
  setTimeout(syncPadding, 10);

  input.addEventListener("input", () => {
    const val = input.value.trimStart().toLowerCase();
    hint.textContent = "";
    autocompleteMatches = [];
    if (!val) return;

    autocompleteMatches = getAutocompleteList().filter(c => c.startsWith(val));
    const syntax = getSyntaxHint(val);

    if (autocompleteMatches.length) {
      hint.innerHTML = autocompleteMatches.map(m => `<span>${m.slice(val.length)}</span>`).join("");
      if (syntax) hint.innerHTML += ` <span style="color:rgba(100,180,255,0.5)">${syntax}</span>`;
    } else if (syntax) {
      hint.innerHTML = `<span style="color:rgba(100,180,255,0.5)">${syntax}</span>`;
    }
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Tab" && autocompleteMatches.length) {
      e.preventDefault();
      input.value = autocompleteMatches[0] + " ";
      input.dispatchEvent(new Event("input"));
      setTimeout(() => input.focus(), 0);
    }
    if (e.key === "Escape") {
      hint.textContent = "";
      autocompleteMatches = [];
    }
  });

  console.log("[AUTOCOMPLETE] Ready");
}

function waitForState(cb, tries = 0) {
  if (window.State && window.State.fixtures) return cb();
  if (tries > 50) return console.error("[INIT] State never loaded!");
  setTimeout(() => waitForState(cb, tries + 1), 50);
}

window.addEventListener("load", () => {
  waitForState(() => {
    setupAutocomplete();
    console.log("[SYSTEM] Commands ready — State loaded");
  });
});

function parseCommand(cmd) {
  console.log("[COMMAND] Received:", JSON.stringify(cmd));
  if (!cmd || !cmd.trim()) return log("Empty command", "warn");
  if (!window.State || !window.State.fixtures) {
    console.warn("[COMMAND] State not ready yet — try again in a moment");
    return log("System still starting — wait 1 second", "warn");
  }
  const c = String(cmd).toLowerCase().trim();

  if (/^visualizer$|^viz$/.test(c)) {
    window.open('visualizer.html', '_blank', 'width=1280,height=800,menubar=no,toolbar=no');
    return log('✅ Visualizer opened in new window', 'ok');
  }
  if (/^artnet$/.test(c)) {
    document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    document.querySelector('[data-page="settings"]')?.classList.add('active');
    document.getElementById('page-settings')?.classList.add('active');
    return log('Opened Art-Net Settings', 'ok');
  }
  if (/^(clear|release)$/.test(c)) {
    State.selected.clear(); renderFixtures();
    return log('Cleared selection', 'ok');
  }
  if (/^blackout$/.test(c)) {
    fadeTo({ intensity: 0, strobe: 0 }, 500);
    Object.assign(State.current, { intensity: 0, strobe: 0 });
    const intEl = document.getElementById('intensity');
    const valEl = document.getElementById('intVal');
    if (intEl) intEl.value = 0;
    if (valEl) valEl.textContent = '0%';
    updateDMX();
    return log('Blackout — all lights off', 'ok');
  }
  if (/^(full|all)$/.test(c)) {
    fadeTo({ intensity: 100, strobe: 0 }, 500);
    Object.assign(State.current, { intensity: 100, strobe: 0 });
    const intEl = document.getElementById('intensity');
    const valEl = document.getElementById('intVal');
    if (intEl) intEl.value = 100;
    if (valEl) valEl.textContent = '100%';
    updateDMX();
    return log('Full On — all lights 100%', 'ok');
  }
  if (/^all half$/.test(c)) {
    Object.assign(State.current,{intensity:50}); fadeTo({intensity:50},300); updateDMX();
    return log('All @ 50%', 'ok');
  }
  if (/^all 25$/.test(c)) {
    Object.assign(State.current,{intensity:25}); fadeTo({intensity:25},300); updateDMX();
    return log('All @ 25%', 'ok');
  }
  if (/^all 75$/.test(c)) {
    Object.assign(State.current,{intensity:75}); fadeTo({intensity:75},300); updateDMX();
    return log('All @ 75%', 'ok');
  }
  if (/^reset$/.test(c)) {
    State.current={intensity:100,hue:0,sat:0,strobe:0,master:100,pan:128,tilt:128}; updateDMX();
    return log('Reset to default', 'ok');
  }
  if (/^status$/.test(c)) {
    return log(`Selected: ${State.selected.size} | Groups: ${State.groups.length} | Cues: ${State.cues.length}`, 'ok');
  }
  if (/^list groups$/.test(c)) {
    return log(State.groups.map(g=>g.name).join(', ') || 'No groups saved', 'ok');
  }
  if (/^list cues$/.test(c)) {
    return log(State.cues.map((q,i)=>`${i+1}: ${q?.name||'Cue'} (${q?.fade??800}ms${q?.followEnabled?' · Follow '+(q.follow??0)+'s':''})`).join(', ') || 'No cues saved', 'ok');
  }

  const namedGrp = State.groups.find(x => x.name.toLowerCase() === c);
  if (namedGrp) {
    State.selected.clear(); let found=0;
    namedGrp.members.forEach(n=>{const f=State.fixtures[n-1];if(f){State.selected.add(f.id);found++}});
    const currInt = State.current.intensity??100;
    const intEl = document.getElementById('intensity');
    const valEl = document.getElementById('intVal');
    if (intEl) intEl.value = currInt;
    if (valEl) valEl.textContent = currInt+'%';
    renderFixtures(); updateControlsForSelection(); updateDMX();
    return log(`✅ Selected "${namedGrp.name}": ${found}/${namedGrp.members.length} — DMX active`, 'ok');
  }

  let g;
  if (g = c.match(/^group\s+(\d+)\s*=\s*((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))$/)) {
    const num = Number(g[1]);
    const members = parseSelection(g[2]);
    if (!members.length) return log("No valid fixture numbers", "warn");
    const existing = State.groups.find(x => x.name === `Group ${num}`);
    existing ? existing.members = members : State.groups.push({ name: `Group ${num}`, members });
    renderGroups();
    return log(`Group ${num} saved: ${members.join(', ')}`, 'ok');
  }
  if (g = c.match(/^group\s+(\d+)\s+name\s+(.+)$/)) {
    const num = Number(g[1]);
    const newName = g[2].trim();
    if (!newName) return log('Name cannot be empty','warn');
    const grp = State.groups.find(x => x.name === `Group ${num}`);
    if (!grp) return log(`Group ${num} not found — create it first`,'warn');
    grp.name = newName; renderGroups();
    return log(`Group ${num} renamed → "${newName}"`, 'ok');
  }
  if (g = c.match(/^delete\s+group\s+(.+)$/)) {
    const name = g[1].trim();
    const idx = State.groups.findIndex(x => x.name.toLowerCase() === name.toLowerCase() || x.name === `Group ${name}`);
    if (idx < 0) return log(`Group "${name}" not found`,'warn');
    State.groups.splice(idx,1); renderGroups();
    return log(`Deleted group: ${name}`, 'ok');
  }
  if (g = c.match(/^group\s+(\d+)$/)) {
    const name = `Group ${g[1]}`;
    const grp = State.groups.find(x => x.name === name);
    if (!grp) return log(`${name} not defined`,'warn');
    State.selected.clear(); let found=0;
    grp.members.forEach(n=>{ const f=State.fixtures[n-1]; if(f){State.selected.add(f.id);found++} });
    if (!found) return log('⚠️ No fixtures found — check patch numbers','warn');
    const currInt = State.current.intensity??100;
    const intEl = document.getElementById('intensity');
    const valEl = document.getElementById('intVal');
    if (intEl) intEl.value = currInt;
    if (valEl) valEl.textContent = currInt+'%';
    renderFixtures(); updateControlsForSelection(); updateDMX();
    return log(`✅ ${name}: ${found}/${grp.members.length} — DMX active`, 'ok');
  }
  if (g = c.match(/^group\s+(\d+)\s+at\s+(\d+\.?\d*)$/)) {
    const grp = State.groups.find(x=>x.name===`Group ${g[1]}`);
    if (!grp) return log('Group not found','warn');
    const v = Math.max(0,Math.min(100,parseFloat(g[2])));
    State.selected.clear(); grp.members.forEach(n=>{const f=State.fixtures[n-1];if(f)State.selected.add(f.id)});
    Object.assign(State.current,{intensity:v}); fadeTo({intensity:v},300); updateDMX();
    const intEl = document.getElementById('intensity');
    const valEl = document.getElementById('intVal');
    if (intEl) intEl.value = v;
    if (valEl) valEl.textContent = v+'%';
    renderFixtures(); updateControlsForSelection();
    return log(`Group ${g[1]} @ ${v}%`, 'ok');
  }
  if (g = c.match(/^group\s+(\d+)\s+colou?r\s+(\w+)$/)) {
    const grp = State.groups.find(x=>x.name===`Group ${g[1]}`);
    const col = cueColours[g[2]];
    if (!grp) return log('Group not found','warn');
    if (!col) return log(`Unknown colour: ${g[2]}`,'warn');
    State.selected.clear(); grp.members.forEach(n=>{const f=State.fixtures[n-1];if(f)State.selected.add(f.id)});
    Object.assign(State.current,col); fadeTo(col,300); updateDMX();
    renderFixtures(); updateControlsForSelection();
    return log(`Group ${g[1]} → ${g[2]}`, 'ok');
  }

  if (g = c.match(/^(.*?)\s+at\s+(\d+\.?\d*)$/)) {
    const grp = State.groups.find(x=>x.name.toLowerCase()===g[1].trim().toLowerCase());
    if (!grp) return log(`Group "${g[1].trim()}" not found`,'warn');
    const v = Math.max(0,Math.min(100,parseFloat(g[2])));
    State.selected.clear(); grp.members.forEach(n=>{const f=State.fixtures[n-1];if(f)State.selected.add(f.id)});
    Object.assign(State.current,{intensity:v}); fadeTo({intensity:v},300); updateDMX();
    const intEl = document.getElementById('intensity');
    const valEl = document.getElementById('intVal');
    if (intEl) intEl.value = v;
    if (valEl) valEl.textContent = v+'%';
    renderFixtures(); updateControlsForSelection();
    return log(`"${grp.name}" @ ${v}%`, 'ok');
  }
  if (g = c.match(/^(.*?)\s+colou?r\s+(\w+)$/)) {
    const grp = State.groups.find(x=>x.name.toLowerCase()===g[1].trim().toLowerCase());
    const col = cueColours[g[2]];
    if (!grp) return log(`Group "${g[1].trim()}" not found`,'warn');
    if (!col) return log(`Unknown colour: ${g[2]}`,'warn');
    State.selected.clear(); grp.members.forEach(n=>{const f=State.fixtures[n-1];if(f)State.selected.add(f.id)});
    Object.assign(State.current,col); fadeTo(col,300); updateDMX();
    renderFixtures(); updateControlsForSelection();
    return log(`"${grp.name}" → ${g[2]}`, 'ok');
  }

  let ch;
  if (ch = c.match(/^chase\s+(\d+)\s*=\s*((?:\d+\s*,\s*)*\d+)\s+speed\s+(\d+)$/)) {
    const id=Number(ch[1]), cues=ch[2].split(',').map(Number).filter(n=>!isNaN(n)), spd=Math.max(100,Number(ch[3]));
    Chases[id]={cues,speed:spd,idx:0};
    return log(`Chase ${id} = Cues ${cues.join(', ')} @ ${spd}ms`, 'ok');
  }
  if (/^run\s+chase\s+(\d+)$/.test(c)) {
    const id=Number(RegExp.$1); if(!Chases[id])return log(`Chase ${id} not found`,'warn');
    if(ActiveChase)clearInterval(ActiveChase);
    ActiveChase=setInterval(()=>{
      const o=Chases[id]; if(!o)return clearInterval(ActiveChase);
      const t=o.cues[o.idx]; if(State.cues[t-1])goToCue(t-1);
      o.idx=(o.idx+1)%o.cues.length;
    },Chases[id].speed);
    return log(`Running Chase ${id}`, 'ok');
  }
  if (/^(stop|halt)\s+chase$/.test(c)) {
    if(ActiveChase)clearInterval(ActiveChase); ActiveChase=null;
    return log('Chase stopped', 'ok');
  }

  const rec = c.match(/^record\s+cue\s+((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))(?:\s+(.+))?$/);
  if (rec) {
    const cues=parseSelection(rec[1]), nm=rec[3]?.trim()||'Cue';
    cues.forEach((n,i)=>recordCue(n,cues.length>1?`${nm} ${n}`:nm));
    return log(`Recorded: ${cues.join(', ')}`, 'ok');
  }
  const delcue = c.match(/^delete\s+cue\s+((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))$/);
  if (delcue) {
    const nums=parseSelection(delcue[1]);
    nums.forEach(n=>deleteCue(n));
    return log(`Deleted cues: ${nums.join(', ')}`, 'ok');
  }

  const setfade = c.match(/^fade\s+(\d+)\s+(\d*\.?\d+)$/);
  if (setfade) {
    const cueNum = Number(setfade[1]);
    const sec = parseFloat(setfade[2]);
    if (sec < 0) return log('Fade time cannot be negative', 'warn');
    const idx = cueNum - 1;
    if (!State.cues[idx]) return log(`Cue ${cueNum} not found`, 'warn');
    State.cues[idx].fade = Math.round(sec * 1000);
    renderCues();
    return log(`✅ Cue ${cueNum} fade set to ${sec}s = ${State.cues[idx].fade}ms`, 'ok');
  }
  const quickfade = c.match(/^fade\s+(\d+)$/);
  if (quickfade) {
    const n = Number(quickfade[1]);
    const idx = n - 1;
    if (!State.cues[idx]) return log(`Cue ${n} not found`, 'warn');
    goToCue(idx);
    return log(`Fading to Cue ${n} (${State.cues[idx].fade}ms)`, 'ok');
  }

  if (/^go\s+(\d+)$/.test(c)) {
    const n = Number(RegExp.$1);
    const idx = n - 1;
    if (!State.cues[idx]) return log(`Cue ${n} not found`, 'warn');
    goToCue(idx);
    return;
  }
  if (/^(go|next)$/.test(c)) {
    if(!State.cues.length)return log('No cues saved','warn');
    let nxt=(State.currentCue<0||State.currentCue>=State.cues.length-1)?0:State.currentCue+1;
    goToCue(nxt); return;
  }
  if (/^(back|previous|prev)$/.test(c)) {
    if(!State.cues.length)return log('No cues saved','warn');
    let prv=State.currentCue<=0?State.cues.length-1:State.currentCue-1;
    goToCue(prv); return;
  }

  const selm = c.match(/^((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))$/);
  if (selm) {
    const s=new Set(); parseSelection(selm[1]).forEach(n=>{const f=State.fixtures[n-1];if(f)s.add(f.id)});
    if(s.size){State.selected=s;renderFixtures();return log(`Selected ${s.size} fixture(s)`, 'ok')}
  }

  const atv = c.match(/at\s+(\d+\.?\d*)/);
  if (atv && State.selected.size) {
    const v=Math.max(0,Math.min(100,parseFloat(atv[1])));
    Object.assign(State.current,{intensity:v}); fadeTo({intensity:v},300); updateDMX();
    const intEl=document.getElementById('intensity'),valEl=document.getElementById('intVal');
    if(intEl)intEl.value=v;if(valEl)valEl.textContent=v+'%';
    return log(`@ ${v}%`, 'ok');
  }

  const colm = c.match(/(red|green|blue|white|yellow|cyan|magenta|orange|elsa|ice|snow|sky|aurora|castle|kristoff|sven|olaf|forest|night)/);
  if (colm && State.selected.size) {
    const cl=cueColours[colm[1]]; Object.assign(State.current,cl); fadeTo(cl,300); updateDMX();
    return log(`Colour: ${colm[1]}`, 'ok');
  }

  const stbm = c.match(/strobe\s+(\d+|off)/);
  if (stbm && State.selected.size) {
    const v=stbm[1]==='off'?0:Math.max(0,Math.min(255,Number(stbm[1])));
    State.current.strobe=v; updateDMX();
    return log(v===0?'Strobe off':`Strobe ${v}`, 'ok');
  }

  console.warn("[COMMAND] UNKNOWN:", cmd);
  log(`Unknown command: ${cmd} — type "status" to see what's loaded`, 'warn');
}

// ============================================================
// CUE PROGRAMMING COMMAND EXTENSIONS
// ============================================================
(function installCueProgrammingCommands(){
  const originalParseCommand = window.parseCommand || parseCommand;

  const cloneCueValue = value => {
    if (value === undefined) return value;
    try { return structuredClone(value); } catch (_) {}
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };

  const cueExists = n => Number.isInteger(Number(n)) && Number(n) >= 1 && !!State.cues[Number(n)-1];
  const cueAt = n => State.cues[Number(n)-1];
  const cueRefresh = () => {
    if (typeof renderCues === 'function') renderCues();
    if (typeof window.updateInspectorList === 'function') window.updateInspectorList();
  };

  window.parseCommand = function(rawCommand){
    const c = String(rawCommand || '').trim().toLowerCase();
    let m;

    if ((m = c.match(/^update\s+cue\s+(\d+)$/))) {
      const n=Number(m[1]);
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      return updateCue(n) ? log(`Updated Cue ${n} from current programmer state`, 'ok') : undefined;
    }

    if ((m = c.match(/^update\s+cue\s+(\d+)\s+name\s+(.+)$/))) {
      const n=Number(m[1]), name=m[2].trim();
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      if (!name) return log('Cue name cannot be empty', 'warn');
      return updateCue(n,{name}) ? log(`Cue ${n} renamed → "${name}"`, 'ok') : undefined;
    }

    if ((m = c.match(/^rename\s+cue\s+(\d+)\s+(.+)$/))) {
      const n=Number(m[1]), name=m[2].trim();
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      if (!name) return log('Cue name cannot be empty', 'warn');
      cueAt(n).name=name; cueRefresh();
      return log(`Cue ${n} renamed → "${name}"`, 'ok');
    }

    if ((m = c.match(/^update\s+cue\s+(\d+)\s+fade\s+(\d*\.?\d+)$/))) {
      const n=Number(m[1]), sec=Number(m[2]);
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      if (!Number.isFinite(sec) || sec < 0) return log('Fade time cannot be negative', 'warn');
      return updateCue(n,{fade:Math.round(sec*1000)}) ? log(`Cue ${n} fade updated to ${sec}s`, 'ok') : undefined;
    }

    if ((m = c.match(/^update\s+cue\s+(\d+)\s+follow\s+(off|\d*\.?\d+)$/))) {
      const n=Number(m[1]);
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      if (m[2] === 'off') return updateCue(n,{follow:0,followEnabled:false}) ? log(`Cue ${n} follow disabled`, 'ok') : undefined;
      const seconds=Number(m[2]);
      if (!Number.isFinite(seconds) || seconds < 0) return log('Follow time cannot be negative', 'warn');
      return updateCue(n,{follow:seconds,followEnabled:true}) ? log(`Cue ${n} follow set to ${seconds}s`, 'ok') : undefined;
    }

    if ((m = c.match(/^follow\s+cue\s+(\d+)\s+(off|\d*\.?\d+)$/))) {
      const n=Number(m[1]);
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      if (m[2] === 'off') {
        cueAt(n).follow=0; cueAt(n).followEnabled=false; cueRefresh();
        return log(`Cue ${n} follow disabled`, 'ok');
      }
      const seconds=Number(m[2]);
      if (!Number.isFinite(seconds) || seconds < 0) return log('Follow time cannot be negative', 'warn');
      cueAt(n).follow=seconds; cueAt(n).followEnabled=true; cueRefresh();
      return log(`Cue ${n} follow set to ${seconds}s`, 'ok');
    }

    if ((m = c.match(/^copy\s+cue\s+(\d+)\s+to\s+(\d+)(?:\s+(.+))?$/))) {
      const from=Number(m[1]), to=Number(m[2]);
      if (!cueExists(from)) return log(`Cue ${from} not found`, 'warn');
      if (to < 1) return log('Destination cue must be 1 or higher', 'warn');
      const source=cueAt(from);
      const copy=cloneCueValue(source);
      if (!copy) return log(`Could not copy Cue ${from}`, 'warn');
      copy.name=(m[3]||source.name||`Cue ${to}`).trim() || `Cue ${to}`;
      while(State.cues.length < to) State.cues.push(null);
      State.cues[to-1]=copy;
      cueRefresh();
      return log(`Copied Cue ${from} → Cue ${to}`, 'ok');
    }

    if ((m = c.match(/^move\s+cue\s+(\d+)\s+to\s+(\d+)$/))) {
      const from=Number(m[1]), to=Number(m[2]);
      if (!cueExists(from)) return log(`Cue ${from} not found`, 'warn');
      if (to < 1) return log('Destination cue must be 1 or higher', 'warn');
      while(State.cues.length < to) State.cues.push(null);
      const moved=State.cues[from-1];
      State.cues[to-1]=moved;
      State.cues[from-1]=null;
      if (State.currentCue === from-1) State.currentCue=to-1;
      cueRefresh();
      return log(`Moved Cue ${from} → Cue ${to}`, 'ok');
    }

    if ((m = c.match(/^cue\s+(\d+)(?:\s+go)?$/))) {
      const n=Number(m[1]);
      if (!cueExists(n)) return log(`Cue ${n} not found`, 'warn');
      return goToCue(n-1);
    }

    return originalParseCommand(rawCommand);
  };
})();
