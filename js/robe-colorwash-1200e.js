"use strict";

/*
 * ROBE ColorWash 1200E AT compatibility layer.
 *
 * Mode 1 is a 17-channel personality. The fixture is CMY based;
 * it does not expose zoom or shutter/strobe in this personality.
 * This layer makes the existing programmer state drive the actual
 * CMY/CTO/colour-wheel channels instead of treating the fixture as RGB.
 */
(function installRobeColorWash1200ECompatibility() {
  const NAME = "Robe ColorWash 1200E AT (17ch Mode 1)";

  const profile = {
    type: "moving",
    channels: 17,
    map: {
      pan: 0,
      panf: 1,
      tilt: 2,
      tiltf: 3,
      speed: 4,
      control: 5,
      macro: 6,
      macroSpeed: 7,
      colour: 8,
      colourFine: 9,
      colour2: 10,
      colour2Fine: 11,
      cyan: 12,
      magenta: 13,
      yellow: 14,
      cto: 15,
      dimmer: 16,
      intensity: 16
    },
    photometrics: {
      verified: true,
      sourceType: "DISCHARGE",
      ratedLumens: null,
      beamAngle: null,
      beamAngleMin: 10,
      beamAngleMax: 87,
      outputScale: 1,
      manufacturer: "ROBE",
      model: "ColorWash 1200E AT"
    },
    colourWheel: [
      { min: 0, max: 31, rgb: [1, 1, 1], hue: 0 },
      { min: 32, max: 63, rgb: [0.55, 0, 0], hue: 0 },
      { min: 64, max: 95, rgb: [0, 0.05, 0.55], hue: 235 },
      { min: 96, max: 127, rgb: [0.05, 0.55, 0.05], hue: 120 },
      { min: 128, max: 159, rgb: [1, 0.35, 0.02], hue: 20 },
      { min: 160, max: 191, rgb: [0.95, 0.95, 0.95], hue: 0 },
      { min: 192, max: 255, rgb: [1, 1, 1], hue: 0 }
    ]
  };

  function installProfile() {
    if (!window.FixtureLibrary || typeof window.FixtureLibrary !== "object") return false;
    window.FixtureLibrary[NAME] = profile;
    return true;
  }

  function getFixtureDefinition(fixture) {
    if (typeof window.getFixtureDefinition === "function") return window.getFixtureDefinition(fixture);
    return window.FixtureLibrary?.[fixture?.name];
  }

  function getBase(fixture) {
    const n = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.start ?? fixture?.channel);
    return Number.isFinite(n) && n >= 1 && n <= 512 ? n - 1 : -1;
  }

  function clamp255(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  function clamp100(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function rgbFromHsl(h, s, l) {
    h = ((Number(h) || 0) % 360 + 360) % 360 / 60;
    s = clamp100(s) / 100;
    l = clamp100(l) / 100;
    if (s === 0) return [l, l, l];
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 1) { r = c; g = x; }
    else if (h < 2) { r = x; g = c; }
    else if (h < 3) { g = c; b = x; }
    else if (h < 4) { g = x; b = c; }
    else if (h < 5) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  function write(base, channel, value) {
    if (!Number.isInteger(channel)) return;
    const index = base + channel;
    if (index >= 0 && index < 512 && window.State?.dmx) window.State.dmx[index] = clamp255(value);
  }

  function applyToColorWash() {
    if (!window.State || !Array.isArray(window.State.fixtures) || !window.State.dmx) return;
    for (const fixture of window.State.fixtures) {
      if (fixture?.name !== NAME) continue;
      const map = getFixtureDefinition(fixture)?.map || profile.map;
      const base = getBase(fixture);
      if (base < 0) continue;
      const state = typeof window.ensureFixtureState === "function"
        ? window.ensureFixtureState(fixture.id)
        : window.State.fixtureStates?.get(fixture.id);
      if (!state) continue;

      const master = clamp100(state.master ?? window.State.current?.master ?? 100) / 100;
      const intensity = clamp100(state.intensity ?? window.State.current?.intensity ?? 100) / 100;
      const level = window.State.blackout ? 0 : master * intensity;

      // Pan / tilt and their fine channels are already handled by dmx.js.
      // Re-assert them here only when this compatibility layer is used.
      write(base, map.pan, state.pan ?? 128);
      write(base, map.panf, state.panf ?? 0);
      write(base, map.tilt, state.tilt ?? 128);
      write(base, map.tiltf, state.tiltf ?? 0);
      write(base, map.speed, state.speed ?? 0);
      write(base, map.control, state.control ?? 0);
      write(base, map.macro, state.macro ?? 0);
      write(base, map.macroSpeed, state.macroSpeed ?? 0);

      // Mode 1 has a combined mechanical dimmer/shutter on channel 17.
      write(base, map.dimmer, 255 * level);

      // If explicit CMY values exist, use them. Otherwise convert the
      // console's normal HSL programmer colour to subtractive CMY.
      const hasExplicitCMY = ["cyan", "magenta", "yellow"].some(k =>
        state[k] != null || window.State.current?.[k] != null
      );

      if (hasExplicitCMY) {
        write(base, map.cyan, window.State.blackout ? 0 : clamp255(state.cyan ?? window.State.current?.cyan ?? 0));
        write(base, map.magenta, window.State.blackout ? 0 : clamp255(state.magenta ?? window.State.current?.magenta ?? 0));
        write(base, map.yellow, window.State.blackout ? 0 : clamp255(state.yellow ?? window.State.current?.yellow ?? 0));
      } else {
        const rgb = rgbFromHsl(state.hue ?? window.State.current?.hue ?? 0, state.sat ?? window.State.current?.sat ?? 100, state.light ?? window.State.current?.light ?? 50);
        write(base, map.cyan, (1 - rgb[0]) * 255);
        write(base, map.magenta, (1 - rgb[1]) * 255);
        write(base, map.yellow, (1 - rgb[2]) * 255);
      }

      // CTO: 0 = no correction / 5600K, 255 = maximum correction / 3200K.
      write(base, map.cto, window.State.blackout ? 0 : clamp255(state.cto ?? window.State.current?.cto ?? 0));

      // Preserve explicit colour-wheel positions if a cue/command supplies them.
      write(base, map.colour, window.State.blackout ? 0 : clamp255(state.colour ?? window.State.current?.colour ?? 0));
      write(base, map.colourFine, window.State.blackout ? 0 : clamp255(state.colourFine ?? window.State.current?.colourFine ?? 0));
      write(base, map.colour2, window.State.blackout ? 0 : clamp255(state.colour2 ?? window.State.current?.colour2 ?? 0));
      write(base, map.colour2Fine, window.State.blackout ? 0 : clamp255(state.colour2Fine ?? window.State.current?.colour2Fine ?? 0));
    }
  }

  function install() {
    if (!installProfile()) return false;
    if (typeof window.updateDMX !== "function") return false;
    if (window.__robeColorWash1200ECompat) return true;
    window.__robeColorWash1200ECompat = true;
    const originalUpdateDMX = window.updateDMX;
    window.updateDMX = function robeColorWashCompatibleUpdateDMX() {
      originalUpdateDMX.apply(this, arguments);
      applyToColorWash();
      window.ArtNet?.send?.();
    };
    return true;
  }

  const attempts = setInterval(() => {
    if (install()) clearInterval(attempts);
  }, 100);
  install();
})();
