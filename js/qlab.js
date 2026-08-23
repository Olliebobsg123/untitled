/* QLab frontend client */
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

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem("qlabConnectionSettings") || "{}");
      if (s.ip != null) this.ip = String(s.ip);
      if (s.bridgePort != null) this.bridgePort = Number(s.bridgePort) || 8083;
      if (s.passcode != null) this.passcode = String(s.passcode);
      this.cueLinks = JSON.parse(localStorage.getItem("qlabCueLinks") || "{}");
      this.timeTriggers = JSON.parse(localStorage.getItem("qlabTimeTriggers") || "{}");
    } catch (e) { console.warn("Could not load QLab settings:", e); }
  },

  saveSettings() {
    const ip = document.getElementById("qlabIpInput");
    const port = document.getElementById("qlabPortInput");
    const pass = document.getElementById("qlabPasscodeInput");
    if (ip) this.ip = ip.value.trim() || "127.0.0.1";
    if (port) this.bridgePort = Number(port.value) || 8083;
    if (pass) this.passcode = pass.value;
    localStorage.setItem("qlabConnectionSettings", JSON.stringify({ ip: this.ip, bridgePort: this.bridgePort, passcode: this.passcode }));
  },

  escapeHTML(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  },

  renderSettings() {
    const page = document.getElementById("page-qlab");
    if (!page || document.getElementById("qlabSettingsPanel")) return;
    const panel = document.createElement("div");
    panel.id = "qlabSettingsPanel";
    panel.className = "panel qlab-settings";
    panel.innerHTML = `
      <div class="panel-header"><div><span class="eyebrow">SETTINGS</span> QLab Connection</div><span class="panel-meta">BRIDGE</span></div>
      <div class="panel-body"><div class="form-grid">
        <div class="form-row"><label>QLab IP Address</label><input id="qlabIpInput" value="${this.escapeHTML(this.ip)}" placeholder="127.0.0.1"></div>
        <div class="form-row"><label>Bridge Port</label><input id="qlabPortInput" type="number" value="${this.bridgePort}"></div>
        <div class="form-row form-span"><label>Passcode</label><input id="qlabPasscodeInput" type="password" value="${this.escapeHTML(this.passcode)}"></div>
      </div><div class="action-row"><button class="btn-secondary" onclick="QLab.applySettings()">💾 Save & Connect</button></div>
      <div id="qlabSettingsStatus" class="inline-status">Settings are saved in this browser.</div></div>`;
    page.appendChild(panel);
  },

  applySettings() {
    this.saveSettings();
    const status = document.getElementById("qlabSettingsStatus");
    if (status) status.textContent = `Connecting to ${this.ip}:${this.bridgePort}…`;
    this.connect();
  },

  connect(ip = null) {
    if (ip != null) this.ip = String(ip);
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    this.stopWatcher();
    const url = `ws://${this.ip}:${this.bridgePort}`;
    try { this.ws = new WebSocket(url); } catch (e) { console.error("QLab WebSocket error:", e); this.scheduleReconnect(); return false; }
    this.ws.onopen = () => {
      this.connected = true;
      this.updateStatus(true);
      if (this.passcode) this.send({ type: "auth", passcode: this.passcode });
      this.send({ type: "subscribe" });
      this.syncCues();
      this.startWatcher();
      if (typeof log === "function") log("🎵 QLab connected");
    };
    this.ws.onmessage = e => {
      try { this.handleMessage(JSON.parse(e.data)); } catch (err) { console.error("QLab message error:", err, e.data); }
    };
    this.ws.onerror = e => console.error("QLab bridge error:", e);
    this.ws.onclose = () => { this.connected = false; this.stopWatcher(); this.updateStatus(false); this.scheduleReconnect(); };
    return true;
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (!this.connected) this.connect(); }, 2000);
  },

  updateStatus(connected) {
    if (typeof window.updateQLabStatus === "function") window.updateQLabStatus(connected ? `Connected — ${this.ip}:${this.bridgePort}` : "Disconnected — retrying…", connected);
    const s = document.getElementById("qlabSettingsStatus");
    if (s) s.textContent = connected ? `Connected to ${this.ip}:${this.bridgePort}` : `Disconnected — retrying ${this.ip}:${this.bridgePort}`;
  },

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(JSON.stringify(message)); return true; } catch (e) { console.error("QLab send error:", e); return false; }
  },

  command(address, ...args) { return this.send({ type: "osc", address, args }); },
  syncCues() { return this.send({ type: "sync-cues" }); },
  fetchPlayhead() { return this.send({ type: "check-playhead" }); },
  go() { return this.command("/go"); },
  goFromLightingConsole() { return this.go(); },
  lightingGo() { return this.go(); },
  qlabGo() { return this.go(); },
  stop() { const r = this.command("/stop"); this.resetTracking(); return r; },
  pause() { return this.command("/pause"); },
  resume() { return this.command("/resume"); },
  cue(n) { return this.goTo(n); },
  goTo(n) { n = String(n ?? "").trim(); return n ? this.command(`/cue/${n}/go`) : false; },
  cueStop(n) { n = String(n ?? "").trim(); return n ? this.command(`/cue/${n}/stop`) : false; },
  panic() { const r = this.command("/panic"); this.resetTracking(); return r; },

  startWatcher() {
    this.stopWatcher();
    this.watcher = setInterval(() => this.fetchPlayhead(), 500);
  },
  stopWatcher() { if (this.watcher) { clearInterval(this.watcher); this.watcher = null; } },

  handleMessage(message) {
    if (!message) return;
    if (message.type === "status") { this.connected = !!message.connected; return; }
    if (message.type === "qlab-workspace") { this.workspaceId = message.workspaceId; return; }
    if (message.type === "qlab-cues") { this.loadCues(message.cues); return; }
    if (message.type === "qlab-cue-start") { this.startAudio(message.cueNumber ?? message.number ?? message.cue); return; }
    if (message.type === "qlab-cue-stop") { this.resetTracking(); return; }
    if (message.type === "qlab-time") { this.handleCurrentTime(message.cueNumber, message.elapsed); return; }
    if (message.type === "qlab-lighting-trigger") {
      (Array.isArray(message.lights) ? message.lights : []).forEach(n => this.fireLightingCue(n, `QLab ${message.cueNumber} reached ${message.triggerTime}s`));
      return;
    }
    if (message.type === "osc") return this.handleOSC(message.address, message.args);
    if (message.address) this.handleOSC(message.address, message.args ?? message.arguments ?? []);
  },

  handleOSC(address, args) {
    address = String(address || "");
    if (address.endsWith("/cueLists") || address.endsWith("/cueLists/shallow")) return this.loadCues(this.extractValue(args));
    if (address.endsWith("/currentFileTime")) {
      const m = address.match(/\/cue\/([^/]+)\/currentFileTime$/);
      const t = this.extractNumber(args);
      if (m && t != null) this.handleCurrentTime(m[1], t);
    }
  },

  extractValue(args) {
    if (!Array.isArray(args)) return args;
    if (args.length === 1) {
      if (typeof args[0] !== "string") return args[0];
      try { return JSON.parse(args[0]); } catch (_) { return args[0]; }
    }
    return args;
  },

  extractNumber(value) {
    const list = Array.isArray(value) ? value : [value];
    for (const v of list) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; try { const n2 = this.extractNumber(JSON.parse(v)); if (n2 != null) return n2; } catch (_) {} }
      if (v && typeof v === "object") {
        for (const k of ["value","data","elapsed","currentFileTime","time"]) { const n = this.extractNumber(v[k]); if (n != null) return n; }
      }
    }
    return null;
  },

  /* QLab returns cue lists as nested objects. The old client treated every
     object containing an id as a cue, which caused cue-list/workspace objects
     to appear as bogus cues and real child cues to be lost. Only accept actual
     cue-numbered objects and recursively walk all common QLab child fields. */
  normalizeCue(raw, parent = null) {
    if (!raw || typeof raw !== "object") return null;
    const number = raw.number ?? raw.cueNumber ?? raw.cueNumberString ?? raw.displayNumber;
    if (number === undefined || number === null || String(number).trim() === "") return null;
    const q = { ...raw };
    q.number = String(number).trim();
    q.name = String(raw.name ?? raw.displayName ?? raw.title ?? raw.type ?? raw.cueType ?? "Unnamed").trim() || "Unnamed";
    q.type = String(raw.type ?? raw.cueType ?? raw.kind ?? "").trim();
    if (parent && !q.parentName) q.parentName = parent.name || parent.displayName || "";
    return q;
  },

  loadCues(data) {
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (_) { return; } }
    const found = [];
    const seen = new Set();
    const childKeys = ["cues","children","items","cueList","cueLists","contents","data"];
    const walk = (value, parent = null) => {
      if (!value) return;
      if (typeof value === "string") { try { walk(JSON.parse(value), parent); } catch (_) {} return; }
      if (Array.isArray(value)) { value.forEach(v => walk(v, parent)); return; }
      if (typeof value !== "object") return;
      const cue = this.normalizeCue(value, parent);
      if (cue) {
        const id = String(cue.uniqueID ?? cue.uniqueId ?? cue.number);
        const key = `${id}|${cue.number}`;
        if (!seen.has(key)) { seen.add(key); found.push(cue); }
      }
      const nextParent = value.name || value.displayName ? value : parent;
      childKeys.forEach(k => { if (value[k] !== undefined) walk(value[k], nextParent); });
      // Also inspect unknown nested arrays/objects, but don't recurse into the
      // cue's scalar fields. This handles different QLab reply shapes.
      Object.entries(value).forEach(([k, v]) => {
        if (childKeys.includes(k) || ["name","displayName","title","number","cueNumber","uniqueID","uniqueId","id"].includes(k)) return;
        if (v && typeof v === "object") walk(v, nextParent);
      });
    };
    walk(data);
    found.sort((a,b) => {
      const na = parseFloat(a.number), nb = parseFloat(b.number);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.number.localeCompare(b.number, undefined, { numeric: true });
    });
    this.cues = found;
    this.renderCueSync();
    this.renderLinkEditor();
    const sync = document.getElementById("qlabLastSync");
    if (sync) sync.textContent = `${found.length} CUES LOADED`;
    if (typeof log === "function") log(`🎵 QLab: loaded ${found.length} cues`);
  },

  resolveCueNumber(value) {
    if (value == null) return null;
    if (typeof value === "object") {
      for (const k of ["number","cueNumber","cue","uniqueID","uniqueId","id"]) {
        const r = this.resolveCueNumber(value[k]);
        if (r) return r;
      }
      return null;
    }
    const s = String(value).trim().replace(/^\/cue\//, "").split("/")[0];
    const match = this.cues.find(c => String(c.number) === s || String(c.uniqueID ?? c.uniqueId ?? c.id ?? "") === s);
    return match ? String(match.number) : (/^\d+(?:\.\d+)?$/.test(s) ? s : null);
  },

  startAudio(n) {
    const cue = this.resolveCueNumber(n) || String(n ?? "").trim();
    if (!cue) return;
    if (String(this.activeCue) !== cue) {
      this.activeCue = cue;
      this.activeElapsed = 0;
      this.firedTriggers.clear();
      (this.cueLinks[cue] || []).forEach(light => this.fireLightingCue(light, `QLab ${cue} started`));
      this.updateCueSyncTime();
    }
  },
  handleCurrentTime(n, elapsed) {
    const cue = this.resolveCueNumber(n) || String(n ?? "").trim();
    elapsed = Number(elapsed);
    if (!cue || !Number.isFinite(elapsed)) return;
    if (!this.activeCue || String(this.activeCue) !== cue) this.startAudio(cue);
    if (String(this.activeCue) !== cue) return;
    this.activeElapsed = elapsed;
    this.updateCueSyncTime();
  },
  resetTracking() { this.activeCue = null; this.activeElapsed = 0; this.firedTriggers.clear(); this.updateCueSyncTime(); },
  fireLightingCue(n, reason = "") {
    const number = parseInt(n, 10);
    if (!Number.isInteger(number) || number < 1) return;
    if (typeof window.goToCue === "function") window.goToCue(number - 1);
    if (typeof log === "function") log(`💡 Lighting Cue ${number} — ${reason}`);
  },

  renderCueSync() {
    const box = document.getElementById("qlabSyncList");
    if (!box) return;
    box.innerHTML = "";
    if (!this.cues.length) {
      box.innerHTML = `<div class="empty-state">No QLab cues found. Click Sync Cues.</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    this.cues.forEach(cue => {
      const q = String(cue.number);
      const row = document.createElement("div");
      row.dataset.qlabCueRow = q;
      row.style.cssText = "padding:10px;margin:4px 0;border-radius:6px;display:flex;gap:10px;align-items:center;";
      const triggers = this.timeTriggers[q] || [];
      const label = triggers.length ? triggers.map(t => `⏰ ${t.time}s → Light ${(t.lights || [])[0] || "?"}`).join(" | ") : "⚡ Not linked";
      row.innerHTML = `<b>${this.escapeHTML(q)}</b><span style="flex:1">${this.escapeHTML(cue.name)}</span><span style="font-size:12px;min-width:160px">${this.escapeHTML(label)}</span><span data-qlab-elapsed style="font-size:11px;min-width:60px;text-align:right"></span><button class="btn-secondary" type="button">▶ GO</button>`;
      row.querySelector("button").addEventListener("click", () => this.goTo(q));
      frag.appendChild(row);
    });
    box.appendChild(frag);
    this.updateCueSyncTime();
  },

  updateCueSyncTime() {
    const box = document.getElementById("qlabSyncList");
    if (!box) return;
    box.querySelectorAll("[data-qlab-cue-row]").forEach(row => {
      const active = row.dataset.qlabCueRow === String(this.activeCue);
      row.style.background = active ? "#1a3a2a" : "#2a2a3a";
      row.style.borderLeft = active ? "3px solid #0f6" : "3px solid #444";
      const e = row.querySelector("[data-qlab-elapsed]");
      if (e) e.textContent = active ? `▶ ${this.activeElapsed.toFixed(2)}s` : "";
    });
  },

  saveStoredLinks() {
    localStorage.setItem("qlabCueLinks", JSON.stringify(this.cueLinks));
    localStorage.setItem("qlabTimeTriggers", JSON.stringify(this.timeTriggers));
  },
  saveAllLinks() {
    document.querySelectorAll("#linkEditorList [data-immediate]").forEach(input => {
      const q = input.dataset.immediate;
      const nums = input.value.split(",").map(v => parseInt(v.trim(),10)).filter(Number.isInteger);
      if (nums.length) this.cueLinks[q] = nums; else delete this.cueLinks[q];
    });
    this.saveStoredLinks();
    this.renderLinkEditor();
    this.renderCueSync();
  },
  clearAllLinks() {
    this.cueLinks = {}; this.timeTriggers = {}; this.firedTriggers.clear();
    localStorage.removeItem("qlabCueLinks"); localStorage.removeItem("qlabTimeTriggers");
    this.send({ type: "set-time-triggers", triggers: {} });
    this.renderLinkEditor(); this.renderCueSync();
  },
  addNewLinkRow() {
    const q = prompt("QLab cue number:");
    if (q == null || !String(q).trim()) return;
    const n = String(q).trim();
    if (!this.cues.some(c => String(c.number) === n)) this.cues.push({ number:n, name:"Cue", type:"" });
    this.cues.sort((a,b) => a.number.localeCompare(b.number,undefined,{numeric:true}));
    this.renderLinkEditor(); this.renderCueSync();
  },
  addTimeTrigger(q) {
    q = String(q);
    if (!Array.isArray(this.timeTriggers[q])) this.timeTriggers[q] = [];
    this.timeTriggers[q].push({ time:5, lights:[1] });
    this.saveStoredLinks();
    this.send({ type:"set-time-triggers", triggers:this.timeTriggers });
    this.renderLinkEditor(); this.renderCueSync();
  },
  removeTimeTrigger(q,index) {
    if (!this.timeTriggers[q]) return;
    this.timeTriggers[q].splice(index,1);
    if (!this.timeTriggers[q].length) delete this.timeTriggers[q];
    this.saveStoredLinks();
    this.send({ type:"set-time-triggers", triggers:this.timeTriggers });
    this.renderLinkEditor(); this.renderCueSync();
  },
  renderLinkEditor() {
    const box = document.getElementById("linkEditorList");
    if (!box) return;
    box.innerHTML = "";
    this.cues.forEach(cue => {
      const q = String(cue.number);
      const row = document.createElement("div"); row.className = "link-panel";
      row.innerHTML = `<b>QLab ${this.escapeHTML(q)}</b><input class="link-input" data-immediate="${this.escapeHTML(q)}" value="${this.escapeHTML((this.cueLinks[q]||[]).join(", "))}" placeholder="1,2,3" style="width:120px"><button class="btn-secondary link-btn" type="button">+ Add Lighting Cue</button><div style="font-size:10px;color:#777;margin:6px 0">Timed lighting cues:</div><div class="qlab-trigger-list"></div>`;
      row.querySelector("button").addEventListener("click", () => this.addTimeTrigger(q));
      const list = row.querySelector(".qlab-trigger-list");
      (this.timeTriggers[q]||[]).forEach((t,i) => {
        const r = document.createElement("div"); r.className="link-row";
        r.innerHTML = `<span>At</span><input type="number" class="link-input" value="${Number(t.time)||0}" step="0.01" min="0"><span>sec → Lighting Cue</span><input type="number" class="link-input" value="${(t.lights||[])[0]||1}" min="1"><button class="btn-secondary link-btn" type="button">✕</button>`;
        r.querySelectorAll("input")[0].addEventListener("change", e => { t.time=Number(e.target.value)||0; this.saveStoredLinks(); this.sendTimeTriggers(); });
        r.querySelectorAll("input")[1].addEventListener("change", e => { t.lights=[parseInt(e.target.value,10)||1]; this.saveStoredLinks(); this.sendTimeTriggers(); });
        r.querySelector("button").addEventListener("click", () => this.removeTimeTrigger(q,i));
        list.appendChild(r);
      });
      box.appendChild(row);
    });
  },
  sendTimeTriggers() { return this.send({ type:"set-time-triggers", triggers:this.timeTriggers }); },

  init() {
    this.renderSettings();
    this.renderCueSync();
    this.renderLinkEditor();
  }
};

window.QLabGO = () => window.QLab.goFromLightingConsole();
window.qlabGo = () => window.QLab.goFromLightingConsole();
window.goQLab = () => window.QLab.goFromLightingConsole();
window.lightingConsoleQLabGo = () => window.QLab.goFromLightingConsole();

QLab.loadSettings();
