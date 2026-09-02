"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * electron-builder calls this hook after the app bundle has been assembled,
 * but before the DMG/ZIP targets are produced.
 *
 * CI does not have an Apple Developer signing identity, so we apply an
 * ad-hoc Apple signature instead of shipping a completely unsigned bundle.
 * This does NOT provide Apple notarization; it simply prevents macOS from
 * treating the downloaded application as a modified/invalid bundle.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = context.appOutDir;
  if (!fs.existsSync(appPath)) {
    throw new Error(`macOS app bundle was not found: ${appPath}`);
  }

  console.log(`[macOS] Applying ad-hoc signature to ${path.basename(appPath)}`);

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
