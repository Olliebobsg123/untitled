"use strict";

/*
 * Online fixture library: fixtures from Open Fixture Library
 * (open-fixture-library.org, about 650 lights from Robe, Martin, Chauvet,
 * ETC, Clay Paky, Showtec, Elation…), searched from the Patch page and
 * turned into Light Spark fixtures with the maker's own channel layout:
 * which channel does what, the colour wheel's real colours and positions,
 * where the shutter is open and where it strobes, and how far it pans and
 * tilts. A downloaded fixture is kept with the custom fixtures (Fixture
 * Editor), so it works offline from then on and can be tweaked there.
 *
 * LXOnlineFixtures.convert(oflFixture, makerName, modeIndex) does the
 * conversion on its own (no network), for tests and for files.
 */
(function () {
  if (window.LXOnlineFixtures) return;
  const API = "https://open-fixture-library.org/api/v1";
  const RAW = ["https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/fixtures", "https://cdn.jsdelivr.net/gh/OpenLightingProject/open-fixture-library@master/fixtures"];
  const INDEX = "https://data.jsdelivr.com/v1/package/gh/OpenLightingProject/open-fixture-library@master/flat";
  const CACHE = "lx-ofl-index";
  const CUSTOM = "lx-custom-fixtures";
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------- converting

  const COLOURS = { red: "r", green: "g", blue: "b", white: "w", amber: "amber", uv: "uv", lime: "lime", cyan: "cyan", magenta: "magenta", yellow: "yellow", "warm white": "warmWhite", "cold white": "coolWhite" };
  const SIMPLE = { Pan: "pan", Tilt: "tilt", Zoom: "zoom", BeamAngle: "zoom", Focus: "focus", Iris: "iris", Frost: "frost", Prism: "prism", PrismRotation: "prismr", ColorTemperature: "cto", ColorPreset: "colmacro", Fog: "fog", FogOutput: "fog", Rotation: "rot", PanTiltSpeed: "speed", Speed: "speed", EffectSpeed: "speed", Effect: "effect", EffectParameter: "effect", Maintenance: "control", Generic: "control" };

  const capsOf = ch => (ch?.capabilities || (ch?.capability ? [{ ...ch.capability, dmxRange: [0, 255] }] : []));
  // The type that most of a channel's range does (NoFunction aside).
  function mainType(ch) {
    const count = {};
    for (const c of capsOf(ch)) {
      if (c.type === "NoFunction") continue;
      const [a, b] = c.dmxRange || [0, 255];
      count[c.type] = (count[c.type] || 0) + (b - a + 1);
    }
    return Object.entries(count).sort((x, y) => y[1] - x[1])[0]?.[0] || "NoFunction";
  }
  const hexRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); const n = m ? parseInt(m[1], 16) : 0xffffff; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => Math.round(v * 100) / 100); };
  function hueOf([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.08) return null; // white / grey: no hue
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round((h * 60 + 360) % 360);
  }
  const cleanName = t => String(t || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

  function convert(fx, makerName, modeIndex = 0) {
    const mode = fx.modes?.[modeIndex];
    if (!mode) throw new Error("No such mode");
    const channels = fx.availableChannels || {};
    const wheels = fx.wheels || {};
    const fine = new Map(); // "Pan fine" -> { base, level }
    for (const [key, ch] of Object.entries(channels)) (ch.fineChannelAliases || []).forEach((alias, i) => fine.set(alias, { base: key, level: i + 1 }));
    const isColourWheel = name => {
      const w = wheels[name];
      if (/colou?r/i.test(name)) return true;
      const slots = w?.slots || [];
      return slots.length > 0 && slots.filter(s => s.type === "Color").length >= slots.length / 2;
    };
    const goboWheels = [];
    const map = {}, notes = [], extra = {};
    let colourWheel = null;
    const put = (attr, i, why) => {
      if (map[attr] != null) { notes.push(`channel ${i + 1} (${why}) not used: ${attr} is already channel ${map[attr] + 1}`); return false; }
      map[attr] = i; return true;
    };
    const baseAttr = {};

    mode.channels.forEach((key, i) => {
      if (typeof key !== "string") { if (key != null) notes.push(`channel ${i + 1} is a matrix/switching channel — left unused`); return; }
      const alias = fine.get(key);
      if (alias) {
        const attr = baseAttr[alias.base];
        if (alias.level === 1 && (attr === "pan" || attr === "tilt")) put(attr + "f", i, key);
        else notes.push(`channel ${i + 1} (${key}) is a fine channel — left at 0`);
        return;
      }
      const ch = channels[key];
      if (!ch) { notes.push(`channel ${i + 1} (${key}) isn't described`); return; }
      const type = mainType(ch);
      const caps = capsOf(ch);
      let attr = null;
      if (type === "Intensity") { if (put("dimmer", i, key)) { map.intensity = i; baseAttr[key] = "dimmer"; } return; }
      if (type === "ColorIntensity") attr = COLOURS[String(caps.find(c => c.type === "ColorIntensity")?.color || "").toLowerCase()];
      else if (type === "ShutterStrobe") {
        attr = "strobe";
        // Where the shutter is open, and where it strobes slow → fast.
        const open = caps.find(c => c.type === "ShutterStrobe" && c.shutterEffect === "Open");
        const strobe = caps.filter(c => c.type === "ShutterStrobe" && /Strobe|Pulse|Random/.test(c.shutterEffect || "")).sort((a, b) => (b.dmxRange[1] - b.dmxRange[0]) - (a.dmxRange[1] - a.dmxRange[0]))[0];
        if (open) extra.strobeOpen = open.dmxRange[0] === 0 && open.dmxRange[1] > 0 ? open.dmxRange[1] : Math.round((open.dmxRange[0] + open.dmxRange[1]) / 2);
        if (strobe) extra.strobeRange = [strobe.dmxRange[0], strobe.dmxRange[1]];
      } else if (/^Wheel/.test(type)) {
        const wheelName = caps.find(c => c.wheel)?.wheel || key;
        if (isColourWheel(wheelName)) attr = type === "WheelSlot" || type === "WheelShake" ? "colour" : "colourr";
        else {
          if (!goboWheels.includes(wheelName)) goboWheels.push(wheelName);
          const n = goboWheels.indexOf(wheelName);
          const rotate = type === "WheelSlotRotation" || type === "WheelRotation";
          attr = n === 0 ? (rotate ? "gobor" : "gobo") : n === 1 ? (rotate ? "gobo2r" : "gobo2") : null;
        }
        if (attr === "colour" && !colourWheel) colourWheel = wheelSlots(ch, wheels[wheelName]);
      } else if (/^Blade/.test(type)) {
        const blade = caps.find(c => c.blade)?.blade;
        const n = { Top: 1, Right: 2, Bottom: 3, Left: 4 }[blade] || (Number(blade) || null);
        if (n) attr = `shutter${n}${type === "BladeInsertion" ? "Insert" : "Rotate"}`;
      } else attr = SIMPLE[type] || null;
      if (!attr) { notes.push(`channel ${i + 1} (${key}, ${type}) has no Light Spark control — left at 0`); return; }
      if (put(attr, i, key)) baseAttr[key] = attr;
    });

    const has = k => typeof map[k] === "number";
    const type = has("pan") && has("tilt") ? "moving" : has("r") && has("g") && has("b") ? (has("w") ? "rgbw" : "rgb") : has("strobe") && !has("dimmer") ? "strobe" : "dimmer";
    const lens = fx.physical?.lens?.degreesMinMax;
    const panMax = Math.max(0, ...Object.values(channels).flatMap(ch => capsOf(ch).filter(c => c.type === "Pan").map(c => parseFloat(c.angleEnd) || 0)));
    const tiltMax = Math.max(0, ...Object.values(channels).flatMap(ch => capsOf(ch).filter(c => c.type === "Tilt").map(c => parseFloat(c.angleEnd) || 0)));
    const modeName = mode.shortName || mode.name || `Mode ${modeIndex + 1}`;
    const name = `${makerName} ${fx.name} (${new RegExp(`\\b${mode.channels.length}\\s*ch`, "i").test(modeName) ? modeName : `${modeName}, ${mode.channels.length}ch`})`;
    const definition = {
      type, channels: mode.channels.length, map,
      manufacturer: makerName, model: fx.name,
      photometrics: {
        verified: false, sourceType: /LED/i.test(fx.physical?.bulb?.type || "") ? "LED" : fx.physical?.bulb?.type ? "DISCHARGE" : "LED",
        ratedLumens: Number(fx.physical?.bulb?.lumens) || null,
        beamAngle: lens && lens[0] === lens[1] ? lens[0] : null,
        beamAngleMin: lens ? lens[0] : null, beamAngleMax: lens ? lens[1] : null,
        outputScale: 1, colourTemperature: Number(fx.physical?.bulb?.colorTemperature) || null,
        sourcePowerWatts: Number(fx.physical?.power) || null,
        manufacturer: makerName, model: fx.name,
        sourceNote: `From Open Fixture Library (open-fixture-library.org), mode “${mode.name || modeName}”.`
      },
      custom: true, ofl: true
    };
    if (panMax) definition.panRange = panMax;
    if (tiltMax) definition.tiltRange = tiltMax;
    if (colourWheel?.length) definition.colourWheel = colourWheel;
    if (has("strobe") && extra.strobeOpen != null) { definition.strobeOpen = extra.strobeOpen; if (extra.strobeRange) definition.strobeRange = extra.strobeRange; }
    return { name, definition, notes };
  }

  // A colour wheel channel's slots: where each colour sits and what it is.
  function wheelSlots(ch, wheel) {
    const scale = ch.dmxValueResolution === "16bit" ? 1 / 257 : 1;
    const slots = [];
    for (const c of capsOf(ch)) {
      if (c.type !== "WheelSlot" || !Number.isInteger(Number(c.slotNumber))) continue;
      const s = wheel?.slots?.[Number(c.slotNumber) - 1];
      if (!s) continue;
      const [a, b] = (c.dmxRange || [0, 0]).map(v => Math.round(v * scale));
      const open = s.type === "Open";
      const rgb = open ? [1, 1, 1] : hexRgb(s.colors?.[0]);
      const slot = { name: open ? "Open" : cleanName(s.name) || `Slot ${c.slotNumber}`, min: a, max: b, dmx: Math.round((a + b) / 2), rgb };
      const hue = hueOf(rgb);
      if (hue != null && !open) slot.hue = hue;
      if (!slots.some(x => x.min === a)) slots.push(slot);
    }
    return slots.sort((x, y) => x.min - y.min);
  }

  // ----------------------------------------------------------------- network

  async function getJSON(urls) {
    let last;
    for (const url of [].concat(urls)) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) return await res.json();
        last = new Error(`${res.status} from ${new URL(url).host}`);
      } catch (err) { last = err; }
    }
    throw last || new Error("Not reachable");
  }

  let makers = null, index = null;
  async function loadIndex() {
    if (index) return index;
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE) || "null");
      if (saved && Date.now() - saved.at < 7 * 864e5 && saved.makers && saved.fixtures?.length) { makers = saved.makers; index = saved.fixtures; return index; }
    } catch (_) {}
    makers = await getJSON(`${API}/manufacturers`);
    let fixtures = [];
    try {
      const flat = await getJSON(INDEX);
      fixtures = (flat.files || []).map(f => /^\/fixtures\/([^/]+)\/([^/]+)\.json$/.exec(f.name)).filter(Boolean).map(m => ({ maker: m[1], key: m[2] }));
    } catch (_) {}
    if (!fixtures.length) {
      // No flat index: ask maker by maker.
      for (const maker of Object.keys(makers)) {
        try { const m = await getJSON(`${API}/manufacturers/${maker}`); for (const f of m.fixtures || []) fixtures.push({ maker, key: f.key, name: f.name }); } catch (_) {}
      }
    }
    index = fixtures.filter(f => makers[f.maker]).map(f => ({ ...f, name: f.name || f.key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()), makerName: makers[f.maker].name }));
    try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), makers, fixtures: index })); } catch (_) {}
    return index;
  }

  const fetchFixture = (maker, key) => getJSON(RAW.map(base => `${base}/${maker}/${key}.json`));

  // --------------------------------------------------------------------- UI

  let current = null; // { item, fixture }

  function open() {
    const panel = ensurePanel();
    panel.hidden = false;
    $("oflSearch").focus();
    if (!index) {
      $("oflList").innerHTML = `<div class="ofl-note">Loading the library…</div>`;
      loadIndex().then(() => search()).catch(err => { $("oflList").innerHTML = `<div class="ofl-note warn">Couldn't reach Open Fixture Library (${esc(err.message)}). Check the internet connection.</div>`; });
    } else search();
  }

  function search() {
    const q = String($("oflSearch").value || "").toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    const list = (index || []).filter(f => words.every(w => `${f.makerName} ${f.name} ${f.key}`.toLowerCase().includes(w))).slice(0, 80);
    $("oflList").innerHTML = !q ? `<div class="ofl-note">${index?.length || 0} fixtures from ${Object.keys(makers || {}).length} makers. Type a maker or model — “robin 600”, “martin mac”, “chauvet rogue”.</div>`
      : list.length ? list.map((f, i) => `<button type="button" class="ofl-item" data-i="${i}"><b>${esc(f.name)}</b><span>${esc(f.makerName)}</span></button>`).join("")
      : `<div class="ofl-note">Nothing found for “${esc(q)}”. Open Fixture Library doesn't have every light (no Vari-Lite or High End Systems, for example): make it in the Fixture Editor instead.</div>`;
    $("oflList").__items = list;
    properNames(list);
  }

  // Names guessed from file names ("Robin 300e Wash") are swapped for the
  // real ones ("Robin 300E Wash") for the makers in the results.
  const named = new Set();
  async function properNames(list) {
    const todo = [...new Set(list.map(f => f.maker))].filter(m => !named.has(m)).slice(0, 6);
    if (!todo.length) return;
    todo.forEach(m => named.add(m));
    let changed = false;
    await Promise.all(todo.map(async maker => {
      try {
        const m = await getJSON(`${API}/manufacturers/${maker}`);
        for (const f of m.fixtures || []) { const item = index.find(x => x.maker === maker && x.key === f.key); if (item && item.name !== f.name) { item.name = f.name; changed = true; } }
      } catch (_) { named.delete(maker); }
    }));
    if (changed) {
      try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), makers, fixtures: index })); } catch (_) {}
      const on = document.querySelector(".ofl-item.on")?.dataset.i;
      search();
      if (on != null) document.querySelector(`.ofl-item[data-i="${on}"]`)?.classList.add("on");
    }
  }

  async function choose(item) {
    $("oflDetail").innerHTML = `<div class="ofl-note">Getting ${esc(item.makerName)} ${esc(item.name)}…</div>`;
    try {
      const fixture = await fetchFixture(item.maker, item.key);
      current = { item, fixture };
      const modes = fixture.modes || [];
      $("oflDetail").innerHTML = `<div class="ofl-head"><b>${esc(item.makerName)} ${esc(fixture.name)}</b><span>${esc((fixture.categories || []).join(", "))}</span></div>
        <label class="ofl-row">Mode <select id="oflMode">${modes.map((m, i) => `<option value="${i}">${esc(m.name)} — ${m.channels.length} channels</option>`).join("")}</select></label>
        <div id="oflPreview"></div>
        <div class="action-row"><button type="button" class="btn-primary" id="oflAdd">＋ Add to library</button></div>`;
      $("oflMode").addEventListener("change", preview);
      $("oflAdd").addEventListener("click", add);
      preview();
    } catch (err) { $("oflDetail").innerHTML = `<div class="ofl-note warn">Couldn't download it (${esc(err.message)}).</div>`; }
  }

  function preview() {
    if (!current) return;
    const { name, definition, notes } = convert(current.fixture, current.item.makerName, Number($("oflMode").value) || 0);
    const byChannel = Object.entries(definition.map).filter(([k]) => k !== "intensity").sort((a, b) => a[1] - b[1]);
    $("oflPreview").innerHTML = `<div class="ofl-note">Adds <b>${esc(name)}</b>.</div>
      <div class="ofl-map">${byChannel.map(([k, ch]) => `<span><i>${ch + 1}</i>${esc(k)}</span>`).join("")}</div>
      ${definition.colourWheel ? `<div class="ofl-wheel">${definition.colourWheel.filter((s, i, all) => all.findIndex(x => x.name.toLowerCase() === s.name.toLowerCase()) === i).map(s => `<span title="DMX ${s.dmx}" style="--c:rgb(${s.rgb.map(v => Math.round(v * 255)).join(",")})">${esc(s.name)}</span>`).join("")}</div>` : ""}
      ${notes.length ? `<details class="ofl-notes"><summary>${notes.length} channel${notes.length === 1 ? "" : "s"} without a control</summary>${notes.map(n => `<div>${esc(n)}</div>`).join("")}</details>` : ""}`;
  }

  function add() {
    if (!current) return;
    const { name, definition } = convert(current.fixture, current.item.makerName, Number($("oflMode").value) || 0);
    let custom = {};
    try { custom = JSON.parse(localStorage.getItem(CUSTOM) || "{}") || {}; } catch (_) {}
    custom[name] = definition;
    try { localStorage.setItem(CUSTOM, JSON.stringify(custom)); } catch (_) {}
    if (window.FixtureLibrary) window.FixtureLibrary[name] = JSON.parse(JSON.stringify(definition));
    window.renderLibrary?.();
    const field = $("patchName");
    if (field) { field.value = name; field.dispatchEvent(new Event("change", { bubbles: true })); }
    window.LXPatch?.refresh?.();
    window.log?.(`Added ${name} from Open Fixture Library — picked in the Patch form`, "ok");
    $("oflDetail").insertAdjacentHTML("beforeend", `<div class="ofl-note ok">Added. It's picked in the Patch form: set the address and press Patch.</div>`);
  }

  function ensurePanel() {
    let panel = $("oflPanel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "oflPanel";
    panel.className = "ofl-panel";
    panel.hidden = true;
    panel.innerHTML = `<div class="ofl-box" role="dialog" aria-modal="true"><div class="ofl-title"><b>Online fixture library</b><span>Open Fixture Library</span><button type="button" id="oflClose" title="Close">×</button></div>
      <div class="search-box">⌕ <input id="oflSearch" placeholder="Search makers and models — robin 600, mac aura, rogue" autocomplete="off" spellcheck="false"></div>
      <div class="ofl-cols"><div id="oflList" class="ofl-list"></div><div id="oflDetail" class="ofl-detail"><div class="ofl-note">Pick a fixture to see its modes and channels.</div></div></div></div>`;
    document.body.appendChild(panel);
    $("oflClose").addEventListener("click", () => { panel.hidden = true; });
    panel.addEventListener("click", e => { if (e.target === panel) panel.hidden = true; });
    $("oflSearch").addEventListener("input", search);
    $("oflList").addEventListener("click", e => { const b = e.target.closest(".ofl-item"); if (!b) return; document.querySelectorAll(".ofl-item.on").forEach(x => x.classList.remove("on")); b.classList.add("on"); choose($("oflList").__items[Number(b.dataset.i)]); });
    const st = document.createElement("style");
    st.textContent = `.ofl-panel{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:rgba(2,4,5,.6)}.ofl-panel[hidden]{display:none}.ofl-box{width:min(980px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #2b383f;border-radius:12px;background:#0b1114;box-shadow:0 20px 60px rgba(0,0,0,.6)}.ofl-title{display:flex;align-items:center;gap:10px}.ofl-title b{font-size:15px;color:#edf4f2}.ofl-title span{flex:1;font-size:13px;color:#9daaa7}.ofl-title button{width:36px;height:32px;border:0;border-radius:6px;background:transparent;color:#a7b1ae;font-size:20px;cursor:pointer}.ofl-cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:12px}.ofl-list,.ofl-detail{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:5px}.ofl-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 10px;border:1px solid #202a30;border-radius:7px;background:#10171b;color:#c6d0ce;text-align:left;cursor:pointer}.ofl-item b{font-size:14px}.ofl-item span{font-size:10.5px;color:#a5adac}.ofl-item.on{border-color:var(--accent,#19d6a3)}.ofl-note{font-size:11.5px;line-height:1.5;color:#a5adac}.ofl-note.warn{color:#f2b84b}.ofl-note.ok{color:#54f2c8}.ofl-head b{display:block;font-size:15px;color:#edf4f2}.ofl-head span{font-size:13px;color:#a5adac}.ofl-row{display:flex;align-items:center;gap:8px;font-size:14px;color:#c6d0ce}.ofl-row select{flex:1;min-width:0}.ofl-map{display:flex;flex-wrap:wrap;gap:4px}.ofl-map span{display:inline-flex;gap:5px;padding:3px 7px;border:1px solid #202a30;border-radius:5px;font-size:13px;color:#c6d0ce}.ofl-map i{font-style:normal;color:#54f2c8;font-family:var(--mono,monospace)}.ofl-wheel{display:flex;flex-wrap:wrap;gap:4px}.ofl-wheel span{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:12px;background:#10171b;font-size:13px;color:#c6d0ce}.ofl-wheel span::before{content:"";width:11px;height:11px;border-radius:50%;background:var(--c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}.ofl-notes{font-size:13px;color:#a5adac}.ofl-notes summary{cursor:pointer}`;
    document.head.appendChild(st);
    return panel;
  }

  // A button by the Patch page's library search.
  function install(tries = 0) {
    const search = $("fixtureSearch")?.closest(".search-box");
    if (!search) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if ($("oflOpen")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "oflOpen";
    button.className = "btn-secondary full-width";
    button.textContent = "🌐 Online fixture library…";
    button.style.margin = "8px 0";
    button.addEventListener("click", open);
    search.after(button);
  }

  window.LXOnlineFixtures = { convert, open, loadIndex };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
