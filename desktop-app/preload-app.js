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
  loadPrototype: (filePath, testerName, testType) =>
    ipcRenderer.invoke('load-prototype', { filePath: filePath, testerName: testerName, testType: testType }),
  loadPrototypeUrl: (url, testerName, testType) =>
    ipcRenderer.invoke('load-prototype-url', { url: url, testerName: testerName, testType: testType }),
  loadPrototypeFigma: (url, testerName, testType) =>
    ipcRenderer.invoke('load-prototype-figma', { url: url, testerName: testerName, testType: testType }),
  resetSession: () => ipcRenderer.send('reset-session'),
  onStatusUpdate: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('status-update', listener);
    return () => ipcRenderer.removeListener('status-update', listener);
  }
});
