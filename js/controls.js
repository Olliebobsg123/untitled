"use strict";

// UI-only control helpers. Input handling lives in app.js.
(function initialiseControls() {
  let lastPadDisplay = null;
  let refreshQueued = false;

  function refreshVisibilityNow() {
    refreshQueued = false;
    const xyPad = document.querySelector(".xy-pad");
    if (!xyPad) return;
    const state = window.State;
    const library = window.FixtureLibrary;
    let nextDisplay = "none";
    if (state && state.selected instanceof Set && state.selected.size) {
      const fixture = Array.isArray(state.fixtures) ? state.fixtures.find(item => state.selected.has(item?.id)) : null;
      const definition = fixture && library && typeof library === "object" ? library[fixture.name] : null;
      const map = definition && typeof definition.map === "object" ? definition.map : {};
      if (typeof map.pan === "number" || typeof map.tilt === "number") nextDisplay = "";
    }
    if (nextDisplay !== lastPadDisplay) {
      xyPad.style.display = nextDisplay;
      lastPadDisplay = nextDisplay;
    }
  }

  function refreshVisibility() {
    if (refreshQueued) return;
    refreshQueued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(refreshVisibilityNow);
    else setTimeout(refreshVisibilityNow, 0);
  }

  window.updateControlVisibility = refreshVisibility;

  if (typeof window.renderFixtures === "function" && !window.__stableFixtureRenderer) {
    const originalRenderFixtures = window.renderFixtures;
    let lastFixtureSignature = null;
    let hasRendered = false;

    function fixtureSignature() {
      const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
      return JSON.stringify(fixtures.map(f => ({ id: f?.id ?? null, fixtureNumber: f?.fixtureNumber ?? null, name: f?.name ?? null, uni: f?.uni ?? f?.universe ?? null, addr: f?.addr ?? f?.address ?? f?.startAddress ?? null })));
    }

    function updateSelectionOnly() {
      const list = document.getElementById("fixtureList");
      const count = document.getElementById("selCount");
      const selected = window.State?.selected instanceof Set ? window.State.selected : new Set();
      if (!list) return false;
      const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
      if (list.children.length !== fixtures.length) return false;
      fixtures.forEach((fixture, index) => {
        const el = list.children[index];
        if (!el || el.dataset.fixtureId !== String(fixture?.id ?? "")) throw new Error("fixture DOM topology changed");
        el.classList.toggle("sel", selected.has(fixture?.id));
        const state = window.State?.fixtureStates?.get(fixture?.id);
        const intensity = Number(state?.intensity ?? state?.dimmer ?? 100);
        const p = typeof window.getFixturePhotometrics === "function" ? window.getFixturePhotometrics(fixture?.name) : null;
        const output = typeof window.calculateFixtureOutput === "function" ? window.calculateFixtureOutput(fixture?.name, intensity) : 0;
        const outputText = typeof p?.ratedLumens === "number" ? `${Math.round(output)} lm` : "manufacturer output unavailable";
        const spans = el.children;
        if (spans.length >= 2) {
          spans[0].textContent = `#${fixture?.fixtureNumber ?? index + 1} ${fixture?.name || `Fixture ${index + 1}`}`;
          spans[1].textContent = `Uni ${fixture?.uni} · Addr ${fixture?.addr} · ${Math.round(intensity)}% · ${outputText}`;
        }
      });
      if (count) count.textContent = `(${selected.size} selected)`;
      return true;
    }

    function applyFixtureNumbers() {
      const list = document.getElementById("fixtureList");
      const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
      if (!list || list.children.length !== fixtures.length) return;
      fixtures.forEach((fixture, index) => {
        const el = list.children[index];
        if (el?.children.length >= 1) el.children[0].textContent = `#${fixture?.fixtureNumber ?? index + 1} ${fixture?.name || `Fixture ${index + 1}`}`;
      });
    }

    window.renderFixtures = function stableRenderFixtures() {
      const signature = fixtureSignature();
      if (!hasRendered || signature !== lastFixtureSignature) {
        lastFixtureSignature = signature;
        originalRenderFixtures();
        hasRendered = true;
        const list = document.getElementById("fixtureList");
        const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
        if (list) fixtures.forEach((fixture, index) => { if (list.children[index]) list.children[index].dataset.fixtureId = String(fixture?.id ?? ""); });
        applyFixtureNumbers();
      } else {
        try { updateSelectionOnly(); }
        catch (err) { console.warn("⚠️ Stable fixture update fell back to full render:", err.message); originalRenderFixtures(); applyFixtureNumbers(); }
      }
      refreshVisibility();
    };
    window.__stableFixtureRenderer = true;
    console.log("🖥️ Stable fixture renderer enabled — selection no longer rebuilds the fixture list");
  }

  if (typeof window.sendToVisualizer === "function" && !window.__visualizerSyncGuard) {
    const originalSendToVisualizer = window.sendToVisualizer;
    let lastFixtureSignature = null;
    function visualizerFixtureSignature() {
      const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
      return JSON.stringify(fixtures.map(f => ({ id: f?.id ?? null, fixtureNumber: f?.fixtureNumber ?? null, name: f?.name ?? null, uni: f?.uni ?? f?.universe ?? null, addr: f?.addr ?? f?.address ?? f?.startAddress ?? null })));
    }
    window.sendToVisualizer = function guardedSendToVisualizer() {
      const signature = visualizerFixtureSignature();
      const originalPostMessage = Window.prototype.postMessage;
      try {
        Window.prototype.postMessage = function guardedPostMessage(message, targetOrigin, transfer) {
          if (message?.type === "SYNC_FIXTURES") {
            if (signature === lastFixtureSignature) return;
            lastFixtureSignature = signature;
          }
          return originalPostMessage.call(this, message, targetOrigin, transfer);
        };
        return originalSendToVisualizer.apply(this, arguments);
      } finally { Window.prototype.postMessage = originalPostMessage; }
    };
    window.__visualizerSyncGuard = true;
    console.log("🖥️ Visualiser sync guard enabled");
  }

  // XY pad fix: only a left-click directly on the dot starts a drag.
  // The drag applies the same pan/tilt position to every selected fixture.
  if (!window.__multiFixtureXYFix) {
    window.__multiFixtureXYFix = true;

    const getSelectedFixtures = () => {
      const state = window.State;
      if (!state || !(state.selected instanceof Set) || !state.selected.size) return [];
      return [...state.selected]
        .map(id => state.fixtures?.find(f => f?.id === id))
        .filter(Boolean);
    };

    const getDefinition = fixture => {
      if (typeof window.getFixtureDefinition === "function") return window.getFixtureDefinition(fixture) || null;
      return window.FixtureLibrary?.[fixture?.name] || null;
    };

    const getState = fixture => {
      if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
      const state = window.State;
      if (!(state.fixtureStates instanceof Map)) state.fixtureStates = new Map();
      if (!state.fixtureStates.has(fixture.id)) {
        state.fixtureStates.set(fixture.id, { ...(state.current || {}), pan: 128, tilt: 128 });
      }
      return state.fixtureStates.get(fixture.id);
    };

    const isDotTarget = event => {
      const dot = document.getElementById("xy");
      const target = event?.target;
      return !!dot && (target === dot || (target && typeof target.closest === "function" && target.closest("#xy") === dot));
    };

    const getPosition = (pad, event) => {
      const rect = pad.getBoundingClientRect();
      const x = Number(event.clientX);
      const y = Number(event.clientY);
      if (!rect.width || !rect.height || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      // Do not clamp outside movement to an edge: once outside the grid,
      // the current value simply stays where it was.
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      return {
        pan: Math.round(((x - rect.left) / rect.width) * 255),
        tilt: Math.round((1 - ((y - rect.top) / rect.height)) * 255)
      };
    };

    const applyPosition = (pad, event) => {
      const position = getPosition(pad, event);
      if (!position) return;

      const selected = getSelectedFixtures();
      if (!selected.length) return;

      let changed = false;
      for (const fixture of selected) {
        const map = getDefinition(fixture)?.map || {};
        if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;

        const state = getState(fixture);
        if (!state) continue;
        if (typeof map.pan === "number") state.pan = position.pan;
        if (typeof map.tilt === "number") state.tilt = position.tilt;
        window.State.fixtureStates.set(fixture.id, state);
        changed = true;
      }

      if (!changed) return;

      window.State.current ||= {};
      window.State.current.pan = position.pan;
      window.State.current.tilt = position.tilt;

      const dot = document.getElementById("xy");
      if (dot) {
        dot.style.left = `${(position.pan / 255) * 100}%`;
        dot.style.top = `${(1 - position.tilt / 255) * 100}%`;
      }

      window.updateDMX?.();
      window.sendToVisualizer?.();
    };

    const attachXYFix = () => {
      const pad = document.querySelector(".xy-pad");
      if (!pad || pad.dataset.multiFixtureXYFix === "1") return;
      pad.dataset.multiFixtureXYFix = "1";

      const dot = document.getElementById("xy");
      if (dot) dot.style.pointerEvents = "auto";

      let dragging = false;
      let pointerId = null;

      // Capture phase is intentional: app.js has its own pad-wide pointerdown
      // handler. We stop it before it can start a drag unless the dot was hit.
      pad.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !isDotTarget(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        dragging = true;
        pointerId = event.pointerId;
        try { pad.setPointerCapture(pointerId); } catch (_) {}
        applyPosition(pad, event);
      }, true);

      // While not dragging, pointer movement is completely ignored by the XY
      // control. While dragging, only positions inside the pad are applied.
      pad.addEventListener("pointermove", event => {
        if (!dragging || event.pointerId !== pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        applyPosition(pad, event);
      }, true);

      const stopDrag = event => {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        if (dragging) event.stopImmediatePropagation();
        dragging = false;
        try { if (pointerId !== null) pad.releasePointerCapture(pointerId); } catch (_) {}
        pointerId = null;
      };

      pad.addEventListener("pointerup", stopDrag, true);
      pad.addEventListener("pointercancel", stopDrag, true);
      pad.addEventListener("lostpointercapture", () => {
        dragging = false;
        pointerId = null;
      }, true);
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachXYFix, { once: true });
    else attachXYFix();

    console.log("🎯 XY pad fixed — grab the dot to drag; all selected fixtures follow");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshVisibility, { once: true });
  else refreshVisibility();
})();
