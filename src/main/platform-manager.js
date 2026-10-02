'use strict';

/**
 * PlatformManager — the content engine.
 *
 *  • Each platform is a lazily-created WebContentsView (modern, stable Electron
 *    API — BrowserView is deprecated; <webview> is not used).
 *  • Every platform gets its own `persist:<id>` session partition, so cookies,
 *    localStorage, sessionStorage and cache never mix between platforms.
 *  • One shared overlay view (topmost) renders Loading / Connecting / Error /
 *    Offline / Home states so a white screen can never appear.
 *  • A failure in one platform never affects the others: each view is isolated
 *    and errors are mapped to a per-platform Retry state.
 */

const path = require('path');
const { WebContentsView, session, net } = require('electron');
const { getLocale } = require('./locales');
const { registerPlatformSession, hardenWebContents } = require('./security-manager');

const PLATFORMS = [
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/',
    partition: 'persist:instagram',
    domains: ['instagram.com', 'cdninstagram.com', 'ig.me', 'instagr.am'],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    url: 'https://www.facebook.com/',
    partition: 'persist:facebook',
    domains: ['facebook.com', 'fb.com', 'fbcdn.net', 'fb.me'],
  },
  {
    id: 'messenger',
    name: 'Messenger',
    url: 'https://www.messenger.com/',
    partition: 'persist:messenger',
    domains: ['messenger.com', 'facebook.com', 'fb.com', 'fbcdn.net', 'm.me'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/',
    partition: 'persist:telegram',
    domains: ['telegram.org', 't.me', 'telegram.me', 'telesco.pe'],
  },
];

const SLOW_HINT_MS = 18000;   // switch overlay copy to "still connecting…"
const LOAD_TIMEOUT_MS = 45000; // give up → error + retry
const OVERLAY_FADE_MS = 280;

/**
 * Popup universe: union of ALL platform domains. A window.open from any
 * platform to any other known platform domain (e.g. Instagram "Login with
 * Facebook" SSO) opens as a controlled in-app popup in the OPENER's session;
 * every other target goes to the system browser. This keeps cross-platform
 * OAuth/login flows working without ever allowing arbitrary windows.
 */
const POPUP_DOMAINS = [...new Set(PLATFORMS.flatMap((p) => p.domains))];

class PlatformManager {
  constructor({ windowManager, settings }) {
    this.wm = windowManager;
    this.settings = settings;
    this.win = null;
    this.overlay = null;
    this.overlayReadyPromise = null;
    this._overlayResolve = null;
    this._overlayShown = false;
    this._overlayPayload = null;
    this._overlayHideTimer = null;
    this.views = new Map(); // id -> { view, state, everReady, slowTimer, timeoutTimer, settleTimer, navigations }
    this.activeId = null;
    this.panelName = null;
    this.contentRect = { x: 0, y: 0, width: 0, height: 0 };
    this.online = true;
    this._started = false;
  }

  get platforms() { return PLATFORMS; }

  platformById(id) { return PLATFORMS.find((p) => p.id === id) || null; }

  /* ── window attachment ─────────────────────────────────────────────────── */

  attachToWindow(win) {
    this.win = win;
    this.overlayReadyPromise = new Promise((resolve) => { this._overlayResolve = resolve; });

    this.overlay = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.overlay.setBackgroundColor('#00000000');
    this.overlay.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
    this.win.contentView.addChildView(this.overlay);
    this._applyBounds(this.overlay);
  }

  onOverlayReady() {
    if (this._overlayResolve) this._overlayResolve();
  }

  /* ── shell lifecycle ───────────────────────────────────────────────────── */

  onShellReady() {
    if (this._started) return;
    this._started = true;
    const startup = this.settings.get('startupPlatform');
    const last = this.settings.get('lastPlatform');
    let target = null;
    if (startup === 'last') target = last;
    else if (startup && startup !== 'home') target = startup;
    if (target && this.platformById(target)) this.selectPlatform(target);
    else this.showHome();
  }

