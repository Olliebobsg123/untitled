"use strict";

(() => {
  // Patch page → RDM Discovery: which RDM fixtures a node can see on a universe
  // (main/artnet-monitor.js does the Art-Net side).

  const state = { devices: [], selectedUid: null, scanning: false };
  const $ = id => document.getElementById(id);


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
    // Ask the node the Art-Net output for this universe sends to (or everyone, by broadcast).
    const output = window.LXOutputs?.list().find(o => o.protocol === "artnet" && o.universe === universe);
    const target = output && !/\.255$/.test(output.target) ? output.target : undefined;
    if (flush) window.LXArtNet.flushTod(universe, target);
    else window.LXArtNet.requestTod(universe, target);
    setTimeout(() => { state.scanning = false; if (!state.devices.length) setStatus(`No RDM devices reported on universe ${universe}.`); }, 2500);
  }

  function handleTod(message) {
    (Array.isArray(message?.devices) ? message.devices : []).forEach(device => {
      if (!device?.uid) return;
      const existing = state.devices.find(d => d.uid === device.uid);
      if (existing) Object.assign(existing, device); else state.devices.push(device);
    });
    renderDevices();
    setStatus(`${state.devices.length} RDM device${state.devices.length === 1 ? "" : "s"} discovered.`);
  }

  function install() {
    ensurePanel();
    ["patchName", "patchAddr", "patchUni"].forEach(id => $(id)?.addEventListener("input", patchFootprint));
    patchFootprint();
    window.LXArtNet?.onTod(handleTod);
    setStatus("Ready to discover RDM devices on the patch universe.");
  }

  window.RDMUI = { scan, renderDevices, patchFootprint };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();
