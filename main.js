const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
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
ipcMain.handle('lx-show-save', (_event, payload) => {
  const filePath = resolveShowPath(payload?.filePath);
  const show = payload?.show;
  if (!show || typeof show !== 'object') throw new Error('No show data supplied');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(show, null, 2), 'utf8');
  return { path: filePath };
});
ipcMain.handle('lx-show-load', (_event, payload) => {
  const filePath = resolveShowPath(payload?.filePath);
  if (!fs.existsSync(filePath)) throw new Error(`Show file not found: ${filePath}`);
  let show;
  try { show = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { throw new Error(`Could not read show file: ${err.message}`); }
  return { path: filePath, show };
});

function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  try { relayService = require('./relay.js'); console.log('✅ ART-NET relay service started'); } catch (err) { console.error('❌ ART-NET relay failed:', err); }
  // QLab is deliberately NOT started here. It is a Pro-only service and is
  // started below only after the renderer confirms the active licence tier.
  try { multiOutputService = require('./multi-output.js'); console.log('✅ Multi-universe output service started'); } catch (err) { console.error('❌ Multi-universe output failed:', err); }
  try { usbDmxService = require('./usb-dmx.js'); console.log('✅ USB-DMX service started'); } catch (err) { console.error('❌ USB-DMX service failed:', err); }
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

function buildApplicationMenu() {
  Menu.setApplicationMenu(null);
}

function createWindow() {
  // Keep context isolation enabled for security, but disable Electron's
  // sandbox so the preload can reliably expose the file IPC bridge used by
  // SAVE / LOAD in the desktop app.
  mainWindow = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Lighting Console', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
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
        if (window.__visualiserShowPositionFix) return;
        window.__visualiserShowPositionFix = true;
        let pendingShowVisualizer = null;

        const apply = visualizerState => {
          if (!visualizerState || typeof visualizerState !== 'object') return false;
          const Viz = window.S || window.VizState;
          if (!Viz || !(Viz.fixturePositions instanceof Map)) {
            pendingShowVisualizer = visualizerState;
            return false;
          }

          const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
          const byId = new Map(fixtures.map((fixture, index) => [String(fixture?.id), index]));
          const positions = Array.isArray(visualizerState.fixturePositions) ? visualizerState.fixturePositions : [];
          const rotations = Array.isArray(visualizerState.fixtureManualRot) ? visualizerState.fixtureManualRot : [];

          Viz.fixturePositions.clear();
          Viz.fixtureManualRot.clear();

          positions.forEach(saved => {
            const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId))
              ? byId.get(String(saved.fixtureId))
              : Number(saved?.fixtureIndex);
            if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) return;
            const x = Number(saved.x), y = Number(saved.y), z = Number(saved.z);
            if ([x, y, z].every(Number.isFinite)) Viz.fixturePositions.set(index, { x, y, z });
          });

          rotations.forEach(saved => {
            const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId))
              ? byId.get(String(saved.fixtureId))
              : Number(saved?.fixtureIndex);
            if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) return;
            const pan = Number(saved.pan), tilt = Number(saved.tilt);
            if ([pan, tilt].every(Number.isFinite)) Viz.fixtureManualRot.set(index, { pan, tilt });
          });

          Viz.rebuildFixtures?.();
          if (Viz.grid) Viz.grid.visible = visualizerState.gridOn !== false;
          return true;
        };

        window.addEventListener('lx-show-loaded', event => {
          pendingShowVisualizer = event.detail?.visualizer || null;
          if (pendingShowVisualizer) apply(pendingShowVisualizer);
        });

        window.addEventListener('message', event => {
          if (event.data?.type !== 'VISUALIZER_READY' || !pendingShowVisualizer) return;
          if (apply(pendingShowVisualizer)) pendingShowVisualizer = null;
        });

        window.__applyShowVisualizerPositions = apply;
      })();
    `).catch(err => console.error('❌ Visualiser show-position fix failed:', err));

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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(err => { console.error('❌ Electron startup failed:', err); stopServices(); app.quit(); });
app.on('before-quit', () => stopServices());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
