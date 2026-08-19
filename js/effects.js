"use strict";

window.State = window.State || {};

State.activeEffect = State.activeEffect || null;
State.effectFrame = State.effectFrame || null;
State.savedEffects = State.savedEffects || {};

/*
============================================================
LIVE EFFECT INTENSITY
============================================================

IMPORTANT:

This is NOT a fixed effect intensity.

The normal lighting intensity control can change this while
an effect is running.

Example:

Effect animation = 100%
Lighting intensity control = 35%

Actual output = 35%

If the slider changes to 60% while the effect is running:

Actual output immediately becomes 60%.
============================================================
*/

if (!Number.isFinite(Number(State.effectIntensity))) {
  State.effectIntensity = 100;
}

function fxNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fxClamp(value, min = 0, max = 100) {
  return Math.max(
    min,
    Math.min(max, fxNumber(value, min))
  );
}

function fxLog(message, type = "info") {
  if (typeof window.log === "function") {
    window.log(message, type);
  } else {
    console.log("[EFFECTS]", message);
  }
}

/*
============================================================
LIVE INTENSITY CONTROL
============================================================
*/

function setIntensity(percent) {
  const value = fxClamp(percent);

  State.effectIntensity = value;

  /*
   * Keep the normal lighting state in sync.
   *
   * Do NOT let the effect overwrite this later.
   */
  if (!State.current) {
    State.current = {};
  }

  State.current.intensity = value;

  /*
   * Update selected fixture states too.
   */
  if (State.fixtureStates instanceof Map) {
    const selected =
      State.selected instanceof Set
        ? State.selected
        : null;

    State.fixtureStates.forEach((state, id) => {
      if (!selected || selected.has(id)) {
        if (state) {
          state.intensity = value;
        }
      }
    });
  }

  /*
   * Immediately push the new value to DMX.
   */
  fxUpdateOutput();

  /*
   * Update the actual intensity slider if it exists.
   */
  const slider =
    document.getElementById("intensity");

  const label =
    document.getElementById("intensityVal");

  if (slider) {
    slider.value = value;
  }

  if (label) {
    label.textContent = String(Math.round(value));
  }

  fxLog(
    `💡 Live effect intensity: ${Math.round(value)}%`,
    "ok"
  );

  return value;
}

/*
============================================================
GET CURRENT LIVE INTENSITY

This is deliberately read EVERY animation frame.

Therefore moving the normal intensity slider while an
effect is running immediately changes the output.
============================================================
*/

function fxGetLiveIntensity() {

  /*
   * Prefer the actual lighting control/state.
   */
  const current =
    Number(State.current?.intensity);

  if (Number.isFinite(current)) {
    return fxClamp(current);
  }

  /*
   * Otherwise use the effect intensity.
   */
  return fxClamp(
    State.effectIntensity,
    100
  );
}

/*
============================================================
APPLY LIVE INTENSITY
============================================================
*/

function fxApplyIntensity(effectValue) {

  const effect =
    fxClamp(effectValue);

  const live =
    fxGetLiveIntensity();

  return Math.round(
    effect * (live / 100)
  );
}

/*
============================================================
FIXTURE HELPERS
============================================================
*/

function fxGetFixtureDefinition(fixture) {

  if (!fixture || !window.FixtureLibrary) {
    return null;
  }

  const names = [
    fixture.name,
    fixture.fixtureName,
    fixture.fixtureType,
    fixture.fixture,
    fixture.profileName,
    fixture.profile,
    fixture.model,
    fixture.type,
    fixture.libraryName,
    fixture.definition
  ];

  for (const name of names) {

    if (
      typeof name === "string" &&
      FixtureLibrary[name]
    ) {
      return FixtureLibrary[name];
    }
  }

  if (
    fixture.definition &&
    typeof fixture.definition === "object" &&
    fixture.definition.map
  ) {
    return fixture.definition;
  }

  if (
    fixture.profile &&
    typeof fixture.profile === "object" &&
    fixture.profile.map
  ) {
    return fixture.profile;
  }

  return null;
}

