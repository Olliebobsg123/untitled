"use strict";

/*
 * LX Console custom fixture editor.
 * Kept separate from feedback.js so feedback and fixture editing remain
 * independently maintainable.
 */
(function installFixtureEditorModule() {
  const STORE = "lx-custom-fixtures";
  const ATTRS = ["dimmer","intensity","strobe","r","g","b","w","uv","a","l","c","pan","panf","tilt","tiltf","gobo","gobo2","gobor","gobo2r","prism","prismr","focus","zoom","iris","frost","colour","colourr","speed","effect","preset","cct","cyan","magenta","yellow","amber","lime","warmWhite","coolWhite","naturalWhite","fog","haze","fana","fluid","control"];
  const TYPES = ["dimmer","rgb","rgbw","moving","strobe","rgbal","rgbalc","tungsten"];
  let editingName = null;

  const clone = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    Object.entries(value).forEach(([key, item]) => { try { out[key] = clone(item); } catch (_) {} });
    return out;
  };

  const loadCustom = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORE) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  };

  const saveCustom = value => {
    try { localStorage.setItem(STORE, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  };

  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", "\"":"&quot;"
  }[char]));

  function addStyles() {
    if (document.getElementById("lxFixtureEditorStyles")) return;
    const style = document.createElement("style");
    style.id = "lxFixtureEditorStyles";
    style.textContent = `
      #lxFixtureEditorModal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,7,8,.76);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:100000;padding:24px;box-sizing:border-box}
      #lxFixtureEditorModal.is-open{display:flex;animation:lxFxFadeIn .18s ease-out}
      #lxFixtureEditorModal .lx-fixture-box{position:relative;width:min(820px,100%);max-height:min(92vh,900px);overflow:auto;background:linear-gradient(180deg,#101719 0%,#0a0f11 100%);border:1px solid rgba(112,142,138,.22);border-radius:18px;box-shadow:0 30px 100px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.02) inset;padding:28px;box-sizing:border-box;color:#eef4f2;font-family:Inter,"Segoe UI",system-ui,sans-serif;scrollbar-width:thin;scrollbar-color:#314044 transparent}
      #lxFixtureEditorModal .lx-fixture-box::-webkit-scrollbar{width:8px}
      #lxFixtureEditorModal .lx-fixture-box::-webkit-scrollbar-track{background:transparent}
      #lxFixtureEditorModal .lx-fixture-box::-webkit-scrollbar-thumb{background:#314044;border-radius:99px}
      #lxFixtureEditorModal .lx-fixture-kicker{display:inline-flex;align-items:center;gap:7px;color:#19d6a3;font:900 9px/1 var(--mono,monospace);letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px;padding:7px 10px;border:1px solid rgba(25,214,163,.18);background:rgba(25,214,163,.07);border-radius:999px}
      #lxFixtureEditorModal .lx-fixture-kicker:before{content:"";width:6px;height:6px;border-radius:50%;background:#19d6a3;box-shadow:0 0 12px rgba(25,214,163,.8)}
      #lxFixtureEditorModal h3{margin:0 0 7px;font-size:24px;line-height:1.15;letter-spacing:-.025em;color:#f4faf8}
      #lxFixtureEditorModal p{margin:0 0 22px;color:#8d9e9b;font-size:12px;line-height:1.6;max-width:680px}
      #lxFixtureEditorModal .lx-fixture-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:18px;border:1px solid rgba(112,142,138,.16);background:rgba(255,255,255,.025);border-radius:14px}
      #lxFixtureEditorModal .lx-fixture-grid>div{min-width:0}
      #lxFixtureEditorModal label{display:block;color:#91a29f;font:800 9px/1 var(--mono,monospace);text-transform:uppercase;letter-spacing:.1em;margin:0 0 7px;padding-left:2px}
      #lxFixtureEditorModal .lx-fixture-grid input,#lxFixtureEditorModal .lx-fixture-grid select{width:100%;height:40px;box-sizing:border-box;background:#080d0f;border:1px solid #29373a;border-radius:9px;color:#eef4f2;padding:0 11px;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
      #lxFixtureEditorModal .lx-fixture-grid input::placeholder{color:#50605e}
      #lxFixtureEditorModal .lx-fixture-grid input:hover,#lxFixtureEditorModal .lx-fixture-grid select:hover{border-color:#3a4b4e;background:#0a1012}
      #lxFixtureEditorModal .lx-fixture-grid input:focus,#lxFixtureEditorModal .lx-fixture-grid select:focus{border-color:#19d6a3;box-shadow:0 0 0 3px rgba(25,214,163,.09);background:#0a1012}
      #lxFixtureEditorModal .section-divider{display:flex!important;align-items:center;gap:12px;height:34px!important;margin:22px 0 4px!important;padding:0!important;border:0!important;background:none!important;color:#687875!important;font:900 9px/1 var(--mono,monospace)!important;letter-spacing:.13em;text-transform:uppercase}
      #lxFixtureEditorModal .section-divider:before,#lxFixtureEditorModal .section-divider:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,#263437)}
      #lxFixtureEditorModal .section-divider:after{background:linear-gradient(90deg,#263437,transparent)}
      #lxFixtureEditorModal .lx-channel-list{margin-top:8px;padding:0;border:1px solid rgba(112,142,138,.16);border-radius:14px;overflow:hidden;background:#080d0f}
      #lxFixtureEditorModal .lx-channel-head{display:grid;grid-template-columns:64px 1fr 42px;gap:10px;align-items:center;padding:10px 12px;background:#10181a;border-bottom:1px solid #202c2f;color:#60716e;font:900 9px var(--mono,monospace);text-transform:uppercase;letter-spacing:.1em}
      #lxFixtureEditorModal .lx-channel-row{display:grid;grid-template-columns:64px 1fr 42px;gap:10px;align-items:center;padding:8px 12px;margin:0;border-bottom:1px solid rgba(42,55,58,.55);transition:background .14s ease}
      #lxFixtureEditorModal .lx-channel-row:last-child{border-bottom:0}
      #lxFixtureEditorModal .lx-channel-row:hover{background:rgba(255,255,255,.025)}
      #lxFixtureEditorModal .lx-channel-row input,#lxFixtureEditorModal .lx-channel-row select{width:100%;height:38px;box-sizing:border-box;background:#0b1113;border:1px solid #283639;border-radius:8px;color:#eef4f2;padding:0 10px;outline:none;transition:border-color .16s ease,box-shadow .16s ease}
      #lxFixtureEditorModal .lx-channel-row input{color:#71817f;text-align:center;font:800 10px var(--mono,monospace);background:#11191b}
      #lxFixtureEditorModal .lx-channel-row select:focus{border-color:#19d6a3;box-shadow:0 0 0 3px rgba(25,214,163,.08)}
      #lxFixtureEditorModal .lx-channel-row button{width:38px;height:38px;padding:0;border-radius:8px;border:1px solid #2a373b;background:#11191c;color:#7d8e8b;font-size:17px;line-height:1;transition:all .16s ease}
      #lxFixtureEditorModal .lx-channel-row button:hover{border-color:#ff6565;background:rgba(255,80,80,.1);color:#ff8585}
      #lxFixtureEditorModal .lx-fixture-actions{display:flex;justify-content:flex-end;align-items:center;gap:9px;margin-top:18px;flex-wrap:wrap;padding-top:4px}
      #lxFixtureEditorModal button{border:1px solid #2b3a3d;background:#121a1c;color:#dce6e3;padding:10px 14px;min-height:38px;border-radius:9px;cursor:pointer;font:900 10px/1 var(--mono,monospace);text-transform:uppercase;letter-spacing:.03em;transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease;color-scheme:dark}
      #lxFixtureEditorModal button:hover{background:#182326;border-color:#405155;transform:translateY(-1px)}
      #lxFixtureEditorModal button:active{transform:translateY(0)}
      #lxFixtureEditorModal .lx-fixture-save{background:#19d6a3;color:#06110d;border-color:#19d6a3;box-shadow:0 8px 24px rgba(25,214,163,.13)}
      #lxFixtureEditorModal .lx-fixture-save:hover{background:#35e4b4;border-color:#35e4b4;box-shadow:0 10px 30px rgba(25,214,163,.2)}
      #lxFixtureEditorModal .lx-fixture-status{min-height:18px;margin-top:10px;padding:0 2px;color:#19d6a3;font:700 10px/1.5 var(--mono,monospace)}
      #lxFixtureEditorModal .lx-library-list{margin-top:8px;padding:8px;border:1px solid rgba(112,142,138,.16);border-radius:14px;background:#080d0f}
      #lxFixtureEditorModal .lx-custom-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;border:1px solid #202d30;border-radius:10px;margin-bottom:7px;background:linear-gradient(180deg,#101719,#0d1416);transition:border-color .14s ease,background .14s ease,transform .14s ease}
      #lxFixtureEditorModal .lx-custom-item:last-child{margin-bottom:0}
      #lxFixtureEditorModal .lx-custom-item:hover{border-color:#35474a;background:#121b1d;transform:translateY(-1px)}
      #lxFixtureEditorModal .lx-custom-item strong{display:block;color:#eef4f2;font-size:12px;margin-bottom:4px}
      #lxFixtureEditorModal .lx-custom-meta{color:#687875;font-size:10px;line-height:1.4}
      #lxFixtureEditorModal .lx-library-list .lx-custom-meta{padding:8px 4px}
      #lxFixtureEditorModal .lx-custom-item>div:last-child{display:flex;gap:6px;flex-shrink:0}
      #lxFixtureEditorModal .lx-custom-item button{min-height:32px;padding:8px 10px;font-size:9px;border-radius:7px}
      @keyframes lxFxFadeIn{from{opacity:0}to{opacity:1}}
      @media(max-width:650px){
        #lxFixtureEditorModal{padding:12px}
        #lxFixtureEditorModal .lx-fixture-box{padding:20px;border-radius:15px;max-height:94vh}
        #lxFixtureEditorModal h3{font-size:21px}
        #lxFixtureEditorModal .lx-fixture-grid{grid-template-columns:1fr;padding:14px}
        #lxFixtureEditorModal .lx-fixture-actions{justify-content:stretch}
        #lxFixtureEditorModal .lx-fixture-actions button{flex:1 1 140px}
        #lxFixtureEditorModal .lx-channel-head,#lxFixtureEditorModal .lx-channel-row{grid-template-columns:48px 1fr 38px;gap:7px;padding-left:8px;padding-right:8px}
      }
    `;
    document.head.appendChild(style);
  }

  function installCustomFixtures() {
    const custom = loadCustom();
    try {
      if (typeof FixtureLibrary !== "undefined" && FixtureLibrary && typeof FixtureLibrary === "object") {
        Object.entries(custom).forEach(([name, definition]) => {
          if (definition && typeof definition === "object") FixtureLibrary[name] = clone(definition);
        });
      }
    } catch (error) { console.warn("[FIXTURE] Could not install custom fixtures:", error); }
  }

  function renderCustomLibrary() {
    const list = document.getElementById("libList");
    if (!list) return;
    const custom = loadCustom();
    list.querySelectorAll("[data-custom-fixture]").forEach(element => element.remove());
    Object.entries(custom).forEach(([name, definition]) => {
      const item = document.createElement("div");
      item.className = "cue-item";
      item.dataset.customFixture = name;
      item.style.cursor = "pointer";
      item.innerHTML = `<div><strong>${escapeHtml(name)}</strong><small>Custom · ${Number(definition.channels)||0} CH</small></div><span class="panel-meta">USER</span>`;
      item.addEventListener("click", () => selectCustomFixture(name, definition));
      list.prepend(item);
    });
  }

  function selectCustomFixture(name, definition) {
    const nameInput = document.getElementById("patchName");
    const typeInput = document.getElementById("patchType");
    if (nameInput) nameInput.value = name;
    if (typeInput) typeInput.value = String(definition.type || "dimmer");
    if (typeof window.log === "function") window.log(`Selected custom fixture: ${name}`, "ok");
  }

  function ensureFixtureEditor() {
    addStyles();
    let modal = document.getElementById("lxFixtureEditorModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "lxFixtureEditorModal";
    modal.innerHTML = `<div class="lx-fixture-box" role="dialog" aria-modal="true"><div class="lx-fixture-kicker">FIXTURE EDITOR</div><h3>Create your own fixture</h3><p>Build a DMX personality just like a patch wizard: define the fixture, channel count and what each DMX channel controls.</p><div class="lx-fixture-grid"><div><label>Fixture Name</label><input id="lxFxName" placeholder="My Moving Head"></div><div><label>Type</label><select id="lxFxType">${TYPES.map(type => `<option value="${type}">${type.toUpperCase()}</option>`).join("")}</select></div><div><label>Manufacturer</label><input id="lxFxManufacturer" placeholder="Manufacturer"></div><div><label>Model</label><input id="lxFxModel" placeholder="Model / personality"></div><div><label>DMX Channels</label><input id="lxFxChannels" type="number" min="1" max="512" value="8"></div><div><label>Beam Angle ° (optional)</label><input id="lxFxBeam" type="number" min="0" max="360" placeholder=""></div></div><div class="section-divider" style="margin-top:16px"><span>DMX CHANNEL MAP</span></div><div id="lxFxChannelList" class="lx-channel-list"></div><div class="lx-fixture-actions"><button type="button" id="lxFxAddChannel">＋ Add Channel</button><button type="button" id="lxFxCancel">Cancel</button><button type="button" id="lxFxExport">Export JSON</button><button type="button" id="lxFxSave" class="lx-fixture-save">Save Fixture</button></div><div id="lxFxStatus" class="lx-fixture-status"></div><div class="section-divider" style="margin-top:16px"><span>CUSTOM FIXTURES</span></div><div id="lxFxLibrary" class="lx-library-list"></div></div>`;
    document.body.appendChild(modal);
    const close = () => modal.classList.remove("is-open");
    document.getElementById("lxFxCancel")?.addEventListener("click", close);
    modal.addEventListener("click", event => { if (event.target === modal) close(); });
    document.getElementById("lxFxChannels")?.addEventListener("change", () => buildChannelRows());
    document.getElementById("lxFxAddChannel")?.addEventListener("click", () => addChannelRow());
    document.getElementById("lxFxSave")?.addEventListener("click", saveFixture);
    document.getElementById("lxFxExport")?.addEventListener("click", exportFixture);
    return modal;
  }

  function buildChannelRows(values) {
    const box = document.getElementById("lxFxChannelList");
    const count = Math.max(1, Math.min(512, Number(document.getElementById("lxFxChannels")?.value) || 8));
    if (!box) return;
    box.innerHTML = "<div class=\"lx-channel-head\"><span>CH</span><span>ATTRIBUTE</span><span></span></div>";
    for (let index = 0; index < count; index++) addChannelRow(values?.[index]?.attribute || "", index, true);
  }

  function addChannelRow(attribute = "", index = null, silent = false) {
    const box = document.getElementById("lxFxChannelList");
    if (!box) return;
    const rows = box.querySelectorAll(".lx-channel-row");
    const indexValue = index == null ? rows.length : index;
    const row = document.createElement("div");
    row.className = "lx-channel-row";
    row.innerHTML = `<input value="${indexValue + 1}" disabled><select>${ATTRS.map(item => `<option value="${item}" ${item === attribute ? "selected" : ""}>${item}</option>`).join("")}<option value="">— Unassigned —</option></select><button type="button" title="Remove">×</button>`;
    row.querySelector("button")?.addEventListener("click", () => { row.remove(); renumberRows(); });
    box.appendChild(row);
    if (!silent) renumberRows();
  }

  function renumberRows() {
    document.querySelectorAll("#lxFxChannelList .lx-channel-row").forEach((row, index) => {
      const input = row.querySelector("input");
      if (input) input.value = index + 1;
    });
    const channels = document.getElementById("lxFxChannels");
    if (channels) channels.value = document.querySelectorAll("#lxFxChannelList .lx-channel-row").length || 1;
  }

  function setFxStatus(message, error) {
    const status = document.getElementById("lxFxStatus");
    if (status) { status.textContent = message; status.style.color = error ? "#ff6b6b" : "#19d6a3"; }
  }

  function openFixtureEditor(name = null) {
    const modal = ensureFixtureEditor();
    const custom = loadCustom();
    editingName = name;
    modal.classList.add("is-open");
    const definition = name ? custom[name] : null;
    document.getElementById("lxFxName").value = name || "";
    document.getElementById("lxFxType").value = definition?.type || "dimmer";
    document.getElementById("lxFxManufacturer").value = definition?.manufacturer || "";
    document.getElementById("lxFxModel").value = definition?.model || "";
    document.getElementById("lxFxChannels").value = definition?.channels || 8;
    document.getElementById("lxFxBeam").value = definition?.photometrics?.beamAngle ?? "";
    buildChannelRows(definition ? Object.entries(definition.map || {}).sort((a, b) => a[1] - b[1]).map(([attribute]) => ({ attribute })) : null);
    renderEditorLibrary();
    setTimeout(() => document.getElementById("lxFxName")?.focus(), 0);
  }

  function saveFixture() {
    const name = String(document.getElementById("lxFxName")?.value || "").trim();
    const type = String(document.getElementById("lxFxType")?.value || "dimmer");
    const channels = Math.max(1, Math.min(512, Number(document.getElementById("lxFxChannels")?.value) || 1));
    if (!name) { setFxStatus("Enter a fixture name.", true); return; }
    const map = {};
    document.querySelectorAll("#lxFxChannelList .lx-channel-row").forEach((row, index) => {
      const attribute = String(row.querySelector("select")?.value || "").trim();
      if (attribute && !Object.prototype.hasOwnProperty.call(map, attribute)) map[attribute] = index;
    });
    if (!Object.keys(map).length) { setFxStatus("Assign at least one DMX channel.", true); return; }
    const beam = document.getElementById("lxFxBeam")?.value;
    const definition = {
      type,
      channels,
      map,
      photometrics: { verified: false, sourceType: "LED", ratedLumens: null, beamAngle: beam === "" ? null : Number(beam), outputScale: 1 },
      manufacturer: String(document.getElementById("lxFxManufacturer")?.value || "").trim() || "Custom",
      model: String(document.getElementById("lxFxModel")?.value || "").trim() || name,
      custom: true
    };
    const custom = loadCustom();
    if (editingName && editingName !== name) delete custom[editingName];
    custom[name] = definition;
    if (!saveCustom(custom)) { setFxStatus("Could not save custom fixture to local storage.", true); return; }
    try { if (typeof FixtureLibrary !== "undefined") FixtureLibrary[name] = clone(definition); } catch (_) {}
    renderCustomLibrary();
    renderEditorLibrary();
    if (typeof window.renderLibrary === "function") window.renderLibrary();
    if (typeof window.log === "function") window.log(`Custom fixture saved: ${name}`, "ok");
    setFxStatus("Fixture saved and added to the patch library.", false);
    editingName = name;
  }

  function renderEditorLibrary() {
    const box = document.getElementById("lxFxLibrary");
    if (!box) return;
    box.innerHTML = "";
    const custom = loadCustom();
    if (!Object.keys(custom).length) { box.innerHTML = "<div class=\"lx-custom-meta\">No custom fixtures yet.</div>"; return; }
    Object.entries(custom).forEach(([name, definition]) => {
      const row = document.createElement("div");
      row.className = "lx-custom-item";
      row.innerHTML = `<div><strong>${escapeHtml(name)}</strong><div class="lx-custom-meta">${Number(definition.channels)||0} channels · ${escapeHtml(definition.type||"dimmer")}</div></div><div style="display:flex;gap:6px"><button type="button">Edit</button><button type="button">Delete</button></div>`;
      row.querySelectorAll("button")[0].addEventListener("click", () => openFixtureEditor(name));
      row.querySelectorAll("button")[1].addEventListener("click", () => {
        const customFixtures = loadCustom();
        delete customFixtures[name];
        saveCustom(customFixtures);
        try { if (typeof FixtureLibrary !== "undefined") delete FixtureLibrary[name]; } catch (_) {}
        renderCustomLibrary();
        renderEditorLibrary();
      });
      box.appendChild(row);
    });
  }

  function exportFixture() {
    const name = String(document.getElementById("lxFxName")?.value || "").trim();
    const custom = loadCustom();
    const definition = custom[name];
    if (!definition) { setFxStatus("Save the fixture first, then export it.", true); return; }
    const blob = new Blob([JSON.stringify({ name, definition }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.replace(/[^a-z0-9_-]+/gi, "_")}.fixture.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function installFixtureEditor() {
    installCustomFixtures();
    const patch = document.getElementById("page-patch");
    if (!patch) return false;
    if (!document.getElementById("btnFixtureEditor")) {
      const target = patch.querySelector(".page-grid .panel:nth-child(2) .action-row");
      if (target) {
        const button = document.createElement("button");
        button.id = "btnFixtureEditor";
        button.type = "button";
        button.className = "btn-secondary";
        button.textContent = "⚙ Fixture Editor";
        button.addEventListener("click", () => openFixtureEditor());
        target.appendChild(button);
      }
    }
    renderCustomLibrary();
    return true;
  }

  if (typeof commandDefs !== "undefined" && Array.isArray(commandDefs)) {
    commandDefs.push(
      { cmd: "fixture editor", hint: "open custom fixture editor" },
      { cmd: "fixtureeditor", hint: "open custom fixture editor" }
    );
  }

  const previousParseCommand = window.parseCommand || window.__lxOriginalParseCommand;
  window.parseCommand = function(rawCommand) {
    const command = String(rawCommand || "").trim().toLowerCase();
    if (/^(fixture\s+editor|fixtureeditor)$/.test(command)) {
      openFixtureEditor();
      return;
    }
    return typeof previousParseCommand === "function" ? previousParseCommand.apply(this, arguments) : undefined;
  };

  window.LXFixtureEditor = Object.freeze({ open: () => openFixtureEditor(), install: installCustomFixtures });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFixtureEditor, { once: true });
  } else {
    installFixtureEditor();
  }
  setTimeout(installFixtureEditor, 500);
  setTimeout(installFixtureEditor, 1500);
})();
