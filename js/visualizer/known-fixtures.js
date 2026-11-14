// Real specs for fixtures whose profiles don't carry them (most come from an
// FLX show, where the desk knows the channels but not the optics), so the
// visualiser draws the right kind of light at the right size and brightness.
//
//   kind        what it is optically (profile = hard-edged ellipsoidal,
//               fresnel = soft, par = wash)
//   beamAngle   the angle drawn when the fixture has no DMX zoom: for lights
//               with a manual zoom or a choice of lenses, the usual theatre
//               focus (a fixture's own Beam Angle in the console still wins)
//   min / max   the zoom or lens range, for the Beam Angle card
//   lumens      light output
//   kelvin      colour of a plain white source
//   candela     measured brightness at the centre of the beam (lux x distance²),
//               at the angle candelaAt: used rather than working it out from lumens
//   scale       brightness × this, where the paper figure doesn't match the room
//
// Matched on the fixture's name, so it works for library and FLX fixtures.
const KNOWN = [
  // Showtec Performer Profile 650 Q5: RGBAL LED ellipsoidal, 6,800 lm; fixed
  // 19° / 26° lenses or 15-30° / 25-50° zooms (26° is the measured lens).
  // Measured: 60,800 lux at 1 m with the 26° lens.
  { match: /performer\s*profile\s*650\s*q5/i, kind: "profile", beamAngle: 26, min: 15, max: 50, lumens: 6800, candela: 60800, candelaAt: 26 },
  // Showtec Performer Profile 600 DDT: 250 W warm white COB, 3200K. Showtec
  // quote 10,000 lm for the LED; 6,522 lm measured out of the front, which is
  // what lands on stage.
  { match: /performer\s*profile\s*600.*ddt/i, kind: "profile", beamAngle: 26, min: 15, max: 50, lumens: 6522, kelvin: 3200 },
  // Performer Profile 600 MKIII: 10,665 lm.
  { match: /performer\s*profile\s*600.*mk\s*iii/i, kind: "profile", beamAngle: 26, min: 15, max: 50, lumens: 10665 },
  { match: /performer\s*profile\s*600/i, kind: "profile", beamAngle: 26, min: 15, max: 50, lumens: 3800, kelvin: 3200 },
  { match: /performer\s*profile/i, kind: "profile", beamAngle: 26, min: 15, max: 50 },
  // Showtec Performer 1500 Fresnel Q6 (RGBALC): 10-50° zoom, 3,111 lm,
  // 12,195 lux at 2 m at 10° (manual, item 41252).
  { match: /performer\s*1500\s*fresnel\s*q6/i, kind: "fresnel", beamAngle: 25, min: 10, max: 50, lumens: 3111, candela: 48780, candelaAt: 10 },
  // Showtec Performer 1500 Fresnel (tungsten-look, warm + cool white):
  // 10-50° zoom, 4,781 lm, 22,163 lux at 2 m at 10°, 2700-4500K (manual, item 33131).
  // That's both whites at full at its tightest zoom; on stage it reads far
  // dimmer (checked against the real rig), so it's drawn at 40%.
  { match: /performer\s*1500\s*fresnel/i, kind: "fresnel", beamAngle: 25, min: 10, max: 50, lumens: 4781, candela: 88652, candelaAt: 10, scale: 0.4, kelvinMin: 2700, kelvinMax: 4500 },
  { match: /performer\s*\d+\s*fresnel/i, kind: "fresnel", beamAngle: 25, min: 10, max: 50 },
  // Chauvet EVE E-50Z: a warm white LED *ellipsoidal* (hard edge), 20-39° zoom,
  // 7,910 lux at 2 m at 20° (≈ 2,500 lm).
  { match: /\beve\s*e-?50z/i, kind: "profile", beamAngle: 26, min: 20, max: 39, lumens: 2500, kelvin: 3200, candela: 31640, candelaAt: 20 },
  // Chauvet EVE F-50Z: the fresnel version, 17-50°.
  { match: /\beve\s*f-?50z/i, kind: "fresnel", beamAngle: 30, min: 17, max: 50, lumens: 2500, kelvin: 3200 },
  // Chauvet COREpar 40 USB: RGB COB par, 40° (85° field) bare, 20° with its lens.
  // Measured: 243 lux at 2 m bare (40°).
  { match: /corepar\s*40/i, kind: "par", beamAngle: 40, min: 20, max: 40, lumens: 1200, candela: 972, candelaAt: 40 },
  // Showtec Compact Par 18 Q4: 18 x 7 W RGBW, 15° fixed, 4,997 lm,
  // 10,000 lux at 2 m (40,000 cd at the centre).
  { match: /compact\s*par\s*18\s*q4/i, kind: "par", beamAngle: 15, lumens: 4997, candela: 40000, candelaAt: 15 },
  // A dimmer channel drives an ordinary lamp: tungsten, warm.
  { match: /\bgeneric\s*dimmer\b|^dimmer\b/i, kind: "fresnel", beamAngle: 30, lumens: 5000, kelvin: 3000 }
];

export function knownFixture(name) {
  const n = String(name || "");
  return KNOWN.find(k => k.match.test(n)) || null;
}

// The fixture's definition with the real specs filled in (a copy; cached).
const cache = new WeakMap();
export function withKnownSpecs(def, name) {
  if (!def) return def;
  const known = knownFixture(name);
  if (!known) return def;
  let byName = cache.get(def);
  if (!byName) cache.set(def, byName = new Map());
  if (byName.has(name)) return byName.get(name);
  const p = { ...(def.photometrics || {}) };
  if (known.beamAngle) p.beamAngle = known.beamAngle;
  if (known.min && !(Number(p.beamAngleMin) > 0)) p.beamAngleMin = known.min;
  if (known.max && !(Number(p.beamAngleMax) > 0)) p.beamAngleMax = known.max;
  if (known.lumens) p.ratedLumens = known.lumens;
  if (known.kelvin) p.colorTemp = known.kelvin;
  if (known.kelvinMin) p.colourTemperatureMin = known.kelvinMin;
  if (known.kelvinMax) p.colourTemperatureMax = known.kelvinMax;
  if (known.scale) p.outputScale = known.scale;
  if (known.candela) { p.peakCandela = known.candela; p.peakCandelaAngle = known.candelaAt || known.beamAngle; }
  const out = { ...def, photometrics: p, vizKind: known.kind };
  byName.set(name, out);
  return out;
}
