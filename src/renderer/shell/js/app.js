'use strict';

/**
 * Shell app logic — boot, sidebar navigation, window controls, settings,
 * language switching, network badge and layout reporting.
 * Talks to the main process exclusively through window.hub (preload bridge).
 */

(function () {
  const state = {
    settings: null,
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

  const PLATFORM_IDS = ['instagram', 'facebook', 'messenger', 'telegram'];

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

    await renderAppInfo();
    renderStartupOptions();
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
    renderLanguageOptions();
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
    $$('.side-item[data-platform]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveSidebar(btn.dataset.platform);
        window.hub.selectPlatform(btn.dataset.platform);
      });
    });

    $('#navLanguage').addEventListener('click', () => openPanel('language'));
    $('#navSettings').addEventListener('click', () => openPanel('settings'));
  }

  function setActiveSidebar(id) {
    $$('.side-item[data-platform]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.platform === id);
    });
    const sysActive = state.panel !== null;
    $('#navLanguage').classList.toggle('active', state.panel === 'language');
    $('#navSettings').classList.toggle('active', state.panel === 'settings');
    if (!sysActive) { /* keep as is */ }
    if (!id) $$('.side-item[data-platform]').forEach((b) => b.classList.remove('active'));
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
  }

  function renderStartupOptions() {
    const wrap = $('#startupOpts');
    wrap.innerHTML = '';
    const opts = [
      { v: 'last', label: t('settings.startup.last') },
      { v: 'home', label: t('settings.startup.home') },
      ...PLATFORM_IDS.map((id) => ({ v: id, label: t('platform.' + id, id) })),
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
