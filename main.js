const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let servicesStarted = false;
let relayService = null;
let qlabBridgeService = null;
let shuttingDown = false;

function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;

  try {
    relayService = require('./relay.js');
    console.log('✅ ART-NET relay service started');
  } catch (err) {
    console.error('❌ ART-NET relay failed:', err);
  }

  try {
    qlabBridgeService = require('./js/qlab-bridge.js');
    console.log('✅ QLab bridge service started');
  } catch (err) {
    console.error('❌ QLab bridge failed:', err);
  }
}

function stopServices() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const [name, service] of [
    ['Art-Net relay', relayService],
    ['QLab bridge', qlabBridgeService]
  ]) {
    try {
      if (service && typeof service.shutdown === 'function') {
        service.shutdown();
      }
    } catch (err) {
      console.error(`❌ ${name} shutdown failed:`, err);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Lighting Console',
    webPreferences: {
      // Renderer code does not require Node.js APIs. Keep Node out of the
      // renderer so a compromised UI/third-party page cannot access fs,
      // child_process, or other privileged Electron APIs.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
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

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__qlabStableCueRenderer) return;
        if (!window.QLab || typeof window.QLab.renderCueSync !== 'function') {
          console.warn('⚠️ QLab stable cue renderer could not initialise');
          return;
        }

        const qlab = window.QLab;
        const originalRenderCueSync = qlab.renderCueSync.bind(qlab);
        let lastStructureSignature = null;
        let hasRendered = false;

        const getCueNumber = cue => String(cue?.number ?? '').trim();

        const getStructureSignature = () => JSON.stringify(
          (Array.isArray(qlab.cues) ? qlab.cues : []).map(cue => {
            const q = getCueNumber(cue);
            const triggers = qlab.timeTriggers?.[q] || [];
            return {
              q,
              name: cue?.name ?? cue?.displayName ?? cue?.type ?? cue?.cueType ?? 'Unnamed',
              triggers: triggers.map(t => ({
                time: Number(t?.time) || 0,
                lights: Array.isArray(t?.lights) ? t.lights : []
              }))
            };
          })
        );

        const annotateRows = () => {
          const box = document.getElementById('qlabSyncList');
          const cues = Array.isArray(qlab.cues) ? qlab.cues : [];
          if (!box) return;

          let rowIndex = 0;
          cues.forEach(cue => {
            const q = getCueNumber(cue);
            if (!q) return;
            const row = box.children[rowIndex++];
            if (row) row.dataset.qlabCueNumber = q;
          });
        };

        const updatePlaybackOnly = () => {
          const box = document.getElementById('qlabSyncList');
          const cues = Array.isArray(qlab.cues) ? qlab.cues : [];
          if (!box || !cues.length || box.children.length !== cues.filter(c => getCueNumber(c)).length) {
            return false;
          }

          let rowIndex = 0;
          for (const cue of cues) {
            const q = getCueNumber(cue);
            if (!q) continue;

            const row = box.children[rowIndex++];
            if (!row || row.dataset.qlabCueNumber !== q) return false;

            const active = q === String(qlab.activeCue ?? '');
            row.style.background = active ? '#1a3a2a' : '#2a2a3a';
            row.style.borderLeft = `3px solid ${active ? '#0f6' : '#444'}`;

            let elapsed = row.querySelector('.qlab-active-time');
            if (active) {
              if (!elapsed) {
                elapsed = document.createElement('span');
                elapsed.className = 'qlab-active-time';
                elapsed.style.cssText = 'font-size:11px;color:#0f6;';
                const goButton = row.querySelector('button');
                row.insertBefore(elapsed, goButton || null);
              }
              elapsed.textContent = `▶ ${Number(qlab.activeElapsed || 0).toFixed(2)}s`;
            } else if (elapsed) {
              elapsed.remove();
            }
          }

          return true;
        };

        qlab.renderCueSync = function stableRenderCueSync() {
          const signature = getStructureSignature();

          if (!hasRendered || signature !== lastStructureSignature) {
            originalRenderCueSync();
            lastStructureSignature = signature;
            hasRendered = true;
            annotateRows();
            return;
          }

          if (!updatePlaybackOnly()) {
            originalRenderCueSync();
            lastStructureSignature = signature;
            annotateRows();
          }
        };

        window.__qlabStableCueRenderer = true;
      })();
    `).catch(err => {
      console.error('❌ QLab stable cue renderer failed:', err);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(err => {
  console.error('❌ Electron startup failed:', err);
  stopServices();
  app.quit();
});

app.on('before-quit', () => {
  stopServices();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});