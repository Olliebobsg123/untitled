/* ============================================================
   QLAB CLIENT
   ------------------------------------------------------------
   Stable QLab client with:
   • configurable IP / bridge port / passcode
   • localStorage settings and lighting links
   • automatic cue detection and currentFileTime tracking
   • timed and immediate lighting triggers
   • automatic reconnect
   • lighting-console -> QLab GO

   IMPORTANT UI FIX:
   The cue list is no longer rebuilt every 250ms. Only the
   elapsed-time text is patched during playback, which prevents
   the QLab page/buttons from flashing or losing hover/focus.
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
      .replace(/"/g, "&quot;")
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
    // The bridge owns playback polling. This legacy client watcher is
    // intentionally disabled to prevent a second polling loop.
  },

  requestCurrentTime() {
    if (!this.connected || !this.activeCue) return;
    const cue = String(this.activeCue).trim();
    if (cue) this.command(`/cue/${cue}/currentFileTime`);
  },

  handleMessage(message) {
    if (!message) return;
    if (message.type === "qlab-time") return this.handleCurrentTime(message.cueNumber, message.elapsed);
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
      if (cue) this.startAudio(cue);
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

    match = address.match(/\/cue\/([^/]+)\/actionElapsed$/);
    if (match) {
      const elapsed = this.extractNumber(args);
      if (elapsed !== null) this.handleCurrentTime(this.cleanCueIdentifier(match[1]), elapsed);
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

      // Immediate lighting links fire once when a new QLab cue becomes active.
      // Timed links are owned by the bridge, which emits qlab-lighting-trigger.
      (Array.isArray(this.cueLinks[cueNumber]) ? this.cueLinks[cueNumber] : []).forEach(light => {
        this.fireLightingCue(light, `QLab ${cueNumber} started`);
      });

      if (typeof log === "function") log(`🎵 QLab Audio Cue ${cueNumber} started`);
    }
    this.requestCurrentTime();
  },

  handleCurrentTime(cueNumber, elapsed) {
    cueNumber = String(cueNumber ?? "").trim();
    elapsed = Number(elapsed);
    if (!Number.isFinite(elapsed)) return;

    const resolved = this.resolveCueNumber(cueNumber);
    if (resolved) cueNumber = resolved;
    if (!this.activeCue) this.startAudio(cueNumber);
    if (this.activeCue && String(cueNumber) !== String(this.activeCue)) return;

    if (this.lastElapsed >= 0 && elapsed < this.lastElapsed - 0.25) this.firedTriggers.clear();

    this.activeCue = cueNumber;
    this.activeElapsed = elapsed;
    this.lastElapsed = elapsed;

    // Timed lighting is deliberately NOT checked here. The bridge owns the
    // timed trigger clock so each configured lighting cue fires exactly once.
    this.updateCueSyncTime();
  },

  checkTimedLighting(cueNumber, elapsed) {
    // Kept for compatibility with older callers. The bridge is authoritative.
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
        for (const candidate of [value.data, value.value, value.elapsed, value.currentFileTime, value.actionElapsed, value.time]) {
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
    this.lastCue = null;
    this.lastElapsed = -1;
    this.firedTriggers.clear();
    this.renderCueSync();
  },

  sendTimeTriggers() {
    return this.send({ type: "set-time-triggers", triggers: this.timeTriggers });
  },

  addTimeTrigger(q) {
    q = String(q);
    if (!this.timeTriggers[q]) this.timeTriggers[q] = [];
    this.timeTriggers[q].push({ time: 5, lights: [] });
    this.saveAllLinks();
  },

  removeTimeTrigger(q, index) {
    q = String(q);
    if (!this.timeTriggers[q]) return;
    this.timeTriggers[q].splice(index, 1);
    if (!this.timeTriggers[q].length) delete this.timeTriggers[q];
    this.firedTriggers.clear();
    this.saveStoredLinks();
    this.sendTimeTriggers();
    this.renderLinkEditor();
    this.renderCueSync();
  },

  saveAllLinks() {
    document.querySelectorAll("#linkEditorList [data-immediate]").forEach(input => {
      const q = input.dataset.immediate;
      const numbers = input.value.split(",").map(x => parseInt(x.trim(), 10)).filter(Number.isInteger);
      if (numbers.length) this.cueLinks[q] = numbers;
      else delete this.cueLinks[q];
    });

    const next = {};
    document.querySelectorAll("#linkEditorList [data-time]").forEach(input => {
      const q = input.dataset.time;
      const index = Number(input.dataset.index);
      const lightInput = document.querySelector(`#linkEditorList [data-light="${CSS.escape(q)}"][data-index="${index}"]`);
      const time = Number(input.value);
      const light = Number(lightInput?.value);
      if (!Number.isFinite(time) || time < 0 || !Number.isInteger(light) || light < 1) return;
      if (!next[q]) next[q] = [];
      next[q].push({ time, lights: [light] });
    });

    Object.keys(next).forEach(q => next[q].sort((a, b) => Number(a.time) - Number(b.time)));
    this.timeTriggers = next;
    this.saveStoredLinks();
    this.firedTriggers.clear();
    this.sendTimeTriggers();
    this.renderLinkEditor();
    this.renderCueSync();
  },

  saveStoredLinks() {
    localStorage.setItem("qlabCueLinks", JSON.stringify(this.cueLinks));
    localStorage.setItem("qlabTimeTriggers", JSON.stringify(this.timeTriggers));
  },

  clearAllLinks() {
    this.cueLinks = {};
    this.timeTriggers = {};
    this.firedTriggers.clear();
    localStorage.removeItem("qlabCueLinks");
    localStorage.removeItem("qlabTimeTriggers");
    this.sendTimeTriggers();
    this.renderLinkEditor();
    this.renderCueSync();
  },

  addNewLinkRow() {
    const q = prompt("QLab audio cue number:");
    if (q === null || !String(q).trim()) return;
    const number = String(q).trim();
    if (!this.cues.some(cue => String(cue.number ?? cue.cueNumber ?? "") === number)) {
      this.cues.push({ number, name: "Audio Cue", type: "audio" });
    }
    this.renderLinkEditor();
  },

  renderLinkEditor() {
    const box = document.getElementById("linkEditorList");
    if (!box) return;
    box.innerHTML = "";

    this.cues.forEach(cue => {
      const q = String(cue.number ?? cue.cueNumber ?? "").trim();
      if (!q) return;
      const row = document.createElement("div");
      row.className = "link-panel";
      row.innerHTML = `
        <b>QLab ${this.escapeHTML(q)}</b>
        <input class="link-input" data-immediate="${this.escapeHTML(q)}" value="${this.escapeHTML((this.cueLinks[q] || []).join(", "))}" placeholder="1,2,3" style="width:120px">
        <button class="btn-secondary link-btn" onclick="QLab.addTimeTrigger('${this.escapeHTML(q)}')">+ Add Lighting Cue</button>
        <div style="font-size:10px;color:#777;margin:6px 0">Timed lighting cues:</div>
        <div data-triggers="${this.escapeHTML(q)}"></div>`;
      box.appendChild(row);

      const list = row.querySelector(`[data-triggers="${CSS.escape(q)}"]`);
      (this.timeTriggers[q] || []).forEach((trigger, index) => {
        const r = document.createElement("div");
        r.className = "link-row";
        r.innerHTML = `
          <span>At</span>
          <input type="number" class="link-input" data-time="${this.escapeHTML(q)}" data-index="${index}" value="${Number(trigger.time) || 0}" step="0.01" min="0">
          <span>sec → Lighting Cue</span>
          <input type="number" class="link-input" data-light="${this.escapeHTML(q)}" data-index="${index}" value="${(trigger.lights || [])[0] || ""}" min="1">
          <button class="btn-secondary link-btn" onclick="QLab.removeTimeTrigger('${this.escapeHTML(q)}', ${index})">✕</button>`;
        list?.appendChild(r);
      });
    });
  },

  renderCueSync() {
    const box = document.getElementById("qlabSyncList");
    if (!box) return;

    // Preserve the existing DOM when possible. Replacing innerHTML while
    // the mouse is over a button was the source of the visible hover flash.
    box.innerHTML = "";
    if (!this.cues.length) {
      box.innerHTML = `<div style="padding:15px;color:#aaa;text-align:center">No QLab cues found.</div>`;
      return;
    }

    this.cues.forEach(cue => {
      const q = String(cue.number ?? cue.cueNumber ?? "");
      if (!q) return;
      const row = document.createElement("div");
      row.dataset.qlabCueRow = q;
      row.style.cssText = "padding:10px;margin:4px 0;border-radius:6px;display:flex;gap:10px;align-items:center;";

      const name = cue.name || cue.displayName || cue.type || cue.cueType || "Unnamed";
      const triggers = this.timeTriggers[q] || [];
      const label = triggers.length
        ? triggers.map(x => `⏰ ${x.time}s → Light ${(x.lights || [])[0] || "?"}`).join(" | ")
        : "⚡ Not linked";

      row.innerHTML = `
        <b>${this.escapeHTML(q)}</b>
        <span style="flex:1">${this.escapeHTML(name)}</span>
        <span style="font-size:12px;min-width:160px">${this.escapeHTML(label)}</span>
        <span data-qlab-elapsed style="font-size:11px;color:#0f6;min-width:60px;text-align:right"></span>
        <button class="btn-secondary" type="button" onclick="QLab.goTo('${this.escapeHTML(q)}')">▶ GO</button>`;
      box.appendChild(row);
    });

    this.updateCueSyncTime();
  },

  updateCueSyncTime() {
    const box = document.getElementById("qlabSyncList");
    if (!box) return;
    box.querySelectorAll("[data-qlab-cue-row]").forEach(row => {
      const isActive = row.dataset.qlabCueRow === String(this.activeCue);
      row.style.background = isActive ? "#1a3a2a" : "#2a2a3a";
      row.style.borderLeft = isActive ? "3px solid #0f6" : "3px solid #444";
      const elapsed = row.querySelector("[data-qlab-elapsed]");
      if (elapsed) elapsed.textContent = isActive ? `▶ ${this.activeElapsed.toFixed(2)}s` : "";
    });
  }
};

window.QLabGO = () => window.QLab.goFromLightingConsole();
window.qlabGo = () => window.QLab.goFromLightingConsole();
window.goQLab = () => window.QLab.goFromLightingConsole();
window.lightingConsoleQLabGo = () => window.QLab.goFromLightingConsole();

QLab.loadSettings();
try {
  QLab.cueLinks = JSON.parse(localStorage.getItem("qlabCueLinks") || "{}");
  QLab.timeTriggers = JSON.parse(localStorage.getItem("qlabTimeTriggers") || "{}");
} catch (_) {
  QLab.cueLinks = {};
  QLab.timeTriggers = {};
}

let qlabDuration = 0;
function formatQLabTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function updateQLabDuration() {
  try {
    const media = document.querySelector("audio") || document.querySelector("video");
    if (media && Number.isFinite(media.duration) && media.duration > 0) qlabDuration = media.duration;
    const durationEl = document.getElementById("qlabDuration");
    if (durationEl && qlabDuration > 0) durationEl.textContent = formatQLabTime(qlabDuration);
  } catch (error) {
    console.warn("QLab duration check failed:", error);
  }
}
setInterval(updateQLabDuration, 250);
updateQLabDuration();

function installQLabGoButtonHooks() {
  ["#qlabGoButton", "#qlabGOButton", "#lightingQLabGo", "#lightingConsoleQLabGo", "#goQLab", "[data-qlab-go]"].forEach(selector => {
    document.querySelectorAll(selector).forEach(button => {
      if (button.dataset.qlabGoHooked === "true") return;
      button.dataset.qlabGoHooked = "true";
      button.addEventListener("click", () => QLab.goFromLightingConsole());
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  QLab.renderSettings();
  QLab.connect(QLab.ip);
  installQLabGoButtonHooks();
  setTimeout(installQLabGoButtonHooks, 500);
  setTimeout(installQLabGoButtonHooks, 1500);
});