'use strict';

/**
 * SettingsStore — persists user settings to userData/settings.json.
 * Whitelisted keys only; every write is validated and atomic (tmp + rename).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
  // Performance mode (owner request: the app must adapt to low-end machines —
  // 4 GB RAM / HDD / no dedicated GPU). When ON: Chromium-default graphics
  // (no forced GPU blocklist bypass — same recipe as the smooth IPTV app),
  // lean switches, LRU view budget, no slideshow, smart video focus.
  // perfAuto marks that it was enabled automatically on first boot.
  perfMode: false,
  perfAuto: false,
};

/**
 * Low-end threshold: machines reporting ≤ 4.9 GB of RAM (a "4 GB" Windows PC
 * reports ~4.0–4.3 GB) get performance mode automatically on first boot.
 * Pure function — unit-tested by the smoke harness with both classes.
 */
function detectLowEnd(totalmemBytes) {
  const mem = Number(totalmemBytes);
  return Number.isFinite(mem) && mem > 0 && mem <= 4.9 * 1024 * 1024 * 1024;
}

class SettingsStore {
  constructor(userDataDir, { totalmemOverride } = {}) {
    this.file = path.join(userDataDir, 'settings.json');
    const raw = this._read();
    this.data = { ...DEFAULTS, ...raw };
    // First boot (no settings file): resolve performance mode from the
    // machine's RAM and persist immediately, so the pre-ready flag decision
    // in main.js (peekPerfMode) and the store agree on every later boot.
    if (!('perfMode' in raw)) {
      const totalmem = Number.isFinite(Number(totalmemOverride))
        ? Number(totalmemOverride) : os.totalmem();
      const auto = detectLowEnd(totalmem);
      this.data.perfMode = auto;
      this.data.perfAuto = auto;
      this._persist();
    }
  }

  /**
   * Pre-ready read used by main.js to pick the graphics/switches profile
   * BEFORE app.whenReady() — command-line switches only work before ready.
   * Returns the persisted perfMode if a settings file exists, otherwise the
   * first-boot auto-detection for this machine.
   */
  static peekPerfMode(userDataDir, totalmemOverride) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
      if (raw && typeof raw === 'object' && typeof raw.perfMode === 'boolean') {
        return raw.perfMode;
      }
    } catch (_e) { /* no file yet → first boot */ }
    const totalmem = Number.isFinite(Number(totalmemOverride))
      ? Number(totalmemOverride) : os.totalmem();
    return detectLowEnd(totalmem);
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
    if (patch.perfMode !== undefined) {
      if (typeof patch.perfMode !== 'boolean') throw new Error('settings: invalid perfMode');
      clean.perfMode = patch.perfMode;
      // a manual toggle always clears the "auto-enabled" badge
      if (patch.perfMode !== this.data.perfMode) clean.perfAuto = false;
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
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
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
module.exports.detectLowEnd = detectLowEnd;
