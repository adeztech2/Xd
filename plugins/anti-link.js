// plugins/anti-link.js — removes links in groups (admins/owner exempt)
const config = require('../config');

const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|ke|xyz|info|link|app|gg|tv)\b\S*/gi;

module.exports = {
  name: 'anti-link',
  events: {
    message: async (ctx) => {
      const cfg = config.antiLink;
      if (!cfg?.enabled || !ctx.isGroup || ctx.isAdmin || ctx.isOwner) return;
      if (!ctx.botIsAdmin) return;

      const found = (ctx.body.match(LINK) || []).filter(
        (l) => !(cfg.whitelist || []).some((w) => l.toLowerCase().includes(w.toLowerCase()))
      );
      if (!found.length) return;

      await ctx.sock.sendMessage(ctx.jid, { delete: ctx.m.key }).catch(() => {});
      const tag = { mentions: [ctx.sender] };

      if (cfg.action === 'kick') {
        await ctx.reply(`🚫 @${ctx.num(ctx.sender)} removed for sending links`, tag);
        await ctx.group.kick(ctx.sender);
      } else if (cfg.action === 'warn') {
        await ctx.reply(`⚠️ @${ctx.num(ctx.sender)} links are not allowed here`, tag);
      }
    },
  },
};
