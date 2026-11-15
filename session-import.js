// Loads SESSION_ID (format: ADEZ-XMD~<base64 of creds.json>) once per distinct value.
// A SESSION_ID that WhatsApp rejected (logout) is never imported again, in Postgres or in files.
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./pg');

const SESSION_PREFIX = 'ADEZ-XMD~';
const IMPORT_MARKER_PREFIX = 'import-marker:';

// File mode: hash of the SESSION_ID that WhatsApp rejected. It lives in ./data, outside the
// session folder, so clearing the session does not delete it.
const REJECTED_FILE = path.join(process.cwd(), 'data', 'rejected-session.txt');

// Key files the pair page may bundle with the login. They hold the one-time pre-keys and the
// encryption sessions made while linking, which the bot needs to read the first messages.
const BUNDLE_TYPES = ['app-state-sync-version', 'app-state-sync-key', 'lid-mapping', 'device-list', 'pre-key', 'session'];
const MAX_KEYS = 600;
const MAX_KEY_CHARS = 200000;

// Accepts ADEZ-XMD~<base64 of creds.json>, the same gzipped, and the newer bundle
// (gzipped JSON { v: 2, creds, keys }). Also accepts ADEZ-XMD;;;<gzip base64> from older pair pages.
// Returns { creds, keys } where creds is the creds.json text and keys maps file name to file text.
function parseBundle(raw) {
  let payload;
  let gz = false;
  if (raw.startsWith(SESSION_PREFIX)) payload = raw.slice(SESSION_PREFIX.length);
  else if (raw.startsWith('ADEZ-XMD;;;')) { payload = raw.slice('ADEZ-XMD;;;'.length); gz = true; }
  else throw new Error(`SESSION_ID must start with ${SESSION_PREFIX}`);

  let buf = Buffer.from(payload, 'base64');
  if (gz || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = zlib.gunzipSync(buf); // gzip magic bytes
  const text = buf.toString('utf8');
  const obj = JSON.parse(text); // throws if the payload is not valid JSON
  if (obj && obj.v === 2 && typeof obj.creds === 'string') {
    JSON.parse(obj.creds);
    return { creds: obj.creds, keys: obj.keys && typeof obj.keys === 'object' ? obj.keys : {} };
  }
  return { creds: text, keys: {} };
}

function parseSessionId(raw) {
  return parseBundle(raw).creds;
}

// "pre-key-5.json" -> "pre-key-5" (the database key). Returns null for any file this bot does not accept.
function keyIdFromFile(file) {
  if (!/^[A-Za-z0-9_.\-]{1,200}\.json$/.test(file)) return null; // no slashes, so no path tricks
  const name = file.slice(0, -5);
  if (!BUNDLE_TYPES.some((t) => name.startsWith(t + '-'))) return null;
  return name.replace(/__/g, '/');
}

// Bundled key files that are safe to restore, as [file, text] pairs.
function usableKeys(keys) {
  const out = [];
  for (const [file, text] of Object.entries(keys || {}).slice(0, MAX_KEYS)) {
    if (!keyIdFromFile(file) || typeof text !== 'string' || text.length > MAX_KEY_CHARS) continue;
    try { JSON.parse(text); } catch { continue; }
    out.push([file, text]);
  }
  return out;
}

function hashOf(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Each linked WhatsApp number gets its own database key and its own lock, so many bots can share one
// database without touching each other's session. The key is a hash of the number, never the SESSION_ID
// itself (that is the credential). With no SESSION_ID the old fixed key is used.
function deriveStore() {
  const fallback = { key: 'main', lock: 727272 };
  const raw = (process.env.SESSION_ID || '').trim();
  if (!raw) return fallback;
  try {
    const creds = JSON.parse(parseSessionId(raw));
    const num = String(creds?.me?.id || '').split(':')[0].split('@')[0];
    if (!num) return fallback;
    const h = crypto.createHash('sha256').update(num).digest();
    return { key: 'bot-' + h.toString('hex').slice(0, 12), lock: (h.readUInt32BE(0) & 0x3fffffff) + 1000 };
  } catch {
    return fallback;
  }
}
const { key: STORE_KEY, lock: LOCK_ID } = deriveStore();

function getImportMarkerId() {
  return `${IMPORT_MARKER_PREFIX}${STORE_KEY}`;
}

async function clearImportMarker() {
  if (pool) {
    await pool.query('DELETE FROM auth_state WHERE id = $1', [getImportMarkerId()]);
  }
}

// Call this when WhatsApp logs the session out, before the session files are removed.
async function markSessionRejected() {
  const raw = (process.env.SESSION_ID || '').trim();
  if (!raw || pool) return; // Postgres mode already records the import marker
  fs.mkdirSync(path.dirname(REJECTED_FILE), { recursive: true });
  fs.writeFileSync(REJECTED_FILE, hashOf(raw));
}

// File mode: hash of the SESSION_ID that was last imported, kept outside the session folder.
const IMPORTED_FILE = path.join(process.cwd(), 'data', 'imported-session.txt');

async function importSession() {
  const raw = (process.env.SESSION_ID || '').trim();
  if (!raw) return;

  let creds;
  let keys = [];
  try {
    const bundle = parseBundle(raw);
    creds = bundle.creds;
    keys = usableKeys(bundle.keys);
  } catch (e) {
    console.error(`SESSION_ID is not valid (${e.message}), ignoring it.`);
    return;
  }

  const hash = hashOf(raw);

  if (pool) {
    const credsId = `${STORE_KEY}:creds`;
    const markerId = getImportMarkerId();

    const m = await pool.query('SELECT data FROM auth_state WHERE id = $1', [markerId]);
    if (m.rows[0] && m.rows[0].data === hash) {
      return; // this exact SESSION_ID was already imported (the saved keys may have moved on since)
    }

    // A new SESSION_ID replaces the old login completely: old creds and keys are removed first,
    // otherwise the new account would be mixed with the previous account's keys.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM auth_state WHERE id LIKE $1', [`${STORE_KEY}:%`]);
      await client.query('INSERT INTO auth_state (id, data) VALUES ($1, $2)', [credsId, creds]);
      for (const [file, text] of keys) {
        await client.query(
          'INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
          [`${STORE_KEY}:${keyIdFromFile(file)}`, text]
        );
      }
      await client.query(
        'INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [markerId, hash]
      );
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
    console.log(`SESSION_ID imported (${keys.length} saved keys)`);
  } else {
    if (fs.existsSync(REJECTED_FILE) && fs.readFileSync(REJECTED_FILE, 'utf8').trim() === hash) {
      console.log('This SESSION_ID was rejected by WhatsApp earlier. Set a new SESSION_ID to pair again.');
      return;
    }
    const file = path.join(config.sessionDir, 'creds.json');
    const imported = fs.existsSync(IMPORTED_FILE) ? fs.readFileSync(IMPORTED_FILE, 'utf8').trim() : '';
    if (imported === hash && fs.existsSync(file)) return; // same SESSION_ID, keep the saved (rotated) keys

    fs.rmSync(config.sessionDir, { recursive: true, force: true }); // new SESSION_ID: start clean
    fs.mkdirSync(config.sessionDir, { recursive: true });
    fs.writeFileSync(file, creds);
    for (const [name, text] of keys) fs.writeFileSync(path.join(config.sessionDir, name), text);
    fs.mkdirSync(path.dirname(IMPORTED_FILE), { recursive: true });
    fs.writeFileSync(IMPORTED_FILE, hash);
    console.log(`SESSION_ID imported (${keys.length} saved keys)`);
  }
}

module.exports = {
  importSession,
  parseBundle,
  keyIdFromFile,
  markSessionRejected,
  clearImportMarker,
  STORE_KEY,
  LOCK_ID,
  SESSION_PREFIX,
  getImportMarkerId,
  IMPORT_MARKER_PREFIX,
};
