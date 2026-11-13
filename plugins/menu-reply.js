// Opens a category when someone replies to the .menu3 message with its number.
const { pending, categoryBox } = require('../lib/menu');

module.exports = {
  name: 'menu-reply',
  events: {
    message: async (ctx) => {
      const ci = ctx.m.message?.extendedTextMessage?.contextInfo;
      const sections = ci?.stanzaId && pending.get(ci.stanzaId);
      if (!sections) return;
      const n = parseInt((ctx.body || '').trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > sections.length) return;
      await ctx.reply(categoryBox(sections[n - 1]));
    },
  },
};
