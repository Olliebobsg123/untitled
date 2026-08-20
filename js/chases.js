"use strict";

(function initialiseChases() {
  const state = () => window.State;
  const writeLog = (message, type) => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(message);
  };

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

    const run = () => {
      if (s.currentChase !== index) return;
      const cueIndex = Number(chase.steps[step]);
      const cue = s.cues?.[cueIndex];
      if (cue) {
        const target = { ...s.current, ...(cue.globalState || cue.state || {}) };
        const fixtureTargets = [];
        if (s.fixtureStates instanceof Map && Array.isArray(s.fixtures)) {
          s.fixtures.forEach(fixture => {
            if (!fixture?.id) return;
            const existing = s.fixtureStates.get(fixture.id) || {};
            const specific = cue.fixtureStates?.[fixture.id] || cue.fixtures?.[fixture.id] || {};
            fixtureTargets.push([
              fixture.id,
              { ...(window.DEFAULT_FIXTURE_STATE || {}), ...existing, ...target, ...specific }
            ]);
          });
        }
        const fade = Math.max(0, Number(s.chaseFade) || 0);
        if (typeof window.fadeTo === "function") {
          window.fadeTo(target, fade, fixtureTargets);
        } else {
          Object.assign(s.current, target);
          fixtureTargets.forEach(([id, fixtureState]) => s.fixtureStates.set(id, fixtureState));
          if (typeof window.updateDMX === "function") window.updateDMX();
        }
        s.currentCue = cueIndex;
        if (typeof window.renderCues === "function") window.renderCues();
        writeLog(`Chase ${index + 1} Step ${step + 1}: Cue ${cueIndex + 1}`);
      }
      step += 1;
      if (step >= chase.steps.length) {
        if (chase.loop) step = 0;
        else {
          window.stopChase();
          return;
        }
      }
      const wait = Math.max(0, Number(s.chaseWait) || 0);
      s.chaseTimer = window.setTimeout(run, wait);
    };

    run();
    window.renderChases();
    writeLog(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
    return true;
  };

  window.stopChase = function stopChase(writeMessage = true) {
    const s = state();
    if (!s) return;
    if (s.chaseTimer) window.clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    if (s.fading) cancelAnimationFrame(s.fading);
    s.fading = null;
    s.currentChase = -1;
    if (typeof window.renderChases === "function") window.renderChases();
    if (writeMessage) writeLog("⏹ Chase stopped");
  };

  window.saveChase = function saveChase(name, cueIndices, loop = true) {
    const s = state();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];
    if (!Array.isArray(cueIndices)) cueIndices = [];
    const steps = cueIndices.map(value => Number(value) - 1).filter(value => Number.isInteger(value) && value >= 0 && value < s.cues.length);
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
