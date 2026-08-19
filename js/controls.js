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

    // Avoid forcing layout/style recalculation when the visibility has not
    // actually changed. This is especially important while clicking fixtures.
    if (nextDisplay !== lastPadDisplay) {
      xyPad.style.display = nextDisplay;
      lastPadDisplay = nextDisplay;
    }
  }

  function refreshVisibility() {
    if (refreshQueued) return;
    refreshQueued = true;

    // Coalesce multiple selection/render calls into one layout update.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(refreshVisibilityNow);
    } else {
      setTimeout(refreshVisibilityNow, 0);
    }
  }

  window.updateControlVisibility = refreshVisibility;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshVisibility, { once: true });
  } else {
    refreshVisibility();
  }
})();
