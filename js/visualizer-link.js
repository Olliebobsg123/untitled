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
    // venue: the stage design from Build mode (js/visualizer/venue.js), or null for the default theatre.
    return { version: 2, positions: object(layout.positions), aims: object(layout.aims), settings: object(layout.settings), venue: layout.venue && typeof layout.venue === "object" && Array.isArray(layout.venue.items) ? layout.venue : null };
  }

  // Show files from the old visualiser stored positions in its own room: a
  // 22m stage whose front edge was at z = 2 (top at 1.3m), three bars at
  // 9.5m over it (z = -2, -5, -8) and a FOH bar at 8.5m (z = 10). Fixed
  // fixtures stored a manual pan/tilt instead of an aim point. These are
  // moved onto the new room (js/visualizer/theatre.js: 12m stage, front at
  // z = 0, top at 1m) so a show keeps its rig.
  const OLD_BARS = [
    { y: 9.5, z: -2, bar: { y: 7.2, z: -1.2, length: 11 } },
    { y: 9.5, z: -5, bar: { y: 7.2, z: -3.8, length: 11 } },
    { y: 9.5, z: -8, bar: { y: 7.2, z: -6.4, length: 11 } },
    { y: 8.5, z: 10, bar: { y: 7.6, z: 6, length: 12 } }
  ];
  const OLD_STAGE = { front: 2, depth: 22, top: 1.3, width: 22 };
  const NEW_STAGE = { depth: 9, top: 1, width: 12 };
  const finite = (...values) => values.every(Number.isFinite);

  function oldBar(p) {
    return OLD_BARS.find(b => Math.abs(p.y - b.y) < 1.2 && Math.abs(p.z - b.z) < 1.4) || null;
  }

  // Anywhere else (floor units, booms): scale the stage, shift the house.
  function mapPoint(p) {
    const x = p.x * (NEW_STAGE.width / OLD_STAGE.width);
    const z = p.z < OLD_STAGE.front ? (p.z - OLD_STAGE.front) * (NEW_STAGE.depth / OLD_STAGE.depth) : p.z - OLD_STAGE.front;
    const onStage = p.z < OLD_STAGE.front && p.y >= OLD_STAGE.top - 0.05;
    const y = onStage ? Math.max(NEW_STAGE.top, p.y - (OLD_STAGE.top - NEW_STAGE.top)) : Math.max(0, p.y);
    return { x, y, z };
  }

  const round = p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) });

  function fromOldShow(layout) {
    if (!layout || typeof layout !== "object") return null;
    const result = { ...empty(), settings: { grid: layout.gridOn !== false, house: Boolean(layout.houseOn), work: Boolean(layout.workOn) } };
    const fixtures = Array.isArray(State.fixtures) ? State.fixtures : [];
    const idOf = saved => {
      const id = saved.fixtureId ?? saved.id;
      if (id != null && fixtures.some(f => String(f.id) === String(id))) return String(id);
      const index = saved.fixtureIndex ?? saved.index;
      return Number.isInteger(index) && fixtures[index] ? String(fixtures[index].id) : null;
    };

    const old = {};
    for (const saved of Array.isArray(layout.fixturePositions) ? layout.fixturePositions : []) {
      const id = idOf(saved || {});
      const p = { x: Number(saved.x), y: Number(saved.y), z: Number(saved.z) };
      if (id && finite(p.x, p.y, p.z)) old[id] = p;
    }
    // Fixtures never moved hung where the old visualiser put them: in patch
    // order along the first bar, 2.4m apart.
    if (Array.isArray(layout.fixturePositions)) {
      fixtures.forEach((fixture, i) => {
        const id = String(fixture.id);
        // Floor units and the mirror ball have their own spots in the new room.
        if (/fog|haz|smoke|mirror|disco|ball/i.test(fixture.name || "")) return;
        if (!old[id]) old[id] = { x: (i - (fixtures.length - 1) / 2) * 2.4, y: 9.5, z: -2 };
      });
    }

    // Fixtures on an old bar go on the matching new bar, keeping their
    // order and relative spacing (squeezed only if the bar is shorter).
    const onBar = new Map();
    for (const [id, p] of Object.entries(old)) {
      const b = oldBar(p);
      if (b) { if (!onBar.has(b)) onBar.set(b, []); onBar.get(b).push(id); } else result.positions[id] = round(mapPoint(p));
    }
    for (const [b, ids] of onBar) {
      const reach = b.bar.length / 2 - 0.4;
      const widest = Math.max(...ids.map(id => Math.abs(old[id].x)), 1e-6);
      const scale = Math.min(0.55, reach / widest);
      for (const id of ids) result.positions[id] = round({ x: old[id].x * scale, y: b.bar.y - 0.08, z: b.bar.z });
    }

    // Old manual pan/tilt: pan about Y from +z, tilt down about X. Turned
    // into the point the fixture was aimed at, moved onto the new stage.
    for (const saved of Array.isArray(layout.fixtureManualRot) ? layout.fixtureManualRot : []) {
      const id = idOf(saved || {});
      const pan = Number(saved?.pan), tilt = Number(saved?.tilt);
      if (!id || !old[id] || !finite(pan, tilt)) continue;
      const from = old[id];
      const dir = { x: Math.sin(pan) * Math.cos(tilt), y: -Math.sin(tilt), z: Math.cos(pan) * Math.cos(tilt) };
      // Where the beam met the stage top, or the floor if it missed the stage.
      let reach = 10;
      if (dir.y < -0.05) {
        reach = (from.y - OLD_STAGE.top) / -dir.y;
        if (from.z + dir.z * reach >= OLD_STAGE.front) reach = from.y / -dir.y;
        reach = Math.min(30, reach);
      }
      const target = mapPoint({ x: from.x + dir.x * reach, y: from.y + dir.y * reach, z: from.z + dir.z * reach });
      // Keep the same angle relative to where the fixture now hangs.
      const now = result.positions[id];
      const was = mapPoint(from);
      result.aims[id] = round({ x: target.x + (now.x - was.x), y: target.y, z: target.z + (now.z - was.z) });
    }
    return result;
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
    } else if (message.type === "VIZ_SCREEN_SOURCES" && event.source === visualizer) {
      // Live video on a visualiser screen (js/visualizer/live-video.js): what can be shown.
      const reply = result => event.source.postMessage({ type: "SCREEN_SOURCES", id: message.id, result }, "*");
      if (!window.LXApp?.screenSources) reply({ sources: [], error: "Live video needs the Light Spark app (not a browser)." });
      else window.LXApp.screenSources().then(reply, error => reply({ sources: [], error: String(error?.message || error) }));
    } else if (message.type === "VIZ_SCREEN_SETTINGS" && event.source === visualizer) {
      window.LXApp?.openScreenSettings?.();
    } else if (message.type === "VIZ_LAYOUT" && event.source === visualizer) {
      const layout = normalise(message.layout);
      if (!layout) return;
      State.visualizer = layout;
      persist();
    }
  });

  // The house curtain (tabs) in the visualiser:
  //   curtain open / curtain close / curtain 50 (% open) / curtain toggle
  //   …over 8 (seconds for a full open or close; 4 if not said)
  // Kept with the show, so it can be part of a cue: cue 1 command curtain open
  function curtain(open, seconds) {
    State.visualizer.settings = { ...State.visualizer.settings, curtain: open };
    persist();
    if (visualizer && !visualizer.closed) visualizer.postMessage({ type: "CURTAIN", open, seconds }, "*");
  }
  // Installed once everything has loaded (js/commands.js defines the base
  // parseCommand after this file).
  function install() {
    const previous = window.parseCommand;
    if (typeof previous !== "function") return setTimeout(install, 300);
    const wrapped = function (raw) {
      const m = String(raw ?? "").trim().toLowerCase().match(/^(?:curtain|tabs|house curtain)\s+(open|out|close|in|shut|toggle|\d+(?:\.\d+)?%?)(?:\s+(?:over\s+|in\s+)?(\d*\.?\d+)\s*s?)?$/);
      if (!m) return previous.apply(this, arguments);
      const now = Number(State.visualizer.settings?.curtain ?? 1);
      const word = m[1];
      const open = /^(open|out)$/.test(word) ? 1 : /^(close|in|shut)$/.test(word) ? 0 : word === "toggle" ? (now >= 0.5 ? 0 : 1) : Math.max(0, Math.min(100, parseFloat(word))) / 100;
      const seconds = m[2] != null ? Number(m[2]) : undefined;
      curtain(open, seconds);
      window.log?.(`🎭 Curtain ${open >= 1 ? "opening" : open <= 0 ? "closing" : `to ${Math.round(open * 100)}% open`}${seconds != null ? ` over ${seconds} s` : ""}${visualizer && !visualizer.closed ? "" : " (open the visualiser to see it)"}`, "ok");
    };
    Object.assign(wrapped, previous);
    window.parseCommand = wrapped; // once, never re-wrapped
  }
  if (document.readyState === "complete") install(); else window.addEventListener("load", install, { once: true });

  window.LXVisualizer = Object.freeze({
    curtain,
    layout: () => clone(State.visualizer),
    toShow: () => clone(State.visualizer),
    fromShow(layout) {
      State.visualizer = normalise(layout) || fromOldShow(layout) || empty();
      persist();
      send();
    }
  });
})();
