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
      meta.textContent = `${Array.isArray(chase.steps) ? chase.steps.length : 0} cues · ${chase.loop ? "🔁 Loop" : "→ Run once"} · ${num(chase.speed, 50)}% speed · ${num(chase.fade, 0)}ms fade`;

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

    // Use the normal cue engine's fade/timer cancellation rather than a
    // second chase-specific fade engine. This keeps chase playback identical
    // to manually pressing a cue.
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
    log(`CHASE DEBUG step ${step + 1}/${chase.steps.length}: Cue ${cueIndex + 1} "${cue.name || `Cue ${cueIndex + 1}`}" H=${num(g.hue)} S=${num(g.sat)} L=${num(g.light)} I=${num(g.intensity)} M=${num(g.master)}`);

    if (Array.isArray(cue.fixtureStates)) {
      cue.fixtureStates.forEach(([id, state]) => {
        if (!state) return;
        log(`CHASE DEBUG fixture ${id}: H=${num(state.hue)} S=${num(state.sat)} L=${num(state.light)} I=${num(state.intensity)}`);
      });
    }
  }

  function waitForCueEngineThenAdvance(token, chase, step) {
    const s = S();
    if (!s || token !== chaseRunToken || s.currentChase < 0) return;

    // goToCue() owns State.fading. Wait until its fade is finished, then put
    // the cue's follow setting back exactly as it was and move to the next
    // chase step. This prevents cue follow timers from hijacking a chase.
    if (s.fading !== null) {
      requestAnimationFrame(() => waitForCueEngineThenAdvance(token, chase, step));
      return;
    }

    const cueIndex = Number(chase.steps[step]);
    const cue = s.cues?.[cueIndex];
    if (cue && cue.__chaseOriginalFollow) {
      cue.followEnabled = cue.__chaseOriginalFollow.enabled;
      cue.follow = cue.__chaseOriginalFollow.follow;
      delete cue.__chaseOriginalFollow;
    }

    if (typeof window.startCueEffectIfNeeded === "function" && cue) {
      // goToCue already starts the effect in its completion callback.
    }

    if (s.currentChase !== chase.__index || token !== chaseRunToken) return;

    log(`Chase ${chase.__index + 1} Step ${step + 1}: Cue ${cueIndex + 1}`, "ok");

    let next = step + 1;
    if (next >= chase.steps.length) {
      if (chase.loop) next = 0;
      else {
        stopChase();
        return;
      }
    }

    const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
    const interval = Math.max(50, Math.round(1000 * (100 / speed)));
    s.chaseTimer = setTimeout(() => runStep(token, chase, next), interval);
  }

  function runStep(token, chase, step) {
    const s = S();
    if (!s || token !== chaseRunToken || s.currentChase !== chase.__index) return;

    const cueIndex = Number(chase.steps[step]);
    const cue = s.cues?.[cueIndex];
    if (!cue) {
      log(`CHASE DEBUG: missing Cue ${cueIndex + 1}`, "warn");
      const next = step + 1 >= chase.steps.length ? (chase.loop ? 0 : -1) : step + 1;
      if (next < 0) return stopChase();
      s.chaseTimer = setTimeout(() => runStep(token, chase, next), 50);
      return;
    }

    debugCue(cueIndex, step, chase);

    // The old chase engine had its own target/fade/output implementation.
    // That duplicated the cue engine and was the source of the "everything
    // turns white" behaviour. Chases now call the exact same goToCue()
    // routine used by the normal cue stack, so RGB/colour-wheel fixtures,
    // movement, dimmer and effects all use one code path.
    if (typeof window.goToCue !== "function") {
      log("CHASE ERROR: goToCue() is unavailable; cues.js must load before chases.js", "error");
      return stopChase(false);
    }

    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    if (typeof window.stopEffect === "function") window.stopEffect(true);

    cue.__chaseOriginalFollow = {
      enabled: cue.followEnabled === true,
      follow: cue.follow
    };
    cue.followEnabled = false;

    s.currentCue = cueIndex;
    if (typeof window.renderCues === "function") window.renderCues();

    const fade = Math.max(0, Math.min(60000, num(chase.fade, 0)));
    const ok = window.goToCue(cueIndex, fade);
    if (!ok) {
      cue.followEnabled = cue.__chaseOriginalFollow.enabled;
      cue.follow = cue.__chaseOriginalFollow.follow;
      delete cue.__chaseOriginalFollow;
      log(`CHASE ERROR: Cue ${cueIndex + 1} could not be played`, "error");
      return;
    }

    log(`CHASE DEBUG output path: goToCue(Cue ${cueIndex + 1}, ${fade}ms)`);
    waitForCueEngineThenAdvance(token, chase, step);
  }

  function startChase(index) {
    const s = S();
    index = Number(index);
    const chase = s?.chases?.[index];

    if (!s || !Number.isInteger(index) || !chase || !Array.isArray(chase.steps) || !chase.steps.length) {
      log("Choose a chase containing at least one cue", "warn");
      return false;
    }

    stopChase(false);
    chaseRunToken++;
    const token = chaseRunToken;
    chase.__index = index;
    selectedChase = index;
    s.currentChase = index;

    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`} — ${chase.steps.map(i => `Cue ${Number(i) + 1}`).join(" → ")}`, "ok");
    runStep(token, chase, 0);
    return true;
  }

  function saveChase(name, cueIndices, loop = true, speed = 50, fadeMs = 0) {
    const s = S();
    if (!s) return false;
    if (!Array.isArray(s.chases)) s.chases = [];

    // Preserve the order the operator selected. Do not silently add every
    // cue, and do not duplicate a selected cue.
    const steps = [];
    for (const value of Array.isArray(cueIndices) ? cueIndices : []) {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= (s.cues?.length || 0) || !s.cues[index]) continue;
      if (!steps.includes(index)) steps.push(index);
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
      fade: Math.max(0, Math.min(60000, num(fadeMs, 0)))
    };

    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`✅ Saved Chase: ${chase.name} — ${steps.map(i => `Cue ${i + 1}`).join(", ")}`, "ok");
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
    box.style.cssText = "width:min(650px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);color:var(--text,#fff);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;box-shadow:0 18px 60px rgba(0,0,0,.55);";

    const heading = document.createElement("h3");
    heading.textContent = "Create Chase";
    heading.style.marginTop = "0";
    box.appendChild(heading);

    const help = document.createElement("p");
    help.textContent = "Select exactly the cues you want. They play in the order shown below; nothing is added automatically.";
    help.style.color = "var(--text-muted,#9aa4aa)";
    box.appendChild(help);

    const name = document.createElement("input");
    name.value = `Chase ${(s.chases?.length || 0) + 1}`;
    name.placeholder = "Chase name";
    name.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0 14px;padding:10px;";
    box.appendChild(name);

    const options = document.createElement("div");
    options.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;";

    const makeField = (labelText, input) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-muted,#9aa4aa);";
      const label = document.createElement("span");
      label.textContent = labelText;
      wrap.append(label, input);
      return wrap;
    };

    const speed = document.createElement("input");
    speed.type = "range";
    speed.min = "10";
    speed.max = "100";
    speed.value = String(document.getElementById("chaseSpeed")?.value || 50);
    const speedText = document.createElement("strong");
    speedText.textContent = `${speed.value}%`;
    speed.oninput = () => speedText.textContent = `${speed.value}%`;

    const fade = document.createElement("input");
    fade.type = "number";
    fade.min = "0";
    fade.max = "60000";
    fade.step = "50";
    fade.value = "0";

    const speedWrap = makeField("CHASE SPEED", speed);
    speedWrap.appendChild(speedText);
    options.append(speedWrap, makeField("STEP FADE · ms", fade));
    box.appendChild(options);

    const checks = document.createElement("div");
    checks.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    s.cues.forEach((cue, i) => {
      if (!cue) return;
      const label = document.createElement("label");
      label.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.cue = String(i);
      const text = document.createElement("span");
      text.textContent = `Cue ${i + 1} — ${cue.name || `Cue ${i + 1}`}`;
      label.append(cb, text);
      checks.appendChild(label);
    });
    box.appendChild(checks);

    const loopLabel = document.createElement("label");
    loopLabel.style.cssText = "display:flex;gap:8px;margin:14px 0;align-items:center;";
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
      const selected = [...checks.querySelectorAll("input[data-cue]:checked")].map(input => Number(input.dataset.cue));
      if (!selected.length) {
        log("Choose at least one cue for the chase", "warn");
        return;
      }
      if (saveChase(name.value, selected, loop.checked, Number(speed.value), Number(fade.value))) modal.remove();
    };
    modal.onclick = event => { if (event.target === modal) modal.remove(); };
  }

  function installButtons() {
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    const speed = document.getElementById("chaseSpeed");
    const speedVal = document.getElementById("chaseSpeedVal");

    if (speed && speedVal) {
      speedVal.textContent = speed.value;
      speed.oninput = () => speedVal.textContent = speed.value;
    }

    if (save) {
      save.type = "button";
      save.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        createChasePicker();
      };
    }

    if (run) {
      run.type = "button";
      run.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const s = S();
        if (selectedChase < 0 && s?.chases?.length) selectedChase = s.chases.length - 1;
        if (selectedChase >= 0) startChase(selectedChase);
        else log("Create/select a chase first", "warn");
      };
    }

    if (stop) {
      stop.type = "button";
      stop.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        stopChase();
      };
    }
  }

  window.renderChases = renderChases;
  window.startChase = startChase;
  window.stopChase = stopChase;
  window.saveChase = saveChase;
  window.__installChaseButtons = installButtons;
  window.__chaseDebug = true;

  function init() {
    installButtons();
    renderChases();
    setTimeout(installButtons, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  window.addEventListener("load", installButtons, { once: true });
})();
