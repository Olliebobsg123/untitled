"use strict";

/*
 * CITP (Settings → Outputs → Visualiser link): keeps a visualiser such as
 * Capture in step with Light Spark. citp.js does the talking; this page
 * sends it the patch, the selection and (if asked) the levels, shows who
 * it has found, and selects lights clicked in the visualiser.
 *
 * Light ids on CITP are fixture numbers, the same numbers as the command line.
 */
(function () {
  if (window.LXCitp) return;
  const STORE = "lx-citp";
  const $ = id => document.getElementById(id);
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let config = { enabled: false, patch: true, selection: true, levels: false };
  try { config = { ...config, ...(JSON.parse(localStorage.getItem(STORE) || "{}") || {}) }; } catch (_) {}
  let socket = null, retry = null, status = null, lastPatch = "", lastSelection = "", fromPeer = false;

  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(config)); } catch (_) {} };
  const send = m => { if (socket?.readyState !== WebSocket.OPEN) return false; try { socket.send(JSON.stringify(m)); return true; } catch (_) { return false; } };

  function connect() {
    clearTimeout(retry);
    if (socket && socket.readyState <= 1) return;
    try {
      socket = new WebSocket("ws://127.0.0.1:8087");
      socket.onopen = () => { lastPatch = lastSelection = ""; send({ type: "CITP_CONFIG", config }); tick(); };
      socket.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) {} };
      socket.onclose = () => { socket = null; retry = setTimeout(connect, 2000); };
      socket.onerror = () => {};
    } catch (_) { retry = setTimeout(connect, 2000); }
  }

  function onMessage(m) {
    if (m.type === "CITP_STATUS") { status = m; render(); }
    if (m.type === "CITP_SELECT") select(m.ids, m.from);
    if (m.type === "CITP_PEER_PATCH") window.log?.(`${m.from} changed its patch — Light Spark's patch is the one that counts, so it's sent back on the next change`, "info");
  }

  // ------------------------------------------------------------ what we send

  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const numberOf = f => Number(f?.fixtureNumber) || (S().fixtures || []).indexOf(f) + 1;

  // Make and model as a visualiser's library knows them: "Robe" + "Robin
  // 600 LEDWash", not "Robe Robin 600 LEDWash (Mode 1)".
  function makeAndName(f) {
    const def = defOf(f);
    const full = String(f?.name || def.name || "Fixture");
    const make = String(def.manufacturer || def.make || def.brand || "").trim() || (/^generic\s/i.test(full) ? "Generic" : "");
    let name = String(def.model || full).replace(/\s*\([^)]*\)\s*$/, "").trim() || full;
    if (make && name.toLowerCase().startsWith(make.toLowerCase() + " ")) name = name.slice(make.length + 1);
    return { make: make || "Generic", name };
  }

  function patchList() {
    return (S().fixtures || []).map(f => {
      const def = defOf(f);
      return { id: numberOf(f), universe: Number(f.uni ?? f.universe) || 1, channel: Number(f.addr ?? f.address) || 1, count: Number(def.channels || def.channelCount) || 1, ...makeAndName(f) };
    });
  }

  function selectedNumbers() {
    const selected = S().selected instanceof Set ? S().selected : new Set();
    return (S().fixtures || []).filter(f => selected.has(f.id)).map(numberOf).sort((a, b) => a - b);
  }

  function levels() {
    const frames = {};
    const dmx = S().dmx;
    if (!dmx) return frames;
    for (const f of S().fixtures || []) {
      const u = Number(f.uni ?? f.universe), base = Number(f.addr ?? f.address) - 1;
      if (!Number.isInteger(u) || !Number.isInteger(base) || base < 0) continue;
      const global = typeof window.getFixtureBaseAddress === "function" ? window.getFixtureBaseAddress(f) : base;
      const count = Number(defOf(f).channels) || 1;
      frames[u] ||= new Array(512).fill(0);
      for (let i = 0; i < count && base + i < 512; i++) frames[u][base + i] = Number(dmx[global + i]) & 255;
    }
    return frames;
  }

  let ticks = 0;
  function tick() {
    if (!config.enabled || socket?.readyState !== WebSocket.OPEN) return;
    ticks++;
    if (ticks % 10 === 0 || !lastPatch) {
      const list = patchList(), text = JSON.stringify(list);
      if (text !== lastPatch) { lastPatch = text; send({ type: "CITP_PATCH", fixtures: list }); }
    }
    const ids = selectedNumbers(), text = JSON.stringify(ids);
    if (text !== lastSelection) {
      lastSelection = text;
      if (!fromPeer) send({ type: "CITP_SELECTION", ids });
      fromPeer = false;
    }
    if (config.levels && ticks % 2 === 0) send({ type: "CITP_LEVELS", universes: levels() });
  }

  // Lights clicked in the visualiser are selected here.
  function select(numbers, from) {
    const byNumber = new Map((S().fixtures || []).map(f => [numberOf(f), f.id]));
    const ids = (numbers || []).map(n => byNumber.get(Number(n))).filter(id => id != null);
    const state = S();
    state.selected = new Set(ids);
    state.selectedFixtureId = ids[ids.length - 1] ?? null;
    lastSelection = JSON.stringify(selectedNumbers());
    fromPeer = true;
    if (window.syncFixtureListSelectionClasses) window.syncFixtureListSelectionClasses();
    else window.renderFixtures?.();
    window.updateControlVisibility?.();
    try { if (typeof updateControlsForSelection === "function") updateControlsForSelection(); } catch (_) {}
    const el = $("citpLast");
    if (el) el.textContent = ids.length ? `${from} selected ${ids.length} light${ids.length === 1 ? "" : "s"}` : `${from} cleared the selection`;
  }

  // ------------------------------------------------------------------- panel

  function render() {
    const host = $("citpBody");
    if (!host) return;
    const peers = status?.peers || [];
    const on = config.enabled;
    host.querySelector("[data-c=enabled]").checked = on;
    ["patch", "selection", "levels"].forEach(k => { host.querySelector(`[data-c=${k}]`).checked = Boolean(config[k]); });
    const list = $("citpPeers");
    if (!socket || socket.readyState !== WebSocket.OPEN) list.innerHTML = `<div class="citp-note">The CITP service isn't running — restart Light Spark.</div>`;
    else if (!on) list.innerHTML = `<div class="citp-note">Off. Tick “Link with a visualiser” to look for Capture.</div>`;
    else if (status?.error) list.innerHTML = `<div class="citp-note warn">⚠ ${esc(status.error)}</div>`;
    else if (!peers.length) list.innerHTML = `<div class="citp-note">Looking for a visualiser… Open Capture on this computer or the same network. In Capture: Universes tab → Console links, pick Light Spark.</div>`;
    else list.innerHTML = peers.map(p => `<div class="citp-peer"><span class="dot ${p.connected ? "on" : ""}"></span><div><b>${esc(p.name || "Visualiser")}</b><span>${esc(p.type || "")} · ${esc(p.ip)} · ${p.connected ? `linked — ${status.patched} light${status.patched === 1 ? "" : "s"} shared` : "found, connecting…"}</span></div></div>`).join("");
  }

  function install() {
    if ($("citpPanel")) return true;
    const outputs = $("multiOutputPanel");
    if (!outputs) return false;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "citpPanel";
    panel.dataset.prefsTab = "outputs";
    panel.innerHTML = `<div class="panel-header"><div><span class="eyebrow">CITP</span> Visualiser link</div><span class="panel-meta">CAPTURE</span></div><div class="panel-body" id="citpBody">
      <p class="citp-note">CITP lets Light Spark and a visualiser such as Capture share what they know: the lights you patch here appear in Capture at the right addresses, and selecting lights in one selects them in the other. The light levels still go by Art-Net or sACN (the outputs above) unless you tick “Levels too”.</p>
      <label class="citp-row"><input type="checkbox" data-c="enabled"> <b>Link with a visualiser</b></label>
      <label class="citp-row"><input type="checkbox" data-c="patch"> Patch — send the patch (lights, addresses, makes and models)</label>
      <label class="citp-row"><input type="checkbox" data-c="selection"> Selection — select together</label>
      <label class="citp-row"><input type="checkbox" data-c="levels"> Levels too — send the DMX over CITP as well (only if the visualiser takes it)</label>
      <div id="citpPeers" class="citp-peers"></div><div id="citpLast" class="citp-note"></div></div>`;
    outputs.after(panel);
    if (!$("citpStyles")) {
      const st = document.createElement("style");
      st.id = "citpStyles";
      st.textContent = `.citp-note{font-size:11px;line-height:1.55;color:#7d8987;margin:0 0 10px}.citp-note.warn{color:#f2b84b}.citp-row{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;color:#c6d0ce;cursor:pointer}.citp-peers{display:grid;gap:6px;margin:6px 0 8px}.citp-peer{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26343a;border-radius:8px;background:#0d1418}.citp-peer b{display:block;font-size:12px;color:#edf4f2}.citp-peer span{font-size:11px;color:#7d8987}.citp-peer .dot{width:9px;height:9px;border-radius:50%;background:#3a4549;flex:0 0 auto}.citp-peer .dot.on{background:#54f2c8;box-shadow:0 0 8px rgba(84,242,200,.6)}`;
      document.head.appendChild(st);
    }
    panel.addEventListener("change", e => {
      const key = e.target.dataset.c;
      if (!key) return;
      config[key] = e.target.checked;
      save();
      lastPatch = lastSelection = "";
      send({ type: "CITP_CONFIG", config });
      tick();
      render();
    });
    render();
    return true;
  }

  function boot(tries = 0) {
    if (!install() && tries < 100) return setTimeout(() => boot(tries + 1), 200);
    connect();
    setInterval(tick, 100);
  }

  window.LXCitp = { status: () => status, config: () => ({ ...config }), set: next => { config = { ...config, ...next }; save(); lastPatch = lastSelection = ""; send({ type: "CITP_CONFIG", config }); render(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
  else boot();
})();
