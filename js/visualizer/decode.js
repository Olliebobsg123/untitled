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
// Colour wheel / macro colours in fixture profiles are display (sRGB)
// colours picked by eye; light is mixed in linear units, so convert.
export const srgbToLinear = v => { v = clamp01(v); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const linear = rgb => rgb.map(srgbToLinear);

export function wheelColour(def, value) {
  const wheel = Array.isArray(def?.colourWheel) && def.colourWheel.length ? def.colourWheel : DEFAULT_WHEEL;
  const slot = wheel.find(s => value >= Number(s.min) && value <= Number(s.max));
  return Array.isArray(slot?.rgb) ? linear(slot.rgb) : [1, 1, 1];
}

// The colour of white light at a colour temperature, as the camera sees it.
// The Planckian locus (Kim et al. cubic fit) gives the chromaticity; that goes
// to linear sRGB and is white-balanced to WHITE_BALANCE, as a camera or the
// eye is: tungsten (3000K) looks warm amber, cool LED (6500K) a little blue,
// and daylight-balanced sources near white. Scaled so the brightest of R/G/B
// is 1 (the fixture's brightness comes from its lumens).
export const WHITE_BALANCE = 5000;
function planckXYZ(kelvin) {
  const T = Math.max(1667, Math.min(25000, kelvin));
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.17991
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.24039;
  const y = T <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x / y, 1, (1 - x - y) / y];
}
function xyzToLinearSrgb([X, Y, Z]) {
  return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
}
const balance = xyzToLinearSrgb(planckXYZ(WHITE_BALANCE));
export function kelvinToRgb(kelvin) {
  const rgb = xyzToLinearSrgb(planckXYZ(Math.max(1000, Math.min(12000, Number(kelvin) || 3200)))).map((v, i) => Math.max(0, v / balance[i]));
  const peak = Math.max(...rgb) || 1;
  return rgb.map(v => v / peak);
}

export const isTungsten = (def, name = "") =>
  def?.type === "tungsten" || /tungsten|halogen|incandescent/i.test(`${def?.photometrics?.sourceType || ""} ${name}`);

// Generic colour-macro palette for fixtures whose macro tables we don't have:
// most LED fixtures step through primaries and mixes in DMX bands.
const MACRO_PALETTE = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 0.5, 0], [0.5, 0, 1], [1, 1, 1]].map(linear);
const MACRO_KEYS = ["colmacro", "colorPreset", "presetColors", "colorMacros"];

