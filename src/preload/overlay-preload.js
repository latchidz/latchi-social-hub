'use strict';

/**
 * Overlay preload — tiny bridge for the state overlay view
 * (loading / connecting / error / offline / home).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hubOverlay', {
  ready: () => ipcRenderer.send('overlay:ready'),
  onShow: (cb) => ipcRenderer.on('overlay:show', (_e, payload) => cb(payload)),
  onHide: (cb) => ipcRenderer.on('overlay:hide', () => cb()),
  retry: () => ipcRenderer.invoke('overlay:retry'),
});
