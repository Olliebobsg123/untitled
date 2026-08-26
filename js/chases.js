"use strict";

(function initialiseChases() {
  const state = () => window.State;
  const log = (message, type = "info") => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(message);
  };
  const n = (v, fallback = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
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

  function cueFixtureEntries(cue) {
    const result = [];
    const saved = cue?.fixtureStates;

    if (Array.isArray(saved)) {
      saved.forEach(entry => {
        if (Array.isArray(entry) && entry.length >= 2 && entry[0] != null && entry[1]) {
          result.push([entry[0], clone(entry[1])]);
        }
      });
      return result;
    }

    if (saved instanceof Map) {
      saved.forEach((value, id) => {
        if (id != null && value) result.push([id, clone(value)]);
      });
      return result;
    }

    if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([id, value]) => {
        if (value && typeof value === "object") result.push([id, clone(value)]);
      });
    }

    return result;
  }

  /*
   * IMPORTANT:
   * A chase step must replay the exact snapshot stored in the cue.
   * The old implementation merged State.current and the live fixture state
   * into every step. That meant values left by the previous cue could leak
   * into the next cue, and in particular colour values could fall back to the
   * default white state.
   */
  function makeCueTarget(s, cue) {
    const globalState = clone(cue?.globalState || cue?.state || {});
    const fixtureTargets = new Map();
    const entries = cueFixtureEntries(cue);

    if (entries.length) {
      entries.forEach(([id, fixtureState]) => {
        fixtureTargets.set(id, fixtureState);
      });
    } else {
      // Old cues without a fixture snapshot still work: apply their global
      // look to every currently patched fixture.
      (Array.isArray(s.fixtures) ? s.fixtures : []).forEach(fixture => {
        if (fixture?.id != null) fixtureTargets.set(fixture.id, clone(globalState));
      });
    }

    return { globalState, fixtureTargets };
  }

  function pushLighting() {
    try { window.updateDMX?.(); } catch (e) { console.error("Chase updateDMX failed", e); }
    try { window.sendToVisualizer?.(); } catch (e) { console.error("Chase visualizer update failed", e); }
  }

  function applyTarget(s, target) {
    s.current ||= {};
    Object.assign(s.current, target.globalState || {});
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    target.fixtureTargets.forEach((fixtureState, id) => {
      s.fixtureStates.set(id, clone(fixtureState));
    });
    pushLighting();
  }

  function stopFade(s) {
    if (s.chaseFading) cancelAnimationFrame(s.chaseFading);
    s.chaseFading = null;
  }

  function fadeToTarget(s, target, duration, finished) {
    stopFade(s);
    const ms = Math.max(0, n(duration, 0));
    if (ms === 0) {
      applyTarget(s, target);
      finished?.();
      return;
    }

    const fromGlobal = clone(s.current || {});
    const fromFixtures = new Map();
    if (s.fixtureStates instanceof Map) {
      s.fixtureStates.forEach((value, id) => fromFixtures.set(id, clone(value)));
    }

    const start = performance.now();
    const frame = now => {
      if (s.currentChase < 0) return;
      const raw = Math.min(1, Math.max(0, (now - start) / ms));
      const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;

      const global = {};
      const globalKeys = new Set([
        ...Object.keys(fromGlobal),
        ...Object.keys(target.globalState || {})
      ]);
      globalKeys.forEach(key => {
        const a = fromGlobal[key];
        const b = target.globalState?.[key];
        global[key] = (typeof a === "number" || typeof b === "number")
          ? n(a) + (n(b) - n(a)) * t
          : (raw < 1 ? (a ?? b) : (b ?? a));
      });
      Object.assign(s.current, global);

      if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
      target.fixtureTargets.forEach((toState, id) => {
        const fromState = fromFixtures.get(id) || clone(toState);
        const result = {};
        const keys = new Set([...Object.keys(fromState), ...Object.keys(toState || {})]);
        keys.forEach(key => {
          const a = fromState[key];
          const b = toState?.[key];
          result[key] = (typeof a === "number" || typeof b === "number")
            ? n(a) + (n(b) - n(a)) * t
            : (raw < 1 ? (a ?? b) : (b ?? a));
        });
        s.fixtureStates.set(id, result);
      });

      pushLighting();

      if (raw >= 1) {
        stopFade(s);
        applyTarget(s, target);
        finished?.();
        return;
      }
      s.chaseFading = requestAnimationFrame(frame);
    };

    s.chaseFading = requestAnimationFrame(frame);
  }

  function stopCueEffect() {
    if (typeof window.stopEffect === "function") window.stopEffect(true);
  }

  function startCueEffect(cue) {
    stopCueEffect();
    if (!cue?.effect?.type || typeof window.startEffect !== "function") return;
    const saved = cue.effect;
    const effect = {
      type: String(saved.type),
      speed: n(saved.speed, 1),
      fixtureMode: saved.fixtureMode || "selected"
    };
    if (Array.isArray(saved.fixtureIds) && saved.fixtureIds.length) {
      effect.fixtureMode = "custom";
      effect.fixtureIds = saved.fixtureIds.map(String);
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
        renderChases();
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
      log("Choose a chase containing at least one cue", "warn");
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
        advance();
        return;
      }

      const target = makeCueTarget(s, cue);
      const fade = Math.max(0, n(chase.fade, n(s.chaseFade, n(cue.fade, 0))));
      s.currentCue = cueIndex;
      window.renderCues?.();

      fadeToTarget(s, target, fade, () => {
        if (s.currentChase !== index) return;
        startCueEffect(cue);
        log(`Chase ${index + 1} Step ${step + 1}: Cue ${cueIndex + 1}`);
        advance();
      });
    };

    const advance = () => {
      if (s.currentChase !== index) return;
      step += 1;
      if (step >= chase.steps.length) {
        if (chase.loop) step = 0;
        else {
          window.stopChase();
          return;
        }
      }

      // chaseSpeed is a percentage: 100 = fast, 10 = slow.
      const speed = Math.max(10, Math.min(100, n(chase.speed, n(document.getElementById("chaseSpeed")?.value, 50))));
      const interval = Math.max(50, 1000 * (100 / speed));
      s.chaseTimer = window.setTimeout(runStep, interval);
    };

    runStep();
    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
    return true;
  };

  window.stopChase = function stopChase(writeMessage = true) {
    const s = state();
    if (!s) return;
    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    stopFade(s);
    s.currentChase = -1;
    stopCueEffect();
    renderChases();
    if (writeMessage) log("⏹ Chase stopped");
  };

  window.saveChase = function saveChase(name, cueIndices, loop = true, speed = 50) {
    const s = state();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];
    if (!Array.isArray(s.cues)) s.cues = [];

    const steps = [...new Set((Array.isArray(cueIndices) ? cueIndices : [])
      .map(Number)
      .filter(i => Number.isInteger(i) && i >= 0 && i < s.cues.length && s.cues[i]))];

    if (!steps.length) {
      log("Choose at least one cue for the chase", "warn");
      return false;
    }

    const chaseName = String(name || "").trim() || `Chase ${s.chases.length + 1}`;
    s.chases.push({
      name: chaseName,
      steps,
      loop: Boolean(loop),
      speed: Math.max(10, Math.min(100, n(speed, 50))),
      fade: Math.max(0, n(s.chaseFade, 0))
    });
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`✅ Saved Chase: ${chaseName} (${steps.length} cues)`, "ok");
    return true;
  };

  function closeEditor() {
    document.getElementById("chaseEditorModal")?.remove();
  }

  function openEditor() {
    const s = state();
    if (!s || !Array.isArray(s.cues) || !s.cues.some(Boolean)) {
      log("Add at least one cue before creating a chase", "warn");
      return;
    }
    closeEditor();

    const modal = document.createElement("div");
    modal.id = "chaseEditorModal";
    modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;";

    const box = document.createElement("div");
    box.style.cssText = "width:min(620px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;box-shadow:0 20px 70px rgba(0,0,0,.5);";

    const h = document.createElement("h3");
    h.textContent = "Create Chase";
    h.style.marginTop = "0";
    box.appendChild(h);

    const help = document.createElement("p");
    help.textContent = "Choose the cues you want, in the order you want them to play.";
    help.style.color = "var(--text-muted,#8b9698)";
    box.appendChild(help);

    const name = document.createElement("input");
    name.type = "text";
    name.value = `Chase ${(s.chases?.length || 0) + 1}`;
    name.style.cssText = "display:block;width:100%;box-sizing:border-box;margin:7px 0 16px;padding:10px;";
    box.appendChild(name);

    const selected = new Set();
    const cueList = document.createElement("div");
    cueList.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:16px;";

    s.cues.forEach((cue, index) => {
      if (!cue) return;
      const row = document.createElement("label");
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.addEventListener("change", () => check.checked ? selected.add(index) : selected.delete(index));
      const text = document.createElement("span");
      text.textContent = `Cue ${index + 1} — ${cue.name || `Cue ${index + 1}`}`;
      row.append(check, text);
      cueList.appendChild(row);
    });
    box.appendChild(cueList);

    const loopLabel = document.createElement("label");
    loopLabel.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:12px;";
    const loop = document.createElement("input");
    loop.type = "checkbox";
    loop.checked = true;
    loopLabel.append(loop, document.createTextNode("Loop chase"));
    box.appendChild(loopLabel);

    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Speed";
    const speed = document.createElement("input");
    speed.type = "range";
    speed.min = "10";
    speed.max = "100";
    speed.value = document.getElementById("chaseSpeed")?.value || "50";
    speed.style.width = "100%";
    speedLabel.appendChild(speed);
    box.appendChild(speedLabel);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:18px;";
    const cancel = document.createElement("button");
    cancel.className = "btn-secondary";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = closeEditor;
    const save = document.createElement("button");
    save.className = "btn-primary";
    save.type = "button";
    save.textContent = "Save Chase";
    save.onclick = () => {
      const ok = window.saveChase(name.value, [...selected].sort((a, b) => a - b), loop.checked, speed.value);
      if (ok) closeEditor();
    };
    actions.append(cancel, save);
    box.appendChild(actions);
    modal.appendChild(box);
    modal.addEventListener("click", e => { if (e.target === modal) closeEditor(); });
    document.body.appendChild(modal);
    name.focus();
  }

  function installControls() {
    if (controlsInstalled) return;
    controlsInstalled = true;

    document.getElementById("btnSaveChase")?.addEventListener("click", openEditor);
    document.getElementById("btnRunChase")?.addEventListener("click", () => {
      const s = state();
      if (!s?.chases?.length) {
        log("Create a chase first", "warn");
        return;
      }
      const index = selectedChase >= 0 ? selectedChase : s.chases.length - 1;
      window.startChase(index);
    });
    document.getElementById("btnStopChase")?.addEventListener("click", () => window.stopChase());

    const speed = document.getElementById("chaseSpeed");
    const speedVal = document.getElementById("chaseSpeedVal");
    speed?.addEventListener("input", () => {
      if (speedVal) speedVal.textContent = speed.value;
      const s = state();
      if (s?.currentChase >= 0 && s.chases?.[s.currentChase]) {
        s.chases[s.currentChase].speed = Number(speed.value);
      }
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    installControls();
    renderChases();
  });

  // app.js can initialise the page after DOMContentLoaded.
  window.setTimeout(() => {
    installControls();
    renderChases();
  }, 0);
})();
