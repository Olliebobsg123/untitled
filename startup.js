const { utilityProcess, app } = require('electron');
const Module = require('module');
const path = require('path');

// Development services live beside the source files. Packaged builds use
// electron-builder extraResources so the service entrypoints are guaranteed
// to be real files outside app.asar.
const root = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : __dirname;
const moduleRoot = root;
const children = [];
let shuttingDown = false;

function startNodeService(label, script) {
  try {
    const scriptPath = path.join(root, script);
    const child = utilityProcess.fork(scriptPath, [], {
      cwd: root,
      env: {
        ...process.env,
        LIGHTING_CONSOLE_SERVICE_CHILD: '1',
        NODE_PATH: [
          path.join(moduleRoot, 'node_modules'),
          process.env.NODE_PATH || ''
        ].filter(Boolean).join(path.delimiter)
      },
      stdio: 'pipe',
      serviceName: label
    });

    child.stdout?.on('data', data => process.stdout.write(`[${label}] ${data}`));
    child.stderr?.on('data', data => process.stderr.write(`[${label}] ${data}`));
    child.on('spawn', () => console.log(`▶️ Started ${label}: ${scriptPath}`));
    child.on('error', err => console.error(`❌ ${label} process failed:`, err));
    child.on('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`❌ ${label} exited (code=${code}, signal=${signal || 'none'})`);
      }
    });

    children.push({ label, child });
  } catch (err) {
    console.error(`❌ Failed to start ${label}:`, err);
  }
}

// main.js contains legacy require() calls for these services. Replace those
// requires with harmless stubs so packaged and development startup only run
// one real copy of each service process.
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

// Register the Electron application first. utilityProcess.fork() is only
// available after Electron has reached the ready state.
require(path.join(__dirname, 'main.js'));

const startServicesWhenReady = () => {
  if (shuttingDown) return;

  console.log(`📦 Service root: ${root}`);
  console.log(`📦 Packaged: ${app.isPackaged}`);

  startNodeService('ART-NET relay', 'relay.js');
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
};

if (app.isReady()) {
  startServicesWhenReady();
} else {
  app.whenReady().then(startServicesWhenReady).catch(err => {
    console.error('❌ Failed waiting for Electron readiness:', err);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { label, child } of children) {
    try {
      console.log(`🛑 Stopping ${label}...`);
      child.kill();
    } catch (err) {
      console.error(`❌ Failed to stop ${label}:`, err.message);
    }
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
