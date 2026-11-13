// Silence libsignal's per-message session dumps. They print key material to the logs,
// and the "Closing open session" lines are routine noise. Must run before Baileys is loaded.
const SILENCED = [
  'Closing session',
  'Closing open session',
  'Opening session',
  'Removing old closed session',
  'Decrypted message with closed session',
  'Migrating session',
];
for (const method of ['log', 'info', 'warn', 'debug']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (typeof args[0] === 'string' && SILENCED.some((p) => args[0].startsWith(p))) return;
    original(...args);
  };
}

const { loadBaileys } = require('./lib/baileys');
const { jidNormalizedUser } = require('./lib/jid');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { handle, throttleSend, sentCache, cache, metaCache, GROUP_META_TTL } = require('./lib/handler');
const { startKeepAlive } = require('./lib/keepalive');
const { num, mask, buildStartupAlert } = require('./lib/startup');
const { pool, init } = require('./pg');
const { usePgAuthState } = require('./auth-pg');
// SESSION_ID must start with ADEZ-XMD~ (validated in session-import.js)
const { importSession, markSessionRejected, STORE_KEY } = require('./session-import');
const { applyRuntimeSettings } = require('./lib/runtime');

const GROUP_LINK = 'https://chat.whatsapp.com/CvpcZcqPckCCIFT1QpQsqs';
const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb8N0xYLikgHxdGh790m';

const MAX_BAD_SESSION_RETRIES = 3;   // code-500 retries before reconnects stop
const STARTUP_STEP_MS = 30000;       // a startup step that takes longer than this fails and retries
const CONNECT_TIMEOUT_MS = 20000;    // a database connection that takes longer than this fails
const LOCK_PING_MS = 30000;          // how often the lock connection is checked


// Small in-memory store for Baileys' retry counters
class MapCache {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.get(k); }
  set(k, v) { this.m.set(k, v); if (this.m.size > 5000) this.m.delete(this.m.keys().next().value); }
  del(k) { this.m.delete(k); }
  flushAll() { this.m.clear(); }
}
const retryCache = new MapCache();


let announced = false; // so reconnects don't re-send the alert

startKeepAlive(() => !!sock);

// ── State shared across restarts of the socket ──
let sock = null;          // the ONE active socket
let lockClient = null;    // Postgres connection that holds the single-instance lock
let lockTimer = null;     // periodic check that the lock connection is still alive
let starting = false;
let replaced = false;     // set when another device/instance took over this session (440)
let halted = false;       // set when WhatsApp keeps rejecting the saved session (500)
let badRetries = 0;       // code-500 retries since the last successful connection
let shuttingDown = false;
const LOCK_ID = 727272;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fails a step after a time limit, so a stalled step becomes an error and the bot retries.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function endSocket() {
  if (sock) {
    try { sock.end(undefined); } catch {}
    sock = null;
  }
}

// Only one instance may use the WhatsApp session at a time. The lock is held on a
// dedicated Postgres connection. It is checked regularly, and if it is lost the bot
// stops, takes the lock again, and restarts. It never exits for this reason.
async function acquireLock() {
  if (!pool || lockClient) return;
  for (;;) {
    const client = await withTimeout(pool.connect(), CONNECT_TIMEOUT_MS, 'database connection');
    client.on('error', (e) => {
      if (lockClient === client) onLockLost(`connection error: ${e.message}`);
    });
    try {
      const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
      if (r.rows[0].ok) {
        lockClient = client;
        startLockPing();
        console.log('Instance lock acquired');
        return;
      }
      client.release(true);
    } catch (e) {
      try { client.release(true); } catch {}
      throw e;
    }
    console.log('Another instance is running, waiting for it to stop...');
    await sleep(5000);
  }
}

function startLockPing() {
  clearInterval(lockTimer);
  lockTimer = setInterval(async () => {
    try {
      await withTimeout(lockClient.query('SELECT 1'), 15000, 'lock check');
    } catch (e) {
      onLockLost(e.message);
    }
  }, LOCK_PING_MS);
}

// The lock connection dropped (often because the database closed an idle connection).
// Stop the socket, release what is left, and start again, which takes the lock once more.
function onLockLost(reason) {
  if (shuttingDown) return;
  console.error(`Instance lock lost (${reason}). Restarting the connection...`);
  clearInterval(lockTimer);
  lockTimer = null;
  try { lockClient?.release(true); } catch {}
  lockClient = null;
  endSocket();
  setTimeout(start, 3000);
}

// Wipes the saved WhatsApp login (used only when WhatsApp says we were really logged out).
// The rejected SESSION_ID is recorded first, so it is not imported again on the next start.
async function clearSession() {
  await markSessionRejected().catch((e) => console.error('mark rejected failed:', e.message));
  if (pool) {
    await pool.query('DELETE FROM auth_state WHERE id LIKE $1', [`${STORE_KEY}:%`]);
  } else {
    fs.rmSync(config.sessionDir, { recursive: true, force: true });
  }
}

