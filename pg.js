// Postgres connection (Heroku Postgres sets DATABASE_URL automatically).
// Without DATABASE_URL the bot falls back to local files (fine for a VPS or panel).
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
const pool = url
  ? new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
      max: 5,
    })
  : null;

async function init() {
  if (!pool) return;
  await pool.query('CREATE TABLE IF NOT EXISTS auth_state (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

module.exports = { pool, init };
