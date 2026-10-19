"use strict";
function $(id){return document.getElementById(id)}
if(typeof window.log!=="function")window.log=(msg,type="info")=>console.log(`[${type.toUpperCase()}] ${msg}`);
window.State=window.State||{};
// Fixtures carry a patch universe (1-10, see MAX_UNIVERSES below) but every
// live-control read/write used to go through a single 512-channel State.dmx
// indexed by DMX ADDRESS ALONE, with the universe never factored in. Two
// fixtures on different universes sharing the same address (completely
// normal in any rig over ~25-30 fixtures, since that's roughly how many fit
// in one real 512-channel universe) silently overwrote each other's channel
// data on every updateDMX() — whichever fixture happened to be processed
// last in State.fixtures won. A 200+ fixture rig needs several universes,
// so this was the actual ceiling on "how many fixtures work", not anything
// about rendering: it looked like only a handful of fixtures worked because
// only the ones whose addresses never collided with a later-processed
// fixture were left with correct data by the time DMX was actually sent.
// State.dmx is now one flat buffer covering all MAX_UNIVERSES, addressed as
// (universe-1)*DMX_CHANNELS + (address-1) — see getFixtureBaseAddress below.
const DMX_CHANNELS=512;
const MAX_UNIVERSES=10;
const DMX_TOTAL_CHANNELS=DMX_CHANNELS*MAX_UNIVERSES;
Object.assign(State,{
dmx:State.dmx instanceof Uint8Array&&State.dmx.length===DMX_TOTAL_CHANNELS?State.dmx:new Uint8Array(DMX_TOTAL_CHANNELS),
liveDMX:State.liveDMX instanceof Uint8Array?State.liveDMX:new Uint8Array(512),
fixtures:Array.isArray(State.fixtures)?State.fixtures:[],
cues:Array.isArray(State.cues)?State.cues:[],
chases:Array.isArray(State.chases)?State.chases:[],
fixtureStates:State.fixtureStates instanceof Map?State.fixtureStates:new Map(),
selected:State.selected instanceof Set?State.selected:new Set(),
groups:Array.isArray(State.groups)?State.groups:[],
blackout:Boolean(State.blackout),
current:{
hue:0,sat:100,light:50,intensity:100,master:100,
pan:128,tilt:128,strobe:0,gobo:0,gobo2:0,gobor:0,gobo2r:0,
prism:0,prismr:0,focus:0,zoom:0,frost:0,iris:0,rot:0,effect:0,
speed:0,macro:0,preset:0,shake:0,mode:0,zone:0,fog:0,fana:0,haze:0,fluid:0,colmacro:0,
...(State.current||{})
},
Viz:State.Viz||{scene:null,camera:null,renderer:null,controls:null,fixtures:[]}
});
if(State.chaseFade==null)State.chaseFade=800;
if(State.chaseWait==null)State.chaseWait=500;
let visualizerWindow=null,ws=null,reconnectTimer=null;

function cloneState(state){
return typeof cloneFixtureState==="function"?cloneFixtureState(state):{...(state||{})};
}
function fixtureState(id){
if(!(State.fixtureStates instanceof Map))State.fixtureStates=new Map();
if(!State.fixtureStates.has(id)){
State.fixtureStates.set(id,typeof createFixtureState==="function"?createFixtureState(State.current):{...State.current});
}
return State.fixtureStates.get(id);
}
function initialiseFixtureState(f){
if(!f?.id)return;
if(!State.fixtureStates.has(f.id))State.fixtureStates.set(f.id,cloneState(State.current));
}
window.initFixtureStates=()=>{
if(!(State.fixtureStates instanceof Map))State.fixtureStates=new Map();
State.fixtures.forEach(initialiseFixtureState);
};
window.ensureFixtureState=fixtureState;

