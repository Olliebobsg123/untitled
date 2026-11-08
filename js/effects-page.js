"use strict";

/*
 * The Effects page: tap an effect to run it, tap again to stop it.
 *
 * It runs on the lights selected now (with nothing selected, on the lights
 * the effect was saved with, if it has any).
 *
 * Running effects are lit up. Recording a cue keeps the effects running on
 * its lights (js/cues.js), colours and all. "Edit" opens the effect editor.
 */
(function () {
  if (window.__fxPage) return;
  window.__fxPage = true;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(m, t);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function css() {
    if (document.getElementById("fxPageStyle")) return;
    const st = document.createElement("style");
    st.id = "fxPageStyle";
    st.textContent = `
  .effect-card{position:relative}
  .effect-card.running{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
  .effect-card.running strong::before{content:"● ";color:var(--accent)}
  .effect-card strong,.effect-card small{padding-right:46px}
  .effect-card .fx-edit{position:absolute;top:6px;right:6px;height:22px;padding:0 8px;border:1px solid var(--border-strong);border-radius:var(--r-sm);background:var(--bg-0);color:var(--text-soft);font:700 10px var(--sans);cursor:pointer}
  .effect-card .fx-edit:hover{color:var(--text)}`;
    document.head.appendChild(st);
  }

  function allIds() { return (S().fixtures || []).filter(f => f && f.id != null).map(f => String(f.id)); }
  function targetsFor(effect) {
    const sel = [...(S().selected || [])].map(String);
    if (sel.length) return sel;
    if (effect.fixtureMode === "all") return allIds();
    return (effect.fixtureIds || []).map(String);
  }
  const runningOf = effect => (S().effects || []).filter(e => e && (e.name || "") === (effect.name || ""));

  function toggle(effect) {
    const running = runningOf(effect);
    if (running.length) {
      for (const e of running) window.stopEffectsOn?.([...e.ids], false);
      say(`Stopped ${effect.name}`, "info");
      render();
      return;
    }
    const ids = targetsFor(effect);
    if (!ids.length) { say(`Select the lights first, then tap the effect`, "warn"); return; }
    const ok = window.applyEffectToFixtures?.(effect, ids);
    if (ok !== false) say(`${effect.name} running on ${ids.length} light${ids.length === 1 ? "" : "s"} — record a cue to keep it`, "ok");
    render();
  }

  function edit(effect) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set("effectName", effect.name);
    set("effectType", effect.type);
    set("effectSpeed", effect.speed);
    set("effectBeats", effect.beats > 0 ? String(effect.beats) : "");
    S().effectTargetIds = new Set(effect.fixtureIds || []);
    const ed = document.getElementById("effectEditor");
    if (ed) { ed.style.display = "block"; ed.scrollIntoView?.({ block: "nearest" }); }
    try { window.fxRenderEffectTargetUI?.(); } catch (_) {}
  }

  function render() {
    css();
    const list = document.getElementById("effectsList");
    if (!list) return;
    const effects = Object.values(S().savedEffects || {}).filter(Boolean);
    list.innerHTML = "";
    if (!effects.length) { list.innerHTML = '<div class="empty-state">No saved effects. Make one with New Effect.</div>'; return; }
    for (const effect of effects) {
      const card = document.createElement("div");
      card.className = "effect-card" + (runningOf(effect).length ? " running" : "");
      card.dataset.effectName = effect.name;
      card.dataset.effect = effect.type;
      card.style.cursor = "pointer";
      const pace = effect.beats > 0 ? window.LXTempo?.describeBeats?.(effect.beats) || `${effect.beats} beats` : `${effect.speed} speed`;
      card.innerHTML = `<strong>${esc(effect.name)}</strong><small>${esc(effect.type)} · ${esc(pace)}</small><button type="button" class="fx-edit" title="Edit this effect">Edit</button>`;
      card.addEventListener("click", e => {
        const saved = S().savedEffects?.[card.dataset.effectName]; if (!saved) return;
        if (e.target.closest(".fx-edit")) edit(saved); else toggle(saved);
      });
      list.appendChild(card);
    }
    try { window.wireEffectButtons?.(); } catch (_) {}
  }

  window.renderEffectsList = render;
  window.LXEffectsPage = { render, toggle, targetsFor };
  // Keep "running" up to date when effects start or stop elsewhere (cues, commands).
  setInterval(() => { if (document.getElementById("page-effects")?.classList.contains("active")) {
    const now = (S().effects || []).map(e => e.name || "").join("|");
    if (now !== render.last) { render.last = now; render(); }
  } }, 700);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
