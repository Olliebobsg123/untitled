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
  const stored=window.ShowStore?.getShow?.();
  const outputs=stored?.multiOutputs;
  return Array.isArray(outputs)?showClone(outputs):[];
}

function getOutputSettingsShowState(){
  const stored=window.ShowStore?.getShow?.();
  const result={outputs:getMultiOutputShowState(),relay:null,legacy:null};
  if(stored?.outputSettings&&typeof stored.outputSettings==="object"){
    result.legacy=showClone(stored.outputSettings.legacy||null);
    result.relay=showClone(stored.outputSettings.relay||null);
  }
  try{
    const art=window.ArtNet;
    if(art&&typeof art==="object")result.relay={protocol:"artnet",universe:Number.isFinite(Number(art.universe))?Number(art.universe):0,enabled:Boolean(art.enabled),fps:Number.isFinite(Number(art.fps))?Number(art.fps):25,port:6454,name:"Lighting Console"};
  }catch(_){ }
  result.outputs=result.outputs.map((output,index)=>{
    const o=showClone(output)||{};
    const protocol=String(o.protocol||"artnet").toLowerCase();
    o.name=String(o.name||`Universe Output ${index+1}`);
    o.protocol=["artnet","sacn","usb"].includes(protocol)?protocol:"artnet";
    o.port=Number.isInteger(Number(o.port))?Number(o.port):(o.protocol==="sacn"?5568:o.protocol==="artnet"?6454:null);
    o.target=String(o.target||"");
    return o;
  });
  return result;
}

function restoreOutputSettingsShowState(settings){
  if(!settings||typeof settings!=="object")return;
  const next=showClone(settings)||{};
  const current=window.ShowStore?.getShow?.()||{};
  current.outputSettings=next;
  if(Array.isArray(next.outputs))current.multiOutputs=showClone(next.outputs);
  window.ShowStore?.setShow?.(current);
  if(Array.isArray(next.outputs))restoreMultiOutputShowState(next.outputs);
}

