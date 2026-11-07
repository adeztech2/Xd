// Loads the SESSION_DATA from the pair page (base64 of creds.json) on first start.
// Never overwrites an existing session, so restarts keep the newest credentials.
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
    const id = `${process.env.SESSION_ID || 'main'}:creds`;
    await pool.query('INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, creds]);
  } else {
    const file = path.join(config.sessionDir, 'creds.json');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(config.sessionDir, { recursive: true });
      fs.writeFileSync(file, creds);
    }
  }
}

module.exports = { importSession };