function fxGetFixtures() {

  const fixtures =
    Array.isArray(State.fixtures)
      ? State.fixtures.filter(Boolean)
      : [];

  if (
    State.selected instanceof Set &&
    State.selected.size
  ) {
    return fixtures.filter(
      fixture =>
        fixture.id != null &&
        State.selected.has(fixture.id)
    );
  }

  return fixtures;
}

function fxGetState(fixture) {

  if (!fixture || fixture.id == null) {
    return null;
  }

  if (
    typeof window.fixtureState ===
    "function"
  ) {
    return window.fixtureState(
      fixture.id
    );
  }

  if (!(State.fixtureStates instanceof Map)) {
    State.fixtureStates = new Map();
  }

  if (
    !State.fixtureStates.has(
      fixture.id
    )
  ) {
    State.fixtureStates.set(
      fixture.id,
      {
        ...(State.current || {})
      }
    );
  }

  return State.fixtureStates.get(
    fixture.id
  );
}

function fxHasColour(fixture) {

  const def =
    fxGetFixtureDefinition(
      fixture
    );

  if (!def || !def.map) {
    return false;
  }

  const map = def.map;

  return (
    typeof map.r === "number" &&
    typeof map.g === "number" &&
    typeof map.b === "number"
  );
}

/*
============================================================
OUTPUT
============================================================
*/

function fxUpdateOutput() {

  try {

    if (
      typeof window.updateDMX ===
      "function"
    ) {
      window.updateDMX();
    }

  } catch (e) {

    console.error(
      "[EFFECTS] updateDMX failed:",
      e
    );
  }

  try {

    if (
      typeof window.sendToVisualizer ===
      "function"
    ) {
      window.sendToVisualizer();
    }

  } catch (e) {

    console.error(
      "[EFFECTS] Visualizer update failed:",
      e
    );
  }
}

/*
============================================================
STOP
============================================================
*/

function stopEffect(silent = false) {

  if (State.effectFrame !== null) {

    cancelAnimationFrame(
      State.effectFrame
    );

    State.effectFrame = null;
  }

  const previous =
    State.activeEffect;

  State.activeEffect = null;

  if (
    !silent &&
    previous
  ) {
    fxLog(
      `■ Effect stopped: ${previous.type}`,
      "ok"
    );
  }
}

/*
============================================================
RAINBOW
============================================================
*/

function startRainbow(options = {}) {

  stopEffect(true);

  const speed =
    Math.max(
      0.05,
      fxNumber(
        options.speed,
        0.12
      )
    );

  const fixtures =
    fxGetFixtures()
      .filter(fxHasColour);

  if (!fixtures.length) {

    fxLog(
      "Rainbow: no RGB/RGBW fixtures found",
      "warn"
    );

    return false;
  }

  State.activeEffect = {
    type: "rainbow",
    speed
  };

  const started =
    performance.now();

  function frame(now) {

    if (
      !State.activeEffect ||
      State.activeEffect.type !==
        "rainbow"
    ) {
      return;
    }

    const elapsed =
      (now - started) / 1000;

    /*
     * READ LIVE CONTROL EVERY FRAME.
     */
    const liveIntensity =
      fxGetLiveIntensity();

    fixtures.forEach(
      (fixture, index) => {

        const offset =
          (
            index /
            Math.max(
              1,
              fixtures.length
            )
          ) * 360;

        const hue =
          (
            elapsed *
              speed *
              360 +
            offset
          ) % 360;

        const state =
          fxGetState(
            fixture
          );

        if (!state) return;

        state.hue = hue;
        state.sat = 100;
        state.light = 50;

        /*
         * THIS is the important part.
         *
         * We don't set intensity to 100.
         *
         * We use the current slider value.
         */
        state.intensity =
          liveIntensity;

        state.master = 100;

        if ("w" in state) {
          state.w = 0;
        }
      }
    );

    fxUpdateOutput();

    State.effectFrame =
      requestAnimationFrame(
        frame
      );
  }

  State.effectFrame =
    requestAnimationFrame(
      frame
    );

  fxLog(
    `▶ Rainbow started — ${fixtures.length} RGB/RGBW fixtures`,
    "ok"
  );

  return true;
}

