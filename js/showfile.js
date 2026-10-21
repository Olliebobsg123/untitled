"use strict";

/*
 * LX Console show-file system.

 * This file is now the single source of truth for show save/load. It combines
 * the old show.js browser/UI behaviour with the newer showfile.js Electron
 * file bridge, including fixtures, Tapo settings, QLab, outputs, effects,
 * chases, fixture states and visualizer state..
 */
(function () {
  // index.html, preload and main all load this file; only the first copy may
  // run, or each copy keeps its own idea of which show is open.
  if (window.LXShowCommands) return;
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

  // Tapo account passwords stay on this computer (localStorage) and are left
  // out of show files, which get copied and shared.
  const TAPO_PASSWORDS_KEY = "lighting-tapo-passwords";
  const tapoKey = config => `${String(config?.email || "").trim().toLowerCase()}|${String(config?.ip || "").trim()}`;
  function rememberTapoPassword(config) {
    if (!config?.password) return;
    const stored = readStoredJSON(TAPO_PASSWORDS_KEY, {});
    stored[tapoKey(config)] = String(config.password);
    writeStoredJSON(TAPO_PASSWORDS_KEY, stored);
  }
  function storedTapoPassword(config) {
    return String(readStoredJSON(TAPO_PASSWORDS_KEY, {})[tapoKey(config)] || "");
  }

  function snapshotTapoSettings(fixtures) {
    return (Array.isArray(fixtures) ? fixtures : [])
      .filter(isTapoFixture)
      .map(fixture => {
        const config = fixture.tapo || {};
        rememberTapoPassword(config);
        return {
          fixtureId: String(fixture.id),
          ip: String(config.ip || "").trim(),
          email: String(config.email || "").trim()
        };
      })
      .filter(config => config.ip || config.email);
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
        password: String(config.password || "") || storedTapoPassword(config)
      };
      fixture.addr = null;
      fixture.uni = null;
    });
    // Older show files kept the password; newer ones get it from this computer.
    fixtures.forEach(fixture => {
      if (!fixture?.tapo) return;
      if (fixture.tapo.password) rememberTapoPassword(fixture.tapo);
      else fixture.tapo.password = storedTapoPassword(fixture.tapo);
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

  // The visualiser layout (fixture positions, aims, view settings) lives in
  // State.visualizer, owned by js/visualizer-link.js.
  function snapshotVisualizerState() {
    return window.LXVisualizer?.toShow() ?? null;
  }

  function restoreVisualizerState(viz) {
    window.LXVisualizer?.fromShow(viz);
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
      version: 8,
      savedAt: new Date().toISOString(),
      fixtures: cloneValue(fixtures).map(fixture => {
        if (!fixture?.tapo) return fixture;
        rememberTapoPassword(fixture.tapo);
        const { password, ...tapo } = fixture.tapo;
        return { ...fixture, tapo };
      }),
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
    if (state.fading != null) { LXClock.cancel(state.fading); state.fading = null; }
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
      if (chase.bpm != null) chase.bpm = Math.max(6, Math.min(1200, Number.isFinite(Number(chase.bpm)) ? Number(chase.bpm) : 120));
      else delete chase.bpm;
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

  // Shows before version 8: a light nobody had coloured was stored as red at
  // full saturation (hue 0, sat 100). On a colour wheel that used to pick the
  // white slot (white and red were both "hue 0"), so the light looked white.
  // The wheel now picks real red, so keep those lights looking as they did.
  function keepOldWheelWhite(show) {
    if (Number(show.version) >= 8) return;
    const lib = window.FixtureLibrary || {};
    const fixtureOf = new Map((show.fixtures || []).filter(Boolean).map(f => [String(f.id), f]));
    const wasWhite = id => {
      const f = fixtureOf.get(String(id));
      const def = (f && (lib[f.name] || f.definition)) || {};
      const map = def.map || {};
      if (typeof map.colour !== "number" || ["r", "g", "b"].every(k => typeof map[k] === "number")) return false;
      const wheel = Array.isArray(def.colourWheel) ? def.colourWheel : [];
      // The slot the old code picked for hue 0: the first one nearest in hue.
      let best = null, bestDist = Infinity;
      for (const slot of wheel) { if (slot?.hue == null) continue; const d = Math.min(Math.abs(slot.hue % 360), 360 - Math.abs(slot.hue % 360)); if (d < bestDist) { bestDist = d; best = slot; } }
      return Boolean(best && Array.isArray(best.rgb) && Math.min(...best.rgb) >= 0.95);
    };
    const fix = (id, st) => { if (st && typeof st === "object" && Number(st.hue) === 0 && Number(st.sat) === 100 && wasWhite(id)) st.sat = 0; };
    for (const [id, st] of show.fixtureStates || []) fix(id, st);
    for (const cue of show.cues || []) for (const [id, st] of cue?.fixtureStates || []) fix(id, st);
  }

  function restoreShow(show) {
    if (!show || typeof show !== "object" || (show.format && show.format !== "lx-console-show")) throw new Error("Not a valid LX Console show file");
    keepOldWheelWhite(show);
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

  // The show file you're working in: set by Open, Save, Save As and the
  // splash screen's recent shows. Save and autosave write back to it.
  let currentPath = null;
  const showName = file => String(file || "").split(/[\\/]/).pop().replace(/\.json$/i, "");
  // What was last saved or opened, to tell whether there are unsaved changes.
  let savedKey = "";
  const showKey = () => { const x = snapshotShow(); return JSON.stringify([x.fixtures, x.groups, x.cues, x.chases, x.savedEffects, x.palettes, x.targets]); };
  function markSaved() { try { savedKey = showKey(); } catch (_) { savedKey = ""; } }
  function isDirty() {
    const st = window.State || {};
    if (!currentPath && !(st.cues || []).some(Boolean) && !(st.fixtures || []).length) return false; // nothing to lose
    try { return showKey() !== savedKey; } catch (_) { return true; }
  }
  // macOS and Windows don't care about upper/lower case in file names: "bms.json" is "BMS.json".
  const samePath = (a, b) => Boolean(a && b) && (/^(darwin|win32)$/.test(window.LXApp?.platform || "darwin") ? a.toLowerCase() === b.toLowerCase() : a === b);
  const when = ms => {
    const d = new Date(ms), today = new Date();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === today.toDateString() ? `today ${time}` : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  };
  const describe = stat => stat?.exists ? `${stat.cues ?? "?"} cue${stat.cues === 1 ? "" : "s"}, ${stat.fixtures ?? "?"} fixture${stat.fixtures === 1 ? "" : "s"}, saved ${when(stat.mtimeMs)}` : "";
  const openName = () => (currentPath ? `“${showName(currentPath)}”` : "the show you have open");
  const cueCount = () => (window.State?.cues || []).filter(Boolean).length;
  const ask = (title, message, ok, safe = false) => (window.LXAsk ? window.LXAsk(title, [], { ok, message, safe }) : Promise.resolve(window.confirm(`${title}\n\n${message}`)));

  function setCurrent(path) {
    currentPath = path || null;
    markSaved();
    document.title = currentPath ? `${showName(currentPath)} — Light Spark` : "Light Spark";
    window.dispatchEvent(new CustomEvent("lx-show-file", { detail: { path: currentPath } }));
  }

  async function saveShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("SAVE requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const bridge = window.LXShowFiles;
    if (!bridge || typeof bridge.save !== "function") throw new Error("Show file IPC bridge is unavailable — restart LX Console");
    const result = await bridge.save(requested, snapshotShow(), { backup: true });
    setCurrent(result?.path || requested);
    report(`Show saved: ${result?.path || requested}${result?.backup ? ` — the old version is kept in Backups` : ""}`, "ok");
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
    setCurrent(result?.path || requested);
    report(`Show loaded: ${result?.path || requested}`, "ok");
    return result;
  }

  // Save: back into the open show, or ask where the first time.
  async function saveCurrent() {
    if (!window.LXShowFiles?.saveDialog) return browserSaveShow();
    if (!currentPath) return saveAs();
    try { return await saveShow(currentPath); }
    catch (error) { report(`Save failed: ${error?.message || error}`, "error"); return null; }
  }
  async function saveAs() {
    const bridge = window.LXShowFiles;
    if (!bridge?.saveDialog) return browserSaveShow();
    const path = await bridge.saveDialog(currentPath ? showName(currentPath) : "Untitled Show");
    if (!path) return null;
    try { return await saveShow(path); }
    catch (error) { report(`Save failed: ${error?.message || error}`, "error"); return null; }
  }
  async function openShow() {
    const bridge = window.LXShowFiles;
    if (!bridge?.openDialog) return document.getElementById("showFileInput")?.click();
    const path = await bridge.openDialog();
    if (!path) return null;
    if (!samePath(path, currentPath) && isDirty() && !(await ask(`Open “${showName(path)}”?`, `${openName()} has changes that haven't been saved — they'll be lost. Cancel and press Save first to keep them.`, "Open without saving", true))) {
      report("Open cancelled — nothing was changed", "info");
      return null;
    }
    try { return await loadShow(path); }
    catch (error) { report(`Open failed: ${error?.message || error}`, "error"); return null; }
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
      setCurrent(null);
      report("Show loaded", "ok");
    }).catch(error => {
      console.error("[SHOW] Browser load failed:", error);
      report(`Load failed: ${error.message || error}`, "error");
    });
  }

  // "save NAME" / "load NAME" (also "open NAME") from the command line.
  // Both check first: saving over a different show, saving a copy under a
  // new name (Save and autosave then go to the copy), or opening a show
  // while this one has unsaved changes all ask before anything happens.
  async function executeShowCommand(raw) {
    const command = String(raw ?? "").trim();
    if (/^save$/i.test(command)) { await saveCurrent(); return true; }
    const match = command.match(/^(save|load|open)\s+(.+)$/i);
    if (!match) return false;
    const verb = match[1].toLowerCase() === "save" ? "save" : "load";
    let name = normalisePath(match[2]);
    if (name && !/\.json$/i.test(name)) name += ".json";
    const bridge = window.LXShowFiles;
    try {
      const stat = bridge?.stat ? await bridge.stat(name) : null;
      const target = showName(stat?.path || name);
      if (verb === "save") {
        if (stat?.exists && !samePath(stat.path, currentPath)) {
          const ok = await ask(`Replace “${target}”?`,
            `A different show called “${target}” already exists (${describe(stat)}). Saving would replace it with ${openName()} (${cueCount()} cues). If you're sure, a copy of the old “${target}” is kept in Backups.`,
            `Replace “${target}”`, true);
          if (!ok) { report(`Save cancelled — “${target}” wasn't touched`, "info"); return true; }
        } else if (stat && !stat.exists && currentPath) {
          const ok = await ask(`Save a copy as “${target}”?`,
            `This saves ${openName()} under a new name. From now on Save and autosave go to “${target}”, not ${openName()}. (To save ${openName()} itself, just press Save.)`,
            "Save the copy");
          if (!ok) { report("Save cancelled — nothing was changed", "info"); return true; }
        }
        await saveShow(stat?.exists ? stat.path : name);
      } else {
        if (stat && !stat.exists) { report(`LOAD failed: there's no show called “${target}”`, "error"); return true; }
        const already = stat && samePath(stat.path, currentPath);
        const dirty = isDirty();
        const ok = await ask(already ? `Reopen “${target}”?` : `Open “${target}”?`,
          `${stat ? `“${target}”: ${describe(stat)}. ` : ""}${dirty ? `${openName()} has changes that haven't been saved — they'll be lost. Cancel and press Save first to keep them.` : already ? "This goes back to the last saved version." : `${openName()} is saved, so nothing will be lost.`}`,
          dirty ? "Open without saving" : "Open it", dirty);
        if (!ok) { report("Open cancelled — nothing was changed", "info"); return true; }
        await loadShow(stat?.exists ? stat.path : name);
      }
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
        void saveCurrent();
      });
    }
    if (loadButton.dataset.showWired !== "1") {
      loadButton.dataset.showWired = "1";
      loadButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void openShow();
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
      if (!/^(save|load|open)\s+.+$|^save$/i.test(command)) return;
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
      if (/^(save|load|open)\s+.+$|^save$/i.test(command)) {
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
    saveCurrent,
    saveAs,
    open: openShow,
    current: () => currentPath,
    markSaved,
    isDirty,
    name: () => (currentPath ? showName(currentPath) : ""),
    restore: restoreShow,
    execute: executeShowCommand
  });
  window.saveShow = saveShow;
  window.loadShow = loadShow;

  /*
   * Custom fixture show-file bridge.
   *
   * The fixture editor still uses its existing lx-custom-fixtures storage API,
   * but this bridge redirects that key into State.current so custom fixture
   * definitions are part of the normal show-file snapshot instead of being
   * machine-local saves.
   */
  const CUSTOM_FIXTURE_STORE = "lx-custom-fixtures";
  const CUSTOM_FIXTURE_STATE_KEY = "__lxCustomFixtures";
  const nativeStorageGet = Storage.prototype.getItem;
  const nativeStorageSet = Storage.prototype.setItem;
  const nativeStorageRemove = Storage.prototype.removeItem;

  function ensureCustomFixtureState() {
    const state = window.State || (window.State = {});
    if (!state.current || typeof state.current !== "object" || Array.isArray(state.current)) {
      state.current = {};
    }
    if (!state.current[CUSTOM_FIXTURE_STATE_KEY] || typeof state.current[CUSTOM_FIXTURE_STATE_KEY] !== "object" || Array.isArray(state.current[CUSTOM_FIXTURE_STATE_KEY])) {
      state.current[CUSTOM_FIXTURE_STATE_KEY] = {};
    }
    return state;
  }

  function getCustomFixtureDefinitions() {
    return ensureCustomFixtureState().current[CUSTOM_FIXTURE_STATE_KEY];
  }

  function setCustomFixtureDefinitions(value) {
    const state = ensureCustomFixtureState();
    state.current[CUSTOM_FIXTURE_STATE_KEY] = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return true;
  }

  // Migrate fixtures created by older versions of the editor into the current
  // show state. The old localStorage copy is removed after migration.
  try {
    const legacy = nativeStorageGet.call(window.localStorage, CUSTOM_FIXTURE_STORE);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length) {
        Object.assign(getCustomFixtureDefinitions(), parsed);
      }
      nativeStorageRemove.call(window.localStorage, CUSTOM_FIXTURE_STORE);
    }
  } catch (_) {}

  Storage.prototype.getItem = function (key) {
    if (key === CUSTOM_FIXTURE_STORE && this === window.localStorage) {
      return JSON.stringify(getCustomFixtureDefinitions());
    }
    return nativeStorageGet.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (key === CUSTOM_FIXTURE_STORE && this === window.localStorage) {
      try {
        const parsed = JSON.parse(String(value));
        setCustomFixtureDefinitions(parsed);
      } catch (_) {
        setCustomFixtureDefinitions({});
      }
      return;
    }
    return nativeStorageSet.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (key === CUSTOM_FIXTURE_STORE && this === window.localStorage) {
      setCustomFixtureDefinitions({});
      return;
    }
    return nativeStorageRemove.call(this, key);
  };

  function reinstallCustomFixtures() {
    try { window.LXFixtureEditor?.install?.(); } catch (_) {}
    try { window.renderLibrary?.(); } catch (_) {}
  }

  document.addEventListener("lx-show-loaded", () => {
    // restoreShow has replaced State.current with the loaded show snapshot.
    // Reinstall the custom definitions from that show immediately.
    setTimeout(reinstallCustomFixtures, 0);
  });

  window.LXCustomFixtureShowfile = Object.freeze({
    get: () => JSON.parse(JSON.stringify(getCustomFixtureDefinitions())),
    set: value => setCustomFixtureDefinitions(value),
    clear: () => setCustomFixtureDefinitions({})
  });


  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
