"use strict";

/*
 * Eos-style command line. Sits in front of the older commands and handles
 * selection + action in one line; anything it doesn't understand is passed
 * on unchanged.
 *
 *   1 thru 10 @ 50          1>10 @ full        1 + 3 + 5 @ out
 *   1 thru 10 - 4 @ 75      group 2 @ 50       all lights + odd @ 30
 *   @ +10   @ -20           1 thru 4 red       1 thru 4 @ 60 blue time 3
 *   2 pan 100 tilt 40       1 thru 4 home      group 1 strobe 120
 *   rem dim                 info 5             sneak / sneak 3
 *   undo / redo (⌘Z)        help (or ?)
 *
 * Also: command history on ↑/↓, a live preview of what the command will do,
 * and a Command Reference window.
 */
(function () {
  if (window.LXCommandLine) return;

  const S = () => window.State;
  const say = (m, l = "ok") => window.log?.(m, l);
  const LEVEL_WORDS = { full: 100, fl: 100, out: 0, off: 0, half: 50 };
  const PARAMS = { pan: [0, 255], tilt: [0, 255], zoom: [0, 255], focus: [0, 255], frost: [0, 255], iris: [0, 255], gobo: [0, 255], prism: [0, 255], strobe: [0, 255] };
  const colours = () => (typeof cueColours === "object" ? cueColours : {}); // commands.js
  // Hazers and fog machines: "haze 80", "fog full", "fan 50", "fluid out" (percent).
  // Their output is its own channel, not the level, so "@" on a hazer sets the output too.
  const ATMOS = { haze: "output", fog: "output", output: "output", fan: "fana", fluid: "fluid" };
  const atmosMap = id => { const f = S().fixtures.find(x => x?.id === id); const map = window.FixtureLibrary?.[f?.name]?.map || {}; return typeof map.haze === "number" || typeof map.fog === "number" ? map : null; };
  const fadeMs = () => Number(window.LXPrefs?.get("commandFadeMs") ?? 300);

  // ------------------------------------------------------------ tokens

  function tokenize(raw) {
    let c = String(raw || "").toLowerCase().trim();
    c = c.replace(/[@＠]/g, " at ").replace(/>/g, " thru ").replace(/\bthrough\b/g, "thru").replace(/–/g, "-");
    // "1-10" (no spaces) is a range; any other "-" means "except", or "down" after @.
    c = c.replace(/(\d)-(\d)/g, "$1~$2").replace(/-/g, " - ").replace(/~/g, "-");
    c = c.replace(/([+,])/g, " $1 ").replace(/(\d)%/g, "$1");
    return c.split(/\s+/).filter(Boolean);
  }

  const isNum = t => /^\d+(\.\d+)?$/.test(t);
  const groupsList = () => (S()?.groups || []).filter(Boolean);
  const fixtureByNumber = n => (typeof getFixtureByNumber === "function" ? getFixtureByNumber(n) : S().fixtures.find(f => Number(f?.fixtureNumber) === Number(n)));

  function groupIds(group) {
    return (group.members || []).map(n => fixtureByNumber(n)?.id).filter(id => id != null);
  }

  // A group by number ("group 3": the one called "Group 3", else the 3rd) or by name.
  function findGroupByNumber(n) {
    const list = groupsList();
    return list.find(g => String(g.name).toLowerCase() === `group ${n}`) || list[n - 1] || null;
  }

  // Longest group name starting at tokens[i].
  function matchGroupName(tokens, i) {
    let best = null;
    for (const g of groupsList()) {
      const words = String(g.name).toLowerCase().split(/\s+/);
      if (words.every((w, k) => tokens[i + k] === w) && (!best || words.length > best.len)) best = { group: g, len: words.length };
    }
    return best;
  }

  // ------------------------------------------------------------ parse

  // Returns { ids, label, explicit } from the selection part, or null if it
  // isn't a selection this parser understands.
  function parseSelection(tokens) {
    const state = S();
    if (!tokens.length) return { ids: [...(state.selected || [])], label: "selected fixtures", explicit: false };
    const result = new Set();
    const labels = [];
    let mode = "+", i = 0, any = false;
    const apply = (ids, label) => {
      ids.forEach(id => (mode === "+" ? result.add(id) : result.delete(id)));
      labels.push(`${mode === "-" ? "except " : labels.length ? "+ " : ""}${label}`);
      any = true;
    };
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === "+" || t === "," || t === "and") { mode = "+"; i++; continue; }
      if (t === "-" || t === "except" || t === "minus" || t === "not") { mode = "-"; i++; continue; }
      let m;
      if (isNum(t) && tokens[i + 1] === "thru" && isNum(tokens[i + 2] || "")) {
        const a = Number(t), b = Number(tokens[i + 2]);
        apply(numbers(a, b), `${a}–${b}`); i += 3; continue;
      }
      if ((m = t.match(/^(\d+)-(\d+)$/))) { apply(numbers(Number(m[1]), Number(m[2])), `${m[1]}–${m[2]}`); i++; continue; }
      if (isNum(t) && Number.isInteger(Number(t))) {
        const f = fixtureByNumber(Number(t));
        if (!f) return { error: `There's no fixture ${t}` };
        apply([f.id], t); i++; continue;
      }
      if (t === "group" && isNum(tokens[i + 1] || "")) {
        const g = findGroupByNumber(Number(tokens[i + 1]));
        if (!g) return { error: `There's no group ${tokens[i + 1]}` };
        apply(groupIds(g), g.name); i += 2; continue;
      }
      if ((m = t.match(/^g(\d+)$/))) {
        const g = findGroupByNumber(Number(m[1]));
        if (!g) return { error: `There's no group ${m[1]}` };
        apply(groupIds(g), g.name); i++; continue;
      }
      const named = matchGroupName(tokens, i + (t === "group" ? 1 : 0));
      if (named) { apply(groupIds(named.group), named.group.name); i += named.len + (t === "group" ? 1 : 0); continue; }
      if (t === "all" || t === "everything") { apply(state.fixtures.filter(Boolean).map(f => f.id), "all fixtures"); i++; continue; }
      return null; // not a selection
    }
    if (!any) return null;
    return { ids: [...result], label: labels.join(" "), explicit: true };
  }

  function numbers(a, b) {
    const ids = [];
    const step = a <= b ? 1 : -1;
    for (let n = a; ; n += step) {
      const f = fixtureByNumber(n);
      if (f) ids.push(f.id);
      if (n === b || ids.length > 5000) break;
    }
    return ids;
  }

  // Splits a command into selection and actions. Returns null to pass on.
  function parse(raw) {
    const tokens = tokenize(raw);
    if (!tokens.length) return null;
    if (tokens[0] === "rem" && tokens[1] === "dim" && tokens.length === 2) return { remDim: true, sel: parseSelection([]) };
    // Where do actions start? "at", or the first attribute word.
    const ACTION_WORDS = new Set(["at", "time", "sneak", "home", "rem", ...Object.keys(PARAMS), ...Object.keys(ATMOS), ...Object.keys(colours())]);
    let cut = tokens.findIndex((t, k) => ACTION_WORDS.has(t) && !(t === "rem" && tokens[k + 1] !== "dim"));
    if (cut === -1) cut = tokens.length;
    const selTokens = tokens.slice(0, cut), act = tokens.slice(cut);
    // "full"/"out" straight after a selection ("1 thru 5 full") act like "@ full".
    if (selTokens.length > 1 && LEVEL_WORDS[selTokens[selTokens.length - 1]] != null) {
      act.unshift("at", selTokens.pop());
    }
    if (!selTokens.length && !act.length) return null;
    // "all 25" has always meant all at 25.
    if (selTokens.length === 2 && selTokens[0] === "all" && isNum(selTokens[1]) && !act.length) act.push("at", selTokens.pop());
    // A bare word the older commands know ("full", "all", "blackout"…) isn't ours.
    if (!act.length && (selTokens.length === 1 && !isNum(selTokens[0]) && !/^\d+-\d+$/.test(selTokens[0]) && !/^g\d+$/.test(selTokens[0]))) {
      if (selTokens[0] === "all" || selTokens[0] === "everything") return null;
    }
    const sel = parseSelection(selTokens);
    if (!sel) return null;
    // Only complain about a missing fixture or group if the line is
    // otherwise plainly selection syntax ("group 4 = 1,2" isn't ours).
    if (sel.error) return selTokens.every(t => /^(\d+|\d+-\d+|thru|\+|,|-|and|except|minus|not|group|g\d+|all|everything)$/.test(t)) ? { error: sel.error } : null;
    if (!act.length) return { sel, select: true };
    const actions = parseActions(act);
    if (actions.error) return actions;
    return { sel, ...actions };
  }

  function parseActions(t) {
    const values = {}, words = [];
    let relative = null, time = null, home = false, remDim = false, sneak = null, i = 0;
    const range = (key, v) => Math.max(PARAMS[key][0], Math.min(PARAMS[key][1], Math.round(v)));
    while (i < t.length) {
      const w = t[i];
      if (w === "at") {
        const v = t[i + 1];
        if (v == null) return { error: "@ what? Try @ 50, @ full or @ out" };
        if (v === "+" || v === "-") {
          if (!isNum(t[i + 2] || "")) return { error: `@ ${v} how much? e.g. @ ${v}10` };
          relative = (v === "+" ? 1 : -1) * Number(t[i + 2]); words.push(`@ ${v}${t[i + 2]}%`); i += 3; continue;
        }
        if (/^[+-]\d+(\.\d+)?$/.test(v)) { relative = Number(v); words.push(`@ ${v}%`); i += 2; continue; }
        if (LEVEL_WORDS[v] != null) { values.intensity = LEVEL_WORDS[v]; words.push(`@ ${v === "fl" ? "full" : v}`); i += 2; continue; }
        if (isNum(v)) { values.intensity = Math.max(0, Math.min(100, Number(v))); words.push(`@ ${values.intensity}%`); i += 2; continue; }
        if (colours()[v]) { i += 1; continue; } // "@ red": the colour is read next
        return { error: `@ ${v}? Try a level 0–100, full or out` };
      }
      if (colours()[w]) { Object.assign(values, colours()[w]); words.push(w); i++; continue; }
      if (w === "colour" || w === "color") { i++; continue; }
      if (PARAMS[w]) {
        const v = t[i + 1];
        if (w === "strobe" && (v === "off" || v === "out")) { values.strobe = 0; words.push("strobe off"); i += 2; continue; }
        if (!isNum(v || "")) return { error: `${w} what? e.g. ${w} 128 (0–255)` };
        values[w] = range(w, Number(v)); words.push(`${w} ${values[w]}`); i += 2; continue;
      }
      if (ATMOS[w]) {
        const v = t[i + 1];
        const pct = LEVEL_WORDS[v] ?? (isNum(v || "") ? Math.max(0, Math.min(100, Number(v))) : null);
        if (pct == null) return { error: `${w} what? e.g. ${w} 80 (percent), ${w} full or ${w} out` };
        values.__atmos = { ...(values.__atmos || {}), [ATMOS[w]]: Math.round(pct * 2.55) };
        words.push(`${w} ${pct}%`); i += 2; continue;
      }
      if (w === "home") { home = true; values.pan = 128; values.tilt = 128; words.push("home"); i++; continue; }
      if (w === "time" || w === "sneak" && isNum(t[i + 1] || "")) {
        if (!isNum(t[i + 1] || "")) return { error: "time what? e.g. time 3 (seconds)" };
        time = Number(t[i + 1]) * 1000; words.push(`in ${t[i + 1]}s`); i += 2; continue;
      }
      if (w === "rem" && t[i + 1] === "dim") { remDim = true; words.push("rem dim"); i += 2; continue; }
      if (w === "sneak") { sneak = true; i++; continue; }
      return { error: `Not sure what "${w}" means here` };
    }
    if (!words.length && !remDim) return { error: "Nothing to do — add a level, colour or attribute" };
    return { values, relative, time, home, remDim, words };
  }

  // ---------------------------------------------------------- describe

  function fixtureLabel(ids) {
    const nums = ids.map(id => Number(S().fixtures.find(f => f?.id === id)?.fixtureNumber)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!nums.length) return "no fixtures";
    const parts = [];
    for (let k = 0; k < nums.length; k++) {
      let j = k;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(j > k ? `${nums[k]}–${nums[j]}` : String(nums[k]));
      k = j;
    }
    return `${nums.length === 1 ? "Fixture" : "Fixtures"} ${parts.join(", ")}`;
  }

  function describe(p) {
    if (p.error) return `⚠ ${p.error}`;
    if (p.remDim && !p.words) return `Rem dim — everything except ${fixtureLabel(p.sel.ids)} to 0`;
    if (p.select) return `Select ${fixtureLabel(p.sel.ids)}`;
    return `${fixtureLabel(p.sel.ids)} ${p.words.join(" ")}`.trim();
  }

  // ----------------------------------------------------------- execute

  function selectIds(ids) {
    const state = S();
    state.selected = new Set(ids);
    state.selectedFixtureId = ids[ids.length - 1] ?? null;
    if (window.syncFixtureListSelectionClasses) window.syncFixtureListSelectionClasses();
    else window.renderFixtures?.();
    window.updateControlVisibility?.();
    updateControlsForSelectionSafe();
  }
  function updateControlsForSelectionSafe() { try { if (typeof updateControlsForSelection === "function") updateControlsForSelection(); } catch (_) {} }

  function fadeIds(targets, ms) {
    window.finishFade?.();
    window.fadeTo?.({}, ms, targets);
  }

  function run(p) {
    const state = S();
    if (p.error) return say(p.error, "warn");
    const ids = p.sel.ids;
    if (p.select) {
      if (!ids.length) return say("Nothing selected — that matched no fixtures", "warn");
      selectIds(ids);
      return say(`Selected ${fixtureLabel(ids)}`);
    }
    // "haze 50" with no hazer selected means every hazer / fog machine.
    if (!p.sel.explicit && p.values?.__atmos && !ids.some(atmosMap)) ids.splice(0, ids.length, ...state.fixtures.filter(f => f && atmosMap(f.id)).map(f => f.id));
    if (!ids.length && p.values?.__atmos) return say("There's no hazer or fog machine patched", "warn");
    if (!ids.length) return say(p.sel.explicit ? "That matched no fixtures" : "Select some fixtures first, e.g. 1 thru 10 @ 50", "warn");
    selectIds(ids);
    // Land any fade still running, or its half-way values become the new ones.
    window.finishFade?.();
    const ms = p.time != null ? p.time : fadeMs();
    window.LXFixtureInfo?.act("command", `“${p.raw || describe(p)}”`, "typed in the command line", ms + 600, p.remDim ? null : ids);
    const targets = [];
    const cmy = typeof withCMY === "function" ? withCMY : (id, s) => s;
    const clone = s => (typeof window.cloneFixtureState === "function" ? window.cloneFixtureState(s) : { ...s });
    if (p.words?.length) {
      for (const id of ids) {
        const cur = window.ensureFixtureState?.(id) || state.fixtureStates.get(id) || {};
        const values = { ...p.values };
        if (p.relative != null) values.intensity = Math.max(0, Math.min(100, Math.round((Number(cur.intensity) || 0) + p.relative)));
        const atmos = values.__atmos; delete values.__atmos;
        const map = atmosMap(id);
        if (map) {
          // The output channel follows a level typed at the machine ("1 @ full");
          // the fan (and fluid pump) come on with it if they were off.
          const out = atmos?.output ?? (values.intensity != null ? Math.round(values.intensity * 2.55) : null);
          if (out != null) for (const k of ["haze", "fog"]) if (typeof map[k] === "number") values[k] = out;
          for (const k of ["fana", "fluid"]) {
            if (typeof map[k] !== "number") continue;
            if (atmos?.[k] != null) values[k] = atmos[k];
            else if (out > 0 && !(Number(cur[k]) > 0)) values[k] = out;
            else if (out === 0 && atmos?.output === 0) values[k] = 0; // "haze out" stops the machine
          }
        }
        targets.push([id, cmy(id, { ...clone(cur), ...values }, values)]);
      }
    }
    if (p.remDim) {
      const keep = new Set(ids);
      for (const f of state.fixtures) {
        if (!f || keep.has(f.id)) continue;
        const cur = window.ensureFixtureState?.(f.id) || {};
        targets.push([f.id, { ...clone(cur), intensity: 0 }]);
      }
    }
    fadeIds(targets, ms);
    if (p.words?.length) window.LXFixtureInfo?.claimKeys(ids, Object.keys(p.relative != null ? { ...p.values, intensity: 0 } : p.values).filter(k => k !== "__atmos"), { kind: "command", label: `“${p.raw || describe(p)}”`, detail: "typed in the command line" });
    // Palettes and the Control Deck read the programmer values from here.
    if (p.words?.length) { const { __atmos, ...plain } = p.values; Object.assign(state.current, p.relative != null ? { ...plain, intensity: targets[0]?.[1]?.intensity ?? state.current.intensity } : plain); }
    const level = p.values?.intensity;
    if (level != null) { const el = document.getElementById("intensity"), val = document.getElementById("intVal"); if (el) el.value = level; if (val) val.textContent = `${level}%`; }
    window.renderFixtures?.();
    if (state.blackout) say("Blackout is on, so you won't see this until you turn it off (BLACKOUT button or type full)", "warn");
    return say(describe(p));
  }

  function info(n) {
    const f = fixtureByNumber(n);
    if (!f) return say(`There's no fixture ${n}`, "warn");
    if (window.LXFixtureInfo) return window.LXFixtureInfo.open(f.id);
    const s = window.ensureFixtureState?.(f.id) || {};
    const def = window.FixtureLibrary?.[f.name] || {};
    const bits = [`#${f.fixtureNumber} ${f.name}`, `Uni ${f.uni} Addr ${f.addr}${def.channels ? `–${Number(f.addr) + def.channels - 1}` : ""}`, `level ${Math.round(Number(s.intensity) || 0)}%`];
    if (s.sat > 0) bits.push(`hue ${Math.round(s.hue)}° sat ${Math.round(s.sat)}%`);
    if (def.channels && (s.pan !== 128 || s.tilt !== 128)) bits.push(`pan ${Math.round(s.pan)} tilt ${Math.round(s.tilt)}`);
    const groups = groupsList().filter(g => (g.members || []).map(Number).includes(Number(f.fixtureNumber))).map(g => g.name);
    if (groups.length) bits.push(`in ${groups.join(", ")}`);
    return say(bits.join(" · "), "info");
  }

  // -------------------------------------------------------------- undo

  const undoStack = [], redoStack = [];
  function snapshot(label) {
    const state = S();
    if (!state?.fixtureStates) return null;
    const states = [];
    state.fixtureStates.forEach((v, id) => states.push([id, { ...v }]));
    return { label, states, selected: [...(state.selected || [])], key: JSON.stringify(states) };
  }
  function remember(label) {
    const snap = snapshot(label);
    if (!snap) return;
    if (undoStack.length && undoStack[undoStack.length - 1].key === snap.key) { undoStack[undoStack.length - 1].label = label; return; }
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(snap) {
    const state = S();
    window.finishFade?.();
    fadeIds(snap.states.map(([id, s]) => [id, s]), 150);
    state.selected = new Set(snap.selected);
    window.syncFixtureListSelectionClasses?.();
    window.updateControlVisibility?.();
    updateControlsForSelectionSafe();
    window.renderFixtures?.();
  }
  function undo() {
    // Skip snapshots that match what's on stage now.
    const now = snapshot("now");
    while (undoStack.length && undoStack[undoStack.length - 1].key === now?.key) undoStack.pop();
    const snap = undoStack.pop();
    if (!snap) return say("Nothing to undo", "warn");
    redoStack.push({ ...now, label: snap.label });
    restore(snap);
    return say(`Undo: ${snap.label}`);
  }
  function redo() {
    const snap = redoStack.pop();
    if (!snap) return say("Nothing to redo", "warn");
    undoStack.push({ ...snapshot(snap.label) });
    restore(snap);
    return say(`Redo: ${snap.label}`);
  }

  // ------------------------------------------------------------ wrapper

  const QUIET = /^(undo|redo|help|\?|status|info\b|list\b|commands)/;

  let installed = false;
  function install() {
    const previous = window.parseCommand;
    if (installed) return true;
    if (typeof previous !== "function" || previous.__lxCommandLine) return false;
    installed = true;
    const wrapped = function (rawCommand) {
      const raw = String(rawCommand ?? "").trim();
      const c = raw.toLowerCase();
      let m;
      if (c === "undo") return undo();
      if (c === "redo") return redo();
      // "fog limit 10", "fog reset" (js/atmos-safety.js): before "fog 80".
      if (window.LXAtmos?.command?.(c)) return true;
      if (c === "cue list" || c === "cuelist") { window.LXWindows?.open("cuelist"); return; }
      if (c === "focus" || c === "point and shoot" || c === "point & shoot") { window.LXWindows?.open("focus"); return; }
      if ((m = c.match(/^focus\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/))) { window.LXFocus?.aimAt({ x: Number(m[1]), z: -Number(m[2]) }); return; }
      if ((m = c.match(/^mib(?:\s+(on|off))?$/))) {
        const on = m[1] ? m[1] === "on" : !window.LXPrefs?.get("mib");
        window.LXPrefs?.set("mib", on);
        return say(`Move in black ${on ? "on" : "off"}`, "ok");
      }
      if ((m = c.match(/^insert\s+cue\s+(\d+(?:\.\d+)?|\.\d+)$/))) { const i = window.cueIndexOf(m[1]); if (i < 0) return say(`Cue ${m[1]} not found`, "warn"); window.LXDeck?.insertCue(i); return; }
      if ((m = c.match(/^(block|track|unblock)\s+cue\s+(\d+(?:\.\d+)?|\.\d+)$/))) {
        const ok = window.LXTracking?.setMode(window.cueIndexOf(m[2]), m[1] === "block" ? "block" : "track");
        return ok ? say(`Cue ${m[2]} is now ${m[1] === "block" ? "a block cue — it stores its whole look" : "tracked — it stores only what changed"}`, "ok") : say(`Cue ${m[2]} not found`, "warn");
      }
      if (c === "help" || c === "?" || c === "commands") { window.LXWindows?.open("commands"); return say("Command reference opened — click any example to try it", "info"); }
      if ((m = c.match(/^(?:info\s+(\d+)|(\d+)\s+info)$/))) return info(Number(m[1] || m[2]));
      if (c === "info") {
        const id = [...(S().selected || [])][0];
        if (id == null) return say("Select a fixture first, or type info 5", "warn");
        return window.LXFixtureInfo ? window.LXFixtureInfo.open(id) : null;
      }
      // Fixture Info shows this command as what changed things.
      if (!QUIET.test(c)) window.LXFixtureInfo?.act("command", `“${raw}”`, "typed in the command line", 1500);
      if ((m = c.match(/^sneak(?:\s+(\d+(?:\.\d+)?))?$/))) {
        const state = S();
        if (!(state.currentCue >= 0) || !state.cues?.[state.currentCue]) return say("Sneak needs a cue to go back to — GO a cue first", "warn");
        remember(raw);
        const cue = state.cues[state.currentCue];
        const keep = cue.fade;
        if (m[1] != null) cue.fade = Number(m[1]) * 1000;
        try { window.goToCue?.(state.currentCue); } finally { cue.fade = keep; }
        return say(`Sneak back to cue ${state.currentCue + 1}${m[1] != null ? ` in ${m[1]}s` : ""}`);
      }
      // Faster programming (js/fast-programming.js): fans ("1 thru 5 @ 0 thru 100") read
      // like levels, so they're asked first.
      if (window.LXFastProgramming?.handle(raw)) { remember(raw); return; }
      const parsed = parse(raw);
      if (parsed) {
        parsed.raw = raw;
        if (!parsed.error && !parsed.select) remember(raw);
        return run(parsed);
      }
      if (!QUIET.test(c)) remember(raw);
      return previous.apply(this, arguments);
    };
    wrapped.__lxCommandLine = true;
    window.parseCommand = wrapped;
    return true;
  }

  // ------------------------------------------- history, preview, keys

  const HISTORY = "lx-command-history";
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY) || "[]") || []; } catch (_) { history = []; }
  let hIndex = -1, draft = "";

  function wireInput() {
    const input = document.getElementById("cmdInput");
    const line = input?.closest(".cmd-line");
    if (!input || !line || input.dataset.lxHistory) return Boolean(input?.dataset.lxHistory);
    input.dataset.lxHistory = "1";
    input.placeholder = "Type a command — e.g. 1 thru 10 @ 50   ·   help for the list";
    const preview = document.createElement("span");
    preview.className = "cmd-preview";
    input.after(preview);

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (v && history[history.length - 1] !== v) { history.push(v); while (history.length > (Number(window.LXPrefs?.get("cmdHistory")) || 200)) history.shift(); try { localStorage.setItem(HISTORY, JSON.stringify(history)); } catch (_) {} }
        hIndex = -1; preview.textContent = "";
        
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      // Only when the box is empty or we're already stepping through history,
      // so the autocomplete list keeps its arrows.
      const browsing = hIndex !== -1 && input.value === history[hIndex];
      if (input.value.trim() && !browsing) return;
      if (!history.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (hIndex === -1) { draft = input.value; hIndex = history.length; }
      hIndex += e.key === "ArrowUp" ? -1 : 1;
      if (hIndex < 0) hIndex = 0;
      if (hIndex >= history.length) { hIndex = -1; input.value = draft; }
      else input.value = history[hIndex];
      window.LXAutocomplete?.hide();
      input.setSelectionRange(input.value.length, input.value.length);
      showPreview();
    }, true);

    const showPreview = () => {
      const v = input.value.trim();
      if (!v) { preview.textContent = ""; return; }
      let p = null;
      try { p = parse(v); } catch (_) { p = null; }
      preview.textContent = p ? describe(p) : "";
      preview.classList.toggle("bad", Boolean(p?.error));
    };
    input.addEventListener("input", showPreview);
    input.addEventListener("blur", () => { if (!input.value.trim()) preview.textContent = ""; });
    return true;
  }

  // ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo — when you're not typing in a box.
  document.addEventListener("keydown", e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
  });

  // Changes made with the mouse can be undone too.
  document.addEventListener("pointerdown", e => {
    const where = e.target.closest?.("#controlPanel, .lx-direct, .magic-tools, #paletteModal, #groupList");
    if (!where) return;
    const label = where.id === "controlPanel" ? "Control Deck change" : where.classList.contains("lx-direct") || where.id === "paletteModal" ? "palette" : where.id === "groupList" ? "group selection" : "magic sheet level";
    remember(label);
  }, true);

  // --------------------------------------------------- reference window

  const REFERENCE = [
    ["Select", [["1", "fixture 1"], ["1 thru 10", "fixtures 1 to 10 (also 1>10 or 1-10)"], ["1 + 3 + 5", "several fixtures"], ["1 thru 10 - 4", "1 to 10 except 4"], ["group 2", "a group by number"], ["all lights + odd", "groups by name"], ["group = front whites 1,3,5", "make a named group (no numbers: the selected fixtures)"], ["clear", "deselect everything"], ["clear programmer", "drop everything set by hand, back to the live cue"], ["insert cue 3", "load what cue 3 programs into the Control Deck"]]],
    ["Levels", [["1 thru 10 @ 50", "set a level"], ["group 1 @ full", "full is 100"], ["2 @ out", "out is 0"], ["@ 75", "the selected fixtures"], ["@ +10", "up 10% (each from its own level)"], ["@ -20", "down 20%"], ["1 thru 5 @ 80 time 4", "fade over 4 seconds"], ["rem dim", "everything not selected to 0"]]],
    ["Faster programming", [["1 thru 10 @ 0 thru 100", "fan levels across the lights"], ["recall from cue 5", "selected lights take cue 5's look"], ["recall from cue 5 colour", "…just the colour (or intensity, position, beam)"], ["apply to cue 3 thru 9", "your changes go into cues 3–9"], ["apply to cue 3,5,7 colour", "…just the colour"], ["copy 1 to 2 thru 6", "light 1's look onto 2–6"], ["highlight", "selected lights full, white (next / last step through)"], ["highlight off", "back as they were"], ["patch 1 thru 8 at 2/1", "re-address lights one after another"], ["effect snowfall", "snow, ice shimmer, aurora, blizzard, freeze, fireplace"]]],
    ["Colour & movement", [["1 thru 4 red", "colour by name"], ["group 2 @ 60 blue", "level and colour together"], ["5 pan 100 tilt 40", "position (0–255)"], ["5 zoom 200", "also focus, frost, iris, gobo, prism"], ["group 3 home", "pan and tilt to centre"], ["1 strobe 120", "strobe (strobe off to stop)"]]],
    ["Cues", [["record cue 5 Opening", "record a cue"], ["record cue 2.5", "a cue between 2 and 3"], ["move cue 4 to 1.5", "renumber a cue"], ["go", "next cue"], ["go 3", "jump to cue 3"], ["back", "previous cue"], ["update cue 3", "save the stage into cue 3"], ["fade 3 2.5", "set cue 3's fade"], ["sneak", "fade back to the current cue"], ["cue list", "open the Cue List window"], ["block cue 4", "cue 4 stores its whole look"], ["track cue 4", "cue 4 stores only changes"], ["mib off", "turn move in black off"], ["sneak 5", "…over 5 seconds"]]],
    ["Cue options", [["cue 5 up 3 down 6", "split fade: up 3 s, down 6 s"], ["cue 5 move 4 delay 1", "moves take 4 s, after 1 s"], ["cue 5 colour 2", "colour changes take 2 s"], ["cue 5 delay 2", "wait 2 s before fading"], ["cue 5 curve linear", "fade shape: smooth, linear, in, out, snap"], ["cue 5 rate 200", "play twice as fast"], ["cue 5 follow 2", "next cue 2 s after this GO"], ["cue 5 hang 2", "next cue 2 s after this finishes"], ["cue 8 link 5", "after 8, GO jumps back to 5"], ["cue 8 loop 3", "…3 times, then on"], ["cue 5 disable", "GO skips cue 5"], ["cue 5 scene Act 1", "scene heading in the cue list"], ["cue 5 command haze 40", "run a command when cue 5 GOes"], ["cue 5 note …", "a note on the cue"], ["curtain open", "open the curtain in the visualiser"], ["curtain close 8", "close it over 8 seconds"], ["cue 1 curtain open", "cue 1 opens the curtain (recording a cue stores the curtain too)"]]],
    ["Other", [["undo", `undo a level change (${/Mac/.test(navigator.platform) ? "⌘Z" : "Ctrl+Z"})`], ["redo", `redo it (${/Mac/.test(navigator.platform) ? "⇧⌘Z" : "Ctrl+Y"})`], ["info 5", "what fixture 5 is doing, and why (window)"], ["blackout", "everything off"], ["full", "everything on"], ["auto create", "groups, palettes, effects and chases"], ["viz", "3D visualiser"], ["save MyShow.json", "save the show"]]],
    ["Checking", [["errors", "what's gone wrong this session, and how often"], ["check", "health check: outputs, patch, clashes, saved…"], ["stats", "running time, GOs, commands, errors"], ["clashes", "fixtures whose addresses overlap"], ["address 5", "where fixture 5 is patched"], ["dmx 5", "the DMX fixture 5 is sending now"], ["locate 5", "fixture 5 full, open white, centred"], ["fixture check", "step through every light one by one"], ["history", "the last commands typed"], ["haze 50", "every hazer to 50% (also fog, fan)"], ["update", "check for a new Light Spark"]]]
  ];

  function buildReference(body) {
    body.innerHTML = `<div class="lx-cmdref">${REFERENCE.map(([title, rows]) => `<h5>${title.toUpperCase()}</h5><div class="lx-cmdref-grid">${rows.map(([cmd, what]) => `<button type="button" data-cmd="${cmd.replace(/"/g, "&quot;")}"><code>${cmd}</code><span>${what}</span></button>`).join("")}</div>`).join("")}<p>↑ and ↓ in the command line bring back earlier commands. Click any line above to put it in the command line, then press Enter.</p></div>`;
    body.addEventListener("click", e => {
      const b = e.target.closest("button[data-cmd]");
      if (!b) return;
      const input = document.getElementById("cmdInput");
      if (!input) return;
      input.value = b.dataset.cmd;
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function injectStyles() {
    if (document.getElementById("lxCmdStyles")) return;
    const style = document.createElement("style");
    style.id = "lxCmdStyles";
    style.textContent = `
      .cmd-preview{flex:0 1 auto;min-width:0;max-width:55%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--accent-2);font-family:var(--mono);font-size:10px;padding:0 8px;margin-right:104px;border-left:1px solid var(--border)}
      html[data-remote="off"] .cmd-preview{margin-right:0}
      .cmd-preview:empty{display:none}
      .cmd-preview.bad{color:var(--warning)}
      .cmd-line:has(.cmd-preview:not(:empty)) .cmd-ticker{display:none}
      .lx-cmdref{padding:10px;display:flex;flex-direction:column;gap:6px}
      .lx-cmdref h5{margin:6px 0 0;color:#5d6b68;font-size:9px;font-weight:850;letter-spacing:1.2px}
      .lx-cmdref-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:3px}
      .lx-cmdref-grid button{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center;min-height:26px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:#10171b;color:#9aa7a4;font-size:10.5px;text-align:left;cursor:pointer}
      .lx-cmdref-grid button:hover{border-color:var(--accent-line);color:var(--text)}
      .lx-cmdref code{color:var(--accent-2);font-family:var(--mono);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lx-cmdref p{margin:8px 0 0;color:#6f7d7a;font-size:11px}
    `;
    document.head.appendChild(style);
  }

  // ----------------------------------------------------------------- boot

  function addDefs() {
    if (typeof commandDefs === "undefined" || commandDefs.__lxCmd) return;
    commandDefs.__lxCmd = true;
    commandDefs.push(
      { cmd: "help", hint: "— every command, with examples" },
      { cmd: "undo", hint: "— undo a level change" }, { cmd: "redo", hint: "" },
      { cmd: "info", hint: "[fixture] — what it's doing" },
      { cmd: "focus", hint: "[across] [depth] — point & shoot (metres from centre, downstage edge)" },
      { cmd: "mib", hint: "[on|off] — move in black" },
      { cmd: "clear programmer", hint: "— drop hand changes, back to the live cue" },
      { cmd: "insert cue", hint: "N — load what cue N programs into the Control Deck" },
      { cmd: "block cue", hint: "N — cue stores its whole look" },
      { cmd: "track cue", hint: "N — cue stores only what changed" },
      { cmd: "rem dim", hint: "— everything not selected to 0" },
      { cmd: "sneak", hint: "[seconds] — fade back to the current cue" }
    );
  }

  function boot(tries = 0) {
    injectStyles();
    addDefs();
    if (window.LXWindows && !window.LXWindows.list().includes("commands")) {
      window.LXWindows.register({ id: "commands", title: "Command Reference", build: buildReference, w: 640, h: 520 });
    }
    // Go in front of every other command handler, once they've all installed.
    install();
    const ready = wireInput();
    if ((!ready || !window.LXWindows) && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  // Other scripts wrap parseCommand on load; take the front spot after them,
  // and again if one wraps later.
  window.addEventListener("load", () => setTimeout(boot, 400));
  // Retry until it's in (parseCommand may not exist yet), then never again:
  // re-adding it whenever another layer sat on top made the two leapfrog,
  // stacking wrappers until commands overflowed and Enter did nothing.
  const retry = setInterval(() => { if (installed || install()) clearInterval(retry); }, 1000);

  window.LXCommandLine = Object.freeze({ parse, describe, undo, redo, history: () => [...history] });
})();
