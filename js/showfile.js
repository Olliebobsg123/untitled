"use strict";

(function initialiseShowFiles() {
  const api = () => window.LXShowFiles;

  const cloneValue = value => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
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
    const fixtureStates = state.fixtureStates instanceof Map
      ? [...state.fixtureStates.entries()].map(([id, value]) => [id, cloneValue(value)])
      : [];

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
      fixtureStates,
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

    if (typeof window.initFixtureStates === "function") window.initFixtureStates();
    window.chaseFade = state.chaseFade;
    window.chaseWait = state.chaseWait;
    window.updateDMX?.();
    window.sendToVisualizer?.();
    window.renderFixtures?.();
    window.buildControls?.();
    window.render?.();
    window.updateControlVisibility?.();
    document.dispatchEvent(new CustomEvent("lx-show-loaded", { detail: show }));
  }

  function showResult(message, level = "ok") {
    window.log?.(message, level);
  }

  async function saveShow(filePath) {
    if (!api()?.save) throw new Error("Show file support is unavailable");
    const result = await api().save(String(filePath || ""), snapshotShow());
    showResult(`Show saved: ${result.path}`, "ok");
    return result;
  }

  async function loadShow(filePath) {
    if (!api()?.load) throw new Error("Show file support is unavailable");
    const result = await api().load(String(filePath || ""));
    restoreShow(result.show);
    showResult(`Show loaded: ${result.path}`, "ok");
    return result;
  }

  window.LXShowFiles = window.LXShowFiles || {};
  window.LXShowFiles.saveShow = saveShow;
  window.LXShowFiles.loadShow = loadShow;
  window.LXShowFiles.snapshot = snapshotShow;

  function installCommandWrapper() {
    const current = window.parseCommand;
    if (typeof current !== "function") return false;
    if (current.__lxShowFiles) return true;

    const wrapped = async function(raw) {
      const command = String(raw ?? "").trim();
      const match = command.match(/^(save|load)\s+(.+)$/i);
      if (!match) return current.apply(this, arguments);

      const action = match[1].toLowerCase();
      const requestedPath = match[2].trim().replace(/^['"]|['"]$/g, "");
      if (!requestedPath) {
        showResult(`${action.toUpperCase()} requires a .json show path`, "warn");
        return;
      }
      if (!/\.json$/i.test(requestedPath)) {
        showResult("Show files must use the .json extension", "warn");
        return;
      }

      try {
        return action === "save" ? await saveShow(requestedPath) : await loadShow(requestedPath);
      } catch (err) {
        console.error(`[SHOW] ${action} failed:`, err);
        showResult(`${action.toUpperCase()} failed: ${err?.message || err}`, "error");
      }
    };
    wrapped.__lxShowFiles = true;
    wrapped.__lxShowFilesOriginal = current;
    window.parseCommand = wrapped;
    return true;
  }

  function waitForCommandParser() {
    if (installCommandWrapper()) return;
    setTimeout(waitForCommandParser, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForCommandParser, { once: true });
  } else {
    waitForCommandParser();
  }
})();
