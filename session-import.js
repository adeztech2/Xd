// Loads SESSION_ID (format: ADEZ-XMD~<base64 of creds.json>) once per distinct value.
// A SESSION_ID that WhatsApp rejected (logout) is never imported again, in Postgres or in files.
const crypto = require('crypto');
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

function parseSessionId(raw) {
  if (!raw.startsWith(SESSION_PREFIX)) {
    throw new Error(`SESSION_ID must start with ${SESSION_PREFIX}`);
  }
  const creds = Buffer.from(raw.slice(SESSION_PREFIX.length), 'base64').toString('utf8');
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
      return; // this exact SESSION_ID was already imported once
    }

    await pool.query('INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [credsId, creds]);
    await pool.query(
      'INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [markerId, hash]
    );
    console.log('SESSION_ID imported');
  } else {
    if (fs.existsSync(REJECTED_FILE) && fs.readFileSync(REJECTED_FILE, 'utf8').trim() === hash) {
      console.log('This SESSION_ID was rejected by WhatsApp earlier. Set a new SESSION_ID to pair again.');
      return;
    }
    const file = path.join(config.sessionDir, 'creds.json');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(config.sessionDir, { recursive: true });
      fs.writeFileSync(file, creds);
      console.log('SESSION_ID imported');
    }
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
