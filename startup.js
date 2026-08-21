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
  const writeLog = (prefix, data) => logStream.write(`[${stamp()}] ${prefix}${String(data)}`);

  // The relay and QLab bridge are ordinary Node services. Run them with
  // Electron's bundled Node runtime in normal Node mode so UDP networking
  // behaves exactly like `node relay.js` on macOS.
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

// main.js historically required the services in-process. Do not allow those
// legacy requires to start a second copy (or fail inside app.asar). Matching
// the request directly is intentional: Electron's asar module resolver can
// make _resolveFilename behave differently from a normal Node process.
const originalLoad = Module._load;
const legacyServiceRequests = new Set([
  './relay.js',
  'relay.js',
  './js/qlab-bridge.js',
  'js/qlab-bridge.js'
]);
Module._load = function(request, parent, isMain) {
  if (typeof request === 'string' && legacyServiceRequests.has(request)) {
    console.log(`⏭️ Skipping legacy service require: ${request}`);
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
  console.log(`📦 ws exists: ${fs.existsSync(path.join(serviceRoot, 'node_modules', 'ws'))}`);

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
