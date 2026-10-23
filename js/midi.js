"use strict";

/* COMPACT MIDI CONTROLLER
   MPK MINI MK3:
   - MIDI Learn
   - Configurable pad targets
   - 14-bit pitch-bend joystick X
   - CC joystick Y
   - Knobs
   - Cues / GO / Blackout
   - Record Cue
   - Position Hold
*/

const MIDI={
  access:null,input:null,inputs:[],
  mappings:JSON.parse(localStorage.getItem("midiMappings")||"{}"),
  targets:JSON.parse(localStorage.getItem("midiTargets")||"{}"),
  learning:null,connected:false,
  nextCueNumber:Number(localStorage.getItem("midiNextCueNumber")||1),
  mappingLookup:new Map(),buttonState:{},pendingRender:false,
  _lastRecordTime:0,_lastPad10Time:0,_lastPad11Time:0,
  positionHold:localStorage.getItem("midiPositionHold")==="true",
  heldPosition:null,
  joystick:{
    x:63.5,y:64,pan:128,tilt:128,
    deadzone:.04,smoothing:.45,
    lastPan:128,lastTilt:128,
    rawX:63.5,rawY:64
  },
  joystickInvertY:localStorage.getItem("midiJoystickInvertY")!=="false"
};

try{
  const p=JSON.parse(localStorage.getItem("midiHeldPosition")||"null");
  if(p&&Number.isFinite(+p.pan)&&Number.isFinite(+p.tilt))
    MIDI.heldPosition={pan:Math.round(+p.pan),tilt:Math.round(+p.tilt)};
}catch(e){}

const MIDI_DEFAULTS={
  knob1:"intensity",knob2:"hue",knob3:"saturation",
  knob4:"pan",knob5:"tilt",knob6:"zoom",knob7:"focus",
  knob8:"speed",knob9:"strobe",
  joystickX:"pan",joystickY:"tilt",
  pad1:"cue1",pad2:"cue2",pad3:"cue3",pad4:"cue4",
  pad5:"blackout",pad6:"go",pad7:"cue5",pad8:"recordnext",
  pad9:"cue6",pad10:"holdposition",pad11:"resetposition",
  pad12:"cue7",pad13:"cue8",pad14:"cue9",pad15:"cue10",pad16:"none"
};

const MIDI_CONTROLS=[
  ["knob1","KNOB 1"],["knob2","KNOB 2"],["knob3","KNOB 3"],
  ["knob4","KNOB 4"],["knob5","KNOB 5"],["knob6","KNOB 6"],
  ["knob7","KNOB 7"],["knob8","KNOB 8"],["knob9","KNOB 9"],
  ["joystickX","JOYSTICK X"],["joystickY","JOYSTICK Y"],
  ["pad1","PAD 1"],["pad2","PAD 2"],["pad3","PAD 3"],["pad4","PAD 4"],
  ["pad5","PAD 5"],["pad6","PAD 6"],["pad7","PAD 7"],["pad8","PAD 8"],
  ["pad9","PAD 9"],["pad10","PAD 10"],["pad11","PAD 11"],
  ["pad12","PAD 12"],["pad13","PAD 13"],["pad14","PAD 14"],
  ["pad15","PAD 15"],["pad16","PAD 16"]
];

// Every target here can be assigned to ANY control (knob, pad or
// joystick axis) via the dropdown in the MIDI settings panel — not
// just the knobs' out-of-the-box defaults in MIDI_DEFAULTS. Anything
// not specially handled in executeNamedControl (hue/saturation/pan/
// tilt/master/named actions) falls through to a generic "write this
// value straight to the fixture's DMX-equivalent state key" handler,
// so adding a new channel here is enough to make it MIDI-controllable.
const TARGETS=[
  ["intensity","Intensity"],["hue","Hue"],["saturation","Saturation"],
  ["pan","Pan"],["tilt","Tilt"],["zoom","Zoom"],["focus","Focus"],
  ["speed","Speed"],["strobe","Strobe"],

  ["frost","Frost"],["iris","Iris"],
  ["gobo","Gobo 1 Pattern"],["gobor","Gobo 1 Rotate"],
  ["gobo2","Gobo 2 Pattern"],["gobo2r","Gobo 2 Rotate"],
  ["prism","Prism Engage"],["prismr","Prism Rotate"],

  ["shutter1Insert","Shutter 1 Insert"],["shutter1Rotate","Shutter 1 Rotate"],
  ["shutter2Insert","Shutter 2 Insert"],["shutter2Rotate","Shutter 2 Rotate"],
  ["shutter3Insert","Shutter 3 Insert"],["shutter3Rotate","Shutter 3 Rotate"],
  ["shutter4Insert","Shutter 4 Insert"],["shutter4Rotate","Shutter 4 Rotate"],

  ["warmWhite","Warm White"],["naturalWhite","Natural White"],
  ["coolWhite","Cool White"],["cct","CCT"],

  ["rot","Rotation"],["effect","Effect"],["macro","Macro"],
  ["preset","Preset"],["shake","Shake"],["mode","Mode"],["zone","Zone"],
  ["fog","Fog"],["fana","Fan"],["haze","Haze"],["fluid","Fluid"],
  ["colmacro","Colour Macro"],

  ["blackout","Blackout"],
  ["go","GO"],["recordnext","Record Next Cue"],
  ["holdposition","Hold Position"],["resetposition","Release Position"],
  ...Array.from({length:50},(_,i)=>[`cue${i+1}`,`Cue ${i+1}`]),
  ["none","None"]
];

