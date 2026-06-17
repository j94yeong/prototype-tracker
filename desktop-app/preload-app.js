/*
 * Preload script for the app's own UI window (renderer/index.html).
 * Exposes a minimal, safe API surface to the renderer via contextBridge -
 * no direct ipcRenderer/Node access leaks into the UI's JS world.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fctApi', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  pickPrototypeFile: () => ipcRenderer.invoke('pick-prototype-file'),
  loadPrototype: (filePath, testerName) =>
    ipcRenderer.invoke('load-prototype', { filePath: filePath, testerName: testerName }),
  loadPrototypeUrl: (url, testerName) =>
    ipcRenderer.invoke('load-prototype-url', { url: url, testerName: testerName }),
  resetSession: () => ipcRenderer.send('reset-session'),
  onStatusUpdate: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('status-update', listener);
    return () => ipcRenderer.removeListener('status-update', listener);
  }
});
