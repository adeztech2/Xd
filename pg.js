// Postgres connection. Set DATABASE_URL to use it. Without it, the bot uses local files.
// Timeouts make a stalled database fail with an error, instead of waiting forever.
const { Pool } = require('pg');

// Built-in fallback so any host (Render, Heroku, Railway, VPS) works without setting the variable.
// A DATABASE_URL set on the host always wins over this. Password's "$" is encoded as %24.
const DEFAULT_DATABASE_URL =
  'postgresql://postgres.wfrwvcqkdnkurainsogk:x9s%24UkDdyPG5PpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const pool = url
  ? new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 15000, // give up connecting after 15s
      idleTimeoutMillis: 30000,
      query_timeout: 20000,           // give up on a query after 20s
      keepAlive: true,
    })
  : null;

if (pool) {
  pool.on('error', (e) => console.error('postgres pool error:', e.message));
}

async function init() {
  if (!pool) return;
  console.log('Postgres: creating tables if needed...');
  await pool.query('CREATE TABLE IF NOT EXISTS auth_state (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  console.log('Postgres: ready');
}

module.exports = { pool, init };
