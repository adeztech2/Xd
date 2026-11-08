// Loads SESSION_ID (base64 of creds.json from the pair page) ONCE per distinct value.
// Never overwrites an existing session, and never re-imports the same SESSION_ID after a
// logout has cleared it (otherwise a dead login would be re-imported and rejected forever).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./pg');

// Fixed database key. SESSION_ID is the credential itself, so it must not be used as a key.
const STORE_KEY = 'main';

async function importSession() {
  const raw = (process.env.SESSION_ID || '').trim();
  if (!raw) return;

  let creds;
  try {
    creds = Buffer.from(raw, 'base64').toString('utf8');
    JSON.parse(creds);
  } catch {
    console.error('SESSION_ID is not valid, ignoring it.');
    return;
  }

  if (pool) {
    const credsId = `${STORE_KEY}:creds`;
    // This id does not match '${STORE_KEY}:%', so clearSession() leaves it alone
    const markerId = `import-marker:${STORE_KEY}`;
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

module.exports = { importSession, STORE_KEY };
