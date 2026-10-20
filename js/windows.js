"use strict";

/*
 * Floating windows that sit over whatever page is showing.
 *
 * Panel windows take an existing panel (Cue Stack, Effects, Magic Sheet…)
 * out of its page into a window and put it back when the window closes, so
 * everything in it keeps working. Other windows build their own contents
 * (Palettes, Preferences). Where each window was, its size, and which were
 * open are remembered.
 *
 *   LXWindows.open(id)  .close(id)  .toggle(id)  .isOpen(id)
 *   LXWindows.register({ id, title, panel | build, w, h, menu })
 */
(function () {
  if (window.LXWindows) return;

  const STORE = "lx-windows";
  const defs = new Map();
  const open = new Map(); // id -> { el, body, placeholder }
  let layer = null, z = 10, saved = {};

  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (_) { saved = {}; }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (_) {}
  }

  const say = (message, level) => window.log?.(message, level);
  const workspaceRect = () => document.querySelector(".workspace")?.getBoundingClientRect() || { left: 70, top: 60, width: innerWidth - 80, height: innerHeight - 120 };

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "lxWindowLayer";
    document.body.appendChild(layer);
    return layer;
  }

  // Keep a window on screen (or inside its page), with its title bar reachable.
  function clamp(rect, host) {
    if (host) {
      const W = host.el.clientWidth, H = host.el.clientHeight;
      const w = Math.max(200, Math.min(rect.w, W)), h = Math.max(120, Math.min(rect.h, H));
      const x = Math.max(0, Math.min(rect.x, W - w)), y = Math.max(0, Math.min(rect.y, H - h));
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }
    const w = Math.max(240, Math.min(rect.w, innerWidth - 8));
    const h = Math.max(140, Math.min(rect.h, innerHeight - 8));
    const x = Math.max(4 - w + 80, Math.min(rect.x, innerWidth - 80));
    const y = Math.max(4, Math.min(rect.y, innerHeight - 32));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  // Preferences → Layout → "Snap windows to a grid".
  function snap(rect, mode) {
    const step = Number(window.LXPrefs?.get("windowSnap")) || 0;
    if (!step) return rect;
    const r = v => Math.round(v / step) * step;
    return mode === "move" ? { ...rect, x: r(rect.x), y: r(rect.y) } : { ...rect, w: r(rect.w), h: r(rect.h) };
  }

  function place(el, rect) {
    Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }

  function defaultRect(def) {
    const area = workspaceRect();
    const count = open.size;
    const w = Math.min(def.w || 480, area.width - 20), h = Math.min(def.h || 400, area.height - 20);
    if (def.center || window.LXPrefs?.get("windowOpen") === "centre") return { x: area.left + (area.width - w) / 2, y: Math.max(area.top, area.top + (area.height - h) / 3), w, h };
    return { x: area.left + area.width - w - 16 - count * 24, y: area.top + 12 + count * 24, w, h };
  }

  function front(id) {
    const entry = open.get(id);
    if (!entry) return;
    entry.el.style.zIndex = String(++z);
    for (const [other, e] of open) e.el.classList.toggle("front", other === id);
  }

  function drag(handle, el, id, mode) {
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const host = open.get(id)?.host;
      if (host?.locked?.()) return;
      event.preventDefault();
      front(id);
      handle.setPointerCapture(event.pointerId);
      const start = { px: event.clientX, py: event.clientY, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const move = e => {
        const dx = e.clientX - start.px, dy = e.clientY - start.py;
        const rect = mode === "move" ? { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h } : { x: start.x, y: start.y, w: start.w + dx, h: start.h + dy };
        place(el, clamp(snap(rect, mode), host));
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        remember(id);
        window.dispatchEvent(new Event("resize")); // magic sheet etc. re-lay out
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  function remember(id) {
    const entry = open.get(id);
    if (entry?.host) { entry.host.onChange?.(id, { x: entry.el.offsetLeft, y: entry.el.offsetTop, w: entry.el.offsetWidth, h: entry.el.offsetHeight }); return; }
    saved[id] = { ...(saved[id] || {}), open: Boolean(entry) };
    if (entry) Object.assign(saved[id], { x: entry.el.offsetLeft, y: entry.el.offsetTop, w: entry.el.offsetWidth, h: entry.el.offsetHeight });
    persist();
  }

  function panelOf(def) {
    try { return typeof def.panel === "function" ? def.panel() : null; } catch (_) { return null; }
  }

  function bodyClass(def, on) {
    if (def.outClass) document.body.classList.toggle(`lxw-out-${def.outClass}`, on);
  }

  function openWindow(id, options = {}) {
    const def = defs.get(id);
    if (!def) return false;
    const host = options.host || null;
    if (open.has(id)) {
      // Moving between a page and floating: close it where it is first.
      if (open.get(id).host !== host) closeWindow(id);
      else { front(id); def.onFront?.(); return true; }
    }
    let panel = null, placeholder = null;
    if (def.panel) {
      panel = panelOf(def);
      if (!panel) return false;
      placeholder = document.createElement("div");
      placeholder.className = "lxw-placeholder";
      placeholder.dataset.for = id;
      if (def.placeholder) {
        placeholder.classList.add("show");
        placeholder.innerHTML = `<span>${def.title} is open in a window.</span><button type="button" class="btn-secondary">Put it back here</button>`;
        placeholder.querySelector("button").addEventListener("click", () => closeWindow(id));
      }
      panel.before(placeholder);
    }

    const el = document.createElement("div");
    el.className = "lxw";
    el.dataset.win = id;
    el.innerHTML = `<div class="lxw-bar"><span class="lxw-title"></span>${def.panel ? '<button type="button" class="lxw-dock" title="Put back in the page">⇲</button>' : ""}<button type="button" class="lxw-close" title="Close">×</button></div><div class="lxw-body"></div><div class="lxw-grip"></div>`;
    el.querySelector(".lxw-title").textContent = def.title;
    const body = el.querySelector(".lxw-body");
    if (host) { el.classList.add("lxw-docked"); host.el.appendChild(el); }
    else ensureLayer().appendChild(el);
    place(el, clamp(host ? (options.rect || { x: 20, y: 20, w: def.w || 480, h: def.h || 400 }) : saved[id]?.w ? saved[id] : defaultRect(def), host));
    if (panel) body.appendChild(panel);
    else def.build?.(body, el);

    open.set(id, { el, body, placeholder, panel, host });
    el.addEventListener("pointerdown", () => front(id), true);
    // Closing a window that's part of a page takes it off that page.
    const userClose = () => { host?.onRemove?.(id); closeWindow(id); };
    el.querySelector(".lxw-close").addEventListener("click", userClose);
    el.querySelector(".lxw-dock")?.addEventListener("click", userClose);
    drag(el.querySelector(".lxw-bar"), el, id, "move");
    drag(el.querySelector(".lxw-grip"), el, id, "size");
    bodyClass(def, true);
    front(id);
    if (!options.quiet && !host) remember(id);
    def.onOpen?.(body, el);
    window.dispatchEvent(new Event("resize"));
    renderMenu();
    return true;
  }

  function closeWindow(id) {
    const entry = open.get(id);
    const def = defs.get(id);
    if (!entry) return false;
    if (!entry.host) remember(id);
    if (entry.panel && entry.placeholder) entry.placeholder.replaceWith(entry.panel);
    entry.el.remove();
    open.delete(id);
    if (!entry.host) {
      saved[id] = { ...(saved[id] || {}), open: false };
      persist();
    }
    // A panel whose home is hidden (the log, when it isn't docked) stays out.
    bodyClass(def, Boolean(def.hiddenWhenDocked?.()));
    def.onClose?.();
    window.dispatchEvent(new Event("resize"));
    renderMenu();
    return true;
  }

  function register(def) {
    defs.set(def.id, def);
    if (def.outClass && def.hiddenWhenDocked?.()) bodyClass(def, true);
    renderMenu();
  }

  // ------------------------------------------------------------ menu

  let menuButton = null, menu = null;

  function renderMenu() {
    if (!menu || menu.hidden) return;
    const items = [...defs.values()].filter(d => d.menu !== false);
    menu.innerHTML = `<div class="lxw-menu-label">WINDOWS</div>${items.map(d => `<button type="button" data-win="${d.id}"><span class="tick">${open.has(d.id) ? "●" : ""}</span><span>${d.title}</span><kbd>${d.key || ""}</kbd></button>`).join("")}
      <hr><button type="button" data-act="viz"><span class="tick"></span><span>3D Visualiser</span><kbd></kbd></button>
      <button type="button" data-act="prefs"><span class="tick"></span><span>Preferences…</span><kbd>${navigator.platform.includes("Mac") ? "⌘," : "Ctrl+,"}</kbd></button>
      <hr><button type="button" data-act="dock"><span class="tick"></span><span>Put every window back</span><kbd></kbd></button>`;
  }

  function toggleMenu(show) {
    if (!menu) return;
    const want = show ?? menu.hidden;
    menu.hidden = !want;
    menuButton.classList.toggle("open", want);
    if (!want) return;
    renderMenu();
    const r = menuButton.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.min(r.left, innerWidth - 260)}px`;
  }

  function installMenu() {
    if (menuButton) return true;
    const status = document.querySelector(".topbar-status");
    if (!status) return false;
    menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "lxw-menu-btn";
    menuButton.id = "lxWindowsMenuBtn";
    menuButton.innerHTML = "▤ WINDOWS";
    status.prepend(menuButton);
    menu = document.createElement("div");
    menu.className = "lxw-menu";
    menu.hidden = true;
    document.body.appendChild(menu);
    menuButton.addEventListener("click", e => { e.stopPropagation(); toggleMenu(); });
    menu.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      toggleMenu(false);
      if (b.dataset.win) return toggle(b.dataset.win);
      if (b.dataset.act === "viz") return window.parseCommand?.("viz");
      if (b.dataset.act === "prefs") return window.LXPrefs?.open();
      if (b.dataset.act === "dock") return [...open.keys()].filter(id => !open.get(id).host).forEach(closeWindow);
    });
    document.addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuButton) toggleMenu(false); });
    return true;
  }

  function toggle(id) { return open.has(id) ? closeWindow(id) : openWindow(id); }

  // ------------------------------------------------------- log ticker

  function installTicker() {
    const line = document.querySelector(".cmd-line");
    const log = document.getElementById("termLog");
    if (!line || !log || line.querySelector(".cmd-ticker")) return Boolean(line && log);
    const ticker = document.createElement("span");
    ticker.className = "cmd-ticker";
    ticker.title = "Console log — click to open";
    line.querySelector(".cmd-hint")?.remove();
    line.appendChild(ticker);
    ticker.addEventListener("click", () => openWindow("log"));
    const update = () => {
      const last = log.lastElementChild;
      if (!last) return;
      const message = last.querySelector(".lx-log-message") || last;
      const levelText = (last.querySelector(".lx-log-level")?.textContent || "").trim().toLowerCase();
      ticker.textContent = message.textContent.replace(/\s+/g, " ").trim();
      const level = /err/.test(levelText) ? "error" : /warn/.test(levelText) ? "warn" : levelText === "ok" ? "ok" : "";
      ticker.className = `cmd-ticker ${level}`;
    };
    new MutationObserver(update).observe(log, { childList: true });
    update();
    return true;
  }

  // ------------------------------------------------------- the windows

  const q = sel => () => document.querySelector(sel);
  const pagePanel = page => () => document.querySelector(`#page-${page} > section.panel, .lxw-body > section.panel[data-home="${page}"]`);

  function registerBuiltIns() {
    const pref = (key, fallback) => (window.LXPrefs ? window.LXPrefs.get(key) : fallback);
    register({ id: "cues", title: "Cue Stack", panel: q(".panel.cues"), outClass: "cues", w: 420, h: 380 });
    register({ id: "log", title: "Console Log", panel: q(".panel.terminal"), outClass: "log", w: 600, h: 280, hiddenWhenDocked: () => pref("logDocked", true) === false });
    register({ id: "groups", title: "Groups", panel: q(".groups-panel"), outClass: "groups", w: 340, h: 380 });
    register({ id: "fixtures", title: "Fixtures", panel: q(".fixtures-panel"), outClass: "fixtures", w: 420, h: 540 });
    register({ id: "control", title: "Control Deck", panel: q("#controlPanel"), outClass: "control", w: 440, h: 660 });
    register({ id: "palettes", title: "Palettes", build: buildPalettes, w: 440, h: 360 });
    register({ id: "magic", title: "Magic Sheet", panel: q(".magic-panel"), placeholder: true, w: 820, h: 500 });
    register({ id: "effects", title: "Effects", panel: pagePanel("effects"), placeholder: true, w: 640, h: 480 });
    register({ id: "chases", title: "Chases", panel: pagePanel("chases"), placeholder: true, w: 640, h: 480 });
    register({ id: "inspector", title: "Cue Inspector", panel: pagePanel("inspector"), placeholder: true, w: 520, h: 600 });
    register({ id: "patch", title: "Patched Fixtures", panel: q("#patchTablePanel"), placeholder: true, w: 760, h: 440 });
  }

  // Palettes: one-click buttons by category, like a direct-select window.
  function buildPalettes(body) {
    body.innerHTML = '<div class="lx-direct"></div>';
    const box = body.firstElementChild;
    let key = "";
    const swatch = p => {
      const v = p.values || {};
      if (v.hue != null && (v.sat ?? 100) > 0) return `hsl(${v.hue} ${v.sat ?? 100}% ${Math.max(35, Math.min(70, v.light ?? 50))}%)`;
      if (v.intensity != null) return `hsl(0 0% ${20 + v.intensity * 0.6}%)`;
      return "";
    };
    const render = () => {
      const palettes = (window.State?.palettes || []).filter(Boolean);
      const next = JSON.stringify(palettes.map(p => [p.name, p.category, swatch(p)]));
      if (next === key) return;
      key = next;
      if (!palettes.length) {
        box.innerHTML = '<div class="lx-direct-empty">No palettes yet. Record one from the Palette Library, or use Auto Create.</div>';
        return;
      }
      const byCat = new Map();
      palettes.forEach(p => { const c = p.category || "General"; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(p); });
      box.replaceChildren();
      for (const [cat, list] of byCat) {
        const h = document.createElement("h5"); h.textContent = String(cat).toUpperCase();
        const grid = document.createElement("div"); grid.className = "lx-direct-grid";
        for (const p of list) {
          const b = document.createElement("button");
          b.type = "button"; b.textContent = p.name; b.title = `${p.name} — apply to the selected fixtures`;
          const s = swatch(p); if (s) b.style.setProperty("--swatch", s);
          b.addEventListener("click", () => {
            const result = window.Palettes?.apply(p.name);
            if (result && !result.ok) say(result.message, "warn");
          });
          grid.appendChild(b);
        }
        box.append(h, grid);
      }
    };
    render();
    const timer = setInterval(() => { if (!body.isConnected) clearInterval(timer); else render(); }, 700);
  }

  // Reopen what was open last time, once the panels exist.
  function restore(tries = 0) {
    let pending = false;
    for (const [id, state] of Object.entries(saved)) {
      if (!state?.open || open.has(id) || !defs.has(id) || defs.get(id).noRestore) continue;
      if (!openWindow(id, { quiet: true })) pending = true;
    }
    if (pending && tries < 20) setTimeout(() => restore(tries + 1), 500);
  }

  function boot() {
    if (!installMenu() || !installTicker()) return setTimeout(boot, 300);
    // Tag page panels with their page so they can be found while windowed.
    for (const page of ["effects", "chases", "inspector"]) {
      const panel = document.querySelector(`#page-${page} > section.panel`);
      if (panel) panel.dataset.home = page;
    }
    registerBuiltIns();
    // Wait for the splash screen to go, so windows open over the console.
    const ready = () => !document.getElementById("splashScreen");
    const go = (n = 0) => (ready() || n > 40 ? restore() : setTimeout(() => go(n + 1), 250));
    go();
    addEventListener("resize", () => {
      for (const { el, host } of open.values()) if (!host) place(el, clamp({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
    });
  }

  window.LXWindows = Object.freeze({
    register, open: openWindow, close: closeWindow, toggle,
    isOpen: id => open.has(id),
    hostOf: id => open.get(id)?.host || null,
    title: id => defs.get(id)?.title || id,
    place: (id, rect) => { const e = open.get(id); if (e) place(e.el, clamp(rect, e.host)); },
    rectOf: id => { const e = open.get(id); return e ? { x: e.el.offsetLeft, y: e.el.offsetTop, w: e.el.offsetWidth, h: e.el.offsetHeight } : null; },
    list: () => [...defs.keys()],
    floating: () => [...open.entries()].filter(([, e]) => !e.host).map(([id]) => id),
    refreshDock: id => { const def = defs.get(id); if (def && !open.has(id)) bodyClass(def, Boolean(def.hiddenWhenDocked?.())); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
