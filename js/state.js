"use strict";

(function initialiseState() {
  const DEFAULT_FIXTURE_STATE = Object.freeze({
    hue: 0, sat: 100, light: 50, intensity: 100, master: 100,
    pan: 128, tilt: 128,
    strobe: 0, gobo: 0, gobo2: 0, gobor: 0, gobo2r: 0,
    prism: 0, prismr: 0, focus: 0, zoom: 0, frost: 0, iris: 0,
    rot: 0, effect: 0, speed: 0, macro: 0, colour: 0, colourr: 0,
    panf: 0, tiltf: 0, amber: 0, uv: 0, preset: 0, shake: 0,
    mode: 0, zone: 0, fog: 0, fana: 0, haze: 0, fluid: 0, colmacro: 0
  });

  const existing = window.State && typeof window.State === "object"
    ? window.State
    : {};

  window.State = existing;

  const asArray = (value) => Array.isArray(value) ? value : [];
  const asMap = (value) => value instanceof Map ? value : new Map();
  const asSet = (value) => value instanceof Set ? value : new Set();
  const asUint8 = (value) => value instanceof Uint8Array && value.length === 512
    ? value
    : new Uint8Array(512);

  Object.assign(State, {
    currentChase: Number.isInteger(existing.currentChase) ? existing.currentChase : -1,
    chaseTimer: existing.chaseTimer || null,
    chases: asArray(existing.chases),
    fixtures: asArray(existing.fixtures),
    groups: asArray(existing.groups),
    cues: asArray(existing.cues),
    palettes: asArray(existing.palettes),
    selected: asSet(existing.selected),
    selectedFixtureId: existing.selectedFixtureId ?? null,
    currentCue: Number.isInteger(existing.currentCue) ? existing.currentCue : -1,
    current: { ...DEFAULT_FIXTURE_STATE, ...(existing.current || {}) },
    target: existing.target || null,
    dmx: asUint8(existing.dmx),
    liveDMX: asUint8(existing.liveDMX),
    fixtureStates: asMap(existing.fixtureStates),
    fading: existing.fading || null,
    chaseFade: Number.isFinite(existing.chaseFade) ? existing.chaseFade : 800,
    chaseWait: Number.isFinite(existing.chaseWait) ? existing.chaseWait : 500,
    Viz: existing.Viz && typeof existing.Viz === "object"
      ? existing.Viz
      : { scene: null, camera: null, renderer: null, controls: null, fixtures: [] }
  });

  window.chaseFade = State.chaseFade;
  window.chaseWait = State.chaseWait;
  window.DEFAULT_FIXTURE_STATE = DEFAULT_FIXTURE_STATE;

  window.createFixtureState = function createFixtureState(source = null) {
    return { ...DEFAULT_FIXTURE_STATE, ...(source && typeof source === "object" ? source : {}) };
  };

  window.cloneFixtureState = function cloneFixtureState(source = null) {
    return window.createFixtureState(source);
  };

  window.ensureFixtureState = function ensureFixtureState(fixtureId) {
    if (fixtureId === undefined || fixtureId === null) {
      return window.createFixtureState(State.current);
    }

    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();

    if (!State.fixtureStates.has(fixtureId)) {
      State.fixtureStates.set(fixtureId, window.createFixtureState(State.current));
    }

    return State.fixtureStates.get(fixtureId);
  };

  window.initFixtureStates = function initFixtureStates() {
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();

    State.fixtures.forEach(fixture => {
      if (!fixture || fixture.id == null) return;
      window.ensureFixtureState(fixture.id);
    });
  };

  // Load the optional palette feature after the base state exists. This keeps
  // the feature isolated while avoiding another entry in the HTML script list.
  function loadPaletteFeature() {
    if (window.Palettes || document.querySelector('script[data-palette-feature]')) return;
    const script = document.createElement('script');
    script.src = 'js/palette.js';
    script.dataset.paletteFeature = '1';
    script.defer = true;
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPaletteFeature, { once: true });
  } else {
    loadPaletteFeature();
  }
})();