// The colour a fixture makes (0-1 per channel, before brightness), and whether
// that colour also carries the brightness (LED fixtures with no dimmer).
const AMBER = [1, 0.32, 0], LIME = [0.55, 1, 0.04], CYAN = [0, 0.85, 1];
let WHITE_LED = null;
export function decodeColour(def, read, name = "") {
  WHITE_LED ||= kelvinToRgb(5700);
  const map = def?.map || {};
  const has = key => isChannel(map[key]);
  const level = key => read.fine(key, `${key}Fine`) ?? 0;
  const hasEmitters = has("r") || has("g") || has("b");
  let result;

  if (!hasEmitters && has("cyan") && has("magenta") && has("yellow")) {
    // Subtractive CMY (e.g. Robe ColorWash): white minus C/M/Y.
    result = { rgb: [1 - level("cyan"), 1 - level("magenta"), 1 - level("yellow")], carriesLevel: false };
  } else if (hasEmitters) {
    // Additive LED mixing: each emitter adds its own colour.
    // Each emitter's colour in linear light (what its LED die looks like):
    // amber ~590nm, lime is a broad yellow-green phosphor, cyan ~500nm, the
    // white die ~5700K. UV is mostly invisible: a dim violet.
    const emitters = [
      ["r", [1, 0, 0]], ["g", [0, 1, 0]], ["b", [0, 0, 1]],
      ["w", WHITE_LED], ["a", AMBER], ["amber", AMBER],
      ["l", LIME], ["lime", LIME], ["c", CYAN], ["cyan", CYAN], ["uv", [0.08, 0, 0.35]]
    ];
    const seen = new Set();
    const mixed = [0, 0, 0];
    for (const [key, colour] of emitters) {
      if (!has(key) || seen.has(map[key])) continue;
      seen.add(map[key]);
      const value = level(key);
      colour.forEach((c, i) => { mixed[i] += c * value; });
    }
    // LED fixtures with "magenta"/"yellow" channels use them as virtual CMY
    // filters over the mix.
    if (has("magenta") && !seen.has(map.magenta)) mixed[1] *= 1 - level("magenta");
    if (has("yellow") && !seen.has(map.yellow)) mixed[2] *= 1 - level("yellow");
    const peak = Math.max(...mixed);
    result = { rgb: peak > 0 ? mixed.map(v => v / peak) : [0, 0, 0], carriesLevel: true, level: Math.min(1, peak) };
  } else if (has("warmWhite") || has("naturalWhite") || has("coolWhite")) {
    const warm = has("warmWhite") ? level("warmWhite") : 0;
    const natural = has("naturalWhite") ? level("naturalWhite") : 0;
    const cool = has("coolWhite") ? level("coolWhite") : 0;
    const total = warm + natural + cool;
    const kelvin = total > 0 ? (warm * 2700 + natural * 4300 + cool * 6500) / total : 3200;
    result = { rgb: kelvinToRgb(kelvin), carriesLevel: !has("dimmer") && !has("intensity"), level: Math.min(1, Math.max(warm, natural, cool)) };
  } else if (!has("colour")) {
    // A plain white source: tungsten glows warm, LED/discharge cooler.
    result = { rgb: isTungsten(def, name) ? kelvinToRgb(3000) : kelvinToRgb(5600), carriesLevel: false };
  } else {
    result = { rgb: [1, 1, 1], carriesLevel: false };
  }

  // Filters that sit in front of any source.
  const tint = (rgb, filter) => rgb.map((v, i) => v * filter[i]);
  if (has("colour")) result.rgb = tint(result.rgb, wheelColour(def, read.raw("colour")));
  if (has("cct") && read.raw("cct") > 0) {
    // Tunable white: 0 = off/native, then 2700K → 6500K.
    const kelvin = 2700 + ((read.raw("cct") - 1) / 254) * 3800;
    result.rgb = hasEmitters ? tint(result.rgb, kelvinToRgb(kelvin).map(v => 0.5 + v / 2)) : kelvinToRgb(kelvin);
  }
  if (has("cto")) result.rgb = tint(result.rgb, kelvinToRgb(5600 - level("cto") * 2400));
  for (const key of MACRO_KEYS) {
    const value = read.raw(key);
    if (value != null && value > 10) {
      result.rgb = MACRO_PALETTE[Math.min(MACRO_PALETTE.length - 1, Math.floor(((value - 11) / 245) * MACRO_PALETTE.length))];
      if (result.carriesLevel) result.level = Math.max(result.level, 1);
    }
  }
  return result;
}

// Shutter/strobe: { rate: flashes per second (0 = steady), closed }.
export function decodeStrobe(def, read, name = "") {
  const value = read.raw("strobe") ?? read.raw("shutter");
  if (value == null) return { rate: 0 };
  const map = def?.map || {};
  const robe = /\brobe\b/i.test(`${def?.photometrics?.manufacturer || ""} ${name}`) || (isChannel(map.shutter) && map.shutter === map.strobe);
  if (robe) {
    // Robe: 0-31 closed, 32-63 open, 64-95 strobe slow→fast, then effects (shown open).
    if (value < 32) return { rate: 0, closed: true };
    if (value >= 64 && value <= 95) return { rate: 1 + ((value - 64) / 31) * 19 };
    return { rate: 0 };
  }
  // Most fixtures: 0-10 open, above that strobing, faster as it goes up.
  return value <= 10 ? { rate: 0 } : { rate: 1 + ((value - 11) / 244) * 24 };
}

