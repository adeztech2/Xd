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

let announced = false; // so reconnects don't re-send the alert

// Render / Railway web services need an open port, otherwise they kill the app ("No open ports detected").
// Also keeps the process alive. Point an uptime pinger (e.g. UptimeRobot) at the URL on free plans.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${config.botName} is running`);
    })
    .listen(process.env.PORT, () => console.log(`HTTP keep-alive on port ${process.env.PORT}`));
}

// Wipes the saved WhatsApp login (used when WhatsApp says we were logged out)
async function clearSession() {
  if (pool) {
    await pool.query('DELETE FROM auth_state WHERE id LIKE $1', [`${process.env.SESSION_ID || 'main'}:%`]);
  } else {
    fs.rmSync(config.sessionDir, { recursive: true, force: true });
  }
}

async function start() {
  await init();
  await importSession();
  const { state, saveCreds } = pool
    ? await usePgAuthState(pool, process.env.SESSION_ID || 'main')
    : await useMultiFileAuthState(config.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
  });

  throttleSend(sock);

  // Pairing-code login (no QR needed)
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.pairNumber);
        console.log(`\n🔑 Pairing code: ${code}\nWhatsApp > Linked devices > Link with phone number\n`);
      } catch (e) {
        console.error('Pairing failed:', e.message);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`✅ ${config.botName} connected as ${num(sock.user.id)}`);

      const a = config.startupAlert;
      if (a?.enabled && !announced) {
        announced = true;
        const text = a.message
          .replace('{bot}', config.botName)
          .replace('{time}', new Date().toLocaleString('en-GB', { timeZone: a.timezone }))
          .replace('{host}', process.env.DYNO || process.env.HOSTNAME || 'local');
        sock.sendMessage(config.owner + '@s.whatsapp.net', { text }).catch(() => {});
      }
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out by WhatsApp. Clearing the saved session and requesting a new pairing code...');
        announced = false;
        await clearSession().catch((e) => console.error('clear session failed:', e.message));
        setTimeout(start, 3000);
      } else {
        console.log('Connection closed, reconnecting...');
        setTimeout(start, 3000);
      }
    }
  });

  // ── Anti-call ──
  sock.ev.on('call', async (calls) => {
    if (!config.antiCall) return;
    for (const c of calls) {
      if (c.status === 'offer') await sock.rejectCall(c.id, c.from).catch(() => {});
    }
  });

  // ── Welcome ──
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (!config.welcome || !['add', 'remove'].includes(action)) return;
    const template = action === 'add' ? config.welcomeMessage : config.leaveMessage;
    if (!template) return;
    for (const p of participants) {
      const jid = typeof p === 'string' ? p : p.id;
      await sock.sendMessage(id, {
        text: template.replace(/@user/g, `@${num(jid)}`),
        mentions: [jid],
      });
    }
  });

  // ── Messages ──
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        await handle(sock, m);
      } catch (e) {
        console.error('handler error:', e.message);
      }
    }
  });
}

function unwrap(msg = {}) {
  return msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg;
}

// Human-like pacing: every outgoing message waits a random delay, one at a time
function throttleSend(sock) {
  const orig = sock.sendMessage.bind(sock);
  const [min, max] = config.sendDelay || [0, 0];
  let chain = Promise.resolve();
  sock.sendMessage = (...a) => {
    const p = chain
      .then(() => new Promise((r) => setTimeout(r, min + Math.random() * (max - min))))
      .then(() => orig(...a));
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
async function getMeta(sock, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.t < 60000) return hit.meta;
  const meta = await sock.groupMetadata(jid);
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

  if (config.autoRead) await sock.readMessages([m.key]).catch(() => {});
  if (config.autoTyping) await sock.sendPresenceUpdate('composing', jid).catch(() => {});

  await cmd.run(ctx);
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
}

// Anti-crash: log instead of dying (use pm2 / the panel's auto-restart for hard crashes)
process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled:', e?.message || e));

start();
