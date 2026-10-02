'use strict';

/**
 * Overlay logic — receives state payloads from the main process
 * ({ type, platformId, strings }) and renders the matching screen.
 */

(function () {
  const $ = (sel) => document.querySelector(sel);

  let current = null;

  function logoTemplateFor(type, platformId) {
    if (type === 'error' || type === 'timeout') return 'tpl-warning';
    if (type === 'offline') return 'tpl-wifioff';
    if (platformId) return 'tpl-' + platformId;
    return 'tpl-hub';
  }

  const TYPE_CONFIG = {
    loading:    { spinner: true,  retry: false },
    connecting: { spinner: true,  retry: false },
    error:      { spinner: false, retry: true },
    offline:    { spinner: false, retry: true },
    timeout:    { spinner: false, retry: true },
    home:       { spinner: false, retry: false },
  };

  function render(payload) {
    if (!payload) return;
    current = payload;

    const { type, platformId, strings = {} } = payload;
    document.body.dataset.type = type || 'home';
    document.body.dataset.platform = platformId || 'none';

    // home branding: the banner replaces the hub logo on the home screen;
    // the optional background layers beneath the radial gradient
    const isHome = (type || 'home') === 'home';
    $('#ovBanner').hidden = !isHome;
    $('#ovLogo').hidden = isHome;
    const bg = payload.homeBackground && payload.homeBackground !== 'default'
      ? payload.homeBackground : null;
    if (bg) document.body.dataset.bg = bg;
    else delete document.body.dataset.bg;
    $('#bgLayer').classList.toggle('on', !!bg);

    // logo
    const tplId = logoTemplateFor(type, platformId);
    const tpl = document.getElementById(tplId);
    const logoBox = $('#ovLogo');
    logoBox.innerHTML = '';
    if (tpl) logoBox.appendChild(tpl.content.cloneNode(true));

    // copy
    const titleMap = {
      loading: strings.loading,
      connecting: strings.loading,
      error: strings.errorTitle,
      offline: strings.offlineTitle,
      timeout: strings.timeoutTitle,
      home: strings.homeTitle,
    };
    const subMap = {
      loading: '',
      connecting: strings.connecting,
      error: strings.errorSub,
      offline: strings.offlineSub,
      timeout: strings.errorSub,
      home: strings.homeHint,
    };

    const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.home;
    $('#ovTitle').textContent = titleMap[type] || '';
    $('#ovSub').textContent = subMap[type] || '';
    $('#ovSpinner').hidden = !cfg.spinner;
    $('#ovRetry').hidden = !cfg.retry;
    $('#ovRetryText').textContent = strings.retry || '';

    // fade in on the next frame so the transition always runs
    requestAnimationFrame(() => $('#overlay').classList.add('visible'));
  }

  window.hubOverlay.onShow(render);
  window.hubOverlay.onHide(() => $('#overlay').classList.remove('visible'));

  $('#ovRetry').addEventListener('click', () => window.hubOverlay.retry());

  window.hubOverlay.ready();
})();
