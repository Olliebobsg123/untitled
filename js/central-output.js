"use strict";

// Single source of truth for network DMX output.
// GLOBAL universe for Art-Net/sACN; BLIND mode is a hard no-DMX-output state.
(() => {
  if (window.__centralOutputPatch) return;
  window.__centralOutputPatch = true;

  const $ = id => document.getElementById(id);
  const log = (message, type = "info") => {
    try { if (typeof window.log === "function") window.log(message, type); else console.log(`[${String(type).toUpperCase()}] ${message}`); } catch (_) {}
  };
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  const isBlind = () => String(document.documentElement.dataset.consoleMode || "live").toLowerCase() === "blind";

  // Support both old settings keys so an older saved configuration cannot overwrite
  // the selected global universe with the old default.
  const stored = (() => {
    try {
      const oldSettings = JSON.parse(localStorage.getItem("dmxOutputSettings") || "{}");
      const centralSettings = JSON.parse(localStorage.getItem("lighting-output-settings") || "{}");
      return { ...oldSettings, ...centralSettings };
    } catch (_) { return {}; }
  })();

  const protocol = String(stored.protocol || $("outMode")?.value || "Art-Net").toLowerCase() === "sacn" ? "sacn" : "artnet";
  const settings = {
    target: String(stored.target || $("artnetIp")?.value || "192.168.1.1").trim(),
    universe: protocol === "sacn"
      ? clamp(stored.universe ?? $("artnetUni")?.value, 1, 63999, 1)
      : clamp(stored.universe ?? $("artnetUni")?.value, 0, 32767, 1),
    protocol,
    enabled: Boolean(stored.enabled) && !isBlind()
  };

  const saveSettings = () => {
    const data = { ...settings, priority: 100, multicast: false, sourceName: "Lighting Console" };
    try {
      localStorage.setItem("lighting-output-settings", JSON.stringify(data));
      localStorage.setItem("dmxOutputSettings", JSON.stringify(data));
    } catch (_) {}
  };

  const syncUI = () => {
    if ($("artnetIp")) $("artnetIp").value = settings.target;
    if ($("artnetUni")) {
      $("artnetUni").min = settings.protocol === "sacn" ? "1" : "0";
      $("artnetUni").max = settings.protocol === "sacn" ? "63999" : "32767";
      $("artnetUni").step = "1";
      $("artnetUni").value = settings.universe;
    }
    if ($("outMode")) $("outMode").value = settings.protocol === "sacn" ? "sACN" : "Art-Net";
  };
  syncUI();

  // Global universe: remove the obsolete per-fixture universe field.
  $("patchUni")?.closest(".form-row")?.remove();
  if (Array.isArray(window.State?.fixtures)) {
    State.fixtures.forEach(fixture => { if (fixture) delete fixture.uni; });
  }

  // Last-line safety guard. Even if another renderer script tries to send a DMX
  // WebSocket message while BLIND is active, it is discarded here.
  if (!WebSocket.prototype.__blindDMXGuard) {
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (isBlind() && typeof data === "string") {
        try {
          const message = JSON.parse(data);
          if (message?.type === "DMX_UPDATE") return;
          if (message?.type === "OUTPUT_CONFIG") data = JSON.stringify({ ...message, enabled: false });
        } catch (_) {}
      }
      return originalSend.call(this, data);
    };
    WebSocket.prototype.__blindDMXGuard = true;
  }

  let socket = null;
  let reconnectTimer = null;
  let frameTimer = null;
  let stopping = false;

  const sendConfig = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: "OUTPUT_CONFIG",
      protocol: settings.protocol,
      enabled: settings.enabled && !isBlind(),
      target: settings.target,
      universe: settings.universe,
      priority: 100,
      multicast: false,
      sourceName: "Lighting Console"
    }));
  };

  const sendDMX = () => {
    if (isBlind()) {
      try { window.sendVisualizerDMX?.(); } catch (_) {}
      return;
    }
    if (socket && socket.readyState === WebSocket.OPEN && settings.enabled) {
      const dmx = window.State?.dmx instanceof Uint8Array ? Array.from(State.dmx) : Array.from(window.State?.dmx || []);
      socket.send(JSON.stringify({ type: "DMX_UPDATE", dmx }));
    }
    try { window.sendVisualizerDMX?.(); } catch (_) {}
  };

  const connect = () => {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    stopping = false;
    try {
      socket = new WebSocket("ws://localhost:8081");
      socket.onopen = () => { sendConfig(); if (settings.enabled && !isBlind()) sendDMX(); log(`Output ready → ${settings.protocol.toUpperCase()} universe ${settings.universe}`, "ok"); };
      socket.onclose = () => { socket = null; if (!stopping) reconnectTimer = setTimeout(connect, 1500); };
      socket.onerror = () => {};
    } catch (_) { reconnectTimer = setTimeout(connect, 1500); }
  };

  const startFrameLoop = () => {
    clearInterval(frameTimer);
    if (!settings.enabled || isBlind()) return;
    frameTimer = setInterval(sendDMX, 40);
    sendDMX();
  };
  const stopFrameLoop = () => { clearInterval(frameTimer); frameTimer = null; };

  const applyOutputSettings = () => {
    settings.target = String($("artnetIp")?.value || settings.target).trim() || "127.0.0.1";
    settings.protocol = String($("outMode")?.value || "Art-Net").toLowerCase() === "sacn" ? "sacn" : "artnet";
    const raw = Number($("artnetUni")?.value ?? settings.universe);
    settings.universe = settings.protocol === "sacn" ? clamp(raw, 1, 63999, 1) : clamp(raw, 0, 32767, 1);
    if (window.ArtNet) { ArtNet.ip = settings.target; ArtNet.universe = settings.universe; ArtNet.protocol = settings.protocol; }
    saveSettings();
    syncUI();
    sendConfig();
    if (settings.enabled && !isBlind()) sendDMX();
    log(`Output settings → ${settings.protocol.toUpperCase()} / universe ${settings.universe}`, "ok");
  };

  ["artnetIp", "artnetUni", "outMode"].forEach(id => $(id)?.addEventListener("change", applyOutputSettings));

  $("artnetStart")?.addEventListener("click", e => {
    e?.preventDefault();
    applyOutputSettings();
    settings.enabled = !isBlind();
    saveSettings();
    sendConfig();
    startFrameLoop();
    if (window.ArtNet) ArtNet.enabled = settings.enabled;
    log(isBlind() ? "BLIND mode — network output remains stopped" : "Network output enabled", isBlind() ? "warn" : "ok");
  });

  $("artnetStop")?.addEventListener("click", e => {
    e?.preventDefault();
    settings.enabled = false;
    saveSettings();
    stopFrameLoop();
    sendConfig();
    if (window.ArtNet) ArtNet.enabled = false;
    log("Network output stopped", "warn");
  });

  if (window.ArtNet) {
    ArtNet.ip = settings.target;
    ArtNet.universe = settings.universe;
    ArtNet.protocol = settings.protocol;
    ArtNet.enabled = settings.enabled;
    ArtNet.send = sendDMX;
    ArtNet.start = () => { settings.enabled = !isBlind(); ArtNet.enabled = settings.enabled; saveSettings(); sendConfig(); startFrameLoop(); };
    ArtNet.stop = () => { settings.enabled = false; ArtNet.enabled = false; saveSettings(); stopFrameLoop(); sendConfig(); };
  }

  // Blind/live is owned by modes.js. Watch the HTML mode attribute so switching
  // to BLIND immediately stops the relay and switching back to LIVE resumes only
  // if the user had output enabled.
  new MutationObserver(() => {
    if (isBlind()) {
      stopFrameLoop();
      if (window.ArtNet) ArtNet.enabled = false;
      sendConfig();
    } else {
      if (window.ArtNet) ArtNet.enabled = settings.enabled;
      sendConfig();
      startFrameLoop();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-console-mode"] });

  connect();
  if (settings.enabled && !isBlind()) startFrameLoop();
})();