/*
============================================================
STROBE
============================================================
*/

function startStrobe(options = {}) {

  stopEffect(true);

  const speed =
    Math.max(
      1,
      fxNumber(
        options.speed,
        8
      )
    );

  const fixtures =
    fxGetFixtures();

  State.activeEffect = {
    type: "strobe",
    speed
  };

  const started =
    performance.now();

  function frame(now) {

    if (
      !State.activeEffect ||
      State.activeEffect.type !==
        "strobe"
    ) {
      return;
    }

    const elapsed =
      (now - started) / 1000;

    const on =
      Math.floor(
        elapsed * speed
      ) % 2 === 0;

    /*
     * READ SLIDER LIVE.
     */
    const liveIntensity =
      fxGetLiveIntensity();

    const strobeValue =
      Math.round(
        255 *
        (liveIntensity / 100)
      );

    fixtures.forEach(
      fixture => {

        const def =
          fxGetFixtureDefinition(
            fixture
          );

        const state =
          fxGetState(
            fixture
          );

        if (!def || !state) {
          return;
        }

        const map =
          def.map || {};

        if (
          typeof map.strobe ===
          "number"
        ) {

          state.strobe =
            on
              ? strobeValue
              : 0;

          /*
           * Keep intensity available
           * for fixtures where the
           * strobe channel is separate.
           */
          state.intensity =
            liveIntensity;

        } else {

          state.intensity =
            on
              ? liveIntensity
              : 0;
        }
      }
    );

    fxUpdateOutput();

    State.effectFrame =
      requestAnimationFrame(
        frame
      );
  }

  State.effectFrame =
    requestAnimationFrame(
      frame
    );

  fxLog(
    "▶ Strobe started",
    "ok"
  );

  return true;
}

/*
============================================================
PULSE
============================================================
*/

function startPulse(options = {}) {

  stopEffect(true);

  const speed =
    Math.max(
      0.1,
      fxNumber(
        options.speed,
        1
      )
    );

  const fixtures =
    fxGetFixtures();

  State.activeEffect = {
    type: "pulse",
    speed
  };

  const started =
    performance.now();

  function frame(now) {

    if (
      !State.activeEffect ||
      State.activeEffect.type !==
        "pulse"
    ) {
      return;
    }

    const elapsed =
      (now - started) / 1000;

    const wave =
      (
        Math.sin(
          elapsed *
          speed *
          Math.PI *
          2
        ) + 1
      ) / 2;

    const baseIntensity =
      10 + wave * 90;

    /*
     * MULTIPLY ANIMATION BY
     * CURRENT LIVE CONTROL.
     */
    const intensity =
      fxApplyIntensity(
        baseIntensity
      );

    fixtures.forEach(
      fixture => {

        const state =
          fxGetState(
            fixture
          );

        if (!state) return;

        state.intensity =
          intensity;
      }
    );

    fxUpdateOutput();

    State.effectFrame =
      requestAnimationFrame(
        frame
      );
  }

  State.effectFrame =
    requestAnimationFrame(
      frame
    );

  fxLog(
    "▶ Pulse started",
    "ok"
  );

  return true;
}

/*
============================================================
CHASE
============================================================
*/

function startChase(options = {}) {

  stopEffect(true);

  const fixtures =
    fxGetFixtures()
      .filter(fxHasColour);

  if (!fixtures.length) {

    fxLog(
      "Chase: no RGB/RGBW fixtures found",
      "warn"
    );

    return false;
  }

  const speed =
    Math.max(
      0.1,
      fxNumber(
        options.speed,
        5
      )
    );

  State.activeEffect = {
    type: "chase",
    speed
  };

  const started =
    performance.now();

  function frame(now) {

    if (
      !State.activeEffect ||
      State.activeEffect.type !==
        "chase"
    ) {
      return;
    }

    const elapsed =
      (now - started) / 1000;

    const active =
      Math.floor(
        elapsed * speed
      ) % fixtures.length;

    /*
     * LIVE.
     */
    const intensityOn =
      fxGetLiveIntensity();

    fixtures.forEach(
      (fixture, index) => {

        const state =
          fxGetState(
            fixture
          );

        if (!state) return;

        const on =
          index === active;

        state.intensity =
          on
            ? intensityOn
            : 0;

        state.hue = 0;
        state.sat = 0;
        state.light = 100;
        state.master = 100;
      }
    );

    fxUpdateOutput();

    State.effectFrame =
      requestAnimationFrame(
        frame
      );
  }

  State.effectFrame =
    requestAnimationFrame(
      frame
    );

  fxLog(
    "▶ Chase started",
    "ok"
  );

  return true;
}

