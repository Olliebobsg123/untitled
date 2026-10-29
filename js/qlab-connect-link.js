"use strict";

/*
 * QLab Connect link (renderer side; the listener is desk-link.js).
 *
 * QLab Connect fires a lighting desk when a QLab cue tagged "LX ..." starts.
 * With this on, point QLab Connect's lighting desk at this computer and:
 *   LX 5   → GO Light Spark cue 5
 *   LXP 2  → run chase 2
 *   LXR 2  → stop chase 2
 *   LXM 3  → run effect 3 (in the effects list's order)
 * The panel lives on the Settings page.
 */
(function () {
  if (window.__qlabConnectLinkInstalled) return;
  window.__qlabConnectLinkInstalled = true;
  const api = window.LXDeskLink;
  const S = () => window.State || {};
  const say = (message, level = "ok") => window.log?.(`🎭 QLab Connect: ${message}`, level);
  const has = name => typeof window[name] === "function";

  // ---------------------------------------------------------- commands

  function run(command) {
    const state = S();
    switch (command.kind) {
      case "cue": {
        const number = command.cue, index = window.cueIndexOf(number);
        if (window.parseCueNumber?.(number) == null) return say(`cue ${command.cue} — that isn't a cue number`, "warn");
        if (index < 0) return say(`GO cue ${number} — there's no cue ${number}`, "warn");
        if (command.playback && command.playback !== "1") say(`playback ${command.playback} → Light Spark's cue list`, "info");
        window.goToCue?.(index);
        return say(`GO cue ${window.cueLabel(index)}${state.cues[index]?.name ? ` (${state.cues[index].name})` : ""}`);
      }
      case "chase": {
        const chase = state.chases?.[command.number - 1];
        if (!chase) return say(`run chase ${command.number} — there's no chase ${command.number}`, "warn");
        window.startChase?.(command.number - 1);
        return say(`run chase ${command.number} (${chase.name || "Chase"})`);
      }
      case "release": {
        if (state.currentChase === command.number - 1) window.stopChase?.(false);
        return say(`stop chase ${command.number}`);
      }
      case "effect": {
        const effect = Object.values(state.savedEffects || {})[command.number - 1];
        if (!effect) return say(`run effect ${command.number} — there's no effect ${command.number}`, "warn");
        window.applySavedEffect?.(effect.name);
        return say(`run effect ${command.number} (${effect.name})`);
      }
      case "go":
        if (!state.cues?.length) return say("GO — no cues saved", "warn");
        has("goNextCue") ? window.goNextCue() : window.parseCommand?.("go");
        return say("GO");
      case "back":
        window.parseCommand?.("back");
        return say("Back");
      case "stop":
        window.stopChase?.(false);
        window.stopEffect?.(true);
        return say("stop chases and effects");
      case "blackout":
        window.parseCommand?.("blackout");
        return say("blackout");
      default:
        return null;
    }
  }

  // --------------------------------------------------------------- panel

  let info = null;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderStatus() {
    const status = $("qcLinkStatus"), setup = $("qcLinkSetup");
    if (!status || !info) return;
    const enabled = $("qcLinkEnabled"), port = $("qcLinkPort"), local = $("qcLinkLocal");
    if (enabled && document.activeElement !== enabled) enabled.checked = info.enabled;
    if (port && document.activeElement !== port) port.value = info.port;
    if (local && document.activeElement !== local) local.checked = info.localOnly;
    let text;
    if (!info.enabled) text = "Off — QLab Connect can't fire Light Spark.";
    else if (info.error) text = `⚠ ${info.error}. Try another port.`;
    else if (info.listening) text = `● Listening on port ${info.port}${info.localOnly ? " (this computer only)" : ""}.`;
    else text = "Starting…";
    if (info.last) text += ` Last: ${info.last.address}${info.last.understood ? "" : " (not a command Light Spark knows)"} from ${info.last.from || "?"} at ${new Date(info.last.at).toLocaleTimeString()}.`;
    status.textContent = text;
    status.style.color = info.enabled && info.listening && !info.error ? "var(--accent)" : info.error ? "#ff8b8b" : "";
    const ips = info.localOnly ? ["127.0.0.1"] : ["127.0.0.1 (if QLab Connect runs on this Mac)", ...(info.addresses || [])];
    setup.innerHTML = `In <b>QLab Connect → Admin → Lighting desk</b>: turn it on, set the IP address to ${ips.map(ip => `<b>${escape(ip)}</b>`).join(" or ")}, port <b>${escape(info.port)}</b>, UDP, tag <b>LX</b>.`;
  }

  async function configure() {
    if (!api) return;
    info = await api.configure({ enabled: $("qcLinkEnabled").checked, port: Number($("qcLinkPort").value), localOnly: $("qcLinkLocal").checked });
    renderStatus();
  }

  function installPanel() {
    if ($("qcLinkPanel")) return true;
    const grid = document.querySelector("#page-settings .page-grid");
    if (!grid) return false;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "qcLinkPanel";
    panel.innerHTML = `
      <div class="panel-header"><div><span class="eyebrow">QLAB CONNECT</span> Lighting Cue Link</div><span class="panel-meta">OSC · ZEROS STYLE</span></div>
      <div class="panel-body">
        ${api ? "" : '<div class="empty-state">Only available in the desktop app.</div>'}
        <style>.qc-check{display:flex;gap:10px;align-items:center;margin-bottom:10px;font-size:14px;color:#d9e2e0;cursor:pointer}.qc-check input{width:16px;height:16px;flex:none;margin:0;accent-color:var(--accent)}</style>
        <label class="qc-check"><input type="checkbox" id="qcLinkEnabled"> Accept lighting cues from QLab Connect</label>
        <label class="qc-check"><input type="checkbox" id="qcLinkLocal"> Only from this computer (QLab Connect on the same Mac)</label>
        <div class="form-grid"><div class="form-row"><label>Port</label><input type="number" id="qcLinkPort" min="1024" max="65535" value="8830"></div></div>
        <div id="qcLinkStatus" style="margin-top:10px;font-size:13px;color:#a5adac"></div>
        <div id="qcLinkSetup" style="margin-top:10px;font-size:13px;line-height:1.55;color:#9aa7a4"></div>
        <div style="margin-top:12px;display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;color:#9aa7a4">
          <b style="color:#e3ebe9">QLab cue tag</b><b style="color:#e3ebe9">Light Spark does</b>
          <span>LX 5</span><span>GO cue 5</span>
          <span>LXP 2</span><span>Run chase 2</span>
          <span>LXR 2</span><span>Stop chase 2</span>
          <span>LXM 3</span><span>Run effect 3 (as listed on the Effects page)</span>
        </div>
      </div>`;
    grid.appendChild(panel);
    for (const id of ["qcLinkEnabled", "qcLinkLocal"]) $(id).addEventListener("change", configure);
    $("qcLinkPort").addEventListener("change", configure);
    if (!api) panel.querySelectorAll("input").forEach(input => { input.disabled = true; });
    renderStatus();
    return true;
  }

  function boot() {
    if (!installPanel()) return setTimeout(boot, 500);
    if (!api) return;
    api.onCommand(command => { try { run(command); } catch (error) { console.error("[QLAB CONNECT]", error); } });
    api.onInfo(next => { info = next; renderStatus(); });
    api.getInfo().then(next => { info = next; renderStatus(); }).catch(() => {});
  }

  window.QLabConnectLink = Object.freeze({ run });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
