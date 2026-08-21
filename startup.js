const { app } = require('electron');
const { spawn } = require('child_process');
const Module = require('module');
const path = require('path');

let mainLoaded = false;
let shuttingDown = false;
const children = [];

// In development the services live beside the source. In a packaged app
// electron-builder copies them to Resources/services via extraResources.
const serviceRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : __dirname;

function startNodeService(label, relativeScript) {
  const scriptPath = path.join(serviceRoot, relativeScript);

  try {
    console.log(`📦 ${label} path: ${scriptPath}`);
    console.log(`📦 ${label} exists: ${require('fs').existsSync(scriptPath)}`);

    // Do NOT use Electron's utilityProcess.fork() here. A packaged Electron
    // executable is not a normal Node executable, and utilityProcess can also
    // be unavailable during early startup. Spawn the Electron binary in
    // Node mode so relay.js/qlab-bridge.js run as ordinary Node processes.
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LIGHTING_CONSOLE_SERVICE_CHILD: '1',
      NODE_PATH: [
        path.join(serviceRoot, 'node_modules'),
        process.env.NODE_PATH || ''
      ].filter(Boolean).join(path.delimiter)
    };

    const child = spawn(process.execPath, [scriptPath], {
      cwd: serviceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    children.push({ label, child });

    child.stdout.on('data', data => {
      process.stdout.write(`[${label}] ${data}`);
    });
    child.stderr.on('data', data => {
      process.stderr.write(`[${label}] ${data}`);
    });
    child.on('error', err => {
      console.error(`❌ ${label} process error:`, err);
    });
    child.on('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`❌ ${label} exited (code=${code}, signal=${signal || 'none'})`);
      }
    });

    console.log(`▶️ Started ${label} as Node process`);
    return child;
  } catch (err) {
    console.error(`❌ Failed to start ${label}:`, err);
    return null;
  }
}

// main.js still contains legacy require() calls. Prevent those calls from
// starting a second copy; startup.js owns the service child processes.
const originalLoad = Module._load;
const serviceFiles = new Set([
  path.resolve(__dirname, 'relay.js'),
  path.resolve(__dirname, 'js/qlab-bridge.js')
]);

Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
  if (resolved && serviceFiles.has(resolved)) return { shutdown() {} };
  return originalLoad.apply(this, arguments);
};

function startServices() {
  if (shuttingDown) return;
  console.log(`📦 Service root: ${serviceRoot}`);
  console.log(`📦 Packaged: ${app.isPackaged}`);
  startNodeService('ART-NET relay', 'relay.js');
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}

// Load the Electron UI immediately, but only launch the external Node
// services after Electron is ready. This works for both `npm start` and the
// packaged .app.
require(path.join(__dirname, 'main.js'));
mainLoaded = true;

app.whenReady().then(startServices).catch(err => {
  console.error('❌ Electron readiness failed:', err);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { label, child } of children) {
    try {
      console.log(`🛑 Stopping ${label}...`);
      child.kill('SIGTERM');
    } catch (err) {
      console.error(`❌ Failed to stop ${label}:`, err.message);
    }
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