  onLanguageChanged() {
    // refresh the overlay copy if it is currently visible
    if (this._overlayShown && this._overlayPayload) {
      this._renderOverlay(this._overlayPayload.type, this._overlayPayload.platformId);
    }
  }

  /* ── selection ─────────────────────────────────────────────────────────── */

  selectPlatform(id) {
    const p = this.platformById(id);
    if (!p || !this.win) return { ok: false };
    if (this.panelName) this.closePanel();

    this.activeId = id;
    try { this.settings.set({ lastPlatform: id }); } catch (_e) {}

    for (const [pid, rec] of this.views) {
      if (pid !== id) rec.view.setVisible(false);
    }

    let rec = this.views.get(id);
    if (!rec) {
      rec = this._createView(p);
      this.views.set(id, rec);
      this._beginLoad(rec, p); // hides the view; overlay covers the whole load
    } else if (rec.state === 'ready') {
      // NOTE: views are never re-inserted into the view tree (no remove+add):
      // in Electron 44 re-inserting a visible WebContentsView leaves its
      // renderer stuck at visibilityState 'hidden' (verified experimentally),
      // which freezes visibility-aware SPAs like Telegram Web. Exactly one
      // view is visible at a time, so z-order never needs adjusting.
      rec.view.setVisible(true);
      this._renderOverlay(null); // instant switch — no loading screen
    } else if (rec.state === 'loading') {
      rec.view.setVisible(false);
      this._renderOverlay('loading', id);
    } else { // error / offline — view hidden, branded state screen
      rec.view.setVisible(false);
      this._renderOverlay(rec.state, id);
    }

    this.wm.send('platform:active', { id });
    this._emitState(id);
    return { ok: true };
  }

  retryPlatform(id) {
    const p = this.platformById(id);
    if (!p || !this.win) return { ok: false };
    const rec = this.views.get(id);
    if (!rec) return this.selectPlatform(id);
    this.activeId = id;
    if (this.panelName) this.panelName = null;
    this._beginLoad(rec, p); // hides the view; overlay shows loading/retry state
    this.wm.send('platform:active', { id });
    this._emitState(id);
    return { ok: true };
  }

  showHome() {
    this.activeId = null;
    for (const [, rec] of this.views) rec.view.setVisible(false);
    this._renderOverlay('home');
    this.wm.send('platform:active', { id: null });
  }

  /* ── panels (settings / language cover the content area) ───────────────── */

  openPanel(name) {
    this.panelName = name;
    for (const [, rec] of this.views) rec.view.setVisible(false);
    // panels own the content area: the overlay is fully hidden, so its state
    // flags must reflect that (otherwise a language change while a platform is
    // still loading would re-show the overlay on top of the panel).
    this._overlayShown = false;
    this._overlayPayload = null;
    this._setOverlayVisible(false, true);
  }

  closePanel() {
    if (!this.panelName) return;
    this.panelName = null;
    if (this.activeId) this.selectPlatform(this.activeId);
    else this.showHome();
  }

  /* ── view lifecycle ────────────────────────────────────────────────────── */

