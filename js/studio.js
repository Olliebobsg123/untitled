"use strict";

/*
 * Light Spark's interface: a Mac app in three columns (studio.css).
 *
 * It sits on the same engine as before (State, cues.js, commands, effects,
 * chases, DMX output…) and calls the same functions; only what you see and
 * touch is new. Classic is the default; "ui new" shows this one (the old
 * interface stays underneath, hidden, because the engine still draws into
 * it), "ui classic" goes back.
 *
 *   sidebar   Cues · Lights · Groups · Palettes | Effects · Chases · Patch | tools
 *   content   the list for the sidebar's choice
 *   inspector the chosen cue (on Cues), otherwise the selected lights
 *   GO bar    live / next cue and its GO note, Back, GO, the command line
 */
(function () {
  if (window.LXStudio) return;
  const S = () => window.State || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} return null; };
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const cmd = text => window.parseCommand?.(text);
  const label = i => (window.cueLabel ? window.cueLabel(i) : String(i + 1));
  // The named colours (commands.js keeps them in a script-wide const, not on window).
  const colourTable = () => (typeof cueColours === "object" && cueColours ? cueColours : {});

  // ------------------------------------------------------------------ icons

  const ICON = {
    cues: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1M4 12h1M4 18h1"/>',
    lights: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    groups: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    palettes: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    effects: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    chases: '<path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    patch: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v2M11 9v2M15 9v2M7 15h10"/>',
    viz: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    faders: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" rx="1"/><rect x="10" y="7" width="4" height="3" rx="1"/><rect x="16" y="11" width="4" height="3" rx="1"/>',
    magic: '<path d="M5 19L15 9M14 4v2M19 9h2M17.5 5.5l1.5-1.5M15 9l2 2"/>',
    script: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h6M9.5 16h6"/>',
    tracking: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/>',
    timecode: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    starter: '<path d="M5 19c2-6 6-10 14-14-2 8-6 12-12 14"/><path d="M9 15l-2-2"/>',
    qlab: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    remote: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    sidebar: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/>',
    inspector: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M15 5v14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    power: '<path d="M12 3v8"/><path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    open: '<path d="M3 7h6l2 2h10v10H3z"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24">${ICON[name] || ""}</svg>`;

  // ------------------------------------------------------------------ sidebar

  const SECTIONS = [
    ["Show", [["cues", "Cues"], ["lights", "Lights"], ["groups", "Groups"], ["palettes", "Palettes"]]],
    ["Program", [["effects", "Effects"], ["chases", "Chases"], ["patch", "Patch"]]],
    ["Tools", [["viz", "Visualiser", () => cmd("viz")], ["faders", "Faders", () => legacyPage("faders", "Faders")], ["magic", "Magic Sheet", () => window.LXWindows?.open("magic")], ["script", "Script", () => window.LXWindows?.open("script")], ["tracking", "Tracking Sheet", () => window.LXWindows?.open("tracking")], ["timecode", "Timecode", () => window.LXWindows?.open("timecode")], ["starter", "Show Starter", () => window.LXWindows?.open("starter")], ["qlab", "QLab", () => legacyPage("qlab", "QLab")], ["remote", "Phone Remote", () => document.getElementById("lxRemoteBtn")?.click()]]],
    ["", [["settings", "Settings", () => window.LXPrefs?.open?.()]]]
  ];

  let view = store("lxStudioView") || "cues";
  let pickedCue = null;    // the cue chosen in the list (index)
  let search = "";
  let lastSel = null;      // for shift-click ranges in Lights
  const keys = {};         // what each part was last drawn from

  function counts() {
    const s = S();
    return {
      cues: (s.cues || []).filter(Boolean).length,
      lights: (s.fixtures || []).filter(Boolean).length,
      groups: (s.groups || []).filter(Boolean).length,
      palettes: (s.palettes || []).filter(Boolean).length,
      effects: Object.keys(s.savedEffects || {}).length,
      chases: (s.chases || []).filter(Boolean).length,
      patch: (s.fixtures || []).filter(Boolean).length
    };
  }

  function renderSidebar() {
    const c = counts();
    const key = JSON.stringify([view, c]);
    if (keys.sidebar === key) return;
    keys.sidebar = key;
    $("#stSidebar").innerHTML = SECTIONS.map(([head, items]) => `${head ? `<div class="st-side-head">${head}</div>` : `<div style="height:14px"></div>`}${items.map(([id, name, action]) => `<button type="button" class="st-side-item${id === view ? " on" : ""}" data-view="${id}"${action ? ' data-tool="1"' : ""}>${icon(id)}<span>${name}</span>${c[id] != null ? `<small>${c[id]}</small>` : ""}</button>`).join("")}`).join("");
  }

  function choose(id) {
    const tool = SECTIONS.flatMap(([, items]) => items).find(([i]) => i === id);
    if (tool?.[2]) { tool[2](); return; }
    view = id;
    store("lxStudioView", id);
    search = "";
    pickedCue = null;
    Object.keys(keys).forEach(k => delete keys[k]);
    renderAll();
  }

  // ------------------------------------------------------------------ toolbar

  function renderToolbar() {
    const s = S();
    const name = window.LXShowCommands?.name?.() || "Untitled show";
    const dirty = window.LXShowCommands?.isDirty?.();
    const mode = (window.getConsoleMode?.() || "LIVE").toUpperCase();
    const blind = mode === "BLIND";
    const live = s.currentCue >= 0 && s.cues?.[s.currentCue] ? `Cue ${label(s.currentCue)} · ${s.cues[s.currentCue].name || ""}` : "No cue running";
    const key = JSON.stringify([name, dirty, blind, s.blackout, live]);
    if (keys.toolbar === key) return;
    keys.toolbar = key;
    $("#stTitle").innerHTML = `<b>${esc(String(name).replace(/\.json$/i, ""))}${dirty ? " — Edited" : ""}</b><span>${esc(live)}</span>`;
    $("#stMode").innerHTML = `<button type="button" data-mode="live" class="${blind ? "" : "on"}">Live</button><button type="button" data-mode="blind" class="blind${blind ? " on" : ""}">Blind</button>`;
    $("#stBlackout").classList.toggle("on", Boolean(s.blackout));
  }

  // ------------------------------------------------------------------ content

  function head(title, sub, actions = "", withSearch = false) {
    return `<div class="st-head"><h1>${esc(title)}</h1>${sub ? `<span class="st-sub">${esc(sub)}</span>` : ""}<div class="st-grow"></div>${withSearch ? `<label class="st-search">${icon("search")}<input data-act="search" placeholder="Search" value="${esc(search)}"></label>` : ""}${actions}</div>`;
  }

  function renderContent(force = false) {
    const fn = VIEWS[view] || VIEWS.cues;
    const key = fn.key();
    if (!force && keys.content === key) return;
    keys.content = key;
    const box = $("#stContent");
    const scroller = box.querySelector(".st-body");
    const top = scroller ? scroller.scrollTop : 0;
    const focused = document.activeElement?.dataset?.act === "search";
    box.innerHTML = fn.html();
    const body = box.querySelector(".st-body");
    if (body) body.scrollTop = top;
    if (focused) { const input = box.querySelector('[data-act="search"]'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }
  }

  const fixtureState = f => S().fixtureStates?.get?.(f.id) || {};
  const colourOf = st => {
    if (st.r != null && (st.r || st.g || st.b) && !(st.r === st.g && st.g === st.b)) return `rgb(${st.r},${st.g},${st.b})`;
    const sat = num(st.sat);
    if (sat > 3) return `hsl(${num(st.hue)} ${Math.min(100, sat)}% ${50 + (100 - sat) / 4}%)`;
    return num(st.intensity) > 0 ? "#fffbe8" : "transparent";
  };
  const shortType = f => String(f.name || "").replace(/\s*\(.*\)\s*/g, " ").trim();
  const matches = (...parts) => !search || parts.join(" ").toLowerCase().includes(search.toLowerCase());

  const VIEWS = {
    cues: {
      key: () => JSON.stringify([search, pickedCue, S().currentCue, window.LXCueList?.next?.(), (S().cues || []).map(c => c && [c.number, c.name, c.fade, c.follow, c.followEnabled, c.goNote, c.scene, c.disabled])]),
      html() {
        const s = S();
        const cues = s.cues || [];
        const next = window.LXCueList?.next?.();
        let scene = null;
        const rows = [];
        cues.forEach((c, i) => {
          if (!c || !matches(c.number, c.name, c.goNote, c.scene)) return;
          if (c.scene && c.scene !== scene) { scene = c.scene; rows.push(`<tr class="scene"><td colspan="5">${esc(c.scene)}</td></tr>`); }
          const live = i === s.currentCue, isNext = i === next;
          const then = c.followEnabled ? `${c.followMode === "go" ? "Follow" : "Hang"} ${num(c.follow)}s` : "";
          rows.push(`<tr data-cue="${i}" class="${i === pickedCue ? "sel" : ""}${live ? " live" : ""}"${c.disabled ? ' style="opacity:.45"' : ""}>
            <td class="num" style="width:62px">${live ? '<span class="st-live-dot"></span>' : ""}${esc(label(i))}</td>
            <td class="cue-name">${esc(c.name || `Cue ${label(i)}`)} ${isNext ? '<span class="st-pill">Next</span>' : ""}</td>
            <td class="num" style="width:70px">${(num(c.fade) / 1000).toFixed(1)}s</td>
            <td class="muted" style="width:90px">${esc(then)}</td>
            <td class="muted" style="width:34%">${esc(c.goNote || "")}</td></tr>`);
        });
        const count = cues.filter(Boolean).length;
        return head("Cues", `${count} cue${count === 1 ? "" : "s"}`, `<button type="button" class="st-btn primary" data-act="record">${icon("plus")} Record</button>`, true) +
          `<div class="st-body">${count ? `<table class="st-table"><colgroup><col style="width:72px"><col><col style="width:64px"><col style="width:92px"><col style="width:36%"></colgroup><thead><tr><th>#</th><th>Name</th><th>Fade</th><th>Then</th><th>GO on</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="st-empty"><b>No cues yet</b>Set a look on stage, then Record.</div>`}</div>`;
      }
    },

    lights: {
      key: () => JSON.stringify([search, [...(S().selected || [])], (S().fixtures || []).map(f => f && [f.id, f.fixtureNumber, f.name, f.uni, f.addr]), [...(S().fixtureStates?.entries?.() || [])].map(([id, st]) => [id, Math.round(num(st.intensity)), st.hue, st.sat, st.r, st.g, st.b])]),
      html() {
        const s = S();
        const sel = s.selected || new Set();
        const list = (s.fixtures || []).filter(f => f && matches(f.fixtureNumber, f.name, f.label));
        const rows = list.map(f => {
          const st = fixtureState(f), level = Math.round(num(st.intensity));
          return `<tr data-fix="${esc(f.id)}" class="${sel.has(f.id) ? "sel" : ""}">
            <td class="num" style="width:56px">${esc(f.fixtureNumber ?? "")}</td>
            <td>${esc(f.label || shortType(f))}</td>
            <td class="muted mono" style="width:90px">${f.addr != null ? `${esc(f.uni ?? 1)}/${esc(f.addr)}` : "—"}</td>
            <td style="width:150px"><div class="st-level"><i><b style="width:${level}%"></b></i><em>${level}%</em></div></td>
            <td style="width:30px"><span class="st-swatch" style="background:${colourOf(st)}"></span></td></tr>`;
        }).join("");
        return head("Lights", `${sel.size} of ${(s.fixtures || []).filter(Boolean).length} selected`, `<button type="button" class="st-btn" data-act="sel-none"${sel.size ? "" : " disabled"}>Clear</button><button type="button" class="st-btn" data-act="sel-all">Select All</button>`, true) +
          `<div class="st-body">${list.length ? `<table class="st-table"><colgroup><col style="width:60px"><col><col style="width:84px"><col style="width:170px"><col style="width:34px"></colgroup><thead><tr><th>#</th><th>Name</th><th>Address</th><th>Level</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="st-empty"><b>No lights</b>Add lights in Patch.</div>`}</div>`;
      }
    },

    groups: {
      key: () => JSON.stringify([search, (S().groups || []).map(g => g && [g.name, (g.members || []).length]), [...(S().selected || [])].length]),
      html() {
        const groups = (S().groups || []).filter(g => g && g.name && matches(g.name));
        return head("Groups", "", `<button type="button" class="st-btn" data-act="group-new"${S().selected?.size ? "" : " disabled"}>${icon("plus")} From Selection</button>`, true) +
          `<div class="st-body">${groups.length ? `<div class="st-tiles" style="margin-top:6px">${groups.map(g => `<button type="button" class="st-tile" data-group="${esc(g.name)}"><div class="st-tile-text"><b>${esc(g.name)}</b><small>${(g.members || []).length} light${(g.members || []).length === 1 ? "" : "s"}</small></div></button>`).join("")}</div>` : `<div class="st-empty"><b>No groups</b>Select lights, then From Selection.</div>`}</div>`;
      }
    },

    palettes: {
      key: () => JSON.stringify([search, (S().palettes || []).map(p => p && [p.name, p.category, p.values?.hue, p.values?.sat])]),
      html() {
        const byCat = new Map();
        for (const p of (S().palettes || []).filter(p => p && p.name && matches(p.name, p.category))) {
          const cat = p.category || "General";
          if (!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat).push(p);
        }
        const dot = p => { const v = p.values || {}; if (v.sat != null && num(v.sat) > 0) return `<span class="st-dot" style="background:hsl(${num(v.hue)} ${num(v.sat)}% ${Math.max(40, Math.min(75, num(v.light ?? 50)))}%)"></span>`; if (v.intensity != null) return `<span class="st-dot" style="background:hsl(0 0% ${20 + num(v.intensity) * .7}%)"></span>`; return ""; };
        return head("Palettes", "", `<button type="button" class="st-btn" data-act="palette-new"${S().selected?.size ? "" : " disabled"}>${icon("plus")} From Selection</button>`, true) +
          `<div class="st-body">${byCat.size ? [...byCat].map(([cat, list]) => `<div class="st-section-title">${esc(cat)}</div><div class="st-tiles">${list.map(p => `<button type="button" class="st-tile" data-palette="${esc(p.name)}">${dot(p)}<div class="st-tile-text"><b>${esc(p.name)}</b></div></button>`).join("")}</div>`).join("") : `<div class="st-empty"><b>No palettes</b>Set lights how you like, then From Selection.</div>`}</div>`;
      }
    },

    effects: {
      key: () => JSON.stringify([search, Object.keys(S().savedEffects || {}), (S().effects || []).map(e => [e.id, e.name || e.type])]),
      html() {
        const running = S().effects || [];
        const saved = Object.keys(S().savedEffects || {}).filter(n => matches(n));
        const types = Object.keys(typeof FX_TYPES === "object" && FX_TYPES ? FX_TYPES : {}).filter(t => matches(t));
        return head("Effects", running.length ? `${running.length} running` : "", `<button type="button" class="st-btn" data-act="fx-stop"${running.length ? "" : " disabled"}>Stop All</button><button type="button" class="st-btn" data-act="fx-editor">Effect Editor…</button>`, true) +
          `<div class="st-body">
            ${running.length ? `<div class="st-section-title">Running</div><div class="st-tiles">${running.map(e => `<button type="button" class="st-tile on" data-fx-stop="${esc(e.id)}"><div class="st-tile-text"><b>${esc(e.name || e.type)}</b><small>Click to stop</small></div></button>`).join("")}</div>` : ""}
            <div class="st-section-title">Saved effects</div>
            ${saved.length ? `<div class="st-tiles">${saved.map(n => `<button type="button" class="st-tile" data-fx="${esc(n)}"><div class="st-tile-text"><b>${esc(n)}</b><small>On the selected lights</small></div></button>`).join("")}</div>` : `<div class="st-empty" style="padding:16px">None saved yet.</div>`}
            ${types.length ? `<div class="st-section-title">Quick effects</div><div class="st-tiles">${types.map(t => `<button type="button" class="st-tile" data-fx-type="${esc(t)}"><div class="st-tile-text"><b>${esc(t[0].toUpperCase() + t.slice(1))}</b><small>On the selected lights</small></div></button>`).join("")}</div>` : ""}
          </div>`;
      }
    },

    chases: {
      key: () => JSON.stringify([search, (S().chases || []).map(c => c && [c.name, (c.steps || []).length]), S().currentChase, Boolean(S().chaseTimer)]),
      html() {
        const s = S();
        const running = Number.isInteger(s.currentChase) && s.chaseTimer ? s.currentChase : -1;
        const list = (s.chases || []).map((c, i) => c && { c, i }).filter(x => x && matches(x.c.name));
        return head("Chases", running >= 0 ? "1 running" : "", `<button type="button" class="st-btn" data-act="chase-stop"${running >= 0 ? "" : " disabled"}>Stop</button><button type="button" class="st-btn" data-act="chase-editor">Chase Editor…</button>`, true) +
          `<div class="st-body">${list.length ? `<div class="st-tiles" style="margin-top:6px">${list.map(({ c, i }) => `<button type="button" class="st-tile${i === running ? " on" : ""}" data-chase="${i}"><div class="st-tile-text"><b>${esc(c.name || `Chase ${i + 1}`)}</b><small>${i === running ? "Running — click to stop" : `${(c.steps || []).length || ""} ${(c.steps || []).length ? "steps" : "Click to run"}`}</small></div></button>`).join("")}</div>` : `<div class="st-empty"><b>No chases</b>Make one in the Chase Editor.</div>`}</div>`;
      }
    },

    patch: {
      key: () => JSON.stringify([search, (S().fixtures || []).map(f => f && [f.id, f.fixtureNumber, f.name, f.uni, f.addr])]),
      html() {
        const lib = window.FixtureLibrary || {};
        const list = (S().fixtures || []).filter(f => f && matches(f.fixtureNumber, f.name));
        const rows = list.map(f => {
          const ch = Math.max(1, num(lib[f.name]?.channels) || 1);
          return `<tr><td class="num" style="width:56px">${esc(f.fixtureNumber ?? "")}</td><td>${esc(shortType(f))}</td><td class="mono muted" style="width:110px">${f.addr != null ? `${esc(f.uni ?? 1)}/${esc(f.addr)}–${num(f.addr) + ch - 1}` : "Not patched"}</td><td class="num" style="width:80px">${ch} ch</td></tr>`;
        }).join("");
        return head("Patch", `${list.length} light${list.length === 1 ? "" : "s"}`, `<button type="button" class="st-btn" data-act="patch-advanced">Patch Window…</button><button type="button" class="st-btn primary" data-act="patch-add">${icon("plus")} Add Lights</button>`, true) +
          `<div class="st-body">${list.length ? `<table class="st-table"><colgroup><col style="width:60px"><col><col style="width:130px"><col style="width:90px"></colgroup><thead><tr><th>#</th><th>Light</th><th>Address</th><th>Channels</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="st-empty"><b>Nothing patched</b>Add Lights to start.</div>`}</div>`;
      }
    }
  };

  // ------------------------------------------------------------------ inspector

  let dragging = false;
  function renderInspector(force = false) {
    const box = $("#stInspector");
    if (dragging && !force) return;
    const onCue = view === "cues" && pickedCue != null && S().cues?.[pickedCue];
    const key = onCue ? JSON.stringify(["cue", pickedCue, S().cues[pickedCue]]) : JSON.stringify(["lights", [...(S().selected || [])], [...(S().selected || [])].map(id => S().fixtureStates?.get?.(id)).map(st => st && [st.intensity, st.hue, st.sat, st.strobe, st.zoom, st.focus, st.iris, st.pan, st.tilt]), (window.LXFaders?.data?.().grand)]);
    if (!force && keys.inspector === key) return;
    if (box.contains(document.activeElement) && document.activeElement.matches("input:not([type=range]),textarea,select")) return; // someone's typing there
    keys.inspector = key;
    box.innerHTML = onCue ? cueInspector(pickedCue) : lightsInspector();
    box.querySelectorAll('input[type="range"]').forEach(paint);
  }

  function cueInspector(i) {
    const c = S().cues[i];
    return `<div class="st-insp-title">Cue ${esc(label(i))}</div><div class="st-insp-sub">${i === S().currentCue ? "Live now" : "Not live"}</div>
      <div class="st-group">
        <div class="st-field"><label>Name</label><input data-cue-field="name" value="${esc(c.name || "")}"></div>
        <div class="st-field"><label>GO on (shown under GO)</label><textarea data-cue-field="goNote">${esc(c.goNote || "")}</textarea></div>
        <div class="st-field"><label>Scene / song</label><input data-cue-field="scene" value="${esc(c.scene || "")}"></div>
      </div>
      <div class="st-group">
        <div class="st-field"><label>Fade (seconds)</label><input type="number" min="0" step="0.1" data-cue-field="fade" value="${(num(c.fade) / 1000).toFixed(1)}"></div>
        <div class="st-field"><label>Then</label><select data-cue-field="then"><option value="wait"${!c.followEnabled ? " selected" : ""}>Wait for GO</option><option value="hang"${c.followEnabled && c.followMode !== "go" ? " selected" : ""}>Go on after it finishes</option><option value="follow"${c.followEnabled && c.followMode === "go" ? " selected" : ""}>Go on after its GO</option></select></div>
        ${c.followEnabled ? `<div class="st-field"><label>After (seconds)</label><input type="number" min="0" step="0.1" data-cue-field="follow" value="${num(c.follow)}"></div>` : ""}
      </div>
      <div class="st-row"><button type="button" class="st-btn primary" data-act="cue-go">Go to Cue</button><button type="button" class="st-btn" data-act="cue-next">Make Next</button></div>
      <div class="st-row"><button type="button" class="st-btn" data-act="cue-update" title="Save what's on stage into this cue">Update from Stage</button><button type="button" class="st-btn danger" data-act="cue-delete">Delete</button></div>`;
  }

  function capabilities(ids) {
    const has = new Set();
    for (const id of ids) {
      const f = (S().fixtures || []).find(x => x && x.id === id);
      const map = (window.getFixtureDefinition?.(f) || window.FixtureLibrary?.[f?.name] || {}).map || {};
      for (const k of ["zoom", "focus", "iris", "frost", "gobo", "prism", "pan", "tilt", "strobe"]) if (typeof map[k] === "number") has.add(k);
      if (window.canColour?.(f)) has.add("colour");
    }
    return has;
  }

  function lightsInspector() {
    const s = S();
    const ids = [...(s.selected || [])];
    const grand = num(window.LXFaders?.data?.().grand ?? 100);
    const master = `<div class="st-group"><h3>Grand Master <span>${Math.round(grand)}%</span></h3><div class="st-slider-row"><input type="range" min="0" max="100" value="${grand}" data-set="grand"></div></div>`;
    if (!ids.length) return `<div class="st-insp-title">No lights selected</div><div class="st-insp-sub">Pick lights in Lights or Groups, or type 1 thru 10 below.</div>${master}`;
    const st = s.fixtureStates?.get?.(ids[0]) || {};
    const can = capabilities(ids);
    const slider = (key, name, max, value) => `<div class="st-slider-row"><label>${name}</label><input type="range" min="0" max="${max}" value="${Math.round(num(value))}" data-set="${key}"><em>${Math.round(num(value))}</em></div>`;
    const colours = Object.entries(colourTable());
    const level = Math.round(num(st.intensity));
    return `<div class="st-insp-title">${ids.length} light${ids.length === 1 ? "" : "s"} selected</div><div class="st-insp-sub">${esc(ids.slice(0, 12).map(id => (s.fixtures || []).find(f => f && f.id === id)?.fixtureNumber).join(", "))}${ids.length > 12 ? "…" : ""}</div>
      <div class="st-group"><h3>Intensity <span>${level}%</span></h3>
        <div class="st-slider-row"><input type="range" min="0" max="100" value="${level}" data-set="intensity"></div>
        <div class="st-quick">${[["Out", 0], ["25", 25], ["50", 50], ["75", 75], ["Full", 100]].map(([t, v]) => `<button type="button" data-level="${v}">${t}</button>`).join("")}</div>
      </div>
      ${can.has("colour") ? `<div class="st-group"><h3>Colour <span class="st-swatch" style="background:${colourOf(st)}"></span></h3>
        ${colours.length ? `<div class="st-swatches">${colours.map(([n, c]) => `<button type="button" title="${esc(n)}" data-colour="${esc(n)}" style="background:hsl(${num(c.hue)} ${num(c.sat)}% ${num(c.light ?? 50)}%)"></button>`).join("")}</div>` : ""}
        <div class="st-slider-row"><label>Hue</label><input type="range" class="hue" min="0" max="360" value="${Math.round(num(st.hue))}" data-set="hue"><em>${Math.round(num(st.hue))}°</em></div>
        <div class="st-slider-row"><label>Saturation</label><input type="range" class="sat" min="0" max="100" value="${Math.round(num(st.sat))}" data-set="sat" style="--sat-to:hsl(${num(st.hue)} 100% 50%)"><em>${Math.round(num(st.sat))}%</em></div>
      </div>` : ""}
      ${["zoom", "focus", "iris", "frost", "gobo", "prism"].some(k => can.has(k)) ? `<div class="st-group"><h3>Beam</h3>${["zoom", "focus", "iris", "frost", "gobo", "prism"].filter(k => can.has(k)).map(k => slider(k, k[0].toUpperCase() + k.slice(1), 255, st[k])).join("")}</div>` : ""}
      ${can.has("pan") || can.has("tilt") ? `<div class="st-group"><h3>Position</h3>${slider("pan", "Pan", 255, st.pan ?? 128)}${slider("tilt", "Tilt", 255, st.tilt ?? 128)}<div class="st-quick"><button type="button" data-cmd="home">Home</button></div></div>` : ""}
      <div class="st-group"><h3>Strobe <span>${num(st.strobe) < 1 ? "Off" : Math.round(num(st.strobe))}</span></h3><div class="st-slider-row"><input type="range" min="0" max="255" value="${Math.round(num(st.strobe))}" data-set="strobe"></div><div class="st-quick"><button type="button" data-strobe="0">Off</button><button type="button" data-strobe="60">Slow</button><button type="button" data-strobe="200">Fast</button></div></div>
      ${master}
      <div class="st-row"><button type="button" class="st-btn" data-cmd="highlight">Highlight</button><button type="button" class="st-btn" data-cmd="clear programmer" title="Drop changes made by hand, back to the live cue">Clear Changes</button></div>`;
  }

  function paint(input) {
    const min = num(input.min), max = num(input.max) || 100;
    input.style.setProperty("--p", `${((num(input.value) - min) / (max - min)) * 100}%`);
  }

  // A slider moved: send it (at most every 40 ms while dragging).
  let lastSend = 0, pendingSend = null;
  function setFromSlider(input, final = false) {
    paint(input);
    const key = input.dataset.set, v = num(input.value);
    const em = input.parentElement.querySelector("em");
    if (em) em.textContent = key === "hue" ? `${Math.round(v)}°` : key === "sat" ? `${Math.round(v)}%` : String(Math.round(v));
    const h3 = input.closest(".st-group")?.querySelector("h3 span");
    if (h3 && (key === "intensity" || key === "grand")) h3.textContent = `${Math.round(v)}%`;
    if (key === "hue") input.closest(".st-group")?.querySelector(".sat")?.style.setProperty("--sat-to", `hsl(${v} 100% 50%)`);
    const send = () => {
      lastSend = performance.now();
      const ids = S().selected;
      if (key === "grand") return window.LXFaders?.setGrand?.(v);
      if (key === "intensity") return window.applyLevel?.(v);
      if (key === "hue" || key === "sat") {
        const box = input.closest(".st-group");
        return window.applyColour?.({ hue: num(box.querySelector('[data-set="hue"]').value), sat: num(box.querySelector('[data-set="sat"]').value) });
      }
      window.fadeFixtures?.(ids, { [key]: v }, 0);
      window.updateDMX?.();
    };
    clearTimeout(pendingSend);
    if (final || performance.now() - lastSend > 40) send(); else pendingSend = setTimeout(send, 40);
  }

  // ------------------------------------------------------------------ GO bar

  let lastLogLine = null;
  function renderGoBar() {
    const s = S();
    const next = window.LXCueList?.next?.();
    const nextCue = Number.isInteger(next) && next >= 0 ? s.cues?.[next] : null;
    const liveCue = s.currentCue >= 0 ? s.cues?.[s.currentCue] : null;
    const key = JSON.stringify([s.currentCue, next, liveCue?.name, nextCue?.name, nextCue?.goNote]);
    if (keys.gobar === key) return;
    keys.gobar = key;
    $("#stNext").innerHTML = `<div class="st-live-line">${liveCue ? `<span class="st-live-dot"></span>Live: ${esc(label(s.currentCue))} · ${esc(liveCue.name || "")}` : "Nothing live"}</div>
      <div class="st-next-line">${nextCue ? `Next: ${esc(label(next))} · ${esc(nextCue.name || "")}` : liveCue ? "End of the cue list" : (s.cues || []).some(Boolean) ? "GO plays the first cue" : "No cues yet"}</div>
      ${nextCue?.goNote ? `<div class="st-gonote">GO on ${esc(nextCue.goNote)}</div>` : ""}`;
  }

  // The newest line in the console's log, beside the command line.
  function watchLog() {
    const log = document.getElementById("termLog");
    if (!log) return setTimeout(watchLog, 500);
    const show = () => {
      const line = log.lastElementChild;
      if (!line || line === lastLogLine) return;
      lastLogLine = line;
      const msg = $("#stMsg");
      if (!msg) return;
      const text = line.textContent.trim().replace(/^\d\d:\d\d:\d\d\s*/, "").replace(/^(OK|INFO|WARN|ERROR)\s*/, "");
      msg.textContent = text;
      msg.className = `st-msg ${/warn/i.test(line.className) ? "warn" : /err/i.test(line.className) ? "error" : "ok"}`;
    };
    new MutationObserver(show).observe(log, { childList: true });
    show();
  }

  // ------------------------------------------------------------------ actions

  async function recordCue() {
    const next = window.nextCueNumber?.() ?? 1;
    const answer = await window.LXAsk?.("Record cue", [{ key: "number", label: "Cue number", value: next, type: "number", step: "any", min: 0.001 }, { key: "name", label: "Name", value: "" }], { ok: "Record" });
    if (!answer) return;
    window.recordCue?.(Number(answer.number), answer.name || "");
    const i = window.cueIndexOf?.(Number(answer.number));
    if (i >= 0) pickedCue = i;
  }

  function setCueField(field, value) {
    const c = S().cues?.[pickedCue];
    if (!c) return;
    if (field === "fade") window.setCueFade(c, Math.max(0, num(value) * 1000));
    else if (field === "follow") c.follow = Math.max(0, num(value));
    else if (field === "then") {
      if (value === "wait") c.followEnabled = false;
      else { c.followEnabled = true; c.followMode = value === "follow" ? "go" : "complete"; if (c.follow == null) c.follow = 0; }
      keys.inspector = null;
    } else if (value.trim()) c[field] = value.trim();
    else delete c[field];
    if (field === "goNote") delete c.goNoteFromScript;
    window.renderCues?.();
    window.LXCueList?.refresh?.();
    keys.content = null;
  }

  function selectFixture(id, e) {
    const s = S();
    if (!(s.selected instanceof Set)) s.selected = new Set();
    const order = (s.fixtures || []).filter(Boolean).map(f => f.id);
    if (e.shiftKey && lastSel != null) {
      const a = order.indexOf(lastSel), b = order.indexOf(id);
      if (a >= 0 && b >= 0) for (let k = Math.min(a, b); k <= Math.max(a, b); k++) s.selected.add(order[k]);
    } else if (e.metaKey || e.ctrlKey) {
      s.selected.has(id) ? s.selected.delete(id) : s.selected.add(id);
    } else {
      const only = s.selected.size === 1 && s.selected.has(id);
      s.selected.clear();
      if (!only) s.selected.add(id);
    }
    lastSel = id;
    window.renderFixtures?.();
    window.updateControlsForSelection?.();
  }

  // An old editor (Effects, Chases, Patch, Faders, QLab) in a sheet, until each has its own.
  let legacy = null;
  function legacyPage(id, title) {
    const page = document.getElementById(`page-${id}`);
    if (!page) return window.log?.(`There's no ${title} page`, "warn");
    closeSheet();
    const back = document.createElement("div");
    back.className = "st-sheet-back";
    back.innerHTML = `<div class="st-sheet wide legacy"><div class="st-sheet-head"><h2>${esc(title)}</h2><button type="button" class="st-btn" data-act="sheet-close">Done</button></div><div class="st-sheet-body"></div></div>`;
    document.body.appendChild(back);
    legacy = { page, parent: page.parentElement, next: page.nextSibling, back };
    back.querySelector(".st-sheet-body").appendChild(page);
    page.classList.add("active");
    back.addEventListener("click", e => { if (e.target === back || e.target.closest('[data-act="sheet-close"]')) closeSheet(); });
  }
  function closeSheet() {
    document.querySelectorAll(".st-sheet-back").forEach(b => { if (!legacy || b !== legacy.back) b.remove(); });
    if (!legacy) return;
    legacy.parent.insertBefore(legacy.page, legacy.next);
    legacy.page.classList.remove("active");
    legacy.back.remove();
    legacy = null;
    Object.keys(keys).forEach(k => delete keys[k]);
  }

  // Add lights: pick from the library, how many, where.
  function addLightsSheet() {
    closeSheet();
    const lib = window.FixtureLibrary || {};
    const names = Object.keys(lib).sort((a, b) => a.localeCompare(b));
    const fixtures = (S().fixtures || []).filter(Boolean);
    const nextNumber = Math.max(0, ...fixtures.map(f => num(f.fixtureNumber))) + 1;
    let chosen = "";
    const back = document.createElement("div");
    back.className = "st-sheet-back";
    back.innerHTML = `<div class="st-sheet"><div class="st-sheet-head"><h2>Add Lights</h2></div>
      <div class="st-sheet-body">
        <label class="st-search" style="width:100%;margin-bottom:8px">${icon("search")}<input data-lib-search placeholder="Search ${names.length} lights — e.g. Showtec par" autofocus></label>
        <div class="st-lib" data-lib></div>
        <div class="st-form">
          <div class="st-field"><label>How many</label><input type="number" min="1" max="96" value="1" data-f="qty"></div>
          <div class="st-field"><label>First number</label><input type="number" min="1" value="${nextNumber}" data-f="number"></div>
          <div class="st-field"><label>Universe</label><input type="number" min="1" value="1" data-f="uni"></div>
          <div class="st-field"><label>Address</label><input type="number" min="1" max="512" value="${nextFree(1)}" data-f="addr"></div>
        </div>
      </div>
      <div class="st-sheet-foot"><span class="st-msg" data-msg style="margin-right:auto;max-width:60%"></span><button type="button" class="st-btn" data-act="sheet-cancel">Cancel</button><button type="button" class="st-btn primary" data-act="sheet-add" disabled>Add</button></div></div>`;
    document.body.appendChild(back);
    const q = sel => back.querySelector(sel);
    const draw = text => {
      const t = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
      const list = names.filter(n => t.every(w => n.toLowerCase().includes(w))).slice(0, 200);
      q("[data-lib]").innerHTML = list.map(n => `<button type="button" data-name="${esc(n)}" class="${n === chosen ? "on" : ""}">${esc(n)}<small>${num(lib[n]?.channels) || 1} ch</small></button>`).join("") || `<div class="st-empty" style="padding:20px">No lights match</div>`;
    };
    draw("");
    q("[data-lib-search]").addEventListener("input", e => draw(e.target.value));
    q("[data-lib-search]").addEventListener("keydown", e => e.stopPropagation());
    back.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => e.stopPropagation()));
    q("[data-lib]").addEventListener("click", e => {
      const b = e.target.closest("[data-name]");
      if (!b) return;
      chosen = b.dataset.name;
      q('[data-act="sheet-add"]').disabled = false;
      q('[data-f="addr"]').value = nextFree(num(q('[data-f="uni"]').value) || 1);
      draw(q("[data-lib-search]").value);
    });
    q('[data-f="uni"]').addEventListener("change", e => { q('[data-f="addr"]').value = nextFree(num(e.target.value) || 1); });
    back.addEventListener("click", e => {
      if (e.target === back || e.target.closest('[data-act="sheet-cancel"]')) return back.remove();
      if (!e.target.closest('[data-act="sheet-add"]')) return;
      const before = (S().fixtures || []).filter(Boolean).length;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set("patchName", chosen);
      set("patchQty", q('[data-f="qty"]').value);
      set("patchFixtureNumber", q('[data-f="number"]').value);
      set("patchUni", q('[data-f="uni"]').value);
      set("patchAddr", q('[data-f="addr"]').value);
      document.getElementById("btnPatch")?.click();
      const added = (S().fixtures || []).filter(Boolean).length - before;
      if (added > 0) back.remove();
      else q("[data-msg]").textContent = $("#stMsg")?.textContent || "Couldn't add those lights";
    });
  }

  // The first address on a universe after every light patched there.
  function nextFree(uni) {
    const lib = window.FixtureLibrary || {};
    let end = 0;
    for (const f of (S().fixtures || []).filter(Boolean)) if (num(f.uni || 1) === uni && f.addr != null) end = Math.max(end, num(f.addr) + Math.max(1, num(lib[f.name]?.channels) || 1) - 1);
    return Math.min(512, end + 1);
  }

  function onClick(e) {
    const t = e.target;
    const side = t.closest("[data-view]");
    if (side) return choose(side.dataset.view);
    const modeBtn = t.closest("[data-mode]");
    if (modeBtn) return document.getElementById(modeBtn.dataset.mode === "blind" ? "consoleModeBlind" : "consoleModeLive")?.click();
    const act = t.closest("[data-act]")?.dataset.act;
    switch (act) {
      case "go": return window.goNextCue ? window.goNextCue() : cmd("go");
      case "back": return window.goPreviousCue ? window.goPreviousCue() : cmd("back");
      case "blackout": return cmd("blackout");
      case "viz": return cmd("viz");
      case "save": return cmd("save");
      case "open": return window.LXShowCommands?.open?.();
      case "toggle-sidebar": return toggle("sidebar");
      case "toggle-inspector": return toggle("inspector");
      case "record": return recordCue();
      case "sel-all": return cmd("select all");
      case "sel-none": return cmd("select none");
      case "group-new": return window.LXAsk?.("New group", [{ key: "name", label: "Name", value: "" }], { ok: "Make Group" }).then(a => a?.name && cmd(`group = ${a.name}`));
      case "palette-new": return window.LXAsk?.("New palette", [{ key: "name", label: "Name", value: "" }], { ok: "Save Palette" }).then(a => a?.name && cmd(`record palette ${a.name}`));
      case "fx-stop": return cmd("kill effects");
      case "fx-editor": return legacyPage("effects", "Effect Editor");
      case "chase-stop": return window.stopChase?.();
      case "chase-editor": return legacyPage("chases", "Chase Editor");
      case "patch-add": return addLightsSheet();
      case "patch-advanced": return legacyPage("patch", "Patch");
      case "cue-go": return window.goToCue?.(pickedCue);
      case "cue-next": return window.LXCueList?.setNext?.(pickedCue);
      case "cue-update": return cmd(`update cue ${label(pickedCue)}`);
      case "cue-delete": {
        const n = label(pickedCue), c = S().cues[pickedCue];
        return window.LXAsk?.(`Delete cue ${n}?`, [], { ok: "Delete", message: `“${c?.name || ""}” is removed from the cue list.`, safe: true }).then(ok => { if (ok) { window.deleteCue?.(Number(n)); pickedCue = null; keys.inspector = null; } });
      }
    }
    const cueRow = t.closest("tr[data-cue]");
    if (cueRow) { pickedCue = Number(cueRow.dataset.cue); keys.content = keys.inspector = null; renderContent(); renderInspector(true); return; }
    const fixRow = t.closest("tr[data-fix]");
    if (fixRow) {
      const f = (S().fixtures || []).find(x => x && String(x.id) === fixRow.dataset.fix);
      if (f) selectFixture(f.id, e);
      return;
    }
    const group = t.closest("[data-group]");
    if (group) { const g = (S().groups || []).find(x => x?.name === group.dataset.group); if (g) window.selectGroup?.(g); window.renderFixtures?.(); return; }
    const pal = t.closest("[data-palette]");
    if (pal) return cmd(`palette ${pal.dataset.palette}`);
    const fx = t.closest("[data-fx]");
    if (fx) return window.applySavedEffect?.(fx.dataset.fx);
    const fxType = t.closest("[data-fx-type]");
    if (fxType) return cmd(`effect ${fxType.dataset.fxType}`);
    const fxStop = t.closest("[data-fx-stop]");
    if (fxStop) return window.stopEffectById?.(fxStop.dataset.fxStop);
    const chase = t.closest("[data-chase]");
    if (chase) { const i = Number(chase.dataset.chase); const s = S(); return s.currentChase === i && s.chaseTimer ? window.stopChase?.() : window.startChase?.(i); }
    const level = t.closest("[data-level]");
    if (level) return window.applyLevel?.(Number(level.dataset.level));
    const colour = t.closest("[data-colour]");
    if (colour) { const c = colourTable()[colour.dataset.colour]; if (c) window.applyColour?.(c); return; }
    const strobe = t.closest("[data-strobe]");
    if (strobe) { window.fadeFixtures?.(S().selected, { strobe: Number(strobe.dataset.strobe) }, 0); window.updateDMX?.(); return; }
    const c = t.closest("[data-cmd]");
    if (c) return cmd(c.dataset.cmd);
  }

  function toggle(part) {
    const main = $(".st-main");
    main.classList.toggle(`no-${part}`);
    store(`lxStudioHide-${part}`, main.classList.contains(`no-${part}`) ? "1" : null);
  }

  // ------------------------------------------------------------------ build

  function build() {
    if (document.getElementById("studio")) return;
    const root = document.createElement("div");
    root.id = "studio";
    root.innerHTML = `
      <header class="st-toolbar">
        <button type="button" class="st-tool icon" data-act="toggle-sidebar" title="Show or hide the sidebar">${icon("sidebar")}</button>
        <div class="st-title" id="stTitle"></div>
        <div class="st-grow"></div>
        <button type="button" class="st-tool icon" data-act="open" title="Open a show">${icon("open")}</button>
        <button type="button" class="st-tool icon" data-act="save" title="Save the show (⌘S)">${icon("save")}</button>
        <div class="st-seg" id="stMode"></div>
        <button type="button" class="st-tool" data-act="viz" title="The 3D visualiser">${icon("viz")} Visualiser</button>
        <button type="button" class="st-tool danger" id="stBlackout" data-act="blackout" title="Everything off (again to undo)">${icon("power")} Blackout</button>
        <button type="button" class="st-tool icon" data-act="toggle-inspector" title="Show or hide the inspector">${icon("inspector")}</button>
      </header>
      <div class="st-main">
        <nav class="st-sidebar" id="stSidebar"></nav>
        <section class="st-content" id="stContent"></section>
        <aside class="st-inspector" id="stInspector"></aside>
      </div>
      <footer class="st-gobar">
        <div class="st-next" id="stNext"></div>
        <div class="st-go-buttons">
          <button type="button" class="st-btn st-back" data-act="back">${icon("back")} Back</button>
          <button type="button" class="st-btn st-go" data-act="go">GO</button>
        </div>
        <div class="st-cmd" id="stCmd"><span class="st-msg" id="stMsg"></span></div>
      </footer>`;
    document.body.appendChild(root);
    if (store("lxStudioHide-sidebar")) $(".st-main").classList.add("no-sidebar");
    if (store("lxStudioHide-inspector")) $(".st-main").classList.add("no-inspector");
    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", e => { const row = e.target.closest("tr[data-cue]"); if (row) window.goToCue?.(Number(row.dataset.cue)); });
    root.addEventListener("input", e => {
      if (e.target.matches('[data-act="search"]')) { search = e.target.value; keys.content = null; renderContent(); return; }
      if (e.target.matches('input[type="range"][data-set]')) { dragging = true; setFromSlider(e.target); }
    });
    root.addEventListener("change", e => {
      if (e.target.matches('input[type="range"][data-set]')) { setFromSlider(e.target, true); dragging = false; return; }
      const field = e.target.dataset.cueField;
      if (field) setCueField(field, e.target.value);
    });
    root.addEventListener("pointerup", () => { if (dragging) setTimeout(() => { dragging = false; }, 300); });
    // Typing in the inspector's boxes isn't the console's keyboard shortcuts.
    root.addEventListener("keydown", e => { if (e.target.matches("#stInspector input:not([type=range]), #stInspector textarea, #stContent input")) e.stopPropagation(); });
    // The command line moves in (autocomplete, history and keypad come with it).
    const line = document.querySelector("body > .cmd-line") || document.querySelector(".cmd-line");
    if (line) $("#stCmd").prepend(line);
    watchLog();
    renderAll(true);
    setInterval(() => { if (isOn()) renderAll(); }, 250);
  }

  function renderAll(force = false) {
    if (force) Object.keys(keys).forEach(k => delete keys[k]);
    renderToolbar();
    renderSidebar();
    renderContent();
    renderInspector();
    renderGoBar();
  }

  // ------------------------------------------------------------------ on / off

  const isOn = () => document.documentElement.dataset.ui === "studio";
  function setUi(which) {
    const on = which !== "classic";
    store("lxUi", on ? "studio" : "classic");
    document.documentElement.dataset.ui = on ? "studio" : "classic";
    window.LXApp?.setUi?.(on ? "studio" : "classic");
    // The command line lives in whichever interface is showing.
    const line = document.querySelector(".cmd-line");
    if (line) {
      if (on) $("#stCmd")?.prepend(line);
      else document.querySelector(".bottom-row")?.after(line);
    }
    closeSheet();
    if (on) renderAll(true);
    window.log?.(on ? "The new interface — \"ui classic\" for the old one" : "The old interface — \"ui new\" for the new one", "ok");
  }

  function command(c) {
    if (/^(ui|interface) (classic|old)$/.test(c)) { setUi("classic"); return true; }
    if (/^(ui|interface) (new|studio|mac)$/.test(c)) { setUi("studio"); return true; }
    return false;
  }

  window.LXStudio = { setUi, command, choose, render: () => renderAll(true), isOn };
  const boot = () => { build(); if (isOn()) { const line = document.querySelector(".cmd-line"); if (line) $("#stCmd").prepend(line); } else { const line = $("#stCmd .cmd-line"); if (line) document.querySelector(".bottom-row")?.after(line); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
