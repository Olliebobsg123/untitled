// What a fixture's DMX channels mean for the visualiser: how bright it is, what
// colour it makes, where it points, how wide the beam is and whether it's
// strobing. Plain functions with no three.js, so they can be tested on their own.

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const isChannel = value => Number.isInteger(value) && value >= 0;

// Read a channel (0-1) from a 512-slot frame, or null if the fixture doesn't have it.
export function reader(frame, base, map) {
  const raw = key => {
    const offset = map?.[key];
    if (!isChannel(offset)) return null;
    const index = base + offset;
    return index >= 0 && index < 512 ? frame[index] : null;
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

// Colour-wheel slot for a DMX value (the fixture's own wheel when it has one).
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

// Colour temperature (kelvin) → RGB, close enough for a visualiser.
export function kelvinToRgb(kelvin) {
  const t = Math.max(1000, Math.min(12000, kelvin)) / 100;
  const r = t <= 66 ? 1 : clamp01((329.698727446 * Math.pow(t - 60, -0.1332047592)) / 255);
  const g = t <= 66 ? clamp01((99.4708025861 * Math.log(t) - 161.1195681661) / 255) : clamp01((288.1221695283 * Math.pow(t - 60, -0.0755148492)) / 255);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp01((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);
  return [r, g, b];
}

const isTungsten = def => /tungsten|halogen|incandescent/i.test(`${def?.photometrics?.sourceType || ""} ${def?.name || ""}`);

// The colour the fixture makes (0-1 per channel, before intensity), and whether
// that colour also carries the brightness (RGB fixtures with no dimmer).
export function decodeColour(def, read, name = "") {
  const map = def?.map || {};
  const has = key => isChannel(map[key]);

  if (has("cyan") && has("magenta") && has("yellow")) {
    // Subtractive mixing (e.g. Robe ColorWash): white light minus C/M/Y, warmed by CTO.
    let rgb = [1 - read("cyan"), 1 - read("magenta"), 1 - read("yellow")];
    if (has("cto")) {
      const warm = kelvinToRgb(5600 - read("cto") * 2400);
      rgb = rgb.map((v, i) => v * warm[i]);
    }
    return { rgb, carriesLevel: false };
  }

  const r = map.r ?? map.red;
  const g = map.g ?? map.green;
  const b = map.b ?? map.blue;
  if (isChannel(r) && isChannel(g) && isChannel(b)) {
    // Additive LED mixing: each emitter adds its own colour.
    const emitters = [
      ["r", [1, 0, 0]], ["red", [1, 0, 0]], ["g", [0, 1, 0]], ["green", [0, 1, 0]], ["b", [0, 0, 1]], ["blue", [0, 0, 1]],
      ["w", [1, 0.95, 0.88]], ["white", [1, 0.95, 0.88]], ["amber", [1, 0.62, 0]], ["a", [1, 0.62, 0]],
      ["lime", [0.7, 1, 0]], ["l", [0.7, 1, 0]], ["c", [0, 1, 1]], ["uv", [0.35, 0, 1]]
    ];
    const seen = new Set();
    const mixed = [0, 0, 0];
    for (const [key, colour] of emitters) {
      if (!has(key) || seen.has(map[key])) continue;
      seen.add(map[key]);
      const level = read(key);
      colour.forEach((c, i) => { mixed[i] += c * level; });
    }
    // An LED cyan emitter (RGBACL fixtures) is named "cyan" when there's no CMY.
    if (has("cyan") && !seen.has(map.cyan)) { mixed[1] += read("cyan"); mixed[2] += read("cyan"); }
    const peak = Math.max(...mixed);
    return { rgb: peak > 0 ? mixed.map(v => v / peak) : [0, 0, 0], carriesLevel: true, level: Math.min(1, peak) };
  }

  if (has("colour")) {
    return { rgb: wheelColour(def, read.raw("colour")), carriesLevel: false };
  }

  if (has("warmWhite") || has("naturalWhite")) {
    const warm = has("warmWhite") ? read("warmWhite") : 0;
    const natural = has("naturalWhite") ? read("naturalWhite") : 0;
    const total = warm + natural;
    const kelvin = total > 0 ? (warm * 2700 + natural * 5600) / total : 3200;
    return { rgb: kelvinToRgb(kelvin), carriesLevel: !has("dimmer") && !has("intensity"), level: Math.min(1, Math.max(warm, natural)) };
  }

  // A plain white light: tungsten glows warm, LED/discharge cooler.
  return { rgb: isTungsten({ ...def, name }) ? kelvinToRgb(3000) : kelvinToRgb(5200), carriesLevel: false };
}

// Shutter/strobe: { open: 0-1 multiplier now, rate: flashes per second (0 = steady) }.
export function decodeStrobe(def, read) {
  const value = read.raw("strobe") ?? read.raw("shutter");
  if (value == null) return { rate: 0 };
  // Robe: 0-31 closed, 32-63 open, 64-95 strobe slow→fast, then other effects (shown open).
  if (/robe/i.test(def?.photometrics?.manufacturer || "")) {
    if (value < 32) return { rate: 0, closed: true };
    if (value >= 64 && value <= 95) return { rate: 1 + ((value - 64) / 31) * 19 };
    return { rate: 0 };
  }
  // Most fixtures: 0-10 open, above that strobing, faster as it goes up.
  return value <= 10 ? { rate: 0 } : { rate: 1 + ((value - 11) / 244) * 24 };
}

// Beam spread in degrees: the zoom channel moves between the fixture's narrowest
// and widest angles; fixed-lens fixtures use their beam angle.
export function decodeBeamAngle(def, read) {
  const p = def?.photometrics || {};
  const narrow = Number(p.beamAngleMin) > 0 ? Number(p.beamAngleMin) : null;
  const wide = Number(p.beamAngleMax) > 0 ? Number(p.beamAngleMax) : null;
  const fixed = Number(p.beamAngle) > 0 ? Number(p.beamAngle) : null;
  const zoom = read("zoom");
  if (zoom != null && narrow && wide) return narrow + (wide - narrow) * zoom;
  if (zoom != null) return 8 + zoom * 42;
  return fixed || wide || narrow || (def?.type === "moving" ? 18 : 30);
}

// Everything the visualiser needs for one fixture from its universe's frame.
export function decodeFixture(def, frame, base, name = "") {
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
  return {
    intensity: clamp01(intensity),
    rgb: colour.rgb,
    strobeRate: strobe.rate,
    beamAngle: decodeBeamAngle(def, read),
    softness: read("focus") == null ? 0.5 : 0.25 + read("focus") * 0.6,
    frost: read("frost") ?? 0,
    // Radians from the centre of travel; null for fixtures that don't move.
    pan: pan == null ? null : (pan - 0.5) * (panRange * Math.PI / 180),
    tilt: tilt == null ? null : (tilt - 0.5) * (tiltRange * Math.PI / 180),
    gobo: (read.raw("gobo") ?? 0) > 9
  };
}
