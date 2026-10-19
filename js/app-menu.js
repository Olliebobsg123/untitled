"use strict";

/*
 * The app menu. Click the Light Spark logo at the top of the sidebar for
 * About, Preferences, Save/Open Show, New Page and Quit. The menu bar
 * (main.js) runs the same actions through LXAppMenu.run().
 */
(function () {
  if (window.LXAppMenu) return;

  const NAME = "Light Spark";
  const mac = /Mac/.test(navigator.platform);
  const key = k => (mac ? `⌘${k}` : `Ctrl+${k}`);
  const click = id => document.getElementById(id)?.click();

  function about() {
    const version = window.LXApp?.version ? `Version ${window.LXApp.version}` : "";
    window.LXAsk?.(`About ${NAME}`, [], { ok: "OK", message: `${NAME} lighting console. ${version}`.trim() });
  }

  let last = { action: "", at: 0 };
  function run(action) {
    // A key press can reach both the menu bar and the page: do it once.
    if (action === last.action && Date.now() - last.at < 400) return null;
    last = { action, at: Date.now() };
    const [verb, arg] = String(action).split(":");
    switch (verb) {
      case "about": return about();
      case "prefs": return window.LXPrefs?.open();
      case "save": return window.LXShowCommands?.saveCurrent ? window.LXShowCommands.saveCurrent() : click("btnSaveShow");
      case "save-as": return window.LXShowCommands?.saveAs();
      case "open": return window.LXShowCommands?.open ? window.LXShowCommands.open() : click("btnLoadShow");
      case "autosave": return window.LXPrefs?.autosave().then(r => window.log?.(r ? `Autosaved to ${r.path}` : "Nothing new to autosave", r ? "ok" : "info"));
      case "new-page": return window.LXCustomPages?.create();
      case "page": return document.querySelector(`.nav-link[data-page="${arg}"]`)?.click();
      case "win": return window.LXWindows?.open(arg);
      case "dock": return window.LXWindows?.list().forEach(id => { if (!window.LXWindows.hostOf(id)) window.LXWindows.close(id); });
      case "viz": return window.parseCommand?.("viz");
      case "quit": return window.LXApp ? window.LXApp.quit() : window.close();
      default: return null;
    }
  }

  // ------------------------------------------------------------ dropdown

  let menu = null;

  function injectStyles() {
    if (document.getElementById("lxAppMenuStyles")) return;
    const style = document.createElement("style");
    style.id = "lxAppMenuStyles";
    style.textContent = `
      .sidebar .brand{cursor:pointer;position:relative}
      .sidebar .brand:hover .brand-mark{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
      .sidebar .brand::after{content:"▾";position:absolute;left:44px;top:50%;transform:translateY(-50%);color:#5d6b68;font-size:9px}
      body:has(.sidebar:hover) .sidebar .brand::after,html[data-sidebar="labels"] .sidebar .brand::after{display:none}
      .lx-app-menu .app-head{padding:8px 8px 6px;color:var(--text);font-size:12px;font-weight:800;letter-spacing:.3px}
      .lx-app-menu .app-head small{display:block;color:#5d6b68;font-size:9px;font-weight:600;letter-spacing:.4px;margin-top:2px}
    `;
    document.head.appendChild(style);
  }

  function items() {
    return [
      ["about", `About ${NAME}`, ""],
      ["prefs", "Preferences…", key(",")],
      "-",
      ["save", "Save Show", key("S")],
      ["save-as", "Save Show As…", key("⇧S")],
      ["open", "Open Show…", key("O")],
      ["autosave", "Autosave Now", ""],
      "-",
      ["new-page", "New Page…", ""],
      ["viz", "3D Visualiser", ""],
      "-",
      ["quit", `Quit ${NAME}`, key("Q")]
    ];
  }

  function toggle(anchor, show) {
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "lxw-menu lx-app-menu";
      menu.hidden = true;
      document.body.appendChild(menu);
      menu.addEventListener("click", e => {
        const b = e.target.closest("button[data-act]");
        if (!b) return;
        toggle(null, false);
        run(b.dataset.act);
      });
      document.addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".sidebar .brand")) toggle(null, false); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) toggle(null, false); });
    }
    const want = show ?? menu.hidden;
    menu.hidden = !want;
    if (!want) return;
    const version = window.LXApp?.version ? `VERSION ${window.LXApp.version}` : "LIGHTING CONSOLE";
    menu.innerHTML = `<div class="app-head">${NAME}<small>${version}</small></div><hr>${items().map(i => i === "-" ? "<hr>" : `<button type="button" data-act="${i[0]}"><span class="tick"></span><span>${i[1]}</span><kbd>${i[2]}</kbd></button>`).join("")}`;
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(6, r.left)}px`;
  }

  function boot() {
    const brand = document.querySelector(".sidebar .brand");
    if (!brand) return setTimeout(boot, 300);
    injectStyles();
    brand.title = `${NAME} menu`;
    brand.setAttribute("role", "button");
    brand.addEventListener("click", e => { e.stopPropagation(); toggle(brand.querySelector(".brand-mark") || brand); });
    // In the desktop app the menu bar owns ⌘S/⌘O; in a plain browser, do it here.
    document.addEventListener("keydown", e => {
      if (window.LXApp || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); run("save"); }
      else if (k === "o") { e.preventDefault(); run("open"); }
    });
  }

  window.LXAppMenu = Object.freeze({ run, open: () => toggle(document.querySelector(".sidebar .brand-mark"), true) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
