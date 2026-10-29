const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
// The screen mirror talks WebRTC on the local network. Chromium hides local
// IP addresses behind mDNS names, which some Wi-Fi networks can't resolve
// (they block multicast): use the plain addresses.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// Startup log: what the app was doing, and any moment the main process was
// stuck (Windows calls that "Not Responding"). Kept in the app's data folder
// (File → Show Log Folder on Windows, the Light Spark menu on a Mac), newest 200 KB.
const startedAt = Date.now();
let logFile = null;
function mark(what) {
  try {
    if (!logFile) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'main.log');
      try { if (fs.statSync(logFile).size > 200 * 1024) fs.renameSync(logFile, `${logFile}.old`); } catch (_) {}
      fs.appendFileSync(logFile, `\n=== ${new Date().toISOString()} Light Spark ${app.getVersion()} on ${process.platform} ${require('os').release()} ===\n`);
    }
    fs.appendFileSync(logFile, `${((Date.now() - startedAt) / 1000).toFixed(2)}s ${what}\n`);
  } catch (_) {}
}
let lastMark = 'starting';
const step = what => { lastMark = what; mark(what); };
{
  let last = Date.now();
  setInterval(() => {
    const now = Date.now(), late = now - last - 250;
    if (late > 1500) mark(`STUCK for ${(late / 1000).toFixed(1)}s (after: ${lastMark})`);
    last = now;
  }, 250).unref?.();
}

