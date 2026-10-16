'use strict';

// Light Spark: the Electron main process. It owns everything that talks to the
// outside world (DMX output, Art-Net discovery, the licence, QLab, show files,
// Tapo bulbs, feedback) and hands it to the console window through preload.js.

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

const license = require('./main/license.js');
const showFiles = require('./main/show-files.js');
const feedback = require('./main/feedback.js');
const qlab = require('./main/qlab.js');

// Services that open network ports start once the app is ready.
let dmxOutput = null;
let artnet = null;
let tapo = null;
let mainWindow = null;
let shuttingDown = false;

const sendToWindow = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

// Live output and QLab follow the licence: nothing the window does can turn them on without it.
function applyLicence(state) {
  dmxOutput?.setLicensed(state.canOutput);
  if (state.canQLab) qlab.start();
  else qlab.stop();
  sendToWindow('license:changed', state);
}

function startServices() {
  dmxOutput = require('./main/dmx-output.js');
  artnet = require('./main/artnet-monitor.js');
  dmxOutput.onStatus(status => sendToWindow('dmx:status', status));
  artnet.on({ node: node => sendToWindow('artnet:node', node), tod: tod => sendToWindow('rdm:tod', tod) });
  license.onChange(applyLicence);
  license.start();
  applyLicence(license.publicState());
}

function registerIpc() {
  ipcMain.handle('show:directory', () => showFiles.showDirectory());
  ipcMain.handle('show:save', (_event, { filePath, show } = {}) => showFiles.save(filePath, show));
  ipcMain.handle('show:load', (_event, { filePath } = {}) => showFiles.load(filePath));

  ipcMain.handle('feedback:send', (_event, payload) => feedback.send(payload));

  const tapoApi = () => (tapo ||= require('./main/tapo.js'));
  ipcMain.handle('tapo:test', (_event, config) => tapoApi().test(config));
  ipcMain.handle('tapo:set-state', (_event, config, state) => tapoApi().setState(config, state));
  ipcMain.handle('tapo:clear-session', (_event, config) => tapoApi().clearSession(config));

  ipcMain.on('dmx:frames', (_event, universes) => dmxOutput?.setFrames(universes));
  ipcMain.on('dmx:blind', (_event, blind) => dmxOutput?.setBlind(blind));
  ipcMain.handle('dmx:configure', (_event, outputs) => dmxOutput.configure(outputs).then(() => dmxOutput.status()));
  ipcMain.handle('dmx:status', () => dmxOutput.status());
  ipcMain.handle('dmx:usb-ports', () => dmxOutput.listUsbPorts());

  ipcMain.handle('artnet:poll', (_event, target) => artnet.poll(target || undefined));
  ipcMain.handle('artnet:nodes', () => artnet.knownNodes());
  ipcMain.handle('rdm:request', (_event, { universe, target } = {}) => artnet.requestTod(universe, target));
  ipcMain.handle('rdm:flush', (_event, { universe, target } = {}) => artnet.flushTod(universe, target));

  ipcMain.handle('license:state', () => license.publicState());
  ipcMain.handle('license:activate', (_event, key) => license.activate(key));
  ipcMain.handle('license:validate', () => license.validate());
  ipcMain.handle('license:deactivate', () => license.deactivate());
  ipcMain.handle('license:import-legacy', (_event, legacy) => license.importLegacy(legacy));
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  // Fades, chases and output keep running when the window is minimised or covered.
  backgroundThrottling: false
};

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 900, minWidth: 1000, minHeight: 640, title: 'Light Spark', backgroundColor: '#05080a', webPreferences });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // The 3D visualiser opens as its own window; web links open in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/visualizer\.html(\?|#|$)/.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1280, height: 800, title: 'Light Spark Visualiser', backgroundColor: '#050505', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } }
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function stopServices() {
  if (shuttingDown) return;
  shuttingDown = true;
  license.stop();
  qlab.stop();
  artnet?.shutdown();
  await dmxOutput?.shutdown();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  startServices();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(err => {
  console.error('Light Spark failed to start:', err);
  app.quit();
});

app.on('before-quit', () => { void stopServices(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
