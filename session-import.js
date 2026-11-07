// Loads SESSION_DATA from the pair page (base64 of creds.json) ONCE per distinct value.
// Never overwrites an existing session, and never re-imports the same SESSION_DATA after a
// logout has cleared it (otherwise a dead login would be re-imported and rejected forever).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./pg');

async function importSession() {
  const raw = process.env.SESSION_DATA;
  if (!raw) return;

  let creds;
  try {
    creds = Buffer.from(raw.trim(), 'base64').toString('utf8');
    JSON.parse(creds);
  } catch {
    console.error('SESSION_DATA is not valid, ignoring it.');
    return;
  }

  if (pool) {
    const sid = process.env.SESSION_ID || 'main';
    const credsId = `${sid}:creds`;
    // This id does not match 'main:%', so clearSession() leaves it alone
    const markerId = `import-marker:${sid}`;
    const hash = crypto.createHash('sha256').update(raw.trim()).digest('hex');

    const m = await pool.query('SELECT data FROM auth_state WHERE id = $1', [markerId]);
    if (m.rows[0] && m.rows[0].data === hash) {
      return; // this exact SESSION_DATA was already imported once
    }

    await pool.query('INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [credsId, creds]);
    await pool.query(
      'INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [markerId, hash]
    );
    console.log('SESSION_DATA imported');
  } else {
    const file = path.join(config.sessionDir, 'creds.json');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(config.sessionDir, { recursive: true });
      fs.writeFileSync(file, creds);
    }
  }
}

module.exports = { importSession };
