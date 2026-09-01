const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let servicesStarted = false;
let relayService = null;
let qlabBridgeService = null;
let multiOutputService = null;
let usbDmxService = null;
let shuttingDown = false;

function startQLabBridge() {
  if (qlabBridgeService || shuttingDown) return;
  try { qlabBridgeService = require('./js/qlab-bridge.js'); console.log('✅ QLab bridge service started (Pro license)'); } catch (err) { console.error('❌ QLab bridge failed:', err); }
}

function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  try { relayService = require('./relay.js'); console.log('✅ ART-NET relay service started'); } catch (err) { console.error('❌ ART-NET relay failed:', err); }
  // QLab is deliberately NOT started here. It is a Pro-only service and is
  // started only after the renderer confirms that the active license is Pro.
  try { multiOutputService = require('./multi-output.js'); console.log('✅ Multi-universe output service started'); } catch (err) { console.error('❌ Multi-universe output service failed:', err); }
  try { usbDmxService = require('./usb-dmx.js'); console.log('✅ USB-DMX service started'); } catch (err) { console.error('❌ USB-DMX service failed:', err); }
}

function stopServices() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, service] of [['Art-Net relay', relayService], ['QLab bridge', qlabBridgeService], ['Multi-universe output', multiOutputService], ['USB-DMX', usbDmxService]]) {
    try { if (service && typeof service.shutdown === 'function') service.shutdown(); } catch (err) { console.error(`❌ ${name} shutdown failed:`, err); }
  }
}

function buildApplicationMenu() {
  Menu.setApplicationMenu(null);
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Lighting Console', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__electronQLabBootstrap) return;
        window.__electronQLabBootstrap = true;
        let attempts = 0;
        const bootstrap = () => {
          attempts++;
          try {
            if (!window.QLab || !window.License) {
              if (attempts < 150) return setTimeout(bootstrap, 100);
              console.error('❌ Electron QLab bootstrap timed out: QLab or License missing');
              return;
            }
            if (typeof window.QLab.loadSettings === 'function') window.QLab.loadSettings();
            if (typeof window.QLab.renderSettings === 'function') window.QLab.renderSettings();
            const tier = String(window.License.getTier?.() || window.__licenseTier || 'free').toLowerCase();
            if (tier !== 'pro') {
              console.log(`🔒 Electron: QLab bridge disabled for ${tier.toUpperCase()} license`);
              return;
            }
            window.__electronStartQLabBridge = true;
            console.log('🎵 Electron: Pro license confirmed; starting QLab bridge connection');
            if (typeof window.QLab.connect === 'function') window.QLab.connect();
            setTimeout(() => { try { if (window.QLab && typeof window.QLab.syncCues === 'function') { console.log('🎵 Electron: forcing QLab cue sync'); window.QLab.syncCues(); } } catch (err) { console.error('❌ Electron QLab sync failed:', err); } }, 750);
          } catch (err) { if (attempts < 150) return setTimeout(bootstrap, 100); console.error('❌ Electron QLab bootstrap failed:', err); }
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
        if (window.__visualiserPerformancePatch) return;
        window.__visualiserPerformancePatch = true;
        const originalOpen = window.open; const wrappedWindows = new WeakSet();
        window.open = function(...args) {
          const child = originalOpen.apply(this, args); if (!child || wrappedWindows.has(child)) return child; wrappedWindows.add(child);
          const installPhotometricBeamPatch = () => { try { if (!child.document || !child.document.documentElement) return false; if (child.document.getElementById('__photometricBeamPatch')) return true; const script = child.document.createElement('script'); script.id = '__photometricBeamPatch'; script.textContent = \`(() => { if (window.__photometricBeamPatch) return; window.__photometricBeamPatch = true; const syncBeams = () => { const state = window.S; if (!state || !Array.isArray(state.objects)) return; for (const fixture of state.objects) { if (!fixture || !fixture.haze || !fixture.spot) continue; const active = fixture.spot.visible && fixture.spot.intensity > 0.001; fixture.haze.visible = active; if (!fixture.haze.material?.uniforms) continue; const uniforms = fixture.haze.material.uniforms; if (uniforms.opacity) uniforms.opacity.value = active ? Math.min(0.2, Math.max(0, fixture.spot.intensity / 180) * 0.13) : 0; if (uniforms.color) uniforms.color.value.copy(fixture.spot.color); } }; const originalRAF = window.requestAnimationFrame; window.requestAnimationFrame = function(callback) { return originalRAF.call(this, time => { syncBeams(); callback(time); }); }; syncBeams(); })();\`; child.document.documentElement.appendChild(script); return true; } catch (_) { return false; } };
          const beamTimer = setInterval(() => { if (installPhotometricBeamPatch()) clearInterval(beamTimer); }, 100); setTimeout(() => clearInterval(beamTimer), 15000);
          const originalPostMessage = child.postMessage.bind(child); let pendingDMX = null; let frameQueued = false; let lastDMX = null;
          child.postMessage = function(message, targetOrigin, transfer) { if (!message || message.type !== 'DMX_UPDATE') return originalPostMessage(message, targetOrigin, transfer); const dmx = Array.isArray(message.dmx) ? message.dmx : null; if (!dmx) return; let unchanged = !!lastDMX && lastDMX.length === dmx.length; if (unchanged) for (let i = 0; i < dmx.length; i++) if (dmx[i] !== lastDMX[i]) { unchanged = false; break; } if (unchanged) return; lastDMX = dmx.slice(); pendingDMX = message; if (frameQueued) return; frameQueued = true; requestAnimationFrame(() => { frameQueued = false; if (!pendingDMX) return; const next = pendingDMX; pendingDMX = null; try { originalPostMessage(next, targetOrigin, transfer); } catch (err) { console.warn('⚠️ Visualiser DMX update failed:', err.message); } }); };
          console.log('🖥️ Visualiser performance patch enabled'); return child;
        };
      })();
    `).catch(err => console.error('❌ Visualiser performance patch failed:', err));

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
        script.onload = () => console.log('✅ Effect/chase command layer loaded'); script.onerror = err => console.error('❌ Effect/chase command loader failed:', err); document.head.appendChild(script);
      })();
    `).catch(err => console.error('❌ Effect/chase command loader failed:', err));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  buildApplicationMenu(); startServices(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('browser-window-focus', () => buildApplicationMenu());
}).catch(err => { console.error('❌ Electron startup failed:', err); stopServices(); app.quit(); });
app.on('before-quit', () => stopServices());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });