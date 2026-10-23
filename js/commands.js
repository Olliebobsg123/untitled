"use strict";

// ==============================================
// COMMAND CONSOLE LOGGER
// ==============================================

function ensureCommandConsoleStyles() {
  if (document.getElementById('lxCommandConsoleStyles')) return;

  const style = document.createElement('style');
  style.id = 'lxCommandConsoleStyles';

  style.textContent = `
    /* ---------- Console log ---------- */

   #termLog {
  font-family: Inter, "Segoe UI", system-ui, sans-serif !important;
  font-size: 9px !important;
  line-height: 1.5 !important;
  letter-spacing: .025em;
  font-weight: 800;
  text-transform: uppercase;
  overflow-x: hidden;
}

#termLog .lx-log-entry {
  display: grid;
  grid-template-columns: 58px 52px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  padding: 4px 7px;
  border-bottom: 1px solid rgba(255,255,255,.035);
  box-sizing: border-box;
}

#termLog .lx-log-time {
  color: #53615e;
  font-family: var(--mono, monospace);
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
}

#termLog .lx-log-level {
  font-family: var(--mono, monospace);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .08em;
  white-space: nowrap;
}

#termLog .lx-log-level.ok {
  color: #19d6a3;
}

#termLog .lx-log-level.info {
  color: #5ca8ff;
}

#termLog .lx-log-level.warn {
  color: #ffb454;
}

#termLog .lx-log-level.error {
  color: #ff5265;
}

#termLog .lx-log-message {
  min-width: 0;
  color: #e5ecea;
  font-weight: 800;

  /* IMPORTANT: don't cut long messages */
  white-space: normal;
  overflow: visible;
  overflow-wrap: anywhere;
  word-break: break-word;
  text-overflow: clip;
}
  /* ==============================================
   COMMAND AUTOCOMPLETE
   ============================================== */

.cmd-line {
  position: relative !important;
  min-height: 34px !important;
  height: 34px !important;
  overflow: visible !important;
}

/*
 * The autocomplete is INSIDE the command line's
 * positioning context.
 *
 * It sits immediately ABOVE the command bar,
 * without creating another layout row.
 */
#cmdAutocompleteList {
  position: absolute !important;

  left: 0;
  right: 0;

  bottom: calc(100% + 2px);

  height: 24px;
  min-height: 24px;

  display: none;
  align-items: center;

  box-sizing: border-box;

  padding: 0 4px;

  background: #080b0d;

  border: 1px solid #252f34;

  overflow-x: auto;
  overflow-y: hidden;

  white-space: nowrap;

  z-index: 9999;

  font-family: var(--mono, monospace);
}

#cmdAutocompleteList.is-visible {
  display: flex;
}

/* Individual command */
#cmdAutocompleteList .cmd-autocomplete-item {
  flex: 0 0 auto;

  height: 22px;

  display: inline-flex;
  align-items: center;

  gap: 8px;

  padding: 0 9px;

  margin: 0;

  background: transparent;

  border: 0;
  border-right: 1px solid #252d31;

  color: #eef4f2;

  font-family: var(--mono, monospace);

  font-size: 8px;
  font-weight: 900;

  letter-spacing: .04em;

  line-height: 22px;

  text-transform: uppercase;

  white-space: nowrap;

  cursor: pointer;
}

/* Command name */
#cmdAutocompleteList .cmd-autocomplete-command {
  color: #f1f5f4;

  font-weight: 900;
}

/* Parameters / hint */
#cmdAutocompleteList .cmd-autocomplete-hint {
  color: rgba(225,233,231,.48);

  font-weight: 700;

  letter-spacing: .025em;
}

/* Hover */
#cmdAutocompleteList .cmd-autocomplete-item:hover {
  background: rgba(255,255,255,.045);
  color: #ffffff;
}

/* Selected */
#cmdAutocompleteList .cmd-autocomplete-item.is-active {
  background: rgba(25,214,163,.10);

  color: #ffffff;

  box-shadow:
    inset 0 -2px 0 #19d6a3;
}

/* Scrollbar */
#cmdAutocompleteList::-webkit-scrollbar {
  height: 3px;
}

#cmdAutocompleteList::-webkit-scrollbar-track {
  background: #080b0d;
}

#cmdAutocompleteList::-webkit-scrollbar-thumb {
  background: #303a3f;
}
  `;

  document.head.appendChild(style);
}

window.log = function(msg, type = 'info') {
  ensureCommandConsoleStyles();

  const out = document.getElementById('termLog');

  if (!out) {
    console.warn('[LX] termLog not found');
    return;
  }

  const levelMap = {
    ok: 'ok',
    success: 'ok',
    warn: 'warn',
    warning: 'warn',
    error: 'error',
    fail: 'error',
    info: 'info'
  };

  const level = levelMap[String(type).toLowerCase()] || 'info';

  const now = new Date();
  const time =
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');

  const line = document.createElement('div');
  line.className = 'lx-log-entry';

  const timeEl = document.createElement('span');
  timeEl.className = 'lx-log-time';
  timeEl.textContent = time;

  const levelEl = document.createElement('span');
  levelEl.className = `lx-log-level ${level}`;
  levelEl.textContent = level.toUpperCase();

  const messageEl = document.createElement('span');
  messageEl.className = 'lx-log-message';
  messageEl.textContent = String(msg);

  line.appendChild(timeEl);
  line.appendChild(levelEl);
  line.appendChild(messageEl);

  out.appendChild(line);

  // Keep the console responsive.
  while (out.children.length > 250) {
    out.removeChild(out.firstElementChild);
  }

  out.scrollTop = out.scrollHeight;
};

function logStartupReady() {
  ensureCommandConsoleStyles();
  window.log('COMMAND CONSOLE ONLINE', 'ok');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', logStartupReady, { once: true });
} else {
  logStartupReady();
}
// The DOM may not exist yet when this script is parsed, so show the startup
// message after the page is ready as well as immediately when possible.
function logStartupReady() {
  window.log('SYSTEM ONLINE — COMMAND CONSOLE READY', 'ok');
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
  red:{hue:0,sat:100},green:{hue:120,sat:100},blue:{hue:240,sat:100},white:{hue:0,sat:0,light:100},
  yellow:{hue:60,sat:100},cyan:{hue:180,sat:100},magenta:{hue:300,sat:100},orange:{hue:30,sat:100},...FrozenColours
};
// Saturated colours sit at lightness 50; white needs 100 or it comes out as 50% grey.
Object.values(cueColours).forEach(colour => { colour.light ??= 50; });

const commandDefs = [
  {cmd:'artnet',hint:''},{cmd:'clear',hint:''},{cmd:'release',hint:''},{cmd:'blackout',hint:''},{cmd:'full',hint:''},
  {cmd:'all',hint:'[25/50/75/half]'},{cmd:'group',hint:'= [name] [fixtures] / [number] = [fixtures] / [name] / at [value] / colour [name]'},
  {cmd:'delete group',hint:'[name]'},{cmd:'record cue',hint:'[number] [name] — in between too: record cue 1.5'},{cmd:'delete cue',hint:'[number]'},
  {cmd:'update cue',hint:'[number] / name [name] / fade [seconds] / follow [seconds|off]'},{cmd:'rename cue',hint:'[number] [name]'},
  {cmd:'follow cue',hint:'[number] [seconds/off]'},{cmd:'copy cue',hint:'[from] to [to] [name]'},{cmd:'move cue',hint:'[from] to [to]'},
  {cmd:'cue',hint:'[number]'},{cmd:'fade',hint:'[number] [seconds]'},{cmd:'go',hint:'[number]'},{cmd:'next',hint:''},
  {cmd:'back',hint:''},{cmd:'previous',hint:''},{cmd:'prev',hint:''},{cmd:'at',hint:'[0-100]'},{cmd:'colour',hint:'[name]'},
  {cmd:'color',hint:'[name]'},{cmd:'strobe',hint:'[0-255/off]'},{cmd:'reset',hint:''},{cmd:'visualizer',hint:''},{cmd:'viz',hint:''},
  {cmd:'list groups',hint:''},{cmd:'list cues',hint:''},{cmd:'status',hint:''},{cmd:'chase',hint:'[number] = [cue numbers] speed [ms]'},
  {cmd:'run chase',hint:'[number]'},{cmd:'stop chase',hint:''},{cmd:'halt chase',hint:''},{cmd:'new chase',hint:''},{cmd:'delete chase',hint:'number'},{cmd:'chase',hint:'number'},
  {cmd:'new effect',hint:''},{cmd:'run effect',hint:'number'},{cmd:'stop effect',hint:''},{cmd:'effect',hint:'number'},
  {cmd:'target create',hint:'name'},{cmd:'target delete',hint:'name'},{cmd:'targets',hint:''},{cmd:'target aim',hint:'name'},{cmd:'target capture',hint:'name'},{cmd:'target release',hint:'name'},
  {cmd:'save',hint:'[filename.json]'},
{cmd:'load',hint:'[filename.json]'}
];

 // ==============================================
// INLINE COMMAND AUTOCOMPLETE
// ==============================================

// ==============================================
// LMX-STYLE COMMAND LIST
// ==============================================

let autocompleteMatches = [];
let autocompleteIndex = 0;

