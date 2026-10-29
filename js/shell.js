"use strict";

/*
 * The app's layout: three zones (shell.css).
 *
 *   Top bar     show name and page · LIVE/BLIND · tempo + Tap · Back / GO ·
 *               master — then the status pills other modules add.
 *   Workspace   the page, with the sidebar on the left: pages by task
 *               (Patch, Program, Cues, Playback, Show), with icons and names.
 *   Cue list    docked on the right (not on the Cue Inspector page, which has
 *               its own list). The console log sits under the workspace.
 *
 * In BLIND a blue bar runs across the top and a blue frame around the
 * window, so it's clear the stage isn't changing.
 *
 * The panels themselves are the same elements as before, just moved, so
 * everything wired to them keeps working.
 */
(function () {
  if (window.LXShell) return;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Pages by task. "@x" entries are tools that open a window.
  const SECTIONS = [
    ["Patch", [["patch", "Patch", "▦"]]],
    ["Program", [["live", "Program", "✦"], ["magic", "Magic Sheet", "◎"]]],
    ["Cues", [["inspector", "Cue Inspector", "◫"], ["@song", "Song Timeline", "♪"], ["@tracking", "Tracking Sheet", "▤"]]],
    ["Playback", [["faders", "Faders", "☰"], ["chases", "Chases", "≋"], ["effects", "Effects", "✹"]]],
    ["Show", [["qlab", "QLab", "♫"], ["settings", "Settings", "⚙"]]]
  ];
  const known = new Set(SECTIONS.flatMap(([, items]) => items.map(([id]) => id)));

  // ---------------------------------------------------------- sidebar

  function buildNav() {
    const nav = document.querySelector(".sidebar .nav");
    if (!nav) return false;
    const links = new Map([...nav.querySelectorAll(".nav-link[data-page]")].map(b => [b.dataset.page, b]));
    const frag = document.createDocumentFragment();
    for (const [title, items] of SECTIONS) {
      const head = document.createElement("div");
      head.className = "shell-nav-head";
      head.textContent = title;
      frag.appendChild(head);
      for (const [id, name, icon] of items) {
        let b;
        if (id.startsWith("@")) {
          b = nav.querySelector(`.nav-link[data-tool="${id.slice(1)}"]`) || document.createElement("button");
          b.type = "button";
          b.className = "nav-link nav-tool";
          b.dataset.tool = id.slice(1);
          if (!b.dataset.wired) {
            b.dataset.wired = "1";
            b.addEventListener("click", () => window.LXWindows?.toggle?.(id.slice(1)));
          }
        } else {
          b = links.get(id);
          if (!b) continue;
        }
        b.title = name;
        b.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-text">${esc(name)}</span>`;
        frag.appendChild(b);
      }
    }
    // Anything else (your own pages): at the end.
    const extra = [...links.entries()].filter(([id]) => !known.has(id));
    if (extra.length) {
      const head = document.createElement("div");
      head.className = "shell-nav-head";
      head.textContent = "My pages";
      frag.appendChild(head);
      extra.forEach(([, b]) => frag.appendChild(b));
    }
    nav.querySelectorAll(".shell-nav-head").forEach(h => h.remove());
    // Anything else in the sidebar (the ＋ New page button) stays at the end.
    const rest = [...nav.children].filter(el => !el.matches(".nav-link[data-page], .nav-tool"));
    nav.appendChild(frag);
    rest.forEach(el => nav.appendChild(el));
    return links.has("faders") && links.has("magic");
  }

  // Faders and Magic Sheet add their links once they load; custom pages come
  // and go. Rebuild when the set of pages changes (not when we move them).
  const pageIds = () => [...document.querySelectorAll(".sidebar .nav .nav-link[data-page]")].map(b => b.dataset.page).sort().join(",");
  let navTimer = null, built = "";
  function rebuild() { built = pageIds(); return buildNav(); }
  function watchNav() {
    const nav = document.querySelector(".sidebar .nav");
    if (!nav) return;
    let tries = 0;
    const settle = () => { if (!rebuild() && ++tries < 30) navTimer = setTimeout(settle, 200); };
    settle();
    new MutationObserver(() => {
      if (pageIds() === built) return;
      clearTimeout(navTimer);
      navTimer = setTimeout(rebuild, 50);
    }).observe(nav, { childList: true });
  }

  // ---------------------------------------------------------- top bar

  function buildTopbar() {
    const bar = document.querySelector(".topbar");
    if (!bar || $("shellRun")) return;
    const title = bar.querySelector(".page-title");
    if (title && !$("shellShowName")) {
      const name = document.createElement("div");
      name.id = "shellShowName";
      name.className = "shell-show";
      title.prepend(name);
    }
    const run = document.createElement("div");
    run.id = "shellRun";
    run.className = "shell-run";
    run.innerHTML = `
      <div class="shell-slot" id="shellMode"></div>
      <div class="shell-slot" id="shellTempo"></div>
      <div class="shell-go">
        <button type="button" class="shell-back" id="shellBack" title="Back to the previous cue">◀<span> Back</span></button>
        <button type="button" class="shell-gobtn" id="shellGo" title="GO: the next cue">GO</button>
      </div>
      <button type="button" class="shell-master" id="shellMaster" title="Grand master — open the Faders page"><span>Master</span><b>100%</b><i><em></em></i></button>`;
    title ? title.after(run) : bar.prepend(run);
    const mode = bar.querySelector(".console-mode-switch");
    if (mode) $("shellMode").appendChild(mode);
    $("shellGo").addEventListener("click", () => window.goNextCue?.());
    $("shellBack").addEventListener("click", () => window.goPreviousCue?.());
    $("shellMaster").addEventListener("click", () => document.querySelector('.nav-link[data-page="faders"]')?.click());
  }

  // Wide sidebar (names beside icons) on big screens, or always if
  // Preferences → Interface → Sidebar says so.
  const wideQuery = window.matchMedia("(min-width: 1600px)");
  function sidebarWidth() {
    document.body.classList.toggle("shell-wide", wideQuery.matches || window.LXPrefs?.get("sidebar") === "labels");
  }

  function tick() {
    const name = $("shellShowName");
    if (name) {
      const show = window.LXShowCommands?.name?.() || "Untitled show";
      const dirty = window.LXShowCommands?.isDirty?.() ? " •" : "";
      const text = show + dirty;
      if (name.textContent !== text) { name.textContent = text; name.title = `${show}${dirty ? " — not saved yet" : ""}`; }
    }
    const master = $("shellMaster");
    if (master) {
      const g = Math.round((window.LXFaders?.grand?.() ?? 1) * 100);
      const b = master.querySelector("b");
      if (b.textContent !== `${g}%`) { b.textContent = `${g}%`; master.querySelector("em").style.width = `${g}%`; master.classList.toggle("down", g < 100); }
    }
    // The licence badge and Change licence button live in the sidebar footer.
    const footer = document.querySelector(".sidebar .sidebar-footer");
    for (const id of ["licenseTierBadge", "changeLicenseButton"]) {
      const el = $(id);
      if (footer && el && el.parentElement !== footer) footer.appendChild(el);
    }
    // Which page is showing (for the layout: the Inspector has its own cue list).
    const page = document.querySelector(".workspace > .page.active")?.id?.replace(/^page-/, "") || "";
    if (document.body.dataset.page !== page) document.body.dataset.page = page;
    document.querySelectorAll(".nav-tool").forEach(b => b.classList.toggle("open", Boolean(window.LXWindows?.isOpen?.(b.dataset.tool))));
  }

  // ------------------------------------------------------- the zones

  function buildZones() {
    // The cue list leaves the bottom row for the right-hand dock.
    const cues = document.querySelector(".bottom-row > .panel.cues");
    if (cues) {
      cues.classList.add("shell-cues");
      document.querySelector(".workspace")?.after(cues);
      // One cue per row (js/cue-list.js), in place of the old tile stack.
      const list = document.createElement("div");
      list.className = "shell-cuelist";
      cues.appendChild(list);
      const mount = (tries = 0) => { if (window.LXCueList?.mount) window.LXCueList.mount(list); else if (tries < 50) setTimeout(() => mount(tries + 1), 100); };
      mount();
    }
    if (!$("shellBlindBar")) {
      const blind = document.createElement("div");
      blind.id = "shellBlindBar";
      blind.className = "shell-blind-bar";
      blind.innerHTML = `<b>BLIND</b><span>You're changing cues, not the stage — nothing you do here is seen until you go LIVE.</span><button type="button">Go LIVE</button>`;
      blind.querySelector("button").addEventListener("click", () => $("consoleModeLive")?.click());
      document.body.appendChild(blind);
      const frame = document.createElement("div");
      frame.className = "shell-blind-frame";
      document.body.appendChild(frame);
    }
  }

  // Patch page: the library and patch form are a side panel you can hide.
  function patchToggle(tries = 0) {
    const head = document.querySelector("#patchTablePanel .panel-header");
    if (!head) { if (tries < 50) setTimeout(() => patchToggle(tries + 1), 200); return; }
    if ($("shellLibToggle")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "shellLibToggle";
    b.className = "btn-secondary shell-lib-toggle";
    const show = hidden => { document.body.classList.toggle("patch-lib-hidden", hidden); b.textContent = hidden ? "＋ Add fixtures (library)" : "Hide library ▸"; };
    let hidden = false;
    try { hidden = localStorage.getItem("lx-patch-lib-hidden") === "1"; } catch (_) {}
    show(hidden);
    b.addEventListener("click", () => { hidden = !document.body.classList.contains("patch-lib-hidden"); show(hidden); try { localStorage.setItem("lx-patch-lib-hidden", hidden ? "1" : "0"); } catch (_) {} });
    head.appendChild(b);
  }

  function install() {
    document.body.classList.add("lx-shell");
    patchToggle();
    buildZones();
    buildTopbar();
    watchNav();
    sidebarWidth();
    wideQuery.addEventListener?.("change", sidebarWidth);
    window.LXPrefs?.on?.(key => { if (key === "sidebar") sidebarWidth(); });
    tick();
    setInterval(tick, 250);
  }

  window.LXShell = { buildNav: rebuild, tick };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
