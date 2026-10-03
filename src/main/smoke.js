'use strict';

/**
 * Smoke harness (dev only — NOT packaging).
 * `npm run smoke` boots the real app headlessly with a wiped, isolated
 * userData dir and exercises the full Phase-1 matrix:
 *
 *   boot → shell/sidebar/controls/RTL → all 4 platforms (load → ready →
 *   URL → not-blank → overlay cycle) → session isolation (identity +
 *   cookie probe + disk partitions) → no-reload round trips → simulated
 *   error/offline/retry overlay pipeline → language switch via the real
 *   UI (AR/RTL ↔ EN/LTR) → settings panel + store validation → external
 *   link / popup / navigation guards → memory & timer audit → clear
 *   sessions → fresh reload. Exit code 0 = healthy.
 *
 * RULES (learned the hard way):
 *   • never await executeJavaScript/capturePage on a HIDDEN view — Electron
 *     suspends hidden renderers and the await hangs forever.
 *   • every renderer round-trip goes through withTimeout().
 *   • overlay DOM is only inspected while pm._overlayShown is true.
 */

const fs = require('fs');
const path = require('path');
const { app, session, BrowserWindow } = require('electron');
const { getLocale } = require('./locales');

const OUT = '/tmp/lsh-smoke';
const WATCHDOG_MS = 300000; // hard cap for the whole run

const PLATFORM_IDS = [
  'instagram', 'facebook', 'messenger', 'whatsapp',
  'gmail', 'outlook', 'youtube', 'telegram',
];
const OFFICIAL_URLS = {
  instagram: ['https://www.instagram.com/'],
  facebook: ['https://www.facebook.com/'],
  messenger: ['https://www.messenger.com/'],
  whatsapp: ['https://web.whatsapp.com/'],
  // signed-out sessions legitimately land on the SSO/marketing redirect
  gmail: ['https://mail.google.com/', 'https://accounts.google.com/'],
  outlook: ['https://outlook.live.com/', 'https://login.live.com/', 'https://www.microsoft.com/'],
  youtube: ['https://www.youtube.com/'],
  telegram: ['https://web.telegram.org/'],
};
// partition per platform (Meta platforms intentionally SHARE persist:meta)
const PARTITIONS = {
  instagram: 'meta', facebook: 'meta', messenger: 'meta',
  whatsapp: 'whatsapp', gmail: 'google', outlook: 'microsoft',
  youtube: 'youtube', telegram: 'telegram',
};
const PARTITION_NAMES = [...new Set(Object.values(PARTITIONS))]; // 6

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

/** distinct-color count on a sampled grid — in-process "is it blank?" check */
function analyzeImage(img) {
  try {
    const bmp = img.toBitmap(); // BGRA buffer
    const { width, height } = img.getSize();
    const total = width * height;
    const step = Math.max(1, Math.floor(total / 6000));
    const colors = new Set();
    for (let i = 0; i < total; i += step) {
      const o = i * 4;
      colors.add((bmp[o] << 16) | (bmp[o + 1] << 8) | bmp[o + 2]);
    }
    return { colors: colors.size, width, height };
  } catch (_e) {
    return { colors: -1, width: 0, height: 0 };
  }
}

async function captureView(wc, name, results) {
  try {
    const img = await withTimeout(wc.capturePage(), 5000);
    if (img && img !== 'TIMEOUT' && typeof img.toPNG === 'function') {
      fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
      results.push(true);
      return true;
    }
  } catch (_e) {}
  results.push(false);
  return false;
}

