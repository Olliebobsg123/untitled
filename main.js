const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;
let servicesStarted = false;

// ==========================================================
// START SERVICES
// ==========================================================

function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;

  try {
    require('./relay.js');
  } catch (err) {
    console.error('❌ ART-NET relay failed:', err);
  }

  try {
    require('./js/qlab-bridge.js');
  } catch (err) {
    console.error('❌ QLab bridge failed:', err);
  }
}

// ==========================================================
// CREATE WINDOW
// ==========================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Lighting Console',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', startServices);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==========================================================
// ELECTRON READY
// ==========================================================

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(err => {
  console.error('❌ Electron startup failed:', err);
  app.quit();
});

// ==========================================================
// CLOSE APP
// ==========================================================

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