// Anything in here just means "clamp the incoming MIDI value to
// 0-255 and write it to this key on the selected fixture(s)' state" —
// exactly the same DMX-equivalent value every other dynamic control
// in controls.js/fresnel-controls.js already writes to that same key.
const DIRECT_STATE_TARGETS=new Set([
  "zoom","focus","speed","strobe",
  "frost","iris","gobo","gobor","gobo2","gobo2r","prism","prismr",
  "shutter1Insert","shutter1Rotate","shutter2Insert","shutter2Rotate",
  "shutter3Insert","shutter3Rotate","shutter4Insert","shutter4Rotate",
  "warmWhite","naturalWhite","coolWhite","cct",
  "rot","effect","macro","preset","shake","mode","zone",
  "fog","fana","haze","fluid","colmacro"
]);

/* --------------------------------------------------------- */

function midiLog(msg){
  const text="[MIDI] "+msg;
  if(typeof log==="function")try{log(text)}catch(e){}
  const el=document.getElementById("termLog");
  if(!el)return;
  const line=document.createElement("div");
  line.textContent=text;
  el.appendChild(line);
  while(el.children.length>300)el.removeChild(el.firstChild);
  el.scrollTop=el.scrollHeight;
}

function midiStatus(text){
  const el=document.getElementById("midiStatus");
  if(el)el.textContent=text;
}

function midiTypeName(type){
  return type===0x90?"NOTE ON":
         type===0x80?"NOTE OFF":
         type===0xB0?"CC":
         type===0xE0?"PITCH":"MIDI";
}

/* ---------------------------------------------------------
   MAPPINGS
--------------------------------------------------------- */

function getMIDIMapping(control){return MIDI.mappings[control]||null}

function saveMIDIMappings(){
  localStorage.setItem("midiMappings",JSON.stringify(MIDI.mappings));
  localStorage.setItem("midiTargets",JSON.stringify(MIDI.targets));
  rebuildMIDIMappingLookup();
  updateMIDILearnUI();
}

function saveMIDINextCue(){
  localStorage.setItem("midiNextCueNumber",String(MIDI.nextCueNumber));
}

function setMIDIMapping(control,msg){
  MIDI.mappings[control]={
    type:+msg.type,
    channel:+msg.channel,
    data1:+msg.data1
  };
  saveMIDIMappings();
}

function getMIDILookupKey(type,ch,data1){
  return `${type}:${ch}:${data1}`;
}

function rebuildMIDIMappingLookup(){
  MIDI.mappingLookup.clear();

  Object.entries(MIDI.mappings).forEach(([control,m])=>{
    if(!m)return;

    const type=+m.type,ch=+m.channel,d1=+m.data1;
    if(!Number.isFinite(type)||!Number.isFinite(ch)||!Number.isFinite(d1))
      return;

    /* Pitch bend has NO fixed data1.
       data1 is the low 7 bits of the changing 14-bit value. */
    if(type===0xE0)return;

    const key=getMIDILookupKey(type,ch,d1);
    if(!MIDI.mappingLookup.has(key))MIDI.mappingLookup.set(key,[]);
    MIDI.mappingLookup.get(key).push(control);
  });
}

/* ---------------------------------------------------------
   MIDI CONNECTION
--------------------------------------------------------- */

async function initMIDI(){
  if(!navigator.requestMIDIAccess){
    midiStatus("MIDI not supported");
    midiLog("Web MIDI API is not supported.");
    return;
  }

  try{
    MIDI.access=await navigator.requestMIDIAccess({sysex:false});
    MIDI.access.onstatechange=handleMIDIStateChange;
    rebuildMIDIMappingLookup();
    refreshMIDIInputs();
    midiLog("Web MIDI access granted.");
  }catch(e){
    midiStatus("MIDI access denied");
    midiLog("Could not access MIDI: "+(e?.message||e));
  }
}

function refreshMIDIInputs(){
  if(!MIDI.access)return;

  MIDI.inputs=Array.from(MIDI.access.inputs.values());

  if(!MIDI.inputs.length){
    if(MIDI.input)MIDI.input.onmidimessage=null;
    MIDI.input=null;
    MIDI.connected=false;
    midiStatus("No MIDI device");
    updateMIDIDeviceList();
    return;
  }

  const preferred=
    MIDI.inputs.find(i=>/mpk\s*mini/i.test(i.name||""))||
    MIDI.inputs.find(i=>/akai/i.test(i.name||""))||
    MIDI.inputs[0];

  if(MIDI.input?.id===preferred.id&&preferred.state!=="disconnected"){
    MIDI.connected=true;
    updateMIDIDeviceList();
    return;
  }

  connectMIDIInput(preferred);
}

function connectMIDIInput(input){
  if(!input)return;

  if(MIDI.input)MIDI.input.onmidimessage=null;

  MIDI.input=input;
  input.onmidimessage=handleMIDIMessage;
  MIDI.connected=true;

  midiStatus("Connected: "+(input.name||"MIDI Input"));
  midiLog("Connected to "+(input.name||"MIDI Input"));
  updateMIDIDeviceList();
}

function handleMIDIStateChange(e){
  const p=e.port;
  midiLog((p.name||"MIDI device")+" "+p.state);

  if(MIDI.input?.id===p.id&&p.state==="disconnected"){
    MIDI.input=null;
    MIDI.connected=false;
  }

  refreshMIDIInputs();
}

/* ---------------------------------------------------------
   MIDI INPUT / LEARN
--------------------------------------------------------- */

function isPadControl(control){
  return /^pad\d+$/.test(control);
}

function isPress(msg){
  if(msg.type===0x90)return +msg.data2>0;
  if(msg.type===0xB0)return +msg.data2>0;
  return msg.type!==0x80;
}

function isRelease(msg){
  return msg.type===0x80||
    (msg.type===0x90&&+msg.data2===0)||
    (msg.type===0xB0&&+msg.data2===0);
}

