// plugins/anti-spam.js — spam guard (3 warnings, then kick)
const LIMIT = 8;          // messages
const WINDOW = 10000;     // within 10 seconds

module.exports = {
  name: 'anti-spam',
  events: {
    message: async (ctx, { db }) => {
      if (!ctx.isGroup) return;
      if (ctx.isAdmin || ctx.isOwner) return;   // never punish admins or the owner

      const key = `spam:${ctx.jid}:${ctx.sender}`;
      const r = (await db.get(key)) || { count: 0, lastMsg: 0, warnings: 0 };
      const now = Date.now();

      if (now - r.lastMsg > WINDOW) r.count = 0;
      r.count++;
      r.lastMsg = now;

      if (r.count > LIMIT) {
        r.warnings++;
        r.count = 0;
        if (r.warnings >= 3) {
          if (ctx.botIsAdmin) {
            await ctx.group.kick(ctx.sender);
            await ctx.reply(`🚫 @${ctx.num(ctx.sender)} kicked for spam`, { mentions: [ctx.sender] });
            r.warnings = 0;
          } else {
            await ctx.reply('Spam detected, but I need admin rights to remove members.');
          }
        } else {
          await ctx.reply(`⚠️ @${ctx.num(ctx.sender)} stop spamming. Warning ${r.warnings}/3`, { mentions: [ctx.sender] });
        }
      }
      await db.set(key, r);
    },
  },
};
