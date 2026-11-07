// plugins/anti-badword.js — deletes messages containing blocked words
const config = require('../config');
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  name: 'anti-badword',
  events: {
    message: async (ctx) => {
      const cfg = config.antiBadword;
      if (!cfg?.enabled || !cfg.words?.length || !ctx.isGroup || ctx.isAdmin || ctx.isOwner) return;
      if (!ctx.botIsAdmin) return;

      const re = new RegExp(`\\b(?:${cfg.words.map(esc).join('|')})\\b`, 'i');
      if (!re.test(ctx.body)) return;

      await ctx.sock.sendMessage(ctx.jid, { delete: ctx.m.key }).catch(() => {});
      if (cfg.action === 'warn') {
        await ctx.reply(`⚠️ @${ctx.num(ctx.sender)} watch your language`, { mentions: [ctx.sender] });
      }
    },
  },
};
