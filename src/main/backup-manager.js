'use strict';

/**
 * BackupManager — encrypted export/import of sessions + settings.
 *
 * File format (`.latchi-backup`):
 *   "LSHBKUP1" (8B magic) + salt(16B) + iv(12B) + authTag(16B) + ciphertext
 *   plaintext = JSON { app, format, createdAt, platforms, settings, partitions }
 *
 * Encryption: AES-256-GCM, key derived from the user's password with
 * scrypt (salt stored in the header). The password is NEVER persisted —
 * it exists only in memory for the duration of one operation.
 *
 * What is included (and nothing else):
 *   • per-partition: Cookies*, Local Storage/, IndexedDB/   ← login sessions
 *   • settings.json
 *   Password/Form-data stores (Login Data, Web Data) are deliberately
 *   EXCLUDED — the app never stores passwords, and the backup must not
 *   become the first place that does.
 *
 * Restoring writes the files back and requires an app restart; import
 * merges (never deletes partitions that are not in the archive).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

const MAGIC = Buffer.from('LSHBKUP1', 'utf8'); // 8 bytes
const FORMAT_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024 * 1024; // safety cap per single file

/** Top-level names inside a partition dir that are worth backing up. */
const WANTED_PARTITION_ENTRIES = new Set([
  'Cookies', 'Cookies-journal',
  'Local Storage', 'IndexedDB',
]);

/** Directory names on disk that belong to our partitions. */
function knownPartitionDirs(partitions) {
  const names = new Set();
  for (const p of partitions) {
    names.add(p);                    // e.g. "persist:meta"
    if (p.startsWith('persist:')) names.add(p.slice(8)); // e.g. "meta"
  }
  return names;
}

function listFilesRecursive(rootDir, relDir = '') {
  const out = [];
  const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
  let entries = [];
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const ent of entries) {
    const rel = relDir ? path.join(relDir, ent.name) : ent.name;
    if (ent.isDirectory()) {
      out.push(...listFilesRecursive(rootDir, rel));
    } else if (ent.isFile()) {
      if (ent.name === 'LOCK') continue; // leveldb lock marker — meaningless on restore
      out.push(rel);
    }
  }
  return out;
}

/** Collect all backup-relevant partition files → { dirName: { relPath: base64 } } */
function collectPartitions(partitionNames) {
  const base = path.join(app.getPath('userData'), 'Partitions');
  const known = knownPartitionDirs(partitionNames);
  const result = {};
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }); } catch (_e) { return result; }
  for (const d of dirs) {
    if (!d.isDirectory() || !known.has(d.name)) continue;
    const dirFiles = {};
    for (const entry of WANTED_PARTITION_ENTRIES) {
      const absEntry = path.join(base, d.name, entry);
      let st = null;
      try { st = fs.statSync(absEntry); } catch (_e) { continue; }
      const rels = st.isDirectory() ? listFilesRecursive(path.join(base, d.name), entry) : [entry];
      for (const rel of rels) {
        try {
          const stf = fs.statSync(path.join(base, d.name, rel));
          if (!stf.isFile() || stf.size > MAX_FILE_BYTES) continue;
          dirFiles[rel.split(path.sep).join('/')] = fs.readFileSync(path.join(base, d.name, rel)).toString('base64');
        } catch (_e) { /* locked/rotated file — skip */ }
      }
    }
    if (Object.keys(dirFiles).length) result[d.name] = dirFiles;
  }
  return result;
}

function encryptJson(obj, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

function decryptToJson(buf, password) {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length + 16 + 12 + 16) {
    throw new Error('bad-file');
  }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('bad-file');
  let o = MAGIC.length;
  const salt = buf.subarray(o, o + 16); o += 16;
  const iv = buf.subarray(o, o + 12); o += 12;
  const tag = buf.subarray(o, o + 16); o += 16;
  const key = crypto.scryptSync(String(password), salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(buf.subarray(o)), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (_e) {
    throw new Error('wrong-password'); // GCM auth failed (or corrupted payload)
  }
}

/* ── export ───────────────────────────────────────────────────────────────── */

function exportToPath(filePath, password, { settings, platformIds, partitionNames }) {
  const payload = {
    app: 'latchi-social-hub',
    format: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    platforms: platformIds,
    settings: settings.getAll(),
    partitions: collectPartitions(partitionNames),
  };
  const data = encryptJson(payload, password);
  fs.writeFileSync(filePath, data);
  return { ok: true, path: filePath, size: data.length, platformCount: platformIds.length };
}

function exportWithDialog(win, password, { settings, platformIds, partitionNames }) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const defaultPath = path.join(app.getPath('downloads'), `LATCHI-SOCIAL-HUB-backup-${stamp}.latchi-backup`);
  const r = dialog.showSaveDialogSync(win, {
    title: 'LATCHI SOCIAL HUB — Export',
    defaultPath,
    filters: [{ name: 'LATCHI Backup', extensions: ['latchi-backup'] }],
  });
  if (!r) return { ok: false, canceled: true };
  try {
    return exportToPath(r, password, { settings, platformIds, partitionNames });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* ── import ───────────────────────────────────────────────────────────────── */

function importFromPath(filePath, password) {
  let manifest;
  try {
    manifest = decryptToJson(fs.readFileSync(filePath), password);
  } catch (err) {
    const code = String((err && err.message) || err);
    return { ok: false, error: code === 'wrong-password' ? 'wrong-password' : 'bad-file' };
  }
  if (!manifest || manifest.app !== 'latchi-social-hub' || manifest.format !== FORMAT_VERSION) {
    return { ok: false, error: 'bad-file' };
  }

  const userData = app.getPath('userData');
  const base = path.join(userData, 'Partitions');
  let restored = 0;
  const partitions = (manifest.partitions && typeof manifest.partitions === 'object') ? manifest.partitions : {};
  for (const [dirName, files] of Object.entries(partitions)) {
    if (typeof dirName !== 'string' || !/^[A-Za-z0-9:_ .-]+$/.test(dirName)) continue; // no traversal
    if (!files || typeof files !== 'object') continue;
    for (const [rel, b64] of Object.entries(files)) {
      if (typeof rel !== 'string' || !/^[A-Za-z0-9:_ .\/-]+$/.test(rel) || rel.includes('..')) continue;
      try {
        const target = path.join(base, dirName, ...rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(String(b64), 'base64'));
        restored += 1;
      } catch (_e) { /* best effort per file */ }
    }
  }

  // settings.json — applied on next start (store keeps its in-memory state)
  if (manifest.settings && typeof manifest.settings === 'object') {
    try {
      const clean = {};
      for (const k of ['language', 'startupPlatform', 'lastPlatform', 'homeBackground']) {
        if (manifest.settings[k] !== undefined) clean[k] = manifest.settings[k];
      }
      fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(clean, null, 2), 'utf8');
    } catch (_e) { /* non-fatal */ }
  }

  return { ok: true, restartRequired: true, filesRestored: restored };
}

function importWithDialog(win, password) {
  const r = dialog.showOpenDialogSync(win, {
    title: 'LATCHI SOCIAL HUB — Import',
    properties: ['openFile'],
    filters: [{ name: 'LATCHI Backup', extensions: ['latchi-backup'] }],
  });
  if (!r || !r[0]) return { ok: false, canceled: true };
  try {
    return importFromPath(r[0], password);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

module.exports = {
  exportToPath,       // used by the dev smoke harness (path known in advance)
  importFromPath,     // used by the dev smoke harness
  exportWithDialog,   // used by the IPC layer (native save dialog)
  importWithDialog,   // used by the IPC layer (native open dialog)
  MAGIC,
};
