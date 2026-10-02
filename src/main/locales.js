'use strict';

/**
 * Locale service (main process).
 * Single source of truth: src/renderer/locales/{ar,en}.json — the same files
 * the shell requests over IPC, so renderer and overlay never diverge.
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED = ['ar', 'en'];
const cache = new Map();

function getLocale(lang) {
  const safe = SUPPORTED.includes(lang) ? lang : 'ar';
  if (!cache.has(safe)) {
    const file = path.join(__dirname, '..', 'renderer', 'locales', `${safe}.json`);
    cache.set(safe, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return cache.get(safe);
}

module.exports = { getLocale, SUPPORTED };
