"use strict";

/*
 * Custom pages: the ＋ at the bottom of the sidebar makes a new page that
 * you lay out yourself from the console's windows (Cue Stack, Fixtures,
 * Magic Sheet, Palettes…). Move and resize them on the page; lock the
 * layout when it's right. Pages are kept in localStorage
 * "lx-custom-pages", with each window's place stored as a fraction of
 * the page so the layout scales with the screen.
 *
 * A window can only be in one place at a time: showing a page takes its
 * windows from wherever they were, and leaving the page puts them back.
 */
(function () {
  if (window.LXCustomPages) return;

  const STORE = "lx-custom-pages";
  const ICONS = ["▣", "◧", "◨", "⬒", "✚", "★", "◆", "●", "▲", "♫", "☰", "⌂"];
  const TEMPLATES = {
    empty: { label: "Empty — I'll add windows myself", windows: {} },
    programming: {
      label: "Programming — fixtures, control deck, groups, palettes",
      windows: { fixtures: [0, 0, .3, 1], groups: [.3, 0, .3, .38], palettes: [.3, .38, .3, .62], control: [.6, 0, .4, 1] }
    },
    playback: {
      label: "Playback — cue stack, magic sheet, chases, effects",
      windows: { magic: [0, 0, .62, .6], cues: [.62, 0, .38, .6], chases: [0, .6, .5, .4], effects: [.5, .6, .5, .4] }
    },
    busking: {
      label: "Busking — groups, palettes, effects, chases, magic sheet",
      windows: { groups: [0, 0, .25, .45], palettes: [0, .45, .25, .55], magic: [.25, 0, .45, .55], effects: [.7, 0, .3, .55], chases: [.25, .55, .75, .45] }
    }
  };

  let pages = [];
  try { pages = JSON.parse(localStorage.getItem(STORE) || "[]") || []; } catch (_) { pages = []; }
  if (!Array.isArray(pages)) pages = [];
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(pages)); } catch (_) {} };

  const W = () => window.LXWindows;
  const find = id => pages.find(p => p.id === id);
  const esc = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = (m, l) => window.log?.(m, l);
  let addButton = null, mounted = null; // id of the page whose windows are out

  // ------------------------------------------------------------ styles

  function injectStyles() {
    if (document.getElementById("lxCustomPageStyles")) return;
    const style = document.createElement("style");
    style.id = "lxCustomPageStyles";
    style.textContent = `
      .page.custom-page.active{display:flex;flex-direction:column;gap:6px}
      .cp-bar{flex:none;display:flex;align-items:center;gap:6px;min-height:32px;padding:0 8px;border:1px solid var(--border);border-radius:var(--r-md);background:rgba(11,16,19,.92)}
      .cp-bar .cp-name{font-size:12px;font-weight:800;letter-spacing:.4px;color:var(--text);margin-right:6px}
      .cp-bar .cp-hint{margin-left:auto;color:#5d6b68;font-size:10px}
      .cp-bar button{height:24px;padding:0 9px;font-size:10px}
      .cp-bar button.on{border-color:var(--accent-line);color:var(--accent-2);background:var(--accent-soft)}
      .cp-canvas{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;border-radius:var(--r-md)}
      .custom-page:not(.cp-locked) .cp-canvas{background-image:radial-gradient(circle,rgba(255,255,255,.06) 1px,transparent 1.2px);background-size:16px 16px;outline:1px dashed var(--border-strong);outline-offset:-1px}
      .cp-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#6f7d7a;font-size:12px;text-align:center;pointer-events:none}
      .cp-empty b{color:var(--text-soft);font-size:14px}
      .cp-empty button{pointer-events:auto}
      .lxw.lxw-docked{box-shadow:0 2px 10px rgba(0,0,0,.35)}
      .cp-locked .lxw.lxw-docked .lxw-bar{cursor:default}
      .cp-locked .lxw.lxw-docked .lxw-grip,.cp-locked .lxw.lxw-docked .lxw-close,.cp-locked .lxw.lxw-docked .lxw-dock{display:none}
      .nav-link.nav-add{opacity:.75}
      .nav-link.nav-add:hover{opacity:1}
      .nav-link.nav-add .nav-icon{font-size:16px;font-weight:400}
    `;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------ sidebar

  function navButton(page) {
    let button = document.querySelector(`.nav-link[data-custom="${page.id}"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "nav-link custom-nav";
      button.dataset.custom = page.id;
      button.dataset.page = `custom-${page.id}`;
      button.addEventListener("click", e => { e.preventDefault(); show(page.id); });
      button.addEventListener("dblclick", e => { e.preventDefault(); rename(page.id); });
      addButton.before(button);
    }
    button.title = page.name;
    const html = `<span class="nav-icon">${esc(page.icon || "▣")}</span><span class="nav-text">${esc(page.name)}</span><b></b>`;
    if (button.dataset.html !== html) { button.innerHTML = html; button.dataset.html = html; renumber(); }
    return button;
  }

  // Number every page button in order (01, 02 …), custom ones included.
  function renumber() {
    document.querySelectorAll(".nav-link[data-page]").forEach((b, i) => {
      const tag = b.querySelector("b");
      if (tag) tag.textContent = String(i + 1).padStart(2, "0");
    });
  }

  // ------------------------------------------------------------- page

  function pageEl(page) {
    let el = document.getElementById(`page-custom-${page.id}`);
    if (!el) {
      el = document.createElement("div");
      el.className = "page custom-page";
      el.id = `page-custom-${page.id}`;
      el.innerHTML = `
        <div class="cp-bar">
          <span class="cp-name"></span>
          <button type="button" class="btn-primary" data-cp="add">＋ Add window</button>
          <button type="button" class="btn-secondary" data-cp="tidy" title="Arrange the windows in a grid">Tidy</button>
          <button type="button" class="btn-secondary" data-cp="lock">🔒 Lock layout</button>
          <span class="cp-hint"></span>
          <button type="button" class="btn-secondary" data-cp="rename">Rename</button>
          <button type="button" class="btn-danger-soft" data-cp="delete">Delete page</button>
        </div>
        <div class="cp-canvas"><div class="cp-empty"><b>Build your page</b><span>Add the windows you want here, then drag and resize them into place.</span><button type="button" class="btn-primary" data-cp="add">＋ Add window</button></div></div>`;
      document.getElementById("page-live").parentElement.appendChild(el);
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-cp]");
        if (!b) return;
        const act = b.dataset.cp;
        if (act === "add") addMenu(page.id, b);
        else if (act === "tidy") tidy(page.id);
        else if (act === "lock") { page.locked = !page.locked; persist(); render(page.id); }
        else if (act === "rename") rename(page.id);
        else if (act === "delete") remove(page.id);
      });
      // Mount the windows when the page shows, put them back when it hides.
      new MutationObserver(() => {
        if (el.classList.contains("active")) requestAnimationFrame(() => mount(page.id));
        else if (mounted === page.id) unmount();
      }).observe(el, { attributes: true, attributeFilter: ["class"] });
    }
    return el;
  }

  function render(id) {
    const page = find(id);
    if (!page) return;
    const el = pageEl(page);
    el.querySelector(".cp-name").textContent = page.name;
    el.classList.toggle("cp-locked", Boolean(page.locked));
    const lock = el.querySelector('[data-cp="lock"]');
    lock.classList.toggle("on", Boolean(page.locked));
    lock.textContent = page.locked ? "🔒 Locked" : "🔓 Lock layout";
    const count = Object.keys(page.windows || {}).length;
    el.querySelector(".cp-empty").style.display = count ? "none" : "";
    el.querySelector(".cp-hint").textContent = page.locked ? "Unlock to move or resize windows." : count ? "Drag title bars to move · drag corners to resize · × takes a window off this page" : "";
    el.querySelector('[data-cp="add"]').disabled = Boolean(page.locked);
    navButton(page);
  }

  function hostFor(page) {
    const canvas = pageEl(page).querySelector(".cp-canvas");
    return {
      el: canvas,
      locked: () => Boolean(page.locked),
      onChange: (winId, r) => {
        const W0 = canvas.clientWidth || 1, H0 = canvas.clientHeight || 1;
        page.windows[winId] = [r.x / W0, r.y / H0, r.w / W0, r.h / H0].map(v => Math.round(v * 10000) / 10000);
        persist();
      },
      onRemove: winId => { delete page.windows[winId]; persist(); setTimeout(() => render(page.id), 0); }
    };
  }

  const toPx = (canvas, f) => ({ x: f[0] * canvas.clientWidth, y: f[1] * canvas.clientHeight, w: f[2] * canvas.clientWidth, h: f[3] * canvas.clientHeight });

  function mount(id) {
    const page = find(id);
    const el = page && document.getElementById(`page-custom-${id}`);
    if (!page || !el?.classList.contains("active") || !W()) return;
    if (mounted && mounted !== id) unmount();
    mounted = id;
    const host = hostFor(page);
    for (const [winId, frac] of Object.entries(page.windows || {})) {
      if (W().hostOf(winId)?.el === host.el) continue;
      W().open(winId, { host, rect: toPx(host.el, frac), quiet: true });
    }
    render(id);
  }

  function unmount() {
    const page = find(mounted);
    const canvas = page && document.querySelector(`#page-custom-${page.id} .cp-canvas`);
    mounted = null;
    if (!page || !W()) return;
    for (const winId of Object.keys(page.windows || {})) if (W().hostOf(winId)?.el === canvas) W().close(winId);
  }

  // Re-fit the windows when the app window changes size.
  addEventListener("resize", () => {
    const page = find(mounted);
    const canvas = page && document.querySelector(`#page-custom-${page.id} .cp-canvas`);
    if (!canvas || !canvas.clientWidth) return;
    for (const [winId, frac] of Object.entries(page.windows || {})) if (W().hostOf(winId)?.el === canvas) W().place(winId, toPx(canvas, frac));
  });

  // ---------------------------------------------------------- actions

  function show(id) {
    const page = find(id);
    if (!page) return;
    document.querySelectorAll(".nav-link").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
    navButton(page).classList.add("active");
    pageEl(page).classList.add("active");
    const title = document.getElementById("topPageTitle");
    if (title) title.textContent = page.name.toUpperCase();
    say(`View: ${page.name}`);
  }

  async function create() {
    const answer = await window.LXAsk("New page", [
      { key: "name", label: "Page name", value: `My Page ${pages.length + 1}` },
      { key: "icon", label: "Icon", type: "select", value: ICONS[pages.length % ICONS.length], options: ICONS.map(i => [i, i]) },
      { key: "template", label: "Start with", type: "select", value: "empty", options: Object.entries(TEMPLATES).map(([k, t]) => [k, t.label]) }
    ], { ok: "Create page" });
    if (!answer) return null;
    const page = {
      id: Date.now().toString(36),
      name: answer.name.trim() || `My Page ${pages.length + 1}`,
      icon: answer.icon,
      locked: false,
      windows: {}
    };
    for (const [winId, frac] of Object.entries(TEMPLATES[answer.template]?.windows || {})) if (W()?.list().includes(winId)) page.windows[winId] = frac;
    pages.push(page);
    persist();
    render(page.id);
    renumber();
    show(page.id);
    say(`Made a new page: ${page.name}`, "ok");
    return page;
  }

  async function rename(id) {
    const page = find(id);
    if (!page) return;
    const answer = await window.LXAsk("Rename page", [
      { key: "name", label: "Page name", value: page.name },
      { key: "icon", label: "Icon", type: "select", value: page.icon, options: ICONS.map(i => [i, i]) }
    ], { ok: "Save" });
    if (!answer) return;
    page.name = answer.name.trim() || page.name;
    page.icon = answer.icon;
    persist();
    render(id);
    if (document.getElementById(`page-custom-${id}`)?.classList.contains("active")) document.getElementById("topPageTitle").textContent = page.name.toUpperCase();
  }

  async function remove(id) {
    const page = find(id);
    if (!page) return;
    const sure = await window.LXAsk(`Delete “${page.name}”?`, [], { ok: "Delete page", message: "The page goes, but its windows don't — they go back to their usual places." });
    if (!sure) return;
    if (mounted === id) unmount();
    pages = pages.filter(p => p.id !== id);
    persist();
    document.getElementById(`page-custom-${id}`)?.remove();
    document.querySelector(`.nav-link[data-custom="${id}"]`)?.remove();
    renumber();
    document.querySelector('.nav-link[data-page="live"]')?.click();
    say(`Deleted page ${page.name}`, "ok");
  }

  function addMenu(id, anchor) {
    const page = find(id);
    if (!page || page.locked) return;
    document.querySelector(".cp-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "lxw-menu cp-menu";
    const ids = W().list().filter(w => w !== "prefs");
    menu.innerHTML = `<div class="lxw-menu-label">ADD TO THIS PAGE</div>${ids.map(w => `<button type="button" data-w="${w}"${page.windows[w] ? " disabled" : ""}><span class="tick">${page.windows[w] ? "●" : ""}</span><span>${esc(W().title(w))}</span><kbd></kbd></button>`).join("")}`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.min(r.left, innerWidth - 260)}px`;
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
    menu.addEventListener("click", e => {
      const b = e.target.closest("button[data-w]");
      if (!b || b.disabled) return;
      menu.remove();
      document.removeEventListener("pointerdown", close, true);
      addWindow(id, b.dataset.w);
    });
  }

  // Put a new window in the first free-looking spot.
  function addWindow(id, winId) {
    const page = find(id);
    if (!page) return;
    const n = Object.keys(page.windows).length;
    page.windows[winId] = [Math.min(.6, .03 + (n % 5) * .08), Math.min(.5, .04 + (n % 5) * .08), .38, .45];
    persist();
    mount(id);
    render(id);
  }

  // Arrange the page's windows in an even grid.
  function tidy(id) {
    const page = find(id);
    const canvas = page && document.querySelector(`#page-custom-${id} .cp-canvas`);
    const ids = page ? Object.keys(page.windows) : [];
    if (!ids.length || page.locked) return;
    const cols = Math.ceil(Math.sqrt(ids.length * 1.6)), rows = Math.ceil(ids.length / cols), gap = 6;
    ids.forEach((winId, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const last = r === rows - 1 ? ids.length - r * cols : cols; // stretch the last row
      const cw = (canvas.clientWidth - gap * (last - 1)) / last, ch = (canvas.clientHeight - gap * (rows - 1)) / rows;
      const rect = { x: c * (cw + gap), y: r * (ch + gap), w: cw, h: ch };
      page.windows[winId] = [rect.x / canvas.clientWidth, rect.y / canvas.clientHeight, rect.w / canvas.clientWidth, rect.h / canvas.clientHeight];
      W().place(winId, rect);
    });
    persist();
  }

  // ------------------------------------------------------------- boot

  function boot() {
    const nav = document.querySelector(".sidebar .nav");
    if (!nav || !W() || !window.LXAsk || !document.getElementById("page-magic")) return setTimeout(boot, 300);
    injectStyles();
    addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "nav-link nav-add";
    addButton.id = "navAddPage";
    addButton.title = "Make your own page from windows";
    addButton.innerHTML = '<span class="nav-icon">＋</span><span class="nav-text">New page</span>';
    nav.appendChild(addButton);
    addButton.addEventListener("click", e => { e.preventDefault(); create(); });
    for (const page of pages) render(page.id);
    renumber();
  }

  window.LXCustomPages = Object.freeze({ create, show, rename, remove, tidy, list: () => pages.map(p => ({ ...p, windows: { ...p.windows } })), addWindow });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
