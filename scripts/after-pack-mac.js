"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const outputDir = context.appOutDir;
  if (!fs.existsSync(outputDir)) {
    throw new Error(`macOS app output directory was not found: ${outputDir}`);
  }

  const appEntry = fs.readdirSync(outputDir, { withFileTypes: true })
    .find(entry => entry.isDirectory() && entry.name.endsWith(".app"));

  if (!appEntry) {
    throw new Error(`macOS .app bundle was not found inside: ${outputDir}`);
  }

  const appPath = path.join(outputDir, appEntry.name);
  console.log(`[macOS] Applying ad-hoc signature to ${appEntry.name}`);

  const result = spawnSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign failed with exit code ${result.status}`);
  }

  const verify = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", appPath],
    { stdio: "inherit" }
  );

  if (verify.error) throw verify.error;
  if (verify.status !== 0) {
    throw new Error(`codesign verification failed with exit code ${verify.status}`);
  }

  console.log("[macOS] Ad-hoc signature verified successfully");
};
