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
  // Programmer presentation. The controls remain functional; this
  // only changes how the existing control cards are presented.
  // BASIC / BEAM / CUSTOM are real views rather than scroll targets.
  // ------------------------------------------------------------
  function ensureProgrammerStyles() {
    if (document.getElementById("lxProgrammerControlStyles")) return;

    const style = document.createElement("style");
    style.id = "lxProgrammerControlStyles";
    style.textContent = `
      #controlPanel {
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: #0d1013 !important;
        box-shadow: none !important;
        overflow: hidden auto;
        scrollbar-width: thin;
        scrollbar-color: #39434a #0d1013;
      }

      #controlPanel::-webkit-scrollbar { width: 7px; }
      #controlPanel::-webkit-scrollbar-track { background: #0d1013; }
      #controlPanel::-webkit-scrollbar-thumb { background: #39434a; border: 2px solid #0d1013; }
      #controlPanel::-webkit-scrollbar-thumb:hover { background: #4b575e; }

      #controlPanel .control-deck-header {
        min-height: 34px;
        height: 34px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #252c31;
        background: #101317;
        position: sticky;
        top: 0;
        z-index: 10;
      }

      #controlPanel .control-deck-header > div {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }

      #controlPanel .control-deck-header .eyebrow {
        color: #20d5a5;
        font-family: var(--mono, monospace);
        font-size: 8px;
        font-weight: 800;
        letter-spacing: .12em;
      }

      #controlPanel .control-deck-header strong {
        color: #e0e7e5;
        font-family: var(--mono, monospace);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .08em;
      }

      #controlPanel .deck-led {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #19d6a3;
        box-shadow: 0 0 7px rgba(25,214,163,.65);
      }

      #controlPanel .lx-programmer-tabs {
        height: 31px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        border-bottom: 1px solid #252c31;
        background: #0b0e11;
        position: sticky;
        top: 34px;
        z-index: 9;
      }

      #controlPanel .lx-programmer-tab {
        position: relative;
        height: 30px;
        padding: 0 8px;
        border: 0;
        border-right: 1px solid #20272c;
        background: transparent;
        color: #697572;
        font-family: var(--mono, monospace);
        font-size: 8px;
        font-weight: 900;
        letter-spacing: .14em;
        cursor: pointer;
      }

      #controlPanel .lx-programmer-tab:last-child { border-right: 0; }
      #controlPanel .lx-programmer-tab:hover { color: #e6eeeb; background: rgba(255,255,255,.025); }
      #controlPanel .lx-programmer-tab.is-active { color: #f2f7f5; background: rgba(25,214,163,.055); }
      #controlPanel .lx-programmer-tab.is-active::after {
        content: "";
        position: absolute;
        left: 14px;
        right: 14px;
        bottom: 0;
        height: 2px;
        background: #19d6a3;
      }

      #controlPanel .lx-programmer-pages {
        padding: 0 10px 12px;
      }

      #controlPanel .lx-programmer-page {
        display: none;
        min-width: 0;
      }

      #controlPanel .lx-programmer-page.is-active {
        display: block;
        animation: lxProgrammerPageIn .14s ease-out;
      }

      @keyframes lxProgrammerPageIn {
        from { opacity: .45; transform: translateY(2px); }
        to { opacity: 1; transform: translateY(0); }
      }

      #controlPanel > .master-card {
        margin: 9px 10px 0 !important;
        padding: 0 0 9px !important;
        border: 0 !important;
        border-bottom: 1px solid #252c31 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      #controlPanel .master-card .fader { height: 26px; }
      #controlPanel .master-card input[type="range"]::-webkit-slider-runnable-track {
        background: linear-gradient(90deg, #7544ff, #25d7de);
        border-color: #29343a;
      }
      #controlPanel .master-card input[type="range"]::-webkit-slider-thumb {
        width: 14px;
        height: 14px;
        margin-top: -5px;
        background: #c24cff;
        border: 2px solid #0b1013;
        box-shadow: 0 0 0 1px #8e42ff, 0 0 7px rgba(195,76,255,.22);
      }

      #controlPanel .lx-programmer-page > .parameter-card,
      #controlPanel .lx-programmer-page > .dynamic-controls {
        margin: 0 !important;
      }

      #controlPanel .parameter-card {
        padding: 11px 2px 13px !important;
        border: 0 !important;
        border-bottom: 1px solid #20272c !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      #controlPanel .parameter-card:last-child { border-bottom: 0 !important; }

      #controlPanel .control-heading {
        min-height: 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      #controlPanel .control-label {
        color: #dce5e2;
        font-family: var(--mono, monospace);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .075em;
        text-transform: uppercase;
      }

      #controlPanel .control-heading small {
        display: block;
        margin-top: 2px;
        color: #596662;
        font-family: var(--mono, monospace);
        font-size: 7px;
        font-weight: 700;
        letter-spacing: .07em;
        text-transform: uppercase;
      }

      #controlPanel .fader-val,
      #controlPanel .big-value {
        color: #93a09c;
        font-family: var(--mono, monospace);
        font-size: 9px;
        font-weight: 900;
        white-space: nowrap;
      }

      #controlPanel .big-value { color: #20d5a5; font-size: 10px; }
      #controlPanel .big-value em { color: #5d6966; font-style: normal; font-size: 8px; }

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
        background: repeating-linear-gradient(90deg, #2c373d 0 1px, transparent 1px 12px), #11181c;
        border: 1px solid #202a30;
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
        border: 1px solid #29343a;
        border-radius: 2px;
      }

      #controlPanel input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        margin-top: -5px;
        border-radius: 50%;
        border: 2px solid #0c1114;
        background: #19d6a3;
        box-shadow: 0 0 0 1px #19d6a3, 0 0 7px rgba(25,214,163,.22);
      }

      #controlPanel input[type="range"]::-moz-range-track {
        height: 4px;
        background: #182126;
        border: 1px solid #29343a;
        border-radius: 2px;
      }

      #controlPanel input[type="range"]::-moz-range-thumb {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 2px solid #0c1114;
        background: #19d6a3;
      }

      #controlPanel .dynamic-controls {
        padding-top: 10px;
      }

      #controlPanel .selection-empty {
        min-height: 56px;
        padding: 9px 0;
        display: grid;
        grid-template-columns: 30px minmax(0,1fr);
        grid-template-rows: auto auto;
        column-gap: 9px;
        align-items: center;
        border-top: 1px solid #20272c;
        border-bottom: 1px solid #20272c;
        background: transparent;
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
        font-size: 12px;
      }

      #controlPanel .selection-empty strong {
        color: #cbd5d1;
        font-family: var(--mono, monospace);
        font-size: 8px;
        letter-spacing: .07em;
        text-transform: uppercase;
      }

      #controlPanel .selection-empty p { color: #586461; font-size: 7px; line-height: 1.35; margin: 0; }

      #controlPanel .colour-card { padding-top: 10px !important; }
      #controlPanel .colour-wheel { width: min(100%, 188px); margin: 5px auto 8px; }
      #controlPanel .colour-wheel canvas { display: block; width: 100%; height: auto; }
      #controlPanel .colour-swatch { width: 100%; height: 18px; border: 1px solid #303a40; background: #151b1f; }

      #controlPanel .xy-pad {
        min-height: 155px;
        height: 155px;
        border: 1px solid #29343a;
        border-radius: 2px;
        background:
          linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px),
          #0a0f12;
        background-size: 25% 25%;
        position: relative;
        overflow: hidden;
      }

      #controlPanel .xy-dot {
        width: 12px;
        height: 12px;
        border: 2px solid #0a1012;
        background: #19d6a3;
        box-shadow: 0 0 0 1px #19d6a3, 0 0 9px rgba(25,214,163,.45);
      }

      #controlPanel .xy-home-control { margin-top: 6px; }
      #controlPanel #btnHome {
        width: 100%;
        min-height: 26px;
        padding: 0 8px;
        border: 1px solid #29353a;
        border-radius: 2px;
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

  function classifyProgrammerCard(card) {
    const text = `${card.id || ""} ${card.className || ""} ${card.textContent || ""}`.toLowerCase();
    if (/pan|tilt|xy|position|rotation|custom/.test(text)) return "custom";
    if (/strobe|gobo|zoom|focus|prism|iris|frost|shutter|beam/.test(text)) return "beam";
    return "basic";
  }

  function setupProgrammerPages() {
    const panel = document.getElementById("controlPanel");
    if (!panel) return false;
    if (panel.dataset.programmerPagesReady === "1") return true;

    const header = panel.querySelector(".control-deck-header");
    if (header) {
      header.querySelector(".eyebrow")?.replaceChildren("PROGRAMMER");
      header.querySelector("strong")?.replaceChildren("LIVE PARAMETERS");
    }

    const master = panel.querySelector(":scope > .master-card");
    const cards = Array.from(panel.children).filter(el => {
      if (el === master) return false;
      if (el.classList.contains("lx-programmer-tabs") || el.classList.contains("lx-programmer-pages")) return false;
      return el.classList.contains("parameter-card") || el.classList.contains("dynamic-controls");
    });

    if (!cards.length) return false;

    const tabs = document.createElement("div");
    tabs.className = "lx-programmer-tabs";
    tabs.setAttribute("role", "tablist");

    const pages = document.createElement("div");
    pages.className = "lx-programmer-pages";

    const pageMap = new Map();
    [
      ["basic", "BASIC"],
      ["beam", "BEAM"],
      ["custom", "CUSTOM"]
    ].forEach(([key, label], index) => {
      const page = document.createElement("section");
      page.className = `lx-programmer-page${index === 0 ? " is-active" : ""}`;
      page.dataset.programmerPage = key;
      page.setAttribute("role", "tabpanel");
      pageMap.set(key, page);

      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `lx-programmer-tab${index === 0 ? " is-active" : ""}`;
      tab.textContent = label;
      tab.dataset.programmerPage = key;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", index === 0 ? "true" : "false");

      tab.addEventListener("click", () => {
        tabs.querySelectorAll(".lx-programmer-tab").forEach(other => {
          const active = other === tab;
          other.classList.toggle("is-active", active);
          other.setAttribute("aria-selected", active ? "true" : "false");
        });
        pageMap.forEach((view, viewKey) => view.classList.toggle("is-active", viewKey === key));
        panel.dataset.programmerPage = key;
      });

      tabs.appendChild(tab);
      pages.appendChild(page);
    });

    cards.forEach(card => {
      const category = classifyProgrammerCard(card);
      pageMap.get(category)?.appendChild(card);
    });

    if (master) {
      const headerTabs = panel.querySelector(".lx-programmer-tabs");
      if (headerTabs) headerTabs.remove();
      const existingPages = panel.querySelector(".lx-programmer-pages");
      if (existingPages) existingPages.remove();
      panel.insertBefore(tabs, panel.firstChild === master ? master.nextSibling : panel.firstChild);
      panel.appendChild(pages);
    } else {
      panel.prepend(tabs);
      panel.appendChild(pages);
    }

    panel.dataset.programmerPagesReady = "1";
    panel.dataset.programmerPage = "basic";
    return true;
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

  const initialiseProgrammerPresentation = () => {
    ensureProgrammerStyles();
    setupProgrammerPages();
    refreshVisibility();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseProgrammerPresentation, { once: true });
  else initialiseProgrammerPresentation();
})();
