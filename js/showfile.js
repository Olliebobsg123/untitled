"use strict";

(function () {
  const api = () => window.LXShowFiles;

  const cloneValue = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneValue);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "chaseTimer" || key === "fading" || key === "Viz" || key === "effectFrame") continue;
      try { out[key] = cloneValue(item); } catch (_) {}
    }
    return out;
  };

  function readStoredJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }

  function writeStoredJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function snapshotExternalSettings() {
    return {
      qlab: {
        connection: readStoredJSON("qlabConnectionSettings", {}),
        cueLinks: readStoredJSON("qlabCueLinks", {}),
        timeTriggers: readStoredJSON("qlabTimeTriggers", {})
      },
      multiOutputs: readStoredJSON("lighting-multi-outputs", []),
      networkTarget: (() => {
        try { return localStorage.getItem("lighting-network-target") || ""; } catch (_) { return ""; }
      })()
    };
  }

  function snapshotSelectedEffect() {
    const name = String(document.getElementById("effectName")?.value || "").trim();
    return name || null;
  }

  function snapshotSelectedChase() {
    const list = document.getElementById("chaseList");
    if (!list) return -1;
    const active = list.querySelector(".cue-item.active");
    if (!active) return -1;
    const items = [...list.querySelectorAll(".cue-item")];
    return items.indexOf(active);
  }

  function restoreExternalSettings(show) {
    const external = show?.externalSettings || {};
    const qlab = external.qlab || {};

    if (qlab.connection && typeof qlab.connection === "object") writeStoredJSON("qlabConnectionSettings", qlab.connection);
    if (qlab.cueLinks && typeof qlab.cueLinks === "object") writeStoredJSON("qlabCueLinks", qlab.cueLinks);
    if (qlab.timeTriggers && typeof qlab.timeTriggers === "object") writeStoredJSON("qlabTimeTriggers", qlab.timeTriggers);

    if (external.networkTarget) {
      try { localStorage.setItem("lighting-network-target", String(external.networkTarget)); } catch (_) {}
    }
    if (Array.isArray(external.multiOutputs)) writeStoredJSON("lighting-multi-outputs", external.multiOutputs);

    try {
      if (window.QLab) {
        const connection = qlab.connection || {};
        if (connection.ip != null) window.QLab.ip = String(connection.ip);
        if (connection.bridgePort != null) window.QLab.bridgePort = Number(connection.bridgePort) || 8083;
        if (connection.passcode != null) window.QLab.passcode = String(connection.passcode);
        if (qlab.cueLinks && typeof qlab.cueLinks === "object") window.QLab.cueLinks = cloneValue(qlab.cueLinks);
        if (qlab.timeTriggers && typeof qlab.timeTriggers === "object") window.QLab.timeTriggers = cloneValue(qlab.timeTriggers);
        window.QLab.renderLinkEditor?.();
        window.QLab.renderCueSync?.();
        window.QLab.updateStatus?.(window.QLab.connected);
      }
    } catch (error) { console.warn("[SHOW] QLab settings refresh failed:", error); }

    // multi-output.js listens on window, not document. Dispatching on document
    // meant the saved output configuration never reached its live state.
    try {
      window.dispatchEvent(new CustomEvent("show-multi-output-restore", {
        detail: {
          outputs: Array.isArray(external.multiOutputs) ? external.multiOutputs : [],
          networkTarget: external.networkTarget || ""
        }
      }));
    } catch (error) { console.warn("[SHOW] Multi-output settings refresh failed:", error); }
  }

  function snapshotShow() {
    const state = window.State || {};
    return {
      format: "lx-console-show",
      version: 4,
      savedAt: new Date().toISOString(),
      fixtures: cloneValue(state.fixtures || []),
      groups: cloneValue(state.groups || []),
      cues: cloneValue(state.cues || []),
      chases: cloneValue(state.chases || []),
      savedEffects: cloneValue(state.savedEffects || {}),
      effectTargetMode: String(state.effectTargetMode || "selected"),
      effectTargetIds: state.effectTargetIds instanceof Set ? [...state.effectTargetIds] : Array.isArray(state.effectTargetIds) ? state.effectTargetIds.slice() : [],
      palettes: cloneValue(state.palettes || []),
      targets: cloneValue(state.targets || []),
      fixtureStates: state.fixtureStates instanceof Map ? [...state.fixtureStates.entries()].map(([id, value]) => [id, cloneValue(value)]) : [],
      current: cloneValue(state.current || {}),
      selectedFixtureId: state.selectedFixtureId ?? null,
      selected: state.selected instanceof Set ? [...state.selected] : [],
      currentCue: Number.isInteger(state.currentCue) ? state.currentCue : -1,
      chaseFade: Number.isFinite(state.chaseFade) ? state.chaseFade : 800,
      chaseWait: Number.isFinite(state.chaseWait) ? state.chaseWait : 500,
      selectedEffectName: snapshotSelectedEffect(),
      selectedChaseIndex: snapshotSelectedChase(),
      externalSettings: snapshotExternalSettings()
    };
  }

  function stopLivePlayback() {
    try { window.stopEffect?.(true); } catch (error) { console.warn("[SHOW] Could not stop effect:", error); }
    try { window.stopChase?.(false); } catch (error) { console.warn("[SHOW] Could not stop chase:", error); }
    const state = window.State;
    if (!state) return;
    if (state.chaseTimer) { try { clearTimeout(state.chaseTimer); } catch (_) {} state.chaseTimer = null; }
    if (state.fading != null) { try { cancelAnimationFrame(state.fading); } catch (_) {} state.fading = null; }
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
      const fixtureMode = ["selected", "all", "custom"].includes(String(raw.fixtureMode)) ? String(raw.fixtureMode) : fixtureIds.length ? "custom" : "selected";
      effects[name] = { ...cloneValue(raw), name, type: String(raw.type || "rainbow").toLowerCase(), speed: Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : 1, fixtureMode, fixtureIds };
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
      // Keep the original step order, but remove only steps that cannot point
      // at a cue. Do not use Set here because duplicate steps can be deliberate.
      chase.steps = Array.isArray(chase.steps) ? chase.steps.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < cueCount) : [];
      chase.snapshots = Array.isArray(chase.snapshots) ? chase.snapshots.map(snapshot => ({
        globalState: cloneValue(snapshot?.globalState || snapshot?.state || {}),
        fixtureStates: Array.isArray(snapshot?.fixtureStates) ? snapshot.fixtureStates.filter(x => Array.isArray(x) && x.length > 1).map(x => [x[0], cloneValue(x[1])]) : []
      })) : [];
      return chase;
    });
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
    const editor = document.getElementById("effectEditor");
    if (nameEl) nameEl.value = effect.name;
    if (typeEl) typeEl.value = effect.type;
    if (speedEl) speedEl.value = effect.speed;
    if (modeEl) modeEl.value = effect.fixtureMode || "selected";
    window.State.effectTargetIds = new Set(Array.isArray(effect.fixtureIds) ? effect.fixtureIds.map(String) : []);
    if (editor) editor.style.display = "block";
    window.fxRenderEffectTargetUI?.();
  }

  function restoreSelectedChase(show) {
    const chases = window.State?.chases || [];
    if (!chases.length) return;
    let index = Number(show?.selectedChaseIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chases.length) index = 0;
    // chases.js intentionally keeps its selection private. Selecting the card
    // through the same UI path keeps its private selectedChase in sync.
    const list = document.getElementById("chaseList");
    const items = list ? [...list.querySelectorAll(".cue-item")] : [];
    if (items[index]) {
      items[index].click();
      return;
    }
    // If rendering happened before the DOM is ready, retry once on the next tick.
    setTimeout(() => {
      const retry = document.getElementById("chaseList");
      const retryItems = retry ? [...retry.querySelectorAll(".cue-item")] : [];
      if (retryItems[index]) retryItems[index].click();
    }, 0);
  }

  function restoreShow(show) {
    if (!show || typeof show !== "object" || show.format !== "lx-console-show") throw new Error("Not a valid LX Console show file");

    stopLivePlayback();
    const state = window.State || (window.State = {});
    state.fixtures = Array.isArray(show.fixtures) ? show.fixtures : [];
    state.groups = Array.isArray(show.groups) ? show.groups : [];
    state.cues = Array.isArray(show.cues) ? show.cues : [];
    state.chases = normaliseChases(show.chases, state.cues.length);
    state.savedEffects = normaliseEffects(show.savedEffects);
    state.effectTargetMode = String(show.effectTargetMode || "selected");
    state.effectTargetIds = new Set(Array.isArray(show.effectTargetIds) ? show.effectTargetIds.map(String) : []);
    state.palettes = Array.isArray(show.palettes) ? show.palettes : [];
    state.targets = Array.isArray(show.targets) ? show.targets : [];
    state.current = show.current && typeof show.current === "object" ? show.current : {};
    state.selectedFixtureId = show.selectedFixtureId ?? null;
    state.currentCue = Number.isInteger(show.currentCue) ? show.currentCue : -1;
    state.chaseFade = Number.isFinite(show.chaseFade) ? show.chaseFade : 800;
    state.chaseWait = Number.isFinite(show.chaseWait) ? show.chaseWait : 500;
    state.selected = new Set(Array.isArray(show.selected) ? show.selected : []);
    state.fixtureStates = new Map(Array.isArray(show.fixtureStates) ? show.fixtureStates.map(([id, value]) => [String(id), cloneValue(value)]) : []);

    window.chaseFade = state.chaseFade;
    window.chaseWait = state.chaseWait;
    restoreExternalSettings(show);

    try { window.initFixtureStates?.(); } catch (error) { console.warn("[SHOW] Fixture state rebuild failed:", error); }
    try { window.fxRenderEffectTargetUI?.(); } catch (_) {}
    try { window.renderFixtures?.(); } catch (_) {}
    try { window.renderGroups?.(); } catch (_) {}
    try { window.renderCues?.(); } catch (_) {}
    try { window.renderChases?.(); } catch (_) {}
    try { window.renderEffectsList?.(); } catch (error) { console.warn("[SHOW] Effect list rebuild failed:", error); }
    try { window.buildControls?.(); } catch (_) {}
    try { window.render?.(); } catch (_) {}
    try { window.updateControlVisibility?.(); } catch (_) {}
    try { window.updateDMX?.(); } catch (_) {}
    try { window.sendToVisualizer?.(); } catch (_) {}

    // Re-apply the saved selections after every list has been rebuilt. This
    // makes a loaded show behave like the show did before SAVE rather than
    // merely displaying the stored names.
    try { restoreSelectedEffect(show); } catch (error) { console.warn("[SHOW] Effect selection restore failed:", error); }
    try { restoreSelectedChase(show); } catch (error) { console.warn("[SHOW] Chase selection restore failed:", error); }
    try { window.fxRenderEffectTargetUI?.(); } catch (_) {}

    document.dispatchEvent(new CustomEvent("lx-show-loaded", { detail: show }));
  }

  function normalisePath(raw) {
    return String(raw || "").trim().replace(/^[\'\"]+|[\'\"]+$/g, "").replace(/^\((.*)\)$/s, "$1").trim();
  }

  function report(message, level = "ok") {
    if (typeof window.log === "function") window.log(message, level); else console.log(`[SHOW] ${message}`);
  }

  async function saveShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("SAVE requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const bridge = api();
    if (!bridge || typeof bridge.save !== "function") throw new Error("Show file IPC bridge is unavailable — restart LX Console");
    const result = await bridge.save(requested, snapshotShow());
    report(`Show saved: ${result?.path || requested}`, "ok");
    return result;
  }

  async function loadShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("LOAD requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const bridge = api();
    if (!bridge || typeof bridge.load !== "function") throw new Error("Show file IPC bridge is unavailable — restart LX Console");
    const result = await bridge.load(requested);
    restoreShow(result.show);
    report(`Show loaded: ${result?.path || requested}`, "ok");
    return result;
  }

  async function executeShowCommand(raw) {
    const command = String(raw ?? "").trim();
    const match = command.match(/^(save|load)\s+(.+)$/i);
    if (!match) return false;
    try {
      if (match[1].toLowerCase() === "save") await saveShow(match[2]);
      else await loadShow(match[2]);
    } catch (err) {
      console.error(`[SHOW] ${match[1].toUpperCase()} failed:`, err);
      report(`${match[1].toUpperCase()} failed: ${err?.message || err}`, "error");
    }
    return true;
  }

  window.LXShowCommands = Object.freeze({ saveShow, loadShow, snapshot: snapshotShow, execute: executeShowCommand });

  function installWindowInputFallback() {
    if (window.__lxShowWindowCaptureInstalled) return true;
    window.__lxShowWindowCaptureInstalled = true;
    const intercept = event => {
      if (event.key !== "Enter") return;
      const target = event.target;
      if (!target || target.id !== "cmdInput") return;
      const command = String(target.value || "").trim();
      if (!/^(save|load)\s+.+$/i.test(command)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      target.value = "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      void executeShowCommand(command);
    };
    window.addEventListener("keydown", intercept, true);
    window.addEventListener("keypress", intercept, true);
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
      input.dispatchEvent(new Event("input", { bubbles: true }));
      void executeShowCommand(command);
    }, true);
    return true;
  }

  function installLogFallback() {
    if (window.log && window.log.__lxShowLogFallback) return true;
    if (typeof window.log !== "function") return false;
    const originalLog = window.log;
    const wrappedLog = function (message, type) {
      const text = String(message ?? "");
      if (/^Show file support is unavailable\s*[—-]/i.test(text)) {
        const input = document.getElementById("cmdInput");
        const command = String(input?.dataset?.lxPendingShowCommand || "").trim();
        if (command) { delete input.dataset.lxPendingShowCommand; void executeShowCommand(command); return; }
      }
      const unknown = text.match(/^Unknown command:\s*(save|load)\s+(.+?)(?:\s+—.*)?$/i);
      if (unknown) { void executeShowCommand(`${unknown[1]} ${unknown[2]}`); return; }
      return originalLog.apply(this, arguments);
    };
    wrappedLog.__lxShowLogFallback = true;
    wrappedLog.__lxShowOriginal = originalLog;
    window.log = wrappedLog;
    return true;
  }

  function installParserFallback() {
    const current = window.parseCommand;
    if (typeof current !== "function") return false;
    if (current.__lxShowFiles) return true;
    const wrapped = function (raw) {
      const command = String(raw ?? "").trim();
      if (/^(save|load)\s+.+$/i.test(command)) { void executeShowCommand(command); return; }
      return current.apply(this, arguments);
    };
    wrapped.__lxShowFiles = true;
    wrapped.__lxShowFilesOriginal = current;
    window.parseCommand = wrapped;
    return true;
  }

  function installPendingCommandCapture() {
    if (window.__lxShowPendingCaptureInstalled) return true;
    window.__lxShowPendingCaptureInstalled = true;
    const capture = event => {
      if (event.key !== "Enter") return;
      const target = event.target;
      if (!target || target.id !== "cmdInput") return;
      const command = String(target.value || "").trim();
      if (!/^(save|load)\s+.+$/i.test(command)) return;
      target.dataset.lxPendingShowCommand = command;
    };
    window.addEventListener("keydown", capture, false);
    return true;
  }

  function install() {
    const windowCapture = installWindowInputFallback();
    const input = installInputFallback();
    const log = installLogFallback();
    const parser = installParserFallback();
    const pending = installPendingCommandCapture();
    return windowCapture || input || log || parser || pending;
  }

  function waitForInstall(attempts = 0) {
    install();
    if (attempts < 200) setTimeout(() => waitForInstall(attempts + 1), 100);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => waitForInstall(), { once: true });
  else waitForInstall();
})();