function restoreMultiOutputShowState(outputs){
  if(!Array.isArray(outputs))return;
  const current=window.ShowStore?.getShow?.()||{};
  current.multiOutputs=showClone(outputs);
  window.ShowStore?.setShow?.(current);
  window.dispatchEvent(new CustomEvent("show-multi-output-restore",{detail:{outputs:showClone(outputs)}}));
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
function snapshotShowChases(){return Array.isArray(State.chases)?State.chases.map(chase=>showClone(chase)):[];}

let showVisualizerWindow=null;
let pendingShowVisualizerState=null;
function getVisualizerState(){
  if(window.S||window.VizState)return window.S||window.VizState;
  if(showVisualizerWindow&&!showVisualizerWindow.closed)return showVisualizerWindow.S||showVisualizerWindow.VizState||null;
  return null;
}
function normaliseVisualizerState(viz){
  const result={fixturePositions:[],fixtureManualRot:[],gridOn:true,houseOn:false,workOn:false};
  if(!viz||typeof viz!=="object")return result;
  if(Array.isArray(viz.fixturePositions))result.fixturePositions=viz.fixturePositions.map(showClone);
  if(Array.isArray(viz.fixtureManualRot))result.fixtureManualRot=viz.fixtureManualRot.map(showClone);
  if(typeof viz.gridOn==="boolean")result.gridOn=viz.gridOn;
  if(typeof viz.houseOn==="boolean")result.houseOn=viz.houseOn;
  if(typeof viz.workOn==="boolean")result.workOn=viz.workOn;
  return result;
}

function buildShowData(){
  const vizState={};
  const Viz=getVisualizerState();
  if(Viz){
    const posList=[];
    (State.fixtures||[]).forEach((fx,idx)=>{const pos=Viz.fixturePositions?.get(idx);if(pos)posList.push({fixtureIndex:idx,fixtureId:fx.id,x:Number(pos.x),y:Number(pos.y),z:Number(pos.z)})});
    const rotList=[];
    (State.fixtures||[]).forEach((fx,idx)=>{const rot=Viz.fixtureManualRot?.get(idx);if(rot)rotList.push({fixtureIndex:idx,fixtureId:fx.id,pan:Number(rot.pan),tilt:Number(rot.tilt)})});
    vizState.fixturePositions=posList;vizState.fixtureManualRot=rotList;
    vizState.gridOn=Viz.gridOn!==undefined?Boolean(Viz.gridOn):true;vizState.houseOn=Viz.houseOn!==undefined?Boolean(Viz.houseOn):false;vizState.workOn=Viz.workOn!==undefined?Boolean(Viz.workOn):false;
  }
  const cues=Array.isArray(State.cues)?State.cues.map(cue=>showClone(cue)):[];
  const chases=snapshotShowChases();
  const activeEffect=snapshotShowEffect();
  const savedEffects=snapshotShowEffects();
  const multiOutputs=getMultiOutputShowState();
  const outputSettings=getOutputSettingsShowState();
  return {version:5,fixtures:showClone(State.fixtures||[]),groups:showClone(State.groups||[]),cues,chases,fixtureStates:snapshotShowFixtureStates(),current:showClone(State.current||{}),selected:State.selected instanceof Set?[...State.selected]:[],activeEffect,savedEffects,effects:savedEffects,effectTargetMode:State.effectTargetMode||"selected",effectTargetIds:State.effectTargetIds instanceof Set?[...State.effectTargetIds]:[],currentCue:Number.isInteger(State.currentCue)?State.currentCue:-1,currentChase:Number.isInteger(State.currentChase)?State.currentChase:-1,activeChase:Number.isInteger(State.currentChase)&&State.currentChase>=0?State.currentChase:-1,chaseWait:Number.isFinite(Number(State.chaseWait))?Number(State.chaseWait):500,chaseFade:Number.isFinite(Number(State.chaseFade))?Number(State.chaseFade):800,visualizer:vizState,multiOutputs,outputSettings,savedAt:new Date().toISOString()};
}

async function persistShowData(showData){
  const data=showClone(showData);
  if(window.ShowStore?.setShow)window.ShowStore.setShow(data);
  if(window.electronShowFile?.save){
    try{
      await window.electronShowFile.save(data);
      console.log("[SHOW] persisted to js/shows.js",{fixtures:data.fixtures?.length||0,cues:data.cues?.filter(Boolean).length||0,chases:data.chases?.length||0});
      return true;
    }catch(e){console.error("[SHOW] Electron show-file save failed",e);return false;}
  }
  return false;
}

async function saveShow(){
  try{
    const showData=buildShowData();
    const ok=await persistShowData(showData);
    if(typeof log==="function")log(ok?`Show saved to js/shows.js — ${showData.fixtures.length} fixtures, ${showData.cues.filter(Boolean).length} cues, ${showData.chases.length} chases`:`Show is in memory; Electron show-file bridge unavailable`,ok?"ok":"warn");
    return ok;
  }catch(e){console.error("[SHOW] save failed",e);if(typeof log==="function")log("Failed to save show","warn");return false}
}

function stopRunningShowState(){
  try{if(typeof window.stopChase==="function")window.stopChase(false)}catch(e){console.warn("[SHOW] chase stop failed",e)}
  try{if(typeof window.stopEffect==="function")window.stopEffect(true)}catch(e){console.warn("[SHOW] effect stop failed",e)}
  if(State.fading!=null){try{cancelAnimationFrame(State.fading)}catch(_){}State.fading=null}
  if(State.followTimer!=null){try{clearTimeout(State.followTimer)}catch(_){}State.followTimer=null}
}
function restoreShowFixtureStates(entries){State.fixtureStates=new Map();if(!Array.isArray(entries))return;entries.forEach(entry=>{if(!Array.isArray(entry)||entry.length<2||entry[0]==null||!entry[1])return;State.fixtureStates.set(entry[0],showClone(entry[1]))})}
function restoreShowSelection(ids){State.selected=new Set();if(!Array.isArray(ids))return;const valid=new Set((State.fixtures||[]).map(f=>String(f?.id)));ids.forEach(id=>{if(valid.has(String(id)))State.selected.add(id)})}
function refreshShowEffectsUI(){try{if(typeof window.renderEffectsList==="function")window.renderEffectsList();if(typeof window.renderEffects==="function")window.renderEffects();if(typeof window.renderSavedEffects==="function")window.renderSavedEffects();if(typeof window.wireEffectButtons==="function")window.wireEffectButtons()}catch(e){console.warn("[SHOW] effects UI refresh failed",e)}}
function restoreVisualizerState(viz,targetWindow=null){
  const normalised=normaliseVisualizerState(viz);pendingShowVisualizerState=normalised;
  const Viz=targetWindow?.S||targetWindow?.VizState||getVisualizerState();if(!Viz)return;
  try{
    if(typeof Viz.applyLoadedPositions==="function")Viz.applyLoadedPositions(normalised.fixturePositions,normalised.fixtureManualRot);
    else{
      if(!(Viz.fixturePositions instanceof Map))Viz.fixturePositions=new Map();if(!(Viz.fixtureManualRot instanceof Map))Viz.fixtureManualRot=new Map();Viz.fixturePositions.clear();Viz.fixtureManualRot.clear();
      const fixtures=Array.isArray(State.fixtures)?State.fixtures:[];const fixtureIndexById=new Map(fixtures.map((fx,index)=>[String(fx?.id),index]));
      normalised.fixturePositions.forEach(saved=>{if(!saved||typeof saved!=="object")return;const savedId=saved.fixtureId!=null?String(saved.fixtureId):null;const index=savedId&&fixtureIndexById.has(savedId)?fixtureIndexById.get(savedId):Number(saved.fixtureIndex);if(!Number.isInteger(index)||index<0||index>=fixtures.length)return;const x=Number(saved.x),y=Number(saved.y),z=Number(saved.z);if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z))Viz.fixturePositions.set(index,{x,y,z})});
      normalised.fixtureManualRot.forEach(saved=>{if(!saved||typeof saved!=="object")return;const savedId=saved.fixtureId!=null?String(saved.fixtureId):null;const index=savedId&&fixtureIndexById.has(savedId)?fixtureIndexById.get(savedId):Number(saved.fixtureIndex);if(!Number.isInteger(index)||index<0||index>=fixtures.length)return;const pan=Number(saved.pan),tilt=Number(saved.tilt);if(Number.isFinite(pan)&&Number.isFinite(tilt))Viz.fixtureManualRot.set(index,{pan,tilt})});
      if(typeof Viz.rebuildFixtures==="function")Viz.rebuildFixtures();
    }
  }catch(e){console.error("[SHOW] visualizer restore failed",e)}
}
function applyPendingVisualizerState(targetWindow){if(!pendingShowVisualizerState||!targetWindow||targetWindow.closed)return;try{const Viz=targetWindow.S||targetWindow.VizState;if(!Viz)return;targetWindow.applyLoadedPositions?.(pendingShowVisualizerState.fixturePositions,pendingShowVisualizerState.fixtureManualRot);if(Viz.grid)Viz.grid.visible=pendingShowVisualizerState.gridOn}catch(e){console.error("[SHOW] pending visualizer restore failed",e)}}

