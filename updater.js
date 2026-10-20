"use strict";

// Software updates.
//
// Each build the GitHub workflows make gets a new version number and is
// published with a small "latest.yml" (Windows) / "latest-mac.yml" file
// saying what the newest version is. The app checks that file:
//
//   Windows installer  downloads the update in the background and installs
//                      it the next time Light Spark quits (or "Restart now").
//                      It never restarts on its own: the lights stay up.
//   Windows portable,  can't replace themselves (the Mac build isn't signed),
//   Mac                so they say an update is out and offer the download.
//   npm start          running from the source: update with git pull.
//
//   createUpdater({ app, shell, send }) -> { check, install, status }

function createUpdater({ app, shell, send, feedUrl }) {
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const canInstall = app.isPackaged && process.platform === "win32" && !portable;
  let state = {
    version: app.getVersion(),
    packaged: app.isPackaged,
    canInstall,
    status: app.isPackaged ? "idle" : "source", // idle | checking | none | available | downloading | ready | error | source
    latest: null, percent: 0, error: "", checkedAt: 0, download: ""
  };
  const set = patch => { state = { ...state, ...patch }; try { send(state); } catch (_) {} };

  let updater = null;
  function load() {
    if (updater || !app.isPackaged) return updater;
    try { ({ autoUpdater: updater } = require("electron-updater")); } catch (error) { set({ status: "error", error: `Updater missing: ${error.message}` }); return null; }
    if (feedUrl) updater.setFeedURL({ provider: "generic", url: feedUrl });
    updater.autoDownload = canInstall;
    updater.autoInstallOnAppQuit = canInstall;
    updater.allowPrerelease = false;
    updater.logger = null;
    updater.on("checking-for-update", () => set({ status: "checking", error: "" }));
    updater.on("update-not-available", () => set({ status: "none", checkedAt: Date.now() }));
    updater.on("update-available", info => {
      // The builds keep the same file names (see package.json), next to each other.
      const file = portable ? "Lighting-Console-portable.exe" : process.platform === "darwin" ? `Lighting-Console-${process.arch}.dmg` : "Lighting-Console-x64.exe";
      set({ status: canInstall ? "downloading" : "available", latest: info?.version || null, checkedAt: Date.now(), percent: 0, download: feedUrl ? `${feedUrl.replace(/\/$/, "")}/${file}` : "" });
    });
    updater.on("download-progress", p => set({ status: "downloading", percent: Math.round(p?.percent || 0) }));
    updater.on("update-downloaded", info => set({ status: "ready", latest: info?.version || state.latest, percent: 100 }));
    updater.on("error", error => set({ status: "error", error: friendly(error), checkedAt: Date.now() }));
    return updater;
  }

  function friendly(error) {
    const text = String(error?.message || error || "");
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(text)) return "Couldn't reach the update server — check the internet connection.";
    if (/404|Cannot find .*latest/i.test(text)) return "No update information was found online yet.";
    return text.split("\n")[0].slice(0, 200);
  }

  async function check() {
    if (!app.isPackaged) { set({ status: "source" }); return state; }
    const u = load();
    if (!u) return state;
    if (state.status === "downloading" || state.status === "ready") return state;
    try { await u.checkForUpdates(); } catch (error) { set({ status: "error", error: friendly(error) }); }
    return state;
  }

  function install() {
    if (state.status === "ready" && updater) { setImmediate(() => updater.quitAndInstall(false, true)); return true; }
    if (state.download) { shell.openExternal(state.download); return true; }
    return false;
  }

  return { check, install, status: () => state };
}

module.exports = { createUpdater };