function handleMIDIMessage(e){
  const d=e.data;
  if(!d||d.length<2)return;

  const status=+d[0],data1=+d[1],data2=+(d[2]||0);
  const rawType=status&0xF0,ch=status&0x0F;

  if(![0x80,0x90,0xB0,0xE0].includes(rawType))return;

  const type=rawType===0x90&&data2===0?0x80:rawType;
  const msg={status,type,channel:ch,data1,data2};

  if(MIDI.learning){
    const control=MIDI.learning;

    if(isPadControl(control)&&(!isPress(msg)||isRelease(msg)))return;

    setMIDIMapping(control,msg);
    MIDI.learning=null;
    MIDI.buttonState[control]=false;

    midiLog(
      `Learned ${control}: ${midiTypeName(type)} CH ${ch+1} DATA ${data1}`
    );

    updateMIDILearnUI();
    midiStatus("Connected: "+(MIDI.input?.name||""));
    return;
  }

  processMIDIMapping(msg);
}

function isPadPress(control,msg){
  if(!isPadControl(control))return true;

  const pressed=isPress(msg);
  const old=!!MIDI.buttonState[control];
  MIDI.buttonState[control]=pressed;

  return pressed&&!old;
}

/* ---------------------------------------------------------
   IMPORTANT MPK MINI MK3 JOYSTICK HANDLING
--------------------------------------------------------- */

function processMIDIMapping(msg){

  /*
   * PITCH BEND = 14 BIT.
   *
   * DO NOT compare data1.
   * data1 changes continuously while the joystick moves.
   *
   * 8192 = centre
   * 0    = full negative
   * 16383= full positive
   */
  if(msg.type===0xE0){

    const map=MIDI.mappings.joystickX;

    if(
      map &&
      +map.type===0xE0 &&
      +map.channel===msg.channel
    ){
      const bend=(msg.data2<<7)|msg.data1;
      const x=(bend/16383)*127;

      updateMIDIJoystickX(x);
      return;
    }
  }

  const key=getMIDILookupKey(msg.type,msg.channel,msg.data1);
  const controls=MIDI.mappingLookup.get(key);

  if(!controls)return;

  controls.forEach(control=>{
    if(isPadControl(control)&&!isPadPress(control,msg))return;
    executeMIDIControl(control,msg.data2);
  });
}

/* ---------------------------------------------------------
   FIXTURE STATE
--------------------------------------------------------- */

function getSelectedFixtures(){
  if(typeof State==="undefined"||!Array.isArray(State.fixtures))return [];

  const fixtures=State.fixtures.filter(f=>f&&f.id!=null);
  if(!fixtures.length)return [];

  const selected=State.selected;

  if(selected?.has instanceof Function){
    const r=fixtures.filter(f=>selected.has(f.id));
    if(r.length)return r;
  }

  if(Array.isArray(selected)){
    const ids=new Set(selected.map(x=>x?.id??x));
    const r=fixtures.filter(f=>ids.has(f.id));
    if(r.length)return r;
  }

  if(State.selectedFixtureId!=null){
    const f=fixtures.find(f=>
      f.id===State.selectedFixtureId||
      String(f.id)===String(State.selectedFixtureId)
    );
    if(f)return [f];
  }

  return fixtures.length===1?[fixtures[0]]:[];
}

function getFixtureMIDIState(fixture){
  if(!fixture||typeof State==="undefined")return null;

  if(State.fixtureStates?.get){
    let state=State.fixtureStates.get(fixture.id);

    if(!state){
      state=typeof createFixtureState==="function"
        ?createFixtureState(State.current||{})
        :{...(State.current||{})};

      State.fixtureStates.set(fixture.id,state);
    }

    return state;
  }

  return typeof fixtureState==="function"
    ?fixtureState(fixture.id)
    :State.current||null;
}

function scheduleMIDIVisualUpdate(){
  if(MIDI.pendingRender)return;
  MIDI.pendingRender=true;

  const render=()=>{
    MIDI.pendingRender=false;
    if(typeof updateDMX==="function")try{updateDMX()}catch(e){}
    if(typeof sendToVisualizer==="function")try{sendToVisualizer()}catch(e){}
    if(typeof renderFixtures==="function")try{renderFixtures()}catch(e){}
    if(typeof updateControlVisibility==="function")try{updateControlVisibility()}catch(e){}
    /* Redraws the colour wheel + hue/sat/zoom/focus/etc faders from
       the fixture state MIDI just wrote — without this, the wheel's
       indicator and preview swatch never move for a MIDI-driven
       colour change (its own update path lives in a closure app.js
       never exposes), only snapping into place later on some
       unrelated click, which reads as it randomly "flashing". */
    if(typeof window.syncControlsFromSelection==="function")
      try{window.syncControlsFromSelection()}catch(e){}
  };

  requestAnimationFrame?.(render)||setTimeout(render,0);
}

function updateSelectedFixturesState(key,value){
  const fixtures=getSelectedFixtures();

  if(!fixtures.length){

    return false;
  }

  // Callers like forceHeldPosition() reassert the SAME value on a fixed
  // interval (position hold re-writes pan/tilt every 100ms for as long
  // as it's on, which can be indefinitely — see enforceMIDIPositionHold)
  // rather than only when the value actually changes. scheduleMIDIVisualUpdate()
  // is not cheap: it runs a full renderFixtures() (list teardown/rebuild)
  // plus a visualizer resync every time it fires. Without checking for
  // an actual change here, re-asserting an unchanged held position looks
  // to the user like the fixture list and controls flashing continuously
  // for no reason, and can run forever since position hold persists
  // across restarts (localStorage) with no MIDI-free way to clear it.
  let changed=false;

  fixtures.forEach(f=>{
    const s=getFixtureMIDIState(f);
    if(!s)return;

    if(s[key]!==value)changed=true;

    s[key]=value;
    if(State.fixtureStates?.set)State.fixtureStates.set(f.id,s);
  });

  if(State.current&&typeof State.current==="object"){
    if(State.current[key]!==value)changed=true;
    State.current[key]=value;
  }

  if(changed)scheduleMIDIVisualUpdate();
  return true;
}

