// What a fixture's DMX channels mean to the visualiser: brightness, colour,
// beam angle, strobe, pan/tilt, gobo, framing. Plain functions with no
// three.js, so they can be tested on their own (tests/visualizer-decode.test.mjs).

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const isChannel = value => Number.isInteger(value) && value >= 0;

// Reads a fixture's channels as 0-1 from the console's DMX buffer, which holds
// every universe end to end (universe N starts at (N-1)*512). Missing
// channels read as null.
export function reader(frame, base, map) {
  const raw = key => {
    const offset = map?.[key];
    if (!isChannel(offset)) return null;
    const index = base + offset;
    return index >= 0 && index < frame.length ? frame[index] : null;
  };
  const read = key => {
    const value = raw(key);
    return value == null ? null : value / 255;
  };
  // 16-bit (coarse + fine) where the fixture has both.
  read.fine = (key, fineKey) => {
    const coarse = raw(key);
    if (coarse == null) return null;
    const fine = raw(fineKey);
    return fine == null ? coarse / 255 : (coarse * 256 + fine) / 65535;
  };
  read.raw = raw;
  return read;
}

// Where a fixture's channels start in the console's DMX buffer, or -1.
export function baseAddress(fixture) {
  const universe = Number(fixture?.uni ?? fixture?.universe ?? 1);
  const address = Number(fixture?.addr ?? fixture?.address);
  if (!Number.isInteger(universe) || universe < 1 || !Number.isInteger(address) || address < 1 || address > 512) return -1;
  return (universe - 1) * 512 + address - 1;
}

const DEFAULT_WHEEL = [
  { min: 0, max: 20, rgb: [1, 1, 1] }, { min: 21, max: 40, rgb: [1, 0, 0] }, { min: 41, max: 60, rgb: [1, 0.5, 0] },
  { min: 61, max: 80, rgb: [1, 1, 0] }, { min: 81, max: 100, rgb: [0, 1, 0] }, { min: 101, max: 120, rgb: [0, 1, 1] },
  { min: 121, max: 140, rgb: [0, 0, 1] }, { min: 141, max: 160, rgb: [0.5, 0, 1] }, { min: 161, max: 180, rgb: [1, 0, 1] },
  { min: 181, max: 255, rgb: [1, 1, 1] }
];
export function wheelColour(def, value) {
  const wheel = Array.isArray(def?.colourWheel) && def.colourWheel.length ? def.colourWheel : DEFAULT_WHEEL;
  const slot = wheel.find(s => value >= Number(s.min) && value <= Number(s.max));
  return Array.isArray(slot?.rgb) ? slot.rgb.map(clamp01) : [1, 1, 1];
}

