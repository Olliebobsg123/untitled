const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LXShowFiles', {
  save: (filePath, show) => ipcRenderer.invoke('lx-show-save', { filePath, show }),
  load: filePath => ipcRenderer.invoke('lx-show-load', { filePath }),
  getDefaultDirectory: () => ipcRenderer.invoke('lx-show-default-directory')
});

// Ensure the renderer-side SAVE / LOAD command handler is always loaded.
// This is intentionally injected from preload so it does not depend on the
// order of the renderer <script> tags in index.html.
const injectShowFileCommands = () => {
  try {
    if (document.getElementById('lxShowFileCommandsScript')) return;
    const script = document.createElement('script');
    script.id = 'lxShowFileCommandsScript';
    script.src = new URL('./js/showfile.js', window.location.href).href;
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    console.error('[SHOW] Failed to load showfile.js:', error);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShowFileCommands, { once: true });
} else {
  injectShowFileCommands();
}
