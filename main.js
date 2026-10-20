const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

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
let usbDmxService = null;
let shuttingDown = false;
let qlabLicenseTimer = null;

function getShowDirectory() {
  const directory = path.join(app.getPath('documents'), 'LX Console Shows');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

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
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (err) { return []; }
  return entries
    .filter(entry => entry.isFile() && /\.json$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(directory, entry.name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch (_) {}
      return { name: entry.name.replace(/\.json$/i, ''), path: filePath, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 8);
});
ipcMain.handle('lx-show-save', (_event, payload) => {
  const filePath = resolveShowPath(payload?.filePath);
  const show = payload?.show;
  if (!show || typeof show !== 'object') throw new Error('No show data supplied');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(show, null, 2), 'utf8');
  return { path: filePath };
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
ipcMain.handle('lx-show-load', (_event, payload) => {
  const filePath = resolveShowPath(payload?.filePath);
  if (!fs.existsSync(filePath)) throw new Error(`Show file not found: ${filePath}`);
  let show;
  try { show = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { throw new Error(`Could not read show file: ${err.message}`); }
  return { path: filePath, show };
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
  try { relayService = require('./relay.js'); console.log('✅ ART-NET relay service started'); } catch (err) { console.error('❌ ART-NET relay failed:', err); }
  // QLab is deliberately NOT started here. It is a Pro-only service and is
  // started below only after the renderer confirms the active licence tier.
  try { multiOutputService = require('./multi-output.js'); console.log('✅ Multi-universe output service started'); } catch (err) { console.error('❌ Multi-universe output failed:', err); }
  try { usbDmxService = require('./usb-dmx.js'); console.log('✅ USB-DMX service started'); } catch (err) { console.error('❌ USB-DMX service failed:', err); }
  try { getDeskLink(); } catch (err) { console.error('❌ QLab Connect link failed:', err); }
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
  for (const [name, service] of [['Art-Net relay', relayService], ['QLab bridge', qlabBridgeService], ['Multi-universe output', multiOutputService], ['USB-DMX', usbDmxService]]) {
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
        ...(mac ? [] : [{ type: 'separator' }, page('Preferences…', 'prefs', 'CmdOrCtrl+,'), { type: 'separator' }, { label: `Quit ${APP_NAME}`, accelerator: 'Ctrl+Q', click: () => app.quit() }])
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
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
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

app.whenReady().then(() => {
  buildApplicationMenu(); startServices(); createWindow();
  try { getRemoteServer()?.autostart(); } catch (err) { console.error('❌ Remote server failed:', err); }
  try { getSessionLink(); } catch (err) { console.error('❌ Multi-console link failed:', err); } // listens for primaries on the LAN
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(err => { console.error('❌ Electron startup failed:', err); stopServices(); app.quit(); });
app.on('before-quit', () => { try { remoteServer?.stop(); } catch (_) {} try { deskLink?.close(); } catch (_) {} try { sessionLink?.stop(); } catch (_) {} stopServices(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
