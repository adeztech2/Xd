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

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./config');
const db = require('./db');
const { pool, init } = require('./pg');
const { usePgAuthState } = require('./auth-pg');
// SESSION_ID must start with ADEZ-XMD~ (validated in session-import.js)
const { importSession, markSessionRejected, STORE_KEY } = require('./session-import');
const { applyRuntimeSettings } = require('./lib/runtime');
const { brandQuote } = require('./lib/brand');

const GROUP_LINK = 'https://chat.whatsapp.com/CvpcZcqPckCCIFT1QpQsqs';
const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb8N0xYLikgHxdGh790m';

const GROUP_META_TTL = 60000;        // group metadata is refreshed after 60 seconds
const MAX_BAD_SESSION_RETRIES = 3;   // code-500 retries before reconnects stop
const STARTUP_STEP_MS = 30000;       // a startup step that takes longer than this fails and retries
const CONNECT_TIMEOUT_MS = 20000;    // a database connection that takes longer than this fails
const LOCK_PING_MS = 30000;          // how often the lock connection is checked

// ── Load commands (each file exports an array) ──
const commands = new Map();
const list = [];
for (const f of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  for (const c of require('./commands/' + f)) {
    commands.set(c.name, c);
    (c.alias || []).forEach((a) => commands.set(a, c));
    list.push(c);
  }
}

// ── Load plugins (plugins/*.js with events: { message }) ──
const plugins = [];
const pdir = path.join(__dirname, 'plugins');
if (fs.existsSync(pdir)) {
  for (const f of fs.readdirSync(pdir).filter((f) => f.endsWith('.js'))) plugins.push(require('./plugins/' + f));
}

const cache = new Map(); // message id -> message (for anti-delete)
const MAX_CACHE = 500;
const num = (jid = '') => jid.split('@')[0].split(':')[0];
// Masked version for logs, so phone numbers don't sit in log history
const mask = (jid = '') => {
  const n = num(jid);
  return n.length > 4 ? `${n.slice(0, 4)}****` : '****';
};

// Messages we sent, kept so WhatsApp retry requests can be answered ("Waiting for this message" fix)
const sentCache = new Map();
const MAX_SENT = 1000;

// Small in-memory store for Baileys' retry counters
class MapCache {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.get(k); }
  set(k, v) { this.m.set(k, v); if (this.m.size > 5000) this.m.delete(this.m.keys().next().value); }
  del(k) { this.m.delete(k); }
  flushAll() { this.m.clear(); }
}
const retryCache = new MapCache();

function detectHost() {
  const e = process.env;
  if (e.RENDER) return 'Render';
  if (e.DYNO) return 'Heroku';
  if (e.RAILWAY_ENVIRONMENT || e.RAILWAY_PROJECT_ID) return 'Railway';
  if (e.KOYEB_APP_NAME) return 'Koyeb';
  if (e.FLY_APP_NAME) return 'Fly.io';
  if (e.REPL_ID || e.REPL_SLUG) return 'Replit';
  if (e.VERCEL) return 'Vercel';
  if (e.CODESPACES) return 'GitHub Codespaces';
  if (e.PROJECT_DOMAIN) return 'Glitch';
  if (e.P_SERVER_UUID) return 'Pterodactyl panel';
  if (process.platform === 'win32') return 'Windows PC';
  return process.platform === 'linux' ? 'VPS / Linux' : 'Local';
}