// One copy at a time: a second copy would fight the first over the DMX
// output ports (double-clicking twice is easy on Windows). Opening it again
// brings the running one to the front. LX_ALLOW_MULTIPLE=1 lifts this.
if (!process.env.LX_ALLOW_MULTIPLE && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
let servicesStarted = false;
let relayService = null;
let qlabBridgeService = null;
let multiOutputService = null;
let citpService = null;
let usbDmxService = null;
let shuttingDown = false;
let qlabLicenseTimer = null;

// ---- Shows folder (and working across two Macs) ----
// Shows live in Documents/LX Console Shows unless you choose iCloud Drive
// (iCloud Drive/Light Spark Shows) or a folder of your own in Preferences →
// Show → Shows Folder. In a synced folder the show is the same on every Mac;
// Light Spark adds what syncing alone doesn't: who saved it (savedBy), a
// note while it's open somewhere (<show>.json.lxlock), and downloading a
// show iCloud has only a placeholder for.
const os = require('os');
const showsConfigFile = () => path.join(app.getPath('userData'), 'shows-folder.json');
const icloudRoot = () => path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
function readShowsConfig() {
  try { return JSON.parse(fs.readFileSync(showsConfigFile(), 'utf8')) || {}; } catch (_) { return {}; }
}
function showDirectoryFor(config) {
  if (config.kind === 'icloud') return path.join(icloudRoot(), 'Light Spark Shows');
  if (config.kind === 'custom' && config.path) return config.path;
  return path.join(app.getPath('documents'), 'LX Console Shows');
}
function getShowDirectory() {
  const directory = showDirectoryFor(readShowsConfig());
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
// This Mac's name as you know it ("Oliver's MacBook Air").
let hostName = null;
function thisHost() {
  if (hostName) return hostName;
  if (process.platform === 'darwin') { try { hostName = require('child_process').execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim(); } catch (_) {} }
  if (!hostName) hostName = os.hostname().replace(/\.local$/i, '');
  return hostName;
}
const lockPath = filePath => `${filePath}.lxlock`;
const LOCK_FRESH_MS = 3 * 60 * 1000; // a lock not refreshed for 3 minutes is left over from a crash
function readLock(filePath) {
  try { const lock = JSON.parse(fs.readFileSync(lockPath(filePath), 'utf8')); return lock && lock.host ? lock : null; } catch (_) { return null; }
}
// iCloud keeps a placeholder ".Name.json.icloud" for a file it hasn't
// downloaded to this Mac yet; ask for it and wait.
const placeholderOf = filePath => path.join(path.dirname(filePath), `.${path.basename(filePath)}.icloud`);
async function downloadFromICloud(filePath, waitMs = 60000) {
  if (fs.existsSync(filePath) || !fs.existsSync(placeholderOf(filePath))) return fs.existsSync(filePath);
  try { require('child_process').execFile('brctl', ['download', filePath], () => {}); } catch (_) {}
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (fs.existsSync(filePath)) { await new Promise(r => setTimeout(r, 300)); return true; }
    await new Promise(r => setTimeout(r, 500));
  }
  return fs.existsSync(filePath);
}
function copyShows(from, to) {
  let copied = 0;
  const copyDir = (src, dest, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const a = path.join(src, e.name), b = path.join(dest, e.name);
      if (e.isDirectory() && depth < 2 && !e.name.startsWith('.')) { fs.mkdirSync(b, { recursive: true }); copyDir(a, b, depth + 1); }
      else if (e.isFile() && /\.json$/i.test(e.name)) {
        // Never over a newer copy that's already there.
        try { if (fs.existsSync(b) && fs.statSync(b).mtimeMs >= fs.statSync(a).mtimeMs) continue; } catch (_) {}
        fs.copyFileSync(a, b);
        if (path.basename(src) !== 'Backups') copied++; // backups come too, but aren't counted as shows
      }
    }
  };
  fs.mkdirSync(to, { recursive: true });
  copyDir(from, to, 0);
  return copied;
}
ipcMain.handle('lx-shows-folder', () => {
  const config = readShowsConfig();
  return { kind: config.kind || 'documents', path: getShowDirectory(), icloud: fs.existsSync(icloudRoot()), icloudPath: showDirectoryFor({ kind: 'icloud' }), host: thisHost() };
});
ipcMain.handle('lx-shows-folder-set', (_event, payload) => {
  const before = getShowDirectory();
  const kind = ['documents', 'icloud', 'custom'].includes(payload?.kind) ? payload.kind : 'documents';
  if (kind === 'icloud' && !fs.existsSync(icloudRoot())) throw new Error('iCloud Drive isn\'t turned on for this Mac (System Settings → your name → iCloud → iCloud Drive)');
  if (kind === 'custom' && !payload?.path) throw new Error('No folder chosen');
  fs.writeFileSync(showsConfigFile(), JSON.stringify({ kind, path: kind === 'custom' ? payload.path : undefined }), 'utf8');
  const after = getShowDirectory();
  const copied = payload?.copy && path.resolve(before) !== path.resolve(after) ? copyShows(before, after) : 0;
  return { path: after, copied, from: before };
});
ipcMain.handle('lx-shows-folder-choose', async event => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(win, { title: 'Choose a shows folder', defaultPath: fs.existsSync(icloudRoot()) ? icloudRoot() : app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || !result.filePaths?.[0] ? null : result.filePaths[0];
});
// While a show is open, a small note next to it says where; on with
// on: true (refreshed every minute), off when it's closed.
ipcMain.handle('lx-show-lock', (_event, payload) => {
  let filePath;
  try { filePath = resolveShowPath(payload?.filePath); } catch (_) { return null; }
  const lock = readLock(filePath);
  const other = lock && lock.host !== thisHost() && Date.now() - Number(lock.at || 0) < LOCK_FRESH_MS ? lock : null;
  if (payload?.on) { try { fs.writeFileSync(lockPath(filePath), JSON.stringify({ host: thisHost(), at: Date.now(), since: lock && lock.host === thisHost() ? lock.since : Date.now() }), 'utf8'); } catch (_) {} }
  else if (lock && lock.host === thisHost()) { try { fs.unlinkSync(lockPath(filePath)); } catch (_) {} }
  return { other, host: thisHost() };
});

function resolveShowPath(filePath) {
  const requested = String(filePath || '').trim();
  if (!requested) throw new Error('No show path supplied');
  const directory = getShowDirectory();
  const resolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(directory, requested);
  if (!/\.json$/i.test(resolved)) throw new Error('Show files must use the .json extension');
  return resolved;
}

ipcMain.handle('lx-show-default-directory', () => getShowDirectory());
// Audio timecode (LTC) listens to a sound input: macOS asks the user first.
// Screen mirror (js/screen-mirror.js): the id of this window for capture,
// and whether macOS lets us record it.
ipcMain.handle('lx-screen-source', event => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  let permission = 'granted';
  if (process.platform === 'darwin') { try { permission = require('electron').systemPreferences.getMediaAccessStatus('screen'); } catch (_) {} }
  return { id: win ? win.getMediaSourceId() : null, permission };
});
// Every screen and window that could be shown live on a video screen in the
// visualiser (e.g. QLab's video output), with a small picture of each.
ipcMain.handle('lx-screen-sources', async () => {
  let permission = 'granted';
  if (process.platform === 'darwin') { try { permission = require('electron').systemPreferences.getMediaAccessStatus('screen'); } catch (_) {} }
  try {
    const sources = await require('electron').desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    return { permission, sources: sources.map(s => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '' })) };
  } catch (error) {
    return { permission, sources: [], error: String(error && error.message || error) };
  }
});
ipcMain.handle('lx-open-screen-settings', () => { if (process.platform === 'darwin') require('electron').shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); });
ipcMain.handle('lx-ask-microphone', async () => {
  if (process.platform !== 'darwin') return true;
  const { systemPreferences } = require('electron');
  try { return await systemPreferences.askForMediaAccess('microphone'); } catch (_) { return false; }
});
// Backs the splash screen's "Recent Shows" list — a real directory read
// of the one folder this app ever saves shows into, not an arbitrary
// disk search. Bounded and fast (typically a handful of files), and
// always accurate (a show renamed or deleted outside the app just
// stops/starts appearing) in a way a separately-tracked history list
// couldn't be.
ipcMain.handle('lx-show-list', () => {
  const directory = getShowDirectory();
  const found = [];
  // The folder itself and one folder down (a folder per production, with
  // its QLab workspace and Capture project beside the show), not Backups.
  const look = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth === 0 && entry.name !== 'Backups' && !entry.name.startsWith('.') && !/\.(qlab\d*|cap\w*)$/i.test(entry.name)) look(full, 1); continue; }
      if (!entry.isFile()) continue;
      let name = null, filePath = full, cloud = false;
      if (/\.json$/i.test(entry.name) && !entry.name.startsWith('.')) name = entry.name.replace(/\.json$/i, '');
      else { const m = /^\.(.+\.json)\.icloud$/i.exec(entry.name); if (m) { name = m[1].replace(/\.json$/i, ''); filePath = path.join(dir, m[1]); cloud = true; } }
      if (!name) continue;
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch (_) {}
      found.push({ name: depth ? `${path.basename(dir)} / ${name}` : name, path: filePath, mtimeMs, cloud });
    }
  };
  look(directory, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 12);
});
// Before a save replaces a show file, the old one is copied to
// Backups/<name> before <date time>.json (the last 20 per show are kept), so
// saving over the wrong show can always be undone. Autosave doesn't do this
// (it saves every few minutes); every Save, Save As and "save" command does.
function backupBeforeReplace(filePath, nextText) {
  if (!fs.existsSync(filePath)) return null;
  let old;
  try { old = fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
  const strip = text => { try { const j = JSON.parse(text); delete j.savedAt; return JSON.stringify(j); } catch (_) { return text; } };
  if (strip(old) === strip(nextText)) return null; // nothing would be lost
  const dir = path.join(getShowDirectory(), 'Backups');
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(filePath).replace(/\.json$/i, '');
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
  const backup = path.join(dir, `${name} before ${stamp}.json`);
  fs.writeFileSync(backup, old, 'utf8');
  // Keep the newest 20 for this show.
  try {
    const mine = fs.readdirSync(dir).filter(f => f.startsWith(`${name} before `) && f.endsWith('.json')).sort();
    for (const f of mine.slice(0, Math.max(0, mine.length - 20))) fs.unlinkSync(path.join(dir, f));
  } catch (_) {}
  return backup;
}
ipcMain.handle('lx-show-save', (_event, payload) => {
  const filePath = resolveShowPath(payload?.filePath);
  const show = payload?.show;
  if (!show || typeof show !== 'object') throw new Error('No show data supplied');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Which Mac saved it: the other Mac sees "saved on Oliver's MacBook Pro".
  const text = JSON.stringify({ ...show, savedBy: thisHost() }, null, 2);
  const backup = payload?.backup ? backupBeforeReplace(filePath, text) : null;
  fs.writeFileSync(filePath, text, 'utf8');
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch (_) {}
  return { path: filePath, backup, mtimeMs, savedBy: thisHost() };
});
// What's in a show file, for "are you sure?" questions.
ipcMain.handle('lx-show-stat', (_event, payload) => {
  let filePath = resolveShowPath(payload?.filePath);
  if (!fs.existsSync(filePath)) {
    // "bms" means BMS.json even where file names are case-sensitive.
    try {
      const want = path.basename(filePath).toLowerCase();
      const match = fs.readdirSync(path.dirname(filePath)).find(f => f.toLowerCase() === want);
      if (match) filePath = path.join(path.dirname(filePath), match);
    } catch (_) {}
  }
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false, cloud: fs.existsSync(placeholderOf(filePath)) };
  const st = fs.statSync(filePath);
  let cues = null, fixtures = null, savedBy = null, savedAt = null;
  try { const j = JSON.parse(fs.readFileSync(filePath, 'utf8')); cues = (j.cues || []).filter(Boolean).length; fixtures = (j.fixtures || []).length; savedBy = j.savedBy || null; savedAt = j.savedAt || null; } catch (_) {}
  return { path: filePath, exists: true, mtimeMs: st.mtimeMs, cues, fixtures, savedBy, savedAt, host: thisHost() };
});
// Save As… and Open… pick a file with the system dialog, starting in the
// shows folder.
ipcMain.handle('lx-show-save-dialog', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const name = String(payload?.name || 'Untitled Show').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled Show';
  const result = await dialog.showSaveDialog(win, { title: 'Save Show', defaultPath: path.join(getShowDirectory(), /\.json$/i.test(name) ? name : `${name}.json`), filters: [{ name: 'Light Spark Show', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return null;
  return /\.json$/i.test(result.filePath) ? result.filePath : `${result.filePath}.json`;
});
ipcMain.handle('lx-show-open-dialog', async event => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(win, { title: 'Open Show', defaultPath: getShowDirectory(), properties: ['openFile'], filters: [{ name: 'Light Spark Show', extensions: ['json'] }] });
  return result.canceled || !result.filePaths?.[0] ? null : result.filePaths[0];
});
ipcMain.handle('lx-show-load', async (_event, payload) => {
  const filePath = resolveShowPath(payload?.filePath);
  if (!fs.existsSync(filePath) && fs.existsSync(placeholderOf(filePath)) && !(await downloadFromICloud(filePath))) throw new Error(`iCloud hasn't downloaded “${path.basename(filePath)}” to this Mac yet — check the internet connection and try again`);
  if (!fs.existsSync(filePath)) throw new Error(`Show file not found: ${filePath}`);
  let show;
  try { show = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { throw new Error(`Could not read show file: ${err.message}`); }
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch (_) {}
  return { path: filePath, show, mtimeMs };
});

// ---- Phone remote (see remote-server.js) ----
// The phone remote is optional: if remote-server.js isn't present the rest of
// the console runs normally and the remote just reports itself unavailable.
let remoteServer = null;
let remoteUnavailable = false;
function getRemoteServer() {
  if (!remoteServer && !remoteUnavailable) {
    let createRemoteServer;
    try {
      ({ createRemoteServer } = require('./remote-server.js'));
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
      remoteUnavailable = true;
      console.log('ℹ️ Phone remote not installed (remote-server.js missing) — skipping');
      return null;
    }
    remoteServer = createRemoteServer({
      configPath: path.join(app.getPath('userData'), 'remote.json'),
      onCommand: msg => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-remote-command', msg); },
      onClientsChanged: info => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-remote-info', info); }
    });
  }
  return remoteServer;
}
const REMOTE_OFF = { available: false, enabled: false, clients: 0 };
ipcMain.handle('lx-remote-info', () => getRemoteServer()?.info() ?? REMOTE_OFF);
ipcMain.handle('lx-remote-set-enabled', (_e, enabled) => getRemoteServer()?.setEnabled(enabled) ?? REMOTE_OFF);
ipcMain.handle('lx-remote-regen-pin', () => getRemoteServer()?.regeneratePin() ?? REMOTE_OFF);
ipcMain.on('lx-remote-snapshot', (_e, snapshot) => { if (remoteServer) remoteServer.broadcast(snapshot); });

// ---- Multi-console link (see session-link.js and js/session.js) ----
let sessionLink = null;
function getSessionLink() {
  if (!sessionLink) {
    const { createSessionLink } = require('./session-link.js');
    const toPage = (channel, data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); };
    sessionLink = createSessionLink({
      onMessage: (from, msg) => toPage('lx-session-message', { from, msg }),
      onStatus: info => toPage('lx-session-status', info)
    });
  }
  return sessionLink;
}
ipcMain.handle('lx-session-start', (_e, cfg) => getSessionLink().start(cfg));
ipcMain.handle('lx-session-info', () => getSessionLink().info());
ipcMain.handle('lx-session-discovered', () => getSessionLink().discovered());
ipcMain.on('lx-session-send', (_e, payload) => { if (sessionLink) sessionLink.send(payload?.msg, payload?.to || null, payload?.except || null); });
ipcMain.on('lx-session-control', (_e, on) => { if (sessionLink) sessionLink.setInControl(on); });

// ---- QLab Connect link (see desk-link.js) ----
// QLab Connect fires lighting cues by sending a desk OSC commands; this makes
// Light Spark answer them like a Zero 88 ZerOS desk would.
let deskLink = null;
function getDeskLink() {
  if (!deskLink) {
    const { createDeskLink } = require('./desk-link.js');
    deskLink = createDeskLink({
      configPath: path.join(app.getPath('userData'), 'desk-link.json'),
      onCommand: msg => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-desk-command', msg); },
      onInfo: info => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-desk-info', info); }
    });
  }
  return deskLink;
}
ipcMain.handle('lx-desk-info', () => getDeskLink().info());
ipcMain.handle('lx-desk-configure', (_e, next) => getDeskLink().configure(next));

function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  step('./relay.js'); try { relayService = require('./relay.js'); console.log('✅ ART-NET relay service started'); } catch (err) { console.error('❌ ART-NET relay failed:', err); }
  // QLab is deliberately NOT started here. It is a Pro-only service and is
  // started below only after the renderer confirms the active licence tier.
  step('./multi-output.js'); try { multiOutputService = require('./multi-output.js'); console.log('✅ Multi-universe output service started'); } catch (err) { console.error('❌ Multi-universe output failed:', err); }
  step('./citp.js'); try { citpService = require('./citp.js'); console.log('✅ CITP service started'); } catch (err) { console.error('❌ CITP service failed:', err); }
  step('./usb-dmx.js'); try { usbDmxService = require('./usb-dmx.js'); console.log('✅ USB-DMX service started'); } catch (err) { console.error('❌ USB-DMX service failed:', err); }
  step('desk link'); try { getDeskLink(); } catch (err) { console.error('❌ QLab Connect link failed:', err); }
}

function startQLabBridgeIfPro() {
  if (!mainWindow || mainWindow.isDestroyed() || qlabBridgeService) return;
  mainWindow.webContents.executeJavaScript(
    'window.License && typeof window.License.getTier === "function" ? window.License.getTier() : "free"',
    true
  ).then(tier => {
    if (String(tier).toLowerCase() !== 'pro') {
      console.log(`🔒 QLab bridge waiting for PRO licence (current: ${String(tier || 'free').toUpperCase()})`);
      if (!qlabLicenseTimer) qlabLicenseTimer = setTimeout(() => { qlabLicenseTimer = null; startQLabBridgeIfPro(); }, 1000);
      return;
    }
    try {
      qlabBridgeService = require('./js/qlab-bridge.js');
      console.log('🎵 QLab bridge service started for PRO licence');
    } catch (err) {
      console.error('❌ QLab bridge failed:', err);
      if (!qlabLicenseTimer) qlabLicenseTimer = setTimeout(() => { qlabLicenseTimer = null; startQLabBridgeIfPro(); }, 1000);
    }
  }).catch(err => {
    console.error('❌ Unable to determine licence for QLab bridge:', err);
    if (!qlabLicenseTimer) qlabLicenseTimer = setTimeout(() => { qlabLicenseTimer = null; startQLabBridgeIfPro(); }, 1000);
  });
}

function stopServices() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (qlabLicenseTimer) { clearTimeout(qlabLicenseTimer); qlabLicenseTimer = null; }
  for (const [name, service] of [['Art-Net relay', relayService], ['QLab bridge', qlabBridgeService], ['Multi-universe output', multiOutputService], ['CITP', citpService], ['USB-DMX', usbDmxService]]) {
    try { if (service && typeof service.shutdown === 'function') service.shutdown(); } catch (err) { console.error(`❌ ${name} shutdown failed:`, err); }
  }
}

