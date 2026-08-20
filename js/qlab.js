/* ============================================================
   QLAB CLIENT
   Stable QLab client: connection, cue detection, authoritative
   duration/time tracking, timed lighting triggers and QLab GO.
   ============================================================ */
"use strict";

window.QLab = {
  ip: "127.0.0.1",
  bridgePort: 8083,
  passcode: "",
  ws: null,
  connected: false,
  reconnectTimer: null,
  watcher: null,
  cues: [],
  activeCue: null,
  activeElapsed: 0,
  activeDuration: null,
  activeRemaining: null,
  activePercent: null,
  activeRunning: false,
  workspaceId: null,
  cueLinks: {},
  timeTriggers: {},
  firedTriggers: new Set(),
  lastElapsed: -1,
  lastCue: null,

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("qlabConnectionSettings") || "{}");
      if (saved.ip !== undefined) this.ip = String(saved.ip);
      if (saved.bridgePort !== undefined) this.bridgePort = Number(saved.bridgePort) || 8083;
      if (saved.passcode !== undefined) this.passcode = String(saved.passcode);
    } catch (error) { console.warn("Could not load QLab settings:", error); }
  },

  saveSettings() {
    const ipInput = document.getElementById("qlabIpInput");
    const portInput = document.getElementById("qlabPortInput");
    const passInput = document.getElementById("qlabPasscodeInput");
    if (ipInput) this.ip = ipInput.value.trim() || "127.0.0.1";
    if (portInput) this.bridgePort = Number(portInput.value) || 8083;
    if (passInput) this.passcode = passInput.value;
    localStorage.setItem("qlabConnectionSettings", JSON.stringify({ ip: this.ip, bridgePort: this.bridgePort, passcode: this.passcode }));
  },

  escapeHTML(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
  },

  renderSettings() {
    const page = document.getElementById("page-qlab") || document.getElementById("qlabPage") || document.getElementById("qlab");
    if (!page || document.getElementById("qlabSettingsPanel")) return;
    const panel = document.createElement("div");
    panel.id = "qlabSettingsPanel";
    panel.style.cssText = "width:100%;box-sizing:border-box;margin:15px 0;padding:16px;background:#20202a;border:1px solid #444;border-radius:10px;color:#fff;";
    panel.innerHTML = `<div style="font-size:16px;font-weight:bold;margin-bottom:12px">⚙️ QLab Connection Settings</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
        <div><label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px">QLab IP Address</label><input id="qlabIpInput" type="text" value="${this.escapeHTML(this.ip)}" placeholder="127.0.0.1"></div>
        <div><label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px">Bridge Port</label><input id="qlabPortInput" type="number" value="${this.bridgePort}" placeholder="8083"></div>
        <div><label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px">Passcode</label><input id="qlabPasscodeInput" type="password" value="${this.escapeHTML(this.passcode)}"></div>
        <button class="btn-secondary" onclick="QLab.applySettings()">💾 Save &amp; Connect</button>
        <button class="btn-secondary" onclick="QLab.goFromLightingConsole()">▶ QLAB GO</button>
      </div>
      <div id="qlabSettingsStatus" style="margin-top:10px;font-size:11px;color:#888">Settings are saved in this browser.</div>`;
    page.appendChild(panel);
  },

  applySettings() {
    this.saveSettings();
    const status = document.getElementById("qlabSettingsStatus");
    if (status) status.textContent = `Connecting to ${this.ip}:${this.bridgePort}…`;
    this.connect(this.ip);
  },

  connect(ip = null) {
    if (ip !== null) this.ip = String(ip);
    this.stopWatcher();
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    const url = `ws://${this.ip}:${this.bridgePort}`;
    console.log("QLab bridge connecting:", url);
    try { this.ws = new WebSocket(url); } catch (error) { console.error("QLab WebSocket error:", error); this.scheduleReconnect(); return false; }
    this.ws.onopen = () => {
      this.connected = true;
      this.updateStatus(true);
      if (this.passcode) this.send({ type: "auth", passcode: this.passcode });
      this.send({ type: "subscribe" });
      this.syncCues();
      this.sendTimeTriggers();
      this.startWatcher();
      if (typeof log === "function") log("🎵 QLab connected — automatic cue tracking ACTIVE");
    };
    this.ws.onmessage = event => {
      try { this.handleMessage(JSON.parse(event.data)); }
      catch (error) { console.error("QLab message error:", error, event.data); }
    };
    this.ws.onerror = error => console.error("QLab bridge error:", error);
    this.ws.onclose = () => { this.connected = false; this.stopWatcher(); this.updateStatus(false); this.scheduleReconnect(); };
    return true;
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (!this.connected) this.connect(this.ip); }, 2000);
  },

  updateStatus(connected) {
    if (typeof window.updateQLabStatus === "function") window.updateQLabStatus(connected ? `Connected — ${this.ip}:${this.bridgePort}` : "Disconnected — retrying…", connected);
    const status = document.getElementById("qlabSettingsStatus");
    if (status) status.textContent = connected ? `Connected to ${this.ip}:${this.bridgePort}` : `Disconnected — retrying ${this.ip}:${this.bridgePort}`;
  },

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(JSON.stringify(message)); return true; }
    catch (error) { console.error("QLab send error:", error); return false; }
  },

  command(address, ...args) { return this.send({ type: "osc", address, args }); },
  syncCues() { return this.send({ type: "sync-cues" }); },
  go() { return this.command("/go"); },

  goFromLightingConsole() {
    if (!this.connected) { if (typeof log === "function") log("⚠️ QLab GO failed — bridge disconnected"); return false; }
    const result = this.command("/go");
    if (result && typeof log === "function") log("▶ QLab GO");
    return result;
  },

  lightingGo() { return this.goFromLightingConsole(); },
  qlabGo() { return this.goFromLightingConsole(); },
  stop() { const result = this.command("/stop"); this.resetTracking(); return result; },
  pause() { return this.command("/pause"); },
  resume() { return this.command("/resume"); },
  cue(number) { return this.goTo(number); },
  goTo(number) { number = String(number ?? "").trim(); return number ? this.command(`/cue/${number}/go`) : false; },
  cueStop(number) { number = String(number ?? "").trim(); return number ? this.command(`/cue/${number}/stop`) : false; },
  panic() { const result = this.command("/panic"); this.resetTracking(); return result; },

  startWatcher() { this.stopWatcher(); this.watcher = setInterval(() => this.pollQLab(), 250); this.pollQLab(); },
  stopWatcher() { if (this.watcher) { clearInterval(this.watcher); this.watcher = null; } },

  pollQLab() {
    if (!this.connected) return;
    // Ask for the cue that is actually playing, not the cue currently selected in QLab.
    this.command("/playbackPosition");
    if (this.activeCue) this.requestCurrentTime();
  },

  requestCurrentTime(cueNumber = this.activeCue) {
    if (!this.connected || !cueNumber) return;
    const cue = String(cueNumber).trim();
    if (!cue) return;
    this.command(`/cue/${cue}/currentFileTime`);
    this.command(`/cue/${cue}/currentDuration`);
    this.command(`/cue/${cue}/isRunning`);
  },

  handleMessage(message) {
    if (!message) return;
    if (message.type === "qlab-time") return this.handleCurrentTime(message.cueNumber, message.elapsed, message.duration, message.remaining, message.percent, message.ended);
    if (message.type === "qlab-duration") return this.handleDuration(message.cueNumber, message.duration);
    if (message.type === "qlab-running") return this.handleRunning(message.cueNumber, message.running);
    if (message.type === "qlab-lighting-trigger") {
      (Array.isArray(message.lights) ? message.lights : []).forEach(light => this.fireLightingCue(light, `QLab ${message.cueNumber} reached ${message.triggerTime}s`));
      return;
    }
    if (message.type === "status") { this.connected = !!message.connected; return; }
    if (message.type === "qlab-workspace") { this.workspaceId = message.workspaceId; return; }
    if (message.type === "qlab-cues") return this.loadCues(message.cues);
    if (message.type === "qlab-cue-start") {
      const cue = this.resolveCueNumber(message.cueNumber ?? message.number ?? message.cue);
      if (cue) this.startAudio(cue, this.extractDuration(message.duration, message.cue));
      return;
    }
    if (message.type === "qlab-cue-stop") {
      if (!message.cueNumber || String(message.cueNumber) === String(this.activeCue)) this.resetTracking();
      return;
    }
    if (message.type === "osc") return this.handleOSC(message.address, message.args);
    if (message.address) this.handleOSC(message.address, message.args ?? message.arguments ?? []);
  },

  handleOSC(address, args) {
    address = String(address || "");
    if (!Array.isArray(args)) args = args === undefined ? [] : [args];
    if (address.endsWith("/cueLists")) return this.loadCues(this.extractValue(args));
    if (address === "/playbackPosition" || address.endsWith("/playbackPosition")) return this.handlePlaybackPosition(args);

    let match = address.match(/\/cue\/([^/]+)\/currentFileTime$/);
    if (match) { const elapsed = this.extractNumber(args); if (elapsed !== null) this.handleCurrentTime(this.cleanCueIdentifier(match[1]), elapsed); return; }
    match = address.match(/\/cue\/([^/]+)\/currentDuration$/);
    if (match) { const duration = this.extractNumber(args); if (duration !== null) this.handleDuration(this.cleanCueIdentifier(match[1]), duration); return; }
    match = address.match(/\/cue\/([^/]+)\/isRunning$/);
    if (match) { const running = this.extractBoolean(args); if (running !== null) this.handleRunning(this.cleanCueIdentifier(match[1]), running); return; }
    match = address.match(/\/cue\/([^/]+)\/start$/);
    if (match) { const cue = this.resolveCueNumber(this.cleanCueIdentifier(match[1])); if (cue) this.startAudio(cue); return; }
    match = address.match(/\/cue\/([^/]+)\/stop$/);
    if (match && String(this.activeCue) === String(this.cleanCueIdentifier(match[1]))) this.resetTracking();
  },

  handlePlaybackPosition(args) {
    const value = this.extractValue(args);
    const cueNumber = this.resolveCueNumber(value) || this.findCueNumberDeep(value);
    if (!cueNumber) { if (this.activeCue) this.handleRunning(this.activeCue, false); return; }
    if (String(this.activeCue) !== String(cueNumber)) this.startAudio(cueNumber);
    else this.requestCurrentTime(cueNumber);
  },

  handleRunning(cueNumber, running) {
    cueNumber = this.resolveCueNumber(cueNumber) || String(cueNumber ?? "").trim();
    if (!cueNumber) return;
    if (running) {
      if (String(this.activeCue) !== String(cueNumber)) this.startAudio(cueNumber);
      else this.activeRunning = true;
      return;
    }
    if (String(this.activeCue) === String(cueNumber)) { this.activeRunning = false; this.resetTracking(); }
  },

  startAudio(cueNumber, duration = null) {
    cueNumber = String(cueNumber ?? "").trim();
    if (!cueNumber) return;
    cueNumber = this.resolveCueNumber(cueNumber) || cueNumber;
    const changed = String(this.activeCue) !== String(cueNumber);

    if (changed) {
      this.activeCue = cueNumber;
      this.activeElapsed = 0;
      // Do NOT carry the previous song's duration into the new cue.
      this.activeDuration = null;
      this.activeRemaining = null;
      this.activePercent = 0;
      this.activeRunning = true;
      this.lastCue = cueNumber;
      this.lastElapsed = -1;
      this.firedTriggers.clear();

      const cueDuration = this.extractDuration(duration, this.findCue(cueNumber));
      if (cueDuration !== null) this.activeDuration = cueDuration;
      if (this.activeDuration !== null) this.activeRemaining = this.activeDuration;

      this.renderCueSync();
      (Array.isArray(this.cueLinks[cueNumber]) ? this.cueLinks[cueNumber] : []).forEach(light => this.fireLightingCue(light, `QLab ${cueNumber} started`));
      if (typeof log === "function") log(`🎵 QLab Audio Cue ${cueNumber} started${this.activeDuration ? ` — ${this.formatTime(this.activeDuration)} duration` : ""}`);
    } else if (duration !== null) {
      const d = this.extractDuration(duration);
      if (d !== null) this.activeDuration = d;
    }
    this.requestCurrentTime(cueNumber);
  },

  handleDuration(cueNumber, duration) {
    cueNumber = String(cueNumber ?? "").trim();
    duration = Number(duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const resolved = this.resolveCueNumber(cueNumber);
    if (resolved) cueNumber = resolved;
    if (this.activeCue && String(cueNumber) !== String(this.activeCue)) return;
    if (!this.activeCue) this.activeCue = cueNumber;
    this.activeDuration = duration;
    this.activeRemaining = Math.max(0, duration - this.activeElapsed);
    this.activePercent = Math.min(100, Math.max(0, (this.activeElapsed / duration) * 100));
    this.updateCueSyncTime();
  },

  handleCurrentTime(cueNumber, elapsed, duration = null, remaining = null, percent = null, ended = false) {
    cueNumber = String(cueNumber ?? "").trim();
    elapsed = Number(elapsed);
    if (!Number.isFinite(elapsed)) return;
    const resolved = this.resolveCueNumber(cueNumber);
    if (resolved) cueNumber = resolved;
    if (!this.activeCue) this.startAudio(cueNumber, duration);
    if (this.activeCue && String(cueNumber) !== String(this.activeCue)) return;

    const d = Number(duration);
    if (Number.isFinite(d) && d > 0) this.activeDuration = d;
    if (this.lastElapsed >= 0 && elapsed < this.lastElapsed - 0.25) this.firedTriggers.clear();

    this.activeCue = cueNumber;
    this.activeElapsed = Math.max(0, elapsed);
    this.lastElapsed = elapsed;
    this.activeRunning = !ended;
    this.activeRemaining = this.activeDuration !== null ? Math.max(0, this.activeDuration - this.activeElapsed) : (remaining === null ? null : Number(remaining));
    this.activePercent = this.activeDuration !== null ? Math.min(100, Math.max(0, (this.activeElapsed / this.activeDuration) * 100)) : (percent === null ? null : Number(percent));

    this.updateCueSyncTime();
    this.checkTimedLighting(cueNumber, this.activeElapsed);

    if (ended || (this.activeDuration !== null && this.activeElapsed >= this.activeDuration - 0.1)) this.finishCue(cueNumber);
  },

  finishCue(cueNumber = this.activeCue) {
    if (!cueNumber) return;
    if (typeof log === "function") log(`🎵 QLab Audio Cue ${cueNumber} finished — lighting timeline stopped`);
    this.resetTracking();
  },

  checkTimedLighting(cueNumber, elapsed) {
    const triggers = this.timeTriggers?.[cueNumber];
    if (!triggers) return;
    const list = Array.isArray(triggers) ? triggers : Object.entries(triggers).map(([time, lights]) => ({ time, lights }));
    for (const trigger of list) {
      const time = Number(trigger?.time ?? trigger?.at ?? trigger?.seconds);
      if (!Number.isFinite(time) || elapsed + 0.08 < time) continue;
      const key = `${cueNumber}:${time}`;
      if (this.firedTriggers.has(key)) continue;
      this.firedTriggers.add(key);
      const lights = Array.isArray(trigger?.lights) ? trigger.lights : (trigger?.light !== undefined ? [trigger.light] : []);
      lights.forEach(light => this.fireLightingCue(light, `QLab ${cueNumber} reached ${time}s`));
    }
  },

  fireLightingCue(number, reason = "") {
    const n = parseInt(number, 10);
    if (!Number.isInteger(n) || n < 1) return;
    if (typeof window.goToCue === "function") window.goToCue(n - 1);
    if (typeof log === "function") log(`💡 Lighting Cue ${n} — ${reason}`);
  },

  extractDuration(...values) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
      if (value && typeof value === "object") {
        for (const candidate of [value.duration, value.currentDuration, value.length, value.fileDuration]) {
          const d = Number(candidate);
          if (Number.isFinite(d) && d > 0) return d;
        }
      }
    }
    return null;
  },

  extractBoolean(args) {
    if (!Array.isArray(args)) args = [args];
    for (const value of args) {
      if (typeof value === "boolean") return value;
      if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (["true", "t", "1", "yes"].includes(s)) return true;
        if (["false", "f", "0", "no"].includes(s)) return false;
        try { const parsed = JSON.parse(value); if (typeof parsed === "boolean") return parsed; } catch (_) {}
      }
      if (value && typeof value === "object") {
        for (const candidate of [value.data, value.value, value.running, value.isRunning]) {
          const result = this.extractBoolean([candidate]);
          if (result !== null) return result;
        }
      }
    }
    return null;
  },

  extractNumber(args) {
    if (!Array.isArray(args)) args = [args];
    for (const value of args) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
        try { const nested = this.extractNumber([JSON.parse(value)]); if (nested !== null) return nested; } catch (_) {}
      }
      if (value && typeof value === "object") {
        for (const candidate of [value.data, value.value, value.elapsed, value.currentFileTime, value.currentDuration, value.actionElapsed, value.time, value.duration]) {
          const n = Number(candidate);
          if (Number.isFinite(n)) return n;
        }
      }
    }
    return null;
  },

  extractValue(args) {
    if (!Array.isArray(args)) return args;
    if (!args.length) return null;
    if (args.length === 1 && typeof args[0] === "string") { try { return JSON.parse(args[0]); } catch (_) { return args[0]; } }
    return args.length === 1 ? args[0] : args;
  },

  resolveCueNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number") {
      let s = String(value).trim();
      if (!s || s === "[object Object]") return null;
      const pathMatch = s.match(/\/cue\/([^/]+)/);
      if (pathMatch) s = pathMatch[1];
      const direct = this.cues.find(cue => String(cue.number ?? cue.cueNumber ?? "") === s);
      if (direct) return String(direct.number ?? direct.cueNumber);
      const byId = this.cues.find(cue => String(cue.uniqueID ?? "") === s || String(cue.uniqueId ?? "") === s || String(cue.id ?? "") === s);
      if (byId) return String(byId.number ?? byId.cueNumber ?? "");
      return /^\d+(?:\.\d+)?$/.test(s) ? s : null;
    }
    if (value && typeof value === "object") {
      for (const candidate of [value.number, value.cueNumber, value.cue, value.playbackPosition, value.uniqueID, value.uniqueId, value.id, value.data, value.value]) {
        const result = this.resolveCueNumber(candidate);
        if (result) return result;
      }
    }
    return null;
  },

  findCueNumberDeep(value) {
    const direct = this.resolveCueNumber(value);
    if (direct) return direct;
    if (Array.isArray(value)) {
      for (const item of value) { const result = this.findCueNumberDeep(item); if (result) return result; }
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) { const result = this.findCueNumberDeep(item); if (result) return result; }
    }
    return null;
  },

  findCue(number) {
    return this.cues.find(cue => String(cue?.number ?? cue?.cueNumber ?? "") === String(number)) || null;
  },

  cleanCueIdentifier(value) {
    const s = String(value ?? "").trim();
    const match = s.match(/\/cue\/([^/]+)/);
    return match ? match[1] : s;
  },

  loadCues(data) {
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (_) { return; } }
    const result = [];
    const seen = new Set();
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      const number = value.number ?? value.cueNumber;
      const uniqueID = value.uniqueID ?? value.uniqueId ?? value.id;
      if (number !== undefined || uniqueID !== undefined) {
        const identity = String(uniqueID ?? number);
        if (!seen.has(identity)) { seen.add(identity); result.push(value); }
      }
      Object.values(value).forEach(child => { if (child && typeof child === "object") walk(child); });
    };
    walk(data);
    this.cues = result;
    this.renderCueSync();
    this.renderLinkEditor();
  },

  resetTracking() {
    this.activeCue = null;
    this.activeElapsed = 0;
    this.activeDuration = null;
    this.activeRemaining = null;
    this.activePercent = null;
    this.activeRunning = false;
    this.lastCue = null;
    this.lastElapsed = -1;
    this.firedTriggers.clear();
    this.renderCueSync();
  },

  formatTime(seconds) {
    const n = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  },

  updateCueSyncTime() {
    const elapsed = this.formatTime(this.activeElapsed);
    const duration = this.activeDuration === null ? "--:--" : this.formatTime(this.activeDuration);
    const remaining = this.activeRemaining === null ? "--:--" : this.formatTime(this.activeRemaining);
    const percent = this.activePercent === null ? "--" : `${Math.round(this.activePercent)}%`;
    const ids = {
      elapsed: ["qlabCueElapsed", "qlabElapsed"],
      duration: ["qlabCueDuration", "qlabDuration"],
      remaining: ["qlabCueRemaining", "qlabRemaining"],
      percent: ["qlabCuePercent", "qlabPercent"]
    };
    const values = { elapsed, duration, remaining, percent };
    Object.entries(ids).forEach(([key, candidates]) => {
      for (const id of candidates) {
        const node = document.getElementById(id);
        if (node) { node.textContent = values[key]; break; }
      }
    });
    const bar = document.getElementById("qlabCueProgress") || document.getElementById("qlabProgress");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(this.activePercent) || 0))}%`;
    const cueNode = document.getElementById("qlabActiveCue");
    if (cueNode) cueNode.textContent = this.activeCue || "—";
  },

  renderCueSync() {
    this.updateCueSyncTime();
    const node = document.getElementById("qlabActiveCue");
    if (node) node.textContent = this.activeCue || "—";
    const status = document.getElementById("qlabCueSyncStatus");
    if (status) status.textContent = this.activeCue ? `${this.activeRunning ? "RUNNING" : "STOPPED"} · Cue ${this.activeCue}` : "No active QLab cue";
  },

  renderLinkEditor() {
    if (typeof window.renderQLabLinkEditor === "function") window.renderQLabLinkEditor(this.cues, this.cueLinks);
  },

  sendTimeTriggers() { return this.send({ type: "set-time-triggers", triggers: this.timeTriggers }); }
};

QLab.loadSettings();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => QLab.renderSettings(), { once: true });
else QLab.renderSettings();
