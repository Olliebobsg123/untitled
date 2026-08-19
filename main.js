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

  mainWindow.webContents.once('did-finish-load', () => {
    // Coalesce high-frequency visualiser DMX messages. The console can still
    // output Art-Net at its configured rate, but the visualiser only receives
    // one DMX frame per animation frame and skips identical frames.
    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__visualiserPerformancePatch) return;
        window.__visualiserPerformancePatch = true;

        const originalOpen = window.open;
        const wrappedWindows = new WeakSet();

        window.open = function(...args) {
          const child = originalOpen.apply(this, args);
          if (!child || wrappedWindows.has(child)) return child;
          wrappedWindows.add(child);

          const originalPostMessage = child.postMessage.bind(child);
          let pendingDMX = null;
          let frameQueued = false;
          let lastDMX = null;

          child.postMessage = function(message, targetOrigin, transfer) {
            if (!message || message.type !== 'DMX_UPDATE') {
              return originalPostMessage(message, targetOrigin, transfer);
            }

            const dmx = Array.isArray(message.dmx) ? message.dmx : null;
            if (!dmx) return;

            let unchanged = !!lastDMX && lastDMX.length === dmx.length;
            if (unchanged) {
              for (let i = 0; i < dmx.length; i++) {
                if (dmx[i] !== lastDMX[i]) {
                  unchanged = false;
                  break;
                }
              }
            }

            if (unchanged) return;

            lastDMX = dmx.slice();
            pendingDMX = message;

            if (frameQueued) return;
            frameQueued = true;

            requestAnimationFrame(() => {
              frameQueued = false;
              if (!pendingDMX) return;
              const next = pendingDMX;
              pendingDMX = null;
              try {
                originalPostMessage(next, targetOrigin, transfer);
              } catch (err) {
                console.warn('⚠️ Visualiser DMX update failed:', err.message);
              }
            });
          };

          console.log('🖥️ Visualiser performance patch enabled');
          return child;
        };
      })();
    `).catch(err => {
      console.error('❌ Visualiser performance patch failed:', err);
    });

    startServices();
  });

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
