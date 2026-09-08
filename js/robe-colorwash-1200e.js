"use strict";

/*
 * ROBE ColorWash 1200E AT compatibility layer.
 *
 * Correct 17-channel Mode 1 map from the ROBE manual:
 *  1 Pan, 2 Pan Fine, 3 Tilt, 4 Tilt Fine, 5 P/T Speed,
 *  6 Power/Special, 7 P/T Macro, 8 Macro Speed,
 *  9 Cyan, 10 Magenta, 11 Yellow, 12 CTO,
 * 13 Effect Speed, 14 Fresnel Opening, 15 Zoom,
 * 16 Shutter/Strobe, 17 Dimmer.
 *
 * Mode 1 does not contain the colour-wheel channels; those are used by
 * later personalities. This is why the previous mapping made colour
 * controls appear to operate the wrong functions.
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
      cyan: 8,
      magenta: 9,
      yellow: 10,
      cto: 11,
      effectSpeed: 12,
      fresnel: 13,
      zoom: 14,
      strobe: 15,
      shutter: 15,
      dimmer: 16,
      intensity: 16
    },
    photometrics: {
      verified: true,
      sourceType: "DISCHARGE",
      ratedLumens: null,
      beamAngle: null,
      beamAngleMin: 13,
      beamAngleMax: 44,
      outputScale: 1,
      manufacturer: "ROBE",
      model: "ColorWash 1200E AT"
    }
  };

  const clamp255 = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  const clamp100 = value => Math.max(0, Math.min(100, Number(value) || 0));

  function installProfile() {
    if (!window.FixtureLibrary || typeof window.FixtureLibrary !== "object") return false;
    window.FixtureLibrary[NAME] = profile;
    return true;
  }

  function getBase(fixture) {
    const n = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.start ?? fixture?.channel);
    return Number.isFinite(n) && n >= 1 && n <= 512 ? n - 1 : -1;
  }

  function getState(fixture) {
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    return window.State?.fixtureStates?.get(fixture.id) || null;
  }

  function write(base, channel, value) {
    if (!Number.isInteger(channel)) return;
    const index = base + channel;
    if (index >= 0 && index < 512 && window.State?.dmx) {
      window.State.dmx[index] = clamp255(value);
    }
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

  function applyToColorWash() {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures) || !state.dmx) return;

    for (const fixture of state.fixtures) {
      if (fixture?.name !== NAME) continue;
      const base = getBase(fixture);
      if (base < 0) continue;

      const fixtureState = getState(fixture);
      if (!fixtureState) continue;

      const current = state.current || {};
      const master = clamp100(fixtureState.master ?? current.master ?? 100) / 100;
      const intensity = clamp100(fixtureState.intensity ?? current.intensity ?? 100) / 100;
      const level = state.blackout ? 0 : master * intensity;

      write(base, profile.map.pan, fixtureState.pan ?? current.pan ?? 128);
      write(base, profile.map.panf, fixtureState.panf ?? current.panf ?? 0);
      write(base, profile.map.tilt, fixtureState.tilt ?? current.tilt ?? 128);
      write(base, profile.map.tiltf, fixtureState.tiltf ?? current.tiltf ?? 0);
      write(base, profile.map.speed, fixtureState.speed ?? current.speed ?? 0);
      write(base, profile.map.control, fixtureState.control ?? current.control ?? 0);
      write(base, profile.map.macro, fixtureState.macro ?? current.macro ?? 0);
      write(base, profile.map.macroSpeed, fixtureState.macroSpeed ?? current.macroSpeed ?? 0);

      // Mode 1 colour control is CMY, not RGB and not the colour wheels.
      // The normal colour picker is converted to CMY when explicit CMY
      // values have not been supplied by the user.
      const cyan = fixtureState.cyan ?? current.cyan;
      const magenta = fixtureState.magenta ?? current.magenta;
      const yellow = fixtureState.yellow ?? current.yellow;

      if (cyan != null || magenta != null || yellow != null) {
        write(base, profile.map.cyan, state.blackout ? 0 : cyan ?? 0);
        write(base, profile.map.magenta, state.blackout ? 0 : magenta ?? 0);
        write(base, profile.map.yellow, state.blackout ? 0 : yellow ?? 0);
      } else {
        const rgb = rgbFromHsl(
          fixtureState.hue ?? current.hue ?? 0,
          fixtureState.sat ?? current.sat ?? 100,
          fixtureState.light ?? current.light ?? 50
        );
        write(base, profile.map.cyan, (1 - rgb[0]) * 255);
        write(base, profile.map.magenta, (1 - rgb[1]) * 255);
        write(base, profile.map.yellow, (1 - rgb[2]) * 255);
      }

      // CTO: 0 = 5600 K / no correction, 255 = 3200 K.
      write(base, profile.map.cto, state.blackout ? 0 : fixtureState.cto ?? current.cto ?? 0);

      // Keep the fixture's physical dimmer open independently of the
      // shutter/strobe control. The previous implementation calculated
      // 'level' but never wrote it to the DMX dimmer channel.
      write(base, profile.map.dimmer, state.blackout ? 0 : level * 255);

      // Strobe UI semantics: 0 means OPEN/no strobe, rather than the ROBE
      // shutter-closed DMX range 0-31. Values above zero enter the strobe
      // range 64-95 and therefore do not prevent the dimmer from working.
      const strobe = clamp255(fixtureState.strobe ?? current.strobe ?? 0);
      const strobeDMX = strobe === 0
        ? 63
        : 64 + Math.round((strobe / 255) * 31);
      write(base, profile.map.strobe, state.blackout ? 0 : strobeDMX);

      // Zoom is a single 8-bit proportional channel in Mode 1.
      write(base, profile.map.zoom, fixtureState.zoom ?? current.zoom ?? 0);

      // Fresnel opening: 85 DMX is the LightMax/high-intensity spot point.
      write(base, profile.map.fresnel, fixtureState.fresnel ?? current.fresnel ?? 0);

      // Effect speed is channel 13 in Mode 1.
      write(base, profile.map.effectSpeed, fixtureState.effectSpeed ?? current.effectSpeed ?? 0);
    }
  }

  function install() {
    if (!installProfile()) return false;
    if (window.__robeColorWash1200ECompat) return true;
    window.__robeColorWash1200ECompat = true;

    const originalUpdateDMX = window.updateDMX;
    if (typeof originalUpdateDMX === "function") {
      window.updateDMX = function robeColorWashCompatibleUpdateDMX() {
        originalUpdateDMX.apply(this, arguments);
        applyToColorWash();
      };
    }

    window.renderLibrary?.();
    window.renderFixtures?.();
    window.updateControlVisibility?.();
    return true;
  }

  const attempts = setInterval(() => {
    if (install()) clearInterval(attempts);
  }, 100);
  install();
})();