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

  if (!document.querySelector('link[data-home-button-css]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "home-button.css";
    link.dataset.homeButtonCss = "1";
    document.head?.appendChild(link);
  }

  // Keep the controls.js UI confined to the Live Control workspace.
  // Blind mode uses the same page, so its controls remain available there too.
  let controlPageObserver = null;
  function refreshControlPanelPageVisibility() {
    const panel = document.getElementById("controlPanel");
    if (!panel) return false;
    const livePage = document.getElementById("page-live");
    const visible = !!livePage && livePage.classList.contains("active");
    panel.style.display = visible ? "" : "none";
    document.body?.classList.toggle("control-panel-hidden", !visible);
    return true;
  }

  function watchControlPanelPageVisibility() {
    refreshControlPanelPageVisibility();
    if (controlPageObserver || !document.body) return;
    controlPageObserver = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === "attributes" && m.attributeName === "class")) {
        refreshControlPanelPageVisibility();
      }
    });
    controlPageObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    if (!document.getElementById("controlPanelWorkspaceStyle")) {
      const style = document.createElement("style");
      style.id = "controlPanelWorkspaceStyle";
      style.textContent = `
        @media (min-width: 901px) {
          body.control-panel-hidden {
            grid-template-columns: 58px minmax(0, 1fr);
            grid-template-areas:
              "sidebar topbar"
              "sidebar workspace"
              "sidebar bottom-row"
              "sidebar cmd-line";
          }
          body.control-panel-hidden:has(.sidebar:hover) {
            grid-template-columns: 214px minmax(0, 1fr);
          }
        }
      `;
      document.head?.appendChild(style);
    }
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

  const initialiseControlUI = () => {
    watchControlPanelPageVisibility();
    refreshVisibility();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseControlUI, { once: true });
  else initialiseControlUI();
})();
