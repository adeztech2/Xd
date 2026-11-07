// plugins/level.js — XP per message (with a cooldown so it can't be farmed)
const config = require('../config');
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 10));

module.exports = {
  name: 'level',
  levelOf,
  events: {
    message: async (ctx, { db }) => {
      const cfg = config.levelSystem;
      if (!cfg?.enabled || !ctx.body) return;

      const key = `xp:${ctx.sender}`;
      const r = (await db.get(key)) || { xp: 0, last: 0 };
      const now = Date.now();
      if (now - r.last < cfg.cooldown) return;

      const before = levelOf(r.xp);
      r.xp += cfg.xpPerMsg;
      r.last = now;
      await db.set(key, r);

      const after = levelOf(r.xp);
      if (after > before && ctx.isGroup) {
        await ctx.reply(`🎉 @${ctx.num(ctx.sender)} reached level ${after}!`, { mentions: [ctx.sender] });
      }
    },
  },
};
