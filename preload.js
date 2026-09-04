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

try {
  contextBridge.exposeInMainWorld('LXShowDebug', {
    bridgeReady: () => true,
    bridgeKeys: () => Object.keys(showFileApi)
  });
} catch (error) {
  console.error('[SHOW DEBUG] FAILED to expose LXShowDebug:', error);
}

const injectRendererScript = (id, src, label) => {
  try {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = new URL(src, window.location.href).href;
    script.onload = () => console.log(`[SHOW DEBUG] ${label} loaded`);
    script.onerror = error => console.error(`[SHOW DEBUG] Failed to load ${label}:`, error);
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    console.error(`[SHOW DEBUG] Failed to inject ${label}:`, error);
  }
};

const injectShowFileCommands = () => {
  injectRendererScript('lxShowFileCommandsScript', './js/showfile.js', 'showfile.js');
};

const injectFresnelControls = () => {
  injectRendererScript('lxFresnelControlsScript', './js/fresnel-controls.js', 'fresnel-controls.js');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShowFileCommands, { once: true });
  document.addEventListener('DOMContentLoaded', injectFresnelControls, { once: true });
} else {
  injectShowFileCommands();
  injectFresnelControls();
}
