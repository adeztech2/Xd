// Postgres connection. Set DATABASE_URL in your host's env vars (never in source code).
// Without it, the bot uses local files. Timeouts make a stalled database fail with an error.
const { Pool } = require('pg');

// Clean common paste mistakes: surrounding quotes/spaces, "DATABASE_URL=" prefix, leftover [brackets] around the password.
function cleanUrl(raw = '') {
  const unq = (x) => x.trim().replace(/^['"]|['"]$/g, '').trim();
  let u = unq(unq(String(raw)).replace(/^DATABASE_URL\s*=\s*/i, ''));
  u = u.replace(/^postgresql:\/\//i, 'postgres://');
  u = u.replace(/(postgres:\/\/[^:]+:)\[([^\]]*)\](@)/, '$1$2$3');
  return u;
}

const url = cleanUrl(process.env.DATABASE_URL);

// Supabase direct hosts (db.<ref>.supabase.co) are IPv6-only; Render cannot reach them.
const isSupabaseDirect = /@db\.[a-z0-9]+\.supabase\.co(:\d+)?\//i.test(url);

// sslmode in the URL would override our ssl option, so drop it and control SSL with PGSSL.
const connectionString = url.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');

const pool = url
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      query_timeout: 20000,
      keepAlive: true,
    })
  : null;

if (pool) {
  pool.on('error', (e) => console.error('postgres pool error:', e.message));
}

function explain(e) {
  const code = e.code || '';
  if (['ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(code) || /timeout/i.test(e.message)) {
    return isSupabaseDirect
      ? 'Cannot reach the Supabase direct host (it is IPv6-only). In Supabase click Connect -> Session pooler and use that URL (user is postgres.<project-ref>, host aws-0-<region>.pooler.supabase.com, port 5432).'
      : 'Cannot reach the database host. Check the host/port in DATABASE_URL and that the database allows outside connections.';
  }
  if (code === '28P01' || /password authentication failed/i.test(e.message)) {
    return 'Wrong database password (or wrong username for the pooler: it must be postgres.<project-ref>). Reset the password in Supabase and update DATABASE_URL.';
  }
  if (/Tenant or user not found/i.test(e.message)) {
    return 'Pooler rejected the user. Use the username postgres.<project-ref> and the correct region host from Supabase -> Connect.';
  }
  return null;
}

async function init() {
  if (!pool) return;
  console.log('Postgres: creating tables if needed...');
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS auth_state (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  } catch (e) {
    const hint = explain(e);
    if (hint) console.error('Postgres hint:', hint);
    throw e;
  }
  console.log('Postgres: ready');
}

module.exports = { pool, init };
