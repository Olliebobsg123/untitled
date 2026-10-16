"use strict";

// The DMX engine. Each fixture's programmer state (State.fixtureStates: level,
// colour, pan/tilt, …) becomes DMX values in its own universe's 512-channel
// frame (State.universes). Frames go to the output service in the main process
// (main/dmx-output.js) and to the 3D visualiser whenever they change.
//
//   updateDMX()                 work the frames out again after any change
//   fadeTo(target, ms, states)  fade the programmer to a new look
//   LXDmx.registerProfileWriter(name, writer)
//                               a fixture profile with its own channel layout (e.g. CMY)
//   LXDmx.onFrame(listener)     called after every update (e.g. Tapo Wi-Fi bulbs)

(() => {
  const OUTPUT_INTERVAL_MS = 25; // the most often frames go to the output service
  const VISUALISER_INTERVAL_MS = 33; // ~30 frames a second to the visualiser

  const clamp255 = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  const clamp100 = value => Math.max(0, Math.min(100, Number(value) || 0));
  const normaliseHue = value => {
    let hue = Number(value);
    if (!Number.isFinite(hue)) hue = 0;
    hue %= 360;
    return hue < 0 ? hue + 360 : hue;
  };

  if (!(State.universes instanceof Map)) State.universes = new Map();
  if (State.chaseFade == null) State.chaseFade = 800;
  if (State.chaseWait == null) State.chaseWait = 500;

  const profileWriters = new Map();
  const frameListeners = [];

  // --- Fixtures ---

  function getFixtureDefinition(fixture) {
    if (!fixture) return null;
    if (fixture.map && typeof fixture.map === "object") return fixture;
    if (fixture.definition && typeof fixture.definition === "object") return fixture.definition;
    const library = window.FixtureLibrary || {};
    const name = fixture.name ?? fixture.fixtureName ?? fixture.type ?? fixture.model;
    if (!name) return null;
    if (library[name]) return library[name];
    const key = Object.keys(library).find(k => k.toLowerCase() === String(name).toLowerCase());
    return key ? library[key] : null;
  }

  // 0-based start channel, or -1 for fixtures with no DMX address (e.g. Wi-Fi bulbs).
  function getFixtureBaseAddress(fixture) {
    const n = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.start ?? fixture?.channel);
    return Number.isFinite(n) && n >= 1 && n <= 512 ? n - 1 : -1;
  }

  function getFixtureUniverse(fixture) {
    const n = Number(fixture?.uni ?? fixture?.universe ?? 1);
    return Number.isInteger(n) && n >= 0 && n <= 32767 ? n : 1;
  }

  function frameFor(universe) {
    let frame = State.universes.get(universe);
    if (!frame) {
      frame = new Uint8Array(512);
      State.universes.set(universe, frame);
    }
    return frame;
  }

  // State.dmx: universe 1's frame, for older code that only knew one universe.
  Object.defineProperty(State, "dmx", { configurable: true, get: () => frameFor(1) });

  function fixtureState(id) {
    return window.ensureFixtureState(id);
  }

  // --- Colour ---

  function hslToRgb(h, s, l) {
    h = normaliseHue(h) / 60;
    s = clamp100(s) / 100;
    l = clamp100(l) / 100;
    if (!s) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 1) [r, g] = [c, x];
    else if (h < 2) [r, g] = [x, c];
    else if (h < 3) [g, b] = [c, x];
    else if (h < 4) [g, b] = [x, c];
    else if (h < 5) [r, b] = [x, c];
    else [r, b] = [c, x];
    return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
  }

  const DEFAULT_COLOUR_WHEEL = [
    { min: 0, max: 20, rgb: [1, 1, 1], hue: 0 },
    { min: 21, max: 40, rgb: [1, 0, 0], hue: 0 },
    { min: 41, max: 60, rgb: [1, 0.5, 0], hue: 30 },
    { min: 61, max: 80, rgb: [1, 1, 0], hue: 60 },
    { min: 81, max: 100, rgb: [0, 1, 0], hue: 120 },
    { min: 101, max: 120, rgb: [0, 1, 1], hue: 180 },
    { min: 121, max: 140, rgb: [0, 0, 1], hue: 240 },
    { min: 141, max: 160, rgb: [0.5, 0, 1], hue: 270 },
    { min: 161, max: 180, rgb: [1, 0, 1], hue: 300 },
    { min: 181, max: 255, rgb: [1, 1, 1], hue: 0 }
  ];

  const getColourWheel = def => (Array.isArray(def?.colourWheel) && def.colourWheel.length ? def.colourWheel : DEFAULT_COLOUR_WHEEL);

  // The colour-wheel slot nearest a hue (white when the colour is barely saturated).
  function colourWheelValue(def, hue, sat) {
    const wheel = getColourWheel(def);
    if (Number(sat) < 5) {
      const white = wheel.find(slot => Array.isArray(slot.rgb) && slot.rgb.every(v => v === 1));
      if (white) return clamp255((white.min + white.max) / 2);
    }
    const target = normaliseHue(hue);
    let best = wheel[0];
    let bestDistance = Infinity;
    for (const slot of wheel) {
      if (slot.hue === undefined) continue;
      let distance = Math.abs(target - normaliseHue(slot.hue));
      distance = Math.min(distance, 360 - distance);
      if (distance < bestDistance) { bestDistance = distance; best = slot; }
    }
    return clamp255((best.min + best.max) / 2);
  }

  // --- Working out the frames ---

  const PASSTHROUGH = ["strobe", "gobo", "gobo2", "gobor", "gobo2r", "prism", "prismr", "focus", "zoom", "frost", "iris", "rot", "effect", "speed", "macro", "preset", "shake", "mode", "zone", "fog", "fana", "haze", "fluid", "colmacro"];

  // The standard fixture: dimmer, tunable white, RGB(W/A/L/C/UV) or a colour wheel, then the rest.
  function writeStandardFixture({ def, state, level, blackout, write }) {
    const map = def.map || {};
    const number = key => typeof map[key] === "number";
    if (number("dimmer")) write(map.dimmer, 255 * level);
    else if (number("intensity")) write(map.intensity, 255 * level);

    // Tunable-white fixtures (e.g. Showtec Performer 1500 Fresnel 8ch): the LED engines need driving too.
    if (number("warmWhite") || number("naturalWhite")) {
      const white = blackout ? 0 : 255 * level;
      if (number("warmWhite")) write(map.warmWhite, white);
      if (number("naturalWhite")) write(map.naturalWhite, white);
      if (number("warmWhiteFine")) write(map.warmWhiteFine, 0);
      if (number("naturalWhiteFine")) write(map.naturalWhiteFine, 0);
      if (number("cct")) write(map.cct, blackout ? 0 : state.cct ?? State.current?.cct ?? 0);
    }

    if (number("r") && number("g") && number("b")) {
      const [r, g, b] = blackout ? [0, 0, 0] : hslToRgb(state.hue ?? 0, state.sat ?? 100, state.light ?? 50);
      write(map.r, r * level);
      write(map.g, g * level);
      write(map.b, b * level);
      if (number("w")) write(map.w, blackout ? 0 : (state.w ?? state.white ?? 0) * level);
      for (const key of ["amber", "lime", "cyan", "uv"]) if (number(key)) write(map[key], blackout ? 0 : state[key] ?? 0);
    } else if (number("colour")) {
      write(map.colour, blackout ? 0 : colourWheelValue(def, state.hue ?? 0, state.sat ?? 100));
      if (number("colourr")) write(map.colourr, blackout ? 0 : state.colourr ?? 0);
    }

    for (const key of PASSTHROUGH) if (number(key)) write(map[key], state[key] ?? 0);
    if (number("pan")) {
      write(map.pan, state.pan ?? 128);
      if (number("panf")) write(map.panf, state.panf ?? 0);
    }
    if (number("tilt")) {
      write(map.tilt, state.tilt ?? 128);
      if (number("tiltf")) write(map.tiltf, state.tiltf ?? 0);
    }
  }

  function updateDMX() {
    for (const frame of State.universes.values()) frame.fill(0);
    if (typeof window.initFixtureStates === "function") window.initFixtureStates();
    const blackout = Boolean(State.blackout);

    for (const fixture of Array.isArray(State.fixtures) ? State.fixtures : []) {
      const def = getFixtureDefinition(fixture);
      const base = getFixtureBaseAddress(fixture);
      if (!def || base < 0) continue;
      const frame = frameFor(getFixtureUniverse(fixture));
      const state = fixtureState(fixture.id) || State.current || {};
      const master = clamp100(state.master ?? State.current?.master ?? 100) / 100;
      const intensity = clamp100(state.intensity ?? 100) / 100;
      const write = (channel, value) => {
        if (!Number.isInteger(channel)) return;
        const index = base + channel;
        if (index >= 0 && index < 512) frame[index] = clamp255(value);
      };
      const writer = profileWriters.get(fixture.name) || writeStandardFixture;
      writer({ fixture, def, state, level: blackout ? 0 : master * intensity, blackout, write, current: State.current || {} });
    }

    for (const listener of frameListeners) {
      try { listener(State.universes); } catch (err) { console.error("[DMX] frame listener failed:", err); }
    }
    scheduleOutput();
    scheduleVisualiser();
  }

  // --- Output (main/dmx-output.js) ---

  let outputQueued = false;
  let lastOutputAt = 0;

  function sendOutput() {
    outputQueued = false;
    lastOutputAt = performance.now();
    const universes = {};
    for (const [universe, frame] of State.universes) universes[universe] = Array.from(frame);
    window.LXOutput?.sendFrames(universes);
  }

  function scheduleOutput() {
    if (outputQueued) return;
    outputQueued = true;
    const wait = Math.max(0, OUTPUT_INTERVAL_MS - (performance.now() - lastOutputAt));
    setTimeout(sendOutput, wait);
  }

  // --- The visualiser window ---

  let visualiserWindow = null;
  let visualiserQueued = false;
  let lastVisualiserAt = 0;
  let sentPatchSignature = "";

  const visualiserOpen = () => Boolean(visualiserWindow && !visualiserWindow.closed);
  const postToVisualiser = message => {
    if (visualiserOpen()) visualiserWindow.postMessage(message, "*");
  };

  function patchSignature() {
    return JSON.stringify((State.fixtures || []).map(f => [f.id, f.name, getFixtureUniverse(f), f.addr, f.fixtureNumber]));
  }

  // The patch, sent only when it has changed: the visualiser rebuilds its fixtures from it.
  function syncVisualiserPatch(force = false) {
    if (!visualiserOpen()) return;
    const signature = patchSignature();
    if (!force && signature === sentPatchSignature) return;
    sentPatchSignature = signature;
    const library = {};
    for (const fixture of State.fixtures || []) {
      const def = getFixtureDefinition(fixture);
      if (def && fixture.name) library[fixture.name] = def;
    }
    postToVisualiser({ type: "SYNC_FIXTURES", fixtures: State.fixtures || [], fixtureLibrary: library });
  }

  function sendVisualiserFrame() {
    visualiserQueued = false;
    lastVisualiserAt = performance.now();
    if (!visualiserOpen()) return;
    syncVisualiserPatch();
    const universes = {};
    for (const [universe, frame] of State.universes) universes[universe] = Array.from(frame);
    postToVisualiser({ type: "DMX_FRAME", universes });
  }

  function scheduleVisualiser() {
    if (visualiserQueued || !visualiserOpen()) return;
    visualiserQueued = true;
    const wait = Math.max(0, VISUALISER_INTERVAL_MS - (performance.now() - lastVisualiserAt));
    setTimeout(sendVisualiserFrame, wait);
  }

  function openVisualiser() {
    if (visualiserOpen()) {
      visualiserWindow.focus();
    } else {
      visualiserWindow = window.open("visualizer.html", "visualizer");
      if (!visualiserWindow) return window.log?.("The visualiser window could not be opened", "warn");
    }
    sentPatchSignature = "";
    scheduleVisualiser();
  }

  window.addEventListener("message", event => {
    if (event.data?.type !== "VISUALIZER_READY") return;
    visualiserWindow = event.source;
    syncVisualiserPatch(true);
    postToVisualiser({ type: "CONSOLE_MODE", mode: window.getConsoleMode?.() || "LIVE" });
    sendVisualiserFrame();
  });

  // --- Fades ---

  function stopFade() {
    if (State.fading != null) LXClock.cancel(State.fading);
    State.fading = null;
  }

  // Fade the programmer (State.current) and, optionally, individual fixtures ([[id, state], …]) to a new look.
  function fadeTo(target, duration = 1000, targetFixtureStates = null) {
    stopFade();
    const fixtureTargets = Array.isArray(targetFixtureStates) ? targetFixtureStates : null;
    const finish = () => {
      State.fading = null;
      Object.assign(State.current, target || {});
      fixtureTargets?.forEach(([id, state]) => State.fixtureStates.set(id, window.cloneFixtureState(state)));
      updateDMX();
    };
    if (duration <= 0) return finish();

    const startGlobal = { ...State.current };
    const startFixtures = new Map();
    State.fixtureStates.forEach((state, id) => startFixtures.set(id, window.cloneFixtureState(state)));
    const started = performance.now();
    const step = now => {
      const p = Math.min(1, (now - started) / duration);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      for (const [key, to] of Object.entries(target || {})) {
        if (typeof to === "number" && typeof startGlobal[key] === "number") State.current[key] = startGlobal[key] + (to - startGlobal[key]) * e;
      }
      fixtureTargets?.forEach(([id, to]) => {
        const from = startFixtures.get(id) || window.cloneFixtureState(to);
        const next = window.cloneFixtureState(from);
        for (const key of Object.keys(to)) {
          if (typeof to[key] === "number" && typeof from[key] === "number") next[key] = from[key] + (to[key] - from[key]) * e;
        }
        State.fixtureStates.set(id, next);
      });
      if (p >= 1) return finish();
      updateDMX();
      State.fading = LXClock.frame(step);
    };
    State.fading = LXClock.frame(step);
  }

  // --- Blackout ---

  function setBlackout(enabled) {
    State.blackout = Boolean(enabled);
    updateDMX();
    return State.blackout;
  }

  // The quick BLACKOUT button holds everything at zero until FULL or a level is pressed.
  document.addEventListener("click", event => {
    const button = event.target?.closest?.("[data-action], [data-v]");
    if (!button) return;
    const action = String(button.dataset.action || "").toLowerCase();
    if (action === "blackout") State.blackout = true;
    else if (action === "full" || button.dataset.v != null) State.blackout = false;
    else return;
    updateDMX();
  });

  window.LXCommands?.add(raw => {
    const command = String(raw ?? "").toLowerCase().trim();
    if (command === "blackout") State.blackout = true;
    else if (/^(full|all|all 25|all 50|all half|all 75)$/.test(command)) State.blackout = false;
    return LXCommands.NOT_MINE;
  }, { first: true });

  // --- Exports (the rest of the console uses these as globals) ---

  Object.assign(window, {
    getFixtureDefinition,
    getFixtureBaseAddress,
    getFixtureUniverse,
    getColourWheel,
    hslToRgb,
    updateDMX,
    fadeTo,
    stopFade,
    setBlackout,
    connectVisualizer: openVisualiser,
    // Called after almost every change: refresh the visualiser (cheap unless the patch changed).
    sendToVisualizer: () => scheduleVisualiser(),
    postToVisualizer: postToVisualiser
  });

  window.LXDmx = Object.freeze({
    registerProfileWriter(name, writer) {
      profileWriters.set(name, writer);
    },
    onFrame(listener) {
      if (typeof listener === "function") frameListeners.push(listener);
    },
    frameFor
  });
})();