// Rotation channels (gobo, prism, effect): most fixtures index (hold an
// angle) in the lower half and spin, one way then the other, in the upper.
export function decodeRotation(value) {
  if (value == null || value < 5) return { angle: 0, speed: 0 };
  if (value < 128) return { angle: ((value - 5) / 122) * Math.PI * 2, speed: 0 };
  if (value < 192) return { angle: 0, speed: ((value - 128) / 63) * 1.5 }; // turns per second
  return { angle: 0, speed: -((value - 192) / 63) * 1.5 };
}

const DEFAULT_ANGLE = { moving: 16, wash: 25, beam: 4, strobe: 110, blinder: 60, bar: 40, tungsten: 30, dimmer: 30 };

// Beam spread in degrees: zoom moves between the fixture's narrowest and widest
// angles; fixed-lens fixtures use their beam angle; iris narrows it.
// `chosen` is the angle set on this fixture in the console (patch or the
// Beam Angle card): for lights with a manual zoom or a choice of lenses.
// A DMX zoom channel still wins, since the console drives that live.
export function decodeBeamAngle(def, read, name = "", chosen = null) {
  const p = def?.photometrics || {};
  const narrow = Number(p.beamAngleMin) > 0 ? Number(p.beamAngleMin) : null;
  const wide = Number(p.beamAngleMax) > 0 ? Number(p.beamAngleMax) : null;
  const fixed = Number(p.beamAngle) > 0 ? Number(p.beamAngle) : null;
  const zoom = read("zoom");
  let angle;
  if (zoom == null && Number(chosen) > 0) angle = Number(chosen);
  else if (zoom != null && narrow && wide) angle = narrow + (wide - narrow) * zoom;
  else if (zoom != null) angle = /wash/i.test(name) || def?.type === "wash" ? 15 + zoom * 45 : 8 + zoom * 42;
  else angle = fixed || wide || narrow || (/wash/i.test(name) ? 30 : /\bbeam\b/i.test(name) ? 4 : null) || DEFAULT_ANGLE[def?.type] || 25;
  const iris = read("iris");
  if (iris != null) angle *= 1 - iris * 0.75;
  return Math.max(1, Math.min(150, angle));
}

// Light output in lumens when the fixture doesn't say: typical for its kind.
const DEFAULT_LUMENS = { moving: 4000, wash: 6000, beam: 3000, strobe: 12000, blinder: 10000, bar: 2500, tungsten: 6000, dimmer: 5000, rgb: 1500, rgbw: 2200, rgbal: 5000, rgbalc: 5000 };
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
  // A hazer or smoke machine patched as a plain dimmer channel, named for what it is.
  if (/\bhaze/i.test(name) && !isChannel(map.pan)) return "hazer";
  if (/\b(fog|smoke)\b/i.test(name) && !isChannel(map.pan)) return "fogger";
  // Library types are sometimes generic ("moving", "rgb"), so the name decides too.
  if (isChannel(map.pan) || isChannel(map.tilt)) {
    if (def?.type === "beam" || /\bbeam\b/i.test(name)) return "movingBeam";
    if (def?.type === "wash" || /wash/i.test(name)) return "movingWash";
    return "movingSpot";
  }
  if (def?.type === "strobe" || /strobe|atomic/i.test(name)) return "strobe";
  if (def?.type === "blinder" || /blinder/i.test(name)) return "blinder";
  if (def?.type === "bar" || /\bbar\b|batten|sunstrip|strip\b/i.test(name)) return "bar";
  if (/profile|leko|ellipsoidal/i.test(name) || [1, 2, 3, 4].some(n => isChannel(map[`shutter${n}Insert`]))) return "profile";
  if (def?.type === "tungsten" || def?.type === "dimmer" || /fresnel/i.test(name)) return "fresnel";
  return "par";
}

