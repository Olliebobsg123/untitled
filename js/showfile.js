"use strict";

/*
 * LX Console show-file system.
 *
 * This file is now the single source of truth for show save/load. It combines
 * the old show.js browser/UI behaviour with the newer showfile.js Electron
 * file bridge, including fixtures, Tapo settings, QLab, outputs, effects,
 * chases, fixture states and visualizer state..
 */
(function () {
  const cloneValue = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneValue);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (["chaseTimer", "fading", "Viz", "effectFrame"].includes(key)) continue;
      try { out[key] = cloneValue(item); } catch (_) {}
    }
    return out;
  };

  const readStoredJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  };

  const writeStoredJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  };

  const isTapoFixture = fixture => {
    const def = fixture && (window.FixtureLibrary?.[fixture.name] || fixture.definition);
    return def?.transport === "tapo" || fixture?.transport === "tapo" || !!fixture?.tapo;
  };

  function snapshotTapoSettings(fixtures) {
    return (Array.isArray(fixtures) ? fixtures : [])
      .filter(isTapoFixture)
      .map(fixture => {
        const config = fixture.tapo || {};
        return {
          fixtureId: String(fixture.id),
          ip: String(config.ip || "").trim(),
          email: String(config.email || "").trim(),
          password: String(config.password || "")
        };
      })
      .filter(config => config.ip || config.email || config.password);
  }

  function restoreTapoSettings(fixtures, settings) {
    if (!Array.isArray(fixtures) || !Array.isArray(settings)) return;
    const byId = new Map(settings.filter(x => x?.fixtureId != null).map(x => [String(x.fixtureId), x]));
    fixtures.forEach(fixture => {
      const config = byId.get(String(fixture?.id));
      if (!config) return;
      fixture.transport = "tapo";
      fixture.tapo = {
        ip: String(config.ip || "").trim(),
        email: String(config.email || "").trim(),
        password: String(config.password || "")
      };
      fixture.addr = null;
      fixture.uni = null;
    });
  }

  function getMultiOutputShowState() {
    const outputs = readStoredJSON("lighting-multi-outputs", []);
    return Array.isArray(outputs) ? outputs : [];
  }

  function getOutputSettingsShowState() {
    const result = { outputs: getMultiOutputShowState(), relay: null, legacy: null };
    const legacy = readStoredJSON("lighting-output-settings", null);
    if (legacy && typeof legacy === "object") result.legacy = cloneValue(legacy);
    try {
      const art = window.ArtNet;
      if (art && typeof art === "object") {
        result.relay = {
          protocol: "artnet",
          universe: Number.isFinite(Number(art.universe)) ? Number(art.universe) : 0,
          enabled: Boolean(art.enabled),
          fps: Number.isFinite(Number(art.fps)) ? Number(art.fps) : 25,
          port: 6454,
          name: "Lighting Console"
        };
      }
    } catch (_) {}
    result.outputs = result.outputs.map((output, index) => {
      const o = cloneValue(output) || {};
      const protocol = String(o.protocol || "artnet").toLowerCase();
      o.name = String(o.name || `Universe Output ${index + 1}`);
      o.protocol = ["artnet", "sacn", "usb"].includes(protocol) ? protocol : "artnet";
      o.port = Number.isInteger(Number(o.port)) ? Number(o.port) : (o.protocol === "sacn" ? 5568 : o.protocol === "artnet" ? 6454 : null);
      o.target = String(o.target || "");
      return o;
    });
    return result;
  }

  function restoreOutputSettingsShowState(settings) {
    if (!settings || typeof settings !== "object") return;
    if (settings.legacy && typeof settings.legacy === "object") writeStoredJSON("lighting-output-settings", settings.legacy);
    if (Array.isArray(settings.outputs)) {
      const outputs = settings.outputs.map((output, index) => {
        const o = cloneValue(output) || {};
        const protocol = String(o.protocol || "artnet").toLowerCase();
        o.name = String(o.name || `Universe Output ${index + 1}`);
        o.protocol = ["artnet", "sacn", "usb"].includes(protocol) ? protocol : "artnet";
        o.port = Number.isInteger(Number(o.port)) ? Number(o.port) : (o.protocol === "sacn" ? 5568 : o.protocol === "artnet" ? 6454 : null);
        return o;
      });
      writeStoredJSON("lighting-multi-outputs", outputs);
      window.dispatchEvent(new CustomEvent("show-multi-output-restore", { detail: { outputs } }));
    }
  }

  function snapshotExternalSettings(fixtures) {
    const liveQLab = window.QLab;
    const liveCueLinks = liveQLab?.cueLinks && typeof liveQLab.cueLinks === "object" ? cloneValue(liveQLab.cueLinks) : null;
    const liveTimeTriggers = liveQLab?.timeTriggers && typeof liveQLab.timeTriggers === "object" ? cloneValue(liveQLab.timeTriggers) : null;
    const storedConnection = readStoredJSON("qlabConnectionSettings", {});
    const connection = liveQLab && typeof liveQLab === "object" ? {
      ip: liveQLab.ip,
      bridgePort: liveQLab.bridgePort,
      passcode: liveQLab.passcode
    } : storedConnection;
    return {
      qlab: {
        connection: cloneValue(connection || storedConnection || {}),
        cueLinks: liveCueLinks || readStoredJSON("qlabCueLinks", {}),
        timeTriggers: liveTimeTriggers || readStoredJSON("qlabTimeTriggers", {})
      },
      tapo: snapshotTapoSettings(fixtures),
      multiOutputs: getMultiOutputShowState(),
      outputSettings: getOutputSettingsShowState(),
      networkTarget: (() => {
        try { return localStorage.getItem("lighting-network-target") || ""; } catch (_) { return ""; }
      })()
    };
  }

  function getVisualizerState() {
    if (window.S || window.VizState) return window.S || window.VizState;
    return null;
  }

  function snapshotVisualizerState() {
    const Viz = getVisualizerState();
    const result = { fixturePositions: [], fixtureManualRot: [], gridOn: true, houseOn: false, workOn: false };
    if (!Viz) return result;
    const fixtures = Array.isArray(State.fixtures) ? State.fixtures : [];
    fixtures.forEach((fx, index) => {
      const pos = Viz.fixturePositions?.get(index);
      if (pos) result.fixturePositions.push({ fixtureIndex: index, fixtureId: fx.id, x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) });
      const rot = Viz.fixtureManualRot?.get(index);
      if (rot) result.fixtureManualRot.push({ fixtureIndex: index, fixtureId: fx.id, pan: Number(rot.pan), tilt: Number(rot.tilt) });
    });
    result.gridOn = Viz.gridOn !== undefined ? Boolean(Viz.gridOn) : true;
    result.houseOn = Viz.houseOn !== undefined ? Boolean(Viz.houseOn) : false;
    result.workOn = Viz.workOn !== undefined ? Boolean(Viz.workOn) : false;
    return result;
  }

  function restoreVisualizerState(viz) {
    if (!viz || typeof viz !== "object") return;
    const Viz = getVisualizerState();
    if (!Viz) {
      window.__pendingShowVisualizerState = cloneValue(viz);
      return;
    }
    try {
      const positions = Array.isArray(viz.fixturePositions) ? viz.fixturePositions : [];
      const rotations = Array.isArray(viz.fixtureManualRot) ? viz.fixtureManualRot : [];
      if (typeof Viz.applyLoadedPositions === "function") {
        Viz.applyLoadedPositions(positions, rotations);
      } else {
        if (!(Viz.fixturePositions instanceof Map)) Viz.fixturePositions = new Map();
        if (!(Viz.fixtureManualRot instanceof Map)) Viz.fixtureManualRot = new Map();
        Viz.fixturePositions.clear();
        Viz.fixtureManualRot.clear();
        const fixtures = Array.isArray(State.fixtures) ? State.fixtures : [];
        const byId = new Map(fixtures.map((fx, index) => [String(fx?.id), index]));
        positions.forEach(saved => {
          const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId)) ? byId.get(String(saved.fixtureId)) : Number(saved?.fixtureIndex);
          if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) return;
          const x = Number(saved.x), y = Number(saved.y), z = Number(saved.z);
          if ([x, y, z].every(Number.isFinite)) Viz.fixturePositions.set(index, { x, y, z });
        });
        rotations.forEach(saved => {
          const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId)) ? byId.get(String(saved.fixtureId)) : Number(saved?.fixtureIndex);
          if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) return;
          const pan = Number(saved.pan), tilt = Number(saved.tilt);
          if ([pan, tilt].every(Number.isFinite)) Viz.fixtureManualRot.set(index, { pan, tilt });
        });
        Viz.rebuildFixtures?.();
      }
      if (Viz.grid) Viz.grid.visible = viz.gridOn !== false;
    } catch (error) {
      console.warn("[SHOW] Visualizer restore failed:", error);
    }
  }

  function snapshotSelectedEffect() {
    return String(document.getElementById("effectName")?.value || "").trim() || null;
  }

  function snapshotSelectedChase() {
    const list = document.getElementById("chaseList");
    if (!list) return -1;
    const active = list.querySelector(".cue-item.active");
    if (!active) return -1;
    return [...list.querySelectorAll(".cue-item")].indexOf(active);
  }

  function snapshotShow() {
    const state = window.State || {};
    const fixtures = Array.isArray(state.fixtures) ? state.fixtures : [];
    const effects = cloneValue(state.savedEffects || {});
    return {
      format: "lx-console-show",
      version: 7,
      savedAt: new Date().toISOString(),
      fixtures: cloneValue(fixtures),
      groups: cloneValue(state.groups || []),
      cues: cloneValue(state.cues || []),
      chases: cloneValue(state.chases || []),
      savedEffects: effects,
      effects,
      effectTargetMode: String(state.effectTargetMode || "selected"),
      effectTargetIds: state.effectTargetIds instanceof Set ? [...state.effectTargetIds] : Array.isArray(state.effectTargetIds) ? state.effectTargetIds.slice() : [],
      palettes: cloneValue(state.palettes || []),
      targets: cloneValue(state.targets || []),
      fixtureStates: state.fixtureStates instanceof Map ? [...state.fixtureStates.entries()].map(([id, value]) => [id, cloneValue(value)]) : [],
      current: cloneValue(state.current || {}),
      selectedFixtureId: state.selectedFixtureId ?? null,
      selected: state.selected instanceof Set ? [...state.selected] : [],
      currentCue: Number.isInteger(state.currentCue) ? state.currentCue : -1,
      currentChase: Number.isInteger(state.currentChase) ? state.currentChase : -1,
      activeChase: Number.isInteger(state.currentChase) && state.currentChase >= 0 ? state.currentChase : -1,
      activeEffect: state.activeEffect?.type ? cloneValue(state.activeEffect) : null,
      chaseFade: Number.isFinite(Number(state.chaseFade)) ? Number(state.chaseFade) : 800,
      chaseWait: Number.isFinite(Number(state.chaseWait)) ? Number(state.chaseWait) : 500,
      selectedEffectName: snapshotSelectedEffect(),
      selectedChaseIndex: snapshotSelectedChase(),
      visualizer: snapshotVisualizerState(),
      externalSettings: snapshotExternalSettings(fixtures)
    };
  }

  function stopLivePlayback() {
    try { window.stopEffect?.(true); } catch (_) {}
    try { window.stopChase?.(false); } catch (_) {}
    const state = window.State;
    if (!state) return;
    if (state.chaseTimer) { try { clearTimeout(state.chaseTimer); } catch (_) {} state.chaseTimer = null; }
    if (state.fading != null) { try { cancelAnimationFrame(state.fading); } catch (_) {} state.fading = null; }
    if (state.followTimer != null) { try { clearTimeout(state.followTimer); } catch (_) {} state.followTimer = null; }
    state.currentChase = -1;
    state.activeEffect = null;
    state.effectFrame = null;
  }

  function normaliseEffects(rawEffects) {
    if (!rawEffects || typeof rawEffects !== "object" || Array.isArray(rawEffects)) return {};
    const effects = {};
    for (const [key, raw] of Object.entries(rawEffects)) {
      if (!raw || typeof raw !== "object") continue;
      const name = String(raw.name || key).trim();
      if (!name) continue;
      const fixtureIds = Array.isArray(raw.fixtureIds) ? raw.fixtureIds.map(String) : [];
      effects[name] = {
        ...cloneValue(raw),
        name,
        type: String(raw.type || "rainbow").toLowerCase(),
        speed: Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : 1,
        fixtureMode: ["selected", "all", "custom"].includes(String(raw.fixtureMode)) ? String(raw.fixtureMode) : fixtureIds.length ? "custom" : "selected",
        fixtureIds
      };
    }
    return effects;
  }

  function normaliseChases(rawChases, cueCount) {
    if (!Array.isArray(rawChases)) return [];
    return rawChases.filter(Boolean).map(raw => {
      const chase = cloneValue(raw);
      chase.name = String(chase.name || "Unnamed Chase").trim();
      chase.fixtureIds = Array.isArray(chase.fixtureIds) ? chase.fixtureIds.map(String) : [];
      chase.speed = Math.max(10, Math.min(100, Number.isFinite(Number(chase.speed)) ? Number(chase.speed) : 50));
      chase.fade = Math.max(0, Math.min(60000, Number.isFinite(Number(chase.fade)) ? Number(chase.fade) : 0));
      chase.loop = chase.loop !== false;
      chase.mode = ["sequence", "spread", "snapshot"].includes(String(chase.mode)) ? String(chase.mode) : "sequence";
      chase.steps = Array.isArray(chase.steps) ? chase.steps.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < cueCount) : [];
      chase.snapshots = Array.isArray(chase.snapshots) ? chase.snapshots.map(snapshot => ({
        globalState: cloneValue(snapshot?.globalState || snapshot?.state || {}),
        fixtureStates: Array.isArray(snapshot?.fixtureStates) ? snapshot.fixtureStates.filter(x => Array.isArray(x) && x.length > 1).map(x => [x[0], cloneValue(x[1])]) : []
      })) : [];
      return chase;
    });
  }

  function restoreExternalSettings(show) {
    const external = show?.externalSettings || {};
    const qlab = external.qlab || show?.qlab || {};
    if (qlab.connection && typeof qlab.connection === "object") writeStoredJSON("qlabConnectionSettings", qlab.connection);
    if (qlab.cueLinks && typeof qlab.cueLinks === "object") writeStoredJSON("qlabCueLinks", qlab.cueLinks);
    if (qlab.timeTriggers && typeof qlab.timeTriggers === "object") writeStoredJSON("qlabTimeTriggers", qlab.timeTriggers);
    if (external.networkTarget) {
      try { localStorage.setItem("lighting-network-target", String(external.networkTarget)); } catch (_) {}
    }
    if (Array.isArray(external.multiOutputs)) writeStoredJSON("lighting-multi-outputs", external.multiOutputs);
    if (external.outputSettings && typeof external.outputSettings === "object") restoreOutputSettingsShowState(external.outputSettings);
    try {
      if (window.QLab) {
        const connection = qlab.connection || {};
        if (connection.ip != null) window.QLab.ip = String(connection.ip);
        if (connection.bridgePort != null) window.QLab.bridgePort = Number(connection.bridgePort) || 8083;
        if (connection.passcode != null) window.QLab.passcode = String(connection.passcode);
        if (qlab.cueLinks && typeof qlab.cueLinks === "object") window.QLab.cueLinks = cloneValue(qlab.cueLinks);
        if (qlab.timeTriggers && typeof qlab.timeTriggers === "object") window.QLab.timeTriggers = cloneValue(qlab.timeTriggers);
        window.QLab.saveStoredLinks?.();
        window.QLab.renderLinkEditor?.();
        window.QLab.renderCueSync?.();
        window.QLab.updateStatus?.(window.QLab.connected);
      }
    } catch (error) { console.warn("[SHOW] QLab settings refresh failed:", error); }
    try {
      window.dispatchEvent(new CustomEvent("show-multi-output-restore", {
        detail: {
          outputs: Array.isArray(external.multiOutputs) ? external.multiOutputs : [],
          networkTarget: external.networkTarget || ""
        }
      }));
    } catch (_) {}
  }

  function restoreShow(show) {
    if (!show || typeof show !== "object" || (show.format && show.format !== "lx-console-show")) throw new Error("Not a valid LX Console show file");
    stopLivePlayback();
    const state = window.State || (window.State = {});
    state.fixtures = Array.isArray(show.fixtures) ? show.fixtures : [];
    restoreTapoSettings(state.fixtures, show?.externalSettings?.tapo || show?.tapoSettings || []);
    state.groups = Array.isArray(show.groups) ? show.groups : [];
    state.cues = Array.isArray(show.cues) ? show.cues : [];
    state.chases = normaliseChases(show.chases, state.cues.length);
    state.savedEffects = normaliseEffects(show.savedEffects || show.effects);
    state.effectTargetMode = String(show.effectTargetMode || "selected");
    state.effectTargetIds = new Set(Array.isArray(show.effectTargetIds) ? show.effectTargetIds.map(String) : []);
    state.palettes = Array.isArray(show.palettes) ? show.palettes : [];
    state.targets = Array.isArray(show.targets) ? show.targets : [];
    state.current = show.current && typeof show.current === "object" ? cloneValue(show.current) : {};
    state.selectedFixtureId = show.selectedFixtureId ?? null;
    state.currentCue = Number.isInteger(show.currentCue) ? show.currentCue : -1;
    state.currentChase = -1;
    state.chaseFade = Number.isFinite(Number(show.chaseFade)) ? Number(show.chaseFade) : 800;
    state.chaseWait = Number.isFinite(Number(show.chaseWait)) ? Number(show.chaseWait) : 500;
    state.selected = new Set(Array.isArray(show.selected) ? show.selected : []);
    state.fixtureStates = new Map(Array.isArray(show.fixtureStates) ? show.fixtureStates.map(([id, value]) => [String(id), cloneValue(value)]) : []);
    window.chaseFade = state.chaseFade;
    window.chaseWait = state.chaseWait;
    restoreExternalSettings(show);
    

// Keep the loaded visualizer state available even when the visualizer
// window is closed. A newly opened visualizer will request this state.
window.__loadedShowVisualizerState =
  show.visualizer && typeof show.visualizer === "object"
    ? cloneValue(show.visualizer)
    : null;

try { window.initFixtureStates?.(); } catch (_) {}
    try { window.initFixtureStates?.(); } catch (_) {}
    try { window.renderFixtures?.(); } catch (_) {}
    try { window.renderGroups?.(); } catch (_) {}
    try { window.renderCues?.(); } catch (_) {}
    try { window.renderChases?.(); } catch (_) {}
    try { window.renderEffectsList?.(); } catch (_) {}
    try { window.fxRenderEffectTargetUI?.(); } catch (_) {}
    try { window.buildControls?.(); } catch (_) {}
    try { window.render?.(); } catch (_) {}
    try { window.updateControlVisibility?.(); } catch (_) {}
    try { window.updateDMX?.(); } catch (_) {}
    try { window.sendToVisualizer?.(); } catch (_) {}
    restoreVisualizerState(show.visualizer);
    restoreSelectedEffect(show);
    restoreSelectedChase(show);
    document.dispatchEvent(new CustomEvent("lx-show-loaded", { detail: show }));
  }

  function restoreSelectedEffect(show) {
    const effects = window.State?.savedEffects || {};
    const name = String(show?.selectedEffectName || "").trim();
    if (!name || !effects[name]) return;
    const effect = effects[name];
    const nameEl = document.getElementById("effectName");
    const typeEl = document.getElementById("effectType");
    const speedEl = document.getElementById("effectSpeed");
    const modeEl = document.getElementById("effectFixtureMode");
    if (nameEl) nameEl.value = effect.name;
    if (typeEl) typeEl.value = effect.type;
    if (speedEl) speedEl.value = effect.speed;
    if (modeEl) modeEl.value = effect.fixtureMode || "selected";
    window.State.effectTargetIds = new Set(Array.isArray(effect.fixtureIds) ? effect.fixtureIds.map(String) : []);
    const editor = document.getElementById("effectEditor");
    if (editor) editor.style.display = "block";
    window.fxRenderEffectTargetUI?.();
  }

  function restoreSelectedChase(show) {
    const chases = window.State?.chases || [];
    if (!chases.length) return;
    const index = Number(show?.selectedChaseIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chases.length) return;
    const list = document.getElementById("chaseList");
    const items = list ? [...list.querySelectorAll(".cue-item")] : [];
    if (items[index]) items[index].click();
  }

  function normalisePath(raw) {
    return String(raw || "").trim().replace(/^[\'\"]+|[\'\"]+$/g, "").replace(/^\((.*)\)$/s, "$1").trim();
  }

  function report(message, level = "ok") {
    if (typeof window.log === "function") window.log(message, level);
    else console.log(`[SHOW] ${message}`);
  }

  async function saveShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("SAVE requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const bridge = window.LXShowFiles;
    if (!bridge || typeof bridge.save !== "function") throw new Error("Show file IPC bridge is unavailable — restart LX Console");
    const result = await bridge.save(requested, snapshotShow());
    report(`Show saved: ${result?.path || requested}`, "ok");
    return result;
  }

  async function loadShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("LOAD requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const bridge = window.LXShowFiles;
    if (!bridge || typeof bridge.load !== "function") throw new Error("Show file IPC bridge is unavailable — restart LX Console");
    const result = await bridge.load(requested);
    restoreShow(result.show);
    report(`Show loaded: ${result?.path || requested}`, "ok");
    return result;
  }

  function browserSaveShow() {
    const show = snapshotShow();
    const blob = new Blob([JSON.stringify(show, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LightingShow_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report("Show saved", "ok");
  }

  function browserLoadShow(file) {
    if (!file) return;
    file.text().then(text => {
      const data = JSON.parse(text);
      restoreShow(data);
      report("Show loaded", "ok");
    }).catch(error => {
      console.error("[SHOW] Browser load failed:", error);
      report(`Load failed: ${error.message || error}`, "error");
    });
  }

  async function executeShowCommand(raw) {
    const command = String(raw ?? "").trim();
    const match = command.match(/^(save|load)\s+(.+)$/i);
    if (!match) return false;
    try {
      if (match[1].toLowerCase() === "save") await saveShow(match[2]);
      else await loadShow(match[2]);
    } catch (error) {
      console.error(`[SHOW] ${match[1].toUpperCase()} failed:`, error);
      report(`${match[1].toUpperCase()} failed: ${error?.message || error}`, "error");
    }
    return true;
  }

  function initShowFileControls() {
    const saveButton = document.getElementById("btnSaveShow");
    const loadButton = document.getElementById("btnLoadShow");
    const fileInput = document.getElementById("showFileInput");
    if (!saveButton || !loadButton || !fileInput) return false;
    if (saveButton.dataset.showWired !== "1") {
      saveButton.dataset.showWired = "1";
      saveButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        browserSaveShow();
      });
    }
    if (loadButton.dataset.showWired !== "1") {
      loadButton.dataset.showWired = "1";
      loadButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        fileInput.click();
      });
    }
    if (fileInput.dataset.showWired !== "1") {
      fileInput.dataset.showWired = "1";
      fileInput.addEventListener("change", event => {
        browserLoadShow(event.target.files?.[0]);
        fileInput.value = "";
      });
    }
    return true;
  }

  function installInputFallback() {
    const input = document.getElementById("cmdInput");
    if (!input || input.dataset.showFileCommands === "1") return !!input;
    input.dataset.showFileCommands = "1";
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const command = String(input.value || "").trim();
      if (!/^(save|load)\s+.+$/i.test(command)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.value = "";
      void executeShowCommand(command);
    }, true);
    return true;
  }

  function installParserFallback() {
    const current = window.parseCommand;
    if (typeof current !== "function" || current.__lxShowFiles) return false;
    const wrapped = function (raw) {
      const command = String(raw ?? "").trim();
      if (/^(save|load)\s+.+$/i.test(command)) {
        void executeShowCommand(command);
        return;
      }
      return current.apply(this, arguments);
    };
    wrapped.__lxShowFiles = true;
    wrapped.__lxShowFilesOriginal = current;
    window.parseCommand = wrapped;
    return true;
  }

  function start() {
    initShowFileControls();
    installInputFallback();
    installParserFallback();
    if (!document.getElementById("btnSaveShow")) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (initShowFileControls() || attempts >= 100) clearInterval(timer);
      }, 100);
    }
  }

  window.LXShowCommands = Object.freeze({
    saveShow,
    loadShow,
    snapshot: snapshotShow,
    restore: restoreShow,
    execute: executeShowCommand
  });
  window.saveShow = saveShow;
  window.loadShow = loadShow;
  window.addEventListener("lx-show-visualizer-ready", () => {
    const pending = window.__pendingShowVisualizerState;
    if (pending) {
      delete window.__pendingShowVisualizerState;
      restoreVisualizerState(pending);
    }
  });



  "use strict";

