// Message handling: command/plugin loading, send pacing, rate limit and the main handle().
const fs = require('fs');
const path = require('path');
const { jidNormalizedUser } = require('./jid');
const config = require('../config');
const db = require('../db');
const { brandQuote } = require('./brand');
const { num } = require('./startup');

const GROUP_META_TTL = 60000;        // group metadata is refreshed after 60 seconds

// ── Load commands (each file exports an array) ──
const commands = new Map();
const list = [];
for (const f of fs.readdirSync(path.join(__dirname, '..', 'commands')).filter((f) => f.endsWith('.js'))) {
  for (const c of require('../commands/' + f)) {
    commands.set(c.name, c);
    (c.alias || []).forEach((a) => commands.set(a, c));
    list.push(c);
  }
}

// ── Load plugins (plugins/*.js with events: { message }) ──
const plugins = [];
const pdir = path.join(__dirname, '..', 'plugins');
if (fs.existsSync(pdir)) {
  for (const f of fs.readdirSync(pdir).filter((f) => f.endsWith('.js'))) plugins.push(require('../plugins/' + f));
}

const cache = new Map(); // message id -> message (for anti-delete)
const MAX_CACHE = 500;

// Messages we sent, kept so WhatsApp retry requests can be answered ("Waiting for this message" fix)
const sentCache = new Map();
const MAX_SENT = 1000;

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
  // WhatsApp now often uses @lid ids; the *Alt fields carry the phone-number id when it is known
  const senderPn = isGroup ? (m.key.participantAlt || m.key.participant) : (m.key.remoteJidAlt || jid);
  const isOwner = m.key.fromMe || num(sender) === config.owner || num(senderPn) === config.owner;
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
    // WhatsApp may identify people by phone id (@s.whatsapp.net) or by @lid; match on every id we know.
    const ids = (...list) => list.flat().filter(Boolean).map((x) => num(jidNormalizedUser(x)));
    const senderIds = ids(sender, senderPn);
    const botIds = ids(sock.user?.id, sock.user?.lid, sock.authState?.creds?.me?.id, sock.authState?.creds?.me?.lid);
    const check = (meta) => {
      const admins = meta.participants.filter((p) => p.admin).map((p) => ids(p.id, p.lid, p.phoneNumber));
      const has = (mine) => admins.some((a) => a.some((x) => mine.includes(x)));
      ctx.isAdmin = has(senderIds) || isOwner;
      ctx.botIsAdmin = has(botIds);
    };
    try {
      ctx.meta = await getMeta(sock, jid);
      check(ctx.meta);
      if (!ctx.botIsAdmin || !ctx.isAdmin) {
        // metadata may be up to a minute old (e.g. admin was just granted): refresh once and re-check
        metaCache.delete(jid);
        ctx.meta = await getMeta(sock, jid);
        check(ctx.meta);
      }
    } catch (e) {
      ctx.isAdmin = isOwner;
      ctx.botIsAdmin = false;
    }
  }

  // Access gate: in private mode, strangers get nothing (no plugins, no commands)
  if (!config.publicMode && !isOwner) return;

  // ── Plugin hooks (run for allowed users, except the bot's own messages) ──
  if (!m.key.fromMe) {
    for (const p of plugins) {
      if (p.events?.message) await p.events.message(ctx, { db }).catch((e) => console.error(`[${p.name}]`, e.message));
    }
  }

  // ── Commands ──
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

module.exports = { handle, throttleSend, sentCache, cache, metaCache, GROUP_META_TTL };

      
