"use strict";

// Chase command bridge. This sits on top of the existing command input and
// deliberately leaves the main command parser untouched.
(function installChaseCommands() {
  const normalise = value => String(value || "").trim().replace(/\s+/g, " ");

  function list() {
    return Array.isArray(window.State?.chases) ? window.State.chases : [];
  }

  function log(message, type = "info") {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(`[CHASE COMMAND ${type}]`, message);
  }

  function findChase(value) {
    const wanted = normalise(value).toLowerCase();
    if (!wanted) return -1;

    const numbered = wanted.match(/^chase\s+(\d+)$/) || wanted.match(/^(\d+)$/);
    if (numbered) {
      const index = Number(numbered[1]) - 1;
      return Number.isInteger(index) && list()[index] ? index : -1;
    }

    return list().findIndex(chase => normalise(chase?.name).toLowerCase() === wanted);
  }

  function openNewChase() {
    const button = document.getElementById("btnSaveChase");
    if (!button) {
      log("New Chase button is not available yet", "warn");
      return false;
    }
    button.click();
    log("Opened New Chase", "ok");
    return true;
  }

  function selectChase(index) {
    const listEl = document.getElementById("chaseList");
    const row = listEl?.children?.[index];
    if (!row) return false;
    row.click();
    return true;
  }

  function runChase(value) {
    const index = findChase(value);
    if (index < 0) {
      log(`Chase "${normalise(value)}" not found`, "warn");
      return false;
    }

    // Use the same UI path as clicking a chase and then ▶ Run Chase. This
    // keeps command execution tied to the real chase engine rather than a
    // second, competing timer implementation.
    if (!selectChase(index)) {
      log("Chase list is not ready yet", "warn");
      return false;
    }

    const button = document.getElementById("btnRunChase");
    if (!button) {
      log("Run Chase button is not available yet", "warn");
      return false;
    }
    button.click();
    log(`Running Chase ${index + 1}: ${list()[index]?.name || `Chase ${index + 1}`}`, "ok");
    return true;
  }

  function stopChase(value = "") {
    const requested = normalise(value);
    if (requested) {
      const index = findChase(requested);
      if (index < 0) {
        log(`Chase "${requested}" not found`, "warn");
        return false;
      }

      const active = Number(window.State?.currentChase);
      if (active !== index) {
        log(`Chase "${list()[index]?.name || `Chase ${index + 1}`}" is not running`, "warn");
        return false;
      }
    }

    const button = document.getElementById("btnStopChase");
    if (!button) {
      log("Stop Chase button is not available yet", "warn");
      return false;
    }
    button.click();
    return true;
  }

  function handle(command) {
    const c = normalise(command);
    let match;

    if (/^new\s+chase$/i.test(c) || /^create\s+chase$/i.test(c)) return openNewChase();

    match = c.match(/^run\s+chase\s+(.+)$/i);
    if (match) return runChase(match[1]);

    match = c.match(/^start\s+chase\s+(.+)$/i);
    if (match) return runChase(match[1]);

    match = c.match(/^stop\s+chase(?:\s+(.+))?$/i);
    if (match) return stopChase(match[1] || "");

    match = c.match(/^halt\s+chase(?:\s+(.+))?$/i);
    if (match) return stopChase(match[1] || "");

    return false;
  }

  window.handleChaseCommand = handle;

  function wire() {
    const input = document.getElementById("cmdInput");
    if (!input || input.dataset.chaseCommandsWired === "1") return;
    input.dataset.chaseCommandsWired = "1";

    // commands.js keeps parseCommand private, so wrapping window.parseCommand
    // cannot work. Capture Enter here, before the normal command handler gets
    // the chase command.
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const command = normalise(input.value);
      if (!/^(new\s+chase|create\s+chase|run\s+chase\s+.+|start\s+chase\s+.+|stop\s+chase(?:\s+.*)?|halt\s+chase(?:\s+.*)?)$/i.test(command)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (handle(command)) input.value = "";
    }, true);

    console.log("[CHASE COMMANDS] Ready");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();
