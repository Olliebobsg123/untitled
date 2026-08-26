"use strict";

(function initialiseChases() {
  const S = () => window.State;
  const log = (message, type = "info") => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(`[CHASE ${type}]`, message);
  };
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  let selectedChase = -1;
  let chaseRunToken = 0;

  const clone = value => {
    if (!value || typeof value !== "object") return {};
    if (typeof window.cloneFixtureState === "function") return window.cloneFixtureState(value);
    return { ...value };
  };

  function fixtureStateFromCue(cue, fixtureId) {
    if (!cue) return {};
    if (Array.isArray(cue.fixtureStates)) {
      const hit = cue.fixtureStates.find(entry => Array.isArray(entry) && String(entry[0]) === String(fixtureId));
      if (hit?.[1]) return clone(hit[1]);
    }
    return clone(cue.globalState || cue.state || {});
  }

  function renderChases() {
    const list = document.getElementById("chaseList");
    const s = S();
    if (!list || !s) return;
    if (!Array.isArray(s.chases)) s.chases = [];
    list.replaceChildren();
    if (!s.chases.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No chases yet. Click New Chase to choose cues.";
      list.appendChild(empty);
      return;
    }
    s.chases.forEach((chase, index) => {
      if (!chase) return;
      const el = document.createElement("div");
      el.className = `cue-item ${index === selectedChase ? "active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${chase.name || `Chase ${index + 1}`}`;
      const meta = document.createElement("div");
      meta.style.cssText = "font-size:11px;color:var(--text-muted);";
      const mode = chase.mode === "spread" ? "🌈 Per-fixture" : chase.mode === "snapshot" ? "● Snapshot" : "→ Sequence";
      const count = Array.isArray(chase.steps) ? chase.steps.length : 0;
      meta.textContent = `${count} ${chase.mode === "snapshot" ? "snapshot(s)" : "cues"} · ${mode} · ${chase.loop ? "🔁 Loop" : "→ Run once"} · ${num(chase.speed, 50)}% speed · ${num(chase.fade, 0)}ms fade`;
      el.append(title, meta);
      el.onclick = event => {
        event.preventDefault();
        selectedChase = index;
        renderChases();
        log(`Selected Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
      };
      list.appendChild(el);
    });
  }

  function stopChase(message = true) {
    const s = S();
    chaseRunToken++;
    if (!s) return;
    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    s.currentChase = -1;
    if (typeof window.stopCueTimers === "function") window.stopCueTimers();
    else if (typeof window.stopCueFade === "function") window.stopCueFade();
    if (typeof window.stopEffect === "function") window.stopEffect(true);
    renderChases();
    if (message) log("⏹ Chase stopped");
  }

  function debugCue(cueIndex, step, chase) {
    const s = S();
    const cue = s?.cues?.[cueIndex];
    if (!cue) return;
    const g = cue.globalState || cue.state || {};
    log(`CHASE DEBUG ${chase.name}: step ${step + 1}/${chase.steps.length} Cue ${cueIndex + 1} H=${num(g.hue)} S=${num(g.sat)} L=${num(g.light)} I=${num(g.intensity)} M=${num(g.master)}`);
    if (Array.isArray(cue.fixtureStates)) cue.fixtureStates.forEach(([id, state]) => {
      if (state) log(`CHASE DEBUG fixture ${id}: H=${num(state.hue)} S=${num(state.sat)} L=${num(state.light)} I=${num(state.intensity)}`);
    });
  }

  function waitForCueEngine(token, chase, step) {
    const s = S();
    if (!s || token !== chaseRunToken || s.currentChase < 0) return;
    if (s.fading !== null) {
      requestAnimationFrame(() => waitForCueEngine(token, chase, step));
      return;
    }
    let next = step + 1;
    if (next >= chase.steps.length) {
      if (chase.loop) next = 0;
      else return stopChase();
    }
    const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
    const interval = Math.max(50, Math.round(1000 * (100 / speed)));
    s.chaseTimer = setTimeout(() => runSequenceStep(token, chase, next), interval);
  }

  function runSequenceStep(token, chase, step) {
    const s = S();
    if (!s || token !== chaseRunToken || s.currentChase !== chase.__index) return;
    const cueIndex = Number(chase.steps[step]);
    const cue = s.cues?.[cueIndex];
    if (!cue) {
      log(`CHASE ERROR: missing Cue ${cueIndex + 1}`, "error");
      return stopChase(false);
    }
    if (typeof window.goToCue !== "function") {
      log("CHASE ERROR: goToCue() unavailable", "error");
      return stopChase(false);
    }
    debugCue(cueIndex, step, chase);
    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    if (typeof window.stopEffect === "function") window.stopEffect(true);
    const oldFollow = { enabled: cue.followEnabled === true, follow: cue.follow };
    cue.followEnabled = false;
    const fade = Math.max(0, Math.min(60000, num(chase.fade, 0)));
    s.currentCue = cueIndex;
    const ok = window.goToCue(cueIndex, fade);
    if (!ok) {
      cue.followEnabled = oldFollow.enabled;
      cue.follow = oldFollow.follow;
      return stopChase(false);
    }
    log(`CHASE DEBUG output path: goToCue(Cue ${cueIndex + 1}, ${fade}ms)`);
    const restore = () => {
      cue.followEnabled = oldFollow.enabled;
      cue.follow = oldFollow.follow;
    };
    const poll = () => {
      if (token !== chaseRunToken || s.currentChase !== chase.__index) return;
      if (s.fading !== null) return requestAnimationFrame(poll);
      restore();
      waitForCueEngine(token, chase, step);
    };
    poll();
  }

  function applySnapshot(snapshot) {
    const s = S();
    if (!s || !snapshot) return false;
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    if (snapshot.globalState) Object.assign(s.current, clone(snapshot.globalState));
    (snapshot.fixtureStates || []).forEach(([id, state]) => {
      if (id != null && state) s.fixtureStates.set(id, clone(state));
    });
    try { if (typeof window.updateDMX === "function") window.updateDMX(); } catch (e) { console.error("[CHASE] updateDMX failed", e); }
    try { if (typeof window.sendToVisualizer === "function") window.sendToVisualizer(); } catch (e) { console.error("[CHASE] visualizer update failed", e); }
    return true;
  }

  function makeSpreadSnapshot(chase) {
    const s = S();
    const ids = (s?.fixtures || []).map(f => f?.id).filter(id => id != null);
    const cueIndexes = chase.steps.map(Number).filter(i => s.cues?.[i]);
    if (!ids.length || !cueIndexes.length) return null;
    const fixtureStates = ids.map((id, fixtureIndex) => {
      const cueIndex = cueIndexes[fixtureIndex % cueIndexes.length];
      const cue = s.cues[cueIndex];
      const state = fixtureStateFromCue(cue, id);
      return [id, state];
    });
    const firstCue = s.cues[cueIndexes[0]];
    return { globalState: clone(firstCue?.globalState || firstCue?.state || {}), fixtureStates, cueIndexes };
  }

  function runSpreadStep(token, chase, step) {
    const s = S();
    if (!s || token !== chaseRunToken || s.currentChase !== chase.__index) return;
    const snapshot = makeSpreadSnapshot(chase);
    if (!snapshot) {
      log("CHASE ERROR: spread chase needs patched fixtures and at least one cue", "error");
      return stopChase(false);
    }
    const fade = Math.max(0, Math.min(60000, num(chase.fade, 0)));
    log(`🌈 CHASE: applying ${snapshot.cueIndexes.length} cue(s) across ${snapshot.fixtureStates.length} fixture(s)`);
    snapshot.fixtureStates.forEach(([id, state]) => log(`🌈 fixture ${id} ← cue ${snapshot.cueIndexes[chase._fixtureCursor?.get(String(id)) ?? 0] + 1}: H=${num(state.hue)} S=${num(state.sat)} I=${num(state.intensity)}`));
    applySnapshot(snapshot);
    let next = step + 1;
    if (next >= chase.steps.length) {
      if (chase.loop) next = 0;
      else return stopChase();
    }
    const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
    s.chaseTimer = setTimeout(() => runSpreadStep(token, chase, next), Math.max(fade, Math.round(1000 * (100 / speed))));
  }

  function runSnapshotStep(token, chase, step) {
    const s = S();
    if (!s || token !== chaseRunToken || s.currentChase !== chase.__index) return;
    const snapshot = chase.snapshots?.[step];
    if (!snapshot) return stopChase(false);
    applySnapshot(snapshot);
    log(`CHASE SNAPSHOT ${step + 1}/${chase.snapshots.length}: applied ${snapshot.fixtureStates?.length || 0} fixtures`, "ok");
    let next = step + 1;
    if (next >= chase.snapshots.length) {
      if (chase.loop) next = 0;
      else return stopChase();
    }
    const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
    s.chaseTimer = setTimeout(() => runSnapshotStep(token, chase, next), Math.max(num(chase.fade, 0), Math.round(1000 * (100 / speed))));
  }

  function startChase(index) {
    const s = S();
    index = Number(index);
    const chase = s?.chases?.[index];
    if (!s || !Number.isInteger(index) || !chase) {
      log("Choose a chase first", "warn");
      return false;
    }
    const validSteps = Array.isArray(chase.steps) ? chase.steps.filter(i => s.cues?.[Number(i)]) : [];
    if (chase.mode !== "snapshot" && !validSteps.length) {
      log("Chase contains no valid cues", "warn");
      return false;
    }
    if (chase.mode === "snapshot" && !Array.isArray(chase.snapshots)) {
      log("Snapshot chase has no snapshots", "warn");
      return false;
    }
    stopChase(false);
    chaseRunToken++;
    const token = chaseRunToken;
    chase.__index = index;
    chase.steps = validSteps;
    selectedChase = index;
    s.currentChase = index;
    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`} — ${chase.mode || "sequence"}`, "ok");
    if (chase.mode === "snapshot") runSnapshotStep(token, chase, 0);
    else if (chase.mode === "spread") runSpreadStep(token, chase, 0);
    else runSequenceStep(token, chase, 0);
    return true;
  }

  function saveChase(name, cueIndices, loop = true, speed = 50, fadeMs = 0, mode = "sequence") {
    const s = S();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];
    const steps = [];
    for (const value of Array.isArray(cueIndices) ? cueIndices : []) {
      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < (s.cues?.length || 0) && s.cues[index] && !steps.includes(index)) steps.push(index);
    }
    if (!steps.length) {
      log("Choose at least one cue for the chase", "warn");
      return false;
    }
    const chase = {
      name: String(name || `Chase ${s.chases.length + 1}`).trim() || `Chase ${s.chases.length + 1}`,
      steps,
      loop: Boolean(loop),
      speed: Math.max(10, Math.min(100, num(speed, 50))),
      fade: Math.max(0, Math.min(60000, num(fadeMs, 0))),
      mode: mode === "spread" ? "spread" : "sequence"
    };
    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`✅ Saved Chase: ${chase.name} — ${steps.map(i => `Cue ${i + 1}`).join(", ")} — ${chase.mode}`, "ok");
    return true;
  }

  function saveSnapshotChase(name, loop = true, speed = 50, fadeMs = 0) {
    const s = S();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];
    const fixtureStates = [];
    (s.fixtures || []).forEach(fixture => {
      if (!fixture || fixture.id == null) return;
      const state = s.fixtureStates instanceof Map ? s.fixtureStates.get(fixture.id) : null;
      fixtureStates.push([fixture.id, clone(state || s.current || {})]);
    });
    if (!fixtureStates.length) {
      log("Patch at least one fixture before recording a chase", "warn");
      return false;
    }
    const chase = {
      name: String(name || `Chase ${s.chases.length + 1}`).trim() || `Chase ${s.chases.length + 1}`,
      mode: "snapshot",
      snapshots: [{ globalState: clone(s.current || {}), fixtureStates }],
      steps: [],
      loop: Boolean(loop),
      speed: Math.max(10, Math.min(100, num(speed, 50))),
      fade: Math.max(0, Math.min(60000, num(fadeMs, 0)))
    };
    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`💾 Recorded independent chase snapshot: ${chase.name} (${fixtureStates.length} fixtures)`, "ok");
    return true;
  }

  function createChasePicker() {
    const s = S();
    if (!s?.cues?.some(Boolean)) {
      log("Add at least one cue first", "warn");
      return;
    }
    document.getElementById("chasePicker")?.remove();
    const modal = document.createElement("div");
    modal.id = "chasePicker";
    modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px;";
    const box = document.createElement("div");
    box.style.cssText = "width:min(700px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);color:var(--text,#fff);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;box-shadow:0 18px 60px rgba(0,0,0,.55);";
    const heading = document.createElement("h3");
    heading.textContent = "Create Chase";
    heading.style.marginTop = "0";
    box.appendChild(heading);
    const help = document.createElement("p");
    help.textContent = "Sequence = cues one after another. Per-fixture = the selected cues are distributed across the lights simultaneously. Snapshot = records the current look as an independent chase, without using the cue stack.";
    help.style.color = "var(--text-muted,#9aa4aa)";
    box.appendChild(help);
    const name = document.createElement("input");
    name.value = `Chase ${(s.chases?.length || 0) + 1}`;
    name.placeholder = "Chase name";
    name.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0 14px;padding:10px;";
    box.appendChild(name);
    const mode = document.createElement("select");
    mode.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:12px;padding:10px;";
    mode.innerHTML = `<option value="sequence">Sequence — one cue at a time</option><option value="spread">Per-fixture rainbow — different cue on each light</option><option value="snapshot">Snapshot — record current lights independently</option>`;
    box.appendChild(mode);
    const options = document.createElement("div");
    options.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;";
    const speed = document.createElement("input"); speed.type = "range"; speed.min = "10"; speed.max = "100"; speed.value = String(document.getElementById("chaseSpeed")?.value || 50);
    const fade = document.createElement("input"); fade.type = "number"; fade.min = "0"; fade.max = "60000"; fade.step = "50"; fade.value = "0";
    const wrap = (labelText, input) => { const w = document.createElement("label"); w.style.cssText = "display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-muted,#9aa4aa);"; const l = document.createElement("span"); l.textContent = labelText; w.append(l,input); return w; };
    options.append(wrap("CHASE SPEED", speed), wrap("STEP FADE · ms", fade));
    box.appendChild(options);
    const checks = document.createElement("div"); checks.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    s.cues.forEach((cue, i) => {
      if (!cue) return;
      const label = document.createElement("label"); label.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.cue = String(i);
      const text = document.createElement("span"); text.textContent = `Cue ${i + 1} — ${cue.name || `Cue ${i + 1}`}`;
      label.append(cb,text); checks.appendChild(label);
    });
    box.appendChild(checks);
    const loopLabel = document.createElement("label"); loopLabel.style.cssText = "display:flex;gap:8px;margin:14px 0;align-items:center;";
    const loop = document.createElement("input"); loop.type = "checkbox"; loop.checked = true;
    loopLabel.append(loop,document.createTextNode("Loop chase")); box.appendChild(loopLabel);
    const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:16px;";
    const cancel = document.createElement("button"); cancel.className="btn-secondary"; cancel.type="button"; cancel.textContent="Cancel";
    const create = document.createElement("button"); create.className="btn-primary"; create.type="button"; create.textContent="Create Chase";
    actions.append(cancel,create); box.appendChild(actions); modal.appendChild(box); document.body.appendChild(modal);
    const refreshMode = () => { const snapshot = mode.value === "snapshot"; checks.style.display = snapshot ? "none" : "flex"; fade.disabled = snapshot; };
    mode.onchange = refreshMode; refreshMode();
    cancel.onclick = () => modal.remove();
    create.onclick = () => {
      if (mode.value === "snapshot") {
        if (saveSnapshotChase(name.value, loop.checked, Number(speed.value), Number(fade.value))) modal.remove();
        return;
      }
      const selected = [...checks.querySelectorAll("input[data-cue]:checked")].map(input => Number(input.dataset.cue));
      if (!selected.length) { log("Choose at least one cue for the chase", "warn"); return; }
      if (saveChase(name.value, selected, loop.checked, Number(speed.value), Number(fade.value), mode.value)) modal.remove();
    };
    modal.onclick = event => { if (event.target === modal) modal.remove(); };
  }

  function installButtons() {
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    const speed = document.getElementById("chaseSpeed");
    const speedVal = document.getElementById("chaseSpeedVal");
    if (speed && speedVal) { speedVal.textContent = speed.value; speed.oninput = () => speedVal.textContent = speed.value; }
    if (save) { save.type="button"; save.onclick=e=>{e.preventDefault();e.stopPropagation();createChasePicker();}; }
    if (run) { run.type="button"; run.onclick=e=>{e.preventDefault();e.stopPropagation();const s=S();if(selectedChase<0&&s?.chases?.length)selectedChase=s.chases.length-1;if(selectedChase>=0)startChase(selectedChase);else log("Create/select a chase first","warn");}; }
    if (stop) { stop.type="button"; stop.onclick=e=>{e.preventDefault();e.stopPropagation();stopChase();}; }
  }

  window.renderChases = renderChases;
  window.startChase = startChase;
  window.stopChase = stopChase;
  window.saveChase = saveChase;
  window.saveSnapshotChase = saveSnapshotChase;
  window.__installChaseButtons = installButtons;
  window.__chaseDebug = true;

  function init() { installButtons(); renderChases(); setTimeout(installButtons, 0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
  window.addEventListener("load", installButtons, { once: true });
})();
