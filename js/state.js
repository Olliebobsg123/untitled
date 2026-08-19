"use strict";

(function () {
  const DEFAULT_FIXTURE_STATE = {
    hue: 0,
    sat: 100,
    light: 50,
    intensity: 100,
    master: 100,

    pan: 128,
    tilt: 128,

    strobe: 0,
    gobo: 0,
    gobo2: 0,
    gobor: 0,
    gobo2r: 0,
    prism: 0,
    prismr: 0,
    focus: 0,
    zoom: 0,
    frost: 0,
    iris: 0,
    rot: 0,
    effect: 0,
    speed: 0,
    macro: 0,
    colour: 0,
    colourr: 0,

    panf: 0,
    tiltf: 0,
    amber: 0,
    uv: 0,
    preset: 0,
    shake: 0,
    mode: 0,
    zone: 0,
    fog: 0,
    fana: 0,
    haze: 0,
    fluid: 0,
    colmacro: 0
  };

  const existing = window.State || {};

  window.State = existing;

  Object.assign(State, {
    currentChase: Number.isInteger(existing.currentChase)
      ? existing.currentChase
      : -1,

    chaseTimer: existing.chaseTimer || null,

    chases: Array.isArray(existing.chases)
      ? existing.chases
      : [],

    fixtures: Array.isArray(existing.fixtures)
      ? existing.fixtures
      : [],

    groups: Array.isArray(existing.groups)
      ? existing.groups
      : [],

    cues: Array.isArray(existing.cues)
      ? existing.cues
      : [],

    selected: existing.selected instanceof Set
      ? existing.selected
      : new Set(),

    currentCue: Number.isInteger(existing.currentCue)
      ? existing.currentCue
      : -1,

    current: {
      ...DEFAULT_FIXTURE_STATE,
      ...(existing.current || {})
    },

    target: existing.target || null,

    dmx: existing.dmx instanceof Uint8Array
      ? existing.dmx
      : new Uint8Array(512),

    liveDMX: existing.liveDMX instanceof Uint8Array
      ? existing.liveDMX
      : new Uint8Array(512),

    fixtureStates: existing.fixtureStates instanceof Map
      ? existing.fixtureStates
      : new Map(),

    fading: existing.fading || null,

    chaseFade: typeof existing.chaseFade === "number"
      ? existing.chaseFade
      : 800,

    chaseWait: typeof existing.chaseWait === "number"
      ? existing.chaseWait
      : 500,

    Viz: existing.Viz || {
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      fixtures: []
    }
  });

  // Keep compatibility with code using window.chaseFade/chaseWait.
  window.chaseFade = State.chaseFade;
  window.chaseWait = State.chaseWait;

  window.DEFAULT_FIXTURE_STATE = DEFAULT_FIXTURE_STATE;

  window.createFixtureState = function (source = null) {
    return {
      ...DEFAULT_FIXTURE_STATE,
      ...(source || {})
    };
  };

  window.cloneFixtureState = function (source = null) {
    return {
      ...DEFAULT_FIXTURE_STATE,
      ...(source || {})
    };
  };

  window.ensureFixtureState = function (fixtureId) {
    if (fixtureId === undefined || fixtureId === null) {
      return createFixtureState();
    }

    if (!(State.fixtureStates instanceof Map)) {
      State.fixtureStates = new Map();
    }

    if (!State.fixtureStates.has(fixtureId)) {
      State.fixtureStates.set(
        fixtureId,
        createFixtureState(State.current)
      );
    }

    return State.fixtureStates.get(fixtureId);
  };

  window.initFixtureStates = function () {
    if (!(State.fixtureStates instanceof Map)) {
      State.fixtureStates = new Map();
    }

    State.fixtures.forEach(fixture => {
      if (!fixture || fixture.id == null) return;

      if (!State.fixtureStates.has(fixture.id)) {
        State.fixtureStates.set(
          fixture.id,
          createFixtureState(State.current)
        );
      }
    });
  };
})();