// Deletes only the Signal encryption sessions (not the login). WhatsApp rebuilds them on the next
// message. Fixes "Waiting for this message" caused by sessions that no longer match the phone's.
// Run it once by setting RESET_SIGNAL=1, redeploy, then remove the variable.
let signalReset = false;
async function resetSignalSessions() {
  if (signalReset || process.env.RESET_SIGNAL !== '1') return;
  signalReset = true;
  if (pool) {
    const r = await pool.query(
      "DELETE FROM auth_state WHERE id LIKE $1 AND (id LIKE $2 OR id LIKE $3 OR id LIKE $4)",
      [`${STORE_KEY}:%`, `${STORE_KEY}:session-%`, `${STORE_KEY}:sender-key-%`, `${STORE_KEY}:sender-key-memory-%`]
    );
    console.log(`RESET_SIGNAL: removed ${r.rowCount} saved encryption sessions. Remove RESET_SIGNAL from the config vars.`);
  } else if (fs.existsSync(config.sessionDir)) {
    let n = 0;
    for (const f of fs.readdirSync(config.sessionDir)) {
      if (/^(session|sender-key|sender-key-memory)-/.test(f)) { fs.rmSync(path.join(config.sessionDir, f)); n++; }
    }
    console.log(`RESET_SIGNAL: removed ${n} saved encryption sessions. Remove RESET_SIGNAL from the variables.`);
  }
}