// Framing: four blades (0 = open, 1 = across the whole beam) and a frame
// rotation in radians. From DMX shutters on profiles, or the manual barn
// doors set on the fixture in the console (never sent over DMX).
export function decodeFraming(read, manual) {
  const blades = [1, 2, 3, 4].map(n => read(`shutter${n}Insert`) ?? 0);
  // Blade angles (e.g. SolaFrame A/B): how far each end of a blade pushes in,
  // so a blade can sit at a slant. 0.5 = straight.
  const angles = [1, 2, 3, 4].map(n => [read(`shutter${n}AngleA`) ?? 0.5, read(`shutter${n}AngleB`) ?? 0.5]);
  if (manual) {
    ["b1", "b2", "b3", "b4"].forEach((key, i) => { blades[i] = Math.max(blades[i], clamp01((Number(manual[key]) || 0) / 100)); });
  }
  const rotation = ((Number(manual?.rotate) || 0) * Math.PI) / 180;
  const active = blades.some(b => b > 0.001);
  return { blades, angles, rotation, active };
}

const goboSlot = value => (value > 7 ? 1 + (Math.floor((value - 8) / 16) % 8) : 0);

// Everything the visualiser needs for one fixture, from the console's buffer.
export function decodeFixture(def, frame, base, name = "", manualShutters = null, beamAngle = null) {
  const map = def?.map || {};
  const read = reader(frame, base, map);
  const colour = decodeColour(def, read, name);
  const dimmer = read.fine("dimmer", "dimmerFine") ?? read.fine("intensity", "intensityFine");
  let intensity = dimmer ?? (colour.carriesLevel ? colour.level : 1);
  if (dimmer != null && colour.carriesLevel) intensity *= colour.level;
  const strobe = decodeStrobe(def, read, name);
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
    beamAngle: decodeBeamAngle(def, read, name, beamAngle),
    // Focus (0 = near, 1 = far; null when the lens is focused by hand) and
    // frost. The edge they give depends on the throw, so it's worked out
    // where the beam's length is known (fixture-model.js).
    focus: read("focus"),
    frost: read("frost") ?? 0,
    // Radians from the centre of travel; null for fixtures that don't move.
    pan: pan == null ? null : (pan - 0.5) * (panRange * Math.PI / 180),
    tilt: tilt == null ? null : (tilt - 0.5) * (tiltRange * Math.PI / 180),
    // Gobo slots: 0 = open, 1+ = a pattern. Most wheels use bands of ~16 values.
    gobo: goboSlot(goboValue),
    gobo2: goboSlot(read.raw("gobo2") ?? 0),
    goboRotation: decodeRotation(read.raw("gobor") ?? read.raw("rot")),
    gobo2Rotation: decodeRotation(read.raw("gobo2r") ?? (isChannel(map.gobor) ? read.raw("rot") : null)),
    goboShake: (read.raw("shake") ?? 0) > 5 ? read("shake") : 0,
    effect: (read.raw("effect") ?? 0) > 5 ? read("effect") : 0,
    prism: (read.raw("prism") ?? 0) > 20,
    prismRotation: decodeRotation(read.raw("prismr")),
    // Colour wheel scroll: turns the wheel continuously (slots per second).
    colourScroll: (read.raw("colourr") ?? 0) > 5 ? read("colourr") * 2 : 0,
    framing: decodeFraming(read, manualShutters),
    // Atmosphere and mirror-ball motor, 0-1.
    // (A hazer on a plain dimmer channel: its level is its output.)
    fog: read("fog") ?? read("haze") ?? (/\b(haze|hazer|fog|smoke)/i.test(name) ? dimmer ?? 0 : 0),
    fan: read("fana") ?? 1,
    speed: read("speed") ?? 0
  };
}
