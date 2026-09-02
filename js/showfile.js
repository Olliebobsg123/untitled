"use strict";

(function initialiseShowFiles() {
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

  function showResult(message, level = "ok") {
    if (typeof window.log === "function") window.log(message, level);
    else console.log(`[SHOW] ${message}`);
  }

  function normalisePath(raw) {
    return String(raw || "")
      .trim()
      .replace(/^['"]+|['"]+$/g, "")
      .replace(/^\((.*)\)$/s, "$1")
      .trim();
  }

  async function saveShow(filePath) {
    if (!api()?.save) throw new Error("Show file support is unavailable");
    const requested = normalisePath(filePath);
    if (!requested) throw new Error("SAVE requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const result = await api().save(requested, snapshotShow());
    showResult(`Show saved: ${result.path}`, "ok");
    return result;
  }

  async function loadShow(filePath) {
    if (!api()?.load) throw new Error("Show file support is unavailable");
    const requested = normalisePath(filePath);
    if (!requested) throw new Error("LOAD requires a show path");
    if (!/\.json$/i.test(requested)) throw new Error("Show files must use the .json extension");
    const result = await api().load(requested);
    restoreShow(result.show);
    showResult(`Show loaded: ${result.path}`, "ok");
    return result;
  }

  window.LXShowFiles = window.LXShowFiles || {};
  window.LXShowFiles.saveShow = saveShow;
  window.LXShowFiles.loadShow = loadShow;
  window.LXShowFiles.snapshot = snapshotShow;

  async function executeShowCommand(raw) {
    const command = String(raw ?? "").trim();
    const match = command.match(/^(save|load)\s+(.+)$/i);
    if (!match) return false;

    const action = match[1].toLowerCase();
    const requestedPath = normalisePath(match[2]);
    if (!requestedPath) {
      showResult(`${action.toUpperCase()} requires a .json show path`, "warn");
      return true;
    }

    try {
      if (action === "save") await saveShow(requestedPath);
      else await loadShow(requestedPath);
    } catch (err) {
      console.error(`[SHOW] ${action} failed:`, err);
      showResult(`${action.toUpperCase()} failed: ${err?.message || err}`, "error");
    }
    return true;
  }

  // The normal command handler is a lexical function in commands.js, so
  // replacing window.parseCommand alone does not intercept Enter. Capture
  // SAVE/LOAD at the command input before the normal handler sees the event.
  function installCommandInput() {
    const input = document.getElementById("cmdInput");
    if (!input || input.dataset.showFileCommands === "1") return !!input;
    input.dataset.showFileCommands = "1";

    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const command = String(input.value || "").trim();
      if (!/^(save|load)\s+.+$/i.test(command)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      void executeShowCommand(command);
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, true);

    return true;
  }

  function installCommandWrapper() {
    const current = window.parseCommand;
    if (typeof current !== "function") return false;
    if (current.__lxShowFiles) return true;

    const wrapped = function(raw) {
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
    const inputReady = installCommandInput();
    const parserReady = installCommandWrapper();
    return inputReady || parserReady;
  }

  function waitForInstall(attempts = 0) {
    if (install()) return;
    if (attempts < 200) setTimeout(() => waitForInstall(attempts + 1), 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => waitForInstall(), { once: true });
  } else {
    waitForInstall();
  }
})();
