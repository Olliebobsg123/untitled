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
  const fixtures = fxGetFixtures(targetInfo).filter(filter || (() => true));
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
function startEffect(type, options = {}) {
  switch (type) {
    case "rainbow": return startRainbow(options);
    case "strobe": return startStrobe(options);
    case "pulse": return startPulse(options);
    case "chase": return startChaseEffect(options);
    case "wave": return startWave(options);
    default: fxLog(`Unknown effect: ${type}`, "warn"); return false;
  }
}
function createCustomEffect() {
  const type = prompt("Effect type:\n\nrainbow\nstrobe\npulse\nchase\nwave", "rainbow");
  if (type === null) return false;
  const clean = String(type).trim().toLowerCase();
  if (!["rainbow","strobe","pulse","chase","wave"].includes(clean)) { fxLog("Unknown custom effect", "warn"); return false; }
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
  renderEffectsList
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEffects, { once: true });
else initEffects();