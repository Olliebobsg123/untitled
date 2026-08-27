"use strict";

(() => {
  if (window.__strobeSliderInstalled) return;
  window.__strobeSliderInstalled = true;

  const $ = id => document.getElementById(id);
  let attempts = 0;

  const getSelectedFixtures = () => {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures)) return [];
    const ids = state.selected instanceof Set ? [...state.selected] : [];
    if (!ids.length && state.selectedFixtureId != null) ids.push(state.selectedFixtureId);
    return state.fixtures.filter(f => ids.some(id => String(id) === String(f?.id)));
  };

  const getFixtureState = fixture => {
    if (!fixture) return null;
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    if (!(window.State.fixtureStates instanceof Map)) window.State.fixtureStates = new Map();
    if (!window.State.fixtureStates.has(fixture.id)) {
      window.State.fixtureStates.set(fixture.id, { ...(window.State.current || {}), strobe: 0 });
    }
    return window.State.fixtureStates.get(fixture.id);
  };

  const applyStrobe = value => {
    const strobe = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    const fixtures = getSelectedFixtures();
    if (!fixtures.length) return;

    for (const fixture of fixtures) {
      const state = getFixtureState(fixture);
      if (!state) continue;
      state.strobe = strobe;
      window.State.fixtureStates.set(fixture.id, state);
    }

    window.State.current ||= {};
    window.State.current.strobe = strobe;
    $("strobeVal")?.replaceChildren(String(strobe));
    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();
  };

  const install = () => {
    const existing = $("strobe");
    if (existing) {
      existing.min = "0";
      existing.max = "255";
      existing.step = "1";
      existing.setAttribute("aria-label", "Strobe");
      return true;
    }

    const intensity = $("intensity");
    if (!intensity) return false;

    const sourceRow = intensity.closest(".form-row") || intensity.parentElement;
    if (!sourceRow?.parentElement) return false;
    if ($("liveStrobeRow")) return true;

    const row = document.createElement("div");
    row.className = sourceRow.className || "form-row";
    row.id = "liveStrobeRow";
    row.innerHTML = '<label>Strobe <strong id="strobeVal">0</strong></label><input type="range" id="strobe" min="0" max="255" step="1" value="0">';
    sourceRow.parentElement.insertBefore(row, sourceRow.nextSibling);

    const slider = $("strobe");
    slider.addEventListener("input", () => applyStrobe(slider.value));
    slider.addEventListener("change", () => applyStrobe(slider.value));
    return true;
  };

  const waitForControls = () => {
    if (install()) return;
    attempts += 1;
    if (attempts < 150) setTimeout(waitForControls, 100);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForControls, { once: true });
  else waitForControls();
})();
