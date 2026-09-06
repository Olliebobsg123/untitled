"use strict";

// ==============================================
// SUGGESTIONS / BUG REPORTS + CUSTOM FIXTURE EDITOR
// ==============================================
(function installFeedbackCommands() {
  const addStyles = () => {
    if (document.getElementById("lxFeedbackStyles")) return;
    const style = document.createElement("style");
    style.id = "lxFeedbackStyles";
    style.textContent = `
      #lxFeedbackModal,#lxFixtureEditorModal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);z-index:100000;padding:20px;box-sizing:border-box}
      #lxFeedbackModal.is-open,#lxFixtureEditorModal.is-open{display:flex}
      #lxFeedbackModal .lx-feedback-box,#lxFixtureEditorModal .lx-fixture-box{width:min(760px,100%);max-height:90vh;overflow:auto;background:#0b1012;border:1px solid #2a373b;box-shadow:0 24px 80px rgba(0,0,0,.55);padding:22px;box-sizing:border-box;color:#eef4f2;font-family:Inter,"Segoe UI",system-ui,sans-serif}
      #lxFeedbackModal .lx-feedback-kicker,#lxFixtureEditorModal .lx-fixture-kicker{color:#19d6a3;font:900 9px/1 var(--mono,monospace);letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px}
      #lxFeedbackModal h3,#lxFixtureEditorModal h3{margin:0 0 7px;font-size:20px}
      #lxFeedbackModal p,#lxFixtureEditorModal p{margin:0 0 16px;color:#879693;font-size:12px}
      #lxFeedbackModal textarea{width:100%;min-height:170px;resize:vertical;box-sizing:border-box;background:#070a0b;border:1px solid #2a373b;color:#eef4f2;padding:12px;outline:none;font:700 12px/1.5 var(--mono,monospace)}
      #lxFeedbackModal textarea:focus,#lxFixtureEditorModal input:focus,#lxFixtureEditorModal select:focus{border-color:#19d6a3}
      #lxFeedbackModal .lx-feedback-actions,#lxFixtureEditorModal .lx-fixture-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:13px;flex-wrap:wrap}
      #lxFeedbackModal button,#lxFixtureEditorModal button{border:1px solid #2a373b;background:#11191c;color:#eef4f2;padding:9px 14px;cursor:pointer;font:900 10px/1 var(--mono,monospace);text-transform:uppercase}
      #lxFeedbackModal button:hover,#lxFixtureEditorModal button:hover{background:#172124}
      #lxFeedbackModal .lx-feedback-send,#lxFixtureEditorModal .lx-fixture-save{background:#19d6a3;color:#06110d;border-color:#19d6a3}
      #lxFeedbackModal .lx-feedback-status,#lxFixtureEditorModal .lx-fixture-status{min-height:16px;margin-top:9px;color:#879693;font:700 10px/1.4 var(--mono,monospace)}
      #lxFixtureEditorModal .lx-fixture-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      #lxFixtureEditorModal .lx-fixture-row{display:flex;gap:8px;align-items:center;margin-bottom:7px}
      #lxFixtureEditorModal .lx-fixture-row input,#lxFixtureEditorModal .lx-fixture-row select,#lxFixtureEditorModal .lx-fixture-grid input,#lxFixtureEditorModal .lx-fixture-grid select{width:100%;box-sizing:border-box;background:#070a0b;border:1px solid #2a373b;color:#eef4f2;padding:9px;outline:none}
      #lxFixtureEditorModal label{display:block;color:#879693;font:800 9px/1 var(--mono,monospace);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
      #lxFixtureEditorModal .lx-channel-list{margin-top:10px;border-top:1px solid #202b2e;padding-top:10px}
      #lxFixtureEditorModal .lx-channel-head{display:grid;grid-template-columns:70px 1fr 38px;gap:8px;color:#687875;font:800 9px var(--mono,monospace);text-transform:uppercase;margin-bottom:6px}
      #lxFixtureEditorModal .lx-channel-row{display:grid;grid-template-columns:70px 1fr 38px;gap:8px;margin-bottom:6px}
      #lxFixtureEditorModal .lx-channel-row button{padding:0;width:38px;height:34px}
      #lxFixtureEditorModal .lx-library-list{margin-top:12px;border-top:1px solid #202b2e;padding-top:10px}
      #lxFixtureEditorModal .lx-custom-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px;border:1px solid #202b2e;margin-bottom:6px;background:#0e1517}
      #lxFixtureEditorModal .lx-custom-meta{color:#687875;font-size:10px}
      @media(max-width:650px){#lxFixtureEditorModal .lx-fixture-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  };

  function ensureFeedbackModal() {
    addStyles();
    let modal = document.getElementById("lxFeedbackModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "lxFeedbackModal";
    modal.innerHTML = `<div class="lx-feedback-box" role="dialog" aria-modal="true"><div class="lx-feedback-kicker" id="lxFeedbackKicker">FEEDBACK</div><h3 id="lxFeedbackTitle">Send feedback</h3><p id="lxFeedbackHelp">Tell us what you would like to report or suggest.</p><textarea id="lxFeedbackText" placeholder="Type your message here..."></textarea><div class="lx-feedback-status" id="lxFeedbackStatus"></div><div class="lx-feedback-actions"><button type="button" id="lxFeedbackCancel">Cancel</button><button type="button" id="lxFeedbackSend" class="lx-feedback-send">Send</button></div></div>`;
    document.body.appendChild(modal);
    const close=()=>{modal.classList.remove("is-open");const t=document.getElementById("lxFeedbackText");if(t)t.value="";};
    document.getElementById("lxFeedbackCancel")?.addEventListener("click",close);
    modal.addEventListener("click",e=>{if(e.target===modal)close();});
    document.getElementById("lxFeedbackText")?.addEventListener("keydown",e=>{if(e.key==="Escape")close();if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();submitFeedback();}});
    document.getElementById("lxFeedbackSend")?.addEventListener("click",submitFeedback);
    return modal;
  }

  let currentType="suggestion";
  function openFeedback(type){
    const modal=ensureFeedbackModal();currentType=type==="bug"?"bug":"suggestion";
    const k=document.getElementById("lxFeedbackKicker"),t=document.getElementById("lxFeedbackTitle"),h=document.getElementById("lxFeedbackHelp"),x=document.getElementById("lxFeedbackText"),s=document.getElementById("lxFeedbackStatus");
    if(currentType==="bug"){if(k)k.textContent="BUG REPORT";if(t)t.textContent="Report a bug";if(h)h.textContent="Describe what went wrong and what you expected to happen.";if(x)x.placeholder="What happened? What were you trying to do?";}else{if(k)k.textContent="SUGGESTION";if(t)t.textContent="Send a suggestion";if(h)h.textContent="Tell us what you would like to see added or changed.";if(x)x.placeholder="What would you like to suggest?";}
    if(s)s.textContent="";modal.classList.add("is-open");setTimeout(()=>x?.focus(),0);
  }

  async function submitFeedback(){
    const text=String(document.getElementById("lxFeedbackText")?.value||"").trim(),status=document.getElementById("lxFeedbackStatus"),send=document.getElementById("lxFeedbackSend");
    if(!text){if(status)status.textContent="Please enter a message first.";return;}
    if(send){send.disabled=true;send.textContent="Sending...";}if(status)status.textContent="Sending feedback...";
    try{
      if(!window.LXFeedbackMail||typeof window.LXFeedbackMail.send!=="function")throw new Error("The desktop email bridge is not available. Restart the app after updating it.");
      const result=await window.LXFeedbackMail.send({message:text,type:currentType==="bug"?"Bug Report":"Suggestion"});
      console.log("[FEEDBACK] Email bridge response:",result);if(!result?.success)throw new Error(result?.message||"Email service rejected the message");
      if(status)status.textContent="Sent successfully — check your email.";if(typeof window.log==="function")window.log(`${currentType==="bug"?"Bug Report":"Suggestion"} sent`,"ok");
      setTimeout(()=>document.getElementById("lxFeedbackModal")?.classList.remove("is-open"),1200);
    }catch(error){console.error("[FEEDBACK] Send failed:",error);if(status)status.textContent=`Could not send: ${error?.message||"email service error"}`;if(typeof window.log==="function")window.log("Feedback could not be sent","error");}
    finally{if(send){send.disabled=false;send.textContent="Send";}}
  }

  const STORE="lx-custom-fixtures";
  const clone=v=>{if(v===null||v===undefined||typeof v!=="object")return v;if(Array.isArray(v))return v.map(clone);const o={};Object.entries(v).forEach(([k,x])=>{o[k]=clone(x)});return o;};
  const loadCustom=()=>{try{const v=JSON.parse(localStorage.getItem(STORE)||"{}");return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}catch(_){return {};}};
  const saveCustom=v=>{try{localStorage.setItem(STORE,JSON.stringify(v));return true;}catch(_){return false;}};
  const ATTRS=["dimmer","intensity","strobe","r","g","b","w","a","l","c","pan","panf","tilt","tiltf","gobo","gobo2","gobor","gobo2r","prism","prismr","focus","zoom","iris","frost","colour","colourr","speed","effect","preset","cct","cyan","magenta","yellow","amber","lime","warmWhite","coolWhite","naturalWhite","fog","haze","fana","fluid","control"];
  const TYPES=["dimmer","rgb","rgbw","moving","strobe","rgbal","rgbalc","tungsten"];

  function installCustomFixtures(){
    const custom=loadCustom();
    try{if(typeof FixtureLibrary!=="undefined"&&FixtureLibrary&&typeof FixtureLibrary==="object")Object.entries(custom).forEach(([name,def])=>{if(def&&typeof def==="object")FixtureLibrary[name]=clone(def);});}catch(error){console.warn("[FIXTURE] Could not install custom fixtures:",error);}
  }

  function renderCustomLibrary(){
    const list=document.getElementById("libList");if(!list)return;
    const custom=loadCustom();
    list.querySelectorAll("[data-custom-fixture]").forEach(el=>el.remove());
    Object.entries(custom).forEach(([name,def])=>{
      const item=document.createElement("div");item.className="cue-item";item.dataset.customFixture=name;item.style.cursor="pointer";
      item.innerHTML=`<div><strong>${escapeHtml(name)}</strong><small>Custom · ${Number(def.channels)||0} CH</small></div><span class="panel-meta">USER</span>`;
      item.addEventListener("click",()=>selectCustomFixture(name,def));list.prepend(item);
    });
  }
  const escapeHtml=s=>String(s).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
  function selectCustomFixture(name,def){
    const n=document.getElementById("patchName"),t=document.getElementById("patchType");if(n)n.value=name;if(t)t.value=String(def.type||"dimmer");
    if(typeof window.log==="function")window.log(`Selected custom fixture: ${name}`,"ok");
  }

  let editingName=null;
  function ensureFixtureEditor(){
    addStyles();let modal=document.getElementById("lxFixtureEditorModal");if(modal)return modal;
    modal=document.createElement("div");modal.id="lxFixtureEditorModal";
    modal.innerHTML=`<div class="lx-fixture-box" role="dialog" aria-modal="true"><div class="lx-fixture-kicker">FIXTURE EDITOR</div><h3>Create your own fixture</h3><p>Build a DMX personality just like a patch wizard: define the fixture, channel count and what each DMX channel controls.</p><div class="lx-fixture-grid"><div><label>Fixture Name</label><input id="lxFxName" placeholder="My Moving Head"></div><div><label>Type</label><select id="lxFxType">${TYPES.map(t=>`<option value="${t}">${t.toUpperCase()}</option>`).join("")}</select></div><div><label>Manufacturer</label><input id="lxFxManufacturer" placeholder="Manufacturer"></div><div><label>Model</label><input id="lxFxModel" placeholder="Model / personality"></div><div><label>DMX Channels</label><input id="lxFxChannels" type="number" min="1" max="512" value="8"></div><div><label>Beam Angle ° (optional)</label><input id="lxFxBeam" type="number" min="0" max="360" placeholder=""></div></div><div class="section-divider" style="margin-top:16px"><span>DMX CHANNEL MAP</span></div><div id="lxFxChannelList" class="lx-channel-list"></div><div class="lx-fixture-actions"><button type="button" id="lxFxAddChannel">＋ Add Channel</button><button type="button" id="lxFxCancel">Cancel</button><button type="button" id="lxFxExport">Export JSON</button><button type="button" id="lxFxSave" class="lx-fixture-save">Save Fixture</button></div><div id="lxFxStatus" class="lx-fixture-status"></div><div class="section-divider" style="margin-top:16px"><span>CUSTOM FIXTURES</span></div><div id="lxFxLibrary" class="lx-library-list"></div></div>`;
    document.body.appendChild(modal);
    const close=()=>modal.classList.remove("is-open");document.getElementById("lxFxCancel")?.addEventListener("click",close);modal.addEventListener("click",e=>{if(e.target===modal)close();});
    document.getElementById("lxFxChannels")?.addEventListener("change",()=>buildChannelRows());document.getElementById("lxFxAddChannel")?.addEventListener("click",()=>addChannelRow());document.getElementById("lxFxSave")?.addEventListener("click",saveFixture);document.getElementById("lxFxExport")?.addEventListener("click",exportFixture);
    return modal;
  }
  function buildChannelRows(values){
    const box=document.getElementById("lxFxChannelList"),count=Math.max(1,Math.min(512,Number(document.getElementById("lxFxChannels")?.value)||8));if(!box)return;box.innerHTML="<div class=\"lx-channel-head\"><span>CH</span><span>ATTRIBUTE</span><span></span></div>";for(let i=0;i<count;i++)addChannelRow(values?.[i]?.attribute||"",i,true);
  }
  function addChannelRow(attribute="",index=null,silent=false){
    const box=document.getElementById("lxFxChannelList");if(!box)return;const rows=box.querySelectorAll(".lx-channel-row");const i=index==null?rows.length:index;const row=document.createElement("div");row.className="lx-channel-row";row.innerHTML=`<input value="${i+1}" disabled><select>${ATTRS.map(a=>`<option value="${a}" ${a===attribute?"selected":""}>${a}</option>`).join("")}<option value="">— Unassigned —</option></select><button type="button" title="Remove">×</button>`;row.querySelector("button")?.addEventListener("click",()=>{row.remove();renumberRows();});box.appendChild(row);if(!silent)renumberRows();}
  function renumberRows(){document.querySelectorAll("#lxFxChannelList .lx-channel-row").forEach((row,i)=>{const input=row.querySelector("input");if(input)input.value=i+1;});const c=document.getElementById("lxFxChannels");if(c)c.value=document.querySelectorAll("#lxFxChannelList .lx-channel-row").length||1;}
  function openFixtureEditor(name=null){
    const modal=ensureFixtureEditor(),custom=loadCustom();editingName=name;modal.classList.add("is-open");
    const def=name?custom[name]:null;document.getElementById("lxFxName").value=name||"";document.getElementById("lxFxType").value=def?.type||"dimmer";document.getElementById("lxFxManufacturer").value=def?.manufacturer||"";document.getElementById("lxFxModel").value=def?.model||"";document.getElementById("lxFxChannels").value=def?.channels||8;document.getElementById("lxFxBeam").value=def?.photometrics?.beamAngle??"";buildChannelRows(def?Object.entries(def.map||{}).sort((a,b)=>a[1]-b[1]).map(([attribute])=>({attribute})):null);renderEditorLibrary();setTimeout(()=>document.getElementById("lxFxName")?.focus(),0);
  }
  function saveFixture(){
    const name=String(document.getElementById("lxFxName")?.value||"").trim(),type=String(document.getElementById("lxFxType")?.value||"dimmer"),channels=Math.max(1,Math.min(512,Number(document.getElementById("lxFxChannels")?.value)||1));if(!name){setFxStatus("Enter a fixture name.",true);return;}
    const map={};document.querySelectorAll("#lxFxChannelList .lx-channel-row").forEach((row,i)=>{const attr=String(row.querySelector("select")?.value||"").trim();if(attr&&!Object.prototype.hasOwnProperty.call(map,attr))map[attr]=i;});if(!Object.keys(map).length){setFxStatus("Assign at least one DMX channel.",true);return;}
    const beam=document.getElementById("lxFxBeam")?.value;const def={type,channels,map,photometrics:{verified:false,sourceType:"LED",ratedLumens:null,beamAngle:beam===""?null:Number(beam),outputScale:1},manufacturer:String(document.getElementById("lxFxManufacturer")?.value||"").trim()||"Custom",model:String(document.getElementById("lxFxModel")?.value||"").trim()||name,custom:true};
    const custom=loadCustom();if(editingName&&editingName!==name)delete custom[editingName];custom[name]=def;if(!saveCustom(custom)){setFxStatus("Could not save custom fixture to local storage.",true);return;}try{if(typeof FixtureLibrary!=="undefined")FixtureLibrary[name]=clone(def);}catch(_){}renderCustomLibrary();renderEditorLibrary();if(typeof window.renderLibrary==="function")window.renderLibrary();if(typeof window.log==="function")window.log(`Custom fixture saved: ${name}`,"ok");setFxStatus("Fixture saved and added to the patch library.",false);editingName=name;
  }
  function setFxStatus(message,error){const s=document.getElementById("lxFxStatus");if(s){s.textContent=message;s.style.color=error?"#ff6b6b":"#19d6a3";}}
  function renderEditorLibrary(){const box=document.getElementById("lxFxLibrary");if(!box)return;box.innerHTML="";const custom=loadCustom();if(!Object.keys(custom).length){box.innerHTML="<div class=\"lx-custom-meta\">No custom fixtures yet.</div>";return;}Object.entries(custom).forEach(([name,def])=>{const row=document.createElement("div");row.className="lx-custom-item";row.innerHTML=`<div><strong>${escapeHtml(name)}</strong><div class="lx-custom-meta">${Number(def.channels)||0} channels · ${escapeHtml(def.type||"dimmer")}</div></div><div style="display:flex;gap:6px"><button type="button">Edit</button><button type="button">Delete</button></div>`;row.querySelectorAll("button")[0].addEventListener("click",()=>openFixtureEditor(name));row.querySelectorAll("button")[1].addEventListener("click",()=>{const c=loadCustom();delete c[name];saveCustom(c);try{if(typeof FixtureLibrary!=="undefined")delete FixtureLibrary[name];}catch(_){}renderCustomLibrary();renderEditorLibrary();});box.appendChild(row);});}
  function exportFixture(){const name=String(document.getElementById("lxFxName")?.value||"").trim();const custom=loadCustom();const def=custom[name];if(!def){setFxStatus("Save the fixture first, then export it.",true);return;}const blob=new Blob([JSON.stringify({name,definition:def},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${name.replace(/[^a-z0-9_-]+/gi,"_")}.fixture.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function installFixtureEditor(){
    installCustomFixtures();
    const patch=document.getElementById("page-patch");if(!patch)return false;
    if(!document.getElementById("btnFixtureEditor")){const target=patch.querySelector(".page-grid .panel:nth-child(2) .action-row");if(target){const b=document.createElement("button");b.id="btnFixtureEditor";b.type="button";b.className="btn-secondary";b.textContent="⚙ Fixture Editor";b.addEventListener("click",()=>openFixtureEditor());target.appendChild(b);}}
    renderCustomLibrary();return true;
  }

  if(typeof commandDefs!=="undefined"&&Array.isArray(commandDefs))commandDefs.push({cmd:"suggestion",hint:"open suggestion menu"},{cmd:"suggestions",hint:"open suggestion menu"},{cmd:"bug report",hint:"open bug report menu"},{cmd:"bugreport",hint:"open bug report menu"},{cmd:"fixture editor",hint:"open custom fixture editor"},{cmd:"fixtureeditor",hint:"open custom fixture editor"});
  const previousParseCommand=window.parseCommand||window.__lxOriginalParseCommand;
  window.parseCommand=function(rawCommand){const command=String(rawCommand||"").trim().toLowerCase();if(/^(suggestion|suggestions)$/.test(command)){openFeedback("suggestion");return;}if(/^(bug\s+report|bugreport)$/.test(command)){openFeedback("bug");return;}if(/^(fixture\s+editor|fixtureeditor)$/.test(command)){openFixtureEditor();return;}return typeof previousParseCommand==="function"?previousParseCommand.apply(this,arguments):undefined;};
  window.LXFeedback=Object.freeze({openSuggestion:()=>openFeedback("suggestion"),openBugReport:()=>openFeedback("bug")});
  window.LXFixtureEditor=Object.freeze({open:()=>openFixtureEditor(),install:installCustomFixtures});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{ensureFeedbackModal();installFixtureEditor();},{once:true});else{ensureFeedbackModal();installFixtureEditor();}
  setTimeout(installFixtureEditor,500);setTimeout(installFixtureEditor,1500);
})();