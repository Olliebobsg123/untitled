/* ============================================================
   QLAB CLIENT
   ------------------------------------------------------------
   Stable QLab client with:
   • configurable IP / bridge port / passcode
   • localStorage settings and lighting links
   • automatic cue detection, elapsed time and duration tracking
   • timed and immediate lighting triggers
   • automatic reconnect
   • lighting-console -> QLab GO
   ============================================================ */

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
    } catch (error) {
      console.warn("Could not load QLab settings:", error);
    }
  },

  saveSettings() {
    const ipInput = document.getElementById("qlabIpInput");
    const portInput = document.getElementById("qlabPortInput");
    const passInput = document.getElementById("qlabPasscodeInput");

    if (ipInput) this.ip = ipInput.value.trim() || "127.0.0.1";
    if (portInput) this.bridgePort = Number(portInput.value) || 8083;
    if (passInput) this.passcode = passInput.value;

    localStorage.setItem("qlabConnectionSettings", JSON.stringify({
      ip: this.ip,
      bridgePort: this.bridgePort,
      passcode: this.passcode
    }));
  },

  escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  renderSettings() {
    const qlabPage = document.getElementById("page-qlab") || document.getElementById("qlabPage") || document.getElementById("qlab");
    if (!qlabPage || document.getElementById("qlabSettingsPanel")) return;

    const panel = document.createElement("div");
    panel.id = "qlabSettingsPanel";
    panel.style.cssText = "width:100%;box-sizing:border-box;margin:15px 0;padding:16px;background:#20202a;border:1px solid #444;border-radius:10px;color:#fff;";
    panel.innerHTML = `
      <div style="font-size:16px;font-weight:bold;margin-bottom:12px">⚙️ QLab Connection Settings</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
        <div><label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px">QLab IP Address</label>
          <input id="qlabIpInput" type="text" value="${this.escapeHTML(this.ip)}" placeholder="127.0.0.1" style="width:150px;padding:8px;border-radius:5px;border:1px solid #555;background:#111;color:#fff">
        </div>
        <div><label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px">Bridge Port</label>
          <input id="qlabPortInput" type="number" value="${this.bridgePort}" placeholder="8083" style="width:90px;padding:8px;border-radius:5px;border:1px solid #555;background:#111;color:#fff">
        </div>
        <div><label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px">Passcode</label>
          <input id="qlabPasscodeInput" type="password" value="${this.escapeHTML(this.passcode)}" placeholder="QLab bridge passcode" style="width:180px;padding:8px;border-radius:5px;border:1px solid #555;background:#111;color:#fff">
        </div>
        <button class="btn-secondary" onclick="QLab.applySettings()">💾 Save &amp; Connect</button>
        <button class="btn-secondary" onclick="QLab.goFromLightingConsole()" style="font-weight:bold;padding:9px 18px">▶ QLAB GO</button>
      </div>
      <div id="qlabSettingsStatus" style="margin-top:10px;font-size:11px;color:#888">Settings are saved in this browser.</div>
    `;
    qlabPage.appendChild(panel);
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

    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }

    const url = `ws://${this.ip}:${this.bridgePort}`;
    console.log("QLab bridge connecting:", url);

    try {
      this.ws = new WebSocket(url);
    } catch (error) {
      console.error("QLab WebSocket error:", error);
      this.scheduleReconnect();
      return false;
    }

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
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("QLab message error:", error, event.data);
      }
    };

    this.ws.onerror = error => console.error("QLab bridge error:", error);

    this.ws.onclose = () => {
      this.connected = false;
      this.stopWatcher();
      this.updateStatus(false);
      this.scheduleReconnect();
    };

    return true;
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected) this.connect(this.ip);
    }, 2000);
  },

  updateStatus(connected) {
    if (typeof window.updateQLabStatus === "function") {
      window.updateQLabStatus(
        connected ? `Connected — ${this.ip}:${this.bridgePort}` : "Disconnected — retrying…",
        connected
      );
    }
    const status = document.getElementById("qlabSettingsStatus");
    if (status) status.textContent = connected
      ? `Connected to ${this.ip}:${this.bridgePort}`
      : `Disconnected — retrying ${this.ip}:${this.bridgePort}`;
  },

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error("QLab send error:", error);
      return false;
    }
  },

  command(address, ...args) {
    return this.send({ type: "osc", address, args });
  },

  syncCues() { return this.send({ type: "sync-cues" }); },
  go() { return this.command("/go"); },

  goFromLightingConsole() {
    if (!this.connected) {
      if (typeof log === "function") log("⚠️ QLab GO failed — bridge disconnected");
      return false;
    }
    const result = this.command("/go");
    if (result && typeof log === "function") log("▶ QLab GO");
    return result;
  },

  lightingGo() { return this.goFromLightingConsole(); },
  qlabGo() { return this.goFromLightingConsole(); },

  stop() {
    const result = this.command("/stop");
    this.resetTracking();
    return result;
  },
  pause() { return this.command("/pause"); },
  resume() { return this.command("/resume"); },
  cue(number) { return this.goTo(number); },

  goTo(number) {
    number = String(number ?? "").trim();
    return number ? this.command(`/cue/${number}/go`) : false;
  },

  cueStop(number) {
    number = String(number ?? "").trim();
    return number ? this.command(`/cue/${number}/stop`) : false;
  },

  panic() {
    const result = this.command("/panic");
    this.resetTracking();
    return result;
  },

  startWatcher() {
    this.stopWatcher();
    this.watcher = setInterval(() => this.pollQLab(), 250);
    this.pollQLab();
  },

  stopWatcher() {
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
  },

  pollQLab() {
    if (!this.connected) return;
  },

  requestCurrentTime() {
    if (!this.connected || !this.activeCue) return;
    const cue = String(this.activeCue).trim();
    if (cue) {
      this.command(`/cue/${cue}/currentFileTime`);
      this.command(`/cue/${cue}/currentDuration`);
      this.command(`/cue/${cue}/isRunning`);
    }
  },

  handleMessage(message) {
    if (!message) return;
    if (message.type === "qlab-time") return this.handleCurrentTime(message.cueNumber, message.elapsed, message.duration, message.remaining, message.percent, message.ended);
    if (message.type === "qlab-duration") return this.handleDuration(message.cueNumber, message.duration);
    if (message.type === "qlab-lighting-trigger") {
      (Array.isArray(message.lights) ? message.lights : []).forEach(light =>
        this.fireLightingCue(light, `QLab ${message.cueNumber} reached ${message.triggerTime}s`)
      );
      return;
    }
    if (message.type === "status") { this.connected = !!message.connected; return; }
    if (message.type === "qlab-workspace") { this.workspaceId = message.workspaceId; return; }
    if (message.type === "qlab-cues") return this.loadCues(message.cues);
    if (message.type === "qlab-cue-start") {
      const cue = this.resolveCueNumber(message.cueNumber ?? message.number ?? message.cue);
      if (cue) {
        this.activeDuration = Number(message.duration);
        if (!Number.isFinite(this.activeDuration) || this.activeDuration <= 0) this.activeDuration = Number(message.cue?.duration) || null;
        this.startAudio(cue);
      }
      return;
    }
    if (message.type === "qlab-cue-stop") { this.resetTracking(); return; }
    if (message.type === "osc") return this.handleOSC(message.address, message.args);
    if (message.address) this.handleOSC(message.address, message.args ?? message.arguments ?? []);
  },

  handleOSC(address, args) {
    address = String(address || "");
    if (!Array.isArray(args)) args = args === undefined ? [] : [args];

    if (address.endsWith("/cueLists")) return this.loadCues(this.extractValue(args));
    if (address === "/playbackPosition" || address.endsWith("/playbackPosition")) return this.handlePlaybackPosition(args);

    let match = address.match(/\/cue\/([^/]+)\/currentFileTime$/);
    if (match) {
      const elapsed = this.extractNumber(args);
      if (elapsed !== null) this.handleCurrentTime(this.cleanCueIdentifier(match[1]), elapsed);
      return;
    }

    match = address.match(/\/cue\/([^/]+)\/currentDuration$/);
    if (match) {
      const duration = this.extractNumber(args);
      if (duration !== null) this.handleDuration(this.cleanCueIdentifier(match[1]), duration);
      return;
    }

    match = address.match(/\/cue\/([^/]+)\/start$/);
    if (match) {
      const cue = this.resolveCueNumber(this.cleanCueIdentifier(match[1]));
      if (cue) this.startAudio(cue);
      return;
    }

    match = address.match(/\/cue\/([^/]+)\/stop$/);
    if (match && String(this.activeCue) === String(this.cleanCueIdentifier(match[1]))) this.resetTracking();
  },

  handlePlaybackPosition(args) {
    const value = this.extractValue(args);
    if (this.isNothingPlaying(value)) {
      if (this.activeCue) this.resetTracking();
      return;
    }

    const cueNumber = this.resolveCueNumber(value) || this.findCueNumberDeep(value);
    if (!cueNumber) return;

    if (String(this.activeCue) !== String(cueNumber)) this.startAudio(cueNumber);
    else this.requestCurrentTime();
  },

  isNothingPlaying(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      return !s || s === "none" || s === "null" || s === "false" || s === "0";
    }
    return false;
  },

  startAudio(cueNumber) {
    cueNumber = String(cueNumber ?? "").trim();
    if (!cueNumber) return;
    cueNumber = this.resolveCueNumber(cueNumber) || cueNumber;

    const changed = String(this.activeCue) !== String(cueNumber);
    if (changed) {
      this.activeCue = cueNumber;
      this.activeElapsed = 0;
      this.lastCue = cueNumber;
      this.lastElapsed = -1;
      this.firedTriggers.clear();
      this.renderCueSync();

      (Array.isArray(this.cueLinks[cueNumber]) ? this.cueLinks[cueNumber] : []).forEach(light => {
        this.fireLightingCue(light, `QLab ${cueNumber} started`);
      });

      if (typeof log === "function") log(`🎵 QLab Audio Cue ${cueNumber} started${this.activeDuration ? ` — ${this.formatTime(this.activeDuration)} duration` : ""}`);
    }
    this.requestCurrentTime();
  },

  handleDuration(cueNumber, duration) {
    cueNumber = String(cueNumber ?? "").trim();
    duration = Number(duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const resolved = this.resolveCueNumber(cueNumber);
    if (resolved) cueNumber = resolved;
    if (this.activeCue && String(cueNumber) !== String(this.activeCue)) return;
    this.activeCue = cueNumber;
    this.activeDuration = duration;
    this.activeRemaining = this.activeElapsed >= 0 ? Math.max(0, duration - this.activeElapsed) : duration;
    this.activePercent = this.activeElapsed >= 0 ? Math.min(100, Math.max(0, (this.activeElapsed / duration) * 100)) : 0;
    this.updateCueSyncTime();
  },

  handleCurrentTime(cueNumber, elapsed, duration = null, remaining = null, percent = null, ended = false) {
    cueNumber = String(cueNumber ?? "").trim();
    elapsed = Number(elapsed);
    if (!Number.isFinite(elapsed)) return;

    const resolved = this.resolveCueNumber(cueNumber);
    if (resolved) cueNumber = resolved;
    if (!this.activeCue) this.startAudio(cueNumber);
    if (this.activeCue && String(cueNumber) !== String(this.activeCue)) return;

    if (duration !== null && Number.isFinite(Number(duration)) && Number(duration) > 0) this.activeDuration = Number(duration);
    if (this.lastElapsed >= 0 && elapsed < this.lastElapsed - 0.25) this.firedTriggers.clear();

    this.activeCue = cueNumber;
    this.activeElapsed = elapsed;
    this.lastElapsed = elapsed;
    this.activeRemaining = this.activeDuration === null ? (remaining === null ? null : Number(remaining)) : Math.max(0, this.activeDuration - elapsed);
    this.activePercent = this.activeDuration === null ? (percent === null ? null : Number(percent)) : Math.min(100, Math.max(0, (elapsed / this.activeDuration) * 100));

    this.updateCueSyncTime();

    if (ended) {
      this.resetTracking();
      if (typeof log === "function") log(`🎵 QLab Audio Cue ${cueNumber} finished — lighting timeline stopped`);
    }
  },

  checkTimedLighting(cueNumber, elapsed) {
    return undefined;
  },

  fireLightingCue(number, reason = "") {
    const n = parseInt(number, 10);
    if (!Number.isInteger(n) || n < 1) return;
    if (typeof window.goToCue === "function") window.goToCue(n - 1);
    if (typeof log === "function") log(`💡 Lighting Cue ${n} — ${reason}`);
  },

  extractNumber(args) {
    if (!Array.isArray(args)) args = [args];
    for (const value of args) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
        try {
          const nested = this.extractNumber([JSON.parse(value)]);
          if (nested !== null) return nested;
        } catch (_) {}
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
    if (args.length === 1 && typeof args[0] === "string") {
      try { return JSON.parse(args[0]); } catch (_) { return args[0]; }
    }
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
      const byId = this.cues.find(cue => String(cue.uniqueID ?? "") === s);
      if (byId) return String(byId.number ?? byId.cueNumber ?? "");
      const byOtherId = this.cues.find(cue => String(cue.id ?? "") === s || String(cue.uniqueId ?? "") === s);
      if (byOtherId) return String(byOtherId.number ?? byOtherId.cueNumber ?? "");
      return /^\d+(?:\.\d+)?$/.test(s) ? s : null;
    }
    if (value && typeof value === "object") {
      for (const candidate of [value.number, value.cueNumber, value.cue, value.uniqueID, value.uniqueId, value.id, value.data, value.value]) {
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
      for (const item of value) {
        const result = this.findCueNumberDeep(item);
        if (result) return result;
      }
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        const result = this.findCueNumberDeep(item);
        if (result) return result;
      }
    }
    return null;
  },

  cleanCueIdentifier(value) {
    const s = String(value ?? "").trim();
    const match = s.match(/\/cue\/([^/]+)/);
    return match ? match[1] : s;
  },

  loadCues(data) {
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (_) { return; }
    }

    const result = [];
    const seen = new Set();
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;

      const number = value.number ?? value.cueNumber;
      const uniqueID = value.uniqueID ?? value.uniqueId ?? value.id;
      if (number !== undefined || uniqueID !== undefined) {
        const identity = String(uniqueID ?? number);
        if (!seen.has(identity)) {
          seen.add(identity);
          result.push(value);
        }
      }
      Object.values(value).forEach(child => {
        if (child && typeof child === "object") walk(child);
      });
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

  sendTimeTriggers() {
    return this.send({ type: "set-time-triggers", triggers: this.timeTriggers });
  },
