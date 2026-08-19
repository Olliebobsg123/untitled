"use strict";

// UI-only control helpers. Input handling lives in app.js.
(function initialiseControls() {
  function refreshVisibility() {
    const xyPad = document.querySelector(".xy-pad");
    if (!xyPad) return;

    const state = window.State;
    const library = window.FixtureLibrary;

    if (!state || !(state.selected instanceof Set) || !state.selected.size) {
      xyPad.style.display = "none";
      return;
    }

    const fixture = Array.isArray(state.fixtures)
      ? state.fixtures.find(item => state.selected.has(item?.id))
      : null;

    const definition = fixture && library && typeof library === "object"
      ? library[fixture.name]
      : null;

    const map = definition && typeof definition.map === "object"
      ? definition.map
      : {};

    xyPad.style.display =
      typeof map.pan === "number" || typeof map.tilt === "number"
        ? ""
        : "none";
  }

  window.updateControlVisibility = refreshVisibility;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshVisibility, { once: true });
  } else {
    refreshVisibility();
  }
})();