window.connectVisualizer=()=>{
if(visualizerWindow&&!visualizerWindow.closed){visualizerWindow.focus();sendToVisualizer();return;}
visualizerWindow=window.open("visualizer.html","visualizer","width=1440,height=900");
if(!visualizerWindow)console.error("Visualizer popup blocked");
};
window.sendToVisualizer=()=>{
if(!visualizerWindow||visualizerWindow.closed)return;
visualizerWindow.postMessage({type:"SYNC_FIXTURES",fixtures:Array.isArray(State.fixtures)?State.fixtures:[],fixtureLibrary:window.FixtureLibrary||{}},"*");
sendVisualizerDMX();
};
// At most one frame every 25ms, and only when something changed.
let lastVisualizerDMX=null,visualizerDMXTimer=null;
function sendVisualizerDMX(){
if(!visualizerWindow||visualizerWindow.closed||visualizerDMXTimer)return;
visualizerDMXTimer=setTimeout(()=>{
visualizerDMXTimer=null;
if(!visualizerWindow||visualizerWindow.closed)return;
const dmx=State.dmx;
if(lastVisualizerDMX&&lastVisualizerDMX.length===dmx.length&&lastVisualizerDMX.every((v,i)=>v===dmx[i]))return;
lastVisualizerDMX=dmx.slice();
visualizerWindow.postMessage({type:"DMX_UPDATE",dmx:lastVisualizerDMX.slice()},"*");
},25);
}
window.addEventListener("message",e=>{
if(e.data?.type==="VISUALIZER_READY"){visualizerWindow=e.source;window.visualizerWindow=e.source;lastVisualizerDMX=null;sendToVisualizer();}
});

function connectArtNet(){
clearTimeout(reconnectTimer);
try{
ws=new WebSocket("ws://localhost:8081");
ws.binaryType="arraybuffer";
ws.onopen=()=>{console.log("WebSocket connected");ArtNet.start();};
ws.onclose=()=>{console.warn("Art-Net relay disconnected");ArtNet.stop();reconnectTimer=setTimeout(connectArtNet,2000);};
ws.onerror=e=>console.error("WebSocket error:",e);
ws.onmessage=e=>{
if(!(e.data instanceof ArrayBuffer))return;
const p=new Uint8Array(e.data);
if(p.length<18||p[0]!==0x41||p[1]!==0x72||p[2]!==0x74||p[3]!==0x2d)return;
const len=Math.min((p[16]<<8)|p[17],512);
State.liveDMX.fill(0);
State.liveDMX.set(p.subarray(18,18+len));
updateVisualizerFromDMX();
};
}catch(e){console.error("WebSocket failed:",e);reconnectTimer=setTimeout(connectArtNet,2000);}
}

function hslToRgb(h,s,l){
h=((h%360)+360)%360/60;
s=Math.max(0,Math.min(100,s))/100;
l=Math.max(0,Math.min(100,l))/100;
if(!s){const v=Math.round(l*255);return[v,v,v];}
const c=(1-Math.abs(2*l-1))*s;
const x=c*(1-Math.abs(h%2-1));
const m=l-c/2;
let r=0,g=0,b=0;
if(h<1)[r,g]=[c,x];
else if(h<2)[r,g]=[x,c];
else if(h<3)[g,b]=[c,x];
else if(h<4)[g,b]=[x,c];
else if(h<5)[r,b]=[c,x];
else[r,b]=[c,x];
return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}

const ArtNet={
universe:0,enabled:false,sequence:0,timer:null,fps:25,
makePacket(data,u=0){
data=data instanceof Uint8Array?data:new Uint8Array(512);
const len=Math.max(2,Math.min(512,data.length));
const p=new Uint8Array(18+len);
p.set([0x41,0x72,0x74,0x2d,0x4e,0x65,0x74,0],0);
p[8]=0;p[9]=0x50;p[10]=0;p[11]=0x0e;
p[12]=this.sequence;this.sequence=(this.sequence+1)&255;
p[13]=0;p[14]=u&255;p[15]=(u>>8)&255;
p[16]=(len>>8)&255;p[17]=len&255;
p.set(data.subarray(0,len),18);
return p;
},
send(){
// this.universe is 0-based Art-Net wire numbering; patch universes (fixture.uni)
// are 1-based, so wire universe N is State.dmx's (N+1)th 512-channel segment —
// State.dmx now covers every patch universe end-to-end, not just one.
if(this.enabled&&ws?.readyState===WebSocket.OPEN){
const start=this.universe*DMX_CHANNELS;
ws.send(this.makePacket(State.dmx.subarray(start,start+DMX_CHANNELS),this.universe));
}
sendVisualizerDMX();
},
start(){
if(this.enabled)return;this.enabled=true;clearInterval(this.timer);
this.timer=setInterval(()=>this.send(),1000/this.fps);this.send();
console.log("Art-Net output enabled");
},
stop(){this.enabled=false;clearInterval(this.timer);this.timer=null;}
};
window.ArtNet=ArtNet;