function loadShow(jsonData){
  try{
    const data=typeof jsonData==="string"?JSON.parse(jsonData):jsonData;if(!data||typeof data!=="object")throw new Error("Invalid show object");stopRunningShowState();
    State.fixtures=Array.isArray(data.fixtures)?data.fixtures:[];State.groups=Array.isArray(data.groups)?data.groups:[];State.cues=Array.isArray(data.cues)?data.cues.map(showClone):[];State.chases=Array.isArray(data.chases)?data.chases.map(showClone):[];State.current=showClone(data.current||{});State.currentCue=Number.isInteger(data.currentCue)?data.currentCue:-1;State.currentChase=-1;State.chaseWait=Number.isFinite(Number(data.chaseWait))?Number(data.chaseWait):500;State.chaseFade=Number.isFinite(Number(data.chaseFade))?Number(data.chaseFade):800;
    restoreShowFixtureStates(data.fixtureStates);restoreShowSelection(data.selected);
    const effectLibrary=data.savedEffects&&typeof data.savedEffects==="object"&&!Array.isArray(data.savedEffects)?data.savedEffects:(data.effects&&typeof data.effects==="object"&&!Array.isArray(data.effects)?data.effects:{});State.savedEffects=showClone(effectLibrary);State.effectTargetMode=data.effectTargetMode||"selected";State.effectTargetIds=new Set(Array.isArray(data.effectTargetIds)?data.effectTargetIds.map(String):[]);
    if(Array.isArray(data.multiOutputs))restoreMultiOutputShowState(data.multiOutputs);if(data.outputSettings&&typeof data.outputSettings==="object")restoreOutputSettingsShowState(data.outputSettings);
    window.ShowStore?.setShow?.(data);
    restoreVisualizerState(data.visualizer);
    if(typeof renderFixtures==="function")renderFixtures();if(typeof renderGroups==="function")renderGroups();if(typeof renderCues==="function")renderCues();if(typeof renderChases==="function")renderChases();if(typeof updateInspectorList==="function")updateInspectorList();refreshShowEffectsUI();if(typeof rebuildFixtures==="function")setTimeout(()=>rebuildFixtures(),100);if(typeof updateDMX==="function")updateDMX();if(typeof sendToVisualizer==="function")sendToVisualizer();
    const activeEffect=data.activeEffect&&data.activeEffect.type?showClone(data.activeEffect):null;const activeChase=Number.isInteger(data.activeChase)&&data.activeChase>=0?data.activeChase:-1;
    if(activeEffect&&typeof window.startEffect==="function")setTimeout(()=>{try{window.startEffect(activeEffect.type,activeEffect)}catch(e){console.error("[SHOW] active effect restore failed",e)}},300);if(activeChase>=0&&State.chases[activeChase]&&typeof window.startChase==="function")setTimeout(()=>{try{window.startChase(activeChase)}catch(e){console.error("[SHOW] active chase restore failed",e)}},350);
    if(typeof log==="function")log(`Show loaded — ${State.fixtures.length} fixtures, ${State.cues.filter(Boolean).length} cues, ${State.chases.length} chases`,"ok");
  }catch(e){console.error("[SHOW] load failed",e);if(typeof log==="function")log("Load failed: invalid file","warn")}
}