/*
============================================================
WAVE
============================================================
*/

function startWave(options = {}) {

  stopEffect(true);

  const fixtures =
    fxGetFixtures();

  if (!fixtures.length) {

    fxLog(
      "Wave: no fixtures found",
      "warn"
    );

    return false;
  }

  const speed =
    Math.max(
      0.1,
      fxNumber(
        options.speed,
        1
      )
    );

  State.activeEffect = {
    type: "wave",
    speed
  };

  const started =
    performance.now();

  function frame(now) {

    if (
      !State.activeEffect ||
      State.activeEffect.type !==
        "wave"
    ) {
      return;
    }

    const elapsed =
      (now - started) / 1000;

    fixtures.forEach(
      (fixture, index) => {

        const state =
          fxGetState(
            fixture
          );

        if (!state) return;

        const position =
          index /
          Math.max(
            1,
            fixtures.length - 1
          );

        const phase =
          (
            elapsed *
            speed *
            Math.PI *
            2
          ) +
          position *
          Math.PI *
          2;

        const value =
          (
            Math.sin(phase) + 1
          ) / 2;

        const baseIntensity =
          10 + value * 90;

        /*
         * LIVE INTENSITY CONTROL.
         */
        state.intensity =
          fxApplyIntensity(
            baseIntensity
          );
      }
    );

    fxUpdateOutput();

    State.effectFrame =
      requestAnimationFrame(
        frame
      );
  }

  State.effectFrame =
    requestAnimationFrame(
      frame
    );

  fxLog(
    "▶ Wave started",
    "ok"
  );

  return true;
}

/*
============================================================
START EFFECT
============================================================
*/

function startEffect(
  type,
  options = {}
) {

  switch (type) {

    case "rainbow":
      return startRainbow(options);

    case "strobe":
      return startStrobe(options);

    case "pulse":
      return startPulse(options);

    case "chase":
      return startChase(options);

    case "wave":
      return startWave(options);

    default:

      fxLog(
        `Unknown effect: ${type}`,
        "warn"
      );

      return false;
  }
}

/*
============================================================
CUSTOM EFFECT
============================================================
*/

function createCustomEffect() {

  const type =
    prompt(
      "Effect type:\n\nrainbow\nstrobe\npulse\nchase\nwave",
      "rainbow"
    );

  if (type === null) {
    return false;
  }

  const clean =
    String(type)
      .trim()
      .toLowerCase();

  if (
    ![
      "rainbow",
      "strobe",
      "pulse",
      "chase",
      "wave"
    ].includes(clean)
  ) {

    fxLog(
      "Unknown custom effect",
      "warn"
    );

    return false;
  }

  const speed =
    Number(
      prompt(
        "Speed:",
        clean === "strobe"
          ? "8"
          : "1"
      )
    );

  return startEffect(
    clean,
    {
      speed:
        Number.isFinite(speed)
          ? speed
          : 1
    }
  );
}

/*
============================================================
CUE EFFECT
============================================================
*/

function startCueEffect(effect) {

  if (
    !effect ||
    !effect.type
  ) {

    stopEffect(true);

    return;
  }

  State.pendingCueEffect =
    {
      ...effect
    };

  startEffect(
    effect.type,
    effect
  );
}

/*
============================================================
BUTTONS
============================================================
*/

