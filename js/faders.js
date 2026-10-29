"use strict";

/*
 * Faders: a page of big touch-friendly faders for running the show by
 * hand, on four pages of ten.
 *
 *   Group     brings that group's lights up to the fader's level. Brighter
 *             wins: a light already higher from a cue or the programmer
 *             stays where it is (like a submaster).
 *   Effect    a saved effect runs while the fader is up.
 *   Chase     a chase runs while the fader is up.
 *   Grand     the grand master: everything's intensity scaled by it.
 *   Fixture   one light's intensity (brighter wins, like a group).
 *   Parameter one or more lights' pan, tilt, zoom, colour… set straight from
 *             the fader, like moving it on the Control Deck (records into cues).
 *   DMX       one DMX channel (universe/address) to at least the fader's level.
 *   "Fill with fixtures" puts lights 1, 2, 3… on a page, a fader each.
 *
 * Every fader has a Flash button underneath: full while you hold it.
 * Faders don't record into cues; what they're set to is saved with the
 * show (State.faders). Tap an empty fader (or hold one) to set it up.
 *
 * js/dmx.js asks LXFaders.levelFor(fixtureId) and LXFaders.grand().
 */
(function () {
  if (window.LXFaders) return;
  const PAGES = 4, PER_PAGE = 10, ON = 5; // effect/chase faders run above 5%
  const S = () => window.State || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let page = 0;
  const flashing = new Set(); // "page:index" held down now
  const running = new Map();  // "page:index" -> what it started

  function data() {
    const s = S();
    if (!s.faders || !Array.isArray(s.faders.pages)) s.faders = { pages: [], grand: 100 };
    for (let p = 0; p < PAGES; p++) {
      s.faders.pages[p] ||= [];
      for (let i = 0; i < PER_PAGE; i++) s.faders.pages[p][i] ||= { type: "", level: 0 };
    }
    if (!Number.isFinite(Number(s.faders.grand))) s.faders.grand = 100;
    return s.faders;
  }
  const slot = (p, i) => data().pages[p][i];
  const fixtureNumbered = n => (S().fixtures || []).find(f => Number(f?.fixtureNumber) === Number(n));
  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  // Parameters a fader can drive, and the range of each in the light's state.
  const PARAM_RANGE = { intensity: 100, hue: 360, sat: 100 };
  const PARAM_NAME = { intensity: "Intensity", hue: "Colour (hue)", sat: "Saturation", pan: "Pan", tilt: "Tilt", panf: "Pan fine", tiltf: "Tilt fine", zoom: "Zoom", focus: "Focus", iris: "Iris", frost: "Frost", strobe: "Strobe", gobo: "Gobo 1", gobor: "Gobo 1 rotate", gobo2: "Gobo 2", gobo2r: "Gobo 2 rotate", prism: "Prism", prismr: "Prism rotate", speed: "Speed", effect: "Effect", cto: "CTO", blueMix: "Blue mix", amberMix: "Amber mix", magentaMix: "Magenta mix", rot: "Rotation", macro: "Macro", preset: "Preset", fog: "Fog", haze: "Haze", fana: "Fan", fluid: "Fluid", colmacro: "Colour macro" };
  function paramsOf(fixtures) {
    const keys = new Set(["intensity"]);
    for (const f of fixtures) {
      const map = defOf(f).map || {};
      for (const k of Object.keys(map)) if (PARAM_NAME[k]) keys.add(k);
      if (typeof map.colour === "number" || typeof map.r === "number" || typeof map.cyan === "number") { keys.add("hue"); keys.add("sat"); }
    }
    return [...keys];
  }
  // "1 thru 4", "1,3,5", "2" → fixture numbers.
  function parseNumbers(text) {
    const out = [];
    for (const part of String(text || "").toLowerCase().replace(/\s*(thru|through|>)\s*/g, "-").split(/[\s,+]+/)) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) continue;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b) && out.length < 512; n++) out.push(n);
    }
    return [...new Set(out)];
  }

  // ------------------------------------------------------------ what they do

  function membersOf(group) {
    const fixtures = S().fixtures || [];
    return (group?.members || []).map(v => fixtures.find(f => String(f.id) === String(v) || Number(f.fixtureNumber) === Number(v))).filter(Boolean);
  }
  const groupNamed = name => (S().groups || []).find(g => g?.name === name);

  // The highest group fader (or flash) on each light, 0-1. Rebuilt when a
  // fader moves rather than every DMX frame.
  let levels = new Map(), dmx = new Map();
  function rebuild() {
    const next = new Map(), raw = new Map();
    const f = data();
    f.pages.forEach((faders, p) => faders.forEach((fd, i) => {
      const level = flashing.has(`${p}:${i}`) ? 1 : Math.max(0, Math.min(100, Number(fd.level) || 0)) / 100;
      if (!level) return;
      if (fd.type === "dmx") { const key = `${fd.universe}:${fd.address}`; raw.set(key, Math.max(raw.get(key) || 0, Math.round(level * 255))); return; }
      const lights = fd.type === "group" ? membersOf(groupNamed(fd.name)) : fd.type === "fixture" ? [fixtureNumbered(fd.number)].filter(Boolean) : [];
      for (const light of lights) next.set(light.id, Math.max(next.get(light.id) || 0, level));
    }));
    levels = next; dmx = raw;
  }
  const levelFor = id => levels.get(id) || 0;
  const dmxLevels = () => dmx;

  // A parameter fader writes the lights' own state, like the Control Deck.
  function applyParam(fd, percent) {
    const range = PARAM_RANGE[fd.attr] || 255;
    const value = Math.round(Math.max(0, Math.min(100, percent)) / 100 * range);
    for (const n of fd.fixtures || []) {
      const f = fixtureNumbered(n);
      if (!f) continue;
      const st = typeof window.ensureFixtureState === "function" ? window.ensureFixtureState(f.id) : S().fixtureStates?.get(f.id);
      if (!st) continue;
      st[fd.attr] = value;
      if (fd.attr === "hue" && Number(st.sat) < 5) st.sat = 100; // a hue on white shows nothing
    }
  }
  const grand = () => Math.max(0, Math.min(100, Number(data().grand) || 0)) / 100;

  // Effects and chases run while their fader is up (or flashed).
  function sync(p, i) {
    const fd = slot(p, i), key = `${p}:${i}`;
    const want = (flashing.has(key) || Number(fd.level) > ON) && (fd.type === "effect" || fd.type === "chase");
    const now = running.get(key);
    if (want && !now) {
      if (fd.type === "effect") window.applySavedEffect?.(fd.name);
      if (fd.type === "chase") { const index = (S().chases || []).findIndex(c => c?.name === fd.name); if (index >= 0) window.startChase?.(index); }
      running.set(key, fd.type);
    } else if (!want && now) {
      if (now === "effect") window.stopEffectById?.(fd.name, true);
      if (now === "chase") window.stopChase?.(false);
      running.delete(key);
    }
  }

  function output() {
    rebuild();
    window.updateDMX?.();
    window.sendToVisualizer?.();
  }

  // ---------------------------------------------------------------------- UI

  function labelOf(fd) {
    if (fd.type === "group") return fd.name;
    if (fd.type === "fixture") {
      const f = fixtureNumbered(fd.number);
      if (!f) return `${fd.number} (not patched)`;
      const model = String(defOf(f).photometrics?.model || "");
      return `${fd.number} ${f.label || (model && !/^unknown$/i.test(model) ? model : f.name).replace(/\s*\([^)]*\)\s*$/, "")}`;
    }
    if (fd.type === "param") return `${fd.label || fd.fixtures?.join(",")} ${PARAM_NAME[fd.attr] || fd.attr}`;
    if (fd.type === "dmx") return `DMX ${fd.universe}/${fd.address}`;
    if (fd.type === "effect") return `FX ${fd.name}`;
    if (fd.type === "chase") return `Chase ${fd.name}`;
    if (fd.type === "grand") return "Grand master";
    return "";
  }

  function render() {
    const host = $("fadersBank");
    if (!host) return;
    const f = data();
    $("fadersPages").innerHTML = Array.from({ length: PAGES }, (_, p) => `<button type="button" class="fd-page${p === page ? " on" : ""}" data-page="${p}">Page ${p + 1}</button>`).join("") + `<button type="button" class="fd-page fd-fillbtn" data-fill>Fill with fixtures…</button>`;
    // Nothing on this page yet: say what faders are for, and a way to start.
    const start = $("fadersStart");
    if (start) {
      const blank = f.pages[page].every(fd => !fd.type);
      start.hidden = !blank;
      if (blank) {
        const groups = (S().groups || []).filter(g => g?.name).length;
        start.innerHTML = `<div><b>Assign groups or cues to faders</b><span>A fader brings its lights up by hand — a group, one light, an effect, a chase, or the grand master. Tap ＋ on a fader, or fill the page in one go:</span></div>
          <div class="fd-start-buttons">${groups ? `<button type="button" class="btn-primary" data-start="groups">Put my ${groups} group${groups === 1 ? "" : "s"} on faders</button>` : ""}<button type="button" class="${groups ? "btn-secondary" : "btn-primary"}" data-start="fixtures">A fader per light…</button><button type="button" class="btn-secondary" data-start="one">Assign fader ${page * PER_PAGE + 1} myself</button></div>`;
      }
    }
    host.innerHTML = f.pages[page].map((fd, i) => {
      const lvl = fd.type === "grand" ? Number(f.grand) : Number(fd.level) || 0;
      const empty = !fd.type;
      const missing = (fd.type === "fixture" && !fixtureNumbered(fd.number)) || (fd.type === "param" && !(fd.fixtures || []).some(fixtureNumbered)) || (fd.type === "group" && !groupNamed(fd.name)) || (fd.type === "effect" && !S().savedEffects?.[fd.name]) || (fd.type === "chase" && !(S().chases || []).some(c => c?.name === fd.name));
      return `<div class="fd${empty ? " empty" : ""}${missing ? " missing" : ""} fd-${fd.type || "none"}" data-i="${i}">
        <div class="fd-num">${page * PER_PAGE + i + 1}</div>
        <div class="fd-val">${empty ? "" : `${Math.round(lvl)}%`}</div>
        <div class="fd-track" data-track="${i}">${empty ? `<span class="fd-add">＋<small>Assign</small></span>` : `<div class="fd-fill" style="height:${lvl}%"></div><div class="fd-knob" style="bottom:calc((100% - 28px) * ${lvl / 100})"></div>`}</div>
        <button type="button" class="fd-name" data-assign="${i}" title="${esc(missing ? "Not in this show any more — tap to change" : "Tap to change")}">${esc(labelOf(fd) || "—")}</button>
        <button type="button" class="fd-flash" data-flash="${i}"${empty ? " disabled" : ""}>${fd.type === "grand" ? "Black" : "Flash"}</button>
      </div>`;
    }).join("");
  }

  function setLevel(i, value, final = false, p = page) {
    const fd = slot(p, i);
    if (!fd.type) return;
    const v = Math.max(0, Math.min(100, Math.round(value)));
    if (fd.type === "grand") data().grand = v; else fd.level = v;
    if (fd.type === "param") applyParam(fd, v);
    const el = p === page ? document.querySelector(`.fd[data-i="${i}"]`) : null;
    if (el) {
      el.querySelector(".fd-val").textContent = `${v}%`;
      el.querySelector(".fd-fill")?.style.setProperty("height", `${v}%`);
      el.querySelector(".fd-knob")?.style.setProperty("bottom", `calc((100% - 28px) * ${v / 100})`);
    }
    sync(p, i);
    output();
    if (final && fd.type === "param") window.renderDynamicControls?.();
  }

  // Flash (and Black on the grand master): on while held.
  const held = new Map();
  function flash(p, i, down) {
    const fd = slot(p, i), key = `${p}:${i}`;
    if (!fd.type) return;
    if (down) {
      if (fd.type === "grand") { held.set(key, data().grand); data().grand = 0; }
      else if (fd.type === "param") { held.set(key, fd.level); applyParam(fd, 100); }
      else flashing.add(key);
    } else {
      if (fd.type === "grand") data().grand = held.get(key) ?? data().grand;
      else if (fd.type === "param") applyParam(fd, held.get(key) ?? fd.level);
      else flashing.delete(key);
      held.delete(key);
    }
    sync(p, i); output();
  }

  async function assign(i) {
    const s = S(), fd = slot(page, i);
    const fixtures = (s.fixtures || []).filter(f => Number.isFinite(Number(f?.fixtureNumber))).sort((a, b) => a.fixtureNumber - b.fixtureNumber);
    const options = [["", "— Nothing (clear) —"], ["grand:", "Grand master"], ["param:", "A parameter of some lights (pan, tilt, zoom, colour…)…"], ["dmx:", "A DMX channel…"],
      ...fixtures.map(f => [`fixture:${f.fixtureNumber}`, `Fixture ${f.fixtureNumber}: ${window.fixtureLabel ? window.fixtureLabel(f) : f.name}`]),
      ...(s.groups || []).filter(g => g?.name).map(g => [`group:${g.name}`, `Group: ${g.name}`]),
      ...Object.keys(s.savedEffects || {}).map(n => [`effect:${n}`, `Effect: ${n}`]),
      ...(s.chases || []).filter(c => c?.name).map(c => [`chase:${c.name}`, `Chase: ${c.name}`])];
    const now = fd.type === "fixture" ? `fixture:${fd.number}` : fd.type === "param" ? "param:" : fd.type === "dmx" ? "dmx:" : fd.type ? `${fd.type}:${fd.name || ""}` : "";
    const r = await window.LXAsk?.(`Fader ${page * PER_PAGE + i + 1}`, [{ key: "what", label: "Controls", type: "select", value: now, options }], { ok: "Set", message: options.length <= 2 ? "Make groups, effects or chases first and they'll be listed here." : "" });
    if (!r) return;
    const [type, ...rest] = String(r.what || "").split(":");
    let next = { type, name: rest.join(":"), level: 0 };
    if (type === "fixture") next = { type, number: Number(rest[0]), level: 0 };
    if (type === "param") {
      const which = await window.LXAsk?.(`Fader ${page * PER_PAGE + i + 1}: which lights`, [{ key: "lights", label: "Fixture numbers (e.g. 5, or 1 thru 4, or 1,3,5)", value: fd.type === "param" ? (fd.label || fd.fixtures.join(",")) : "" }], { ok: "Next" });
      const numbers = parseNumbers(which?.lights);
      if (!which || !numbers.length) return;
      const lights = numbers.map(fixtureNumbered).filter(Boolean);
      if (!lights.length) { window.log?.(`No patched fixture ${which.lights}`, "warn"); return; }
      const attrs = paramsOf(lights);
      const what = await window.LXAsk?.(`Fader ${page * PER_PAGE + i + 1}: which parameter`, [{ key: "attr", label: `On ${which.lights}`, type: "select", value: fd.attr || attrs[0], options: attrs.map(a => [a, PARAM_NAME[a] || a]) }], { ok: "Set" });
      if (!what) return;
      next = { type, fixtures: numbers, label: String(which.lights).trim(), attr: what.attr, level: 0 };
    }
    if (type === "dmx") {
      const at = await window.LXAsk?.(`Fader ${page * PER_PAGE + i + 1}: DMX channel`, [{ key: "universe", label: "Universe", value: fd.universe || 1, type: "number" }, { key: "address", label: "Address (1-512)", value: fd.address || 1, type: "number" }], { ok: "Set" });
      if (!at) return;
      next = { type, universe: Math.max(1, Math.round(Number(at.universe) || 1)), address: Math.max(1, Math.min(512, Math.round(Number(at.address) || 1))), level: 0 };
    }
    // Whatever it ran before stops first.
    fd.level = 0; sync(page, i);
    for (const k of Object.keys(fd)) delete fd[k];
    Object.assign(fd, type ? next : { type: "", level: 0 });
    render(); output();
  }

  // FLX-style: a fader per light, numbered on from the one asked.
  async function fillWithFixtures() {
    const fixtures = (S().fixtures || []).filter(f => Number.isFinite(Number(f?.fixtureNumber))).sort((a, b) => a.fixtureNumber - b.fixtureNumber);
    if (!fixtures.length) { window.log?.("Patch some lights first", "warn"); return; }
    const r = await window.LXAsk?.(`Fill page ${page + 1} with fixtures`, [{ key: "from", label: "Starting at fixture", value: fixtures[0].fixtureNumber, type: "number" }], { ok: "Fill", message: `A fader each for ${PER_PAGE} lights, from that number on. Faders already set up on this page are replaced.` });
    if (!r) return;
    const from = Number(r.from) || 1;
    const list = fixtures.filter(f => f.fixtureNumber >= from).slice(0, PER_PAGE);
    data().pages[page].forEach((fd, i) => {
      fd.level = 0; sync(page, i);
      for (const k of Object.keys(fd)) delete fd[k];
      Object.assign(fd, list[i] ? { type: "fixture", number: list[i].fixtureNumber, level: 0 } : { type: "", level: 0 });
    });
    render(); output();
  }

  // Your groups, a fader each, in order (and the grand master on the last).
  function fillWithGroups() {
    const groups = (S().groups || []).filter(g => g?.name).slice(0, PER_PAGE - 1);
    if (!groups.length) { window.log?.("Make some groups first", "warn"); return; }
    data().pages[page].forEach((fd, i) => {
      fd.level = 0; sync(page, i);
      for (const k of Object.keys(fd)) delete fd[k];
      Object.assign(fd, groups[i] ? { type: "group", name: groups[i].name, level: 0 } : i === PER_PAGE - 1 ? { type: "grand", name: "", level: 0 } : { type: "", level: 0 });
    });
    render(); output();
    window.log?.(`Faders: ${groups.map(g => g.name).join(", ")}, and the grand master`, "ok");
  }

  // The command line's suggestions sit over the bottom of the page while it
  // has the focus; touching a fader is done with typing.
  const leaveTyping = () => { const a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur(); };

  function wire(host) {
    host.addEventListener("pointerdown", leaveTyping, true);
    // Drag anywhere on a fader's track: it follows the finger (or mouse).
    host.addEventListener("pointerdown", e => {
      const track = e.target.closest("[data-track]");
      if (!track) return;
      const i = Number(track.dataset.track);
      if (!slot(page, i).type) { assign(i); return; }
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      const at = ev => { const r = track.getBoundingClientRect(); return (1 - (ev.clientY - r.top) / r.height) * 100; };
      setLevel(i, at(e));
      const move = ev => setLevel(i, at(ev));
      const up = ev => { setLevel(i, at(ev), true); track.removeEventListener("pointermove", move); track.removeEventListener("pointerup", up); track.removeEventListener("pointercancel", up); };
      track.addEventListener("pointermove", move);
      track.addEventListener("pointerup", up);
      track.addEventListener("pointercancel", up);
    });
    // Flash: full while held (Black on the grand master: everything out).
    host.addEventListener("pointerdown", e => {
      const b = e.target.closest("[data-flash]");
      if (!b || b.disabled) return;
      e.preventDefault();
      const i = Number(b.dataset.flash), key = `${page}:${i}`, fd = slot(page, i);
      b.setPointerCapture(e.pointerId);
      b.classList.add("down");
      const p = page;
      flash(p, i, true);
      const release = () => {
        b.classList.remove("down");
        flash(p, i, false);
        b.removeEventListener("pointerup", release); b.removeEventListener("pointercancel", release);
      };
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
    });
    host.addEventListener("click", e => { const b = e.target.closest("[data-assign]"); if (b) assign(Number(b.dataset.assign)); });
    host.addEventListener("contextmenu", e => { const f = e.target.closest(".fd"); if (!f) return; e.preventDefault(); assign(Number(f.dataset.i)); });
  }

  function styles() {
    if ($("fadersStyles")) return;
    const st = document.createElement("style");
    st.id = "fadersStyles";
    st.textContent = `
      #page-faders.active{display:flex;flex-direction:column;min-height:0}
      #page-faders .panel{flex:1;min-height:0;display:flex;flex-direction:column}
      #page-faders .panel-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto}
      .fd-pages{display:flex;gap:6px;flex-wrap:wrap}
      .fd-page{min-height:40px;padding:0 16px;border:1px solid #26343a;border-radius:8px;background:#10171b;color:#9fb0ac;font-weight:800;cursor:pointer}
      .fd-page.on{border-color:var(--accent,#19d6a3);color:var(--accent,#19d6a3);background:#132024}
      .fd-bank{flex:1;min-height:300px;display:grid;grid-template-columns:repeat(${PER_PAGE},minmax(64px,1fr));gap:8px;overflow-x:auto}
      .fd{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0;padding:8px 6px;border:1px solid #1f2a2f;border-radius:10px;background:#0c1215;user-select:none;-webkit-user-select:none}
      .fd-num{font:800 13px var(--mono,monospace);color:#99a8a5;text-align:center}
      .fd-val{font:800 15px var(--mono,monospace);color:#edf4f2;text-align:center;min-height:18px}
      .fd-track{position:relative;flex:1;min-height:120px;margin:0 auto;width:56px;border-radius:10px;background:#071012;border:1px solid #1d282c;touch-action:none;cursor:ns-resize;overflow:visible}
      .fd-fill{position:absolute;left:0;right:0;bottom:0;border-radius:9px;background:linear-gradient(180deg,var(--accent,#19d6a3),rgba(25,214,163,.25));opacity:.55;pointer-events:none}
      .fd-knob{position:absolute;left:-6px;right:-6px;height:28px;border-radius:7px;background:#dfe9e6;box-shadow:0 2px 8px rgba(0,0,0,.6),inset 0 -3px 0 rgba(0,0,0,.18);pointer-events:none}
      .fd-add{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#93a7a2;font-size:24px;cursor:pointer}
      .fd-add small{display:block;font-size:13px;font-weight:800;letter-spacing:.06em}
      .fd.empty .fd-track{cursor:pointer;border-style:dashed}
      .fd-name{min-height:38px;padding:4px;border:1px solid #1f2a2f;border-radius:7px;background:#10171b;color:#c6d0ce;font-size:13px;font-weight:800;line-height:1.2;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .fd.missing .fd-name{color:#f2b84b;border-color:#5a4520}
      .fd-flash{min-height:52px;border:1px solid #2b383f;border-radius:8px;background:#15201f;color:#c6d0ce;font-weight:900;letter-spacing:.06em;cursor:pointer;touch-action:none}
      .fd-flash.down{background:var(--accent,#19d6a3);color:#061210}
      .fd-grand .fd-fill{background:linear-gradient(180deg,#f2b84b,rgba(242,184,75,.25))}
      .fd-grand .fd-flash.down{background:#ff6b6b}
      .fd-fillbtn{margin-left:auto}
      .fd-start{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 10px;padding:14px 16px;border:1px dashed var(--accent-line,#1f5a4a);border-radius:10px;background:rgba(25,214,163,.05)}
      .fd-start[hidden]{display:none}
      .fd-start > div:first-child{flex:1 1 320px;display:flex;flex-direction:column;gap:4px}
      .fd-start b{color:var(--text);font-size:16px}
      .fd-start span{color:var(--text-soft,#c9d3d1);font-size:13px;line-height:1.45}
      .fd-start-buttons{display:flex;flex-wrap:wrap;gap:8px}
      .fd-start-buttons button{min-height:38px;padding:0 14px}
      .fd-param .fd-fill{background:linear-gradient(180deg,#5ca8ff,rgba(92,168,255,.25))}
      .fd-dmx .fd-fill{background:linear-gradient(180deg,#c6d0ce,rgba(198,208,206,.2))}
      .fd-effect .fd-fill,.fd-chase .fd-fill{background:linear-gradient(180deg,#9b7bff,rgba(155,123,255,.25))}
    `;
    document.head.appendChild(st);
  }

  // A Faders page in the sidebar, before Settings.
  function install(tries = 0) {
    const settings = document.querySelector('.nav-link[data-page="settings"]');
    const main = document.querySelector("main.workspace");
    if (!settings || !main) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if ($("page-faders")) return;
    styles();
    const pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.id = "page-faders";
    pageEl.innerHTML = `<section class="panel" style="height:100%"><div class="panel-header"><div><span class="eyebrow">PLAYBACK</span> Faders</div><span class="panel-meta">GROUPS · EFFECTS · CHASES</span></div><div class="panel-body"><div class="fd-pages" id="fadersPages"></div><div class="fd-start" id="fadersStart" hidden></div><div class="fd-bank" id="fadersBank"></div></div></section>`;
    main.appendChild(pageEl);
    const nav = document.createElement("button");
    nav.className = "nav-link";
    nav.dataset.page = "faders";
    nav.title = "Faders";
    nav.innerHTML = `<span class="nav-icon">☰</span><span class="nav-text">Faders</span><b></b>`;
    settings.before(nav);
    nav.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".nav-link").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
      nav.classList.add("active");
      pageEl.classList.add("active");
      leaveTyping();
      const title = $("topPageTitle");
      if (title) title.textContent = "FADERS";
      render();
    });
    document.querySelectorAll(".nav-link[data-page]").forEach((b, i) => { const tag = b.querySelector("b"); if (tag) tag.textContent = String(i + 1).padStart(2, "0"); });
    $("fadersStart").addEventListener("click", e => {
      const a = e.target.closest("[data-start]")?.dataset.start;
      if (a === "groups") fillWithGroups();
      else if (a === "fixtures") fillWithFixtures();
      else if (a === "one") assign(0);
    });
    $("fadersPages").addEventListener("click", e => { if (e.target.closest("[data-fill]")) { fillWithFixtures(); return; } const b = e.target.closest("[data-page]"); if (b) { page = Number(b.dataset.page); render(); } });
    wire($("fadersBank"));
    render();
  }

  // A show opened or started: its faders, with nothing running.
  window.addEventListener("lx-show-file", () => {
    running.clear(); flashing.clear();
    data().pages.forEach((faders, p) => faders.forEach((_, i) => sync(p, i)));
    output(); render();
  });

  window.LXFaders = {
    levelFor, dmxLevels, grand, render, refresh: output, data, parseNumbers,
    page: () => page,
    set: (i, v) => setLevel(i, v, true),
    // For MIDI and the like: fader n (1-40, across the pages) to a level or
    // flashed; the screen follows.
    setFader: (n, v) => { const p = Math.floor((n - 1) / PER_PAGE), i = (n - 1) % PER_PAGE; if (p >= 0 && p < PAGES) { setLevel(i, v, false, p); if (p === page) render(); } },
    flashFader: (n, down) => { const p = Math.floor((n - 1) / PER_PAGE), i = (n - 1) % PER_PAGE; if (p >= 0 && p < PAGES) flash(p, i, down); },
    setGrand: v => { data().grand = Math.max(0, Math.min(100, Math.round(v))); output(); render(); },
    count: PAGES * PER_PAGE
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
