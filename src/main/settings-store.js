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

const DEFAULTS = {
  language: 'ar',            // 'ar' | 'en'
  startupPlatform: 'last',   // 'last' | 'home' | platformId
  lastPlatform: null,        // platformId | null
};

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = { ...DEFAULTS, ...this._read() };
  }

  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
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
