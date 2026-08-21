const { app } = require('electron');
const Module = require('module');
const fs = require('fs');
const path = require('path');

// startup.js is only a compatibility wrapper. The actual service lifecycle
// belongs to main.js. Do not start the relay here: doing so created duplicate
// WebSocket/UDP servers and broke both packaged and development launches.
//
// In a packaged app main.js still uses require('./relay.js'). electron-builder
// places the service copy in Resources/services, so redirect those two legacy
// relative requires to the packaged service files. In development, leave
// normal relative resolution untouched.
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function(request, parent, isMain, options) {
  if (app.isPackaged && parent?.filename) {
    const parentPath = path.resolve(parent.filename);
    const mainPath = path.join(process.resourcesPath, 'app.asar', 'main.js');

    if (parentPath === mainPath && request === './relay.js') {
      const target = path.join(process.resourcesPath, 'services', 'relay.js');
      if (fs.existsSync(target)) return target;
    }

    if (parentPath === mainPath && request === './js/qlab-bridge.js') {
      const target = path.join(process.resourcesPath, 'services', 'js', 'qlab-bridge.js');
      if (fs.existsSync(target)) return target;
    }
  }

  return originalResolve.call(this, request, parent, isMain, options);
};

require(path.join(__dirname, 'main.js'));
