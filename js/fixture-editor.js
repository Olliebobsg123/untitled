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

  // Custom fixtures belong to the show: they're kept in State.current (so show
  // files and the autosave carry them) under the key older versions used.
  const SHOW_KEY = "__lxCustomFixtures";
  const loadCustom = () => {
    const value = State.current?.[SHOW_KEY];
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

  const saveCustom = value => {
    State.current ||= {};
    State.current[SHOW_KEY] = value && typeof value === "object" ? value : {};
    return true;
  };

  // Older versions kept them in this window's storage instead: move them into the show once.
  try {
    const legacy = JSON.parse(localStorage.getItem(STORE) || "null");
    if (legacy && typeof legacy === "object" && Object.keys(legacy).length) saveCustom({ ...loadCustom(), ...legacy });
    localStorage.removeItem(STORE);
  } catch (_) {}

  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", "\"":"&quot;"
  }[char]));


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

  LXCommands.describe("fixture editor", "open custom fixture editor");
  LXCommands.add(raw => (/^(fixture\s+editor|fixtureeditor)$/i.test(String(raw || "").trim()) ? openFixtureEditor() : LXCommands.NOT_MINE));

  window.LXFixtureEditor = Object.freeze({ open: () => openFixtureEditor(), install: installCustomFixtures });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFixtureEditor, { once: true });
  } else {
    installFixtureEditor();
  }
})();