async function loadStoredShow(){
  if(!window.electronShowFile?.load)return false;
  try{
    const data=await window.electronShowFile.load();
    if(data&&typeof data==="object"&&((data.fixtures||[]).length||data.cues||data.groups||data.chases)){
      loadShow(data);
      return true;
    }
  }catch(e){console.warn("[SHOW] stored show load failed",e)}
  return false;
}

function initShowFileControls(){
  const settingsPage=document.getElementById("page-settings");if(!settingsPage)return false;let panel=document.getElementById("showFileControls");
  if(!panel){panel=document.createElement("section");panel.id="showFileControls";panel.className="panel";panel.style.marginTop="16px";panel.innerHTML=`<div class="panel-header"><div><span class="eyebrow">SHOW</span> Show File</div><span class="panel-meta">JS SHOW FILE</span></div><div class="panel-body"><div class="action-row"><button class="btn-primary" id="btnSaveShow" type="button">💾 Save Show</button><button class="btn-secondary" id="btnLoadShow" type="button">↻ Reload Show File</button></div></div>`;settingsPage.appendChild(panel)}
  const saveButton=document.getElementById("btnSaveShow"),loadButton=document.getElementById("btnLoadShow");if(!saveButton||!loadButton)return false;saveButton.type="button";loadButton.type="button";
  if(saveButton.dataset.showWired!=="1"){saveButton.dataset.showWired="1";saveButton.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();saveShow()})}
  if(loadButton.dataset.showWired!=="1"){loadButton.dataset.showWired="1";loadButton.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();loadStoredShow()})}
  return true;
}
function installShowDelegatedHandlers(){if(window.__showDelegatedHandlers)return;window.__showDelegatedHandlers=true;document.addEventListener("click",e=>{const save=e.target?.closest?.("#btnSaveShow"),load=e.target?.closest?.("#btnLoadShow");if(!save&&!load)return;e.preventDefault();e.stopImmediatePropagation();if(save){saveShow();return}loadStoredShow()},true)}
function startShowFileControlWatcher(){installShowDelegatedHandlers();if(initShowFileControls())return;let attempts=0;const timer=setInterval(()=>{attempts++;if(initShowFileControls()||attempts>=100)clearInterval(timer)},100)}
window.saveShow=saveShow;window.buildShowData=buildShowData;window.loadShow=loadShow;window.loadStoredShow=loadStoredShow;window.addEventListener("message",e=>{if(e.data?.type!=="VISUALIZER_READY")return;showVisualizerWindow=e.source;applyPendingVisualizerState(showVisualizerWindow)});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{startShowFileControlWatcher();loadStoredShow()},{once:true});else{startShowFileControlWatcher();loadStoredShow()}
window.addEventListener("show-multi-output-restore",event=>console.log("[SHOW] Multi-output restore event",event.detail?.outputs?.length||0));
