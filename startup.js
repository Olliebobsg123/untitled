const { app } = require('electron');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const services = [];
let shuttingDown = false;
const serviceRoot = app.isPackaged ? path.join(process.resourcesPath, 'services') : __dirname;

// Keep service logs available even when macOS launches the app from Finder.
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

  try {
    console.log(`📦 ${label} path: ${scriptPath}`);
    console.log(`📦 ${label} exists: true`);
    console.log(`📦 ${label} log: ${logPath}`);
    console.log(`📦 Running ${label} in Electron main process`);

    // IMPORTANT: Do not spawn Electron with ELECTRON_RUN_AS_NODE for packaged
    // services. On macOS that child process can get a different network context
    // from the Electron app launched by Finder, producing EHOSTUNREACH for UDP
    // even though the host and route are valid. Loading the service directly
    // keeps its UDP socket in the same process/network context as the app.
    const service = require(scriptPath);
    services.push({ label, service });
    console.log(`✅ ${label} service started in main process`);
    return service;
  } catch (err) {
    console.error(`❌ ${label} failed:`, err);
    return null;
  }
}

// main.js contains legacy in-process requires. startup.js explicitly owns
// service startup, so prevent those requires from creating duplicate servers.
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
  console.log('🛑 Stopping services...');

  for (const { label, service } of services) {
    try {
      if (service && typeof service.shutdown === 'function') {
        console.log(`🛑 Stopping ${label}...`);
        service.shutdown();
      }
    } catch (err) {
      console.error(`❌ ${label} shutdown failed:`, err);
    }
  }
}

app.on('before-quit', shutdown);
app.on('will-quit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', shutdown);
