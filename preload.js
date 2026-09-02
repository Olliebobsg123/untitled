const { contextBridge, ipcRenderer } = require('electron');

const showFileApi = {
  save: (filePath, show) => ipcRenderer.invoke('lx-show-save', { filePath, show }),
  load: filePath => ipcRenderer.invoke('lx-show-load', { filePath }),
  getDefaultDirectory: () => ipcRenderer.invoke('lx-show-default-directory')
};

try {
  contextBridge.exposeInMainWorld('LXShowFiles', showFileApi);
  console.log('[SHOW DEBUG] LXShowFiles preload bridge exposed');
} catch (error) {
  console.error('[SHOW DEBUG] FAILED to expose LXShowFiles bridge:', error);
}

// Expose a read-only diagnostic helper so the renderer can report whether the
// Electron IPC bridge actually made it into the page.
try {
  contextBridge.exposeInMainWorld('LXShowDebug', {
    bridgeReady: () => true,
    bridgeKeys: () => Object.keys(showFileApi)
  });
} catch (error) {
  console.error('[SHOW DEBUG] FAILED to expose LXShowDebug:', error);
}

// Ensure the renderer-side SAVE / LOAD command handler is always loaded.
const injectShowFileCommands = () => {
  try {
    if (document.getElementById('lxShowFileCommandsScript')) return;
    const script = document.createElement('script');
    script.id = 'lxShowFileCommandsScript';
    script.src = new URL('./js/showfile.js', window.location.href).href;
    (document.head || document.documentElement).appendChild(script);
    console.log('[SHOW DEBUG] Requested showfile.js injection');
  } catch (error) {
    console.error('[SHOW DEBUG] Failed to load showfile.js:', error);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShowFileCommands, { once: true });
} else {
  injectShowFileCommands();
}
