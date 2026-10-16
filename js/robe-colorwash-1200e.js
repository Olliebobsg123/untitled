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

  const rgbFromHsl = (h, s, l) => window.hslToRgb(h, s, l).map(v => v / 255);

  // Writes one ColorWash's channels (called by the DMX engine, js/dmx.js).
  function writeColorWash({ state: fixtureState, current, level, blackout, write }) {
    write(profile.map.pan, fixtureState.pan ?? current.pan ?? 128);
    write(profile.map.panf, fixtureState.panf ?? current.panf ?? 0);
    write(profile.map.tilt, fixtureState.tilt ?? current.tilt ?? 128);
    write(profile.map.tiltf, fixtureState.tiltf ?? current.tiltf ?? 0);
    write(profile.map.speed, fixtureState.speed ?? current.speed ?? 0);
    write(profile.map.control, fixtureState.control ?? current.control ?? 0);
    write(profile.map.macro, fixtureState.macro ?? current.macro ?? 0);
    write(profile.map.macroSpeed, fixtureState.macroSpeed ?? current.macroSpeed ?? 0);

    // Mode 1 colour control is CMY, not RGB and not the colour wheels.
    // The normal colour picker is converted to CMY when explicit CMY
    // values have not been supplied by the user.
    const cyan = fixtureState.cyan ?? current.cyan;
    const magenta = fixtureState.magenta ?? current.magenta;
    const yellow = fixtureState.yellow ?? current.yellow;

    if (cyan != null || magenta != null || yellow != null) {
      write(profile.map.cyan, blackout ? 0 : cyan ?? 0);
      write(profile.map.magenta, blackout ? 0 : magenta ?? 0);
      write(profile.map.yellow, blackout ? 0 : yellow ?? 0);
    } else {
      const rgb = rgbFromHsl(
        fixtureState.hue ?? current.hue ?? 0,
        fixtureState.sat ?? current.sat ?? 100,
        fixtureState.light ?? current.light ?? 50
      );
      write(profile.map.cyan, (1 - rgb[0]) * 255);
      write(profile.map.magenta, (1 - rgb[1]) * 255);
      write(profile.map.yellow, (1 - rgb[2]) * 255);
    }

    // CTO: 0 = 5600 K / no correction, 255 = 3200 K.
    write(profile.map.cto, blackout ? 0 : fixtureState.cto ?? current.cto ?? 0);

    // The dimmer carries the level; the shutter channel only strobes.
    write(profile.map.dimmer, blackout ? 0 : level * 255);

    // Strobe UI semantics: 0 means OPEN/no strobe, rather than the ROBE
    // shutter-closed DMX range 0-31. Values above zero enter the strobe
    // range 64-95 and therefore do not prevent the dimmer from working.
    const strobe = clamp255(fixtureState.strobe ?? current.strobe ?? 0);
    const strobeDMX = strobe === 0
      ? 63
      : 64 + Math.round((strobe / 255) * 31);
    write(profile.map.strobe, blackout ? 0 : strobeDMX);

    // Zoom is a single 8-bit proportional channel in Mode 1.
    write(profile.map.zoom, fixtureState.zoom ?? current.zoom ?? 0);

    // Fresnel opening: 85 DMX is the LightMax/high-intensity spot point.
    write(profile.map.fresnel, fixtureState.fresnel ?? current.fresnel ?? 0);

    // Effect speed is channel 13 in Mode 1.
    write(profile.map.effectSpeed, fixtureState.effectSpeed ?? current.effectSpeed ?? 0);
  }

  window.FixtureLibrary[NAME] = profile;
  LXDmx.registerProfileWriter(NAME, writeColorWash);
})();
