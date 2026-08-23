const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let servicesStarted = false;
let relayService = null;
let qlabBridgeService = null;
let multiOutputService = null;
let shuttingDown = false;

function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  try { relayService = require('./relay.js'); console.log('✅ ART-NET relay service started'); } catch (err) { console.error('❌ ART-NET relay failed:', err); }
  try { qlabBridgeService = require('./js/qlab-bridge.js'); console.log('✅ QLab bridge service started'); } catch (err) { console.error('❌ QLab bridge failed:', err); }
  try { multiOutputService = require('./multi-output.js'); console.log('✅ Multi-universe output service started'); } catch (err) { console.error('❌ Multi-universe output service failed:', err); }
}

function stopServices() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, service] of [['Art-Net relay', relayService], ['QLab bridge', qlabBridgeService], ['Multi-universe output', multiOutputService]]) {
    try { if (service && typeof service.shutdown === 'function') service.shutdown(); } catch (err) { console.error(`❌ ${name} shutdown failed:`, err); }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Lighting Console', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__centralOutputLoader) return;
        window.__centralOutputLoader = true;
        const script = document.createElement('script');
        script.src = 'js/central-output.js';
        script.onload = () => {
          console.log('✅ Central Art-Net/sACN output policy loaded');
          const multi = document.createElement('script');
          multi.src = 'js/multi-output.js';
          multi.onload = () => console.log('✅ Multi-universe output UI loaded');
          multi.onerror = err => console.error('❌ Multi-universe output UI failed to load:', err);
          document.head.appendChild(multi);
        };
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
              const script = child.document.createElement('script'); script.id = '__photometricBeamPatch';
              script.textContent = \`(() => {
                if (window.__photometricBeamPatch) return;
                window.__photometricBeamPatch = true;
                const syncBeams = () => {
                  const state = window.S; if (!state || !Array.isArray(state.objects)) return;
                  for (const fixture of state.objects) {
                    if (!fixture || !fixture.haze || !fixture.spot) continue;
                    const active = fixture.spot.visible && fixture.spot.intensity > 0.001; fixture.haze.visible = active;
                    if (!fixture.haze.material?.uniforms) continue;
                    const uniforms = fixture.haze.material.uniforms;
                    if (uniforms.opacity) uniforms.opacity.value = active ? Math.min(0.2, Math.max(0, fixture.spot.intensity / 180) * 0.13) : 0;
                    if (uniforms.color) uniforms.color.value.copy(fixture.spot.color);
                  }
                };
                const originalRAF = window.requestAnimationFrame;
                window.requestAnimationFrame = function(callback) { return originalRAF.call(this, time => { syncBeams(); callback(time); }); };
                syncBeams(); console.log('🟣 Photometric beam patch enabled');
              })();\`;
              child.document.documentElement.appendChild(script); return true;
            } catch (_) { return false; }
          };
          const beamTimer = setInterval(() => { if (installPhotometricBeamPatch()) clearInterval(beamTimer); }, 100); setTimeout(() => clearInterval(beamTimer), 15000);
          const originalPostMessage = child.postMessage.bind(child); let pendingDMX = null; let frameQueued = false; let lastDMX = null;
          child.postMessage = function(message, targetOrigin, transfer) {
            if (!message || message.type !== 'DMX_UPDATE') return originalPostMessage(message, targetOrigin, transfer);
            const dmx = Array.isArray(message.dmx) ? message.dmx : null; if (!dmx) return;
            let unchanged = !!lastDMX && lastDMX.length === dmx.length; if (unchanged) for (let i = 0; i < dmx.length; i++) if (dmx[i] !== lastDMX[i]) { unchanged = false; break; }
            if (unchanged) return; lastDMX = dmx.slice(); pendingDMX = message; if (frameQueued) return; frameQueued = true;
            requestAnimationFrame(() => { frameQueued = false; if (!pendingDMX) return; const next = pendingDMX; pendingDMX = null; try { originalPostMessage(next, targetOrigin, transfer); } catch (err) { console.warn('⚠️ Visualiser DMX update failed:', err.message); } });
          };
          const installVisualiserModePatch = () => {
            try {
              if (!child.document || !child.document.documentElement) return false;
              if (child.document.getElementById('__consoleModePatch')) return true;
              const script = child.document.createElement('script'); script.id = '__consoleModePatch';
              script.textContent = \`(() => {
                if (window.__consoleModePatch) return; window.__consoleModePatch = true;
                const style = document.createElement('style'); style.textContent = '#consoleModeBanner{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100;background:#10351d;color:#8cffaa;border:1px solid #55d879;border-radius:7px;padding:8px 18px;font:700 12px monospace;letter-spacing:1px;box-shadow:0 0 18px #0008}#consoleModeBanner.blind{background:#102d55;color:#8fc4ff;border-color:#4b9cff;box-shadow:0 0 18px #1d73c755}'; document.head.appendChild(style);
                const banner = document.createElement('div'); banner.id = 'consoleModeBanner'; document.body.appendChild(banner);
                const setMode = mode => { const blind = String(mode).toUpperCase() === 'BLIND'; banner.classList.toggle('blind', blind); banner.textContent = blind ? '● BLIND — VISUALIZER PROGRAMMER' : '● LIVE — ART-NET OUTPUT'; };
                window.addEventListener('message', e => { if (e.data?.type === 'CONSOLE_MODE') setMode(e.data.mode); }); setMode('LIVE');
              })();\`;
              child.document.documentElement.appendChild(script); return true;
            } catch (_) { return false; }
          };
          const modeTimer = setInterval(() => { if (installVisualiserModePatch()) clearInterval(modeTimer); }, 100); setTimeout(() => clearInterval(modeTimer), 15000);
          console.log('🖥️ Visualiser performance patch enabled'); return child;
        };
      })();
    `).catch(err => console.error('❌ Visualiser performance patch failed:', err));

    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__rdmScriptLoader) return;
        window.__rdmScriptLoader = true;
        const script = document.createElement('script'); script.src = 'js/rdm.js';
        script.onload = () => console.log('✅ RDM patching UI loaded');
        script.onerror = err => console.error('❌ RDM patching UI failed to load:', err);
        document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ RDM UI loader failed:', err));
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); startServices(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(err => { console.error('❌ Electron startup failed:', err); stopServices(); app.quit(); });
app.on('before-quit', () => stopServices());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
