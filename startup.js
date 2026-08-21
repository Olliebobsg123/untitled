const { utilityProcess } = require('electron');
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

// Start the network services as Node-based Electron utility processes.
// This avoids relying on ELECTRON_RUN_AS_NODE, which may be disabled by
// Electron packaging fuses.
startNodeService('ART-NET relay', 'relay.js');
startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));

// main.js still contains its legacy require() calls. Return harmless service
// handles there so the actual network servers above are not started twice.
const originalLoad = Module._load;
const serviceFiles = new Set([
  path.resolve(root, 'relay.js'),
  path.resolve(root, 'js', 'qlab-bridge.js')
]);

Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
  if (resolved && serviceFiles.has(resolved)) return { shutdown() {} };
  return originalLoad.apply(this, arguments);
};

require(path.join(root, 'main.js'));

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