function updateSelectedFixtureState(key,value){
  return updateSelectedFixturesState(key,value);
}

/* ---------------------------------------------------------
   COLOUR
--------------------------------------------------------- */

function updateMIDIColour(hue,sat){
  const fixtures=getSelectedFixtures();
  if(!fixtures.length)return false;

  hue=Math.max(0,Math.min(360,+hue));
  sat=Math.max(0,Math.min(100,+sat));

  const h=hue/60,s=sat/100,c=s,x=c*(1-Math.abs(h%2-1));
  let r=0,g=0,b=0;

  if(h<1)[r,g,b]=[c,x,0];
  else if(h<2)[r,g,b]=[x,c,0];
  else if(h<3)[r,g,b]=[0,c,x];
  else if(h<4)[r,g,b]=[0,x,c];
  else if(h<5)[r,g,b]=[x,0,c];
  else[r,g,b]=[c,0,x];

  const m=1-c;
  r=Math.round((r+m)*255);
  g=Math.round((g+m)*255);
  b=Math.round((b+m)*255);

  fixtures.forEach(f=>{
    const state=getFixtureMIDIState(f);
    if(!state)return;
    state.hue=hue;
    state.sat=sat;
    if(State.fixtureStates instanceof Map)
      State.fixtureStates.set(f.id,state);
  });

  if(State.current){
    Object.assign(State.current,{hue,sat,r,g,b});
  }

  // The colour wheel itself gets redrawn via syncControlsFromSelection()
  // inside scheduleMIDIVisualUpdate() below — updateColourUI is declared
  // inside app.js's own DOMContentLoaded closure and was never reachable
  // as a bare global from here.
  scheduleMIDIVisualUpdate();
  return true;
}

/* ---------------------------------------------------------
   BASIC VALUES
--------------------------------------------------------- */

function getCurrentState(){
  const f=getSelectedFixtures();

  if(f.length){
    const s=getFixtureMIDIState(f[f.length-1]);
    if(s)return s;
  }

  return typeof State!=="undefined"&&State.current?State.current:{};
}

const clamp=(v,min,max)=>Math.max(min,Math.min(max,+v));

function getCurrentHue(){return clamp(getCurrentState().hue??0,0,360)}
function getCurrentSaturation(){return clamp(getCurrentState().sat??100,0,100)}
function getCurrentPan(){return Math.round(clamp(getCurrentState().pan??128,0,255))}
function getCurrentTilt(){return Math.round(clamp(getCurrentState().tilt??128,0,255))}

function setControlValue(id,value,events=false){
  const el=document.getElementById(id);
  if(!el)return;

  const min=+(el.min||0),max=+(el.max||100);
  el.value=clamp(value,min,max);

  if(events)
    ["input","change"].forEach(t=>
      el.dispatchEvent(new Event(t,{bubbles:true}))
    );
}

function updateMIDIPan(value){
  value=Math.round(clamp(value,0,255));
  const changed=updateSelectedFixturesState("pan",value);

  if(changed){
    updateXYUI(value,getCurrentTilt());
    setControlValue("pan",value);
  }

  return changed;
}

function updateMIDITilt(value){
  value=Math.round(clamp(value,0,255));
  const changed=updateSelectedFixturesState("tilt",value);

  if(changed){
    updateXYUI(getCurrentPan(),value);
    setControlValue("tilt",value);
  }

  return changed;
}

/* ---------------------------------------------------------
   JOYSTICK
--------------------------------------------------------- */

function applyDeadzone(v){
  const dz=MIDI.joystick.deadzone;
  if(Math.abs(v)<dz)return 0;

  const sign=v<0?-1:1;
  return sign*Math.min(1,(Math.abs(v)-dz)/(1-dz));
}

function smooth(previous,next){
  const a=clamp(MIDI.joystick.smoothing,.01,1);
  return previous+(next-previous)*a;
}

function updateMIDIJoystickX(value){
  value=+value;
  if(!Number.isFinite(value))return;

  MIDI.joystick.x=value;
  MIDI.joystick.rawX=value;

  if(MIDI.positionHold&&MIDI.heldPosition){
    MIDI.joystick.pan=MIDI.heldPosition.pan;
    MIDI.joystick.lastPan=MIDI.heldPosition.pan;
    forceHeldPosition();
    return;
  }

  /* Pitch bend centre is 63.5 after 14-bit -> 7-bit scaling. */
  const bipolar=applyDeadzone((value-63.5)/63.5);
  const pan=Math.round(((bipolar+1)/2)*255);
  const out=Math.round(smooth(MIDI.joystick.lastPan,pan));

  MIDI.joystick.pan=MIDI.joystick.lastPan=out;
  updateMIDIPan(out);
}

function updateMIDIJoystickY(value){
  value=+value;
  if(!Number.isFinite(value))return;

  MIDI.joystick.y=value;
  MIDI.joystick.rawY=value;

  if(MIDI.positionHold&&MIDI.heldPosition){
    MIDI.joystick.tilt=MIDI.heldPosition.tilt;
    MIDI.joystick.lastTilt=MIDI.heldPosition.tilt;
    forceHeldPosition();
    return;
  }

  let bipolar=(value-64)/63;

  if(MIDI.joystickInvertY)bipolar*=-1;

  bipolar=applyDeadzone(bipolar);

  const tilt=Math.round(((bipolar+1)/2)*255);
  const out=Math.round(smooth(MIDI.joystick.lastTilt,tilt));

  MIDI.joystick.tilt=MIDI.joystick.lastTilt=out;
  updateMIDITilt(out);
}

