const { app, session } = require('electron');
const { spawn } = require('child_process');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let directRelayService = null;
let directUsbService = null;
let directMultiOutputService = null;
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

app.whenReady().then(async () => {
  try { await session.defaultSession.clearStorageData({ storages: ['localstorage'] }); console.log('🧹 Cleared stale renderer localStorage before renderer startup'); }
  catch (err) { console.warn('⚠️ Could not clear renderer localStorage:', err.message); }
  require(path.join(__dirname, 'main.js'));
}).catch(err => console.error('❌ Renderer storage reset failed:', err));

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    window.webContents.executeJavaScript(`
      (() => {
        if (window.__universeInputFix) return;
        window.__universeInputFix = true;
        const applyUniverse = () => {
          const input = document.getElementById('artnetUni'); if (!input) return;
          const value = Number(input.value); if (!Number.isInteger(value) || value < 0) { input.value = '1'; return; }
          try { const current = JSON.parse(localStorage.getItem('lighting-output-settings') || '{}'); const data = { ...current, universe: value }; localStorage.setItem('lighting-output-settings', JSON.stringify(data)); localStorage.setItem('dmxOutputSettings', JSON.stringify(data)); } catch (_) {}
          if (window.ArtNet) window.ArtNet.universe = value;
          window.dispatchEvent(new CustomEvent('dmx-universe-changed', { detail: value }));
          console.log('🎛 DMX universe set to', value);
        };
        const install = input => {
          if (!input || input.dataset.universeFixInstalled) return;
          input.dataset.universeFixInstalled = '1'; input.min = '0'; input.step = '1'; input.value = '1';
          input.addEventListener('change', event => { event.stopImmediatePropagation(); applyUniverse(); }, true);
          input.addEventListener('keydown', event => { if (event.key !== 'Enter') return; event.preventDefault(); event.stopImmediatePropagation(); applyUniverse(); }, true);
        };
        install(document.getElementById('artnetUni'));
        const observer = new MutationObserver(() => install(document.getElementById('artnetUni')));
        observer.observe(document.documentElement, { childList: true, subtree: true });
        console.log('✅ Universe input fix installed');
      })();
    `).catch(err => console.error('❌ Universe input fix failed:', err));
  });
});

function startRelayInElectronMainProcess() {
  const relayPath = path.join(serviceRoot, 'relay.js');
  if (!fs.existsSync(relayPath)) { console.error(`❌ ART-NET relay missing: ${relayPath}`); return null; }
  try { const serviceNodeModules = path.join(serviceRoot, 'node_modules'); process.env.NODE_PATH = [serviceNodeModules, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter); Module._initPaths(); directRelayService = require(relayPath); console.log('✅ ART-NET relay running inside Electron main process'); return directRelayService; }
  catch (err) { console.error('❌ ART-NET relay failed to start in Electron main process:', err); return null; }
}

function startUsbInElectronMainProcess() {
  const usbPath = path.join(serviceRoot, 'usb-dmx.js');
  if (!fs.existsSync(usbPath)) { console.error(`❌ USB DMX service missing: ${usbPath}`); return null; }
  try { const serviceNodeModules = path.join(serviceRoot, 'node_modules'); process.env.NODE_PATH = [serviceNodeModules, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter); Module._initPaths(); directUsbService = require(usbPath); console.log('✅ USB DMX service running inside Electron main process'); return directUsbService; }
  catch (err) { console.error('❌ USB DMX service failed to start:', err); return null; }
}

function startMultiOutputInElectronMainProcess() {
  const multiPath = path.join(serviceRoot, 'multi-output.js');
  if (!fs.existsSync(multiPath)) { console.error(`❌ Multi-universe output service missing: ${multiPath}`); return null; }
  try { const serviceNodeModules = path.join(serviceRoot, 'node_modules'); process.env.NODE_PATH = [serviceNodeModules, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter); Module._initPaths(); directMultiOutputService = require(multiPath); console.log('✅ Multi-universe output service running inside Electron main process'); return directMultiOutputService; }
  catch (err) { console.error('❌ Multi-universe output service failed to start:', err); return null; }
}

app.whenReady().then(() => {
  startRelayInElectronMainProcess();
  startUsbInElectronMainProcess();
  startMultiOutputInElectronMainProcess();
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}).catch(err => console.error('❌ Electron readiness failed:', err));

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, service] of [['ART-NET relay', directRelayService], ['USB DMX service', directUsbService], ['Multi-universe output service', directMultiOutputService]]) {
    if (service && typeof service.shutdown === 'function') { try { service.shutdown(); } catch (err) { console.error(`❌ ${name} shutdown failed:`, err); } }
  }
  for (const { child, logStream } of children) { try { if (child && !child.killed) child.kill('SIGTERM'); } catch (_) {} try { logStream.end(); } catch (_) {} }
}

app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
