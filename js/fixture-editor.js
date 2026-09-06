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
      #lxFixtureEditorModal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);z-index:100000;padding:20px;box-sizing:border-box}
      #lxFixtureEditorModal.is-open{display:flex}
      #lxFixtureEditorModal .lx-fixture-box{width:min(760px,100%);max-height:90vh;overflow:auto;background:#0b1012;border:1px solid #2a373b;box-shadow:0 24px 80px rgba(0,0,0,.55);padding:22px;box-sizing:border-box;color:#eef4f2;font-family:Inter,"Segoe UI",system-ui,sans-serif}
      #lxFixtureEditorModal .lx-fixture-kicker{color:#19d6a3;font:900 9px/1 var(--mono,monospace);letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px}
      #lxFixtureEditorModal h3{margin:0 0 7px;font-size:20px}
      #lxFixtureEditorModal p{margin:0 0 16px;color:#879693;font-size:12px}
      #lxFixtureEditorModal .lx-fixture-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:13px;flex-wrap:wrap}
      #lxFixtureEditorModal button{border:1px solid #2a373b;background:#11191c;color:#eef4f2;padding:9px 14px;cursor:pointer;font:900 10px/1 var(--mono,monospace);text-transform:uppercase}
      #lxFixtureEditorModal button:hover{background:#172124}
      #lxFixtureEditorModal .lx-fixture-save{background:#19d6a3;color:#06110d;border-color:#19d6a3}
      #lxFixtureEditorModal .lx-fixture-status{min-height:16px;margin-top:9px;color:#879693;font:700 10px/1.4 var(--mono,monospace)}
      #lxFixtureEditorModal .lx-fixture-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      #lxFixtureEditorModal .lx-fixture-grid input,#lxFixtureEditorModal .lx-fixture-grid select{width:100%;box-sizing:border-box;background:#070a0b;border:1px solid #2a373b;color:#eef4f2;padding:9px;outline:none}
      #lxFixtureEditorModal .lx-fixture-grid input:focus,#lxFixtureEditorModal .lx-fixture-grid select:focus{border-color:#19d6a3}
      #lxFixtureEditorModal label{display:block;color:#879693;font:800 9px/1 var(--mono,monospace);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
      #lxFixtureEditorModal .lx-channel-list{margin-top:10px;border-top:1px solid #202b2e;padding-top:10px}
      #lxFixtureEditorModal .lx-channel-head{display:grid;grid-template-columns:70px 1fr 38px;gap:8px;color:#687875;font:800 9px var(--mono,monospace);text-transform:uppercase;margin-bottom:6px}
      #lxFixtureEditorModal .lx-channel-row{display:grid;grid-template-columns:70px 1fr 38px;gap:8px;margin-bottom:6px}
      #lxFixtureEditorModal .lx-channel-row input,#lxFixtureEditorModal .lx-channel-row select{width:100%;box-sizing:border-box;background:#070a0b;border:1px solid #2a373b;color:#eef4f2;padding:9px;outline:none}
      #lxFixtureEditorModal .lx-channel-row button{padding:0;width:38px;height:34px}
      #lxFixtureEditorModal .lx-library-list{margin-top:12px;border-top:1px solid #202b2e;padding-top:10px}
      #lxFixtureEditorModal .lx-custom-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px;border:1px solid #202b2e;margin-bottom:6px;background:#0e1517}
      #lxFixtureEditorModal .lx-custom-meta{color:#687875;font-size:10px}
      @media(max-width:650px){#lxFixtureEditorModal .lx-fixture-grid{grid-template-columns:1fr}}
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