function updateXYUI(pan,tilt){
  const xy=document.getElementById("xy");
  const pad=document.querySelector(".xy-pad");
  if(!xy||!pad?.clientWidth||!pad?.clientHeight)return;

  xy.style.left=`${clamp(pan/255,0,1)*100}%`;
  xy.style.top=`${clamp(1-tilt/255,0,1)*100}%`;
}

/* ---------------------------------------------------------
   POSITION HOLD
--------------------------------------------------------- */

function saveJoystickSettings(){
  localStorage.setItem(
    "midiJoystickInvertY",
    String(MIDI.joystickInvertY)
  );
}

function saveMIDIPositionHold(){
  localStorage.setItem(
    "midiPositionHold",
    String(!!MIDI.positionHold)
  );

  if(MIDI.heldPosition)
    localStorage.setItem(
      "midiHeldPosition",
      JSON.stringify(MIDI.heldPosition)
    );
  else
    localStorage.removeItem("midiHeldPosition");
}

function getActualCurrentMIDIPosition(){
  const f=getSelectedFixtures();

  if(f.length){
    const s=getFixtureMIDIState(f[f.length-1]);
    if(s&&Number.isFinite(+s.pan)&&Number.isFinite(+s.tilt))
      return{
        pan:Math.round(clamp(s.pan,0,255)),
        tilt:Math.round(clamp(s.tilt,0,255))
      };
  }

  const s=getCurrentState();

  return{
    pan:Math.round(clamp(s.pan??MIDI.joystick.lastPan,0,255)),
    tilt:Math.round(clamp(s.tilt??MIDI.joystick.lastTilt,0,255))
  };
}

function holdCurrentMIDIPosition(){
  const now=performance.now();
  if(now-MIDI._lastPad10Time<250)return false;

  MIDI._lastPad10Time=now;

  const p=getActualCurrentMIDIPosition();

  if(!p)return false;

  MIDI.heldPosition={
    pan:Math.round(p.pan),
    tilt:Math.round(p.tilt)
  };

  MIDI.positionHold=true;
  MIDI.joystick.lastPan=MIDI.joystick.pan=p.pan;
  MIDI.joystick.lastTilt=MIDI.joystick.tilt=p.tilt;

  saveMIDIPositionHold();
  forceHeldPosition();

  midiLog(`POSITION SAVED: Pan ${p.pan}, Tilt ${p.tilt}`);
  midiStatus(`Position held: Pan ${p.pan} / Tilt ${p.tilt}`);
  return true;
}

function forceHeldPosition(){
  if(!MIDI.positionHold||!MIDI.heldPosition)return false;

  const p=MIDI.heldPosition;

  updateSelectedFixturesState("pan",p.pan);
  updateSelectedFixturesState("tilt",p.tilt);

  MIDI.joystick.pan=MIDI.joystick.lastPan=p.pan;
  MIDI.joystick.tilt=MIDI.joystick.lastTilt=p.tilt;

  updateXYUI(p.pan,p.tilt);
  return true;
}

// MIDI.positionHold is persisted to localStorage (see saveMIDIPositionHold)
// so it survives an app restart — deliberately, so a held position isn't
// lost if the app closes mid-session. But that means it can also be left
// "on" from a previous session with a MIDI controller that isn't plugged
// in this time, with no MIDI-only way to clear it (resetMIDIPosition()
// needs a real MIDI pad press). Without gating on MIDI.connected, this
// 100ms interval would then force every selected fixture's pan/tilt back
// to the stale held value ten times a second forever, with each pass
// triggering scheduleMIDIVisualUpdate()'s full renderFixtures() —
// exactly what a stuck flag looks like: the fixture list and controls
// visibly flashing at 10Hz and pan/tilt refusing to respond to input.
function enforceMIDIPositionHold(){
  if(MIDI.connected&&MIDI.positionHold)forceHeldPosition();
}

function resetMIDIPosition(){
  const now=performance.now();
  if(now-MIDI._lastPad11Time<250)return false;

  MIDI._lastPad11Time=now;
  MIDI.positionHold=false;
  MIDI.heldPosition=null;

  localStorage.removeItem("midiHeldPosition");
  localStorage.setItem("midiPositionHold","false");

  MIDI.joystick.pan=MIDI.joystick.lastPan=getCurrentPan();
  MIDI.joystick.tilt=MIDI.joystick.lastTilt=getCurrentTilt();

  midiLog("POSITION HOLD RELEASED");
  midiStatus(MIDI.connected?"Connected: "+(MIDI.input?.name||""):"No MIDI device");
  return true;
}

function toggleMIDIPositionHold(){
  return holdCurrentMIDIPosition();
}

/* ---------------------------------------------------------
   CONTROLS
--------------------------------------------------------- */

// Every control (knob, pad, joystick axis) resolves to a named
// action via getMIDITarget() — the SAME dropdown-driven lookup pads
// already used. Knobs used to have their behaviour hardcoded here
// by control number instead, which meant reassigning a knob's target
// in the settings panel dropdown silently did nothing; now the
// dropdown is the single source of truth for every control.
function executeMIDIControl(control,value){
  if(control==="joystickX")return updateMIDIJoystickX(value);
  if(control==="joystickY")return updateMIDIJoystickY(value);

  return executeNamedControl(getMIDITarget(control),value);
}

function getMIDITarget(control){
  return MIDI.targets[control]||MIDI_DEFAULTS[control]||"none";
}

