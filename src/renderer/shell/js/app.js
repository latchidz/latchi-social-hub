'use strict';

/**
 * Shell app logic — boot, sidebar navigation, window controls, settings,
 * language switching, network badge and layout reporting.
 * Talks to the main process exclusively through window.hub (preload bridge).
 */

(function () {
  const state = {
    settings: null,
    platforms: null,
    backgrounds: null,
    strings: null,
    lang: 'ar',
    online: navigator.onLine,
    maximized: false,
    activePlatform: null,
    panel: null,       // 'settings' | 'language' | null
    info: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const t = (key, fb) => window.I18n.t(key, fb);

  // dynamic platform list (from main); fallback mirrors platform-manager order
  const FALLBACK_PLATFORMS = [
    { id: 'instagram', name: 'Instagram' }, { id: 'facebook', name: 'Facebook' },
    { id: 'messenger', name: 'Messenger' }, { id: 'whatsapp', name: 'WhatsApp' },
    { id: 'gmail', name: 'Gmail' }, { id: 'outlook', name: 'Outlook' },
    { id: 'youtube', name: 'YouTube' }, { id: 'telegram', name: 'Telegram' },
  ];

  /* ── boot ─────────────────────────────────────────────────────────────── */

  async function boot() {
    state.settings = await window.hub.getSettings();
    state.lang = state.settings.language === 'en' ? 'en' : 'ar';
    state.strings = await window.hub.getLocale(state.lang);
    window.I18n.apply(state.strings, state.lang);

    bindWindowControls();
    bindSidebar();
    bindNetwork();
    bindSettings();
    bindEvents();
    observeLayout();

    state.platforms = await loadPlatforms();
    renderPlatformTiles();
    state.backgrounds = await loadBackgrounds();

    await renderAppInfo();
    renderStartupOptions();
    renderBackgroundOptions();
    renderSlideshowToggle();
    renderLanguageOptions();
    setOnline(navigator.onLine);

    window.hub.shellReady();
  }

  /* ── i18n refresh ─────────────────────────────────────────────────────── */

  async function switchLanguage(lang) {
    if (lang === state.lang) return;
    state.lang = lang;
    state.settings = await window.hub.setSettings({ language: lang });
    state.strings = await window.hub.getLocale(lang);
    window.I18n.apply(state.strings, lang);
    renderStartupOptions();
    renderBackgroundOptions();
    renderSlideshowToggle();
    renderLanguageOptions();
    renderPlatformTiles(); // refresh tile tooltips (platform names)
  }

  function renderLanguageOptions() {
    $$('button[data-lang]').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.lang === state.lang);
    });
  }

  /* ── window controls ──────────────────────────────────────────────────── */

  function bindWindowControls() {
    $('#btnMin').addEventListener('click', () => window.hub.windowControl('minimize'));
    $('#btnMax').addEventListener('click', () => window.hub.windowControl('maximize'));
    $('#btnClose').addEventListener('click', () => window.hub.windowControl('close'));

    // standard behavior: double-click the title bar toggles maximize
    $('#titlebar').addEventListener('dblclick', (e) => {
      if (!e.target.closest('.wc-btn')) window.hub.windowControl('maximize');
    });

    // the middle button reflects the current window state: shows "restore"
    // when maximized, "maximize" otherwise (icon + localized tooltip)
    const syncMaxBtn = () => {
      const maximized = !!state.winMaximized;
      $('#iconMax').hidden = maximized;
      $('#iconRestore').hidden = !maximized;
      $('#btnMax').title = maximized
        ? window.I18n.t('window.restore', 'Restore')
        : window.I18n.t('window.maximize', 'Maximize');
    };
    window.hub.onWindowState((s) => {
      state.winMaximized = !!(s && s.maximized);
      syncMaxBtn();
    });
    // re-sync after a language switch (I18n.apply rewrote all static titles)
    const _applyLang = window.I18n.apply.bind(window.I18n);
    window.I18n.apply = (strings, lang) => { _applyLang(strings, lang); syncMaxBtn(); };
  }

  function renderWindowButtons() {
    $('#iconMax').hidden = state.maximized;
    $('#iconRestore').hidden = !state.maximized;
  }

  /* ── sidebar ──────────────────────────────────────────────────────────── */

  function bindSidebar() {
    $('#platformTiles').addEventListener('click', (e) => {
      const tile = e.target.closest('.tile[data-platform]');
      if (!tile) return;
      setActiveSidebar(tile.dataset.platform);
      window.hub.selectPlatform(tile.dataset.platform);
    });

    $('#navLanguage').addEventListener('click', () => openPanel('language'));
    $('#navSettings').addEventListener('click', () => openPanel('settings'));
  }

  async function loadPlatforms() {
    try {
      const list = await window.hub.getPlatforms();
      if (Array.isArray(list) && list.length) return list;
    } catch (_e) { /* fall back to static list */ }
    return FALLBACK_PLATFORMS;
  }

  async function loadBackgrounds() {
    try {
      const list = await window.hub.getBackgrounds();
      if (Array.isArray(list) && list.length) return list;
    } catch (_e) { /* fall back to the shipped background */ }
    return [{ id: 'bg-01' }];
  }

  function renderPlatformTiles() {
    const wrap = $('#platformTiles');
    if (!wrap || !state.platforms) return;
    wrap.textContent = '';
    for (const p of state.platforms) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.dataset.platform = p.id;
      tile.title = p.name;
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-label', p.name);
      const img = document.createElement('img');
      img.src = `../../assets/platforms/${p.id}.png`;
      img.onerror = () => { img.src = `../../assets/platforms/${p.id}.jpg`; };
      img.alt = p.name;
      img.draggable = false;
      const name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = p.name;
      tile.append(img, name);
      wrap.appendChild(tile);
    }
    setActiveSidebar(state.activePlatform);
  }

  function setActiveSidebar(id) {
    $$('.tile[data-platform]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.platform === id);
    });
    const sysActive = state.panel !== null;
    $('#navLanguage').classList.toggle('active', state.panel === 'language');
    $('#navSettings').classList.toggle('active', state.panel === 'settings');
    if (!sysActive) { /* keep as is */ }
    if (!id) $$('.tile[data-platform]').forEach((b) => b.classList.remove('active'));
  }

  /* ── panels (settings / language) ─────────────────────────────────────── */

  function openPanel(name) {
    state.panel = name;
    if (name === 'settings') {
      $('#settingsPanel').hidden = false;
    } else if (name === 'language') {
      $('#langModal').hidden = false;
    }
    window.hub.openPanel(name);
    setActiveSidebar(state.activePlatform);
  }

  function closePanel() {
    if (state.panel === 'settings') $('#settingsPanel').hidden = true;
    if (state.panel === 'language') $('#langModal').hidden = true;
    state.panel = null;
    window.hub.closePanel();
    setActiveSidebar(state.activePlatform);
  }

  function bindSettings() {
    $('#btnSettingsBack').addEventListener('click', closePanel);

    // language options (settings card + language modal)
    $$('button[data-lang]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await switchLanguage(btn.dataset.lang);
        if (state.panel === 'language') closePanel();
      });
    });

    // clear sessions (with confirmation)
    $('#btnClearSessions').addEventListener('click', () => { $('#confirmModal').hidden = false; });
    $('#confirmCancel').addEventListener('click', () => { $('#confirmModal').hidden = true; });
    $('#confirmClear').addEventListener('click', async () => {
      $('#confirmModal').hidden = true;
      closePanel();
      await window.hub.clearSessions();
      showToast(t('cleared.toast'));
    });

    // language modal backdrop click closes it
    $('#langModal').addEventListener('click', (e) => {
      if (e.target === $('#langModal')) closePanel();
    });

    bindBackup();
    bindSlideshowToggle();
  }

  /* ── backup: encrypted export / import ────────────────────────────────── */

  let backupMode = null; // 'export' | 'import'

  function openBackupModal(mode) {
    backupMode = mode;
    $('#backupModalTitle').textContent = t(mode === 'export' ? 'backup.exportTitle' : 'backup.importTitle');
    $('#backupModalDesc').textContent = t(mode === 'export' ? 'backup.exportDesc' : 'backup.importDesc');
    $('#backupPassword').placeholder = t('backup.passwordPlaceholder');
    $('#backupPassword').value = '';
    $('#backupModal').hidden = false;
    setTimeout(() => $('#backupPassword').focus(), 50);
  }

  function closeBackupModal() {
    $('#backupModal').hidden = true;
    $('#backupPassword').value = '';
    backupMode = null;
  }

  async function runBackupFlow(password, mode) {
    if (mode === 'export') {
      const res = await window.hub.exportBackup(password);
      if (res && res.ok) showToast(t('backup.exported'));
      else if (res && res.canceled) { /* user closed the save dialog */ }
      else if (res && res.error === 'weak-password') showToast(t('backup.weakPassword'));
      else showToast(t('backup.failed'));
    } else if (mode === 'import') {
      const res = await window.hub.importBackup(password);
      if (res && res.ok) {
        closePanel();
        $('#restartModal').hidden = false;
      } else if (res && res.canceled) { /* user closed the open dialog */ }
      else if (res && res.error === 'weak-password') showToast(t('backup.weakPassword'));
      else if (res && res.error === 'wrong-password' || res && res.error === 'bad-file') showToast(t('backup.wrongPassword'));
      else showToast(t('backup.failed'));
    }
  }

  function bindBackup() {
    $('#btnBackupExport').addEventListener('click', () => openBackupModal('export'));
    $('#btnBackupImport').addEventListener('click', () => openBackupModal('import'));
    $('#backupCancel').addEventListener('click', closeBackupModal);
    $('#backupPassword').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#backupConfirm').click();
    });
    $('#backupConfirm').addEventListener('click', async () => {
      const pwd = $('#backupPassword').value;
      if (!pwd || pwd.length < 4) { showToast(t('backup.weakPassword')); return; }
      const mode = backupMode;
      closeBackupModal();
      await runBackupFlow(pwd, mode);
    });
    $('#backupModal').addEventListener('click', (e) => {
      if (e.target === $('#backupModal')) closeBackupModal();
    });
    $('#restartNow').addEventListener('click', () => window.hub.relaunchApp());
    $('#restartLater').addEventListener('click', () => { $('#restartModal').hidden = true; });
  }

  function renderBackgroundOptions() {
    const wrap = $('#homeBgOptions');
    if (!wrap) return;
    wrap.textContent = '';
    const current = (state.settings && state.settings.homeBackground) || 'default';
    const bgs = (state.backgrounds && state.backgrounds.length)
      ? state.backgrounds : [{ id: 'bg-01' }];
    const entries = [
      { id: 'default', key: 'settings.bgRandom', thumb: null }, // shuffled slideshow
      ...bgs.map((b) => ({
        id: b.id,
        key: 'settings.bg' + b.id.replace('-', ''), // bg-01 → settings.bg01
        thumb: `../../assets/backgrounds/${b.id}-thumb.jpg`,
      })),
    ];
    for (const bg of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-opt' + (bg.id === current ? ' selected' : '');
      btn.dataset.bg = bg.id;
      const thumb = document.createElement('span');
      thumb.className = 'bg-thumb' + (bg.id === 'default' ? ' bg-thumb-default' : '');
      if (bg.thumb) {
        const img = document.createElement('img');
        img.src = bg.thumb;
        img.onerror = () => { img.onerror = null; img.src = bg.thumb.replace('-thumb.jpg', '.jpg'); };
        img.alt = '';
        img.draggable = false;
        thumb.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'bg-name';
      name.textContent = t(bg.key, bg.id);
      btn.append(thumb, name);
      btn.addEventListener('click', async () => {
        if (((state.settings || {}).homeBackground) === bg.id) return;
        state.settings = await window.hub.setSettings({ homeBackground: bg.id });
        renderBackgroundOptions();
        renderSlideshowToggle(); // specific choice auto-disables the show
      });
      wrap.appendChild(btn);
    }
  }

  function renderSlideshowToggle() {
    const btn = $('#slideshowToggle');
    if (!btn) return;
    const on = (state.settings && state.settings.backgroundSlideshow) !== false;
    const specific = !!((state.settings || {}).homeBackground
      && state.settings.homeBackground !== 'default');
    btn.classList.toggle('selected', on);
    btn.classList.toggle('is-inactive', specific);
    btn.querySelector('.opt-state').textContent = on ? t('settings.slideshowOn') : t('settings.slideshowOff');
  }

  function bindSlideshowToggle() {
    const btn = $('#slideshowToggle');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const on = (state.settings && state.settings.backgroundSlideshow) !== false;
      state.settings = await window.hub.setSettings({ backgroundSlideshow: !on });
      renderSlideshowToggle();
    });
  }

  function renderStartupOptions() {
    const wrap = $('#startupOpts');
    wrap.innerHTML = '';
    const opts = [
      { v: 'last', label: t('settings.startup.last') },
      { v: 'home', label: t('settings.startup.home') },
      ...(state.platforms || FALLBACK_PLATFORMS).map((p) => ({ v: p.id, label: t('platform.' + p.id, p.name) })),
    ];
    const current = (state.settings && state.settings.startupPlatform) || 'last';
    opts.forEach((o) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.textContent = o.label;
      btn.classList.toggle('selected', o.v === current);
      btn.addEventListener('click', async () => {
        state.settings = await window.hub.setSettings({ startupPlatform: o.v });
        renderStartupOptions();
      });
      wrap.appendChild(btn);
    });
  }

  async function renderAppInfo() {
    state.info = await window.hub.getAppInfo();
    $('#infoName').textContent = state.info.name;
    $('#infoVersion').textContent = state.info.version;
    $('#infoElectron').textContent = state.info.electron;
    $('#infoCopyright').textContent = state.info.copyright;
  }

  /* ── network ──────────────────────────────────────────────────────────── */

  function setOnline(online) {
    state.online = online;
    $('#netBadge').hidden = online === true;
  }

  function bindNetwork() {
    window.addEventListener('online', () => { setOnline(true); window.hub.reportOnline(true); });
    window.addEventListener('offline', () => { setOnline(false); window.hub.reportOnline(false); });
    window.hub.onNetState((s) => setOnline(!!s.online));
  }

  /* ── main-process events ──────────────────────────────────────────────── */

  function bindEvents() {
    window.hub.onWindowState((s) => {
      state.maximized = !!s.maximized;
      document.body.dataset.focused = s.focused === false ? 'false' : 'true';
      renderWindowButtons();
    });
    window.hub.onPlatformActive((p) => {
      state.activePlatform = p && p.id;
      setActiveSidebar(state.activePlatform);
    });
    window.hub.onPlatformState((_s) => { /* state is visualized by the overlay */ });
  }

  /* ── layout reporting (content area rect → main bounds the views) ─────── */

  function observeLayout() {
    const el = $('#content');
    let lastSent = 0;
    let queued = false;

    const send = () => {
      queued = false;
      const r = el.getBoundingClientRect();
      lastSent = Date.now();
      window.hub.reportLayout({ x: r.left, y: r.top, width: r.width, height: r.height });
    };

    const schedule = () => {
      if (queued) return;
      queued = true;
      const wait = Math.max(0, 60 - (Date.now() - lastSent));
      setTimeout(() => requestAnimationFrame(send), wait);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener('resize', schedule);
    schedule(); // initial rect
  }

  /* ── toast ────────────────────────────────────────────────────────────── */

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
