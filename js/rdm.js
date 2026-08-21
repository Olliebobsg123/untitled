"use strict";

(() => {
  if (window.__rdmPatchInstalled) return;
  window.__rdmPatchInstalled = true;

  const state = { devices: [], selectedUid: null, scanning: false, ws: null };
  const $ = id => document.getElementById(id);

  function injectStyles() {
    if ($("rdmPatchStyles")) return;
    const style = document.createElement("style");
    style.id = "rdmPatchStyles";
    style.textContent = `
      .rdm-panel{margin-top:14px}.rdm-actions{display:flex;gap:8px;flex-wrap:wrap}
      .rdm-status{font:700 9px/1.4 var(--mono,monospace);color:#6f7b79}
      .rdm-device{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:10px 12px;border:1px solid #202a30;border-radius:8px;background:#0a0f12;cursor:pointer}
      .rdm-device:hover,.rdm-device.selected{border-color:#19d6a3;background:#0d1717}.rdm-uid{font:800 11px/1 var(--mono,monospace);letter-spacing:.8px;color:#dce7e4}
      .rdm-meta{font:700 8px/1.4 var(--mono,monospace);color:#64716f}.rdm-empty{padding:14px;color:#64716f;font:700 9px/1.5 var(--mono,monospace)}
      .patch-range{margin-top:10px;padding:10px 12px;border:1px solid #202a30;border-radius:8px;background:#0a0f12;font:800 10px/1.4 var(--mono,monospace);color:#8bc5ff}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    if ($("rdmPanel")) return $("rdmPanel");
    const patchPage = $("page-patch");
    const grid = patchPage?.querySelector(".page-grid");
    if (!grid) return null;
    const panel = document.createElement("section");
    panel.className = "panel rdm-panel";
    panel.id = "rdmPanel";
    panel.innerHTML = `<div class="panel-header"><div><span class="eyebrow">03</span> RDM Discovery</div><span class="panel-meta">ART-NET RDM / TOD</span></div><div class="panel-body"><div class="rdm-actions"><button class="btn-primary" id="btnRdmScan">↻ Discover RDM</button><button class="btn-secondary" id="btnRdmFlush">⟳ Full Discovery</button></div><div class="rdm-status" id="rdmStatus">Ready — choose a universe and discover RDM devices.</div><div class="patch-range" id="patchRange">Select a fixture to see its DMX footprint.</div><div id="rdmDeviceList" class="item-list" style="margin-top:10px"></div></div>`;
    grid.appendChild(panel);
    $("btnRdmScan")?.addEventListener("click", () => scan(false));
    $("btnRdmFlush")?.addEventListener("click", () => scan(true));
    return panel;
  }

  function patchFootprint() {
    const name = $("patchName")?.value;
    const addr = Number($("patchAddr")?.value || 0);
    const def = name && window.FixtureLibrary?.[name];
    const channels = Number(def?.channels || 0);
    const range = $("patchRange");
    if (!range) return;
    if (!name || !channels || !Number.isInteger(addr) || addr < 1) { range.textContent = "Select a fixture to see its DMX footprint."; return; }
    const end = addr + channels - 1;
    range.textContent = end <= 512 ? `DMX footprint: ${addr}–${end} (${channels} channel${channels === 1 ? "" : "s"})` : `Invalid footprint: ${addr}–${end} exceeds channel 512`;
    range.style.color = end <= 512 ? "#8bc5ff" : "#ff8996";
  }

  function setStatus(text) { const el = $("rdmStatus"); if (el) el.textContent = text; }

  function renderDevices() {
    const list = $("rdmDeviceList");
    if (!list) return;
    list.innerHTML = "";
    if (!state.devices.length) { list.innerHTML = '<div class="rdm-empty">No RDM devices discovered yet.</div>'; return; }
    state.devices.forEach(device => {
      const item = document.createElement("div");
      item.className = "rdm-device" + (state.selectedUid === device.uid ? " selected" : "");
      item.innerHTML = `<div><div class="rdm-uid">UID ${device.uid}</div><div class="rdm-meta">Universe ${device.universe} · Port ${device.port} · ${device.rdmVersion === 1 ? "RDM Standard" : "RDM Draft"}</div></div><button class="btn-secondary" type="button">Use Universe</button>`;
      item.addEventListener("click", () => { state.selectedUid = device.uid; renderDevices(); });
      item.querySelector("button")?.addEventListener("click", event => {
        event.stopPropagation();
        if ($("patchUni")) $("patchUni").value = String(device.universe);
        patchFootprint();
        setStatus(`RDM UID ${device.uid} is on universe ${device.universe}, port ${device.port}. Set the fixture's DMX start address manually before patching.`);
      });
      list.appendChild(item);
    });
  }

  function scan(flush) {
    const universe = Math.max(1, Number($("patchUni")?.value || 1));
    state.scanning = true;
    state.devices = [];
    renderDevices();
    setStatus(flush ? `Starting full RDM discovery on universe ${universe}…` : `Requesting RDM TOD on universe ${universe}…`);
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) { setStatus("RDM transport is not connected."); return; }
    state.ws.send(JSON.stringify({ type: flush ? "RDM_TOD_FLUSH" : "RDM_TOD_REQUEST", universe }));
    setTimeout(() => { state.scanning = false; if (!state.devices.length) setStatus(`No RDM devices reported on universe ${universe}.`); }, 2500);
  }

  function handleMessage(message) {
    if (!message || message.type !== "RDM_TOD") return;
    (Array.isArray(message.devices) ? message.devices : []).forEach(device => {
      if (!device?.uid) return;
      const existing = state.devices.find(d => d.uid === device.uid);
      if (existing) Object.assign(existing, device); else state.devices.push(device);
    });
    renderDevices();
    setStatus(`${state.devices.length} RDM device${state.devices.length === 1 ? "" : "s"} discovered.`);
  }

  function connectRelay() {
    if (state.ws && state.ws.readyState <= WebSocket.OPEN) return;
    try {
      const ws = new WebSocket("ws://localhost:8081");
      state.ws = ws;
      ws.onopen = () => setStatus("RDM transport connected — ready to discover.");
      ws.onclose = () => { state.ws = null; setStatus("RDM transport disconnected."); setTimeout(connectRelay, 1500); };
      ws.onerror = () => setStatus("RDM transport error — check the Art-Net relay.");
      ws.onmessage = event => {
        if (typeof event.data !== "string") return;
        try { handleMessage(JSON.parse(event.data)); } catch (_) {}
      };
    } catch (_) { setTimeout(connectRelay, 1500); }
  }

  function install() {
    injectStyles();
    ensurePanel();
    ["patchName", "patchAddr", "patchUni"].forEach(id => $(id)?.addEventListener("input", patchFootprint));
    patchFootprint();
    connectRelay();
  }

  window.RDMUI = { scan, renderDevices, patchFootprint };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();
