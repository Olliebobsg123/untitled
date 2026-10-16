'use strict';

// The console window's only way to reach the main process: a fixed set of calls,
// no Node.js. (The window runs sandboxed; see main.js.)

const { contextBridge, ipcRenderer } = require('electron');

const listen = channel => callback => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// Show files (js/showfile.js).
contextBridge.exposeInMainWorld('LXShowFiles', {
  save: (filePath, show) => ipcRenderer.invoke('show:save', { filePath, show }),
  load: filePath => ipcRenderer.invoke('show:load', { filePath }),
  getDefaultDirectory: () => ipcRenderer.invoke('show:directory')
});

// Suggestions and bug reports (js/feedback.js).
contextBridge.exposeInMainWorld('LXFeedbackMail', {
  send: payload => ipcRenderer.invoke('feedback:send', payload)
});

// Tapo smart bulbs (js/tapo-integration.js).
contextBridge.exposeInMainWorld('Tapo', {
  test: config => ipcRenderer.invoke('tapo:test', config),
  setState: (config, state) => ipcRenderer.invoke('tapo:set-state', config, state),
  clearSession: config => ipcRenderer.invoke('tapo:clear-session', config)
});

// DMX output (js/dmx.js sends frames; js/multi-output.js sets the outputs up).
contextBridge.exposeInMainWorld('LXOutput', {
  sendFrames: universes => ipcRenderer.send('dmx:frames', universes),
  setBlind: blind => ipcRenderer.send('dmx:blind', Boolean(blind)),
  configure: outputs => ipcRenderer.invoke('dmx:configure', outputs),
  status: () => ipcRenderer.invoke('dmx:status'),
  usbPorts: () => ipcRenderer.invoke('dmx:usb-ports'),
  onStatus: listen('dmx:status')
});

// Art-Net node discovery and RDM (js/multi-output.js, js/rdm.js).
contextBridge.exposeInMainWorld('LXArtNet', {
  poll: target => ipcRenderer.invoke('artnet:poll', target),
  nodes: () => ipcRenderer.invoke('artnet:nodes'),
  requestTod: (universe, target) => ipcRenderer.invoke('rdm:request', { universe, target }),
  flushTod: (universe, target) => ipcRenderer.invoke('rdm:flush', { universe, target }),
  onNode: listen('artnet:node'),
  onTod: listen('rdm:tod')
});

// The licence (js/license.js). The window can ask, activate and deactivate, but
// the tier itself is decided in the main process.
contextBridge.exposeInMainWorld('LXLicense', {
  state: () => ipcRenderer.invoke('license:state'),
  activate: key => ipcRenderer.invoke('license:activate', key),
  validate: () => ipcRenderer.invoke('license:validate'),
  deactivate: () => ipcRenderer.invoke('license:deactivate'),
  importLegacy: legacy => ipcRenderer.invoke('license:import-legacy', legacy),
  onChange: listen('license:changed')
});
