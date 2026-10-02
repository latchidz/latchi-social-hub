'use strict';

/**
 * Smoke harness (dev only — NOT packaging).
 * `npm run smoke` launches the real app headlessly, exercises the core flow
 * (boot → home overlay → platform load → switch without reload) and captures
 * screenshots to /tmp/lsh-smoke for verification. Exit code 0 = healthy.
 *
 * NOTE: Electron suspends hidden renderers — we never await
 * executeJavaScript/capturePage on a hidden view (it would hang).
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const OUT = '/tmp/lsh-smoke';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => 'TIMEOUT')]);

async function waitFor(fn, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

async function capturePage(wc, name) {
  try {
    const img = await withTimeout(wc.capturePage(), 4000);
    if (img && img !== 'TIMEOUT' && typeof img.toPNG === 'function') {
      fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
      return true;
    }
  } catch (_e) {}
  return false;
}

async function runSmoke({ wm, pm }) {
  const results = {
    window: false,
    shell: false,
    platformStates: {},
    switchBackNoReload: null,
    screenshots: [],
    consoleErrors: [],
    overlayChecks: {},
    urls: {},
  };

  fs.mkdirSync(OUT, { recursive: true });

  const win = wm.win;
  results.window = !!win;

  try {
    win.webContents.on('console-message', (_e, level, message) => {
      if (String(level) === '3' || /error/i.test(String(message))) {
        results.consoleErrors.push(String(message).slice(0, 300));
      }
    });
  } catch (_e) {}

  // Overlay state read from the MAIN process (always safe — no renderer round-trip).
  const overlayMainState = () => ({
    shown: pm._overlayShown,
    type: pm._overlayPayload ? pm._overlayPayload.type : null,
    platform: pm._overlayPayload ? pm._overlayPayload.platformId : null,
  });
  // DOM check only while the overlay is shown (renderer awake).
  const overlayDomState = async () => {
    if (!pm._overlayShown) return { hidden: true };
    try {
      const v = await withTimeout(pm.overlay.webContents.executeJavaScript(
        "JSON.stringify({v:document.getElementById('overlay').classList.contains('visible'),t:document.body.dataset.type,p:document.body.dataset.platform})"
      ), 4000);
      return (typeof v === 'string' && v !== 'TIMEOUT') ? JSON.parse(v) : { timeout: true };
    } catch (e) { return { err: String(e && e.message) }; }
  };

  results.shell = await wm.waitForShell(15000);
  await sleep(800); // let the home overlay paint

  // 0) Home state
  results.overlayChecks.home = { main: overlayMainState(), dom: await overlayDomState() };
  await capturePage(pm.overlay.webContents, '0-overlay-home');
  results.screenshots.push(await capturePage(win.webContents, '0-shell-home'));

  // 1) Telegram — first lazy load
  pm.selectPlatform('telegram');
  await sleep(1500);
  results.overlayChecks.duringLoad = { main: overlayMainState(), dom: await overlayDomState() };
  await capturePage(pm.overlay.webContents, '1-overlay-loading');

  let snap = await waitFor(() => {
    const s = pm.getSnapshot();
    const tg = s.platforms.find((p) => p.id === 'telegram');
    return (tg && tg.state === 'ready') ? s : null;
  }, 50000);
  results.platformStates.telegram = snap
    ? snap.platforms.find((p) => p.id === 'telegram').state
    : 'timeout';

  await sleep(6000); // give the SPA time to render in the headless environment
  results.overlayChecks.afterReady = { main: overlayMainState(), dom: await overlayDomState() };

  const tgRec = pm.views.get('telegram');
  if (tgRec) {
    try { results.urls.telegram = tgRec.view.webContents.getURL(); } catch (_e) {}
    results.screenshots.push(await capturePage(tgRec.view.webContents, '1-telegram-view'));
  }
  results.screenshots.push(await capturePage(win.webContents, '1-telegram-window'));

  // 2) Instagram — second platform (ready or failed are both valid outcomes)
  pm.selectPlatform('instagram');
  snap = await waitFor(() => {
    const s = pm.getSnapshot();
    const ig = s.platforms.find((p) => p.id === 'instagram');
    return (ig && ig.state !== 'loading') ? s : null;
  }, 35000);
  results.platformStates.instagram = snap
    ? snap.platforms.find((p) => p.id === 'instagram').state
    : 'timeout';

  await sleep(3500);
  const igRec = pm.views.get('instagram');
  if (igRec) {
    try { results.urls.instagram = igRec.view.webContents.getURL(); } catch (_e) {}
    results.screenshots.push(await capturePage(igRec.view.webContents, '2-instagram-view'));
  }
  results.screenshots.push(await capturePage(win.webContents, '2-instagram-window'));

  // 3) Back to Telegram — must NOT reload (session preserved)
  const navBefore = tgRec ? tgRec.navigations : -1;
  const stateBefore = tgRec ? tgRec.state : null;
  pm.selectPlatform('telegram');
  await sleep(1200);
  const tgAfter = pm.views.get('telegram');
  if (tgRec && tgAfter) {
    results.switchBackNoReload =
      tgAfter.navigations === navBefore && tgAfter.state === stateBefore;
  }
  results.overlayChecks.afterSwitchBack = { main: overlayMainState(), dom: await overlayDomState() };
  if (tgAfter) results.screenshots.push(await capturePage(tgAfter.view.webContents, '3-telegram-back-view'));
  results.screenshots.push(await capturePage(win.webContents, '3-back-to-telegram-window'));

  // 4) Home again (platform views hidden, overlay home state)
  pm.showHome();
  await sleep(800);
  results.overlayChecks.homeAgain = { main: overlayMainState(), dom: await overlayDomState() };
  results.screenshots.push(await capturePage(win.webContents, '4-home-window'));

  results.consoleErrors = results.consoleErrors.slice(0, 20);

  console.log('===SMOKE===' + JSON.stringify(results));

  const ok = results.window && results.shell && results.platformStates.telegram === 'ready';
  app.exit(ok ? 0 : 1);
}

module.exports = { runSmoke };
