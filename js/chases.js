"use strict";

/*
 * Chase engine.
 *
 * A chase MUST replay the fixture snapshot stored in each cue.  It must not
 * rebuild a cue from State.current, because State.current is only the global
 * programmer state and can be white while the individual fixture snapshot is
 * coloured.
 */
(function initialiseChases() {
  const S = () => window.State;
  const log = (m, t = "info") => window.log?.(m, t) ?? console.log(m);
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clone = v => {
    if (!v || typeof v !== "object") return {};
    return typeof window.cloneFixtureState === "function"
      ? window.cloneFixtureState(v)
      : { ...v };
  };

  let selectedChase = -1;

  function cueFixtureMap(cue) {
    const out = new Map();
    const saved = cue?.fixtureStates;

    if (saved instanceof Map) {
      saved.forEach((v, id) => { if (id != null && v) out.set(String(id), clone(v)); });
    } else if (Array.isArray(saved)) {
      saved.forEach(e => {
        if (Array.isArray(e) && e.length >= 2 && e[0] != null && e[1]) {
          out.set(String(e[0]), clone(e[1]));
        }
      });
    } else if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([id, v]) => { if (v) out.set(String(id), clone(v)); });
    }
    return out;
  }

  function buildTarget(cue) {
    const s = S();
    const global = clone(cue?.globalState || cue?.state || {});
    let fixtures = cueFixtureMap(cue);

    // Compatibility for old cues which were recorded before fixtureStates was
    // added.  Do NOT use State.current when a cue has a real fixture snapshot.
    if (!fixtures.size) {
      const ids = Array.isArray(s?.fixtures) ? s.fixtures : [];
      ids.forEach(f => {
        if (f?.id != null) fixtures.set(String(f.id), clone(global));
      });
    }
    return { global, fixtures };
  }

  function output() {
    try { window.updateDMX?.(); } catch (e) { console.error(e); }
    try { window.sendToVisualizer?.(); } catch (e) { console.error(e); }
  }

  function apply(target) {
    const s = S();
    if (!s) return;
    s.current ||= {};
    Object.assign(s.current, target.global);
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();

    // Match IDs as strings because show-file loading can change the concrete
    // type of an ID while preserving its value.
    const realIds = new Map((s.fixtures || []).map(f => [String(f.id), f.id]));
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

  function fade(target, ms, done) {
    const s = S();
    if (!s) return;
    stopFade();
    ms = Math.max(0, num(ms, 0));
    if (!ms) { apply(target); done?.(); return; }

    const fromGlobal = clone(s.current);
    const from = new Map();
    (s.fixtureStates instanceof Map ? s.fixtureStates : new Map())
      .forEach((v, id) => from.set(String(id), clone(v)));

    const realIds = new Map((s.fixtures || []).map(f => [String(f.id), f.id]));
    const start = performance.now();

    const tick = now => {
      if (s.currentChase < 0) return;
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

      const global = {};
      const keys = new Set([...Object.keys(fromGlobal), ...Object.keys(target.global)]);
      keys.forEach(k => {
        const a = fromGlobal[k], b = target.global[k];
        global[k] = (typeof a === "number" || typeof b === "number")
          ? num(a) + (num(b) - num(a)) * e
          : (p < 1 ? (a ?? b) : (b ?? a));
      });
      Object.assign(s.current, global);

      if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
      target.fixtures.forEach((to, sid) => {
        const id = realIds.has(sid) ? realIds.get(sid) : sid;
        const a = from.get(String(id)) || clone(to);
        const result = {};
        const ks = new Set([...Object.keys(a), ...Object.keys(to)]);
        ks.forEach(k => {
          const av = a[k], bv = to[k];
          result[k] = (typeof av === "number" || typeof bv === "number")
            ? num(av) + (num(bv) - num(av)) * e
            : (p < 1 ? (av ?? bv) : (bv ?? av));
        });
        s.fixtureStates.set(id, result);
      });

      output();
      if (p >= 1) {
        stopFade();
        apply(target);
        done?.();
      } else {
        s.chaseFading = requestAnimationFrame(tick);
      }
    };
    s.chaseFading = requestAnimationFrame(tick);
  }

  function stopEffect() { window.stopEffect?.(true); }
  function startEffect(cue) {
    stopEffect();
    if (!cue?.effect?.type || typeof window.startEffect !== "function") return;
    const e = cue.effect;
    window.startEffect(String(e.type), {
      type: String(e.type),
      speed: num(e.speed, 1),
      fixtureMode: e.fixtureIds?.length ? "custom" : (e.fixtureMode || "selected"),
      fixtureIds: Array.isArray(e.fixtureIds) ? e.fixtureIds.map(String) : []
    });
  }

  window.renderChases = function renderChases() {
    const list = document.getElementById("chaseList");
    const s = S();
    if (!list || !s) return;
    s.chases ||= [];
    list.replaceChildren();

    if (!s.chases.length) {
      const e = document.createElement("div");
      e.className = "empty-state";
      e.textContent = "No chases yet. Click New Chase to choose cues.";
      list.appendChild(e);
      return;
    }

    s.chases.forEach((c, i) => {
      if (!c) return;
      const el = document.createElement("div");
      el.className = `cue-item ${i === selectedChase ? "active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${i + 1}. ${c.name || `Chase ${i + 1}`}`;
      const meta = document.createElement("div");
      meta.style.cssText = "font-size:11px;color:var(--text-muted);";
      meta.textContent = `${c.steps?.length || 0} cues · ${c.loop ? "🔁 Loop" : "→ Run once"}`;
      el.append(title, meta);
      el.onclick = () => { selectedChase = i; renderChases(); };
      list.appendChild(el);
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
    let pos = 0;

    const run = () => {
      if (s.currentChase !== index) return;
      const cueIndex = Number(chase.steps[pos]);
      const cue = s.cues?.[cueIndex];
      if (!cue) { advance(); return; }

      const target = buildTarget(cue);
      s.currentCue = cueIndex;
      window.renderCues?.();

      // Use the cue's own fade, unless the chase explicitly specifies one.
      const fadeMs = Math.max(0, num(chase.fade, num(cue.fade, 800)));
      fade(target, fadeMs, () => {
        if (s.currentChase !== index) return;
        startEffect(cue);
        log(`Chase ${index + 1} Step ${pos + 1}: Cue ${cueIndex + 1}`);
        advance();
      });
    };

    const advance = () => {
      if (s.currentChase !== index) return;
      pos++;
      if (pos >= chase.steps.length) {
        if (chase.loop) pos = 0;
        else { window.stopChase(); return; }
      }
      const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
      s.chaseTimer = setTimeout(run, Math.max(50, 1000 * (100 / speed)));
    };

    run();
    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`);
    return true;
  };

  window.saveChase = function saveChase(name, cueIndices, loop = true, speed = 50) {
    const s = S();
    if (!s) return false;
    s.chases ||= [];
    const steps = [...new Set((cueIndices || []).map(Number)
      .filter(i => Number.isInteger(i) && i >= 0 && i < (s.cues?.length || 0) && s.cues[i]))];
    if (!steps.length) { log("Choose at least one cue for the chase", "warn"); return false; }

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
    log(`✅ Saved Chase: ${chase.name} (${steps.map(i => `Cue ${i + 1}`).join(", ")})`, "ok");
    return true;
  };

  /* One, and only one, set of button handlers.  A previous version had both
     app.js and chases.js wiring these buttons, which created an extra chase.
     We install after every other DOMContentLoaded handler and replace onclick
     so the old handler cannot create a second chase. */
  function installButtons() {
    if (window.__chaseButtonsInstalled) return;
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    if (!save || !run || !stop) return;

    save.onclick = e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const s = S();
      if (!s?.cues?.some(Boolean)) return log("Add at least one cue first", "warn");

      const modal = document.createElement("div");
      modal.id = "chasePicker";
      modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;";
      const box = document.createElement("div");
      box.style.cssText = "width:min(600px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;";
      box.innerHTML = "<h3 style='margin-top:0'>Create Chase</h3><p style='color:var(--text-muted)'>Tick only the cues you want, in cue-number order.</p>";

      const name = document.createElement("input");
      name.value = `Chase ${(s.chases?.length || 0) + 1}`;
      name.placeholder = "Chase name";
      name.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0 12px;padding:10px;";
      box.appendChild(name);

      const checks = document.createElement("div");
      checks.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      s.cues.forEach((cue, i) => {
        if (!cue) return;
        const label = document.createElement("label");
        label.style.cssText = "display:flex;gap:10px;padding:9px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.cue = String(i);
        label.append(cb, document.createTextNode(`Cue ${i + 1} — ${cue.name || `Cue ${i + 1}`}`));
        checks.appendChild(label);
      });
      box.appendChild(checks);

      const loop = document.createElement("label");
      loop.style.cssText = "display:flex;gap:8px;margin:14px 0;";
      const loopBox = document.createElement("input");
      loopBox.type = "checkbox"; loopBox.checked = true;
      loop.append(loopBox, document.createTextNode("Loop chase"));
      box.appendChild(loop);

      const buttons = document.createElement("div");
      buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:16px;";
      const cancel = document.createElement("button"); cancel.className = "btn-secondary"; cancel.textContent = "Cancel";
      const create = document.createElement("button"); create.className = "btn-primary"; create.textContent = "Create Chase";
      buttons.append(cancel, create); box.appendChild(buttons); modal.appendChild(box); document.body.appendChild(modal);

      cancel.onclick = () => modal.remove();
      create.onclick = () => {
        const selected = [...checks.querySelectorAll("input[data-cue]:checked")].map(cb => Number(cb.dataset.cue));
        if (!selected.length) return log("Select at least one cue", "warn");
        saveChase(name.value, selected, loopBox.checked, 50);
        modal.remove();
      };
    };

    run.onclick = e => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (selectedChase < 0) return log("Select a chase first", "warn");
      startChase(selectedChase);
    };

    stop.onclick = e => {
      e.preventDefault(); e.stopImmediatePropagation();
      stopChase();
    };

    window.__chaseButtonsInstalled = true;
  }

  function init() {
    renderChases();
    // app.js also uses DOMContentLoaded. Run after its handler so these
    // handlers are the final onclick handlers on the three chase buttons.
    setTimeout(installButtons, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
