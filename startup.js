const { app } = require('electron');
const path = require('path');

// Keep startup.js deliberately small. The services are started by main.js only
// after Electron is ready, which works both from `npm start` and from the
// packaged .app. Starting Electron's child processes here caused packaged
// builds to report a successful launch while the relay itself never became a
// real Node process.
require(path.join(__dirname, 'main.js'));

process.on('uncaughtException', err => {
  console.error('❌ Lighting Console startup error:', err);
});

process.on('unhandledRejection', err => {
  console.error('❌ Lighting Console unhandled startup error:', err);
});
