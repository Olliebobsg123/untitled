"use strict";

(() => {
  if (window.__multiOutputUI) return;
  window.__multiOutputUI = true;
  const MAX_OUTPUTS = 10;
  const USB_RATES = [10, 15, 20, 25, 30, 35, 40];
  const $ = id => document.getElementById(id);
  const clamp = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; };
  const DEFAULT_NETWORK_TARGET = "192.168.1.1";
  let socket = null, reconnectTimer = null, usbPorts = [], outputs = [];

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem("lighting-multi-outputs") || "[]");
      if (Array.isArray(saved) && saved.length) return saved.slice(0, MAX_OUTPUTS);
      const old = JSON.parse(localStorage.getItem("lighting-output-settings") || "{}");
      const target = String(old.target || localStorage.getItem("lighting-network-target") || DEFAULT_NETWORK_TARGET);
      return [{ id: crypto.randomUUID?.() || `output-${Date.now()}`, protocol: String(old.protocol || "artnet").toLowerCase().includes("sacn") ? "sacn" : "artnet", universe: Number.isFinite(Number(old.universe)) ? Number(old.universe) : 0, target, usbDevice: "", refreshRate: 25, enabled: false, multicast: String(old.protocol || "").toLowerCase().includes("sacn"), priority: 100 }];
    } catch (_) { return [{ id: `output-${Date.now()}`, protocol: "artnet", universe: 0, target: DEFAULT_NETWORK_TARGET, usbDevice: "", refreshRate: 25, enabled: false, multicast: false, priority: 100 }]; }
  }
  outputs = load();
  outputs.forEach(o => { o.id ||= `output-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; o.protocol = ["artnet","sacn","usb"].includes(String(o.protocol).toLowerCase()) ? String(o.protocol).toLowerCase() : "artnet"; o.universe = o.protocol === "sacn" ? clamp(o.universe,1,63999,1) : clamp(o.universe,0,32767,0); o.refreshRate = clamp(o.refreshRate ?? 25,10,40,25); o.target ||= DEFAULT_NETWORK_TARGET; o.usbDevice ||= ""; o.enabled = Boolean(o.enabled); o.multicast = o.protocol === "sacn" ? Boolean(o.multicast) : false; o.priority = clamp(o.priority ?? 100,0,200,100); });
  const save = () => { try { localStorage.setItem("lighting-multi-outputs", JSON.stringify(outputs)); } catch (_) {} };
  const getNetworkTarget = () => String(localStorage.getItem("lighting-network-target") || outputs.find(o => o.protocol !== "usb" && o.target)?.target || DEFAULT_NETWORK_TARGET);
  const setNetworkTarget = value => { const target = String(value || "").trim(); if (!target) return; try { localStorage.setItem("lighting-network-target", target); } catch (_) {} };
  const send = m => { if (!socket || socket.readyState !== WebSocket.OPEN) return false; try { socket.send(JSON.stringify(m)); return true; } catch (_) { return false; } };
  const sendConfig = () => send({ type:"MULTI_OUTPUT_CONFIG", outputs:outputs.slice(0,MAX_OUTPUTS) });
  const requestUsbPorts = () => send({ type:"MULTI_USB_PORTS" });
  const sendMode = mode => send({ type:"MULTI_OUTPUT_MODE", mode: String(mode).toUpperCase() === "BLIND" ? "BLIND" : "LIVE" });
  window.__setMultiOutputMode = sendMode;

  function normalizeOutputs(next) {
    return (Array.isArray(next) ? next : []).slice(0, MAX_OUTPUTS).map((raw, index) => {
      const o = { ...raw };
      o.id ||= `output-${Date.now()}-${index}-${Math.random().toString(36).slice(2,7)}`;
      o.protocol = ["artnet","sacn","usb"].includes(String(o.protocol).toLowerCase()) ? String(o.protocol).toLowerCase() : "artnet";
      o.universe = o.protocol === "sacn" ? clamp(o.universe,1,63999,1) : clamp(o.universe,0,32767,0);
      o.target = String(o.target || getNetworkTarget());
      o.usbDevice = String(o.usbDevice || "");
      o.refreshRate = clamp(o.refreshRate ?? 25,10,40,25);
      o.enabled = Boolean(o.enabled);
      o.multicast = o.protocol === "sacn" ? Boolean(o.multicast) : false;
      o.priority = clamp(o.priority ?? 100,0,200,100);
      return o;
    });
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    try {
      socket = new WebSocket("ws://127.0.0.1:8084");
      socket.onopen = () => {
        sendConfig();
        requestUsbPorts();
        sendMode(window.getConsoleMode?.() || (window.__licenseTier === "free" ? "BLIND" : "LIVE"));
      };
      socket.onmessage = e => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "MULTI_USB_PORTS") { usbPorts = Array.isArray(m.ports) ? m.ports : []; render(); }
          if (m.type === "MULTI_OUTPUT_STATUS") {
            const byId = new Map((m.outputs || []).map(o => [o.id, o]));
            outputs.forEach(o => { const s = byId.get(o.id); if (s) o.__status = s; });
            renderStatuses();
            window.dispatchEvent(new CustomEvent("multi-output-status", { detail: m }));
          }
        } catch (_) {}
      };
      socket.onclose = () => { socket = null; reconnectTimer = setTimeout(connect, 1500); };
      socket.onerror = () => {};
    } catch (_) { reconnectTimer = setTimeout(connect, 1500); }
  }

  function canPhysicalOutput() {
    const tier = String(window.__licenseTier || window.getLicenseTier?.() || "FREE").toUpperCase();
    return tier === "LIVE" || tier === "PRO";
  }

  function sendDMX() {
    if (!canPhysicalOutput()) return;
    if (!outputs.some(o=>o.enabled)) return;
    const universes = patchUniverseFrames();
    for (const output of outputs) {
      if (!output.enabled) continue;
      const u=Number(output.universe);
      if (!Number.isInteger(u)) continue;
      if (!Object.prototype.hasOwnProperty.call(universes,u)) universes[u]=new Array(512).fill(0);
    }
    send({type:"MULTI_DMX_UPDATE",universes});
  }

  function patchUniverseFrames() {
    const frames = {};
    const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
    const dmx = window.State?.dmx;
    if (!(dmx instanceof Uint8Array) && !Array.isArray(dmx)) return frames;
    const getDef = window.getFixtureDefinition || (f => window.FixtureLibrary?.[f?.name]);
    for (const fixture of fixtures) {
      const universe = Number(fixture?.uni ?? fixture?.universe);
      if (!Number.isInteger(universe) || universe < 0 || universe > 32767) continue;
      const base = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.channel) - 1;
      if (!Number.isInteger(base) || base < 0 || base >= 512) continue;
      const def = getDef?.(fixture);
      const channels = Math.max(1, Math.min(512, Number(def?.channels || def?.channelCount || 1)));
      if (!frames[universe]) frames[universe] = new Array(512).fill(0);
      for (let i=0;i<channels && base+i<512;i++) frames[universe][base+i]=Number(dmx[base+i])&255;
    }
    return frames;
  }

  function usbOptions(current){const a=[`<option value="">— Select USB device —</option>`];for(const p of usbPorts){const label=[p.manufacturer,p.product].filter(Boolean).join(" ")||"USB serial DMX";const value=String(p.path||"");const safe=value.replace(/&/g,"&amp;").replace(/"/g,"&quot;");a.push(`<option value="${safe}" ${value===String(current||"")?"selected":""}>${label} — ${value}</option>`);}return a.join("");}
  function statusText(o){const s=o.__status;if(!o.enabled)return "Disabled";if(s?.error)return `Error: ${s.error}`;if(o.protocol==="usb")return s?.connected?`Connected · ${o.usbDevice} · ${o.refreshRate} Hz`:"USB device not connected";return s?.connected?`Online · ${o.protocol==="sacn"?"sACN":"Art-Net"} DMX universe ${o.universe}`:"Waiting for network output";}
  function renderStatuses(){document.querySelectorAll(".multi-output-card").forEach(c=>{const o=outputs.find(x=>x.id===c.dataset.outputId);const s=c.querySelector(".multi-status");if(o&&s)s.textContent=statusText(o);});}

  function render(){
    const host=$("multiOutputHost"); if(!host)return; host.innerHTML="";
    outputs.forEach((output,index)=>{
      const card=document.createElement("div"); card.className="multi-output-card"; card.dataset.outputId=output.id; card.style.cssText="border:1px solid var(--border,#333);border-radius:10px;padding:12px;margin:10px 0;background:rgba(255,255,255,.025);";
      const isUsb=output.protocol==="usb", isSacn=output.protocol==="sacn";
      card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;"><strong>Output ${index+1}</strong><button type="button" class="btn-danger-soft multi-remove">Remove</button></div><div class="form-grid"><div class="form-row"><label>Protocol</label><select class="multi-protocol"><option value="artnet">Art-Net</option><option value="sacn">sACN</option><option value="usb">USB DMX</option></select></div><div class="form-row"><label>DMX Universe</label><input class="multi-universe" type="number" min="${isSacn?1:0}" max="${isSacn?63999:32767}" step="1" value="${output.universe}"></div><div class="form-row multi-network-row"><label>${isSacn?"Target IP / Multicast":"Target IP"}</label><input class="multi-target" value="${String(output.target||getNetworkTarget()).replace(/"/g,"&quot;")}"></div><div class="form-row multi-multicast-row"><label>Use sACN Multicast</label><input class="multi-multicast" type="checkbox" ${output.multicast?"checked":""}></div><div class="form-row multi-priority-row"><label>sACN Priority</label><input class="multi-priority" type="number" min="0" max="200" step="1" value="${output.priority}"></div><div class="form-row multi-usb-row"><label>USB Device</label><select class="multi-usb">${usbOptions(output.usbDevice)}</select></div><div class="form-row multi-rate-row"><label>USB Refresh Rate</label><select class="multi-rate">${USB_RATES.map(h=>`<option value="${h}">${h} Hz</option>`).join("")}</select></div><div class="form-row"><label>Enabled</label><input class="multi-enabled" type="checkbox" ${output.enabled?"checked":""}></div></div><small class="multi-status" style="display:block;margin-top:7px;opacity:.7;"></small>`;
      const protocol=card.querySelector(".multi-protocol"), universe=card.querySelector(".multi-universe"), target=card.querySelector(".multi-target"), multicast=card.querySelector(".multi-multicast"), priority=card.querySelector(".multi-priority"), usb=card.querySelector(".multi-usb"), rate=card.querySelector(".multi-rate"), enabled=card.querySelector(".multi-enabled"); protocol.value=output.protocol; rate.value=String(output.refreshRate);
      const sync=()=>{const old=output.protocol;output.protocol=protocol.value;output.universe=output.protocol==="sacn"?clamp(universe.value,1,63999,1):clamp(universe.value,0,32767,0);output.target=target.value.trim()||getNetworkTarget();output.usbDevice=usb.value;output.refreshRate=clamp(rate.value,10,40,25);output.enabled=enabled.checked;output.multicast=output.protocol==="sacn"?multicast.checked:false;output.priority=clamp(priority.value,0,200,100);if(output.protocol!=="usb")setNetworkTarget(output.target);if(old!==output.protocol&&output.protocol==="sacn")output.multicast=true;if(old!==output.protocol){universe.min=output.protocol==="sacn"?"1":"0";universe.max=output.protocol==="sacn"?"63999":"32767";}delete output.__status;save();sendConfig();render();};
      [protocol,universe,target,multicast,priority,usb,rate,enabled].forEach(el=>el.addEventListener("change",sync));
      card.querySelector(".multi-remove").onclick=()=>{outputs=outputs.filter(o=>o.id!==output.id);save();sendConfig();render();};
      card.querySelector(".multi-usb-row").style.display=isUsb?"":"none";card.querySelector(".multi-rate-row").style.display=isUsb?"":"none";card.querySelector(".multi-network-row").style.display=isUsb?"none":"";card.querySelector(".multi-multicast-row").style.display=isSacn?"":"none";card.querySelector(".multi-priority-row").style.display=isSacn?"":"none";host.appendChild(card);
    });
    const add=$("multiOutputAdd");if(add)add.disabled=outputs.length>=MAX_OUTPUTS;const count=$("multiOutputCount");if(count)count.textContent=`${outputs.length}/${MAX_OUTPUTS}`;const defaultTarget=$("multiDefaultTarget");if(defaultTarget)defaultTarget.value=getNetworkTarget();renderStatuses();
  }

  function installUI(){
    const outMode=$("outMode"),oldPanel=outMode?.closest(".panel");if(!oldPanel||$("multiOutputPanel"))return;oldPanel.style.display="none";
    const panel=document.createElement("section");panel.className="panel";panel.id="multiOutputPanel";panel.innerHTML=`<div class="panel-header"><div><span class="eyebrow">OUTPUT</span> DMX Outputs</div><span class="panel-meta" id="multiOutputCount">0/10</span></div><div class="panel-body"><p style="opacity:.7;margin-top:0;">Network output stays active while the console is idle. Set the destination IP here; it is saved for future Art-Net and sACN outputs. sACN supports unicast or multicast.</p><div class="form-row" style="margin-bottom:12px;"><label>Default Network Target IP</label><input id="multiDefaultTarget" value="${getNetworkTarget().replace(/"/g,"&quot;")}" placeholder="192.168.1.1" spellcheck="false" autocomplete="off"></div><div id="multiOutputHost"></div><div class="action-row"><button class="btn-primary" id="multiOutputAdd">＋ Add Output</button><button class="btn-secondary" id="multiOutputRefreshUsb">↻ Refresh USB Devices</button></div></div>`;oldPanel.parentElement?.insertBefore(panel,oldPanel);
    $("multiDefaultTarget").addEventListener("change",()=>{const target=$("multiDefaultTarget").value.trim();if(!target)return;setNetworkTarget(target);outputs.forEach(o=>{if(o.protocol!=="usb")o.target=target;});save();sendConfig();render();});
    $("multiOutputAdd").onclick=()=>{if(outputs.length>=MAX_OUTPUTS)return;outputs.push({id:`output-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,protocol:"artnet",universe:outputs.length,target:getNetworkTarget(),usbDevice:"",refreshRate:25,enabled:false,multicast:false,priority:100});save();sendConfig();render();};
    $("multiOutputRefreshUsb").onclick=requestUsbPorts;render();
  }

  window.addEventListener("show-multi-output-restore", e => {
    outputs = normalizeOutputs(e.detail?.outputs);
    save();
    sendConfig();
    render();
    console.log(`✅ Multi Output restored from show: ${outputs.length} universes`);
  });

  function install(){try{window.ArtNet?.stop?.();}catch(_){}installUI();connect();setInterval(sendDMX,40);window.addEventListener("beforeunload",()=>{try{socket?.close();}catch(_){}});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();
