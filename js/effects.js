"use strict";

window.State = window.State || {};
State.activeEffect = State.activeEffect || null;
State.effectFrame = State.effectFrame || null;
State.savedEffects = State.savedEffects || {};
State.effectTargetIds = State.effectTargetIds instanceof Set ? State.effectTargetIds : new Set();
State.effectTargetMode = State.effectTargetMode || "selected";

if (!Number.isFinite(Number(State.effectIntensity))) State.effectIntensity = 100;

function fxNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function fxClamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, fxNumber(value, min)));
}
function fxLog(message, type = "info") {
  if (typeof window.log === "function") window.log(message, type);
  else console.log("[EFFECTS]", message);
}
function fxUpdateOutput() {
  try { if (typeof window.updateDMX === "function") window.updateDMX(); } catch (e) { console.error("[EFFECTS] updateDMX failed:", e); }
  try { if (typeof window.sendToVisualizer === "function") window.sendToVisualizer(); } catch (e) { console.error("[EFFECTS] Visualizer update failed:", e); }
}

function setIntensity(percent) {
  const value = fxClamp(percent);
  State.effectIntensity = value;
  State.current = State.current || {};
  State.current.intensity = value;
  fxUpdateOutput();
  const slider = document.getElementById("intensity");
  const label = document.getElementById("intensityVal") || document.getElementById("intVal");
  if (slider) slider.value = value;
  if (label) label.textContent = String(Math.round(value));
  return value;
}
function fxGetLiveIntensity() {
  const current = Number(State.current && State.current.intensity);
  return Number.isFinite(current) ? fxClamp(current) : fxClamp(State.effectIntensity, 0, 100);
}
function fxApplyIntensity(effectValue) {
  return Math.round(fxClamp(effectValue) * fxGetLiveIntensity() / 100);
}

function fxGetFixtureDefinition(fixture) {
  if (!fixture || !window.FixtureLibrary) return null;
  const names = [fixture.name, fixture.fixtureName, fixture.fixtureType, fixture.fixture, fixture.profileName, fixture.profile, fixture.model, fixture.type, fixture.libraryName];
  for (const name of names) if (typeof name === "string" && FixtureLibrary[name]) return FixtureLibrary[name];
  if (fixture.definition && typeof fixture.definition === "object" && fixture.definition.map) return fixture.definition;
  if (fixture.profile && typeof fixture.profile === "object" && fixture.profile.map) return fixture.profile;
  return null;
}
function fxAllFixtures() {
  return Array.isArray(State.fixtures) ? State.fixtures.filter(f => f && f.id != null) : [];
}
function fxNormaliseIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [...(ids instanceof Set ? ids : [])]).filter(id => id != null).map(String))];
}
function fxGetFixtureId(fixture) { return fixture && fixture.id != null ? String(fixture.id) : null; }

function fxResolveTargetIds(options = {}) {
  if (Array.isArray(options.fixtureIds) || options.fixtureIds instanceof Set) return fxNormaliseIds(options.fixtureIds);
  const mode = options.fixtureMode || options.targetMode || State.effectTargetMode || "selected";
  if (mode === "all") return fxAllFixtures().map(fxGetFixtureId);
  if (mode === "custom") return fxNormaliseIds(State.effectTargetIds);
  if (State.selected instanceof Set && State.selected.size) return fxNormaliseIds(State.selected);
  return [];
}
function fxGetFixtures(options = {}) {
  const all = fxAllFixtures();
  const ids = fxResolveTargetIds(options);
  if (!ids.length) return [];
  // An "ordered" effect runs through its fixtures in the order it lists them
  // (e.g. left to right across the stage); otherwise patch order.
  if (options.ordered) {
    const byId = new Map(all.map(f => [fxGetFixtureId(f), f]));
    return ids.map(id => byId.get(id)).filter(Boolean);
  }
  const wanted = new Set(ids);
  return all.filter(f => wanted.has(fxGetFixtureId(f)));
}
function fxSetEffectTargets(ids, mode = "custom") {
  State.effectTargetMode = mode;
  State.effectTargetIds = new Set(fxNormaliseIds(ids));
  fxRenderEffectTargetUI();
  return [...State.effectTargetIds];
}
function fxCaptureEffectTargets(options = {}) {
  if (Array.isArray(options.fixtureIds) || options.fixtureIds instanceof Set) {
    return { fixtureMode: options.fixtureMode || options.targetMode || "custom", fixtureIds: fxNormaliseIds(options.fixtureIds) };
  }
  const modeSelect = document.getElementById("effectFixtureMode");
  const mode = options.fixtureMode || options.targetMode || (modeSelect ? modeSelect.value : State.effectTargetMode || "selected");
  if (mode === "all") return { fixtureMode: "all", fixtureIds: fxAllFixtures().map(fxGetFixtureId) };
  if (mode === "custom") {
    const ids = [...document.querySelectorAll("#effectFixtureTargets input[data-fixture-id]:checked")].map(el => el.dataset.fixtureId);
    return { fixtureMode: "custom", fixtureIds: fxNormaliseIds(ids) };
  }
  return { fixtureMode: "selected", fixtureIds: fxNormaliseIds(State.selected) };
}

