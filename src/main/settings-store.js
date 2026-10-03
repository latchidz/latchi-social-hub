'use strict';

/**
 * SettingsStore — persists user settings to userData/settings.json.
 * Whitelisted keys only; every write is validated and atomic (tmp + rename).
 */

const fs = require('fs');
const path = require('path');

const PLATFORM_IDS = [
  'instagram', 'facebook', 'messenger', 'telegram',
  'whatsapp', 'gmail', 'outlook', 'youtube',
];
const STARTUP_VALUES = ['last', 'home', ...PLATFORM_IDS];
const BG_ID_RE = /^bg-\d{2}$/; // bg-01 .. bg-99 (Session B keeps adding files)

const DEFAULTS = {
  language: 'ar',            // 'ar' | 'en'
  startupPlatform: 'last',   // 'last' | 'home' | platformId
  lastPlatform: null,        // platformId | null
  homeBackground: 'default', // 'default' | bg-XX (specific static background)
  backgroundSlideshow: true, // auto-rotate backgrounds on Home (default on)
};

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = { ...DEFAULTS, ...this._read() };
  }

  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        // drop values that no longer exist (e.g. legacy Phase-1 backgrounds)
        if (raw.homeBackground !== undefined && raw.homeBackground !== 'default'
          && !BG_ID_RE.test(raw.homeBackground)) delete raw.homeBackground;
        if (raw.backgroundSlideshow !== undefined && typeof raw.backgroundSlideshow !== 'boolean') {
          delete raw.backgroundSlideshow;
        }
        return raw;
      }
      return {};
    } catch (_e) {
      return {};
    }
  }

  get(key) { return this.data[key]; }

  getAll() { return { ...this.data }; }

  set(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('settings: invalid patch');
    }
    const clean = {};

    if (patch.language !== undefined) {
      if (!['ar', 'en'].includes(patch.language)) throw new Error('settings: invalid language');
      clean.language = patch.language;
    }
    if (patch.startupPlatform !== undefined) {
      if (!STARTUP_VALUES.includes(patch.startupPlatform)) throw new Error('settings: invalid startupPlatform');
      clean.startupPlatform = patch.startupPlatform;
    }
    if (patch.homeBackground !== undefined) {
      const v = patch.homeBackground;
      if (v !== 'default' && !BG_ID_RE.test(v)) throw new Error('settings: invalid homeBackground');
      clean.homeBackground = v;
    }
    if (patch.backgroundSlideshow !== undefined) {
      if (typeof patch.backgroundSlideshow !== 'boolean') throw new Error('settings: invalid backgroundSlideshow');
      clean.backgroundSlideshow = patch.backgroundSlideshow;
    }
    if (patch.lastPlatform !== undefined) {
      const v = patch.lastPlatform;
      if (!(v === null || PLATFORM_IDS.includes(v))) throw new Error('settings: invalid lastPlatform');
      clean.lastPlatform = v;
    }

    this.data = { ...this.data, ...clean };
    this._persist();
    return this.getAll();
  }

  _persist() {
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[settings] persist failed:', err && err.message);
    }
  }
}

module.exports = SettingsStore;
module.exports.PLATFORM_IDS = PLATFORM_IDS;
