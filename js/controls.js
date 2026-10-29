"use strict";

// UI-only control helpers. Multi-fixture Pan/Tilt and Home live here.
(function initialiseControls() {
  // Which wheel a MIXED RGB+CMY selection currently follows — see
  // isCMYSelection/buildColourModeToggle. Defaults to RGB since that's
  // the more common colour model across this library.
  let colourMixMode = "rgb";

  const getSelectedFixtures = () => {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures)) return [];
    const ids = new Set();
    if (state.selected instanceof Set) state.selected.forEach(id => ids.add(String(id)));
    document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el => ids.add(String(el.dataset.fixtureId)));
    if (!ids.size && state.selectedFixtureId != null) ids.add(String(state.selectedFixtureId));
    return state.fixtures.filter(f => ids.has(String(f?.id)));
  };

  const getDefinition = fixture => {
    if (!fixture) return null;
    if (typeof window.getFixtureDefinition === "function") return window.getFixtureDefinition(fixture) || null;
    return window.FixtureLibrary?.[fixture.name] || null;
  };

  const getState = fixture => {
    if (!fixture) return null;
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    const state = window.State;
    if (!(state.fixtureStates instanceof Map)) state.fixtureStates = new Map();
    if (!state.fixtureStates.has(fixture.id)) state.fixtureStates.set(fixture.id, { ...(state.current || {}), pan: 128, tilt: 128 });
    return state.fixtureStates.get(fixture.id);
  };

  if (!document.querySelector('link[data-home-button-css]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "home-button.css";
    link.dataset.homeButtonCss = "1";
    document.head?.appendChild(link);
  }

  // ------------------------------------------------------------
  // Fixture capability visibility
  // ------------------------------------------------------------
  // Shared cards are hidden when none of the selected fixtures has the
  // corresponding mapped channel. For multiple/all selections we use a UNION
  // of capabilities, so a fixture without a parameter cannot remove that
  // parameter from the other selected fixtures.
  const CONTROL_CAPABILITIES = {
    intensity: ["intensity", "dimmer", "dim"],
    strobe: ["strobe", "shutter"],
    zoom: ["zoom"],
    colour: ["hue", "sat", "saturation", "r", "g", "b", "w", "white", "amber", "uv", "cyan", "magenta", "colour"],
    xy: ["pan", "tilt"]
  };

  // Related channels are grouped into ONE compact card instead of
  // one full fader card per channel — a fixture with 4 framing-
  // shutter blades used to mean 8 full-size cards; it's now one
  // "Shutters" card with 4 compact two-slider rows. "pair" rows
  // list every real-world channel-naming convention that could
  // apply (e.g. Insert/Rotate vs. the two-point Angle A/Angle B
  // some manufacturers use) — whichever one the selected fixture
  // actually has is used; the others are simply never shown.
  const DYNAMIC_CONTROL_GROUPS = [
    {
      // Hazers and fog machines: their output, fan and fluid pump, first
      // on the main tab (most have no dimmer, so the level alone does nothing).
      title: "Atmosphere",
      tab: "beam",
      rows: [
        { type: "single", key: "haze", label: "Haze output" },
        { type: "single", key: "fog", label: "Fog output" },
        { type: "single", key: "fana", label: "Fan" },
        { type: "single", key: "fluid", label: "Fluid" }
      ]
    },
    {
      title: "Beam Shaping",
      tab: "beam",
      rows: [
        { type: "single", key: "focus", label: "Focus" },
        { type: "single", key: "frost", label: "Frost" },
        { type: "single", key: "iris", label: "Iris" }
      ]
    },
    {
      title: "Gobo 1",
      tab: "beam",
      rows: [
        { type: "pair", label: "Gobo 1", options: [
          { a: { key: "gobo", label: "Pattern" }, b: { key: "gobor", label: "Rotate" } }
        ] }
      ]
    },
    {
      title: "Gobo 2",
      tab: "beam",
      rows: [
        { type: "pair", label: "Gobo 2", options: [
          { a: { key: "gobo2", label: "Pattern" }, b: { key: "gobo2r", label: "Rotate" } }
        ] }
      ]
    },
    {
      title: "Prism",
      tab: "beam",
      rows: [
        { type: "pair", label: "Prism", options: [
          { a: { key: "prism", label: "Engage" }, b: { key: "prismr", label: "Rotate" } }
        ] }
      ]
    },
    {
      title: "Shutters",
      tab: "beam",
      rows: [1, 2, 3, 4].map(n => ({
        type: "pair",
        label: `Blade ${n}`,
        options: [
          { a: { key: `shutter${n}Insert`, label: "Insert" }, b: { key: `shutter${n}Rotate`, label: "Rotate" } },
          { a: { key: `shutter${n}AngleA`, label: "A" }, b: { key: `shutter${n}AngleB`, label: "B" } }
        ]
      }))
    },
    {
      // Extra colour-mixing channels independent of the main HSL
      // swatch: additive diodes some RGBA/RGBAL/RGBALC fixtures
      // carry alongside R/G/B, and subtractive CMY(+CTO) dichroic
      // mixing on fixtures with no separate RGB channels at all.
      title: "Colour Mixing",
      tab: "colour",
      rows: [
        { type: "single", key: "amber", label: "Amber" },
        { type: "single", key: "lime", label: "Lime" },
        { type: "single", key: "uv", label: "UV" },
        { type: "single", key: "cyan", label: "Cyan" },
        { type: "single", key: "magenta", label: "Magenta" },
        { type: "single", key: "yellow", label: "Yellow" },
        { type: "single", key: "cto", label: "CTO" },
        // Vari-Lite's own mixing flags (VL3000: Blue, Amber, Magenta):
        // faders of their own, so the colour picker keeps driving the wheel.
        { type: "single", key: "blueMix", label: "Blue mix" },
        { type: "single", key: "amberMix", label: "Amber mix" },
        { type: "single", key: "magentaMix", label: "Magenta mix" }
      ]
    },
    {
      // Everything here is a plain single 0-255 channel with no
      // dedicated visual model of its own yet (unlike gobo/prism/
      // shutters above) — still exposed as a control since the
      // real DMX channel exists and should be reachable, just
      // grouped compactly instead of getting a full card each.
      title: "Effects & Movement",
      tab: "custom",
      rows: [
        { type: "single", key: "rot", label: "Rotation" },
        { type: "single", key: "effect", label: "Effect" },
        { type: "single", key: "speed", label: "Speed" },
        { type: "single", key: "macro", label: "Macro" },
        { type: "single", key: "preset", label: "Preset" },
        { type: "single", key: "shake", label: "Shake" },
        { type: "single", key: "mode", label: "Mode" },
        { type: "single", key: "zone", label: "Zone" },
        { type: "single", key: "colmacro", label: "Colour Macro" }
      ]
    }
  ];

  // Manual barn doors — not a DMX capability. Real fresnels/PAR
  // cans commonly carry a physical 4-way barn door frame shaped
  // by hand at the fixture instead of over DMX. Any fixture that
  // already has real DMX-driven framing shutters, or that pans/
  // tilts, or that's a strobe, is excluded — those either already
  // shape their beam over DMX or don't carry barn doors in real
  // life. Values live on the fixture instance itself (not in
  // fixtureStates/DMX) since nothing here is ever transmitted.
  const MANUAL_SHUTTER_DMX_KEYS = [1, 2, 3, 4].flatMap(n => [
    `shutter${n}Insert`, `shutter${n}Rotate`, `shutter${n}AngleA`, `shutter${n}AngleB`
  ]);

  function eligibleForManualShutters(fixture) {
    const def = getDefinition(fixture);
    if (String(def?.type || "").toLowerCase() === "strobe") return false;
    const map = def?.map || {};
    if (typeof map.pan === "number" || typeof map.tilt === "number") return false;
    return !MANUAL_SHUTTER_DMX_KEYS.some(key => typeof map[key] === "number");
  }

  function manualShutterFixtures(fixtures) {
    return fixtures.filter(eligibleForManualShutters);
  }

  function ensureManualShutters(fixture) {
    if (!fixture.manualShutters) fixture.manualShutters = { b1: 0, b2: 0, b3: 0, b4: 0, rotate: 0 };
    return fixture.manualShutters;
  }

  function applyManualShutter(key, value, max) {
    const number = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    const fixtures = manualShutterFixtures(getSelectedFixtures());
    if (!fixtures.length) return number;
    for (const fixture of fixtures) ensureManualShutters(fixture)[key] = number;
    window.sendToVisualizer?.();
    return number;
  }

  function buildManualField(label, value, max, suffix, onChange) {
    const field = document.createElement("div");
    field.className = "dynamic-field";

    const labelEl = document.createElement("span");
    labelEl.className = "dynamic-field-label";
    labelEl.textContent = label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(max);
    input.step = "1";
    input.value = String(value);
    input.className = "dynamic-mini-fader";

    const valueEl = document.createElement("strong");
    valueEl.className = "dynamic-field-val";
    valueEl.textContent = `${value}${suffix}`;

    const handler = () => {
      const applied = onChange(input.value);
      valueEl.textContent = `${applied}${suffix}`;
    };
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);

    field.append(labelEl, input, valueEl);
    return field;
  }

  // Beam angle chosen for a fixture: for lights with a manual zoom or a
  // choice of lenses (a 15-30 degree profile, a par with different lamps).
  // Stored on the fixture like the barn doors, saved with the show, and
  // used by the visualiser. A DMX zoom channel drives the angle instead.
  function beamAngleInfo(def) {
    const p = def?.photometrics || {};
    const min = Number(p.beamAngleMin) > 0 ? Number(p.beamAngleMin) : null;
    const max = Number(p.beamAngleMax) > 0 ? Number(p.beamAngleMax) : null;
    const fixed = Number(p.beamAngle) > 0 ? Number(p.beamAngle) : null;
    const zoom = typeof def?.map?.zoom === "number";
    const text = min && max && min !== max ? `${min}–${max}°` : fixed || min || max ? `${fixed || min || max}°` : "";
    return { min, max, fixed, zoom, text };
  }
  window.LXBeamAngle = Object.freeze({
    info: beamAngleInfo,
    // A typed angle, or null for "use the library". Clamped to 1-150°.
    parse(value) {
      const number = Number(String(value ?? "").replace("°", "").trim());
      return String(value ?? "").trim() && Number.isFinite(number) && number > 0 ? Math.max(1, Math.min(150, Math.round(number * 10) / 10)) : null;
    }
  });

  function applyBeamAngle(fixtures, angle) {
    for (const fixture of fixtures) {
      if (angle == null) delete fixture.beamAngle;
      else fixture.beamAngle = angle;
    }
    window.sendToVisualizer?.();
  }

  function renderBeamAngle(container, fixtures) {
    const settable = fixtures.filter(f => !beamAngleInfo(getDefinition(f)).zoom);
    const zoomOnly = fixtures.length && !settable.length;
    if (!fixtures.length) return;
    const representative = settable.length ? settable[settable.length - 1] : fixtures[0];
    const info = beamAngleInfo(getDefinition(representative));

    const card = document.createElement("div");
    card.className = "control-group parameter-card dynamic-parameter-card";
    const heading = document.createElement("div");
    heading.className = "dynamic-group-heading";
    heading.textContent = "Beam Angle & Focus";
    card.appendChild(heading);

    const note = document.createElement("div");
    note.style.cssText = "color:var(--text-muted,#7c8a92);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:4px 2px 0;line-height:1.4;";

    if (zoomOnly) {
      note.textContent = "Set by the Zoom control on this fixture.";
      card.appendChild(note);
      renderEdge(card, fixtures);
      container.appendChild(card);
      return;
    }

    const lo = Math.max(1, Math.floor(info.min ? info.min * 0.5 : 1));
    const hi = Math.min(150, Math.ceil(info.max ? Math.max(info.max * 1.5, info.max + 10) : 90));
    const current = representative.beamAngle ?? info.fixed ?? info.min ?? 25;

    const field = document.createElement("div");
    field.className = "dynamic-field";
    const label = document.createElement("span");
    label.className = "dynamic-field-label";
    label.textContent = "Angle";
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(lo);
    range.max = String(hi);
    range.step = "0.5";
    range.value = String(current);
    range.className = "dynamic-mini-fader";
    const number = document.createElement("input");
    number.type = "number";
    number.min = "1";
    number.max = "150";
    number.step = "0.5";
    number.placeholder = info.text || "auto";
    number.value = representative.beamAngle != null ? String(representative.beamAngle) : "";
    number.title = "Degrees. Leave empty to use the library angle.";
    number.style.cssText = "width:58px;";
    field.append(label, range, number);

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn-secondary";
    reset.textContent = "Library";
    reset.title = info.text ? `Back to the library angle (${info.text})` : "Back to the library angle";
    reset.style.cssText = "margin-left:6px;padding:2px 8px;font-size:13px;";
    field.appendChild(reset);

    const describe = () => {
      const chosen = representative.beamAngle;
      const library = info.text ? `Library ${info.text}` : "No library angle";
      const zoomNote = settable.length < fixtures.length ? " · zoom fixtures use their Zoom control" : "";
      note.textContent = (chosen != null ? `Set to ${chosen}° · ${library}` : `${library} (in use)`) + zoomNote;
    };
    range.addEventListener("input", () => {
      const angle = window.LXBeamAngle.parse(range.value);
      number.value = String(angle);
      applyBeamAngle(settable, angle);
      describe();
    });
    number.addEventListener("change", () => {
      const angle = window.LXBeamAngle.parse(number.value);
      if (angle != null) range.value = String(angle);
      number.value = angle != null ? String(angle) : "";
      applyBeamAngle(settable, angle);
      describe();
    });
    reset.addEventListener("click", () => {
      number.value = "";
      range.value = String(info.fixed ?? info.min ?? 25);
      applyBeamAngle(settable, null);
      describe();
    });

    const row = document.createElement("div");
    row.className = "dynamic-row";
    row.appendChild(field);
    card.appendChild(row);
    describe();
    card.appendChild(note);
    renderEdge(card, fixtures);
    container.appendChild(card);
  }

  // Edge: how sharply a hand-focused light is focused (0 sharp - 100 soft).
  // Empty = the usual edge for that kind of light (profiles sharp, pars
  // soft-edged, fresnels soft). Fixtures with a Focus channel use that.
  function renderEdge(card, fixtures) {
    const settable = fixtures.filter(f => typeof getDefinition(f)?.map?.focus !== "number");
    if (!settable.length) return;
    const representative = settable[settable.length - 1];
    const field = document.createElement("div");
    field.className = "dynamic-field";
    const label = document.createElement("span");
    label.className = "dynamic-field-label";
    label.textContent = "Edge";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.step = "1";
    range.className = "dynamic-mini-fader";
    range.title = "Sharp (left) to soft (right)";
    const value = document.createElement("strong");
    value.className = "dynamic-field-val";
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "btn-secondary";
    auto.textContent = "Auto";
    auto.title = "The usual edge for this kind of light";
    auto.style.cssText = "margin-left:6px;padding:2px 8px;font-size:13px;";
    const show = () => {
      const edge = representative.edge;
      range.value = String(Math.round((edge ?? 0.2) * 100));
      value.textContent = edge == null ? "Auto" : edge <= 0.08 ? "Sharp" : edge >= 0.6 ? "Soft" : `${Math.round(edge * 100)}%`;
    };
    range.addEventListener("input", () => {
      const edge = Math.max(0, Math.min(1, Number(range.value) / 100));
      for (const fixture of settable) fixture.edge = edge;
      window.sendToVisualizer?.();
      show();
    });
    auto.addEventListener("click", () => {
      for (const fixture of settable) delete fixture.edge;
      window.sendToVisualizer?.();
      show();
    });
    field.append(label, range, value, auto);
    const row = document.createElement("div");
    row.className = "dynamic-row";
    row.appendChild(field);
    card.appendChild(row);
    show();
  }

  function renderManualBarnDoors(container, fixtures) {
    const eligible = manualShutterFixtures(fixtures);
    if (!eligible.length) return;

    const representative = eligible[eligible.length - 1];
    const m = ensureManualShutters(representative);

    const card = document.createElement("div");
    card.className = "control-group parameter-card dynamic-parameter-card";

    const heading = document.createElement("div");
    heading.className = "dynamic-group-heading";
    heading.textContent = "Barn Doors";
    card.appendChild(heading);

    [["b1", "Blade 1"], ["b2", "Blade 2"], ["b3", "Blade 3"], ["b4", "Blade 4"]].forEach(([key, label]) => {
      const row = document.createElement("div");
      row.className = "dynamic-row";
      row.appendChild(buildManualField(label, m[key] ?? 0, 100, "%", value => applyManualShutter(key, value, 100)));
      card.appendChild(row);
    });

    const rotateRow = document.createElement("div");
    rotateRow.className = "dynamic-row";
    rotateRow.appendChild(buildManualField("Frame Rotate", m.rotate ?? 0, 360, "°", value => applyManualShutter("rotate", value, 360)));
    card.appendChild(rotateRow);

    const note = document.createElement("div");
    note.textContent = "Manual — shaped at the fixture, never sent over DMX.";
    note.style.cssText = "color:var(--text-muted,#7c8a92);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:4px 2px 0;line-height:1.4;";
    card.appendChild(note);

    container.appendChild(card);
  }

  const mapHasCapability = (map, names) => names.some(name => typeof map?.[name] === "number");

  function selectedCapability(capability) {
    const fixtures = getSelectedFixtures();
    if (!fixtures.length) return false;
    const names = CONTROL_CAPABILITIES[capability] || [capability];
    return fixtures.some(fixture => mapHasCapability(getDefinition(fixture)?.map || {}, names));
  }

  function setGroupVisibility(id, visible) {
    const group = document.getElementById(id);
    if (group) group.style.display = visible ? "" : "none";
  }

  function setInputGroupVisibility(inputId, visible) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const group = input.closest(".control-group");
    if (group) group.style.display = visible ? "" : "none";
  }

  function setDynamicValue(key, value) {
    const input = document.getElementById(`dynamic-${key}`);
    const output = document.getElementById(`dynamic-${key}-val`);
    if (input) input.value = value;
    if (output) output.textContent = String(value);
  }

  function applyDynamicParameter(key, value) {
    const number = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    const fixtures = getSelectedFixtures();
    if (!fixtures.length) return;

    let changed = false;
    for (const fixture of fixtures) {
      const map = getDefinition(fixture)?.map || {};
      if (typeof map[key] !== "number") continue;
      const state = getState(fixture);
      if (!state) continue;
      state[key] = number;
      window.State.fixtureStates.set(fixture.id, state);
      changed = true;
    }

    if (!changed) return;
    window.State.current ||= {};
    window.State.current[key] = number;
    setDynamicValue(key, number);
    window.updateDMX?.();
    window.sendToVisualizer?.();
  }

  function buildDynamicField(key, label) {
    const field = document.createElement("div");
    field.className = "dynamic-field";

    const labelEl = document.createElement("span");
    labelEl.className = "dynamic-field-label";
    labelEl.textContent = label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "255";
    input.step = "1";
    input.value = "0";
    input.id = `dynamic-${key}`;
    input.className = "dynamic-mini-fader";
    input.dataset.dynamicControl = key;

    const value = document.createElement("strong");
    value.className = "dynamic-field-val";
    value.id = `dynamic-${key}-val`;
    value.textContent = "0";

    input.addEventListener("input", () => applyDynamicParameter(key, input.value));
    input.addEventListener("change", () => applyDynamicParameter(key, input.value));

    field.append(labelEl, input, value);
    return field;
  }

  // Subtractive HSL->RGB and its inverse, scoped to the CMY wheel —
  // deliberately separate from js/app.js's own copy (used by the
  // additive RGB colour wheel) since the two must stay independently
  // editable, and from js/dmx.js's colourHSL (which clamps 0-100
  // percentages rather than the 0-255 device values this widget shows).
  function cmyHueSatToRgb(h, s, l) {
    h = ((Number(h) || 0) % 360 + 360) % 360;
    s = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
    l = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function cmyRgbToHueSat(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return [h, Math.round(s * 100)];
  }

  function hasTrueCMYOne(fixture) {
    const map = getDefinition(fixture)?.map || {};
    return typeof map.cyan === "number" && typeof map.magenta === "number" && typeof map.yellow === "number";
  }

  // True if ANY selected fixture has real cyan/magenta/yellow
  // (subtractive), regardless of what else is also selected — NOTE
  // this alone doesn't distinguish a true-CMY fixture (ROBE ColorWash,
  // SolaFrame 750, CyberLight) from one that carries cyan/magenta/
  // yellow as extra ADDITIVE LEDs alongside real r/g/b (e.g. the
  // Performer 2000 RGBAL); combine with hasMainWheelFixture for that,
  // same as isCMYSelection below does.
  function hasTrueCMY(fixtures) {
    return fixtures.some(hasTrueCMYOne);
  }

  // True if ANY selected fixture is actually controlled by the MAIN
  // hue/sat wheel rather than the CMY one — real r/g/b, OR a discrete
  // colour wheel (Vari-Lite VL3000, SolaFrame's own wheel channel,
  // etc.) — as long as that same fixture doesn't ALSO have real CMY.
  // A fixture with both a wheel channel AND real CMY (CyberLight,
  // SolaFrame 750) is CMY-primary (js/dmx.js's hasCMYPrimary skips its
  // wheel channel entirely), so it must NOT count here — otherwise a
  // CyberLight selected on its OWN would look "mixed" with itself and
  // wrongly show the mode toggle.
  function hasMainWheelFixture(fixtures) {
    return fixtures.some(fixture => {
      if (hasTrueCMYOne(fixture)) return false;
      const map = getDefinition(fixture)?.map || {};
      const hasRGB = typeof map.r === "number" && typeof map.g === "number" && typeof map.b === "number";
      const hasWheel = typeof map.colour === "number";
      return hasRGB || hasWheel;
    });
  }

  // A discrete-wheel-only fixture (VL3000, SolaFrame's own wheel
  // channel — no true CMY) in the selection, if any — used to make a
  // CMY-capable fixture in the SAME mixed selection match that
  // fixture's actual gel colour exactly (see resolveWheelRGB) rather
  // than independently computing its own nearby-but-different shade
  // from the raw picked hue. A fixture with no colourWheel data at all
  // (a plain continuous-sweep wheel) doesn't need this — it can
  // already hit any hue precisely, same as the CMY fixture can.
  function findWheelOnlyFixture(fixtures) {
    return fixtures.find(fixture => {
      if (hasTrueCMYOne(fixture)) return false;
      const def = getDefinition(fixture);
      return typeof def?.map?.colour === "number" && Array.isArray(def.colourWheel) && def.colourWheel.length;
    }) || null;
  }

  // The real RGB (0-1 floats, as stored in a fixture's own colourWheel
  // data) that a discrete-wheel fixture will actually resolve a given
  // hue/sat pick to — the exact same nearest-slot search js/dmx.js's
  // colourWheelDMX() does, just returning the slot's colour instead of
  // its DMX byte, so a CMY-capable fixture in the same selection can
  // match it precisely instead of computing an independent shade.
  function resolveWheelRGB(fixture, hue, sat) {
    const wheel = getDefinition(fixture)?.colourWheel;
    if (!Array.isArray(wheel) || !wheel.length) return null;
    if (Number(sat) < 5) {
      const white = wheel.find(s => Array.isArray(s.rgb) && s.rgb[0] === 1 && s.rgb[1] === 1 && s.rgb[2] === 1);
      if (white) return white.rgb;
    }
    const target = ((Number(hue) || 0) % 360 + 360) % 360;
    let best = wheel[0], bestDist = Infinity;
    for (const slot of wheel) {
      if (typeof slot.hue === "undefined") continue;
      const slotHue = ((slot.hue % 360) + 360) % 360;
      const d = Math.min(Math.abs(target - slotHue), 360 - Math.abs(target - slotHue));
      if (d < bestDist) { bestDist = d; best = slot; }
    }
    return Array.isArray(best?.rgb) ? best.rgb : null;
  }

  // The RGB a CMY-capable fixture should target for a given pick: the
  // exact resolved gel colour of a discrete-wheel-only fixture in the
  // same selection if there is one (so the two visibly match), else
  // the raw hue/sat conversion.
  function cmyTargetRGB(fixtures, hue, sat) {
    const wheelFixture = findWheelOnlyFixture(fixtures);
    const wheelRGB = wheelFixture ? resolveWheelRGB(wheelFixture, hue, sat) : null;
    if (wheelRGB) return wheelRGB.map(v => Math.round(v * 255));
    return cmyHueSatToRgb(hue, sat, 50);
  }

  // A selection spanning BOTH a main-wheel fixture (real RGB, or a
  // discrete colour wheel like the VL3000's) AND a true-CMY fixture
  // (ROBE ColorWash, SolaFrame 750, CyberLight) at once — neither wheel
  // alone can drive both, so isCMYSelection below defers to whichever
  // the user has picked via the mode toggle (see buildColourModeToggle)
  // instead of choosing automatically.
  function isMixedColourSelection(fixtures) {
    return hasMainWheelFixture(fixtures) && hasTrueCMY(fixtures);
  }

  // Which of the two wheels should currently be showing for a colour-
  // mixing-capable selection: CMY-only fixtures (ROBE ColorWash,
  // SolaFrame 750, CyberLight — no main-wheel fixture alongside them)
  // always take the CMY wheel, main-wheel-only fixtures always take
  // the main hue/sat wheel, and a MIXED selection follows
  // colourMixMode (see buildColourModeToggle) — whichever wheel that
  // resolves to also drives the OTHER colour model's fixtures in the
  // same selection (see applyCMY below, window.applyRGBWheelToCMYFixtures,
  // and js/app.js's colourAt), so every selected fixture actually
  // responds to it rather than only the matching half. Shared by
  // refreshParameterVisibility (swaps the main hue/sat wheel for the
  // CMY one) and renderDynamicControls (keeps cyan/magenta/yellow out
  // of the plain Colour Mixing sliders once a wheel is driving them
  // instead).
  function isCMYSelection(fixtures) {
    if (!fixtures.length) return false;
    const mainWheel = hasMainWheelFixture(fixtures);
    const cmy = hasTrueCMY(fixtures);
    if (mainWheel && cmy) return colourMixMode === "cmy";
    return cmy;
  }

  // The primary colour-wheel picker for a CMY-mixing selection — built
  // with the exact same markup/classes as the main #colourGroup wheel
  // (see styles.css .colour-card/.colour-wheel/.wheel-indicator/
  // .colour-swatch) so it visually takes that wheel's place, but every
  // pick is converted to cyan/magenta/yellow (255 minus the equivalent
  // RGB) instead of writing r/g/b — the only way this app can actually
  // drive a fixture whose real colour channels are cyan/magenta/yellow.
  function buildPrimaryCMYWheel(fixtures) {
    const card = document.createElement("div");
    card.className = "control-group parameter-card colour-card";
    card.id = "cmyColourGroup";
    card.innerHTML = `<div class="control-heading"><div><span class="control-label">CMY Mix</span><small>CYAN / MAGENTA / YELLOW</small></div></div><div class="colour-wheel"><canvas width="220" height="220"></canvas><div class="wheel-indicator"></div></div><div class="colour-swatch"></div>`;

    const canvas = card.querySelector("canvas");
    const dot = card.querySelector(".wheel-indicator");
    const swatch = card.querySelector(".colour-swatch");
    const ctx = canvas.getContext("2d");
    const size = canvas.width, centre = size / 2;

    // A plain hue/sat wheel with this maths puts RED/GREEN/BLUE at the
    // three primary (0/120/240) positions and cyan/magenta/yellow as
    // paler blends in between — a relabelled RGB wheel, not a CMY one,
    // which is exactly what looked wrong here. Rotating by 180 degrees
    // swaps that: CYAN/MAGENTA/YELLOW land on the primary positions
    // instead (real hue 180/300/60 sit at geometric angle 0/120/240),
    // with red/green/blue as the in-between blends — same trick as
    // complementary colours being 180 degrees apart on any hue wheel.
    // The shift is applied consistently everywhere a geometric angle
    // meets a real hue (draw, pick, setDot) so what's drawn, where the
    // dot lands, and what's actually driven to the fixture always agree.
    const toRealHue = angle => (angle + 180) % 360;
    const toAngle = realHue => (realHue - 180 + 360) % 360;

    function draw() {
      const image = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - centre, dy = y - centre;
          const dist = Math.hypot(dx, dy);
          if (dist > centre) continue;
          const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          const sat = Math.min(100, (dist / centre) * 100);
          const [r, g, b] = cmyHueSatToRgb(toRealHue(angle), sat, 50);
          const i = (y * size + x) * 4;
          image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }
    draw();

    function setDot(realHue, sat) {
      const rad = toAngle(realHue) * Math.PI / 180;
      dot.style.left = `${50 + Math.cos(rad) * (sat / 100) * 50}%`;
      dot.style.top = `${50 + Math.sin(rad) * (sat / 100) * 50}%`;
      const [pr, pg, pb] = cmyHueSatToRgb(realHue, sat, 50);
      if (swatch) swatch.style.background = `rgb(${pr},${pg},${pb})`;
    }

    const representative = fixtures.find(f => {
      const map = getDefinition(f)?.map || {};
      return typeof map.cyan === "number" && typeof map.magenta === "number" && typeof map.yellow === "number";
    });
    const initState = representative ? getState(representative) : null;
    const initCyan = initState?.cyan ?? 0, initMagenta = initState?.magenta ?? 0, initYellow = initState?.yellow ?? 0;
    const [initHue, initSat] = cmyRgbToHueSat(255 - initCyan, 255 - initMagenta, 255 - initYellow);
    setDot(initHue, initSat);

    // Deliberately does NOT also set hue/sat on the CMY-capable
    // fixtures themselves. An earlier version did, so that a combo
    // fixture's discrete colour-wheel channel (js/dmx.js's map.colour)
    // would track the same hue as a hedge for third-party receivers
    // that might only read the wheel channel — but tested against
    // Capture, that backfired: its Cyberlight profile prioritises the
    // wheel channel over CMY, so driving the wheel to also vary made
    // colour changes look like discrete gel picks instead of
    // continuous CMY. js/dmx.js instead parks the wheel channel on
    // "open" for these fixtures so it never competes with the real CMY
    // channels this wheel drives below.
    //
    // It DOES set hue/sat on any main-wheel fixture (real RGB, or a
    // discrete colour wheel like the VL3000's) in a mixed selection
    // (isMixedColourSelection) though — with both colour models
    // selected at once and this wheel active (colourMixMode === "cmy"),
    // this is the only way that half of the selection responds at all,
    // via the generic engine's existing hue/sat -> r/g/b or hue/sat ->
    // wheel-slot derivation (js/dmx.js). CMY-only fixtures are
    // untouched by this, preserving the "only channels 6/7/8" rule
    // above for them.
    function applyCMY(realHue, sat) {
      // If a discrete-wheel-only fixture (VL3000, etc.) is also in the
      // selection, match its actual resolved gel colour exactly rather
      // than this wheel's own raw hue/sat conversion — see
      // cmyTargetRGB. Otherwise the two fixtures would each show an
      // independently-computed, slightly different shade even though
      // both are meant to display "the same" colour.
      const [r, g, b] = cmyTargetRGB(fixtures, realHue, sat);
      applyDynamicParameter("cyan", 255 - r);
      applyDynamicParameter("magenta", 255 - g);
      applyDynamicParameter("yellow", 255 - b);

      if (hasMainWheelFixture(fixtures)) {
        for (const fixture of fixtures) {
          if (hasTrueCMYOne(fixture)) continue;
          const map = getDefinition(fixture)?.map || {};
          const isMainWheelHere = (typeof map.r === "number" && typeof map.g === "number" && typeof map.b === "number") || typeof map.colour === "number";
          if (!isMainWheelHere) continue;
          const state = getState(fixture);
          if (!state) continue;
          state.hue = realHue;
          state.sat = sat;
          window.State.fixtureStates.set(fixture.id, state);
        }
        window.State.current ||= {};
        window.State.current.hue = realHue;
        window.State.current.sat = sat;
        window.updateDMX?.();
        window.sendToVisualizer?.();
      }
    }

    function pick(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * size;
      const y = (e.clientY - rect.top) / rect.height * size;
      const dx = x - centre, dy = y - centre;
      const dist = Math.min(centre, Math.hypot(dx, dy));
      const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const sat = Math.min(100, dist / centre * 100);
      const realHue = toRealHue(angle);
      setDot(realHue, sat);
      applyCMY(realHue, sat);
    }

    // Pointer capture keeps the drag self-contained to this canvas —
    // this card is rebuilt from scratch on every selection change
    // (unlike the main Colour wheel, set up once at load), so window-
    // level mousemove/mouseup listeners here would pile up on every
    // re-render instead of being released with the old canvas.
    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener("pointermove", e => {
      if (e.buttons & 1) pick(e);
    });
    canvas.addEventListener("pointerup", e => {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    return card;
  }

  // js/fresnel-controls.js also manages #colourGroup's visibility on
  // its own independent poll (unaware of CMY-only fixtures) — exposed
  // globally so that file can defer to this instead of fighting it.
  window.isCMYSelection = isCMYSelection;

  function refreshPrimaryCMYWheel(fixtures) {
    const colourGroupEl = document.getElementById("colourGroup");
    if (!colourGroupEl) return;
    const cmySelection = isCMYSelection(fixtures);

    let host = document.getElementById("cmyColourGroup");
    if (!cmySelection) {
      host?.remove();
      return;
    }

    host?.remove();
    colourGroupEl.insertAdjacentElement("afterend", buildPrimaryCMYWheel(fixtures));
  }

  // Shown only for a selection spanning both a true-RGB and a true-CMY
  // fixture at once (see isMixedColourSelection) — lets the user pick
  // which colour model drives the whole selection, since neither wheel
  // alone can. Sits above whichever wheel is currently showing.
  function buildColourModeToggle() {
    const wrap = document.createElement("div");
    wrap.id = "colourModeToggle";
    wrap.className = "colour-mode-toggle";
    wrap.innerHTML = `<button type="button" class="colour-mode-btn" data-mode="rgb">RGB</button><button type="button" class="colour-mode-btn" data-mode="cmy">CMY</button>`;

    const buttons = Array.from(wrap.querySelectorAll(".colour-mode-btn"));
    const sync = () => buttons.forEach(b => b.classList.toggle("active", b.dataset.mode === colourMixMode));
    buttons.forEach(button => button.addEventListener("click", () => {
      if (button.dataset.mode === colourMixMode) return;
      colourMixMode = button.dataset.mode;
      sync();
      // Re-run the same refresh a selection change would — swaps the
      // wheel, and js/fresnel-controls.js's poll will pick up the new
      // isCMYSelection() result within its own 150ms cycle too.
      window.updateParameterVisibility?.();
    }));
    sync();
    return wrap;
  }

  function refreshColourModeToggle(fixtures) {
    const colourGroupEl = document.getElementById("colourGroup");
    if (!colourGroupEl) return;
    document.getElementById("colourModeToggle")?.remove();
    if (!isMixedColourSelection(fixtures)) return;
    colourGroupEl.insertAdjacentElement("beforebegin", buildColourModeToggle());
  }

  // The mirror image of buildPrimaryCMYWheel's applyCMY: when the main
  // hue/sat wheel (js/app.js) is the active control for a mixed
  // RGB+CMY selection, it already drives any true-RGB fixtures via the
  // generic engine's own hue/sat handling — but does nothing for the
  // CMY-capable fixtures in that same selection, since js/dmx.js never
  // derives cyan/magenta/yellow from hue itself. Called from
  // js/app.js's colourAt() after every pick so those fixtures respond
  // too; a no-op whenever the selection has no CMY-capable fixture, so
  // it's safe to call unconditionally on every wheel interaction.
  window.applyRGBWheelToCMYFixtures = function applyRGBWheelToCMYFixtures(hue, sat) {
    const fixtures = getSelectedFixtures();
    if (!hasTrueCMY(fixtures)) return;
    // Matches a discrete-wheel-only fixture's actual resolved gel
    // colour exactly when one is also selected — see cmyTargetRGB —
    // so e.g. a VL3000 and a CyberLight picked together show the same
    // colour instead of each independently computing its own shade.
    const [r, g, b] = cmyTargetRGB(fixtures, hue, sat);
    applyDynamicParameter("cyan", 255 - r);
    applyDynamicParameter("magenta", 255 - g);
    applyDynamicParameter("yellow", 255 - b);
  };

  // Deck now splits its dynamic groups across three tabs (Beam /
  // Colour / Custom) instead of one long stacked list — each group
  // above declares which tab it belongs in.
  const DECK_TABS = ["beam", "colour", "custom"];
  const DECK_TAB_CONTAINER_ID = { beam: "dynamicControlsBeam", colour: "dynamicControlsColour", custom: "dynamicControlsCustom" };
  const EMPTY_SELECTION_HTML = '<div class="selection-empty"><div class="empty-icon">◇</div><strong>Select a fixture</strong><p>Choose a patched fixture to expose its parameters.</p></div>';

  function renderDynamicControls() {
    const containers = {};
    for (const tab of DECK_TABS) containers[tab] = document.getElementById(DECK_TAB_CONTAINER_ID[tab]);
    if (!containers.beam || !containers.colour || !containers.custom) return;

    const fixtures = getSelectedFixtures();
    if (!fixtures.length) {
      for (const tab of DECK_TABS) containers[tab].innerHTML = EMPTY_SELECTION_HTML;
      return;
    }

    const hasKey = key => fixtures.some(fixture => typeof getDefinition(fixture)?.map?.[key] === "number");

    // Fixtures with real dichroic CMY colour mixing and no RGB diodes
    // (ROBE ColorWash, SolaFrame 750, CyberLight) get the primary CMY
    // wheel in place of the main Colour wheel (see refreshParameterVisibility
    // / buildPrimaryCMYWheel) — their cyan/magenta/yellow sliders are
    // dropped here rather than duplicated as raw 0-255 faders. Fixtures
    // that carry cyan/magenta/yellow as extra ADDITIVE LEDs alongside
    // real r/g/b (e.g. the Performer 2000 RGBAL) keep their plain
    // sliders: subtractive wheel maths would be wrong for those.
    const showCMYWheel = isCMYSelection(fixtures);

    const fragments = {};
    for (const tab of DECK_TABS) fragments[tab] = document.createDocumentFragment();
    const activeKeys = [];

    for (const group of DYNAMIC_CONTROL_GROUPS) {
      const resolvedRows = [];
      const isColourMixingGroup = group.title === "Colour Mixing";

      for (const row of group.rows) {
        if (row.type === "single") {
          if (isColourMixingGroup && showCMYWheel && ["cyan", "magenta", "yellow"].includes(row.key)) continue;
          if (hasKey(row.key)) resolvedRows.push(row);
          continue;
        }
        const option = row.options.find(opt => hasKey(opt.a.key) || hasKey(opt.b.key));
        if (option) {
          resolvedRows.push({
            type: "pair",
            label: row.label,
            a: option.a,
            b: option.b,
            aPresent: hasKey(option.a.key),
            bPresent: hasKey(option.b.key)
          });
        }
      }

      if (!resolvedRows.length) continue;

      const card = document.createElement("div");
      card.className = "control-group parameter-card dynamic-parameter-card";
      card.dataset.dynamicGroup = group.title;

      const heading = document.createElement("div");
      heading.className = "dynamic-group-heading";
      heading.textContent = group.title;
      card.appendChild(heading);

      for (const row of resolvedRows) {
        const rowEl = document.createElement("div");
        rowEl.className = "dynamic-row";

        if (row.type === "single") {
          rowEl.appendChild(buildDynamicField(row.key, row.label));
          activeKeys.push(row.key);
        } else {
          const rowLabel = document.createElement("span");
          rowLabel.className = "dynamic-row-label";
          rowLabel.textContent = row.label;
          rowEl.appendChild(rowLabel);

          const fields = document.createElement("div");
          fields.className = "dynamic-row-fields";
          if (row.aPresent) { fields.appendChild(buildDynamicField(row.a.key, row.a.label)); activeKeys.push(row.a.key); }
          if (row.bPresent) { fields.appendChild(buildDynamicField(row.b.key, row.b.label)); activeKeys.push(row.b.key); }
          rowEl.appendChild(fields);
        }

        card.appendChild(rowEl);
      }

      fragments[group.tab].appendChild(card);
    }

    for (const tab of DECK_TABS) {
      containers[tab].replaceChildren();
      if (fragments[tab].childNodes.length) containers[tab].appendChild(fragments[tab]);
    }

    // A hazer or fog machine has no beam to shape.
    const lights = fixtures.filter(f => { const m = getDefinition(f)?.map || {}; return !(typeof m.haze === "number" || typeof m.fog === "number"); });
    if (lights.length) {
      renderBeamAngle(containers.beam, lights);
      renderManualBarnDoors(containers.beam, lights);
    }
    renderWheelSlots(containers.colour, fixtures);

    for (const key of activeKeys) {
      const fixture = fixtures.find(f => typeof getDefinition(f)?.map?.[key] === "number");
      const state = fixture ? getState(fixture) : null;
      setDynamicValue(key, state?.[key] ?? window.State.current?.[key] ?? 0);
    }
  }

  // A fixed colour wheel's real colours as buttons (VL3000: Open, Congo
  // Blue, Orange…): press one and the wheel goes to exactly that slot. For
  // a wheel-only light the colour picker follows (so the visualiser and
  // other lights match); picking another colour there hands the wheel back
  // to the picker. For a CMY light (Cyberlight) the wheel is otherwise left
  // open, so this is the only way to use it, and it stays until Open.
  const slotValue = slot => Number.isFinite(Number(slot?.dmx)) ? Number(slot.dmx) : Math.round((Number(slot.min) + Number(slot.max)) / 2);
  const isWhiteSlot = slot => Array.isArray(slot?.rgb) && Math.min(...slot.rgb) >= 0.95;
  function renderWheelSlots(container, fixtures) {
    const byDef = new Map();
    for (const f of fixtures) {
      const def = getDefinition(f);
      if (typeof def?.map?.colour !== "number" || !Array.isArray(def.colourWheel) || !def.colourWheel.length) continue;
      const key = f.name || "";
      if (!byDef.has(key)) byDef.set(key, { def, fixtures: [] });
      byDef.get(key).fixtures.push(f);
    }
    if (!byDef.size) return;
    for (const [name, { def, fixtures: group }] of byDef) {
      const card = document.createElement("div");
      card.className = "control-group parameter-card wheel-slot-card";
      const label = String(def.photometrics?.model || name).replace(/\s*\([^)]*\)\s*$/, "");
      card.innerHTML = `<div class="dynamic-group-heading">Colour wheel${byDef.size > 1 ? ` · ${label}` : ""}</div><div class="wheel-slots"></div>`;
      const box = card.querySelector(".wheel-slots");
      const current = getState(group[0]) || {};
      const cmy = hasTrueCMYOne(group[0]);
      const seen = new Set();
      def.colourWheel.forEach((slot, i) => {
        const value = slotValue(slot);
        // A colour listed again further round (the second Open, or a wheel
        // that repeats its colours) gets one button: the first.
        const seenKey = isWhiteSlot(slot) ? "white" : String(slot.name || `#${(slot.rgb || []).join(",")}`).toLowerCase();
        if (seen.has(seenKey)) return;
        seen.add(seenKey);
        const rgb = (Array.isArray(slot.rgb) ? slot.rgb : [1, 1, 1]).map(v => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wheel-slot";
        const on = Number(current.colourSlot) === value && (cmy || current.colourSlotFor === `${current.hue}|${current.sat}`);
        button.classList.toggle("on", on || (isWhiteSlot(slot) && current.colourSlot == null && cmy));
        button.style.setProperty("--slot", `rgb(${rgb.join(",")})`);
        button.title = `${slot.name || (isWhiteSlot(slot) ? "Open" : `Slot ${i}`)} · DMX ${value}`;
        button.innerHTML = `<span class="wheel-slot-chip"></span><span>${slot.name || (isWhiteSlot(slot) ? "Open" : `Slot ${i}`)}</span>`;
        button.addEventListener("click", () => {
          for (const f of group) {
            const state = getState(f);
            if (!state) continue;
            if (hasTrueCMYOne(f)) {
              if (isWhiteSlot(slot)) delete state.colourSlot; else state.colourSlot = value;
              delete state.colourSlotFor;
            } else {
              state.hue = Number(slot.hue ?? 0);
              state.sat = isWhiteSlot(slot) ? 0 : 100;
              state.colourSlot = value;
              state.colourSlotFor = `${state.hue}|${state.sat}`;
            }
          }
          window.updateDMX?.();
          window.sendToVisualizer?.();
          window.log?.(`${group.length > 1 ? `${group.length} × ` : ""}${label}: wheel to ${button.title}`, "ok");
          renderDynamicControls();
        });
        box.appendChild(button);
      });
      container.prepend(card);
    }
    if (!document.getElementById("wheelSlotStyles")) {
      const st = document.createElement("style");
      st.id = "wheelSlotStyles";
      st.textContent = `.wheel-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px;margin-top:8px}.wheel-slot{display:flex;align-items:center;gap:7px;min-height:34px;padding:5px 8px;border:1px solid #26343a;border-radius:7px;background:#10171b;color:#c6d0ce;font-size:13px;font-weight:700;cursor:pointer;text-align:left}.wheel-slot-chip{flex:0 0 auto;width:16px;height:16px;border-radius:50%;background:var(--slot);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}.wheel-slot.on{border-color:var(--accent,#19d6a3);color:#edf4f2;background:#152026}`;
      document.head.appendChild(st);
    }
  }

  function installDeckTabs() {
    const tabs = document.querySelectorAll(".deck-tab");
    const panels = document.querySelectorAll(".deck-tab-panel");
    if (!tabs.length || !panels.length) return;

    const activate = name => {
      tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
      panels.forEach(p => { p.hidden = p.dataset.tabPanel !== name; });
      try { localStorage.setItem("lx-deck-tab", name); } catch (_) {}
    };

    tabs.forEach(t => {
      if (t.dataset.deckTabBound === "1") return;
      t.dataset.deckTabBound = "1";
      t.addEventListener("click", () => activate(t.dataset.tab));
    });

    let initial = "beam";
    try { initial = localStorage.getItem("lx-deck-tab") || "beam"; } catch (_) {}
    if (!DECK_TABS.includes(initial)) initial = "beam";
    activate(initial);
  }

  function refreshParameterVisibility() {
    const fixtures = getSelectedFixtures();
    const hasSelection = fixtures.length > 0;

    // Master is global and is never tied to fixture capabilities.
    setInputGroupVisibility("master", true);

    if (!hasSelection) {
      setInputGroupVisibility("intensity", false);
      setGroupVisibility("strobeGroup", false);
      setGroupVisibility("zoomGroup", false);
      setGroupVisibility("colourGroup", false);
      setGroupVisibility("xyGroup", false);
      refreshColourModeToggle(fixtures);
      refreshPrimaryCMYWheel(fixtures);
      renderDynamicControls();
      return;
    }

    // A CMY-mixing selection (ROBE ColorWash, SolaFrame 750, CyberLight)
    // gets the CMY wheel in place of the main hue/sat wheel — that wheel
    // only ever writes hue/sat, which does nothing for a fixture whose
    // real colour channels are cyan/magenta/yellow. A selection mixing
    // both colour models follows colourMixMode instead of choosing
    // automatically — see isCMYSelection/refreshColourModeToggle.
    const cmySelection = isCMYSelection(fixtures);
    setInputGroupVisibility("intensity", selectedCapability("intensity"));
    setGroupVisibility("strobeGroup", selectedCapability("strobe"));
    setGroupVisibility("zoomGroup", selectedCapability("zoom"));
    setGroupVisibility("colourGroup", selectedCapability("colour") && !cmySelection);
    setGroupVisibility("xyGroup", selectedCapability("xy"));
    refreshColourModeToggle(fixtures);
    refreshPrimaryCMYWheel(fixtures);
    renderDynamicControls();
  }

  window.updateParameterVisibility = refreshParameterVisibility;

  let refreshQueued = false;
  function refreshVisibilityNow() {
    refreshQueued = false;
    const pad = document.querySelector(".xy-pad");
    const fixtures = getSelectedFixtures();
    const moving = fixtures.some(f => {
      const map = getDefinition(f)?.map || {};
      return typeof map.pan === "number" || typeof map.tilt === "number";
    });
    if (pad) pad.style.display = moving ? "" : "none";
    refreshParameterVisibility();
  }
  function refreshVisibility() {
    if (refreshQueued) return;
    refreshQueued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(refreshVisibilityNow);
    else setTimeout(refreshVisibilityNow, 0);
  }
  window.updateControlVisibility = refreshVisibility;

  if (!window.__multiFixtureXYFix) {
    window.__multiFixtureXYFix = true;
    const attach = () => {
      const pad = document.querySelector(".xy-pad");
      if (!pad || pad.dataset.multiFixtureXYFix === "1") return !!pad;
      pad.dataset.multiFixtureXYFix = "1";
      pad.style.touchAction = "none";
      pad.style.userSelect = "none";
      let dragging = false;
      let pointerId = null;
      const positionFromEvent = e => {
        const rect = pad.getBoundingClientRect();
        const touch = e.touches?.[0] || e.changedTouches?.[0];
        const x = Number(e.clientX ?? touch?.clientX);
        const y = Number(e.clientY ?? touch?.clientY);
        if (!rect.width || !rect.height || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          pan: Math.round(Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * 255),
          tilt: Math.round((1 - Math.max(0, Math.min(1, (y - rect.top) / rect.height))) * 255)
        };
      };
      const apply = e => {
        const values = positionFromEvent(e);
        if (!values) return;
        const fixtures = getSelectedFixtures();
        if (!fixtures.length) { window.log?.("Select a fixture first", "warn"); return; }
        let changed = false;
        for (const fixture of fixtures) {
          const map = getDefinition(fixture)?.map || {};
          if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
          const state = getState(fixture);
          if (!state) continue;
          if (typeof map.pan === "number") state.pan = values.pan;
          if (typeof map.tilt === "number") state.tilt = values.tilt;
          window.State.fixtureStates.set(fixture.id, state);
          changed = true;
        }
        if (!changed) return;
        window.State.current ||= {};
        window.State.current.pan = values.pan;
        window.State.current.tilt = values.tilt;
        const dot = document.getElementById("xy");
        if (dot) { dot.style.left = `${(values.pan / 255) * 100}%`; dot.style.top = `${(1 - values.tilt / 255) * 100}%`; }
        window.updateDMX?.();
        window.sendToVisualizer?.();
      };
      pad.addEventListener("pointerdown", e => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault(); e.stopImmediatePropagation(); dragging = true; pointerId = e.pointerId;
        try { pad.setPointerCapture(e.pointerId); } catch {}
        apply(e);
      }, true);
      pad.addEventListener("pointermove", e => {
        if (!dragging || e.pointerId !== pointerId) return;
        e.preventDefault(); e.stopImmediatePropagation(); apply(e);
      }, true);
      const stop = e => {
        if (pointerId !== null && e.pointerId !== pointerId) return;
        e.stopImmediatePropagation?.();
        try { if (pointerId !== null) pad.releasePointerCapture(pointerId); } catch {}
        dragging = false; pointerId = null;
      };
      pad.addEventListener("pointerup", stop, true);
      pad.addEventListener("pointercancel", stop, true);
      pad.addEventListener("lostpointercapture", () => { dragging = false; pointerId = null; }, true);
      pad.addEventListener("mousedown", e => { e.preventDefault(); e.stopImmediatePropagation(); dragging = true; apply(e); }, true);
      window.addEventListener("mousemove", e => { if (dragging) apply(e); }, true);
      window.addEventListener("mouseup", () => { dragging = false; }, true);
      return true;
    };
    let attempts = 0;
    const waitForPad = () => { if (attach()) return; if (++attempts < 150) setTimeout(waitForPad, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForPad, { once: true });
    else waitForPad();
  }

  if (!window.__homePanTiltControl) {
    window.__homePanTiltControl = true;
    const homeSelectedPanTilt = () => {
      const fixtures = getSelectedFixtures();
      if (!fixtures.length) { window.log?.("Select a fixture first", "warn"); return; }
      let homed = 0;
      for (const fixture of fixtures) {
        const map = getDefinition(fixture)?.map || {};
        if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
        const state = getState(fixture);
        if (!state) continue;
        if (typeof map.pan === "number") state.pan = 128;
        if (typeof map.tilt === "number") state.tilt = 128;
        window.State.fixtureStates.set(fixture.id, state); homed++;
      }
      if (!homed) { window.log?.("Selected fixtures have no Pan/Tilt controls", "warn"); return; }
      window.State.current ||= {};
      window.State.current.pan = 128; window.State.current.tilt = 128;
      window.updateDMX?.(); window.sendToVisualizer?.();
      const dot = document.getElementById("xy");
      if (dot) { dot.style.left = "50%"; dot.style.top = "50%"; }
      window.log?.(`Homed Pan/Tilt for ${homed} selected fixture${homed === 1 ? "" : "s"}`, "ok");
    };
    const installHomeButton = () => {
      const existing = document.getElementById("btnHome");
      if (existing) { existing.onclick = e => { e.preventDefault(); homeSelectedPanTilt(); }; return true; }
      const xy = document.querySelector(".xy-pad");
      if (!xy) return false;
      const wrapper = document.createElement("div"); wrapper.className = "xy-home-control";
      const button = document.createElement("button"); button.id = "btnHome"; button.type = "button"; button.className = "btn-secondary";
      button.textContent = "⌂ HOME"; button.title = "Centre Pan/Tilt for selected fixtures"; button.setAttribute("aria-label", "Home selected fixtures Pan/Tilt");
      button.addEventListener("click", homeSelectedPanTilt); wrapper.appendChild(button); xy.insertAdjacentElement("afterend", wrapper); return true;
    };
    let attempts = 0;
    const waitForHomeButton = () => { if (installHomeButton()) return; if (++attempts < 150) setTimeout(waitForHomeButton, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForHomeButton, { once: true });
    else waitForHomeButton();
  }

  if (!window.__strobeControl) {
    window.__strobeControl = true;
    const $ = id => document.getElementById(id);
    const applyStrobe = value => {
      const strobe = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
      const fixtures = getSelectedFixtures(); if (!fixtures.length) return;
      for (const fixture of fixtures) {
        const state = getState(fixture); if (!state) continue;
        state.strobe = strobe; window.State.fixtureStates.set(fixture.id, state);
      }
      window.State.current ||= {}; window.State.current.strobe = strobe;
      $("strobeVal")?.replaceChildren(String(strobe)); window.updateDMX?.(); window.sendToVisualizer?.();
    };
    const installStrobe = () => {
      const slider = $("strobe"); if (!slider) return false;
      slider.min = "0"; slider.max = "255"; slider.step = "1";
      if (!slider.dataset.controlsStrobeBound) {
        slider.dataset.controlsStrobeBound = "1";
        slider.addEventListener("input", () => applyStrobe(slider.value));
        slider.addEventListener("change", () => applyStrobe(slider.value));
      }
      return true;
    };
    let attempts = 0;
    const waitForStrobe = () => { if (installStrobe()) return; if (++attempts < 150) setTimeout(waitForStrobe, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForStrobe, { once: true });
    else waitForStrobe();
  }

  const initialiseControlUI = () => { installDeckTabs(); refreshVisibility(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseControlUI, { once: true });
  else initialiseControlUI();

  if (!window.__targetFixtureCommandInstaller) {
    window.__targetFixtureCommandInstaller = true;
    const parseFixtureSelection = value => {
      const input = String(value || "").trim().toLowerCase().replace(/–/g, "-");
      const numbers = new Set();
      for (const token of input.split(/\s*,\s*/).filter(Boolean)) {
        const range = token.match(/^(\d+)\s*(?:thru|through|-)\s*(\d+)$/);
        if (range) {
          const a = Number(range[1]), b = Number(range[2]), step = a <= b ? 1 : -1;
          for (let n = a; ; n += step) { numbers.add(n); if (n === b) break; }
          continue;
        }
        const n = Number(token); if (Number.isInteger(n) && n > 0) numbers.add(n);
      }
      return [...numbers].sort((a, b) => a - b);
    };
    const getFixtureForTargetCommand = number => {
      const fixtures = window.State?.fixtures || []; const n = Number(number);
      if (!Number.isInteger(n) || n < 1) return null;
      return fixtures.find(f => Number(f?.fixtureNumber) === n) || fixtures[n - 1] || null;
    };
    const installTargetFixtureSyntax = () => {
      const current = window.parseCommand;
      if (typeof current !== "function" || current.__lxTargetFixtureSyntax) return;
      const wrapped = function(raw) {
        const command = String(raw ?? "").trim();
        const match = command.match(/^target\s+(create|aim|capture|release|delete)\s+(.+?)\s+((?:\d+\s*(?:thru|through|[-–])\s*\d+|\d+(?:\s*,\s*\d+)+|\d+))$/i);
        if (!match) return current.apply(this, arguments);
        const action = match[1].toLowerCase(), name = match[2].trim(), numbers = parseFixtureSelection(match[3]);
        if (!numbers.length) return current.apply(this, arguments);
        const selected = new Set();
        for (const number of numbers) { const fixture = getFixtureForTargetCommand(number); if (fixture) selected.add(fixture.id); }
        if (!selected.size) { window.log?.("No matching fixtures found", "warn"); return; }
        const previousSelection = window.State.selected instanceof Set ? new Set(window.State.selected) : new Set();
        window.State.selected = selected;
        const targetCommand = `target ${action} ${name}`;
        const result = current.call(this, targetCommand);
        void previousSelection;
        return result;
      };
      wrapped.__lxTargetFixtureSyntax = true;
      window.parseCommand = wrapped;
    };
    let targetSyntaxAttempts = 0;
    const waitForTargetSyntax = () => {
      installTargetFixtureSyntax();
      if (window.parseCommand?.__lxTargetFixtureSyntax) return;
      if (++targetSyntaxAttempts < 200) setTimeout(waitForTargetSyntax, 100);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForTargetSyntax, { once: true });
    else waitForTargetSyntax();
  }

  // Load the dedicated tunable-white Fresnel UI after the shared control helpers.
  if (!window.__fresnelControlsLoader) {
    window.__fresnelControlsLoader = true;
    const script = document.createElement("script");
    script.src = "js/fresnel-controls.js";
    script.onload = () => console.log("Performer 1500 Fresnel controls loaded");
    script.onerror = err => console.error("Performer 1500 Fresnel controls failed to load:", err);
    document.head?.appendChild(script);
  }
})();