function executeNamedControl(action,value){
  if(!action||action==="none")return;

  const normal=clamp(+value/127,0,1);
  const scaled=Math.round(normal*255);

  if(action==="intensity"){
    const v=Math.round(normal*100);
    updateSelectedFixturesState("intensity",v);
    setControlValue("intensity",v);
    return;
  }

  if(action==="hue")
    return updateMIDIColour(Math.round(normal*360),getCurrentSaturation());

  if(action==="saturation")
    return updateMIDIColour(getCurrentHue(),Math.round(normal*100));

  if(action==="pan")
    return MIDI.positionHold?forceHeldPosition():updateMIDIPan(scaled);

  if(action==="tilt")
    return MIDI.positionHold?forceHeldPosition():updateMIDITilt(scaled);

  if(action==="master"){
    setControlValue("master",Math.round(normal*100),true);
    return;
  }

  if(DIRECT_STATE_TARGETS.has(action)){
    updateSelectedFixturesState(action,scaled);
    setControlValue(action,scaled);
    return;
  }

  if(action==="blackout")return triggerBlackout();
  if(action==="go")return triggerGo();
  if(action==="recordnext")return recordNextMIDICue();
  if(action==="holdposition")return holdCurrentMIDIPosition();
  if(action==="resetposition")return resetMIDIPosition();

  const match=String(action).match(/^cue(\d+)$/);
  if(match)triggerCue(+match[1]);
}

/* ---------------------------------------------------------
   CUES
--------------------------------------------------------- */

function triggerCue(number){
  // MIDI pad "Cue 5" goes to cue number 5 (wherever it is in the list).
  if(typeof window.cueIndexOf==="function"&&typeof window.goToCue==="function"){
    const index=window.cueIndexOf(number);
    if(index<0){midiLog(`Cue ${number} not found`);return false;}
    window.goToCue(index);midiLog(`Cue ${number}`);return true;
  }
  const list=document.getElementById("cueList");
  if(!list)return false;

  let target=
    list.querySelector(`[data-cue-id="${number}"]`)||
    list.querySelector(`[data-cue-number="${number}"]`);

  if(!target){
    target=[...list.querySelectorAll("[data-cue-id],[data-cue-number],button")]
      .find(el=>{
        const m=(el.textContent||"").match(/\bCue\s*(\d+(?:\.\d+)?)\b/i);
        return m&&+m[1]===+number;
      });
  }

  if(!target){
    const cues=list.querySelectorAll("[data-cue-id],[data-cue-number]");
    target=cues[number-1];
  }

  if(target){
    target.click();
    midiLog(`Cue ${number}`);
    return true;
  }

  midiLog(`Cue ${number} not found.`);
  return false;
}

function triggerGo(){
  const btn=document.getElementById("btnCueGo");
  if(!btn)return false;
  btn.click();
  midiLog("GO");
  return true;
}

function triggerBlackout(){
  const btn=document.querySelector('[data-action="blackout"]');
  if(btn){btn.click();midiLog("BLACKOUT");return true;}
  if(typeof window.parseCommand==="function"){window.parseCommand("blackout");midiLog("BLACKOUT");return true;}
  return false;
}

/* ---------------------------------------------------------
   RECORDING
--------------------------------------------------------- */

function getExistingCueNumbers(){
  const list=document.getElementById("cueList");
  if(!list)return [];

  const nums=[];

  list.querySelectorAll("[data-cue-id],[data-cue-number]").forEach(el=>{
    const m=(el.textContent||"").match(/\bCue\s*(\d+(?:\.\d+)?)\b/i);
    const n=Number(
      el.getAttribute("data-cue-id")||
      el.getAttribute("data-cue-number")||
      (m?m[1]:"")
    );

    if(Number.isFinite(n)&&n>0)nums.push(n);
  });

  return [...new Set(nums)].sort((a,b)=>a-b);
}

function getNextCueNumber(){
  if(typeof window.nextCueNumber==="function")return window.nextCueNumber();
  const nums=getExistingCueNumbers();

  if(nums.length&&MIDI.nextCueNumber<=nums.at(-1))
    MIDI.nextCueNumber=nums.at(-1)+1;

  MIDI.nextCueNumber=Math.max(1,MIDI.nextCueNumber);
  saveMIDINextCue();
  return MIDI.nextCueNumber;
}

function findRecordCueButton(){
  const selectors=[
    "#btnRecordCue","#recordCue","#btnRecord",
    '[data-action="record-cue"]',
    '[data-action="recordCue"]',
    '[data-action="record"]',
    "[data-record-cue]",".btn-record-cue"
  ];

  for(const s of selectors){
    const btn=document.querySelector(s);
    if(btn)return btn;
  }

  return [...document.querySelectorAll("button")].find(b=>{
    const t=(b.textContent||"").trim().toLowerCase();
    return t.includes("record cue")||t==="record"||t.includes("record next");
  })||null;
}

function callCueRecorder(number,fadeTime){
  // recordCue(number, name, fadeMs): the fade isn't the name.
  if(typeof window.recordCue==="function")return window.recordCue(number,"",fadeTime==null?undefined:fadeTime)!==false;
  for(const name of ["recordCueAt","recordCue","saveCueAt","saveCue","createCue"]){
    const fn=window[name];
    if(typeof fn!=="function")continue;

    try{
      if(fadeTime!=null){
        try{fn(number,fadeTime);return true}catch(e){}
      }

      try{fn(number);return true}catch(e){}

      try{
        fn({number,cueNumber:number,fadeTime});
        return true;
      }catch(e){}
    }catch(e){}
  }

  return false;
}

