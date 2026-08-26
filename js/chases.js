"use strict";

(function initialiseChases() {
  const state = () => window.State;
  const writeLog = (message, type) => {
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

  function getCueFixtureState(cue, fixtureId) {
    const wanted = String(fixtureId);
    const saved = cue?.fixtureStates;
    if (Array.isArray(saved)) {
      const entry = saved.find(item =>
        Array.isArray(item) && item.length >= 2 && String(item[0]) === wanted
      );
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
    const globalState = {
      ...(s.current || {}),
      ...(cue?.globalState || cue?.state || {})
    };
    const fixtureTargets = new Map();
    (Array.isArray(s.fixtures) ? s.fixtures : []).forEach(fixture => {
      if (!fixture || fixture.id == null) return;
      const existing = s.fixtureStates instanceof Map
        ? (s.fixtureStates.get(fixture.id) || {})
        : {};
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

  function pushOutput(s) {
    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();
  }

  function applyTarget(s, target) {
    s.current ||= {};
    Object.assign(s.current, target.globalState);
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    target.fixtureTargets.forEach((fixtureState, id) => s.fixtureStates.set(id, fixtureState));
    pushOutput(s);
  }

  function fadeToTarget(s, target, duration, finished) {
    const ms = Math.max(0, num(duration, 0));
    if (s.chaseFading) {
      window.cancelAnimationFrame(s.chaseFading);
      s.chaseFading = null;
    }
    if (ms <= 0) {
      applyTarget(s, target);
      finished?.();
      return;
    }

    const fromGlobal = { ...(s.current || {}) };
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
        global[key] = typeof a === "number" || typeof b === "number"
          ? num(a) + (num(b) - num(a)) * t
          : (raw < 1 ? (a ?? b) : (b ?? a));
      });
      s.current ||= {};
      Object.assign(s.current, global);

      if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
      target.fixtureTargets.forEach((toState, id) => {
        const fromState = fromFixtures.get(id) || {};
        const result = {};
        const keys = new Set([...Object.keys(fromState), ...Object.keys(toState || {})]);
        keys.forEach(key => {
          const a = fromState[key];
          const b = toState?.[key];
          result[key] = typeof a === "number" || typeof b === "number"
            ? num(a) + (num(b) - num(a)) * t
            : (raw < 1 ? (a ?? b) : (b ?? a));
        });
        s.fixtureStates.set(id, result);
      });
      pushOutput(s);

      if (raw >= 1) {
        s.chaseFading = null;
        applyTarget(s, target);
        finished?.();
        return;
      }
      s.chaseFading = window.requestAnimationFrame(frame);
    };
    s.chaseFading = window.requestAnimationFrame(frame);
  }

  function startCueEffect(cue) {
    if (typeof window.stopEffect === "function") window.stopEffect(true);
    if (!cue?.effect?.type || typeof window.startEffect !== "function") return;
    const saved = cue.effect;
    const effect = {
      type: String(saved.type),
      speed: num(saved.speed, 1),
      fixtureMode: saved.fixtureMode || "selected"
    };
    if (Array.isArray(saved.fixtureIds) && saved.fixtureIds.length) {
      effect.fixtureMode = "custom";
      effect.fixtureIds = [...saved.fixtureIds];
    }
    if (saved.name) effect.name = String(saved.name);
    window.startEffect(effect.type, effect);
  }

  let selectedChase = -1;

  window.renderChases = function renderChases() {
    const list = document.getElementById("chaseList");
    if (!list) return;
    const s = state();
    if (!s) return;
    if (!Array.isArray(s.chases)) s.chases = [];

    if (selectedChase >= s.chases.length) selectedChase = -1;
    list.replaceChildren();

    s.chases.forEach((chase, index) => {
      if (!chase) return;
      const el = document.createElement("div");
      el.className = `cue-item ${index === selectedChase ? "active" : ""}`;
      el.dataset.chaseIndex = String(index);
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${chase.name || `Chase ${index + 1}`}`;
      const meta = document.createElement("div");
      meta.style.cssText = "font-size:11px;color:var(--text-muted);";
      meta.textContent = `${Array.isArray(chase.steps) ? chase.steps.length : 0} steps · ${chase.loop ? "🔁 Loop" : "→ Run once"}`;
      el.append(title, meta);
      el.addEventListener("click", event => {
        event.preventDefault();
        selectedChase = index;
        window.renderChases();
        writeLog(`Selected Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
      });
      list.appendChild(el);
    });
  };

  window.startChase = function startChase(index) {
    const s = state();
    if (!s) return false;
    index = Number(index);
    if (!Number.isInteger(index)) return false;
    const chase = s.chases?.[index];
    if (!chase || !Array.isArray(chase.steps) || !chase.steps.length) {
      writeLog("Chase empty or missing", "warn");
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
        writeLog(`Chase ${index + 1}: Cue ${cueIndex + 1} is missing`, "warn");
        step += 1;
        if (step >= chase.steps.length) {
          if (chase.loop) step = 0;
          else { window.stopChase(); return; }
        }
        s.chaseTimer = window.setTimeout(runStep, Math.max(0, num(s.chaseWait, 0)));
        return;
      }

      const target = buildCueTarget(s, cue);
      const fade = Math.max(0, num(s.chaseFade, 0));
      s.currentCue = cueIndex;
      if (typeof window.renderCues === "function") window.renderCues();

      fadeToTarget(s, target, fade, () => {
        if (s.currentChase !== index) return;
        startCueEffect(cue);
        writeLog(`Chase ${index + 1} Step ${step + 1}: Cue ${cueIndex + 1}`);
        step += 1;
        if (step >= chase.steps.length) {
          if (chase.loop) step = 0;
          else { window.stopChase(); return; }
        }
        const wait = Math.max(0, num(s.chaseWait, 0));
        s.chaseTimer = window.setTimeout(runStep, Math.max(0, wait - fade));
      });
    };

    runStep();
    window.renderChases();
    writeLog(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
    return true;
  };

  window.stopChase = function stopChase(writeMessage = true) {
    const s = state();
    if (!s) return;
    if (s.chaseTimer) window.clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    if (s.chaseFading) window.cancelAnimationFrame(s.chaseFading);
    s.chaseFading = null;
    s.currentChase = -1;
    if (typeof window.renderChases === "function") window.renderChases();
    if (writeMessage) writeLog("⏹ Chase stopped");
  };

  window.saveChase = function saveChase(name, cueIndices, loop = true) {
    const s = state();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];
    if (!Array.isArray(s.cues)) s.cues = [];
    if (!Array.isArray(cueIndices)) cueIndices = [];

    const steps = cueIndices
      .map(value => Number(value) - 1)
      .filter(value => Number.isInteger(value) && value >= 0 && value < s.cues.length && s.cues[value]);
    if (!steps.length) {
      writeLog("No valid cues selected for chase", "warn");
      return false;
    }

    const chaseName = String(name || "").trim() || `Chase ${s.chases.length + 1}`;
    s.chases.push({ name: chaseName, steps, loop: Boolean(loop) });
    selectedChase = s.chases.length - 1;
    window.renderChases();
    writeLog(`✅ Saved Chase: ${chaseName} (${steps.length} steps)`, "ok");
    return true;
  };

  function wireChaseControls() {
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    const speed = document.getElementById("chaseSpeed");
    const speedVal = document.getElementById("chaseSpeedVal");

    if (speed && speedVal) {
      const updateSpeed = () => {
        const s = state();
        const percent = Math.max(10, Math.min(100, num(speed.value, 50)));
        speed.value = String(percent);
        speedVal.textContent = String(percent);
        if (s) {
          // Higher percentage = faster chase. Keep a useful 100–2000ms range.
          s.chaseWait = Math.round(2000 - (percent / 100) * 1900);
          if (s.chaseWait < 100) s.chaseWait = 100;
        }
      };
      speed.addEventListener("input", updateSpeed);
      updateSpeed();
    }

    save?.addEventListener("click", () => {
      const s = state();
      if (!s) return;
      if (!Array.isArray(s.cues) || !s.cues.length) {
        writeLog("Add at least one cue before creating a chase", "warn");
        return;
      }

      const name = window.prompt
        ? window.prompt("Chase name:", `Chase ${(s.chases?.length || 0) + 1}`)
        : null;
      if (name === null) return;

      const defaultSteps = s.cues.map((_, i) => String(i + 1)).join(",");
      const cueText = window.prompt
        ? window.prompt(`Cue numbers to run, separated by commas (1-${s.cues.length}):`, defaultSteps)
        : null;
      if (cueText === null) return;

      const loop = window.confirm ? window.confirm("Loop this chase when it reaches the end?") : true;
      const cues = cueText.split(",").map(v => v.trim()).filter(Boolean);
      saveChase(name, cues, loop);
    });

    run?.addEventListener("click", () => {
      const s = state();
      if (!s || !Array.isArray(s.chases) || !s.chases.length) {
        writeLog("No chases available", "warn");
        return;
      }
      const index = selectedChase >= 0 ? selectedChase : (s.currentChase >= 0 ? s.currentChase : 0);
      startChase(index);
    });

    stop?.addEventListener("click", () => stopChase());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireChaseControls, { once: true });
  } else {
    wireChaseControls();
  }
})();
