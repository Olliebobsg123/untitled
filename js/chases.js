"use strict";

(function initialiseChases() {
  const S = () => window.State;
  const log = (message, type = "info") => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(message);
  };
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const clone = value => {
    if (!value || typeof value !== "object") return {};
    return typeof window.cloneFixtureState === "function"
      ? window.cloneFixtureState(value)
      : { ...value };
  };

  let selectedChase = -1;
  let buttonsInstalled = false;

  function cueFixtureMap(cue) {
    const result = new Map();
    const saved = cue?.fixtureStates;

    if (saved instanceof Map) {
      saved.forEach((value, id) => {
        if (id != null && value) result.set(String(id), clone(value));
      });
    } else if (Array.isArray(saved)) {
      saved.forEach(entry => {
        if (Array.isArray(entry) && entry.length >= 2 && entry[0] != null && entry[1]) {
          result.set(String(entry[0]), clone(entry[1]));
        }
      });
    } else if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([id, value]) => {
        if (value) result.set(String(id), clone(value));
      });
    }

    return result;
  }

  function buildTarget(cue) {
    const s = S();
    const global = clone(cue?.globalState || cue?.state || {});
    let fixtures = cueFixtureMap(cue);

    if (!fixtures.size) {
      (s?.fixtures || []).forEach(fixture => {
        if (fixture?.id != null) fixtures.set(String(fixture.id), clone(global));
      });
    }

    /*
     * IMPORTANT:
     * The console's colour controls are global programmer values and older
     * cue snapshots can contain fixture states captured before the colour was
     * written to each fixture.  Replaying those stale fixture colour fields
     * made a chase look white/default even though the cue itself was coloured.
     *
     * The cue's recorded global colour/intensity is authoritative for chase
     * playback. Movement/FX remain per-fixture.
     */
    const colourKeys = ["hue", "sat", "light"];
    const levelKeys = ["intensity", "master"];
    fixtures.forEach((fixtureState, id) => {
      const next = clone(fixtureState);
      colourKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(global, key)) next[key] = num(global[key], next[key]);
      });
      levelKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(global, key)) next[key] = num(global[key], next[key]);
      });
      fixtures.set(id, next);
    });

    return { global, fixtures };
  }

  function output() {
    try { window.updateDMX?.(); } catch (error) { console.error("Chase DMX output failed:", error); }
    try { window.sendToVisualizer?.(); } catch (error) { console.error("Chase visualizer output failed:", error); }
  }

  function apply(target) {
    const s = S();
    if (!s) return;

    s.current ||= {};
    Object.assign(s.current, target.global);
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();

    const realIds = new Map((s.fixtures || []).map(fixture => [String(fixture.id), fixture.id]));
    target.fixtures.forEach((state, stringId) => {
      const id = realIds.has(stringId) ? realIds.get(stringId) : stringId;
      s.fixtureStates.set(id, clone(state));
    });

    output();
  }

  function stopFade() {
    const s = S();
    if (s?.chaseFading) cancelAnimationFrame(s.chaseFading);
    if (s) s.chaseFading = null;
  }

  function fade(target, milliseconds, finished) {
    const s = S();
    if (!s) return;

    stopFade();
    const duration = Math.max(0, num(milliseconds, 0));
    if (!duration) {
      apply(target);
      finished?.();
      return;
    }

    const fromGlobal = clone(s.current);
    const from = new Map();
    (s.fixtureStates instanceof Map ? s.fixtureStates : new Map()).forEach((value, id) => {
      from.set(String(id), clone(value));
    });

    const realIds = new Map((s.fixtures || []).map(fixture => [String(fixture.id), fixture.id]));
    const started = performance.now();

    const tick = now => {
      if (s.currentChase < 0) return;

      const raw = Math.min(1, Math.max(0, (now - started) / duration));
      const eased = raw < 0.5
        ? 2 * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 2) / 2;

      const global = {};
      const globalKeys = new Set([
        ...Object.keys(fromGlobal),
        ...Object.keys(target.global)
      ]);

      globalKeys.forEach(key => {
        const a = fromGlobal[key];
        const b = target.global[key];
        global[key] = (typeof a === "number" || typeof b === "number")
          ? num(a) + (num(b) - num(a)) * eased
          : (raw < 1 ? (a ?? b) : (b ?? a));
      });
      Object.assign(s.current, global);

      if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
      target.fixtures.forEach((to, stringId) => {
        const id = realIds.has(stringId) ? realIds.get(stringId) : stringId;
        const startState = from.get(String(id)) || clone(to);
        const result = {};
        const keys = new Set([...Object.keys(startState), ...Object.keys(to)]);

        keys.forEach(key => {
          const a = startState[key];
          const b = to[key];
          result[key] = (typeof a === "number" || typeof b === "number")
            ? num(a) + (num(b) - num(a)) * eased
            : (raw < 1 ? (a ?? b) : (b ?? a));
        });

        s.fixtureStates.set(id, result);
      });

      output();

      if (raw >= 1) {
        stopFade();
        apply(target);
        finished?.();
      } else {
        s.chaseFading = requestAnimationFrame(tick);
      }
    };

    s.chaseFading = requestAnimationFrame(tick);
  }

  function stopEffect() {
    window.stopEffect?.(true);
  }

  function startEffect(cue) {
    stopEffect();
    if (!cue?.effect?.type || typeof window.startEffect !== "function") return;

    const effect = cue.effect;
    window.startEffect(String(effect.type), {
      type: String(effect.type),
      speed: num(effect.speed, 1),
      fixtureMode: Array.isArray(effect.fixtureIds) && effect.fixtureIds.length
        ? "custom"
        : (effect.fixtureMode || "selected"),
      fixtureIds: Array.isArray(effect.fixtureIds) ? effect.fixtureIds.map(String) : []
    });
  }

  window.renderChases = function renderChases() {
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
      const item = document.createElement("div");
      item.className = `cue-item ${index === selectedChase ? "active" : ""}`;

      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${chase.name || `Chase ${index + 1}`}`;

      const meta = document.createElement("div");
      meta.style.cssText = "font-size:11px;color:var(--text-muted);";
      meta.textContent = `${Array.isArray(chase.steps) ? chase.steps.length : 0} cues · ${chase.loop ? "🔁 Loop" : "→ Run once"}`;

      item.append(title, meta);
      item.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        selectedChase = index;
        renderChases();
      };
      list.appendChild(item);
    });
  };

  window.stopChase = function stopChase(message = true) {
    const s = S();
    if (!s) return;

    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    stopFade();
    s.currentChase = -1;
    stopEffect();
    renderChases();

    if (message) log("⏹ Chase stopped");
  };

  window.startChase = function startChase(index) {
    const s = S();
    index = Number(index);
    const chase = s?.chases?.[index];

    if (!s || !Number.isInteger(index) || !chase || !Array.isArray(chase.steps) || !chase.steps.length) {
      log("Choose a chase containing at least one cue", "warn");
      return false;
    }

    window.stopChase(false);
    s.currentChase = index;
    selectedChase = index;
    let position = 0;

    const advance = () => {
      if (s.currentChase !== index) return;

      position += 1;
      if (position >= chase.steps.length) {
        if (chase.loop) position = 0;
        else {
          window.stopChase();
          return;
        }
      }

      const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
      s.chaseTimer = setTimeout(runStep, Math.max(50, 1000 * (100 / speed)));
    };

    const runStep = () => {
      if (s.currentChase !== index) return;

      const cueIndex = Number(chase.steps[position]);
      const cue = s.cues?.[cueIndex];
      if (!cue) {
        advance();
        return;
      }

      const target = buildTarget(cue);
      s.currentCue = cueIndex;
      window.renderCues?.();

      const fadeMs = Math.max(0, num(chase.fade, 0));
      fade(target, fadeMs, () => {
        if (s.currentChase !== index) return;
        startEffect(cue);
        log(`Chase ${index + 1} Step ${position + 1}: Cue ${cueIndex + 1}`);
        advance();
      });
    };

    runStep();
    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
    return true;
  };

  window.saveChase = function saveChase(name, cueIndices, loop = true, speed = 50) {
    const s = S();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];

    const steps = [...new Set((cueIndices || [])
      .map(Number)
      .filter(index => Number.isInteger(index) && index >= 0 && index < (s.cues?.length || 0) && s.cues[index]))];

    if (!steps.length) {
      log("Choose at least one cue for the chase", "warn");
      return false;
    }

    const chase = {
      name: String(name || `Chase ${s.chases.length + 1}`).trim(),
      steps,
      loop: Boolean(loop),
      speed: Math.max(10, Math.min(100, num(speed, 50))),
      fade: 0
    };

    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`✅ Saved Chase: ${chase.name} (${steps.map(index => `Cue ${index + 1}`).join(", ")})`, "ok");
    return true;
  };

  function createChasePicker() {
    const s = S();
    if (!s?.cues?.some(Boolean)) {
      log("Add at least one cue first", "warn");
      return;
    }

    document.getElementById("chasePicker")?.remove();

    const modal = document.createElement("div");
    modal.id = "chasePicker";
    modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;";

    const box = document.createElement("div");
    box.style.cssText = "width:min(600px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;";
    box.innerHTML = "<h3 style='margin-top:0'>Create Chase</h3><p style='color:var(--text-muted)'>Tick only the cues you want. They will play in cue-number order.</p>";

    const name = document.createElement("input");
    name.value = `Chase ${(s.chases?.length || 0) + 1}`;
    name.placeholder = "Chase name";
    name.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0 12px;padding:10px;";
    box.appendChild(name);

    const checks = document.createElement("div");
    checks.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    s.cues.forEach((cue, index) => {
      if (!cue) return;
      const label = document.createElement("label");
      label.style.cssText = "display:flex;gap:10px;padding:9px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.cue = String(index);
      label.append(checkbox, document.createTextNode(`Cue ${index + 1} — ${cue.name || `Cue ${index + 1}`}`));
      checks.appendChild(label);
    });
    box.appendChild(checks);

    const loopLabel = document.createElement("label");
    loopLabel.style.cssText = "display:flex;gap:8px;margin:14px 0;";
    const loop = document.createElement("input");
    loop.type = "checkbox";
    loop.checked = true;
    loopLabel.append(loop, document.createTextNode("Loop chase"));
    box.appendChild(loopLabel);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:16px;";
    const cancel = document.createElement("button");
    cancel.className = "btn-secondary";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const create = document.createElement("button");
    create.className = "btn-primary";
    create.type = "button";
    create.textContent = "Create Chase";
    actions.append(cancel, create);
    box.appendChild(actions);
    modal.appendChild(box);
    document.body.appendChild(modal);

    cancel.onclick = () => modal.remove();
    create.onclick = () => {
      const selected = [...checks.querySelectorAll("input[data-cue]:checked")]
        .map(input => Number(input.dataset.cue));
      if (!selected.length) {
        log("Select at least one cue", "warn");
        return;
      }
      if (saveChase(name.value, selected, loop.checked, 50)) modal.remove();
    };
  }

  function installButtons() {
    if (buttonsInstalled) return;

    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    if (!save || !run || !stop) return;

    /* Capture phase deliberately intercepts app.js' old prompt-based handlers
       before they reach the target button. This prevents duplicate creation
       and the unwanted "Chase number:" prompt. */
    document.addEventListener("click", event => {
      const target = event.target?.closest?.("#btnSaveChase,#btnRunChase,#btnStopChase");
      if (!target) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (target === save) {
        createChasePicker();
      } else if (target === run) {
        if (selectedChase < 0) {
          log("Select a chase first", "warn");
          return;
        }
        startChase(selectedChase);
      } else {
        stopChase();
      }
    }, true);

    buttonsInstalled = true;
    window.__chaseButtonsInstalled = true;
  }

  function init() {
    renderChases();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", installButtons, { once: true });
    } else {
      installButtons();
    }
    setTimeout(installButtons, 0);
  }

  init();
})();
