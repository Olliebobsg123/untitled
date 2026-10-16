"use strict";

// The command line. Each feature adds its own commands here instead of wrapping
// parseCommand():
//
//   LXCommands.add(raw => {
//     if (!/^my command$/i.test(raw.trim())) return LXCommands.NOT_MINE;
//     ...do it...
//   });
//   LXCommands.describe("my command", "[what goes after]");   // for the autocomplete list
//
// Handlers are tried newest first (a feature loaded later can refine an earlier
// one's command); { first: true } handlers always go before the rest. The first
// handler that doesn't return NOT_MINE has handled the command.
(() => {
  const NOT_MINE = Symbol("not mine");
  const firstHandlers = [];
  const handlers = [];
  const descriptions = [];

  function run(raw) {
    for (const handler of [...firstHandlers, ...handlers]) {
      let result;
      try {
        result = handler(raw);
      } catch (err) {
        console.error("[COMMAND]", err);
        window.log?.(`Command failed: ${err.message}`, "error");
        return undefined;
      }
      if (result !== NOT_MINE) return result;
    }
    window.log?.(`Unknown command: ${raw} — type "status" to see what's loaded`, "warn");
    return undefined;
  }

  window.LXCommands = Object.freeze({
    NOT_MINE,
    add(handler, { first = false } = {}) {
      if (typeof handler !== "function") return;
      if (first) firstHandlers.unshift(handler);
      else handlers.unshift(handler);
    },
    // The fallback that handles whatever nobody else claimed (js/commands.js).
    setFallback(handler) {
      handlers.push(handler);
    },
    describe(cmd, hint = "") {
      if (!descriptions.some(item => item.cmd === cmd)) descriptions.push({ cmd, hint });
    },
    descriptions: () => descriptions.slice(),
    run
  });

  window.parseCommand = run;
  // Older code pushes straight into this list.
  window.commandDefs = descriptions;
})();
