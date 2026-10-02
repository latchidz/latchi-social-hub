# LATCHI SOCIAL HUB — Architecture (Phase 1)

## Overview

LATCHI SOCIAL HUB is an Electron desktop shell that hosts four social platforms
(Instagram, Facebook, Messenger, Telegram) inside one frameless window.
The app UI ("shell") is local HTML/CSS/JS; the platforms are real websites
embedded through modern Electron APIs with strict isolation.

```
┌────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node)                     │
│                                                            │
│  main.js ─── central IPC registry (all channels validated) │
│     │                                                      │
│     ├── WindowManager ── frameless BrowserWindow           │
│     │       └── contentView                                │
│     │             ├── [base]  shell renderer (app UI)      │
│     │             ├── WebContentsView: instagram           │
│     │             ├── WebContentsView: facebook            │
│     │             ├── WebContentsView: messenger           │
│     │             ├── WebContentsView: telegram            │
│     │             └── WebContentsView: overlay (topmost)   │
│     │                                                      │
│     ├── PlatformManager ── lazy views, partitions,         │
│     │       states, retry, timeouts, session clear         │
│     │                                                      │
│     ├── SecurityManager ── permissions, popups,            │
│     │       navigation guards, devtools lockdown           │
│     │                                                      │
│     ├── SettingsStore ── validated userData/settings.json  │
│     └── locales.js ── AR/EN strings (single source)        │
└────────────────────────────────────────────────────────────┘
         ▲ IPC (contextBridge, sandboxed preloads) ▲
┌────────┴───────────────────────┬─────────────────┴─────────┐
│   SHELL RENDERER (index.html)  │   OVERLAY VIEW (local)    │
│   title bar + window controls  │   loading / connecting /  │
│   sidebar + settings + i18n    │   error / offline / home  │
└────────────────────────────────┴───────────────────────────┘
```

## Key decisions

### 1. WebContentsView (not BrowserView, not webview)

* `BrowserView` is **deprecated** in current Electron — not used.
* `<webview>` is not recommended for new applications — not used.
* **WebContentsView** is the modern, stable API. Each platform is a
  `WebContentsView` added to the window's `contentView`, created **lazily on
  first activation** and kept alive afterwards for instant switching.

### 2. Session isolation

Every platform view is created with its own partition:

```
persist:instagram | persist:facebook | persist:messenger | persist:telegram
```

Cookies, localStorage, sessionStorage and cache are therefore fully isolated:
an Instagram login can never leak into Facebook. "Clear session data" wipes all
four partitions (`clearStorageData` + `clearCache`).

### 3. Overlay view for states (no white screens)

A single transparent-topmost `WebContentsView` renders every non-content state:
loading, connecting (slow hint), error, offline, timeout and home.
Because it sits **above** platform views, transitions are real CSS fades and a
white flash can never appear — the overlay is opaque and branded while a
platform is still loading. When idle it is hidden (`setVisible(false)`) so it
never intercepts clicks.

### 4. Bounds from the renderer (RTL/compact aware)

The shell reports the content-area rectangle (throttled `ResizeObserver` +
resize events). The main process applies it to every view and the overlay.
This keeps bounds correct in RTL and in compact-sidebar mode without
duplicating layout logic in the main process.

### 5. IPC surface

All channels are registered in one place (`main.js`) with input validation.
The renderer never receives `ipcRenderer`; preloads expose a minimal typed API
(`window.hub`, `window.hubOverlay`) via `contextBridge`. Platform views get
**no preload at all**.

### 6. Security model

* Shell + overlay: `contextIsolation`, `sandbox`, `nodeIntegration: false`,
  strict CSP (`default-src 'none'`), devtools closed, navigation denied.
* Platform sessions: **permissions are denied by default — the allowlist is
  empty by design.** Camera, microphone, notifications, geolocation,
  clipboard, media and screen capture are all denied until a specific
  product decision says otherwise (single, documented place to change:
  `ALLOWED_PERMISSIONS` in `security-manager.js`).
* `setWindowOpenHandler`: URLs on any known platform domain (union of all
  four platforms' domains — keeps cross-platform SSO login flows working)
  open as controlled popups in the **opener's** partition, sandboxed, no
  node, no preload; all other URLs go to the system browser via
  `shell.openExternal`.
* `will-navigate`: only `http(s)` allowed; `file://`, `javascript:` and
  custom protocols (`tg://`, …) are blocked.
* Downloads (`will-download` per platform session): non-`http(s)` sources are
  cancelled; filenames are sanitized to a basename (no path components, no
  control characters); the save path is forced into the OS Downloads folder
  with collision-safe `(n)` suffixes — a page can never pick an arbitrary
  path or overwrite an existing file.
* No passwords, tokens or credentials are stored by the app — authentication
  is fully delegated to the platforms' official pages.

### 7. Localization

`src/renderer/locales/{ar,en}.json` is the single source of truth. The main
process reads them (fs) and serves them over IPC; switching language updates
`document.dir` (`rtl`/`ltr`) and every UI string. All CSS uses logical
properties (`inset-inline-start`, `margin-inline-end`, …), so the entire
layout — sidebar side, modal alignment, window-control position — flips
correctly between Arabic and English.

### 8. Performance

* Platforms are lazy-loaded on first activation only.
* Loaded views are kept for instant, reload-free switching (verified by the
  smoke harness: switching back does not trigger a new navigation).
* Timers are cleaned up per view (`slowTimer`, `timeoutTimer` and the
  post-load `settleTimer` are all cleared together); all views are destroyed
  on window close, and `clearAllSessions` destroys every view before wiping
  the partitions.
* The app never starts background work beyond the UI.

## State machine (per platform)

```
(creating) → LOADING ──ready──→ READY
                │
                ├─ slow (>18s) → CONNECTING (overlay hint)
                ├─ timeout (>45s) → ERROR
                ├─ load failed ──→ ERROR (or OFFLINE when net.isOnline() is false)
                └─ renderer gone → ERROR
ERROR/OFFLINE ──retry──→ LOADING
OFFLINE ──connection back──→ LOADING (auto-resume)
```

App-level states: STARTING (before shell ready) → READY, plus a global
OFFLINE indicator in the title bar driven by `navigator.onLine` events.
