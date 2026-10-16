"use strict";

// The console log at the bottom of the screen. log(message, "ok" | "info" | "warn" | "error")
(() => {
  const LEVELS = { ok: "ok", success: "ok", info: "info", warn: "warn", warning: "warn", error: "error", fail: "error" };
  const MAX_LINES = 250;
  const early = [];

  function write(message, type = "info") {
    const level = LEVELS[String(type).toLowerCase()] || "info";
    const out = document.getElementById("termLog");
    if (!out) {
      early.push([message, level]);
      console.log(`[${level.toUpperCase()}] ${message}`);
      return;
    }
    const line = document.createElement("div");
    line.className = "lx-log-entry";
    const time = document.createElement("span");
    time.className = "lx-log-time";
    time.textContent = new Date().toTimeString().slice(0, 8);
    const badge = document.createElement("span");
    badge.className = `lx-log-level ${level}`;
    badge.textContent = level.toUpperCase();
    const text = document.createElement("span");
    text.className = "lx-log-message";
    text.textContent = String(message);
    line.append(time, badge, text);
    out.appendChild(line);
    while (out.children.length > MAX_LINES) out.firstElementChild.remove();
    out.scrollTop = out.scrollHeight;
  }

  window.log = write;

  // Anything logged before the page was ready.
  document.addEventListener("DOMContentLoaded", () => {
    early.splice(0).forEach(([message, level]) => write(message, level));
  }, { once: true });
})();