async function start() {
  if (starting) return; // never run two start() calls at once
  if (replaced || halted || shuttingDown) return; // another copy owns this session, or WhatsApp rejected it
  starting = true;
  try {
    console.log('Startup: starting');

    // End the previous socket so it can't keep reconnecting or fighting with the new one
    endSocket();

    console.log(`Startup: storage is ${pool ? 'Postgres' : 'local files'}`);
    if (!pool) {
      console.warn(
        'No DATABASE_URL: the single-instance lock is off. If another copy of this bot uses the same ' +
        'SESSION_ID (on Heroku, Render, or a VPS), WhatsApp will disconnect one of them with code 440. ' +
        'Keep only one copy running.'
      );
    }
    await withTimeout(init(), STARTUP_STEP_MS, 'database setup');

    // Re-apply owner changes (mode, prefix, bot name, toggles) saved before the restart.
    await applyRuntimeSettings(config).catch((e) => console.error('runtime settings failed:', e.message));

    console.log('Startup: taking the instance lock');
    await acquireLock();

    console.log('Startup: importing SESSION_ID');
    await withTimeout(importSession(), STARTUP_STEP_MS, 'session import');
    console.log(pool ? 'Session storage: Postgres' : 'Session storage: LOCAL files (lost on every redeploy!)');

    await withTimeout(resetSignalSessions(), STARTUP_STEP_MS, 'signal reset');

    // Baileys 7 is an ES module, so it is loaded here with import()
    const {
      makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
      Browsers, makeCacheableSignalKeyStore,
    } = await loadBaileys();

    const { state, saveCreds } = pool
      ? await usePgAuthState(pool, STORE_KEY)
      : await useMultiFileAuthState(config.sessionDir);

    // No pairing codes here. The bot only runs with a session made by the pair page.
    if (!state.creds.registered) {
      console.log('No WhatsApp session found. Create one with your pair page, set SESSION_ID in the app config vars, then restart the worker.');
      return; // stay idle, no reconnect loop
    }

    const { version } = await withTimeout(fetchLatestBaileysVersion(), STARTUP_STEP_MS, 'version check');

    const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
    const s = makeWASocket({
      version,
      // 'warn' keeps decrypt / Bad MAC / retry problems visible in the logs (set LOG_LEVEL to change)
      logger,
      // cached keys: far fewer database reads per message, so replies are faster and consistent
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      // lets WhatsApp re-request messages the other side could not decrypt
      getMessage: async (key) => sentCache.get(key.id) || cache.get(key.id)?.message || undefined,
      msgRetryCounterCache: retryCache,
      maxMsgRetryCount: 5,
      retryRequestDelayMs: 250,
      // faster group sends, but only with metadata that is still fresh
      cachedGroupMetadata: async (jid) => {
        const hit = metaCache.get(jid);
        return hit && Date.now() - hit.t < GROUP_META_TTL ? hit.meta : undefined;
      },
    });
    sock = s;

    throttleSend(s);

    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      // Ignore everything from a socket that was replaced or that is no longer in use,
      // including events that arrive after a 440.
      if (s !== sock || replaced) return;

      if (connection === 'open') {
        badRetries = 0;
        console.log(`✅ ${config.botName} connected as ${mask(s.user.id)}`);

        if (config.startupAlert?.enabled && !announced) {
          announced = true;
          const jid = jidNormalizedUser(s.user.id);
          const text = buildStartupAlert(s);
          try {
            await s.sendMessage(jid, {
              text,
              footer: `${config.botName} • ADEZ TECH`,
              interactiveButtons: [
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({
                    display_text: '📢 Follow Channel',
                    url: CHANNEL_LINK,
                    merchant_url: CHANNEL_LINK,
                  }),
                },
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({
                    display_text: '👥 Join Group',
                    url: GROUP_LINK,
                    merchant_url: GROUP_LINK,
                  }),
                },
              ],
            });
          } catch (e) {
            console.error('startup alert buttons failed:', e.message);
            // fall back to plain text with the links, so the alert is never lost
            await s.sendMessage(jid, { text: `${text}\n\n📢 ${CHANNEL_LINK}\n👥 ${GROUP_LINK}` }).catch(() => {});
          }
        }
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(`Connection closed (code ${code}): ${lastDisconnect?.error?.message || 'no details'}`);

        if (code === DisconnectReason.loggedOut) {
          console.log('Logged out by WhatsApp (401). Clearing the saved session...');
          announced = false;
          endSocket();
          await clearSession().catch((e) => console.error('clear session failed:', e.message));
          setTimeout(start, 3000);
        } else if (code === DisconnectReason.badSession) {
          // WhatsApp rejected the saved keys (500). A freshly linked device is often refused
          // once while WhatsApp finishes registering it, so retry with longer waits first.
          badRetries += 1;
          endSocket();
          if (badRetries > MAX_BAD_SESSION_RETRIES) {
            halted = true;
            console.error(
              'WhatsApp keeps rejecting this session (500). Reconnects stopped. ' +
              'Set a new SESSION_ID and restart the worker, or pair again.'
            );
          } else {
            const wait = 30000 * badRetries;
            console.log(
              `Session rejected (500). Keeping the saved keys. ` +
              `Retry ${badRetries}/${MAX_BAD_SESSION_RETRIES} in ${wait / 1000}s...`
            );
            setTimeout(start, wait);
          }
        } else if (code === DisconnectReason.connectionReplaced) {
          // Another copy took over this login. Reconnecting would only start a fight with it,
          // so this copy stays idle until it is restarted. Its lock and socket are released.
          replaced = true;
          endSocket();
          console.error(
            'Another copy of this bot is using the same SESSION_ID (440). This copy has stopped. ' +
            'Stop the other copy, then restart this worker.'
          );
        } else {
          endSocket();
          console.log('Reconnecting in 3s...');
          setTimeout(start, 3000);
        }
      }
    });

    // ── Anti-call ──
    s.ev.on('call', async (calls) => {
      if (!config.antiCall) return;
      for (const c of calls) {
        if (c.status === 'offer') await s.rejectCall(c.id, c.from).catch(() => {});
      }
    });

    // ── Welcome ──
    s.ev.on('group-participants.update', async ({ id, participants, action }) => {
      metaCache.delete(id); // membership changed, refresh on next use
      if (!config.welcome || !['add', 'remove'].includes(action)) return;
      const template = action === 'add' ? config.welcomeMessage : config.leaveMessage;
      if (!template) return;
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.id;
        await s.sendMessage(id, {
          text: template.replace(/@user/g, `@${num(jid)}`),
          mentions: [jid],
        });
      }
    });

    // ── Messages ──
    s.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || s !== sock || replaced) return;
      for (const m of messages) {
        try {
          await handle(s, m);
        } catch (e) {
          console.error('handler error:', e.message);
        }
      }
    });
  } catch (e) {
    console.error('start failed:', e.message);
    setTimeout(start, 5000);
  } finally {
    starting = false;
  }
}

// ── Shutdown ──
// One shutdown path: stop the socket, save pending data, release the lock, then exit.
// Heroku and Render allow about 30 seconds, so a hard exit timer is set as a backstop.
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down...');
  setTimeout(() => process.exit(0), 10000).unref();
  clearInterval(lockTimer);
  endSocket();
  await db.flush().catch(() => {});
  if (lockClient) {
    try { await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch {}
    try { lockClient.release(true); } catch {}
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Unexpected errors leave the process in an unknown state. Log the stack and exit,
// so the platform restarts the worker. The advisory lock keeps that restart safe.
process.on('uncaughtException', (e) => {
  console.error('uncaught:', e?.stack || e);
  process.exit(1);
});

// Baileys sends internal retry requests on sockets that may already be closed. Those
// rejections ("Connection Closed") are harmless, so they are logged once and not as errors.
let closedNoticeShown = false;
process.on('unhandledRejection', (e) => {
  const message = e?.message || String(e);
  if (message === 'Connection Closed') {
    if (!closedNoticeShown) {
      closedNoticeShown = true;
      console.log('Ignored a retry on a closed WhatsApp connection (harmless).');
    }
    return;
  }
  console.error('unhandled:', e?.stack || message);
});

start();

                                
