"use strict";

// QLab is a Pro-only service. The core bridge is deliberately not loaded
// until the renderer has reported a Pro licence. This keeps the UDP and
// WebSocket bridge completely inactive for Free/Live licences.
const { BrowserWindow } = require("electron");

let core = null;
let gateTimer = null;
let shuttingDown = false;

async function checkLicenceAndStart() {
  if (shuttingDown || core) return;

  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) {
    gateTimer = setTimeout(checkLicenceAndStart, 100);
    return;
  }

  try {
    const tier = await win.webContents.executeJavaScript(
      'window.License && typeof window.License.getTier === "function" ? window.License.getTier() : "free"',
      true
    );

    if (String(tier).toLowerCase() !== "pro") {
      console.log(`🔒 QLab bridge disabled for ${String(tier || "free").toUpperCase()} licence`);
      gateTimer = setTimeout(checkLicenceAndStart, 1000);
      return;
    }

    console.log("🎵 Pro licence detected — starting QLab bridge");
    core = require("./qlab-bridge-core.js");
  } catch (err) {
    console.error("❌ QLab licence gate check failed:", err);
    gateTimer = setTimeout(checkLicenceAndStart, 1000);
  }
}

checkLicenceAndStart();

function shutdown() {
  shuttingDown = true;
  if (gateTimer) {
    clearTimeout(gateTimer);
    gateTimer = null;
  }
  try {
    if (core && typeof core.shutdown === "function") core.shutdown();
  } catch (err) {
    console.error("❌ QLab bridge shutdown failed:", err);
  }
  core = null;
}

module.exports = { shutdown };
