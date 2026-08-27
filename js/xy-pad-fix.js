"use strict";

// Final XY-pad input layer. This runs after app.js so the app's pad-wide
// pointer handlers cannot turn ordinary mouse movement/clicks into pan/tilt.
(function installXYPadFix() {
  function install() {
    const pad = document.querySelector(".xy-pad");
    if (!pad || pad.dataset.finalXYFix === "1") return;
    pad.dataset.finalXYFix = "1";

    const dot = document.getElementById("xy");
    if (!dot) return;
    dot.style.pointerEvents = "auto";

    let dragging = false;
    let pointerId = null;

    const selectedFixtures = () => {
      const state = window.State;
      if (!state?.selected || !(state.selected instanceof Set) || !state.selected.size) return [];
      return [...state.selected]
        .map(id => state.fixtures?.find(f => f?.id === id))
        .filter(Boolean);
    };

    const definitionFor = fixture => {
      if (typeof window.getFixtureDefinition === "function") return window.getFixtureDefinition(fixture) || null;
      return window.FixtureLibrary?.[fixture?.name] || null;
    };

    const stateFor = fixture => {
      if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
      const state = window.State;
      if (!(state.fixtureStates instanceof Map)) state.fixtureStates = new Map();
      if (!state.fixtureStates.has(fixture.id)) {
        state.fixtureStates.set(fixture.id, { ...(state.current || {}), pan: 128, tilt: 128 });
      }
      return state.fixtureStates.get(fixture.id);
    };

    const isDot = event => {
      const target = event?.target;
      return target === dot || (target && typeof target.closest === "function" && target.closest("#xy") === dot);
    };

    const position = event => {
      const rect = pad.getBoundingClientRect();
      const x = Number(event.clientX);
      const y = Number(event.clientY);
      if (!rect.width || !rect.height || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      return {
        pan: Math.round(((x - rect.left) / rect.width) * 255),
        tilt: Math.round((1 - ((y - rect.top) / rect.height)) * 255)
      };
    };

    const apply = event => {
      const pos = position(event);
      if (!pos) return;

      const selected = selectedFixtures();
      if (!selected.length) return;

      let changed = false;
      for (const fixture of selected) {
        const map = definitionFor(fixture)?.map || {};
        if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
        const state = stateFor(fixture);
        if (!state) continue;
        if (typeof map.pan === "number") state.pan = pos.pan;
        if (typeof map.tilt === "number") state.tilt = pos.tilt;
        window.State.fixtureStates.set(fixture.id, state);
        changed = true;
      }

      if (!changed) return;

      window.State.current ||= {};
      window.State.current.pan = pos.pan;
      window.State.current.tilt = pos.tilt;
      dot.style.left = `${(pos.pan / 255) * 100}%`;
      dot.style.top = `${(1 - pos.tilt / 255) * 100}%`;
      window.updateDMX?.();
      window.sendToVisualizer?.();
    };

    // Capture phase deliberately consumes every pad pointer event before
    // app.js sees it. Only a left-button press directly on the dot can start.
    pad.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !isDot(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragging = true;
      pointerId = event.pointerId;
      try { pad.setPointerCapture(pointerId); } catch (_) {}
      apply(event);
    }, true);

    pad.addEventListener("pointermove", event => {
      if (!dragging || event.pointerId !== pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      apply(event);
    }, true);

    const stop = event => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      if (dragging) event.stopImmediatePropagation();
      dragging = false;
      try { if (pointerId !== null) pad.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
    };

    pad.addEventListener("pointerup", stop, true);
    pad.addEventListener("pointercancel", stop, true);
    pad.addEventListener("lostpointercapture", () => {
      dragging = false;
      pointerId = null;
    }, true);

    console.log("🎯 Final XY pad fix enabled — grab dot only; all selected fixtures follow");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