// Startup message text sent to the bot's own chat when it connects
function buildStartupAlert(s) {
  const tz = config.startupAlert?.timezone || 'UTC';
  const time = new Date().toLocaleString('en-GB', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const { version } = require('./package.json');
  const prefix = (config.prefix || ['.'])[0];
  const mode = config.publicMode ? 'Public' : 'Private';

  return [
    `┏━━━━━━━━━━━━━━━━━━━━┓`,
    `┃   ⚡ ${config.botName} ⚡`,
    `┃   𝗖𝗼𝗻𝗻𝗲𝗰𝘁𝗲𝗱 𝘀𝘂𝗰𝗰𝗲𝘀𝘀𝗳𝘂𝗹𝗹𝘆`,
    `┗━━━━━━━━━━━━━━━━━━━━┛`,
    '',
    `◈ Status   ➜ Online 🟢`,
    `◈ Number   ➜ ${num(s.user.id)}`,
    `◈ Time     ➜ ${time}`,
    `◈ Host     ➜ ${detectHost()}`,
    `◈ Mode     ➜ ${mode}`,
    `◈ Prefix   ➜ ${prefix}`,
    `◈ Version  ➜ v${version}`,
    '',
    `▸ Type ${prefix}menu to begin`,
    `▸ Fast • Secure • Always On`,
    '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `POWERED BY ADEZ TECH`,
  ].join('\n');
}

let announced = false; // so reconnects don't re-send the alert

// ── HTTP server and keep-alive ──
// Render's free web services sleep after 15 minutes without inbound traffic.
// This server answers requests, and the bot pings its own public URL so Render sees traffic.
const KEEP_ALIVE_MS = 10 * 60 * 1000;
const PUBLIC_URL = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
let keepAliveFailures = 0;

if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${config.botName} is running. Connected: ${sock ? 'yes' : 'no'}`);
    })
    .listen(process.env.PORT, () => console.log(`HTTP server on port ${process.env.PORT}`));

  if (PUBLIC_URL) {
    console.log(`Keep-alive: pinging ${PUBLIC_URL} every ${KEEP_ALIVE_MS / 60000} minutes`);
    setInterval(async () => {
      try {
        const res = await fetch(`${PUBLIC_URL}/health`, { signal: AbortSignal.timeout(20000) });
        if (res.ok) {
          keepAliveFailures = 0;
        } else {
          keepAliveFailures += 1;
          console.warn(`Keep-alive: HTTP ${res.status} (${keepAliveFailures} in a row)`);
        }
      } catch (e) {
        keepAliveFailures += 1;
        console.warn(`Keep-alive failed (${keepAliveFailures} in a row): ${e.message}`);
      }
    }, KEEP_ALIVE_MS).unref();
  } else {
    console.warn('Keep-alive is off. Set KEEP_ALIVE_URL to your service URL, or the free web service will sleep.');
  }
}

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

function unwrap(msg = {}) {
  return msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg;
}

// Human-like pacing: every outgoing message waits a random delay, one at a time
function throttleSend(s) {
  const orig = s.sendMessage.bind(s);
  const [min, max] = config.sendDelay || [0, 0];
  let chain = Promise.resolve();
  s.sendMessage = (...a) => {
    const p = chain
      .then(() => (max > 0 ? new Promise((r) => setTimeout(r, min + Math.random() * (max - min))) : null))
      .then(async () => {
        const res = await orig(...a);
        if (res?.key?.id && res.message) {
          sentCache.set(res.key.id, res.message);
          if (sentCache.size > MAX_SENT) sentCache.delete(sentCache.keys().next().value);
        }
        return res;
      });
    chain = p.catch(() => {});
    return p;
  };
}

const hits = new Map();
function limited(sender) {
  const { window, maxRequests } = config.rateLimit;
  const now = Date.now();
  const arr = (hits.get(sender) || []).filter((t) => now - t < window);
  arr.push(now);
  hits.set(sender, arr);
  return arr.length > maxRequests;
}

// Drop rate-limit history older than the window, so memory does not grow forever
setInterval(() => {
  const now = Date.now();
  const window = config.rateLimit?.window || 60000;
  for (const [sender, times] of hits) {
    const recent = times.filter((t) => now - t < window);
    if (recent.length) hits.set(sender, recent);
    else hits.delete(sender);
  }
}, 60000).unref();

const metaCache = new Map();
async function getMeta(s, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.t < GROUP_META_TTL) return hit.meta;
  const meta = await s.groupMetadata(jid);
  metaCache.set(jid, { meta, t: Date.now() });
  return meta;
}

async function handle(sock, m) {
  if (!m.message) return;
  const jid = m.key.remoteJid;

  // Auto-view status
  if (jid === 'status@broadcast') {
    if (config.autoStatusView) await sock.readMessages([m.key]).catch(() => {});
    if (config.autoStatusReact?.enabled && !m.key.fromMe && m.key.participant) {
      const delay = 2000 + Math.random() * 3000;
      setTimeout(() => {
        sock
          .sendMessage(
            'status@broadcast',
            { react: { key: m.key, text: config.autoStatusReact.emoji } },
            { statusJidList: [m.key.participant, jidNormalizedUser(sock.user.id)] }
          )
          .catch(() => {});
      }, delay);
    }
    return;
  }

  // Anti-delete
  const proto = m.message.protocolMessage;
  if (proto && proto.type === 0) {
    const orig = cache.get(proto.key?.id);
    // Skip when no owner is configured, so we never send to an invalid JID
    if (config.antiDelete && config.owner && orig && !orig.key.fromMe) {
      const ownerJid = config.owner + '@s.whatsapp.net';
      const who = orig.key.participant || orig.key.remoteJid;
      await sock.sendMessage(ownerJid, {
        text: `🚨 *Anti-Delete*\n👤 @${num(who)}\n💬 ${jid}`,
        mentions: [who],
      }).catch((e) => console.error('anti-delete alert failed:', e.message));
      await sock.sendMessage(ownerJid, { forward: orig }).catch(() => {});
    }
    return;
  }

  cache.set(m.key.id, m);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);

  const msg = unwrap(m.message);
  const body =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    '';

  const prefix = config.prefix.find((p) => body.startsWith(p));
  const [cmdName, ...args] = prefix ? body.slice(prefix.length).trim().split(/\s+/) : [];

  const isGroup = jid.endsWith('@g.us');
  const sender = isGroup ? m.key.participant : jid;
  const isOwner = m.key.fromMe || num(sender) === config.owner;
  const ci = msg.extendedTextMessage?.contextInfo;

  const ctx = {
    sock, m, jid, sender, isGroup, isOwner, args, body, db,
    text: args.join(' '),
    prefix, list, config, num,
    mentioned: ci?.mentionedJid || [],
    quotedSender: ci?.participant,
    quotedMsg: ci?.quotedMessage,
    reply: (text, opts = {}) => sock.sendMessage(jid, { text, ...opts }, { quoted: brandQuote(sock, m) }),
    group: {
      kick: (u) => sock.groupParticipantsUpdate(jid, [u], 'remove'),
      promote: (u) => sock.groupParticipantsUpdate(jid, [u], 'promote'),
      demote: (u) => sock.groupParticipantsUpdate(jid, [u], 'demote'),
      members: async () => (await getMeta(sock, jid)).participants.map((p) => p.id),
    },
  };

  if (isGroup) {
    try {
      ctx.meta = await getMeta(sock, jid);
      const admins = ctx.meta.participants.filter((p) => p.admin).map((p) => jidNormalizedUser(p.id));
      ctx.isAdmin = admins.includes(jidNormalizedUser(sender)) || isOwner;
      ctx.botIsAdmin = admins.includes(jidNormalizedUser(sock.user.id));
    } catch (e) {
      ctx.isAdmin = isOwner;
      ctx.botIsAdmin = false;
    }
    }
