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

  // Prevent fixture selection from making the visualiser rebuild its
  // entire Three.js fixture scene. sendToVisualizer() is also used for
  // live DMX changes, so only suppress duplicate SYNC_FIXTURES messages;
  // normal Art-Net output is completely unaffected.
  if (typeof window.sendToVisualizer === "function" && !window.__visualizerSyncGuard) {
    const originalSendToVisualizer = window.sendToVisualizer;
    let lastFixtureSignature = null;

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

    window.sendToVisualizer = function guardedSendToVisualizer() {
      const signature = fixtureSignature();
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
