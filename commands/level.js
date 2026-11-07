const { levelOf } = require('../plugins/level');

module.exports = [
  {
    name: 'rank',
    alias: ['level'],
    desc: 'Show your XP and level',
    run: async ({ db, sender, reply }) => {
      const r = (await db.get(`xp:${sender}`)) || { xp: 0 };
      const lvl = levelOf(r.xp);
      const next = 10 * (lvl + 1) ** 2;
      await reply(`⭐ Level ${lvl}\nXP: ${r.xp} / ${next}`);
    },
  },
];
