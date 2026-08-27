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
      const fixture = Array.isArray(state.fixtures)
        ? state.fixtures.find(item => state.selected.has(item?.id))
        : null;
      const definition = fixture && library && typeof library === "object"
        ? library[fixture.name]
        : null;
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
      return JSON.stringify(fixtures.map(f => ({
        id: f?.id ?? null,
        fixtureNumber: f?.fixtureNumber ?? null,
        name: f?.name ?? null,
        uni: f?.uni ?? f?.universe ?? null,
        addr: f?.addr ?? f?.address ?? f?.startAddress ?? null
      })));
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

  // Multi-fixture pan/tilt fix.
  // IMPORTANT: do not listen on window for pointer events. The old implementation
  // did that, which made the XY pad react to mouse/pointer movement anywhere on
  // the page. Instead, attach only to the actual XY pad and only while dragging.
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
      if (!state.fixtureStates.has(fixture.id)) state.fixtureStates.set(fixture.id, { ...(state.current || {}), pan: 128, tilt: 128 });
      return state.fixtureStates.get(fixture.id);
    };

    const applyMultiFixtureXY = event => {
      const pad = document.querySelector(".xy-pad");
      if (!pad || !event) return;

      const selected = getSelectedFixtures();
      if (selected.length <= 1) return;

      const rect = pad.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const clientX = Number(event.clientX);
      const clientY = Number(event.clientY);
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;

      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const pan = Math.round(x * 255);
      const tilt = Math.round((1 - y) * 255);

      let changed = 0;
      for (const fixture of selected) {
        const map = getDefinition(fixture)?.map || {};
        if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
        const state = getState(fixture);
        if (!state) continue;
        if (typeof map.pan === "number") state.pan = pan;
        if (typeof map.tilt === "number") state.tilt = tilt;
        window.State.fixtureStates.set(fixture.id, state);
        changed++;
      }

      if (!changed) return;
      window.State.current ||= {};
      window.State.current.pan = pan;
      window.State.current.tilt = tilt;

      const dot = document.getElementById("xy");
      if (dot) {
        dot.style.left = `${(pan / 255) * 100}%`;
        dot.style.top = `${(1 - tilt / 255) * 100}%`;
      }
      if (typeof window.updateDMX === "function") window.updateDMX();
      if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();
    };

    // Listen ONLY on the pad. Pointer capture/dragging remains owned by app.js;
    // these events merely mirror the final pad position to the other selected
    // fixtures. A click or movement outside the pad can no longer affect XY.
    const attachXYFix = () => {
      const pad = document.querySelector(".xy-pad");
      if (!pad || pad.dataset.multiFixtureXYFix === "1") return;
      pad.dataset.multiFixtureXYFix = "1";
      pad.addEventListener("pointerdown", applyMultiFixtureXY);
      pad.addEventListener("pointermove", applyMultiFixtureXY);
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachXYFix, { once: true });
    else attachXYFix();

    console.log("🎯 Multi-fixture pan/tilt fix enabled — XY input is pad-only");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshVisibility, { once: true });
  else refreshVisibility();
})();
