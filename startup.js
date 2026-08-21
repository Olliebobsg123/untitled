const { app } = require('electron');
const { spawn, spawnSync } = require('child_process');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let shuttingDown = false;
const serviceRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : __dirname;

function findNodeBinary() {
  const candidates = [
    process.env.NODE_BINARY,
    process.env.NODE,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }

  try {
    const result = spawnSync('/bin/sh', ['-lc', 'command -v node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const found = String(result.stdout || '').trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch (_) {}

  return null;
}

function startNodeService(label, relativeScript) {
  const scriptPath = path.join(serviceRoot, relativeScript);
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ ${label} missing: ${scriptPath}`);
    return null;
  }

  const nodeBinary = findNodeBinary();
  if (!nodeBinary) {
    console.error('❌ Node.js executable not found. Set NODE_BINARY to your node path.');
    return null;
  }

  console.log(`🚀 Starting ${label}: ${nodeBinary} ${scriptPath}`);

  const child = spawn(nodeBinary, [scriptPath], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      LIGHTING_CONSOLE_SERVICE_CHILD: '1',
      NODE_PATH: [path.join(serviceRoot, 'node_modules'), process.env.NODE_PATH || '']
        .filter(Boolean)
        .join(path.delimiter)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  children.push({ label, child });

  child.stdout.on('data', data => process.stdout.write(`[${label}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${label}] ${data}`));
  child.on('spawn', () => console.log(`✅ ${label} Node process started (pid=${child.pid})`));
  child.on('error', err => console.error(`❌ ${label} Node process error:`, err));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`❌ ${label} Node process EXITED: code=${code}, signal=${signal || 'none'}`);
    }
  });

  return child;
}

// main.js also requires these service files. Do not start a second copy in
// Electron's main process: the real services below run as normal Node.js
// processes, exactly like `node relay.js` from a terminal.
const originalLoad = Module._load;
const serviceFiles = new Set([
  path.resolve(__dirname, 'relay.js'),
  path.resolve(__dirname, 'js/qlab-bridge.js')
]);

Module._load = function(request, parent, isMain) {
  let resolved = null;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch (_) {}

  if (resolved && serviceFiles.has(path.resolve(resolved))) {
    return { shutdown() {} };
  }

  return originalLoad.apply(this, arguments);
};

// Load the Electron UI immediately; the service processes are deliberately
// started only after Electron is ready.
require(path.join(__dirname, 'main.js'));

app.whenReady().then(() => {
  console.log(`📦 Packaged: ${app.isPackaged}`);
  console.log(`📦 Service root: ${serviceRoot}`);
  console.log(`📦 Relay path: ${path.join(serviceRoot, 'relay.js')}`);
  console.log(`📦 Relay exists: ${fs.existsSync(path.join(serviceRoot, 'relay.js'))}`);
  console.log(`📦 Node binary: ${findNodeBinary() || 'NOT FOUND'}`);

  startNodeService('ART-NET relay', 'relay.js');
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}).catch(err => console.error('❌ Electron readiness failed:', err));

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { label, child } of children) {
    try {
      console.log(`🛑 Stopping ${label}...`);
      child.kill('SIGTERM');
    } catch (_) {}
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);

process.on('uncaughtException', err => {
  console.error('❌ Lighting Console startup error:', err);
});

process.on('unhandledRejection', err => {
  console.error('❌ Lighting Console unhandled startup error:', err);
});
