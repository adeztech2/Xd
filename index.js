const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
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
const { importSession } = require('./session-import');

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

let announced = false; // so reconnects don't re-send the alert

// Render / Railway web services need an open port, otherwise they kill the app ("No open ports detected").
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${config.botName} is running`);
    })
    .listen(process.env.PORT, () => console.log(`HTTP keep-alive on port ${process.env.PORT}`));
}

// ── State shared across restarts of the socket ──
let sock = null; // the ONE active socket
let lockClient = null; // Postgres connection that holds the single-instance lock
let starting = false;
const LOCK_ID = 727272;

// Only one instance may use the WhatsApp session at a time. During a Render deploy the new
// instance waits here until the old one has shut down (and released the lock).
async function acquireLock() {
  if (!pool || lockClient) return;
  const client = await pool.connect();
  client.on('error', (e) => {
    console.error('lock connection lost:', e.message);
    process.exit(1); // let Render restart us cleanly
  });
  for (;;) {
    const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (r.rows[0].ok) break;
    console.log('Another instance is running, waiting for it to stop...');
    await new Promise((res) => setTimeout(res, 5000));
  }
  lockClient = client;
  console.log('Instance lock acquired');
}

// Wipes the saved WhatsApp login (used only when WhatsApp says we were really logged out)
async function clearSession() {
  if (pool) {
    await pool.query('DELETE FROM auth_state WHERE id LIKE $1', [`${process.env.SESSION_ID || 'main'}:%`]);
  } else {
    fs.rmSync(config.sessionDir, { recursive: true, force: true });
  }
}

async function start() {
  if (starting) return; // never run two start() calls at once
  starting = true;
  try {
    // End the previous socket so it can't keep reconnecting or fighting with the new one
    if (sock) {
      try { sock.end(undefined); } catch {}
      sock = null;
    }

    await init();
    await acquireLock();
    await importSession();
    console.log(pool ? 'Session storage: Postgres' : 'Session storage: LOCAL files (lost on every redeploy!)');

    const { state, saveCreds } = pool
      ? await usePgAuthState(pool, process.env.SESSION_ID || 'main')
      : await useMultiFileAuthState(config.sessionDir);

    // No pairing codes here. The bot only runs with a session made by the pair page.
    if (!state.creds.registered) {
      console.log('No WhatsApp session found. Create one with your pair page, set SESSION_DATA on Render, then redeploy.');
      return; // stay idle (HTTP server keeps running), no reconnect loop
    }

    const { version } = await fetchLatestBaileysVersion();

    const s = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      // lets WhatsApp re-request messages the other side could not decrypt
      getMessage: async (key) => sentCache.get(key.id) || cache.get(key.id)?.message || undefined,
      msgRetryCounterCache: retryCache,
      // faster group sends (no metadata fetch each time)
      cachedGroupMetadata: async (jid) => metaCache.get(jid)?.meta,
    });
    sock = s;

    throttleSend(s);

    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (s !== sock) return; // ignore events from old sockets

      if (connection === 'open') {
        console.log(`✅ ${config.botName} connected as ${num(s.user.id)}`);

        const a = config.startupAlert;
        if (a?.enabled && !announced) {
          announced = true;
          const text = a.message
            .replace('{bot}', config.botName)
            .replace('{number}', num(s.user.id))
            .replace('{time}', new Date().toLocaleString('en-GB', { timeZone: a.timezone }))
            .replace('{host}', detectHost());
          s.sendMessage(jidNormalizedUser(s.user.id), { text }).catch(() => {});
        }
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

        if (code === DisconnectReason.loggedOut) {
          console.log('Logged out by WhatsApp (401). Clearing the saved session...');
          announced = false;
          await clearSession().catch((e) => console.error('clear session failed:', e.message));
          setTimeout(start, 3000);
        } else if (code === DisconnectReason.connectionReplaced) {
          // Another instance/device is using this login. Do NOT reconnect (that causes a fight).
          console.log('Connection replaced by another instance (440). Exiting.');
          process.exit(0);
        } else {
          console.log(`Connection closed (${code}), reconnecting...`);
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
      if (type !== 'notify') return;
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

const metaCache = new Map();
async function getMeta(s, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.t < 60000) return hit.meta;
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
    if (config.antiDelete && orig && !orig.key.fromMe) {
      const ownerJid = config.owner + '@s.whatsapp.net';
      const who = orig.key.participant || orig.key.remoteJid;
      await sock.sendMessage(ownerJid, {
        text: `🚨 *Anti-Delete*\n👤 @${num(who)}\n💬 ${jid}`,
        mentions: [who],
      });
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
    reply: (text, opts = {}) => sock.sendMessage(jid, { text, ...opts }, { quoted: m }),
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

  // ── Plugin hooks (run for everyone, except the bot's own messages) ──
  if (!m.key.fromMe) {
    for (const p of plugins) {
      if (p.events?.message) await p.events.message(ctx, { db }).catch((e) => console.error(`[${p.name}]`, e.message));
    }
  }

  // ── Commands ──
  const cmd = commands.get((cmdName || '').toLowerCase());
  if (!cmd) return;

  if (!config.publicMode && !isOwner) return;
  if (!isOwner && config.rateLimit?.enabled && limited(sender)) return;
  if (cmd.ownerOnly && !isOwner) return;
  if (cmd.groupOnly && !isGroup) return ctx.reply('Group only command.');
  if (cmd.adminOnly && !ctx.isAdmin) return ctx.reply('Admins only.');
  if (cmd.adminOnly && !ctx.botIsAdmin) return ctx.reply('Make me admin first.');

  if (config.autoRead) sock.readMessages([m.key]).catch(() => {});
  if (config.autoTyping) sock.sendPresenceUpdate('composing', jid).catch(() => {});

  await cmd.run(ctx);
  if (config.autoTyping) sock.sendPresenceUpdate('paused', jid).catch(() => {});
}

// Graceful shutdown: Render sends SIGTERM to the old instance on every deploy.
// Close the socket and release the lock so the new instance can take over cleanly.
function shutdown() {
  console.log('Shutting down...');
  try { sock?.end(undefined); } catch {}
  try { lockClient?.release(); } catch {}
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Anti-crash: log instead of dying (use pm2 / the panel's auto-restart for hard crashes)
process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled:', e?.message || e));

start();