function applyFadeTimeToRecordedCue(number,fadeTime){
  if(fadeTime==null)return;

  const list=document.getElementById("cueList");
  if(!list)return;

  const cue=
    list.querySelector(`[data-cue-id="${number}"]`)||
    list.querySelector(`[data-cue-number="${number}"]`);

  if(!cue)return;

  const input=cue.querySelector(
    "[data-fade-time],[name='fadeTime'],[name='fade-time'],input.fade-time,input[data-fade],.fade-time input"
  );

  if(input){
    input.value=String(fadeTime);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  }else{
    cue.dataset.fadeTime=String(fadeTime);
  }
}

function recordMIDICue(number,fadeTime){
  const now=performance.now();

  if(now-MIDI._lastRecordTime<500)return false;
  MIDI._lastRecordTime=now;

  let recorded=callCueRecorder(number,fadeTime);

  if(!recorded){
    const btn=findRecordCueButton();

    if(btn){
      btn.dataset.nextCueNumber=String(number);
      btn.dataset.fadeTime=fadeTime==null?"":String(fadeTime);
      btn.nextCueNumber=number;
      btn.__midiCueNumber=number;

      try{
        btn.click();
        recorded=true;
      }catch(e){}
    }
  }

  if(!recorded){
    midiLog("ERROR: Record Cue function/button not found.");
    return false;
  }

  setTimeout(()=>applyFadeTimeToRecordedCue(number,fadeTime),100);

  MIDI.nextCueNumber=Math.max(MIDI.nextCueNumber,number+1);
  saveMIDINextCue();

  midiLog(`Cue ${number} recorded.`);
  return true;
}

function removeMIDIRecordDialog(){
  document.getElementById("midiRecordCueDialog")?.remove();
}