function setDMX(channel,value){
const ch=Number(channel);
if(!Number.isFinite(ch)||ch<0||ch>=State.dmx.length)return;
State.dmx[ch]=Math.max(0,Math.min(255,Math.round(Number(value)||0)));
}

function getFixtureDefinition(fixture){
if(!fixture)return null;
if(fixture.map&&typeof fixture.map==="object")return fixture;
if(fixture.definition&&typeof fixture.definition==="object")return fixture.definition;
if(fixture.fixture&&typeof fixture.fixture==="object")return fixture.fixture;
const lib=window.FixtureLibrary&&typeof window.FixtureLibrary==="object"?window.FixtureLibrary:{};
const name=fixture.name??fixture.fixtureName??fixture.type??fixture.model;
if(!name)return null;
if(lib[name])return lib[name];
const key=Object.keys(lib).find(k=>k.toLowerCase()===String(name).toLowerCase());
return key?lib[key]:null;
}

// 0-based address WITHIN a single 512-channel universe (ignores which
// universe the fixture is patched on) — this is what real DMX/Art-Net/sACN
// output needs per-universe, and what the patch UI validates against.
function getFixtureLocalAddress(fixture){
if(!fixture)return-1;
const n=Number(fixture.addr??fixture.address??fixture.startAddress??fixture.start??fixture.channel);
return Number.isFinite(n)&&n>=1&&n<=DMX_CHANNELS?n-1:-1;
}

function getFixtureUniverse(fixture){
const n=Number(fixture?.uni??fixture?.universe??1);
return Number.isInteger(n)&&n>=1&&n<=MAX_UNIVERSES?n:1;
}

// Global 0-based index into State.dmx (which now spans every patch universe
// end-to-end) — see the DMX_TOTAL_CHANNELS comment above for why the
// universe has to be folded in here rather than just using the address.
function getFixtureBaseAddress(fixture){
const local=getFixtureLocalAddress(fixture);
if(local<0)return-1;
return(getFixtureUniverse(fixture)-1)*DMX_CHANNELS+local;
}
window.getFixtureLocalAddress=getFixtureLocalAddress;
window.getFixtureUniverse=getFixtureUniverse;
window.getFixtureBaseAddress=getFixtureBaseAddress;

function writeFixtureChannel(base,mapValue,value){
if(typeof mapValue!=="number")return;
const ch=base+mapValue;
if(ch>=0&&ch<State.dmx.length)setDMX(ch,value);
}

function updateDMX(){
// Captured fixtures go back on their target first, whatever moved them (js/target.js).
try{window.Targets?.enforce?.();}catch(error){console.warn("[TARGET] enforce failed",error);}
State.dmx.fill(0);
if(!Array.isArray(State.fixtures)||!State.fixtures.length){ArtNet.send();return;}
initFixtureStates();

const clamp255=v=>Math.max(0,Math.min(255,Math.round(Number(v)||0)));
const clamp100=v=>Math.max(0,Math.min(100,Number(v)||0));
const normaliseHue=h=>{h=Number(h);if(!Number.isFinite(h))h=0;h%=360;if(h<0)h+=360;return h;};
const blackout=Boolean(State.blackout);

function colourHSL(h,s,l){
h=normaliseHue(h);s=clamp100(s)/100;l=clamp100(l)/100;
if(s===0){const v=Math.round(l*255);return[v,v,v];}
const hh=h/60,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hh%2)-1)),m=l-c/2;
let r=0,g=0,b=0;
if(hh<1){r=c;g=x;}else if(hh<2){r=x;g=c;}else if(hh<3){g=c;b=x;}
else if(hh<4){g=x;b=c;}else if(hh<5){r=x;b=c;}else{r=c;b=x;}
return[clamp255((r+m)*255),clamp255((g+m)*255),clamp255((b+m)*255)];
}

