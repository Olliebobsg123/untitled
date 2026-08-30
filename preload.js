'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronShowFile', {
  save: showData => ipcRenderer.invoke('show-file-save', showData),
  load: () => ipcRenderer.invoke('show-file-load')
});
