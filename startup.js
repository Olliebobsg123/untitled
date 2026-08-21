const { app } = require('electron');
const { spawn } = require('child_process');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let directRelayService = null;
let shuttingDown = false;

// In development the services live beside startup.js. In the packaged app
// electron-builder copies them to Resources/services so they can run outside
// app.asar.
const serviceRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : __dirname;

// Finder launches do not have a useful terminal, so always persist service logs.
const logDir = path.join(app.getPath('logs'), 'services');
fs.mkdirSync(logDir, { recursive: true });

function startNodeService(label, relativeScript) {
  const scriptPath = path.join(serviceRoot, relativeScript);

  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ ${label} missing: ${scriptPath}`);
    return null;
  }

  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const logPath = path.join(logDir, `${safeLabel}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const stamp = () => new Date().toISOString();
  const writeLog = (prefix, data) => {
    try { logStream.write(`[${stamp()}] ${prefix}${String(data)}`); } catch (_) {}
  };

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    LIGHTING_CONSOLE_SERVICE_CHILD: '1',
    LIGHTING_CONSOLE_LOG_DIR: logDir,
    NODE_PATH: [
      path.join(serviceRoot, 'node_modules'),
      process.env.NODE_PATH || ''
    ].filter(Boolean).join(path.delimiter)
  };

  console.log(`📦 ${label} path: ${scriptPath}`);
  console.log(`📦 ${label} exists: true`);
  console.log(`📦 ${label} log: ${logPath}`);

  let child;
  try {
    child = spawn(process.execPath, [scriptPath], {
      cwd: serviceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (err) {
    console.error(`❌ Failed to start ${label}:`, err);
    try { logStream.end(); } catch (_) {}
    return null;
  }

  children.push({ label, child, logStream });

  child.stdout.on('data', data => {
    process.stdout.write(`[${label}] ${data}`);
    writeLog('', data);
  });
  child.stderr.on('data', data => {
    process.stderr.write(`[${label}] ${data}`);
    writeLog('[stderr] ', data);
  });
  child.on('spawn', () => {
    console.log(`✅ ${label} Node process spawned (pid=${child.pid})`);
    writeLog('', `process spawned pid=${child.pid}\n`);
  });
  child.on('error', err => {
    console.error(`❌ ${label} process error:`, err);
    writeLog('[error] ', `${err.stack || err}\n`);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`❌ ${label} EXITED: code=${code}, signal=${signal || 'none'}`);
    }
    writeLog('', `process exited code=${code}, signal=${signal || 'none'}\n`);
    try { logStream.end(); } catch (_) {}
  });

  return child;
}

// main.js contains legacy in-process service startup. startup.js owns the
// lifecycle so the packaged app cannot accidentally create duplicate servers.
// The important exception is the Art-Net relay: it is deliberately allowed to
// run IN THIS ELECTRON MAIN PROCESS. Running the relay as ELECTRON_RUN_AS_NODE
// was the source of the Finder-only UDP EHOSTUNREACH failure seen on macOS.
const originalLoad = Module._load;
const serviceNames = new Set(['relay.js', 'qlab-bridge.js']);

Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}

  const requestName = path.basename(String(request));
  const resolvedName = resolved ? path.basename(path.resolve(resolved)) : '';

  if (serviceNames.has(requestName) || serviceNames.has(resolvedName)) {
    console.log(`⏭️ Skipping legacy service require: ${request}`);
    return { shutdown() {} };
  }

  return originalLoad.apply(this, arguments);
};

// Load the UI. The require shim above prevents main.js from starting duplicate
// relay/QLab services.
require(path.join(__dirname, 'main.js'));

function startRelayInElectronMainProcess() {
  const relayPath = path.join(serviceRoot, 'relay.js');

  if (!fs.existsSync(relayPath)) {
    console.error(`❌ ART-NET relay missing: ${relayPath}`);
    return null;
  }

  try {
    console.log(`📡 Starting ART-NET relay inside Electron main process: ${relayPath}`);
    console.log('📡 This avoids the Finder-launched child-process UDP routing problem.');

    // relay.js requires its dependencies relative to Resources/services, so
    // temporarily expose the packaged service node_modules to Node's resolver.
    const serviceNodeModules = path.join(serviceRoot, 'node_modules');
    const previousNodePath = process.env.NODE_PATH;
    process.env.NODE_PATH = [serviceNodeModules, previousNodePath || '']
      .filter(Boolean).join(path.delimiter);
    Module._initPaths();

    directRelayService = require(relayPath);
    console.log('✅ ART-NET relay running inside Electron main process');
    return directRelayService;
  } catch (err) {
    console.error('❌ ART-NET relay failed to start in Electron main process:', err);
    return null;
  }
}

app.whenReady().then(() => {
  console.log(`📦 Packaged: ${app.isPackaged}`);
  console.log(`📦 Service root: ${serviceRoot}`);
  console.log(`📦 Service logs: ${logDir}`);
  console.log(`📦 Relay exists: ${fs.existsSync(path.join(serviceRoot, 'relay.js'))}`);
  console.log(`📦 QLab exists: ${fs.existsSync(path.join(serviceRoot, 'js', 'qlab-bridge.js'))}`);

  // CRITICAL: Art-Net UDP now belongs to the same Electron GUI process that
  // macOS sees when the user double-clicks the application in Finder.
  startRelayInElectronMainProcess();

  // QLab remains a child process because it is independent of the Art-Net UDP
  // path and has historically worked correctly this way.
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}).catch(err => {
  console.error('❌ Electron readiness failed:', err);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('🛑 Stopping services...');

  if (directRelayService && typeof directRelayService.shutdown === 'function') {
    try {
      console.log('🛑 Stopping ART-NET relay...');
      directRelayService.shutdown();
    } catch (err) {
      console.error('❌ ART-NET relay shutdown failed:', err);
    }
  }

  for (const { label, child, logStream } of children) {
    try {
      if (child && !child.killed) {
        console.log(`🛑 Stopping ${label} (pid=${child.pid})...`);
        child.kill('SIGTERM');
      }
    } catch (_) {}
    try { logStream.end(); } catch (_) {}
  }
}

app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
