"use strict";

(function initPaletteSystem() {
  const FIELD_LABELS = {
    intensity: "Intensity",
    hue: "Hue",
    sat: "Saturation",
    pan: "Pan",
    tilt: "Tilt",
    strobe: "Strobe",
    gobo: "Gobo",
    gobo2: "Gobo 2",
    prism: "Prism",
    focus: "Focus",
    zoom: "Zoom",
    frost: "Frost",
    iris: "Iris",
    rot: "Rotation",
    effect: "Effect",
    speed: "Speed",
    amber: "Amber",
    uv: "UV"
  };

  const PALETTE_FIELDS = Object.keys(FIELD_LABELS);

  function ensureState() {
    window.State = window.State || {};
    if (!Array.isArray(State.palettes)) State.palettes = [];
    if (!(State.selected instanceof Set)) State.selected = new Set();
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
    if (!State.current || typeof State.current !== "object") State.current = {};
    return State;
  }

  function selectedFixtures() {
    ensureState();
    return (State.fixtures || []).filter(f => State.selected.has(f.id));
  }

  function snapshotState() {
    ensureState();
    const values = {};
    PALETTE_FIELDS.forEach(field => {
      const value = State.current[field];
      if (Number.isFinite(Number(value))) values[field] = Number(value);
    });
    return values;
  }

  function applyValues(values) {
    ensureState();
    const selected = selectedFixtures();
    Object.assign(State.current, values);

    selected.forEach(fixture => {
      const current = typeof window.ensureFixtureState === "function"
        ? window.ensureFixtureState(fixture.id)
        : (State.fixtureStates.get(fixture.id) || {});
      Object.assign(current, values);
      State.fixtureStates.set(fixture.id, current);
    });

    if (typeof window.fadeTo === "function") window.fadeTo(values, 250);
    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.renderFixtures === "function") window.renderFixtures();
    if (typeof window.buildControls === "function") window.buildControls();
    if (typeof window.updateColourWheel === "function") window.updateColourWheel();
    refreshPaletteUI();
  }

  function normaliseName(name) {
    return String(name || "").trim().replace(/\s+/g, " ");
  }

  function findPalette(name) {
    const target = normaliseName(name).toLowerCase();
    return State.palettes.find(p => String(p.name).toLowerCase() === target) || null;
  }

  function recordPalette(name, category = "General") {
    ensureState();
    const clean = normaliseName(name);
    if (!clean) return { ok: false, message: "Palette name cannot be empty" };
    const fixtures = selectedFixtures();
    if (!fixtures.length) return { ok: false, message: "Select at least one fixture before recording a palette" };

    const existing = findPalette(clean);
    if (existing) return { ok: false, message: `Palette \"${clean}\" already exists — use update palette ${clean}` };

    const palette = {
      id: `palette-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: clean,
      category: normaliseName(category) || "General",
      values: snapshotState(),
      createdAt: new Date().toISOString(),
      fixtureCount: fixtures.length
    };
    State.palettes.push(palette);
    refreshPaletteUI();
    return { ok: true, palette };
  }

  function updatePalette(name) {
    ensureState();
    const palette = findPalette(name);
    if (!palette) return { ok: false, message: `Palette \"${normaliseName(name)}\" not found` };
    if (!selectedFixtures().length) return { ok: false, message: "Select at least one fixture before updating a palette" };
    palette.values = snapshotState();
    palette.updatedAt = new Date().toISOString();
    palette.fixtureCount = selectedFixtures().length;
    refreshPaletteUI();
    return { ok: true, palette };
  }

  function applyPalette(name) {
    ensureState();
    const palette = findPalette(name);
    if (!palette) return { ok: false, message: `Palette \"${normaliseName(name)}\" not found` };
    if (!selectedFixtures().length) return { ok: false, message: "Select at least one fixture before applying a palette" };
    applyValues({ ...palette.values });
    return { ok: true, palette };
  }

  function deletePalette(name) {
    ensureState();
    const target = normaliseName(name).toLowerCase();
    const index = State.palettes.findIndex(p => String(p.name).toLowerCase() === target);
    if (index < 0) return { ok: false, message: `Palette \"${normaliseName(name)}\" not found` };
    const [removed] = State.palettes.splice(index, 1);
    refreshPaletteUI();
    return { ok: true, palette: removed };
  }

  function listPalettes() {
    ensureState();
    return State.palettes.slice();
  }

  function valuePreview(palette) {
    const values = palette.values || {};
    const parts = [];
    if (values.intensity != null) parts.push(`${values.intensity}%`);
    if (values.hue != null && values.sat != null) parts.push(`H${values.hue} S${values.sat}`);
    if (values.pan != null || values.tilt != null) parts.push(`P${values.pan ?? "-"} T${values.tilt ?? "-"}`);
    if (values.zoom != null) parts.push(`Z${values.zoom}`);
    if (values.gobo != null) parts.push(`G${values.gobo}`);
    return parts.join(" · ") || "Programmer state";
  }

  function categoryOf(palette) {
    return normaliseName(palette.category) || "General";
  }

  function refreshPaletteUI() {
    const root = document.getElementById("paletteWorkspace");
    if (!root) return;
    const list = root.querySelector("[data-palette-list]");
    const empty = root.querySelector("[data-palette-empty]");
    if (!list) return;
    list.innerHTML = "";

    ensureState();
    const categories = {};
    State.palettes.forEach(p => {
      const category = categoryOf(p);
      (categories[category] ||= []).push(p);
    });

    Object.entries(categories).forEach(([category, palettes]) => {
      const section = document.createElement("div");
      section.className = "palette-category";
      const title = document.createElement("div");
      title.className = "palette-category-title";
      title.textContent = category.toUpperCase();
      section.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "palette-grid";
      palettes.forEach(palette => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "palette-button";
        button.dataset.paletteName = palette.name;

        const swatch = document.createElement("span");
        swatch.className = "palette-swatch";
        const hue = Number(palette.values?.hue ?? 0);
        const sat = Number(palette.values?.sat ?? 0);
        const light = Number(palette.values?.light ?? 50);
        swatch.style.background = `hsl(${hue} ${sat}% ${light}%)`;
        button.appendChild(swatch);

        const text = document.createElement("span");
        text.className = "palette-button-text";
        text.innerHTML = `<strong>${escapeHtml(palette.name)}</strong><small>${escapeHtml(valuePreview(palette))}</small>`;
        button.appendChild(text);
        button.addEventListener("click", () => {
          const result = applyPalette(palette.name);
          if (result.ok) window.log?.(`Applied palette: ${palette.name}`, "ok");
          else window.log?.(result.message, "warn");
        });
        grid.appendChild(button);
      });
      section.appendChild(grid);
      list.appendChild(section);
    });

    if (empty) empty.style.display = State.palettes.length ? "none" : "block";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\": "&quot;" }[ch] || ch));
  }

  function createPaletteWorkspace() {
    if (document.getElementById("paletteWorkspace")) return;
    const livePage = document.getElementById("page-live");
    if (!livePage) return;

    const panel = document.createElement("section");
    panel.className = "panel palette-panel";
    panel.id = "paletteWorkspace";
    panel.innerHTML = `
      <div class="panel-header palette-header">
        <div><span class="eyebrow">04</span> Palettes</div>
        <span class="panel-meta">PROGRAMMER</span>
      </div>
      <div class="panel-body palette-body">
        <div class="palette-toolbar">
          <div>
            <strong>Palette Library</strong>
            <span>Capture reusable looks from the current programmer state.</span>
          </div>
          <div class="palette-actions">
            <button type="button" class="btn-secondary" data-palette-record>＋ Record</button>
            <button type="button" class="btn-secondary" data-palette-update>↻ Update</button>
          </div>
        </div>
        <div class="palette-list" data-palette-list></div>
        <div class="palette-empty" data-palette-empty>No palettes recorded yet.</div>
        <div class="palette-editor" data-palette-editor hidden>
          <div class="section-divider"><span>PALETTE EDITOR</span></div>
          <div class="form-grid">
            <div class="form-row form-span"><label>Name</label><input data-palette-name placeholder="e.g. Deep Blue"></div>
            <div class="form-row"><label>Category</label><select data-palette-category><option>Colour</option><option>Intensity</option><option>Position</option><option>Beam</option><option>General</option></select></div>
          </div>
          <div class="action-row">
            <button type="button" class="btn-primary" data-palette-save>Save Palette</button>
            <button type="button" class="btn-danger-soft" data-palette-delete>Delete Palette</button>
            <button type="button" class="btn-secondary" data-palette-close>Close</button>
          </div>
        </div>
      </div>`;

    livePage.querySelector(".live-grid")?.insertAdjacentElement("afterend", panel);

    panel.querySelector("[data-palette-record]").addEventListener("click", () => openEditor());
    panel.querySelector("[data-palette-update]").addEventListener("click", () => {
      const name = window.prompt("Palette name to update:");
      if (!name) return;
      const result = updatePalette(name);
      window.log?.(result.ok ? `Updated palette: ${name}` : result.message, result.ok ? "ok" : "warn");
    });
    panel.querySelector("[data-palette-save]").addEventListener("click", saveFromEditor);
    panel.querySelector("[data-palette-delete]").addEventListener("click", () => {
      const name = panel.querySelector("[data-palette-name]").value;
      const result = deletePalette(name);
      window.log?.(result.ok ? `Deleted palette: ${name}` : result.message, result.ok ? "ok" : "warn");
      if (result.ok) closeEditor();
    });
    panel.querySelector("[data-palette-close]").addEventListener("click", closeEditor);
    refreshPaletteUI();
  }

  function openEditor(name = "") {
    const editor = document.querySelector("[data-palette-editor]");
    if (!editor) return;
    editor.hidden = false;
    const input = editor.querySelector("[data-palette-name]");
    input.value = name;
    input.focus();
  }

  function closeEditor() {
    const editor = document.querySelector("[data-palette-editor]");
    if (editor) editor.hidden = true;
  }

  function saveFromEditor() {
    const editor = document.querySelector("[data-palette-editor]");
    if (!editor) return;
    const name = normaliseName(editor.querySelector("[data-palette-name]").value);
    const category = editor.querySelector("[data-palette-category").value;
    const result = recordPalette(name, category);
    window.log?.(result.ok ? `Recorded palette: ${name}` : result.message, result.ok ? "ok" : "warn");
    if (result.ok) closeEditor();
  }

  window.Palettes = {
    record: recordPalette,
    update: updatePalette,
    apply: applyPalette,
    delete: deletePalette,
    list: listPalettes,
    refresh: refreshPaletteUI,
    openEditor
  };

  function boot() {
    ensureState();
    createPaletteWorkspace();
    refreshPaletteUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
