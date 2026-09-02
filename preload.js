const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LXShowFiles', {
  save: (filePath, show) => ipcRenderer.invoke('lx-show-save', { filePath, show }),
  load: filePath => ipcRenderer.invoke('lx-show-load', { filePath }),
  getDefaultDirectory: () => ipcRenderer.invoke('lx-show-default-directory')
});
