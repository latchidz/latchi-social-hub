# LATCHI SOCIAL HUB

A unified Windows desktop application that brings **Instagram, Facebook, Messenger and Telegram** together inside one premium, fast and lightweight desktop shell — not a browser with four tabs.

> **Status: Phase 1 — Foundation.** Packaging / installer generation is intentionally **not configured yet** and will be added in a later phase.

---

## Features

- **One app, four platforms** — Instagram, Facebook, Messenger and Telegram side by side in a single frameless window.
- **Real session isolation** — every platform runs in its own `persist:` session partition: cookies, local storage, session storage and cache never mix. Logging into Instagram does not touch Facebook.
- **Keep-alive sessions** — switching platforms is instant; an already-loaded platform is never reloaded, and login sessions persist across restarts.
- **Premium desktop shell** — custom title bar and window controls (SVG icons), custom sidebar with per-platform brand accents, smooth short animations, fully responsive layout (compact sidebar on small windows).
- **Never a white screen** — per-platform branded loading screens, connecting states, offline and error states with a Retry action, and a load timeout.
- **One platform failing never crashes the app** — errors are isolated per platform.
- **Arabic & English** — full localization with a real RTL/LTR flip (sidebar position, layout direction, alignment) and persisted language choice.
- **Settings** — language, startup platform, clear session data (with confirmation) and app information.
- **External links open in the system default browser** — popups and `target="_blank"` are intercepted and handled explicitly.

## Tech Stack

- **Electron** (main + renderer + preload, sandboxed and context-isolated)
- **JavaScript** (no build step required for Phase 1)
- **HTML / CSS** (logical properties for full RTL/LTR support)
- **Node.js** (main process services only)

## Architecture

```
src/
├── main/
│   ├── main.js              app entry + central IPC registry (validated)
│   ├── window-manager.js    frameless main window, custom controls
│   ├── platform-manager.js  lazy WebContentsView per platform + overlay
│   ├── security-manager.js  permissions, popups, navigation, devtools
│   ├── settings-store.js    validated userData/settings.json persistence
│   ├── locales.js           AR/EN strings service (shared source)
│   └── smoke.js             headless smoke harness (dev only)
├── preload/
│   ├── shell-preload.js     minimal contextBridge API for the shell
│   └── overlay-preload.js   minimal bridge for the state overlay
└── renderer/
    ├── shell/               app chrome: title bar, sidebar, settings
    ├── overlay/             loading / connecting / error / offline / home
    └── locales/             ar.json + en.json
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design notes.

### Why WebContentsView?

`WebContentsView` is the modern, officially stable Electron API for embedding web content (BrowserView is deprecated in current Electron releases; the `<webview>` tag is not recommended). Each platform is a lazily-created `WebContentsView` with its own session partition, and one shared overlay view renders all state screens on top.

## Supported Platforms

| Platform | URL | Session partition |
|---|---|---|
| Instagram | `https://www.instagram.com/` | `persist:instagram` |
| Facebook | `https://www.facebook.com/` | `persist:facebook` |
| Messenger | `https://www.messenger.com/` | `persist:messenger` |
| Telegram | `https://web.telegram.org/` | `persist:telegram` |

## Languages

- العربية (full RTL layout)
- English (full LTR layout)

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` everywhere.
- Platform pages run **without any preload** — they never receive app APIs.
- The preload bridge exposes only a small, typed surface; every IPC channel is validated in the main process.
- Strict permission allowlist per platform session (calls/notifications allowed; risky permissions denied).
- Popups: only same-platform-domain windows open in-app; everything else goes to the default system browser.
- Navigation restricted to `http(s)` — custom protocols are blocked.
- DevTools are closed if ever opened; the default menu bar is removed.
- Strict CSP for all local pages (`default-src 'none'`).

## Development

```bash
npm install     # install dependencies (Electron)
npm start       # run the app in development mode
npm run smoke   # headless smoke test: boot → platform load → switching (screenshots in /tmp/lsh-smoke)
```

No credentials, session data or tokens are stored in this repository. Login sessions live in the app's own `userData` partitions on the user's machine.

## Build

Packaging is **out of scope for Phase 1** by decision. A build/packaging pipeline (installer, auto-update, code signing) will be introduced in a later phase.
