"use strict";

// The visualiser's saved layout: where each fixture hangs, where fixed
// fixtures are aimed, and the view settings (house/work lights, haze…).
//
// It lives here in the console (State.visualizer), not in the visualiser
// window, so it is saved with the show and survives the visualiser being
// closed. The visualiser sends every change back as VIZ_LAYOUT; the console
// sends the layout to it as LOAD_LAYOUT when it opens and when a show loads.
(() => {
  if (window.LXVisualizer) return;

  const STORE = "lighting-visualizer-layout";
  const object = value => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  const clone = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({ version: 2, positions: {}, aims: {}, settings: {} });

  function normalise(layout) {
    if (!layout || typeof layout !== "object" || layout.version !== 2) return null;
    return { version: 2, positions: object(layout.positions), aims: object(layout.aims), settings: object(layout.settings) };
  }

  // Show files from the old visualiser stored positions in its own scene
  // units and by list position; only the view settings carry over.
  function fromOldShow(layout) {
    if (!layout || typeof layout !== "object") return null;
    return { ...empty(), settings: { grid: layout.gridOn !== false, house: Boolean(layout.houseOn), work: Boolean(layout.workOn) } };
  }

  function saved() {
    try { return normalise(JSON.parse(localStorage.getItem(STORE) || "null")); } catch (_) { return null; }
  }

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(State.visualizer)); } catch (_) {}
  }

  let visualizer = null;
  function send() {
    if (visualizer && !visualizer.closed) visualizer.postMessage({ type: "LOAD_LAYOUT", layout: clone(State.visualizer) }, "*");
  }

  State.visualizer = normalise(State.visualizer) || saved() || empty();

  window.addEventListener("message", event => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "VISUALIZER_READY") {
      visualizer = event.source;
      send();
    } else if (message.type === "VIZ_LAYOUT" && event.source === visualizer) {
      const layout = normalise(message.layout);
      if (!layout) return;
      State.visualizer = layout;
      persist();
    }
  });

  window.LXVisualizer = Object.freeze({
    layout: () => clone(State.visualizer),
    toShow: () => clone(State.visualizer),
    fromShow(layout) {
      State.visualizer = normalise(layout) || fromOldShow(layout) || empty();
      persist();
      send();
    }
  });
})();
