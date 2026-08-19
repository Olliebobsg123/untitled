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

      const map = definition && typeof definition.map === "object"
        ? definition.map
        : {};

      if (typeof map.pan === "number" || typeof map.tilt === "number") {
        nextDisplay = "";
      }
    }

    if (nextDisplay !== lastPadDisplay) {
      xyPad.style.display = nextDisplay;
      lastPadDisplay = nextDisplay;
    }
  }

  function refreshVisibility() {
    if (refreshQueued) return;
    refreshQueued = true;

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(refreshVisibilityNow);
    } else {
      setTimeout(refreshVisibilityNow, 0);
    }
  }

  window.updateControlVisibility = refreshVisibility;

  // ----------------------------------------------------------
  // STABLE FIXTURE LIST RENDERING
  // ----------------------------------------------------------
  // Selecting a fixture used to call renderFixtures(), which did:
  //
  //   list.innerHTML = "";
  //   recreate every fixture element;
  //   recreate every click handler.
  //
  // That destroys the hovered DOM node underneath the mouse. The
  // browser then has to recalculate layout/paint and the whole UI
  // visibly flashes. Keep the original renderer for real patch
  // changes, but make selection-only updates class/text changes.
  if (typeof window.renderFixtures === "function" && !window.__stableFixtureRenderer) {
    const originalRenderFixtures = window.renderFixtures;
    let lastFixtureSignature = null;
    let hasRendered = false;

    function fixtureSignature() {
      const fixtures = Array.isArray(window.State?.fixtures)
        ? window.State.fixtures
        : [];

      return JSON.stringify(fixtures.map(f => ({
        id: f?.id ?? null,
        name: f?.name ?? null,
        uni: f?.uni ?? f?.universe ?? null,
        addr: f?.addr ?? f?.address ?? f?.startAddress ?? null
      })));
    }

    function updateSelectionOnly() {
      const list = document.getElementById("fixtureList");
      const count = document.getElementById("selCount");
      const selected = window.State?.selected instanceof Set
        ? window.State.selected
        : new Set();

      if (!list) return false;

      const fixtures = Array.isArray(window.State?.fixtures)
        ? window.State.fixtures
        : [];

      // If the DOM does not match the patch, fall back to the real renderer.
      if (list.children.length !== fixtures.length) return false;

      fixtures.forEach((fixture, index) => {
        const el = list.children[index];
        if (!el || el.dataset.fixtureId !== String(fixture?.id ?? "")) {
          throw new Error("fixture DOM topology changed");
        }

        const isSelected = selected.has(fixture?.id);
        el.classList.toggle("sel", isSelected);

        // Keep the displayed intensity/output current without replacing DOM.
        const state = window.State?.fixtureStates?.get(fixture?.id);
        const intensity = Number(state?.intensity ?? state?.dimmer ?? 100);
        const p = typeof window.getFixturePhotometrics === "function"
          ? window.getFixturePhotometrics(fixture?.name)
          : null;
        const output = typeof window.calculateFixtureOutput === "function"
          ? window.calculateFixtureOutput(fixture?.name, intensity)
          : 0;
        const outputText = typeof p?.ratedLumens === "number"
          ? `${Math.round(output)} lm`
          : "manufacturer output unavailable";

        const spans = el.children;
        if (spans.length >= 2) {
          spans[1].textContent =
            `Uni ${fixture?.uni} · Addr ${fixture?.addr} · ${Math.round(intensity)}% · ${outputText}`;
        }
      });

      if (count) count.textContent = `(${selected.size} selected)`;
      return true;
    }

    window.renderFixtures = function stableRenderFixtures() {
      const signature = fixtureSignature();

      if (!hasRendered || signature !== lastFixtureSignature) {
        lastFixtureSignature = signature;
        originalRenderFixtures();
        hasRendered = true;

        // Mark the DOM so later selection changes can update it in place.
        const list = document.getElementById("fixtureList");
        const fixtures = Array.isArray(window.State?.fixtures)
          ? window.State.fixtures
          : [];
        if (list) {
          fixtures.forEach((fixture, index) => {
            const el = list.children[index];
            if (el) el.dataset.fixtureId = String(fixture?.id ?? "");
          });
        }
      } else {
        try {
          updateSelectionOnly();
        } catch (err) {
          console.warn("⚠️ Stable fixture update fell back to full render:", err.message);
          originalRenderFixtures();
        }
      }

      refreshVisibility();
    };

    window.__stableFixtureRenderer = true;
    console.log("🖥️ Stable fixture renderer enabled — selection no longer rebuilds the fixture list");
  }

  // Prevent fixture selection from making the visualiser rebuild its
  // entire Three.js fixture scene. sendToVisualizer() is also used for
  // live DMX changes, so only suppress duplicate SYNC_FIXTURES messages;
  // normal Art-Net output is completely unaffected.
  if (typeof window.sendToVisualizer === "function" && !window.__visualizerSyncGuard) {
    const originalSendToVisualizer = window.sendToVisualizer;
    let lastFixtureSignature = null;

    function visualizerFixtureSignature() {
      const fixtures = Array.isArray(window.State?.fixtures)
        ? window.State.fixtures
        : [];

      return JSON.stringify(fixtures.map(f => ({
        id: f?.id ?? null,
        name: f?.name ?? null,
        uni: f?.uni ?? f?.universe ?? null,
        addr: f?.addr ?? f?.address ?? f?.startAddress ?? null
      })));
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
      } finally {
        Window.prototype.postMessage = originalPostMessage;
      }
    };

    window.__visualizerSyncGuard = true;
    console.log("🖥️ Visualiser sync guard enabled");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshVisibility, { once: true });
  } else {
    refreshVisibility();
  }
})();