function colourWheelDMX(def,hue,sat){
    const wheel=getColourWheel(def);
    if(!wheel.length) return clamp255((normaliseHue(hue)/360)*255);
    if(Number(sat)<5){
        const white=wheel.find(s=>Array.isArray(s.rgb)&&s.rgb[0]===1&&s.rgb[1]===1&&s.rgb[2]===1);
        if(white) return clamp255((white.min+white.max)/2);
    }
    const target=normaliseHue(hue);
    let best=wheel[0], bestDist=Infinity;
    wheel.forEach(s=>{
        if(typeof s.hue==="undefined") return;
        const slotH=normaliseHue(s.hue);
        let d=Math.abs(target-slotH);
        d=Math.min(d,360-d);
        if(d<bestDist){bestDist=d; best=s;}
    });
    return clamp255((best.min+best.max)/2);
}

function write(base,ch,v){if(!Number.isInteger(ch))return;const a=base+ch;if(a>=0&&a<State.dmx.length)State.dmx[a]=clamp255(v);}

State.fixtures.forEach(fixture=>{
if(!fixture)return;
const def=getFixtureDefinition(fixture);if(!def)return;
const map=def.map||{};const base=getFixtureBaseAddress(fixture);if(base<0)return;
const saved=fixtureState(fixture.id)||State.current||{};

// No master dimmer: intensity alone sets the level (an old "master" value
// left in a show, e.g. 0 after Clear, must not hold a light dark).
const master=1;
const intensity=clamp100(saved.intensity??100)/100;
const level=blackout?0:master*intensity;

const hue=normaliseHue(saved.hue??0),sat=clamp100(saved.sat??100),light=clamp100(saved.light??50);

if(typeof map.dimmer==="number")write(base,map.dimmer,255*level);

// Tunable-white fixtures such as the Showtec Performer 1500 Fresnel Tungsten 8ch.
// warmWhite/naturalWhite/coolWhite are independent LED-array output levels set
// by the Fresnel controls card (js/fresnel-controls.js), not a copy of the
// master dimmer — the fixture's own separate dimmer/intensity channel above
// already carries master*intensity, so these are only ever zeroed by blackout.
const hasWhite=typeof map.warmWhite==="number"||typeof map.naturalWhite==="number"||typeof map.coolWhite==="number";
if(hasWhite){
if(typeof map.warmWhite==="number")write(base,map.warmWhite,blackout?0:(saved.warmWhite??255));
if(typeof map.warmWhiteFine==="number")write(base,map.warmWhiteFine,0);
if(typeof map.naturalWhite==="number")write(base,map.naturalWhite,blackout?0:(saved.naturalWhite??0));
if(typeof map.naturalWhiteFine==="number")write(base,map.naturalWhiteFine,0);
if(typeof map.coolWhite==="number")write(base,map.coolWhite,blackout?0:(saved.coolWhite??0));
if(typeof map.cct==="number")write(base,map.cct,blackout?0:clamp255(saved.cct??State.current?.cct??0));
}

const hasRGB=typeof map.r==="number"&&typeof map.g==="number"&&typeof map.b==="number";
if(hasRGB){
const rgb=blackout?[0,0,0]:colourHSL(hue,sat,light);
// A fixture with its own dimmer takes the level there; its colour channels
// stay at full colour (scaling both would give 10% x 10% = 1% at 10%).
// Fixtures without one can only dim through their colour channels.
const colourLevel=typeof map.dimmer==="number"?(blackout?0:1):level;
write(base,map.r,rgb[0]*colourLevel);
write(base,map.g,rgb[1]*colourLevel);
write(base,map.b,rgb[2]*colourLevel);
if(typeof map.w==="number")write(base,map.w,blackout?0:(saved.w??saved.white??0)*colourLevel);
}else if(typeof map.colour==="number"){
// A fixture with real CMY (cyan/magenta/yellow all present) skips the
// wheel channel entirely rather than writing any computed value to it
// — not even a constant "open" placeholder (an earlier version wrote
// one; even that turned out to visibly interfere in Capture). This
// app's colour control for such a fixture is exclusively cyan/magenta/
// yellow below; channel 5 is left untouched (defaults to 0 from the
// State.dmx.fill(0) at the top of this function) rather than driven
// by this generic wheel logic at all.
const hasCMYPrimary=typeof map.cyan==="number"&&typeof map.magenta==="number"&&typeof map.yellow==="number";
if(!hasCMYPrimary){
const wVal=blackout?0:colourWheelDMX(def,hue,sat);
write(base,map.colour,wVal);
if(typeof map.colourr==="number")write(base,map.colourr,blackout?0:clamp255(saved.colourr??0));
}
}

// Extra colour-mixing channels some fixtures carry independently of
// the primary RGB/colour-wheel model above (RGBA/RGBAL/RGBALC extra
// diodes, or pure CMY+CTO dichroic mixing with no RGB channels at
// all) — each is only ever zeroed by blackout, driven straight from
// its own control rather than the primary colour model.
if(typeof map.amber==="number")write(base,map.amber,blackout?0:clamp255(saved.amber??0));
if(typeof map.lime==="number")write(base,map.lime,blackout?0:clamp255(saved.lime??0));
if(typeof map.cyan==="number")write(base,map.cyan,blackout?0:clamp255(saved.cyan??0));
if(typeof map.uv==="number")write(base,map.uv,blackout?0:clamp255(saved.uv??0));
if(typeof map.magenta==="number")write(base,map.magenta,blackout?0:clamp255(saved.magenta??0));
if(typeof map.yellow==="number")write(base,map.yellow,blackout?0:clamp255(saved.yellow??0));
if(typeof map.cto==="number")write(base,map.cto,blackout?0:clamp255(saved.cto??0));

["strobe","gobo","gobo2","gobor","gobo2r","prism","prismr","focus","zoom","frost","iris","rot","effect","speed","macro","preset","shake","mode","zone","fog","fana","haze","fluid","colmacro","shutter1Insert","shutter1Rotate","shutter2Insert","shutter2Rotate","shutter3Insert","shutter3Rotate","shutter4Insert","shutter4Rotate","shutter1AngleA","shutter1AngleB","shutter2AngleA","shutter2AngleB","shutter3AngleA","shutter3AngleB","shutter4AngleA","shutter4AngleB"].forEach(k=>{if(typeof map[k]==="number")write(base,map[k],saved[k]??0);});

// Fixtures whose shutter and strobe share a channel (e.g. Robe) treat low
// values as SHUTTER CLOSED. The console's strobe 0 means "open, no strobe", so
// translate: 0 → open (32), 1-255 → strobe slow→fast (64-95).
if(typeof map.shutter==="number"&&map.shutter===map.strobe){const strobe=Math.max(0,Math.min(255,Number(saved.strobe)||0));write(base,map.strobe,blackout?0:strobe===0?32:64+Math.round((strobe/255)*31));}

if(typeof map.pan==="number"){write(base,map.pan,saved.pan??128);if(typeof map.panf==="number")write(base,map.panf,saved.panf??0);}
if(typeof map.tilt==="number"){write(base,map.tilt,saved.tilt??128);if(typeof map.tiltf==="number")write(base,map.tiltf,saved.tiltf??0);}
});
ArtNet.send();
}

