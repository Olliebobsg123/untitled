"use strict";

(function initialiseChases() {
  const S = () => window.State;
  const log = (message, type = "info") => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(`[CHASE ${type}]`, message);
  };
  const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const clone = v => typeof window.cloneFixtureState === "function"
    ? window.cloneFixtureState(v)
    : { ...(v && typeof v === "object" ? v : {}) };

  let selectedChase = -1;
  let runToken = 0;
  let cueBridgeInstalled = false;

  function fixtures() { return (S()?.fixtures || []).filter(f => f && f.id != null); }

  function selectedFixtureIds() {
    const s = S();
    const all = fixtures();
    const selected = s?.selected instanceof Set ? [...s.selected] : [];
    return selected.length
      ? all.filter(f => selected.some(id => String(id) === String(f.id))).map(f => f.id)
      : all.map(f => f.id);
  }

  function chaseFixtureIds(chase) {
    const all = fixtures();
    if (!Array.isArray(chase?.fixtureIds) || !chase.fixtureIds.length) return all.map(f => f.id);
    return all.filter(f => chase.fixtureIds.some(id => String(id) === String(f.id))).map(f => f.id);
  }

  function cueState(cue, id) {
    if (!cue) return {};
    if (Array.isArray(cue.fixtureStates)) {
      const hit = cue.fixtureStates.find(x => Array.isArray(x) && String(x[0]) === String(id));
      if (hit?.[1]) return clone(hit[1]);
    }
    return clone(cue.globalState || cue.state || {});
  }

  function pushState(globalState, map) {
    const s = S();
    if (!s) return;
    s.current ||= {};
    Object.assign(s.current, clone(globalState || {}));
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    map.forEach((state, id) => s.fixtureStates.set(id, clone(state)));
    try { window.updateDMX?.(); } catch (e) { console.error("[CHASE] DMX", e); }
    try { window.sendToVisualizer?.(); } catch (e) { console.error("[CHASE] visualizer", e); }
  }

  function applyCueToFixtures(cue, fixtureIds) {
    const s = S();
    if (!s || !cue) return false;
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    const allowed = new Set(fixtureIds.map(String));
    const map = new Map();
    fixtures().forEach(f => {
      const existing = s.fixtureStates.get(f.id) || s.current || {};
      map.set(f.id, clone(existing));
    });
    fixtures().forEach(f => {
      if (!allowed.has(String(f.id))) return;
      map.set(f.id, cueState(cue, f.id));
    });
    pushState(cue.globalState || cue.state || {}, map);
    return true;
  }

  function captureLook() {
    const s = S();
    const fixtureStates = fixtures().map(f => [f.id, clone(s.fixtureStates?.get(f.id) || s.current || {})]);
    return { globalState: clone(s.current || {}), fixtureStates };
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return false;
    const map = new Map((snapshot.fixtureStates || []).filter(x => Array.isArray(x) && x.length > 1));
    pushState(snapshot.globalState || {}, map);
    return true;
  }

  function renderChases() {
    const list = document.getElementById("chaseList");
    const s = S();
    if (!list || !s) return;
    s.chases = Array.isArray(s.chases) ? s.chases : [];
    list.replaceChildren();
    if (!s.chases.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No chases yet. Click New Chase to create one.";
      list.appendChild(empty);
      return;
    }
    s.chases.forEach((chase, i) => {
      if (!chase) return;
      const el = document.createElement("div");
      el.className = `cue-item ${i === selectedChase ? "active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${i + 1}. ${chase.name || `Chase ${i + 1}`}`;
      const meta = document.createElement("small");
      const count = chase.mode === "snapshot" ? (chase.snapshots?.length || 0) : (chase.steps?.length || 0);
      const mode = chase.mode === "spread" ? "🌈 Per-fixture" : chase.mode === "snapshot" ? "● Recorded" : "→ Sequence";
      const fxCount = Array.isArray(chase.fixtureIds) && chase.fixtureIds.length ? `${chase.fixtureIds.length} fixture(s)` : "All fixtures";
      meta.textContent = `${count} ${chase.mode === "snapshot" ? "look(s)" : "cue(s)"} · ${mode} · ${fxCount} · ${chase.loop ? "Loop" : "Once"} · ${n(chase.speed, 50)}% · ${n(chase.fade, 0)}ms`;
      el.append(title, meta);
      el.onclick = () => { selectedChase = i; renderChases(); log(`Selected Chase ${i + 1}: ${chase.name || `Chase ${i + 1}`}`); };
      list.appendChild(el);
    });
  }

  function stopChase(message = true) {
    runToken++;
    const s = S();
    if (!s) return;
    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    s.currentChase = -1;
    if (typeof window.stopCueTimers === "function") window.stopCueTimers();
    if (s.fading != null) { LXClock.cancel(s.fading); s.fading = null; }
    renderChases();
    if (message) log("⏹ Chase stopped");
  }

  function schedule(token, chase, fn) {
    const s = S();
    const speed = Math.max(10, Math.min(100, n(chase.speed, 50)));
    const interval = Math.max(50, Math.round(1000 * 100 / speed));
    s.chaseTimer = setTimeout(() => { if (token === runToken && s.currentChase >= 0) fn(); }, Math.max(n(chase.fade, 0), interval));
  }

  function runSequence(token, chase, step) {
    const s = S();
    if (!s || token !== runToken || s.currentChase !== chase.__index) return;
    const cueIndex = Number(chase.steps[step]);
    const cue = s.cues?.[cueIndex];
    if (!cue) return stopChase(false);
    const fade = Math.max(0, Math.min(60000, n(chase.fade, 0)));
    const fixtureIds = chaseFixtureIds(chase);
    console.debug(`CHASE: sequence step ${step + 1}/${chase.steps.length} → Cue ${cueIndex + 1} on ${fixtureIds.length} fixture(s)`);
    if (fade > 0 && typeof window.fadeTo === "function") {
      const target = clone(cue.globalState || cue.state || {});
      const fixtureTargets = fixtureIds.map(id => [id, cueState(cue, id)]);
      window.fadeTo(target, fade, fixtureTargets);
    } else {
      applyCueToFixtures(cue, fixtureIds);
    }
    s.currentCue = cueIndex;

    let next = step + 1;
    if (next >= chase.steps.length) {
      if (!chase.loop) return stopChase();
      next = 0;
    }
    schedule(token, chase, () => runSequence(token, chase, next));
  }

  function runSpread(token, chase, rotation) {
    const s = S();
    const allowed = new Set(chaseFixtureIds(chase).map(String));
    const fs = fixtures().filter(f => allowed.has(String(f.id)));
    const steps = (chase.steps || []).map(Number).filter(i => s?.cues?.[i]);
    if (!s || token !== runToken || s.currentChase !== chase.__index) return;
    if (!fs.length || !steps.length) return stopChase(false);

    const map = new Map();
    fixtures().forEach(f => map.set(f.id, clone(s.fixtureStates?.get(f.id) || s.current || {})));
    fs.forEach((fixture, fixtureIndex) => {
      const cueIndex = steps[(fixtureIndex + rotation) % steps.length];
      const state = cueState(s.cues[cueIndex], fixture.id);
      map.set(fixture.id, state);
      console.debug(`CHASE: fixture ${fixture.id} ← Cue ${cueIndex + 1}`);
    });
    const first = s.cues[steps[rotation % steps.length]];
    pushState(first?.globalState || first?.state || {}, map);
    s.currentCue = steps[rotation % steps.length];

    const next = rotation + 1;
    if (!chase.loop && next >= steps.length) return stopChase();
    schedule(token, chase, () => runSpread(token, chase, next % steps.length));
  }

  function runSnapshot(token, chase, step) {
    const s = S();
    if (!s || token !== runToken || s.currentChase !== chase.__index) return;
    const snapshot = chase.snapshots?.[step];
    if (!snapshot) return stopChase(false);
    const ids = new Set(chaseFixtureIds(chase).map(String));
    const filtered = (snapshot.fixtureStates || []).filter(x => Array.isArray(x) && x.length > 1 && ids.has(String(x[0])));
    applySnapshot({ globalState: snapshot.globalState, fixtureStates: filtered });
    console.debug(`CHASE: recorded look ${step + 1}/${chase.snapshots.length} on ${ids.size} fixture(s)`);
    let next = step + 1;
    if (next >= chase.snapshots.length) {
      if (!chase.loop) return stopChase();
      next = 0;
    }
    schedule(token, chase, () => runSnapshot(token, chase, next));
  }

  function startChase(index) {
    const s = S();
    index = Number(index);
    const chase = s?.chases?.[index];
    if (!s || !Number.isInteger(index) || !chase) { log("Choose a chase first", "warn"); return false; }
    stopChase(false);
    const valid = Array.isArray(chase.steps) ? chase.steps.map(Number).filter(i => s.cues?.[i]) : [];
    if (chase.mode === "snapshot" && !chase.snapshots?.length) { log("Recorded chase has no looks", "warn"); return false; }
    if (chase.mode !== "snapshot" && !valid.length) { log("Chase contains no valid cues", "warn"); return false; }
    chase.steps = valid;
    chase.__index = index;
    selectedChase = index;
    s.currentChase = index;
    runToken++;
    const token = runToken;
    const ids = chaseFixtureIds(chase);
    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`} (${chase.mode || "sequence"}) — ${ids.length} fixture(s)`, "ok");
    if (chase.mode === "snapshot") runSnapshot(token, chase, 0);
    else if (chase.mode === "spread") runSpread(token, chase, 0);
    else runSequence(token, chase, 0);
    return true;
  }

  function saveChase(name, cueIndices, loop = true, speed = 50, fade = 0, mode = "sequence", fixtureIds = null) {
    const s = S();
    if (!s) return false;
    const steps = [...new Set((Array.isArray(cueIndices) ? cueIndices : []).map(Number).filter(i => Number.isInteger(i) && s.cues?.[i]))];
    if (!steps.length) { log("Choose at least one cue for the chase", "warn"); return false; }
    const allIds = fixtures().map(f => f.id);
    const ids = Array.isArray(fixtureIds) && fixtureIds.length
      ? allIds.filter(id => fixtureIds.some(x => String(x) === String(id)))
      : selectedFixtureIds();
    if (!ids.length) { log("Select at least one fixture for the chase", "warn"); return false; }
    const chase = {
      name: String(name || `Chase ${(s.chases?.length || 0) + 1}`).trim(),
      steps, fixtureIds: ids, loop: Boolean(loop), speed: Math.max(10, Math.min(100, n(speed, 50))),
      fade: Math.max(0, Math.min(60000, n(fade, 0))), mode: mode === "spread" ? "spread" : "sequence"
    };
    s.chases = Array.isArray(s.chases) ? s.chases : [];
    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`✅ Saved Chase: ${chase.name} — ${steps.map(i => `Cue ${i + 1}`).join(", ")} — ${ids.length} fixture(s)`, "ok");
    return true;
  }

  function recordSnapshotChase(name, loop = true, speed = 50, fade = 0, fixtureIds = null) {
    const s = S();
    if (!s || !fixtures().length) { log("Patch at least one fixture before recording", "warn"); return false; }
    const ids = Array.isArray(fixtureIds) && fixtureIds.length ? fixtureIds : selectedFixtureIds();
    if (!ids.length) { log("Select at least one fixture for the chase", "warn"); return false; }
    s.chases = Array.isArray(s.chases) ? s.chases : [];
    const all = captureLook();
    const allowed = new Set(ids.map(String));
    all.fixtureStates = all.fixtureStates.filter(x => allowed.has(String(x[0])));
    const chase = {
      name: String(name || `Chase ${s.chases.length + 1}`).trim(), mode: "snapshot", steps: [],
      snapshots: [all], fixtureIds: ids, loop: Boolean(loop), speed: Math.max(10, Math.min(100, n(speed, 50))),
      fade: Math.max(0, Math.min(60000, n(fade, 0)))
    };
    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`💾 Recorded chase look: ${chase.name} — ${ids.length} fixture(s)`, "ok");
    return true;
  }

  function addSnapshotToSelected() {
    const s = S();
    const chase = s?.chases?.[selectedChase];
    if (!chase || chase.mode !== "snapshot") { log("Select a recorded chase first", "warn"); return false; }
    const ids = new Set(chaseFixtureIds(chase).map(String));
    const snapshot = captureLook();
    snapshot.fixtureStates = snapshot.fixtureStates.filter(x => ids.has(String(x[0])));
    chase.snapshots = Array.isArray(chase.snapshots) ? chase.snapshots : [];
    chase.snapshots.push(snapshot);
    renderChases();
    log(`💾 Added look ${chase.snapshots.length} to ${chase.name}`, "ok");
    return true;
  }

  function picker() {
    const s = S();
    if (!s?.cues?.some(Boolean)) { log("Add at least one cue first", "warn"); return; }
    const fs = fixtures();
    if (!fs.length) { log("Patch at least one fixture first", "warn"); return; }
    document.getElementById("chasePicker")?.remove();
    const modal = document.createElement("div");
    modal.id = "chasePicker";
    modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:20px";
    const box = document.createElement("div");
    box.style.cssText = "width:min(760px,96vw);max-height:90vh;overflow:auto;background:#151515;border:1px solid #444;padding:24px;border-radius:10px";
    box.innerHTML = `<h2 style="margin-top:0">Create Chase</h2><p>Select the cues <b>and fixtures</b> this chase should control.</p>`;

    const name = document.createElement("input");
    name.placeholder = "Chase name";
    name.style.cssText = "width:100%;margin-bottom:12px";

    const mode = document.createElement("select");
    mode.style.cssText = "width:100%;margin-bottom:12px";
    mode.innerHTML = `<option value="sequence">Sequence — one cue after another</option><option value="spread">🌈 Per-fixture — different cue/colour on each light</option><option value="snapshot">Recorded looks — independent of cue stack</option>`;

    const fixtureHeading = document.createElement("div");
    fixtureHeading.innerHTML = `<strong>Fixtures</strong> <small style="opacity:.7">(defaults to your currently selected fixtures)</small>`;
    fixtureHeading.style.marginTop = "8px";
    const fixtureList = document.createElement("div");
    fixtureList.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px;margin:8px 0 14px";
    const currentSelected = new Set(selectedFixtureIds().map(String));
    fs.forEach((fixture, i) => {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;gap:8px;align-items:center;padding:9px;background:#202020;border-radius:5px";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = String(fixture.id); cb.checked = currentSelected.has(String(fixture.id));
      label.append(cb, document.createTextNode(fixture.name || `Fixture ${i + 1}`));
      fixtureList.appendChild(label);
    });

    const cueHeading = document.createElement("strong");
    cueHeading.textContent = "Cues";
    const list = document.createElement("div");
    list.style.cssText = "display:grid;gap:6px;margin:8px 0 12px";
    s.cues.forEach((cue, i) => {
      if (!cue) return;
      const label = document.createElement("label");
      label.style.cssText = "display:flex;gap:8px;padding:8px;background:#202020";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = String(i);
      label.append(cb, document.createTextNode(`Cue ${i + 1} — ${cue.name || `Cue ${i + 1}`}`));
      list.appendChild(label);
    });

    const opts = document.createElement("div");
    opts.innerHTML = `<label>Speed <input id="cpSpeed" type="number" min="10" max="100" value="50"></label> <label>Fade ms <input id="cpFade" type="number" min="0" max="60000" value="0"></label> <label><input id="cpLoop" type="checkbox" checked> Loop</label>`;
    const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px;margin-top:16px";
    const save = document.createElement("button"); save.className = "btn-primary"; save.textContent = "Save Chase";
    const cancel = document.createElement("button"); cancel.className = "btn-secondary"; cancel.textContent = "Cancel";

    save.onclick = () => {
      const selectedCues = [...list.querySelectorAll('input[type="checkbox"]:checked')].map(x => Number(x.value));
      const selectedFixtures = [...fixtureList.querySelectorAll('input[type="checkbox"]:checked')].map(x => x.value);
      const speed = Number(opts.querySelector("#cpSpeed").value);
      const fade = Number(opts.querySelector("#cpFade").value);
      const loop = opts.querySelector("#cpLoop").checked;
      if (!selectedFixtures.length) { log("Select at least one fixture for the chase", "warn"); return; }
      let ok;
      if (mode.value === "snapshot") ok = recordSnapshotChase(name.value, loop, speed, fade, selectedFixtures);
      else ok = saveChase(name.value, selectedCues, loop, speed, fade, mode.value, selectedFixtures);
      if (ok) modal.remove();
    };
    cancel.onclick = () => modal.remove();
    actions.append(save, cancel);
    box.append(name, mode, fixtureHeading, fixtureList, cueHeading, list, opts, actions);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function wireButtons() {
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    if (save) save.onclick = e => { e.preventDefault(); picker(); };
    if (run) run.onclick = e => { e.preventDefault(); if (selectedChase >= 0) startChase(selectedChase); else log("Select a chase first", "warn"); };
    if (stop) stop.onclick = e => { e.preventDefault(); stopChase(); };
    const speed = document.getElementById("chaseSpeed");
    const speedVal = document.getElementById("chaseSpeedVal");
    if (speed) speed.oninput = () => { if (speedVal) speedVal.textContent = speed.value; const s = S(); const c = s?.chases?.[selectedChase]; if (c) c.speed = n(speed.value, 50); };
  }

  function installCueBridge() {
    if (cueBridgeInstalled || typeof window.goToCue !== "function") return;
    const original = window.goToCue;
    window.goToCue = function bridgedGoToCue(index, forceFade = null, options = {}) {
      if (options?.fromChase) return original.call(this, index, forceFade);
      const s = S(); const cue = s?.cues?.[Number(index)];
      if (!cue?.chase) return original.call(this, index, forceFade);
      const chaseIndex = Number(cue.chase.index);
      if (!Number.isInteger(chaseIndex) || !s.chases?.[chaseIndex]) {
        log(`Cue ${Number(index) + 1} references missing chase`, "error"); return false;
      }
      log(`Cue ${Number(index) + 1} → starting Chase ${chaseIndex + 1}`);
      return startChase(chaseIndex);
    };
    cueBridgeInstalled = true;
  }

  window.renderChases = renderChases;
  window.startChase = startChase;
  window.stopChase = stopChase;
  window.saveChase = saveChase;
  window.recordSnapshotChase = recordSnapshotChase;
  window.addSnapshotToSelectedChase = addSnapshotToSelected;
  window.recordChaseToCue = function recordChaseToCue(cueNumber, chaseIndex = selectedChase, name = "") {
    const s = S(); const number = Number(cueNumber); const ci = Number(chaseIndex);
    if (!s || !Number.isInteger(number) || number < 1 || !s.chases?.[ci]) return false;
    s.cues = Array.isArray(s.cues) ? s.cues : [];
    const index = number - 1;
    while (s.cues.length <= index) s.cues.push(null);
    const chase = s.chases[ci];
    s.cues[index] = {
      name: String(name || `Chase ${chase.name || ci + 1}`).trim(),
      chase: { index: ci },
      globalState: clone(s.current || {}), state: clone(s.current || {}), fixtureStates: [],
      fade: n(chase.fade, 0), follow: 0, followEnabled: false, effect: null
    };
    window.renderCues?.();
    log(`🔗 Recorded Chase ${ci + 1} into Cue ${number}`, "ok");
    return true;
  };

  document.addEventListener("DOMContentLoaded", () => { wireButtons(); renderChases(); installCueBridge(); });
  window.addEventListener("load", () => { wireButtons(); renderChases(); installCueBridge(); });
})();
