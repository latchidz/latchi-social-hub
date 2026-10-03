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
    // performance mode: main process decides; the class kills CSS transitions
    document.body.classList.toggle('perf', payload.perf === true);

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
      } else if (payload.perf && Array.isArray(payload.backgrounds) && payload.backgrounds.length) {
        // performance mode + "random" choice: ONE static background per Home
        // visit (branded, but no 3s timer / no cross-fade repaints)
        stopBackgroundSlideshow();
        const pick = payload.backgrounds[Math.floor(Math.random() * payload.backgrounds.length)];
        applyBackground(pick);
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

  /* ── background slideshow (home screen only, shuffled) ────────────────── */

  const BG_SLIDESHOW_INTERVAL = 3000; // ms between backgrounds
  const BG_FADE_MS = 800;             // cross-fade duration
  let slideshowTimer = null;
  let slideshowGen = 0;               // cancels pending fades on stop/switch
  let shuffledBackgrounds = [];
  let currentShuffleIndex = 0;
  let activeBgList = [];
  let lastShownBg = null;             // guards against immediate repetition
  let slideshowHistory = [];          // bounded applied-ids trail (debug/verify)

  function bgUrl(id) { return `../../assets/backgrounds/${id}.jpg`; }

  function shuffleArray(array) { // Fisher-Yates — a real uniform shuffle
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function reshuffleAvoidingRepeat() {
    shuffledBackgrounds = shuffleArray(activeBgList);
    // never repeat the currently shown background first in a fresh order
    if (shuffledBackgrounds.length > 1 && shuffledBackgrounds[0] === lastShownBg) {
      [shuffledBackgrounds[0], shuffledBackgrounds[1]] = [shuffledBackgrounds[1], shuffledBackgrounds[0]];
    }
  }

  function noteShown(id) {
    lastShownBg = id;
    slideshowHistory.push(id);
    if (slideshowHistory.length > 24) slideshowHistory.shift();
    syncSlideshowDebug();
  }

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
    // a re-apply of the SAME background (e.g. the user picks the static
    // background the slideshow is already showing) is not a change — keep
    // the history trail = actual visual changes. Slideshow ticks always
    // log via applyBackgroundWithFade, so a real rotation bug stays visible.
    if (bgId !== lastShownBg) noteShown(bgId);
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
      noteShown(bgId);
    }, BG_FADE_MS);
  }

  function startBackgroundSlideshow(backgrounds) {
    stopBackgroundSlideshow();
    activeBgList = backgrounds || [];
    if (!activeBgList.length) { applyBackground(null); return; }
    if (activeBgList.length === 1) {
      applyBackground(activeBgList[0]); // nothing to rotate
      return;
    }
    reshuffleAvoidingRepeat();
    currentShuffleIndex = 0;
    applyBackground(shuffledBackgrounds[0]);
    slideshowTimer = setInterval(() => {
      currentShuffleIndex += 1;
      if (currentShuffleIndex >= shuffledBackgrounds.length) {
        reshuffleAvoidingRepeat(); // fresh order every full cycle
        currentShuffleIndex = 0;
      }
      applyBackgroundWithFade(shuffledBackgrounds[currentShuffleIndex]);
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
    window.__lshSlideshow = {
      perf: document.body.classList.contains('perf'),
      active: !!slideshowTimer,
      list: activeBgList.length,
      index: currentShuffleIndex,
      last: lastShownBg,
      history: slideshowHistory.slice(-12),
    };
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
