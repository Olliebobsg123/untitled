const { spawn } = require('child_process');
const Module = require('module');
const path = require('path');

const root = __dirname;
const children = [];
let shuttingDown = false;

function startNodeService(label, script) {
  const child = spawn(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(`[${label}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${label}] ${data}`));
  child.on('error', err => console.error(`❌ ${label} process failed:`, err));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) console.error(`❌ ${label} exited (code=${code}, signal=${signal || 'none'})`);
  });

  children.push({ label, child });
  console.log(`▶️ Started ${label} as node ${script}`);
}

startNodeService('ART-NET relay', 'relay.js');
startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));

// main.js still contains its legacy service startup. Return a harmless
// shutdown-only module there so the real servers are not started twice.
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
    if (child.killed || child.exitCode !== null) continue;
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
