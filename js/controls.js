"use strict";



// UI-only control helpers. Multi-fixture Pan/Tilt and Home live here.
(function initialiseControls() {
  const getSelectedFixtures = () => {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures)) return [];
    const ids = new Set();
    if (state.selected instanceof Set) state.selected.forEach(id => ids.add(String(id)));
    document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el => ids.add(String(el.dataset.fixtureId)));
    if (!ids.size && state.selectedFixtureId != null) ids.add(String(state.selectedFixtureId));
    return state.fixtures.filter(f => ids.has(String(f?.id)));
  };

  const getDefinition = fixture => {
    if (!fixture) return null;
    if (typeof window.getFixtureDefinition === "function") return window.getFixtureDefinition(fixture) || null;
    return window.FixtureLibrary?.[fixture.name] || null;
  };

  const getState = fixture => {
    if (!fixture) return null;
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    const state = window.State;
    if (!(state.fixtureStates instanceof Map)) state.fixtureStates = new Map();
    if (!state.fixtureStates.has(fixture.id)) state.fixtureStates.set(fixture.id, { ...(state.current || {}), pan: 128, tilt: 128 });
    return state.fixtureStates.get(fixture.id);
  };

  // ------------------------------------------------------------
  // LMX-inspired programmer deck presentation.
  // This stays in controls.js so the existing control hooks/IDs are
  // untouched; the actual lighting behaviour below remains unchanged.
  // ------------------------------------------------------------
  function ensureProgrammerStyles() {
    if (document.getElementById("lxProgrammerControlStyles")) return;

    const style = document.createElement("style");
    style.id = "lxProgrammerControlStyles";
    style.textContent = `
      #controlPanel {
        padding: 0 !important;
        border-radius: 4px !important;
        border: 1px solid #252d31 !important;
        background: #0b0d10 !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.018), 0 10px 24px rgba(0,0,0,.24) !important;
        scrollbar-width: thin;
        scrollbar-color: #384248 #0b0d10;
      }

      #controlPanel::-webkit-scrollbar { width: 7px; }
      #controlPanel::-webkit-scrollbar-track { background: #0b0d10; }
      #controlPanel::-webkit-scrollbar-thumb { background: #384248; border: 2px solid #0b0d10; }
      #controlPanel::-webkit-scrollbar-thumb:hover { background: #4a565c; }

      #controlPanel .control-deck-header {
        min-height: 36px;
        height: 36px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #252d31;
        background: #0e1115;
        position: sticky;
        top: 0;
        z-index: 8;
      }

      #controlPanel .control-deck-header > div {
        display: flex;
        align-items: baseline;
        gap: 7px;
        min-width: 0;
      }

      #controlPanel .control-deck-header .eyebrow {
        margin-right: 0;
        color: #22d9aa;
        font-family: var(--mono, monospace);
        font-size: 8px;
        letter-spacing: .12em;
      }

      #controlPanel .control-deck-header strong {
        color: #d9e2df;
        font-family: var(--mono, monospace);
        font-size: 9px;
        letter-spacing: .08em;
        font-weight: 900;
      }

      #controlPanel .deck-led {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #19d6a3;
        box-shadow: 0 0 8px rgba(25,214,163,.72);
        flex: 0 0 auto;
      }

      #controlPanel .lx-programmer-tabs {
        min-height: 30px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-bottom: 1px solid #252d31;
        background: #090b0e;
        position: sticky;
        top: 36px;
        z-index: 7;
      }

      #controlPanel .lx-programmer-tab {
        height: 29px;
        border: 0;
        border-right: 1px solid #1f272b;
        background: transparent;
        color: #6d7977;
        font-family: var(--mono, monospace);
        font-size: 8px;
        font-weight: 900;
        letter-spacing: .13em;
        cursor: pointer;
        position: relative;
      }

      #controlPanel .lx-programmer-tab:last-child { border-right: 0; }
      #controlPanel .lx-programmer-tab:hover { color: #dbe5e2; background: rgba(255,255,255,.025); }
      #controlPanel .lx-programmer-tab.is-active { color: #f2f7f5; background: rgba(25,214,163,.065); }
      #controlPanel .lx-programmer-tab.is-active::after {
        content: "";
        position: absolute;
        left: 9px;
        right: 9px;
        bottom: 0;
        height: 2px;
        background: #19d6a3;
      }

      #controlPanel > .master-card,
      #controlPanel > .dynamic-controls,
      #controlPanel > .parameter-card {
        margin: 8px 9px 0;
      }

      #controlPanel > .master-card {
        margin-top: 9px;
        padding: 9px;
        border: 1px solid #2a3439;
        border-radius: 3px;
        background: #101419;
      }

      #controlPanel .control-group {
        gap: 7px;
      }

      #controlPanel .parameter-card {
        padding: 8px 9px 10px;
        border: 1px solid #242d32;
        border-radius: 3px;
        background: #0f1317;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.012);
      }

      #controlPanel .control-heading {
        min-height: 22px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      #controlPanel .control-heading > div { min-width: 0; }

      #controlPanel .control-label {
        color: #e1e8e6;
        font-family: var(--mono, monospace);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      #controlPanel .control-heading small {
        display: block;
        margin-top: 2px;
        color: #596563;
        font-family: var(--mono, monospace);
        font-size: 7px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      #controlPanel .fader-val,
      #controlPanel .big-value {
        color: #8c9a96;
        font-family: var(--mono, monospace);
        font-size: 9px;
        font-weight: 900;
        white-space: nowrap;
      }

      #controlPanel .big-value { color: #19d6a3; font-size: 11px; }
      #controlPanel .big-value em { color: #62706d; font-style: normal; font-size: 8px; }

      #controlPanel .fader {
        position: relative;
        height: 25px;
        display: flex;
        align-items: center;
      }

      #controlPanel .fader::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: 4px;
        transform: translateY(-50%);
        background: repeating-linear-gradient(90deg, #283238 0 1px, transparent 1px 12px), #11181c;
        border: 1px solid #1f292e;
        pointer-events: none;
      }

      #controlPanel input[type="range"] {
        width: 100%;
        height: 25px;
        margin: 0;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        cursor: pointer;
        position: relative;
        z-index: 1;
      }

      #controlPanel input[type="range"]::-webkit-slider-runnable-track {
        height: 4px;
        background: #182126;
        border: 1px solid #2a353b;
        border-radius: 0;
      }

      #controlPanel input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 13px;
        height: 13px;
        margin-top: -5px;
        border-radius: 50%;
        border: 2px solid #0c1114;
        background: #19d6a3;
        box-shadow: 0 0 0 1px #19d6a3, 0 0 8px rgba(25,214,163,.25);
      }

      #controlPanel input[type="range"]::-moz-range-track { height: 4px; background: #182126; border: 1px solid #2a353b; border-radius: 0; }
      #controlPanel input[type="range"]::-moz-range-thumb { width: 11px; height: 11px; border-radius: 50%; border: 2px solid #0c1114; background: #19d6a3; }

      #controlPanel .master-card .fader { height: 28px; }
      #controlPanel .master-card input[type="range"]::-webkit-slider-thumb {
        width: 15px;
        height: 15px;
        background: #c34cff;
        box-shadow: 0 0 0 1px #8e42ff, 0 0 8px rgba(195,76,255,.22);
      }

      #controlPanel .master-card input[type="range"]::-webkit-slider-runnable-track {
        background: linear-gradient(90deg, #7a42ff, #29d8df);
        border-color: #29353b;
      }

      #controlPanel .dynamic-controls {
        min-height: 54px;
      }

      #controlPanel .selection-empty {
        min-height: 54px;
        padding: 8px;
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        grid-template-rows: auto auto;
        column-gap: 8px;
        align-items: center;
        border: 1px solid #20292e;
        border-radius: 3px;
        background: #0d1114;
      }

      #controlPanel .selection-empty .empty-icon {
        grid-row: 1 / -1;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 1px solid #29343a;
        color: #596764;
        font-family: var(--mono, monospace);
        font-size: 13px;
      }

      #controlPanel .selection-empty strong { color: #c8d1ce; font-family: var(--mono, monospace); font-size: 8px; letter-spacing: .07em; text-transform: uppercase; }
      #controlPanel .selection-empty p { color: #586461; font-size: 7px; line-height: 1.35; margin: 0; }

      #controlPanel .colour-card {
        padding-bottom: 9px;
      }

      #controlPanel .colour-wheel {
        width: min(100%, 190px);
        margin: 6px auto 7px;
      }

      #controlPanel .colour-wheel canvas {
        display: block;
        width: 100%;
        height: auto;
        image-rendering: auto;
      }

      #controlPanel .colour-swatch {
        width: 100%;
        height: 18px;
        border: 1px solid #303b40;
        background: #151b1f;
      }

      #controlPanel .xy-pad {
        min-height: 150px;
        height: 150px;
        border: 1px solid #2a353a;
        border-radius: 2px;
        background:
          linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px),
          #0a0f12;
        background-size: 25% 25%;
        position: relative;
        overflow: hidden;
      }

      #controlPanel .xy-crosshair.x,
      #controlPanel .xy-crosshair.y {
        background: rgba(25,214,163,.25);
      }

      #controlPanel .xy-dot {
        width: 12px;
        height: 12px;
        border: 2px solid #0a1012;
        background: #19d6a3;
        box-shadow: 0 0 0 1px #19d6a3, 0 0 10px rgba(25,214,163,.5);
      }

      #controlPanel .xy-home-control {
        margin-top: 6px;
      }

      #controlPanel #btnHome {
        width: 100%;
        min-height: 25px;
        padding: 0 8px;
        border-radius: 2px;
        border: 1px solid #29353a;
        background: #11171b;
        color: #9aa7a4;
        font-family: var(--mono, monospace);
        font-size: 8px;
        font-weight: 900;
        letter-spacing: .08em;
      }

      #controlPanel #btnHome:hover { border-color: #19d6a3; color: #eff5f3; background: #151d21; }

      @media (max-width: 1100px) {
        #controlPanel .colour-wheel { width: min(100%, 160px); }
        #controlPanel .xy-pad { height: 130px; min-height: 130px; }
      }
    `;
    document.head?.appendChild(style);
  }

  function decorateProgrammerDeck() {
    const panel = document.getElementById("controlPanel");
    if (!panel || panel.dataset.programmerDeckDecorated === "1") return !!panel;
    panel.dataset.programmerDeckDecorated = "1";

    const header = panel.querySelector(".control-deck-header");
    if (header) {
      const eyebrow = header.querySelector(".eyebrow");
      const title = header.querySelector("strong");
      if (eyebrow) eyebrow.textContent = "PROGRAMMER";
      if (title) title.textContent = "LIVE PARAMETERS";
    }

    const tabs = document.createElement("div");
    tabs.className = "lx-programmer-tabs";
    tabs.setAttribute("role", "tablist");

    const destinations = [
      ["BASIC", () => document.getElementById("intensity")?.closest(".parameter-card") || document.getElementById("intensity")],
      ["BEAM", () => document.getElementById("strobeGroup") || document.getElementById("zoomGroup") || document.getElementById("dynamicControls")],
      ["CUSTOM", () => document.getElementById("xyGroup") || document.querySelector(".xy-pad")]
    ];

    destinations.forEach(([label, getTarget], index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "lx-programmer-tab";
      tab.textContent = label;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
      tab.addEventListener("click", () => {
        const target = getTarget();
        if (target?.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        tabs.querySelectorAll(".lx-programmer-tab").forEach(el => {
          const active = el === tab;
          el.classList.toggle("is-active", active);
          el.setAttribute("aria-selected", active ? "true" : "false");
        });
      });
      if (index === 0) tab.classList.add("is-active");
      tabs.appendChild(tab);
    });

    header?.insertAdjacentElement("afterend", tabs);
    return true;
  }

  ensureProgrammerStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", decorateProgrammerDeck, { once: true });
  } else {
    decorateProgrammerDeck();
  }

  if (!document.querySelector('link[data-home-button-css]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "home-button.css";
    link.dataset.homeButtonCss = "1";
    document.head?.appendChild(link);
  }

  let refreshQueued = false;
  function refreshVisibilityNow() {
    refreshQueued = false;
    const pad = document.querySelector(".xy-pad");
    if (!pad) return;
    const moving = getSelectedFixtures().some(f => {
      const map = getDefinition(f)?.map || {};
      return typeof map.pan === "number" || typeof map.tilt === "number";
    });
    pad.style.display = moving ? "" : "none";
  }
  function refreshVisibility() {
    if (refreshQueued) return;
    refreshQueued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(refreshVisibilityNow);
    else setTimeout(refreshVisibilityNow, 0);
  }
  window.updateControlVisibility = refreshVisibility;

  // Capture the XY pointer events before app.js. app.js's original handler
  // uses activeFixture(), which is only the last selected fixture.
  if (!window.__multiFixtureXYFix) {
    window.__multiFixtureXYFix = true;
    const attach = () => {
      const pad = document.querySelector(".xy-pad");
      if (!pad || pad.dataset.multiFixtureXYFix === "1") return !!pad;
      pad.dataset.multiFixtureXYFix = "1";
      pad.style.touchAction = "none";
      pad.style.userSelect = "none";
      let dragging = false;
      let pointerId = null;

      const positionFromEvent = e => {
        const rect = pad.getBoundingClientRect();
        const touch = e.touches?.[0] || e.changedTouches?.[0];
        const x = Number(e.clientX ?? touch?.clientX);
        const y = Number(e.clientY ?? touch?.clientY);
        if (!rect.width || !rect.height || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          pan: Math.round(Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * 255),
          tilt: Math.round((1 - Math.max(0, Math.min(1, (y - rect.top) / rect.height))) * 255)
        };
      };

      const apply = e => {
        const values = positionFromEvent(e);
        if (!values) return;
        const fixtures = getSelectedFixtures();
        if (!fixtures.length) {
          window.log?.("Select a fixture first", "warn");
          return;
        }
        let changed = false;
        for (const fixture of fixtures) {
          const map = getDefinition(fixture)?.map || {};
          if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
          const state = getState(fixture);
          if (!state) continue;
          if (typeof map.pan === "number") state.pan = values.pan;
          if (typeof map.tilt === "number") state.tilt = values.tilt;
          window.State.fixtureStates.set(fixture.id, state);
          changed = true;
        }
        if (!changed) return;
        window.State.current ||= {};
        window.State.current.pan = values.pan;
        window.State.current.tilt = values.tilt;
        const dot = document.getElementById("xy");
        if (dot) {
          dot.style.left = `${(values.pan / 255) * 100}%`;
          dot.style.top = `${(1 - values.tilt / 255) * 100}%`;
        }
        window.updateDMX?.();
        window.sendToVisualizer?.();
      };

      // Handle the whole pad, not just the existing dot. stopImmediatePropagation
      // prevents app.js's single-fixture handler from running afterwards.
      pad.addEventListener("pointerdown", e => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        dragging = true;
        pointerId = e.pointerId;
        try { pad.setPointerCapture(e.pointerId); } catch {}
        apply(e);
      }, true);
      pad.addEventListener("pointermove", e => {
        if (!dragging || e.pointerId !== pointerId) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        apply(e);
      }, true);
      const stop = e => {
        if (pointerId !== null && e.pointerId !== pointerId) return;
        e.stopImmediatePropagation?.();
        try { if (pointerId !== null) pad.releasePointerCapture(pointerId); } catch {}
        dragging = false;
        pointerId = null;
      };
      pad.addEventListener("pointerup", stop, true);
      pad.addEventListener("pointercancel", stop, true);
      pad.addEventListener("lostpointercapture", () => { dragging = false; pointerId = null; }, true);

      pad.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        dragging = true;
        apply(e);
      }, true);
      window.addEventListener("mousemove", e => { if (dragging) apply(e); }, true);
      window.addEventListener("mouseup", () => { dragging = false; }, true);
      return true;
    };
    let attempts = 0;
    const waitForPad = () => { if (attach()) return; if (++attempts < 150) setTimeout(waitForPad, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForPad, { once: true });
    else waitForPad();
  }

  if (!window.__homePanTiltControl) {
    window.__homePanTiltControl = true;
    const homeSelectedPanTilt = () => {
      const fixtures = getSelectedFixtures();
      if (!fixtures.length) {
        window.log?.("Select a fixture first", "warn");
        return;
      }
      let homed = 0;
      for (const fixture of fixtures) {
        const map = getDefinition(fixture)?.map || {};
        if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
        const state = getState(fixture);
        if (!state) continue;
        if (typeof map.pan === "number") state.pan = 128;
        if (typeof map.tilt === "number") state.tilt = 128;
        window.State.fixtureStates.set(fixture.id, state);
        homed++;
      }
      if (!homed) {
        window.log?.("Selected fixtures have no Pan/Tilt controls", "warn");
        return;
      }
      window.State.current ||= {};
      window.State.current.pan = 128;
      window.State.current.tilt = 128;
      window.updateDMX?.();
      window.sendToVisualizer?.();
      const dot = document.getElementById("xy");
      if (dot) { dot.style.left = "50%"; dot.style.top = "50%"; }
      window.log?.(`Homed Pan/Tilt for ${homed} selected fixture${homed === 1 ? "" : "s"}`, "ok");
    };

    const installHomeButton = () => {
      const existing = document.getElementById("btnHome");
      if (existing) {
        existing.onclick = e => { e.preventDefault(); homeSelectedPanTilt(); };
        return true;
      }
      const xy = document.querySelector(".xy-pad");
      if (!xy) return false;
      const wrapper = document.createElement("div");
      wrapper.className = "xy-home-control";
      const button = document.createElement("button");
      button.id = "btnHome";
      button.type = "button";
      button.className = "btn-secondary";
      button.textContent = "⌂ HOME";
      button.title = "Centre Pan/Tilt for selected fixtures";
      button.setAttribute("aria-label", "Home selected fixtures Pan/Tilt");
      button.addEventListener("click", homeSelectedPanTilt);
      wrapper.appendChild(button);
      xy.insertAdjacentElement("afterend", wrapper);
      return true;
    };
    let attempts = 0;
    const waitForHomeButton = () => { if (installHomeButton()) return; if (++attempts < 150) setTimeout(waitForHomeButton, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForHomeButton, { once: true });
    else waitForHomeButton();
  }

  

  if (!window.__strobeControl) {
    window.__strobeControl = true;
    const $ = id => document.getElementById(id);
    const applyStrobe = value => {
      const strobe = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
      const fixtures = getSelectedFixtures();
      if (!fixtures.length) return;
      for (const fixture of fixtures) {
        const state = getState(fixture);
        if (!state) continue;
        state.strobe = strobe;
        window.State.fixtureStates.set(fixture.id, state);
      }
      window.State.current ||= {};
      window.State.current.strobe = strobe;
      $("strobeVal")?.replaceChildren(String(strobe));
      window.updateDMX?.();
      window.sendToVisualizer?.();
    };
    const installStrobe = () => {
      const slider = $("strobe");
      if (!slider) return false;
      slider.min = "0";
      slider.max = "255";
      slider.step = "1";
      if (!slider.dataset.controlsStrobeBound) {
        slider.dataset.controlsStrobeBound = "1";
        slider.addEventListener("input", () => applyStrobe(slider.value));
        slider.addEventListener("change", () => applyStrobe(slider.value));
      }
      return true;
    };
    let attempts = 0;
    const waitForStrobe = () => { if (installStrobe()) return; if (++attempts < 150) setTimeout(waitForStrobe, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForStrobe, { once: true });
    else waitForStrobe();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshVisibility, { once: true });
  else refreshVisibility();
})();