/*
 * Visualizer show-load reliability patch.
 *
 * The show data is already stored by showfile.js. This layer only reapplies
 * the saved visualizer state after the visualizer has finished rebuilding its
 * fixture objects, which prevents saved positions from being overwritten by
 * the normal visualizer startup/render cycle.
 */
(function installVisualizerShowLoadFix() {
  const clone = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      try { out[key] = clone(item); } catch (_) {}
    });
    return out;
  };

  const getViz = () => window.S || window.VizState || null;

  const normalise = viz => {
    const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
    const byId = new Map(fixtures.map((fixture, index) => [String(fixture?.id), index]));

    const positions = Array.isArray(viz?.fixturePositions) ? viz.fixturePositions : [];
    const rotations = Array.isArray(viz?.fixtureManualRot) ? viz.fixtureManualRot : [];

    return {
      fixtures,
      positions: positions.map(saved => ({
        ...clone(saved),
        fixtureIndex: saved?.fixtureId != null && byId.has(String(saved.fixtureId))
          ? byId.get(String(saved.fixtureId))
          : Number(saved?.fixtureIndex)
      })).filter(saved => Number.isInteger(saved.fixtureIndex) && saved.fixtureIndex >= 0 && saved.fixtureIndex < fixtures.length),
      rotations: rotations.map(saved => ({
        ...clone(saved),
        fixtureIndex: saved?.fixtureId != null && byId.has(String(saved.fixtureId))
          ? byId.get(String(saved.fixtureId))
          : Number(saved?.fixtureIndex)
      })).filter(saved => Number.isInteger(saved.fixtureIndex) && saved.fixtureIndex >= 0 && saved.fixtureIndex < fixtures.length)
    };
  };

  const apply = viz => {
    if (!viz || typeof viz !== "object") return false;
    const Viz = getViz();
    if (!Viz) return false;

    try {
      const { fixtures, positions, rotations } = normalise(viz);

      // The visualizer keeps its own fixture array. After a show load the
      // console's State.fixtures has been replaced, so make the visualizer use
      // that exact loaded fixture list before rebuilding its scene objects.
      if (fixtures.length) {
        Viz.fixtures = fixtures;
        if (window.FixtureLibrary && typeof window.FixtureLibrary === "object") {
          Viz.library = window.FixtureLibrary;
          Viz.fixtureCache?.clear?.();
        }
      }

      if (typeof Viz.applyLoadedPositions === "function") {
        // The visualizer's native loader uses fixtureIndex. Convert saved
        // fixture IDs to the current fixture order before calling it.
        Viz.applyLoadedPositions(clone(positions), clone(rotations));
      } else {
        if (!(Viz.fixturePositions instanceof Map)) Viz.fixturePositions = new Map();
        if (!(Viz.fixtureManualRot instanceof Map)) Viz.fixtureManualRot = new Map();

        Viz.fixturePositions.clear();
        Viz.fixtureManualRot.clear();

        positions.forEach(saved => {
          const x = Number(saved.x);
          const y = Number(saved.y);
          const z = Number(saved.z);
          if ([x, y, z].every(Number.isFinite)) {
            Viz.fixturePositions.set(saved.fixtureIndex, { x, y, z });
          }
        });

        rotations.forEach(saved => {
          const pan = Number(saved.pan);
          const tilt = Number(saved.tilt);
          if ([pan, tilt].every(Number.isFinite)) {
            Viz.fixtureManualRot.set(saved.fixtureIndex, { pan, tilt });
          }
        });

        Viz.rebuildFixtures?.();
      }

      if (Viz.grid) Viz.grid.visible = viz.gridOn !== false;
      return true;
    } catch (error) {
      console.warn("[SHOW] Visualizer position reapply failed:", error);
      return false;
    }
  };

  const retry = viz => {
    let attempts = 0;
    const run = () => {
      attempts++;
      const applied = apply(viz);

      // Do not stop after the first successful apply. The visualizer can
      // rebuild its fixture list immediately after a show load, so reapply
      // for a short window to ensure the saved positions survive that rebuild.
      if (attempts < 20) {
        setTimeout(run, attempts < 5 ? 50 : 100);
      } else if (!applied) {
        console.warn("[SHOW] Visualizer positions could not be restored");
      }
    };
    run();
  };

  document.addEventListener("lx-show-loaded", event => {
    const viz = event.detail?.visualizer;
    if (viz) {
      window.__pendingShowVisualizerState = clone(viz);
      retry(window.__pendingShowVisualizerState);
    }
  });

  window.addEventListener("lx-show-visualizer-ready", () => {
    const pending = window.__pendingShowVisualizerState;
    if (!pending) return;
    retry(pending);
  });

  window.LXShowVisualizerFix = Object.freeze({ apply, retry });
})();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  // ---------------------------------------------------------------------------
// VISUALIZER WINDOW HANDSHAKE
//
// The visualizer is a separate window. Its S/VizState belongs to THAT window,
// not this console window.
//
// Therefore, when the visualizer announces that it is ready, send the saved
// show-file visualizer state back to the window that sent the READY message.
// ---------------------------------------------------------------------------

