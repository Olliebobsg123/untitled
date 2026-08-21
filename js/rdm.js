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
      .fixture-number-hint{margin-top:6px;font:700 8px/1.4 var(--mono,monospace);color:#64716f}
      .rdm-assignment{margin-top:8px;padding:8px 10px;border:1px solid #202a30;border-radius:7px;background:#080d10;font:700 8px/1.4 var(--mono,monospace);color:#8bc5ff}
    `;
    document.head.appendChild(style);
  }

  function ensureFixtureNumberField() {
    if ($("patchFixtureNumber")) return;
    const name = $("patchName");
    const addr = $("patchAddr");
    const form = name?.closest(".form-grid");
    if (!form || !addr) return;

    const row = document.createElement("div");
    row.className = "form-row";
    row.innerHTML = `
      <label>Fixture Number</label>
      <input type="number" id="patchFixtureNumber" min="1" max="9999" step="1" placeholder="Auto">
      <div class="fixture-number-hint">Console fixture ID — separate from the DMX start address.</div>
    `;

    const addrRow = addr.closest(".form-row");
    if (addrRow?.parentElement === form) addrRow.insertAdjacentElement("afterend", row);
    else form.appendChild(row);

    const input = $("patchFixtureNumber");
    if (input) input.value = String(nextFixtureNumber());
  }

  function nextFixtureNumber() {
    const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
    const used = new Set(
      fixtures
        .map(f => Number(f?.number ?? f?.fixtureNumber))
        .filter(Number.isInteger)
    );
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  function getSelectedRdmDevice() {
    return state.devices.find(device => device.uid === state.selectedUid) || null;
  }

  function ensureRdmAssignmentUI() {
    const range = $("patchRange");
    if (!range || $("rdmAssignment")) return;
    const box = document.createElement("div");
    box.id = "rdmAssignment";
    box.className = "rdm-assignment";
    range.insertAdjacentElement("afterend", box);
  }

  function updateRdmAssignmentUI() {
    ensureRdmAssignmentUI();
    const box = $("rdmAssignment");
    if (!box) return;
    const device = getSelectedRdmDevice();
    if (!device) {
      box.textContent = "RDM: no device selected. Scan the selected universe to discover fixtures.";
      return;
    }
    box.textContent = `RDM UID ${device.uid} · Universe ${device.universe} · Port ${device.port} · Source ${device.sourceIp || "unknown"}`;
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
    ensureRdmAssignmentUI();
    return panel;
  }

  function patchFootprint() {
    const name = $("patchName")?.value;
    const addr = Number($("patchAddr")?.value || 0);
    const def = name && window.FixtureLibrary?.[name];
    const channels = Number(def?.channels || 0);
    const range = $("patchRange");
    if (!range) return;
    if (!name || !channels || !Number.isInteger(addr) || addr < 1) {
      range.textContent = "Select a fixture to see its DMX footprint.";
      updateRdmAssignmentUI();
      return;
    }
    const end = addr + channels - 1;
    range.textContent = end <= 512 ? `DMX footprint: ${addr}–${end} (${channels} channel${channels === 1 ? "" : "s"})` : `Invalid footprint: ${addr}–${end} exceeds channel 512`;
    range.style.color = end <= 512 ? "#8bc5ff" : "#ff8996";
    updateRdmAssignmentUI();
  }

  function setStatus(text) {
    const el = $("rdmStatus");
    if (el) el.textContent = text;
  }

  function renderDevices() {
    const list = $("rdmDeviceList");
    if (!list) return;
    list.replaceChildren();
    if (!Array.isArray(state.devices) || !state.devices.length) {
      list.innerHTML = '<div class="rdm-empty">No RDM devices discovered yet.</div>';
      updateRdmAssignmentUI();
      return;
    }
    state.devices.forEach(device => {
      if (!device) return;
      const item = document.createElement("div");
      item.className = "rdm-device" + (state.selectedUid === device.uid ? " selected" : "");
      item.innerHTML = `<div><div class="rdm-uid">UID ${device.uid}</div><div class="rdm-meta">Universe ${device.universe} · Port ${device.port} · ${device.rdmVersion === 1 ? "RDM Standard" : "RDM Draft"}${device.sourceIp ? ` · ${device.sourceIp}` : ""}</div></div><button class="btn-secondary" type="button">Use RDM</button>`;
      item.addEventListener("click", () => {
        state.selectedUid = device.uid;
        renderDevices();
        patchFootprint();
      });
      item.querySelector("button")?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        state.selectedUid = device.uid;
        if ($("patchUni")) $("patchUni").value = String(device.universe);
        if ($("patchFixtureNumber") && !Number.isInteger(Number($("patchFixtureNumber").value))) {
          $("patchFixtureNumber").value = String(nextFixtureNumber());
        }
        patchFootprint();
        renderDevices();
        setStatus(`RDM UID ${device.uid} selected on universe ${device.universe}, port ${device.port}. Set the fixture's DMX start address, then patch it.`);
      });
      list.appendChild(item);
    });
    updateRdmAssignmentUI();
  }

  function scan(flush) {
    const universe = Math.max(1, Number($("patchUni")?.value || 1));
    state.scanning = true;
    state.devices = [];
    state.selectedUid = null;
    renderDevices();
    setStatus(flush ? `Starting full RDM discovery on universe ${universe}…` : `Requesting RDM TOD on universe ${universe}…`);
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      state.scanning = false;
      setStatus("RDM transport is not connected.");
      return;
    }
    state.ws.send(JSON.stringify({ type: flush ? "RDM_TOD_FLUSH" : "RDM_TOD_REQUEST", universe }));
    setTimeout(() => {
      state.scanning = false;
      if (!state.devices.length) setStatus(`No RDM devices reported on universe ${universe}.`);
    }, 2500);
  }

  function handleMessage(message) {
    if (!message || message.type !== "RDM_TOD") return;
    if (!Array.isArray(state.devices)) state.devices = [];
    (Array.isArray(message.devices) ? message.devices : []).forEach(device => {
      if (!device?.uid) return;
      const existing = state.devices.find(d => d.uid === device.uid);
      if (existing) Object.assign(existing, device);
      else state.devices.push(device);
    });
    renderDevices();
    setStatus(`${state.devices.length} RDM device${state.devices.length === 1 ? "" : "s"} discovered.`);
  }

  function patchFixtureFromUI(event) {
    try {
      const name = $("patchName")?.value;
      const uni = Number($("patchUni")?.value || 1);
      const addr = Number($("patchAddr")?.value || 1);
      const numberInput = $("patchFixtureNumber");
      const fixtureNumber = Number(numberInput?.value || 0);

      if (!name || !window.FixtureLibrary?.[name]) {
        setStatus("Select a valid fixture first.");
        return;
      }
      if (!Number.isInteger(uni) || uni < 1) {
        setStatus("Invalid universe.");
        return;
      }
      if (!Number.isInteger(addr) || addr < 1 || addr > 512) {
        setStatus("Invalid DMX address.");
        return;
      }
      if (!Number.isInteger(fixtureNumber) || fixtureNumber < 1 || fixtureNumber > 9999) {
        setStatus("Invalid fixture number.");
        return;
      }

      const definition = window.FixtureLibrary[name];
      const channels = Number(definition?.channels || 1);
      const end = addr + channels - 1;
      if (!Number.isFinite(channels) || channels < 1 || end > 512) {
        setStatus("Fixture extends beyond DMX address 512.");
        return;
      }

      if (!window.State || !Array.isArray(window.State.fixtures)) {
        if (window.State) window.State.fixtures = [];
        else {
          setStatus("Console state is not ready yet.");
          return;
        }
      }
      if (!(window.State.fixtureStates instanceof Map)) window.State.fixtureStates = new Map();
      if (!(window.State.selected instanceof Set)) window.State.selected = new Set();

      const fixtures = window.State.fixtures;
      const numberConflict = fixtures.find(f => Number(f?.number ?? f?.fixtureNumber) === fixtureNumber);
      if (numberConflict && !window.confirm(`Fixture number ${fixtureNumber} is already used by ${numberConflict.name || "another fixture"}. Use it anyway?`)) return;

      const overlap = fixtures.some(fixture => {
        if (Number(fixture?.uni) !== uni) return false;
        const existing = window.FixtureLibrary?.[fixture?.name];
        if (!existing) return false;
        const start = Number(fixture?.addr);
        const finish = start + Number(existing.channels || 1) - 1;
        return Number.isFinite(start) && addr <= finish && end >= start;
      });
      if (overlap && !window.confirm(`DMX ${addr}-${end} is already used. Overwrite?`)) return;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const fixture = { id, number: fixtureNumber, name, uni, addr };
      const rdmDevice = getSelectedRdmDevice();
      if (rdmDevice) {
        fixture.rdmUid = rdmDevice.uid;
        fixture.rdm = {
          uid: rdmDevice.uid,
          universe: rdmDevice.universe,
          port: rdmDevice.port,
          rdmVersion: rdmDevice.rdmVersion,
          sourceIp: rdmDevice.sourceIp || null
        };
      }

      fixtures.push(fixture);
      const current = window.State.current && typeof window.State.current === "object" ? window.State.current : {};
      const initialState = {
        ...current,
        pan: Number(current.pan ?? 128),
        tilt: Number(current.tilt ?? 128),
        zoom: Number($("zoom")?.value ?? 0),
        intensity: Number($("intensity")?.value ?? 100)
      };
      const stateFactory = typeof window.createFixtureState === "function" ? window.createFixtureState : value => ({ ...value });
      window.State.fixtureStates.set(id, stateFactory(initialState));
      window.State.selectedFixtureId = id;
      window.State.selected.clear();
      window.State.selected.add(id);

      if (typeof window.renderFixtures === "function") window.renderFixtures();
      if (typeof window.updateControlVisibility === "function") window.updateControlVisibility();
      if (typeof window.syncControlsFromSelection === "function") window.syncControlsFromSelection();
      if (typeof window.updateDMX === "function") window.updateDMX();
      if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();

      setStatus(`Patched fixture #${fixtureNumber}: ${name} → Uni ${uni}, DMX ${addr}–${end}${rdmDevice ? ` · RDM ${rdmDevice.uid}` : ""}.`);
      if (numberInput) numberInput.value = String(nextFixtureNumber());
      state.selectedUid = null;
      renderDevices();
    } catch (error) {
      console.error("RDM patch failed:", error);
      setStatus(`Patch failed: ${error?.message || "unknown error"}`);
      if (typeof window.log === "function") window.log(`Patch failed: ${error?.message || "unknown error"}`, "error");
    } finally {
      if (event) event.preventDefault();
    }
  }

  function installPatchCapture() {
    const button = $("btnPatch");
    if (!button || button.__fixtureNumberPatchInstalled) return;
    button.__fixtureNumberPatchInstalled = true;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      patchFixtureFromUI(event);
    }, true);
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
    ensureFixtureNumberField();
    ensurePanel();
    installPatchCapture();
    ["patchName", "patchAddr", "patchUni", "patchFixtureNumber"].forEach(id => $(id)?.addEventListener("input", patchFootprint));
    patchFootprint();
    connectRelay();
  }

  window.RDMUI = { scan, renderDevices, patchFootprint, nextFixtureNumber };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();