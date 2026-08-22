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

/*
 * Effect targeting:
 * - selected = current console selection
 * - all = every patched fixture
 * - custom = exactly the fixture IDs chosen in the effect editor
 *
 * The target is captured when the effect starts/saves, so changing the
 * normal fixture selection later does not unexpectedly move a running effect.
 */
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
  if (State.effectFrame !== null) { cancelAnimationFrame(State.effectFrame); State.effectFrame = null; }
  const previous = State.activeEffect;
  State.activeEffect = null;
  if (!silent && previous) fxLog(`■ Effect stopped: ${previous.type}`, "ok");
}
function fxStart(type, options, renderFrame, filter) {
  stopEffect(true);
  const targetInfo = fxCaptureEffectTargets(options);
  const fixtures = fxGetFixtures(targetInfo).filter(filter || (() => true));
  if (!fixtures.length) { fxLog("No fixtures selected for this effect", "warn"); return false; }
  const speed = Math.max(type === "strobe" ? 1 : 0.05, fxNumber(options.speed, type === "strobe" ? 8 : 1));
  State.activeEffect = { type, speed, fixtureMode: targetInfo.fixtureMode, fixtureIds: targetInfo.fixtureIds.slice() };
  const started = performance.now();
  function frame(now) {
    if (!State.activeEffect || State.activeEffect.type !== type) return;
    renderFrame(now, (now - started) / 1000, fixtures);
    fxUpdateOutput();
    State.effectFrame = requestAnimationFrame(frame);
  }
  State.effectFrame = requestAnimationFrame(frame);
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
function startChase(options = {}) {
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

function startEffect(type, options = {}) {
  switch (type) {
    case "rainbow": return startRainbow(options);
    case "strobe": return startStrobe(options);
    case "pulse": return startPulse(options);
    case "chase": return startChase(options);
    case "wave": return startWave(options);
    default: fxLog(`Unknown effect: ${type}`, "warn"); return false;
  }
}
function createCustomEffect() {
  const type = prompt("Effect type:\n\nrainbow\nstrobe\npulse\nchase\nwave", "rainbow");
  if (type === null) return false;
  const clean = String(type).trim().toLowerCase();
  if (!["rainbow", "strobe", "pulse", "chase", "wave"].includes(clean)) { fxLog("Unknown custom effect", "warn"); return false; }
  const speed = Number(prompt("Speed:", clean === "strobe" ? "8" : "1"));
  return startEffect(clean, { speed: Number.isFinite(speed) ? speed : 1 });
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

/* Save/apply API. A saved effect remembers its own target set. */
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

function wireEffectButtons() {
  document.querySelectorAll(".effect-card").forEach(card => {
    if (card.dataset.effectsWired === "true") return;
    card.dataset.effectsWired = "true";
    let type = card.dataset.effect;
    if (!["strobe","pulse","chase","rainbow","wave"].includes(type)) {
      const text = card.textContent.toLowerCase();
      type = text.includes("strobe") ? "strobe" : text.includes("pulse") ? "pulse" : text.includes("chase") ? "chase" : text.includes("wave") ? "wave" : "rainbow";
      card.dataset.effect = type;
    }
    card.addEventListener("click", () => startEffect(type));
  });
}

function wireEffectEditor() {
  fxWireEffectTargetUI();
  const save = document.getElementById("btnSaveEffect");
  if (save && save.dataset.fxSaveWired !== "true") {
    save.dataset.fxSaveWired = "true";
    save.addEventListener("click", () => {
      const nameEl = document.getElementById("effectName"), typeEl = document.getElementById("effectType"), speedEl = document.getElementById("effectSpeed");
      if (!nameEl || !typeEl || !speedEl) return;
      const saved = saveEffect(nameEl.value.trim() || "Unnamed Effect", typeEl.value, { speed: Number(speedEl.value) });
      const list = document.getElementById("effectsList");
      const cards = list ? list.querySelectorAll(".effect-card") : [];
      const card = cards.length ? cards[cards.length - 1] : null;
      if (card) card.onclick = () => applySavedEffect(saved.name);
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
}

Object.assign(window, {
  startEffect, stopEffect, startRainbow, startStrobe, startPulse, startChase, startWave,
  createCustomEffect, startCueEffect, fxGetFixtureDefinition, attachEffectToCue,
  setIntensity, fxApplyIntensity, fxGetLiveIntensity,
  fxGetFixtures, fxSetEffectTargets, fxCaptureEffectTargets, saveEffect, applySavedEffect, applyEffectToFixtures
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEffects, { once: true });
else initEffects();