function wireEffectButtons() {

  const cards =
    document.querySelectorAll(
      ".effect-card"
    );

  cards.forEach(card => {

    if (
      card.dataset.effectsWired ===
      "true"
    ) {
      return;
    }

    card.dataset.effectsWired =
      "true";

    const text =
      card.textContent
        .trim()
        .toLowerCase();

    let type = null;

    if (
      text.includes("strobe")
    ) {
      type = "strobe";
    }

    else if (
      text.includes("pulse")
    ) {
      type = "pulse";
    }

    else if (
      text.includes("chase")
    ) {
      type = "chase";
    }

    else if (
      text.includes("rainbow")
    ) {
      type = "rainbow";
    }

    else if (
      text.includes("wave")
    ) {
      type = "wave";
    }

    card.dataset.effect =
      type || "custom";

    card.addEventListener(
      "click",
      () => {

        if (
          card.dataset.effect ===
          "custom"
        ) {

          createCustomEffect();

          return;
        }

        startEffect(
          card.dataset.effect
        );
      }
    );
  });
}

/*
============================================================
ATTACH EFFECT TO CUE
============================================================
*/

function attachEffectToCue(
  cueIndex,
  effectType,
  options = {}
) {

  if (
    !State.cues ||
    !State.cues[cueIndex]
  ) {
    return;
  }

  State.cues[
    cueIndex
  ].effect = {
    type: effectType,
    ...options
  };

  fxLog(
    `✅ Effect "${effectType}" attached to Cue ${cueIndex + 1}`,
    "ok"
  );
}

/*
============================================================
EXPORT
============================================================
*/

Object.assign(
  window,
  {

    startEffect,
    stopEffect,

    startRainbow,
    startStrobe,
    startPulse,
    startChase,
    startWave,

    createCustomEffect,
    startCueEffect,

    fxGetFixtureDefinition,
    attachEffectToCue,

    setIntensity,
    fxApplyIntensity,
    fxGetLiveIntensity
  }
);

/*
============================================================
IMPORTANT:
HOOK THE NORMAL INTENSITY SLIDER

This means:

Effect running
      ↓
Move normal intensity slider
      ↓
State.current.intensity changes
      ↓
Effect sees new value on next frame
      ↓
DMX changes immediately
============================================================
*/

function wireLiveIntensityControl() {

  const slider =
    document.getElementById(
      "intensity"
    );

  if (!slider) {
    return;
  }

  if (
    slider.dataset
      .liveEffectIntensityWired ===
    "true"
  ) {
    return;
  }

  slider.dataset
    .liveEffectIntensityWired =
    "true";

  function handleIntensity() {

    const value =
      fxClamp(
        slider.value
      );

    /*
     * Store the control value.
     */
    if (!State.current) {
      State.current = {};
    }

    State.current.intensity =
      value;

    State.effectIntensity =
      value;

    /*
     * Update selected fixture
     * states WITHOUT stopping
     * the effect.
     */
    const fixtures =
      fxGetFixtures();

    fixtures.forEach(
      fixture => {

        const state =
          fxGetState(
            fixture
          );

        if (!state) return;

        /*
         * Don't permanently force
         * the effect's animation value.
         *
         * The next animation frame
         * will calculate the proper
         * effect output.
         */
      }
    );

    const label =
      document.getElementById(
        "intensityVal"
      );

    if (label) {
      label.textContent =
        String(
          Math.round(value)
        );
    }

    /*
     * Force immediate DMX refresh.
     */
    fxUpdateOutput();
  }

  slider.addEventListener(
    "input",
    handleIntensity
  );

  slider.addEventListener(
    "change",
    handleIntensity
  );

  /*
   * Don't force it to 50.
   * Use whatever the slider currently says.
   */
  const current =
    fxClamp(
      slider.value,
      0,
      100
    );

  if (
    Number.isFinite(current)
  ) {
    State.current =
      State.current || {};

    State.current.intensity =
      current;

    State.effectIntensity =
      current;
  }
}

/*
============================================================
INIT
============================================================
*/

function initEffects() {

  wireEffectButtons();

  wireLiveIntensityControl();
}

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initEffects,
    { once: true }
  );

} else {

  initEffects();
}