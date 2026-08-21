const { app } = require('electron');
const { spawn } = require('child_process');
const dgram = require('dgram');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let shuttingDown = false;

// In development the services live beside startup.js. In the packaged app
// electron-builder copies them to Resources/services so they can run outside
// app.asar as normal Node scripts.
const serviceRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : __dirname;

// Finder does not give us a useful terminal, so always persist service output.
const logDir = path.join(app.getPath('logs'), 'services');
fs.mkdirSync(logDir, { recursive: true });

function requestLocalNetworkAccess() {
  // macOS Local Network privacy is attached to the responsible GUI app.
  // Terminal-launched command-line tools are automatically allowed, while a
  // Finder-launched app must first perform a local-network operation so macOS
  // can ask the user for permission. A UDP connect is enough to trigger the
  // permission check and does not transmit an Art-Net packet.
  const target = process.env.ARTNET_TARGET || '192.168.1.1';
  const port = 6454;
  const socket = dgram.createSocket('udp4');

  socket.once('error', err => {
    console.error(`❌ Local Network permission/network check failed → ${target}:${port}:`, err.message);
    try { socket.close(); } catch (_) {}
  });

  try {
    console.log(`🔐 Requesting macOS Local Network access for ${target}:${port}...`);
    socket.connect(port, target, () => {
      console.log('✅ Local Network access check completed.');
      setTimeout(() => {
        try { socket.close(); } catch (_) {}
      }, 250);
    });
  } catch (err) {
    console.error('❌ Could not perform Local Network access check:', err);
    try { socket.close(); } catch (_) {}
  }
}

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
    logStream.write(`[${stamp()}] ${prefix}${String(data)}`);
  };

  const env = {
    ...process.env,
    // Run the service with Electron's bundled runtime as ordinary Node.
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

// main.js still contains the old in-process requires for development. When
// startup.js owns the lifecycle, make those requires harmless so we never get
// a second relay/QLab listener inside Electron.
const originalLoad = Module._load;
const serviceNames = new Set(['relay.js', 'qlab-bridge.js']);

Module._load = function(request, parent, isMain) {
  let resolved = null;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch (_) {}

  const requestName = path.basename(String(request));
  const resolvedName = resolved
    ? path.basename(path.resolve(resolved))
    : '';

  if (serviceNames.has(requestName) || serviceNames.has(resolvedName)) {
    console.log(`⏭️ Skipping legacy service require: ${request}`);
    return { shutdown() {} };
  }

  return originalLoad.apply(this, arguments);
};

// Load the actual Electron UI. The require shim above prevents main.js from
// starting duplicate in-process services.
require(path.join(__dirname, 'main.js'));

app.whenReady().then(() => {
  console.log(`📦 Packaged: ${app.isPackaged}`);
  console.log(`📦 Service root: ${serviceRoot}`);
  console.log(`📦 Service logs: ${logDir}`);
  console.log(`📦 Relay exists: ${fs.existsSync(path.join(serviceRoot, 'relay.js'))}`);
  console.log(`📦 QLab exists: ${fs.existsSync(path.join(serviceRoot, 'js', 'qlab-bridge.js'))}`);

  // Do this from the Electron app itself, not the child process. This is
  // important for Finder launches because macOS Local Network privacy tracks
  // the responsible GUI app and its helper processes together.
  requestLocalNetworkAccess();

  startNodeService('ART-NET relay', 'relay.js');
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}).catch(err => {
  console.error('❌ Electron readiness failed:', err);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('🛑 Stopping child services...');

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
