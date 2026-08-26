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

    // Current cue format is [[fixtureId, state], ...].
    if (Array.isArray(saved)) {
      const entry = saved.find(item =>
        Array.isArray(item) && item.length >= 2 && String(item[0]) === wanted
      );
      if (entry?.[1] && typeof entry[1] === "object") return clone(entry[1]);
    }

    // Also accept older object-based cue formats.
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
    target.fixtureTargets.forEach((fixtureState, id) => {
      s.fixtureStates.set(id, fixtureState);
    });
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
      const t = raw < 0.5
        ? 2 * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 2) / 2;

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
        const keys = new Set([
          ...Object.keys(fromState),
          ...Object.keys(toState || {})
        ]);
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

  window.renderChases = function renderChases() {
    const list = document.getElementById("chaseList");
    if (!list) return;
    const s = state();
    if (!s) return;
    if (!Array.isArray(s.chases)) s.chases = [];

    list.replaceChildren();
    s.chases.forEach((chase, index) => {
      if (!chase) return;
      const el = document.createElement("div");
      el.className = `cue-item ${index === s.currentChase ? "active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${chase.name || `Chase ${index + 1}`}`;
      const meta = document.createElement("div");
      meta.style.cssText = "font-size:11px;color:var(--text-muted);";
      meta.textContent = `${Array.isArray(chase.steps) ? chase.steps.length : 0} steps · ${chase.loop ? "🔁 Loop" : "→ Run once"}`;
      el.append(title, meta);
      el.addEventListener("click", event => {
        event.preventDefault();
        writeLog(`Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`} — ${Array.isArray(chase.steps) ? chase.steps.length : 0} steps`);
      });
      list.appendChild(el);
    });
  };

  window.startChase = function startChase(index) {
    const s = state();
    if (!s) return false;

    window.stopChase(false);
    const chase = s.chases?.[index];
    if (!chase || !Array.isArray(chase.steps) || !chase.steps.length) {
      writeLog("Chase empty or missing", "warn");
      return false;
    }

    s.currentChase = index;
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
          else {
            window.stopChase();
            return;
          }
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
          else {
            window.stopChase();
            return;
          }
        }

        // chaseWait is the total interval for a step. The next step starts
        // after the fade, so fades never overlap and fight each other.
        const wait = Math.max(0, num(s.chaseWait, 0));
        const remaining = Math.max(0, wait - fade);
        s.chaseTimer = window.setTimeout(runStep, remaining);
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

    // State.fading belongs to the normal cue engine. Do not cancel it here.
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

    // The UI supplies human cue numbers (1,2,3). Store zero-based indexes.
    const steps = cueIndices
      .map(value => Number(value) - 1)
      .filter(value => Number.isInteger(value) && value >= 0 && value < s.cues.length && s.cues[value]);

    if (!steps.length) {
      writeLog("No valid cues selected for chase", "warn");
      return false;
    }

    const chaseName = String(name || "").trim() || `Chase ${s.chases.length + 1}`;
    s.chases.push({ name: chaseName, steps, loop: Boolean(loop) });
    window.renderChases();
    writeLog(`✅ Saved Chase: ${chaseName} (${steps.length} steps)`, "ok");
    return true;
  };
})();
