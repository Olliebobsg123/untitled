"use strict";

function showClone(value){
  if(value===undefined)return value;
  try{return structuredClone(value)}catch(_){ }
  try{return JSON.parse(JSON.stringify(value))}catch(_){ }
  if(Array.isArray(value))return value.slice();
  if(value&&typeof value==="object")return {...value};
  return value;
}

function getMultiOutputShowState(){
  try{
    const raw=localStorage.getItem("lighting-multi-outputs");
    const outputs=JSON.parse(raw||"[]");
    return Array.isArray(outputs)?outputs:[];
  }catch(_){return[]}
}

function restoreMultiOutputShowState(outputs){
  if(!Array.isArray(outputs))return;
  try{localStorage.setItem("lighting-multi-outputs",JSON.stringify(outputs))}catch(_){ }
  window.dispatchEvent(new CustomEvent("show-multi-output-restore",{detail:{outputs}}));
}

function snapshotShowFixtureStates(){
  if(!(State.fixtureStates instanceof Map))return [];
  const result=[];
  State.fixtureStates.forEach((value,id)=>result.push([id,showClone(value)]));
  return result;
}

function snapshotShowEffect(){
  if(!State.activeEffect||!State.activeEffect.type)return null;
  const effect=showClone(State.activeEffect);
  if(Array.isArray(effect.fixtureIds))effect.fixtureIds=[...new Set(effect.fixtureIds.map(String))];
  return effect;
}

function snapshotShowEffects(){
  const effects=showClone(State.savedEffects||{});
  return effects&&typeof effects==="object"&&!Array.isArray(effects)?effects:{};
}

function snapshotShowChases(){
  return Array.isArray(State.chases)?State.chases.map(chase=>showClone(chase)):[];
}

function getVisualizerState(){
  return window.S||window.VizState||(window.opener&&(window.opener.S||window.opener.VizState));
}

