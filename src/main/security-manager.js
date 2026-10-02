'use strict';

/**
 * SecurityManager — Electron hardening:
 *   • strict permission allowlist per platform session (calls/notifications work,
 *     everything risky is denied)
 *   • controlled popups: only same-platform-domain windows open in-app; every
 *     other window.open / target=_blank goes to the system default browser
 *   • navigation restricted to http(s) — custom protocols are blocked
 *   • <webview> is never allowed, devtools are closed if ever opened
 */

const { app, session, shell: electronShell } = require('electron');

const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'audioCapture',      // voice/video calls
  'videoCapture',
  'fullscreen',
  'clipboard-sanitized-write',
]);

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/** session -> { partition, domains } for popup classification */
const sessionRegistry = new Map();

function hostAllowed(hostname, domains) {
  if (!Array.isArray(domains)) return false;
  return domains.some((d) => hostname === d || hostname.endsWith('.' + d));
}

/** Applies the permission allowlist to a platform partition and registers it. */
function registerPlatformSession(partition, domains) {
  const ses = session.fromPartition(partition);
  sessionRegistry.set(ses, { partition, domains: Array.isArray(domains) ? domains : [] });
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  return ses;
}

/** Attaches popup/navigation/devtools rules to a webContents. */
function hardenWebContents(wc, { partition = '', domains = [] } = {}) {
  wc.setWindowOpenHandler(({ url }) => {
    try {
      if (!isWebUrl(url)) return { action: 'deny' };
      const { hostname } = new URL(url);
      if (hostAllowed(hostname, domains)) {
        // same-platform popup (e.g. auth flows) — opened as a controlled window
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 980,
            height: 720,
            show: true,
            autoHideMenuBar: true,
            backgroundColor: '#0A0D14',
            webPreferences: {
              partition,                // same isolated session
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      // everything else → default system browser
      electronShell.openExternal(url);
      return { action: 'deny' };
    } catch (_e) {
      return { action: 'deny' };
    }
  });

  wc.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault(); // blocks tg://, file://, etc.
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

  // Popups spawned by platform pages inherit the same hardening rules.
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
