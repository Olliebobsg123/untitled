"use strict";

// Central output policy. Network output remains unchanged; USB DMX is an
// additional transport selected from the same Output Mode control.
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

  const stored = (() => {
    try {
      const oldSettings = JSON.parse(localStorage.getItem("dmxOutputSettings") || "{}");
      const centralSettings = JSON.parse(localStorage.getItem("lighting-output-settings") || "{}");
      const merged = { ...oldSettings, ...centralSettings };

      // Universe 3 was an unwanted startup value in an older build. Do not
      // depend on a one-time migration flag: if an old setting is restored
      // or remains in localStorage, repair it every time the app starts.
      if (Number(merged.universe) === 3) {
        merged.universe = 1;
        localStorage.setItem("dmxOutputSettings", JSON.stringify({ ...oldSettings, universe: 1 }));
        localStorage.setItem("lighting-output-settings", JSON.stringify({ ...centralSettings, universe: 1 }));
      }
      return merged;
    } catch (_) { return {}; }
  })();

  const normaliseProtocol = value => {
    const p = String(value || "Art-Net").toLowerCase().trim();
    if (p === "sacn" || p === "s-acn") return "sacn";
    if (p === "usb dmx" || p === "usb" || p === "usb-dmx") return "usb";
    return "artnet";
  };

  const initialProtocol = normaliseProtocol(stored.protocol || $("outMode")?.value || "Art-Net");
  const settings = {
    target: String(stored.target || $("artnetIp")?.value || "192.168.1.1").trim(),
    universe: initialProtocol === "sacn"
      ? clamp(stored.universe ?? $("artnetUni")?.value, 1, 63999, 1)
      : clamp(stored.universe ?? $("artnetUni")?.value, 0, 32767, 1),
    protocol: initialProtocol,
    enabled: Boolean(stored.enabled) && !isBlind(),
    usbDevice: String(stored.usbDevice || ""),
    usbDriver: stored.usbDriver || null
  };

  const saveSettings = () => {
    const data = { ...settings, priority: 100, multicast: false, sourceName: "Lighting Console" };
    try {
      localStorage.setItem("lighting-output-settings", JSON.stringify(data));
      localStorage.setItem("dmxOutputSettings", JSON.stringify(data));
    } catch (_) {}
  };

  const ensureUsbOption = () => {
    const select = $("outMode");
    if (!select) return;
    if (![...select.options].some(o => String(o.value).toLowerCase() === "usb dmx")) {
      const option = document.createElement("option");
      option.value = "USB DMX";
      option.textContent = "USB DMX";
      select.appendChild(option);
    }
  };

  const setNetworkFieldsVisible = visible => {
    const ip = $("artnetIp")?.closest(".form-row");
    const port = $("artnetPort")?.closest(".form-row");
    if (ip) ip.style.display = visible ? "" : "none";
    if (port) port.style.display = visible ? "" : "none";
  };

  const syncUI = () => {
    ensureUsbOption();
    if ($("artnetIp")) $("artnetIp").value = settings.target;
    if ($("artnetPort")) $("artnetPort").value = settings.protocol === "sacn" ? 5568 : 6454;
    if ($("artnetUni")) {
      $("artnetUni").min = settings.protocol === "sacn" ? "1" : "0";
      $("artnetUni").max = settings.protocol === "sacn" ? "63999" : "32767";
      $("artnetUni").step = "1";
      $("artnetUni").value = String(settings.universe);
    }
    if ($("outMode")) {
      $("outMode").value = settings.protocol === "sacn" ? "sACN" : settings.protocol === "usb" ? "USB DMX" : "Art-Net";
    }
    setNetworkFieldsVisible(settings.protocol !== "usb");
  };
  syncUI();

  if (!WebSocket.prototype.__blindDMXGuard) {
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (isBlind() && typeof data === "string") {
        try {
          const message = JSON.parse(data);
          if (message?.type === "DMX_UPDATE" || message?.type === "USB_DMX_UPDATE") return;
          if (message?.type === "OUTPUT_CONFIG" || message?.type === "USB_DMX_CONFIG") data = JSON.stringify({ ...message, enabled: false });
        } catch (_) {}
      }
      return originalSend.call(this, data);
    };
    WebSocket.prototype.__blindDMXGuard = true;
  }

  let socket = null;
  let usbSocket = null;
  let reconnectTimer = null;
  let usbReconnectTimer = null;
  let frameTimer = null;

  const sendConfig = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: "OUTPUT_CONFIG",
      protocol: settings.protocol,
      enabled: settings.enabled && !isBlind() && settings.protocol !== "usb",
      mode: isBlind() ? "BLIND" : "LIVE",
      target: settings.target,
      universe: settings.universe,
      priority: 100,
      multicast: false,
      sourceName: "Lighting Console"
    }));
  };

  const sendUSBConfig = () => {
    if (!usbSocket || usbSocket.readyState !== WebSocket.OPEN) return;
    usbSocket.send(JSON.stringify({
      type: "USB_DMX_CONFIG",
      enabled: settings.enabled && settings.protocol === "usb" && !isBlind(),
      mode: isBlind() ? "BLIND" : "LIVE",
      device: settings.usbDevice,
      driver: settings.usbDriver,
      universe: settings.universe
    }));
  };

  const sendDMX = () => {
    if (isBlind()) {
      try { window.sendVisualizerDMX?.(); } catch (_) {}
      return;
    }
    const dmx = window.State?.dmx instanceof Uint8Array ? Array.from(State.dmx) : Array.from(window.State?.dmx || []);
    if (settings.protocol === "usb") {
      if (usbSocket?.readyState === WebSocket.OPEN && settings.enabled) usbSocket.send(JSON.stringify({ type: "USB_DMX_UPDATE", dmx, universe: settings.universe }));
    } else if (socket?.readyState === WebSocket.OPEN && settings.enabled) {
      socket.send(JSON.stringify({ type: "DMX_UPDATE", dmx, universe: settings.universe }));
    }
    try { window.sendVisualizerDMX?.(); } catch (_) {}
  };

  const connect = () => {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    try {
      socket = new WebSocket("ws://localhost:8081");
      socket.onopen = () => { sendConfig(); if (settings.enabled && settings.protocol !== "usb" && !isBlind()) sendDMX(); };
      socket.onclose = () => { socket = null; reconnectTimer = setTimeout(connect, 1500); };
      socket.onerror = () => {};
    } catch (_) { reconnectTimer = setTimeout(connect, 1500); }
  };

  const connectUSB = () => {
    clearTimeout(usbReconnectTimer);
    if (usbSocket && (usbSocket.readyState === WebSocket.OPEN || usbSocket.readyState === WebSocket.CONNECTING)) return;
    try {
      usbSocket = new WebSocket("ws://localhost:8082");
      usbSocket.onopen = () => sendUSBConfig();
      usbSocket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === "USB_DMX_STATUS") window.dispatchEvent(new CustomEvent("usb-dmx-status", { detail: message }));
          if (message?.type === "USB_DMX_PORTS") window.dispatchEvent(new CustomEvent("usb-dmx-ports", { detail: message.ports || [] }));
        } catch (_) {}
      };
      usbSocket.onclose = () => { usbSocket = null; usbReconnectTimer = setTimeout(connectUSB, 2000); };
      usbSocket.onerror = () => {};
    } catch (_) { usbReconnectTimer = setTimeout(connectUSB, 2000); }
  };

  const startFrameLoop = () => {
    clearInterval(frameTimer);
    if (!settings.enabled || isBlind()) return;
    frameTimer = setInterval(sendDMX, 40);
    sendDMX();
  };
  const stopFrameLoop = () => { clearInterval(frameTimer); frameTimer = null; };

  const applyOutputSettings = () => {
    settings.protocol = normaliseProtocol($("outMode")?.value || "Art-Net");
    if (settings.protocol !== "usb") settings.target = String($("artnetIp")?.value || settings.target).trim() || "127.0.0.1";
    const raw = Number($("artnetUni")?.value);
    settings.universe = settings.protocol === "sacn"
      ? clamp(raw, 1, 63999, 1)
      : clamp(raw, 0, 32767, 1);
    if (window.ArtNet) {
      ArtNet.ip = settings.target;
      ArtNet.universe = settings.universe;
      ArtNet.protocol = settings.protocol;
    }
    saveSettings();
    syncUI();
    sendConfig();
    sendUSBConfig();
    if (settings.enabled && !isBlind()) sendDMX();
    log(`Output settings → ${settings.protocol === "usb" ? "USB DMX" : settings.protocol.toUpperCase()} / universe ${settings.universe}`, "ok");
  };

  ["artnetIp", "artnetUni", "outMode"].forEach(id => $("" + id)?.addEventListener("change", applyOutputSettings));

  $("artnetStart")?.addEventListener("click", e => {
    e?.preventDefault();
    applyOutputSettings();
    settings.enabled = !isBlind();
    saveSettings();
    sendConfig();
    sendUSBConfig();
    startFrameLoop();
    if (window.ArtNet) ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
    log(isBlind() ? "BLIND mode — hardware output remains stopped" : `${settings.protocol === "usb" ? "USB DMX" : "Network"} output enabled`, isBlind() ? "warn" : "ok");
  });

  $("artnetStop")?.addEventListener("click", e => {
    e?.preventDefault();
    settings.enabled = false;
    saveSettings();
    stopFrameLoop();
    sendConfig();
    sendUSBConfig();
    if (window.ArtNet) ArtNet.enabled = false;
    log("Output stopped", "warn");
  });

  if (window.ArtNet) {
    ArtNet.ip = settings.target;
    ArtNet.universe = settings.universe;
    ArtNet.protocol = settings.protocol;
    ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
    ArtNet.send = sendDMX;
    ArtNet.start = () => { settings.enabled = !isBlind(); ArtNet.enabled = settings.enabled && settings.protocol !== "usb"; saveSettings(); sendConfig(); sendUSBConfig(); startFrameLoop(); };
    ArtNet.stop = () => { settings.enabled = false; ArtNet.enabled = false; saveSettings(); stopFrameLoop(); sendConfig(); sendUSBConfig(); };
  }

  new MutationObserver(() => {
    if (isBlind()) {
      stopFrameLoop();
      if (window.ArtNet) ArtNet.enabled = false;
      sendConfig();
      sendUSBConfig();
    } else {
      if (window.ArtNet) ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
      sendConfig();
      sendUSBConfig();
      startFrameLoop();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-console-mode"] });

  connect();
  connectUSB();
  if (settings.enabled && !isBlind()) startFrameLoop();
})();
