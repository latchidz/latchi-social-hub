'use strict';

/**
 * SecurityManager — Electron hardening:
 *   • PERMISSIONS: deny-by-default. Phase 1 has no verified need for any
 *     site permission, so the allowlist is EMPTY. When a platform feature
 *     genuinely requires one (camera/mic calls, notifications…), it must be
 *     an explicit product decision: add the exact permission key here and
 *     document it. Nothing is granted implicitly.
 *   • DOWNLOADS: http(s) only, sanitized filename, always saved into the OS
 *     Downloads folder with collision-safe naming — no arbitrary paths, no
 *     dialogs, nothing executed.
 *   • controlled popups: window.open / target=_blank to any KNOWN platform
 *     domain opens as a sandboxed in-app window in the opener's session
 *     (keeps cross-platform SSO login flows working); everything else goes
 *     to the system default browser.
 *   • navigation restricted to http(s) — file://, javascript:, custom
 *     protocols (tg://, intent://, …) are all blocked.
 *   • <webview> is never allowed, devtools are closed if ever opened.
 */

const fs = require('fs');
const path = require('path');
const { app, session, shell: electronShell } = require('electron');

/**
 * Empty by design — DENY unless explicitly required and safely handled.
 * Candidate keys for future, deliberate decisions only:
 *   'media' | 'audioCapture' | 'videoCapture' | 'notifications' | 'geolocation'
 *   'clipboard-sanitized-write' | 'fullscreen' | 'pointerLock' | …
 */
const ALLOWED_PERMISSIONS = new Set([]);

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/** session -> { partition, domains } for popup classification */
const sessionRegistry = new Map();

function hostAllowed(hostname, domains) {
  if (!Array.isArray(domains)) return false;
  return domains.some((d) => hostname === d || hostname.endsWith('.' + d));
}

/** Safe download target: Downloads folder + basename-only + collision-safe. */
function safeDownloadPath(filename) {
  const dir = app.getPath('downloads');
  // strip any path components and control characters the page may inject
  const raw = path.basename(String(filename || 'download')).replace(/[\x00-\x1f\x7f]/g, '_');
  const safe = (raw === '' || raw === '.' || raw === '..') ? 'download' : raw.slice(0, 200);
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  let target = path.join(dir, safe);
  for (let n = 1; fs.existsSync(target) && n < 1000; n += 1) {
    target = path.join(dir, `${base} (${n})${ext}`);
  }
  return target;
}

/** Applies the permission allowlist, download policy and popup rules to a
 *  platform partition, and registers it for popup classification. */
function registerPlatformSession(partition, domains) {
  const ses = session.fromPartition(partition);
  sessionRegistry.set(ses, { partition, domains: Array.isArray(domains) ? domains : [] });

  // DENY every permission request and check by default (see ALLOWED_PERMISSIONS).
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  // Download policy: no surprises, no dangerous schemes, no arbitrary paths.
  ses.on('will-download', (event, item) => {
    try {
      if (!isWebUrl(item.getURL())) { event.preventDefault(); return; } // e.g. file://, chrome-extension://
      item.setSavePath(safeDownloadPath(item.getFilename()));
    } catch (_e) {
      event.preventDefault(); // anything unexpected → cancel the download
    }
  });

  return ses;
}

/** Attaches popup/navigation/devtools rules to a webContents. */
function hardenWebContents(wc, { partition = '', domains = [] } = {}) {
  wc.setWindowOpenHandler(({ url }) => {
    try {
      if (!isWebUrl(url)) return { action: 'deny' }; // javascript:, tg://, file:// …
      const { hostname } = new URL(url);
      if (hostAllowed(hostname, domains)) {
        // known platform domain (incl. cross-platform SSO) — controlled popup
        // in the opener's isolated session, sandboxed, no preload, no Node.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 980,
            height: 720,
            show: true,
            autoHideMenuBar: true,
            backgroundColor: '#0A0D14',
            webPreferences: {
              partition,                // same isolated session as the opener
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      // everything else → default system browser (never in-app)
      electronShell.openExternal(url).catch(() => {}); // no-op if no handler (headless)
      return { action: 'deny' };
    } catch (_e) {
      return { action: 'deny' };
    }
  });

  wc.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault(); // blocks tg://, file://, javascript:, etc.
  });

  wc.on('will-attach-webview', (event) => event.preventDefault());

  wc.on('devtools-opened', () => { try { wc.closeDevTools(); } catch (_e) {} });
}

function setupSecurity() {
  // The shell + overlay use the default session and load local files only:
  // deny every permission and every window they might try to open.
  const def = session.defaultSession;
  def.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  def.setPermissionCheckHandler(() => false);

  // Popups spawned by platform pages inherit the same hardening rules;
  // anything from an unknown session can never open a window at all.
  app.on('web-contents-created', (_event, wc) => {
    try { if (wc.getType() !== 'window') return; } catch (_e) { return; }
    const info = sessionRegistry.get(wc.session);
    if (info) hardenWebContents(wc, info);
    else wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

module.exports = {
  ALLOWED_PERMISSIONS,
  setupSecurity,
  registerPlatformSession,
  hardenWebContents,
};
