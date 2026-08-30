"use strict";

// UI-only control helpers. Input handling lives in app.js.
(function initialiseControls() {
  let lastPadDisplay = null;
  let refreshQueued = false;

  function refreshVisibilityNow() {
    refreshQueued = false;
    const xyPad = document.querySelector(".xy-pad");
    if (!xyPad) return;
    const state = window.State;
    const library = window.FixtureLibrary;
    let nextDisplay = "none";
    if (state && state.selected instanceof Set && state.selected.size) {
      const fixture = Array.isArray(state.fixtures) ? state.fixtures.find(item => state.selected.has(item?.id)) : null;
      const definition = fixture && library && typeof library === "object" ? library[fixture.name] : null;
      const map = definition && typeof definition.map === "object" ? definition.map : {};
      if (typeof map.pan === "number" || typeof map.tilt === "number") nextDisplay = "";
    }
    if (nextDisplay !== lastPadDisplay) { xyPad.style.display = nextDisplay; lastPadDisplay = nextDisplay; }
  }

  function refreshVisibility() {
    if (refreshQueued) return;
    refreshQueued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(refreshVisibilityNow);
    else setTimeout(refreshVisibilityNow, 0);
  }
  window.updateControlVisibility = refreshVisibility;

  if (typeof window.renderFixtures === "function" && !window.__stableFixtureRenderer) {
    const originalRenderFixtures = window.renderFixtures;
    let lastFixtureSignature = null, hasRendered = false;
    const fixtureSignature = () => JSON.stringify((Array.isArray(window.State?.fixtures)?window.State.fixtures:[]).map(f=>({id:f?.id??null,fixtureNumber:f?.fixtureNumber??null,name:f?.name??null,uni:f?.uni??f?.universe??null,addr:f?.addr??f?.address??f?.startAddress??null})));
    function updateSelectionOnly(){const list=document.getElementById("fixtureList"),count=document.getElementById("selCount"),selected=window.State?.selected instanceof Set?window.State.selected:new Set();if(!list)return false;const fixtures=Array.isArray(window.State?.fixtures)?window.State.fixtures:[];if(list.children.length!==fixtures.length)return false;fixtures.forEach((fixture,index)=>{const el=list.children[index];if(!el||el.dataset.fixtureId!==String(fixture?.id??""))throw new Error("fixture DOM topology changed");el.classList.toggle("sel",selected.has(fixture?.id));const state=window.State?.fixtureStates?.get(fixture?.id),intensity=Number(state?.intensity??state?.dimmer??100);const p=typeof window.getFixturePhotometrics==="function"?window.getFixturePhotometrics(fixture?.name):null;const output=typeof window.calculateFixtureOutput==="function"?window.calculateFixtureOutput(fixture?.name,intensity):0;const outputText=typeof p?.ratedLumens==="number"?`${Math.round(output)} lm`:"manufacturer output unavailable";const spans=el.children;if(spans.length>=2){spans[0].textContent=`#${fixture?.fixtureNumber??index+1} ${fixture?.name||`Fixture ${index+1}`}`;spans[1].textContent=`Uni ${fixture?.uni} · Addr ${fixture?.addr} · ${Math.round(intensity)}% · ${outputText}`;}});if(count)count.textContent=`(${selected.size} selected)`;return true;}
    function applyFixtureNumbers(){const list=document.getElementById("fixtureList"),fixtures=Array.isArray(window.State?.fixtures)?window.State.fixtures:[];if(!list||list.children.length!==fixtures.length)return;fixtures.forEach((fixture,index)=>{const el=list.children[index];if(el?.children.length>=1)el.children[0].textContent=`#${fixture?.fixtureNumber??index+1} ${fixture?.name||`Fixture ${index+1}`}`;});}
    window.renderFixtures=function(){const signature=fixtureSignature();if(!hasRendered||signature!==lastFixtureSignature){lastFixtureSignature=signature;originalRenderFixtures();hasRendered=true;const list=document.getElementById("fixtureList"),fixtures=Array.isArray(window.State?.fixtures)?window.State.fixtures:[];if(list)fixtures.forEach((fixture,index)=>{if(list.children[index])list.children[index].dataset.fixtureId=String(fixture?.id??"");});applyFixtureNumbers();}else{try{updateSelectionOnly();}catch(err){originalRenderFixtures();applyFixtureNumbers();}}refreshVisibility();};
    window.__stableFixtureRenderer=true;
  }

  if (typeof window.sendToVisualizer === "function" && !window.__visualizerSyncGuard) {
    const originalSendToVisualizer=window.sendToVisualizer; let lastFixtureSignature=null;
    const sig=()=>JSON.stringify((Array.isArray(window.State?.fixtures)?window.State.fixtures:[]).map(f=>({id:f?.id??null,fixtureNumber:f?.fixtureNumber??null,name:f?.name??null,uni:f?.uni??f?.universe??null,addr:f?.addr??f?.address??f?.startAddress??null})));
    window.sendToVisualizer=function(){const signature=sig(),originalPostMessage=Window.prototype.postMessage;try{Window.prototype.postMessage=function(message,targetOrigin,transfer){if(message?.type==="SYNC_FIXTURES"){if(signature===lastFixtureSignature)return;lastFixtureSignature=signature;}return originalPostMessage.call(this,message,targetOrigin,transfer);};return originalSendToVisualizer.apply(this,arguments);}finally{Window.prototype.postMessage=originalPostMessage;}};
    window.__visualizerSyncGuard=true;
  }

  if (!window.__multiFixtureXYFix) {
    window.__multiFixtureXYFix=true;
    const getSelectedFixtures=()=>{const state=window.State;if(!state||!Array.isArray(state.fixtures))return [];const ids=new Set();if(state.selected instanceof Set)state.selected.forEach(id=>ids.add(String(id)));document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el=>ids.add(String(el.dataset.fixtureId)));return state.fixtures.filter(f=>ids.has(String(f?.id)));};
    const getDefinition=fixture=>typeof window.getFixtureDefinition==="function"?window.getFixtureDefinition(fixture)||null:window.FixtureLibrary?.[fixture?.name]||null;
    const getState=fixture=>{if(typeof window.ensureFixtureState==="function")return window.ensureFixtureState(fixture.id);const state=window.State;if(!(state.fixtureStates instanceof Map))state.fixtureStates=new Map();if(!state.fixtureStates.has(fixture.id))state.fixtureStates.set(fixture.id,{...(state.current||{}),pan:128,tilt:128});return state.fixtureStates.get(fixture.id);};
    const isDotTarget=e=>{const dot=document.getElementById("xy"),target=e?.target;return !!dot&&(target===dot||(target&&target.closest?.("#xy")===dot));};
    const getPosition=(pad,e)=>{const r=pad.getBoundingClientRect(),x=Number(e.clientX),y=Number(e.clientY);if(!r.width||!r.height||!Number.isFinite(x)||!Number.isFinite(y))return null;if(x<r.left||x>r.right||y<r.top||y>r.bottom)return null;return{pan:Math.round(((x-r.left)/r.width)*255),tilt:Math.round((1-((y-r.top)/r.height))*255)};};
    const applyPosition=(pad,e)=>{const p=getPosition(pad,e);if(!p)return;const selected=getSelectedFixtures();if(!selected.length)return;let changed=false;for(const fixture of selected){const map=getDefinition(fixture)?.map||{};if(typeof map.pan!=="number"&&typeof map.tilt!=="number")continue;const state=getState(fixture);if(!state)continue;if(typeof map.pan==="number")state.pan=p.pan;if(typeof map.tilt==="number")state.tilt=p.tilt;window.State.fixtureStates.set(fixture.id,state);changed=true;}if(!changed)return;window.State.current||={};window.State.current.pan=p.pan;window.State.current.tilt=p.tilt;const dot=document.getElementById("xy");if(dot){dot.style.left=`${p.pan/255*100}%`;dot.style.top=`${(1-p.tilt/255)*100}%`;}window.updateDMX?.();window.sendToVisualizer?.();};
    const attach=()=>{const pad=document.querySelector(".xy-pad"),dot=document.getElementById("xy");if(!pad||!dot||pad.dataset.multiFixtureXYFix==="1")return;pad.dataset.multiFixtureXYFix="1";dot.style.pointerEvents="auto";pad.style.touchAction="none";let dragging=false,pointerId=null;pad.addEventListener("pointerdown",e=>{if(e.button!==0||!isDotTarget(e))return;e.preventDefault();e.stopImmediatePropagation();dragging=true;pointerId=e.pointerId;try{pad.setPointerCapture(pointerId);}catch(_){}applyPosition(pad,e);},true);pad.addEventListener("pointermove",e=>{if(!dragging||e.pointerId!==pointerId)return;e.preventDefault();e.stopImmediatePropagation();applyPosition(pad,e);},true);const stop=e=>{if(pointerId!==null&&e.pointerId!==pointerId)return;dragging=false;try{if(pointerId!==null)pad.releasePointerCapture(pointerId);}catch(_){}pointerId=null;};pad.addEventListener("pointerup",stop,true);pad.addEventListener("pointercancel",stop,true);pad.addEventListener("lostpointercapture",()=>{dragging=false;pointerId=null;},true);};
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attach,{once:true});else attach();
  }

  // Home selected moving fixtures: centre Pan/Tilt and leave all other attributes unchanged.
  if (!window.__homePanTiltControl) {
    window.__homePanTiltControl = true;
    const getHomeFixtures = () => {
      const state = window.State;
      if (!state || !Array.isArray(state.fixtures)) return [];
      const ids = new Set();
      if (state.selected instanceof Set) state.selected.forEach(id => ids.add(String(id)));
      document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el => ids.add(String(el.dataset.fixtureId)));
      if (!ids.size && state.selectedFixtureId != null) ids.add(String(state.selectedFixtureId));
      return state.fixtures.filter(f => ids.has(String(f?.id)));
    };
    const homeSelectedPanTilt = () => {
      const fixtures = getHomeFixtures();
      if (!fixtures.length) { window.log?.("Select a fixture first", "warn"); return; }
      let changed = false, homed = 0;
      for (const fixture of fixtures) {
        const map = getDefinition(fixture)?.map || {};
        if (typeof map.pan !== "number" && typeof map.tilt !== "number") continue;
        const state = getState(fixture);
        if (!state) continue;
        if (typeof map.pan === "number") state.pan = 128;
        if (typeof map.tilt === "number") state.tilt = 128;
        window.State.fixtureStates.set(fixture.id, state);
        changed = true;
        homed += 1;
      }
      if (!changed) { window.log?.("Selected fixtures have no Pan/Tilt controls", "warn"); return; }
      window.State.current ||= {};
      window.State.current.pan = 128;
      window.State.current.tilt = 128;
      window.updateDMX?.();
      window.sendToVisualizer?.();
      const dot = document.getElementById("xy");
      if (dot) { dot.style.left = "50%"; dot.style.top = "50%"; }
      window.log?.(`Homed Pan/Tilt for ${homed} selected fixture${homed === 1 ? "" : "s"}`, "ok");
    };
    const installHomeButton = () => {
      const existing = document.getElementById("btnHome");
      if (existing) {
        existing.onclick = e => { e.preventDefault(); homeSelectedPanTilt(); };
        return true;
      }
      const xy = document.querySelector(".xy-pad");
      if (!xy?.parentElement) return false;
      const button = document.createElement("button");
      button.id = "btnHome";
      button.type = "button";
      button.textContent = "HOME";
      button.title = "Centre Pan/Tilt for selected fixtures";
      button.setAttribute("aria-label", "Home selected fixtures Pan/Tilt");
      button.addEventListener("click", homeSelectedPanTilt);
      xy.parentElement.appendChild(button);
      return true;
    };
    let attempts = 0;
    const waitForHomeButton = () => { if (installHomeButton()) return; attempts += 1; if (attempts < 150) setTimeout(waitForHomeButton, 100); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForHomeButton, { once: true });
    else waitForHomeButton();
  }

  // Live strobe control. Kept in controls.js with the other live-control UI helpers.
  if (!window.__strobeControl) {
    window.__strobeControl = true;
    const $ = id => document.getElementById(id);
    let strobeAttempts = 0;
    const getStrobeFixtures = () => { const state = window.State; if (!state || !Array.isArray(state.fixtures)) return []; const ids = state.selected instanceof Set ? [...state.selected] : []; if (!ids.length && state.selectedFixtureId != null) ids.push(state.selectedFixtureId); return state.fixtures.filter(f => ids.some(id => String(id) === String(f?.id))); };
    const getStrobeState = fixture => { if (!fixture) return null; if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id); const state = window.State; if (!(state.fixtureStates instanceof Map)) state.fixtureStates = new Map(); if (!state.fixtureStates.has(fixture.id)) state.fixtureStates.set(fixture.id, { ...(state.current || {}), strobe: 0 }); return state.fixtureStates.get(fixture.id); };
    const applyStrobe = value => { const strobe = Math.max(0, Math.min(255, Math.round(Number(value) || 0))); const fixtures = getStrobeFixtures(); if (!fixtures.length) return; for (const fixture of fixtures) { const state = getStrobeState(fixture); if (!state) continue; state.strobe = strobe; window.State.fixtureStates.set(fixture.id, state); } window.State.current ||= {}; window.State.current.strobe = strobe; $("strobeVal")?.replaceChildren(String(strobe)); window.updateDMX?.(); window.sendToVisualizer?.(); };
    const installStrobe = () => { const existing = $("strobe"); if (existing) { existing.min="0"; existing.max="255"; existing.step="1"; existing.setAttribute("aria-label","Strobe"); if (!existing.dataset.controlsStrobeBound) { existing.dataset.controlsStrobeBound="1"; existing.addEventListener("input",()=>applyStrobe(existing.value)); existing.addEventListener("change",()=>applyStrobe(existing.value)); } return true; } const intensity=$("intensity"); if(!intensity)return false; const sourceRow=intensity.closest(".form-row")||intensity.parentElement; if(!sourceRow?.parentElement)return false; if($("liveStrobeRow"))return true; const row=document.createElement("label"); row.className="range-control"; row.id="liveStrobeRow"; row.innerHTML='<span>Strobe</span><input type="range" id="strobe" min="0" max="255" step="1" value="0"><strong><span id="strobeVal">0</span></strong>'; sourceRow.parentElement.insertBefore(row,sourceRow.nextSibling); const slider=$("strobe"); slider.addEventListener("input",()=>applyStrobe(slider.value)); slider.addEventListener("change",()=>applyStrobe(slider.value)); return true; };
    const waitForStrobe=()=>{if(installStrobe())return;strobeAttempts+=1;if(strobeAttempts<150)setTimeout(waitForStrobe,100);};
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",waitForStrobe,{once:true});else waitForStrobe();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",refreshVisibility,{once:true});else refreshVisibility();
})();
