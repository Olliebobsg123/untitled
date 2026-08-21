const { app } = require('electron');
const { spawn } = require('child_process');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let shuttingDown = false;

const serviceRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : __dirname;

function servicePath(relativePath) {
  return path.join(serviceRoot, relativePath);
}

function startNodeService(label, relativePath) {
  const scriptPath = servicePath(relativePath);
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ ${label} missing: ${scriptPath}`);
    return null;
  }

  try {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: serviceRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        LIGHTING_CONSOLE_SERVICE_CHILD: '1',
        NODE_PATH: [path.join(serviceRoot, 'node_modules'), process.env.NODE_PATH || '']
          .filter(Boolean).join(path.delimiter)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    children.push({ label, child });
    child.stdout.on('data', data => process.stdout.write(`[${label}] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[${label}] ${data}`));
    child.on('spawn', () => console.log(`✅ ${label} process spawned (pid=${child.pid})`));
    child.on('exit', (code, signal) => {
      if (!shuttingDown) console.error(`❌ ${label} exited: code=${code}, signal=${signal || 'none'}`);
    });
    child.on('error', err => console.error(`❌ ${label} process error:`, err));
    console.log(`▶️ ${label}: ${scriptPath}`);
    return child;
  } catch (err) {
    console.error(`❌ Failed to start ${label}:`, err);
    return null;
  }
}

const originalLoad = Module._load;
const legacyServiceFiles = new Set([
  path.resolve(__dirname, 'relay.js'),
  path.resolve(__dirname, 'js/qlab-bridge.js')
]);

Module._load = function(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
  if (resolved && legacyServiceFiles.has(path.resolve(resolved))) {
    return { shutdown() {} };
  }
  return originalLoad.apply(this, arguments);
};

require(path.join(__dirname, 'main.js'));

app.whenReady().then(() => {
  console.log(`📦 Packaged: ${app.isPackaged}`);
  console.log(`📦 Service root: ${serviceRoot}`);
  console.log(`📦 Relay exists: ${fs.existsSync(servicePath('relay.js'))}`);
  console.log(`📦 QLab exists: ${fs.existsSync(servicePath(path.join('js', 'qlab-bridge.js')))}`);
  console.log(`📦 Node launcher: ${process.execPath}`);

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