// Colour temperature (kelvin) → linear-ish RGB, close enough for a visualiser.
export function kelvinToRgb(kelvin) {
  const t = Math.max(1000, Math.min(12000, kelvin)) / 100;
  const r = t <= 66 ? 1 : clamp01((329.698727446 * Math.pow(t - 60, -0.1332047592)) / 255);
  const g = t <= 66 ? clamp01((99.4708025861 * Math.log(t) - 161.1195681661) / 255) : clamp01((288.1221695283 * Math.pow(t - 60, -0.0755148492)) / 255);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp01((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);
  return [r, g, b];
}

export const isTungsten = (def, name = "") =>
  def?.type === "tungsten" || /tungsten|halogen|incandescent/i.test(`${def?.photometrics?.sourceType || ""} ${name}`);

// The colour a fixture makes (0-1 per channel, before brightness), and whether
// that colour also carries the brightness (LED fixtures with no dimmer).
export function decodeColour(def, read, name = "") {
  const map = def?.map || {};
  const has = key => isChannel(map[key]);

  if (has("cyan") && has("magenta") && has("yellow")) {
    // Subtractive CMY (e.g. Robe ColorWash): white minus C/M/Y, warmed by CTO.
    let rgb = [1 - read("cyan"), 1 - read("magenta"), 1 - read("yellow")];
    if (has("cto")) {
      const warm = kelvinToRgb(5600 - read("cto") * 2400);
      rgb = rgb.map((v, i) => v * warm[i]);
    }
    if (has("colour")) {
      const wheel = wheelColour(def, read.raw("colour"));
      rgb = rgb.map((v, i) => v * wheel[i]);
    }
    return { rgb, carriesLevel: false };
  }

  if (has("r") && has("g") && has("b")) {
    // Additive LED mixing: each emitter adds its own colour.
    const emitters = [
      ["r", [1, 0, 0]], ["g", [0, 1, 0]], ["b", [0, 0, 1]],
      ["w", [1, 0.95, 0.88]], ["a", [1, 0.62, 0]], ["amber", [1, 0.62, 0]],
      ["l", [0.7, 1, 0]], ["lime", [0.7, 1, 0]], ["c", [0, 1, 1]], ["cyan", [0, 1, 1]], ["uv", [0.3, 0, 1]]
    ];
    const seen = new Set();
    const mixed = [0, 0, 0];
    for (const [key, colour] of emitters) {
      if (!has(key) || seen.has(map[key])) continue;
      seen.add(map[key]);
      const level = read(key);
      colour.forEach((c, i) => { mixed[i] += c * level; });
    }
    const peak = Math.max(...mixed);
    return { rgb: peak > 0 ? mixed.map(v => v / peak) : [0, 0, 0], carriesLevel: true, level: Math.min(1, peak) };
  }

  if (has("colour")) return { rgb: wheelColour(def, read.raw("colour")), carriesLevel: false };

  if (has("warmWhite") || has("naturalWhite") || has("coolWhite")) {
    const warm = has("warmWhite") ? read("warmWhite") : 0;
    const natural = has("naturalWhite") ? read("naturalWhite") : 0;
    const cool = has("coolWhite") ? read("coolWhite") : 0;
    const total = warm + natural + cool;
    const kelvin = total > 0 ? (warm * 2700 + natural * 4300 + cool * 6500) / total : 3200;
    return { rgb: kelvinToRgb(kelvin), carriesLevel: !has("dimmer") && !has("intensity"), level: Math.min(1, Math.max(warm, natural, cool)) };
  }

  // A plain white source: tungsten glows warm, LED/discharge cooler.
  return { rgb: isTungsten(def, name) ? kelvinToRgb(3000) : kelvinToRgb(5600), carriesLevel: false };
}

// Shutter/strobe: { rate: flashes per second (0 = steady), closed }.
export function decodeStrobe(def, read) {
  const value = read.raw("strobe") ?? read.raw("shutter");
  if (value == null) return { rate: 0 };
  if (/robe/i.test(def?.photometrics?.manufacturer || "")) {
    // Robe: 0-31 closed, 32-63 open, 64-95 strobe slow→fast, then effects (shown open).
    if (value < 32) return { rate: 0, closed: true };
    if (value >= 64 && value <= 95) return { rate: 1 + ((value - 64) / 31) * 19 };
    return { rate: 0 };
  }
  // Most fixtures: 0-10 open, above that strobing, faster as it goes up.
  return value <= 10 ? { rate: 0 } : { rate: 1 + ((value - 11) / 244) * 24 };
}

const DEFAULT_ANGLE = { moving: 16, wash: 25, beam: 4, strobe: 110, blinder: 60, bar: 40, tungsten: 30, dimmer: 30 };

// Beam spread in degrees: zoom moves between the fixture's narrowest and widest
// angles; fixed-lens fixtures use their beam angle; iris narrows it.
export function decodeBeamAngle(def, read) {
  const p = def?.photometrics || {};
  const narrow = Number(p.beamAngleMin) > 0 ? Number(p.beamAngleMin) : null;
  const wide = Number(p.beamAngleMax) > 0 ? Number(p.beamAngleMax) : null;
  const fixed = Number(p.beamAngle) > 0 ? Number(p.beamAngle) : null;
  const zoom = read("zoom");
  let angle;
  if (zoom != null && narrow && wide) angle = narrow + (wide - narrow) * zoom;
  else if (zoom != null) angle = 8 + zoom * 42;
  else angle = fixed || wide || narrow || DEFAULT_ANGLE[def?.type] || 25;
  const iris = read("iris");
  if (iris != null) angle *= 1 - iris * 0.75;
  return Math.max(1, Math.min(150, angle));
}

// Light output in lumens when the fixture doesn't say: typical for its kind.
const DEFAULT_LUMENS = { moving: 4000, wash: 6000, beam: 3000, strobe: 20000, blinder: 15000, bar: 2500, tungsten: 9000, dimmer: 6000, rgb: 1200, rgbw: 2000, rgbal: 5000, rgbalc: 5000 };
export function ratedLumens(def) {
  const p = def?.photometrics || {};
  const lumens = Number(p.ratedLumens) > 0 ? Number(p.ratedLumens) : DEFAULT_LUMENS[def?.type] || 2000;
  return lumens * (Number(p.outputScale) > 0 ? Number(p.outputScale) : 1);
}

// What kind of thing this is, for the 3D model and behaviour.
export function archetype(def, name = "") {
  const source = String(def?.photometrics?.sourceType || "").toUpperCase();
  const map = def?.map || {};
  if (source === "MIRROR_BALL_MOTOR" || /mirror\s*ball/i.test(name)) return "mirrorBall";
  if (source === "ATMOSPHERIC" || isChannel(map.fog) || isChannel(map.haze)) return isChannel(map.haze) ? "hazer" : "fogger";
  if (isChannel(map.pan) || isChannel(map.tilt)) return def?.type === "beam" ? "movingBeam" : def?.type === "wash" ? "movingWash" : "movingSpot";
  if (def?.type === "strobe") return "strobe";
  if (def?.type === "blinder") return "blinder";
  if (def?.type === "bar") return "bar";
  if (/profile|leko|ellipsoidal/i.test(name) || [1, 2, 3, 4].some(n => isChannel(map[`shutter${n}Insert`]))) return "profile";
  if (def?.type === "tungsten" || def?.type === "dimmer" || /fresnel/i.test(name)) return "fresnel";
  return "par";
}

// Framing: four blades (0 = open, 1 = across the whole beam) and a frame
// rotation in radians. From DMX shutters on profiles, or the manual barn
// doors set on the fixture in the console (never sent over DMX).
export function decodeFraming(read, manual) {
  const blades = [1, 2, 3, 4].map(n => read(`shutter${n}Insert`) ?? 0);
  if (manual) {
    ["b1", "b2", "b3", "b4"].forEach((key, i) => { blades[i] = Math.max(blades[i], clamp01((Number(manual[key]) || 0) / 100)); });
  }
  const rotation = ((Number(manual?.rotate) || 0) * Math.PI) / 180;
  return { blades, rotation, active: blades.some(b => b > 0.001) };
}

// Everything the visualiser needs for one fixture, from the console's buffer.
export function decodeFixture(def, frame, base, name = "", manualShutters = null) {
  const map = def?.map || {};
  const read = reader(frame, base, map);
  const colour = decodeColour(def, read, name);
  const dimmer = read.fine("dimmer", "dimmerFine") ?? read.fine("intensity", "intensityFine");
  let intensity = dimmer ?? (colour.carriesLevel ? colour.level : 1);
  if (dimmer != null && colour.carriesLevel) intensity *= colour.level;
  const strobe = decodeStrobe(def, read);
  if (strobe.closed) intensity = 0;
  const panRange = Number(def?.panRange) || 540;
  const tiltRange = Number(def?.tiltRange) || 270;
  const pan = read.fine("pan", "panf");
  const tilt = read.fine("tilt", "tiltf");
  const goboValue = read.raw("gobo") ?? 0;
  return {
    intensity: clamp01(intensity),
    rgb: colour.rgb,
    strobeRate: strobe.rate,
    beamAngle: decodeBeamAngle(def, read),
    // Edge softness 0 (hard) - 1 (very soft). Focus sharpens; frost softens.
    softness: Math.min(1, (read("focus") == null ? 0.35 : 0.15 + (1 - read("focus")) * 0.5) + (read("frost") ?? 0) * 0.6),
    // Radians from the centre of travel; null for fixtures that don't move.
    pan: pan == null ? null : (pan - 0.5) * (panRange * Math.PI / 180),
    tilt: tilt == null ? null : (tilt - 0.5) * (tiltRange * Math.PI / 180),
    // Gobo slot: 0 = open, 1+ = a pattern. Most wheels use bands of ~16 values.
    gobo: goboValue > 7 ? 1 + Math.floor((goboValue - 8) / 16) % 8 : 0,
    goboSpin: read("gobor") ?? 0,
    prism: (read.raw("prism") ?? 0) > 20,
    framing: decodeFraming(read, manualShutters),
    // Atmosphere and mirror-ball motor, 0-1.
    fog: read("fog") ?? read("haze") ?? 0,
    speed: read("speed") ?? 0
  };
}