function openMIDIRecordDialog(defaultNumber){
  removeMIDIRecordDialog();

  const overlay=document.createElement("div");
  overlay.id="midiRecordCueDialog";
  overlay.style.cssText=
    "position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65)";

  const box=document.createElement("div");
  box.style.cssText=
    "width:min(420px,90vw);background:#202020;color:#fff;border-radius:10px;padding:20px;box-sizing:border-box";

  box.innerHTML=`
    <div style="font-size:20px;font-weight:600;margin-bottom:18px">Record Cue</div>
    <label>Cue number</label>
    <input id="midiCueNumberInput" type="number" min="0" step="0.1"
      value="${defaultNumber}" style="width:100%;box-sizing:border-box;padding:10px;margin:6px 0 14px">
    <label>Fade time in seconds <span style="opacity:.6">(optional)</span></label>
    <input id="midiFadeTimeInput" type="number" min="0" step="0.1"
      placeholder="Leave blank for no fade"
      style="width:100%;box-sizing:border-box;padding:10px;margin:6px 0 20px">
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button id="midiRecordCancel" type="button">Cancel</button>
      <button id="midiRecordConfirm" type="button">Record Cue</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const n=document.getElementById("midiCueNumberInput");
  const f=document.getElementById("midiFadeTimeInput");
  const close=()=>removeMIDIRecordDialog();

  document.getElementById("midiRecordCancel").onclick=close;

  overlay.onclick=e=>{
    if(e.target===overlay)close();
  };

  const confirm=()=>{
    const number=Number(n.value);
    if(!Number.isFinite(number)||number<=0){
      n.focus();
      return;
    }

    let fade=null;

    if(f.value.trim()!==""){
      fade=Number(f.value);
      if(!Number.isFinite(fade)||fade<0){
        f.focus();
        return;
      }
    }

    close();
    recordMIDICue(number,fade);
  };

  document.getElementById("midiRecordConfirm").onclick=confirm;

  [n,f].forEach(input=>{
    input.onkeydown=e=>{
      if(e.key==="Enter")confirm();
      if(e.key==="Escape")close();
    };
  });

  setTimeout(()=>{n.focus();n.select()},20);
}

function recordNextMIDICue(){
  openMIDIRecordDialog(getNextCueNumber());
  return true;
}

/* ---------------------------------------------------------
   LEARN UI
--------------------------------------------------------- */

function startMIDILearn(control){
  if(!MIDI.connected){
    midiLog("Cannot learn: no MIDI device connected.");
    return;
  }

  MIDI.learning=control;
  MIDI.buttonState[control]=false;

  midiStatus("Learning: "+control);
  midiLog("Move or press "+control+"...");
  updateMIDILearnUI();
}

function cancelMIDILearn(){
  MIDI.learning=null;
  midiStatus(MIDI.connected?"Connected: "+(MIDI.input?.name||""):"No MIDI device");
  updateMIDILearnUI();
}

function updateMIDILearnUI(){
  document.querySelectorAll("[data-midi-learn]").forEach(btn=>{
    const control=btn.dataset.midiLearn;
    const map=getMIDIMapping(control);

    if(MIDI.learning===control){
      btn.textContent="Move control...";
      btn.classList.add("on");
      return;
    }

    btn.classList.remove("on");

    btn.textContent=map
      ?`CH ${+map.channel+1} ${midiTypeName(+map.type)} ${map.data1}`
      :"Learn";
  });
}

/* ---------------------------------------------------------
   DEVICE / PANEL
--------------------------------------------------------- */

function updateMIDIDeviceList(){
  const sel=document.getElementById("midiDevice");
  if(!sel)return;

  sel.innerHTML="";

  if(!MIDI.inputs.length){
    sel.innerHTML="<option value=''>No MIDI devices detected</option>";
    return;
  }

  MIDI.inputs.forEach(input=>{
    const o=document.createElement("option");
    o.value=input.id;
    o.textContent=input.name||"MIDI Input";
    o.selected=MIDI.input?.id===input.id;
    sel.appendChild(o);
  });
}

function createMIDIPanel(){
  const settings=document.getElementById("page-settings");
  if(!settings||document.getElementById("midiSettingsPanel"))return;

  const panel=document.createElement("section");
  panel.className="panel";
  panel.id="midiSettingsPanel";

  panel.innerHTML=`
    <div class="panel-header"><div><span class="eyebrow">MIDI</span> Control Mapping</div><span class="panel-meta">LEARN</span></div>
    <div class="panel-body">
      <!-- The device picker and status are on the MIDI Controller panel
           (#midiDevice, #midiStatus); this panel is the full mapping list. -->
      <div style="font-size:11px;margin:0 0 12px;color:#7d8987;line-height:1.5">
        <b>Learn</b> links a knob, pad or joystick on your controller; the dropdown sets what it does.
        By default Pad 8 records the next cue, Pad 10 holds position and Pad 11 releases it.
      </div>

      <div id="midiMappings"></div>

      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-secondary" id="midiReset">Reset MIDI Mappings</button>
        <button class="btn-secondary" id="midiInvertJoystick">Invert Joystick Y</button>
      </div>
    </div>
  `;

  settings.appendChild(panel);

  const mappings=document.getElementById("midiMappings");

  MIDI_CONTROLS.forEach(([id,label])=>{
    const row=document.createElement("div");
    row.style.cssText="display:flex;align-items:center;gap:8px;margin-bottom:5px";

    const name=document.createElement("span");
    name.style.width="95px";
    name.textContent=label;

    const select=document.createElement("select");
    select.style.flex="1";

    TARGETS.forEach(([value,text])=>{
      const o=document.createElement("option");
      o.value=value;
      o.textContent=text;
      select.appendChild(o);
    });

    select.value=getMIDITarget(id);

    select.onchange=()=>{
      MIDI.targets[id]=select.value;
      saveMIDIMappings();
    };

    const learn=document.createElement("button");
    learn.className="btn-secondary";
    learn.dataset.midiLearn=id;

    const map=getMIDIMapping(id);
    learn.textContent=map
      ?`CH ${+map.channel+1} ${midiTypeName(+map.type)} ${map.data1}`
      :"Learn";

    learn.onclick=()=>{
      MIDI.learning===id?cancelMIDILearn():startMIDILearn(id);
    };

    row.append(name,select,learn);
    mappings.appendChild(row);
  });

  const device=document.getElementById("midiDevice");

  device.onchange=e=>{
    const input=MIDI.inputs.find(i=>i.id===e.target.value);
    if(input)connectMIDIInput(input);
  };

  const invert=document.getElementById("midiInvertJoystick");

  const updateInvert=()=>{
    invert.textContent=MIDI.joystickInvertY
      ?"Joystick Y: INVERTED"
      :"Joystick Y: NORMAL";
  };

  updateInvert();

  invert.onclick=()=>{
    MIDI.joystickInvertY=!MIDI.joystickInvertY;
    saveJoystickSettings();
    updateInvert();
  };

  document.getElementById("midiReset").onclick=()=>{
    MIDI.mappings={};
    MIDI.targets={};
    MIDI.buttonState={};
    MIDI.learning=null;
    MIDI.nextCueNumber=1;
    MIDI.positionHold=false;
    MIDI.heldPosition=null;

    MIDI.joystick.pan=MIDI.joystick.lastPan=128;
    MIDI.joystick.tilt=MIDI.joystick.lastTilt=128;
    MIDI.joystick.rawX=MIDI.joystick.x=63.5;
    MIDI.joystick.rawY=MIDI.joystick.y=64;

    localStorage.removeItem("midiHeldPosition");

    MIDI_CONTROLS.forEach(([id])=>{
      MIDI.targets[id]=MIDI_DEFAULTS[id]||"none";
    });

    saveMIDIPositionHold();
    saveMIDINextCue();
    saveMIDIMappings();

    document.querySelectorAll("#midiMappings select").forEach((select,i)=>{
      const id=MIDI_CONTROLS[i]?.[0];
      if(id)select.value=MIDI_DEFAULTS[id]||"none";
    });

    midiLog("MIDI mappings reset.");
  };
}

/* ---------------------------------------------------------
   AUTO DETECT / STARTUP
--------------------------------------------------------- */

function midiAutoDetect(){
  if(!MIDI.access)return;

  const current=Array.from(MIDI.access.inputs.values());

  if(
    current.length===MIDI.inputs.length&&
    current.every(i=>MIDI.inputs.some(x=>x.id===i.id&&x.state===i.state))&&
    MIDI.input?.state!=="disconnected"
  )return;

  refreshMIDIInputs();
}

MIDI_CONTROLS.forEach(([id])=>{
  if(!MIDI.targets[id])
    MIDI.targets[id]=MIDI_DEFAULTS[id]||"none";
});

rebuildMIDIMappingLookup();
saveMIDIMappings();

Object.assign(window,{
  MIDI,
  initMIDI,
  startMIDILearn,
  cancelMIDILearn,
  refreshMIDIInputs,
  updateMIDIColour,
  updateMIDIPan,
  updateMIDITilt,
  updateMIDIJoystickX,
  updateMIDIJoystickY,
  recordNextMIDICue,
  holdCurrentMIDIPosition,
  toggleMIDIPositionHold,
  resetMIDIPosition,
  getNextCueNumber,
  getSelectedFixtures,
  getActualCurrentMIDIPosition,
  enforceMIDIPositionHold,
  saveMIDIPositionHold,
  triggerCue,
  triggerGo,
  triggerBlackout,
  executeMIDIControl,
  executeNamedControl,
  getMIDITarget,
  getMIDIMapping
});

document.addEventListener("DOMContentLoaded",()=>{
  createMIDIPanel();
  initMIDI();

  setTimeout(midiAutoDetect,1000);
  setInterval(midiAutoDetect,5000);
  setInterval(enforceMIDIPositionHold,100);
});