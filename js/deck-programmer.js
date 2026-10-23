"use strict";

/*
 * The Control Deck shows what's in the programmer.
 *
 *   - A fader, the colour wheel or the pan/tilt pad shows "Not set" when
 *     nothing in the programmer (command line, Control Deck, palettes, the
 *     magic sheet, point & shoot, a cue inserted from the Cue Inspector) has
 *     set that attribute for the light the deck is showing — after Clear Programmer,
 *     or when a cue is in control. Move it and it's set again.
 *   - Colour tab: R, G, B and W faders for lights with those channels. They
 *     drive the same colour as the wheel (R/G/B become hue, saturation and
 *     lightness), so the two always agree.
 *   - Cue Inspector → "Insert into Control Deck": clears the programmer and
 *     loads what the chosen cue programs — a tracked cue's own changes, or
 *     for a block cue whatever isn't left at the fixture's defaults — and
 *     selects those lights. Everything else stays "Not set".
 *
 * Who set what comes from Fixture Info's tracking (js/fixture-info.js).
 *
 *   LXDeck.isSet(ids, keys)   LXDeck.insertCue(index)   LXDeck.programmed(index)
 */
(function () {
  if (window.LXDeck) return;

  const S = () => window.State;
  const PROGRAMMER = new Set(["command", "deck", "palette", "magic", "focus", "manual", "insert"]);
  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const mapOf = f => defOf(f)?.map || {};
  const $ = id => document.getElementById(id);

  function selectedFixtures() {
    const s = S();
    const sel = s?.selected instanceof Set ? s.selected : new Set();
    return (s?.fixtures || []).filter(f => f && sel.has(f.id));
  }
  function activeFixture() {
    const list = selectedFixtures();
    return list.find(f => f.id === S().selectedFixtureId) || list[0] || null;
  }

  // Any of these lights has any of these keys set by the programmer.
  function isSet(ids, keys) {
    const info = window.LXFixtureInfo;
    if (!info?.owners) return true;
    for (const id of ids) {
      const owners = info.owners(id);
      for (const key of keys) {
        const o = owners[info.attrOf ? info.attrOf(key) : key];
        if (o && PROGRAMMER.has(o.kind)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------- RGB / W faders

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hslToRgb(h, s, l) {
    h = ((Number(h) || 0) % 360 + 360) % 360; s = clamp(Number(s) || 0, 0, 100) / 100; l = clamp(Number(l ?? 50), 0, 100) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, hh = h / 60, x = c * (1 - Math.abs((hh % 2) - 1)), m = l - c / 2;
    const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map(v => Math.round((v + m) * 255));
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { hue: 0, sat: 0, light: l * 100 };
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { hue: h * 60, sat: s * 100, light: l * 100 };
  }

  const hasRGB = f => ["r", "g", "b"].every(k => typeof mapOf(f)[k] === "number");
  const hasW = f => typeof mapOf(f).w === "number";

  function buildRGBW() {
    const host = $("controlTabColour");
    if (!host || $("rgbwGroup")) return;
    const card = document.createElement("div");
    card.className = "control-group parameter-card";
    card.id = "rgbwGroup";
    card.innerHTML = `
      <div class="control-heading"><div><span class="control-label">Red · Green · Blue · White</span><small>COLOUR MIX</small></div></div>
      ${[["r", "Red", "#ff4f62"], ["g", "Green", "#5ad34f"], ["b", "Blue", "#3d9bff"], ["w", "White", "#e8eef0"]].map(([k, label, c]) => `
        <div class="dynamic-field lx-rgbw" data-rgbw="${k}" data-lx-keys="${k === "w" ? "w" : "hue,sat,light"}">
          <span class="dynamic-field-label" style="color:${c}">${label}</span>
          <input type="range" min="0" max="255" step="1" value="0" class="dynamic-mini-fader" style="accent-color:${c}" data-rgbw-input="${k}">
          <strong class="dynamic-field-val" data-rgbw-val="${k}">0</strong>
        </div>`).join("")}`;
    const wheel = $("colourGroup");
    if (wheel?.parentElement === host) wheel.after(card); else host.prepend(card);
    card.addEventListener("input", e => {
      const input = e.target.closest("[data-rgbw-input]");
      if (!input) return;
      window.LXFixtureInfo?.act("deck", "Control Deck", "a slider or button you moved", 1500, selectedFixtures().map(f => f.id));
      const k = input.dataset.rgbwInput, v = Number(input.value);
      card.querySelector(`[data-rgbw-val="${k}"]`).textContent = String(v);
      const fixtures = selectedFixtures();
      if (k === "w") {
        fixtures.filter(hasW).forEach(f => { window.ensureFixtureState(f.id).w = v; });
      } else {
        const now = [..."rgb"].map(c => Number(card.querySelector(`[data-rgbw-input="${c}"]`).value));
        const hsl = rgbToHsl(...now);
        fixtures.filter(f => hasRGB(f) || mapOf(f).colour != null || ["cyan", "magenta", "yellow"].every(c => typeof mapOf(f)[c] === "number"))
          .forEach(f => Object.assign(window.ensureFixtureState(f.id), hsl));
        Object.assign(S().current ||= {}, hsl);
      }
      touched.set(input.closest("[data-lx-keys]"), performance.now());
      window.updateDMX?.();
      window.sendToVisualizer?.();
      if (k !== "w") window.syncControlsFromSelection?.();
    });
  }

  function syncRGBW(fixtures) {
    const card = $("rgbwGroup");
    if (!card) return;
    const rgb = fixtures.some(hasRGB), w = fixtures.some(hasW);
    card.style.display = rgb || w ? "" : "none";
    card.querySelectorAll('[data-rgbw="r"], [data-rgbw="g"], [data-rgbw="b"]').forEach(el => { el.style.display = rgb ? "" : "none"; });
    card.querySelector('[data-rgbw="w"]').style.display = w ? "" : "none";
    const f = activeFixture();
    if (!f) return;
    const st = window.ensureFixtureState?.(f.id) || {};
    const [r, g, b] = hslToRgb(st.hue, st.sat ?? 100, st.light ?? 50);
    const values = { r, g, b, w: Math.round(Number(st.w ?? st.white ?? 0)) };
    for (const [k, v] of Object.entries(values)) {
      const input = card.querySelector(`[data-rgbw-input="${k}"]`);
      if (!input || input === document.activeElement && input.matches(":active")) continue;
      if (Number(input.value) !== v) input.value = String(v);
      const out = card.querySelector(`[data-rgbw-val="${k}"]`);
      if (out.textContent !== String(v)) out.textContent = String(v);
    }
  }

  // -------------------------------------------------------- "Not set"

  // Which part of the deck shows which attribute.
  function controls() {
    const list = [];
    const card = (id, keys) => { const el = $(id); if (el) list.push({ el, keys, input: el.querySelector('input[type="range"]') }); };
    const intensity = $("intensity")?.closest(".parameter-card");
    if (intensity) list.push({ el: intensity, keys: ["intensity"], input: $("intensity") });
    card("zoomGroup", ["zoom"]);
    card("strobeGroup", ["strobe"]);
    card("xyGroup", ["pan", "tilt"]);
    card("colourGroup", ["hue", "sat", "light"]);
    document.querySelectorAll("#controlPanel .dynamic-field input[data-dynamic-control]").forEach(input => {
      list.push({ el: input.closest(".dynamic-field"), keys: [input.dataset.dynamicControl], input });
    });
    document.querySelectorAll("#controlPanel [data-lx-keys]").forEach(el => list.push({ el, keys: el.dataset.lxKeys.split(","), input: el.querySelector('input[type="range"]') }));
    return list;
  }

  const touched = new WeakMap(); // control → when it was last moved
  let pointerDown = false;
  function tick() {
    const panel = $("controlPanel");
    if (!panel || !S()) return;
    buildRGBW();
    const fixtures = selectedFixtures();
    syncRGBW(fixtures);
    // The deck shows the lead fixture's values, so it shows whether they're set.
    const lead = activeFixture();
    const ids = lead ? [lead.id] : [];
    let becameSet = false;
    const unset = [];
    for (const c of controls()) {
      if (!c.el) continue;
      const recent = performance.now() - (touched.get(c.el) || 0) < 1200;
      const set = !ids.length || recent || isSet(ids, c.keys);
      const was = !c.el.classList.contains("lx-notset");
      if (set !== was) {
        c.el.classList.toggle("lx-notset", !set);
        if (set) becameSet = true;
      }
      if (!c.el.querySelector(":scope > .lx-notset-tag, :scope > .control-heading > .lx-notset-tag")) {
        const tag = document.createElement("span");
        tag.className = "lx-notset-tag";
        tag.textContent = "Not set";
        (c.el.querySelector(":scope > .control-heading") || c.el).appendChild(tag);
      }
      if (!set) unset.push(c);
    }
    // Something just became set (or the deck was showing zeros): show the real values again.
    if (becameSet && !pointerDown) {
      window.syncControlsFromSelection?.();
      const f = activeFixture();
      const st = f && window.ensureFixtureState?.(f.id);
      if (st) document.querySelectorAll("#controlPanel .dynamic-field:not(.lx-notset) input[data-dynamic-control]").forEach(input => {
        const v = Math.round(Number(st[input.dataset.dynamicControl]) || 0);
        input.value = String(v);
        const out = $(`dynamic-${input.dataset.dynamicControl}-val`);
        if (out) out.textContent = String(v);
      });
    }
    // Set faders follow the live values (a fade from the command line, a
    // palette or MIDI moves them too), unless you're holding one.
    if (!pointerDown) followLive(unset);
    // A fader that isn't set sits at the bottom, like an empty channel.
    for (const c of unset) if (c.input && !(pointerDown && c.el.contains(document.activeElement)) && c.input.value !== c.input.min) c.input.value = c.input.min;
  }

  let lastLive = "";
  function followLive(unset) {
    const f = activeFixture();
    const st = f && window.ensureFixtureState?.(f.id);
    if (!st) return;
    const skip = new Set(unset.map(c => c.input));
    const put = (input, out, v) => {
      if (!input || skip.has(input) || input === document.activeElement) return;
      const text = String(Math.round(Number(v) || 0));
      if (input.value !== text) input.value = text;
      if (out && out.textContent !== text) out.textContent = text;
    };
    put($("intensity"), $("intVal"), st.intensity);
    put($("zoom"), $("zoomVal"), st.zoom);
    put($("strobe"), $("strobeVal"), st.strobe);
    document.querySelectorAll("#controlPanel input[data-dynamic-control]").forEach(input => put(input, $(`dynamic-${input.dataset.dynamicControl}-val`), st[input.dataset.dynamicControl]));
    // The wheel and the pan/tilt pad redraw through the deck's own code.
    const key = [st.hue, st.sat, st.light, st.pan, st.tilt].map(v => Math.round((Number(v) || 0) * 10)).join();
    if (key !== lastLive) { lastLive = key; window.syncControlsFromSelection?.(); }
  }

  document.addEventListener("pointerdown", e => { if (e.target.closest?.("#controlPanel")) pointerDown = true; }, true);
  document.addEventListener("pointerup", () => { pointerDown = false; }, true);
  // Moving a control sets it at once (Fixture Info catches up a moment later).
  document.addEventListener("input", e => {
    const el = e.target.closest?.("#controlPanel .parameter-card, #controlPanel .dynamic-field");
    if (!el) return;
    touched.set(el, performance.now());
    el.classList.remove("lx-notset");
  }, true);
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest?.("#xyGroup, #colourGroup");
    if (el) { touched.set(el, performance.now()); el.classList.remove("lx-notset"); }
  }, true);

  // ------------------------------------------------------ insert a cue

  // What a cue programs, per light: a tracked cue's own changes; for a
  // block cue, lights that are on and whatever isn't at its default.
  const DEFAULTS = { hue: 0, sat: 0, light: 100, pan: 128, tilt: 128, intensity: 0 };
  const SKIP = /^(master|__)/;
  const PARTS = [["hue", "sat", "light"], ["pan", "tilt", "panf", "tiltf"], ["r", "g", "b"]];
  function programmed(index) {
    const cue = S().cues?.[index];
    const map = new Map();
    if (!cue) return map;
    if (cue.mode === "track") {
      (cue.fixtureStates || []).forEach(([id, part]) => {
        const keep = Object.fromEntries(Object.entries(part || {}).filter(([k]) => !SKIP.test(k)));
        if (Object.keys(keep).length) map.set(id, keep);
      });
      return map;
    }
    const look = window.getCueTarget(cue).fixtureMap;
    look.forEach((st, id) => {
      if (!(Number(st.intensity) > 0)) return;
      const keep = {};
      for (const [k, v] of Object.entries(st)) {
        if (SKIP.test(k) || typeof v !== "number") continue;
        if (k === "intensity" || Math.abs(v - (DEFAULTS[k] ?? 0)) > 1e-6) keep[k] = v;
      }
      // Colour and position only make sense whole: red is hue 0 like the
      // default, and a mover can sit at pan 128 while its tilt has moved.
      for (const group of PARTS) if (group.some(k => k in keep)) for (const k of group) if (typeof st[k] === "number") keep[k] = st[k];
      map.set(id, keep);
    });
    return map;
  }

  function insertCue(index) {
    const s = S();
    const cue = s.cues?.[index];
    if (!cue) { window.log?.(`That cue wasn't found`, "warn"); return false; }
    const map = programmed(index);
    if (!map.size) { window.log?.(`Cue ${window.cueLabel(index)} doesn't program anything to insert`, "warn"); return false; }
    window.clearProgrammer?.({ insert: { index, map } });
    s.selected = new Set(map.keys());
    s.selectedFixtureId = [...map.keys()][0];
    window.renderFixtures?.();
    window.syncControlsFromSelection?.();
    window.log?.(`Cue ${window.cueLabel(index)} “${cue.name || `Cue ${window.cueLabel(index)}`}” inserted into the Control Deck — ${map.size} light${map.size === 1 ? "" : "s"} selected, what the cue doesn't program is Not set`, "ok");
    return true;
  }

  function installInspectorButton() {
    const row = $("btnUpdateCue")?.parentElement;
    if (!row || $("btnInsertDeck")) return;
    const button = document.createElement("button");
    button.className = "btn-secondary";
    button.id = "btnInsertDeck";
    button.type = "button";
    button.textContent = "⇩ Insert into Control Deck";
    button.title = "Clear the programmer and load what this cue programs into the Control Deck";
    button.addEventListener("click", () => {
      const index = Number($("inspectCueSelect")?.value);
      if (!Number.isInteger(index) || !S().cues?.[index]) return window.log?.("Pick a cue first", "warn");
      insertCue(index);
    });
    row.appendChild(button);
  }

  function injectStyles() {
    if ($("lxDeckStyles")) return;
    const style = document.createElement("style");
    style.id = "lxDeckStyles";
    style.textContent = `
      .lx-notset-tag{display:none;margin-left:auto;padding:1px 6px;border:1px dashed #3a474d;border-radius:4px;color:#6f7d7a;font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap}
      .lx-notset > .lx-notset-tag,.lx-notset > .control-heading > .lx-notset-tag{display:inline-block}
      .lx-notset > .control-heading .fader-val,.lx-notset > .dynamic-field-val{display:none}
      .lx-notset input[type="range"]{opacity:.35}
      .lx-notset .xy-dot,.lx-notset .wheel-indicator{opacity:0}
      .lx-notset .colour-wheel{opacity:.4;filter:saturate(.35)}
      .lx-notset .colour-swatch{background:repeating-linear-gradient(135deg,#141c20 0 6px,#0e1519 6px 12px)!important;box-shadow:none!important}
      .lx-notset .xy-pad{opacity:.55}
      .dynamic-field.lx-notset .dynamic-field-label{color:#6f7d7a}
      #rgbwGroup .dynamic-field{display:grid;grid-template-columns:52px minmax(0,1fr) 34px;align-items:center;gap:8px}
      #rgbwGroup .dynamic-field.lx-notset{grid-template-columns:52px minmax(0,1fr) auto}
    `;
    document.head.appendChild(style);
  }

  function boot() {
    injectStyles();
    installInspectorButton();
    buildRGBW();
    setInterval(() => { try { tick(); installInspectorButton(); } catch (e) { console.warn("[DECK]", e); } }, 200);
  }
  window.addEventListener("load", () => setTimeout(boot, 700));

  window.LXDeck = Object.freeze({ isSet, insertCue, programmed, rgbToHsl, hslToRgb });
})();
