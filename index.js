// Silence libsignal's per-message session dumps. They print key material to the logs.
// Must run before @whiskeysockets/baileys is required.
const SILENCED = ['Closing session', 'Opening session', 'Decrypted message with closed session'];
for (const method of ['log', 'info', 'warn']) {
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
const { importSession, STORE_KEY } = require('./session-import');

const GROUP_LINK = 'https://chat.whatsapp.com/CvpcZcqPckCCIFT1QpQsqs';
const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb8N0xYLikgHxdGh790m';

const commands = new Map();
const list = [];
for (const f of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  for (const c of require('./commands/' + f)) {
    commands.set(c.name, c);
    (c.alias || []).forEach((a) => commands.set(a, c));
    list.push(c);
  }
}

const plugins = [];
const pdir = path.join(__dirname, 'plugins');
if (fs.existsSync(pdir)) {
  for (const f of fs.readdirSync(pdir).filter((f) => f.endsWith('.js'))) plugins.push(require('./plugins/' + f));
}

const cache = new Map();
const MAX_CACHE = 500;
const num = (jid = '') => jid.split('@')[0].split(':')[0];
const mask = (jid = '') => {
  const n = num(jid);
  return n.length > 4 ? `${n.slice(0, 4)}****` : '****';
};

const sentCache = new Map();
const MAX_SENT = 1000;

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

function buildStartupAlert(s) {
  const LINE = '──────────────';
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
    `┌──「 *✨ ${config.botName}* 」`,
    `│ 🟢 Status   Online`,
    `│ 📱 Number   ${num(s.user.id)}`,
    `│ 🕒 Time     ${time}`,
    `│ 🌍 Host     ${detectHost()}`,
    `│ ⚙️ Mode     ${mode}`,
    `│ ⌨️ Prefix   ${prefix}`,
    `│ 🧩 Version  v${version}`,
    `│ 🟢 Node     ${process.version}`,
    `└${LINE}`,
    '',
    `Type ${prefix}menu to get started.`,
  ].join('\n');
}

function formatBotReply(text) {
  if (!config.replyStyle?.enabled) return String(text || '');
  const style = config.replyStyle;
  const header = [
    `${style.title || 'WhatsApp Business'}${style.subtitle ? ` ${style.subtitle ? '•' : ''} ${style.subtitle}` : ''}`,
    `${style.contactLabel || 'Contact'}: ${style.contactValue || config.botName || 'Arnold Adez'}`,
    style.divider || '━━━━━━━━━━━━━━',
  ].join('\n');
  return `${header}\n${String(text || '')}`;
}

let announced = false;

if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${config.botName} is running`);
    })
    .listen(process.env.PORT, () => console.log(`HTTP keep-alive on port ${process.env.PORT}`));
}

let sock = null;
let lockClient = null;
let starting = false;
let replaced = false;
let reconnectTimer = null;
const LOCK_ID = 727272;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(reason, delayMs = 3000) {
  if (replaced || starting) return;
  if (reconnectTimer) return;
  console.log(`${reason} Scheduling reconnect in ${delayMs}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    start();
  }, delayMs);
}

async function acquireLock() {
  if (!pool || lockClient) return;
  const client = await pool.connect();
  client.on('error', (e) => {
    console.error('lock connection lost:', e.message);
    process.exit(1);
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

async function clearSession() {
  if (pool) {
    await pool.query('DELETE FROM auth_state WHERE id LIKE $1', [`${STORE_KEY}:%`]);
  } else {
    fs.rmSync(config.sessionDir, { recursive: true, force: true });
  }
}

async function start() {
  if (starting) return;
  if (replaced) return;
  starting = true;
  try {
    clearReconnectTimer();
    if (sock) {
      try { sock.end(undefined); } catch {}
      sock = null;
    }

    await init();
    await acquireLock();
    await importSession();
    console.log(pool ? 'Session storage: Postgres' : 'Session storage: LOCAL files (lost on every redeploy!)');

    const { state, saveCreds } = pool
      ? await usePgAuthState(pool, STORE_KEY)
      : await useMultiFileAuthState(config.sessionDir);

    if (!state.creds.registered) {
      console.log('No WhatsApp session found. Create one with your pair page, set SESSION_ID in the app config vars, then restart the worker.');
      return;
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
      getMessage: async (key) => sentCache.get(key.id) || cache.get(key.id)?.message || undefined,
      msgRetryCounterCache: retryCache,
      cachedGroupMetadata: async (jid) => metaCache.get(jid)?.meta,
    });
    sock = s;

    throttleSend(s);

    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (s !== sock) return;

      if (connection === 'open') {
        clearReconnectTimer();
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
                { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: CHANNEL_LINK, merchant_url: CHANNEL_LINK }) },
                { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '👥 Join Group', url: GROUP_LINK, merchant_url: GROUP_LINK }) },
              ],
            });
          } catch (e) {
            console.error('startup alert buttons failed:', e.message);
            await s.sendMessage(jid, { text: `${text}\n\n📢 ${CHANNEL_LINK}\n👥 ${GROUP_LINK}` }).catch(() => {});
          }
        }
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

        if (code === DisconnectReason.loggedOut) {
          console.log('Logged out by WhatsApp (401). Clearing the saved session...');
          announced = false;
          clearReconnectTimer();
          await clearSession().catch((e) => console.error('clear session failed:', e.message));
          scheduleReconnect('Session cleared: reconnecting', 3000);
        } else if (code === DisconnectReason.connectionReplaced) {
          console.error('Connection replaced by another instance (440). Reconnect disabled. Restart the worker to take the session back.');
          replaced = true;
          clearReconnectTimer();
          sock = null;
        } else {
          scheduleReconnect(`Connection closed (${code})`, 3000);
        }
      }
    });

    s.ev.on('call', async (calls) => {
      if (!config.antiCall) return;
      for (const c of calls) {
        if (c.status === 'offer') await s.rejectCall(c.id, c.from).catch(() => {});
      }
    });

    s.ev.on('group-participants.update', async ({ id, participants, action }) => {
      metaCache.delete(id);
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
    scheduleReconnect('Start failed', 5000);
  } finally {
    starting = false;
  }
}

function unwrap(msg = {}) {
  return msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg;
}

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

  const proto = m.message.protocolMessage;
  if (proto && proto.type === 0) {
    const orig = cache.get(proto.key?.id);
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
  const body = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || '';

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
    reply: (text, opts = {}) => sock.sendMessage(jid, { text: formatBotReply(text), ...opts }, { quoted: m }),
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

  if (!config.publicMode && !isOwner) return;

  if (!m.key.fromMe) {
    for (const p of plugins) {
      if (p.events?.message) await p.events.message(ctx, { db }).catch((e) => console.error(`[${p.name}]`, e.message));
    }
  }

  const cmd = commands.get((cmdName || '').toLowerCase());
  if (!cmd) return;

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

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down...');
  clearReconnectTimer();
  try { sock?.end(undefined); } catch {}
  if (lockClient) {
    try { await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch {}
    try { lockClient.release(true); } catch {}
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled:', e?.message || e));

start();
