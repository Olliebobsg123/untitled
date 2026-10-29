"use strict";

/*
 * MIDI map: any MIDI controller, any number of knobs, faders, pads, keys,
 * joysticks or endless encoders, each mapped to whatever you like.
 *
 * Settings → MIDI → MIDI Map. "Learn a control", move or press it, then
 * choose what it does:
 *
 *   Fader on the Faders page   its level (knob/fader) or Flash (pad/key)
 *   Grand master               level, or a pad blacks out while held
 *   Some lights                a parameter of fixtures you name ("1 thru 4"):
 *                              intensity, colour, pan, tilt, zoom, any channel
 *   Selected lights            the same, for whatever's selected
 *   A command                  a pad or key runs any command line text:
 *                              "go", "back", "cue 5", "1 thru 4 @ full", "blackout"
 *
 * How the control is read: Absolute (a knob or fader), Endless (an encoder
 * sending +/- steps), Button (pressed / let go) or Toggle (on, then off).
 *
 * Every input is listened to unless a mapping names one. Mappings are kept
 * in this computer's settings and can be exported for another computer or
 * shared for a controller model.
 */
(function () {
  if (window.LXMidiMap) return;
  const STORE = "lx-midi-map";
  const $ = id => document.getElementById(id);
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = n => `${NOTES[n % 12]}${Math.floor(n / 12) - 2}`;
  const PARAMS = [["intensity", "Intensity", 100], ["hue", "Colour (hue)", 360], ["sat", "Saturation", 100], ["pan", "Pan", 255], ["tilt", "Tilt", 255], ["zoom", "Zoom", 255], ["focus", "Focus", 255], ["iris", "Iris", 255], ["frost", "Frost", 255], ["strobe", "Strobe", 255], ["gobo", "Gobo 1", 255], ["gobor", "Gobo 1 rotate", 255], ["gobo2", "Gobo 2", 255], ["prism", "Prism", 255], ["cto", "CTO", 255], ["speed", "Speed", 255], ["effect", "Effect", 255], ["blueMix", "Blue mix", 255], ["amberMix", "Amber mix", 255], ["magentaMix", "Magenta mix", 255], ["fog", "Fog", 255], ["haze", "Haze", 255]];
  const RANGE = Object.fromEntries(PARAMS.map(([k, , r]) => [k, r]));

  let saved = { mappings: [], oldOff: false };
  try { saved = { ...saved, ...(JSON.parse(localStorage.getItem(STORE) || "{}") || {}) }; } catch (_) {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (_) {} };
  let access = null, learning = null, last = null;
  const toggles = new Map(), positions = new Map();

  // ----------------------------------------------------------- reading MIDI

  // A message as { kind, channel, number, value (0-1), on (pressed?) }.
  function parse(data) {
    const [status, d1 = 0, d2 = 0] = data;
    const type = status & 0xf0, channel = status & 0x0f;
    if (type === 0x90 || type === 0x80) return { kind: "note", channel, number: d1, value: type === 0x90 ? d2 / 127 : 0, on: type === 0x90 && d2 > 0, raw: d2 };
    if (type === 0xb0) return { kind: "cc", channel, number: d1, value: d2 / 127, on: d2 > 0, raw: d2 };
    if (type === 0xe0) return { kind: "pitch", channel, number: 0, value: ((d2 << 7) | d1) / 16383, on: true, raw: (d2 << 7) | d1 };
    if (type === 0xc0) return { kind: "pc", channel, number: d1, value: 1, on: true, raw: d1 };
    if (type === 0xd0) return { kind: "at", channel, number: 0, value: d1 / 127, on: d1 > 0, raw: d1 };
    if (type === 0xa0) return { kind: "at", channel, number: d1, value: d2 / 127, on: d2 > 0, raw: d2 };
    return null;
  }
  const describe = m => m.kind === "note" ? `Note ${noteName(m.number)} (${m.number})` : m.kind === "cc" ? `CC ${m.number}` : m.kind === "pitch" ? "Pitch bend" : m.kind === "pc" ? `Program ${m.number + 1}` : `Pressure${m.number ? ` ${m.number}` : ""}`;
  const matches = (map, m, input) => map.kind === m.kind && (map.channel === -1 || map.channel === m.channel) && (map.kind === "pitch" || (map.kind === "at" && !map.number) || map.number === m.number) && (!map.input || map.input === "any" || map.input === input);

  function onMessage(e) {
    const m = parse(e.data);
    if (!m) return;
    const input = e.target?.name || "";
    last = { ...m, input, at: Date.now() };
    if (learning) {
      // A key or pad being let go isn't the control to learn.
      if ((m.kind === "note" && !m.on)) return;
      const map = learning === "new" ? { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, action: { type: "none" } } : saved.mappings.find(x => x.id === learning);
      if (!map) { learning = null; return; }
      Object.assign(map, { kind: m.kind, channel: m.channel, number: m.number, input: "any", mode: map.mode || (m.kind === "note" || m.kind === "pc" ? "button" : "absolute") });
      if (learning === "new") saved.mappings.push(map);
      learning = null;
      save(); render();
      window.log?.(`MIDI: learned ${describe(m)} on channel ${m.channel + 1}${input ? ` (${input})` : ""}`, "ok");
      return;
    }
    let hit = false;
    for (const map of saved.mappings) if (matches(map, m, input)) { hit = true; run(map, m); }
    flashActivity(hit ? saved.mappings.filter(map => matches(map, m, input)).map(map => map.id) : []);
  }

  // ------------------------------------------------------------ doing things

  function run(map, m) {
    const a = map.action || {};
    if (map.mode === "button" || map.mode === "toggle") {
      let down = m.on;
      if (map.mode === "toggle") { if (!m.on) return; down = !toggles.get(map.id); toggles.set(map.id, down); }
      return press(a, down, map.mode === "toggle");
    }
    let value = m.value;
    if (map.mode === "relative") {
      // Endless encoders: 1-63 turn up, 65-127 turn down (65 = one step down).
      const step = m.raw < 64 ? m.raw : -(128 - m.raw);
      value = Math.max(0, Math.min(1, (positions.get(map.id) ?? current(a)) + step / 100));
    }
    if (map.invert) value = 1 - value;
    positions.set(map.id, value);
    level(a, value);
  }

  // What a knob is at now, so an endless encoder starts from there.
  function current(a) {
    if (a.type === "fader") return (Number(window.LXFaders?.data?.().pages?.[Math.floor((a.n - 1) / 10)]?.[(a.n - 1) % 10]?.level) || 0) / 100;
    if (a.type === "grand") return (Number(window.LXFaders?.data?.().grand) || 0) / 100;
    if (a.type === "lights" || a.type === "selected") {
      const f = targets(a)[0];
      const st = f && (typeof window.ensureFixtureState === "function" ? window.ensureFixtureState(f.id) : S().fixtureStates?.get(f.id));
      return st ? (Number(st[a.attr]) || 0) / (RANGE[a.attr] || 255) : 0;
    }
    return 0;
  }

  function targets(a) {
    const fixtures = S().fixtures || [];
    if (a.type === "selected") { const sel = S().selected instanceof Set ? S().selected : new Set(); return fixtures.filter(f => sel.has(f.id)); }
    const numbers = window.LXFaders?.parseNumbers?.(a.lights) || [];
    return fixtures.filter(f => numbers.includes(Number(f.fixtureNumber)));
  }

  let frame = 0;
  const refresh = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; window.updateDMX?.(); window.sendToVisualizer?.(); });
  };

  function level(a, value) {
    if (a.type === "fader") return window.LXFaders?.setFader?.(Number(a.n) || 1, value * 100);
    if (a.type === "grand") return window.LXFaders?.setGrand?.(value * 100);
    if (a.type === "lights" || a.type === "selected") {
      const range = RANGE[a.attr] || 255;
      for (const f of targets(a)) {
        const st = typeof window.ensureFixtureState === "function" ? window.ensureFixtureState(f.id) : S().fixtureStates?.get(f.id);
        if (!st) continue;
        st[a.attr] = Math.round(value * range);
        if (a.attr === "hue" && Number(st.sat) < 5) st.sat = 100;
      }
      return refresh();
    }
    // A knob on a command: runs once as it passes half way up.
    if (a.type === "command") { const was = positions.get(`cmd:${a.text}`) || 0; positions.set(`cmd:${a.text}`, value); if (was < 0.5 && value >= 0.5) window.parseCommand?.(a.text); }
  }

  function press(a, down, latched) {
    if (a.type === "fader") return latched ? window.LXFaders?.setFader?.(Number(a.n) || 1, down ? 100 : 0) : window.LXFaders?.flashFader?.(Number(a.n) || 1, down);
    // Grand master on a pad: blackout while held (or on/off as a toggle).
    if (a.type === "grand") {
      const f = window.LXFaders?.data?.();
      if (!f) return;
      if (down) { positions.set("grand:held", Number(f.grand) || 100); window.LXFaders.setGrand(0); }
      else window.LXFaders.setGrand(positions.get("grand:held") ?? 100);
      return;
    }
    if (a.type === "lights" || a.type === "selected") return level(a, down ? 1 : 0);
    if (a.type === "command" && down && a.text) window.parseCommand?.(a.text);
  }

  // ---------------------------------------------------------------- inputs

  async function connect() {
    if (access || !navigator.requestMIDIAccess) return;
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
      const attach = () => { for (const input of access.inputs.values()) input.addEventListener("midimessage", onMessage); render(); };
      access.addEventListener("statechange", e => { if (e.port.type === "input" && e.port.state === "connected") e.port.addEventListener("midimessage", onMessage); render(); });
      attach();
    } catch (err) { window.log?.(`MIDI: ${err.message}`, "warn"); }
  }
  const inputNames = () => access ? [...access.inputs.values()].filter(i => i.state !== "disconnected").map(i => i.name) : [];

  // ---------------------------------------------------------------- panel

  function actionFields(map) {
    const a = map.action || {};
    if (a.type === "fader") return `<label>Fader <input type="number" min="1" max="${window.LXFaders?.count || 40}" data-f="n" value="${esc(a.n || 1)}"></label>`;
    if (a.type === "lights") return `<label>Fixtures <input data-f="lights" placeholder="1 thru 4" value="${esc(a.lights || "")}"></label>${paramSelect(a)}`;
    if (a.type === "selected") return paramSelect(a);
    if (a.type === "command") return `<label class="mm-wide">Command <input data-f="text" placeholder="go · back · cue 5 · 1 thru 4 @ full" value="${esc(a.text || "")}"></label>`;
    return "";
  }
  const paramSelect = a => `<label>Parameter <select data-f="attr">${PARAMS.map(([k, n]) => `<option value="${k}"${(a.attr || "intensity") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;

  function render() {
    const host = $("midiMapList");
    if (!host) return;
    const names = inputNames();
    $("midiMapInputs").textContent = names.length ? `Listening to: ${names.join(", ")}` : (navigator.requestMIDIAccess ? "No MIDI controller connected — plug one in." : "MIDI isn't available here.");
    $("midiMapLearn").textContent = learning === "new" ? "Move or press a control on your controller…" : "＋ Learn a control";
    $("midiMapLearn").classList.toggle("learning", learning === "new");
    $("midiMapOld").checked = !saved.oldOff;
    host.innerHTML = saved.mappings.length ? saved.mappings.map(map => {
      const a = map.action || { type: "none" };
      return `<div class="mm-row" data-id="${map.id}">
        <span class="mm-dot"></span>
        <div class="mm-control"><b>${esc(describe(map))}</b><small>channel ${map.channel === -1 ? "any" : map.channel + 1}${map.input && map.input !== "any" ? ` · ${esc(map.input)}` : ""}</small></div>
        <label>Read as <select data-m="mode">${[["absolute", "Knob / fader"], ["relative", "Endless encoder"], ["button", "Button (held)"], ["toggle", "Toggle (on / off)"]].map(([v, n]) => `<option value="${v}"${map.mode === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Does <select data-a="type">${[["none", "— Nothing —"], ["fader", "A fader on the Faders page"], ["grand", "Grand master"], ["lights", "Some lights"], ["selected", "Selected lights"], ["command", "A command"]].map(([v, n]) => `<option value="${v}"${a.type === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        ${actionFields(map)}
        <label class="mm-check"><input type="checkbox" data-m="invert"${map.invert ? " checked" : ""}> Reverse</label>
        <button type="button" class="btn-secondary" data-relearn title="Learn a different control for this">${learning === map.id ? "Move it…" : "Learn"}</button>
        <button type="button" class="btn-danger-soft" data-del title="Remove">×</button>
      </div>`;
    }).join("") : `<div class="mm-empty">No controls mapped yet. Press “Learn a control”, then move a knob or press a pad on your controller.</div>`;
  }

  function flashActivity(ids) {
    const el = $("midiMapLast");
    if (el && last) el.textContent = `Last: ${describe(last)} · channel ${last.channel + 1} · value ${last.raw}${last.input ? ` · ${last.input}` : ""}${ids.length ? "" : " (not mapped)"}`;
    for (const id of ids) {
      const dot = document.querySelector(`.mm-row[data-id="${id}"] .mm-dot`);
      if (!dot) continue;
      dot.classList.add("on");
      clearTimeout(dot.__t);
      dot.__t = setTimeout(() => dot.classList.remove("on"), 150);
    }
  }

  function install(tries = 0) {
    const old = $("midiDevice")?.closest(".panel");
    if (!old) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if ($("midiMapPanel")) return;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "midiMapPanel";
    panel.dataset.prefsTab = "midi";
    panel.innerHTML = `<div class="panel-header"><div><span class="eyebrow">MIDI</span> MIDI Map</div><span class="panel-meta">ANY CONTROLLER</span></div><div class="panel-body">
      <p class="mm-note">Map any knob, fader, pad, key or encoder on any MIDI controller. Press <b>Learn a control</b>, move or press it, then choose what it does.</p>
      <div class="action-row"><button type="button" class="btn-primary" id="midiMapLearn">＋ Learn a control</button><button type="button" class="btn-secondary" id="midiMapExport">Export…</button><button type="button" class="btn-secondary" id="midiMapImport">Import…</button><input type="file" id="midiMapFile" accept=".json" hidden></div>
      <div class="mm-note" id="midiMapInputs"></div><div class="mm-note" id="midiMapLast"></div>
      <div id="midiMapList" class="mm-list"></div>
      <label class="mm-check"><input type="checkbox" id="midiMapOld"> Also use the fixed AKAI MPK Mini mapping below (turn off if a control does two things)</label></div>`;
    old.before(panel);
    panel.addEventListener("click", e => {
      if (e.target.closest("#midiMapLearn")) { learning = learning === "new" ? null : "new"; connect(); render(); return; }
      if (e.target.closest("#midiMapExport")) return exportMap();
      if (e.target.closest("#midiMapImport")) return $("midiMapFile").click();
      const row = e.target.closest(".mm-row");
      if (!row) return;
      const map = saved.mappings.find(m => m.id === row.dataset.id);
      if (e.target.closest("[data-del]")) { saved.mappings = saved.mappings.filter(m => m !== map); save(); render(); }
      if (e.target.closest("[data-relearn]")) { learning = learning === map.id ? null : map.id; connect(); render(); }
    });
    panel.addEventListener("change", e => {
      if (e.target.id === "midiMapOld") { saved.oldOff = !e.target.checked; save(); return; }
      if (e.target.id === "midiMapFile") return importMap(e.target.files?.[0]);
      const row = e.target.closest(".mm-row");
      const map = row && saved.mappings.find(m => m.id === row.dataset.id);
      if (!map) return;
      const t = e.target;
      if (t.dataset.m === "mode") map.mode = t.value;
      if (t.dataset.m === "invert") map.invert = t.checked;
      if (t.dataset.a === "type") { map.action = { type: t.value }; if (t.value === "fader") map.action.n = 1; if (t.value === "lights" || t.value === "selected") map.action.attr = "intensity"; render(); }
      if (t.dataset.f) map.action[t.dataset.f] = t.type === "number" ? Number(t.value) : t.value;
      positions.delete(map.id);
      save();
    });
    if (!$("midiMapStyles")) {
      const st = document.createElement("style");
      st.id = "midiMapStyles";
      st.textContent = `.mm-note{font-size:11.5px;line-height:1.5;color:#7d8987;margin:0 0 8px}.mm-list{display:grid;gap:6px;margin:8px 0}.mm-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 10px;border:1px solid #202a30;border-radius:8px;background:#0d1418}.mm-row label{display:flex;align-items:center;gap:6px;font-size:11px;color:#7d8987}.mm-row select,.mm-row input:not([type=checkbox]){min-width:0;max-width:220px}.mm-row input[type=number]{width:64px}.mm-row .mm-wide input{width:220px}.mm-control{min-width:120px}.mm-control b{display:block;font-size:12px;color:#edf4f2}.mm-control small{font-size:10.5px;color:#7d8987}.mm-dot{width:9px;height:9px;border-radius:50%;background:#2b383f;flex:0 0 auto}.mm-dot.on{background:#54f2c8;box-shadow:0 0 8px rgba(84,242,200,.8)}.mm-empty{padding:12px;border:1px dashed #2b383f;border-radius:8px;font-size:11.5px;color:#7d8987}.mm-check{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#9fb0ac}#midiMapLearn.learning{animation:mmPulse 1s infinite}@keyframes mmPulse{50%{filter:brightness(1.4)}}`;
      document.head.appendChild(st);
    }
    render();
    connect();
  }

  function exportMap() {
    const blob = new Blob([JSON.stringify({ format: "lx-midi-map", mappings: saved.mappings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Light Spark MIDI map.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importMap(file) {
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.mappings)) throw new Error("not a MIDI map");
      saved.mappings = j.mappings;
      save(); render();
      window.log?.(`MIDI map imported: ${j.mappings.length} control${j.mappings.length === 1 ? "" : "s"}`, "ok");
    } catch (err) { window.log?.(`Couldn't import that: ${err.message}`, "warn"); }
  }

  window.LXMidiMap = {
    blocksOld: () => Boolean(saved.oldOff),
    mappings: () => saved.mappings,
    // For tests and other modules: feed a raw MIDI message in.
    receive: (bytes, inputName = "") => onMessage({ data: bytes, target: { name: inputName } }),
    learn: () => { learning = "new"; render(); },
    render
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
