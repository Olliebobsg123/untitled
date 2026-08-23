"use strict";

(() => {
  if (window.__multiOutputUI) return;
  window.__multiOutputUI = true;

  const MAX_OUTPUTS = 10;
  const USB_RATES = [10, 15, 20, 25, 30, 35, 40];
  const $ = id => document.getElementById(id);
  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  const log = (m, t = "info") => { try { window.log?.(m, t); } catch (_) { console.log(m); } };

  let socket = null;
  let reconnectTimer = null;
  let usbPorts = [];
  let outputs = [];

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("lighting-multi-outputs") || "[]");
      if (Array.isArray(saved) && saved.length) return saved.slice(0, MAX_OUTPUTS);
      const old = JSON.parse(localStorage.getItem("lighting-output-settings") || "{}");
      return [{ id: crypto.randomUUID?.() || `output-${Date.now()}`, protocol: String(old.protocol || "artnet").toLowerCase().includes("sacn") ? "sacn" : "artnet", universe: Number(old.universe) || 0, target: old.target || "192.168.1.1", usbDevice: "", refreshRate: 25, enabled: false, multicast: false, priority: 100 }];
    } catch (_) {
      return [{ id: `output-${Date.now()}`, protocol: "artnet", universe: 0, target: "192.168.1.1", usbDevice: "", refreshRate: 25, enabled: false }];
    }
  };

  outputs = load();
  outputs.forEach(o => { o.id ||= `output-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; o.refreshRate = clamp(o.refreshRate ?? 25, 10, 40, 25); });

  const save = () => { try { localStorage.setItem("lighting-multi-outputs", JSON.stringify(outputs)); } catch (_) {} };

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; } catch (_) { return false; }
  }

  function sendConfig() {
    send({ type: "MULTI_OUTPUT_CONFIG", outputs: outputs.slice(0, MAX_OUTPUTS) });
  }

  function disableLegacy() {
    try {
      window.ArtNet?.stop?.();
      const legacyNetwork = new WebSocket("ws://localhost:8081");
      legacyNetwork.onopen = () => legacyNetwork.send(JSON.stringify({ type: "OUTPUT_CONFIG", enabled: false, mode: "BLIND", protocol: "artnet", target: "127.0.0.1", universe: 0 }));
      setTimeout(() => { try { legacyNetwork.close(); } catch (_) {} }, 500);
    } catch (_) {}
    try {
      const legacyUsb = new WebSocket("ws://localhost:8082");
      legacyUsb.onopen = () => legacyUsb.send(JSON.stringify({ type: "USB_DMX_CONFIG", enabled: false, mode: "BLIND", device: "" }));
      setTimeout(() => { try { legacyUsb.close(); } catch (_) {} }, 500);
    } catch (_) {}
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    try {
      socket = new WebSocket("ws://localhost:8083");
      socket.onopen = () => { sendConfig(); requestUsbPorts(); };
      socket.onmessage = e => {
        try {
          const message = JSON.parse(e.data);
          if (message.type === "MULTI_USB_PORTS") { usbPorts = Array.isArray(message.ports) ? message.ports : []; render(); }
          if (message.type === "MULTI_OUTPUT_STATUS") window.dispatchEvent(new CustomEvent("multi-output-status", { detail: message }));
        } catch (_) {}
      };
      socket.onclose = () => { socket = null; reconnectTimer = setTimeout(connect, 1500); };
      socket.onerror = () => {};
    } catch (_) { reconnectTimer = setTimeout(connect, 1500); }
  }

  function requestUsbPorts() { send({ type: "MULTI_USB_PORTS" }); }

  function patchUniverseFrames() {
    const frames = {};
    const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
    const dmx = window.State?.dmx;
    if (!(dmx instanceof Uint8Array) && !Array.isArray(dmx)) return frames;
    const getDef = window.getFixtureDefinition || (f => window.FixtureLibrary?.[f?.name]);
    for (const fixture of fixtures) {
      const universe = Number(fixture?.uni ?? fixture?.universe ?? 0);
      if (!Number.isFinite(universe)) continue;
      const def = getDef?.(fixture);
      const channels = Math.max(1, Math.min(512, Number(def?.channels || 1)));
      const base = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? 1) - 1;
      if (!Number.isInteger(base) || base < 0 || base >= 512) continue;
      if (!frames[universe]) frames[universe] = new Array(512).fill(0);
      for (let i = 0; i < channels && base + i < 512; i++) frames[universe][base + i] = Number(dmx[base + i]) & 0xff;
    }
    return frames;
  }

  function sendDMX() {
    if (!outputs.some(o => o.enabled)) return;
    const universes = patchUniverseFrames();
    for (const output of outputs) {
      const u = Number(output.universe);
      if (!Object.prototype.hasOwnProperty.call(universes, u)) universes[u] = new Array(512).fill(0);
    }
    send({ type: "MULTI_DMX_UPDATE", universes });
  }

  function usbOptions(current) {
    const options = [`<option value="">— Select USB device —</option>`];
    for (const p of usbPorts) {
      const label = [p.manufacturer, p.product].filter(Boolean).join(" ") || "USB serial DMX";
      options.push(`<option value="${String(p.path).replace(/&/g,"&amp;").replace(/"/g,"&quot;")}" ${String(p.path) === String(current) ? "selected" : ""}>${label} — ${p.path}</option>`);
    }
    return options.join("");
  }

  function render() {
    const host = $("multiOutputHost");
    if (!host) return;
    host.innerHTML = "";
    outputs.forEach((output, index) => {
      const card = document.createElement("div");
      card.className = "multi-output-card";
      card.style.cssText = "border:1px solid var(--border,#333);border-radius:10px;padding:12px;margin:10px 0;background:rgba(255,255,255,.025);";
      const isUsb = output.protocol === "usb";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
          <strong>Universe Output ${index + 1}</strong>
          <button type="button" class="btn-danger-soft multi-remove">Remove</button>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>Protocol</label><select class="multi-protocol"><option value="artnet">Art-Net</option><option value="sacn">sACN</option><option value="usb">USB DMX</option></select></div>
          <div class="form-row"><label>Patch Universe</label><input class="multi-universe" type="number" min="0" max="63999" step="1" value="${Number(output.universe) || 0}"></div>
          <div class="form-row multi-network-row"><label>Target IP</label><input class="multi-target" value="${String(output.target || "192.168.1.1").replace(/"/g,"&quot;")}"></div>
          <div class="form-row multi-usb-row"><label>USB Device</label><select class="multi-usb">${usbOptions(output.usbDevice)}</select></div>
          <div class="form-row multi-rate-row"><label>USB Refresh Rate</label><select class="multi-rate">${USB_RATES.map(h => `<option value="${h}">${h} Hz</option>`).join("")}</select></div>
          <div class="form-row"><label>Enabled</label><input class="multi-enabled" type="checkbox" ${output.enabled ? "checked" : ""}></div>
        </div>
        <small class="multi-status" style="display:block;margin-top:7px;opacity:.7;"></small>`;
      const protocol = card.querySelector(".multi-protocol");
      const universe = card.querySelector(".multi-universe");
      const target = card.querySelector(".multi-target");
      const usb = card.querySelector(".multi-usb");
      const rate = card.querySelector(".multi-rate");
      const enabled = card.querySelector(".multi-enabled");
      protocol.value = output.protocol;
      rate.value = String(output.refreshRate);
      const sync = () => {
        output.protocol = protocol.value;
        output.universe = clamp(universe.value, 0, 63999, 0);
        output.target = target.value.trim();
        output.usbDevice = usb.value;
        output.refreshRate = clamp(rate.value, 10, 40, 25);
        output.enabled = enabled.checked;
        output.multicast = false;
        save(); sendConfig(); render();
      };
      [protocol, universe, target, usb, rate, enabled].forEach(el => el.addEventListener("change", sync));
      card.querySelector(".multi-remove").onclick = () => { outputs = outputs.filter(o => o.id !== output.id); save(); sendConfig(); render(); };
      card.querySelector(".multi-usb-row").style.display = isUsb ? "" : "none";
      card.querySelector(".multi-rate-row").style.display = isUsb ? "" : "none";
      card.querySelector(".multi-network-row").style.display = isUsb ? "none" : "";
      host.appendChild(card);
    });
    const add = $("multiOutputAdd");
    if (add) add.disabled = outputs.length >= MAX_OUTPUTS;
    const count = $("multiOutputCount");
    if (count) count.textContent = `${outputs.length}/${MAX_OUTPUTS}`;
  }

  function installUI() {
    const outMode = $("outMode");
    const oldPanel = outMode?.closest(".panel");
    if (!oldPanel || $("multiOutputPanel")) return;
    oldPanel.style.display = "none";
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "multiOutputPanel";
    panel.innerHTML = `
      <div class="panel-header"><div><span class="eyebrow">OUTPUT</span> DMX Universe Outputs</div><span class="panel-meta" id="multiOutputCount">0/10</span></div>
      <div class="panel-body">
        <p style="opacity:.7;margin-top:0;">Route up to 10 patched universes to Art-Net, sACN, or USB DMX independently.</p>
        <div id="multiOutputHost"></div>
        <div class="action-row"><button class="btn-primary" id="multiOutputAdd">＋ Add Universe Output</button><button class="btn-secondary" id="multiOutputRefreshUsb">↻ Refresh USB Devices</button></div>
      </div>`;
    oldPanel.parentElement?.insertBefore(panel, oldPanel);
    $("multiOutputAdd").onclick = () => {
      if (outputs.length >= MAX_OUTPUTS) return;
      outputs.push({ id: `output-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, protocol: "artnet", universe: outputs.length, target: "192.168.1.1", usbDevice: "", refreshRate: 25, enabled: false, multicast: false, priority: 100 });
      save(); sendConfig(); render();
    };
    $("multiOutputRefreshUsb").onclick = requestUsbPorts;
    render();
  }

  function install() {
    installUI();
    connect();
    disableLegacy();
    setInterval(sendDMX, 40);
    window.addEventListener("beforeunload", () => { try { socket?.close(); } catch (_) {} });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
