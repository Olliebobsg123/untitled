"use strict";

// Settings → DMX Outputs: up to 10 outputs, each sending one patch universe over
// Art-Net, sACN or a USB interface. The sending itself is main/dmx-output.js.
// Saved in this window's storage (and in show files, js/showfile.js).
(() => {
  const STORAGE_KEY = "lighting-multi-outputs";
  const TARGET_KEY = "lighting-network-target";
  const MAX_OUTPUTS = 10;
  const USB_RATES = [10, 15, 20, 25, 30, 35, 40];
  const DEFAULT_TARGET = "192.168.1.1";
  const $ = id => document.getElementById(id);
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  const escape = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const newId = () => `output-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let outputs = [];
  let statuses = new Map();
  let usbPorts = [];
  let nodes = [];

  const networkTarget = () => {
    try { return localStorage.getItem(TARGET_KEY) || outputs.find(o => o.protocol !== "usb" && o.target)?.target || DEFAULT_TARGET; } catch (_) { return DEFAULT_TARGET; }
  };

  function normalise(list) {
    return (Array.isArray(list) ? list : []).slice(0, MAX_OUTPUTS).map(raw => {
      const protocol = ["artnet", "sacn", "usb"].includes(String(raw?.protocol).toLowerCase()) ? String(raw.protocol).toLowerCase() : "artnet";
      return {
        id: String(raw?.id || newId()),
        protocol,
        universe: protocol === "sacn" ? clamp(raw?.universe, 1, 63999, 1) : clamp(raw?.universe, 0, 32767, 1),
        target: String(raw?.target || networkTarget()),
        enabled: Boolean(raw?.enabled),
        multicast: protocol === "sacn" && Boolean(raw?.multicast),
        priority: clamp(raw?.priority ?? 100, 0, 200, 100),
        usbDevice: String(raw?.usbDevice || ""),
        usbDriver: ["open-dmx", "dmx-usb-pro"].includes(raw?.usbDriver) ? raw.usbDriver : "auto",
        refreshRate: USB_RATES.includes(Number(raw?.refreshRate)) ? Number(raw.refreshRate) : 25
      };
    });
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) return normalise(saved);
    } catch (_) {}
    return normalise([{ protocol: "artnet", universe: 1, target: networkTarget(), enabled: false }]);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(outputs)); } catch (_) {}
  }

  async function apply() {
    save();
    try {
      showStatus(await window.LXOutput.configure(outputs));
    } catch (err) {
      window.log?.(`Output settings could not be applied: ${err.message}`, "error");
    }
  }

  // --- Status ---

  function statusText(output) {
    const status = statuses.get(output.id);
    if (!output.enabled) return "Off";
    if (status?.error) return `Problem: ${status.error}`;
    if (!window.License?.isLive()) return "Visualiser only: live output needs a LIVE or PRO licence";
    if (window.getConsoleMode?.() === "BLIND") return "Blind: nothing is sent until you switch to LIVE";
    if (output.protocol === "usb") return status?.connected ? `Sending · ${status.driver === "dmx-usb-pro" ? "DMX USB Pro" : "Open DMX"} · ${output.refreshRate} Hz` : "USB interface not connected";
    return status?.connected ? `Sending universe ${output.universe} to ${output.multicast ? "multicast" : output.target} · ${status.tx} packets` : "Starting…";
  }

  function showStatus(status) {
    statuses = new Map((status?.outputs || []).map(o => [o.id, o]));
    document.querySelectorAll(".multi-output-card").forEach(card => {
      const output = outputs.find(o => o.id === card.dataset.outputId);
      const line = card.querySelector(".multi-status");
      if (!output || !line) return;
      line.textContent = statusText(output);
      line.dataset.state = statuses.get(output.id)?.error ? "error" : output.enabled && status?.live ? "on" : "off";
    });
  }

  // --- Rendering ---

  function usbOptions(current) {
    const options = ['<option value="">— Select USB device —</option>'];
    for (const port of usbPorts) {
      const label = [port.manufacturer, port.product].filter(Boolean).join(" ") || port.name || "USB serial DMX";
      options.push(`<option value="${escape(port.path)}" ${port.path === current ? "selected" : ""}>${escape(label)} — ${escape(port.path)}</option>`);
    }
    if (current && !usbPorts.some(port => port.path === current)) options.push(`<option value="${escape(current)}" selected>${escape(current)} (not connected)</option>`);
    return options.join("");
  }

  function cardHtml(output, index) {
    const usb = output.protocol === "usb";
    const sacn = output.protocol === "sacn";
    const option = (value, label, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
    const network = `
      <div class="form-row form-span"><label>${sacn ? "Target IP (unicast)" : "Target IP (the node, or a broadcast address)"}</label><input class="multi-target" value="${escape(output.target)}" spellcheck="false" ${sacn && output.multicast ? "disabled" : ""}></div>
      ${sacn ? `<div class="form-row"><label class="multi-toggle"><input class="multi-multicast" type="checkbox" ${output.multicast ? "checked" : ""}> Multicast</label></div>
      <div class="form-row"><label>Priority</label><input class="multi-priority" type="number" min="0" max="200" value="${output.priority}"></div>` : ""}`;
    const usbRows = `
      <div class="form-row form-span"><label>USB interface</label><select class="multi-usb">${usbOptions(output.usbDevice)}</select></div>
      <div class="form-row"><label>Interface type</label><select class="multi-driver">
        ${option("auto", "Detect", output.usbDriver)}${option("open-dmx", "Open DMX / FTDI", output.usbDriver)}${option("dmx-usb-pro", "DMX USB Pro / DMXking", output.usbDriver)}</select></div>
      <div class="form-row"><label>Refresh rate</label><select class="multi-rate">${USB_RATES.map(hz => `<option value="${hz}" ${hz === output.refreshRate ? "selected" : ""}>${hz} Hz</option>`).join("")}</select></div>`;
    return `
      <div class="multi-output-head">
        <strong>Output ${index + 1}</strong>
        <label class="multi-toggle"><input class="multi-enabled" type="checkbox" ${output.enabled ? "checked" : ""}> On</label>
        <button type="button" class="btn-danger-soft multi-remove">Remove</button>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>Protocol</label><select class="multi-protocol">
          ${option("artnet", "Art-Net", output.protocol)}${option("sacn", "sACN", output.protocol)}${option("usb", "USB DMX", output.protocol)}</select></div>
        <div class="form-row"><label>Universe (patch &amp; network)</label><input class="multi-universe" type="number" min="${sacn ? 1 : 0}" max="${sacn ? 63999 : 32767}" step="1" value="${output.universe}"></div>
        ${usb ? usbRows : network}
      </div>
      <small class="multi-status"></small>`;
  }

  function readCard(card, output) {
    const read = selector => card.querySelector(selector);
    output.protocol = read(".multi-protocol").value;
    output.enabled = read(".multi-enabled").checked;
    output.universe = clamp(read(".multi-universe").value, output.protocol === "sacn" ? 1 : 0, output.protocol === "sacn" ? 63999 : 32767, 1);
    if (read(".multi-target")) {
      output.target = read(".multi-target").value.trim() || networkTarget();
      try { localStorage.setItem(TARGET_KEY, output.target); } catch (_) {}
    }
    if (read(".multi-multicast")) output.multicast = read(".multi-multicast").checked;
    if (read(".multi-priority")) output.priority = clamp(read(".multi-priority").value, 0, 200, 100);
    if (read(".multi-usb")) output.usbDevice = read(".multi-usb").value;
    if (read(".multi-driver")) output.usbDriver = read(".multi-driver").value;
    if (read(".multi-rate")) output.refreshRate = Number(read(".multi-rate").value);
  }

  function render() {
    const host = $("multiOutputHost");
    if (!host) return;
    host.replaceChildren();
    outputs.forEach((output, index) => {
      const card = document.createElement("div");
      card.className = "multi-output-card";
      card.dataset.outputId = output.id;
      card.innerHTML = cardHtml(output, index);
      card.addEventListener("change", event => {
        const previousProtocol = output.protocol;
        readCard(card, output);
        if (previousProtocol !== output.protocol) {
          output.multicast = output.protocol === "sacn";
          if (output.protocol === "sacn" && output.universe < 1) output.universe = 1;
          if (output.protocol === "usb") refreshUsb();
        }
        if (previousProtocol !== output.protocol || event.target.matches(".multi-multicast")) render();
        apply();
      });
      card.querySelector(".multi-remove").addEventListener("click", () => {
        outputs = outputs.filter(o => o.id !== output.id);
        render();
        apply();
      });
      host.appendChild(card);
    });
    $("multiOutputAdd").disabled = outputs.length >= MAX_OUTPUTS;
    $("multiOutputCount").textContent = `${outputs.length}/${MAX_OUTPUTS}`;
    window.LXOutput?.status().then(showStatus).catch(() => {});
  }

  function renderNodes() {
    const list = $("artnetNodeList");
    if (!list) return;
    list.innerHTML = nodes.length
      ? nodes.map(node => `<button type="button" class="artnet-node" data-ip="${escape(node.ip)}" title="Send the Art-Net outputs to this node"><strong>${escape(node.shortName || node.longName || "Art-Net node")}</strong><span>${escape(node.ip)}${node.universes?.length ? ` · universe ${node.universes.join(", ")}` : ""}</span></button>`).join("")
      : '<span class="artnet-node-empty">No nodes found. Check the node is powered and on the same network as this computer.</span>';
  }

  async function refreshUsb() {
    try {
      usbPorts = await window.LXOutput.usbPorts();
    } catch (err) {
      usbPorts = [];
      window.log?.(`Could not list USB interfaces: ${err.message}`, "warn");
    }
    render();
  }

  async function findNodes() {
    $("artnetNodeList").innerHTML = '<span class="artnet-node-empty">Looking…</span>';
    await window.LXArtNet.poll();
    setTimeout(async () => {
      nodes = await window.LXArtNet.nodes();
      renderNodes();
    }, 1500);
  }

  function install() {
    if (!$("multiOutputHost") || !window.LXOutput) return;
    outputs = load();
    $("multiOutputAdd").addEventListener("click", () => {
      if (outputs.length >= MAX_OUTPUTS) return;
      const used = new Set(outputs.map(o => o.universe));
      let universe = 1;
      while (used.has(universe)) universe++;
      outputs.push(normalise([{ protocol: "artnet", universe, target: networkTarget(), enabled: false }])[0]);
      render();
      apply();
    });
    $("multiOutputRefreshUsb").addEventListener("click", refreshUsb);
    $("artnetFindNodes").addEventListener("click", findNodes);
    $("artnetNodeList").addEventListener("click", event => {
      const ip = event.target.closest("[data-ip]")?.dataset.ip;
      if (!ip) return;
      outputs.filter(o => o.protocol === "artnet").forEach(o => { o.target = ip; });
      try { localStorage.setItem(TARGET_KEY, ip); } catch (_) {}
      render();
      apply();
      window.log?.(`Art-Net outputs now send to ${ip}`, "ok");
    });
    window.LXOutput.onStatus(showStatus);
    window.LXArtNet.onNode(node => {
      nodes = [...nodes.filter(n => n.ip !== node.ip), node];
      renderNodes();
    });
    window.addEventListener("license-tier-changed", () => window.LXOutput.status().then(showStatus));
    render();
    apply();
    if (outputs.some(o => o.protocol === "usb")) refreshUsb();
  }

  // A show file brings its own outputs.
  window.addEventListener("show-multi-output-restore", event => {
    outputs = normalise(event.detail?.outputs);
    render();
    apply();
    window.log?.(`Outputs restored from show: ${outputs.length}`, "ok");
  });

  window.LXOutputs = Object.freeze({ list: () => outputs.map(o => ({ ...o })) });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
