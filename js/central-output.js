"use strict";

(() => {
  if (window.__centralOutputPatch) return;
  window.__centralOutputPatch = true;

  const $ = id => document.getElementById(id);
  const log = (message, type = "info") => {
    try {
      if (typeof window.log === "function") window.log(message, type);
      else console.log(`[${String(type).toUpperCase()}] ${message}`);
    } catch (_) {}
  };

  const stored = (() => {
    try { return JSON.parse(localStorage.getItem("lighting-output-settings") || "{}"); }
    catch (_) { return {}; }
  })();

  const settings = {
    target: String(stored.target || $("artnetIp")?.value || "192.168.1.1").trim(),
    universe: Number.isInteger(Number(stored.universe)) ? Number(stored.universe) : Number($("artnetUni")?.value || 0),
    protocol: String(stored.protocol || $("outMode")?.value || "Art-Net").toLowerCase() === "sacn" ? "sacn" : "artnet",
    enabled: Boolean(stored.enabled)
  };

  settings.universe = settings.protocol === "sacn"
    ? Math.max(1, Math.min(63999, settings.universe || 1))
    : Math.max(0, Math.min(32767, settings.universe || 0));

  const saveSettings = () => {
    try { localStorage.setItem("lighting-output-settings", JSON.stringify(settings)); } catch (_) {}
  };

  const syncSettingsUI = () => {
    if ($("artnetIp")) $("artnetIp").value = settings.target;
    if ($("artnetUni")) $("artnetUni").value = settings.universe;
    if ($("outMode")) $("outMode").value = settings.protocol === "sacn" ? "sACN" : "Art-Net";
  };

  syncSettingsUI();

  // Universe is a global output setting. A patched fixture only has an address.
  const patchUni = $("patchUni");
  if (patchUni) {
    const row = patchUni.closest(".form-row");
    if (row) row.remove();
  }

  const normaliseLegacyFixtures = () => {
    if (!Array.isArray(window.State?.fixtures)) return;
    State.fixtures.forEach(fixture => {
      if (fixture && Object.prototype.hasOwnProperty.call(fixture, "uni")) delete fixture.uni;
    });
  };
  normaliseLegacyFixtures();

  let socket = null;
  let reconnectTimer = null;
  let frameTimer = null;
  let stopping = false;

  const sendConfig = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: "OUTPUT_CONFIG",
      protocol: settings.protocol,
      enabled: settings.enabled,
      target: settings.target,
      universe: settings.universe,
      priority: 100,
      multicast: false,
      sourceName: "Lighting Console"
    }));
  };

  const sendDMX = () => {
    if (socket && socket.readyState === WebSocket.OPEN && settings.enabled) {
      const dmx = window.State?.dmx instanceof Uint8Array
        ? Array.from(State.dmx)
        : Array.from(window.State?.dmx || []);
      socket.send(JSON.stringify({ type: "DMX_UPDATE", dmx }));
    }
    try { if (typeof window.sendVisualizerDMX === "function") window.sendVisualizerDMX(); } catch (_) {}
  };

  const connect = () => {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    stopping = false;
    try {
      socket = new WebSocket("ws://localhost:8081");
      socket.onopen = () => {
        sendConfig();
        if (settings.enabled) sendDMX();
        log(`Output ready → ${settings.protocol.toUpperCase()} universe ${settings.universe}`, "ok");
      };
      socket.onclose = () => {
        socket = null;
        if (!stopping) reconnectTimer = setTimeout(connect, 1500);
      };
      socket.onerror = () => {};
    } catch (_) {
      reconnectTimer = setTimeout(connect, 1500);
    }
  };

  const startFrameLoop = () => {
    clearInterval(frameTimer);
    if (!settings.enabled) return;
    frameTimer = setInterval(sendDMX, 40);
    sendDMX();
  };

  const stopFrameLoop = () => {
    clearInterval(frameTimer);
    frameTimer = null;
  };

  const applyOutputSettings = () => {
    settings.target = String($("artnetIp")?.value || settings.target).trim() || "127.0.0.1";
    const rawUniverse = Number($("artnetUni")?.value ?? settings.universe);
    settings.protocol = String($("outMode")?.value || "Art-Net").toLowerCase() === "sacn" ? "sacn" : "artnet";
    settings.universe = settings.protocol === "sacn"
      ? Math.max(1, Math.min(63999, Number.isFinite(rawUniverse) ? Math.round(rawUniverse) : 1))
      : Math.max(0, Math.min(32767, Number.isFinite(rawUniverse) ? Math.round(rawUniverse) : 0));

    if (window.ArtNet) {
      ArtNet.ip = settings.target;
      ArtNet.universe = settings.universe;
      ArtNet.protocol = settings.protocol;
    }

    saveSettings();
    syncSettingsUI();
    sendConfig();
    if (settings.enabled) sendDMX();
    log(`Output settings → ${settings.protocol.toUpperCase()} / universe ${settings.universe}`, "ok");
  };

  ["artnetIp", "artnetUni", "outMode"].forEach(id => $(id)?.addEventListener("change", applyOutputSettings));

  const startButton = $("artnetStart");
  const stopButton = $("artnetStop");
  if (startButton) startButton.onclick = e => {
    e?.preventDefault();
    applyOutputSettings();
    settings.enabled = true;
    saveSettings();
    sendConfig();
    startFrameLoop();
    if (window.ArtNet) ArtNet.enabled = true;
    log("Network output enabled", "ok");
  };
  if (stopButton) stopButton.onclick = e => {
    e?.preventDefault();
    settings.enabled = false;
    saveSettings();
    stopFrameLoop();
    sendConfig();
    if (window.ArtNet) ArtNet.enabled = false;
    log("Network output stopped", "warn");
  };

  if (window.ArtNet) {
    ArtNet.ip = settings.target;
    ArtNet.universe = settings.universe;
    ArtNet.protocol = settings.protocol;
    ArtNet.enabled = settings.enabled;
    ArtNet.send = sendDMX;
    ArtNet.start = () => {
      settings.enabled = true;
      ArtNet.enabled = true;
      saveSettings();
      sendConfig();
      startFrameLoop();
    };
    ArtNet.stop = () => {
      settings.enabled = false;
      ArtNet.enabled = false;
      saveSettings();
      stopFrameLoop();
      sendConfig();
    };
  }

  // Replace the legacy per-universe patch action with a single global-output patch.
  const patchButton = $("btnPatch");
  if (patchButton) {
    patchButton.onclick = e => {
      e?.preventDefault();
      const name = $("patchName")?.value;
      const addr = Number($("patchAddr")?.value || 1);
      const fixtureNumber = Number($("patchFixtureNumber")?.value || 0);

      if (!name || !window.FixtureLibrary?.[name]) return log("Select a valid fixture first", "warn");
      if (!Number.isInteger(addr) || addr < 1 || addr > 512) return log("Invalid DMX address", "warn");
      if (!Number.isInteger(fixtureNumber) || fixtureNumber < 1) return log("Invalid fixture number", "warn");
      if (State.fixtures.some(f => Number(f?.fixtureNumber) === fixtureNumber)) return log(`Fixture number ${fixtureNumber} is already patched`, "warn");

      const definition = FixtureLibrary[name];
      const channels = Number(definition.channels || 1);
      const end = addr + channels - 1;
      if (end > 512) return log("Fixture extends beyond DMX address 512", "warn");

      const overlap = State.fixtures.some(fixture => {
        const existing = FixtureLibrary[fixture.name];
        if (!existing) return false;
        const start = Number(fixture.addr);
        const finish = start + Number(existing.channels || 1) - 1;
        return addr <= finish && end >= start;
      });
      if (overlap && !confirm(`DMX ${addr}-${end} is already used. Overwrite?`)) return;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const fixture = { id, name, addr, fixtureNumber };
      State.fixtures.push(fixture);

      const initialState = {
        ...(State.current || {}),
        pan: Number(State.current?.pan ?? 128),
        tilt: Number(State.current?.tilt ?? 128),
        zoom: Number($("zoom")?.value ?? 0),
        intensity: Number($("intensity")?.value ?? 100)
      };
      State.fixtureStates.set(id, typeof createFixtureState === "function" ? createFixtureState(initialState) : initialState);
      State.selectedFixtureId = id;
      State.selected ||= new Set();
      State.selected.clear();
      State.selected.add(id);

      try { window.renderFixtures?.(); } catch (_) {}
      try { window.updateDMX?.(); } catch (_) {}
      try { window.sendToVisualizer?.(); } catch (_) {}
      log(`Patched: #${fixtureNumber} ${name} → Addr ${addr} / global ${settings.protocol.toUpperCase()} universe ${settings.universe}`, "ok");
    };
  }

  connect();
  if (settings.enabled) startFrameLoop();
})();
