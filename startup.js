const { app, session } = require('electron');
const { spawn } = require('child_process');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let directRelayService = null;
let directUsbService = null;
let shuttingDown = false;

const serviceRoot = app.isPackaged ? path.join(process.resourcesPath, 'services') : __dirname;
const logDir = path.join(app.getPath('logs'), 'services');
fs.mkdirSync(logDir, { recursive: true });

function startNodeService(label, relativeScript) {
  const scriptPath = path.join(serviceRoot, relativeScript);
  if (!fs.existsSync(scriptPath)) { console.error(`❌ ${label} missing: ${scriptPath}`); return null; }
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const logPath = path.join(logDir, `${safeLabel}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const stamp = () => new Date().toISOString();
  const writeLog = (prefix, data) => { try { logStream.write(`[${stamp()}] ${prefix}${String(data)}`); } catch (_) {} };
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', LIGHTING_CONSOLE_SERVICE_CHILD: '1', LIGHTING_CONSOLE_LOG_DIR: logDir, NODE_PATH: [path.join(serviceRoot, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter) };
  let child;
  try { child = spawn(process.execPath, [scriptPath], { cwd: serviceRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
  catch (err) { console.error(`❌ Failed to start ${label}:`, err); try { logStream.end(); } catch (_) {} return null; }
  children.push({ label, child, logStream });
  child.stdout.on('data', data => { process.stdout.write(`[${label}] ${data}`); writeLog('', data); });
  child.stderr.on('data', data => { process.stderr.write(`[${label}] ${data}`); writeLog('[stderr] ', data); });
  child.on('spawn', () => console.log(`✅ ${label} Node process spawned (pid=${child.pid})`));
  child.on('error', err => { console.error(`❌ ${label} process error:`, err); writeLog('[error] ', `${err.stack || err}\n`); });
  child.on('exit', (code, signal) => { if (!shuttingDown) console.error(`❌ ${label} EXITED: code=${code}, signal=${signal || 'none'}`); try { logStream.end(); } catch (_) {} });
  return child;
}

const originalLoad = Module._load;
const serviceNames = new Set(['relay.js', 'qlab-bridge.js']);
Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
  const requestName = path.basename(String(request));
  const resolvedName = resolved ? path.basename(path.resolve(resolved)) : '';
  if (serviceNames.has(requestName) || serviceNames.has(resolvedName)) { console.log(`⏭️ Skipping legacy service require: ${request}`); return { shutdown() {} }; }
  return originalLoad.apply(this, arguments);
};

require(path.join(__dirname, 'main.js'));

// The renderer previously had two competing output-settings implementations.
// One of them read the old persisted Universe 3 value before central-output.js
// repaired it, then restored that stale value whenever the number field changed.
// Clear the old renderer storage before the first BrowserWindow is created.
app.whenReady().then(async () => {
  try {
    await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
    console.log('🧹 Cleared stale renderer localStorage before startup');
  } catch (err) {
    console.warn('⚠️ Could not clear renderer localStorage:', err.message);
  }
});

// Keep the Universe field under one source of truth. This runs in the renderer
// after all existing scripts have loaded, and captures changes before the old
// modes.js change handler can overwrite the user's value.
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    window.webContents.executeJavaScript(`
      (() => {
        if (window.__universeInputFix) return;
        window.__universeInputFix = true;

        const applyUniverse = () => {
          const input = document.getElementById('artnetUni');
          if (!input) return;
          const value = Number(input.value);
          if (!Number.isInteger(value) || value < 0) {
            input.value = '1';
            return;
          }

          // Keep both legacy and central settings in sync so neither code path
          // can resurrect an old Universe 3 value.
          try {
            const current = JSON.parse(localStorage.getItem('lighting-output-settings') || '{}');
            const data = { ...current, universe: value };
            localStorage.setItem('lighting-output-settings', JSON.stringify(data));
            localStorage.setItem('dmxOutputSettings', JSON.stringify(data));
          } catch (_) {}

          if (window.ArtNet) window.ArtNet.universe = value;
          window.dispatchEvent(new CustomEvent('dmx-universe-changed', { detail: value }));
          console.log('🎛 DMX universe set to', value);
        };

        const input = document.getElementById('artnetUni');
        if (input) {
          input.min = '0';
          input.step = '1';
          input.value = '1';

          // Capture phase runs before the old modes.js listener.
          input.addEventListener('change', event => {
            event.stopImmediatePropagation();
            applyUniverse();
          }, true);

          input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            applyUniverse();
          }, true);
        }

        // The settings UI may be created/re-rendered later, so re-apply the
        // guard whenever the settings page changes the DOM.
        const observer = new MutationObserver(() => {
          const next = document.getElementById('artnetUni');
          if (!next || next.dataset.universeFixInstalled) return;
          next.dataset.universeFixInstalled = '1';
          next.min = '0';
          next.step = '1';
          next.addEventListener('change', event => {
            event.stopImmediatePropagation();
            applyUniverse();
          }, true);
          next.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            applyUniverse();
          }, true);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        console.log('✅ Universe input fix installed');
      })();
    `).catch(err => console.error('❌ Universe input fix failed:', err));
  });
});

function startRelayInElectronMainProcess() {
  const relayPath = path.join(serviceRoot, 'relay.js');
  if (!fs.existsSync(relayPath)) { console.error(`❌ ART-NET relay missing: ${relayPath}`); return null; }
  try {
    const serviceNodeModules = path.join(serviceRoot, 'node_modules');
    process.env.NODE_PATH = [serviceNodeModules, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
    Module._initPaths();
    directRelayService = require(relayPath);
    console.log('✅ ART-NET relay running inside Electron main process');
    return directRelayService;
  } catch (err) { console.error('❌ ART-NET relay failed to start in Electron main process:', err); return null; }
}

function startUsbInElectronMainProcess() {
  const usbPath = path.join(serviceRoot, 'usb-dmx.js');
  if (!fs.existsSync(usbPath)) { console.error(`❌ USB DMX service missing: ${usbPath}`); return null; }
  try {
    const serviceNodeModules = path.join(serviceRoot, 'node_modules');
    process.env.NODE_PATH = [serviceNodeModules, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
    Module._initPaths();
    directUsbService = require(usbPath);
    console.log('✅ USB DMX service running inside Electron main process');
    return directUsbService;
  } catch (err) { console.error('❌ USB DMX service failed to start:', err); return null; }
}

app.whenReady().then(() => {
  startRelayInElectronMainProcess();
  startUsbInElectronMainProcess();
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}).catch(err => console.error('❌ Electron readiness failed:', err));

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, service] of [['ART-NET relay', directRelayService], ['USB DMX service', directUsbService]]) {
    if (service && typeof service.shutdown === 'function') { try { service.shutdown(); } catch (err) { console.error(`❌ ${name} shutdown failed:`, err); } }
  }
  for (const { child, logStream } of children) { try { if (child && !child.killed) child.kill('SIGTERM'); } catch (_) {} try { logStream.end(); } catch (_) {} }
}

app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