// Each running fade registers how to jump to its end. finishFade() uses that so
// recording right after a change stores the new look, not a half-faded one.
let fadeFinisher=null;
window.trackFade=(id,finish)=>{fadeFinisher={id,finish};return id;};
window.finishFade=()=>{
if(State.fading==null||fadeFinisher?.id!==State.fading)return;
const {finish}=fadeFinisher;fadeFinisher=null;
LXClock.cancel(State.fading);State.fading=null;finish();
};
function fadeTo(target,duration=1000,targetFixtureStates=null){
if(State.fading){LXClock.cancel(State.fading);State.fading=null;}
const startG={...State.current},startF=new Map();
State.fixtureStates.forEach((v,id)=>startF.set(id,cloneState(v)));
const tgts=Array.isArray(targetFixtureStates)?targetFixtureStates:null;
if(duration<=0){Object.assign(State.current,target||{});tgts?.forEach(([id,s])=>State.fixtureStates.set(id,cloneState(s)));updateDMX();return;}
const start=performance.now();
const finish=()=>{Object.assign(State.current,target||{});tgts?.forEach(([id,s])=>State.fixtureStates.set(id,cloneState(s)));updateDMX();};
function tick(now){
const p=Math.min(1,(now-start)/duration),e=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
Object.keys(target||{}).forEach(k=>{if(typeof target[k]==="number"&&typeof startG[k]==="number")State.current[k]=startG[k]+(target[k]-startG[k])*e;});
tgts?.forEach(([id,tFx])=>{const sFx=startF.get(id)||cloneState(tFx),cFx=cloneState(sFx);Object.keys(tFx).forEach(k=>{if(typeof tFx[k]==="number"&&typeof sFx[k]==="number")cFx[k]=sFx[k]+(tFx[k]-sFx[k])*e;});State.fixtureStates.set(id,cFx);});
updateDMX();
if(p<1)State.fading=trackFade(LXClock.frame(tick),finish);else{Object.assign(State.current,target||{});tgts?.forEach(([id,s])=>State.fixtureStates.set(id,cloneState(s)));State.fading=null;updateDMX();}
}
State.fading=trackFade(LXClock.frame(tick),finish);
}
window.fadeTo=fadeTo;

