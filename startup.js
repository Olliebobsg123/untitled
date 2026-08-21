const { utilityProcess, app } = require('electron');
const Module = require('module');
const path = require('path');

const root = __dirname;
const children = [];
let shuttingDown = false;

function startNodeService(label, script) {
  try {
    const child = utilityProcess.fork(path.join(root, script), [], {
      cwd: root,
      env: { ...process.env, LIGHTING_CONSOLE_SERVICE_CHILD: '1' },
      stdio: 'pipe'
    });

    child.stdout?.on('data', data => process.stdout.write(`[${label}] ${data}`));
    child.stderr?.on('data', data => process.stderr.write(`[${label}] ${data}`));
    child.on('spawn', () => console.log(`▶️ Started ${label}: ${script}`));
    child.on('error', err => console.error(`❌ ${label} process failed:`, err));
    child.on('exit', (code, signal) => {
      if (!shuttingDown) console.error(`❌ ${label} exited (code=${code}, signal=${signal || 'none'})`);
    });

    children.push({ label, child });
  } catch (err) {
    console.error(`❌ Failed to start ${label}:`, err);
  }
}

// main.js has legacy require() calls for these services. Patch those requires
// first so the real service processes are only started once, below.
const originalLoad = Module._load;
const serviceFiles = new Set([
  path.resolve(root, 'relay.js'),
  path.resolve(root, 'js/qlab-bridge.js')
]);

Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
  if (resolved && serviceFiles.has(resolved)) return { shutdown() {} };
  return originalLoad.apply(this, arguments);
};

// Register main.js first so Electron can finish its normal startup sequence.
require(path.join(root, 'main.js'));

// Electron only permits utilityProcess.fork() once app is ready. Starting the
// relay at module load time makes packaged builds fail with:
// "utilityProcess cannot be created before app is ready".
const startServicesWhenReady = () => {
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
