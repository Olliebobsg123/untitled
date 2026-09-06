"use strict";

/*
 * Custom fixture <-> show-file bridge.
 *
 * The fixture editor historically stored its library in localStorage. Keep
 * its existing API intact, but redirect that one storage key into State so
 * the definitions are included in the normal show-file snapshot/restore.
 */
(function installCustomFixtureShowfileBridge() {
  const KEY = "lx-custom-fixtures";
  const STATE_KEY = "__lxCustomFixtures";
  const nativeGet = Storage.prototype.getItem;
  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;

  function ensureState() {
    const state = window.State || (window.State = {});
    if (!state.current || typeof state.current !== "object" || Array.isArray(state.current)) {
      state.current = {};
    }
    if (!state.current[STATE_KEY] || typeof state.current[STATE_KEY] !== "object" || Array.isArray(state.current[STATE_KEY])) {
      state.current[STATE_KEY] = {};
    }
    return state;
  }

  function readDefinitions() {
    const state = ensureState();
    return state.current[STATE_KEY];
  }

  function writeDefinitions(value) {
    const state = ensureState();
    state.current[STATE_KEY] = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return true;
  }

  // One-time migration of fixtures created by the old editor, then remove the
  // local copy so the fixture library is no longer a machine-local save.
  try {
    const legacy = nativeGet.call(window.localStorage, KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length) {
        const current = readDefinitions();
        Object.assign(current, parsed);
      }
      nativeRemove.call(window.localStorage, KEY);
    }
  } catch (_) {}

  Storage.prototype.getItem = function (key) {
    if (key === KEY && this === window.localStorage) {
      return JSON.stringify(readDefinitions());
    }
    return nativeGet.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (key === KEY && this === window.localStorage) {
      try {
        const parsed = JSON.parse(String(value));
        writeDefinitions(parsed);
      } catch (_) {
        writeDefinitions({});
      }
      return;
    }
    return nativeSet.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (key === KEY && this === window.localStorage) {
      writeDefinitions({});
      return;
    }
    return nativeRemove.call(this, key);
  };

  function reinstall() {
    try { window.LXFixtureEditor?.install?.(); } catch (_) {}
    try { window.renderLibrary?.(); } catch (_) {}
  }

  document.addEventListener("lx-show-loaded", () => {
    // showfile.js has just replaced State.current with the loaded snapshot.
    // Reinstall the custom fixture definitions from that show immediately.
    setTimeout(reinstall, 0);
  });

  window.LXCustomFixtureShowfile = Object.freeze({
    get: () => JSON.parse(JSON.stringify(readDefinitions())),
    set: value => writeDefinitions(value),
    clear: () => writeDefinitions({})
  });
})();