function fxRenderEffectTargetUI() {
  const select = document.getElementById("effectFixtureMode");
  if (!select) return;
  if (![...select.options].some(o => o.value === "custom")) {
    const option = document.createElement("option");
    option.value = "custom";
    option.textContent = "Choose Fixtures...";
    select.appendChild(option);
  }
  let box = document.getElementById("effectFixtureTargets");
  if (!box) {
    box = document.createElement("div");
    box.id = "effectFixtureTargets";
    box.className = "effect-fixture-targets";
    box.style.cssText = "display:none;margin-top:10px;max-height:220px;overflow:auto;padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;";
    select.closest(".form-row")?.appendChild(box);
  }
  const fixtures = fxAllFixtures();
  box.innerHTML = fixtures.length ? fixtures.map((fixture, index) => {
    const id = fxGetFixtureId(fixture);
    const label = String(fixture.name || fixture.fixtureName || fixture.fixtureType || `Fixture ${index + 1}`);
    const checked = State.effectTargetIds.has(id) ? " checked" : "";
    const safeId = id.replace(/"/g, "&quot;");
    const safeLabel = label.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    return `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer"><input type="checkbox" data-fixture-id="${safeId}"${checked}> <span>${safeLabel}</span></label>`;
  }).join("") : `<div style="opacity:.7">No patched fixtures.</div>`;
  box.querySelectorAll("input[data-fixture-id]").forEach(input => input.addEventListener("change", () => {
    State.effectTargetIds = new Set([...box.querySelectorAll("input[data-fixture-id]:checked")].map(el => el.dataset.fixtureId));
  }));
  box.style.display = select.value === "custom" ? "block" : "none";
}
function fxWireEffectTargetUI() {
  const select = document.getElementById("effectFixtureMode");
  if (!select || select.dataset.fxTargetWired === "true") return;
  select.dataset.fxTargetWired = "true";
  if (select.value === "") select.value = "selected";
  select.addEventListener("change", () => {
    State.effectTargetMode = select.value;
    if (select.value === "selected") State.effectTargetIds = new Set(fxNormaliseIds(State.selected));
    if (select.value === "all") State.effectTargetIds = new Set(fxAllFixtures().map(fxGetFixtureId));
    fxRenderEffectTargetUI();
  });
  fxRenderEffectTargetUI();
}

function fxGetState(fixture) {
  if (!fixture || fixture.id == null) return null;
  if (typeof window.fixtureState === "function") return window.fixtureState(fixture.id);
  if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
  if (!State.fixtureStates.has(fixture.id)) {
    State.fixtureStates.set(fixture.id, typeof window.createFixtureState === "function" ? window.createFixtureState(State.current) : { ...(State.current || {}) });
  }
  return State.fixtureStates.get(fixture.id);
}
function fxHasColour(fixture) {
  const def = fxGetFixtureDefinition(fixture), map = def && def.map;
  return !!(map && typeof map.r === "number" && typeof map.g === "number" && typeof map.b === "number");
}

function stopEffect(silent = false) {
  if (State.effectFrame !== null) { LXClock.cancel(State.effectFrame); State.effectFrame = null; }
  const previous = State.activeEffect;
  State.activeEffect = null;
  if (!silent && previous) fxLog(`■ Effect stopped: ${previous.type}`, "ok");
}
function fxStart(type, options = {}, renderFrame, filter) {
  stopEffect(true);
  const targetInfo = fxCaptureEffectTargets(options);
  const fixtures = fxGetFixtures({ ...targetInfo, ordered: options.ordered }).filter(filter || (() => true));
  if (!fixtures.length) { fxLog("No fixtures selected for this effect", "warn"); return false; }
  const speed = Math.max(type === "strobe" ? 1 : 0.05, fxNumber(options.speed, type === "strobe" ? 8 : 1));
  State.activeEffect = { type, speed, fixtureMode: targetInfo.fixtureMode, fixtureIds: targetInfo.fixtureIds.slice() };
  const started = performance.now();
  function frame(now) {
    if (!State.activeEffect || State.activeEffect.type !== type) return;
    renderFrame(now, (now - started) / 1000, fixtures);
    fxUpdateOutput();
    State.effectFrame = LXClock.frame(frame);
  }
  State.effectFrame = LXClock.frame(frame);
  fxLog(`▶ ${type[0].toUpperCase() + type.slice(1)} started — ${fixtures.length} fixture${fixtures.length === 1 ? "" : "s"}`, "ok");
  return true;
}

function startRainbow(options = {}) {
  return fxStart("rainbow", options, (now, elapsed, fixtures) => {
    const speed = Math.max(0.05, fxNumber(options.speed, 0.12));
    const live = fxGetLiveIntensity();
    fixtures.forEach((fixture, index) => {
      const hue = (elapsed * speed * 360 + index / Math.max(1, fixtures.length) * 360) % 360;
      const state = fxGetState(fixture); if (!state) return;
      state.hue = hue; state.sat = 100; state.light = 50; state.intensity = live; state.master = 100;
      if ("w" in state) state.w = 0;
    });
  }, fxHasColour);
}
function startStrobe(options = {}) {
  return fxStart("strobe", options, (now, elapsed, fixtures) => {
    const speed = Math.max(1, fxNumber(options.speed, 8));
    const on = Math.floor(elapsed * speed) % 2 === 0;
    const live = fxGetLiveIntensity();
    fixtures.forEach(fixture => {
      const def = fxGetFixtureDefinition(fixture), state = fxGetState(fixture); if (!def || !state) return;
      const map = def.map || {};
      if (typeof map.strobe === "number") state.strobe = on ? Math.round(255 * live / 100) : 0;
      state.intensity = map.strobe === undefined ? (on ? live : 0) : live;
    });
  });
}
function startPulse(options = {}) {
  return fxStart("pulse", options, (now, elapsed, fixtures) => {
    const speed = Math.max(0.1, fxNumber(options.speed, 1));
    const wave = (Math.sin(elapsed * speed * Math.PI * 2) + 1) / 2;
    const intensity = fxApplyIntensity(10 + wave * 90);
    fixtures.forEach(fixture => { const state = fxGetState(fixture); if (state) state.intensity = intensity; });
  });
}

function startChaseEffect(options = {}) {
  return fxStart("chase", options, (now, elapsed, fixtures) => {
    if (!fixtures.length) return;
    const speed = Math.max(0.1, fxNumber(options.speed, 5));
    const active = Math.floor(elapsed * speed) % fixtures.length;
    const live = fxGetLiveIntensity();
    fixtures.forEach((fixture, index) => { const state = fxGetState(fixture); if (!state) return; state.intensity = index === active ? live : 0; state.hue = 0; state.sat = 0; state.light = 100; state.master = 100; });
  }, fxHasColour);
}
function startWave(options = {}) {
  return fxStart("wave", options, (now, elapsed, fixtures) => {
    const speed = Math.max(0.1, fxNumber(options.speed, 1));
    fixtures.forEach((fixture, index) => {
      const state = fxGetState(fixture); if (!state) return;
      const position = index / Math.max(1, fixtures.length - 1);
      const phase = elapsed * speed * Math.PI * 2 + position * Math.PI * 2;
      const value = (Math.sin(phase) + 1) / 2;
      state.intensity = fxApplyIntensity(10 + value * 90);
    });
  });
}
// ------------------------------------------------------------------
// More effect types. Each reads its settings from the effect itself, so a
// saved effect can carry them (Auto Create makes most of its effects with
// these):
//   speed   cycles (or steps) per second
//   spread  0-1: how far apart in the cycle neighbouring fixtures are
//   order   "forward" | "reverse" | "centre" (from the middle out)
//   colours list of hues (0-360); size: movement size in DMX steps (0-255)
// Movement effects run around wherever each head was pointing when the
// effect started, so put the heads somewhere (a position palette) first.
// ------------------------------------------------------------------
function fxRandom(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function fxDefinitionMap(fixture) { return fxGetFixtureDefinition(fixture)?.map || {}; }
function fxCanColour(fixture) {
  const map = fxDefinitionMap(fixture);
  return fxHasColour(fixture) || typeof map.colour === "number" || ["cyan", "magenta", "yellow"].every(k => typeof map[k] === "number");
}
function fxCanMove(fixture) {
  const map = fxDefinitionMap(fixture);
  return typeof map.pan === "number" || typeof map.tilt === "number";
}
// Colour by hue for every kind of fixture: RGB and wheels take hue/sat/light;
// CMY fixtures subtract from white.
function fxSetColour(fixture, state, hue, sat = 100, light = 50) {
  state.hue = ((hue % 360) + 360) % 360; state.sat = sat; state.light = light;
  if ("w" in state) state.w = 0;
  const map = fxDefinitionMap(fixture);
  if (typeof map.r !== "number" && ["cyan", "magenta", "yellow"].every(k => typeof map[k] === "number")) {
    const s = sat / 100, l = light / 100, a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + state.hue / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const rgb = [f(0), f(8), f(4)], max = Math.max(...rgb) || 1;
    state.cyan = Math.round((1 - rgb[0] / max) * 255);
    state.magenta = Math.round((1 - rgb[1] / max) * 255);
    state.yellow = Math.round((1 - rgb[2] / max) * 255);
  }
}
// Where a fixture sits in the effect's order, 0-1.
function fxPosition(index, count, order) {
  const t = count > 1 ? index / (count - 1) : 0;
  if (order === "reverse") return 1 - t;
  if (order === "centre") return Math.abs(t - 0.5) * 2;
  return t;
}
function fxSetPanTilt(state, pan, tilt) {
  const word = v => Math.round(Math.max(0, Math.min(255, v)) * 256) / 256;
  const p = word(pan), t = word(tilt);
  state.pan = Math.floor(p); state.panf = Math.round((p - Math.floor(p)) * 255);
  state.tilt = Math.floor(t); state.tiltf = Math.round((t - Math.floor(t)) * 255);
}
const fxWave01 = x => (Math.sin(x * Math.PI * 2 - Math.PI / 2) + 1) / 2; // 0 → 1 → 0 over one cycle

// name: [which fixtures, frame(state, fixture, ctx)]. ctx: t (seconds),
// speed, phase (0-1 position x spread), index, count, o (options), base.
const FX_TYPES = {
  // ---- intensity
  sparkle: ["all", (st, f, c) => { const k = Math.floor(c.t * c.speed * 8); st.intensity = fxApplyIntensity(fxRandom(c.index + 1, k) < (c.o.density ?? 0.25) ? 100 : 0); }],
  flicker: ["all", (st, f, c) => { const k = c.t * c.speed * 12; const n = fxRandom(c.index + 1, Math.floor(k)) * 0.6 + fxRandom(c.index + 7, Math.floor(k * 2.3)) * 0.4; st.intensity = fxApplyIntensity(55 + n * 45); }],
  bounce: ["all", (st, f, c) => { const span = Math.max(1, c.count - 1); const p = (c.t * c.speed) % (span * 2); const at = p <= span ? p : span * 2 - p; st.intensity = fxApplyIntensity(Math.max(0, 100 - Math.abs(c.index - at) * 100)); }],
  build: ["all", (st, f, c) => { const step = Math.floor(c.t * c.speed) % (c.count + 1); st.intensity = fxApplyIntensity(c.order < step ? 100 : 0); }],
  ramp: ["all", (st, f, c) => { const x = (c.t * c.speed + c.phase) % 1; st.intensity = fxApplyIntensity((c.o.direction === "down" ? 1 - x : x) * 100); }],
  sine: ["all", (st, f, c) => { const lo = c.o.min ?? 0; st.intensity = fxApplyIntensity(lo + fxWave01(c.t * c.speed + c.phase) * (100 - lo)); }],
  random: ["all", (st, f, c) => { st.intensity = fxApplyIntensity(Math.round(fxRandom(c.index + 3, Math.floor(c.t * c.speed)) * 100)); }],
  heartbeat: ["all", (st, f, c) => { const x = (c.t * c.speed + c.phase) % 1; const beat = Math.exp(-Math.pow((x - 0.1) / 0.05, 2)) + 0.7 * Math.exp(-Math.pow((x - 0.32) / 0.05, 2)); st.intensity = fxApplyIntensity(8 + Math.min(1, beat) * 92); }],
  alternate: ["all", (st, f, c) => { const on = (Math.floor(c.t * c.speed) + c.index) % 2 === 0; st.intensity = fxApplyIntensity(on ? 100 : 0); }],
  lightning: ["all", (st, f, c) => { const k = Math.floor(c.t * 20); const strike = fxRandom(Math.floor(c.t * c.speed), 9) < 0.35 && fxRandom(k, c.index + 1) < 0.5 && (k % 7) < 3; st.intensity = fxApplyIntensity(strike ? 100 : 0); if (fxCanColour(f)) fxSetColour(f, st, 220, 25, 90); }],
  // ---- colour (keeps the light up)
  colourfade: ["colour", (st, f, c) => { const hues = c.o.colours?.length ? c.o.colours : [0, 240]; const x = (c.t * c.speed + c.phase) * hues.length; const i = Math.floor(x), m = x - i; const a = hues[i % hues.length], b = hues[(i + 1) % hues.length]; let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; const blend = (1 - Math.cos(m * Math.PI)) / 2; fxSetColour(f, st, a + d * blend); st.intensity = fxGetLiveIntensity(); }],
  colourstep: ["colour", (st, f, c) => { const hues = c.o.colours?.length ? c.o.colours : [0, 120, 240]; const i = Math.floor(c.t * c.speed + c.phase * hues.length); fxSetColour(f, st, hues[((i % hues.length) + hues.length) % hues.length]); st.intensity = fxGetLiveIntensity(); }],
  fire: ["colour", (st, f, c) => { const k = c.t * c.speed * 10; const n = fxRandom(c.index + 1, Math.floor(k)) * 0.5 + fxRandom(c.index + 5, Math.floor(k * 1.7)) * 0.5; fxSetColour(f, st, 4 + n * 30); st.intensity = fxApplyIntensity(50 + n * 50); }],
  water: ["colour", (st, f, c) => { const w = fxWave01(c.t * c.speed + c.phase); fxSetColour(f, st, 185 + w * 50, 100, 45 + w * 15); st.intensity = fxApplyIntensity(55 + w * 45); }],
  police: ["colour", (st, f, c) => { const flash = Math.floor(c.t * c.speed * 6) % 6; const half = c.index < c.count / 2; const redTurn = Math.floor(c.t * c.speed) % 2 === 0; fxSetColour(f, st, half ? 0 : 230); st.intensity = fxApplyIntensity(half === redTurn && flash % 2 === 0 && flash < 4 ? 100 : 0); }],
  disco: ["colour", (st, f, c) => { const k = Math.floor(c.t * c.speed); fxSetColour(f, st, Math.floor(fxRandom(c.index + 1, k) * 12) * 30); st.intensity = fxGetLiveIntensity(); }],
  // ---- movement (around where each head was when the effect started)
  circle: ["move", (st, f, c) => { const a = (c.t * c.speed + c.phase) * Math.PI * 2 * (c.o.direction === "reverse" ? -1 : 1); const r = c.o.size ?? 12; fxSetPanTilt(st, c.base.pan + Math.cos(a) * r, c.base.tilt + Math.sin(a) * r); fxKeepLit(st); }],
  figure8: ["move", (st, f, c) => { const a = (c.t * c.speed + c.phase) * Math.PI * 2; const r = c.o.size ?? 14; fxSetPanTilt(st, c.base.pan + Math.sin(a) * r, c.base.tilt + Math.sin(a * 2) * r * 0.5); fxKeepLit(st); }],
  pansweep: ["move", (st, f, c) => { const r = c.o.size ?? 20; fxSetPanTilt(st, c.base.pan + Math.sin((c.t * c.speed + c.phase) * Math.PI * 2) * r, c.base.tilt); fxKeepLit(st); }],
  tiltsweep: ["move", (st, f, c) => { const r = c.o.size ?? 15; fxSetPanTilt(st, c.base.pan, c.base.tilt + Math.sin((c.t * c.speed + c.phase) * Math.PI * 2) * r); fxKeepLit(st); }],
  ballyhoo: ["move", (st, f, c) => { const x = c.t * c.speed + c.phase; const r = c.o.size ?? 22; fxSetPanTilt(st, c.base.pan + Math.sin(x * Math.PI * 2) * r, c.base.tilt + Math.sin(x * Math.PI * 2 * 1.37 + 1) * r * 0.6); fxKeepLit(st); }],
  fan: ["move", (st, f, c) => { const r = c.o.size ?? 18; const side = c.count > 1 ? (c.index / (c.count - 1)) * 2 - 1 : 0; fxSetPanTilt(st, c.base.pan + side * r * fxWave01(c.t * c.speed), c.base.tilt); fxKeepLit(st); }],
  search: ["move", (st, f, c) => { const k = c.t * c.speed; const i = Math.floor(k), m = (1 - Math.cos((k - i) * Math.PI)) / 2; const r = c.o.size ?? 25; const p = n => (fxRandom(c.index + 1, n) - 0.5) * 2 * r, q = n => (fxRandom(c.index + 11, n) - 0.5) * r; fxSetPanTilt(st, c.base.pan + p(i) + (p(i + 1) - p(i)) * m, c.base.tilt + q(i) + (q(i + 1) - q(i)) * m); fxKeepLit(st); }],
  // ---- beam
  zoompulse: ["zoom", (st, f, c) => { st.zoom = Math.round(fxWave01(c.t * c.speed + c.phase) * 255); }],
  irispulse: ["iris", (st, f, c) => { st.iris = Math.round(fxWave01(c.t * c.speed + c.phase) * 200); }]
};
// Movement effects bring a dark head up so you can see it move.
function fxKeepLit(state) { if (!(Number(state.intensity) > 0)) state.intensity = fxGetLiveIntensity(); }

function startTypedEffect(type, options = {}) {
  const [needs, frame] = FX_TYPES[type];
  const filter = needs === "colour" ? fxCanColour : needs === "move" ? fxCanMove
    : needs === "zoom" ? (f => typeof fxDefinitionMap(f).zoom === "number")
    : needs === "iris" ? (f => typeof fxDefinitionMap(f).iris === "number") : null;
  const base = new Map();
  return fxStart(type, options, (now, elapsed, fixtures) => {
    const speed = Math.max(0.01, fxNumber(options.speed, 1));
    const spread = Math.max(0, Math.min(1, fxNumber(options.spread, 0)));
    const count = fixtures.length;
    // For "build": the order fixtures come on in.
    const ranked = fixtures.map((f, i) => [i, fxPosition(i, count, options.order)]).sort((a, b) => a[1] - b[1]).map(([i]) => i);
    fixtures.forEach((fixture, index) => {
      const state = fxGetState(fixture); if (!state) return;
      if (!base.has(fixture.id)) base.set(fixture.id, { pan: fxNumber(state.pan, 128) + fxNumber(state.panf, 0) / 256, tilt: fxNumber(state.tilt, 128) + fxNumber(state.tiltf, 0) / 256 });
      state.master = 100;
      frame(state, fixture, { t: elapsed, speed, phase: fxPosition(index, count, options.order) * spread, index, count, order: ranked.indexOf(index), o: options, base: base.get(fixture.id) });
    });
  }, filter);
}

function startEffect(type, options = {}) {
  switch (type) {
    case "rainbow": return startRainbow(options);
    case "strobe": return startStrobe(options);
    case "pulse": return startPulse(options);
    case "chase": return startChaseEffect(options);
    case "wave": return startWave(options);
    default:
      if (FX_TYPES[type]) return startTypedEffect(type, options);
      fxLog(`Unknown effect: ${type}`, "warn"); return false;
  }
}
async function createCustomEffect() {
  const answer = await window.LXAsk("Run an effect", [{ key: "type", label: "Effect type (rainbow, strobe, pulse, chase, wave, sine, fire…)", value: "rainbow" }, { key: "speed", label: "Speed", value: 1, type: "number", step: 0.1 }], { ok: "Run" });
  if (!answer) return false;
  const clean = String(answer.type).trim().toLowerCase();
  if (!["rainbow","strobe","pulse","chase","wave", ...Object.keys(FX_TYPES)].includes(clean)) { fxLog("Unknown custom effect", "warn"); return false; }
  const speed = Number(answer.speed);
  return startEffect(clean, { speed: Number.isFinite(speed) && speed > 0 ? speed : 1 });
}
function startCueEffect(effect) {
  if (!effect || !effect.type) { stopEffect(true); return; }
  State.pendingCueEffect = { ...effect };
  startEffect(effect.type, effect);
}
function attachEffectToCue(cueIndex, effectType, options = {}) {
  if (!State.cues || !State.cues[cueIndex]) return;
  State.cues[cueIndex].effect = { type: effectType, ...options };
  fxLog(`✅ Effect "${effectType}" attached to Cue ${cueIndex + 1}`, "ok");
}

function saveEffect(name, type, options = {}) {
  const targetInfo = fxCaptureEffectTargets(options);
  const effect = { name: String(name || "Unnamed Effect"), type, speed: fxNumber(options.speed, 1), fixtureMode: targetInfo.fixtureMode, fixtureIds: targetInfo.fixtureIds.slice() };
  State.savedEffects[effect.name] = effect;
  return { ...effect, fixtureIds: effect.fixtureIds.slice() };
}
function applySavedEffect(name, fixtureIds = null) {
  const effect = State.savedEffects && State.savedEffects[name];
  if (!effect) { fxLog(`Effect not found: ${name}`, "warn"); return false; }
  const ids = fixtureIds == null ? effect.fixtureIds : fxNormaliseIds(fixtureIds);
  return startEffect(effect.type, { ...effect, fixtureMode: "custom", fixtureIds: ids });
}
function applyEffectToFixtures(nameOrEffect, fixtureIds) {
  const effect = typeof nameOrEffect === "string" ? State.savedEffects[nameOrEffect] : nameOrEffect;
  if (!effect) return false;
  return startEffect(effect.type, { ...effect, fixtureMode: "custom", fixtureIds: fxNormaliseIds(fixtureIds) });
}

function renderEffectsList() {
  const list = document.getElementById("effectsList");
  if (!list) return;
  const effects = Object.values(State.savedEffects || {});
  list.innerHTML = "";
  if (!effects.length) {
    list.innerHTML = '<div class="empty-state">No saved effects.</div>';
    return;
  }
  effects.forEach(effect => {
    const card = document.createElement("div");
    card.className = "effect-card";
    card.dataset.effectName = effect.name;
    card.dataset.effect = effect.type;
    card.style.cursor = "pointer";
    card.innerHTML = `<strong>${String(effect.name).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}</strong><small>${effect.type} · ${effect.speed} speed · ${effect.fixtureIds?.length || 0} fixture${effect.fixtureIds?.length === 1 ? "" : "s"}</small>`;
    card.addEventListener("click", () => {
      const name = card.dataset.effectName;
      const nameEl = document.getElementById("effectName");
      const typeEl = document.getElementById("effectType");
      const speedEl = document.getElementById("effectSpeed");
      const modeEl = document.getElementById("effectFixtureMode");
      const saved = State.savedEffects[name];
      if (!saved) return;
      if (nameEl) nameEl.value = saved.name;
      if (typeEl) typeEl.value = saved.type;
      if (speedEl) speedEl.value = saved.speed;
      if (modeEl) modeEl.value = saved.fixtureMode || "selected";
      State.effectTargetIds = new Set(saved.fixtureIds || []);
      document.getElementById("effectEditor")?.style && (document.getElementById("effectEditor").style.display = "block");
      fxRenderEffectTargetUI();
    });
    list.appendChild(card);
  });
  wireEffectButtons();
}

function wireEffectButtons() {
  const newBtn = document.getElementById("btnNewEffect");
  const runBtn = document.getElementById("btnRunEffect");
  const stopBtn = document.getElementById("btnStopEffect");
  const applyBtn = document.getElementById("btnApplyEffect");
  const deleteBtn = document.getElementById("btnDeleteEffect");
  const editor = document.getElementById("effectEditor");

  if (newBtn && newBtn.dataset.fxWired !== "true") {
    newBtn.dataset.fxWired = "true";
    newBtn.type = "button";
    newBtn.addEventListener("click", () => {
      if (editor) editor.style.display = "block";
      const n = Object.keys(State.savedEffects || {}).length + 1;
      document.getElementById("effectName")?.focus();
      const name = document.getElementById("effectName");
      const type = document.getElementById("effectType");
      const speed = document.getElementById("effectSpeed");
      const mode = document.getElementById("effectFixtureMode");
      if (name && !name.value.trim()) name.value = `Effect ${n}`;
      if (type && !type.value) type.value = "rainbow";
      if (speed && !speed.value) speed.value = "1";
      if (mode && !mode.value) mode.value = "selected";
      State.effectTargetMode = mode?.value || "selected";
      if (State.effectTargetMode === "selected") State.effectTargetIds = new Set(fxNormaliseIds(State.selected));
      fxRenderEffectTargetUI();
      fxLog("New effect editor opened", "ok");
    });
  }

  if (runBtn && runBtn.dataset.fxWired !== "true") {
    runBtn.dataset.fxWired = "true";
    runBtn.type = "button";
    runBtn.addEventListener("click", () => {
      const name = document.getElementById("effectName")?.value.trim();
      const selectedSaved = name && State.savedEffects?.[name] ? State.savedEffects[name] : null;
      if (selectedSaved) {
        applySavedEffect(selectedSaved.name);
        return;
      }
      const type = document.getElementById("effectType")?.value || "rainbow";
      const speed = Number(document.getElementById("effectSpeed")?.value || 1);
      startEffect(type, { speed, fixtureMode: document.getElementById("effectFixtureMode")?.value || "selected" });
    });
  }

  if (stopBtn && stopBtn.dataset.fxWired !== "true") {
    stopBtn.dataset.fxWired = "true";
    stopBtn.type = "button";
    stopBtn.addEventListener("click", () => stopEffect(false));
  }

  if (applyBtn && applyBtn.dataset.fxWired !== "true") {
    applyBtn.dataset.fxWired = "true";
    applyBtn.type = "button";
    applyBtn.addEventListener("click", () => {
      const name = document.getElementById("effectName")?.value.trim();
      if (name && State.savedEffects?.[name]) return applySavedEffect(name);
      const type = document.getElementById("effectType")?.value || "rainbow";
      const speed = Number(document.getElementById("effectSpeed")?.value || 1);
      startEffect(type, { speed, fixtureMode: document.getElementById("effectFixtureMode")?.value || "selected" });
    });
  }

  if (deleteBtn && deleteBtn.dataset.fxWired !== "true") {
    deleteBtn.dataset.fxWired = "true";
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", () => {
      const name = document.getElementById("effectName")?.value.trim();
      if (!name || !State.savedEffects?.[name]) return fxLog("Select a saved effect to delete", "warn");
      delete State.savedEffects[name];
      if (State.activeEffect?.name === name) stopEffect(true);
      renderEffectsList();
      document.getElementById("effectEditor")?.style && (document.getElementById("effectEditor").style.display = "none");
      fxLog(`Deleted effect: ${name}`, "ok");
    });
  }
}

