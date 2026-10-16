"use strict";

// Show files: everything about a show (patch, groups, cues, chases, effects,
// palettes, targets, the look on stage, visualiser layout, outputs, QLab links,
// Tapo bulbs) in one JSON file.
//
//   save my-show.json / load my-show.json      on the command line (Documents/LX Console Shows)
//   Save Show / Load Show buttons               download / pick a file
//
// The console also keeps an autosave of the current show, so closing the app (or
// a crash) doesn't lose the patch and cues: it comes back on the next start.
(() => {
  const FORMAT = "lx-console-show";
  const VERSION = 8;
  const AUTOSAVE_KEY = "lx-autosave";
  const AUTOSAVE_EVERY_MS = 5000;

  // Live engine handles never go into a show.
  const TRANSIENT = new Set(["chaseTimer", "fading", "Viz", "effectFrame", "followTimer"]);
  const clone = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    if (value instanceof Map) return [...value.entries()].map(([k, v]) => [k, clone(v)]);
    if (value instanceof Set) return [...value];
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!TRANSIENT.has(key)) out[key] = clone(item);
    return out;
  };
  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  };
  const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  };
  const report = (message, level = "ok") => window.log?.(message, level);

  // --- Visualiser layout ---
  // Kept here in the console (State.visualizer) so it is saved with the show
  // whether or not the visualiser window is open. In the file it keeps the
  // format older versions wrote: lists of { fixtureId, fixtureIndex, x, y, z }.

  function layoutToFile(layout) {
    const fixtures = State.fixtures || [];
    const indexOf = id => fixtures.findIndex(f => String(f.id) === String(id));
    return {
      fixturePositions: Object.entries(layout?.positions || {}).map(([fixtureId, p]) => ({ fixtureId, fixtureIndex: indexOf(fixtureId), x: p.x, y: p.y, z: p.z })),
      fixtureManualRot: Object.entries(layout?.rotations || {}).map(([fixtureId, r]) => ({ fixtureId, fixtureIndex: indexOf(fixtureId), pan: r.pan, tilt: r.tilt })),
      gridOn: layout?.gridOn !== false,
      houseOn: Boolean(layout?.houseOn),
      workOn: Boolean(layout?.workOn),
      beamsOn: layout?.beamsOn !== false
    };
  }

  function layoutFromFile(saved, fixtures) {
    const idFor = entry => {
      if (entry?.fixtureId != null && fixtures.some(f => String(f.id) === String(entry.fixtureId))) return String(entry.fixtureId);
      const byIndex = fixtures[Number(entry?.fixtureIndex)];
      return byIndex ? String(byIndex.id) : null;
    };
    const layout = { positions: {}, rotations: {}, gridOn: saved?.gridOn !== false, houseOn: Boolean(saved?.houseOn), workOn: Boolean(saved?.workOn), beamsOn: saved?.beamsOn !== false };
    for (const entry of saved?.fixturePositions || []) {
      const id = idFor(entry);
      const [x, y, z] = [entry.x, entry.y, entry.z].map(Number);
      if (id && [x, y, z].every(Number.isFinite)) layout.positions[id] = { x, y, z };
    }
    for (const entry of saved?.fixtureManualRot || []) {
      const id = idFor(entry);
      const [pan, tilt] = [entry.pan, entry.tilt].map(Number);
      if (id && [pan, tilt].every(Number.isFinite)) layout.rotations[id] = { pan, tilt };
    }
    return layout;
  }

  // --- Settings kept outside State: outputs, QLab, Tapo bulbs ---

  function snapshotExternal(fixtures) {
    const qlab = window.QLab;
    return {
      qlab: {
        connection: qlab ? { ip: qlab.ip, bridgePort: qlab.bridgePort, passcode: qlab.passcode } : readJSON("qlabConnectionSettings", {}),
        cueLinks: clone(qlab?.cueLinks) || readJSON("qlabCueLinks", {}),
        timeTriggers: clone(qlab?.timeTriggers) || readJSON("qlabTimeTriggers", {})
      },
      tapo: fixtures.filter(f => f?.tapo).map(f => ({ fixtureId: String(f.id), ip: f.tapo.ip || "", email: f.tapo.email || "", password: f.tapo.password || "" })),
      multiOutputs: window.LXOutputs?.list() || readJSON("lighting-multi-outputs", []),
      networkTarget: (() => { try { return localStorage.getItem("lighting-network-target") || ""; } catch (_) { return ""; } })()
    };
  }

  function restoreExternal(show, fixtures) {
    const external = show.externalSettings || {};
    for (const saved of external.tapo || show.tapoSettings || []) {
      const fixture = fixtures.find(f => String(f.id) === String(saved?.fixtureId));
      if (!fixture) continue;
      fixture.transport = "tapo";
      fixture.tapo = { ip: String(saved.ip || ""), email: String(saved.email || ""), password: String(saved.password || "") };
      fixture.addr = null;
      fixture.uni = null;
    }

    const qlab = external.qlab || show.qlab || {};
    if (qlab.connection) writeJSON("qlabConnectionSettings", qlab.connection);
    if (qlab.cueLinks) writeJSON("qlabCueLinks", qlab.cueLinks);
    if (qlab.timeTriggers) writeJSON("qlabTimeTriggers", qlab.timeTriggers);
    if (window.QLab) {
      const connection = qlab.connection || {};
      if (connection.ip != null) window.QLab.ip = String(connection.ip);
      if (connection.bridgePort != null) window.QLab.bridgePort = Number(connection.bridgePort) || 8083;
      if (connection.passcode != null) window.QLab.passcode = String(connection.passcode);
      if (qlab.cueLinks) window.QLab.cueLinks = clone(qlab.cueLinks);
      if (qlab.timeTriggers) window.QLab.timeTriggers = clone(qlab.timeTriggers);
      window.QLab.saveStoredLinks?.();
      window.QLab.renderLinkEditor?.();
      window.QLab.renderCueSync?.();
    }

    if (external.networkTarget) {
      try { localStorage.setItem("lighting-network-target", String(external.networkTarget)); } catch (_) {}
    }
    const outputs = Array.isArray(external.multiOutputs) ? external.multiOutputs : external.outputSettings?.outputs;
    if (Array.isArray(outputs)) window.dispatchEvent(new CustomEvent("show-multi-output-restore", { detail: { outputs } }));
  }

  // --- The show ---

  function snapshotShow() {
    const fixtures = State.fixtures || [];
    const effects = clone(State.savedEffects || {});
    return {
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString(),
      fixtures: clone(fixtures),
      groups: clone(State.groups || []),
      cues: clone(State.cues || []),
      chases: clone(State.chases || []),
      savedEffects: effects,
      effects,
      effectTargetMode: String(State.effectTargetMode || "selected"),
      effectTargetIds: [...(State.effectTargetIds || [])],
      palettes: clone(State.palettes || []),
      targets: clone(State.targets || []),
      fixtureStates: clone(State.fixtureStates || new Map()),
      current: clone(State.current || {}),
      selectedFixtureId: State.selectedFixtureId ?? null,
      selected: [...(State.selected || [])],
      currentCue: Number.isInteger(State.currentCue) ? State.currentCue : -1,
      chaseFade: Number(State.chaseFade) || 800,
      chaseWait: Number(State.chaseWait) || 500,
      selectedEffectName: String(document.getElementById("effectName")?.value || "").trim() || null,
      visualizer: layoutToFile(State.visualizer),
      externalSettings: snapshotExternal(fixtures)
    };
  }

  function normaliseEffects(raw) {
    const effects = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return effects;
    for (const [key, effect] of Object.entries(raw)) {
      if (!effect || typeof effect !== "object") continue;
      const name = String(effect.name || key).trim();
      if (!name) continue;
      const fixtureIds = Array.isArray(effect.fixtureIds) ? effect.fixtureIds.map(String) : [];
      effects[name] = {
        ...clone(effect),
        name,
        type: String(effect.type || "rainbow").toLowerCase(),
        speed: Number.isFinite(Number(effect.speed)) ? Number(effect.speed) : 1,
        fixtureMode: ["selected", "all", "custom"].includes(effect.fixtureMode) ? effect.fixtureMode : fixtureIds.length ? "custom" : "selected",
        fixtureIds
      };
    }
    return effects;
  }

  function normaliseChases(raw, cueCount) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean).map(source => {
      const chase = clone(source);
      chase.name = String(chase.name || "Unnamed Chase").trim();
      chase.fixtureIds = Array.isArray(chase.fixtureIds) ? chase.fixtureIds.map(String) : [];
      chase.speed = Math.max(10, Math.min(100, Number(chase.speed) || 50));
      chase.fade = Math.max(0, Math.min(60000, Number(chase.fade) || 0));
      chase.loop = chase.loop !== false;
      chase.mode = ["sequence", "spread", "snapshot"].includes(chase.mode) ? chase.mode : "sequence";
      chase.steps = Array.isArray(chase.steps) ? chase.steps.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < cueCount) : [];
      chase.snapshots = Array.isArray(chase.snapshots)
        ? chase.snapshots.map(snapshot => ({
          globalState: clone(snapshot?.globalState || snapshot?.state || {}),
          fixtureStates: Array.isArray(snapshot?.fixtureStates) ? snapshot.fixtureStates.filter(x => Array.isArray(x) && x.length > 1).map(x => [x[0], clone(x[1])]) : []
        }))
        : [];
      return chase;
    });
  }

  function stopPlayback() {
    window.stopEffect?.(true);
    window.stopChase?.(false);
    window.stopCueTimers?.();
    window.stopFade?.();
  }

  function restoreShow(show) {
    if (!show || typeof show !== "object" || (show.format && show.format !== FORMAT)) throw new Error("Not a valid LX Console show file");
    stopPlayback();
    const fixtures = Array.isArray(show.fixtures) ? show.fixtures : [];
    State.fixtures = fixtures;
    State.groups = Array.isArray(show.groups) ? show.groups : [];
    State.cues = Array.isArray(show.cues) ? show.cues : [];
    State.chases = normaliseChases(show.chases, State.cues.length);
    State.savedEffects = normaliseEffects(show.savedEffects || show.effects);
    State.effectTargetMode = String(show.effectTargetMode || "selected");
    State.effectTargetIds = new Set(Array.isArray(show.effectTargetIds) ? show.effectTargetIds.map(String) : []);
    State.palettes = Array.isArray(show.palettes) ? show.palettes : [];
    State.targets = Array.isArray(show.targets) ? show.targets : [];
    State.current = show.current && typeof show.current === "object" ? clone(show.current) : {};
    State.selectedFixtureId = show.selectedFixtureId ?? null;
    State.selected = new Set(Array.isArray(show.selected) ? show.selected : []);
    State.currentCue = Number.isInteger(show.currentCue) ? show.currentCue : -1;
    State.currentChase = -1;
    State.chaseFade = Number(show.chaseFade) || 800;
    State.chaseWait = Number(show.chaseWait) || 500;
    State.fixtureStates = new Map((Array.isArray(show.fixtureStates) ? show.fixtureStates : []).map(([id, value]) => [String(id), clone(value)]));
    State.visualizer = layoutFromFile(show.visualizer, fixtures);
    restoreExternal(show, fixtures);

    window.LXFixtureEditor?.install();
    window.initFixtureStates?.();
    window.renderLibrary?.();
    window.renderFixtures?.();
    window.renderGroups?.();
    window.renderCues?.();
    window.renderChases?.();
    window.renderEffectsList?.();
    window.buildControls?.();
    window.updateControlVisibility?.();
    window.updateDMX?.();
    window.sendVisualizerLayout?.();

    const effect = State.savedEffects[String(show.selectedEffectName || "")];
    if (effect) {
      const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
      set("effectName", effect.name);
      set("effectType", effect.type);
      set("effectSpeed", effect.speed);
      set("effectFixtureMode", effect.fixtureMode || "selected");
    }
    document.dispatchEvent(new CustomEvent("lx-show-loaded", { detail: show }));
  }

  // --- Files ---

  const cleanPath = raw => String(raw || "").trim().replace(/^['"]+|['"]+$/g, "").trim();
  const showFiles = () => {
    if (!window.LXShowFiles) throw new Error("Show files are unavailable — restart Light Spark");
    return window.LXShowFiles;
  };

  async function saveShow(path) {
    const requested = cleanPath(path);
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const result = await showFiles().save(requested, snapshotShow());
    report(`Show saved: ${result?.path || requested}`);
    return result;
  }

  async function loadShow(path) {
    const requested = cleanPath(path);
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const result = await showFiles().load(requested);
    restoreShow(result.show);
    report(`Show loaded: ${result?.path || requested}`);
    return result;
  }

  function downloadShow() {
    const blob = new Blob([JSON.stringify(snapshotShow(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `LightingShow_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report("Show saved");
  }

  async function openShowFile(file) {
    if (!file) return;
    try {
      restoreShow(JSON.parse(await file.text()));
      report(`Show loaded: ${file.name}`);
    } catch (error) {
      report(`Load failed: ${error.message || error}`, "error");
    }
  }

  LXCommands.add(raw => {
    const match = String(raw ?? "").trim().match(/^(save|load)\s+(.+)$/i);
    if (!match) return LXCommands.NOT_MINE;
    const action = match[1].toLowerCase();
    (action === "save" ? saveShow(match[2]) : loadShow(match[2])).catch(error => report(`${action.toUpperCase()} failed: ${error?.message || error}`, "error"));
    return undefined;
  });
  LXCommands.describe("save", "[filename.json]");
  LXCommands.describe("load", "[filename.json]");

  // --- Autosave: the current show, kept in this window's storage ---

  let lastAutosave = "";
  function autosave() {
    if (!State.fixtures?.length && !State.cues?.length) return;
    try {
      const snapshot = snapshotShow();
      delete snapshot.savedAt;
      const text = JSON.stringify(snapshot);
      if (text === lastAutosave) return;
      lastAutosave = text;
      localStorage.setItem(AUTOSAVE_KEY, text);
    } catch (error) {
      console.warn("[SHOW] Autosave failed:", error);
    }
  }

  function restoreAutosave() {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (!saved || State.fixtures?.length) return;
      restoreShow(JSON.parse(saved));
      lastAutosave = saved;
      report(`Restored your last session: ${State.fixtures.length} fixtures, ${State.cues.filter(Boolean).length} cues`);
    } catch (error) {
      report(`Your last session could not be restored: ${error.message}`, "warn");
    }
  }

  function wireButtons() {
    const input = document.getElementById("showFileInput");
    document.getElementById("btnSaveShow")?.addEventListener("click", event => {
      event.preventDefault();
      downloadShow();
    });
    document.getElementById("btnLoadShow")?.addEventListener("click", event => {
      event.preventDefault();
      input?.click();
    });
    input?.addEventListener("change", () => {
      openShowFile(input.files?.[0]);
      input.value = "";
    });
  }

  window.LXShow = Object.freeze({ snapshot: snapshotShow, restore: restoreShow, save: saveShow, load: loadShow, layoutToFile });
  window.saveShow = saveShow;
  window.loadShow = loadShow;

  // After the rest of the console has set up (scripts load in order; this runs once the page is ready).
  window.addEventListener("load", () => {
    wireButtons();
    restoreAutosave();
    setInterval(autosave, AUTOSAVE_EVERY_MS);
    window.addEventListener("beforeunload", autosave);
  });
})();
