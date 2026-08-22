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
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__centralOutputLoader) return;
        window.__centralOutputLoader = true;
        const script = document.createElement('script');
        script.src = 'js/central-output.js';
        script.onload = () => console.log('✅ Central Art-Net/sACN output policy loaded');
        script.onerror = err => console.error('❌ Central output policy failed to load:', err);
        document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ Central output policy loader failed:', err));

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

          const installPhotometricBeamPatch = () => {
            try {
              if (!child.document || !child.document.documentElement) return false;
              if (child.document.getElementById('__photometricBeamPatch')) return true;

              const script = child.document.createElement('script');
              script.id = '__photometricBeamPatch';
              script.textContent = \`(() => {
                if (window.__photometricBeamPatch) return;
                window.__photometricBeamPatch = true;

                const syncBeams = () => {
                  const state = window.S;
                  if (!state || !Array.isArray(state.objects)) return;

                  for (const fixture of state.objects) {
                    if (!fixture || !fixture.haze || !fixture.spot) continue;

                    const active = fixture.spot.visible && fixture.spot.intensity > 0.001;
                    fixture.haze.visible = active;

                    if (!fixture.haze.material?.uniforms) continue;

                    const uniforms = fixture.haze.material.uniforms;
                    if (uniforms.opacity) {
                      uniforms.opacity.value = active
                        ? Math.min(0.2, Math.max(0, fixture.spot.intensity / 180) * 0.13)
                        : 0;
                    }
                    if (uniforms.color) {
                      uniforms.color.value.copy(fixture.spot.color);
                    }
                  }
                };

                const originalRAF = window.requestAnimationFrame;
                window.requestAnimationFrame = function(callback) {
                  return originalRAF.call(this, (time) => {
                    syncBeams();
                    callback(time);
                  });
                };

                syncBeams();
                console.log('🟣 Photometric beam patch enabled');
              })();\`;

              child.document.documentElement.appendChild(script);
              return true;
            } catch (err) {
              return false;
            }
          };

          const beamTimer = setInterval(() => {
            if (installPhotometricBeamPatch()) clearInterval(beamTimer);
          }, 100);
          setTimeout(() => clearInterval(beamTimer), 15000);

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

          const installVisualiserModePatch = () => {
            try {
              if (!child.document || !child.document.documentElement) return false;
              if (child.document.getElementById('__consoleModePatch')) return true;

              const script = child.document.createElement('script');
              script.id = '__consoleModePatch';
              script.textContent = \`(() => {
                if (window.__consoleModePatch) return;
                window.__consoleModePatch = true;

                const style = document.createElement('style');
                style.textContent = '\n                  #consoleModeBanner{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100;background:#10351d;color:#8cffaa;border:1px solid #55d879;border-radius:7px;padding:8px 18px;font:700 12px monospace;letter-spacing:1px;box-shadow:0 0 18px #0008}\n                  #consoleModeBanner.blind{background:#102d55;color:#8fc4ff;border-color:#4b9cff;box-shadow:0 0 18px #1d73c755}\n                ';
                document.head.appendChild(style);

                const banner = document.createElement('div');
                banner.id = 'consoleModeBanner';
                document.body.appendChild(banner);

                const setMode = mode => {
                  const blind = String(mode).toUpperCase() === 'BLIND';
                  banner.classList.toggle('blind', blind);
                  banner.textContent = blind ? '● BLIND — VISUALIZER PROGRAMMER' : '● LIVE — ART-NET OUTPUT';
                };

                window.addEventListener('message', e => {
                  if (e.data?.type === 'CONSOLE_MODE') setMode(e.data.mode);
                });

                setMode('LIVE');
              })();\`;

              child.document.documentElement.appendChild(script);
              return true;
            } catch (err) {
              return false;
            }
          };

          const modeTimer = setInterval(() => {
            if (installVisualiserModePatch()) clearInterval(modeTimer);
          }, 100);
          setTimeout(() => clearInterval(modeTimer), 15000);

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
          if (!box || !cues.length || box.children.length !== cues.filter(c => getCueNumber(c)).length) return false;
          let rowIndex = 0;
          for (const cue of cues) {
            const q = getCueNumber(cue);
            if (!q) continue;
            const row = box.children[rowIndex++];
            if (!row || row.dataset.qlabCueNumber !== q) return false;
            const active = q === String(qlab.activeCue ?? '');
            row.style.background = active ? '#1a3a2a' : '#2a2a3a';
            row.style.borderLeft = '3px solid ' + (active ? '#0f6' : '#444');
            let elapsed = row.querySelector('.qlab-active-time');
            if (active) {
              if (!elapsed) {
                elapsed = document.createElement('span');
                elapsed.className = 'qlab-active-time';
                elapsed.style.cssText = 'font-size:11px;color:#0f6;';
                const goButton = row.querySelector('button');
                row.insertBefore(elapsed, goButton || null);
              }
              elapsed.textContent = '▶ ' + Number(qlab.activeElapsed || 0).toFixed(2) + 's';
            } else if (elapsed) elapsed.remove();
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
    `).catch(err => console.error('❌ QLab stable cue renderer failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__blindLiveMode) return;
        window.__blindLiveMode = true;
        const installStyles = () => {
          if (document.getElementById('__blindLiveStyles')) return;
          const style = document.createElement('style');
          style.id = '__blindLiveStyles';
          style.textContent = '\n            .console-mode-switch{display:flex;align-items:center;gap:4px;margin-right:10px;padding:3px;background:#0b0b0b;border:1px solid #3b3b3b;border-radius:8px}\n            .console-mode-switch button{border:1px solid transparent;background:#151515;color:#999;border-radius:5px;padding:7px 13px;font:700 11px monospace;letter-spacing:.6px;cursor:pointer}\n            .console-mode-switch button.live.active{background:#315c35;color:#9dffad;border-color:#6fbd76;box-shadow:0 0 10px #315c3544}\n            .console-mode-switch button.blind.active{background:#173d70;color:#9ac9ff;border-color:#4b9cff;box-shadow:0 0 10px #2468b844}\n            body.console-blind .page-title strong{color:#75b8ff}\n            body.console-blind .control-deck-header strong{color:#75b8ff}\n          ';
          document.head.appendChild(style);
        };
        installStyles();
        const statusBar = document.querySelector('.topbar-status');
        if (!statusBar) return;
        const switcher = document.createElement('div');
        switcher.className = 'console-mode-switch';
        switcher.innerHTML = '<button class="live active" type="button">LIVE</button><button class="blind" type="button">BLIND</button>';
        statusBar.insertBefore(switcher, statusBar.firstChild);
        const liveButton = switcher.querySelector('.live');
        const blindButton = switcher.querySelector('.blind');
        let mode = 'LIVE';
        const notifyVisualizer = () => {
          try {
            if (typeof window.sendToVisualizer === 'function') window.sendToVisualizer();
            const v = window.visualizerWindow;
            if (v && !v.closed) v.postMessage({type:'CONSOLE_MODE',mode}, '*');
          } catch (_) {}
        };
        const setMode = next => {
          mode = String(next).toUpperCase() === 'BLIND' ? 'BLIND' : 'LIVE';
          liveButton.classList.toggle('active', mode === 'LIVE');
          blindButton.classList.toggle('active', mode === 'BLIND');
          document.body.classList.toggle('console-blind', mode === 'BLIND');
          document.documentElement.dataset.consoleMode = mode.toLowerCase();
          const title = document.getElementById('topPageTitle');
          if (title && document.body.classList.contains('console-blind')) title.dataset.liveTitle = title.textContent;
          const meta = document.querySelector('#page-live .quick-panel .panel-meta');
          if (meta) meta.textContent = mode;
          if (window.ArtNet) window.ArtNet.outputMode = mode;
          notifyVisualizer();
          if (typeof window.sendToVisualizer === 'function') window.sendToVisualizer();
          console.log('🎛 Console mode:', mode);
        };
        const originalSend = window.ArtNet?.send?.bind(window.ArtNet);
        if (window.ArtNet && originalSend && !window.ArtNet.__blindPatched) {
          window.ArtNet.__blindPatched = true;
          window.ArtNet.outputMode = 'LIVE';
          window.ArtNet.send = function() {
            if (window.ArtNet.outputMode === 'BLIND') {
              if (typeof window.sendVisualizerDMX === 'function') window.sendVisualizerDMX();
              else if (typeof window.sendToVisualizer === 'function') window.sendToVisualizer();
              return;
            }
            return originalSend();
          };
        }
        liveButton.onclick = () => setMode('LIVE');
        blindButton.onclick = () => setMode('BLIND');
        window.setConsoleMode = setMode;
        window.getConsoleMode = () => mode;
        setMode('LIVE');
      })();
    `).catch(err => console.error('❌ Blind/live mode initialisation failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__rdmScriptLoader) return;
        window.__rdmScriptLoader = true;
        const script = document.createElement('script');
        script.src = 'js/rdm.js';
        script.onload = () => console.log('✅ RDM patching UI loaded');
        script.onerror = err => console.error('❌ RDM patching UI failed to load:', err);
        document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ RDM UI loader failed:', err));
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(err => {
  console.error('❌ Electron startup failed:', err);
  stopServices();
  app.quit();
});

app.on('before-quit', () => stopServices());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