function updateVisualizerFromDMX(){
const live=State.liveDMX;
if(!State.Viz||!Array.isArray(State.Viz.fixtures)||!live||typeof live.length!=="number")return;
State.Viz.fixtures.forEach(fv=>{
const fx=fv.fx;if(!fx)return;
const base=getFixtureBaseAddress(fx);if(!Number.isInteger(base)||base<0)return;
const def=getFixtureDefinition(fx);if(!def||!def.map)return;
const map=def.map;
const read=k=>{const o=map[k];if(!Number.isInteger(o))return null;const i=base+o;if(i<0||i>=live.length)return null;const v=Number(live[i]);return Number.isFinite(v)?Math.max(0,Math.min(255,v)):null;};

let dim=1;
if(Number.isInteger(map.dimmer))dim=read("dimmer")/255;
else if(Number.isInteger(map.intensity))dim=read("intensity")/255;
dim=Math.max(0,Math.min(1,dim));

let r=1,g=1,b=1;
const hasRGB=Number.isInteger(map.r)&&Number.isInteger(map.g)&&Number.isInteger(map.b);
const hasWheel=Number.isInteger(map.colour);

if(hasRGB){
r=read("r")/255;g=read("g")/255;b=read("b")/255;
if(Number.isInteger(map.w)){const w=read("w")/255;r=Math.min(1,r+w);g=Math.min(1,g+w);b=Math.min(1,b+w);}
}else if(hasWheel){
const cVal=read("colour");const wheel=getColourWheel(def);const col=colourWheelToRGB(cVal,wheel);r=col[0];g=col[1];b=col[2];
}

r=Math.max(0,Math.min(1,Number(r)||0));g=Math.max(0,Math.min(1,Number(g)||0));b=Math.max(0,Math.min(1,Number(b)||0));

if(fv.spot){
  fv.spot.color.setRGB(r,g,b);
  fv.spot.intensity=dim*8;
  const zoomVal=read("zoom");
  if(zoomVal!==null) fv.spot.angle=0.1 + (zoomVal/255)*1.05;
  const focusVal=read("focus");
  if(focusVal!==null) fv.spot.penumbra=0.25 + (focusVal/255)*0.65;
}
if(fv.bulb){const m=fv.bulb.material;if(m&&m.color)m.color.setRGB(r,g,b);if(m&&m.emissive)m.emissive.setRGB(r,g,b);if(m)m.emissiveIntensity=dim*5;}

if(fv.group){
if(Number.isInteger(map.pan)){let pan=read("pan");if(Number.isInteger(map.panf))pan=read("pan")*256+read("panf");const pan16=Number.isInteger(map.panf)?pan/65535:pan/255;fv.group.rotation.y=(pan16-.5)*Math.PI;}
if(Number.isInteger(map.tilt)){let tilt=read("tilt");if(Number.isInteger(map.tiltf))tilt=read("tilt")*256+read("tiltf");const tilt16=Number.isInteger(map.tiltf)?tilt/65535:tilt/255;fv.group.rotation.x=(tilt16-.5)*Math.PI*.6;}
}
});
}
window.updateVisualizerFromDMX=updateVisualizerFromDMX;

