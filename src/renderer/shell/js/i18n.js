'use strict';

/**
 * I18n — applies localized strings to the shell DOM and flips the whole
 * document between RTL (Arabic) and LTR (English).
 * All UI text comes from locales/{ar,en}.json via the IPC bridge —
 * no hardcoded UI strings in the renderer.
 */

(function () {
  window.I18n = {
    strings: {},
    lang: 'ar',

    apply(strings, lang) {
      this.strings = strings || {};
      this.lang = lang === 'en' ? 'en' : 'ar';

      document.documentElement.lang = this.lang;
      document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';

      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const v = this.strings[el.getAttribute('data-i18n')];
        if (v != null) el.textContent = v;
      });
      document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const v = this.strings[el.getAttribute('data-i18n-title')];
        if (v != null) el.title = v;
      });
    },

    t(key, fallback) {
      const v = this.strings[key];
      return (v != null && v !== '') ? v : (fallback || '');
    },
  };
})();
