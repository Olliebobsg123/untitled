"use strict";

// Chase command bridge. Loaded after commands.js so it can extend the
// existing parser without replacing the console's command system.
(function installChaseCommands() {
  const normalise = value => String(value || "").trim().toLowerCase();

  function chaseList() {
    return Array.isArray(window.State?.chases) ? window.State.chases : [];
  }

  function findChase(name) {
    const wanted = normalise(name);
    if (!wanted) return -1;
    const list = chaseList();
    const exact = list.findIndex(ch => normalise(ch?.name) === wanted);
    if (exact >= 0) return exact;
    const number = Number(wanted);
    if (Number.isInteger(number) && number >= 1 && list[number - 1]) return number - 1;
    return list.findIndex(ch => normalise(ch?.name).includes(wanted));
  }

  function openNewChase() {
    // chases.js owns the real picker used by the New Chase button.
    // Calling the same public entry point guarantees the command opens
    // exactly the same menu rather than creating a second implementation.
    if (typeof window.openChasePicker === "function") {
      window.openChasePicker();
      return true;
    }
    const button = document.getElementById("btnSaveChase");
    if (button) {
      button.click();
      return true;
    }
    if (typeof window.log === "function") window.log("Chase creator is not ready yet", "warn");
    return false;
  }

  function runNamedChase(name) {
    const index = findChase(name);
    if (index < 0) {
      window.log?.(`Chase "${name}" not found`, "warn");
      return false;
    }
    if (typeof window.startChase !== "function") {
      window.log?.("Chase engine is not ready yet", "warn");
      return false;
    }
    return window.startChase(index);
  }

  function stopNamedChase(name) {
    const list = chaseList();
    const index = findChase(name);
    if (index < 0) {
      window.log?.(`Chase "${name}" not found`, "warn");
      return false;
    }
    if (typeof window.stopChase !== "function") {
      window.log?.("Chase engine is not ready yet", "warn");
      return false;
    }
    // Only stop if the named chase is actually the active one. If another
    // chase is running, don't unexpectedly kill it.
    const active = Number(window.State?.currentChase);
    if (active !== index) {
      window.log?.(`Chase "${list[index]?.name || `Chase ${index + 1}`}" is not running`, "warn");
      return false;
    }
    window.stopChase();
    return true;
  }

  function install() {
    const original = window.parseCommand;
    if (typeof original !== "function") {
      setTimeout(install, 100);
      return;
    }
    if (original.__chaseCommandBridge) return;

    const wrapped = function chaseCommandBridge(raw) {
      const command = normalise(raw);
      let match;

      if (command === "new chase" || command === "create chase") {
        return openNewChase();
      }

      match = command.match(/^run\s+chase\s+(.+)$/);
      if (match) return runNamedChase(match[1].trim());

      match = command.match(/^start\s+chase\s+(.+)$/);
      if (match) return runNamedChase(match[1].trim());

      match = command.match(/^stop\s+chase\s+(.+)$/);
      if (match) return stopNamedChase(match[1].trim());

      match = command.match(/^halt\s+chase\s+(.+)$/);
      if (match) return stopNamedChase(match[1].trim());

      if (command === "stop chase" || command === "halt chase") {
        if (typeof window.stopChase !== "function") {
          window.log?.("Chase engine is not ready yet", "warn");
          return false;
        }
        window.stopChase();
        return true;
      }

      return original(raw);
    };

    wrapped.__chaseCommandBridge = true;
    window.parseCommand = wrapped;
    window.log?.("✅ Chase commands ready: new chase / run chase / stop chase", "ok");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