function getColourWheel(def){
if(def&&Array.isArray(def.colourWheel)&&def.colourWheel.length)return def.colourWheel;
return[
{min:0,max:20,rgb:[1,1,1],hue:0},
{min:21,max:40,rgb:[1,0,0],hue:0},
{min:41,max:60,rgb:[1,.5,0],hue:30},
{min:61,max:80,rgb:[1,1,0],hue:60},
{min:81,max:100,rgb:[0,1,0],hue:120},
{min:101,max:120,rgb:[0,1,1],hue:180},
{min:121,max:140,rgb:[0,0,1],hue:240},
{min:141,max:160,rgb:[.5,0,1],hue:270},
{min:161,max:180,rgb:[1,0,1],hue:300},
{min:181,max:255,rgb:[1,1,1],hue:0}
];
}

function colourWheelToRGB(val,wheel){
val=Number(val);if(!Number.isFinite(val))val=0;val=Math.max(0,Math.min(255,val));
if(!Array.isArray(wheel))return[1,1,1];
const slot=wheel.find(i=>{if(!i)return false;const mn=Number(i.min),mx=Number(i.max);return Number.isFinite(mn)&&Number.isFinite(mx)&&val>=mn&&val<=mx;});
if(!slot||!Array.isArray(slot.rgb))return[1,1,1];
return[Math.max(0,Math.min(1,Number(slot.rgb[0])||0)),Math.max(0,Math.min(1,Number(slot.rgb[1])||0)),Math.max(0,Math.min(1,Number(slot.rgb[2])||0))];
}

function installBlackoutGuard(){
if(window.__blackoutGuardInstalled)return;
window.__blackoutGuardInstalled=true;
const originalParseCommand=window.parseCommand;
if(typeof originalParseCommand==="function"){
window.parseCommand=function(command){
const c=String(command??"").toLowerCase().trim();
if(c==="blackout")State.blackout=true;
else if(/^(full|all|all 25|all 50|all half|all 75)$/.test(c))State.blackout=false;
const result=originalParseCommand.apply(this,arguments);
updateDMX();
return result;
};
}
document.addEventListener("click",event=>{
const button=event.target?.closest?.("[data-action],[data-v]");
if(!button)return;
const action=String(button.dataset.action||"").toLowerCase();
if(action==="blackout")State.blackout=true;
if(action==="full")State.blackout=false;
updateDMX();
},true);
}
window.setBlackout=function(enabled){
State.blackout=Boolean(enabled);
updateDMX();
return State.blackout;
};

window.testArtNet=()=>{State.dmx.fill(0);State.dmx.set([255,255,255,255],0);ArtNet.send();};
document.addEventListener("DOMContentLoaded",()=>{console.log("DMX controller starting...");initFixtureStates();connectArtNet();installBlackoutGuard();});

