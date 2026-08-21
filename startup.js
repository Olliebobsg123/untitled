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

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    LIGHTING_CONSOLE_SERVICE_CHILD: '1',
    NODE_PATH: [path.join(serviceRoot, 'node_modules'), process.env.NODE_PATH || '']
      .filter(Boolean).join(path.delimiter)
  };

  try {
    console.log(`📦 ${label} path: ${scriptPath}`);
    console.log(`📦 ${label} exists: true`);
    console.log(`📦 ${label} log: ${logPath}`);
    console.log(`📦 Node launcher: ${process.execPath}`);

    const child = spawn(process.execPath, [scriptPath], {
      cwd: serviceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
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
      console.log(`✅ ${label} process spawned (pid=${child.pid})`);
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

// startup.js owns the packaged service processes. main.js may contain legacy
// in-process requires, but electron-builder can unpack those files. Prevent
// those legacy requires from starting a second service instance.
const originalLoad = Module._load;
const serviceNames = new Set(['relay.js', 'qlab-bridge.js']);
Module._load = function(request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}

  if (resolved && serviceNames.has(path.basename(path.resolve(resolved)))) {
    console.log(`⏭️ Skipping in-process service require: ${resolved}`);
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
      setTimeout(() => {
        try { if (!child.killed) child.kill('SIGKILL'); } catch (_) {}
      }, 1500).unref();
    } catch (_) {}
    try { logStream.end(); } catch (_) {}
  }
}

// Finder quits do not reliably deliver SIGINT/SIGTERM to the child processes.
// Explicitly tear them down with the Electron app lifecycle so ports 8081/8083
// cannot be left occupied by an orphaned relay/QLab process.
app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
