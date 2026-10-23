"use strict";

/*
 * Fixture Info: "why does this light look like that?"
 *
 * Pick a fixture and an attribute — Intensity, Colour, Red, Pan, Gobo…
 * any channel it has — and see its value now, the DMX channel, and a card
 * for each thing affecting it: PLAYBACK (the running cue), EXECUTOR (a
 * running chase or effect), PROGRAMMER (the command line, Control Deck,
 * a palette) and OUTPUT (blackout, Blind). The one in control is marked.
 *
 * Open it with "info 5", "info" (the selected fixture), right-click a
 * fixture in the list or on the magic sheet, or the Windows menu.
 *
 * How sources are known: whoever acts last owns what they change. Cues,
 * chases, effects, commands, the Control Deck and palettes announce
 * themselves; a watcher compares fixture values 10 times a second and
 * gives each change to whoever was acting at the time.
 */
(function () {
  if (window.LXFixtureInfo) return;

  const S = () => window.State;
  const ATTRS = [
    { id: "intensity", label: "Intensity", keys: ["intensity"], channels: ["dimmer", "intensity"] },
    { id: "colour", label: "Colour", keys: ["hue", "sat", "light", "cyan", "magenta", "yellow", "w", "amber", "uv", "colour", "colourr"], channels: ["r", "g", "b", "w", "amber", "lime", "uv", "cyan", "magenta", "yellow", "colour", "warmWhite", "coolWhite", "cto"] },
    { id: "pan", label: "Pan", keys: ["pan", "panf"], channels: ["pan", "panf"] },
    { id: "tilt", label: "Tilt", keys: ["tilt", "tiltf"], channels: ["tilt", "tiltf"] },
    { id: "zoom", label: "Zoom", keys: ["zoom"], channels: ["zoom"] },
    { id: "focus", label: "Focus", keys: ["focus"], channels: ["focus"] },
    { id: "iris", label: "Iris", keys: ["iris"], channels: ["iris"] },
    { id: "frost", label: "Frost", keys: ["frost"], channels: ["frost"] },
    { id: "strobe", label: "Strobe", keys: ["strobe"], channels: ["strobe", "shutter"] },
    { id: "gobo", label: "Gobo", keys: ["gobo", "gobor"], channels: ["gobo", "gobor"] },
    { id: "gobo2", label: "Gobo 2", keys: ["gobo2", "gobo2r"], channels: ["gobo2", "gobo2r"] },
    { id: "prism", label: "Prism", keys: ["prism", "prismr"], channels: ["prism", "prismr"] }
  ];
  const SKIP_KEYS = new Set(["master"]);
  const ATTR_OF = {};
  ATTRS.forEach(a => a.keys.forEach(k => { ATTR_OF[k] = a.id; }));
  const KINDS = {
    cue: ["PLAYBACK", "#19d6a3"], chase: ["CHASE", "#5ca8ff"], effect: ["EFFECT", "#e24fd0"],
    command: ["COMMAND LINE", "#ffb454"], deck: ["CONTROL DECK", "#ffb454"], palette: ["PALETTE", "#ffb454"],
    magic: ["MAGIC SHEET", "#ffb454"], focus: ["POINT & SHOOT", "#ffad1f"], mib: ["MOVE IN BLACK", "#9b7bff"], insert: ["FROM A CUE", "#ffb454"], clear: ["CLEARED", "#5d6b68"], manual: ["MANUAL", "#8c9a97"], start: ["START-UP", "#5d6b68"]
  };

  // ------------------------------------------------------------ tracking

  const owners = new Map();   // fixtureId -> { attrId: source }
  const history = new Map();  // fixtureId -> { attrId: [entries] }
  let actor = null;           // { kind, label, detail, until }
  let last = new Map();       // fixtureId -> copy of its state

  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const fixtureById = id => S()?.fixtures.find(f => f?.id === id);

  function own(id, attrId, source, value) {
    if (!owners.has(id)) owners.set(id, {});
    owners.get(id)[attrId] = { ...source, at: Date.now() };
    if (!history.has(id)) history.set(id, {});
    const list = history.get(id)[attrId] || (history.get(id)[attrId] = []);
    const top = list[0];
    // One line per action, not one per fade frame.
    if (top && top.label === source.label && Date.now() - top.at < 4000) { top.value = value; top.at = Date.now(); return; }
    list.unshift({ kind: source.kind, label: source.label, value, at: Date.now() });
    if (list.length > 8) list.pop();
  }

  // Someone is about to change things: what they change in the next `ms` is theirs.
  // ids: only these fixtures' changes count (null = whatever changes).
  function act(kind, label, detail = "", ms = 1200, ids = null) {
    actor = { kind, label, detail, until: performance.now() + ms, ids: ids ? new Set(ids) : null };
  }
  const selectedIds = () => [...(S()?.selected || [])];

  // Claim attributes outright (a cue owns what it holds even if the value didn't move).
  function claim(id, attrIds, source) {
    const st = window.ensureFixtureState?.(id) || {};
    attrIds.forEach(a => own(id, a, source, summary(a, st)));
  }

  function chaseHas(id) {
    const s = S();
    const chase = s.currentChase >= 0 ? s.chases?.[s.currentChase] : null;
    if (!chase) return null;
    const ids = Array.isArray(chase.fixtureIds) && chase.fixtureIds.length ? chase.fixtureIds : null;
    return !ids || ids.includes(id) ? chase : null;
  }
  // The running effect this fixture is in (several can run at once).
  function effectHas(id) {
    const list = Array.isArray(S().effects) && S().effects.length ? S().effects : S().activeEffect ? [S().activeEffect] : [];
    for (const e of [...list].reverse()) {
      const ids = e.ids instanceof Set ? [...e.ids] : Array.isArray(e.fixtureIds) ? e.fixtureIds : null;
      if (!ids || !ids.length || ids.map(String).includes(String(id))) return { ...e, fixtureIds: ids };
    }
    return null;
  }

  function watch() {
    const s = S();
    if (!s?.fixtureStates) return;
    const now = performance.now();
    const live = actor && now < actor.until ? actor : null;
    s.fixtureStates.forEach((st, id) => {
      const before = last.get(id);
      if (before) {
        const changed = new Set();
        for (const k in st) if (!SKIP_KEYS.has(k) && typeof st[k] === "number" && Math.abs(st[k] - (before[k] ?? st[k])) > 0.01) changed.add(ATTR_OF[k] || k);
        if (changed.size) {
          let source = live && (!live.ids || live.ids.has(id)) ? live : null;
          if (!source) {
            const chase = chaseHas(id), effect = effectHas(id);
            if (effect) source = { kind: "effect", label: `Effect “${effect.name || effect.type}”`, detail: `${effect.type} · speed ${effect.speed}` };
            else if (chase) source = { kind: "chase", label: `Chase ${s.currentChase + 1} “${chase.name || "Chase"}”`, detail: `running · ${Math.round(window.LXChaseSpeed?.bpmOf(chase) ?? 0)} BPM` };
            else source = { kind: "manual", label: "Manual change", detail: "MIDI, the phone remote or another control" };
          }
          changed.forEach(a => own(id, a, source, summary(a, st)));
        }
      }
      last.set(id, { ...st });
    });
  }

  // ----------------------------------------------------------- hooks

  function hook() {
    // Cues: the cue owns everything it holds for its fixtures.
    if (typeof window.goToCue === "function" && !window.goToCue.__lxInfo) {
      const original = window.goToCue;
      const wrapped = function (index, forceFade = null) {
        const cue = S().cues?.[index];
        const fade = forceFade != null ? Number(forceFade) : Number(cue?.fade ?? 800);
        const source = { kind: "cue", label: `Cue ${Number(index) + 1} “${cue?.name || `Cue ${Number(index) + 1}`}”`, detail: `fade ${(fade / 1000).toFixed(1)} s` };
        if (cue) act("cue", source.label, source.detail, fade + 500);
        const result = original.apply(this, arguments);
        if (result && cue && typeof window.getCueTarget === "function") {
          try {
            const { fixtureMap } = window.getCueTarget(cue);
            fixtureMap.forEach((state, id) => claim(id, [...new Set(Object.keys(state).filter(k => !SKIP_KEYS.has(k)).map(k => ATTR_OF[k] || k))], source));
          } catch (_) {}
        }
        return result;
      };
      wrapped.__lxInfo = true;
      window.goToCue = wrapped;
    }
    // Chases and effects change values a moment before they show as running.
    const announce = (name, make) => {
      const fn = window[name];
      if (typeof fn !== "function" || fn.__lxInfo) return;
      const wrapped = function () { const src = make(...arguments); if (src) act(src.kind, src.label, src.detail || "", 1500); return fn.apply(this, arguments); };
      wrapped.__lxInfo = true;
      window[name] = wrapped;
    };
    announce("startChase", i => { const c = S().chases?.[i]; return c && { kind: "chase", label: `Chase ${Number(i) + 1} “${c.name || "Chase"}”`, detail: "starting" }; });
    announce("stopChase", () => S().currentChase >= 0 && { kind: "chase", label: `Chase ${S().currentChase + 1} stopped`, detail: "left at its last step" });
    announce("applySavedEffect", name => ({ kind: "effect", label: `Effect “${name}”`, detail: "starting" }));
    announce("stopEffect", () => S().activeEffect && { kind: "effect", label: `Effect “${S().activeEffect.name || S().activeEffect.type}” stopped`, detail: "" });
    if (window.Palettes?.apply && !window.Palettes.apply.__lxInfo) {
      const original = window.Palettes.apply;
      const wrapped = function (name) { act("palette", `Palette “${name}”`, "", Number(window.LXPrefs?.get("paletteFadeMs") ?? 300) + 500, selectedIds()); return original.apply(this, arguments); };
      wrapped.__lxInfo = true;
      try { window.Palettes.apply = wrapped; } catch (_) {}
    }
  }

  document.addEventListener("pointerdown", e => {
    if (e.target.closest?.("#controlPanel")) act("deck", "Control Deck", "a slider or button you moved", 2000, selectedIds());
    else if (e.target.closest?.(".magic-tools")) act("magic", "Magic Sheet", "Full / 50% / Out buttons", 1500, selectedIds());
  }, true);
  document.addEventListener("input", e => { if (e.target.closest?.("#controlPanel")) act("deck", "Control Deck", "a slider or button you moved", 1500, selectedIds()); }, true);

  // ------------------------------------------------------------ values

  const clamp255 = v => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  function summary(attrId, st) {
    if (attrId === "intensity") return `${Math.round(Number(st.intensity) || 0)} %`;
    if (attrId === "colour") return Number(st.sat) > 0 ? `hue ${Math.round(st.hue)}° sat ${Math.round(st.sat)}%` : "white";
    const a = ATTRS.find(x => x.id === attrId);
    return `${Math.round(clamp255(st[a ? a.keys[0] : attrId]) / 2.55)} %`;
  }

  function channelsOf(f, attr) {
    const map = defOf(f).map || {};
    const seen = new Set(), out = [];
    const base = (Number(f.uni) - 1) * 512 + (Number(f.addr) - 1);
    for (const key of attr.channels) {
      const off = map[key];
      if (typeof off !== "number" || seen.has(off)) continue;
      seen.add(off);
      out.push({ key, ch: Number(f.addr) + off, value: S().dmx?.[base + off] ?? 0 });
    }
    return out;
  }

  // ------------------------------------------------------------- views
  //
  // Every row the window can show for a fixture: the attribute groups
  // above (who owns them), each DMX channel the fixture has, and things
  // worked out from elsewhere (target, hang position, beam angle…).

  const LABELS = {
    dimmer: "Dimmer", intensity: "Intensity", dimmerFine: "Dimmer fine",
    r: "Red", g: "Green", b: "Blue", w: "White", amber: "Amber", lime: "Lime", uv: "UV",
    cyan: "Cyan", magenta: "Magenta", yellow: "Yellow", warmWhite: "Warm white", coolWhite: "Cool white", naturalWhite: "Natural white",
    cto: "CTO", cct: "Colour temp", colour: "Colour wheel", colourr: "Colour wheel spin", colmacro: "Colour macro", colorPreset: "Colour preset",
    presetColors: "Preset colours", colorMacros: "Colour macros", a: "Amber", l: "Lime", c: "Cyan",
    rFine: "Red fine", gFine: "Green fine", bFine: "Blue fine", aFine: "Amber fine", lFine: "Lime fine", amberFine: "Amber fine", limeFine: "Lime fine",
    cyanFine: "Cyan fine", magentaFine: "Magenta fine", warmWhiteFine: "Warm white fine", naturalWhiteFine: "Natural white fine",
    pan: "Pan", tilt: "Tilt", panf: "Pan fine", tiltf: "Tilt fine",
    zoom: "Zoom", focus: "Focus", iris: "Iris", frost: "Frost", fresnel: "Fresnel",
    strobe: "Strobe", shutter: "Shutter",
    gobo: "Gobo", gobor: "Gobo spin", gobo2: "Gobo 2", gobo2r: "Gobo 2 spin", prism: "Prism", prismr: "Prism spin", rot: "Rotation", shake: "Shake",
    effect: "Effect", effectSpeed: "Effect speed", speed: "Speed", autoSpeed: "Auto speed", dimmerSpeed: "Dimmer speed", macro: "Macro", macroSpeed: "Macro speed",
    mode: "Mode", control: "Control", auto: "Auto", preset: "Preset", performance: "Performance", zone: "Zone",
    fog: "Fog", haze: "Haze", fana: "Fan", fluid: "Fluid"
  };
  const SECTION_OF = key =>
    /^(dimmer|intensity|dimmerFine)$/.test(key) ? "INTENSITY"
    : /^(r|g|b|w|a|l|c|amber|lime|uv|cyan|magenta|yellow|warmWhite|coolWhite|naturalWhite|cto|cct|colour|colourr|colmacro|colorPreset|presetColors|colorMacros)(Fine)?$/.test(key) ? "COLOUR"
    : /^(pan|tilt|panf|tiltf)$/.test(key) ? "POSITION"
    : /^(zoom|focus|iris|frost|fresnel)$/.test(key) || /^shutter\d/.test(key) ? "BEAM"
    : /^(strobe|shutter)$/.test(key) ? "SHUTTER"
    : /^(gobo|gobor|gobo2|gobo2r|prism|prismr|rot|shake|effect|effectSpeed|speed|macro|macroSpeed|autoSpeed|dimmerSpeed)$/.test(key) ? "GOBO & EFFECTS"
    : "OTHER";
  // Which owner group a channel belongs to (colour channels follow the colour).
  const GROUP_OF = key => (SECTION_OF(key) === "COLOUR" ? "colour" : { dimmer: "intensity", intensity: "intensity", dimmerFine: "intensity", panf: "pan", tiltf: "tilt", gobor: "gobo", gobo2r: "gobo2", prismr: "prism", shutter: "strobe" }[key] || ATTR_OF[key] || key);
  const SECTIONS = ["INTENSITY", "COLOUR", "POSITION", "BEAM", "SHUTTER", "GOBO & EFFECTS", "OTHER"];
  const nice = key => LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
  const deg = v => `${Math.round(Number(v) || 0)}°`;

  function viewsFor(f) {
    const map = defOf(f).map || {};
    const views = [];
    const add = v => { if (!views.some(x => x.id === v.id)) views.push(v); };
    const stateView = (id, label, section, group, show) => add({ id, label, section, group, kind: "state", show });
    stateView("intensity", "Intensity", "INTENSITY", "intensity", st => `${Math.round(Number(st.intensity) || 0)} %`);
    const hasColour = Object.keys(map).some(k => SECTION_OF(k) === "COLOUR");
    if (hasColour) {
      stateView("colour", "Colour", "COLOUR", "colour", st => summary("colour", st));
      if (["r", "g", "b"].every(k => typeof map[k] === "number") || ["cyan", "magenta", "yellow"].some(k => typeof map[k] === "number")) {
        stateView("hue", "Hue", "COLOUR", "colour", st => deg(st.hue));
        stateView("sat", "Saturation", "COLOUR", "colour", st => `${Math.round(Number(st.sat) || 0)} %`);
      }
    }
    if (typeof map.pan === "number" || typeof map.tilt === "number") {
      add({ id: "target", label: "Target", section: "POSITION", group: "pan", kind: "derived", show: (st, f) => { const l = window.Targets?.lockOf?.(f?.id); const name = l?.target?.name || st.__targetPositionLock?.targetName; return name ? `“${name}” (captured)` : "None"; } });
      if (typeof map.pan === "number") stateView("pan", "Pan", "POSITION", "pan", st => `${clamp255(st.pan)}`);
      if (typeof map.tilt === "number") stateView("tilt", "Tilt", "POSITION", "tilt", st => `${clamp255(st.tilt)}`);
    }
    add({ id: "hang", label: "Hangs at", section: "POSITION", group: null, kind: "derived", show: () => { const p = S().visualizer?.positions?.[f.id]; return p ? `x ${(+p.x).toFixed(1)} · y ${(+p.y).toFixed(1)} · z ${(+p.z).toFixed(1)} m` : "Not placed in the visualiser"; } });
    // One row per DMX channel the fixture has (the intensity/dimmer pair once).
    const seen = new Set();
    Object.entries(map).filter(([, off]) => typeof off === "number").sort((a, b) => a[1] - b[1]).forEach(([key, off]) => {
      if (seen.has(off)) return;
      seen.add(off);
      if (/^(hue|sat)$/.test(key)) return;
      if ((key === "pan" || key === "tilt") && views.some(v => v.id === key)) return; // already a row
      add({ id: `ch:${key}`, label: key === "intensity" || key === "dimmer" ? "Dimmer channel" : nice(key), section: SECTION_OF(key), group: GROUP_OF(key), kind: "channel", key, off });
    });
    const ph = defOf(f).photometrics || {};
    if (!/fog|haze|mirror/i.test(f.name)) {
      add({ id: "beam", label: "Beam angle", section: "BEAM", group: null, kind: "derived", show: () => f.beamAngle != null ? `${f.beamAngle}° (set)` : ph.beamAngle ? `${ph.beamAngle}° (library)` : ph.beamAngleMin ? `${ph.beamAngleMin}–${ph.beamAngleMax}° (zoom)` : "Not known" });
      add({ id: "edge", label: "Edge", section: "BEAM", group: null, kind: "derived", show: () => (f.edge == null ? "Auto" : `${Math.round(f.edge * 100)}% soft`) });
    }
    if (Array.isArray(f.manualShutters) && f.manualShutters.some(v => Number(v) > 0)) add({ id: "barn", label: "Barn doors", section: "BEAM", group: null, kind: "derived", show: () => f.manualShutters.map(v => `${Math.round(v)}%`).join(" · ") });
    return views.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section));
  }

  function dmxOf(f, off) {
    const base = (Number(f.uni) - 1) * 512 + (Number(f.addr) - 1);
    return S().dmx?.[base + off] ?? 0;
  }

  function showView(v, f, st) {
    if (v.kind === "channel") { const d = dmxOf(f, v.off); return `${d} · ${Math.round(d / 2.55)}%`; }
    return v.show(st, f);
  }

  // -------------------------------------------------------------- window
  //
  // The window is built once per fixture/attribute; after that only the
  // text that changed is touched, so nothing under the mouse flickers and
  // a click never lands on a button that's being replaced.

  let body = null, fixtureId = null, attrId = "intensity", timer = null;
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 5 ? "just now" : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
  const sortedFixtures = () => (S().fixtures || []).filter(Boolean).slice().sort((a, b) => Number(a.fixtureNumber) - Number(b.fixtureNumber));

  // Set only if different: text, html, attribute, style.
  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  const setHTML = (el, v) => { if (el && el.__html !== v) { el.innerHTML = v; el.__html = v; } };

  function build(host) {
    body = host;
    host.innerHTML = `
      <div class="fi">
        <div class="fi-pick">
          <span class="fi-lbl">Fixture</span><select data-fi="fixture"></select>
          <span class="fi-lbl">Attribute</span><select data-fi="attr"></select>
          <span class="fi-live" title="Live — updates as it changes"></span>
        </div>
        <div class="fi-main">
          <div class="fi-head"><div class="fi-title"></div><div class="fi-sub"></div></div>
          <div class="fi-value">
            <div class="fi-tags"><b data-k="attr"></b><span>LTP</span><span data-k="state"></span></div>
            <div class="fi-big"><span class="fi-swatch" data-k="swatch"></span><span data-k="big"></span></div>
            <div class="fi-bar"><i data-k="bar"></i></div>
            <div class="fi-dmx" data-k="dmx"></div>
          </div>
          <div data-k="cards"></div>
        </div>
        <div class="fi-empty" hidden>Patch a fixture to see what it's doing.</div>
      </div>`;
    const fSel = host.querySelector('[data-fi="fixture"]'), aSel = host.querySelector('[data-fi="attr"]');
    fSel.addEventListener("change", () => { fixtureId = fSel.value; render(); });
    aSel.addEventListener("change", () => { attrId = aSel.value; render(); });
    render();
    clearInterval(timer);
    timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); timer = null; body = null; return; } render(); }, 200);
  }

  // What a cue holds for this fixture's attribute group, as text (or null).
  function cueValue(index, f, attr) {
    const cue = S().cues?.[index];
    if (!cue || !attr || typeof window.getCueTarget !== "function") return null;
    try {
      const st = window.getCueTarget(cue).fixtureMap.get(f.id);
      return st && attr.keys.some(k => k in st) ? summary(attr.id, st) : null;
    } catch (_) { return null; }
  }

  function render() {
    if (!body) return;
    const s = S();
    if (!s?.fixtures) return;
    const fixtures = sortedFixtures();
    if (!fixtureId || !fixtureById(fixtureId)) fixtureId = [...(s.selected || [])][0] ?? fixtures[0]?.id ?? null;
    const main = body.querySelector(".fi-main"), empty = body.querySelector(".fi-empty");
    const f = fixtureById(fixtureId);
    main.hidden = !f; empty.hidden = Boolean(f);

    const fSel = body.querySelector('[data-fi="fixture"]');
    const fKey = fixtures.map(x => `${x.id}:${x.fixtureNumber}:${x.name}`).join("|");
    if (fSel.dataset.key !== fKey) { fSel.innerHTML = fixtures.map(x => `<option value="${esc(x.id)}">${esc(x.fixtureNumber)} “${esc(x.name)}”</option>`).join(""); fSel.dataset.key = fKey; }
    if (!f) return;
    if (fSel.value !== String(f.id) && document.activeElement !== fSel) fSel.value = String(f.id);

    // Attribute dropdown: every attribute and channel, grouped.
    const views = viewsFor(f);
    if (!views.some(v => v.id === attrId)) attrId = "intensity";
    const aSel = body.querySelector('[data-fi="attr"]');
    const aKey = `${f.id}:${views.map(v => v.id).join(",")}`;
    if (aSel.dataset.key !== aKey) {
      aSel.innerHTML = SECTIONS.filter(sec => views.some(v => v.section === sec)).map(sec => `<optgroup label="${sec}">${views.filter(v => v.section === sec).map(v => `<option value="${esc(v.id)}">${esc(v.label.toUpperCase())}</option>`).join("")}</optgroup>`).join("");
      aSel.dataset.key = aKey;
    }
    if (aSel.value !== attrId && document.activeElement !== aSel) aSel.value = attrId;

    const view = views.find(v => v.id === attrId);
    const attr = view.group ? ATTRS.find(a => a.id === view.group) || { id: view.group, label: view.label, keys: [view.group], channels: [] } : null;
    const st = window.ensureFixtureState?.(f.id) || {};
    const def = defOf(f);
    const k = name => main.querySelector(`[data-k="${name}"]`);

    // Header.
    setHTML(main.querySelector(".fi-title"), `<b>${esc(f.fixtureNumber)}</b> ${esc(f.name)}`);
    setText(main.querySelector(".fi-sub"), `${String(f.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")} · Univ ${f.uni} · Addr ${f.addr}`);

    // The value.
    const chans = view.kind === "channel" ? [{ key: view.key, ch: Number(f.addr) + view.off, value: dmxOf(f, view.off) }] : attr && ATTRS.some(a => a.id === attr.id) ? channelsOf(f, attr) : [];
    setText(k("attr"), view.label.toUpperCase());
    const fading = s.fading != null;
    setText(k("state"), fading ? "FADE" : "");
    k("state").classList.toggle("on", fading);
    let big, bar = null, swatch = null;
    const TINT = { r: "255,48,48", g: "48,255,96", b: "58,107,255", w: "255,255,255", amber: "255,176,0", a: "255,176,0", lime: "198,255,0", l: "198,255,0", uv: "122,60,255", cyan: "0,229,255", c: "0,229,255", magenta: "255,43,214", yellow: "255,230,0", warmWhite: "255,214,160", coolWhite: "220,235,255", naturalWhite: "255,244,229" };
    if (view.kind === "channel") {
      const d = dmxOf(f, view.off); big = `${Math.round(d / 2.55)} %`; bar = d / 255;
      const tint = TINT[view.key.replace(/Fine$/, "")];
      if (tint) swatch = `rgba(${tint},${(0.15 + 0.85 * d / 255).toFixed(2)})`;
    } else if (view.kind === "derived") big = view.show(st, f);
    else if (view.id === "hue") { big = deg(st.hue); swatch = `hsl(${st.hue || 0} 100% 50%)`; }
    else if (view.id === "sat" || view.id === "intensity") { const v = Math.round(Number(st[view.id]) || 0); big = `${v} %`; bar = v / 100; }
    else if (view.id === "colour") {
      const rgb = chans.filter(c => ["r", "g", "b"].includes(c.key));
      swatch = rgb.length === 3 ? `rgb(${rgb.map(c => c.value).join(",")})` : `hsl(${st.hue || 0} ${st.sat || 0}% ${Math.max(30, Math.min(80, st.light ?? 50))}%)`;
      big = Number(st.sat) > 0 ? `${Math.round(st.hue)}°  ${Math.round(st.sat)} %` : "White";
    } else { const v = clamp255(st[attr.keys[0]]); big = `${Math.round(v / 2.55)} %`; bar = v / 255; }
    setText(k("big"), big);
    k("big").parentElement.classList.toggle("small", view.kind === "derived");
    k("swatch").hidden = !swatch;
    if (swatch && k("swatch").style.background !== swatch) k("swatch").style.background = swatch;
    k("bar").parentElement.hidden = bar == null;
    if (bar != null) { const w = `${Math.round(bar * 100)}%`; if (k("bar").style.width !== w) k("bar").style.width = w; }
    setText(k("dmx"), chans.length ? `DMX  ${chans.map(c => `ch${c.ch} = ${c.value}`).join("   ")}` : view.kind === "derived" ? "Set in the patch or the visualiser" : "");

    // What's affecting it, one card each — like a console's tracking sheet.
    const own = attr ? owners.get(f.id)?.[attr.id] : null;
    const live = attr ? summary(attr.id, st) : "";
    const cards = [];
    const cue = s.currentCue >= 0 ? s.cues?.[s.currentCue] : null;
    const capturedOn = window.Targets?.lockOf?.(f.id);
    const posLocked = Boolean(capturedOn && attr && (attr.id === "pan" || attr.id === "tilt"));
    const held = cue ? cueValue(s.currentCue, f, attr) : null;
    if (held != null) {
      const inControl = !posLocked && (own?.kind === "cue" || (!own && held === live));
      const srcs = window.LXTracking && cue.mode === "track" ? attr.keys.map(key => window.LXTracking.sourceOf(s.currentCue, f.id, key)).filter(i => i >= 0) : [];
      const from = srcs.length ? Math.max(...srcs) : s.currentCue;
      const how = from === s.currentCue ? (cue.mode === "track" ? "moved in this cue" : "LTP set") : `tracked from cue ${from + 1}`;
      cards.push(card("PLAYBACK", "#2fbf63", `Cue ${window.cueLabel(s.currentCue)}  → ${esc(held)}   ${how}   ${(Number(cue.fade ?? 800) / 1000).toFixed(1)} s`, inControl));
    }
    const effect = effectHas(f.id), chase = chaseHas(f.id);
    if (chase) cards.push(card("EXECUTOR", "#5ca8ff", `Chase ${s.currentChase + 1} “${esc(chase.name || "Chase")}”   running   ${Math.round(window.LXChaseSpeed?.bpmOf(chase) ?? 0)} BPM`, own?.kind === "chase"));
    if (effect) cards.push(card("EXECUTOR", "#e24fd0", `Effect “${esc(effect.name || effect.type)}”   ${esc(effect.type)}   running`, own?.kind === "effect"));
    if (posLocked) cards.push(card("TARGET", "#ffad1f", `Captured on “${esc(capturedOn.target.name)}”  → locked   nothing else can move it until you release it`, true));
    const mib = window.LXMoveInBlack?.presetFor(f.id);
    if (mib != null) cards.push(card("MOVE IN BLACK", "#9b7bff", `Preset for cue ${mib + 1}  ·  waiting dark until that cue`, own?.kind === "mib"));
    if (own && !["cue", "chase", "effect", "mib", "clear"].includes(own.kind)) {
      const where = { command: "command line", deck: "control deck", palette: "palette", magic: "magic sheet", focus: "point & shoot", insert: "inserted from a cue", manual: "manual" }[own.kind] || "manual";
      cards.push(card("PROGRAMMER", "#ffb454", `${esc(own.label)}  → ${esc(view.kind === "channel" ? big : live)}   ${where}`, true));
    }
    if (s.blackout) cards.push(card("OUTPUT", "#ff5265", "Blackout is on  → 0 %", true));
    if (document.getElementById("consoleModeBlind")?.classList.contains("active")) cards.push(card("OUTPUT", "#5ca8ff", "Blind — the stage isn't changing", false));
    if (!cards.length) cards.push(card(attr ? "NOTHING" : "PATCH", "#5d6b68", attr ? "Nothing has set this yet" : "Part of the fixture's setup", false));
    setHTML(k("cards"), cards.join(""));
  }

  // One layer: a heading and a single line; the one in control is marked.
  function card(kind, colour, line, inControl) {
    return `<div class="fi-card${inControl ? " win" : ""}" style="--k:${colour}"><div class="fi-kind">${kind}${inControl ? " <span>in control</span>" : ""}</div><div class="fi-card-title">${line}</div></div>`;
  }

  function open(target, attribute) {
    if (target != null) fixtureId = target;
    if (attribute) attrId = attribute;
    const w = window.LXWindows;
    if (!w) return false;
    w.open("fixtureinfo");
    render();
    return true;
  }

  function injectStyles() {
    if (document.getElementById("lxFixtureInfoStyles")) return;
    const style = document.createElement("style");
    style.id = "lxFixtureInfoStyles";
    style.textContent = `
      .fi{display:flex;flex-direction:column;min-height:100%}
      .fi-pick{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid var(--border);background:#0e1519;position:sticky;top:0;z-index:1}
      .fi-lbl{color:#5d6b68;font-size:10px;font-weight:700}
      .fi-pick select{flex:1;min-width:0;height:26px;padding:0 6px;background:#0a1013;border:1px solid var(--border-strong);border-radius:4px;color:var(--text);font-size:11px}
      .fi-live{flex:none;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
      .fi-main{padding:0 0 10px}
      .fi-empty{padding:30px;color:#6f7d7a;text-align:center;font-size:12px}
      .fi-head{padding:10px 12px;background:rgba(92,168,255,.10);border-left:3px solid var(--blue)}
      .fi-title{font-size:15px;font-weight:800;color:var(--text)}
      .fi-title b{margin-right:6px}
      .fi-sub{margin-top:3px;color:#7d8b88;font-family:var(--mono);font-size:10px}
      .fi-value.small .fi-big{font-size:17px}
      .fi-value{padding:10px 12px;border-bottom:1px solid var(--border)}
      .fi-tags{display:flex;gap:10px;align-items:baseline;font-size:10px;font-weight:800;letter-spacing:1px;color:#6f7d7a}
      .fi-tags b{color:var(--accent-2)}
      .fi-tags span.on{color:var(--warning)}
      .fi-big{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:30px;font-weight:300;color:var(--text);font-family:var(--mono)}
      .fi-swatch{width:30px;height:30px;border-radius:6px;border:1px solid var(--border-strong);box-shadow:0 0 18px rgba(255,255,255,.08)}
      .fi-swatch[hidden]{display:none}
      .fi-bar{height:4px;border-radius:2px;background:#1c272d;overflow:hidden}
      .fi-bar[hidden]{display:none}
      .fi-bar i{display:block;height:100%;background:var(--accent);transition:width .15s}
      .fi-dmx{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;color:#6f7d7a;font-family:var(--mono);font-size:10px}
      .fi-dmx em{font-style:normal;color:#9aa7a4}
      .fi-dmx b{color:var(--text)}
      .fi-card{margin:6px 10px;padding:7px 10px;border-left:3px solid var(--k);background:#0f171b;border-radius:3px;opacity:.6}
      .fi-card.win{opacity:1;background:#121c21}
      .fi-kind span{margin-left:6px;padding:1px 5px;border-radius:3px;background:var(--k);color:#071014;font-size:8px;letter-spacing:.6px}
      .fi-kind{color:var(--k);font-size:9.5px;font-weight:900;letter-spacing:1.2px}
      .fi-card-title{margin-top:2px;color:var(--text);font-family:var(--mono);font-size:11.5px}
    `;
    document.head.appendChild(style);
  }

  // Right-click a fixture (list, patch table or magic sheet) for its info.
  document.addEventListener("contextmenu", e => {
    const item = e.target.closest?.("#fixtureList .fixture-item[data-fixture-id], .ms-fx[data-id], #patchTable .pt-row[data-id]");
    if (!item) return;
    const raw = item.dataset.fixtureId ?? item.dataset.id;
    const f = S().fixtures.find(x => String(x?.id) === String(raw));
    if (!f) return;
    e.preventDefault();
    open(f.id);
  });

  function boot(tries = 0) {
    injectStyles();
    hook();
    if (window.LXWindows && !window.LXWindows.list().includes("fixtureinfo")) {
      window.LXWindows.register({ id: "fixtureinfo", title: "Fixture Info", build, w: 480, h: 440 });
    }
    if ((!window.LXWindows || !window.Palettes?.apply?.__lxInfo || !window.goToCue?.__lxInfo) && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  setInterval(watch, 100);
  window.addEventListener("load", () => setTimeout(boot, 300));

  // Claim by state key (intensity, hue, pan…) — for things that set a value
  // even when it doesn't change (e.g. "1 red" on a light that's already red).
  function claimKeys(ids, keys, source) {
    const groups = [...new Set(keys.filter(k => !SKIP_KEYS.has(k)).map(k => ATTR_OF[k] || k))];
    for (const id of ids) claim(id, groups, source);
  }

  window.LXFixtureInfo = Object.freeze({ open, act, claim, claimKeys, owners: id => ({ ...(owners.get(id) || {}) }), attrOf: key => ATTR_OF[key] || key, attrs: ATTRS.map(a => a.id) });
})();