// The menu bar (on a Mac, the menus at the top of the screen; on Windows,
// press Alt). Items that belong to the console run in the page, as a user
// gesture so things like the Open Show file picker are allowed.
const APP_NAME = 'Light Spark';
let confirmQuit = false, quitConfirmed = false;

function runInPage(action) {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.webContents.executeJavaScript(`window.LXAppMenu && window.LXAppMenu.run(${JSON.stringify(action)})`, true).catch(() => {});
}

function buildApplicationMenu() {
  const mac = process.platform === 'darwin';
  const page = (label, action, accelerator) => ({ label, accelerator, click: () => runInPage(action) });
  const template = [
    ...(mac ? [{
      label: APP_NAME,
      submenu: [
        page(`About ${APP_NAME}`, 'about'),
        page('Check for Updates…', 'updates'),
        { label: 'Show Log Folder', click: () => require('electron').shell.openPath(path.join(app.getPath('userData'), 'logs')) },
        { type: 'separator' },
        page('Preferences…', 'prefs', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { label: `Hide ${APP_NAME}`, role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: `Quit ${APP_NAME}`, accelerator: 'Cmd+Q', click: () => app.quit() }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        page('New Page…', 'new-page'),
        { type: 'separator' },
        page('Save Show', 'save', 'CmdOrCtrl+S'),
        page('Save Show As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        page('Open Show…', 'open', 'CmdOrCtrl+O'),
        page('Autosave Now', 'autosave'),
        { type: 'separator' },
        page('Clear Programmer', 'clear'),
        ...(mac ? [] : [{ type: 'separator' }, page('Preferences…', 'prefs', 'CmdOrCtrl+,'), page('Check for Updates…', 'updates'), { label: 'Show Log Folder', click: () => require('electron').shell.openPath(path.join(app.getPath('userData'), 'logs')) }, { type: 'separator' }, { label: `Quit ${APP_NAME}`, accelerator: 'Ctrl+Q', click: () => app.quit() }])
      ]
    },
    { role: 'editMenu' }, // copy and paste in text boxes need this on a Mac
    {
      label: 'View',
      submenu: [
        page('Live Control', 'page:live'), page('Patch', 'page:patch'), page('Cue Inspector', 'page:inspector'),
        page('Chases', 'page:chases'), page('Effects', 'page:effects'), page('QLab', 'page:qlab'), page('Magic Sheet', 'page:magic'),
        { type: 'separator' },
        page('3D Visualiser', 'viz'),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        page('Cue List', 'win:cuelist'), page('Cue Stack', 'win:cues'), page('Console Log', 'win:log'), page('Groups', 'win:groups'), page('Fixtures', 'win:fixtures'),
        page('Control Deck', 'win:control'), page('Palettes', 'win:palettes'), page('Magic Sheet', 'win:magic'), page('Effects', 'win:effects'),
        page('Chases', 'win:chases'), page('Cue Inspector', 'win:inspector'), page('Patched Fixtures', 'win:patch'), page('Command Reference', 'win:commands'), page('Fixture Info', 'win:fixtureinfo'), page('Focus (Point & Shoot)', 'win:focus'), page('Timecode', 'win:timecode'),
        { type: 'separator' },
        page('Put Every Window Back', 'dock'),
        { type: 'separator' },
        { role: 'minimize' },
        ...(mac ? [{ role: 'zoom' }, { role: 'front' }] : [])
      ]
    }
  ];
  template.push({ role: 'help', submenu: [page('Command Reference', 'win:commands')] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Preferences → Show → "Ask before quitting".
ipcMain.on('lx-quit-confirm', (_event, on) => { confirmQuit = Boolean(on); });
ipcMain.on('lx-quit', () => app.quit());

// Software updates (updater.js). The page asks to check; the result and the
// download progress come back as 'lx-update' messages.
let updater = null;
function getUpdater() {
  if (updater) return updater;
  const { shell } = require('electron');
  const { createUpdater } = require('./updater.js');
  let feedUrl = '';
  try { feedUrl = require('./package.json').build?.publish?.[0]?.url || ''; } catch (_) {}
  updater = createUpdater({ app, shell, feedUrl, send: state => { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('lx-update', state); } });
  return updater;
}
ipcMain.handle('lx-update-check', () => getUpdater().check());
ipcMain.handle('lx-update-status', () => getUpdater().status());
ipcMain.handle('lx-update-install', () => { const u = getUpdater(); if (u.status().status === 'ready') quitConfirmed = true; return u.install(); });
function guardClose(win) {
  win.on('close', event => {
    if (!confirmQuit || quitConfirmed) return;
    const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: [`Quit ${APP_NAME}`, 'Cancel'], defaultId: 1, cancelId: 1, message: `Quit ${APP_NAME}?`, detail: 'Lighting output stops when Light Spark quits. Save your show first if you need to.' });
    if (choice === 0) quitConfirmed = true;
    else event.preventDefault();
  });
}

function createWindow() {
  // Keep context isolation enabled for security, but disable Electron's
  // sandbox so the preload can reliably expose the file IPC bridge used by
  // SAVE / LOAD in the desktop app.
  //
  // backgroundThrottling:false matters here specifically: Chromium's
  // default is to throttle a window's timers (setTimeout/rAF) once it
  // loses focus/visibility to another window — which is exactly what
  // happens the moment the visualizer popup opens and takes focus. The
  // QLab bridge client's reconnect loop and the license-tier bootstrap
  // poll both run on setTimeout in THIS window, so throttling them made
  // QLab connections stall or drop for as long as the visualizer stayed
  // open, recovering only once it closed and this window got focus back.
  mainWindow = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Lighting Console', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  guardClose(mainWindow);
  mainWindow.on('unresponsive', () => step('PAGE NOT RESPONDING'));
  mainWindow.on('responsive', () => step('page responding again'));
  mainWindow.webContents.on('render-process-gone', (_e, d) => step(`page crashed: ${d.reason}`));
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    step('page loaded');
    startQLabBridgeIfPro();

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__electronQLabBootstrap) return;
        window.__electronQLabBootstrap = true;
        let attempts = 0;
        const bootstrap = () => {
          attempts++;
          try {
            const tier = window.License && typeof window.License.getTier === 'function'
              ? String(window.License.getTier()).toLowerCase()
              : 'free';
            if (tier !== 'pro') {
              if (attempts < 150) return setTimeout(bootstrap, 100);
              console.log('🔒 QLab UI/connection waiting for Pro license activation');
              attempts = 0;
              return setTimeout(bootstrap, 1000);
            }
            if (!window.QLab) {
              return setTimeout(bootstrap, 100);
            }
            if (typeof window.QLab.loadSettings === 'function') window.QLab.loadSettings();
            if (typeof window.QLab.renderSettings === 'function') window.QLab.renderSettings();
            if (typeof window.QLab.connect === 'function') { console.log('🎵 Electron: starting QLab bridge connection'); window.QLab.connect(); }
            setTimeout(() => { try { if (window.QLab && typeof window.QLab.syncCues === 'function') { console.log('🎵 Electron: forcing QLab cue sync'); window.QLab.syncCues(); } } catch (err) { console.error('❌ Electron QLab sync failed:', err); } }, 750);
          } catch (err) { setTimeout(bootstrap, 1000); }
        };
        bootstrap();
      })();
    `).catch(err => console.error('❌ Electron QLab bootstrap script failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__multiOutputLoader) return;
        window.__multiOutputLoader = true;
        const script = document.createElement('script'); script.src = 'js/multi-output.js';
        script.onload = () => console.log('✅ Multi-universe output UI loaded');
        script.onerror = err => console.error('❌ Multi-universe output UI failed to load:', err);
        document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ Multi-output UI loader failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__qlabStableCueRendererLoader) return;
        window.__qlabStableCueRendererLoader = true;
        let attempts = 0;
        const install = () => {
          attempts++; if (!window.QLab || typeof window.QLab.renderCueSync !== 'function') { if (attempts < 150) return setTimeout(install, 100); return; }
          if (window.__qlabStableCueRenderer) return; const qlab = window.QLab; const originalRenderCueSync = qlab.renderCueSync.bind(qlab); let lastStructureSignature = null; let hasRendered = false;
          const getCueNumber = cue => String(cue?.number ?? '').trim();
          const getStructureSignature = () => JSON.stringify((Array.isArray(qlab.cues) ? qlab.cues : []).map(cue => { const q = getCueNumber(cue); const triggers = qlab.timeTriggers?.[q] || []; return { q, name: cue?.name ?? cue?.displayName ?? cue?.type ?? cue?.cueType ?? 'Unnamed', triggers: triggers.map(t => ({ time: Number(t?.time) || 0, lights: Array.isArray(t?.lights) ? t.lights : [] })) }; }));
          const annotateRows = () => { const box = document.getElementById('qlabSyncList'); const cues = Array.isArray(qlab.cues) ? qlab.cues : []; if (!box) return; let rowIndex = 0; cues.forEach(cue => { const q = getCueNumber(cue); if (!q) return; const row = box.children[rowIndex++]; if (row) row.dataset.qlabCueNumber = q; }); };
          const updatePlaybackOnly = () => { const box = document.getElementById('qlabSyncList'); const cues = Array.isArray(qlab.cues) ? qlab.cues : []; if (!box || !cues.length || box.children.length !== cues.filter(c => getCueNumber(c)).length) return false; let rowIndex = 0; for (const cue of cues) { const q = getCueNumber(cue); if (!q) continue; const row = box.children[rowIndex++]; if (!row || row.dataset.qlabCueNumber !== q) return false; const active = q === String(qlab.activeCue ?? ''); row.style.background = active ? '#1a3a2a' : '#2a2a3a'; row.style.borderLeft = '3px solid ' + (active ? '#0f6' : '#444'); let elapsed = row.querySelector('.qlab-active-time'); if (active) { if (!elapsed) { elapsed = document.createElement('span'); elapsed.className = 'qlab-active-time'; elapsed.style.cssText = 'font-size:11px;color:#0f6;'; const goButton = row.querySelector('button'); row.insertBefore(elapsed, goButton || null); } elapsed.textContent = '▶ ' + Number(qlab.activeElapsed || 0).toFixed(2) + 's'; } else if (elapsed) elapsed.remove(); } return true; };
          qlab.renderCueSync = function stableRenderCueSync() { const signature = getStructureSignature(); if (!hasRendered || signature !== lastStructureSignature) { originalRenderCueSync(); lastStructureSignature = signature; hasRendered = true; annotateRows(); return; } if (!updatePlaybackOnly()) { originalRenderCueSync(); lastStructureSignature = signature; annotateRows(); } };
          window.__qlabStableCueRenderer = true;
        };
        install();
      })();
    `).catch(err => console.error('❌ QLab stable cue renderer failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__rdmScriptLoader) return;
        window.__rdmScriptLoader = true;
        const script = document.createElement('script'); script.src = 'js/rdm.js';
        script.onload = () => console.log('✅ RDM patching UI loaded'); script.onerror = err => console.error('❌ RDM patching UI failed to load:', err); document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ RDM UI loader failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__effectChaseCommandLoader) return;
        window.__effectChaseCommandLoader = true;
        const script = document.createElement('script'); script.src = 'js/effect-chase-commands.js';
        script.onload = () => console.log('✅ Effect/chase command layer loaded'); script.onerror = err => console.error('❌ Effect/chase command layer failed to load:', err); document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ Effect/chase command loader failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__showFileCommandLoader) return;
        window.__showFileCommandLoader = true;
        const script = document.createElement('script'); script.src = 'js/showfile.js';
        script.onload = () => console.log('💾 Show file commands loaded');
        script.onerror = err => console.error('❌ Show file command layer failed to load:', err);
        document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ Show file loader failed:', err));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('before-quit', () => step('quitting'));
app.on('child-process-gone', (_e, d) => mark(`${d.type} process gone: ${d.reason}${d.name ? ` (${d.name})` : ''}`));
app.whenReady().then(() => {
  // A lighting console must keep full speed when it isn't the front app
  // (the operator is in QLab): macOS "App Nap" would otherwise slow its
  // timers to a crawl — late fades, late GOs, a backup that seems frozen.
  try { require('electron').powerSaveBlocker.start('prevent-app-suspension'); } catch (_) {}
  step('ready'); buildApplicationMenu(); step('services'); startServices(); step('window'); createWindow(); step('window created');
  step('remote'); try { getRemoteServer()?.autostart(); } catch (err) { console.error('❌ Remote server failed:', err); }
  step('session link'); try { getSessionLink(); } catch (err) { console.error('❌ Multi-console link failed:', err); } // listens for primaries on the LAN
  step('started');
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(err => { console.error('❌ Electron startup failed:', err); stopServices(); app.quit(); });
app.on('before-quit', () => { try { remoteServer?.stop(); } catch (_) {} try { deskLink?.close(); } catch (_) {} try { sessionLink?.stop(); } catch (_) {} stopServices(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
