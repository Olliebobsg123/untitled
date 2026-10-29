"use strict";

/*
 * The Effects page: your saved effects and every built-in effect as a
 * preset on the left, the editor in its own panel on the right.
 *
 *   Presets   one per effect type, in groups (Frozen, Intensity, Colour…).
 *             Click one to load it into the editor; ▶ runs it on the
 *             selected lights straight away.
 *   Editor    always open: name, type, speed or follow tempo, which lights,
 *             Save / Apply live / Delete (js/effects.js wires those).
 */
(function () {
  if (window.LXEffectsPage) return;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const FIRST = ["Frozen: snow & ice", "Intensity", "Colour", "Basics", "Movement", "Beam"];

  // The effect types, grouped as the editor's Type list groups them.
  function presets() {
    const select = $("effectType");
    if (!select) return [];
    const groups = new Map();
    for (const opt of select.querySelectorAll("option")) {
      const group = opt.parentElement.tagName === "OPTGROUP" ? opt.parentElement.label : "Basics";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ type: opt.value, name: opt.textContent.replace(/\s*\(.*\)\s*$/, "").trim(), full: opt.textContent.trim() });
    }
    return [...groups.entries()].sort((a, b) => (FIRST.indexOf(a[0]) + 99) % 99 - (FIRST.indexOf(b[0]) + 99) % 99);
  }

  // Folded or open, remembered per section.
  const openState = (() => { try { return JSON.parse(localStorage.getItem("lx-fx-open") || "{}") || {}; } catch (_) { return {}; } })();
  const remember = (key, open) => { openState[key] = open; try { localStorage.setItem("lx-fx-open", JSON.stringify(openState)); } catch (_) {} };
  const isOpen = (key, fallback) => (key in openState ? openState[key] : fallback);

  // Your effects in sections: yours first, then each auto-made kind, folded.
  function regroup() {
    const list = $("effectsList");
    const cards = list ? [...list.children].filter(c => c.classList.contains("effect-card")) : [];
    if (!cards.length) return;
    const saved = window.State?.savedEffects || {};
    const groups = new Map();
    for (const card of cards) {
      const effect = saved[card.dataset.effectName] || {};
      const kind = effect.auto ? `Auto-made · ${(/^([^:]+?):/.exec(String(effect.name || "")) || [, "Other"])[1]}` : "Your effects";
      if (!groups.has(kind)) groups.set(kind, []);
      const label = card.querySelector("strong");
      if (effect.auto && label) label.textContent = String(effect.name || "").replace(/^[^:]+?:\s*/, "");
      groups.get(kind).push(card);
    }
    const sections = [...groups.entries()].sort((a, b) => (a[0] === "Your effects" ? -1 : b[0] === "Your effects" ? 1 : a[0].localeCompare(b[0]))).map(([kind, items]) => {
      const auto = kind !== "Your effects";
      const d = document.createElement("details");
      d.className = `fxp-sec ${auto ? "auto" : "mine"}`;
      d.open = isOpen(kind, !auto);
      d.innerHTML = `<summary>${esc(kind)} <small>${items.length}</small></summary><div class="fxp-cards"></div>`;
      d.querySelector(".fxp-cards").append(...items);
      d.addEventListener("toggle", () => remember(kind, d.open));
      return d;
    });
    list.replaceChildren(...sections);
  }

  function renderPresets() {
    const host = $("fxpPresets");
    if (!host) return;
    host.innerHTML = presets().map(([group, items]) => `
      <div class="fxp-group"><h3>${esc(group)}</h3><div class="fxp-grid">${items.map(p => `
        <div class="fxp-preset" data-type="${esc(p.type)}" data-name="${esc(p.name)}" title="${esc(p.full)} — click to edit, ▶ to run on the selected lights">
          <span>${esc(p.name)}</span><button type="button" class="fxp-run" title="Run on the selected lights">▶</button>
        </div>`).join("")}</div></div>`).join("");
  }

  function load(type, name) {
    const saved = window.State?.savedEffects || {};
    let unique = name, n = 2;
    while (saved[unique]) unique = `${name} ${n++}`;
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set("effectName", unique);
    set("effectType", type);
    set("effectSpeed", "1");
    set("effectBeats", "");
    if ($("effectFixtureMode")) {
      $("effectFixtureMode").value = "selected";
      window.State.effectTargetMode = "selected";
      window.State.effectTargetIds = new Set([...(window.State.selected || [])].map(String));
    }
    window.fxRenderEffectTargetUI?.();
    const title = $("fxpTitle");
    if (title) title.textContent = `New: ${name}`;
    $("effectName")?.focus();
  }

  function install(tries = 0) {
    const page = $("page-effects"), editor = $("effectEditor"), list = $("effectsList");
    if (!page || !editor || !list || !$("effectType")) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if (page.classList.contains("fxp")) return;
    page.classList.add("fxp");
    // The editor gets its own panel.
    const side = document.createElement("section");
    side.className = "panel fxp-editor";
    side.innerHTML = `<div class="panel-header"><div><span class="eyebrow">EDIT</span> <span id="fxpTitle">Effect</span></div><span class="panel-meta">CLICK ONE ON THE LEFT</span></div><div class="panel-body"></div>`;
    side.querySelector(".panel-body").appendChild(editor);
    page.appendChild(side);
    // The presets: between your effects and the auto-made ones (shell.css
    // orders them).
    const wrap = document.createElement("details");
    wrap.className = "fxp-sec presets";
    wrap.open = isOpen("Presets", true);
    wrap.innerHTML = `<summary>Presets — every effect, ready to use</summary><div id="fxpPresets"></div>`;
    wrap.addEventListener("toggle", () => remember("Presets", wrap.open));
    list.after(wrap);
    const host = $("fxpPresets");
    renderPresets();
    regroup();
    new MutationObserver(() => { if ([...list.children].some(c => c.classList.contains("effect-card"))) regroup(); }).observe(list, { childList: true });
    host.addEventListener("click", e => {
      const card = e.target.closest(".fxp-preset");
      if (!card) return;
      if (e.target.closest(".fxp-run")) {
        if (!(window.State?.selected?.size > 0)) { window.log?.("Select some lights first, then ▶ runs it on them", "warn"); return; }
        window.startEffect?.(card.dataset.type, { speed: 1, fixtureMode: "selected", name: card.dataset.name });
        return;
      }
      host.querySelectorAll(".fxp-preset.on").forEach(x => x.classList.remove("on"));
      card.classList.add("on");
      load(card.dataset.type, card.dataset.name);
    });
    // Clicking one of your effects names the editor after it.
    list.addEventListener("click", e => {
      const card = e.target.closest(".effect-card");
      const title = $("fxpTitle");
      if (card && title) title.textContent = card.dataset.effectName || "Effect";
      host.querySelectorAll(".fxp-preset.on").forEach(x => x.classList.remove("on"));
    });
  }

  window.LXEffectsPage = { presets, load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
