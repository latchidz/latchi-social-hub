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

    // home branding: the app icon banner replaces the hub logo on the home
    // screen; the background follows the settings policy:
    //   specific bg-XX → static, otherwise slideshow (Home only)
    const isHome = (type || 'home') === 'home';
    $('#ovBanner').hidden = !isHome;
    $('#ovLogo').hidden = isHome;
    if (isHome) {
      if (payload.slideshow && Array.isArray(payload.backgrounds) && payload.backgrounds.length) {
        startBackgroundSlideshow(payload.backgrounds);
      } else if (payload.homeBackground && payload.homeBackground !== 'default') {
        stopBackgroundSlideshow();
        applyBackground(payload.homeBackground);
      } else {
        stopBackgroundSlideshow();
        applyBackground(null);
      }
    } else {
      stopBackgroundSlideshow();
      applyBackground(null);
    }

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

  /* ── background slideshow (home screen only) ─────────────────────────── */

  const BG_SLIDESHOW_INTERVAL = 3000; // ms between backgrounds
  const BG_FADE_MS = 800;             // cross-fade duration
  let slideshowTimer = null;
  let slideshowGen = 0;               // cancels pending fades on stop/switch
  let currentBgIndex = 0;
  let activeBgList = [];

  function bgUrl(id) { return `../../assets/backgrounds/${id}.jpg`; }

  function applyBackground(bgId) {
    const layer = document.getElementById('bgLayer');
    if (!layer) return;
    slideshowGen += 1; // invalidate any pending fade
    if (!bgId) {
      layer.style.opacity = '0';
      layer.style.backgroundImage = '';
      return;
    }
    layer.style.backgroundImage = `url('${bgUrl(bgId)}')`;
    layer.style.opacity = '1';
  }

  function applyBackgroundWithFade(bgId) {
    const layer = document.getElementById('bgLayer');
    if (!layer) return;
    const gen = ++slideshowGen;
    layer.style.opacity = '0';
    setTimeout(() => {
      if (gen !== slideshowGen) return; // stopped/switched meanwhile
      layer.style.backgroundImage = `url('${bgUrl(bgId)}')`;
      layer.style.opacity = '1';
    }, BG_FADE_MS);
  }

  function startBackgroundSlideshow(backgrounds) {
    stopBackgroundSlideshow();
    activeBgList = backgrounds;
    currentBgIndex = 0;
    applyBackground(activeBgList[0]);
    // with a single background there is nothing to rotate — show it
    // statically and keep the timer off (Session B ships bg-02..bg-10)
    if (activeBgList.length < 2) { syncSlideshowDebug(); return; }
    slideshowTimer = setInterval(() => {
      currentBgIndex = (currentBgIndex + 1) % activeBgList.length;
      applyBackgroundWithFade(activeBgList[currentBgIndex]);
    }, BG_SLIDESHOW_INTERVAL);
    syncSlideshowDebug();
  }

  function stopBackgroundSlideshow() {
    if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; }
    activeBgList = [];
    syncSlideshowDebug();
  }

  // minimal introspection state for the dev smoke harness
  function syncSlideshowDebug() {
    window.__lshSlideshow = { active: !!slideshowTimer, list: activeBgList.length };
  }

  window.hubOverlay.onShow(render);
  window.hubOverlay.onHide(() => {
    $('#overlay').classList.remove('visible');
    stopBackgroundSlideshow(); // platforms own the GPU — slideshow pauses
    applyBackground(null);     // release the painted background too
  });

  $('#ovRetry').addEventListener('click', () => window.hubOverlay.retry());

  window.hubOverlay.ready();
})();