window.addEventListener("message", event => {
  if (event.data?.type !== "VISUALIZER_READY") return;

  const saved = window.__loadedShowVisualizerState;

  console.log("[SHOW] VISUALIZER_READY received", {
    hasSavedVisualizerState: !!saved,
    source: !!event.source
  });

  if (!saved || !event.source) {
    console.log("[SHOW] No loaded visualizer state to send");
    return;
  }

  const payload = {
    type: "LOAD_VISUALIZER_STATE",
    state: cloneValue(saved)
  };

  try {
    event.source.postMessage(payload, "*");
    console.log("[SHOW] Sent loaded visualizer positions to new visualizer");
  } catch (error) {
    console.warn("[SHOW] Failed to send visualizer state:", error);
  }
});
// ---------------------------------------------------------------------------
// SHOW FILE VISUALIZER STATE
//
// The main console sends the saved show-file visualizer state here whenever
// this visualizer window is opened.
// ---------------------------------------------------------------------------

window.addEventListener("message", event => {
  if (event.data?.type !== "LOAD_VISUALIZER_STATE") return;

  const state = event.data?.state;
  if (!state || typeof state !== "object") return;

  console.log("[VIZ] Received visualizer state from show file");

  // If the visualizer is still starting up, keep the state until it is ready.
  window.__pendingLoadedVisualizerState = state;

  const Viz = window.S || window.VizState;

  if (!Viz) {
    console.log("[VIZ] Visualizer state object not ready yet");
    return;
  }

  try {
    if (typeof Viz.applyLoadedPositions === "function") {
      Viz.applyLoadedPositions(
        Array.isArray(state.fixturePositions)
          ? state.fixturePositions
          : [],
        Array.isArray(state.fixtureManualRot)
          ? state.fixtureManualRot
          : []
      );
    } else {
      if (!(Viz.fixturePositions instanceof Map)) {
        Viz.fixturePositions = new Map();
      }

      if (!(Viz.fixtureManualRot instanceof Map)) {
        Viz.fixtureManualRot = new Map();
      }

      const fixtures = Array.isArray(window.State?.fixtures)
        ? window.State.fixtures
        : Array.isArray(Viz.fixtures)
          ? Viz.fixtures
          : [];

      const byId = new Map(
        fixtures.map((fixture, index) => [
          String(fixture?.id),
          index
        ])
      );

      Viz.fixturePositions.clear();
      Viz.fixtureManualRot.clear();

      for (const saved of state.fixturePositions || []) {
        let index = Number(saved?.fixtureIndex);

        if (
          saved?.fixtureId != null &&
          byId.has(String(saved.fixtureId))
        ) {
          index = byId.get(String(saved.fixtureId));
        }

        if (!Number.isInteger(index)) continue;

        const x = Number(saved.x);
        const y = Number(saved.y);
        const z = Number(saved.z);

        if ([x, y, z].every(Number.isFinite)) {
          Viz.fixturePositions.set(index, { x, y, z });
        }
      }

      for (const saved of state.fixtureManualRot || []) {
        let index = Number(saved?.fixtureIndex);

        if (
          saved?.fixtureId != null &&
          byId.has(String(saved.fixtureId))
        ) {
          index = byId.get(String(saved.fixtureId));
        }

        if (!Number.isInteger(index)) continue;

        const pan = Number(saved.pan);
        const tilt = Number(saved.tilt);

        if ([pan, tilt].every(Number.isFinite)) {
          Viz.fixtureManualRot.set(index, { pan, tilt });
        }
      }

      Viz.rebuildFixtures?.();
    }

    if (Viz.grid) {
      Viz.grid.visible = state.gridOn !== false;
    }

    if (Viz.houseOn !== undefined) {
      Viz.houseOn = state.houseOn !== false;
    }

    if (Viz.workOn !== undefined) {
      Viz.workOn = state.workOn !== false;
    }

    window.__pendingLoadedVisualizerState = null;

    console.log("[VIZ] Show-file visualizer state applied");
  } catch (error) {
    console.error("[VIZ] Failed to apply show-file visualizer state:", error);
  }
});
})();
