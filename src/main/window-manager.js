'use strict';

/**
 * WindowManager — owns the frameless main window.
 * No native frame, no menu bar, no devtools: the renderer draws the custom
 * title bar and window controls; this class only exposes safe actions.
 */

const path = require('path');
const { BrowserWindow } = require('electron');

class WindowManager {
  constructor({ settings }) {
    this.settings = settings;
    this.win = null;
    this.pm = null;
    this._shellReady = false;
    this._resolveShell = null;
  }

  setPlatformManager(pm) { this.pm = pm; }

  createMainWindow() {
    this.win = new BrowserWindow({
      width: 1280,
      height: 760,
      minWidth: 1000,
      minHeight: 620,
      frame: false,                 // custom title bar (renderer)
      show: false,                  // shown on ready-to-show: no white flash
      backgroundColor: '#0A0D14',   // dark from the very first paint
      title: 'LATCHI SOCIAL HUB',
      icon: path.join(__dirname, '..', '..', 'assets', 'app-icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'shell-preload.js'),
        contextIsolation: true,     // shell: isolated world
        nodeIntegration: false,     // no Node in the renderer
        sandbox: true,              // OS-level sandboxing
        spellcheck: false,
      },
    });

    const wc = this.win.webContents;

    // The shell is local-only: never navigate, never spawn windows.
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('devtools-opened', () => { try { wc.closeDevTools(); } catch (_e) {} });

    this.win.once('ready-to-show', () => { this.win.show(); this._pushState(); });
    this.win.on('maximize', () => this._pushState());
    this.win.on('unmaximize', () => this._pushState());
    this.win.on('focus', () => this._pushState());
    this.win.on('blur', () => this._pushState());
    this.win.on('closed', () => {
      this.win = null;
      if (this.pm) this.pm.destroy();
    });

    // platform views + overlay attach to this window's contentView
    this.pm.attachToWindow(this.win);
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'shell', 'index.html'));
    return this.win;
  }

  control(action) {
    if (!this.win) return;
    if (action === 'minimize') this.win.minimize();
    else if (action === 'maximize') {
      if (this.win.isMaximized()) this.win.unmaximize();
      else this.win.maximize();
    } else if (action === 'restore') {
      // standard Windows restore semantics: raise from minimized,
      // or return from maximized to the previous normal size
      if (this.win.isMinimized()) this.win.restore();
      else if (this.win.isMaximized()) this.win.unmaximize();
    } else if (action === 'close') this.win.close();
  }

  onShellReady() {
    this._shellReady = true;
    if (this._resolveShell) this._resolveShell();
    this._pushState();
  }

  /** Resolves true when the shell finished booting; false on timeout. */
  waitForShell(timeoutMs = 15000) {
    return new Promise((resolve) => {
      if (this._shellReady) return resolve(true);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this._resolveShell = () => { clearTimeout(timer); resolve(true); };
    });
  }

  _pushState() {
    if (!this.win) return;
    this.send('window:state', {
      maximized: this.win.isMaximized(),
      focused: this.win.isFocused(),
    });
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}

module.exports = WindowManager;
