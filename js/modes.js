"use strict";

(() => {
  const MODE_KEY = "consoleMode";
  let mode = localStorage.getItem(MODE_KEY) === "blind" ? "BLIND" : "LIVE";
  let emergencyActive = false;
  let blackoutActive = false;
  let savedState = null;

  const $ = id => document.getElementById(id);

  function installModeStyles() {
    if (document.getElementById("console-mode-styles")) return;
    const style = document.createElement("style");
    style.id = "console-mode-styles";
    style.textContent = `
      .console-mode-switch{display:flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--border,#202a30);border-radius:9px;background:#080d10}
      .console-mode-switch button{min-width:64px;height:27px;padding:0 12px;border:1px solid transparent;border-radius:6px;background:transparent;color:#64716f;cursor:pointer;font:800 8px/1 var(--mono,monospace);letter-spacing:1.1px;transition:all .15s ease}
      .console-mode-switch button:hover{color:#dce7e4;background:rgba(255,255,255,.04)}
      .console-mode-switch button.live.active{color:#06130e;background:#19d6a3;border-color:#54f2c8;box-shadow:0 0 14px rgba(25,214,163,.22)}
      .console-mode-switch button.blind.active{color:#07111d;background:#5ca8ff;border-color:#8bc5ff;box-shadow:0 0 14px rgba(92,168,255,.24)}
      .safety-controls{display:flex;align-items:center;gap:5px;margin-left:4px}
      .safety-control{min-width:78px;height:30px;padding:0 10px;border-radius:7px;cursor:pointer;font:900 8px/1 var(--mono,monospace);letter-spacing:.8px;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}
      .safety-control:hover{transform:translateY(-1px)}
      .safety-emergency{color:#111;background:#f5f5f5;border:2px solid #ff5265;box-shadow:0 0 10px rgba(255,255,255,.06)}
      .safety-emergency.active{background:#e8e8e8;border-color:#111;box-shadow:0 0 12px rgba(255,255,255,.35)}
      .safety-blackout{color:#fff;background:#190b0e;border:1px solid #ff5265}
      .safety-blackout.active{background:#ff5265;color:#fff;border-color:#ff8996}
      .fixture-number-field{display:flex;flex-direction:column;gap:6px}
      .fixture-number-field input{width:100%}
      .fixture-number-badge{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:22px;padding:0 7px;margin-right:8px;border:1px solid var(--border,#202a30);border-radius:6px;background:#0d1519;color:#8bc5ff;font:900 10px/1 var(--mono,monospace);letter-spacing:.5px}
      html.emergency-active,html.emergency-active body{background:#e9e9e9!important;color:#171717!important}
      html.emergency-active .sidebar,html.emergency-active .topbar,html.emergency-active .panel,html.emergency-active .controls,html.emergency-active .bottom-row,html.emergency-active .cmd-line,html.emergency-active .command-line{background:#e9e9e9!important;color:#171717!important;border-color:#c9c9c9!important;box-shadow:0 3px 14px rgba(0,0,0,.07)!important}
      html.emergency-active .panel-header,html.emergency-active .brand,html.emergency-active .sidebar-footer,html.emergency-active .topbar-divider,html.emergency-active .section-divider{border-color:#c9c9c9!important}
      html.emergency-active .panel-header,html.emergency-active .panel-meta,html.emergency-active .sidebar-section-label,html.emergency-active .brand-sub,html.emergency-active .version,html.emergency-active .toolbar-label,html.emergency-active .toolbar-hint,html.emergency-active .page-kicker,html.emergency-active .top-master span{color:#606060!important}
      html.emergency-active .brand-name,html.emergency-active .page-title strong,html.emergency-active .top-master strong,html.emergency-active .nav-link,html.emergency-active .fixture-item,html.emergency-active .group-item,html.emergency-active .cue-item,html.emergency-active label,html.emergency-active .form-row label{color:#171717!important}
      html.emergency-active .nav-link:hover,html.emergency-active .fixture-item:hover,html.emergency-active .group-item:hover,html.emergency-active .cue-item:hover{background:#dedede!important;color:#171717!important}
      html.emergency-active .nav-link.active{color:#171717!important;background:#dedede!important;box-shadow:inset 2px 0 0 #171717!important}
      html.emergency-active .status-pill,html.emergency-active .console-mode-switch,html.emergency-active .btn-secondary,html.emergency-active .btn-icon,html.emergency-active input,html.emergency-active select,html.emergency-active textarea{background:#dedede!important;color:#171717!important;border-color:#bdbdbd!important}
      html.emergency-active .btn-primary{background:#171717!important;color:#fff!important}
      html[data-console-mode="blind"] .topbar{border-color:rgba(92,168,255,.35);box-shadow:0 0 22px rgba(92,168,255,.06)}
      html[data-console-mode="blind"] .sidebar{border-color:rgba(92,168,255,.28)}
      html[data-console-mode="blind"] .nav-link.active{color:#8bc5ff;background:linear-gradient(90deg,rgba(92,168,255,.15),rgba(92,168,255,.045));box-shadow:inset 2px 0 0 #5ca8ff}
      html[data-console-mode="blind"] .nav-link.active span{color:#5ca8ff}
      html[data-console-mode="blind"] .page-kicker{color:#5ca8ff}
      html[data-console-mode="blind"] .page-title strong{color:#8bc5ff}
      html[data-console-mode="blind"] .quick-panel .panel-meta{color:#5ca8ff}
      @media(max-width:900px){.safety-control{min-width:62px;padding:0 7px}}
    `;
    document.head.appendChild(style);
  }

  function sendVisualizerMode() {
    const viz = window.visualizerWindow;
    if (viz && !viz.closed) viz.postMessage({type:"CONSOLE_MODE",mode},"*");
  }

  function updateSidebarModeLabel() {
    const liveNav = document.querySelector('.nav-link[data-page="live"]');
    if (!liveNav) return;
    const labelNode = Array.from(liveNav.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
    if (labelNode) labelNode.textContent = mode === "BLIND" ? " Blind Control " : " Live Control ";
    liveNav.setAttribute("aria-label",mode === "BLIND" ? "Blind Control" : "Live Control");
  }

  function updateUI() {
    const live=$("consoleModeLive"), blind=$("consoleModeBlind");
    if (!live || !blind) return;
    installModeStyles();
    live.classList.toggle("active",mode==="LIVE");
    blind.classList.toggle("active",mode==="BLIND");
    document.body.classList.toggle("console-blind",mode==="BLIND");
    document.documentElement.dataset.consoleMode=mode.toLowerCase();
    const meta=document.querySelector("#page-live .quick-panel .panel-meta");
    if(meta) meta.textContent=mode;
    const title=$("topPageTitle");
    if(title && mode==="BLIND"){
      title.dataset.liveTitle ||= title.textContent;
      title.textContent="BLIND PROGRAMMER";
    }else if(title && !emergencyActive && !blackoutActive){
      title.textContent=title.dataset.liveTitle || "LIVE CONTROL";
    }
    updateSidebarModeLabel();
    sendVisualizerMode();
  }

  function setMode(next) {
    mode=String(next).toUpperCase()==="BLIND" ? "BLIND" : "LIVE";
    localStorage.setItem(MODE_KEY,mode.toLowerCase());
    if(window.ArtNet){
      window.ArtNet.outputMode=mode;
      window.ArtNet.send?.();
    }
    updateUI();
    console.log(`🎛 Console mode: ${mode}`);
  }

  function stopRunningLooks(){
    if(window.ActiveChase){clearInterval(window.ActiveChase);window.ActiveChase=null;}
    if(window.State?.fading){cancelAnimationFrame(window.State.fading);window.State.fading=null;}
    if(typeof window.stopEffects==="function") window.stopEffects();
    if(typeof window.stopAllEffects==="function") window.stopAllEffects();
  }

  function snapshotState(){
    if(!window.State || savedState) return;
    savedState={current:{...(State.current||{})},fixtureStates:new Map()};
    if(State.fixtureStates instanceof Map) State.fixtureStates.forEach((value,key)=>savedState.fixtureStates.set(key,{...value}));
  }

  function restoreSnapshot(){
    if(!savedState || !window.State) return;
    State.current={...(State.current||{}),...savedState.current};
    if(!(State.fixtureStates instanceof Map)) State.fixtureStates=new Map();
    savedState.fixtureStates.forEach((value,key)=>State.fixtureStates.set(key,{...value}));
    savedState=null;
    if(typeof window.updateDMX==="function") window.updateDMX();
    if(typeof window.sendToVisualizer==="function") window.sendToVisualizer();
  }

  function applyAllFixturesState(state){
    if(!window.State) return;
    if(!(State.fixtureStates instanceof Map)) State.fixtureStates=new Map();
    const base=State.current||{};
    (Array.isArray(State.fixtures)?State.fixtures:[]).forEach(fixture=>{
      if(!fixture?.id) return;
      const previous=State.fixtureStates.get(fixture.id)||base;
      State.fixtureStates.set(fixture.id,{...previous,...state});
    });
    State.current={...base,...state};
    if(typeof window.updateDMX==="function") window.updateDMX();
    if(typeof window.sendToVisualizer==="function") window.sendToVisualizer();
  }

  function setEmergencyUI(active){
    emergencyActive=active;
    document.documentElement.classList.toggle("emergency-active",active);
    document.body.classList.toggle("emergency-active",active);
    const button=$("btnEmergencyWhite");
    if(button){button.classList.toggle("active",active);button.textContent=active?"CLEAR WHITE":"🚨 WHITE";button.title=active?"Clear emergency white and restore the previous look":"Force all patched fixtures to a safe white";}
  }

  function setBlackoutUI(active){
    blackoutActive=active;
    const button=$("btnEmergencyBlackout");
    if(button){button.classList.toggle("active",active);button.textContent=active?"CLEAR BLACKOUT":"BLACKOUT";button.title=active?"Clear blackout and restore the previous look":"Force all patched fixtures to 0%";}
  }

  function clearSafetyOverride(){
    const wasBlackout=blackoutActive;
    stopRunningLooks();
    setEmergencyUI(false);
    setBlackoutUI(false);
    if(wasBlackout && window.State) State.blackout=false;
    if(!wasBlackout) restoreSnapshot();
    else if(typeof window.updateDMX==="function") window.updateDMX();
    const title=$("topPageTitle");
    if(title) title.textContent=mode==="BLIND"?"BLIND PROGRAMMER":"LIVE CONTROL";
    if(typeof window.log==="function") window.log("Safety override cleared — previous lighting state restored","ok");
  }

  function emergencyWhite(){
    if(emergencyActive){clearSafetyOverride();return;}
    stopRunningLooks();
    snapshotState();
    blackoutActive=false;
    if(window.State) State.blackout=false;
    setBlackoutUI(false);
    setMode("LIVE");
    applyAllFixturesState({intensity:70,master:100,hue:0,sat:0,light:50,strobe:0,gobo:0,gobo2:0,prism:0,prismr:0,focus:0,zoom:0,frost:0,iris:0,rot:0,effect:0,speed:0,macro:0,preset:0,shake:0,mode:0});
    setEmergencyUI(true);
    const title=$("topPageTitle");
    if(title) title.textContent="EMERGENCY WHITE";
    if(typeof window.log==="function") window.log("EMERGENCY WHITE — safe white at 70% output","warn");
  }

  function blackout(){
    if(blackoutActive){clearSafetyOverride();return;}
    stopRunningLooks();
    emergencyActive=false;
    setEmergencyUI(false);
    setMode("LIVE");
    if(window.State) State.blackout=true;
    setBlackoutUI(true);
    if(typeof window.updateDMX==="function") window.updateDMX();
    if(typeof window.sendToVisualizer==="function") window.sendToVisualizer();
    const title=$("topPageTitle");
    if(title) title.textContent="BLACKOUT";
    if(typeof window.log==="function") window.log("BLACKOUT — output locked to 0% while programmed state is preserved","warn");
  }

  function installSafetyControls(){
    if(document.getElementById("safetyControls")) return;
    const status=document.querySelector(".topbar-status");
    if(!status) return;
    const wrap=document.createElement("div");
    wrap.id="safetyControls";
    wrap.className="safety-controls";
    wrap.setAttribute("aria-label","Emergency lighting controls");

    const emergency=document.createElement("button");
    emergency.type="button";
    emergency.id="btnEmergencyWhite";
    emergency.className="safety-control safety-emergency";
    emergency.title="Force all patched fixtures to a safe white";
    emergency.textContent="🚨 WHITE";
    emergency.addEventListener("click",e=>{e.preventDefault();emergencyWhite();});

    const black=document.createElement("button");
    black.type="button";
    black.id="btnEmergencyBlackout";
    black.className="safety-control safety-blackout";
    black.title="Force all patched fixtures to 0%";
    black.textContent="BLACKOUT";
    black.addEventListener("click",e=>{e.preventDefault();blackout();});

    wrap.append(emergency,black);
    status.prepend(wrap);
  }

  function nextFixtureNumber(){
    const used=new Set();
    (Array.isArray(State?.fixtures)?State.fixtures:[]).forEach((fixture,index)=>{
      const n=Number(fixture?.fixtureNumber);
      if(Number.isInteger(n)&&n>0) used.add(n);
      else if(!fixture?.fixtureNumber){
        let fallback=index+1;
        while(used.has(fallback)) fallback++;
        fixture.fixtureNumber=fallback;
        used.add(fallback);
      }
    });
    let n=1;
    while(used.has(n)) n++;
    return n;
  }

  function installFixtureNumberField(){
    const grid=document.querySelector("#page-patch .form-grid");
    if(!grid || $("patchFixtureNumber")) return;
    const row=document.createElement("div");
    row.className="form-row fixture-number-field";
    row.innerHTML='<label for="patchFixtureNumber">Fixture Number</label><input type="number" id="patchFixtureNumber" min="1" step="1">';
    const typeRow=$("patchType")?.closest(".form-row");
    if(typeRow) grid.insertBefore(row,typeRow);
    else grid.prepend(row);
    const input=$("patchFixtureNumber");
    if(input) input.value=nextFixtureNumber();
  }

  function decorateFixtureList(){
    const list=$("fixtureList");
    if(!list || !Array.isArray(State?.fixtures)) return;
    State.fixtures.forEach((fixture,index)=>{
      if(!fixture || !Number.isInteger(Number(fixture.fixtureNumber)) || Number(fixture.fixtureNumber)<1){
        fixture.fixtureNumber=index+1;
      }
    });
    [...list.children].forEach((item,index)=>{
      const fixture=State.fixtures[index];
      if(!fixture) return;
      const number=Number(fixture.fixtureNumber);
      if(!Number.isInteger(number)||number<1) return;
      let badge=item.querySelector(".fixture-number-badge");
      if(!badge){
        badge=document.createElement("span");
        badge.className="fixture-number-badge";
        item.prepend(badge);
      }
      badge.textContent=`#${number}`;
    });
  }

  function installFixtureNumbering(){
    installFixtureNumberField();
    if(!window.__fixtureNumberPatchInstalled){
      const button=$("btnPatch");
      if(button){
        const original=button.onclick;
        button.onclick=function(event){
          const input=$("patchFixtureNumber");
          const number=Number(input?.value);
          if(!Number.isInteger(number)||number<1){
            log?.("Enter a valid Fixture Number", "warn");
            input?.focus();
            return;
          }
          const duplicate=(State.fixtures||[]).some(f=>Number(f?.fixtureNumber)===number);
          if(duplicate){
            log?.(`Fixture Number ${number} is already in use`, "warn");
            input?.focus();
            return;
          }
          const before=new Set((State.fixtures||[]).map(f=>f?.id));
          if(typeof original==="function") original.call(button,event);
          const added=(State.fixtures||[]).find(f=>f && !before.has(f.id));
          if(added){
            added.fixtureNumber=number;
            State.fixtures.sort((a,b)=>Number(a.fixtureNumber||0)-Number(b.fixtureNumber||0));
            State.selectedFixtureId=added.id;
            State.selected?.clear?.();
            State.selected?.add?.(added.id);
            renderFixtures?.();
            decorateFixtureList();
            input.value=nextFixtureNumber();
            log?.(`Patched Fixture #${number}: ${added.name||"Fixture"}`, "ok");
          }
        };
        window.__fixtureNumberPatchInstalled=true;
      }
    }
    decorateFixtureList();
    const list=$("fixtureList");
    if(list && !list.__fixtureNumberObserver){
      const observer=new MutationObserver(()=>decorateFixtureList());
      observer.observe(list,{childList:true,subtree:true});
      list.__fixtureNumberObserver=observer;
    }
  }

  function install(){
    const live=$("consoleModeLive"), blind=$("consoleModeBlind");
    if(!live || !blind) return;
    installModeStyles();
    installSafetyControls();
    installFixtureNumbering();
    live.onclick=()=>{if(emergencyActive||blackoutActive) clearSafetyOverride();setMode("LIVE");};
    blind.onclick=()=>{if(emergencyActive||blackoutActive) clearSafetyOverride();setMode("BLIND");};

    if(window.ArtNet && !window.ArtNet.__blindLiveModePatched){
      const originalSend=window.ArtNet.send.bind(window.ArtNet);
      window.ArtNet.__blindLiveModePatched=true;
      window.ArtNet.outputMode=mode;
      window.ArtNet.send=function(){
        if(window.ArtNet.outputMode==="BLIND"){
          if(typeof window.sendVisualizerDMX==="function") window.sendVisualizerDMX();
          return;
        }
        return originalSend();
      };
    }
    updateUI();
    sendVisualizerMode();
  }

  window.setConsoleMode=setMode;
  window.getConsoleMode=()=>mode;
  window.emergencyWhite=emergencyWhite;
  window.consoleBlackout=blackout;
  window.clearSafetyOverride=clearSafetyOverride;

  window.addEventListener("message",event=>{
    if(event.data?.type==="VISUALIZER_READY") sendVisualizerMode();
  });

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();
