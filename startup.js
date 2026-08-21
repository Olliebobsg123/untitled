const { app } = require('electron');
const { spawn } = require('child_process');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const children = [];
let shuttingDown = false;
const serviceRoot = app.isPackaged ? path.join(process.resourcesPath, 'services') : __dirname;

// Keep service stdout/stderr available even when macOS launches the app from Finder.
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
    const text = String(data);
    logStream.write(`[${stamp()}] ${prefix}${text}`);
  };

  // Run the relay/QLab scripts under Electron's bundled Node runtime, but as a
  // normal Node process. Electron utilityProcess runs with Chromium's process
  // environment; on macOS that can make ordinary UDP routing fail with
  // EHOSTUNREACH even though the same dgram send works from Node. ELECTRON_RUN_AS_NODE
  // gives the child the normal Node networking stack without requiring Node to
  // be installed on the end user's machine.
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    LIGHTING_CONSOLE_SERVICE_CHILD: '1',
    LIGHTING_CONSOLE_LOG_DIR: logDir,
    NODE_PATH: [path.join(serviceRoot, 'node_modules'), process.env.NODE_PATH || '']
      .filter(Boolean).join(path.delimiter)
  };

  try {
    console.log(`📦 ${label} path: ${scriptPath}`);
    console.log(`📦 ${label} exists: true`);
    console.log(`📦 ${label} log: ${logPath}`);

    const child = spawn(process.execPath, [scriptPath], {
      cwd: serviceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

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
      if (!shuttingDown) console.error(`❌ ${label} EXITED: code=${code}, signal=${signal || 'none'}`);
      writeLog('', `process exited code=${code}, signal=${signal || 'none'}\n`);
      try { logStream.end(); } catch (_) {}
    });
    return child;
  } catch (err) {
    console.error(`❌ Failed to start ${label}:`, err);
    try { logStream.end(); } catch (_) {}
    return null;
  }
}

// main.js contains legacy in-process requires for development. startup.js owns
// the service processes so the packaged app has the same lifecycle in Finder
// and in Terminal, without creating duplicate relay/QLab listeners.
const originalLoad = Module._load;
const serviceNames = new Set(['relay.js', 'qlab-bridge.js']);
Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}

  if (resolved && serviceNames.has(path.basename(path.resolve(resolved)))) {
    console.log(`⏭️ Skipping legacy service require: ${resolved}`);
    return { shutdown() {} };
  }

  return originalLoad.apply(this, arguments);
};

require(path.join(__dirname, 'main.js'));

app.whenReady().then(() => {
  console.log(`📦 Packaged: ${app.isPackaged}`);
  console.log(`📦 Service root: ${serviceRoot}`);
  console.log(`📦 Service logs: ${logDir}`);
  console.log(`📦 Relay exists: ${fs.existsSync(path.join(serviceRoot, 'relay.js'))}`);
  console.log(`📦 QLab exists: ${fs.existsSync(path.join(serviceRoot, 'js', 'qlab-bridge.js'))}`);

  startNodeService('ART-NET relay', 'relay.js');
  startNodeService('QLab bridge', path.join('js', 'qlab-bridge.js'));
}).catch(err => console.error('❌ Electron readiness failed:', err));

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('🛑 Stopping child services...');

  for (const { label, child, logStream } of children) {
    try {
      console.log(`🛑 Stopping ${label} (pid=${child.pid})...`);
      child.kill('SIGTERM');
    } catch (_) {}
    try { logStream.end(); } catch (_) {}
  }
}

app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
