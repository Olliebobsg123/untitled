"use strict";

/*
 * Preferences: a window (the Light Spark menu, the Windows menu, or
 * Cmd/Ctrl+,) with tabs for Appearance, Layout, Programming, Keyboard and
 * Show plus the old Settings page (Outputs, MIDI, QLab Connect). Options
 * are kept in localStorage "lx-preferences".
 *
 * Loaded in <head> so the look applies before the first paint.
 *
 *   LXPrefs.get(key)  .set(key, value)  .on(fn)  .open(tab)  .close()
 */
(function () {
  if (window.LXPrefs) return;

  const STORE = "lx-preferences";
  const DEFAULTS = {
    // Appearance
    density: "compact",        // compact | comfortable
    zoom: 1,                   // interface size
    accent: "teal",            // a name from ACCENTS, or "custom"
    accentCustom: "#19d6a3",
    theme: "dark",             // dark | black | slate
    textSize: "normal",        // small | normal | large
    corners: "rounded",        // rounded | square
    motion: true,              // animations
    panelLabels: true,         // the small "01 · SELECT" labels on panels
    fixtureDetail: true,       // address/level line in the fixture list
    cueDetail: true,           // fade times in the cue stack
    // Layout
    sidebar: "icons",          // icons (expand on hover) | labels
    sidebarWidth: 214,
    clock: "off",              // off | 24 | 12
    topStatus: true,           // Art-Net / QLab / MIDI lights
    topSafety: true,           // WHITE and BLACKOUT buttons
    topLicence: true,          // licence buttons
    logDocked: false,          // console log in the bottom bar, or only as a window
    bottomHeight: 0,           // 0 = automatic
    cueColumns: true,          // cue stack in columns across the bottom bar
    ticker: true,              // latest log line at the end of the command line
    remoteButton: true,
    windowSnap: 0,             // 0 | 8 | 16 | 32
    windowOpen: "right",       // right | centre
    windowDim: 1,              // opacity of windows that aren't in front
    // Programming
    cueFadeMs: 800,            // default fade when recording a cue
    askCueDetails: true,       // ask for name, fade and follow when saving a cue
    paletteFadeMs: 300,
    commandFadeMs: 300,        // fade for levels typed in the command line
    chaseBpm: 120,             // speed of new chases
    confirmUnpatch: true,
    clearMode: "cue",          // Clear programmer: cue (back to the live cue) | dark (everything to 0)
    clearFadeMs: 1000,
    // Tracking
    recordMode: "track",       // track (store only changes, like Eos) | block (store the whole look)
    trackMode: "track",        // re-recording a cue: track (changes carry on) | cueonly (later cues stay as they were)
    // Move in black
    mib: true,
    mibDelayMs: 1000,          // wait after a cue finishes
    mibTimeMs: 2000,           // how long the moves take
    mibPosition: true,
    mibColour: true,
    mibBeam: true,             // gobo, zoom, focus, prism, iris…
    mibOther: true,            // anything else that isn't intensity
    mibLog: true,              // a line in the log when it happens
    // Point & shoot
    aimHeight: "face",         // floor | knee | waist | face | head | custom
    aimHeightCustom: 1.6,
    aimSpread: "spot",         // spot (all on one point) | spaced (keep their spacing)
    aimFadeMs: 400,
    vizAim: true,              // clicking the visualiser in aim mode moves lights
    // Cue List window
    clBigGo: false,
    clShowEffect: true,
    clShowMode: true,          // T / B marks
    clDoubleClick: "edit",     // edit | go
    clConfirmDelete: true,
    // Magic sheet
    msLevels: true,
    msNumbers: true,
    msGlow: true,
    // Command line
    cmdPreview: true,
    cmdHistory: 200,
    // Keyboard
    goKey: "space",            // space | shift | off
    backKey: "off",            // off | left | backspace
    typeToCommand: true,       // typing anywhere goes to the command line
    pageKeys: true,            // Cmd/Ctrl+number switches page
    // Show
    autosaveMin: 2,            // 0 = off
    autosaveCopies: 1,
    autosaveTo: "show",        // show (into the show file you have open) | separate (its own Autosave.json)
    confirmQuit: true
  };
  const ACCENTS = {
    teal: ["#19d6a3", "#54f2c8"],
    blue: ["#3d9bff", "#8cc4ff"],
    amber: ["#ffad1f", "#ffd27a"],
    magenta: ["#e24fd0", "#f59ae4"],
    red: ["#ff4f62", "#ff98a3"],
    green: ["#5ad34f", "#a2f09a"],
    violet: ["#9b7bff", "#c7b6ff"],
    white: ["#cfd8d6", "#ffffff"]
  };

  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || "{}") || {}) }; } catch (_) {}
  const listeners = new Set();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) {} };

  const get = key => prefs[key];
  function set(key, value) {
    if (prefs[key] === value) return;
    prefs[key] = value;
    save();
    apply();
    for (const fn of listeners) { try { fn(key, value); } catch (_) {} }
  }

  // ------------------------------------------------------------ apply

  const hexRgb = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    const n = m ? parseInt(m[1], 16) : 0x19d6a3;
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const lighter = hex => "#" + hexRgb(hex).map(c => Math.round(c + (255 - c) * 0.45).toString(16).padStart(2, "0")).join("");

  function apply() {
    const root = document.documentElement, d = root.dataset;
    d.density = prefs.density === "comfortable" ? "comfortable" : "compact";
    d.sidebar = prefs.sidebar === "labels" ? "labels" : "icons";
    d.theme = prefs.theme;
    d.text = prefs.textSize;
    d.corners = prefs.corners;
    d.motion = prefs.motion ? "on" : "off";
    d.panelLabels = prefs.panelLabels ? "on" : "off";
    d.fixtureDetail = prefs.fixtureDetail ? "on" : "off";
    d.cueDetail = prefs.cueDetail ? "on" : "off";
    d.topStatus = prefs.topStatus ? "on" : "off";
    d.topSafety = prefs.topSafety ? "on" : "off";
    d.topLicence = prefs.topLicence ? "on" : "off";
    d.cueColumns = prefs.cueColumns ? "on" : "off";
    d.ticker = prefs.ticker ? "on" : "off";
    d.remote = prefs.remoteButton ? "on" : "off";
    d.msLevels = prefs.msLevels ? "on" : "off";
    d.msNumbers = prefs.msNumbers ? "on" : "off";
    d.msGlow = prefs.msGlow ? "on" : "off";
    d.cmdPreview = prefs.cmdPreview ? "on" : "off";

    const [accent, accent2] = prefs.accent === "custom" ? [prefs.accentCustom, lighter(prefs.accentCustom)] : ACCENTS[prefs.accent] || ACCENTS.teal;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-2", accent2);
    root.style.setProperty("--accent-rgb", hexRgb(accent).join(", "));
    root.style.setProperty("--sidebar-open", `${Number(prefs.sidebarWidth) || 214}px`);
    if (Number(prefs.bottomHeight) > 0) root.style.setProperty("--bottom-h", `${Number(prefs.bottomHeight)}px`);
    else root.style.removeProperty("--bottom-h");
    root.style.setProperty("--window-dim", String(Number(prefs.windowDim) || 1));

    try { window.LXZoom?.set(Number(prefs.zoom) || 1); } catch (_) {}
    try { window.LXApp?.setConfirmQuit(Boolean(prefs.confirmQuit)); } catch (_) {}
    window.LXWindows?.refreshDock("log");
    clockTick();
    scheduleAutosave();
  }

  // ------------------------------------------------------------- clock

  let clockEl = null, clockTimer = null;
  function clockTick() {
    if (prefs.clock === "off") { clockEl?.remove(); clockEl = null; clearInterval(clockTimer); clockTimer = null; return; }
    const status = document.querySelector(".topbar-status");
    if (!status) return;
    if (!clockEl) {
      clockEl = document.createElement("div");
      clockEl.className = "top-clock";
      status.appendChild(clockEl);
    }
    if (!clockTimer) clockTimer = setInterval(clockTick, 1000);
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: prefs.clock === "12" });
  }

  // --------------------------------------------------------- autosave

  let autosaveTimer = null, lastSaved = "", lastAt = null;
  const AUTOSAVE_FILE = "Autosave.json";

  function scheduleAutosave() {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
    const minutes = Number(prefs.autosaveMin) || 0;
    if (minutes > 0) autosaveTimer = setInterval(autosave, minutes * 60000);
  }

  // Where autosave writes:
  //   "show"     → into the show file you have open (Save, Open, Save As set
  //                it). A show that's never been saved goes to
  //                Backups/Unsaved Show.json until you save it.
  //   "separate" → its own Autosave.json, leaving your show file alone.
  // Older copies (Autosave copies) are kept in the Backups folder, which
  // isn't listed with your shows.
  function autosaveTarget() {
    const current = window.LXShowCommands?.current?.();
    if (prefs.autosaveTo !== "separate" && current) return { path: current, base: window.LXShowCommands.name() };
    if (prefs.autosaveTo !== "separate") return { path: "Backups/Unsaved Show.json", base: "Unsaved Show", unsaved: true };
    return { path: AUTOSAVE_FILE, base: "Autosave" };
  }

  async function autosave() {
    const files = window.LXShowFiles, show = window.LXShowCommands;
    if (!files?.save || !show?.snapshot) return null;
    const state = window.State || {};
    if (!state.fixtures?.length && !state.cues?.length) return null; // nothing to keep yet
    const snap = show.snapshot();
    const text = JSON.stringify({ ...snap, savedAt: undefined });
    if (text === lastSaved) return null;
    try {
      const target = autosaveTarget();
      const result = await files.save(target.path, snap);
      const copies = Number(prefs.autosaveCopies) || 1;
      if (copies > 1) {
        let n = 0;
        try { n = Number(localStorage.getItem("lx-autosave-slot")) || 0; } catch (_) {}
        await files.save(`Backups/${target.base} autosave ${(n % copies) + 1}.json`, snap);
        try { localStorage.setItem("lx-autosave-slot", String(n + 1)); } catch (_) {}
      }
      lastSaved = text;
      lastAt = new Date();
      renderAutosave(result?.path);
      return result;
    } catch (error) {
      window.log?.(`Autosave failed: ${error.message}`, "warn");
      return null;
    }
  }

  function renderAutosave(path) {
    const el = document.getElementById("prefAutosaveStatus");
    if (!el) return;
    const target = autosaveTarget();
    const where = target.unsaved ? "This show hasn't been saved yet, so it's kept in Backups/Unsaved Show.json until you save it (⌘S)." : prefs.autosaveTo === "separate" ? `Saves to ${AUTOSAVE_FILE} in your shows folder, leaving your show file alone.` : `Saves into “${target.base}”, the show you have open.`;
    const reopen = document.getElementById("prefAutosaveLoad");
    if (reopen) reopen.hidden = !target.unsaved && prefs.autosaveTo !== "separate"; // it *is* the open show
    if (!(Number(prefs.autosaveMin) > 0)) el.textContent = "Autosave is off.";
    else if (lastAt) el.textContent = `Last autosaved at ${lastAt.toLocaleTimeString()}${path ? ` to ${path}` : ""}. ${where}`;
    else el.textContent = `${where} It saves whenever something has changed.`;
  }

  apply();
  // Just opened or saved: that file already matches, so don't rewrite it.
  window.addEventListener("lx-show-file", () => {
    try { lastSaved = JSON.stringify({ ...window.LXShowCommands.snapshot(), savedAt: undefined }); } catch (_) { lastSaved = ""; }
    renderAutosave();
  });

  // ------------------------------------------------------------ panels

  const esc = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isMac = /Mac/.test(navigator.platform);
  const cmdKey = isMac ? "⌘" : "Ctrl";

  function panel(tab, id, title, meta, html) {
    const section = document.createElement("section");
    section.className = "panel lx-pref-panel";
    section.id = id;
    section.dataset.prefsTab = tab;
    section.innerHTML = `<div class="panel-header"><div><span class="eyebrow">${esc(meta)}</span> ${esc(title)}</div></div><div class="panel-body">${html}</div>`;
    return section;
  }

  const row = (label, help, control) => `<div class="lx-pref-row"><div><b>${label}</b>${help ? `<small>${help}</small>` : ""}</div><div class="lx-pref-control">${control}</div></div>`;
  const seg = (key, options) => `<div class="lx-seg" data-pref="${key}">${options.map(([value, label]) => `<button type="button" data-value="${esc(value)}">${esc(label)}</button>`).join("")}</div>`;
  const check = key => `<label class="lx-switch"><input type="checkbox" data-pref="${key}"><span></span></label>`;
  const select = (key, options) => `<select class="lx-select" data-pref="${key}">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
  const number = (key, min, max, step, unit, scale) => `<input class="lx-num" type="number" min="${min}" max="${max}" step="${step}" data-pref="${key}"${scale ? ` data-scale="${scale}"` : ""}>${unit ? ` <span class="lx-unit">${unit}</span>` : ""}`;
  const slider = (key, min, max, step, unit) => `<input class="lx-range" type="range" min="${min}" max="${max}" step="${step}" data-pref="${key}"><span class="lx-unit lx-range-val" data-for="${key}" data-unit="${unit}"></span>`;
  const onOff = key => seg(key, [["true", "On"], ["false", "Off"]]);

  function buildPanels() {
    const host = document.querySelector("#page-settings .page-grid") || document.getElementById("page-settings");
    if (!host || document.getElementById("prefLook")) return Boolean(host);

    // ---- Appearance
    host.appendChild(panel("interface", "prefLook", "Look", "APPEARANCE",
      row("Density", "Compact fits more on screen, like Eos. Comfortable is roomier.", seg("density", [["compact", "Compact"], ["comfortable", "Comfortable"]])) +
      row("Interface size", "Makes everything bigger or smaller.", select("zoom", [[0.75, "75%"], [0.8, "80%"], [0.9, "90%"], [1, "100%"], [1.1, "110%"], [1.25, "125%"], [1.4, "140%"], [1.5, "150%"]])) +
      row("Background", "Black is darkest, for a dark auditorium. Slate is lighter, for daylight.", seg("theme", [["black", "Black"], ["dark", "Dark"], ["slate", "Slate"]])) +
      row("Accent colour", "Used for selections, buttons and highlights. The last swatch picks any colour.", `<div class="lx-swatches" data-pref="accent">${Object.entries(ACCENTS).map(([name, [c]]) => `<button type="button" data-value="${name}" title="${name}" style="--c:${c}"></button>`).join("")}<button type="button" data-value="custom" title="Your own colour" class="lx-swatch-custom" style="--c:${esc(prefs.accentCustom)}"></button></div><input type="color" class="lx-color" data-pref="accentCustom" title="Pick your own accent colour">`) +
      row("Text size", "Size of names in lists: fixtures, groups, cues, effects and chases.", seg("textSize", [["small", "Small"], ["normal", "Normal"], ["large", "Large"]])) +
      row("Corners", "Rounded, or square like a hardware desk.", seg("corners", [["rounded", "Rounded"], ["square", "Square"]])) +
      row("Animations", "Fades and slides when things change. Off makes the interface snap instantly.", onOff("motion"))));

    host.appendChild(panel("interface", "prefDetail", "Detail", "APPEARANCE",
      row("Panel labels", "The small numbers and captions in panel headers (01, SELECT, LIVE ENGINE…).", onOff("panelLabels")) +
      row("Fixture details", "Universe, address, level and output beside each fixture in the list.", onOff("fixtureDetail")) +
      row("Cue details", "Fade and follow times beside each cue.", onOff("cueDetail"))));

    host.appendChild(panel("interface", "prefMagic", "Magic Sheet", "APPEARANCE",
      row("Levels", "The intensity under each light (FL, 50, --).", onOff("msLevels")) +
      row("Channel numbers", "The number above each light.", onOff("msNumbers")) +
      row("Glow", "The soft glow round lights that are on.", onOff("msGlow"))));

    // ---- Layout
    host.appendChild(panel("layout", "prefSidebar", "Sidebar", "LAYOUT",
      row("Sidebar", "Icons only (hover to see names), or always show the page names.", seg("sidebar", [["icons", "Icons"], ["labels", "Icons and names"]])) +
      row("Width when open", "How wide the sidebar is when it shows page names.", slider("sidebarWidth", 150, 280, 2, "px"))));

    host.appendChild(panel("layout", "prefTop", "Top Bar", "LAYOUT",
      row("Clock", "Time of day in the top bar.", seg("clock", [["off", "Off"], ["24", "24-hour"], ["12", "12-hour"]])) +
      row("Status lights", "Art-Net, QLab and MIDI connection lights.", onOff("topStatus")) +
      row("WHITE and BLACKOUT buttons", "Hide them if you don't want them pressed by accident. The commands still work.", onOff("topSafety")) +
      row("Licence buttons", "LICENSE and PRO.", onOff("topLicence"))));

    host.appendChild(panel("layout", "prefBottom", "Bottom Bar", "LAYOUT",
      row("Console log", "In the bottom bar, or only in its own window.", seg("logDocked", [["false", "Window only"], ["true", "Bottom bar"]])) +
      row("Cue stack", "Cues in columns across the bar, or one long list.", seg("cueColumns", [["true", "Columns"], ["false", "List"]])) +
      row("Height", "Height of the bottom bar. Automatic suits the density.", `${slider("bottomHeight", 0, 360, 4, "px")}`) +
      row("Latest log line", "Show the last message at the end of the command line.", onOff("ticker")) +
      row("Remote button", "The 📱 Remote button in the corner.", onOff("remoteButton"))));

    host.appendChild(panel("layout", "prefWindows", "Windows", "LAYOUT",
      row("Snap to a grid", "Windows line up neatly when you move or resize them.", seg("windowSnap", [["0", "Off"], ["8", "8 px"], ["16", "16 px"], ["32", "32 px"]])) +
      row("New windows open", "Where a window appears the first time.", seg("windowOpen", [["right", "At the right"], ["centre", "In the middle"]])) +
      row("Windows behind", "Fade windows that aren't in front, so the one you're using stands out.", seg("windowDim", [["1", "Off"], ["0.85", "A little"], ["0.65", "A lot"]])) +
      `<div class="lx-pref-note">Open windows from <b>▤ Windows</b> in the top bar. Make your own page of windows with <b>＋</b> at the bottom of the sidebar.</div>
       <div class="action-row"><button type="button" class="btn-secondary" id="prefResetWindows">Reset window positions</button></div>`));

    // ---- Programming
    host.appendChild(panel("programming", "prefCues", "Cues", "PROGRAMMING",
      row("Default fade", "Fade time for new cues.", number("cueFadeMs", 0, 600, 0.1, "s", 1000)) +
      row("Ask when saving a cue", "Ask for a name, fade and follow time when you press Save. Off: saves straight away with the default fade.", check("askCueDetails")) +
      row("Palette fade", "How long applying a palette takes.", number("paletteFadeMs", 0, 30, 0.1, "s", 1000)) +
      row("Command line fade", "How long a level typed in the command line takes, unless you add time (e.g. 1 thru 5 @ 50 time 3).", number("commandFadeMs", 0, 30, 0.1, "s", 1000))));

    host.appendChild(panel("programming", "prefClear", "Clear Programmer", "PROGRAMMING",
      row("Clear goes to", "The live cue: everything you set by hand is dropped and the lights go back to what the cue says. Everything to 0: the old blank slate.", seg("clearMode", [["cue", "The live cue"], ["dark", "Everything to 0"]])) +
      row("Fade back", "How long the lights take to go back to the cue.", number("clearFadeMs", 0, 30, 0.1, "s", 1000)) +
      `<div class="lx-pref-note">⨯ Clear in the cue stack, ⨯ Clear programmer in the Cue List, the Light Spark menu, or type <b>clear programmer</b>. Captured targets stay captured — release them to move them.</div>`));

    host.appendChild(panel("programming", "prefTracking", "Tracking", "PROGRAMMING",
      row("New cues", "Tracked cues store only what changed — everything else carries on from the cues before, like Eos. Block cues store the whole look.", seg("recordMode", [["track", "Tracked"], ["block", "Whole look (block)"]])) +
      row("Re-recording a cue", "Track: your changes carry on into the next cues until something moves them. Cue only: the next cues keep looking exactly as they did.", seg("trackMode", [["track", "Track"], ["cueonly", "Cue only"]])) +
      `<div class="lx-pref-note">Make any cue a block from the Cue List's right-click menu, or type <b>block cue 5</b>. Cues from older shows are blocks and work as before.</div>`));

    host.appendChild(panel("programming", "prefMib", "Move in Black", "PROGRAMMING",
      row("Move in black", "When a cue has finished, lights that are off and come on in the next cue get their position, colour and beam set while they're dark.", onOff("mib")) +
      row("Wait after a cue", "How long after a cue finishes before lights start moving.", number("mibDelayMs", 0, 60, 0.1, "s", 1000)) +
      row("Move time", "How long the moves take. Slower is quieter for noisy moving heads.", number("mibTimeMs", 0, 60, 0.1, "s", 1000)) +
      row("Position", "Pan and tilt.", check("mibPosition")) +
      row("Colour", "Colour mixing, colour wheel and CTO.", check("mibColour")) +
      row("Beam", "Gobos, prism, zoom, focus, iris and frost.", check("mibBeam")) +
      row("Everything else", "Any other attribute that isn't intensity, strobe, smoke or a built-in programme.", check("mibOther")) +
      row("Note it in the log", "A line in the console log each time lights move in black.", check("mibLog")) +
      `<div class="lx-pref-note">Turn it off for one cue from the Cue List's right-click menu. Nothing moves in Blind, and lights that are on are never touched.</div>`));

    host.appendChild(panel("programming", "prefFocus", "Point & Shoot", "PROGRAMMING",
      row("Aim at", "How high above the stage the beams meet — face height lights a person, the floor makes a pool.", select("aimHeight", [["floor", "The floor"], ["knee", "Knee height (0.5 m)"], ["waist", "Waist height (1 m)"], ["face", "Face height (1.6 m)"], ["head", "Above heads (1.8 m)"], ["custom", "Custom height"]])) +
      row("Custom height", "Used when Aim at is Custom height.", number("aimHeightCustom", 0, 10, 0.1, "m")) +
      row("Several heads", "All on one spot, or keep their spacing and move together.", seg("aimSpread", [["spot", "One spot"], ["spaced", "Keep spacing"]])) +
      row("Move time", "How long a click takes to move the lights. Dragging is always instant.", number("aimFadeMs", 0, 10, 0.1, "s", 1000)) +
      row("Aim from the 3D visualiser", "In the visualiser, press 🎯 Point & shoot (or P) and click the stage.", check("vizAim"))));

    host.appendChild(panel("programming", "prefCueList", "Cue List", "PROGRAMMING",
      row("Big GO button", "A larger GO and BACK for running a show.", check("clBigGo")) +
      row("Effect column", "Show which effect each cue starts.", check("clShowEffect")) +
      row("T / B marks", "Show whether each cue is tracked or a block.", check("clShowMode")) +
      row("Double-click a cue", "Edit the name or time you clicked, or go to the cue.", seg("clDoubleClick", [["edit", "Edit"], ["go", "Go to it"]])) +
      row("Confirm before deleting", "Ask before a cue is deleted from the right-click menu.", check("clConfirmDelete"))));

    host.appendChild(panel("programming", "prefStart", "Chases", "PROGRAMMING",
      row("New chase speed", "How fast new chases step, in beats per minute (one step a beat). 60 BPM is a step a second; 600 is ten a second. Change a running chase on the Chases page or tap the tempo.", number("chaseBpm", 6, 1200, 1, "BPM"))));

    host.appendChild(panel("programming", "prefPatch", "Patch", "PROGRAMMING",
      row("Confirm before unpatching", "Ask before removing fixtures from the patch.", check("confirmUnpatch"))));

    // ---- Keyboard
    host.appendChild(panel("keyboard", "prefKeyboard", "Keys", "KEYBOARD",
      row("GO key", "Fires the next cue. Ignored while you're typing in a box.", seg("goKey", [["space", "Space"], ["shift", "Shift"], ["off", "None"]])) +
      row("Back key", "Goes back a cue.", seg("backKey", [["off", "None"], ["left", "← Left arrow"], ["backspace", "Backspace"]])) +
      row("Type to command line", "Start typing anywhere and it goes into the command line, like Eos.", check("typeToCommand")) +
      row("Page shortcuts", `${cmdKey}+1, 2, 3… go to the pages in the sidebar, in order.`, check("pageKeys"))));

    host.appendChild(panel("keyboard", "prefCmd", "Command Line", "KEYBOARD",
      row("Preview", "Say what a command will do as you type it.", check("cmdPreview")) +
      row("History", "How many earlier commands ↑ remembers.", select("cmdHistory", [[50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1000"]]))));

    host.appendChild(panel("keyboard", "prefKeys", "Shortcuts", "KEYBOARD",
      `<div class="lx-keys">
        <kbd>${cmdKey} ,</kbd><span>Preferences</span>
        <kbd>${cmdKey} S</kbd><span>Save show</span>
        <kbd>${cmdKey} O</kbd><span>Open show</span>
        <kbd>${cmdKey} 1–9</kbd><span>Go to a page (your own pages too)</span>
        <kbd>Space</kbd><span>GO (see GO key)</span>
        <kbd>Enter</kbd><span>Run what's typed in the command line</span>
        <kbd>↑ ↓</kbd><span>Earlier commands (in an empty command line)</span>
        <kbd>${cmdKey} Z</kbd><span>Undo a level change (${cmdKey} ⇧ Z to redo)</span>
        <kbd>Esc</kbd><span>Close Preferences or a menu</span>
        <kbd>${cmdKey} Q</kbd><span>Quit Light Spark</span>
      </div>`));

    // ---- Show
    host.appendChild(panel("show", "prefShow", "Show File", "SHOW",
      row("Autosave", "Keeps a copy of the show in case Light Spark or the computer crashes.", select("autosaveMin", [[0, "Off"], [1, "Every minute"], [2, "Every 2 minutes"], [5, "Every 5 minutes"], [10, "Every 10 minutes"]])) +
      row("Autosave into", "The show you have open, so there's only ever one file for a show. Or its own Autosave file, so your show only changes when you press Save.", seg("autosaveTo", [["show", "The open show"], ["separate", "A separate Autosave file"]])) +
      row("Autosave copies", "Keep older autosaves too, in the Backups folder, so you can go back further.", select("autosaveCopies", [[1, "Latest only"], [3, "Latest + 3 older"], [5, "Latest + 5 older"], [10, "Latest + 10 older"]])) +
      `<div class="lx-pref-note" id="prefAutosaveStatus"></div>
       <div class="action-row"><button type="button" class="btn-secondary" id="prefAutosaveNow">Autosave now</button><button type="button" class="btn-secondary" id="prefAutosaveLoad">Open the autosave</button></div>
       <div class="section-divider"><span>SHOW FILE</span></div>
       <div class="action-row lx-showfile-row"></div>`));

    host.appendChild(panel("show", "prefQuit", "Quitting", "SHOW",
      row("Ask before quitting", "Light Spark asks before it closes, so a stray ⌘Q can't stop the lights mid-show.", check("confirmQuit"))));

    host.appendChild(panel("show", "prefFile", "These Preferences", "SHOW",
      `<div class="lx-pref-note" style="margin-top:0">Copy your preferences to another computer, or start again.</div>
       <div class="action-row"><button type="button" class="btn-secondary" id="prefExport">Export preferences…</button><button type="button" class="btn-secondary" id="prefImport">Import preferences…</button><button type="button" class="btn-danger-soft" id="prefReset">Reset all to defaults</button><input type="file" id="prefImportFile" accept=".json" hidden></div>`));

    // The show file buttons used to sit under Art-Net; they belong here.
    const saveBtn = document.getElementById("btnSaveShow"), load = document.getElementById("btnLoadShow");
    const slot = document.querySelector("#prefShow .lx-showfile-row");
    if (saveBtn && load && slot) {
      const oldRow = saveBtn.closest(".action-row");
      const divider = oldRow?.previousElementSibling;
      slot.append(saveBtn, load);
      const input = document.getElementById("showFileInput");
      if (input) slot.appendChild(input);
      if (divider?.classList.contains("section-divider")) divider.remove();
      if (oldRow && !oldRow.children.length) oldRow.remove();
    }

    wire(host);
    sync();
    return true;
  }

  // Values come out of the controls as strings: give them back their type.
  function typed(key, raw) {
    const def = DEFAULTS[key];
    if (typeof def === "boolean") return raw === true || raw === "true";
    if (typeof def === "number") return Number(raw);
    return String(raw);
  }

  // Listeners go on the panels themselves: they move into the window.
  function wire(host) {
    const onClick = e => {
      const button = e.target.closest(".lx-seg button, .lx-swatches button");
      if (!button) return;
      const key = button.parentElement.dataset.pref;
      set(key, typed(key, button.dataset.value));
      sync();
    };
    const onInput = e => {
      const input = e.target.closest("[data-pref]");
      if (!input || input.classList.contains("lx-seg") || input.classList.contains("lx-swatches")) return;
      if (e.type === "input" && !input.matches(".lx-range, .lx-color")) return; // sliders and the colour picker update live
      const key = input.dataset.pref;
      if (input.type === "checkbox") set(key, input.checked);
      else if (input.dataset.scale) set(key, Math.max(0, Math.round(Number(input.value) * Number(input.dataset.scale)) || 0));
      else set(key, typed(key, input.value));
      if (key === "accentCustom") set("accent", "custom");
      sync();
    };
    host.querySelectorAll(".lx-pref-panel").forEach(p => {
      p.addEventListener("click", onClick);
      p.addEventListener("change", onInput);
      p.addEventListener("input", onInput);
    });
    const $ = id => document.getElementById(id);
    $("prefResetWindows")?.addEventListener("click", () => {
      for (const id of window.LXWindows?.list() || []) if (id !== "prefs" && !window.LXWindows.hostOf(id)) window.LXWindows.close(id);
      try { localStorage.removeItem("lx-windows"); } catch (_) {}
      window.log?.("Window positions reset", "ok");
    });
    $("prefAutosaveNow")?.addEventListener("click", async () => {
      lastSaved = "";
      const result = await autosave();
      if (!result) window.log?.("Nothing to autosave yet — patch some fixtures or record a cue first", "warn");
      else window.log?.(`Autosaved to ${result.path}`, "ok");
    });
    $("prefAutosaveLoad")?.addEventListener("click", async () => {
      const go = await window.LXAsk?.("Open the autosave", [], { ok: "Open it", message: "Anything not saved in the current show will be replaced." });
      if (!go) return;
      try { await window.LXShowCommands.loadShow(autosaveTarget().path); } catch (error) { window.log?.(`Couldn't open the autosave: ${error.message}`, "warn"); }
    });
    $("prefExport")?.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ lightSparkPreferences: 1, prefs }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "Light Spark Preferences.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("prefImport")?.addEventListener("click", () => $("prefImportFile")?.click());
    $("prefImportFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const incoming = data?.prefs || data;
        let n = 0;
        for (const key of Object.keys(DEFAULTS)) if (key in incoming) { prefs[key] = typed(key, incoming[key]); n++; }
        save(); apply(); sync();
        window.log?.(`Imported ${n} preferences`, "ok");
      } catch (error) {
        window.log?.(`That isn't a preferences file: ${error.message}`, "warn");
      }
    });
    $("prefReset")?.addEventListener("click", async () => {
      const sure = await window.LXAsk?.("Reset all preferences?", [], { ok: "Reset", message: "Every option goes back to how Light Spark came. Your show, patch and outputs aren't touched." });
      if (!sure) return;
      prefs = { ...DEFAULTS };
      save(); apply(); sync();
      window.log?.("Preferences reset to defaults", "ok");
    });
  }

  // Show the current values in the controls.
  function sync() {
    document.querySelectorAll(".lx-seg[data-pref], .lx-swatches[data-pref]").forEach(group => {
      const value = String(prefs[group.dataset.pref]);
      group.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.value === value));
    });
    document.querySelectorAll("input[data-pref], select[data-pref]").forEach(input => {
      const value = prefs[input.dataset.pref];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else if (input.dataset.scale) { if (document.activeElement !== input) input.value = String(Number(value) / Number(input.dataset.scale)); }
      else input.value = String(value);
    });
    document.querySelectorAll(".lx-range-val").forEach(el => {
      const v = Number(prefs[el.dataset.for]);
      el.textContent = el.dataset.for === "bottomHeight" && !v ? "Auto" : `${v}${el.dataset.unit}`;
    });
    document.querySelector(".lx-swatch-custom")?.style.setProperty("--c", prefs.accentCustom);
    renderAutosave();
  }

  // ------------------------------------------------------------ keyboard

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    const typing = e.target.closest?.("input, select, textarea, [contenteditable='true'], .lx-ask-back");
    if (mod && e.key === ",") { e.preventDefault(); openPrefs(); return; }
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && prefs.pageKeys) {
      const page = document.querySelectorAll(".nav-link[data-page]")[Number(e.key) - 1];
      if (page) { e.preventDefault(); page.click(); }
      return;
    }
    if (e.key === "Escape" && window.LXWindows?.isOpen("prefs") && !e.target.closest?.("input[type=text], input[type=number], input:not([type]), select, textarea, .lx-ask-back")) {
      window.LXWindows.close("prefs");
      return;
    }
    // Type anywhere → command line (letters, digits and the usual command symbols).
    if (prefs.typeToCommand && !typing && !mod && !e.altKey && e.key.length === 1 && e.key !== " " && /[\w@+\-.*/>]/.test(e.key)) {
      const input = document.getElementById("cmdInput");
      if (input) input.focus(); // the key itself then lands in the box
    }
  }

  // ------------------------------------------------------------ window

  function injectStyles() {
    if (document.getElementById("lxPrefStyles")) return;
    const style = document.createElement("style");
    style.id = "lxPrefStyles";
    style.textContent = `
      .lx-pref-row{display:grid;grid-template-columns:minmax(190px,1fr) auto;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid #161f24}
      .lx-pref-row:last-child{border-bottom:0}
      .lx-pref-row b{display:block;color:#dfe8e5;font-size:12px;font-weight:650}
      .lx-pref-row small{display:block;margin-top:3px;color:#71807d;font-size:10.5px;line-height:1.45}
      .lx-pref-control{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .lx-seg{display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
      .lx-seg button{height:26px;padding:0 10px;border:0;background:#0d1418;color:#8c9a97;font-size:11px;cursor:pointer;white-space:nowrap}
      .lx-seg button + button{border-left:1px solid var(--border)}
      .lx-seg button.on{background:var(--accent-soft);color:var(--accent-2);font-weight:700}
      .lx-select,.lx-num{height:28px;padding:0 8px;background:#0d1418;border:1px solid var(--border);border-radius:6px;color:#e3ebe9;font-size:12px}
      .lx-num{width:76px;text-align:right;font-family:var(--mono)}
      .lx-unit{color:#71807d;font-size:11px}
      .lx-range{width:150px;accent-color:var(--accent)}
      .lx-range-val{min-width:44px;text-align:right;font-family:var(--mono)}
      .lx-swatches{display:flex;gap:5px}
      .lx-swatches button{width:20px;height:20px;border-radius:50%;border:2px solid transparent;background:var(--c);cursor:pointer;box-shadow:inset 0 0 0 2px #0c1215}
      .lx-swatches button.on{border-color:#e6eeec}
      .lx-swatches .lx-swatch-custom{background:conic-gradient(from 0deg,#f44,#fd4,#4f6,#4df,#64f,#f4d,#f44);box-shadow:inset 0 0 0 5px #0c1215,inset 0 0 0 20px var(--c)}
      .lx-color{width:26px;height:22px;padding:0;border:1px solid var(--border);border-radius:4px;background:none;cursor:pointer}
      .lx-switch{position:relative;display:inline-block;width:34px;height:19px;cursor:pointer}
      .lx-switch input{position:absolute;opacity:0;width:0!important;height:0!important}
      .lx-switch span{position:absolute;inset:0;border-radius:99px;background:#1c272d;transition:background .15s}
      .lx-switch span::after{content:"";position:absolute;left:3px;top:3px;width:13px;height:13px;border-radius:50%;background:#8c9a97;transition:transform .15s,background .15s}
      .lx-switch input:checked + span{background:var(--accent-line)}
      .lx-switch input:checked + span::after{transform:translateX(15px);background:var(--accent-2)}
      .lx-pref-note{color:#7d8b88;font-size:11px;line-height:1.55;margin-top:8px}
      .lx-pref-panel .section-divider{margin:16px 0 12px}
      .lx-keys{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;font-size:11px;color:#9aa7a4}
      .lx-keys kbd{justify-self:start;padding:2px 7px;border:1px solid var(--border-strong);border-radius:4px;background:#0d1418;color:#dfe8e5;font-family:var(--mono);font-size:10px}
      .lxw[data-win="prefs"] .lxw-body{overflow:hidden}
    `;
    document.head.appendChild(style);
  }

  function openPrefs(tab) {
    if (!buildPanels()) return false;
    const shown = window.LXWindows?.open("prefs");
    if (tab) window.SettingsTabs?.select(tab);
    sync();
    return shown;
  }

  function registerWindow() {
    if (!window.LXWindows || !window.SettingsTabs?.box()) return false;
    window.LXWindows.register({
      id: "prefs", title: "Preferences", menu: false, noRestore: true, center: true, w: 980, h: 660,
      build: body => { body.appendChild(window.SettingsTabs.box()); sync(); },
      onClose: () => { const box = window.SettingsTabs.box(); document.getElementById("page-settings")?.prepend(box); }
    });
    return true;
  }

  // Preferences lives in the Light Spark menu now, not the sidebar.
  function removeNav() {
    const old = document.querySelector('.nav-link[data-page="settings"]');
    if (!old) return true;
    if (old.classList.contains("active")) document.querySelector('.nav-link[data-page="live"]')?.click();
    old.remove();
    return true;
  }

  function boot() {
    injectStyles();
    if (!buildPanels() || !registerWindow() || !removeNav()) return setTimeout(boot, 300);
    document.addEventListener("keydown", onKey);
    clockTick();
  }

  window.LXPrefs = Object.freeze({
    get, set, defaults: { ...DEFAULTS },
    on: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    open: openPrefs,
    close: () => window.LXWindows?.close("prefs"),
    autosave
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
  else boot();
})();
