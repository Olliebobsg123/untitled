"use strict";

(function () {
  const api = () => window.LXShowFiles;

  const cloneValue = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneValue);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "chaseTimer" || key === "fading" || key === "Viz") continue;
      try { out[key] = cloneValue(item); } catch (_) {}
    }
    return out;
  };

  function snapshotShow() {
    const state = window.State || {};
    return {
      format: "lx-console-show",
      version: 1,
      savedAt: new Date().toISOString(),
      fixtures: cloneValue(state.fixtures || []),
      groups: cloneValue(state.groups || []),
      cues: cloneValue(state.cues || []),
      chases: cloneValue(state.chases || []),
      palettes: cloneValue(state.palettes || []),
      targets: cloneValue(state.targets || []),
      fixtureStates: state.fixtureStates instanceof Map
        ? [...state.fixtureStates.entries()].map(([id, value]) => [id, cloneValue(value)])
        : [],
      current: cloneValue(state.current || {}),
      selectedFixtureId: state.selectedFixtureId ?? null,
      selected: state.selected instanceof Set ? [...state.selected] : [],
      currentCue: Number.isInteger(state.currentCue) ? state.currentCue : -1,
      chaseFade: Number.isFinite(state.chaseFade) ? state.chaseFade : 800,
      chaseWait: Number.isFinite(state.chaseWait) ? state.chaseWait : 500
    };
  }

  function restoreShow(show) {
    if (!show || typeof show !== "object" || show.format !== "lx-console-show") {
      throw new Error("Not a valid LX Console show file");
    }

    const state = window.State || (window.State = {});
    state.fixtures = Array.isArray(show.fixtures) ? show.fixtures : [];
    state.groups = Array.isArray(show.groups) ? show.groups : [];
    state.cues = Array.isArray(show.cues) ? show.cues : [];
    state.chases = Array.isArray(show.chases) ? show.chases : [];
    state.palettes = Array.isArray(show.palettes) ? show.palettes : [];
    state.targets = Array.isArray(show.targets) ? show.targets : [];
    state.current = show.current && typeof show.current === "object" ? show.current : {};
    state.selectedFixtureId = show.selectedFixtureId ?? null;
    state.currentCue = Number.isInteger(show.currentCue) ? show.currentCue : -1;
    state.chaseFade = Number.isFinite(show.chaseFade) ? show.chaseFade : 800;
    state.chaseWait = Number.isFinite(show.chaseWait) ? show.chaseWait : 500;
    state.selected = new Set(Array.isArray(show.selected) ? show.selected : []);
    state.fixtureStates = new Map(Array.isArray(show.fixtureStates) ? show.fixtureStates : []);

    window.chaseFade = state.chaseFade;
    window.chaseWait = state.chaseWait;

    if (typeof window.initFixtureStates === "function") window.initFixtureStates();
    window.renderFixtures?.();
    window.renderGroups?.();
    window.renderCues?.();
    window.buildControls?.();
    window.render?.();
    window.updateControlVisibility?.();
    window.updateDMX?.();
    window.sendToVisualizer?.();
    document.dispatchEvent(new CustomEvent("lx-show-loaded", { detail: show }));
  }

  function normalisePath(raw) {
    return String(raw || "")
      .trim()
      .replace(/^['"]+|['"]+$/g, "")
      .replace(/^\((.*)\)$/s, "$1")
      .trim();
  }

  function report(message, level = "ok") {
    if (typeof window.log === "function") window.log(message, level);
    else console.log(`[SHOW] ${message}`);
  }

  async function saveShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("SAVE requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    if (!api()?.save) throw new Error("Show file support is unavailable");

    const result = await api().save(requested, snapshotShow());
    report(`Show saved: ${result?.path || requested}`, "ok");
    return result;
  }

  async function loadShow(path) {
    const requested = normalisePath(path);
    if (!requested) throw new Error("LOAD requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    if (!api()?.load) throw new Error("Show file support is unavailable");

    const result = await api().load(requested);
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

  window.LXShowFiles = window.LXShowFiles || {};
  window.LXShowFiles.saveShow = saveShow;
  window.LXShowFiles.loadShow = loadShow;
  window.LXShowFiles.snapshot = snapshotShow;

  // IMPORTANT: commands.js contains a lexical parseCommand and its Enter
  // handler may run before this script's input listener. Listen on WINDOW in
  // capture phase so SAVE/LOAD is handled before any renderer command handler.
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
      const unknown = text.match(/^Unknown command:\s*(save|load)\s+(.+?)(?:\s+—.*)?$/i);

      if (unknown) {
        void executeShowCommand(`${unknown[1]} ${unknown[2]}`);
        return;
      }

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

  function install() {
    const windowCapture = installWindowInputFallback();
    const input = installInputFallback();
    const log = installLogFallback();
    const parser = installParserFallback();
    return windowCapture || input || log || parser;
  }

  function waitForInstall(attempts = 0) {
    install();
    if (attempts < 200) setTimeout(() => waitForInstall(attempts + 1), 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => waitForInstall(), { once: true });
  } else {
    waitForInstall();
  }
})();
