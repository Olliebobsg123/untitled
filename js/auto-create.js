"use strict";

/*
 * Auto Create: looks at what's patched and builds the everyday programming a
 * console does for you: groups, colour / position / beam / intensity
 * palettes, effects and chases. Everything it makes is an ordinary group,
 * palette, effect or chase (edit, rename or delete it like any other), tagged
 * `auto` so running it again after re-patching replaces what it made last
 * time, in place, without touching anything you made yourself.
 */
(function () {
  if (window.AutoCreate) return;

  const S = () => window.State || (window.State = {});
  const definition = fixture => window.getFixtureDefinition?.(fixture) || window.FixtureLibrary?.[fixture?.name] || null;
  const isChannel = (def, key) => typeof def?.map?.[key] === "number";
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------------------------------------------------------- the rig

  // What each patched fixture can do.
  function describe(fixture) {
    const def = definition(fixture) || {};
    const name = String(fixture.name || "");
    const rgb = ["r", "g", "b"].every(k => isChannel(def, k));
    const cmy = !rgb && ["cyan", "magenta", "yellow"].every(k => isChannel(def, k));
    const wheel = isChannel(def, "colour");
    const moving = isChannel(def, "pan") || isChannel(def, "tilt");
    const atmospheric = isChannel(def, "fog") || isChannel(def, "haze") || String(def.photometrics?.sourceType || "").toUpperCase() === "ATMOSPHERIC" || /mirror\s*ball/i.test(name);
    const strobe = String(def.type || "").toLowerCase() === "strobe" || /strobe|atomic/i.test(name);
    const kind = atmospheric ? "Atmospherics" : moving ? "Moving Heads" : strobe ? "Strobes" : rgb || cmy || wheel ? "LED & Colour" : "Dimmers";
    return {
      fixture, def, name, kind, rgb, cmy, wheel, moving, atmospheric,
      colour: rgb || cmy || wheel,
      light: !atmospheric && fixture.addr != null,
      gobo: isChannel(def, "gobo"), prism: isChannel(def, "prism"), zoom: isChannel(def, "zoom"),
      frost: isChannel(def, "frost"), iris: isChannel(def, "iris"), white: isChannel(def, "w")
    };
  }

  // Where each light hangs, in the visualiser's room (metres; stage front at
  // z = 0, audience towards +z, stage top at 1m). Saved positions come from
  // the visualiser layout; the rest use the visualiser's default hanging
  // (js/visualizer/theatre.js defaultHanging: up to 8 a bar, LX1-3 then FOH).
  const BARS = [{ y: 7.2, z: -1.2, length: 11 }, { y: 7.2, z: -3.8, length: 11 }, { y: 7.2, z: -6.4, length: 11 }, { y: 7.6, z: 6, length: 12 }];
  function positions(rig) {
    const saved = S().visualizer?.positions || {};
    const hung = rig.filter(r => !r.atmospheric);
    const result = new Map();
    hung.forEach((r, index) => {
      const own = saved[String(r.fixture.id)];
      if (own && [own.x, own.y, own.z].every(Number.isFinite)) { result.set(r.fixture.id, own); return; }
      const barIndex = Math.min(BARS.length - 1, Math.floor(index / 8));
      const bar = BARS[barIndex];
      const onBar = barIndex === BARS.length - 1 ? Math.max(1, hung.length - barIndex * 8) : Math.min(8, hung.length - barIndex * 8);
      const slot = index - barIndex * 8;
      const spacing = Math.min(1.3, (bar.length - 1.5) / Math.max(1, onBar - 1));
      result.set(r.fixture.id, { x: (slot - (onBar - 1) / 2) * spacing, y: bar.y - 0.08, z: bar.z });
    });
    return result;
  }

  // Pan/tilt (as the console's 16-bit pan/panf, tilt/tiltf) that points a
  // hung moving head at a point. Same convention as the visualiser: pan
  // turns the yoke about the vertical, tilt 0 is straight down. Of the ways
  // to reach a point, the one nearest the middle of the pan range wins.
  function aim(r, from, to) {
    const dx = to.x - from.x, dy = to.y - (from.y - 0.35), dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.asin(clamp(-dy / length, -1, 1));
    const panRange = (Number(r.def.panRange) || 540) * Math.PI / 180;
    const tiltRange = (Number(r.def.tiltRange) || 270) * Math.PI / 180;
    const options = [];
    for (const turn of [-2, -1, 0, 1, 2]) {
      options.push([yaw + turn * 2 * Math.PI, pitch - Math.PI / 2]);
      options.push([yaw + Math.PI + turn * 2 * Math.PI, Math.PI / 2 - pitch]);
    }
    const fits = options.filter(([p, t]) => Math.abs(p) <= panRange / 2 + 1e-6 && Math.abs(t) <= tiltRange / 2 + 1e-6);
    const [pan, tilt] = (fits.length ? fits : options).sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))[0];
    const word = v => Math.round(clamp(v, 0, 1) * 65535);
    const p16 = word(pan / panRange + 0.5), t16 = word(tilt / tiltRange + 0.5);
    return { pan: p16 >> 8, panf: p16 & 255, tilt: t16 >> 8, tiltf: t16 & 255 };
  }

  // The console's colour model: hue/sat/light, as js/dmx.js turns into RGB.
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  }

  // ---------------------------------------------------------- what to make

  const COLOURS = [
    ["White", 0, 0, 100, { w: 255 }],
    ["Warm White", 32, 70, 82, { w: 255 }],
    ["Cool White", 210, 45, 88, { w: 255 }],
    ["Red", 0, 100, 50], ["Orange", 22, 100, 50], ["Amber", 38, 100, 50, { amber: 255 }],
    ["Yellow", 55, 100, 50], ["Lime", 85, 100, 50], ["Green", 120, 100, 50],
    ["Cyan", 180, 100, 50], ["Light Blue", 200, 100, 68], ["Blue", 230, 100, 50],
    ["Congo Blue", 255, 100, 42], ["Lavender", 270, 100, 75], ["Magenta", 300, 100, 50],
    ["Pink", 330, 100, 72], ["UV", 275, 100, 45, { uv: 255 }]
  ];

  function colourValues([, hue, sat, light, extra = {}]) {
    return { hue, sat, light, w: 0, amber: 0, uv: 0, lime: 0, cyan: 0, magenta: 0, yellow: 0, ...extra };
  }

  // CMY fixtures mix by subtracting from white; everything else takes hue/sat.
  function cmyFor(colour) {
    const [r, g, b] = hslToRgb(colour[1], colour[2], colour[3]);
    const max = Math.max(r, g, b) || 1;
    return { cyan: Math.round((1 - r / max) * 255), magenta: Math.round((1 - g / max) * 255), yellow: Math.round((1 - b / max) * 255) };
  }

  function makeGroups(rig, pos) {
    const lights = rig.filter(r => r.light);
    const numbers = list => list.map(r => Number(r.fixture.fixtureNumber)).filter(Number.isInteger);
    const groups = [];
    // A group with exactly the same fixtures as one already made is skipped.
    const add = (key, name, list) => {
      const members = numbers(list);
      if (members.length && !groups.some(g => g.members.join() === members.join())) groups.push({ autoKey: key, name, members });
    };
    add("all", "All Lights", lights);
    const kinds = [...new Set(lights.map(r => r.kind))];
    if (kinds.length > 1) kinds.forEach(kind => add(`kind:${kind}`, `All ${kind}`, lights.filter(r => r.kind === kind)));
    const models = [...new Set(lights.map(r => r.name))];
    if (models.length > 1) models.forEach(model => {
      const list = lights.filter(r => r.name === model);
      if (list.length > 1) add(`model:${model}`, model.replace(/\s*\(.*\)\s*$/, ""), list);
    });
    if (lights.length >= 4) {
      add("odd", "Odd", lights.filter((_, i) => i % 2 === 0));
      add("even", "Even", lights.filter((_, i) => i % 2 === 1));
      // Stage left is the performers' left: +x, the audience's right.
      const byX = [...lights].sort((a, b) => (pos.get(a.fixture.id)?.x ?? 0) - (pos.get(b.fixture.id)?.x ?? 0));
      const half = Math.floor(byX.length / 2);
      add("sr", "Stage Right Half", byX.slice(0, half));
      add("sl", "Stage Left Half", byX.slice(byX.length - half));
    }
    return groups;
  }

  function makePalettes(rig, pos) {
    const lights = rig.filter(r => r.light);
    const palettes = [];
    const ids = list => list.map(r => r.fixture.id);
    const add = (key, name, category, values, list, perFixture = null) => {
      if (!list.length) return;
      palettes.push({ autoKey: key, name, category, values, fixtures: ids(list), ...(perFixture ? { perFixture } : {}) });
    };

    // Intensity
    for (const level of [100, 75, 50, 25, 0]) add(`int:${level}`, level ? `${level}%` : "Out", "Intensity", { intensity: level }, lights);

    // Colour
    const colourful = lights.filter(r => r.colour);
    const cmyRig = colourful.filter(r => r.cmy);
    for (const colour of COLOURS) {
      if (colour[0] === "UV" && !colourful.some(r => isChannel(r.def, "uv"))) continue;
      const perFixture = cmyRig.length ? Object.fromEntries(cmyRig.map(r => [r.fixture.id, cmyFor(colour)])) : null;
      add(`col:${colour[0]}`, colour[0], "Colour", colourValues(colour), colourful, perFixture);
    }

    // Position (moving heads), aimed at real spots on the stage.
    const movers = lights.filter(r => r.moving);
    const STAGE_Y = 1;
    const spots = [
      ["Centre Stage", () => ({ x: 0, y: STAGE_Y, z: -4 })],
      ["Downstage Centre", () => ({ x: 0, y: STAGE_Y, z: -1.3 })],
      ["Upstage Centre", () => ({ x: 0, y: STAGE_Y, z: -7 })],
      ["Stage Left", () => ({ x: 3.5, y: STAGE_Y, z: -4 })],
      ["Stage Right", () => ({ x: -3.5, y: STAGE_Y, z: -4 })],
      ["Fan Out", from => ({ x: clamp(from.x * 1.8, -5.5, 5.5), y: STAGE_Y, z: -4 })],
      ["Cross", from => ({ x: clamp(-from.x, -5.5, 5.5), y: STAGE_Y, z: -3 })],
      ["Back Wall", from => ({ x: clamp(from.x, -5, 5), y: 4.5, z: -8.3 })],
      ["Audience", from => ({ x: clamp(from.x, -6, 6), y: 2.5, z: 9 })]
    ];
    if (movers.length) {
      add("pos:Home", "Home", "Position", {}, movers, Object.fromEntries(movers.map(r => [r.fixture.id, { pan: 128, panf: 0, tilt: 128, tiltf: 0 }])));
      for (const [name, target] of spots) {
        const perFixture = Object.fromEntries(movers.map(r => {
          const from = pos.get(r.fixture.id) || { x: 0, y: 7.1, z: -1.2 };
          return [r.fixture.id, aim(r, from, target(from))];
        }));
        add(`pos:${name}`, name, "Position", {}, movers, perFixture);
      }
    }

    // Beam
    const withGobo = lights.filter(r => r.gobo), withPrism = lights.filter(r => r.prism), withZoom = lights.filter(r => r.zoom), withFrost = lights.filter(r => r.frost);
    const shaped = lights.filter(r => r.gobo || r.prism || r.frost || r.iris);
    add("beam:open", "Open", "Beam", { gobo: 0, gobo2: 0, prism: 0, frost: 0, iris: 0, gobor: 0, gobo2r: 0, prismr: 0 }, shaped);
    // Gobo slots in the bands the visualiser and most wheels use (16 values each).
    for (let slot = 1; slot <= 6; slot++) add(`beam:gobo${slot}`, `Gobo ${slot}`, "Beam", { gobo: slot * 16 }, withGobo);
    if (withGobo.length) add("beam:spin", "Gobo Spin", "Beam", { gobor: 200 }, withGobo);
    add("beam:prism", "Prism", "Beam", { prism: 128, prismr: 180 }, withPrism);
    add("beam:narrow", "Narrow", "Beam", { zoom: 0 }, withZoom);
    add("beam:wide", "Wide", "Beam", { zoom: 255 }, withZoom);
    add("beam:frost", "Frost", "Beam", { frost: 255 }, withFrost);
    return palettes;
  }

  // Left to right as the audience sees it (stage right, -x, first).
  const leftToRight = (list, pos) => [...list].sort((a, b) => (pos.get(a.fixture.id)?.x ?? 0) - (pos.get(b.fixture.id)?.x ?? 0));

  // Effects run live on the effects engine (js/effects.js), so they can be
  // smooth, random or continuous. Named "Kind: Effect" so the list sorts
  // into intensity, colour, movement and beam.
  function makeEffects(rig, pos) {
    const lights = leftToRight(rig.filter(r => r.light), pos);
    const colourful = lights.filter(r => r.colour);
    const movers = lights.filter(r => r.moving);
    const effects = [];
    const add = (kind, name, type, options, list) => {
      if (!list.length) return;
      effects.push({ autoKey: `fx:${kind}:${name}`, name: `${kind}: ${name}`, type, speed: options.speed ?? 1, ordered: true, ...options, fixtureMode: "custom", fixtureIds: list.map(r => String(r.fixture.id)) });
    };
    const reversed = list => [...list].reverse();
    const RAINBOW = [0, 30, 55, 120, 180, 235, 290];

    // Intensity
    const I = "Intensity";
    add(I, "Pulse Slow", "sine", { speed: 0.25 }, lights);
    add(I, "Pulse Fast", "sine", { speed: 1.5 }, lights);
    add(I, "Breathe", "sine", { speed: 0.15, min: 15 }, lights);
    add(I, "Heartbeat", "heartbeat", { speed: 1.1 }, lights);
    add(I, "Candle Flicker", "flicker", { speed: 1 }, lights);
    add(I, "Sparkle", "sparkle", { speed: 1, density: 0.25 }, lights);
    add(I, "Strobe Fast", "strobe", { speed: 12 }, lights);
    add(I, "Strobe Slow", "strobe", { speed: 3 }, lights);
    add(I, "Lightning", "lightning", { speed: 1 }, lights);
    if (lights.length >= 2) {
      add(I, "Odd / Even", "alternate", { speed: 2 }, lights);
      add(I, "Random", "random", { speed: 3 }, lights);
      add(I, "Sparkle Fast", "sparkle", { speed: 2.5, density: 0.15 }, lights);
    }
    if (lights.length >= 3) {
      add(I, "Wave Left → Right", "sine", { speed: 0.5, spread: 0.8, order: "reverse" }, lights);
      add(I, "Wave Right → Left", "sine", { speed: 0.5, spread: 0.8 }, lights);
      add(I, "Wave Centre Out", "sine", { speed: 0.5, spread: 0.7, order: "centre" }, lights);
      add(I, "Chase Left → Right", "chase", { speed: 4 }, lights);
      add(I, "Chase Right → Left", "chase", { speed: 4 }, reversed(lights));
      add(I, "Bounce", "bounce", { speed: 4 }, lights);
      add(I, "Build Left → Right", "build", { speed: 3 }, lights);
      add(I, "Build Centre Out", "build", { speed: 3, order: "centre" }, lights);
      add(I, "Ramp Up", "ramp", { speed: 0.5, spread: 0.5 }, lights);
      add(I, "Ramp Down", "ramp", { speed: 0.5, spread: 0.5, direction: "down" }, lights);
    }

    // Colour
    const C = "Colour";
    add(C, "Rainbow", "rainbow", { speed: 0.1 }, colourful.filter(r => r.rgb));
    add(C, "Rainbow Fast", "rainbow", { speed: 0.5 }, colourful.filter(r => r.rgb));
    add(C, "Rainbow Spread", "colourfade", { speed: 0.1, spread: 1, colours: RAINBOW }, colourful);
    add(C, "Red / Blue Fade", "colourfade", { speed: 0.2, colours: [0, 235] }, colourful);
    add(C, "Warm Fade", "colourfade", { speed: 0.15, spread: 0.3, colours: [0, 20, 38, 55] }, colourful);
    add(C, "Cool Fade", "colourfade", { speed: 0.15, spread: 0.3, colours: [180, 210, 240, 270] }, colourful);
    add(C, "Pink / Purple Fade", "colourfade", { speed: 0.15, spread: 0.3, colours: [300, 330, 270] }, colourful);
    add(C, "Sunset", "colourfade", { speed: 0.05, spread: 0.2, colours: [0, 22, 38, 330, 280] }, colourful);
    add(C, "Aurora", "colourfade", { speed: 0.08, spread: 0.6, colours: [120, 170, 280, 190] }, colourful);
    add(C, "RGB Step", "colourstep", { speed: 1, colours: [0, 120, 240] }, colourful);
    add(C, "Colour Chase", "colourstep", { speed: 3, spread: 1, colours: RAINBOW }, colourful);
    add(C, "Christmas", "colourstep", { speed: 1, spread: 0.5, colours: [0, 120] }, colourful);
    add(C, "Neon", "colourstep", { speed: 2, spread: 0.5, colours: [300, 180] }, colourful);
    add(C, "Candy", "colourstep", { speed: 1.5, spread: 0.34, colours: [330, 180, 55] }, colourful);
    add(C, "Fire", "fire", { speed: 1 }, colourful);
    add(C, "Water", "water", { speed: 0.3, spread: 0.6 }, colourful);
    add(C, "Police", "police", { speed: 1 }, colourful);
    add(C, "Disco", "disco", { speed: 3 }, colourful);

    // Movement (around wherever the heads are pointing)
    const M = "Movement";
    add(M, "Circle Small", "circle", { speed: 0.3, size: 8 }, movers);
    add(M, "Circle Large", "circle", { speed: 0.15, size: 20 }, movers);
    add(M, "Circle Fast", "circle", { speed: 0.8, size: 10 }, movers);
    add(M, "Figure 8", "figure8", { speed: 0.2, size: 14 }, movers);
    add(M, "Pan Sweep", "pansweep", { speed: 0.2, size: 18 }, movers);
    add(M, "Pan Sweep Wide", "pansweep", { speed: 0.1, size: 35 }, movers);
    add(M, "Tilt Nod", "tiltsweep", { speed: 0.4, size: 10 }, movers);
    add(M, "Ballyhoo", "ballyhoo", { speed: 0.25, size: 22 }, movers);
    add(M, "Ballyhoo Fast", "ballyhoo", { speed: 0.6, size: 18 }, movers);
    add(M, "Searchlight", "search", { speed: 0.3, size: 25 }, movers);
    add(M, "Random Search", "search", { speed: 0.8, size: 15 }, movers);
    if (movers.length >= 2) {
      add(M, "Circle Ripple", "circle", { speed: 0.25, size: 12, spread: 0.5 }, movers);
      add(M, "Pan Sweep Alternate", "pansweep", { speed: 0.2, size: 18, spread: 0.5 }, movers);
      add(M, "Tilt Wave", "tiltsweep", { speed: 0.3, size: 14, spread: 0.7 }, movers);
      add(M, "Fan", "fan", { speed: 0.2, size: 20 }, movers);
    }

    // Beam
    add("Beam", "Zoom Pulse", "zoompulse", { speed: 0.3 }, lights.filter(r => r.zoom));
    add("Beam", "Iris Pulse", "irispulse", { speed: 0.5 }, lights.filter(r => r.iris));
    return effects;
  }

  // Chases are recorded looks (snapshot mode), so they use no cue numbers.
  // They step from look to look with a fade, like a stack of cues on a loop.
  function makeChases(rig, pos) {
    const lights = leftToRight(rig.filter(r => r.light), pos);
    const colourful = lights.filter(r => r.colour);
    const movers = lights.filter(r => r.moving);
    const chases = [];

    // A full fixture state that keeps where the light is pointing.
    const base = r => {
      const current = window.ensureFixtureState?.(r.fixture.id) || {};
      const keep = {};
      for (const k of ["pan", "panf", "tilt", "tiltf", "zoom", "focus"]) if (current[k] != null) keep[k] = current[k];
      const fresh = typeof window.createFixtureState === "function" ? window.createFixtureState({}) : {};
      return { ...fresh, ...keep, intensity: 100, master: 100, strobe: 0, hue: 0, sat: 0, light: 100, w: 0 };
    };
    const look = (list, stateFor) => ({ globalState: {}, fixtureStates: list.map((r, i) => [r.fixture.id, { ...base(r), ...stateFor(r, i) }]) });
    const colour = name => COLOURS.find(c => c[0] === name);
    const tint = (r, name) => ({ ...colourValues(colour(name)), ...(r.cmy ? cmyFor(colour(name)) : {}) });
    const add = (kind, name, list, snapshots, speed, fade) => {
      if (list.length && snapshots.length) chases.push({ autoKey: `ch:${kind}:${name}`, name: `${kind}: ${name}`, mode: "snapshot", steps: [], snapshots, fixtureIds: list.map(r => r.fixture.id), loop: true, speed, fade });
    };
    const steps = n => [...Array(n).keys()];

    // Colour
    if (colourful.length) {
      const C = "Colour";
      const every = names => names.map(n => look(colourful, r => tint(r, n)));
      add(C, "RGB", colourful, every(["Red", "Green", "Blue"]), 40, 500);
      add(C, "CMY", colourful, every(["Cyan", "Magenta", "Yellow"]), 40, 500);
      add(C, "Rainbow", colourful, every(["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Magenta"]), 45, 600);
      add(C, "Warm", colourful, every(["Red", "Orange", "Amber", "Yellow"]), 30, 1500);
      add(C, "Cool", colourful, every(["Blue", "Cyan", "Lavender", "Congo Blue"]), 30, 1500);
      add(C, "Pastels", colourful, every(["Pink", "Lavender", "Light Blue", "Lime"]), 30, 1500);
      add(C, "Red White Blue", colourful, every(["Red", "White", "Blue", "White"]), 50, 200);
      const rolls = { "Rainbow Roll": ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Magenta"], "Warm Roll": ["Red", "Orange", "Amber", "Yellow"], "Cool Roll": ["Blue", "Cyan", "Lavender", "Congo Blue"], "RGB Roll": ["Red", "Green", "Blue"] };
      for (const [name, names] of Object.entries(rolls)) add(C, name, colourful, names.map((_, step) => look(colourful, (r, i) => tint(r, names[(step + i) % names.length]))), 45, 400);
      if (colourful.length >= 2) {
        for (const [a, b] of [["Red", "Blue"], ["Red", "White"], ["Blue", "White"], ["Green", "Magenta"], ["Cyan", "Pink"], ["Amber", "Blue"], ["Red", "Green"], ["Lavender", "Yellow"], ["Orange", "Cyan"]]) {
          add(C, `${a} / ${b} Swap`, colourful, [0, 1].map(step => look(colourful, (r, i) => tint(r, (i + step) % 2 ? b : a))), 50, 300);
        }
        for (const [a, b] of [["Red", "Blue"], ["Blue", "Amber"]]) {
          add(C, `${a} → ${b} Wipe`, colourful, steps(colourful.length + 1).map(step => look(colourful, (r, i) => tint(r, i < step ? b : a))), 70, 200);
        }
      }
    }

    // Intensity, left to right
    if (lights.length >= 2) {
      const I = "Intensity";
      const n = lights.length;
      const level = fn => steps => steps.map(step => look(lights, (r, i) => ({ intensity: fn(step, i) ? 100 : 0 })));
      add(I, "Odd / Even", lights, level((s, i) => i % 2 === s)([0, 1]), 60, 0);
      add(I, "Full / Out", lights, level(s => s === 0)([0, 1]), 60, 0);
      add(I, "Dim Steps", lights, [100, 60, 30, 60].map(v => look(lights, () => ({ intensity: v }))), 40, 800);
      add(I, "Halves", lights, level((s, i) => (i < n / 2) === (s === 0))([0, 1]), 55, 0);
      if (n >= 3) {
        add(I, "One By One →", lights, level((s, i) => i === s)(steps(n)), 80, 0);
        add(I, "One By One ←", lights, level((s, i) => n - 1 - i === s)(steps(n)), 80, 0);
        add(I, "Ping Pong", lights, level((s, i) => i === (s < n ? s : 2 * n - 2 - s))(steps(Math.max(2, 2 * n - 2))), 85, 0);
        add(I, "Pairs", lights, level((s, i) => Math.floor(i / 2) === s)(steps(Math.ceil(n / 2))), 70, 0);
        add(I, "Every Third", lights, level((s, i) => i % 3 === s)([0, 1, 2]), 65, 0);
        add(I, "Build Up", lights, level((s, i) => i <= s)(steps(n)), 75, 150);
        add(I, "Build & Clear", lights, level((s, i) => (s < n ? i <= s : i > s - n))(steps(2 * n)), 80, 100);
        const middle = (n - 1) / 2;
        const rings = Math.ceil(n / 2);
        add(I, "Centre Out", lights, level((s, i) => Math.round(Math.abs(i - middle) - (n % 2 ? 0 : 0.5)) === s)(steps(rings)), 70, 0);
        add(I, "Outside In", lights, level((s, i) => Math.round(Math.abs(i - middle) - (n % 2 ? 0 : 0.5)) === rings - 1 - s)(steps(rings)), 70, 0);
        // Fixed pseudo-random patterns, so the chase looks the same every time.
        const rnd = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
        add(I, "Random Pops", lights, level((s, i) => rnd(i + 1, s + 1) < 0.3)(steps(8)), 85, 0);
        add(I, "Twinkle", lights, steps(6).map(s => look(lights, (r, i) => ({ intensity: Math.round(30 + rnd(i + 2, s + 5) * 70) }))), 60, 700);
      }
    }

    // Movement, aimed at real places on stage (see aim()).
    if (movers.length) {
      const M = "Movement";
      const from = r => pos.get(r.fixture.id) || { x: 0, y: 7.1, z: -1.2 };
      const at = target => look(movers, (r, i) => aim(r, from(r), target(from(r), i)));
      const route = points => points.map(p => at(typeof p === "function" ? p : () => p));
      add(M, "Ballyhoo", movers, route([{ x: -4, y: 1, z: -1.5 }, { x: 4, y: 1, z: -1.5 }, { x: 4, y: 1, z: -7 }, { x: -4, y: 1, z: -7 }]), 25, 900);
      add(M, "Corners", movers, route([{ x: -5, y: 1, z: -1 }, { x: 5, y: 1, z: -1 }, { x: 5, y: 1, z: -8 }, { x: -5, y: 1, z: -8 }]), 35, 300);
      add(M, "Diamond", movers, route([{ x: 0, y: 1, z: -1 }, { x: 4.5, y: 1, z: -4.5 }, { x: 0, y: 1, z: -8 }, { x: -4.5, y: 1, z: -4.5 }]), 30, 800);
      add(M, "Left / Right Sweep", movers, route([{ x: -5, y: 1, z: -4 }, { x: 5, y: 1, z: -4 }]), 25, 1500);
      add(M, "Up / Downstage", movers, route([{ x: 0, y: 1, z: -1 }, { x: 0, y: 1, z: -8 }]), 25, 1500);
      add(M, "Fan In / Out", movers, route([() => ({ x: 0, y: 1, z: -4 }), f => ({ x: clamp(f.x * 1.8, -5.5, 5.5), y: 1, z: -4 })]), 20, 1200);
      add(M, "Cross / Uncross", movers, route([f => ({ x: clamp(-f.x, -5.5, 5.5), y: 1, z: -3 }), f => ({ x: clamp(f.x, -5.5, 5.5), y: 1, z: -3 })]), 25, 1000);
      add(M, "Stage / Audience", movers, route([{ x: 0, y: 1, z: -4 }, f => ({ x: clamp(f.x, -6, 6), y: 2.5, z: 9 })]), 30, 600);
      add(M, "Back Wall Sweep", movers, route([{ x: -5, y: 4.5, z: -8.3 }, { x: 5, y: 4.5, z: -8.3 }]), 20, 2000);
      add(M, "Circle", movers, route(steps(8).map(k => ({ x: Math.cos((k / 8) * Math.PI * 2) * 2.8, y: 1, z: -4 + Math.sin((k / 8) * Math.PI * 2) * 2.2 }))), 60, 500);
      add(M, "Figure 8", movers, route(steps(8).map(k => { const a = (k / 8) * Math.PI * 2; return { x: Math.sin(a) * 3.5, y: 1, z: -4 + Math.sin(a * 2) * 1.8 }; })), 55, 500);
      // Moving and colour together.
      const both = movers.filter(r => r.colour);
      if (both.length) {
        const wheel = ["Red", "Yellow", "Green", "Cyan", "Blue", "Magenta"];
        const points = [{ x: -4, y: 1, z: -1.5 }, { x: 4, y: 1, z: -1.5 }, { x: 4, y: 1, z: -7 }, { x: -4, y: 1, z: -7 }];
        add(M, "Rainbow Ballyhoo", both, steps(6).map(s => look(both, r => ({ ...aim(r, from(r), points[s % 4]), ...tint(r, wheel[s]) }))), 25, 900);
        add(M, "Police Sweep", both, [0, 1].map(s => look(both, (r, i) => ({ ...aim(r, from(r), { x: s ? 5 : -5, y: 1, z: -4 }), ...tint(r, (i + s) % 2 ? "Blue" : "Red") }))), 45, 700);
      }
    }

    // Beam
    const gobos = lights.filter(r => r.gobo), prisms = lights.filter(r => r.prism), zooms = lights.filter(r => r.zoom);
    add("Beam", "Gobo Cycle", gobos, steps(6).map(s => look(gobos, () => ({ gobo: (s + 1) * 16 }))), 45, 0);
    add("Beam", "Prism In / Out", prisms, [0, 1].map(s => look(prisms, () => ({ prism: s ? 128 : 0, prismr: s ? 180 : 0 }))), 40, 0);
    add("Beam", "Zoom Snap", zooms, [0, 1].map(s => look(zooms, () => ({ zoom: s ? 255 : 0 }))), 45, 0);
    return chases;
  }

  // ------------------------------------------------------------ merge in

  // Replace what Auto Create made last time (matched by autoKey) in place, so
  // numbers like "palette 3" or "group 2" stay put; drop auto items no
  // longer wanted; append new ones. Things you made are never touched.
  function merge(list, made) {
    const result = [];
    const byKey = new Map(made.map(item => [item.autoKey, item]));
    const used = new Set();
    for (const item of list) {
      if (!item?.auto) { result.push(item); continue; }
      const replacement = byKey.get(item.autoKey);
      if (replacement && !used.has(item.autoKey)) { result.push({ ...replacement, ...(item.id != null ? { id: item.id } : {}), auto: true }); used.add(item.autoKey); }
    }
    for (const item of made) if (!used.has(item.autoKey)) result.push({ ...item, auto: true });
    // Your own item already using a name: the auto one gets "(Auto)" added.
    const names = new Set(result.filter(i => !i?.auto).map(i => String(i?.name || "").toLowerCase()));
    for (const item of result) if (item?.auto && names.has(String(item.name).toLowerCase())) item.name = `${item.name} (Auto)`;
    return result;
  }

  function run(options = {}) {
    const want = { groups: true, palettes: true, effects: true, chases: true, ...options };
    const state = S();
    const rig = (Array.isArray(state.fixtures) ? state.fixtures : []).filter(Boolean).map(describe);
    if (!rig.some(r => r.light)) {
      window.log?.("Auto Create: patch some fixtures first", "warn");
      return null;
    }
    const pos = positions(rig);
    const counts = {};

    if (want.groups) {
      const made = makeGroups(rig, pos);
      state.groups = merge(Array.isArray(state.groups) ? state.groups : [], made);
      counts.groups = made.length;
      window.renderGroups?.();
    }
    if (want.palettes) {
      const made = makePalettes(rig, pos).map(p => ({ ...p, id: `palette-auto-${p.autoKey}`, createdAt: new Date().toISOString() }));
      state.palettes = merge(Array.isArray(state.palettes) ? state.palettes : [], made);
      for (const category of ["Colour", "Position", "Beam", "Intensity"]) counts[category] = made.filter(p => p.category === category).length;
      window.Palettes?.refresh?.();
    }
    if (want.effects) {
      const made = makeEffects(rig, pos);
      const current = Object.values(state.savedEffects || {});
      const merged = merge(current, made);
      state.savedEffects = Object.fromEntries(merged.map(effect => [effect.name, effect]));
      counts.effects = made.length;
      if (typeof window.renderEffectsList === "function") window.renderEffectsList();
    }
    if (want.chases) {
      const made = makeChases(rig, pos);
      state.chases = merge(Array.isArray(state.chases) ? state.chases : [], made);
      counts.chases = made.length;
      window.renderChases?.();
    }

    const parts = [];
    if (counts.groups != null) parts.push(`${counts.groups} groups`);
    if (counts.Colour != null) parts.push(`${counts.Colour} colour, ${counts.Position} position, ${counts.Beam} beam, ${counts.Intensity} intensity palettes`);
    if (counts.effects != null) parts.push(`${counts.effects} effects`);
    if (counts.chases != null) parts.push(`${counts.chases} chases`);
    window.log?.(`✨ Auto Create: ${parts.join(" · ")}`, "ok");
    return counts;
  }

  // ------------------------------------------------------------------ UI

  function openDialog() {
    let modal = document.getElementById("autoCreateModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "autoCreateModal";
      modal.className = "palette-modal";
      modal.innerHTML = `
        <div class="palette-window" role="dialog" aria-modal="true" aria-label="Auto Create" style="width:min(520px,94vw)">
          <div class="palette-window-head"><div class="palette-window-title">AUTO CREATE<small>FROM YOUR PATCH</small></div><button type="button" class="palette-window-close" aria-label="Close">×</button></div>
          <div style="padding:15px 17px;color:#9aa7a4;font-size:11px;line-height:1.5">
            Builds groups, palettes, effects and chases for the fixtures you've patched. Position palettes aim each moving head at the stage from where it hangs in the visualiser.
            Running it again updates what it made before; your own groups, palettes, effects and chases are never changed.
          </div>
          <div style="padding:0 17px 6px;display:grid;gap:8px;font-size:12px;color:#d9e2e0">
            <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-auto="groups" checked> Groups <small style="color:#66736f">all, by type, by model, odd/even, left/right</small></label>
            <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-auto="palettes" checked> Palettes <small style="color:#66736f">colour, position, beam, intensity</small></label>
            <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-auto="effects" checked> Effects <small style="color:#66736f">intensity, colour, movement and beam effects</small></label>
            <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-auto="chases" checked> Chases <small style="color:#66736f">colour, intensity, movement and beam chases</small></label>
          </div>
          <div class="palette-actions-row" style="padding:12px 17px 17px"><button type="button" class="btn-primary" data-auto-go>✨ Create</button><button type="button" class="btn-secondary" data-auto-cancel>Cancel</button></div>
        </div>`;
      document.body.appendChild(modal);
      const close = () => modal.classList.remove("open");
      modal.querySelector(".palette-window-close").addEventListener("click", close);
      modal.querySelector("[data-auto-cancel]").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      modal.querySelector("[data-auto-go]").addEventListener("click", () => {
        const options = Object.fromEntries([...modal.querySelectorAll("input[data-auto]")].map(i => [i.dataset.auto, i.checked]));
        if (run(options)) close();
      });
    }
    modal.classList.add("open");
  }

  function installButton() {
    if (document.getElementById("btnAutoCreate")) return;
    const row = document.getElementById("btnPatch")?.closest(".action-row");
    if (!row) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "btnAutoCreate";
    button.className = "btn-secondary";
    button.textContent = "✨ Auto Create";
    button.title = "Make groups, palettes, effects and chases from the patch";
    button.addEventListener("click", openDialog);
    row.appendChild(button);
  }

  // Typed command: "auto create" (or "autocreate").
  function installCommand() {
    if (window.__autoCreateCommandInstalled || typeof window.parseCommand !== "function") return;
    const previous = window.parseCommand;
    window.parseCommand = function (raw) {
      if (/^\s*auto\s*create\s*$/i.test(String(raw || ""))) return run();
      return previous.apply(this, arguments);
    };
    window.__autoCreateCommandInstalled = true;
  }

  window.AutoCreate = Object.freeze({ run, open: openDialog, aim, describe });

  function boot() {
    installButton();
    installCommand();
    // Other scripts re-wrap parseCommand and rebuild panels after load.
    setTimeout(() => { installButton(); installCommand(); }, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
