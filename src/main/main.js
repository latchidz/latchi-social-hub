'use strict';

/**
 * LATCHI SOCIAL HUB — main process entry.
 *
 * Layering:
 *   main.js            app lifecycle + central IPC registry (single auditable place)
 *   window-manager.js  frameless main window + custom window controls
 *   platform-manager   lazy WebContentsView per platform + session isolation + overlay
 *   security-manager   permissions, popups, navigation, devtools lockdown
 *   settings-store.js  validated persistence in userData
 *   locales.js         AR/EN strings shared by shell and overlay
 */

const { app, ipcMain, Menu } = require('electron');
const WindowManager = require('./window-manager');
const PlatformManager = require('./platform-manager');
const SettingsStore = require('./settings-store');
const { getLocale } = require('./locales');
const { setupSecurity } = require('./security-manager');
const backup = require('./backup-manager');

const SMOKE = !app.isPackaged && process.argv.includes('--smoke');

Menu.setApplicationMenu(null); // no default menu bar for the user

// ── GPU / media performance switches (owner-approved Phase-1 expansion) ──────
// Heavy feeds (Instagram reels, YouTube) benefit from hardware video decode
// and GPU rasterization; these are rendering flags only — no security impact.
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

if (SMOKE) {
  // Dev harness ONLY: never active in packaged builds (app.isPackaged gate),
  // even if --smoke is somehow passed to the production executable.
  // Isolated, wiped userData per smoke run → deterministic boot state
  // (fresh settings → home overlay at boot, no cached platform sessions).
  const fs = require('fs');
  const SMOKE_DATA_DIR = '/tmp/lsh-smoke-userdata';
  try { fs.rmSync(SMOKE_DATA_DIR, { recursive: true, force: true }); } catch (_e) {}
  app.setPath('userData', SMOKE_DATA_DIR);
}

let wm = null;
let pm = null;
let settings = null;

// ── single instance ──────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (wm && wm.win) {
      if (wm.win.isMinimized()) wm.win.restore();
      wm.win.focus();
    }
  });

  app.whenReady().then(() => {
    settings = new SettingsStore(app.getPath('userData'));
    setupSecurity();

    wm = new WindowManager({ settings });
    pm = new PlatformManager({ windowManager: wm, settings });
    wm.setPlatformManager(pm);
    wm.createMainWindow();
    registerIpc();

    if (SMOKE) {
      const { runSmoke } = require('./smoke'); // lazy: dev/CI harness only
      runSmoke({ wm, pm, settings });
    }
  });

  app.on('window-all-closed', () => {
    // This is a Windows-first desktop app: quit when the window closes.
    app.quit();
  });

  app.on('web-contents-created', (_event, wc) => {
    // 'crashed' was removed in Electron 29 — 'render-process-gone' is the API.
    wc.on('render-process-gone', (_e, details) => {
      console.error('[main] renderer gone:', wc.id, details && details.reason);
    });
  });

  process.on('uncaughtException', (err) => {
    console.error('[main] uncaughtException:', err);
  });
}

// ── central IPC registry ─────────────────────────────────────────────────────
// Every channel is validated here; the renderer never talks to managers directly.
function registerIpc() {
  const PLATFORM_IDS = pm.platforms.map((p) => p.id);
  const isStr = (v) => typeof v === 'string';

  // window
  ipcMain.handle('window:control', (_e, action) => {
    if (!['minimize', 'maximize', 'restore', 'close'].includes(action)) throw new Error('ipc: invalid window action');
    wm.control(action);
    return { ok: true };
  });

  // platforms
  ipcMain.handle('platforms:list', () => pm.platforms.map((p) => ({ id: p.id, name: p.name })));
  ipcMain.handle('backgrounds:list', () => pm.availableBackgrounds().map((id) => ({ id })));
  ipcMain.handle('platform:select', (_e, id) => {
    if (!PLATFORM_IDS.includes(id)) throw new Error('ipc: invalid platform id');
    return pm.selectPlatform(id);
  });
  ipcMain.handle('platform:retry', (_e, id) => {
    if (!PLATFORM_IDS.includes(id)) throw new Error('ipc: invalid platform id');
    return pm.retryPlatform(id);
  });

  // panels (settings / language) — they cover the content area
  ipcMain.handle('panel:open', (_e, name) => {
    if (!['settings', 'language'].includes(name)) throw new Error('ipc: invalid panel');
    pm.openPanel(name);
    return { ok: true };
  });
  ipcMain.handle('panel:close', () => {
    pm.closePanel();
    return { ok: true };
  });

  // settings + info
  ipcMain.handle('settings:get', () => settings.getAll());
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('ipc: invalid settings patch');
    const out = settings.set(patch);
    if (patch.language !== undefined) pm.onLanguageChanged();
    if (patch.homeBackground !== undefined) pm.onHomeBackgroundChanged();
    if (patch.backgroundSlideshow !== undefined) pm.onHomeBackgroundChanged();
    return out;
  });
  ipcMain.handle('session:clearAll', () => pm.clearAllSessions());

  // backup / restore (encrypted, password-gated; password never persisted)
  const backupCtx = () => ({
    settings,
    platformIds: pm.platforms.map((p) => p.id),
    partitionNames: [...new Set(pm.platforms.map((p) => p.partition))],
  });
  const validPassword = (v) => typeof v === 'string' && v.length >= 4 && v.length <= 256;
  ipcMain.handle('backup:export', (_e, password) => {
    if (!validPassword(password)) return { ok: false, error: 'weak-password' };
    return backup.exportWithDialog(wm.win, password, backupCtx());
  });
  ipcMain.handle('backup:import', (_e, password) => {
    if (!validPassword(password)) return { ok: false, error: 'weak-password' };
    return backup.importWithDialog(wm.win, password);
  });
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
  ipcMain.handle('app:info', () => ({
    name: 'LATCHI SOCIAL HUB',
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    copyright: '© 2026 LATCHI',
  }));
  ipcMain.handle('locale:get', (_e, lang) => getLocale(isStr(lang) && ['ar', 'en'].includes(lang) ? lang : 'ar'));

  // layout (content-area rectangle, reported by the shell — handles RTL/compact)
  ipcMain.on('layout:rect', (_e, rect) => pm.updateContentRect(rect));

  // network state (navigator.onLine events from the shell)
  ipcMain.on('net:report', (_e, online) => pm.onNetworkState(online === true));

  // shell lifecycle
  ipcMain.on('shell:ready', () => {
    wm.onShellReady();
    pm.onShellReady();
  });

  // overlay
  ipcMain.on('overlay:ready', () => pm.onOverlayReady());
  ipcMain.handle('overlay:retry', () => {
    if (pm.activeId) pm.retryPlatform(pm.activeId);
    return { ok: true };
  });
}
