"use strict";

(function initialiseChases() {
  const state = () => window.State;
  const log = (message, type) => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(message);
  };
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const clone = value => {
    if (!value || typeof value !== "object") return {};
    if (typeof window.cloneFixtureState === "function") {
      try { return window.cloneFixtureState(value); } catch (_) {}
    }
    return { ...value };
  };

  let selectedChase = -1;
  let controlsInstalled = false;

  function getCueFixtureState(cue, fixtureId) {
    const wanted = String(fixtureId);
    const saved = cue?.fixtureStates;
    if (saved instanceof Map) {
      for (const [id, value] of saved.entries()) {
        if (String(id) === wanted && value && typeof value === "object") return clone(value);
      }
    }
    if (Array.isArray(saved)) {
      const entry = saved.find(item => Array.isArray(item) && item.length >= 2 && String(item[0]) === wanted);
      if (entry?.[1] && typeof entry[1] === "object") return clone(entry[1]);
    }
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const value = saved[fixtureId] ?? saved[wanted];
      if (value && typeof value === "object") return clone(value);
    }
    if (cue?.fixtures && typeof cue.fixtures === "object") {
      const value = cue.fixtures[fixtureId] ?? cue.fixtures[wanted];
      if (value && typeof value === "object") return clone(value);
    }
    return null;
  }

  function buildCueTarget(s, cue) {
    // A cue must win over the previous chase step. Otherwise missing/default
    // values from the previous look can make every step appear white.
    const cueGlobal = cue?.globalState || cue?.state || {};
    const globalState = {
      ...(window.DEFAULT_FIXTURE_STATE || {}),
      ...(s.current || {}),
      ...(cueGlobal || {})
    };
    const fixtureTargets = new Map();
    (Array.isArray(s.fixtures) ? s.fixtures : []).forEach(fixture => {
      if (!fixture || fixture.id == null) return;
      const existing = s.fixtureStates instanceof Map ? (s.fixtureStates.get(fixture.id) || {}) : {};
      const specific = getCueFixtureState(cue, fixture.id);
      fixtureTargets.set(fixture.id, {
        ...(window.DEFAULT_FIXTURE_STATE || {}),
        ...existing,
        ...globalState,
        ...(specific || {})
      });
    });
    return { globalState, fixtureTargets };
  }

  function pushOutput() {
    window.updateDMX?.();
    window.sendToVisualizer?.();
  }

  function applyTarget(s, target) {
    s.current ||= {};
    Object.assign(s.current, target.globalState);
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    target.fixtureTargets.forEach((fixtureState, id) => s.fixtureStates.set(id, fixtureState));
    pushOutput();
  }

  function fadeToTarget(s, target, duration, finished) {
    const ms = Math.max(0, num(duration, 0));
    if (s.chaseFading) cancelAnimationFrame(s.chaseFading);
    s.chaseFading = null;
    if (ms <= 0) {
      applyTarget(s, target);
      finished?.();
      return;
    }
    const fromGlobal = { ...(s.current || {}) };
    const fromFixtures = new Map();
    if (s.fixtureStates instanceof Map) s.fixtureStates.forEach((value, id) => fromFixtures.set(id, clone(value)));
    const start = performance.now();
    const frame = now => {
      if (s.currentChase < 0) return;
      const raw = Math.min(1, Math.max(0, (now - start) / ms));
      const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      const global = {};
      const keys = new Set([...Object.keys(fromGlobal), ...Object.keys(target.globalState || {})]);
      keys.forEach(key => {
        const a = fromGlobal[key], b = target.globalState?.[key];
        global[key] = typeof a === "number" || typeof b === "number"
          ? num(a) + (num(b) - num(a)) * t
          : (raw < 1 ? (a ?? b) : (b ?? a));
      });
      Object.assign(s.current, global);
      if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
      target.fixtureTargets.forEach((toState, id) => {
        const fromState = fromFixtures.get(id) || {};
        const result = {};
        const keys = new Set([...Object.keys(fromState), ...Object.keys(toState || {})]);
        keys.forEach(key => {
          const a = fromState[key], b = toState?.[key];
          result[key] = typeof a === "number" || typeof b === "number"
            ? num(a) + (num(b) - num(a)) * t
            : (raw < 1 ? (a ?? b) : (b ?? a));
        });
        s.fixtureStates.set(id, result);
      });
      pushOutput();
      if (raw >= 1) {
        s.chaseFading = null;
        applyTarget(s, target);
        finished?.();
        return;
      }
      s.chaseFading = requestAnimationFrame(frame);
    };
    s.chaseFading = requestAnimationFrame(frame);
  }

  function startCueEffect(cue) {
    window.stopEffect?.(true);
    if (!cue?.effect?.type || typeof window.startEffect !== "function") return;
    const saved = cue.effect;
    const effect = { type: String(saved.type), speed: num(saved.speed, 1), fixtureMode: saved.fixtureMode || "selected" };
    if (Array.isArray(saved.fixtureIds) && saved.fixtureIds.length) {
      effect.fixtureMode = "custom";
      effect.fixtureIds = [...saved.fixtureIds];
    }
    if (saved.name) effect.name = String(saved.name);
    window.startEffect(effect.type, effect);
  }

  window.renderChases = function renderChases() {
    const list = document.getElementById("chaseList");
    const s = state();
    if (!list || !s) return;
    if (!Array.isArray(s.chases)) s.chases = [];
    if (selectedChase >= s.chases.length) selectedChase = -1;
    list.replaceChildren();
    if (!s.chases.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No chases yet. Click New Chase to choose the cues you want.";
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
      const count = Array.isArray(chase.steps) ? chase.steps.length : 0;
      meta.textContent = `${count} cue${count === 1 ? "" : "s"} · ${chase.loop ? "🔁 Loop" : "→ Run once"}`;
      el.append(title, meta);
      el.addEventListener("click", () => {
        selectedChase = index;
        window.renderChases();
        log(`Selected Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
      });
      list.appendChild(el);
    });
  };

  window.startChase = function startChase(index) {
    const s = state();
    if (!s) return false;
    index = Number(index);
    const chase = s.chases?.[index];
    if (!Number.isInteger(index) || !chase || !Array.isArray(chase.steps) || !chase.steps.length) {
      log("Chase has no cues", "warn");
      return false;
    }
    window.stopChase(false);
    s.currentChase = index;
    selectedChase = index;
    let step = 0;
    const runStep = () => {
      if (s.currentChase !== index) return;
      const cueIndex = Number(chase.steps[step]);
      const cue = s.cues?.[cueIndex];
      if (!cue) {
        log(`Chase ${index + 1}: Cue ${cueIndex + 1} is missing`, "warn");
        step++;
        if (step >= chase.steps.length) {
          if (chase.loop) step = 0;
          else { window.stopChase(); return; }
        }
        s.chaseTimer = setTimeout(runStep, Math.max(0, num(s.chaseWait, 0)));
        return;
      }
      const target = buildCueTarget(s, cue);
      const fade = Math.max(0, num(s.chaseFade, 0));
      s.currentCue = cueIndex;
      window.renderCues?.();
      fadeToTarget(s, target, fade, () => {
        if (s.currentChase !== index) return;
        startCueEffect(cue);
        log(`Chase ${index + 1} Step ${step + 1}: Cue ${cueIndex + 1}`);
        step++;
        if (step >= chase.steps.length) {
          if (chase.loop) step = 0;
          else { window.stopChase(); return; }
        }
        const wait = Math.max(0, num(s.chaseWait, 0));
        s.chaseTimer = setTimeout(runStep, Math.max(0, wait - fade));
      });
    };
    runStep();
    window.renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
    return true;
  };

  window.stopChase = function stopChase(writeMessage = true) {
    const s = state();
    if (!s) return;
    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    if (s.chaseFading) cancelAnimationFrame(s.chaseFading);
    s.chaseFading = null;
    s.currentChase = -1;
    if (typeof window.stopEffect === "function") window.stopEffect(true);
    window.renderChases?.();
    if (writeMessage) log("⏹ Chase stopped");
  };

  window.saveChase = function saveChase(name, cueIndices, loop = true) {
    const s = state();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];
    if (!Array.isArray(s.cues)) s.cues = [];
    const steps = [...new Set((Array.isArray(cueIndices) ? cueIndices : [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= 0 && value < s.cues.length && s.cues[value]))];
    if (!steps.length) {
      log("Choose at least one cue for the chase", "warn");
      return false;
    }
    const chaseName = String(name || "").trim() || `Chase ${s.chases.length + 1}`;
    s.chases.push({ name: chaseName, steps, loop: Boolean(loop) });
    selectedChase = s.chases.length - 1;
    window.renderChases();
    log(`✅ Saved Chase: ${chaseName} (${steps.length} cues)`, "ok");
    return true;
  };

  function closeChaseEditor() { document.getElementById("chaseEditorModal")?.remove(); }

  function openChaseEditor() {
    const s = state();
    if (!s || !Array.isArray(s.cues) || !s.cues.length) {
      log("Add at least one cue before creating a chase", "warn");
      return;
    }
    closeChaseEditor();
    const modal = document.createElement("div");
    modal.id = "chaseEditorModal";
    modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;";
    const box = document.createElement("div");
    box.style.cssText = "width:min(620px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;box-shadow:0 20px 70px rgba(0,0,0,.5);";
    const heading = document.createElement("h3"); heading.textContent = "Create Chase"; heading.style.marginTop = "0"; box.appendChild(heading);
    const help = document.createElement("p"); help.textContent = "Choose the cues you want in the chase."; help.style.color = "var(--text-muted,#8b9698)"; box.appendChild(help);
    const nameLabel = document.createElement("label"); nameLabel.textContent = "Chase Name"; nameLabel.style.display = "block";
    const name = document.createElement("input"); name.type = "text"; name.value = `Chase ${(s.chases?.length || 0) + 1}`; name.style.cssText = "display:block;width:100%;box-sizing:border-box;margin:7px 0 16px;padding:10px;";
    nameLabel.appendChild(name); box.appendChild(nameLabel);
    const selected = new Set();
    const cueList = document.createElement("div"); cueList.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:16px;";
    s.cues.forEach((cue, index) => {
      if (!cue) return;
      const row = document.createElement("label"); row.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;";
      const check = document.createElement("input"); check.type = "checkbox"; check.value = String(index);
      check.addEventListener("change", () => check.checked ? selected.add(index) : selected.delete(index));
      const text = document.createElement("span"); text.textContent = `Cue ${index + 1} — ${cue.name || `Cue ${index + 1}`}`;
      row.append(check, text); cueList.appendChild(row);
    });
    box.appendChild(cueList);
    const loopLabel = document.createElement("label"); loopLabel.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:18px;";
    const loop = document.createElement("input"); loop.type = "checkbox"; loop.checked = true; loopLabel.append(loop, document.createTextNode("Loop chase")); box.appendChild(loopLabel);
    const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn-secondary"; cancel.textContent = "Cancel"; cancel.onclick = closeChaseEditor;
    const save = document.createElement("button"); save.type = "button"; save.className = "btn-primary"; save.textContent = "Save Chase";
    save.onclick = () => { const ok = window.saveChase(name.value, [...selected].sort((a, b) => a - b), loop.checked); if (ok) closeChaseEditor(); };
    actions.append(cancel, save); box.appendChild(actions); modal.appendChild(box);
    modal.addEventListener("click", event => { if (event.target === modal) closeChaseEditor(); });
    document.body.appendChild(modal); name.focus();
  }

  function installControls() {
    if (controlsInstalled) return;
    controlsInstalled = true;
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    const speed = document.getElementById("chaseSpeed");
    const speedVal = document.getElementById("chaseSpeedVal");
    save?.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); openChaseEditor(); }, true);
    run?.addEventListener("click", event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const s = state();
      if (!s || selectedChase < 0 || !s.chases?.[selectedChase]) { log("Select a chase first", "warn"); return; }
      window.startChase(selectedChase);
    }, true);
    stop?.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); window.stopChase(); }, true);
    speed?.addEventListener("input", () => {
      const s = state(); if (!s) return;
      const value = num(speed.value, 50);
      if (speedVal) speedVal.textContent = String(value);
      s.chaseWait = Math.max(0, Math.round(1600 - value * 16));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { installControls(); window.renderChases(); }, { once: true });
  } else { installControls(); window.renderChases(); }
  window.addEventListener("load", () => { installControls(); window.renderChases(); }, { once: true });
})();
