"use strict";

(function initialiseChases() {
  const S = () => window.State;
  const log = (m, t = "info") => typeof window.log === "function" ? window.log(m, t) : console.log(m);
  const num = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const clone = v => typeof window.cloneFixtureState === "function" ? window.cloneFixtureState(v) : { ...(v || {}) };
  let selectedChase = -1;

  function cueFixtureMap(cue) {
    const out = new Map(), saved = cue?.fixtureStates;
    if (saved instanceof Map) saved.forEach((v, id) => { if (id != null && v) out.set(String(id), clone(v)); });
    else if (Array.isArray(saved)) saved.forEach(e => { if (Array.isArray(e) && e.length >= 2 && e[0] != null && e[1]) out.set(String(e[0]), clone(e[1])); });
    else if (saved && typeof saved === "object") Object.entries(saved).forEach(([id, v]) => { if (v) out.set(String(id), clone(v)); });
    return out;
  }

  function buildTarget(cue) {
    const s = S(), global = clone(cue?.globalState || cue?.state || {}), fixtures = cueFixtureMap(cue);
    if (!fixtures.size) (s?.fixtures || []).forEach(f => { if (f?.id != null) fixtures.set(String(f.id), clone(global)); });
    // IMPORTANT: a recorded per-fixture value wins over the global fallback.
    // Older chase code overwrote fixture colours with stale global white values.
    ["hue", "sat", "light", "intensity", "master"].forEach(k => fixtures.forEach(state => {
      if (!Object.prototype.hasOwnProperty.call(state, k) && Object.prototype.hasOwnProperty.call(global, k)) state[k] = num(global[k], state[k]);
    }));
    return { global, fixtures };
  }

  function output() {
    try { window.updateDMX?.(); } catch (e) { console.error("Chase DMX output failed", e); }
    try { window.sendToVisualizer?.(); } catch (e) { console.error("Chase visualizer output failed", e); }
  }
  function stopFade() { const s = S(); if (s?.chaseFading != null) cancelAnimationFrame(s.chaseFading); if (s) s.chaseFading = null; }
  function apply(target) {
    const s = S(); if (!s) return;
    s.current ||= {}; Object.assign(s.current, clone(target.global));
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    const ids = new Map((s.fixtures || []).map(f => [String(f.id), f.id]));
    target.fixtures.forEach((v, key) => s.fixtureStates.set(ids.has(String(key)) ? ids.get(String(key)) : key, clone(v)));
    output();
  }
  function fade(target, ms, done) {
    const s = S(); if (!s) return; stopFade(); ms = Math.max(0, num(ms, 0));
    if (!ms) { apply(target); done?.(); return; }
    const fromGlobal = clone(s.current), from = new Map();
    (s.fixtureStates instanceof Map ? s.fixtureStates : new Map()).forEach((v, id) => from.set(String(id), clone(v)));
    const ids = new Map((s.fixtures || []).map(f => [String(f.id), f.id])), started = performance.now();
    const tick = now => {
      if (s.currentChase < 0) return;
      const p = Math.min(1, Math.max(0, (now - started) / ms));
      const t = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      Object.keys(target.global || {}).forEach(k => {
        const a = fromGlobal[k], b = target.global[k];
        if (typeof a === "number" || typeof b === "number") s.current[k] = num(a) + (num(b) - num(a)) * t;
        else if (p >= 1) s.current[k] = b ?? a;
      });
      target.fixtures.forEach((to, key) => {
        const id = ids.has(String(key)) ? ids.get(String(key)) : key, start = from.get(String(id)) || clone(to), result = clone(start);
        new Set([...Object.keys(start), ...Object.keys(to)]).forEach(k => {
          const a = start[k], b = to[k];
          if (typeof a === "number" || typeof b === "number") result[k] = num(a) + (num(b) - num(a)) * t;
          else if (p >= 1) result[k] = b ?? a;
        });
        s.fixtureStates.set(id, result);
      });
      output();
      if (p >= 1) { stopFade(); apply(target); done?.(); } else s.chaseFading = requestAnimationFrame(tick);
    };
    s.chaseFading = requestAnimationFrame(tick);
  }
  function stopCueEffect() { window.stopEffect?.(true); }
  function startCueEffect(cue) {
    if (!cue?.effect?.type || typeof window.startEffect !== "function") return;
    const e = cue.effect;
    window.startEffect(String(e.type), { type: String(e.type), speed: num(e.speed, 1), fixtureMode: Array.isArray(e.fixtureIds) && e.fixtureIds.length ? "custom" : (e.fixtureMode || "selected"), fixtureIds: Array.isArray(e.fixtureIds) ? e.fixtureIds.map(String) : [] });
  }

  window.renderChases = function() {
    const list = document.getElementById("chaseList"), s = S(); if (!list || !s) return;
    if (!Array.isArray(s.chases)) s.chases = []; list.replaceChildren();
    if (!s.chases.length) { const e = document.createElement("div"); e.className = "empty-state"; e.textContent = "No chases yet. Click New Chase to choose cues."; list.appendChild(e); return; }
    s.chases.forEach((c, i) => {
      if (!c) return;
      const el = document.createElement("div"); el.className = `cue-item ${i === selectedChase ? "active" : ""}`;
      const title = document.createElement("strong"); title.textContent = `${i + 1}. ${c.name || `Chase ${i + 1}`}`;
      const meta = document.createElement("div"); meta.style.cssText = "font-size:11px;color:var(--text-muted);"; meta.textContent = `${Array.isArray(c.steps) ? c.steps.length : 0} cues · ${c.loop ? "🔁 Loop" : "→ Run once"}`;
      el.append(title, meta); el.onclick = () => { selectedChase = i; renderChases(); }; list.appendChild(el);
    });
  };

  window.stopChase = function(message = true) {
    const s = S(); if (!s) return; if (s.chaseTimer) clearTimeout(s.chaseTimer); s.chaseTimer = null; stopFade(); stopCueEffect(); s.currentChase = -1; renderChases(); if (message) log("⏹ Chase stopped");
  };

  window.startChase = function(index) {
    const s = S(); index = Number(index); const chase = s?.chases?.[index];
    if (!s || !Number.isInteger(index) || !chase || !Array.isArray(chase.steps) || !chase.steps.length) { log("Choose a chase containing at least one cue", "warn"); return false; }
    window.stopChase(false); s.currentChase = index; selectedChase = index; let pos = 0;
    const advance = () => {
      if (s.currentChase !== index) return;
      pos += 1;
      if (pos >= chase.steps.length) { if (chase.loop) pos = 0; else { window.stopChase(); return; } }
      const speed = Math.max(10, Math.min(100, num(chase.speed, 50)));
      s.chaseTimer = setTimeout(runStep, Math.max(50, 1000 * (100 / speed)));
    };
    const runStep = () => {
      if (s.currentChase !== index) return;
      const cueIndex = Number(chase.steps[pos]), cue = s.cues?.[cueIndex];
      if (!cue) { advance(); return; }
      stopCueEffect(); const target = buildTarget(cue); s.currentCue = cueIndex; window.renderCues?.();
      fade(target, Math.max(0, num(chase.fade, 0)), () => { if (s.currentChase !== index) return; startCueEffect(cue); log(`Chase ${index + 1} Step ${pos + 1}: Cue ${cueIndex + 1}`); advance(); });
    };
    runStep(); renderChases(); log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`}`); return true;
  };

  window.saveChase = function(name, cueIndices, loop = true, speed = 50) {
    const s = S(); if (!s) return false; if (!Array.isArray(s.chases)) s.chases = [];
    const steps = [...new Set((cueIndices || []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < (s.cues?.length || 0) && s.cues[i]))];
    if (!steps.length) { log("Choose at least one cue for the chase", "warn"); return false; }
    const chase = { name: String(name || `Chase ${s.chases.length + 1}`).trim(), steps, loop: Boolean(loop), speed: Math.max(10, Math.min(100, num(speed, 50))), fade: 0 };
    s.chases.push(chase); selectedChase = s.chases.length - 1; renderChases(); log(`✅ Saved Chase: ${chase.name} (${steps.map(i => `Cue ${i + 1}`).join(", ")})`, "ok"); return true;
  };

  function createChasePicker() {
    const s = S(); if (!s?.cues?.some(Boolean)) { log("Add at least one cue first", "warn"); return; }
    document.getElementById("chasePicker")?.remove();
    const modal = document.createElement("div"); modal.id = "chasePicker"; modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;";
    const box = document.createElement("div"); box.style.cssText = "width:min(600px,96vw);max-height:90vh;overflow:auto;background:var(--panel,#10171b);border:1px solid var(--border,#283238);border-radius:12px;padding:20px;";
    box.innerHTML = "<h3 style='margin-top:0'>Create Chase</h3><p style='color:var(--text-muted)'>Tick only the cues you want. They will play in cue-number order.</p>";
    const name = document.createElement("input"); name.value = `Chase ${(s.chases?.length || 0) + 1}`; name.placeholder = "Chase name"; name.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0 12px;padding:10px;"; box.appendChild(name);
    const checks = document.createElement("div"); checks.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    s.cues.forEach((cue, i) => { if (!cue) return; const label = document.createElement("label"); label.style.cssText = "display:flex;gap:10px;padding:9px;border:1px solid var(--border,#283238);border-radius:7px;cursor:pointer;"; const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.cue = String(i); label.append(cb, document.createTextNode(`Cue ${i + 1} — ${cue.name || `Cue ${i + 1}`}`)); checks.appendChild(label); });
    box.appendChild(checks);
    const loopLabel = document.createElement("label"); loopLabel.style.cssText = "display:flex;gap:8px;margin:14px 0;"; const loop = document.createElement("input"); loop.type = "checkbox"; loop.checked = true; loopLabel.append(loop, document.createTextNode("Loop chase")); box.appendChild(loopLabel);
    const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:16px;"; const cancel = document.createElement("button"); cancel.className = "btn-secondary"; cancel.textContent = "Cancel"; const create = document.createElement("button"); create.className = "btn-primary"; create.textContent = "Create Chase"; actions.append(cancel, create); box.appendChild(actions); modal.appendChild(box); document.body.appendChild(modal);
    cancel.onclick = () => modal.remove();
    create.onclick = () => { const selected = [...checks.querySelectorAll("input[data-cue]:checked")].map(i => Number(i.dataset.cue)); if (!selected.length) { log("Choose at least one cue for the chase", "warn"); return; } saveChase(name.value, selected, loop.checked, Number(document.getElementById("chaseSpeed")?.value || 50)); modal.remove(); };
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
  }

  function installButtons() {
    const save = document.getElementById("btnSaveChase"), run = document.getElementById("btnRunChase"), stop = document.getElementById("btnStopChase"), speed = document.getElementById("chaseSpeed"), speedVal = document.getElementById("chaseSpeedVal");
    if (speed && speedVal) { speedVal.textContent = speed.value; speed.oninput = () => speedVal.textContent = speed.value; }
    if (save && save.dataset.chaseWired !== "true") { save.dataset.chaseWired = "true"; save.onclick = createChasePicker; }
    if (run && run.dataset.chaseWired !== "true") { run.dataset.chaseWired = "true"; run.onclick = () => { const s = S(); if (selectedChase < 0 && s?.chases?.length) selectedChase = s.chases.length - 1; if (selectedChase >= 0) startChase(selectedChase); else log("Create/select a chase first", "warn"); }; }
    if (stop && stop.dataset.chaseWired !== "true") { stop.dataset.chaseWired = "true"; stop.onclick = () => stopChase(); }
  }
  function init() { installButtons(); renderChases(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
  window.addEventListener("load", installButtons, { once: true });
})();
