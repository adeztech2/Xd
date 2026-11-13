// Group protection: anti-link, anti-badword, anti-bot, anti-tag, anti-sticker.
// Each one is set per group with .anti (see commands/protect.js).
const { getSettings } = require('../lib/guard');
const { addWarn } = require('../lib/warn');

const LINK = /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|ke|xyz|info|link|app|gg|tv)\b\S*/gi;
const escapeRegex = (w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function unwrap(message = {}) {
  let cur = message;
  for (let i = 0; i < 5 && cur; i++) {
    const next = cur.ephemeralMessage?.message || cur.viewOnceMessage?.message || cur.viewOnceMessageV2?.message || cur.documentWithCaptionMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur || {};
}

// What breaks the rule? Returns a short reason or null.
function violation(ctx, s, msg) {
  const body = ctx.body || '';
  if (s.link.on) {
    const wl = ctx.config.antiLink?.whitelist || [];
    const bad = (body.match(LINK) || []).filter((l) => !wl.some((w) => l.toLowerCase().includes(w.toLowerCase())));
    if (bad.length) return ['link', 'posting a link'];
  }
  if (s.badword.on) {
    const words = [...(ctx.config.antiBadword?.words || []), ...s.words];
    if (words.length && new RegExp(`(?:^|\\W)(?:${words.map(escapeRegex).join('|')})(?:$|\\W)`, 'i').test(body)) return ['badword', 'bad language'];
  }
  if (s.bot.on) {
    const id = ctx.m.key.id || '';
    // Heuristic: messages sent by Baileys-based bots often have 16-character ids starting with BAE5.
    if (id.startsWith('BAE5') && id.length === 16) return ['bot', 'being a bot'];
  }
  if (s.tag.on) {
    const ci = msg.extendedTextMessage?.contextInfo || msg.imageMessage?.contextInfo || msg.videoMessage?.contextInfo;
    const mentions = ci?.mentionedJid?.length || 0;
    if (mentions >= 10 || ci?.groupMentions?.length) return ['tag', 'mass tagging'];
  }
  if (s.sticker.on && msg.stickerMessage) return ['sticker', 'sending stickers'];
  return null;
}

module.exports = {
  name: 'guard',
  events: {
    message: async (ctx, { db }) => {
      if (!ctx.isGroup || ctx.isAdmin || ctx.isOwner || !ctx.botIsAdmin) return;
      const s = await getSettings(db, ctx.jid, ctx.config);
      if (![s.link, s.badword, s.bot, s.tag, s.sticker].some((f) => f.on)) return;

      const found = violation(ctx, s, unwrap(ctx.m.message));
      if (!found) return;
      const [feature, reason] = found;
      const action = s[feature].action;
      const who = `@${ctx.num(ctx.sender)}`;
      const opts = { mentions: [ctx.sender] };

      await ctx.sock.sendMessage(ctx.jid, { delete: ctx.m.key }).catch(() => {});
      if (action === 'kick') {
        await ctx.group.kick(ctx.sender);
        await ctx.reply(`🚫 ${who} removed for ${reason}.`, opts);
      } else if (action === 'warn') {
        const w = await addWarn(ctx, ctx.sender);
        await ctx.reply(w.kicked ? `🚫 ${who} removed after ${w.limit} warnings (${reason}).` : `⚠️ ${who} warned for ${reason}. Warning ${w.count}/${w.limit}`, opts);
      }
    },
  },
};
