const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

// ==========================================================
// START SERVICES
// ==========================================================

function startServices() {

  // --------------------------------------------------------
  // ART-NET RELAY
  // --------------------------------------------------------

  try {

    require('./relay.js');

  } catch (err) {

    console.error(
      '❌ ART-NET relay failed:',
      err
    );

  }

  // --------------------------------------------------------
  // QLAB BRIDGE
  // --------------------------------------------------------

  try {

    require('./js/qlab-bridge.js');

  } catch (err) {

    console.error(
      '❌ QLab bridge failed:',
      err
    );

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

  // --------------------------------------------------------
  // LOAD HTML
  // --------------------------------------------------------

  mainWindow.loadFile(
    path.join(__dirname, 'index.html')
  );

  // --------------------------------------------------------
  // START SERVICES AFTER HTML HAS LOADED
  // --------------------------------------------------------

  mainWindow.webContents.once('did-finish-load', () => {

    startServices();

  });

  // --------------------------------------------------------
  // WINDOW CLOSED
  // --------------------------------------------------------

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

});

// ==========================================================
// CLOSE APP
// ==========================================================

app.on('window-all-closed', () => {

  if (process.platform !== 'darwin') {
    app.quit();
  }

});