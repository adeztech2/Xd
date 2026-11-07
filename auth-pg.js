// WhatsApp session stored in Postgres (same job as useMultiFileAuthState, but survives restarts).
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

async function usePgAuthState(pool, sessionId = 'main') {
  const id = (k) => `${sessionId}:${k}`;

  const write = (k, v) =>
    pool.query(
      'INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
      [id(k), JSON.stringify(v, BufferJSON.replacer)]
    );

  const read = async (k) => {
    const r = await pool.query('SELECT data FROM auth_state WHERE id = $1', [id(k)]);
    return r.rows[0] ? JSON.parse(r.rows[0].data, BufferJSON.reviver) : null;
  };

  const del = (k) => pool.query('DELETE FROM auth_state WHERE id = $1', [id(k)]);

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (i) => {
              let v = await read(`${type}-${i}`);
              if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
              data[i] = v;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat in data) {
            for (const i in data[cat]) {
              const v = data[cat][i];
              tasks.push(v ? write(`${cat}-${i}`, v) : del(`${cat}-${i}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

module.exports = { usePgAuthState };