function wireEffectEditor() {
  fxWireEffectTargetUI();
  const save = document.getElementById("btnSaveEffect");
  if (save && save.dataset.fxSaveWired !== "true") {
    save.dataset.fxSaveWired = "true";
    save.type = "button";
    save.addEventListener("click", () => {
      const nameEl = document.getElementById("effectName"), typeEl = document.getElementById("effectType"), speedEl = document.getElementById("effectSpeed");
      if (!nameEl || !typeEl || !speedEl) return;
      const name = nameEl.value.trim() || `Effect ${Object.keys(State.savedEffects || {}).length + 1}`;
      const saved = saveEffect(name, typeEl.value, { speed: Number(speedEl.value), fixtureMode: document.getElementById("effectFixtureMode")?.value || "selected" });
      renderEffectsList();
      fxLog(`💾 Saved "${saved.name}" for ${saved.fixtureIds.length} fixture${saved.fixtureIds.length === 1 ? "" : "s"}`, "ok");
    });
  }
}
function wireLiveIntensityControl() {
  const slider = document.getElementById("intensity");
  if (!slider || slider.dataset.liveEffectIntensityWired === "true") return;
  slider.dataset.liveEffectIntensityWired = "true";
  const handle = () => {
    const value = fxClamp(slider.value);
    State.current = State.current || {};
    State.current.intensity = value;
    State.effectIntensity = value;
    const label = document.getElementById("intensityVal") || document.getElementById("intVal");
    if (label) label.textContent = String(Math.round(value));
    fxUpdateOutput();
  };
  slider.addEventListener("input", handle);
  slider.addEventListener("change", handle);
  State.current = State.current || {};
  State.current.intensity = fxClamp(slider.value);
  State.effectIntensity = State.current.intensity;
}
function initEffects() {
  wireEffectButtons();
  wireEffectEditor();
  wireLiveIntensityControl();
  renderEffectsList();
}

Object.assign(window, {
  startEffect, stopEffect, startRainbow, startStrobe, startPulse, startChaseEffect, startWave,
  createCustomEffect, startCueEffect, fxGetFixtureDefinition, attachEffectToCue,
  setIntensity, fxApplyIntensity, fxGetLiveIntensity,
  fxGetFixtures, fxSetEffectTargets, fxCaptureEffectTargets, saveEffect, applySavedEffect, applyEffectToFixtures,
  renderEffectsList, FX_TYPES
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEffects, { once: true });
else initEffects();