  _createView(p) {
    registerPlatformSession(p.partition, POPUP_DOMAINS);

    const view = new WebContentsView({
      webPreferences: {
        partition: p.partition,   // isolated cookies/storage/cache per platform
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // no preload: platform pages must never receive app APIs
      },
    });
    view.setBackgroundColor('#0A0D14'); // dark, never white

    const wc = view.webContents;
    hardenWebContents(wc, { partition: p.partition, domains: POPUP_DOMAINS });

    const rec = {
      id: p.id,
      view,
      state: 'loading',
      everReady: false,
      slowTimer: null,
      timeoutTimer: null,
      navigations: 0,
    };

    wc.on('did-start-loading', () => { rec.navigations += 1; });
    wc.on('did-finish-load', () => this._markReady(rec, p));
    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      // ERR_ABORTED (-3) fires on redirect chains / superseded navigations — not a real failure
      if (isMainFrame && code !== -3) this._markFailed(rec, p, code, desc);
    });
    wc.on('did-fail-provisional-load', (_e, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this._markFailed(rec, p, code, desc);
    });
    wc.on('render-process-gone', (_e, details) => {
      this._markFailed(rec, p, -1, `render-process-gone (${details && details.reason})`);
    });

    this.win.contentView.addChildView(view);
    this._applyBounds(view);
    return rec; // hidden until ready — the overlay owns the content area meanwhile
  }

  _beginLoad(rec, p) {
    this._clearTimers(rec);
    rec.state = 'loading';
    rec.view.setVisible(false); // the loading overlay owns the content area
    this._renderOverlay('loading', p.id);

    rec.slowTimer = setTimeout(() => {
      if (rec.state === 'loading' && this.activeId === p.id) {
        this._renderOverlay('connecting', p.id);
      }
    }, SLOW_HINT_MS);

    rec.timeoutTimer = setTimeout(() => {
      if (rec.state === 'loading') this._markFailed(rec, p, -2, 'load-timeout');
    }, LOAD_TIMEOUT_MS);

    Promise.resolve(rec.view.webContents.loadURL(p.url)).catch((err) => {
      // ERR_ABORTED fires on redirect chains / cache revalidations — the
      // navigation is superseded, not failed; did-finish-load still arrives.
      const msg = String((err && err.message) || err);
      if (rec.state === 'loading' && !/ERR_ABORTED/i.test(msg)) {
        this._markFailed(rec, p, -3, msg);
      }
    });
  }

  _markReady(rec, p) {
    this._clearTimers(rec);
    // short settle: let the platform actually paint before revealing it,
    // so a still-blank SPA shell is never shown (no white flash)
    rec.settleTimer = setTimeout(() => {
      rec.settleTimer = null;
      rec.state = 'ready';
      rec.everReady = true;
      if (this.activeId === p.id && !this.panelName) {
        rec.view.setVisible(true);
        this._renderOverlay(null); // fade out → platform content
      }
      this._emitState(p.id);
    }, 600);
  }

  _markFailed(rec, p, code, desc) {
    this._clearTimers(rec);
    const offline = !net.isOnline();
    rec.state = offline ? 'offline' : 'error';
    rec.lastError = { code, desc: String(desc) };
    if (this.activeId === p.id && !this.panelName) {
      rec.view.setVisible(false);
      this._renderOverlay(rec.state, p.id);
    }
    console.warn(`[platform] ${p.id} failed (${code}): ${desc}`);
    this._emitState(p.id);
  }

  _clearTimers(rec) {
    if (rec.slowTimer) { clearTimeout(rec.slowTimer); rec.slowTimer = null; }
    if (rec.timeoutTimer) { clearTimeout(rec.timeoutTimer); rec.timeoutTimer = null; }
    if (rec.settleTimer) { clearTimeout(rec.settleTimer); rec.settleTimer = null; }
  }

  _applyBounds(view) {
    const r = this.contentRect;
    if (r.width > 10 && r.height > 10) {
      try { view.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height }); } catch (_e) {}
    }
  }

  /** Content-area rectangle, reported by the shell (RTL/compact aware). */
  updateContentRect(rect) {
    if (!rect || typeof rect !== 'object') return;
    const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.round(v) : null;
    const x = num(rect.x), y = num(rect.y), w = num(rect.width), h = num(rect.height);
    if (x === null || y === null || w === null || h === null || w < 10 || h < 10) return;
    this.contentRect = { x, y, width: w, height: h };
    this._applyBounds(this.overlay);
    for (const [, rec] of this.views) this._applyBounds(rec.view);
  }

  /* ── overlay ───────────────────────────────────────────────────────────── */

  async _renderOverlay(type, platformId) {
    if (!this.overlay) return;
    if (!type) {
      this._overlayShown = false;
      this._overlayPayload = null;
      this._setOverlayVisible(false);
      return;
    }
    await this.overlayReadyPromise; // local page loaded

    const lang = this.settings.get('language') === 'en' ? 'en' : 'ar';
    const s = getLocale(lang);
    const payload = {
      type,
      platformId: platformId || null,
      strings: {
        loading: s['overlay.loading'],
        connecting: s['overlay.connecting'],
        errorTitle: s['overlay.errorTitle'],
        errorSub: s['overlay.errorSub'],
        offlineTitle: s['overlay.offlineTitle'],
        offlineSub: s['overlay.offlineSub'],
        timeoutTitle: s['overlay.timeoutTitle'],
        retry: s['overlay.retry'],
        homeTitle: s['home.title'],
        homeHint: s['home.hint'],
      },
    };

    this._overlayShown = true;
    this._overlayPayload = payload;
    this._setOverlayVisible(true);
    try { this.overlay.webContents.send('overlay:show', payload); } catch (_e) {}
  }

  _setOverlayVisible(visible, immediate = false) {
    if (!this.overlay) return;
    if (visible) {
      // The overlay is opaque: it always owns the content area. Hide the
      // active platform view beneath it — this also guarantees the overlay is
      // never occluded (an occluded overlay renderer gets no animation frames,
      // so its fade-in would never run).
      const rec = this.activeId ? this.views.get(this.activeId) : null;
      if (rec) { try { rec.view.setVisible(false); } catch (_e) {} }
      try { this.overlay.setVisible(true); } catch (_e) {}
      return;
    }
    try { this.overlay.webContents.send('overlay:hide'); } catch (_e) {}
    clearTimeout(this._overlayHideTimer);
    if (immediate) {
      try { this.overlay.setVisible(false); } catch (_e) {}
      return;
    }
    // let the DOM fade out, then hide the view so it stops taking clicks
    this._overlayHideTimer = setTimeout(() => {
      if (!this._overlayShown) {
        try { this.overlay.setVisible(false); } catch (_e) {}
      }
    }, OVERLAY_FADE_MS + 80);
  }

  /* ── network ───────────────────────────────────────────────────────────── */

  onNetworkState(online) {
    const was = this.online;
    this.online = online === true;
    this.wm.send('net:state', { online: this.online });

    if (this.online && !was) {
      // connection is back: auto-resume the active platform if it failed
      const rec = this.views.get(this.activeId);
      if (rec && (rec.state === 'offline' || rec.state === 'error')) {
        this.retryPlatform(this.activeId);
      }
    }
    if (!this.online) {
      const rec = this.views.get(this.activeId);
      if (rec && rec.state === 'loading') this._renderOverlay('offline', this.activeId);
    }
  }

  /* ── sessions ──────────────────────────────────────────────────────────── */

  async clearAllSessions() {
    for (const [, rec] of this.views) this._destroyRecord(rec);
    this.views.clear();
    this.activeId = null;
    await Promise.all(PLATFORMS.map(async (p) => {
      const ses = session.fromPartition(p.partition);
      await ses.clearStorageData();
      await ses.clearCache();
    }));
    this.showHome();
    return { ok: true };
  }

  _destroyRecord(rec) {
    this._clearTimers(rec);
    try { this.win.contentView.removeChildView(rec.view); } catch (_e) {}
    try { rec.view.webContents.close(); } catch (_e) {}
  }

  destroy() {
    for (const [, rec] of this.views) this._destroyRecord(rec);
    this.views.clear();
    if (this.overlay) {
      try { this.win && this.win.contentView.removeChildView(this.overlay); } catch (_e) {}
      try { this.overlay.webContents.close(); } catch (_e) {}
      this.overlay = null;
    }
  }

  /* ── state reporting ───────────────────────────────────────────────────── */

  _emitState(id) {
    const rec = this.views.get(id);
    this.wm.send('platform:state', {
      id,
      state: rec ? rec.state : 'unknown',
      active: id === this.activeId,
    });
  }

  /** Snapshot used by the smoke harness (dev only). */
  getSnapshot() {
    return {
      activeId: this.activeId,
      platforms: [...this.views.entries()].map(([id, r]) => ({
        id, state: r.state, everReady: r.everReady, navigations: r.navigations,
      })),
    };
  }
}

module.exports = PlatformManager;
module.exports.PLATFORMS = PLATFORMS;
