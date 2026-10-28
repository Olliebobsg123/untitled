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

  // ------------------------------------------------------------ what they do

  function membersOf(group) {
    const fixtures = S().fixtures || [];
    return (group?.members || []).map(v => fixtures.find(f => String(f.id) === String(v) || Number(f.fixtureNumber) === Number(v))).filter(Boolean);
  }
  const groupNamed = name => (S().groups || []).find(g => g?.name === name);

  // The highest group fader (or flash) on each light, 0-1. Rebuilt when a
  // fader moves rather than every DMX frame.
  let levels = new Map();
  function rebuild() {
    const next = new Map();
    const f = data();
    f.pages.forEach((faders, p) => faders.forEach((fd, i) => {
      if (fd.type !== "group") return;
      const level = flashing.has(`${p}:${i}`) ? 1 : Math.max(0, Math.min(100, Number(fd.level) || 0)) / 100;
      if (!level) return;
      for (const light of membersOf(groupNamed(fd.name))) next.set(light.id, Math.max(next.get(light.id) || 0, level));
    }));
    levels = next;
  }
  const levelFor = id => levels.get(id) || 0;
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
    if (fd.type === "effect") return `FX ${fd.name}`;
    if (fd.type === "chase") return `Chase ${fd.name}`;
    if (fd.type === "grand") return "Grand master";
    return "";
  }

  function render() {
    const host = $("fadersBank");
    if (!host) return;
    const f = data();
    $("fadersPages").innerHTML = Array.from({ length: PAGES }, (_, p) => `<button type="button" class="fd-page${p === page ? " on" : ""}" data-page="${p}">Page ${p + 1}</button>`).join("");
    host.innerHTML = f.pages[page].map((fd, i) => {
      const lvl = fd.type === "grand" ? Number(f.grand) : Number(fd.level) || 0;
      const empty = !fd.type;
      const missing = (fd.type === "group" && !groupNamed(fd.name)) || (fd.type === "effect" && !S().savedEffects?.[fd.name]) || (fd.type === "chase" && !(S().chases || []).some(c => c?.name === fd.name));
      return `<div class="fd${empty ? " empty" : ""}${missing ? " missing" : ""} fd-${fd.type || "none"}" data-i="${i}">
        <div class="fd-num">${page * PER_PAGE + i + 1}</div>
        <div class="fd-val">${empty ? "" : `${Math.round(lvl)}%`}</div>
        <div class="fd-track" data-track="${i}">${empty ? `<span class="fd-add">＋<small>Assign</small></span>` : `<div class="fd-fill" style="height:${lvl}%"></div><div class="fd-knob" style="bottom:calc((100% - 28px) * ${lvl / 100})"></div>`}</div>
        <button type="button" class="fd-name" data-assign="${i}" title="${esc(missing ? "Not in this show any more — tap to change" : "Tap to change")}">${esc(labelOf(fd) || "—")}</button>
        <button type="button" class="fd-flash" data-flash="${i}"${empty ? " disabled" : ""}>${fd.type === "grand" ? "Black" : "Flash"}</button>
      </div>`;
    }).join("");
  }

  function setLevel(i, value, final = false) {
    const fd = slot(page, i);
    const v = Math.max(0, Math.min(100, Math.round(value)));
    if (fd.type === "grand") data().grand = v; else fd.level = v;
    const el = document.querySelector(`.fd[data-i="${i}"]`);
    if (el) {
      el.querySelector(".fd-val").textContent = `${v}%`;
      el.querySelector(".fd-fill")?.style.setProperty("height", `${v}%`);
      el.querySelector(".fd-knob")?.style.setProperty("bottom", `calc((100% - 28px) * ${v / 100})`);
    }
    sync(page, i);
    output();
    if (final) window.LXShowCommands?.autosave?.();
  }

  async function assign(i) {
    const s = S(), fd = slot(page, i);
    const options = [["", "— Nothing (clear) —"], ["grand:", "Grand master"],
      ...(s.groups || []).filter(g => g?.name).map(g => [`group:${g.name}`, `Group: ${g.name}`]),
      ...Object.keys(s.savedEffects || {}).map(n => [`effect:${n}`, `Effect: ${n}`]),
      ...(s.chases || []).filter(c => c?.name).map(c => [`chase:${c.name}`, `Chase: ${c.name}`])];
    const now = fd.type ? `${fd.type}:${fd.name || ""}` : "";
    const r = await window.LXAsk?.(`Fader ${page * PER_PAGE + i + 1}`, [{ key: "what", label: "Controls", type: "select", value: now, options }], { ok: "Set", message: options.length <= 2 ? "Make groups, effects or chases first and they'll be listed here." : "" });
    if (!r) return;
    // Whatever it ran before stops first.
    fd.level = 0; sync(page, i);
    const [type, ...rest] = String(r.what || "").split(":");
    Object.assign(fd, { type, name: rest.join(":"), level: type === "grand" ? 0 : 0 });
    if (!type) delete fd.name;
    render(); output();
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
      let held = fd.type === "grand" ? data().grand : null;
      if (fd.type === "grand") data().grand = 0; else flashing.add(key);
      sync(page, i); output();
      const release = () => {
        b.classList.remove("down");
        if (fd.type === "grand") data().grand = held; else flashing.delete(key);
        sync(page, i); output();
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
      .fd-num{font:800 10px var(--mono,monospace);color:#53615e;text-align:center}
      .fd-val{font:800 14px var(--mono,monospace);color:#edf4f2;text-align:center;min-height:18px}
      .fd-track{position:relative;flex:1;min-height:120px;margin:0 auto;width:56px;border-radius:10px;background:#071012;border:1px solid #1d282c;touch-action:none;cursor:ns-resize;overflow:visible}
      .fd-fill{position:absolute;left:0;right:0;bottom:0;border-radius:9px;background:linear-gradient(180deg,var(--accent,#19d6a3),rgba(25,214,163,.25));opacity:.55;pointer-events:none}
      .fd-knob{position:absolute;left:-6px;right:-6px;height:28px;border-radius:7px;background:#dfe9e6;box-shadow:0 2px 8px rgba(0,0,0,.6),inset 0 -3px 0 rgba(0,0,0,.18);pointer-events:none}
      .fd-add{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#3f4d4a;font-size:24px;cursor:pointer}
      .fd-add small{display:block;font-size:10px;font-weight:800;letter-spacing:.06em}
      .fd.empty .fd-track{cursor:pointer;border-style:dashed}
      .fd-name{min-height:38px;padding:4px;border:1px solid #1f2a2f;border-radius:7px;background:#10171b;color:#c6d0ce;font-size:11px;font-weight:800;line-height:1.2;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .fd.missing .fd-name{color:#f2b84b;border-color:#5a4520}
      .fd-flash{min-height:52px;border:1px solid #2b383f;border-radius:8px;background:#15201f;color:#c6d0ce;font-weight:900;letter-spacing:.06em;cursor:pointer;touch-action:none}
      .fd-flash.down{background:var(--accent,#19d6a3);color:#061210}
      .fd-grand .fd-fill{background:linear-gradient(180deg,#f2b84b,rgba(242,184,75,.25))}
      .fd-grand .fd-flash.down{background:#ff6b6b}
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
    pageEl.innerHTML = `<section class="panel" style="height:100%"><div class="panel-header"><div><span class="eyebrow">PLAYBACK</span> Faders</div><span class="panel-meta">GROUPS · EFFECTS · CHASES</span></div><div class="panel-body"><div class="fd-pages" id="fadersPages"></div><div class="fd-bank" id="fadersBank"></div></div></section>`;
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
    $("fadersPages").addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b) { page = Number(b.dataset.page); render(); } });
    wire($("fadersBank"));
    render();
  }

  // A show opened or started: its faders, with nothing running.
  window.addEventListener("lx-show-file", () => {
    running.clear(); flashing.clear();
    data().pages.forEach((faders, p) => faders.forEach((_, i) => sync(p, i)));
    output(); render();
  });

  window.LXFaders = { levelFor, grand, render, refresh: output, page: () => page, set: (i, v) => setLevel(i, v, true), data };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