// Multi-universe output: the console supports up to 10 patched DMX universes.
// Fixture patch universes are 1-10. Art-Net uses 0-9 on the wire, while sACN
// uses 1-10. The existing single 512-channel State.dmx remains the programmer
// buffer; this routing layer copies each fixture's channels into its universe.
(() => {
  const activeUniverses = new Set();

  function universeForFixture(fixture) {
    const n = Number(fixture?.uni ?? fixture?.universe ?? 1);
    return Number.isInteger(n) && n >= 1 && n <= MAX_UNIVERSES ? n : null;
  }

  function channelsForFixture(fixture) {
    const def = getFixtureDefinition(fixture);
    const n = Number(def?.channels ?? def?.channelCount ?? 1);
    return Number.isInteger(n) && n > 0 ? Math.min(n, DMX_CHANNELS) : 1;
  }

  function buildUniverseBuffers() {
    const buffers = new Map();
    const fixtures = Array.isArray(State.fixtures) ? State.fixtures : [];
    const source = State.dmx instanceof Uint8Array ? State.dmx : new Uint8Array(DMX_TOTAL_CHANNELS);

    fixtures.forEach(fixture => {
      const universe = universeForFixture(fixture);
      // globalBase indexes the full multi-universe source buffer;
      // localBase (0-511) is this fixture's position within its OWN
      // universe's own wire frame — they only coincide for universe 1,
      // so both are needed here, not just one "base".
      const globalBase = getFixtureBaseAddress(fixture);
      const localBase = getFixtureLocalAddress(fixture);
      if (universe == null || globalBase < 0 || localBase < 0) return;
      if (!buffers.has(universe)) buffers.set(universe, new Uint8Array(DMX_CHANNELS));
      const target = buffers.get(universe);
      const end = Math.min(DMX_CHANNELS, localBase + channelsForFixture(fixture));
      for (let i = localBase, g = globalBase; i < end; i++, g++) target[i] = source[g];
    });

    return buffers;
  }

  function protocolUniverse(consoleUniverse) {
    const protocol = String(window.DMXOutputProtocol || window.ArtNet?.outputProtocol || "artnet").toLowerCase();
    return protocol === "sacn" ? consoleUniverse : consoleUniverse - 1;
  }

  function sendUniverse(universe, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "DMX_UPDATE",
      universe: protocolUniverse(universe),
      dmx: Array.from(data)
    }));
  }

  function installMultiUniverse() {
    if (!window.ArtNet || window.ArtNet.__multiUniverseInstalled) return;
    window.ArtNet.__multiUniverseInstalled = true;
    window.DMXUniverses = { max: MAX_UNIVERSES, channels: DMX_CHANNELS };

    const originalSend = window.ArtNet.send.bind(window.ArtNet);
    window.ArtNet.send = function multiUniverseSend() {
      const buffers = buildUniverseBuffers();
      const next = new Set(buffers.keys());

      activeUniverses.forEach(universe => {
        if (!next.has(universe)) sendUniverse(universe, new Uint8Array(DMX_CHANNELS));
      });

      if (!buffers.size) {
        originalSend();
        activeUniverses.clear();
        return;
      }

      buffers.forEach((data, universe) => sendUniverse(universe, data));
      activeUniverses.clear();
      next.forEach(universe => activeUniverses.add(universe));
      sendVisualizerDMX();
    };

    const patchUniverse = $("patchUni");
    if (patchUniverse) {
      patchUniverse.min = "1";
      patchUniverse.max = String(MAX_UNIVERSES);
      patchUniverse.step = "1";
      if (Number(patchUniverse.value) < 1 || Number(patchUniverse.value) > MAX_UNIVERSES) patchUniverse.value = "1";
    }

    console.log(`🌐 Multi-universe DMX enabled: ${MAX_UNIVERSES} universes × ${DMX_CHANNELS} channels`);
  }

  if (window.ArtNet) installMultiUniverse();
  else document.addEventListener("DOMContentLoaded", installMultiUniverse, { once: true });
})();
