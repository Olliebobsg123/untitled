/* QLAB CLIENT */
"use strict";

window.QLab = {
  ip: "127.0.0.1", bridgePort: 8083, passcode: "",
  ws: null, connected: false, reconnectTimer: null, watcher: null,
  cues: [], activeCue: null, activeElapsed: 0, activeDuration: null,
  activeRemaining: null, activePercent: null, workspaceId: null,
  cueLinks: {}, timeTriggers: {}, firedTriggers: new Set(),
  lastElapsed: -1, lastCue: null,

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("qlabConnectionSettings") || "{}");
      if (saved.ip !== undefined) this.ip = String(saved.ip);
      if (saved.bridgePort !== undefined) this.bridgePort = Number(saved.bridgePort) || 8083;
      if (saved.passcode !== undefined) this.passcode = String(saved.passcode);
    } catch (e) { console.warn("Could not load QLab settings:", e); }
  },

  saveSettings() {
    const ip = document.getElementById("qlabIpInput");
    const port = document.getElementById("qlabPortInput");
    const pass = document.getElementById("qlabPasscodeInput");
    if (ip) this.ip = ip.value.trim() || "127.0.0.1";
    if (port) this.bridgePort = Number(port.value) || 8083;
    if (pass) this.passcode = pass.value;
    localStorage.setItem("qlabConnectionSettings", JSON.stringify({ip:this.ip, bridgePort:this.bridgePort, passcode:this.passcode}));
  },

  escapeHTML(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); },

  renderSettings() {
    const page = document.getElementById("page-qlab") || document.getElementById("qlabPage") || document.getElementById("qlab");
    if (!page || document.getElementById("qlabSettingsPanel")) return;
    const panel = document.createElement("div");
    panel.id = "qlabSettingsPanel";
    panel.style.cssText = "width:100%;box-sizing:border-box;margin:15px 0;padding:16px;background:#20202a;border:1px solid #444;border-radius:10px;color:#fff;";
    panel.innerHTML = `<div style="font-size:16px;font-weight:bold;margin-bottom:12px">⚙️ QLab Connection Settings</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
      <div><label style="display:block;font-size:11px;color:#aaa">QLab IP Address</label><input id="qlabIpInput" value="${this.escapeHTML(this.ip)}"></div>
      <div><label style="display:block;font-size:11px;color:#aaa">Bridge Port</label><input id="qlabPortInput" type="number" value="${this.bridgePort}"></div>
      <div><label style="display:block;font-size:11px;color:#aaa">Passcode</label><input id="qlabPasscodeInput" type="password" value="${this.escapeHTML(this.passcode)}"></div>
      <button class="btn-secondary" onclick="QLab.applySettings()">💾 Save &amp; Connect</button>
      <button class="btn-secondary" onclick="QLab.goFromLightingConsole()">▶ QLAB GO</button></div>
      <div id="qlabSettingsStatus" style="margin-top:10px;font-size:11px;color:#888">Settings are saved in this browser.</div>`;
    page.appendChild(panel);
  },

  applySettings() { this.saveSettings(); this.connect(this.ip); },

  connect(ip = null) {
    if (ip !== null) this.ip = String(ip);
    this.stopWatcher();
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    const url = `ws://${this.ip}:${this.bridgePort}`;
    try { this.ws = new WebSocket(url); } catch (e) { console.error("QLab WebSocket error:",e); this.scheduleReconnect(); return false; }
    this.ws.onopen = () => {
      this.connected = true; this.updateStatus(true);
      if (this.passcode) this.send({type:"auth",passcode:this.passcode});
      this.send({type:"subscribe"}); this.syncCues(); this.sendTimeTriggers(); this.startWatcher();
      if (typeof log === "function") log("🎵 QLab connected — automatic cue tracking ACTIVE");
    };
    this.ws.onmessage = event => { try { this.handleMessage(JSON.parse(event.data)); } catch (e) { console.error("QLab message error:",e,event.data); } };
    this.ws.onerror = e => console.error("QLab bridge error:",e);
    this.ws.onclose = () => { this.connected=false; this.stopWatcher(); this.updateStatus(false); this.scheduleReconnect(); };
    return true;
  },

  scheduleReconnect() { if (this.reconnectTimer) return; this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;if(!this.connected)this.connect(this.ip);},2000); },
  updateStatus(connected) {
    if (typeof window.updateQLabStatus === "function") window.updateQLabStatus(connected?`Connected — ${this.ip}:${this.bridgePort}`:"Disconnected — retrying…",connected);
    const el=document.getElementById("qlabSettingsStatus"); if(el) el.textContent=connected?`Connected to ${this.ip}:${this.bridgePort}`:`Disconnected — retrying ${this.ip}:${this.bridgePort}`;
  },
  send(message) { if(!this.ws||this.ws.readyState!==WebSocket.OPEN)return false; try{this.ws.send(JSON.stringify(message));return true;}catch(e){console.error("QLab send error:",e);return false;} },
  command(address,...args){return this.send({type:"osc",address,args});},
  syncCues(){return this.send({type:"sync-cues"});},
  go(){return this.command("/go");},
  goFromLightingConsole(){if(!this.connected){if(typeof log==="function")log("⚠️ QLab GO failed — bridge disconnected");return false;}const r=this.command("/go");if(r&&typeof log==="function")log("▶ QLab GO");return r;},
  lightingGo(){return this.goFromLightingConsole();}, qlabGo(){return this.goFromLightingConsole();},
  stop(){const r=this.command("/stop");this.resetTracking();return r;}, pause(){return this.command("/pause");}, resume(){return this.command("/resume");}, cue(n){return this.goTo(n);},
  goTo(n){n=String(n??"").trim();return n?this.command(`/cue/${n}/go`):false;},
  cueStop(n){n=String(n??"").trim();return n?this.command(`/cue/${n}/stop`):false;},
  panic(){const r=this.command("/panic");this.resetTracking();return r;},

  startWatcher(){this.stopWatcher();this.watcher=setInterval(()=>this.pollQLab(),250);this.pollQLab();},
  stopWatcher(){if(this.watcher){clearInterval(this.watcher);this.watcher=null;}},
  pollQLab(){if(!this.connected)return;if(this.activeCue)this.requestCurrentTime();},
  requestCurrentTime(){if(!this.connected||!this.activeCue)return;const cue=String(this.activeCue).trim();if(cue){this.command(`/cue/${cue}/currentFileTime`);this.command(`/cue/${cue}/currentDuration`);this.command(`/cue/${cue}/isRunning`);}},

  handleMessage(message){
    if(!message)return;
    if(message.type==="qlab-time")return this.handleCurrentTime(message.cueNumber,message.elapsed,message.duration,message.remaining,message.percent,message.ended);
    if(message.type==="qlab-duration")return this.handleDuration(message.cueNumber,message.duration);
    if(message.type==="qlab-lighting-trigger"){(Array.isArray(message.lights)?message.lights:[]).forEach(l=>this.fireLightingCue(l,`QLab ${message.cueNumber} reached ${message.triggerTime}s`));return;}
    if(message.type==="status"){this.connected=!!message.connected;return;}
    if(message.type==="qlab-workspace"){this.workspaceId=message.workspaceId;return;}
    if(message.type==="qlab-cues")return this.loadCues(message.cues);
    if(message.type==="qlab-cue-start"){const cue=this.resolveCueNumber(message.cueNumber??message.number??message.cue);if(cue){const d=Number(message.duration);if(Number.isFinite(d)&&d>0)this.activeDuration=d;this.startAudio(cue);}return;}
    if(message.type==="qlab-cue-stop"){this.resetTracking();return;}
    if(message.type==="osc")return this.handleOSC(message.address,message.args);
    if(message.address)this.handleOSC(message.address,message.args??message.arguments??[]);
  },

  handleOSC(address,args){
    address=String(address||""); if(!Array.isArray(args))args=args===undefined?[]:[args];
    if(address.endsWith("/cueLists"))return this.loadCues(this.extractValue(args));
    if(address==="/playbackPosition"||address.endsWith("/playbackPosition"))return this.handlePlaybackPosition(args);
    let m=address.match(/\/cue\/([^/]+)\/currentFileTime$/); if(m){const n=this.extractNumber(args);if(n!==null)this.handleCurrentTime(this.cleanCueIdentifier(m[1]),n);return;}
    m=address.match(/\/cue\/([^/]+)\/currentDuration$/); if(m){const n=this.extractNumber(args);if(n!==null)this.handleDuration(this.cleanCueIdentifier(m[1]),n);return;}
    m=address.match(/\/cue\/([^/]+)\/start$/); if(m){const cue=this.cleanCueIdentifier(m[1]);this.startAudio(cue);return;}
    m=address.match(/\/cue\/([^/]+)\/stop$/); if(m&&String(this.activeCue)===String(this.cleanCueIdentifier(m[1])))this.resetTracking();
  },

  handlePlaybackPosition(args){const value=this.extractValue(args);if(this.isNothingPlaying(value)){if(this.activeCue)this.resetTracking();return;}const cue=this.resolveCueNumber(value)||this.findCueNumberDeep(value);if(!cue)return;if(String(this.activeCue)!==String(cue))this.startAudio(cue);else this.requestCurrentTime();},
  isNothingPlaying(value){if(value===null||value===undefined)return true;if(typeof value==="string"){const s=value.trim().toLowerCase();return !s||["none","null","false","0"].includes(s);}return false;},

  startAudio(cueNumber){
    cueNumber=String(cueNumber??"").trim();if(!cueNumber)return;cueNumber=this.resolveCueNumber(cueNumber)||cueNumber;
    const changed=String(this.activeCue)!==String(cueNumber);
    if(changed){this.activeCue=cueNumber;this.activeElapsed=0;this.activeRemaining=this.activeDuration??null;this.activePercent=0;this.lastCue=cueNumber;this.lastElapsed=-1;this.firedTriggers.clear();this.renderCueSync();
      (Array.isArray(this.cueLinks[cueNumber])?this.cueLinks[cueNumber]:[]).forEach(l=>this.fireLightingCue(l,`QLab ${cueNumber} started`));
      if(typeof log==="function")log(`🎵 QLab Audio Cue ${cueNumber} started${this.activeDuration?` — ${this.formatTime(this.activeDuration)} duration`:""}`);
    }
    this.requestCurrentTime();
  },

  handleDuration(cueNumber,duration){
    cueNumber=String(cueNumber??"").trim();duration=Number(duration);if(!Number.isFinite(duration)||duration<=0)return;
    const resolved=this.resolveCueNumber(cueNumber);if(resolved)cueNumber=resolved;
    if(this.activeCue&&String(cueNumber)!==String(this.activeCue))return;
    this.activeCue=cueNumber;this.activeDuration=duration;this.activeRemaining=Math.max(0,duration-this.activeElapsed);this.activePercent=Math.min(100,Math.max(0,(this.activeElapsed/duration)*100));this.updateCueSyncTime();
  },

  handleCurrentTime(cueNumber,elapsed,duration=null,remaining=null,percent=null,ended=false){
    cueNumber=String(cueNumber??"").trim();elapsed=Number(elapsed);if(!Number.isFinite(elapsed))return;
    const resolved=this.resolveCueNumber(cueNumber);if(resolved)cueNumber=resolved;
    if(!this.activeCue)this.startAudio(cueNumber);if(this.activeCue&&String(cueNumber)!==String(this.activeCue))return;
    if(duration!==null&&Number.isFinite(Number(duration))&&Number(duration)>0)this.activeDuration=Number(duration);
    if(this.lastElapsed>=0&&elapsed<this.lastElapsed-0.25)this.firedTriggers.clear();
    this.activeCue=cueNumber;this.activeElapsed=Math.max(0,elapsed);this.lastElapsed=elapsed;
    this.activeRemaining=this.activeDuration!==null?Math.max(0,this.activeDuration-elapsed):(remaining===null?null:Number(remaining));
    this.activePercent=this.activeDuration!==null?Math.min(100,Math.max(0,(elapsed/this.activeDuration)*100)):(percent===null?null:Number(percent));
    this.updateCueSyncTime();
    this.checkTimedLighting(cueNumber,elapsed);
    if(ended||(this.activeDuration!==null&&elapsed>=this.activeDuration-0.1)){this.resetTracking();if(typeof log==="function")log(`🎵 QLab Audio Cue ${cueNumber} finished — lighting timeline stopped`);}
  },

  checkTimedLighting(cueNumber,elapsed){
    const triggers=this.timeTriggers?.[cueNumber];if(!triggers)return;
    const list=Array.isArray(triggers)?triggers:Object.entries(triggers).map(([time,lights])=>({time,lights}));
    for(const trigger of list){const time=Number(trigger.time??trigger.at??trigger.seconds);if(!Number.isFinite(time)||elapsed+0.08<time)continue;const key=`${cueNumber}:${time}`;if(this.firedTriggers.has(key))continue;this.firedTriggers.add(key);const lights=Array.isArray(trigger.lights)?trigger.lights:(trigger.light!==undefined?[trigger.light]:[]);lights.forEach(l=>this.fireLightingCue(l,`QLab ${cueNumber} reached ${time}s`));}
  },

  fireLightingCue(number,reason=""){const n=parseInt(number,10);if(!Number.isInteger(n)||n<1)return;if(typeof window.goToCue==="function")window.goToCue(n-1);if(typeof log==="function")log(`💡 Lighting Cue ${n} — ${reason}`);},

  extractNumber(args){if(!Array.isArray(args))args=[args];for(const value of args){if(typeof value==="number"&&Number.isFinite(value))return value;if(typeof value==="string"&&value.trim()){const n=Number(value);if(Number.isFinite(n))return n;try{const x=this.extractNumber([JSON.parse(value)]);if(x!==null)return x;}catch(_){} }if(value&&typeof value==="object"){for(const c of [value.data,value.value,value.elapsed,value.currentFileTime,value.currentDuration,value.actionElapsed,value.time,value.duration]){const n=Number(c);if(Number.isFinite(n))return n;}}}return null;},
  extractValue(args){if(!Array.isArray(args))return args;if(!args.length)return null;if(args.length===1&&typeof args[0]==="string"){try{return JSON.parse(args[0]);}catch(_){return args[0];}}return args.length===1?args[0]:args;},

  resolveCueNumber(value){
    if(value===null||value===undefined)return null;
    if(typeof value==="string"||typeof value==="number"){let s=String(value).trim();if(!s||s==="[object Object]")return null;const p=s.match(/\/cue\/([^/]+)/);if(p)s=p[1];const direct=this.cues.find(c=>String(c.number??c.cueNumber??"")===s);if(direct)return String(direct.number??direct.cueNumber);const id=this.cues.find(c=>String(c.uniqueID??"")===s||String(c.uniqueId??"")===s||String(c.id??"")===s);if(id)return String(id.number??id.cueNumber??"");return/^\d+(?:\.\d+)?$/.test(s)?s:null;}
    if(value&&typeof value==="object"){for(const c of [value.number,value.cueNumber,value.cue,value.uniqueID,value.uniqueId,value.id,value.data,value.value]){const r=this.resolveCueNumber(c);if(r)return r;}}return null;
  },
  findCueNumberDeep(value){const d=this.resolveCueNumber(value);if(d)return d;if(Array.isArray(value)){for(const x of value){const r=this.findCueNumberDeep(x);if(r)return r;}}else if(value&&typeof value==="object"){for(const x of Object.values(value)){const r=this.findCueNumberDeep(x);if(r)return r;}}return null;},
  cleanCueIdentifier(v){const s=String(v??"").trim();const m=s.match(/\/cue\/([^/]+)/);return m?m[1]:s;},

  loadCues(data){
    if(typeof data==="string"){try{data=JSON.parse(data);}catch(_){return;}}
    const result=[],seen=new Set();const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(!v||typeof v!=="object")return;const number=v.number??v.cueNumber;const id=v.uniqueID??v.uniqueId??v.id;if(number!==undefined||id!==undefined){const key=String(id??number);if(!seen.has(key)){seen.add(key);result.push(v);}}Object.values(v).forEach(child=>{if(child&&typeof child==="object")walk(child);});};
    walk(data);this.cues=result;this.renderCueSync();this.renderLinkEditor();
  },

  resetTracking(){this.activeCue=null;this.activeElapsed=0;this.activeDuration=null;this.activeRemaining=null;this.activePercent=null;this.lastCue=null;this.lastElapsed=-1;this.firedTriggers.clear();this.renderCueSync();},
  formatTime(seconds){const n=Math.max(0,Number(seconds)||0),m=Math.floor(n/60),s=Math.floor(n%60);return `${m}:${String(s).padStart(2,"0")}`;},
  sendTimeTriggers(){return this.send({type:"set-time-triggers",triggers:this.timeTriggers});},

  updateCueSyncTime(){
    const current=this.formatTime(this.activeElapsed),duration=this.activeDuration===null?"--:--":this.formatTime(this.activeDuration),remaining=this.activeRemaining===null?"--:--":this.formatTime(this.activeRemaining),percent=this.activePercent===null?0:this.activePercent;
    for(const id of ["qlabCurrentTime","qlabElapsed","qlabCueElapsed","qlabCueTime"]){const e=document.getElementById(id);if(e)e.textContent=current;}
    for(const id of ["qlabDuration","qlabCueDuration"]){const e=document.getElementById(id);if(e)e.textContent=duration;}
    for(const id of ["qlabRemaining","qlabCueRemaining"]){const e=document.getElementById(id);if(e)e.textContent=remaining;}
    for(const id of ["qlabProgress","qlabCueProgress"]){const e=document.getElementById(id);if(e){if("value"in e)e.value=percent;e.style.width=`${Math.max(0,Math.min(100,percent))}%`;}}
    const cueEl=document.getElementById("qlabActiveCue");if(cueEl)cueEl.textContent=this.activeCue?`Cue ${this.activeCue}`:"No cue playing";
    if(typeof window.updateQLabCueSync==="function")window.updateQLabCueSync({cue:this.activeCue,elapsed:this.activeElapsed,duration:this.activeDuration,remaining:this.activeRemaining,percent:this.activePercent});
  },

  renderCueSync(){
    this.updateCueSyncTime();
    const cue=this.cues.find(c=>String(c.number??c.cueNumber??"")===String(this.activeCue)),name=cue?.name??cue?.displayName??cue?.cueName??"";
    const nameEl=document.getElementById("qlabActiveCueName");if(nameEl)nameEl.textContent=name;
    const status=document.getElementById("qlabCueStatus");if(status)status.textContent=this.activeCue?`Cue ${this.activeCue}${name?` — ${name}`:""}`:"No QLab audio cue active";
  },
  renderLinkEditor(){if(typeof window.renderQLabLinkEditor==="function")window.renderQLabLinkEditor(this.cues,this.cueLinks,this.timeTriggers);},
  setCueLink(cueNumber,lightingCues){const cue=String(cueNumber);this.cueLinks[cue]=Array.isArray(lightingCues)?lightingCues:[lightingCues];this.saveLinks();this.renderLinkEditor();},
  setTimeTriggers(cueNumber,triggers){this.timeTriggers[String(cueNumber)]=triggers;this.saveLinks();this.sendTimeTriggers();},
  saveLinks(){localStorage.setItem("qlabLightingLinks",JSON.stringify({cueLinks:this.cueLinks,timeTriggers:this.timeTriggers}));},
  loadLinks(){try{const x=JSON.parse(localStorage.getItem("qlabLightingLinks")||"{}");this.cueLinks=x.cueLinks||{};this.timeTriggers=x.timeTriggers||{};}catch(e){console.warn("Could not load QLab lighting links:",e);}},
  init(){this.loadSettings();this.loadLinks();this.renderSettings();this.renderCueSync();this.connect();}
};

window.addEventListener("load",()=>{if(window.QLab)window.QLab.init();});