function getAutocompleteList() {
  const commands = commandDefs.map(command => ({
    value: String(command.cmd).toUpperCase(),
    hint: String(command.hint || '')
  }));

  const colours = Object.keys(cueColours || {}).map(name => ({
    value: String(name).toUpperCase(),
    hint: 'COLOUR'
  }));

  const groups = (window.State?.groups || [])
    .filter(group => group?.name)
    .map(group => ({
      value: String(group.name).toUpperCase(),
      hint: 'GROUP'
    }));

  const all = [...commands, ...colours, ...groups];
  const seen = new Set();

  return all
    .filter(item => {
      const key = item.value.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

function setupAutocomplete(inputId = 'cmdInput') {
  const input = document.getElementById(inputId);

  if (!input || input.dataset.autocompleteReady === '1') {
    return;
  }

  input.dataset.autocompleteReady = '1';

  const commandLine = input.closest('.cmd-line');

  if (!commandLine) {
    console.warn('[AUTOCOMPLETE] .cmd-line not found');
    return;
  }

  /*
   * The command line itself is the positioning anchor.
   * Nothing gets added to the terminal layout.
   */
  commandLine.style.position = 'relative';
  commandLine.style.overflow = 'visible';

  const list = document.createElement('div');
  list.id = 'cmdAutocompleteList';

  commandLine.appendChild(list);

  let matches = [];
  let selectedIndex = 0;

  function getCommands() {
    const result = [];

    commandDefs.forEach(command => {
      result.push({
        value: String(command.cmd),
        hint: String(command.hint || '')
      });
    });

    Object.keys(cueColours || {}).forEach(name => {
      result.push({
        value: String(name),
        hint: '[COLOUR]'
      });
    });

    (window.State?.groups || []).forEach(group => {
      if (group?.name) {
        result.push({
          value: String(group.name),
          hint: '[GROUP]'
        });
      }
    });

    const seen = new Set();

    return result.filter(item => {
      const key = item.value.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
  }

  function render() {
    /*
     * Only autocomplete the COMMAND portion.
     *
     * This means:
     *
     *   group 1
     *   group 1 at
     *   group 1 colour
     *
     * does NOT make the autocomplete disappear.
     */
    const typed = input.value.trimStart();

    const commandPart = typed
      .split(/\s+/)
      .slice(0, 2)
      .join(' ')
      .toLowerCase();

    list.innerHTML = '';
    matches = [];

    if (!commandPart) {
      list.classList.remove('is-visible');
      return;
    }

    matches = getCommands().filter(item =>
      item.value
        .toLowerCase()
        .startsWith(commandPart)
    );

    if (!matches.length) {
      list.classList.remove('is-visible');
      return;
    }

    if (selectedIndex >= matches.length) {
      selectedIndex = 0;
    }

    matches.slice(0, 20).forEach((item, index) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'cmd-autocomplete-item';

      if (index === selectedIndex) {
        button.classList.add('is-active');
      }

      const command = document.createElement('span');
      command.className = 'cmd-autocomplete-command';

      /*
       * Show the COMPLETE command name.
       */
      command.textContent = item.value.toUpperCase();

      button.appendChild(command);

      /*
       * Show the REAL parameter hint from commandDefs.
       */
      if (item.hint) {
        const hint = document.createElement('span');

        hint.className = 'cmd-autocomplete-hint';
        hint.textContent = item.hint.toUpperCase();

        button.appendChild(hint);
      }

      button.addEventListener('mousedown', event => {
        event.preventDefault();

        /*
         * Preserve anything already typed after the command.
         */
        const remainder = typed
          .slice(commandPart.length)
          .replace(/^\s*/, '');

        input.value =
          item.value +
          (remainder ? ' ' + remainder : ' ');

        input.focus();

        input.setSelectionRange(
          input.value.length,
          input.value.length
        );

        render();
      });

      list.appendChild(button);
    });

    list.classList.add('is-visible');
  }

  function chooseSelected() {
    if (!matches.length) {
      return false;
    }

    const item = matches[selectedIndex];

    if (!item) {
      return false;
    }

    const typed = input.value.trimStart();
    const commandPart = typed
      .split(/\s+/)
      .slice(0, 2)
      .join(' ');

    const remainder = typed
      .slice(commandPart.length)
      .replace(/^\s*/, '');

    input.value =
      item.value +
      (remainder ? ' ' + remainder : ' ');

    input.focus();

    input.setSelectionRange(
      input.value.length,
      input.value.length
    );

    render();

    return true;
  }

  input.addEventListener('input', () => {
    selectedIndex = 0;
    render();
  });

  input.addEventListener('keydown', event => {
    if (!matches.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();

      selectedIndex =
        (selectedIndex + 1) % matches.length;

      render();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();

      selectedIndex =
        (selectedIndex - 1 + matches.length) %
        matches.length;

      render();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      chooseSelected();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();

      list.classList.remove('is-visible');
      matches = [];

      return;
    }
  });

  input.addEventListener('focus', render);
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
// Fades the given values into each fixture's own state. updateDMX() drives the
// rig from per-fixture states, so changing only State.current did nothing.
// Fixtures that mix colour with cyan/magenta/yellow only (Robe ColorWash,
// SolaFrame...) ignore hue/sat, so a colour given as hue/sat (typed colour
// names, the remote) is turned into their CMY values too.
function withCMY(id,state,values){
  if(!('hue' in values||'sat' in values||'light' in values))return state;
  const fixture=State.fixtures.find(f=>f?.id===id);
  const map=(window.getFixtureDefinition?.(fixture)||{}).map||{};
  const cmyOnly=['cyan','magenta','yellow'].every(k=>typeof map[k]==='number')&&!['r','g','b'].every(k=>typeof map[k]==='number');
  if(!cmyOnly)return state;
  const h=((Number(state.hue)||0)%360+360)%360,sat=Math.max(0,Math.min(100,Number(state.sat??100)))/100,l=Math.max(0,Math.min(100,Number(state.light??50)))/100;
  const a=sat*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  const rgb=[f(0),f(8),f(4)],max=Math.max(...rgb)||1;
  return {...state,cyan:Math.round((1-rgb[0]/max)*255),magenta:Math.round((1-rgb[1]/max)*255),yellow:Math.round((1-rgb[2]/max)*255)};
}
function fadeFixtures(ids,values,ms=300){
  window.finishFade?.(); // land the previous change first, or its values freeze half-way
  const targets=[...ids].filter(id=>State.fixtures.some(f=>f?.id===id)).map(id=>{
    const current=window.ensureFixtureState?.(id)||State.fixtureStates.get(id)||cloneState(State.current);
    return [id,withCMY(id,{...cloneState(current),...values},values)];
  });
  Object.assign(State.current,values);
  fadeTo?.({},ms,targets);
}
function applyColour(col){fadeFixtures(State.selected,col);renderFixtures?.();updateControlsForSelection();}
function applyLevel(v){fadeFixtures(State.selected,{intensity:v});setIntensityUI(v);renderFixtures?.();updateControlsForSelection();}
function allOrSelected(){return State.selected?.size?State.selected:new Set(State.fixtures.filter(Boolean).map(f=>f.id));}

function parseCommand(cmd){
  console.log('[COMMAND] Received:',JSON.stringify(cmd));
    const showCommand = String(cmd || '').trim();
  const showMatch = showCommand.match(/^(save|load)\s+(.+)$/i);

  if (showMatch) {
    const action = showMatch[1].toLowerCase();
    const path = showMatch[2].trim();

    const handler =
      action === 'save'
        ? window.LXShowFiles?.saveShow
        : window.LXShowFiles?.loadShow;

    if (typeof handler !== 'function') {
      return log('Show file support is unavailable — restart LX Console', 'error');
    }

    Promise.resolve(handler(path)).catch(error => {
      log(`${action.toUpperCase()} failed: ${error?.message || error}`, 'error');
    });

    return;
  }
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

  if(/^(visualizer|viz)$/.test(c)){window.connectVisualizer?.();return log('Visualizer opened','ok');}
  if(c==='artnet'){if(window.LXPrefs)window.LXPrefs.open('outputs');else{document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById('page-settings')?.classList.add('active');window.SettingsTabs?.select('outputs');}return log('Opened Art-Net settings','ok');}
  if(/^(clear|release)$/.test(c)){State.selected.clear();renderFixtures?.();return log('Cleared selection','ok');}
  // MIDI position hold (js/midi.js) is normally toggled from a MIDI pad and
  // persists across restarts by design (so a held position survives closing
  // the app mid-show). That also means it can be left ON from a previous
  // session — e.g. a MIDI controller that isn't plugged in this time — with
  // no way to turn it back off without physical MIDI hardware. Every
  // pan/tilt change gets silently forced back to the stale held value,
  // which reads as "the controls are broken". This command gives it a
  // MIDI-free escape hatch.
  if(/^(unhold|hold\s*off)$/.test(c)){
    if(typeof window.resetMIDIPosition==='function'&&window.resetMIDIPosition())
      return log('MIDI position hold released','ok');
    return log('Position hold was already off','ok');
  }
  // Same as the BLACKOUT button: output locked to 0, everything programmed kept; type it again (or press the button) to release.
  if(c==='blackout'){if(typeof window.consoleBlackout==='function'){window.consoleBlackout();return;}fadeTo?.({intensity:0,strobe:0},500);Object.assign(State.current,{intensity:0,strobe:0});setIntensityUI(0);updateDMX?.();return log('Blackout — all lights off','ok');}
  if(/^(full|all)$/.test(c)){const ids=allOrSelected();fadeFixtures(ids,{intensity:100,strobe:0},500);setIntensityUI(100);return log(State.selected?.size?`Full — ${ids.size} selected at 100%`:'Full On — all lights 100%','ok');}
  if(c==='all half')applyLevel(50),log('All @ 50%','ok');
  else if(c==='all 25')applyLevel(25),log('All @ 25%','ok');
  else if(c==='all 75')applyLevel(75),log('All @ 75%','ok');
  else if(c==='reset'){State.current={intensity:100,hue:0,sat:0,strobe:0,master:100,pan:128,tilt:128};updateDMX?.();return log('Reset to default','ok');}
  else if(c==='status')return log(`Selected: ${State.selected.size} | Groups: ${State.groups.length} | Cues: ${State.cues.length}`,'ok');
  else if(c==='list groups')return log(State.groups.map(g=>g.name).join(', ')||'No groups saved','ok');
  else if(c==='list cues')return log(State.cues.map((q,i)=>q?`${window.cueLabel(i)}: ${q.name||'Cue'} (${q.fade??800}ms${q.followEnabled?' · Follow '+(q.follow??0)+'s':''})`:`${i+1}: [empty]`).join(', ')||'No cues saved','ok');
  else {
    const namedGrp=State.groups.find(x=>String(x.name).toLowerCase()===c);
    if(namedGrp){const found=selectGroup(namedGrp);return log(`Selected "${namedGrp.name}": ${found}/${namedGrp.members.length}`,'ok');}

    // Named groups: "group = front whites 1,3,5", "group front whites = 1 thru 6",
    // or with no numbers, the fixtures that are selected now.
    if(!/^group\s+\d+\s*=/.test(c)&&(g=c.match(/^group\s*=\s*(.+)$/)||c.match(/^group\s+(.+?)\s*=\s*(.*)$/))){
      let name,list;
      if(g[2]!==undefined){name=g[1];list=g[2];}
      else{const m=g[1].match(/^(.*?)\s*((?:\d+(?:\s*(?:thru|through|-|–|>)\s*\d+)?[\s,]*)+)$/);name=m&&/\D/.test(m[1])?m[1]:g[1];list=m&&/\D/.test(m[1])?m[2]:'';}
      name=String(name).trim().replace(/^["']|["']$/g,'');
      if(!name)return log('Give the group a name: group = front whites 1,3,5','warn');
      let members=parseSelection(String(list).replace(/>/g,'-').replace(/,\s*,+/g,','));
      if(!list.trim()){
        const byId=new Map((State.fixtures||[]).map(f=>[f.id,f]));
        members=[...(State.selected||[])].map(id=>Number(byId.get(id)?.fixtureNumber)).filter(Number.isFinite).sort((a,b)=>a-b);
        if(!members.length)return log(`Select some fixtures first, or list them: group = ${name} 1,3,5`,'warn');
      }
      if(!members.length)return log('No valid fixture numbers','warn');
      const title=name.replace(/\b\w/g,ch=>ch.toUpperCase());
      const existing=State.groups.find(x=>String(x.name).toLowerCase()===name.toLowerCase());
      existing?existing.members=members:State.groups.push({name:title,members});
      renderGroups?.();return log(`Group "${existing?.name||title}" ${existing?'updated':'saved'}: ${members.join(', ')}`,'ok');
    }
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
    // ==============================================
    // CHASE COMMANDS
    // ==============================================
    if ((m = c.match(/^chase\s+(\d+)\s*=\s*([\d.,\s]+?)(?:\s+speed\s+(\d+))?$/))) {
      // "chase 1 = 1,3,5 speed 2000": cue numbers, and milliseconds per step.
      const number = Number(m[1]);
      const cueIndices = m[2].split(',').map(v => window.cueIndexOf(v.trim())).filter(i => Number.isInteger(i) && i >= 0);
      const stepMs = m[3] ? Number(m[3]) : 2000;
      const bpm = Math.max(6, Math.min(1200, 60000 / Math.max(50, stepMs)));
      if (typeof window.saveChase !== 'function') return log('Chase engine is not loaded', 'error');
      const ids = State.selected?.size ? [...State.selected] : State.fixtures.filter(Boolean).map(f => f.id);
      State.chases = Array.isArray(State.chases) ? State.chases : [];
      const replacing = number - 1 < State.chases.length;
      if (!window.saveChase(`Chase ${number}`, cueIndices, true, bpm, 0, 'sequence', ids)) return;
      if (replacing) State.chases.splice(number - 1, 1, State.chases.pop());
      window.renderChases?.();
      if (stepMs < 50) log('Chase steps can be 50 ms at the fastest (1200 BPM)', 'warn');
      return log(`Chase ${replacing ? number : State.chases.length}: cues ${cueIndices.map(i => window.cueLabel(i)).join(', ')}`, 'ok');
    }
    if ((m = c.match(/^run\s+chase\s+(\d+)$/))) {
      const chaseNumber = Number(m[1]);
      const chaseIndex = chaseNumber - 1;
      if (!Array.isArray(State.chases) || !State.chases[chaseIndex]) return log(`Chase ${chaseNumber} not found`, 'warn');
      if (typeof window.startChase !== 'function') return log('Chase engine is not loaded', 'error');
      return window.startChase(chaseIndex);
    }
    if (/^(stop|halt)\s+chase(?:\s+\d+)?$/.test(c)) {
      if (typeof window.stopChase !== 'function') return log('Chase engine is not loaded', 'error');
      window.stopChase();
      return log('Chase stopped', 'ok');
    }
    // Cue numbers can go in between: 0.5, 1.5, 2.25 (point cues). A range
    // (1 thru 5) is whole numbers; a list can mix them (1, 1.5, 2).
    const cueNumbers=text=>{const t=String(text).trim();if(/(thru|–|-)/.test(t))return parseSelection(t);return t.split(',').map(v=>window.parseCueNumber(v)).filter(n=>n!=null);};
    const CUES='((?:\\d+\\s*(?:thru|–|-)\\s*\\d+|(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:\\s*,\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+))*))';
    const rec=c.match(new RegExp('^record(?:\\s+cue)?\\s+'+CUES+'(?:\\s+(.+))?$'));
    if(rec){const cues=cueNumbers(rec[1]);if(!cues.length)return log('Cue numbers are 0.001 or more, e.g. 5, 0.5 or 2.25','warn');const nm=rec[2]?String(cmd).trim().slice(-rec[2].trim().length):'';/* name as typed, not lowercased */const done=cues.filter(n=>recordCue(n,nm?(cues.length>1?`${nm} ${window.formatCueNumber(n)}`:nm):''));return done.length?log(`Recorded: ${done.map(window.formatCueNumber).join(', ')}`,'ok'):undefined;}
    const delcue=c.match(new RegExp('^delete\\s+cue\\s+'+CUES+'$'));
    if(delcue){const nums=cueNumbers(delcue[1]).filter(n=>window.cueIndexOf(n)>=0);if(!nums.length)return log(`No cue ${delcue[1]}`,'warn');nums.forEach(n=>deleteCue(n));return log(`Deleted cues: ${nums.map(window.formatCueNumber).join(', ')}`,'ok');}

    const setfade=c.match(/^fade\s+(\d+(?:\.\d+)?|\.\d+)\s+(\d*\.?\d+)$/);
    if(setfade){const cueNum=setfade[1],sec=parseFloat(setfade[2]);if(sec<0)return log('Fade time cannot be negative','warn');const idx=window.cueIndexOf(cueNum);if(idx<0)return log(`Cue ${cueNum} not found`,'warn');State.cues[idx].fade=Math.round(sec*1000);renderCues?.();return log(`Cue ${window.cueLabel(idx)} fade set to ${sec}s = ${State.cues[idx].fade}ms`,'ok');}
    const quickfade=c.match(/^fade\s+(\d+(?:\.\d+)?|\.\d+)$/);
    if(quickfade){const n=quickfade[1],idx=window.cueIndexOf(n);if(idx<0)return log(`Cue ${n} not found`,'warn');goToCue(idx);return log(`Fading to Cue ${window.cueLabel(idx)} (${State.cues[idx].fade??800}ms)`,'ok');}
    if((m=c.match(/^go\s+(?:to\s+)?(?:cue\s+)?(\d+(?:\.\d+)?|\.\d+)$/))){const idx=window.cueIndexOf(m[1]);if(idx<0)return log(`Cue ${m[1]} not found`,'warn');goToCue(idx);return;}
    if(/^(go|next)$/.test(c)){if(!State.cues.length)return log('No cues saved','warn');goNextCue();return;}
    if(/^(back|previous|prev)$/.test(c)){if(!State.cues.length)return log('No cues saved','warn');goPreviousCue();return;}

    const selm=c.match(/^((?:\d+\s*(thru|–|-)\s*\d+|\d+(?:\s*,\s*\d+)*|\d+))$/);
    if(selm){const count=selectFixtureNumbers(parseSelection(selm[1]));if(count){renderFixtures?.();return log(`Selected ${count} fixture(s)`,'ok');}}

    // These catch-alls only take a whole command ("white", "at 50"), so an
    // unrecognised line containing a colour word can't change the lights.
    const atv=c.match(/^(?:at|@)\s*(\d+\.?\d*)$/);
    if(atv&&State.selected.size){const v=Math.max(0,Math.min(100,parseFloat(atv[1])));applyLevel(v);return log(`@ ${v}%`,'ok');}
    const colm=c.match(/^(?:colou?r\s+)?(red|green|blue|white|yellow|cyan|magenta|orange|elsa|ice|snow|sky|aurora|castle|kristoff|sven|olaf|forest|night)$/);
    if(colm&&State.selected.size){applyColour(cueColours[colm[1]]);return log(`Colour: ${colm[1]}`,'ok');}
    const stbm=c.match(/^strobe\s+(\d+|off)$/);
    if(stbm&&State.selected.size){const v=stbm[1]==='off'?0:Math.max(0,Math.min(255,Number(stbm[1])));fadeFixtures(State.selected,{strobe:v},0);return log(v===0?'Strobe off':`Strobe ${v}`,'ok');}
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
  const cueExists=n=>window.cueIndexOf(n)>=0;
  const cueAt=n=>State.cues[window.cueIndexOf(n)];
  const label=n=>window.formatCueNumber(n);
  const cueRefresh=()=>{if(typeof renderCues==='function')renderCues();if(typeof window.updateInspectorList==='function')window.updateInspectorList();};
  // Cue numbers can be point cues (1.5, 0.25): N in these patterns.
  const re=text=>new RegExp('^'+text.replace(/N/g,'(\\d+(?:\\.\\d+)?|\\.\\d+)')+'$');
  window.parseCommand=function(rawCommand){
    const raw=String(rawCommand||'').trim();
    const c=raw.toLowerCase();let m;
    // Names are taken from the command as typed (raw), not the lowercased copy.
    if((m=c.match(re('update\\s+cue\\s+N')))){const n=label(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');return updateCue(n)?log(`Updated Cue ${n} from current programmer state`,'ok'):undefined;}
    if((m=c.match(re('update\\s+cue\\s+N\\s+name\\s+(.+)')))){const n=label(m[1]),name=raw.slice(raw.length-m[2].length).trim();if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(!name)return log('Cue name cannot be empty','warn');return updateCue(n,{name})?log(`Cue ${n} renamed → "${name}"`,'ok'):undefined;}
    if((m=c.match(re('rename\\s+cue\\s+N\\s+(.+)')))){const n=label(m[1]),name=raw.slice(raw.length-m[2].length).trim();if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(!name)return log('Cue name cannot be empty','warn');cueAt(n).name=name;cueRefresh();return log(`Cue ${n} renamed → "${name}"`,'ok');}
    if((m=c.match(re('update\\s+cue\\s+N\\s+fade\\s+(\\d*\\.?\\d+)')))){const n=label(m[1]),sec=Number(m[2]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(!Number.isFinite(sec)||sec<0)return log('Fade time cannot be negative','warn');return updateCue(n,{fade:Math.round(sec*1000)})?log(`Cue ${n} fade updated to ${sec}s`,'ok'):undefined;}
    if((m=c.match(re('update\\s+cue\\s+N\\s+follow\\s+(off|\\d*\\.?\\d+)')))){const n=label(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(m[2]==='off')return updateCue(n,{follow:0,followEnabled:false})?log(`Cue ${n} follow disabled`,'ok'):undefined;const seconds=Number(m[2]);if(!Number.isFinite(seconds)||seconds<0)return log('Follow time cannot be negative','warn');return updateCue(n,{follow:seconds,followEnabled:true})?log(`Cue ${n} follow set to ${seconds}s`,'ok'):undefined;}
    if((m=c.match(re('follow\\s+cue\\s+N\\s+(off|\\d*\\.?\\d+)')))){const n=label(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');if(m[2]==='off'){cueAt(n).follow=0;cueAt(n).followEnabled=false;cueRefresh();return log(`Cue ${n} follow disabled`,'ok');}const seconds=Number(m[2]);if(!Number.isFinite(seconds)||seconds<0)return log('Follow time cannot be negative','warn');cueAt(n).follow=seconds;cueAt(n).followEnabled=true;cueRefresh();return log(`Cue ${n} follow set to ${seconds}s`,'ok');}
    if((m=c.match(re('copy\\s+cue\\s+N\\s+to\\s+N(?:\\s+(.+))?')))){
      const from=label(m[1]),to=window.parseCueNumber(m[2]);
      if(!cueExists(from))return log(`Cue ${from} not found`,'warn');
      if(to==null)return log('Cue numbers are 0.001 or more, e.g. 5, 0.5 or 2.25','warn');
      if(cueExists(to))return log(`Cue ${label(to)} already exists — delete it first or copy to an empty number`,'warn');
      const fromIndex=window.cueIndexOf(from),source=State.cues[fromIndex],copy=cloneCueValue(source);
      if(!copy)return log(`Could not copy Cue ${from}`,'warn');
      // A copy keeps the look it had, wherever it lands: tracked cues are copied as a whole look.
      if(window.LXTracking?.isTracked(fromIndex)){copy.fixtureStates=[...window.LXTracking.look(fromIndex).fixtureMap];copy.mode='block';}
      copy.number=to;
      copy.name=(m[3]?raw.slice(raw.length-m[3].length):source.name||`Cue ${label(to)}`).trim()||`Cue ${label(to)}`;
      State.cues[window.insertCueSlot(to)]=copy;
      cueRefresh();return log(`Copied Cue ${from} → Cue ${label(to)}`,'ok');
    }
    if((m=c.match(re('move\\s+cue\\s+N\\s+to\\s+N')))){
      // Moving renumbers the cue and the list re-sorts. A tracked cue that
      // moves keeps its look (the tracking heals on the next redraw).
      const from=label(m[1]),to=window.parseCueNumber(m[2]);
      if(!cueExists(from))return log(`Cue ${from} not found`,'warn');
      if(to==null)return log('Cue numbers are 0.001 or more, e.g. 5, 0.5 or 2.25','warn');
      if(cueExists(to)&&window.cueIndexOf(to)!==window.cueIndexOf(from))return log(`Cue ${label(to)} already exists — pick an empty number`,'warn');
      cueAt(from).number=to;
      cueRefresh();return log(`Moved Cue ${from} → Cue ${label(to)}`,'ok');
    }
    if((m=c.match(re('cue\\s+N(?:\\s+go)?')))){const n=label(m[1]);if(!cueExists(n))return log(`Cue ${n} not found`,'warn');return goToCue(window.cueIndexOf(n));}
    if(/^(?:clear\s+(?:programmer|prog)|clearprog|clear\s+all)$/.test(c)){return typeof clearProgrammer==='function'?clearProgrammer():log('Clear Programmer is unavailable','warn');}
    return originalParseCommand(rawCommand);
  };
})();

// ==============================================
// PALETTE SYSTEM
// ==============================================
// Palettes are stored in State so the existing show save/load system can
// persist them without introducing another file or storage layer.
State.palettes = Array.isArray(State.palettes) ? State.palettes : [];
window.Palettes = window.Palettes || State.palettes;

function paletteSnapshot() {
  const source = State.current || {};
  return {
    intensity: Number.isFinite(Number(source.intensity)) ? Number(source.intensity) : 100,
    hue: Number.isFinite(Number(source.hue)) ? Number(source.hue) : 0,
    sat: Number.isFinite(Number(source.sat)) ? Number(source.sat) : 0,
    strobe: Number.isFinite(Number(source.strobe)) ? Number(source.strobe) : 0,
    master: Number.isFinite(Number(source.master)) ? Number(source.master) : 100,
    pan: Number.isFinite(Number(source.pan)) ? Number(source.pan) : 128,
    tilt: Number.isFinite(Number(source.tilt)) ? Number(source.tilt) : 128
  };
}

function refreshPalettes() {
  State.palettes = Array.isArray(State.palettes) ? State.palettes : [];
  // Don't reassign window.Palettes here: js/palette.js owns it (record/apply/…)
  // and the phone remote calls window.Palettes.apply().
  if (typeof window.renderPalettes === 'function') window.renderPalettes();
  if (typeof window.updateInspectorList === 'function') window.updateInspectorList();
}

function findPalette(name) {
  const wanted = String(name || '').trim().toLowerCase();
  return State.palettes.find(p => String(p.name || '').trim().toLowerCase() === wanted) || null;
}

function recordPalette(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return log('Palette name cannot be empty','warn');
  const selected = [...(State.selected || [])];
  if (!selected.length) return log('Select at least one fixture before recording a palette','warn');

  const existing = findPalette(cleanName);
  const palette = {
    id: existing?.id || `palette-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name: cleanName,
    type: 'programmer',
    values: paletteSnapshot(),
    fixtures: selected,
    updatedAt: Date.now()
  };

  if (existing) Object.assign(existing, palette);
  else State.palettes.push(palette);
  refreshPalettes();
  return log(`${existing ? 'Updated' : 'Recorded'} palette "${cleanName}"`,'ok');
}

function applyPalette(name) {
  const palette = findPalette(name);
  if (!palette) return log(`Palette "${name}" not found`,'warn');
  const values = palette.values || {};
  const selected = State.selected || new Set();
  if (!selected.size && Array.isArray(palette.fixtures) && palette.fixtures.length) {
    State.selected = new Set(palette.fixtures);
  }
  fadeFixtures(State.selected, values);
  setIntensityUI(State.current.intensity ?? 100);
  renderFixtures?.();
  updateControlsForSelection();
  return log(`Applied palette "${palette.name}"`,'ok');
}

function deletePalette(name) {
  const wanted = String(name || '').trim().toLowerCase();
  const index = State.palettes.findIndex(p => String(p.name || '').trim().toLowerCase() === wanted);
  if (index < 0) return log(`Palette "${name}" not found`,'warn');
  const removed = State.palettes.splice(index, 1)[0];
  refreshPalettes();
  return log(`Deleted palette "${removed.name}"`,'ok');
}

commandDefs.push(
  {cmd:'record palette',hint:'[name] — save the current programmer state'},
  {cmd:'update palette',hint:'[name] — overwrite an existing palette'},
  {cmd:'palette',hint:'[name] — apply a palette'},
  {cmd:'delete palette',hint:'[name]'},
  {cmd:'list palettes',hint:''},
  {cmd:'clear programmer',hint:'— set every fixture to 0 so nothing leaks into the next recorded cue'}
);

(function installPaletteCommands(){
  const previousParseCommand = window.parseCommand || parseCommand;
  window.parseCommand = function(rawCommand){
    const c = String(rawCommand || '').trim();
    let m;

    if ((m = c.match(/^record\s+palette\s+(.+)$/i))) return recordPalette(m[1]);
    if ((m = c.match(/^update\s+palette\s+(.+)$/i))) return recordPalette(m[1]);
    if ((m = c.match(/^palette\s+(.+)$/i))) return applyPalette(m[1]);
    if ((m = c.match(/^delete\s+palette\s+(.+)$/i))) return deletePalette(m[1]);
    if (/^list\s+palettes$/i.test(c)) {
      if (!State.palettes.length) return log('No palettes saved','ok');
      return log(State.palettes.map((p,i)=>`${i+1}: ${p.name}`).join(', '),'ok');
    }

    return previousParseCommand(rawCommand);
  };
})();

window.PaletteAPI = {
  list: () => State.palettes,
  record: recordPalette,
  apply: applyPalette,
  remove: deletePalette,
  refresh: refreshPalettes
};
