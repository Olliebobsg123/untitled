"use strict";

/*
 * ⌘K (Ctrl+K): find anything by name and do it. Pages, windows, tools
 * (bar groups, fog limit, cue sheet, learn…), your cues, groups, effects,
 * chases and lights. Type a few letters, ↑↓, Enter. Anything that isn't
 * in the list runs as a command, as if typed on the command line.
 * Also the 🔍 button in the top bar.
 */
(function () {
  if (window.LXPalette) return;
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const run = c => window.parseCommand?.(c);
  const page = id => () => document.querySelector(`.nav-link[data-page="${id}"]`)?.click();
  const win = id => () => window.LXWindows?.open(id);
  const ask = async (title, label, value, then) => { const r = await window.LXAsk?.(title, [{ key: "v", label, value }], { ok: "OK" }); if (r) then(String(r.v).trim()); };
  const mac = /Mac/.test(navigator.platform);

  // Everything the palette can do. [title, section, action, words, hint]
  function items() {
    const out = [];
    const add = (title, section, action, words = "", hint = "") => out.push({ title, section, action, words: `${title} ${words}`.toLowerCase(), hint });
    // Pages
    document.querySelectorAll(".sidebar .nav-link[data-page]").forEach(b => add(`Go to ${b.textContent.trim()}`, "Page", () => b.click(), "page open show"));
    // Windows
    for (const id of window.LXWindows?.list?.() || []) {
      const title = window.LXWindows.title(id);
      add(`${window.LXWindows.isOpen(id) ? "Close" : "Open"} ${title}`, "Window", () => window.LXWindows.toggle(id), "window");
    }
    // Tools
    add("Run show mode", "Show", () => window.LXRunShow?.toggle(), "performance operate run show go only big", "just the cue list and GO");
    add("Song Timeline", "Cues", win("song"), "audio track waveform music timecode");
    add("Learn cue times from the song", "Cues", () => window.LXSong?.command?.("learn"), "learn rehearsal timecode go record times");
    add("Tracking Sheet", "Cues", win("tracking"), "spreadsheet levels every cue unused lights");
    add("Print cue sheet", "Cues", () => window.LXShowTools?.cueSheet?.(), "paper pdf print list");
    add("Clean up show", "Show", () => window.LXShowTools?.cleanUpShow?.(), "leftover unpatched fixture ids tidy");
    add("Bar groups from the visualiser", "Program", () => window.LXBarGroups?.makeAsk?.(), "groups bars truss foh sweep");
    add("Name lights…", "Program", () => ask("Name lights", "Lights and a name, e.g. 1 thru 4 Fresnel", "", v => v && run(`label ${v}`)), "label rename short name");
    add("Fog limit…", "Show", () => ask("Foggers cut after", "Seconds (0 = no limit)", String(window.LXPrefs?.get("fogMaxSec") ?? 10), v => run(`fog limit ${Number(v) || 0}`)), "haze smoke safety fire alarm timer");
    add("Haze limit…", "Show", () => ask("Hazers cut after", "Seconds (0 = no limit)", String(window.LXPrefs?.get("hazeMaxSec") ?? 0), v => run(`haze limit ${Number(v) || 0}`)), "smoke safety timer");
    add("Let smoke machines run again", "Show", () => run("fog reset"), "fog haze reset");
    add("Set tempo…", "Playback", () => ask("Show tempo", "BPM", String(window.LXTempo?.bpm?.() ?? 120), v => window.LXTempo?.set(v)), "bpm beat speed");
    add("Tap tempo", "Playback", () => window.LXTempo?.tap?.(), "bpm beat");
    add("Auto Create groups, palettes, effects and chases", "Program", () => run("auto create"), "make generate");
    add("Record the next cue", "Cues", () => document.getElementById("btnRecordCue")?.click(), "save store");
    add("Update the live cue", "Cues", () => { const i = S().currentCue; if (i >= 0) run(`update cue ${window.cueLabel(i)}`); }, "store save");
    add("Clear the programmer", "Program", () => run("clear programmer"), "release");
    add("Blackout", "Show", () => run("blackout"), "dark off");
    add("Go LIVE", "Show", () => document.getElementById("consoleModeLive")?.click(), "output stage");
    add("Go BLIND", "Show", () => document.getElementById("consoleModeBlind")?.click(), "preview edit offline");
    add("Save the show", "Show", () => window.LXShowCommands?.saveCurrent?.(), "file");
    add("Preferences", "Show", () => window.LXPrefs?.open?.(), "settings options");
    add("Haze & Fog safety settings", "Show", () => window.LXPrefs?.open?.("show"), "fog smoke preferences");
    add("Visualiser", "Show", () => run("visualizer"), "3d stage view");
    add("Help: every command", "Show", () => run("help"), "commands list");
    // Cues
    (S().cues || []).forEach((c, i) => { if (c) add(`Cue ${window.cueLabel(i)}: ${c.name || ""}`, "Go to cue", () => run(`go ${window.cueLabel(i)}`), `cue ${c.goNote || ""} ${c.scene || ""}`, c.goNote ? `GO: ${c.goNote}` : ""); });
    // Groups
    (S().groups || []).forEach(g => { if (g?.name) add(`Select ${g.name}`, "Group", () => window.selectGroup?.(g), "group select"); });
    // Effects and chases
    Object.values(S().savedEffects || {}).forEach(e => add(`Run effect: ${e.name}`, "Effect", () => window.applySavedEffect?.(e.name), `effect ${e.type}`));
    (S().chases || []).forEach((c, i) => { if (c) add(`Run chase: ${c.name || `Chase ${i + 1}`}`, "Chase", () => run(`chase ${i + 1}`), "chase"); });
    // Lights
    (S().fixtures || []).forEach(f => { if (f) add(`Light ${f.fixtureNumber} · ${window.fixtureLabel ? window.fixtureLabel(f) : f.name}`, "Select", () => run(String(f.fixtureNumber)), `fixture light ${f.name}`); });
    return out;
  }

  // Every word typed must start a word, or be inside one; earlier and
  // tighter matches first.
  function score(item, q) {
    if (!q) return 1;
    let total = 0;
    for (const w of q.split(/\s+/).filter(Boolean)) {
      const i = item.words.indexOf(w);
      if (i < 0) return 0;
      const start = i === 0 || /\W/.test(item.words[i - 1]);
      total += (start ? 10 : 3) + (item.title.toLowerCase().includes(w) ? 5 : 0) - Math.min(i, 40) / 20;
    }
    return total;
  }

  let el = null, list = [], cursor = 0;
  function open() {
    if (el) { el.querySelector("input").select(); return; }
    el = document.createElement("div");
    el.className = "lxp-back";
    el.innerHTML = `<div class="lxp" role="dialog" aria-label="Find anything"><input type="text" placeholder="Find a page, tool, cue, group, effect, light… or type a command" spellcheck="false"><div class="lxp-list"></div><div class="lxp-foot"><span>↑↓ choose · Enter do it · Esc close</span><span>${mac ? "⌘" : "Ctrl+"}K</span></div></div>`;
    document.body.appendChild(el);
    const input = el.querySelector("input");
    const all = items();
    const render = () => {
      const q = input.value.trim().toLowerCase();
      list = all.map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.it);
      if (q && !list.some(it => it.title.toLowerCase() === q)) list.push({ title: `Run command: ${input.value.trim()}`, section: "Command", action: () => run(input.value.trim()), hint: "as if typed on the command line" });
      cursor = Math.min(cursor, Math.max(0, list.length - 1));
      el.querySelector(".lxp-list").innerHTML = list.map((it, i) => `<div class="lxp-item${i === cursor ? " on" : ""}" data-i="${i}"><span class="lxp-sec">${esc(it.section)}</span><span class="lxp-title">${esc(it.title)}</span>${it.hint ? `<span class="lxp-hint">${esc(it.hint)}</span>` : ""}</div>`).join("") || `<div class="lxp-empty">Nothing found</div>`;
      el.querySelector(".lxp-item.on")?.scrollIntoView({ block: "nearest" });
    };
    const choose = i => { const it = list[i]; close(); if (it) setTimeout(() => it.action(), 0); };
    input.addEventListener("input", () => { cursor = 0; render(); });
    input.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(list.length - 1, cursor + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); cursor = Math.max(0, cursor - 1); render(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(cursor); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    el.addEventListener("pointerdown", e => { if (e.target === el) close(); });
    el.querySelector(".lxp-list").addEventListener("click", e => { const row = e.target.closest(".lxp-item"); if (row) choose(Number(row.dataset.i)); });
    render();
    input.focus();
  }
  function close() { el?.remove(); el = null; }

  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); el ? close() : open(); }
  }, true);

  function install(tries = 0) {
    const status = document.querySelector(".topbar-status");
    if (!status) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if (!document.getElementById("lxpButton")) {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "lxpButton";
      b.className = "status-pill lxp-button";
      b.title = `Find anything (${mac ? "⌘" : "Ctrl+"}K)`;
      b.innerHTML = `🔍 <span>Find</span> <kbd>${mac ? "⌘" : "Ctrl+"}K</kbd>`;
      b.addEventListener("click", open);
      status.prepend(b);
    }
  }

  window.LXPalette = { open, close, items };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
