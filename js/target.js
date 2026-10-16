"use strict";

/* Target system: reusable pan/tilt points with create, aim, capture and release. */
(function () {
  const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");

  function state() {
    window.State = window.State || {};
    if (!Array.isArray(State.targets)) State.targets = [];
    if (!(State.selected instanceof Set)) State.selected = new Set();
    if (!State.current || typeof State.current !== "object") State.current = {};
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
    return State;
  }

  function findTarget(name) {
    state();
    const wanted = clean(name).toLowerCase();
    if (/^\d+$/.test(wanted)) return State.targets[Number(wanted) - 1] || null;
    return State.targets.find(t => clean(t.name).toLowerCase() === wanted) || null;
  }

  function selectedFixtures() {
    state();
    return (State.fixtures || []).filter(f => State.selected.has(f.id));
  }

  function fixtureState(fixtureId) {
    state();
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixtureId);
    let current = State.fixtureStates.get(fixtureId);
    if (!current) { current = { ...State.current }; State.fixtureStates.set(fixtureId, current); }
    return current;
  }

  function lockFixturePosition(fixtureId, pan, tilt, targetId) {
    const current = fixtureState(fixtureId);
    const target = State.targets.find(t => t.id === targetId);
    const targetName = clean(target?.name) || "Centre";
    const lock = current.__targetPositionLock || { pan, tilt, targetId, targetName };
    lock.pan = pan; lock.tilt = tilt; lock.targetId = targetId; lock.targetName = targetName;
    Object.defineProperty(current, "__targetPositionLock", { value: lock, writable: true, configurable: true, enumerable: false });
    const warnLockedMove = axis => {
      const fixture = (State.fixtures || []).find(f => f.id === fixtureId);
      const fixtureLabel = fixture?.fixtureNumber ?? fixture?.number ?? fixture?.name ?? fixtureId;
      const message = `${lock.targetName} target is captured for Fixture ${fixtureLabel} — release the target before moving ${axis}.`;
      console.warn(`[TARGET] ${message}`);
      window.log?.(message, "warn");
    };
    Object.defineProperty(current, "pan", { configurable: true, enumerable: true, get: () => lock.pan, set: () => warnLockedMove("Pan") });
    Object.defineProperty(current, "tilt", { configurable: true, enumerable: true, get: () => lock.tilt, set: () => warnLockedMove("Tilt") });
  }

  function unlockFixturePosition(fixtureId) {
    const current = State.fixtureStates?.get(fixtureId);
    if (!current || !current.__targetPositionLock) return false;
    const lock = current.__targetPositionLock;
    delete current.__targetPositionLock;
    Object.defineProperty(current, "pan", { value: lock.pan, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(current, "tilt", { value: lock.tilt, writable: true, configurable: true, enumerable: true });
    return true;
  }

  function create(name) {
    state();
    const targetName = clean(name);
    if (!targetName) return { ok:false, message:"Target name cannot be empty." };
    if (findTarget(targetName)) return { ok:false, message:`Target "${targetName}" already exists.` };
    const pan = Number(State.current.pan), tilt = Number(State.current.tilt);
    if (!Number.isFinite(pan) || !Number.isFinite(tilt)) return { ok:false, message:"Current pan/tilt values are not available." };
    const target = { id:`target-${Date.now()}`, name:targetName, pan:Math.max(0,Math.min(255,pan)), tilt:Math.max(0,Math.min(255,tilt)), captures:[], createdAt:new Date().toISOString() };
    State.targets.push(target); render();
    window.log?.(`Created target "${target.name}" at P${target.pan} T${target.tilt}`,"ok");
    return { ok:true,target };
  }

  function aim(name) {
    state(); const target=findTarget(name);
    if(!target) return {ok:false,message:`Target "${clean(name)}" not found.`};
    const fixtures=selectedFixtures(); if(!fixtures.length) return {ok:false,message:"Select at least one fixture before aiming at a target."};
    const values={pan:target.pan,tilt:target.tilt}; Object.assign(State.current,values);
    fixtures.forEach(f=>Object.assign(fixtureState(f.id),values));
    window.fadeTo?.(values,300); window.updateDMX?.(); window.renderFixtures?.(); window.buildControls?.();
    window.log?.(`Aimed ${fixtures.length} fixture(s) at target "${target.name}"`,"ok"); return {ok:true,target};
  }

  function capture(name) {
    state(); const target=findTarget(name);
    if(!target) return {ok:false,message:`Target "${clean(name)}" not found.`};
    const fixtures=selectedFixtures(); if(!fixtures.length) return {ok:false,message:"Select at least one fixture before capturing a target."};
    const pan=Number(target.pan),tilt=Number(target.tilt);
    if(!Number.isFinite(pan)||!Number.isFinite(tilt)) return {ok:false,message:"Target pan/tilt values are not available."};
    const values={pan,tilt};
    const selectedIds=new Set(fixtures.map(f=>f.id));

    // CAPTURE behaves like AIM, but locks the fixtures at the target's saved position.
    // The target's saved pan/tilt values are never overwritten.
    State.targets.forEach(t=>{ t.captures=(t.captures||[]).filter(c=>!selectedIds.has(c.fixtureId)); });

    fixtures.forEach(f=>{
      const current=fixtureState(f.id);
      if(current.__targetPositionLock) unlockFixturePosition(f.id);
      Object.assign(current,values);
      lockFixturePosition(f.id,pan,tilt,target.id);
    });

    target.captures=target.captures||[];
    fixtures.forEach(f=>target.captures.push({fixtureId:f.id,pan,tilt,locked:true}));
    target.updatedAt=new Date().toISOString();
    Object.assign(State.current,values);
    window.fadeTo?.(values,300); window.updateDMX?.(); window.renderFixtures?.(); window.buildControls?.(); render();
    window.log?.(`Captured target "${target.name}" — aimed and locked ${fixtures.length} fixture(s) at P${Math.round(pan)} T${Math.round(tilt)} until release`,"ok"); return {ok:true,target};
  }

  function release(name) {
    state(); const target=findTarget(name); if(!target) return {ok:false,message:`Target "${clean(name)}" not found.`};
    const selected=selectedFixtures(),captures=target.captures||[]; const ids=selected.length?new Set(selected.map(f=>f.id)):new Set(captures.map(c=>c.fixtureId)); let released=0;
    captures.forEach(c=>{if(ids.has(c.fixtureId)&&unlockFixturePosition(c.fixtureId))released++;});
    target.captures=captures.filter(c=>!ids.has(c.fixtureId)); target.updatedAt=new Date().toISOString(); render();
    window.log?.(`Released ${released} fixture(s) from target "${target.name}"`,"ok"); return {ok:true,target};
  }

  function remove(name) {
    state(); const target=findTarget(name); if(!target) return {ok:false,message:`Target "${clean(name)}" not found.`};
    (target.captures||[]).forEach(c=>unlockFixturePosition(c.fixtureId)); State.targets.splice(State.targets.indexOf(target),1); render();
    window.log?.(`Deleted target "${target.name}" and released its captured fixtures`,"ok"); return {ok:true,target};
  }

  function list(){state();return State.targets;}

  function parseFixtureSelector(value) {
    const input = clean(value).toLowerCase().replace(/–/g, "-");
    if (!input) return [];
    const numbers = new Set();
    for (const token of input.split(",").map(part => part.trim()).filter(Boolean)) {
      const range = token.match(/^(\d+)\s*(?:thru|through|-)\s*(\d+)$/i);
      if (range) {
        const start = Number(range[1]), end = Number(range[2]), step = start <= end ? 1 : -1;
        for (let n = start; ; n += step) { numbers.add(n); if (n === end) break; }
        continue;
      }
      if (/^\d+$/.test(token)) numbers.add(Number(token)); else return [];
    }
    return [...numbers].filter(n => n > 0).sort((a,b) => a-b);
  }

  function fixtureByNumber(number) {
    state(); const fixtures = State.fixtures || [], n = Number(number);
    if (!Number.isInteger(n) || n < 1) return null;
    return fixtures.find(f => Number(f?.fixtureNumber) === n) || fixtures.find(f => Number(f?.number) === n) || fixtures[n - 1] || null;
  }

  function selectFixturesForCommand(selector) {
    const numbers = parseFixtureSelector(selector);
    if (!numbers.length) return { ok:false, message:"Invalid fixture selector. Use 1, 1,2,3 or 1 thru 5." };
    const selected = numbers.map(fixtureByNumber).filter(Boolean);
    if (!selected.length) return { ok:false, message:`No fixtures found for selector ${selector}.` };
    State.selected = new Set(selected.map(f => f.id));
    window.updateControlVisibility?.();
    return { ok:true, fixtures:selected, numbers };
  }

  function splitTargetCommand(command) {
    const prefix = command.match(/^target\s+(create|aim|capture|release|delete)\s+(.+)$/i);
    if (!prefix) return null;
    const action = prefix[1].toLowerCase(), rest = clean(prefix[2]);
    const fixturePattern = /(?:^|\s)((?:\d+\s*(?:thru|through|[-–])\s*\d+|\d+)(?:\s*,\s*(?:\d+\s*(?:thru|through|[-–])\s*\d+|\d+))*)$/i;
    const match = rest.match(fixturePattern);
    if (!match) return { action, name:rest, selector:null };
    const selector = match[1].trim(), name = rest.slice(0, match.index).trim();
    if (!name) return { action, name:rest, selector:null };
    return { action, name, selector };
  }


  function open(){document.getElementById("targetModal")?.classList.add("open");render();}
  function close(){document.getElementById("targetModal")?.classList.remove("open");}

  function render(){
    state(); const listEl=document.querySelector("[data-target-list]"); if(!listEl)return; listEl.innerHTML="";
    if(!State.targets.length){listEl.innerHTML='<div class="target-empty">No targets created yet. Create one from the current pan/tilt position.</div>';return;}
    State.targets.forEach((target,index)=>{
      const card=document.createElement("div");card.className="target-card";
      card.innerHTML=`<strong>${index+1}. ${clean(target.name)}</strong><div class="target-coords">PAN ${Math.round(target.pan)} · TILT ${Math.round(target.tilt)} · ${target.captures?.length||0} CAPTURED</div><div class="target-card-actions"><button data-action="aim">AIM</button><button data-action="capture">CAPTURE</button><button data-action="release">RELEASE</button><button data-action="delete">DELETE</button></div>`;
      card.querySelector('[data-action="aim"]').onclick=()=>{const r=aim(target.name);if(r.ok)close();}; card.querySelector('[data-action="capture"]').onclick=()=>capture(target.name); card.querySelector('[data-action="release"]').onclick=()=>release(target.name); card.querySelector('[data-action="delete"]').onclick=()=>remove(target.name); listEl.appendChild(card);
    });
  }

  function createUI(){
    if(document.getElementById("targetModal"))return; const quickPanel=document.querySelector("#page-live .quick-panel .panel-body");
    if(quickPanel&&!document.getElementById("targetLaunch")){const button=document.createElement("button");button.type="button";button.id="targetLaunch";button.className="target-launch";button.innerHTML='<span>TARGETS</span><span>AIM / CAPTURE ↗</span>';button.onclick=open;quickPanel.appendChild(button);}
    const modal=document.createElement("div");modal.id="targetModal";modal.className="target-modal";
    modal.innerHTML=`<div class="target-window" role="dialog" aria-modal="true" aria-label="Target library"><div class="target-head"><div class="target-title">TARGET LIBRARY<small>POSITION CONTROL</small></div><button type="button" class="target-close">×</button></div><div class="target-toolbar"><input id="targetNameInput" placeholder="Target name e.g. Centre Stage"><button type="button" id="targetCreateButton">＋ CREATE TARGET</button></div><div class="target-list" data-target-list></div></div>`;
    document.body.appendChild(modal);modal.querySelector(".target-close").onclick=close;modal.onclick=e=>{if(e.target===modal)close();};
    modal.querySelector("#targetCreateButton").onclick=()=>{const input=modal.querySelector("#targetNameInput"),result=create(input.value);if(result.ok)input.value="";else window.log?.(result.message,"warn");};render();
  }

  const TARGET_COMMANDS=[
    ["target create ","Create a target from the current pan/tilt"],
    ["target aim ","Aim selected fixtures at a target — add fixture numbers last"],
    ["target capture ","Aim selected fixtures at the saved target position and lock them — add fixture numbers last"],
    ["target release ","Release captured fixtures — add fixture numbers last"],
    ["target delete ","Delete a target"],
    ["targets","List targets"]
  ];

  // target create/aim/capture/release/delete [name] [fixtures], targets
  LXCommands.add(raw=>{
    const command=clean(raw);
    const parsed=splitTargetCommand(command);
    if(parsed){
      if(parsed.selector){const selection=selectFixturesForCommand(parsed.selector);if(!selection.ok){window.log?.(selection.message,"warn");return selection;}}
      const fn=parsed.action==="create"?create:parsed.action==="aim"?aim:parsed.action==="capture"?capture:parsed.action==="release"?release:remove;
      const r=fn(parsed.name); if(!r.ok)window.log?.(r.message,"warn"); return r;
    }
    if(/^targets$/i.test(command)){const items=list();return window.log?.(items.length?items.map((t,i)=>`${i+1}: ${t.name}`).join(", "):"No targets saved","ok");}
    return LXCommands.NOT_MINE;
  });
  TARGET_COMMANDS.forEach(([cmd,hint])=>LXCommands.describe(cmd.trim(),hint));

  window.Targets={create,aim,capture,release,delete:remove,list,open,refresh:render,parseFixtureSelector,selectFixturesForCommand};

  function boot(){state();createUI();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