function saveShow(){
  try{
    const vizState={};
    const Viz=getVisualizerState();

    if(Viz){
      const posList=[];
      (State.fixtures||[]).forEach((fx,idx)=>{
        const pos=Viz.fixturePositions?.get(idx);
        if(pos)posList.push({fixtureIndex:idx,fixtureId:fx.id,x:Number(pos.x),y:Number(pos.y),z:Number(pos.z)});
      });

      const rotList=[];
      (State.fixtures||[]).forEach((fx,idx)=>{
        const rot=Viz.fixtureManualRot?.get(idx);
        if(rot)rotList.push({fixtureIndex:idx,fixtureId:fx.id,pan:Number(rot.pan),tilt:Number(rot.tilt)});
      });

      vizState.fixturePositions=posList;
      vizState.fixtureManualRot=rotList;
      vizState.gridOn=typeof gridOn!=="undefined"?gridOn:true;
      vizState.houseOn=typeof houseOn!=="undefined"?houseOn:false;
      vizState.workOn=typeof workOn!=="undefined"?workOn:false;
    }

    const cues=Array.isArray(State.cues)?State.cues.map(cue=>showClone(cue)):[];
    const chases=snapshotShowChases();
    const activeEffect=snapshotShowEffect();
    const savedEffects=snapshotShowEffects();
    const multiOutputs=getMultiOutputShowState();

    const showData={
      version:3,
      fixtures:showClone(State.fixtures||[]),
      groups:showClone(State.groups||[]),
      cues,
      chases,
      fixtureStates:snapshotShowFixtureStates(),
      current:showClone(State.current||{}),
      selected:State.selected instanceof Set?[...State.selected]:[],
      activeEffect,
      savedEffects,
      effects:savedEffects,
      effectTargetMode:State.effectTargetMode||"selected",
      effectTargetIds:State.effectTargetIds instanceof Set?[...State.effectTargetIds]:[],
      currentCue:Number.isInteger(State.currentCue)?State.currentCue:-1,
      currentChase:Number.isInteger(State.currentChase)?State.currentChase:-1,
      activeChase:Number.isInteger(State.currentChase)&&State.currentChase>=0?State.currentChase:-1,
      chaseWait:Number.isFinite(Number(State.chaseWait))?Number(State.chaseWait):500,
      chaseFade:Number.isFinite(Number(State.chaseFade))?Number(State.chaseFade):800,
      visualizer:vizState,
      multiOutputs,
      savedAt:new Date().toISOString()
    };

    const blob=new Blob([JSON.stringify(showData,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`LightingShow_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);

    console.log("[SHOW] save completed",{fixtures:showData.fixtures.length,cues:showData.cues.filter(Boolean).length,chases:showData.chases.length,activeEffect:!!activeEffect,savedEffects:Object.keys(savedEffects).length,outputs:multiOutputs.length});
    if(typeof log==="function")log(`Show saved — ${showData.cues.filter(Boolean).length} cues, ${chases.length} chases, ${Object.keys(savedEffects).length} effects${activeEffect?", active effect":""}`,"ok");
  }catch(e){
    console.error("[SHOW] save failed",e);
    if(typeof log==="function")log("Failed to save show","warn");
  }
}

function stopRunningShowState(){
  try{if(typeof window.stopChase==="function")window.stopChase(false)}catch(e){console.warn("[SHOW] chase stop failed",e)}
  try{if(typeof window.stopEffect==="function")window.stopEffect(true)}catch(e){console.warn("[SHOW] effect stop failed",e)}
  if(State.fading!=null){try{cancelAnimationFrame(State.fading)}catch(_){}State.fading=null}
  if(State.followTimer!=null){try{clearTimeout(State.followTimer)}catch(_){}State.followTimer=null}
}

function restoreShowFixtureStates(entries){
  State.fixtureStates=new Map();
  if(!Array.isArray(entries))return;
  entries.forEach(entry=>{
    if(!Array.isArray(entry)||entry.length<2||entry[0]==null||!entry[1])return;
    State.fixtureStates.set(entry[0],showClone(entry[1]));
  });
}

function restoreShowSelection(ids){
  State.selected=new Set();
  if(!Array.isArray(ids))return;
  const valid=new Set((State.fixtures||[]).map(f=>String(f?.id)));
  ids.forEach(id=>{if(valid.has(String(id)))State.selected.add(id)});
}

function refreshShowEffectsUI(){
  try{
    if(typeof window.renderEffects==='function')window.renderEffects();
    if(typeof window.renderSavedEffects==='function')window.renderSavedEffects();
    if(typeof window.wireEffectButtons==='function')window.wireEffectButtons();
  }catch(e){console.warn("[SHOW] effects UI refresh failed",e)}
}

function restoreVisualizerState(viz){
  const Viz=getVisualizerState();
  if(!viz||!Viz)return;

  try{
    if(!(Viz.fixturePositions instanceof Map))Viz.fixturePositions=new Map();
    if(!(Viz.fixtureManualRot instanceof Map))Viz.fixtureManualRot=new Map();

    Viz.fixturePositions.clear();
    Viz.fixtureManualRot.clear();

    const fixtures=Array.isArray(State.fixtures)?State.fixtures:[];
    const fixtureIndexById=new Map(fixtures.map((fx,index)=>[String(fx?.id),index]));

    // Show files store both fixtureIndex and fixtureId. Prefer the ID so
    // positions still follow the correct fixture if the patch order changes.
    if(Array.isArray(viz.fixturePositions)){
      viz.fixturePositions.forEach(saved=>{
        if(!saved||typeof saved!=="object")return;
        const savedId=saved.fixtureId!=null?String(saved.fixtureId):null;
        const index=savedId&&fixtureIndexById.has(savedId)
          ?fixtureIndexById.get(savedId)
          :Number(saved.fixtureIndex);
        if(!Number.isInteger(index)||index<0||index>=fixtures.length)return;

        const x=Number(saved.x),y=Number(saved.y),z=Number(saved.z);
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return;

        // Do not construct THREE.Vector3 here. THREE is module-scoped inside
        // visualizer.html and is intentionally not exposed to the console.
        // makeFixture only needs x/y/z, so a plain object is sufficient.
        Viz.fixturePositions.set(index,{x,y,z});
      });
    }

    if(Array.isArray(viz.fixtureManualRot)){
      viz.fixtureManualRot.forEach(saved=>{
        if(!saved||typeof saved!=="object")return;
        const savedId=saved.fixtureId!=null?String(saved.fixtureId):null;
        const index=savedId&&fixtureIndexById.has(savedId)
          ?fixtureIndexById.get(savedId)
          :Number(saved.fixtureIndex);
        if(!Number.isInteger(index)||index<0||index>=fixtures.length)return;

        const pan=Number(saved.pan),tilt=Number(saved.tilt);
        if(!Number.isFinite(pan)||!Number.isFinite(tilt))return;
        Viz.fixtureManualRot.set(index,{pan,tilt});
      });
    }

    console.log("[SHOW] visualizer positions restored",{
      positions:Viz.fixturePositions.size,
      rotations:Viz.fixtureManualRot.size
    });
  }catch(e){
    console.error("[SHOW] visualizer restore failed",e);
  }
}

function loadShow(jsonData){
  try{
    const data=typeof jsonData==="string"?JSON.parse(jsonData):jsonData;
    if(!data||typeof data!=="object")throw new Error("Invalid show object");

    stopRunningShowState();

    State.fixtures=Array.isArray(data.fixtures)?data.fixtures:[];
    State.groups=Array.isArray(data.groups)?data.groups:[];
    State.cues=Array.isArray(data.cues)?data.cues.map(showClone):[];
    State.chases=Array.isArray(data.chases)?data.chases.map(showClone):[];
    State.current=showClone(data.current||{});
    State.currentCue=Number.isInteger(data.currentCue)?data.currentCue:-1;
    State.currentChase=-1;
    State.chaseWait=Number.isFinite(Number(data.chaseWait))?Number(data.chaseWait):500;
    State.chaseFade=Number.isFinite(Number(data.chaseFade))?Number(data.chaseFade):800;

    restoreShowFixtureStates(data.fixtureStates);
    restoreShowSelection(data.selected);

    const effectLibrary=data.savedEffects&&typeof data.savedEffects==="object"&&!Array.isArray(data.savedEffects)
      ?data.savedEffects
      :(data.effects&&typeof data.effects==="object"&&!Array.isArray(data.effects)?data.effects:{});
    State.savedEffects=showClone(effectLibrary);
    State.effectTargetMode=data.effectTargetMode||"selected";
    State.effectTargetIds=new Set(Array.isArray(data.effectTargetIds)?data.effectTargetIds.map(String):[]);

    if(Array.isArray(data.multiOutputs))restoreMultiOutputShowState(data.multiOutputs);

    // Restore the visualizer BEFORE rebuilding fixtures. The old code tried to
    // create THREE.Vector3 objects here, but THREE is not a global in the
    // console window. That threw a ReferenceError and aborted the rest of the
    // load, leaving the visualizer at its default positions.
    restoreVisualizerState(data.visualizer);

    if(typeof renderFixtures==="function")renderFixtures();
    if(typeof renderGroups==="function")renderGroups();
    if(typeof renderCues==="function")renderCues();
    if(typeof renderChases==="function")renderChases();
    if(typeof updateInspectorList==="function")updateInspectorList();
    refreshShowEffectsUI();

    if(typeof rebuildFixtures==="function")setTimeout(()=>rebuildFixtures(),100);
    if(typeof updateDMX==="function")updateDMX();
    if(typeof sendToVisualizer==="function")sendToVisualizer();

    const activeEffect=data.activeEffect&&data.activeEffect.type?showClone(data.activeEffect):null;
    const activeChase=Number.isInteger(data.activeChase)&&data.activeChase>=0?data.activeChase:-1;

    if(activeEffect&&typeof window.startEffect==="function"){
      setTimeout(()=>{
        try{window.startEffect(activeEffect.type,activeEffect)}catch(e){console.error("[SHOW] active effect restore failed",e)}
      },300);
    }

    if(activeChase>=0&&State.chases[activeChase]&&typeof window.startChase==="function"){
      setTimeout(()=>{
        try{window.startChase(activeChase)}catch(e){console.error("[SHOW] active chase restore failed",e)}
      },350);
    }

    console.log("[SHOW] load completed",{
      fixtures:State.fixtures.length,
      cues:State.cues.filter(Boolean).length,
      chases:State.chases.length,
      activeEffect:!!activeEffect,
      activeChase,
      savedEffects:Object.keys(State.savedEffects||{}).length,
      outputs:Array.isArray(data.multiOutputs)?data.multiOutputs.length:0
    });
    if(typeof log==="function")log(`Show loaded — ${State.cues.filter(Boolean).length} cues, ${State.chases.length} chases, ${Object.keys(State.savedEffects||{}).length} effects${activeEffect?", effect restored":""}${activeChase>=0?", chase restored":""}`,"ok");
  }catch(e){
    console.error("[SHOW] load failed",e);
    if(typeof log==="function")log("Load failed: invalid file","warn");
  }
}

function initShowFileControls(){
  const settingsPage=document.getElementById("page-settings");
  if(!settingsPage)return false;
  let panel=document.getElementById("showFileControls");
  if(!panel){
    panel=document.createElement("section");
    panel.id="showFileControls";
    panel.className="panel";
    panel.style.marginTop="16px";
    panel.innerHTML=`<div class="panel-header"><div><span class="eyebrow">SHOW</span> Show File</div><span class="panel-meta">SAVE / LOAD</span></div><div class="panel-body"><div class="action-row"><button class="btn-primary" id="btnSaveShow" type="button">💾 Save Show</button><button class="btn-secondary" id="btnLoadShow" type="button">📂 Load Show</button></div><input id="showFileInput" type="file" accept=".json,application/json" style="display:none"></div>`;
    settingsPage.appendChild(panel);
  }

  const saveButton=document.getElementById("btnSaveShow"),loadButton=document.getElementById("btnLoadShow"),fileInput=document.getElementById("showFileInput");
  if(!saveButton||!loadButton||!fileInput)return false;
  saveButton.type="button";loadButton.type="button";

  if(saveButton.dataset.showWired!=="1"){
    saveButton.dataset.showWired="1";
    saveButton.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();console.log("[SHOW] Save Show clicked");saveShow()});
  }

  if(loadButton.dataset.showWired!=="1"){
    loadButton.dataset.showWired="1";
    loadButton.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();console.log("[SHOW] Load Show clicked");fileInput.click()});
  }

  if(fileInput.dataset.showWired!=="1"){
    fileInput.dataset.showWired="1";
    fileInput.addEventListener("change",async e=>{
      const file=e.target.files?.[0];
      if(!file)return;
      console.log("[SHOW] File selected",file.name);
      try{loadShow(await file.text())}
      catch(err){console.error("[SHOW] File read failed",err)}
      finally{fileInput.value=""}
    });
  }

  console.log("[SHOW] controls wired",{save:!!saveButton,load:!!loadButton,input:!!fileInput});
  return true;
}

function installShowDelegatedHandlers(){
  if(window.__showDelegatedHandlers)return;
  window.__showDelegatedHandlers=true;
  document.addEventListener("click",e=>{
    const save=e.target?.closest?.("#btnSaveShow"),load=e.target?.closest?.("#btnLoadShow");
    if(!save&&!load)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(save){console.log("[SHOW] delegated Save Show click");saveShow();return}
    const input=document.getElementById("showFileInput");
    console.log("[SHOW] delegated Load Show click",!!input);
    if(input)input.click();else console.error("[SHOW] showFileInput missing");
  },true);
  console.log("[SHOW] delegated handlers installed");
}

function startShowFileControlWatcher(){
  console.log("[SHOW] show.js loaded");
  installShowDelegatedHandlers();
  if(initShowFileControls())return;
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(initShowFileControls()||attempts>=100){
      clearInterval(timer);
      if(attempts>=100)console.error("[SHOW] Settings controls not found");
    }
  },100);
}

window.saveShow=saveShow;
window.loadShow=loadShow;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startShowFileControlWatcher,{once:true});
else startShowFileControlWatcher();
window.addEventListener("show-multi-output-restore",event=>console.log("[SHOW] Multi-output restore event",event.detail?.outputs?.length||0));
