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
//   Mac                the same, done here (the build isn't signed, and
//                      Apple's own updater only takes signed apps): the new
//                      app's zip is downloaded and checked against its
//                      checksum, unpacked, and swapped in by a small script
//                      once Light Spark has quit (the old one comes back if
//                      anything goes wrong). Running from the disk image or a
//                      folder it can't write to: it offers the download.
//   Windows portable   can't replace itself: offers the download.
//   npm start          running from the source: update with git pull.
//
//   createUpdater({ app, shell, send }) -> { check, install, status }

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");

// The running Mac app's bundle, if Light Spark can replace it: not inside the
// disk image, and in a folder it may write to.
function macBundle(app) {
  if (process.platform !== "darwin" || !app.isPackaged) return null;
  const bundle = path.resolve(path.dirname(process.execPath), "..", "..");
  if (!bundle.endsWith(".app") || bundle.startsWith("/Volumes/")) return null;
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); } catch (_) { return null; }
  return bundle;
}

function createUpdater({ app, shell, send, feedUrl }) {
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const bundle = macBundle(app);
  const mac = Boolean(bundle);
  const canInstall = app.isPackaged && ((process.platform === "win32" && !portable) || mac);
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
    // The Mac downloads and installs its own way (below).
    updater.autoDownload = canInstall && !mac;
    updater.autoInstallOnAppQuit = canInstall && !mac;
    updater.allowPrerelease = false;
    updater.logger = null;
    updater.on("checking-for-update", () => set({ status: "checking", error: "" }));
    updater.on("update-not-available", () => set({ status: "none", checkedAt: Date.now() }));
    updater.on("update-available", info => {
      // The builds keep the same file names (see package.json), next to each other.
      const file = portable ? "Lighting-Console-portable.exe" : process.platform === "darwin" ? `Lighting-Console-${process.arch}.dmg` : "Lighting-Console-x64.exe";
      set({ status: canInstall ? "downloading" : "available", latest: info?.version || null, checkedAt: Date.now(), percent: 0, download: feedUrl ? `${feedUrl.replace(/\/$/, "")}/${file}` : "" });
      if (mac) macDownload(info).catch(error => { set({ status: "available", error: friendly(error) }); cleanup(); });
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

  // ---- Mac: download, check, unpack; swap in when Light Spark quits ----

  const workDir = () => path.join(app.getPath("userData"), "Update");
  let staged = null; // the unpacked new .app, ready to swap in
  let swapping = false;
  function cleanup() { try { fs.rmSync(workDir(), { recursive: true, force: true }); } catch (_) {} staged = null; }

  async function macDownload(info) {
    const files = Array.isArray(info?.files) ? info.files : [];
    const zip = files.find(f => new RegExp(`-${process.arch}\\.zip$`).test(f.url)) || files.find(f => /\.zip$/.test(f.url));
    if (!zip) throw new Error("No Mac zip in the update");
    const url = /^https?:/.test(zip.url) ? zip.url : `${feedUrl.replace(/\/$/, "")}/${zip.url}`;
    cleanup();
    fs.mkdirSync(workDir(), { recursive: true });
    const file = path.join(workDir(), "update.zip");
    // Download (following GitHub's redirect), with progress and the checksum.
    const { net } = require("electron");
    const res = await net.fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get("content-length")) || Number(zip.size) || 0;
    const hash = crypto.createHash("sha512");
    const out = fs.createWriteStream(file);
    let got = 0, last = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once("drain", r));
      got += value.length;
      const pct = total ? Math.round(got / total * 100) : 0;
      if (pct !== last) { last = pct; set({ status: "downloading", percent: pct }); }
    }
    await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    if (zip.sha512 && hash.digest("base64") !== zip.sha512) throw new Error("The download was damaged (checksum didn't match) — it will try again later");
    // Unpack with macOS's own tool (keeps the app's links and permissions).
    const into = path.join(workDir(), "app");
    fs.mkdirSync(into, { recursive: true });
    await new Promise((resolve, reject) => execFile("/usr/bin/ditto", ["-x", "-k", file, into], err => (err ? reject(err) : resolve())));
    fs.rmSync(file, { force: true });
    const name = fs.readdirSync(into).find(n => n.endsWith(".app"));
    if (!name || !fs.existsSync(path.join(into, name, "Contents", "MacOS"))) throw new Error("The update didn't contain the app");
    staged = path.join(into, name);
    set({ status: "ready", latest: info?.version || state.latest, percent: 100 });
  }

  // A small script that waits for Light Spark to close, puts the new app in
  // place of the old one (or the old one back, if that fails), and opens it
  // again if asked.
  function macSwap(relaunch) {
    if (!staged || swapping) return false;
    swapping = true;
    const script = path.join(workDir(), "swap.sh");
    fs.writeFileSync(script, `#!/bin/bash
PID="$1"; NEW="$2"; OLD="$3"; RELAUNCH="$4"; WORK="$5"
for i in $(seq 1 600); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
BACKUP="$OLD.previous"
rm -rf "$BACKUP"
if mv "$OLD" "$BACKUP" && /usr/bin/ditto "$NEW" "$OLD"; then
  rm -rf "$BACKUP"
else
  rm -rf "$OLD"; mv "$BACKUP" "$OLD"
fi
/usr/bin/xattr -dr com.apple.quarantine "$OLD" 2>/dev/null
rm -rf "$WORK"
[ "$RELAUNCH" = "1" ] && /usr/bin/open "$OLD"
exit 0
`, { mode: 0o755 });
    const child = spawn("/bin/bash", [script, String(process.pid), staged, bundle, relaunch ? "1" : "0", workDir()], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  }
  // Quitting with an update ready installs it (as on Windows).
  if (mac) app.on("will-quit", () => { if (state.status === "ready") macSwap(false); });

  function install() {
    if (state.status === "ready" && mac) { if (macSwap(true)) setImmediate(() => app.quit()); return true; }
    if (state.status === "ready" && updater) { setImmediate(() => updater.quitAndInstall(false, true)); return true; }
    if (state.download) { shell.openExternal(state.download); return true; }
    return false;
  }

  return { check, install, status: () => state };
}

module.exports = { createUpdater };
