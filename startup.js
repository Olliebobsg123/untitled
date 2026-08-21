const { app } = require('electron');

// Keep all network services in Electron's main process. macOS 15+ applies
// Local Network privacy to the responsible application process; launching
// relay.js as a separate ELECTRON_RUN_AS_NODE child can cause UDP unicast
// traffic to be denied when the app is launched from Finder even though the
// same code works from Terminal.
//
// main.js already owns the service lifecycle and starts relay.js and the QLab
// bridge once Electron is ready. Do not spawn a second copy here.
require('./main.js');

// main.js owns shutdown for its services. Keep this entry point deliberately
// minimal so the packaged app has exactly one service owner and one relay.
app.on('before-quit', () => {
  // Intentionally empty: main.js handles service shutdown.
});
