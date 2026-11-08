// Loads SESSION_ID (format: ADEZ-XMD~<base64 of creds.json>) ONCE per distinct value.
// Never overwrites an existing session, and never re-imports the same SESSION_ID after a
// logout has cleared it (otherwise a dead login would be re-imported and rejected forever).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./pg');

// Fixed database key. SESSION_ID is the credential itself, so it must not be used as a key.
const STORE_KEY = 'main';
const SESSION_PREFIX = 'ADEZ-XMD~';
const IMPORT_MARKER_PREFIX = 'import-marker:';

function parseSessionId(raw) {
  if (!raw.startsWith(SESSION_PREFIX)) {
    throw new Error(`SESSION_ID must start with ${SESSION_PREFIX}`);
  }
  const creds = Buffer.from(raw.slice(SESSION_PREFIX.length), 'base64').toString('utf8');
  JSON.parse(creds); // throws if the payload is not valid JSON
  return creds;
}

function getImportMarkerId() {
  return `${IMPORT_MARKER_PREFIX}${STORE_KEY}`;
}

async function clearImportMarker() {
  if (pool) {
    await pool.query('DELETE FROM auth_state WHERE id = $1', [getImportMarkerId()]);
  }
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

  if (pool) {
    const credsId = `${STORE_KEY}:creds`;
    const markerId = getImportMarkerId();
    const hash = crypto.createHash('sha256').update(raw).digest('hex');

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
    const file = path.join(config.sessionDir, 'creds.json');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(config.sessionDir, { recursive: true });
      fs.writeFileSync(file, creds);
    }
  }
}

module.exports = { importSession, clearImportMarker, STORE_KEY, SESSION_PREFIX, getImportMarkerId, IMPORT_MARKER_PREFIX };