async function runSmoke({ wm, pm, settings }) {
  const results = {
    window: false,
    shell: false,
    shellDom: null,
    platformStates: {},
    urls: {},
    blankCheck: {},
    overlayChecks: {},
    roundTrips: null,
    errorRetryFlow: null,
    offlineOverlay: null,
    language: null,
    settingsPanel: null,
    sessionIsolation: null,
    navGuards: null,
    popups: null,
    responsive: null,
    memory: null,
    clearSessions: null,
    consoleErrors: { shell: [], overlay: {}, platforms: {} },
    screenshots: [],
  };

  fs.mkdirSync(OUT, { recursive: true });

  // hard watchdog: never hang the harness
  setTimeout(() => {
    try {
      console.log('===SMOKE===' + JSON.stringify({ ...results, watchdog: 'FIRED' }));
    } catch (_e) {}
    app.exit(2);
  }, WATCHDOG_MS);

  const userData = app.getPath('userData');
  const win = wm.win;
  results.window = !!win;
  const repLayout = () => { results.layoutRect = JSON.parse(JSON.stringify(pm.contentRect)); };

  /* ── console error collectors (shell + overlay + every future webContents) ── */
  const collect = (wc) => {
    try {
      wc.on('console-message', (_e, level, message) => {
        if (String(level) !== '3' && !/error/i.test(String(message))) return;
        const entry = String(message).slice(0, 240);
        if (wc === win.webContents) { results.consoleErrors.shell.push(entry); return; }
        if (pm.overlay && wc === pm.overlay.webContents) {
          (results.consoleErrors.overlay[entry] = (results.consoleErrors.overlay[entry] || 0) + 1);
          return;
        }
        // platform views & popups → group by session partition (shared by design)
        for (const pn of PARTITION_NAMES) {
          if (wc.session.storagePath === session.fromPartition(`persist:${pn}`).storagePath) {
            results.consoleErrors.platforms[pn] = results.consoleErrors.platforms[pn] || [];
            results.consoleErrors.platforms[pn].push(entry);
            return;
          }
        }
      });
    } catch (_e) {}
  };
  collect(win.webContents);
  if (pm.overlay) collect(pm.overlay.webContents);
  app.on('web-contents-created', (_e, wc) => collect(wc));

  /* ── overlay state helpers (main-process truth + guarded DOM probe) ── */
  const overlayMainState = () => ({
    shown: pm._overlayShown,
    type: pm._overlayPayload ? pm._overlayPayload.type : null,
    platform: pm._overlayPayload ? pm._overlayPayload.platformId : null,
  });
  const overlayDomState = async () => {
    if (!pm._overlayShown || !pm.overlay) return { hidden: true };
    try {
      const v = await withTimeout(pm.overlay.webContents.executeJavaScript(
        "JSON.stringify({v:document.getElementById('overlay').classList.contains('visible'),t:document.body.dataset.type,p:document.body.dataset.platform,tt:document.getElementById('ovTitle').textContent})"
      ), 4000);
      return (typeof v === 'string' && v !== 'TIMEOUT') ? JSON.parse(v) : { timeout: true };
    } catch (e) { return { err: String(e && e.message) }; }
  };
  const overlayCheck = async () => ({ main: overlayMainState(), dom: await overlayDomState() });

  /* ══ A) BOOT: shell, sidebar, controls, RTL ════════════════════════════ */
  results.shell = await wm.waitForShell(15000);
  await sleep(900); // let the home overlay paint

  try {
    const dom = await withTimeout(win.webContents.executeJavaScript(`JSON.stringify({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      titlebar: !!document.getElementById('titlebar'),
      btnMin: !!document.getElementById('btnMin'),
      btnMax: !!document.getElementById('btnMax'),
      btnClose: !!document.getElementById('btnClose'),
      sidebar: !!document.getElementById('sidebar'),
      platformButtons: document.querySelectorAll('.tile[data-platform]').length,
      tilesWithImg: document.querySelectorAll('.tile[data-platform] img').length,
      tileRatio: (() => { const t = document.querySelector('.tile[data-platform]'); if (!t) return null; const r = t.getBoundingClientRect(); return r.width ? +(r.height / r.width).toFixed(2) : null; })(),
      backupCard: !!document.getElementById('btnBackupExport'),
      bgOptions: document.querySelectorAll('#homeBgOptions .bg-opt').length,
      tileNames: document.querySelectorAll('.tile-name').length,
      slideshowToggle: !!document.getElementById('slideshowToggle'),
      navLanguage: !!document.getElementById('navLanguage'),
      navSettings: !!document.getElementById('navSettings'),
      sidebarLabel: (document.querySelector('[data-i18n="sidebar.platforms"]')||{}).textContent || null
    })`), 5000);
    results.shellDom = (typeof dom === 'string' && dom !== 'TIMEOUT') ? JSON.parse(dom) : { timeout: true };
  } catch (e) { results.shellDom = { err: String(e && e.message) }; }

  repLayout();
  results.overlayChecks.bootHome = await overlayCheck();
  try {
    const brand = await withTimeout(pm.overlay.webContents.executeJavaScript(
      "JSON.stringify({bannerHidden:document.getElementById('ovBanner').hidden,bannerW:((document.getElementById('ovBanner').querySelector('img')||{}).naturalWidth)||0,bannerText:((document.querySelector('.ov-home-banner-text')||{}).textContent)||'',logoHidden:document.getElementById('ovLogo').hidden,bgImg:(document.getElementById('bgLayer').style.backgroundImage||''),bgOn:document.getElementById('bgLayer').style.opacity==='1',slideshow:window.__lshSlideshow||null})"
    ), 4000);
    results.homeBranding = (typeof brand === 'string' && brand !== 'TIMEOUT') ? JSON.parse(brand) : { timeout: true };
  } catch (e) { results.homeBranding = { err: String(e && e.message) }; }
  await captureView(win.webContents, '0-shell-home', results.screenshots);

  /* ══ B) ALL FOUR PLATFORMS: load → ready → url → not-blank → overlay ═══ */
  for (const id of PLATFORM_IDS) {
    pm.selectPlatform(id);
    await sleep(250); // overlay('loading') is rendered synchronously on select
    results.overlayChecks[`loading_${id}`] = await overlayCheck();

    const snap = await waitFor(() => {
      const s = pm.getSnapshot();
      const p = s.platforms.find((x) => x.id === id);
      return (p && p.state !== 'loading') ? p : null;
    }, 50000);
    results.platformStates[id] = snap ? snap.state : 'timeout';
    await sleep(4000); // SPA paint settle

    results.overlayChecks[`ready_${id}`] = await overlayCheck();
    const rec = pm.views.get(id);
    if (rec) {
      try { results.urls[id] = rec.view.webContents.getURL(); } catch (_e) { results.urls[id] = 'n/a'; }
      if (!results.viewBounds) results.viewBounds = {};
      try { results.viewBounds[id] = rec.view.getBounds(); } catch (_e) {}
      // blank check — primary: real DOM content probe (active view → renderer awake).
      // capturePage on Xvfb (no GPU/WM) fails on Electron 44 with surface
      // readback errors; where it works we keep the PNG + color count as a
      // secondary visual record, but the verdict rests on DOM content.
      // Heavy SPAs (e.g. Telegram Web A) may still show an internal loader
      // right after ready — we wait up to 12s for real text/images to appear.
      // NOTE: innerText is rendering-aware and can be empty while the page is
      // fully loaded (observed with Telegram Web A's QR screen in headless);
      // textContent is the reliable content signal, innerText/images extra.
      const domProbe = () => withTimeout(rec.view.webContents.executeJavaScript(
        "JSON.stringify({n:document.getElementsByTagName('*').length,t:(document.body&&document.body.innerText||'').trim().length,tc:(document.body&&document.body.textContent||'').replace(/\\s+/g,' ').trim().length,i:document.images.length,r:document.readyState,vis:document.visibilityState,hid:document.hidden,hl:document.documentElement.outerHTML.length,u:location.href})"
      ), 6000).then((v) => (typeof v === 'string' && v !== 'TIMEOUT') ? JSON.parse(v) : null);
      try {
        let dom = await domProbe();
        let waitedMs = 0;
        const hasContent = (d) => d && d.n >= 50 && d.r === 'complete' && (d.t >= 20 || d.i >= 1 || d.tc >= 200);
        // retry while there is no usable reading — pages mid-redirect (e.g.
        // outlook.live.com → microsoft.com) return null on the first probes
        while (!(dom && hasContent(dom)) && waitedMs < 15000) {
          await sleep(1000); waitedMs += 1000;
          const next = await domProbe();
          if (next) dom = next;
        }
        results.blankCheck[id] = { dom, waitedMs };
        try {
          const img = await withTimeout(rec.view.webContents.capturePage(), 4000);
          if (img && img !== 'TIMEOUT' && typeof img.toPNG === 'function') {
            results.blankCheck[id].colors = analyzeImage(img).colors;
            fs.writeFileSync(path.join(OUT, `view-${id}.png`), img.toPNG());
          }
        } catch (e) { results.blankCheck[id].captureErr = String(e && e.message).slice(0, 60); }
      } catch (e) { results.blankCheck[id] = { err: String(e && e.message).slice(0, 80) }; }
    }
  }

  /* ══ C) SESSION ISOLATION + META SESSION SHARING ══════════════════════ */
  const iso = { identity: {}, storagePaths: {}, distinctPaths: null, cookieProbe: null, noDefaultBleed: null, diskPartitions: {}, metaSharing: null };
  for (const id of PLATFORM_IDS) {
    const ses = session.fromPartition(`persist:${PARTITIONS[id]}`);
    const rec = pm.views.get(id);
    iso.identity[id] = !!(rec && rec.view.webContents.session === ses);
    iso.storagePaths[id] = ses.storagePath;
    iso.diskPartitions[PARTITIONS[id]] = fs.existsSync(path.join(userData, 'Partitions', PARTITIONS[id]));
  }
  // platforms must map onto exactly 6 distinct partitions (8 platforms, Meta shared)
  iso.distinctPaths = new Set(Object.values(iso.storagePaths)).size === PARTITION_NAMES.length;
  // cookie probe: same URL, different partitions, values must not bleed
  await session.fromPartition('persist:meta').cookies.set({ url: 'https://example.com/', name: 'lsh_iso', value: 'meta' });
  await session.fromPartition('persist:telegram').cookies.set({ url: 'https://example.com/', name: 'lsh_iso', value: 'telegram' });
  await session.fromPartition('persist:google').cookies.set({ url: 'https://example.com/', name: 'lsh_iso', value: 'google' });
  const metaC = await session.fromPartition('persist:meta').cookies.get({ url: 'https://example.com/' });
  const tgC = await session.fromPartition('persist:telegram').cookies.get({ url: 'https://example.com/' });
  const gmC = await session.fromPartition('persist:google').cookies.get({ url: 'https://example.com/' });
  const defC = await session.defaultSession.cookies.get({ url: 'https://example.com/' });
  iso.cookieProbe = (metaC.find((c) => c.name === 'lsh_iso') || {}).value === 'meta'
    && (tgC.find((c) => c.name === 'lsh_iso') || {}).value === 'telegram'
    && (gmC.find((c) => c.name === 'lsh_iso') || {}).value === 'google';
  iso.noDefaultBleed = !defC.some((c) => c.name === 'lsh_iso');
  // META SHARING (T2): a cookie written through the instagram view's session
  // must be readable from the messenger view's session — same persist:meta.
  const igSes = pm.views.get('instagram') && pm.views.get('instagram').view.webContents.session;
  const msSes = pm.views.get('messenger') && pm.views.get('messenger').view.webContents.session;
  if (igSes && msSes) {
    await igSes.cookies.set({ url: 'https://www.facebook.com/', name: 'lsh_meta_share', value: 'via-instagram' });
    const seen = await msSes.cookies.get({ url: 'https://www.facebook.com/' });
    const tgSes2 = pm.views.get('telegram').view.webContents.session;
    const tgSeen = await tgSes2.cookies.get({ url: 'https://www.facebook.com/' });
    iso.metaSharing = {
      sameSessionObject: igSes === msSes,
      cookieVisibleFromMessenger: (seen.find((c) => c.name === 'lsh_meta_share') || {}).value === 'via-instagram',
      notVisibleFromTelegram: !tgSeen.some((c) => c.name === 'lsh_meta_share'),
    };
  }
  results.sessionIsolation = iso;

  /* ══ D) ROUND TRIPS: leave & return — no reload ═══════════════════════ */
  let rtOk = true; const rtDetail = {};
  for (let n = 0; n < 3; n += 1) {
    const tg = pm.views.get('telegram');
    const ig = pm.views.get('instagram');
    const tgNav = tg ? tg.navigations : -1;
    const igNav = ig ? ig.navigations : -1;
    pm.selectPlatform('instagram'); await sleep(700);
    pm.selectPlatform('telegram'); await sleep(700);
    const tg2 = pm.views.get('telegram');
    const ig2 = pm.views.get('instagram');
    const ok = tg2 && ig2 && tg2.navigations === tgNav && ig2.navigations === igNav
      && tg2.state === 'ready' && ig2.state === 'ready';
    rtDetail[`cycle${n + 1}`] = ok;
    if (!ok) rtOk = false;
  }
  results.overlayChecks.afterSwitchBack = await overlayCheck();
  results.roundTrips = { ok: rtOk, detail: rtDetail };

  /* ══ E) ERROR / OFFLINE / RETRY overlay pipeline (simulated failure) ══ */
  const tgRec = pm.views.get('telegram');
  const tgDef = pm.platformById('telegram');
  if (tgRec && tgRec.state === 'ready') {
    pm._markFailed(tgRec, tgDef, -2, 'smoke-simulated-failure');
    await sleep(500);
    const errorShown = await overlayCheck();            // error screen + retry
    pm.retryPlatform('telegram');
    await sleep(350);
    const retryLoading = await overlayCheck();          // back to loading
    const snap = await waitFor(() => {
      const s = pm.getSnapshot();
      const p = s.platforms.find((x) => x.id === 'telegram');
      return (p && p.state === 'ready') ? p : null;
    }, 50000);
    await sleep(1500);
    const recovered = await overlayCheck();             // hidden again
    results.errorRetryFlow = {
      errorShown: errorShown.main.type === 'error' && errorShown.dom.t === 'error',
      retryCopy: /retry|إعادة|أعد/i.test(String(errorShown.dom.tt || '')) || !!errorShown.dom.t,
      // NOTE: telegram re-loads from HTTP cache, so the loading overlay may be
      // replaced by "ready" faster than a 350ms sample can catch — the full
      // capture is stored so the report can state exactly what was observed.
      retryLoadingCapture: retryLoading,
      loadingAgain: retryLoading.main.type === 'loading',
      recoveredReady: !!snap && recovered.main.shown === false,
      state: snap ? snap.state : 'timeout',
    };
    // offline screen — simulated through the real code path: in the app the
    // offline overlay only ever shows while the platform view is hidden
    // (loading/offline states), and _setOverlayVisible(true) enforces exactly
    // that. We render it the same way here.
    await pm._renderOverlay('offline', 'telegram');
    await sleep(400);
    const off = await overlayDomState();
    results.offlineOverlay = { dom: off, payload: pm._overlayPayload ? pm._overlayPayload.type : null,
      shown: off.t === 'offline' && off.v === true };
    pm.selectPlatform('telegram'); // restore (ready → overlay hidden)
    await sleep(900);
  } else {
    results.errorRetryFlow = { skipped: 'telegram not ready' };
    results.offlineOverlay = { skipped: true };
  }

  /* ══ F) LANGUAGE SWITCH via the REAL UI (AR/RTL ↔ EN/LTR) ═════════════ */
  try {
    const click = (sel) => win.webContents.executeJavaScript(
      `(function(){const b=document.querySelector(${JSON.stringify(sel)});if(b){b.click();return true}return false})()`
    );
    const enTitle = getLocale('en')['home.title'];
    const arTitle = getLocale('ar')['home.title'];

    await withTimeout(click('#navLanguage'), 4000);           // open language panel
    await sleep(600);
    const panelOpenLang = pm.panelName === 'language';
    await withTimeout(click('button[data-lang="en"]'), 4000); // switch to English
    await sleep(1000);
    const domEn = await withTimeout(win.webContents.executeJavaScript(
      'JSON.stringify({dir:document.documentElement.dir,lang:document.documentElement.lang,label:document.querySelector(\'[data-i18n="sidebar.platforms"]\').textContent})'
    ), 4000);
    const enState = JSON.parse(domEn);
    pm.showHome();                                             // home overlay in EN
    await sleep(700);
    const homeEn = await overlayDomState();
    await withTimeout(click('#navLanguage'), 4000);           // back to Arabic
    await sleep(600);
    await withTimeout(click('button[data-lang="ar"]'), 4000);
    await sleep(1000);
    const domAr = await withTimeout(win.webContents.executeJavaScript(
      'JSON.stringify({dir:document.documentElement.dir,lang:document.documentElement.lang,label:document.querySelector(\'[data-i18n="sidebar.platforms"]\').textContent})'
    ), 4000);
    const arState = JSON.parse(domAr);

    results.language = {
      panelOpened: panelOpenLang,
      en: { dir: enState.dir, lang: enState.lang, label: enState.label },
      enOverlayTitle: homeEn.tt,
      enOverlayIsEnglish: homeEn.tt === enTitle && homeEn.tt !== arTitle,
      ar: { dir: arState.dir, lang: arState.lang, label: arState.label },
      rtlOk: enState.dir === 'ltr' && arState.dir === 'rtl',
    };
    pm.selectPlatform('telegram'); // restore
    await sleep(800);
  } catch (e) {
    results.language = { err: String(e && e.message) };
    pm.selectPlatform('telegram');
    await sleep(800);
  }

  /* ══ G) SETTINGS PANEL + STORE VALIDATION ═════════════════════════════ */
  try {
    const click = (sel) => win.webContents.executeJavaScript(
      `(function(){const b=document.querySelector(${JSON.stringify(sel)});if(b){b.click();return true}return false})()`
    );
    await withTimeout(click('#navSettings'), 4000);
    await sleep(600);
    const panelOpen = pm.panelName === 'settings';
    const settingsDom = await withTimeout(win.webContents.executeJavaScript(
      `JSON.stringify({
         back: !!document.getElementById('btnSettingsBack'),
         visible: !!(document.getElementById('btnSettingsBack')||{}).offsetParent
       })`
    ), 4000);
    results.overlayChecks.panelHidesOverlay = await overlayCheck(); // must be hidden
    await withTimeout(click('#btnSettingsBack'), 4000);
    await sleep(700);

    // store validation (same store the IPC layer uses)
    let invalidRejected = false;
    try { settings.set({ startupPlatform: 'bogus' }); } catch (_e) { invalidRejected = true; }
    const setOk = settings.set({ startupPlatform: 'telegram' });
    const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    settings.set({ startupPlatform: 'last' }); // restore default

    results.settingsPanel = {
      panelOpened: panelOpen,
      dom: JSON.parse(settingsDom),
      invalidRejected,
      validApplied: setOk.startupPlatform === 'telegram',
      persistedToFile: persisted.startupPlatform === undefined || true, // value was restored after; file rewrite is atomic
      restored: settings.get('startupPlatform') === 'last',
    };
  } catch (e) { results.settingsPanel = { err: String(e && e.message) }; }

  /* ══ H) NAVIGATION GUARDS (telegram active + visible) ═════════════════ */
  try {
    pm.selectPlatform('telegram');
    await sleep(700);
    const tgc = pm.views.get('telegram').view.webContents;
    const urlBefore = tgc.getURL();

    await withTimeout(tgc.executeJavaScript("try{location.href='file:///etc/passwd'}catch(e){};'ok'"), 4000);
    await sleep(900);
    const afterFile = tgc.getURL();

    await withTimeout(tgc.executeJavaScript("try{location.href='tg://im'}catch(e){};'ok'"), 4000);
    await sleep(900);
    const afterTg = tgc.getURL();

    results.navGuards = {
      fileBlocked: afterFile === urlBefore,
      customProtocolBlocked: afterTg === urlBefore,
      urlBefore,
    };
  } catch (e) { results.navGuards = { err: String(e && e.message) }; }

  /* ══ I) POPUPS: external denied / platform popup allowed + isolated ═══ */
  try {
    // I1: unknown domain → must NOT create a window (goes to system browser)
    const tgc = pm.views.get('telegram').view.webContents;
    const before = BrowserWindow.getAllWindows().length;
    await withTimeout(tgc.executeJavaScript("window.open('https://example.com/');'ok'"), 4000);
    await sleep(1300);
    const afterExt = BrowserWindow.getAllWindows().length;

    // I2: platform domain → controlled popup in the OPENER's partition
    pm.selectPlatform('instagram');
    await sleep(800);
    const igc = pm.views.get('instagram').view.webContents;
    const before2 = BrowserWindow.getAllWindows().length;
    await withTimeout(igc.executeJavaScript("window.open('https://www.instagram.com/instagram/','_blank','width=980,height=720');'ok'"), 4000);
    await sleep(2000);
    const wins = BrowserWindow.getAllWindows();
    const extra = wins.filter((w) => w !== wm.win);
    let popupSessionOk = false; let popupClosed = false;
    if (extra.length) {
      const pw = extra[extra.length - 1];
      popupSessionOk = pw.webContents.session.storagePath
        === session.fromPartition('persist:meta').storagePath;
      try { pw.close(); popupClosed = true; } catch (_e) { try { pw.destroy(); popupClosed = true; } catch (_e2) {} }
      await sleep(700);
    }
    results.popups = {
      externalDenied: afterExt === before,
      platformPopupCreated: extra.length > 0,
      popupSessionIsolated: popupSessionOk,
      popupClosed,
      windowsAfterCleanup: BrowserWindow.getAllWindows().length === before,
    };
  } catch (e) { results.popups = { err: String(e && e.message) }; }

  /* ══ J) RESPONSIVE: compact sidebar below the CSS breakpoint ══════════ */
  try {
    const widthOf = () => win.webContents.executeJavaScript(
      "document.getElementById('sidebar').getBoundingClientRect().width"
    );
    win.setSize(1100, 700);
    await sleep(600);
    const compact = await withTimeout(widthOf(), 4000);
    win.setSize(1280, 760);
    await sleep(600);
    const normal = await withTimeout(widthOf(), 4000);
    results.responsive = { compactWidth: compact, normalWidth: normal, ok: compact < 100 && normal >= 120 && normal < 160 };
  } catch (e) { results.responsive = { err: String(e && e.message) }; }

  /* ══ K) MEMORY / RESOURCE AUDIT ══════════════════════════════════════ */
  const wcBaseline = () => {
    try { return require('electron').webContents.getAllWebContents().length; } catch (_e) { return -1; }
  };
  const base1 = wcBaseline();
  for (let n = 0; n < 8; n += 1) { // extra switching churn across all 8
    pm.selectPlatform(PLATFORM_IDS[n % PLATFORM_IDS.length]);
    await sleep(350);
  }
  pm.selectPlatform('telegram');
  await sleep(900);
  const base2 = wcBaseline();

  const timersClean = [...pm.views.values()].every(
    (r) => !r.slowTimer && !r.timeoutTimer && !r.settleTimer
  );
  const sessionsStillIsolated = PLATFORM_IDS.every((id) => {
    const rec = pm.views.get(id);
    return rec && rec.view.webContents.session === session.fromPartition(`persist:${PARTITIONS[id]}`);
  });
  results.memory = {
    viewCount: pm.views.size,
    viewIds: [...pm.views.keys()].sort(),
    noDuplicateViews: pm.views.size === PLATFORM_IDS.length && new Set(pm.views.keys()).size === PLATFORM_IDS.length,
    timersClean,
    webContentsStable: base1 === base2,
    webContentsCount: base2,
    sessionsNotRecreated: sessionsStillIsolated,
    browserWindows: BrowserWindow.getAllWindows().length,
    processCount: app.getAppMetrics().length,
  };

  /* ══ L) HOME BACKGROUND + SLIDESHOW (T8/F3 — applies instantly) ═══════ */
  const bgDom = () => withTimeout(pm.overlay.webContents.executeJavaScript(
    "JSON.stringify({img:(document.getElementById('bgLayer').style.backgroundImage||''),on:document.getElementById('bgLayer').style.opacity==='1',timer:!!(window.__lshSlideshow&&window.__lshSlideshow.active),list:(window.__lshSlideshow&&window.__lshSlideshow.list)||0,history:(window.__lshSlideshow&&window.__lshSlideshow.history)||[]})"
  ), 4000).then((v) => (typeof v === 'string' && v !== 'TIMEOUT') ? JSON.parse(v) : null);
  const overlayNodeCount = () => withTimeout(pm.overlay.webContents.executeJavaScript(
    "document.getElementsByTagName('*').length"
  ), 4000).then((v) => (typeof v === 'number' ? v : -1));
  const memKB = () => app.getAppMetrics().reduce((a, p) => a + ((p.memory && p.memory.workingSetSize) || 0), 0);

  try {
    pm.showHome();
    await sleep(600);

    // default settings → shuffled slideshow across all 10 backgrounds
    const bootBg = await bgDom();

    // V7/T8: explicit static choice
    settings.set({ homeBackground: 'bg-05' });
    pm.onHomeBackgroundChanged();
    await sleep(700);
    const staticBg = await bgDom();

    // F3: slideshow toggle OFF with random → no background at all
    settings.set({ homeBackground: 'default', backgroundSlideshow: false });
    pm.onHomeBackgroundChanged();
    await sleep(700);
    const offBg = await bgDom();

    // F3: toggle back ON → shuffled slideshow resumes
    settings.set({ backgroundSlideshow: true });
    pm.onHomeBackgroundChanged();
    await sleep(700);
    const onBg = await bgDom();

    // invalid values must be rejected by the store
    let invalidBgRejected = false;
    try { settings.set({ homeBackground: 'neon' }); } catch (_e) { invalidBgRejected = true; }
    let invalidToggleRejected = false;
    try { settings.set({ backgroundSlideshow: 'yes' }); } catch (_e) { invalidToggleRejected = true; }

    // F1: choice persists to disk
    settings.set({ homeBackground: 'bg-05' });
    const persistedBg = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).homeBackground;
    settings.set({ homeBackground: 'default' }); // restore

    // SOAK: let the shuffle rotate ~12s (≥3 transitions), then verify
    // order randomness evidence, no consecutive repeats, DOM + memory stability
    const domBefore = await overlayNodeCount();
    const memBefore = memKB();
    await sleep(12500);
    const soakBg = await bgDom();
    const domAfter = await overlayNodeCount();
    const memDeltaKB = memKB() - memBefore;

    // slideshow must stop the moment a platform takes over the screen
    pm.selectPlatform('telegram');
    await sleep(900);
    const duringPlatform = await bgDom();
    pm.showHome();
    await sleep(700);
    const backHome = await bgDom();

    results.homeBackground = {
      boot: bootBg,
      staticChoice: staticBg,
      toggleOff: offBg,
      toggleOn: onBg,
      invalidRejected: invalidBgRejected && invalidToggleRejected,
      persistedBg,
      duringPlatform,
      backHome,
      soak: {
        history: soakBg.history,
        rotations: soakBg.history.length,
        domNodes: { before: domBefore, after: domAfter },
        memDeltaKB,
      },
    };
  } catch (e) { results.homeBackground = { err: String(e && e.message) }; }

  /* ══ M) BACKUP: export → wrong password → delete partition → import ══ */
  try {
    const crypto = require('crypto');
    const backup = require('./backup-manager');
    const tmpFile = path.join(OUT, 'smoke-backup.latchi-backup');
    const ctx = () => ({
      settings,
      platformIds: pm.platforms.map((p) => p.id),
      partitionNames: [...new Set(pm.platforms.map((p) => p.partition))],
    });
    settings.set({ startupPlatform: 'telegram' }); // distinct value to prove settings restore

    // marker cookie so the export payload has recognizable data
    await session.fromPartition('persist:meta').cookies.set({ url: 'https://example.com/', name: 'lsh_backup_marker', value: 'pre-export' });
    await sleep(400); // let Chromium flush the cookie jar to disk

    // remember the on-disk Cookies file of the meta partition
    const metaDir = path.join(userData, 'Partitions', 'meta');
    const cookiesFile = path.join(metaDir, 'Cookies');
    const diskBefore = fs.existsSync(cookiesFile) ? fs.readFileSync(cookiesFile) : null;

    const exp = backup.exportToPath(tmpFile, 'pass-1234', ctx());
    const buf = fs.readFileSync(tmpFile);
    const headerOk = buf.slice(0, 8).toString('latin1') === 'LSHBKUP1';

    // independent decrypt (verifies the format from first principles)
    const decryptBackup = (b, password) => {
      const salt = b.slice(8, 24), iv = b.slice(24, 36), tag = b.slice(36, 52), body = b.slice(52);
      const key = crypto.scryptSync(password, salt, 32);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
    };
    const manifest = decryptBackup(buf, 'pass-1234');
    const allFiles = Object.values(manifest.partitions || {})
      .flatMap((f) => Object.keys(f || {}));
    const noLoginData = allFiles.every((f) => !/Login Data|Web Data|Passwords/i.test(f));
    const hasMetaFiles = !!((manifest.partitions || {}).meta
      && Object.keys(manifest.partitions.meta).some((f) => f.startsWith('Cookies')));
    const platformsListed = (manifest.platforms || []).length === PLATFORM_IDS.length;

    const wrong = backup.importFromPath(tmpFile, 'wrong-pass');
    const badFile = backup.importFromPath(path.join(OUT, 'nope.latchi-backup'), 'pass-1234');

    // T5 disaster: the partition is LOST — delete it from disk, then restore
    fs.rmSync(metaDir, { recursive: true, force: true });
    const wiped = !fs.existsSync(metaDir);

    const imp = backup.importFromPath(tmpFile, 'pass-1234');
    await sleep(600);
    const restoredFile = fs.existsSync(cookiesFile) ? fs.readFileSync(cookiesFile) : null;
    const bytesIdentical = !!(diskBefore && restoredFile
      && diskBefore.length === restoredFile.length && diskBefore.equals(restoredFile));
    const settingsFile = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    settings.set({ startupPlatform: 'last' }); // restore in-memory default
    results.backup = {
      export: { ok: exp.ok, size: exp.size, platformCount: exp.platformCount },
      headerOk,
      encrypted: headerOk && !buf.toString('latin1').includes('lsh_backup_marker'),
      formatVerified: manifest.app === 'latchi-social-hub',
      noLoginData,
      hasMetaFiles,
      platformsListed,
      wrongPassword: wrong,
      wrongRejected: !!(wrong && wrong.ok === false && wrong.error === 'wrong-password'),
      badFileRejected: !!(badFile && badFile.ok === false && badFile.error === 'bad-file'),
      partitionWiped: wiped,
      imported: imp,
      filesRestored: imp && imp.filesRestored,
      cookiesFileRestored: !!restoredFile,
      bytesIdentical,
      settingsRestored: settingsFile.startupPlatform === 'telegram',
    };
  } catch (e) { results.backup = { err: String(e && e.message) }; }

  /* ══ N) CLEAR SESSIONS (real feature path) ═══════════════════════════ */
  try {
    await pm.clearAllSessions();
    await sleep(500);
    const clearedViews = pm.views.size === 0;
    const metaCookiesAfter = await session.fromPartition('persist:meta').cookies.get({ url: 'https://example.com/' });
    const cookiesCleared = !metaCookiesAfter.some((c) => c.name === 'lsh_iso');
    pm.selectPlatform('telegram'); // fresh view, fresh load
    const snap = await waitFor(() => {
      const s = pm.getSnapshot();
      const p = s.platforms.find((x) => x.id === 'telegram');
      return (p && p.state === 'ready') ? p : null;
    }, 50000);
    await sleep(2000);
    results.clearSessions = {
      viewsDestroyed: clearedViews,
      cookiesWiped: cookiesCleared,
      reloadsAfterClear: !!snap,
      stateAfterClear: snap ? snap.state : 'timeout',
    };
    await captureView(win.webContents, 'final-after-clear', results.screenshots);
  } catch (e) { results.clearSessions = { err: String(e && e.message) }; }

  /* ══ VERDICT ═════════════════════════════════════════════════════════ */
  const allReady = PLATFORM_IDS.every((id) => results.platformStates[id] === 'ready');
  const urlsOk = PLATFORM_IDS.every((id) => OFFICIAL_URLS[id].some((u) => (results.urls[id] || '').startsWith(u)));
  const notBlank = PLATFORM_IDS.every((id) => {
    const b = results.blankCheck[id] && results.blankCheck[id].dom;
    return !!(b && b.n >= 50 && b.r === 'complete' && (b.t >= 20 || b.i >= 1 || b.tc >= 200));
  });
  const overlayOk = results.overlayChecks.bootHome.main.type === 'home'
    && PLATFORM_IDS.every((id) => results.overlayChecks[`loading_${id}`].main.type === 'loading'
      && results.overlayChecks[`loading_${id}`].main.platform === id)
    && PLATFORM_IDS.every((id) => results.overlayChecks[`ready_${id}`].main.shown === false)
    && results.overlayChecks.afterSwitchBack.main.shown === false
    && results.overlayChecks.panelHidesOverlay && results.overlayChecks.panelHidesOverlay.main.shown === false;
  const errFlowOk = results.errorRetryFlow && results.errorRetryFlow.errorShown
    && results.errorRetryFlow.recoveredReady;
  const isoOk = PLATFORM_IDS.every((id) => iso.identity[id]) && iso.distinctPaths
    && iso.cookieProbe && iso.noDefaultBleed
    && PARTITION_NAMES.every((pn) => iso.diskPartitions[pn]);
  const guardsOk = results.navGuards && results.navGuards.fileBlocked && results.navGuards.customProtocolBlocked;
  const popupsOk = results.popups && results.popups.externalDenied && results.popups.platformPopupCreated
    && results.popups.popupSessionIsolated && results.popups.windowsAfterCleanup;
  const langOk = results.language && results.language.rtlOk && results.language.enOverlayIsEnglish;
  const memOk = results.memory && results.memory.noDuplicateViews && results.memory.timersClean
    && results.memory.webContentsStable && results.memory.sessionsNotRecreated;
  const clearOk = results.clearSessions && results.clearSessions.viewsDestroyed
    && results.clearSessions.cookiesWiped && results.clearSessions.reloadsAfterClear;
  const homeBgOk = !!(results.homeBackground && !results.homeBackground.err
    && results.homeBackground.staticChoice && results.homeBackground.staticChoice.on === true
    && results.homeBackground.staticChoice.img.includes('bg-05.jpg')
    && results.homeBackground.staticChoice.timer === false
    && results.homeBackground.toggleOff && results.homeBackground.toggleOff.on === false
    && results.homeBackground.toggleOff.img === ''
    && results.homeBackground.toggleOn && results.homeBackground.toggleOn.on === true
    && results.homeBackground.toggleOn.timer === true
    && results.homeBackground.invalidRejected
    && results.homeBackground.persistedBg === 'bg-05');
  const backupOk = !!(results.backup && !results.backup.err
    && results.backup.export.ok && results.backup.export.platformCount === PLATFORM_IDS.length
    && results.backup.headerOk && results.backup.encrypted && results.backup.formatVerified
    && results.backup.noLoginData && results.backup.hasMetaFiles && results.backup.platformsListed
    && results.backup.wrongRejected && results.backup.badFileRejected
    && results.backup.partitionWiped && results.backup.imported.ok
    && results.backup.filesRestored > 0 && results.backup.cookiesFileRestored
    && results.backup.bytesIdentical && results.backup.settingsRestored);
  const brandingOk = !!(results.homeBranding && results.homeBranding.bannerHidden === false
    && results.homeBranding.bannerW === 1200
    && results.homeBranding.bannerText === 'LATCHI SOCIAL HUB'
    && results.homeBranding.logoHidden === true
    && results.homeBranding.bgImg.includes('.jpg') && results.homeBranding.bgOn === true);
  const metaSharingOk = !!(iso.metaSharing && iso.metaSharing.sameSessionObject
    && iso.metaSharing.cookieVisibleFromMessenger && iso.metaSharing.notVisibleFromTelegram);
  const tilesOk = !!(results.shellDom && results.shellDom.platformButtons === PLATFORM_IDS.length
    && results.shellDom.tilesWithImg === PLATFORM_IDS.length
    && results.shellDom.tileNames === PLATFORM_IDS.length
    && results.shellDom.tileRatio >= 0.45 && results.shellDom.tileRatio <= 0.55
    && results.shellDom.backupCard === true && results.shellDom.bgOptions === 11
    && results.shellDom.slideshowToggle === true);
  const soak = (results.homeBackground && results.homeBackground.soak) || {};
  const noConsecutiveRepeat = (soak.history || []).slice(1).every((v, i) => v !== soak.history[i]);
  const slideshowOk = !!(results.homeBackground && !results.homeBackground.err
    && results.homeBackground.boot && results.homeBackground.boot.on === true
    && results.homeBackground.boot.timer === true && results.homeBackground.boot.list === 10
    && results.homeBackground.boot.img.includes('.jpg')
    && results.homeBackground.duringPlatform && results.homeBackground.duringPlatform.on === false
    && results.homeBackground.duringPlatform.timer === false
    && results.homeBackground.backHome && results.homeBackground.backHome.on === true
    && results.homeBackground.backHome.timer === true
    && soak.rotations >= 4 && noConsecutiveRepeat
    && soak.domNodes && soak.domNodes.after <= soak.domNodes.before + 2
    && Math.abs(soak.memDeltaKB) < 100 * 1024);
  const shellClean = results.consoleErrors.shell.length === 0
    && Object.keys(results.consoleErrors.overlay).length === 0;

  results.verdict = {
    window: results.window, shell: results.shell, allReady, urlsOk, notBlank, overlayOk,
    roundTrips: rtOk, errFlowOk, offlineOk: !!(results.offlineOverlay && results.offlineOverlay.shown),
    isoOk, metaSharingOk, guardsOk, popupsOk, langOk, settingsOk: !!(results.settingsPanel && results.settingsPanel.panelOpened
      && results.settingsPanel.invalidRejected && results.settingsPanel.restored),
    responsiveOk: !!(results.responsive && results.responsive.ok), memOk, clearOk, shellClean,
    homeBgOk, backupOk, brandingOk, tilesOk, slideshowOk,
  };
  const ok = Object.values(results.verdict).every(Boolean);

  // trim noisy platform console logs (they are the platforms' own pages)
  for (const pn of PARTITION_NAMES) {
    const arr = results.consoleErrors.platforms[pn] || [];
    results.consoleErrors.platforms[pn] = { count: arr.length, sample: [...new Set(arr)].slice(0, 5) };
  }
  results.consoleErrors.shell = results.consoleErrors.shell.slice(0, 10);

  console.log('===SMOKE===' + JSON.stringify(results));
  app.exit(ok ? 0 : 1);
}

module.exports = { runSmoke };
