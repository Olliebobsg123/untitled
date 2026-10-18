"use strict";

/*
 * Preferences: a window (Windows menu, the sidebar's Preferences button,
 * or Cmd/Ctrl+,) with tabs for Interface, Programming and Show plus the old
 * Settings page (Outputs, MIDI, QLab Connect). Options are kept in
 * localStorage "lx-preferences".
 *
 * Loaded in <head> so the layout options apply before the first paint.
 *
 *   LXPrefs.get(key)  .set(key, value)  .on(fn)  .open(tab)  .close()
 */
(function () {
  if (window.LXPrefs) return;

  const STORE = "lx-preferences";
  const DEFAULTS = {
    density: "compact",       // compact | comfortable
    zoom: 1,                  // interface size
    accent: "teal",
    sidebar: "icons",         // icons (expand on hover) | labels
    logDocked: false,         // console log in the bottom bar, or only as a window
    cueFadeMs: 800,           // default fade when recording a cue
    askCueDetails: true,      // ask for name, fade and follow when saving a cue
    confirmUnpatch: true,
    goKey: "space",           // space | shift | off
    autosaveMin: 2            // 0 = off
  };
  const ACCENTS = {
    teal: ["#19d6a3", "#54f2c8", "25, 214, 163"],
    blue: ["#3d9bff", "#8cc4ff", "61, 155, 255"],
    amber: ["#ffad1f", "#ffd27a", "255, 173, 31"],
    magenta: ["#e24fd0", "#f59ae4", "226, 79, 208"],
    red: ["#ff4f62", "#ff98a3", "255, 79, 98"],
    white: ["#cfd8d6", "#ffffff", "207, 216, 214"]
  };

  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || "{}") || {}) }; } catch (_) {}
  const listeners = new Set();

  const get = key => prefs[key];
  function set(key, value) {
    if (prefs[key] === value) return;
    prefs[key] = value;
    try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) {}
    apply();
    for (const fn of listeners) { try { fn(key, value); } catch (_) {} }
  }

  // ------------------------------------------------------------ apply

  function apply() {
    const root = document.documentElement;
    root.dataset.density = prefs.density === "comfortable" ? "comfortable" : "compact";
    root.dataset.sidebar = prefs.sidebar === "labels" ? "labels" : "icons";
    const [accent, accent2, rgb] = ACCENTS[prefs.accent] || ACCENTS.teal;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-2", accent2);
    root.style.setProperty("--accent-rgb", rgb);
    try { window.LXZoom?.set(Number(prefs.zoom) || 1); } catch (_) {}
    window.LXWindows?.refreshDock("log");
    scheduleAutosave();
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

  async function autosave() {
    const files = window.LXShowFiles, show = window.LXShowCommands;
    if (!files?.save || !show?.snapshot) return null;
    const state = window.State || {};
    if (!state.fixtures?.length && !state.cues?.length) return null; // nothing to keep yet
    const snap = show.snapshot();
    const text = JSON.stringify({ ...snap, savedAt: undefined });
    if (text === lastSaved) return null;
    try {
      const result = await files.save(AUTOSAVE_FILE, snap);
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
    if (!(Number(prefs.autosaveMin) > 0)) el.textContent = "Autosave is off.";
    else if (lastAt) el.textContent = `Last autosaved at ${lastAt.toLocaleTimeString()}${path ? ` to ${path}` : ""}.`;
    else el.textContent = `Saves to ${AUTOSAVE_FILE} in your shows folder when something has changed.`;
  }

  apply();

  // ------------------------------------------------------------ panels

  const esc = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

  function buildPanels() {
    const host = document.querySelector("#page-settings .page-grid") || document.getElementById("page-settings");
    if (!host || document.getElementById("prefInterface")) return Boolean(host);
    const isMac = navigator.platform.includes("Mac");

    host.appendChild(panel("interface", "prefInterface", "Layout", "INTERFACE",
      row("Density", "Compact fits more on screen, like Eos. Comfortable is the older, roomier look.", seg("density", [["compact", "Compact"], ["comfortable", "Comfortable"]])) +
      row("Interface size", "Makes everything bigger or smaller.", `<select class="lx-select" data-pref="zoom">${[[0.8, "80%"], [0.9, "90%"], [1, "100%"], [1.1, "110%"], [1.25, "125%"], [1.4, "140%"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`) +
      row("Accent colour", "Used for selections, buttons and highlights.", `<div class="lx-swatches" data-pref="accent">${Object.entries(ACCENTS).map(([name, [c]]) => `<button type="button" data-value="${name}" title="${name}" style="--c:${c}"></button>`).join("")}</div>`) +
      row("Sidebar", "Icons only (hover to see names), or always show the page names.", seg("sidebar", [["icons", "Icons"], ["labels", "Icons and names"]]))));

    host.appendChild(panel("interface", "prefWindows", "Windows", "INTERFACE",
      row("Console log", "In the bottom bar, or only in its own window. The latest line always shows at the end of the command line.", seg("logDocked", [["false", "Window only"], ["true", "Bottom bar"]])) +
      `<div class="lx-pref-note">Open any of these as a floating window from <b>▤ Windows</b> in the top bar: Cue Stack, Console Log, Groups, Fixtures, Control Deck, Palettes, Magic Sheet, Effects, Chases, Cue Inspector and Patched Fixtures. Drag a window by its title bar and resize it from the bottom-right corner. Windows remember where you left them.</div>
       <div class="action-row"><button type="button" class="btn-secondary" id="prefResetWindows">Reset window positions</button></div>`));

    host.appendChild(panel("programming", "prefCues", "Cues", "PROGRAMMING",
      row("Default fade", "Fade time for new cues, in seconds.", `<input class="lx-num" type="number" min="0" max="600" step="0.1" data-pref="cueFadeMs" data-scale="1000"> <span class="lx-unit">s</span>`) +
      row("Ask when saving a cue", "Ask for a name, fade and follow time when you press Save. Off: saves straight away with the default fade.", check("askCueDetails")) +
      row("GO key", "The key that fires the next cue. It's ignored while you're typing in a box.", seg("goKey", [["space", "Space"], ["shift", "Shift"], ["off", "None"]]))));

    host.appendChild(panel("programming", "prefPatch", "Patch", "PROGRAMMING",
      row("Confirm before unpatching", "Ask before removing fixtures from the patch.", check("confirmUnpatch"))));

    host.appendChild(panel("show", "prefShow", "Show File", "SHOW",
      row("Autosave", "Keeps a copy of the show in case Light Spark or the computer crashes.", `<select class="lx-select" data-pref="autosaveMin">${[[0, "Off"], [1, "Every minute"], [2, "Every 2 minutes"], [5, "Every 5 minutes"], [10, "Every 10 minutes"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`) +
      `<div class="lx-pref-note" id="prefAutosaveStatus"></div>
       <div class="action-row"><button type="button" class="btn-secondary" id="prefAutosaveNow">Autosave now</button><button type="button" class="btn-secondary" id="prefAutosaveLoad">Open the autosave</button></div>
       <div class="section-divider"><span>SHOW FILE</span></div>
       <div class="action-row lx-showfile-row"></div>`));

    host.appendChild(panel("show", "prefKeys", "Shortcuts", "SHOW",
      `<div class="lx-keys">
        <kbd>${isMac ? "⌘" : "Ctrl"} ,</kbd><span>Preferences</span>
        <kbd>Space</kbd><span>GO (change it under Programming)</span>
        <kbd>Enter</kbd><span>Run what's typed in the command line</span>
        <kbd>${isMac ? "⌘" : "Ctrl"} 1–7</kbd><span>Go to a page: Live, Patch, Cue Inspector, Chases, Effects, QLab, Magic Sheet</span>
        <kbd>Esc</kbd><span>Close Preferences</span>
      </div>`));

    // The show file buttons used to sit under Art-Net; they belong here.
    const save = document.getElementById("btnSaveShow"), load = document.getElementById("btnLoadShow");
    const slot = document.querySelector("#prefShow .lx-showfile-row");
    if (save && load && slot) {
      const oldRow = save.closest(".action-row");
      const divider = oldRow?.previousElementSibling;
      slot.append(save, load);
      const input = document.getElementById("showFileInput");
      if (input) slot.appendChild(input);
      if (divider?.classList.contains("section-divider")) divider.remove();
      if (oldRow && !oldRow.children.length) oldRow.remove();
    }

    wire(host);
    sync();
    return true;
  }

  // Listeners go on the panels themselves: they move into the window.
  function wire(host) {
    const onClick = e => {
      const button = e.target.closest(".lx-seg button, .lx-swatches button");
      if (!button) return;
      const key = button.parentElement.dataset.pref;
      let value = button.dataset.value;
      if (value === "true" || value === "false") value = value === "true";
      set(key, value);
      sync();
    };
    const onChange = e => {
      const input = e.target.closest("[data-pref]");
      if (!input || input.classList.contains("lx-seg")) return;
      const key = input.dataset.pref;
      if (input.type === "checkbox") set(key, input.checked);
      else if (input.dataset.scale) set(key, Math.max(0, Math.round(Number(input.value) * Number(input.dataset.scale)) || 0));
      else set(key, Number(input.value));
      sync();
    };
    host.querySelectorAll(".lx-pref-panel").forEach(p => {
      p.addEventListener("click", onClick);
      p.addEventListener("change", onChange);
    });
    document.getElementById("prefResetWindows")?.addEventListener("click", () => {
      for (const id of window.LXWindows?.list() || []) if (id !== "prefs") window.LXWindows.close(id);
      try { localStorage.removeItem("lx-windows"); } catch (_) {}
      window.log?.("Window positions reset", "ok");
    });
    document.getElementById("prefAutosaveNow")?.addEventListener("click", async () => {
      lastSaved = "";
      const result = await autosave();
      if (!result) window.log?.("Nothing to autosave yet — patch some fixtures or record a cue first", "warn");
      else window.log?.(`Autosaved to ${result.path}`, "ok");
    });
    document.getElementById("prefAutosaveLoad")?.addEventListener("click", async () => {
      const go = await window.LXAsk?.("Open the autosave", [], { ok: "Open it", message: "Anything not saved in the current show will be replaced." });
      if (!go) return;
      try { await window.LXShowCommands.loadShow(AUTOSAVE_FILE); } catch (error) { window.log?.(`Couldn't open the autosave: ${error.message}`, "warn"); }
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
    renderAutosave();
  }

  // ------------------------------------------------------------ window

  function injectStyles() {
    if (document.getElementById("lxPrefStyles")) return;
    const style = document.createElement("style");
    style.id = "lxPrefStyles";
    style.textContent = `
      .lx-pref-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid #161f24}
      .lx-pref-row:last-child{border-bottom:0}
      .lx-pref-row b{display:block;color:#dfe8e5;font-size:12px;font-weight:650}
      .lx-pref-row small{display:block;margin-top:3px;color:#71807d;font-size:10.5px;line-height:1.45}
      .lx-pref-control{display:flex;align-items:center;gap:6px}
      .lx-seg{display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
      .lx-seg button{height:26px;padding:0 11px;border:0;background:#0d1418;color:#8c9a97;font-size:11px;cursor:pointer}
      .lx-seg button + button{border-left:1px solid var(--border)}
      .lx-seg button.on{background:var(--accent-soft);color:var(--accent-2);font-weight:700}
      .lx-select,.lx-num{height:28px;padding:0 8px;background:#0d1418;border:1px solid var(--border);border-radius:6px;color:#e3ebe9;font-size:12px}
      .lx-num{width:76px;text-align:right;font-family:var(--mono)}
      .lx-unit{color:#71807d;font-size:11px}
      .lx-swatches{display:flex;gap:6px}
      .lx-swatches button{width:22px;height:22px;border-radius:50%;border:2px solid transparent;background:var(--c);cursor:pointer;box-shadow:inset 0 0 0 2px #0c1215}
      .lx-swatches button.on{border-color:#e6eeec}
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
      id: "prefs", title: "Preferences", menu: false, noRestore: true, center: true, w: 960, h: 640,
      build: body => { body.appendChild(window.SettingsTabs.box()); sync(); },
      onClose: () => { const box = window.SettingsTabs.box(); document.getElementById("page-settings")?.prepend(box); }
    });
    return true;
  }

  // The sidebar's Settings button opens the window instead of a page.
  function replaceNav() {
    const old = document.querySelector('.nav-link[data-page="settings"]');
    if (!old) return Boolean(document.getElementById("navPreferences"));
    const button = old.cloneNode(true); // drops the page-switching listeners
    button.removeAttribute("data-page");
    button.id = "navPreferences";
    const text = button.querySelector(".nav-text");
    if (text) text.textContent = "Preferences";
    button.querySelector("b")?.remove();
    old.replaceWith(button);
    button.addEventListener("click", e => { e.preventDefault(); openPrefs(); });
    // If Settings was the page showing, go back to Live.
    if (document.getElementById("page-settings")?.classList.contains("active")) document.querySelector('.nav-link[data-page="live"]')?.click();
    return true;
  }

  function boot() {
    injectStyles();
    if (!buildPanels() || !registerWindow() || !replaceNav()) return setTimeout(boot, 300);
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); openPrefs(); }
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const page = document.querySelectorAll(".nav-link[data-page]")[Number(e.key) - 1];
        if (page) { e.preventDefault(); page.click(); }
      }
      else if (e.key === "Escape" && window.LXWindows?.isOpen("prefs") && !e.target.closest?.("input[type=text], input[type=number], input:not([type]), select, textarea, .lx-ask-back")) window.LXWindows.close("prefs");
    });
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
