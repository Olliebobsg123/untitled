// Handy commands for checking on the console during a session.
//
//   errors            what's gone wrong this session, and how often (window)
//   errors clear      start counting again
//   check             a health check of the show and outputs (window)
//   stats             how long it's been running, GOs, commands, errors…
//   clashes           fixtures whose DMX addresses overlap
//   address 5         where fixture 5 is patched
//   dmx 5             the DMX values fixture 5 is sending right now
//   locate 5          fixture 5 to full, open white, centred (to find it)
//   history           the last commands typed
//   version           which Light Spark this is
//
// Errors are collected from the start: page errors, failed promises,
// console errors, and warnings/errors written to the command line log.
(function () {
  if (window.LXExtraCommands) return;
  const startedAt = Date.now();
  const issues = [];                // { at, level, text, count, where }
  const counts = { error: 0, warn: 0 };
  let gos = 0, commands = 0;
  const typed = [];
  const MAX = 300;

  function note(level, text, where = "") {
    text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (!text) return;
    counts[level] = (counts[level] || 0) + 1;
    const same = issues.find(i => i.level === level && i.text === text);
    if (same) { same.count++; same.at = Date.now(); }
    else { issues.unshift({ at: Date.now(), level, text, count: 1, where }); if (issues.length > MAX) issues.pop(); }
    refreshWindow();
  }

  window.addEventListener("error", e => note("error", e.message || String(e.error || "Script error"), e.filename ? `${e.filename.split("/").pop()}:${e.lineno}` : ""));
  window.addEventListener("unhandledrejection", e => note("error", e.reason?.message || String(e.reason || "A promise failed"), "promise"));
  // Connection retries (QLab not open, a link reconnecting) are warnings, not errors.
  const NOISE = /bridge error|ERR_CONNECTION|ERR_INTERNET|ECONNREFUSED|WebSocket (connection|error)|Failed to load resource/i;
  const consoleError = console.error.bind(console);
  console.error = function (...args) {
    try { const text = args.map(a => (a instanceof Error ? a.message : String(a))).join(" "); note(NOISE.test(text) ? "warn" : "error", args.map(a => (a instanceof Error ? a.message : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(" "), "console"); } catch (_) {}
    return consoleError(...args);
  };

  // Warnings and errors shown in the command line log (wrapped once, when it exists).
  (function hookLog() {
    if (typeof window.log !== "function") return setTimeout(hookLog, 200);
    if (window.log.__lxErrors) return;
    const base = window.log;
    const wrapped = function (msg, type = "info") {
      const t = String(type).toLowerCase();
      if (t === "error" || t === "warn" || t === "warning") note(t === "error" ? "error" : "warn", msg, "log");
      return base.apply(this, arguments);
    };
    Object.assign(wrapped, base);
    wrapped.__lxErrors = true;
    window.log = wrapped;
  })();

  // Count GOs and typed commands for "stats".
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target?.id !== "cmdInput") return;
    const v = String(e.target.value || "").trim();
    if (!v) return;
    commands++;
    typed.unshift({ at: Date.now(), text: v });
    if (typed.length > 50) typed.pop();
  }, true);
  window.addEventListener("lx-cue-go", () => { gos++; });
  let lastCue = null;
  setInterval(() => { const c = window.State?.currentCue; if (c != null && c !== lastCue) { if (lastCue !== null && c >= 0) gos++; lastCue = c; } }, 250);

  // ------------------------------------------------------------ helpers

  const say = (m, l = "ok") => window.log?.(m, l);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const S = () => window.State || {};
  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const byNumber = n => (S().fixtures || []).find(f => f && Number(f.fixtureNumber) === Number(n)) || null;
  const channelsOf = f => Number(defOf(f).channels) || Math.max(1, ...Object.values(defOf(f).map || {}).filter(Number.isInteger).map(c => c + 1));
  const ago = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
  const clock = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function clashes() {
    const used = [];
    for (const f of S().fixtures || []) {
      if (!f || f.addr == null) continue;
      const uni = Number(f.uni) || 1, a = Number(f.addr), n = channelsOf(f);
      used.push({ f, uni, a, b: a + n - 1 });
    }
    const out = [];
    for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
      const x = used[i], y = used[j];
      if (x.uni === y.uni && x.a <= y.b && y.a <= x.b) out.push(`#${x.f.fixtureNumber} (${x.uni}/${x.a}–${x.b}) and #${y.f.fixtureNumber} (${y.uni}/${y.a}–${y.b})`);
    }
    return out;
  }

  // ------------------------------------------------------------ windows

  let errorsBody = null, checkBody = null;
  function renderErrors() {
    if (!errorsBody) return;
    const rows = issues.slice(0, 120).map(i => `<tr class="${i.level}"><td>${clock(i.at)}</td><td>${i.level === "error" ? "Error" : "Warning"}</td><td>${i.count > 1 ? `×${i.count}` : ""}</td><td>${esc(i.text)}${i.where ? ` <small>${esc(i.where)}</small>` : ""}</td></tr>`).join("");
    errorsBody.innerHTML = `
      <div class="lxx">
        <div class="lxx-sum"><b class="${counts.error ? "bad" : "ok"}">${counts.error} error${counts.error === 1 ? "" : "s"}</b><b class="${counts.warn ? "warn" : "ok"}">${counts.warn} warning${counts.warn === 1 ? "" : "s"}</b><span>this session (${ago(Date.now() - startedAt)})</span><button type="button" class="btn-secondary" data-x="clear">Clear</button></div>
        ${rows ? `<table>${rows}</table>` : `<p class="lxx-empty">Nothing has gone wrong this session.</p>`}
      </div>`;
    errorsBody.querySelector("[data-x=clear]")?.addEventListener("click", () => clearErrors());
  }
  let refreshTimer = null;
  function refreshWindow() { if (errorsBody && !refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; renderErrors(); }, 300); }

  function checks() {
    const s = S(), fixtures = (s.fixtures || []).filter(Boolean), list = [];
    const add = (ok, title, detail) => list.push({ ok, title, detail });
    const mode = document.documentElement.dataset.consoleMode;
    add(mode !== "blind", "Output", mode === "blind" ? "BLIND — nothing goes out to the lights" : "LIVE");
    add(!s.blackout, "Blackout", s.blackout ? "On — output is held at 0 (press BLACKOUT to release)" : "Off");
    add(!window.__lxOutputHeld, "Multi-console", window.__lxOutputHeld ? "This console is following another one (output held)" : "Driving the lights");
    let outputs = [];
    try { outputs = JSON.parse(localStorage.getItem("lighting-multi-outputs") || "[]"); } catch (_) {}
    const enabled = outputs.filter(o => o?.enabled);
    add(enabled.length > 0, "DMX outputs", enabled.length ? enabled.map(o => `${String(o.protocol || "").toUpperCase()} U${o.universe} → ${o.target || "broadcast"}`).join(", ") : "None turned on (Preferences → Outputs)");
    add(fixtures.length > 0, "Patch", `${fixtures.length} fixture${fixtures.length === 1 ? "" : "s"}`);
    const c = clashes();
    add(!c.length, "Address clashes", c.length ? c.slice(0, 6).join("; ") + (c.length > 6 ? ` … and ${c.length - 6} more` : "") : "None");
    const noAddr = fixtures.filter(f => f.addr == null || Number(f.addr) < 1 || Number(f.addr) + channelsOf(f) - 1 > 512);
    add(!noAddr.length, "Addresses in range", noAddr.length ? noAddr.map(f => `#${f.fixtureNumber}`).join(", ") + " not patched or past channel 512" : "All fixtures fit in their universe");
    const unknown = fixtures.filter(f => !Object.keys(defOf(f).map || {}).length);
    add(!unknown.length, "Fixture types", unknown.length ? `${unknown.map(f => `#${f.fixtureNumber} ${f.name}`).join(", ")} — not in the library` : "All known");
    const cues = (s.cues || []).filter(Boolean);
    add(cues.length > 0, "Cues", `${cues.length} cue${cues.length === 1 ? "" : "s"}${s.currentCue >= 0 ? `, cue ${window.cueLabel(s.currentCue)} live` : ""}`);
    const ids = new Set(fixtures.map(f => f.id));
    const ghost = cues.filter(q => (q.fixtureStates || []).some(([id]) => !ids.has(id))).length;
    add(true, "Cues and patch", ghost ? `${ghost} cue${ghost === 1 ? "" : "s"} still mention unpatched fixtures (harmless)` : "Match");
    const dirty = window.LXShowCommands?.isDirty?.();
    add(!dirty, "Saved", window.LXShowCommands?.current?.() ? `${window.LXShowCommands.name()}${dirty ? " — has unsaved changes" : " — saved"}` : "Not saved yet");
    add(!counts.error, "Errors this session", `${counts.error} error${counts.error === 1 ? "" : "s"}, ${counts.warn} warning${counts.warn === 1 ? "" : "s"} (type errors)`);
    return list;
  }
  function renderCheck() {
    if (!checkBody) return;
    const list = checks(), bad = list.filter(x => !x.ok).length;
    checkBody.innerHTML = `<div class="lxx"><div class="lxx-sum"><b class="${bad ? "warn" : "ok"}">${bad ? `${bad} thing${bad === 1 ? "" : "s"} to look at` : "All good"}</b><button type="button" class="btn-secondary" data-x="again">Check again</button></div>
      <table>${list.map(x => `<tr class="${x.ok ? "" : "warn"}"><td>${x.ok ? "✓" : "⚠"}</td><td><b>${esc(x.title)}</b></td><td>${esc(x.detail)}</td></tr>`).join("")}</table></div>`;
    checkBody.querySelector("[data-x=again]")?.addEventListener("click", renderCheck);
  }

  function registerWindows() {
    const W = window.LXWindows;
    if (!W) return setTimeout(registerWindows, 300);
    if (!W.list().includes("errors")) W.register({ id: "errors", title: "Errors", build: host => { errorsBody = host; renderErrors(); }, onClose: () => { errorsBody = null; }, w: 640, h: 420 });
    if (!W.list().includes("check")) W.register({ id: "check", title: "Show Check", build: host => { checkBody = host; renderCheck(); }, onClose: () => { checkBody = null; }, w: 620, h: 460 });
    const style = document.createElement("style");
    style.textContent = `
      .lxx{display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--text,#dfe7e5)}
      .lxx-sum{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .lxx-sum b{font-size:14px}.lxx-sum span{color:#a2acb2;font-size:13px}.lxx-sum button{margin-left:auto;height:24px;font-size:13px}
      .lxx .ok{color:#6fe08e}.lxx .warn,.lxx tr.warn td:first-child{color:#ffd27a}.lxx .bad,.lxx tr.error td:nth-child(2){color:#ff98a3}
      .lxx table{border-collapse:collapse;width:100%}
      .lxx td{padding:4px 6px;border-top:1px solid rgba(255,255,255,.06);vertical-align:top}
      .lxx td:first-child{white-space:nowrap;color:#a2acb2;font-variant-numeric:tabular-nums}
      .lxx small{color:#a2acb2}.lxx-empty{color:#a2acb2}
    `;
    document.head.appendChild(style);
  }

  function clearErrors() { issues.length = 0; counts.error = 0; counts.warn = 0; renderErrors(); }

  // ----------------------------------------------------------- commands

  function handle(raw) {
    const c = String(raw ?? "").trim().toLowerCase();
    let m;
    if (c === "errors" || c === "error" || c === "errors list") {
      window.LXWindows?.open("errors"); renderErrors();
      return say(`${counts.error} error${counts.error === 1 ? "" : "s"} and ${counts.warn} warning${counts.warn === 1 ? "" : "s"} this session`, counts.error ? "warn" : "ok"), true;
    }
    if (c === "errors clear" || c === "clear errors") { clearErrors(); return say("Error count cleared"), true; }
    if (c === "check" || c === "show check" || c === "health") { window.LXWindows?.open("check"); renderCheck(); const bad = checks().filter(x => !x.ok).length; return say(bad ? `Show check: ${bad} thing${bad === 1 ? "" : "s"} to look at` : "Show check: all good", bad ? "warn" : "ok"), true; }
    if (c === "stats" || c === "session" || c === "uptime") {
      const s = S();
      return say(`Running ${ago(Date.now() - startedAt)} · ${commands} command${commands === 1 ? "" : "s"} · ${gos} GO${gos === 1 ? "" : "s"} · ${(s.fixtures || []).filter(Boolean).length} fixtures · ${(s.cues || []).filter(Boolean).length} cues · ${counts.error} errors, ${counts.warn} warnings`), true;
    }
    if (c === "clashes" || c === "address clashes") { const list = clashes(); return say(list.length ? `Address clashes: ${list.join("; ")}` : "No DMX address clashes", list.length ? "warn" : "ok"), true; }
    if ((m = c.match(/^(?:address|where|whereis)\s+(\d+)$/))) {
      const f = byNumber(m[1]); if (!f) return say(`There's no fixture ${m[1]}`, "warn"), true;
      const n = channelsOf(f), a = Number(f.addr);
      return say(`#${f.fixtureNumber} ${f.name} · universe ${f.uni || 1} · channels ${a}–${a + n - 1} (${n} ch)`), true;
    }
    if ((m = c.match(/^dmx\s+(\d+)$/))) {
      const f = byNumber(m[1]); if (!f) return say(`There's no fixture ${m[1]}`, "warn"), true;
      const base = typeof window.getFixtureBaseAddress === "function" ? window.getFixtureBaseAddress(f) : -1;
      if (base < 0) return say(`#${f.fixtureNumber} isn't patched`, "warn"), true;
      const n = channelsOf(f), dmx = S().dmx || [];
      const names = Object.fromEntries(Object.entries(defOf(f).map || {}).filter(([, v]) => Number.isInteger(v)).map(([k, v]) => [v, k]));
      const vals = Array.from({ length: n }, (_, i) => `${i + 1}${names[i] ? ` ${names[i]}` : ""}=${dmx[base + i] ?? 0}`);
      return say(`#${f.fixtureNumber} DMX: ${vals.join(" · ")}`), true;
    }
    if ((m = c.match(/^locate\s+(.+)$/))) {
      // Full, open white, pan/tilt centred, no gobo/prism/strobe: find it on stage.
      window.parseCommand?.(`${m[1]} @ full white home`);
      window.parseCommand?.(`${m[1]} gobo 0 prism 0 strobe off`);
      return true;
    }
    if (c === "history") {
      return say(typed.length > 1 ? `Last commands: ${typed.slice(1, 16).map(t => t.text).join(" · ")}` : "No commands typed yet"), true;
    }
    if (c === "version" || c === "about") return say(`Light Spark ${window.LXApp?.version || ""}${window.LXApp?.platform ? ` on ${window.LXApp.platform}` : ""}`), true;
    return false;
  }

  function install() {
    const previous = window.parseCommand;
    if (typeof previous !== "function") return setTimeout(install, 300);
    const wrapped = function (raw) {
      try { if (handle(raw)) return; } catch (e) { note("error", e.message, "command"); }
      return previous.apply(this, arguments);
    };
    Object.assign(wrapped, previous);
    window.parseCommand = wrapped; // once: never re-wrapped (see command-line.js)
  }

  window.LXExtraCommands = Object.freeze({ errors: () => issues.slice(), counts: () => ({ ...counts }), checks, clashes, handle });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { install(); registerWindows(); }, { once: true });
  else { install(); registerWindows(); }
})();
