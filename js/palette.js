"use strict";

/* Palette UI + command bridge. Loaded by index.html after the core console scripts. */
(function () {
  const FIELD_GROUPS = {
    Colour: ["hue", "sat", "amber", "uv"],
    Intensity: ["intensity", "master"],
    Position: ["pan", "tilt"],
    Beam: ["zoom", "focus", "gobo", "gobo2", "prism", "frost", "iris", "rot", "effect", "speed", "strobe"],
    General: ["intensity", "hue", "sat", "strobe", "master", "pan", "tilt", "zoom", "focus", "gobo", "gobo2", "prism", "frost", "iris", "rot", "effect", "speed", "amber", "uv"]
  };
  const FIELDS = FIELD_GROUPS.General;

  const state = () => {
    window.State = window.State || {};
    if (!Array.isArray(State.palettes)) State.palettes = [];
    if (!(State.selected instanceof Set)) State.selected = new Set();
    if (!State.current || typeof State.current !== "object") State.current = {};
    return State;
  };

  const clean = value => String(value || "").trim().replace(/\s+/g, " ");
  const categoryKey = category => {
    const wanted = clean(category).toLowerCase();
    return Object.keys(FIELD_GROUPS).find(key => key.toLowerCase() === wanted) || "General";
  };
  const find = name => {
    state();
    const wanted = clean(name).toLowerCase();
    if (/^\d+$/.test(wanted)) return State.palettes[Number(wanted) - 1] || null;
    return State.palettes.find(p => clean(p.name).toLowerCase() === wanted) || null;
  };

  function selectedFixtures() {
    state();
    return (State.fixtures || []).filter(f => State.selected.has(f.id));
  }

  function snapshot(category = "General") {
    state();
    const values = {};
    const fields = FIELD_GROUPS[categoryKey(category)] || FIELDS;
    fields.forEach(field => {
      const value = Number(State.current[field]);
      if (Number.isFinite(value)) values[field] = value;
    });
    return values;
  }

  function record(name, category) {
    state();
    const paletteName = clean(name);
    const paletteCategory = categoryKey(category);
    if (!paletteName) return { ok: false, message: "Palette name cannot be empty." };
    if (!selectedFixtures().length) return { ok: false, message: "Select at least one fixture before recording a palette." };
    if (find(paletteName)) return { ok: false, message: `Palette \"${paletteName}\" already exists.` };

    const palette = {
      id: `palette-${Date.now()}`,
      name: paletteName,
      category: paletteCategory,
      values: snapshot(paletteCategory),
      fixtures: [...State.selected],
      createdAt: new Date().toISOString()
    };
    State.palettes.push(palette);
    render();
    return { ok: true, palette };
  }

  function apply(name) {
    state();
    const palette = find(name);
    if (!palette) return { ok: false, message: `Palette \"${clean(name)}\" not found.` };
    if (!selectedFixtures().length) return { ok: false, message: "Select at least one fixture before applying a palette." };

    const values = palette.values || {};
    Object.assign(State.current, values);
    selectedFixtures().forEach(fixture => {
      let current = typeof window.ensureFixtureState === "function" ? window.ensureFixtureState(fixture.id) : null;
      if (!current) {
        current = State.fixtureStates?.get(fixture.id) || {};
        State.fixtureStates?.set(fixture.id, current);
      }
      // Some palettes (e.g. Auto Create's positions) hold values per fixture:
      // each moving head's own pan/tilt for the same spot on stage.
      const own = palette.perFixture?.[fixture.id] || {};
      Object.assign(current, values, own);
      // A hue/sat palette on a CMY-only fixture (e.g. Robe): mix it in CMY.
      if (!("cyan" in values) && !("cyan" in own) && typeof window.withCMY === "function") Object.assign(current, window.withCMY(fixture.id, current, values));
    });

    if (typeof window.fadeTo === "function") window.fadeTo(values, 300);
    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.renderFixtures === "function") window.renderFixtures();
    if (typeof window.buildControls === "function") window.buildControls();
    if (typeof window.updateColourWheel === "function") window.updateColourWheel();
    window.log?.(`Applied palette \"${palette.name}\"`, "ok");
    return { ok: true, palette };
  }

  function update(name) {
    state();
    const palette = find(name);
    if (!palette) return { ok: false, message: `Palette \"${clean(name)}\" not found.` };
    if (!selectedFixtures().length) return { ok: false, message: "Select at least one fixture before updating a palette." };
    palette.category = categoryKey(palette.category);
    palette.values = snapshot(palette.category);
    palette.fixtures = [...State.selected];
    palette.updatedAt = new Date().toISOString();
    render();
    return { ok: true, palette };
  }

  function remove(name) {
    state();
    const palette = find(name);
    if (!palette) return { ok: false, message: `Palette \"${clean(name)}\" not found.` };
    const index = State.palettes.indexOf(palette);
    State.palettes.splice(index, 1);
    render();
    return { ok: true, palette };
  }

  function preview(palette) {
    const values = palette.values || {};
    const bits = [];
    if (values.intensity != null) bits.push(`${values.intensity}%`);
    if (values.hue != null) bits.push(`H${values.hue}`);
    if (values.sat != null) bits.push(`S${values.sat}`);
    if (values.pan != null || values.tilt != null) bits.push(`P${values.pan ?? "-"} T${values.tilt ?? "-"}`);
    if (values.zoom != null) bits.push(`Z${values.zoom}`);
    if (palette.perFixture) bits.push(`${Object.keys(palette.perFixture).length} fixtures`);
    if (palette.auto) bits.push("auto");
    return bits.join(" · ") || "Programmer state";
  }

  function injectStyles() {
    if (document.getElementById("paletteUiStyles")) return;
    const style = document.createElement("style");
    style.id = "paletteUiStyles";
    style.textContent = `
      .palette-launch{width:100%;margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border:1px solid #263238;border-radius:8px;background:#10171b;color:#b9c5c2;cursor:pointer;font-size:9px;font-weight:850;letter-spacing:.7px;text-align:left;transition:.14s ease}
      .palette-launch:hover{background:#172026;border-color:rgba(25,214,163,.3);color:#54f2c8;transform:translateY(-1px)}
      .palette-launch span:last-child{color:#4f5d59;font-family:monospace;font-size:8px}
      .palette-modal{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(3,6,8,.76);backdrop-filter:blur(8px)}
      .palette-modal.open{display:flex}
      .palette-window{width:min(820px,94vw);max-height:88vh;overflow:auto;background:#0b1114;border:1px solid #2b383f;border-radius:12px;box-shadow:0 28px 80px rgba(0,0,0,.55)}
      .palette-window-head{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #202a30}
      .palette-window-title{font-size:12px;font-weight:850;letter-spacing:.7px}.palette-window-title small{display:block;margin-top:3px;color:#596764;font-size:7px;letter-spacing:1px}
      .palette-window-close{width:30px;height:30px;border:1px solid #202a30;border-radius:7px;background:#10171b;color:#7d8987;cursor:pointer}.palette-window-close:hover{color:#fff;background:#172026}
      .palette-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 17px;border-bottom:1px solid #202a30}
      .palette-toolbar-info{color:#596764;font-size:8px}.palette-toolbar-actions{display:flex;gap:6px}
      .palette-list-ui{padding:15px 17px}.palette-category{margin-bottom:18px}.palette-category:last-child{margin-bottom:0}.palette-category-title{margin-bottom:8px;color:#19d6a3;font-size:8px;font-weight:900;letter-spacing:1.4px}
      .palette-grid-ui{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:7px}
      .palette-card{min-height:62px;display:grid;grid-template-columns:34px 1fr;align-items:center;gap:9px;padding:8px;border:1px solid #202a30;border-radius:8px;background:#10171b;color:#b9c5c2;text-align:left;cursor:pointer;transition:.12s ease}.palette-card:hover{background:#172026;border-color:#39474d;transform:translateY(-1px)}
      .palette-swatch-ui{width:30px;height:30px;border-radius:7px;border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
      .palette-card strong{display:block;font-size:9px;color:#edf4f2}.palette-card small{display:block;margin-top:3px;color:#5d6b67;font-size:7px;line-height:1.3}
      .palette-empty-ui{padding:32px;text-align:center;color:#53615e;font-size:9px;border:1px dashed #2b383f;border-radius:8px}
      .palette-editor-ui{display:none;padding:0 17px 17px}.palette-editor-ui.open{display:block}.palette-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:8px}.palette-editor-ui input,.palette-editor-ui select{width:100%;height:36px;padding:0 9px;background:#0d1418;border:1px solid #2b383f;border-radius:7px;color:#edf4f2}.palette-editor-ui label{display:block;margin-bottom:5px;color:#66736f;font-size:7px;font-weight:850;letter-spacing:1px;text-transform:uppercase}.palette-actions-row{display:flex;gap:6px;margin-top:9px}
      @media(max-width:650px){.palette-modal{padding:10px}.palette-window{max-height:94vh}.palette-editor-grid{grid-template-columns:1fr}.palette-toolbar{align-items:flex-start;flex-direction:column}.palette-toolbar-actions{width:100%}.palette-toolbar-actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function openModal() {
    const modal = document.getElementById("paletteModal");
    if (modal) modal.classList.add("open");
    render();
  }

  function closeModal() {
    document.getElementById("paletteModal")?.classList.remove("open");
    document.querySelector(".palette-editor-ui")?.classList.remove("open");
  }

  function render() {
    state();
    const list = document.querySelector("[data-palette-list-ui]");
    const empty = document.querySelector("[data-palette-empty-ui]");
    if (!list) return;
    list.innerHTML = "";
    const groups = {};
    State.palettes.forEach(p => (groups[categoryKey(p.category)] ||= []).push(p));
    Object.entries(groups).forEach(([category, palettes]) => {
      const section = document.createElement("section");
      section.className = "palette-category";
      section.innerHTML = `<div class="palette-category-title">${category.toUpperCase()}</div>`;
      const grid = document.createElement("div");
      grid.className = "palette-grid-ui";
      palettes.forEach(palette => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "palette-card";
        const hue = Number(palette.values?.hue ?? 0);
        const sat = Number(palette.values?.sat ?? 0);
        const intensity = Number(palette.values?.intensity ?? 100);
        const light = Math.max(18, Math.min(82, 28 + intensity * .42));
        button.innerHTML = `<span class="palette-swatch-ui" style="background:hsl(${hue} ${sat}% ${light}%);"></span><span><strong>${State.palettes.indexOf(palette) + 1}. ${clean(palette.name)}</strong><small>${preview(palette)}</small></span>`;
        button.addEventListener("click", () => {
          const result = apply(palette.name);
          if (result.ok) closeModal();
        });
        grid.appendChild(button);
      });
      section.appendChild(grid);
      list.appendChild(section);
    });
    if (empty) empty.style.display = State.palettes.length ? "none" : "block";
  }

  function createUI() {
    if (document.getElementById("paletteModal")) return;
    injectStyles();

    const quickPanel = document.querySelector("#page-live .groups-panel .panel-body");
    if (quickPanel && !document.getElementById("paletteLaunch")) {
      const launch = document.createElement("button");
      launch.type = "button";
      launch.id = "paletteLaunch";
      launch.className = "palette-launch";
      launch.innerHTML = `<span>PALETTES</span><span>LIBRARY ↗</span>`;
      launch.addEventListener("click", openModal);
      quickPanel.appendChild(launch);
    }

    const modal = document.createElement("div");
    modal.id = "paletteModal";
    modal.className = "palette-modal";
    modal.innerHTML = `
      <div class="palette-window" role="dialog" aria-modal="true" aria-label="Palette library">
        <div class="palette-window-head"><div class="palette-window-title">PALETTE LIBRARY<small>LIVE PROGRAMMER</small></div><button type="button" class="palette-window-close" aria-label="Close">×</button></div>
        <div class="palette-toolbar"><div class="palette-toolbar-info">Capture reusable programmer looks and recall them on the current selection.</div><div class="palette-toolbar-actions"><button type="button" class="btn-primary" data-palette-new>＋ Record Palette</button></div></div>
        <div class="palette-list-ui" data-palette-list-ui></div>
        <div class="palette-empty-ui" data-palette-empty-ui>No palettes recorded yet.</div>
        <div class="palette-editor-ui" data-palette-editor-ui>
          <div class="section-divider"><span>PALETTE EDITOR</span></div>
          <div class="palette-editor-grid"><div><label>Name</label><input data-palette-name-ui placeholder="e.g. Deep Blue"></div><div><label>Category</label><select data-palette-category-ui><option>Colour</option><option>Intensity</option><option>Position</option><option>Beam</option><option>General</option></select></div></div>
          <div class="palette-actions-row"><button type="button" class="btn-primary" data-palette-save-ui>Save</button><button type="button" class="btn-secondary" data-palette-close-ui>Cancel</button></div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector(".palette-window-close").addEventListener("click", closeModal);
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    modal.querySelector("[data-palette-new]").addEventListener("click", () => {
      const editor = modal.querySelector("[data-palette-editor-ui]");
      editor.classList.add("open");
      modal.querySelector("[data-palette-name-ui]").value = "";
      modal.querySelector("[data-palette-name-ui]").focus();
    });
    modal.querySelector("[data-palette-close-ui]").addEventListener("click", () => modal.querySelector("[data-palette-editor-ui]").classList.remove("open"));
    modal.querySelector("[data-palette-save-ui]").addEventListener("click", () => {
      const name = modal.querySelector("[data-palette-name-ui]").value;
      const category = modal.querySelector("[data-palette-category-ui]").value;
      const result = record(name, category);
      if (result.ok) modal.querySelector("[data-palette-editor-ui]").classList.remove("open");
      else window.log?.(result.message, "warn");
    });
    render();
  }

  function installNumericCommandSupport() {
    if (window.__paletteNumericCommandsInstalled) return;
    const previous = window.parseCommand;
    if (typeof previous !== "function") return;
    window.parseCommand = function (raw) {
      const command = clean(raw);
      let match;
      if ((match = command.match(/^palette\s+(\d+)$/i))) {
        const result = apply(Number(match[1]));
        if (!result.ok) window.log?.(result.message, "warn");
        return result;
      }
      if ((match = command.match(/^update\s+palette\s+(\d+)$/i))) {
        const result = update(Number(match[1]));
        if (!result.ok) window.log?.(result.message, "warn");
        return result;
      }
      if ((match = command.match(/^delete\s+palette\s+(\d+)$/i))) {
        const result = remove(Number(match[1]));
        if (!result.ok) window.log?.(result.message, "warn");
        return result;
      }
      return previous.apply(this, arguments);
    };
    window.__paletteNumericCommandsInstalled = true;
  }

  window.Palettes = { record, apply, update, delete: remove, list: () => state().palettes, refresh: render, open: openModal };

  function boot() {
    state();
    createUI();
    installNumericCommandSupport();
    setInterval(() => {
      if (!document.getElementById("paletteModal")) createUI();
      installNumericCommandSupport();
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
