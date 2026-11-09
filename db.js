// Tiny key-value store (async get/set/del). Postgres when DATABASE_URL is set, otherwise data/db.json.
// Writes are batched every 10s. index.js calls flush() during shutdown, so pending writes are saved.
const fs = require('fs');
const path = require('path');
const { pool } = require('./pg');

const file = path.join(__dirname, 'data', 'db.json');
const store = new Map();
const dirty = new Set();

if (!pool) {
  try {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) store.set(k, v);
  } catch {}
}

async function flush() {
  if (!dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  try {
    if (pool) {
      for (const k of keys) {
        if (store.has(k)) {
          await pool.query(
            'INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            [k, JSON.stringify(store.get(k))]
          );
        } else {
          await pool.query('DELETE FROM kv WHERE key = $1', [k]);
        }
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(store)));
    }
  } catch (e) {
    keys.forEach((k) => dirty.add(k));
    console.error('db flush failed:', e.message);
  }
}

setInterval(flush, 10000).unref();

module.exports = {
  get: async (k) => {
    if (store.has(k)) return store.get(k);
    if (pool) {
      const r = await pool.query('SELECT value FROM kv WHERE key = $1', [k]);
      if (r.rows[0]) {
        const v = JSON.parse(r.rows[0].value);
        store.set(k, v);
        return v;
      }
    }
    return undefined;
  },
  set: async (k, v) => {
    store.set(k, v);
    dirty.add(k);
    return v;
  },
  del: async (k) => {
    store.delete(k);
    dirty.add(k);
  },
  flush,
};
