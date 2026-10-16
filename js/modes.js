"use strict";

// LIVE / BLIND and the two safety buttons (EMERGENCY WHITE, BLACKOUT).
// In BLIND the console keeps programming but nothing reaches the lights; the
// output service (main/dmx-output.js) also refuses LIVE without a LIVE/PRO licence.
(() => {
  const MODE_KEY = "consoleMode";

  try {
    localStorage.removeItem("dmxOutputSettings");
    localStorage.removeItem("lighting-output-settings");
  } catch (_) {}

  const isFreeTier = () => !window.License?.isLive();
  // What the operator chose; the licence can still force BLIND (Free is visualiser only).
  let preferred = (() => { try { return localStorage.getItem(MODE_KEY) === "blind" ? "BLIND" : "LIVE"; } catch (_) { return "LIVE"; } })();
  let mode = "BLIND"; // until the licence is known
  let emergencyActive = false;
  let blackoutActive = false;
  let savedState = null;

  const $ = id => document.getElementById(id);


  function sendMode() {
    window.LXOutput?.setBlind(mode !== "LIVE");
    window.postToVisualizer?.({ type: "CONSOLE_MODE", mode });
  }

  
  function updateUI() {
    const live=$("consoleModeLive"), blind=$("consoleModeBlind");
    if (!live || !blind) return;
    live.classList.toggle("active",mode==="LIVE");
    blind.classList.toggle("active",mode==="BLIND");
    live.disabled = isFreeTier();
    live.title = isFreeTier() ? "LIVE output requires a LIVE or PRO license" : "Switch to LIVE mode";
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
 
    sendMode();
  }

  function applyMode() {
    mode = isFreeTier() ? "BLIND" : preferred;
    updateUI();
  }

  function setMode(next) {
    preferred = String(next).toUpperCase() === "BLIND" ? "BLIND" : "LIVE";
    try { localStorage.setItem(MODE_KEY, preferred.toLowerCase()); } catch (_) {}
    applyMode();
  }

  // Safety overrides stop anything that would keep changing the lights.
  function stopRunningLooks(){
    window.stopEffect?.(true);
    window.stopChase?.(false);
    window.stopCueTimers?.();
    window.stopFade?.();
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
    stopRunningLooks(); snapshotState(); blackoutActive=false;
    if(window.State) State.blackout=false;
    setBlackoutUI(false); setMode("LIVE");
    applyAllFixturesState({intensity:70,master:100,hue:0,sat:0,light:50,strobe:0,gobo:0,gobo2:0,prism:0,prismr:0,focus:0,zoom:0,frost:0,iris:0,rot:0,effect:0,speed:0,macro:0,preset:0,shake:0,mode:0});
    setEmergencyUI(true);
    const title=$("topPageTitle"); if(title) title.textContent="EMERGENCY WHITE";
    if(typeof window.log==="function") window.log("EMERGENCY WHITE — safe white at 70% output","warn");
  }

  function blackout(){
    if(blackoutActive){clearSafetyOverride();return;}
    stopRunningLooks(); emergencyActive=false; setEmergencyUI(false); setMode("LIVE");
    if(window.State) State.blackout=true; setBlackoutUI(true);
    if(typeof window.updateDMX==="function") window.updateDMX();
    if(typeof window.sendToVisualizer==="function") window.sendToVisualizer();
    const title=$("topPageTitle"); if(title) title.textContent="BLACKOUT";
    if(typeof window.log==="function") window.log("BLACKOUT — output locked to 0% while programmed state is preserved","warn");
  }

  function installSafetyControls(){
    if(document.getElementById("safetyControls")) return;
    const status=document.querySelector(".topbar-status"); if(!status) return;
    const wrap=document.createElement("div"); wrap.id="safetyControls"; wrap.className="safety-controls"; wrap.setAttribute("aria-label","Emergency lighting controls");
    const emergency=document.createElement("button"); emergency.type="button"; emergency.id="btnEmergencyWhite"; emergency.className="safety-control safety-emergency"; emergency.title="Force all patched fixtures to a safe white"; emergency.textContent="🚨 WHITE"; emergency.addEventListener("click",e=>{e.preventDefault();emergencyWhite();});
    const black=document.createElement("button"); black.type="button"; black.id="btnEmergencyBlackout"; black.className="safety-control safety-blackout"; black.title="Force all patched fixtures to 0%"; black.textContent="BLACKOUT"; black.addEventListener("click",e=>{e.preventDefault();blackout();});
    wrap.append(emergency,black); status.prepend(wrap);
  }

  function install(){
    const live=$("consoleModeLive"), blind=$("consoleModeBlind");
    if(!live || !blind) return;
    installSafetyControls();
    live.onclick=()=>{if(isFreeTier())return;if(emergencyActive||blackoutActive) clearSafetyOverride();setMode("LIVE");};
    blind.onclick=()=>{if(emergencyActive||blackoutActive) clearSafetyOverride();setMode("BLIND");};
    updateUI();
  }

  window.setConsoleMode=setMode;
  window.getConsoleMode=()=>mode;
  window.emergencyWhite=emergencyWhite;
  window.consoleBlackout=blackout;
  window.clearSafetyOverride=clearSafetyOverride;

  window.addEventListener("license-tier-changed", applyMode);
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();
