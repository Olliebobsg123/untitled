"use strict";

// Renderer side of the phone remote. Publishes a compact snapshot of the show
// to the main process (which relays it to paired phones) and runs commands
// coming back through the same functions the desk UI uses.
(function initialiseRemote() {
  const bridge = window.LXRemote;
  if (!bridge) return;

  const S = () => window.State || {};
  let lastLog = null, logSeq = 0;

  // Surface console feedback ("Cue 9 not found", …) on the phone as a toast.
  const originalLog = window.log;
  if (typeof originalLog === "function") {
    window.log = function remoteLog(msg, type) {
      lastLog = { id: ++logSeq, msg: String(msg), type: type || "info" };
      return originalLog.apply(this, arguments);
    };
  }

  function buildSnapshot() {
    const s = S();
    const fixtures = Array.isArray(s.fixtures) ? s.fixtures : [];
    const selected = s.selected instanceof Set ? s.selected : new Set();
    const master = document.getElementById("master");
    const cur = s.current || {};
    return {
      type: "state",
      mode: typeof window.getConsoleMode === "function" ? window.getConsoleMode() : null,
      blackout: !!s.blackout,
      master: master ? Number(master.value) : 100,
      intensity: Number(cur.intensity ?? 100),
      hue: Number(cur.hue ?? 0),
      sat: Number(cur.sat ?? 0),
      strobe: Number(cur.strobe ?? 0),
      currentCue: Number.isInteger(s.currentCue) ? s.currentCue : -1,
      cues: (Array.isArray(s.cues) ? s.cues : []).map((q, i) => q ? { i, number: window.cueLabel ? window.cueLabel(i) : String(i + 1), name: q.name || "Cue", fade: q.fade ?? 800 } : null),
      groups: (Array.isArray(s.groups) ? s.groups : []).map(g => ({ name: g.name, count: (g.members || []).length })),
      palettes: (Array.isArray(s.palettes) ? s.palettes : []).map(p => ({ name: p.name })),
      chases: (Array.isArray(s.chases) ? s.chases : []).map((c, i) => ({ i, name: c?.name || `Chase ${i + 1}` })),
      activeChase: Number.isInteger(s.currentChase) && s.chaseTimer ? s.currentChase : -1,
      fixtures: fixtures.map((f, i) => ({ id: f.id, num: f.fixtureNumber ?? i + 1, name: f.name || `Fixture ${i + 1}`, sel: selected.has(f.id) })),
      colours: typeof cueColours !== "undefined" ? Object.keys(cueColours) : [],
      log: lastLog
    };
  }

  let lastJson = "";
  function publish(force) {
    let json;
    try { json = JSON.stringify(buildSnapshot()); } catch (_) { return; }
    if (!force && json === lastJson) return;
    lastJson = json;
    bridge.publish(json);
  }
  setInterval(publish, 200);

  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const has = name => typeof window[name] === "function";
  const refreshSelection = () => { window.renderFixtures?.(); window.updateControlsForSelection?.(); window.updateDMX?.(); };

  const handlers = {
    go() { has("goNextCue") ? window.goNextCue() : window.parseCommand("go"); },
    back() { has("goPreviousCue") ? window.goPreviousCue() : window.parseCommand("back"); },
    cue(m) { const i = Number(m.index); if (Number.isInteger(i) && S().cues?.[i] && has("goToCue")) window.goToCue(i); },
    group(m) { const g = S().groups?.find(x => x.name === m.name); if (g && has("selectGroup")) window.selectGroup(g); },
    palette(m) { window.Palettes?.apply?.(String(m.name)); },
    chase(m) { if (has("startChase")) window.startChase(Number(m.index)); },
    stopChase() { if (has("stopChase")) window.stopChase(); },
    master(m) {
      const el = document.getElementById("master");
      if (!el) return;
      el.value = String(num(m.value, 0, 100));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    intensity(m) { if (has("applyLevel")) window.applyLevel(num(m.value, 0, 100)); },
    colour(m) { if (has("applyColour")) window.applyColour({ hue: num(m.hue, 0, 360), sat: num(m.sat, 0, 100) }); },
    colourName(m) { const c = typeof cueColours !== "undefined" ? cueColours[String(m.name)] : null; if (c && has("applyColour")) window.applyColour(c); },
    strobe(m) { if (has("fadeFixtures")) window.fadeFixtures(S().selected, { strobe: num(m.value, 0, 255) }, 0); },
    blackout(m) { if (has("setBlackout")) window.setBlackout(!!m.on); },
    select(m) {
      const s = S(); if (!(s.selected instanceof Set)) return;
      if (m.mode === "all") s.fixtures.forEach(f => s.selected.add(f.id));
      else if (m.mode === "none") s.selected.clear();
      else if (m.id != null) s.selected.has(m.id) ? s.selected.delete(m.id) : s.selected.add(m.id);
      refreshSelection();
    },
    record(m) {
      const name = String(m.name || "").trim().replace(/[\r\n]+/g, " ").slice(0, 60);
      const n = Number(m.number);
      if (window.parseCueNumber?.(n) != null && has("recordCue")) window.recordCue(n, name || "");
    },
    cmd(m) { const c = String(m.text || "").trim(); if (c && has("parseCommand")) window.parseCommand(c); },
    hello() { publish(true); }
  };

  bridge.onCommand(msg => {
    try { handlers[msg.type]?.(msg); } catch (err) { console.error("[REMOTE] command failed:", msg?.type, err); }
    publish();
  });

  // ---- Console-side pairing panel -------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    #lxRemoteBtn{position:fixed;right:14px;bottom:14px;z-index:9998;padding:7px 12px;border-radius:999px;border:1px solid #3a4a5c;background:#131a22;color:#cfe3f7;font:600 12px system-ui;cursor:pointer;opacity:.85}
    #lxRemoteBtn.on{border-color:#2fbf71;color:#7be3a6}
    #lxRemotePanel{position:fixed;right:14px;bottom:52px;z-index:9999;width:280px;padding:14px;border-radius:12px;border:1px solid #3a4a5c;background:#0f151c;color:#dfe9f3;font:13px system-ui;box-shadow:0 10px 30px #000a;display:none}
    #lxRemotePanel h4{margin:0 0 10px;font-size:13px}
    #lxRemotePanel .row{display:flex;justify-content:space-between;align-items:center;margin:8px 0}
    #lxRemotePanel .pin{font:700 26px ui-monospace,monospace;letter-spacing:.2em;text-align:center;padding:8px;background:#1a2430;border-radius:8px}
    #lxRemotePanel button{background:#1f2b38;color:#dfe9f3;border:1px solid #3a4a5c;border-radius:8px;padding:5px 10px;cursor:pointer}
    #lxRemotePanel small{color:#8ea2b6;display:block;margin-top:8px;line-height:1.4}`;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "lxRemoteBtn"; btn.textContent = "📱 Remote";
  const panel = document.createElement("div");
  panel.id = "lxRemotePanel";
  document.body.append(btn, panel);
  btn.onclick = () => { panel.style.display = panel.style.display === "block" ? "none" : "block"; };

  function render(info) {
    btn.classList.toggle("on", !!info.running);
    btn.textContent = info.running ? `📱 Remote · ${info.clients}` : "📱 Remote";
    const addr = info.addresses.length ? info.addresses.map(a => `${a}:${info.port}`).join("<br>") : "No network found";
    panel.innerHTML = `<h4>Phone Remote</h4>
      <div class="row"><span>Enabled</span><input type="checkbox" id="lxRemoteEnable" ${info.enabled ? "checked" : ""}></div>
      ${info.running ? `<div class="pin">${info.pin}</div>
      <div class="row"><span>${info.clients} connected</span><button id="lxRemoteRegen">New PIN</button></div>
      <small>Open the iPhone app, or browse to:<br><b>${addr}</b><br>and enter the PIN. Both devices must be on the same Wi-Fi.</small>` : `<small>Off. Turn on to control this console from a phone on the same network.</small>`}`;
    panel.querySelector("#lxRemoteEnable").onchange = e => bridge.setEnabled(e.target.checked).then(render);
    const regen = panel.querySelector("#lxRemoteRegen");
    if (regen) regen.onclick = () => { if (confirm("Generate a new PIN? Connected remotes will be disconnected.")) bridge.regeneratePin().then(render); };
  }
  bridge.getInfo().then(render).catch(() => {});
  bridge.onInfo(render);
})();
