"use strict";

// Central output policy. Network output remains unchanged; USB DMX is an
// additional transport selected from the same Output Mode control.
(() => {
  if (window.__centralOutputPatch) return;
  window.__centralOutputPatch = true;
  window.__blindLiveMode = true;

  const $ = id => document.getElementById(id);
  const log = (message, type = "info") => {
    try {
      if (typeof window.log === "function") window.log(message, type);
      else console.log(`[${String(type).toUpperCase()}] ${message}`);
    } catch (_) {}
  };
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  const isBlind = () => String(document.documentElement.dataset.consoleMode || "live").toLowerCase() === "blind";
  const USB_REFRESH_RATES = [10, 15, 20, 25, 30, 35, 40];

  const stored = (() => {
    try {
      const oldSettings = JSON.parse(localStorage.getItem("dmxOutputSettings") || "{}");
      const centralSettings = JSON.parse(localStorage.getItem("lighting-output-settings") || "{}");
      const merged = { ...oldSettings, ...centralSettings };
      if (Number(merged.universe) === 3) merged.universe = 1;
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
    universe: initialProtocol === "sacn" ? clamp(stored.universe ?? $("artnetUni")?.value, 1, 63999, 1) : clamp(stored.universe ?? $("artnetUni")?.value, 0, 32767, 1),
    protocol: initialProtocol,
    enabled: Boolean(stored.enabled) && !isBlind(),
    usbDevice: String(stored.usbDevice || ""),
    usbDriver: stored.usbDriver || null,
    usbRefreshRate: clamp(stored.usbRefreshRate ?? 25, 10, 40, 25)
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

  let usbPorts = [];
  let requestUsbPorts = null;

  const formatUsbPort = port => {
    const driverName = port?.driver?.name || "USB serial DMX";
    const details = [port?.manufacturer, port?.product].filter(Boolean).join(" ");
    const identity = [port?.vendorId, port?.productId].filter(Boolean).join(":");
    return [details || driverName, identity ? `(${identity})` : "", port?.path ? `— ${port.path}` : ""].filter(Boolean).join(" ");
  };

  const updateUsbStatus = () => {
    const status = $("usbDmxStatus");
    if (!status) return;
    if (!usbPorts.length) {
      status.textContent = "No USB serial devices detected. Connect the interface and press ↻.";
      return;
    }
    const selected = usbPorts.find(p => String(p.path) === settings.usbDevice);
    status.textContent = selected
      ? `${selected.driver?.name || "USB DMX"} · ${selected.path} · ${settings.usbRefreshRate} Hz`
      : `${usbPorts.length} device${usbPorts.length === 1 ? "" : "s"} detected — select one before starting output.`;
  };

  const populateUsbDevices = () => {
    const select = $("usbDmxDevice");
    if (!select) return;
    const current = settings.usbDevice;
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = usbPorts.length ? "— Select USB DMX device —" : "— No USB DMX devices found —";
    select.appendChild(placeholder);
    for (const port of usbPorts) {
      if (!port?.path) continue;
      const option = document.createElement("option");
      option.value = port.path;
      option.textContent = formatUsbPort(port);
      option.title = `${port.path}${port.driver?.name ? ` — ${port.driver.name}` : ""}`;
      select.appendChild(option);
    }
    if (current && usbPorts.some(p => String(p.path) === current)) select.value = current;
    else if (!usbPorts.length && current) {
      const remembered = document.createElement("option");
      remembered.value = current;
      remembered.textContent = `${current} — disconnected`;
      remembered.disabled = true;
      select.appendChild(remembered);
      select.value = "";
    } else if (!current) {
      settings.usbDevice = "";
      settings.usbDriver = null;
    }
  };

  const ensureUsbControls = () => {
    ensureUsbOption();
    const mode = $("outMode");
    if (!mode) return;
    let row = $("usbDmxDeviceRow");
    if (!row) {
      row = document.createElement("div");
      row.className = "form-row";
      row.id = "usbDmxDeviceRow";
      row.innerHTML = `
        <label for="usbDmxDevice">USB Device</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="usbDmxDevice" style="flex:1;min-width:0;"><option value="">— Select USB DMX device —</option></select>
          <button type="button" class="btn-secondary" id="usbDmxRefresh" title="Refresh USB DMX devices">↻</button>
        </div>
        <small id="usbDmxStatus" style="display:block;margin-top:5px;opacity:.7;"></small>
      `;
      const modeRow = mode.closest(".form-row");
      if (modeRow?.parentElement) modeRow.parentElement.insertBefore(row, modeRow.nextSibling);
      else mode.parentElement?.appendChild(row);

      $("usbDmxDevice")?.addEventListener("change", () => {
        const selected = usbPorts.find(p => String(p.path) === String($("usbDmxDevice")?.value));
        settings.usbDevice = selected?.path || "";
        settings.usbDriver = selected?.driver || null;
        saveSettings();
        sendUSBConfig();
        updateUsbStatus();
        if (!settings.usbDevice && settings.protocol === "usb") {
          settings.enabled = false;
          stopFrameLoop();
          sendUSBConfig();
          log("USB DMX output not enabled — select a USB device first", "warn");
        } else if (settings.usbDevice) log(`USB DMX device selected → ${settings.usbDevice}`, "ok");
      });

      $("usbDmxRefresh")?.addEventListener("click", event => {
        event.preventDefault();
        requestUsbPorts?.();
      });
    }

    let rateRow = $("usbDmxRefreshRateRow");
    if (!rateRow) {
      rateRow = document.createElement("div");
      rateRow.className = "form-row";
      rateRow.id = "usbDmxRefreshRateRow";
      rateRow.innerHTML = `
        <label for="usbDmxRefreshRate">USB DMX Refresh Rate</label>
        <select id="usbDmxRefreshRate"></select>
        <small style="display:block;margin-top:5px;opacity:.7;">Lower rates can be more stable with some OpenDMX interfaces.</small>
      `;
      const deviceRow = $("usbDmxDeviceRow");
      if (deviceRow?.parentElement) deviceRow.parentElement.insertBefore(rateRow, deviceRow.nextSibling);
      else mode.parentElement?.appendChild(rateRow);
      $("usbDmxRefreshRate")?.addEventListener("change", () => {
        settings.usbRefreshRate = clamp($("usbDmxRefreshRate")?.value, 10, 40, 25);
        saveSettings();
        sendUSBConfig();
        updateUsbStatus();
        log(`USB DMX refresh rate → ${settings.usbRefreshRate} Hz`, "ok");
      });
    }

    const rateSelect = $("usbDmxRefreshRate");
    if (rateSelect) {
      rateSelect.replaceChildren();
      for (const hz of USB_REFRESH_RATES) {
        const option = document.createElement("option");
        option.value = String(hz);
        option.textContent = `${hz} Hz`;
        rateSelect.appendChild(option);
      }
      rateSelect.value = String(settings.usbRefreshRate);
    }

    row.style.display = settings.protocol === "usb" ? "" : "none";
    if (rateRow) rateRow.style.display = settings.protocol === "usb" ? "" : "none";
    populateUsbDevices();
    updateUsbStatus();
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
    if ($("outMode")) $("outMode").value = settings.protocol === "sacn" ? "sACN" : settings.protocol === "usb" ? "USB DMX" : "Art-Net";
    setNetworkFieldsVisible(settings.protocol !== "usb");
    ensureUsbControls();
  };

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
    socket.send(JSON.stringify({ type: "OUTPUT_CONFIG", protocol: settings.protocol, enabled: settings.enabled && !isBlind() && settings.protocol !== "usb", mode: isBlind() ? "BLIND" : "LIVE", target: settings.target, universe: settings.universe, priority: 100, multicast: false, sourceName: "Lighting Console" }));
  };

  const sendUSBConfig = () => {
    if (!usbSocket || usbSocket.readyState !== WebSocket.OPEN) return;
    usbSocket.send(JSON.stringify({ type: "USB_DMX_CONFIG", enabled: settings.enabled && settings.protocol === "usb" && !isBlind() && Boolean(settings.usbDevice), mode: isBlind() ? "BLIND" : "LIVE", device: settings.usbDevice, driver: settings.usbDriver, universe: settings.universe, refreshRate: settings.usbRefreshRate }));
  };

  const sendDMX = () => {
    if (isBlind()) {
      try { window.sendVisualizerDMX?.(); } catch (_) {}
      return;
    }
    const dmx = window.State?.dmx instanceof Uint8Array ? Array.from(State.dmx) : Array.from(window.State?.dmx || []);
    if (settings.protocol === "usb") {
      if (usbSocket?.readyState === WebSocket.OPEN && settings.enabled && settings.usbDevice) usbSocket.send(JSON.stringify({ type: "USB_DMX_UPDATE", dmx, universe: settings.universe }));
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
      usbSocket.onopen = () => { sendUSBConfig(); requestUsbPorts?.(); };
      usbSocket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === "USB_DMX_STATUS") {
            if (Number.isFinite(Number(message.refreshRate))) settings.usbRefreshRate = clamp(message.refreshRate, 10, 40, settings.usbRefreshRate);
            window.dispatchEvent(new CustomEvent("usb-dmx-status", { detail: message }));
            updateUsbStatus();
          }
          if (message?.type === "USB_DMX_PORTS") {
            usbPorts = Array.isArray(message.ports) ? message.ports : [];
            populateUsbDevices();
            updateUsbStatus();
            window.dispatchEvent(new CustomEvent("usb-dmx-ports", { detail: usbPorts }));
          }
        } catch (_) {}
      };
      usbSocket.onclose = () => { usbSocket = null; usbReconnectTimer = setTimeout(connectUSB, 2000); };
      usbSocket.onerror = () => {};
    } catch (_) { usbReconnectTimer = setTimeout(connectUSB, 2000); }
  };

  requestUsbPorts = () => {
    if (!usbSocket || usbSocket.readyState !== WebSocket.OPEN) return;
    try { usbSocket.send(JSON.stringify({ type: "USB_DMX_PORTS" })); } catch (_) {}
  };

  const startFrameLoop = () => {
    clearInterval(frameTimer);
    if (!settings.enabled || isBlind() || (settings.protocol === "usb" && !settings.usbDevice)) return;
    // The backend owns the actual USB refresh timing. This loop only keeps the
    // latest console state flowing to the backend at a stable 25 Hz.
    frameTimer = setInterval(sendDMX, 40);
    sendDMX();
  };
  const stopFrameLoop = () => { clearInterval(frameTimer); frameTimer = null; };

  const applyOutputSettings = () => {
    settings.protocol = normaliseProtocol($("outMode")?.value || "Art-Net");
    if (settings.protocol !== "usb") settings.target = String($("artnetIp")?.value || settings.target).trim() || "127.0.0.1";
    const raw = Number($("artnetUni")?.value);
    settings.universe = settings.protocol === "sacn" ? clamp(raw, 1, 63999, 1) : clamp(raw, 0, 32767, 1);
    if (window.ArtNet) { ArtNet.ip = settings.target; ArtNet.universe = settings.universe; ArtNet.protocol = settings.protocol; }
    if (settings.protocol === "usb") requestUsbPorts?.();
    saveSettings();
    syncUI();
    sendConfig();
    sendUSBConfig();
    if (settings.enabled && !isBlind()) sendDMX();
    log(`Output settings → ${settings.protocol === "usb" ? "USB DMX" : settings.protocol.toUpperCase()} / universe ${settings.universe}`, "ok");
  };

  ["artnetIp", "artnetUni", "outMode"].forEach(id => $(id)?.addEventListener("change", applyOutputSettings));

  $("artnetStart")?.addEventListener("click", e => {
    e?.preventDefault();
    applyOutputSettings();
    if (settings.protocol === "usb" && !settings.usbDevice) {
      settings.enabled = false; saveSettings(); sendUSBConfig(); stopFrameLoop();
      log("USB DMX cannot start — select a USB device first", "warn");
      return;
    }
    settings.enabled = !isBlind();
    saveSettings(); sendConfig(); sendUSBConfig(); startFrameLoop();
    if (window.ArtNet) ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
    log(isBlind() ? "BLIND mode — hardware output remains stopped" : `${settings.protocol === "usb" ? "USB DMX" : "Network"} output enabled`, isBlind() ? "warn" : "ok");
  });

  $("artnetStop")?.addEventListener("click", e => {
    e?.preventDefault();
    settings.enabled = false;
    saveSettings(); stopFrameLoop(); sendConfig(); sendUSBConfig();
    if (window.ArtNet) ArtNet.enabled = false;
    log("Output stopped", "warn");
  });

  if (window.ArtNet) {
    ArtNet.ip = settings.target;
    ArtNet.universe = settings.universe;
    ArtNet.protocol = settings.protocol;
    ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
    ArtNet.send = sendDMX;
    ArtNet.start = () => {
      if (settings.protocol === "usb" && !settings.usbDevice) { log("USB DMX cannot start — select a USB device first", "warn"); return; }
      settings.enabled = !isBlind();
      ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
      saveSettings(); sendConfig(); sendUSBConfig(); startFrameLoop();
    };
    ArtNet.stop = () => { settings.enabled = false; ArtNet.enabled = false; saveSettings(); stopFrameLoop(); sendConfig(); sendUSBConfig(); };
  }

  new MutationObserver(() => {
    if (isBlind()) {
      stopFrameLoop();
      if (window.ArtNet) ArtNet.enabled = false;
      sendConfig(); sendUSBConfig();
    } else {
      if (window.ArtNet) ArtNet.enabled = settings.enabled && settings.protocol !== "usb";
      sendConfig(); sendUSBConfig();
      startFrameLoop();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-console-mode"] });

  syncUI();
  connect();
  connectUSB();
  if (settings.enabled && !isBlind()) startFrameLoop();
})();
