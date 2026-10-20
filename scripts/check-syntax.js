"use strict";

// npm test's syntax check, in Node so it runs the same on macOS, Windows
// and Linux (the old one was a bash loop, which Windows' cmd can't run).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [
  "main.js", "preload.js", "relay.js", "usb-dmx.js", "multi-output.js", "remote-server.js",
  "desk-link.js", "session-link.js", "scripts/after-pack-mac.js", "scripts/check-syntax.js",
  ...fs.readdirSync(path.join(root, "js")).filter(f => f.endsWith(".js")).map(f => `js/${f}`)
].filter(f => fs.existsSync(path.join(root, f)));

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) { failed++; process.stderr.write(result.stderr || `${file}: syntax error\n`); }
}
if (failed) { console.error(`${failed} file(s) failed the syntax check`); process.exit(1); }
console.log(`syntax OK (${files.length} files)`);
