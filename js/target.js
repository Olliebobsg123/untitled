"use strict";

/* Target capture lock patch. The original target system lives in target-original.js. */
(function () {
  const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");
  function loadOriginal() {
    if (document.querySelector('script[data-target-original]')) return;
    const script = document.createElement("script");
    script.src = "js/target-original.js";
    script.dataset.targetOriginal = "1";
    script.onload = patch;
    document.head.appendChild(script);
  }
  const selectedFixtures = () => {
    const selected = State.selected instanceof Set ? State.selected : new Set();
    return (State.fixtures || []).filter(f => selected.has(f.id));
  };
  const fixtureState = id => {
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(id);
    let current = State.fixtureStates.get(id);
    if (!current) { current = { ...(State.current || {}) }; State.fixtureStates.set(id, current); }
    return current;
  };
  const findTarget = name => {
    const wanted = clean(name).toLowerCase();
    if (/^\d+$/.test(wanted)) return (State.targets || [])[Number(wanted) - 1] || null;
    return (State.targets || []).find(t => clean(t.name).toLowerCase() === wanted) || null;
  };
  const fixtureByNumber = n => (State.fixtures || []).find(f => Number(f?.fixtureNumber) === n) || (State.fixtures || []).find(f => Number(f?.number) === n) || (State.fixtures || [])[n - 1] || null;
  const selectFixtures = selector => {
    const input = clean(selector).toLowerCase().replace(/–/g,"-");
    const numbers = new Set();
    for (const token of input.split(",").map(x=>x.trim()).filter(Boolean)) {
      const range = token.match(/^(\d+)\s*(?:thru|through|-)\s*(\d+)$/i);
      if (range) { const a=Number(range[1]), b=Number(range[2]), step=a<=b?1:-1; for(let n=a;;n+=step){numbers.add(n);if(n===b)break;} }
      else if (/^\d+$/.test(token)) numbers.add(Number(token));
      else return {ok:false,message:"Invalid fixture selector. Use 1, 1,2,3 or 1 thru 5."};
    }
    const fixtures=[...numbers].sort((a,b)=>a-b).map(fixtureByNumber).filter(Boolean);
    if(!fixtures.length) return {ok:false,message:`No fixtures found for selector ${selector}.`};
    State.selected=new Set(fixtures.map(f=>f.id));
    window.updateControlVisibility?.();
    return {ok:true,fixtures};
  };
  const unlock = id => {
    const current = State.fixtureStates?.get(id);
    if (!current?.__targetPositionLock) return false;
    const lock=current.__targetPositionLock;
    delete current.__targetPositionLock;
    Object.defineProperty(current,"pan",{value:lock.pan,writable:true,configurable:true,enumerable:true});
    Object.defineProperty(current,"tilt",{value:lock.tilt,writable:true,configurable:true,enumerable:true});
    return true;
  };
  const warn = (fixtureId, lock, channel) => {
    const now=Date.now();
    if(lock.lastWarningAt && now-lock.lastWarningAt<500)return;
    lock.lastWarningAt=now;
    window.log?.(`${lock.targetName} target is captured for fixture ${fixtureId} — ${channel} is locked. Release the target before moving Pan/Tilt.`,"warn");
  };
  const lock = (fixture, target) => {
    const current=fixtureState(fixture.id);
    const lockData={pan:Number(target.pan),tilt:Number(target.tilt),targetId:target.id,targetName:clean(target.name),lastWarningAt:0};
    Object.defineProperty(current,"__targetPositionLock",{value:lockData,writable:true,configurable:true,enumerable:false});
    Object.defineProperty(current,"pan",{configurable:true,enumerable:true,get:()=>lockData.pan,set:()=>warn(fixture.id,lockData,"Pan")});
    Object.defineProperty(current,"tilt",{configurable:true,enumerable:true,get:()=>lockData.tilt,set:()=>warn(fixture.id,lockData,"Tilt")});
  };
  function capture(name) {
    const target=findTarget(name);
    if(!target)return {ok:false,message:`Target \"${clean(name)}\" not found.`};
    const fixtures=selectedFixtures();
    if(!fixtures.length)return {ok:false,message:"Select at least one fixture before capturing a target."};
    const values={pan:Number(target.pan),tilt:Number(target.tilt)};
    State.current=State.current||{}; State.current.pan=values.pan; State.current.tilt=values.tilt;
    target.captures=Array.isArray(target.captures)?target.captures:[];
    const ids=new Set(fixtures.map(f=>f.id));
    target.captures=target.captures.filter(c=>!ids.has(c.fixtureId));
    fixtures.forEach(f=>{
      const current=fixtureState(f.id);
      if(current.__targetPositionLock && current.__targetPositionLock.targetId!==target.id)unlock(f.id);
      current.pan=values.pan; current.tilt=values.tilt;
      lock(f,target);
      target.captures.push({fixtureId:f.id,pan:values.pan,tilt:values.tilt,locked:true});
    });
    target.updatedAt=new Date().toISOString();
    window.fadeTo?.(values,300); window.updateDMX?.(); window.renderFixtures?.(); window.buildControls?.(); window.Targets?.refresh?.();
    window.log?.(`Captured target \"${target.name}\" — aimed and locked ${fixtures.length} fixture(s) at P${Math.round(values.pan)} T${Math.round(values.tilt)} until release`,"ok");
    return {ok:true,target};
  }
  function release(name) {
    const target=findTarget(name);
    if(!target)return {ok:false,message:`Target \"${clean(name)}\" not found.`};
    const fixtures=selectedFixtures();
    const ids=fixtures.length?new Set(fixtures.map(f=>f.id)):new Set((target.captures||[]).map(c=>c.fixtureId));
    let released=0;
    (target.captures||[]).forEach(c=>{if(ids.has(c.fixtureId)&&unlock(c.fixtureId))released++;});
    target.captures=(target.captures||[]).filter(c=>!ids.has(c.fixtureId));
    target.updatedAt=new Date().toISOString();
    window.Targets?.refresh?.();
    window.log?.(`Released ${released} fixture(s) from target \"${target.name}\"`,"ok");
    return {ok:true,target};
  }
  function patch() {
    if(window.__targetCaptureLockPatch || typeof window.Targets!=="object" || typeof window.parseCommand!=="function")return;
    window.__targetCaptureLockPatch=true;
    window.Targets.capture=capture;
    window.Targets.release=release;
    const previous=window.parseCommand;
    window.parseCommand=function(raw){
      const command=clean(raw);
      const m=command.match(/^target\s+(capture|release)\s+(.+)$/i);
      if(!m)return previous.apply(this,arguments);
      const rest=clean(m[2]);
      const hit=rest.match(/(?:^|\s)((?:\d+\s*(?:thru|through|[-–])\s*\d+|\d+)(?:\s*,\s*(?:\d+\s*(?:thru|through|[-–])\s*\d+|\d+))*)$/i);
      const selector=hit?hit[1].trim():null;
      const name=hit?rest.slice(0,hit.index).trim():rest;
      if(selector){const result=selectFixtures(selector);if(!result.ok){window.log?.(result.message,"warn");return result;}}
      const result=m[1].toLowerCase()==="capture"?capture(name):release(name);
      if(!result.ok)window.log?.(result.message,"warn");
      return result;
    };
  }
  function boot(){
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",loadOriginal,{once:true});else loadOriginal();
    let attempts=0; const wait=()=>{patch();if(!window.__targetCaptureLockPatch&&++attempts<150)setTimeout(wait,100);}; setTimeout(wait,50);
  }
  boot();
})();
