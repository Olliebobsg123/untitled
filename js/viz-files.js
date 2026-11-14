"use strict";

/*
 * Visualiser files (.lsviz): the stage, set pieces, view settings and where
 * every light hangs and points, saved on their own, so a venue can be loaded
 * into the visualiser without touching the console show (or one venue used
 * for many shows).
 *
 * Each light's beam shaping goes with it: its beam angle, edge (soft/hard
 * focus) and barn doors / shutters, set on the Beam tab (stored on the light
 * in the console, so kept here as "lights").
 *
 * Lights are matched by fixture number when the file is opened, so a layout
 * saved with one show lands on the right lights in another.
 *
 * Preferences → Show File → Visualiser: "Together" (default, the visualiser
 * is saved in show files too) or "Separate files" (show files leave it alone).
 *
 * App menu → Save / Open visualiser file…, or "save viz" / "open viz".
 * Opening a whole Light Spark show file here takes just its visualiser.
 */
(function () {
  if (window.LXVizFiles) return;
  const say = (m, t = "ok") => window.log?.(m, t);
  const S = () => window.State || {};
  const FORMAT = "light-spark-visualiser";

  // The beam shaping kept on each light (js/controls.js).
  const SHAPING = ["beamAngle", "edge", "manualShutters"];
  function shapingOf(fixtures) {
    const out = {};
    for (const f of (fixtures || []).filter(Boolean)) {
      const own = {};
      for (const k of SHAPING) if (f[k] != null) own[k] = JSON.parse(JSON.stringify(f[k]));
      if (Object.keys(own).length) out[f.id] = own;
    }
    return out;
  }

  function snapshot() {
    const layout = window.LXVisualizer?.toShow?.();
    if (!layout) return null;
    const numbers = {};
    for (const f of (S().fixtures || []).filter(Boolean)) if (f.fixtureNumber != null) numbers[f.id] = f.fixtureNumber;
    return { format: FORMAT, version: 1, savedAt: new Date().toISOString(), show: window.LXShowCommands?.name?.() || "", numbers, visualizer: layout, lights: shapingOf(S().fixtures) };
  }

  // Positions and aims are kept by light; move them onto this show's lights
  // by fixture number (or keep the id when it's the same show).
  function remap(file) {
    const layout = JSON.parse(JSON.stringify(file.visualizer));
    const here = new Map((S().fixtures || []).filter(Boolean).map(f => [String(f.fixtureNumber), f.id]));
    const ids = new Set((S().fixtures || []).filter(Boolean).map(f => f.id));
    const numbers = file.numbers || {};
    let placed = 0, unknown = 0;
    for (const key of ["positions", "aims"]) {
      const from = layout[key] || {};
      const to = {};
      for (const [id, v] of Object.entries(from)) {
        const target = ids.has(id) ? id : here.get(String(numbers[id]));
        if (target) { to[target] = v; if (key === "positions") placed++; }
        else if (key === "positions") unknown++;
      }
      layout[key] = to;
    }
    // Beam angle, edge and barn doors onto the matching lights. A light the
    // file has nothing for keeps its own.
    let shaped = 0;
    if (file.lights && typeof file.lights === "object") {
      const byId = new Map((S().fixtures || []).filter(Boolean).map(f => [f.id, f]));
      for (const [id, own] of Object.entries(file.lights)) {
        const f = byId.get(ids.has(id) ? id : here.get(String(numbers[id])));
        if (!f || !own || typeof own !== "object") continue;
        for (const k of SHAPING) { if (own[k] == null) delete f[k]; else f[k] = JSON.parse(JSON.stringify(own[k])); }
        shaped++;
      }
      if (shaped) { window.sendToVisualizer?.(true); window.renderControls?.(); }
    }
    return { layout, placed, unknown, shaped };
  }

  function download(text, file) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function save() {
    const data = snapshot();
    if (!data) return say("The visualiser isn't ready yet", "warn");
    const base = (data.show || "Visualiser").replace(/\.json$/i, "").replace(/[^\w .-]/g, "") || "Visualiser";
    const file = `${base}.lsviz`;
    download(JSON.stringify(data, null, 2), file);
    say(`${file} saved in your Shows folder: the stage, set, ${Object.keys(data.visualizer.positions || {}).length} light positions and focus, and the beam shaping of ${Object.keys(data.lights).length} light${Object.keys(data.lights).length === 1 ? "" : "s"}`, "ok");
    return data;
  }

  async function openFile(file) {
    const json = JSON.parse(await file.text());
    let data = null;
    if (json?.format === FORMAT && json.visualizer) data = json;
    else if (json?.format === "lx-console-show" && json.visualizer) {
      const numbers = {};
      for (const f of (json.fixtures || []).filter(Boolean)) if (f.fixtureNumber != null) numbers[f.id] = f.fixtureNumber;
      data = { visualizer: json.visualizer, numbers, lights: shapingOf(json.fixtures) };
    }
    if (!data) throw new Error("there's no visualiser layout in that file");
    const r = remap(data);
    window.LXVisualizer?.fromShow?.(r.layout);
    say(`Visualiser loaded from ${file.name}: ${r.layout.venue ? "the stage and set, " : ""}${r.placed} light position${r.placed === 1 ? "" : "s"}${r.shaped ? `, beam angle, edge and barn doors for ${r.shaped}` : ""}${r.unknown ? ` (${r.unknown} for lights this show doesn't have)` : ""} — the console show wasn't changed`, "ok");
    return r;
  }

  async function open() {
    const files = window.LXShowFiles;
    if (files?.openFileDialog) {
      try {
        const f = await files.openFileDialog("Open Visualiser File", "Visualiser file or show", ["lsviz", "json"]);
        if (f) await openFile({ name: f.name, text: async () => f.text });
      } catch (e) { console.error("[VIZ FILE]", e); say(`Couldn't open that visualiser file: ${e.message || e}`, "error"); }
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".lsviz,.json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (file) openFile(file).catch(e => { console.error("[VIZ FILE]", e); say(`Couldn't open that visualiser file: ${e.message || e}`, "error"); });
    });
    document.body.appendChild(input);
    input.click();
  }

  function command(c) {
    if (/^(save|export)( as)? (viz|vis|visuali[sz]er)( file)?$/.test(c)) { save(); return true; }
    if (/^(open|load|import) (viz|vis|visuali[sz]er)( file)?$/.test(c)) { open(); return true; }
    if (/^(my files|show files|show my files|files|where are my files|finder)$/.test(c)) { window.LXShowFiles?.revealShows?.("").then(dir => say(`Your files are all in ${dir}`, "info")); return true; }
    return false;
  }

  // Buttons in Preferences → Show File.
  document.addEventListener("click", e => {
    if (e.target.closest("#prefVizSave")) save();
    else if (e.target.closest("#prefVizOpen")) open();
  });

  window.LXVizFiles = { save, open, openFile, snapshot, command };
})();
