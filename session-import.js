// Loads SESSION_ID (format: ADEZ-XMD~<base64 of creds.json>) once per distinct value.
// A SESSION_ID that WhatsApp rejected (logout) is never imported again, in Postgres or in files.
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./pg');

// Fixed database key. SESSION_ID is the credential itself, so it must not be used as a key.
const STORE_KEY = 'main';
const SESSION_PREFIX = 'ADEZ-XMD~';
const IMPORT_MARKER_PREFIX = 'import-marker:';

// File mode: hash of the SESSION_ID that WhatsApp rejected. It lives in ./data, outside the
// session folder, so clearing the session does not delete it.
const REJECTED_FILE = path.join(process.cwd(), 'data', 'rejected-session.txt');

// Accepts ADEZ-XMD~<base64 of creds.json> and also ADEZ-XMD;;;<gzip base64> (older pair pages).
function parseSessionId(raw) {
  let payload;
  let gz = false;
  if (raw.startsWith(SESSION_PREFIX)) payload = raw.slice(SESSION_PREFIX.length);
  else if (raw.startsWith('ADEZ-XMD;;;')) { payload = raw.slice('ADEZ-XMD;;;'.length); gz = true; }
  else throw new Error(`SESSION_ID must start with ${SESSION_PREFIX}`);

  let buf = Buffer.from(payload, 'base64');
  if (gz || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = zlib.gunzipSync(buf); // gzip magic bytes
  const creds = buf.toString('utf8');
  JSON.parse(creds); // throws if the payload is not valid JSON
  return creds;
}

function hashOf(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

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
  try {
    creds = parseSessionId(raw);
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
    console.log('SESSION_ID imported');
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
    fs.mkdirSync(path.dirname(IMPORTED_FILE), { recursive: true });
    fs.writeFileSync(IMPORTED_FILE, hash);
    console.log('SESSION_ID imported');
  }
}

module.exports = {
  importSession,
  markSessionRejected,
  clearImportMarker,
  STORE_KEY,
  SESSION_PREFIX,
  getImportMarkerId,
  IMPORT_MARKER_PREFIX,
};
