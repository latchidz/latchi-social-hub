'use strict';

/**
 * Shell preload — the ONLY bridge between the app UI and the main process.
 * Sandboxed + contextIsolated: the renderer gets a minimal, typed surface
 * and never sees ipcRenderer or any Node API directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  // window
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  onWindowState: (cb) => ipcRenderer.on('window:state', (_e, s) => cb(s)),

  // platforms
  getPlatforms: () => ipcRenderer.invoke('platforms:list'),
  getBackgrounds: () => ipcRenderer.invoke('backgrounds:list'),
  selectPlatform: (id) => ipcRenderer.invoke('platform:select', id),
  retryPlatform: (id) => ipcRenderer.invoke('platform:retry', id),
  onPlatformActive: (cb) => ipcRenderer.on('platform:active', (_e, p) => cb(p)),
  onPlatformState: (cb) => ipcRenderer.on('platform:state', (_e, s) => cb(s)),

  // panels
  openPanel: (name) => ipcRenderer.invoke('panel:open', name),
  closePanel: () => ipcRenderer.invoke('panel:close'),

  // settings & info
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  clearSessions: () => ipcRenderer.invoke('session:clearAll'),

  // backup / restore
  exportBackup: (password) => ipcRenderer.invoke('backup:export', password),
  importBackup: (password) => ipcRenderer.invoke('backup:import', password),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  getLocale: (lang) => ipcRenderer.invoke('locale:get', lang),

  // layout & network
  reportLayout: (rect) => ipcRenderer.send('layout:rect', rect),
  reportOnline: (online) => ipcRenderer.send('net:report', online === true),
  onNetState: (cb) => ipcRenderer.on('net:state', (_e, s) => cb(s)),

  // lifecycle
  shellReady: () => ipcRenderer.send('shell:ready'),
});
