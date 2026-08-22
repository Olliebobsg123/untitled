const { app } = require('electron');
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
