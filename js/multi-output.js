"use strict";

(() => {
  if (window.__multiOutputUI) return;
  window.__multiOutputUI = true;
  const MAX_OUTPUTS = 10;
  const USB_RATES = [10, 15, 20, 25, 30, 35, 40];
  const $ = id => document.getElementById(id);
  const clamp = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; };
  // Broadcast: every Art-Net node on the network hears it, whatever its address.
  const DEFAULT_NETWORK_TARGET = "255.255.255.255";
  let socket = null, reconnectTimer = null, usbPorts = [], outputs = [], interfaces = null, nodes = null, searching = false;
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Art-Net counts universes from 0, so the Patch page's universe 1 goes out
  // as Art-Net universe 0 (like most consoles and nodes). sACN counts from 1.
  const wireFor = (protocol, source) => protocol === "sacn" ? clamp(source, 1, 63999, 1) : clamp(source - 1, 0, 32767, 0);
  // Which patch universe an output sends. Outputs saved before this existed
  // sent the patch universe matching their number; 0 matched nothing, so it
  // becomes universe 1 (still sent as Art-Net 0).
  const sourceOf = o => clamp(o.source ?? Math.max(1, Number(o.universe) || 0), 1, 32767, 1);

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
  outputs.forEach(o => { o.id ||= `output-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; o.protocol = ["artnet","sacn","usb"].includes(String(o.protocol).toLowerCase()) ? String(o.protocol).toLowerCase() : "artnet"; o.universe = o.protocol === "sacn" ? clamp(o.universe,1,63999,1) : clamp(o.universe,0,32767,0); o.refreshRate = clamp(o.refreshRate ?? 25,10,40,25); o.target ||= DEFAULT_NETWORK_TARGET; o.usbDevice ||= ""; o.enabled = Boolean(o.enabled); o.multicast = o.protocol === "sacn" ? Boolean(o.multicast) : false; o.priority = clamp(o.priority ?? 100,0,200,100); o.source = sourceOf(o); o.local = o.local !== false; });
  const save = () => { try { localStorage.setItem("lighting-multi-outputs", JSON.stringify(outputs)); } catch (_) {} };
  const getNetworkTarget = () => String(localStorage.getItem("lighting-network-target") || outputs.find(o => o.protocol !== "usb" && o.target)?.target || DEFAULT_NETWORK_TARGET);
  const setNetworkTarget = value => { const target = String(value || "").trim(); if (!target) return; try { localStorage.setItem("lighting-network-target", target); } catch (_) {} };
  const send = m => { if (!socket || socket.readyState !== WebSocket.OPEN) return false; try { socket.send(JSON.stringify(m)); return true; } catch (_) { return false; } };
  const sendConfig = () => send({ type:"MULTI_OUTPUT_CONFIG", outputs:outputs.slice(0,MAX_OUTPUTS) });
  const requestUsbPorts = () => send({ type:"MULTI_USB_PORTS" });
  // A backup, client or mirror console holds its output (js/session.js): it
  // never drives the lights unless it takes over.
  const sendMode = mode => send({ type:"MULTI_OUTPUT_MODE", mode: canPhysicalOutput() && !window.__lxOutputHeld ? (String(mode).toUpperCase() === "BLIND" ? "BLIND" : "LIVE") : "BLIND" });
  window.__setMultiOutputMode = sendMode;
  window.__refreshOutputMode = () => sendMode(window.getConsoleMode?.() || "LIVE");

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
      o.source = sourceOf(o);
      o.local = o.local !== false;
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
        send({ type: "MULTI_INTERFACES" });
        sendMode(window.getConsoleMode?.() || (window.__licenseTier === "free" ? "BLIND" : "LIVE"));
      };
      socket.onmessage = e => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "MULTI_USB_PORTS") { usbPorts = Array.isArray(m.ports) ? m.ports : []; render(); }
          if (m.type === "MULTI_INTERFACES") { interfaces = m.interfaces || []; renderStatuses(); }
          if (m.type === "MULTI_DISCOVERED") { searching = false; nodes = m.nodes || []; interfaces = m.interfaces || interfaces; renderNodes(); renderStatuses(); }
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
    // window.State.dmx spans every patch universe end-to-end (see js/dmx.js),
    // so reading it needs the fixture's GLOBAL offset (getFixtureBaseAddress,
    // which folds fixture.uni in) — but writing into this universe's OWN
    // 512-channel wire frame needs the LOCAL offset (address alone). Using
    // the local offset for both, like before multi-universe support existed,
    // read every universe past the first back from the wrong slice of dmx.
    for (const fixture of fixtures) {
      const universe = Number(fixture?.uni ?? fixture?.universe);
      if (!Number.isInteger(universe) || universe < 0 || universe > 32767) continue;
      const base = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.channel) - 1;
      if (!Number.isInteger(base) || base < 0 || base >= 512) continue;
      const globalBase = typeof window.getFixtureBaseAddress === "function"
        ? window.getFixtureBaseAddress(fixture)
        : base;
      if (!Number.isInteger(globalBase) || globalBase < 0) continue;
      const def = getDef?.(fixture);
      const channels = Math.max(1, Math.min(512, Number(def?.channels || def?.channelCount || 1)));
      if (!frames[universe]) frames[universe] = new Array(512).fill(0);
      for (let i=0;i<channels && base+i<512;i++) frames[universe][base+i]=Number(dmx[globalBase+i])&255;
    }
    return frames;
  }

  function usbOptions(current){const a=[`<option value="">— Select USB device —</option>`];for(const p of usbPorts){const label=[p.manufacturer,p.product].filter(Boolean).join(" ")||"USB serial DMX";const value=String(p.path||"");const safe=value.replace(/&/g,"&amp;").replace(/"/g,"&quot;");a.push(`<option value="${safe}" ${value===String(current||"")?"selected":""}>${label} — ${value}</option>`);}return a.join("");}
  const ipNum = ip => String(ip).split(".").reduce((n, b) => n * 256 + (Number(b) & 255), 0);
  const isIp = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || "").trim());
  // Is the target on a network this computer is plugged into?
  function reachable(target) {
    if (!interfaces || !isIp(target) || target === "255.255.255.255" || /^127\./.test(target)) return true;
    return interfaces.some(i => { const m = ipNum(i.netmask); return ((ipNum(i.address) & m) >>> 0) === ((ipNum(target) & m) >>> 0); });
  }
  const patchedIn = u => (window.State?.fixtures || []).some(f => Number(f?.uni ?? f?.universe) === u);
  const sendErrorHint = e => /EACCES/.test(e) ? "the computer refused to send there" : /ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL/.test(e) ? "this computer isn't on that network" : /ENOTFOUND|EINVAL/.test(e) ? "that isn't an IP address" : e;

  // [text, level]: level "ok", "warn" or "off".
  function statusOf(o){
    const s=o.__status, name=o.protocol==="sacn"?"sACN":o.protocol==="usb"?"USB":"Art-Net";
    if(!o.enabled) return ["Off — tick Enabled to send", "off"];
    if(!canPhysicalOutput()) return ["Not sending: the Free licence is visualiser only", "warn"];
    if(window.__lxOutputHeld) return ["Held: this console isn't driving the lights (Multi-Console)", "warn"];
    if(String(window.getConsoleMode?.()||"LIVE").toUpperCase()==="BLIND") return ["Blind: holding output until you go back to Live", "warn"];
    if(s?.error) return [`Can't send: ${sendErrorHint(s.error)} (${s.error})`, "warn"];
    if(o.protocol==="usb") return s?.connected?[`Sending patch universe ${o.source} · ${o.usbDevice} · ${o.refreshRate} Hz`,"ok"]:["USB device not connected","warn"];
    if(!s?.connected) return ["Starting…", "warn"];
    const target=o.protocol==="sacn"&&o.multicast?"multicast":o.target;
    let text=`Sending patch universe ${o.source} as ${name} universe ${o.universe} to ${target}${o.protocol==="artnet"&&o.local&&!/^127\./.test(o.target)?" and this computer":""}`, level="ok";
    if(!patchedIn(o.source)) { text+=` · ⚠ no lights are patched in universe ${o.source}`; level="warn"; }
    else if(s && s.lit===false) text+=" · nothing is up yet";
    if(!(o.protocol==="sacn"&&o.multicast) && !reachable(o.target)) {
      const mine=interfaces.map(i=>i.address).join(", ")||"no network";
      text+=` · ⚠ this computer is on ${mine}, so ${o.target} can't be reached: change the target, or give the computer an address on that network (System Settings → Network)`; level="warn";
    }
    const node=o.protocol==="artnet"&&nodes?.find(n=>n.ip===o.target);
    if(node&&node.universes.length&&!node.universes.includes(o.universe)) { text+=` · ⚠ ${node.name||o.target} listens on Art-Net universe ${node.universes.join(", ")}`; level="warn"; }
    return [text, level];
  }
  function statusText(o){ return statusOf(o)[0]; }
  function renderStatuses(){
    document.querySelectorAll(".multi-output-card").forEach(c=>{const o=outputs.find(x=>x.id===c.dataset.outputId);const s=c.querySelector(".multi-status");if(o&&s){const [text,level]=statusOf(o);s.textContent=text;s.dataset.level=level;}});
    renderTopPill();
  }

  // The ART-NET light in the top bar: green while an output is sending
  // without trouble, amber when one has a problem, dark when none is on.
  function renderTopPill(){
    const pill=[...document.querySelectorAll(".topbar-status .status-pill")].find(p=>p.dataset.lxOutputs||/ART-NET/i.test(p.textContent));
    if(!pill)return;
    pill.dataset.lxOutputs="1";
    const on=outputs.filter(o=>o.enabled);
    const states=on.map(statusOf);
    const level=!on.length?"off":states.some(s=>s[1]==="warn")?"warn":"ok";
    const dot=pill.querySelector(".status-dot");
    if(dot){dot.className=`status-dot ${level==="ok"?"online":"offline"}`;dot.style.background=level==="warn"?"#f2b84b":"";dot.style.boxShadow=level==="warn"?"0 0 8px rgba(242,184,75,.6)":"";}
    const label=new Set(on.map(o=>o.protocol==="sacn"?"sACN":o.protocol==="usb"?"USB DMX":"ART-NET"));
    pill.lastChild.textContent=` ${label.size===1?[...label][0].toUpperCase():on.length?"DMX OUT":"ART-NET"}`;
    pill.title=on.length?states.map((s,i)=>`Output ${outputs.indexOf(on[i])+1}: ${s[0]}`).join("\n"):"No output is on — Settings → Outputs";
    pill.style.cursor="pointer";
    if(!pill.dataset.lxClick){pill.dataset.lxClick="1";pill.addEventListener("click",()=>{document.querySelector('.nav-link[data-page="settings"]')?.click();window.SettingsTabs?.select?.("outputs");setTimeout(()=>document.getElementById("multiOutputPanel")?.scrollIntoView({block:"start"}),100);});}
  }

  function renderNodes(){
    const host=$("multiNodes"); if(!host)return;
    const mine=interfaces?.length?`This computer: ${interfaces.map(i=>`${esc(i.address)} (${esc(i.name)})`).join(", ")}`:"";
    if(searching){host.innerHTML=`<div class="multi-nodes-note">Looking for Art-Net nodes…</div>`;return;}
    if(!nodes){host.innerHTML=mine?`<div class="multi-nodes-note">${mine}</div>`:"";return;}
    host.innerHTML=`<div class="multi-nodes-note">${mine}</div>`+(nodes.length?nodes.map((n,i)=>`<div class="multi-node"><div><b>${esc(n.name||n.longName||"Art-Net node")}</b><span>${esc(n.ip)}${n.universes.length?` · Art-Net universe ${n.universes.join(", ")}`:""}${n.longName&&n.longName!==n.name?` · ${esc(n.longName)}`:""}</span></div><button type="button" class="btn-secondary" data-node="${i}">Send here</button></div>`).join(""):`<div class="multi-nodes-note">No Art-Net nodes answered. Check the node is powered and plugged into the same network (or switch) as this computer, and that its address is on the same network as this computer's. Some nodes don't answer searches — they still work if the target is right, or leave the target as 255.255.255.255 (everyone).</div>`);
  }
  function useNode(node){
    setNetworkTarget(node.ip);
    const artnet=outputs.filter(o=>o.protocol==="artnet");
    artnet.forEach(o=>{o.target=node.ip;delete o.__status;});
    // One output, and the node doesn't listen on its universe: use the node's first.
    if(artnet.length===1&&node.universes.length&&!node.universes.includes(artnet[0].universe))artnet[0].universe=node.universes[0];
    if(!artnet.length)outputs.push({id:`output-${Date.now()}`,protocol:"artnet",local:true,source:1,universe:node.universes[0]??0,target:node.ip,usbDevice:"",refreshRate:25,enabled:true,multicast:false,priority:100});
    save();sendConfig();render();renderNodes();
    window.log?.(`Art-Net goes to ${node.name||node.ip} (${node.ip})`,"ok");
  }

  function render(){
    const host=$("multiOutputHost"); if(!host)return; host.innerHTML="";
    const maxU=Math.max(Number(window.MAX_UNIVERSES)||10,...outputs.map(o=>o.source));
    outputs.forEach((output,index)=>{
      const card=document.createElement("div"); card.className="multi-output-card"; card.dataset.outputId=output.id; card.style.cssText="border:1px solid var(--border,#333);border-radius:10px;padding:12px;margin:10px 0;background:rgba(255,255,255,.025);";
      const isUsb=output.protocol==="usb", isSacn=output.protocol==="sacn";
      const sources=Array.from({length:maxU},(_,i)=>i+1).map(u=>`<option value="${u}" ${u===output.source?"selected":""}>Universe ${u}${patchedIn(u)?"":" (nothing patched)"}</option>`).join("");
      card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;"><strong>Output ${index+1}</strong><button type="button" class="btn-danger-soft multi-remove">Remove</button></div><div class="form-grid"><div class="form-row"><label>Protocol</label><select class="multi-protocol"><option value="artnet">Art-Net</option><option value="sacn">sACN</option><option value="usb">USB DMX</option></select></div><div class="form-row"><label>Sends (patch universe)</label><select class="multi-source">${sources}</select></div><div class="form-row multi-wire-row"><label>${isSacn?"sACN universe":"Art-Net universe"} <span style="opacity:.6;font-weight:400">${isSacn?"(from 1)":"(from 0 — most nodes' first is 0)"}</span></label><input class="multi-universe" type="number" min="${isSacn?1:0}" max="${isSacn?63999:32767}" step="1" value="${output.universe}"></div><div class="form-row multi-network-row"><label>${isSacn?"Target IP / Multicast":"Target IP"} <span style="opacity:.6;font-weight:400">255.255.255.255 = every node</span></label><input class="multi-target" value="${esc(output.target||getNetworkTarget())}" spellcheck="false"></div><div class="form-row multi-local-row"><label>Also to this computer <span style="opacity:.6;font-weight:400">for Capture or another visualiser running here</span></label><input class="multi-local" type="checkbox" ${output.local!==false?"checked":""}></div><div class="form-row multi-multicast-row"><label>Use sACN Multicast</label><input class="multi-multicast" type="checkbox" ${output.multicast?"checked":""}></div><div class="form-row multi-priority-row"><label>sACN Priority</label><input class="multi-priority" type="number" min="0" max="200" step="1" value="${output.priority}"></div><div class="form-row multi-usb-row"><label>USB Device</label><select class="multi-usb">${usbOptions(output.usbDevice)}</select></div><div class="form-row multi-rate-row"><label>USB Refresh Rate</label><select class="multi-rate">${USB_RATES.map(h=>`<option value="${h}">${h} Hz</option>`).join("")}</select></div><div class="form-row"><label>Enabled</label><input class="multi-enabled" type="checkbox" ${output.enabled?"checked":""}></div></div><small class="multi-status" style="display:block;margin-top:7px;"></small>`;
      const protocol=card.querySelector(".multi-protocol"), source=card.querySelector(".multi-source"), universe=card.querySelector(".multi-universe"), target=card.querySelector(".multi-target"), multicast=card.querySelector(".multi-multicast"), priority=card.querySelector(".multi-priority"), usb=card.querySelector(".multi-usb"), rate=card.querySelector(".multi-rate"), enabled=card.querySelector(".multi-enabled"), local=card.querySelector(".multi-local"); protocol.value=output.protocol; rate.value=String(output.refreshRate);
      const sync=e=>{const old=output.protocol,oldSource=output.source;output.protocol=protocol.value;output.source=clamp(source.value,1,32767,1);output.universe=output.protocol==="sacn"?clamp(universe.value,1,63999,1):clamp(universe.value,0,32767,0);
        // A new patch universe or protocol: the matching wire number, unless that number was what you just changed.
        if(e?.target!==universe&&(old!==output.protocol||oldSource!==output.source))output.universe=wireFor(output.protocol,output.source);
        output.target=target.value.trim()||getNetworkTarget();output.usbDevice=usb.value;output.refreshRate=clamp(rate.value,10,40,25);output.enabled=enabled.checked;output.local=local.checked;output.multicast=output.protocol==="sacn"?multicast.checked:false;output.priority=clamp(priority.value,0,200,100);if(output.protocol!=="usb")setNetworkTarget(output.target);if(old!==output.protocol&&output.protocol==="sacn")output.multicast=true;delete output.__status;save();sendConfig();render();};
      [protocol,source,universe,target,multicast,priority,usb,rate,enabled,local].forEach(el=>el.addEventListener("change",sync));
      card.querySelector(".multi-remove").onclick=()=>{outputs=outputs.filter(o=>o.id!==output.id);save();sendConfig();render();};
      card.querySelector(".multi-usb-row").style.display=isUsb?"":"none";card.querySelector(".multi-rate-row").style.display=isUsb?"":"none";card.querySelector(".multi-wire-row").style.display=isUsb?"none":"";card.querySelector(".multi-network-row").style.display=isUsb?"none":"";card.querySelector(".multi-multicast-row").style.display=isSacn?"":"none";card.querySelector(".multi-local-row").style.display=output.protocol==="artnet"?"":"none";card.querySelector(".multi-priority-row").style.display=isSacn?"":"none";host.appendChild(card);
    });
    const add=$("multiOutputAdd");if(add)add.disabled=outputs.length>=MAX_OUTPUTS;const count=$("multiOutputCount");if(count)count.textContent=`${outputs.length}/${MAX_OUTPUTS}`;const defaultTarget=$("multiDefaultTarget");if(defaultTarget)defaultTarget.value=getNetworkTarget();renderStatuses();
  }

  function installUI(){
    const outMode=$("outMode"),oldPanel=outMode?.closest(".panel");if(!oldPanel||$("multiOutputPanel"))return;oldPanel.style.display="none";
    const panel=document.createElement("section");panel.className="panel";panel.id="multiOutputPanel";panel.innerHTML=`<div class="panel-header"><div><span class="eyebrow">OUTPUT</span> DMX Outputs</div><span class="panel-meta" id="multiOutputCount">0/10</span></div><div class="panel-body"><p style="opacity:.7;margin-top:0;">Each output sends one universe from the Patch page. Art-Net counts from 0, so patch universe 1 goes out as Art-Net universe 0 — what most nodes expect first. Not sure of the node's address? Find nodes, or leave the target as 255.255.255.255 to send to every node on the network.</p><div class="action-row" style="margin:0 0 8px"><button type="button" class="btn-primary" id="multiFindNodes">🔍 Find Art-Net nodes</button></div><div id="multiNodes" class="multi-nodes"></div><div class="form-row" style="margin-bottom:12px;"><label>Default Network Target IP</label><input id="multiDefaultTarget" value="${esc(getNetworkTarget())}" placeholder="255.255.255.255" spellcheck="false" autocomplete="off"></div><div id="multiOutputHost"></div><div class="action-row"><button class="btn-primary" id="multiOutputAdd">＋ Add Output</button><button class="btn-secondary" id="multiOutputRefreshUsb">↻ Refresh USB Devices</button></div></div>`;oldPanel.parentElement?.insertBefore(panel,oldPanel);
    $("multiDefaultTarget").addEventListener("change",()=>{const target=$("multiDefaultTarget").value.trim();if(!target)return;setNetworkTarget(target);outputs.forEach(o=>{if(o.protocol!=="usb")o.target=target;});save();sendConfig();render();});
    $("multiOutputAdd").onclick=()=>{if(outputs.length>=MAX_OUTPUTS)return;const used=new Set(outputs.map(o=>o.source));let source=1;while(used.has(source))source++;outputs.push({id:`output-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,protocol:"artnet",local:true,source,universe:wireFor("artnet",source),target:getNetworkTarget(),usbDevice:"",refreshRate:25,enabled:true,multicast:false,priority:100});save();sendConfig();render();};
    $("multiFindNodes").onclick=()=>{if(searching)return;if(!send({type:"MULTI_DISCOVER"}))return window.log?.("The output service isn't running — restart Light Spark","warn");searching=true;renderNodes();setTimeout(()=>{if(searching){searching=false;nodes=nodes||[];renderNodes();}},6000);};
    $("multiNodes").addEventListener("click",e=>{const b=e.target.closest("[data-node]");if(b&&nodes?.[b.dataset.node])useNode(nodes[b.dataset.node]);});
    if(!document.getElementById("multiOutputStyles")){const st=document.createElement("style");st.id="multiOutputStyles";st.textContent=`.multi-status{opacity:.8}.multi-status[data-level=ok]{color:#54f2c8!important}.multi-status[data-level=warn]{color:#f2b84b!important}.multi-nodes{display:grid;gap:6px;margin-bottom:12px}.multi-nodes-note{font-size:11px;line-height:1.5;color:#7d8987}.multi-node{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #26343a;border-radius:8px;background:#0d1418}.multi-node b{display:block;font-size:12px;color:#edf4f2}.multi-node span{font-size:11px;color:#7d8987}`;document.head.appendChild(st);}
    renderNodes();
    $("multiOutputRefreshUsb").onclick=requestUsbPorts;render();
  }

  window.addEventListener("show-multi-output-restore", e => {
    outputs = normalizeOutputs(e.detail?.outputs);
    save();
    sendConfig();
    render();
    console.log(`✅ Multi Output restored from show: ${outputs.length} universes`);
  });

  function install(){try{window.ArtNet?.stop?.();}catch(_){}installUI();connect();setInterval(sendDMX,40);setInterval(()=>{renderStatuses();
    // The "(nothing patched)" labels follow the patch, unless you're typing in a card.
    const sig=(window.State?.fixtures||[]).map(f=>f?.uni??f?.universe).join(",");
    if(sig!==window.__lxOutputPatchSig){window.__lxOutputPatchSig=sig;if(!document.activeElement?.closest?.("#multiOutputHost"))render();}},1000);window.addEventListener("beforeunload",()=>{try{socket?.close();}catch(_){}});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();