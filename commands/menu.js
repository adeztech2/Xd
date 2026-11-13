const { getGroups, categoryBox, mainText, fullText, numberedText, remember, sendCard } = require('../lib/menu');

module.exports = [
  {
    name: 'menu', alias: ['help'], desc: 'Show the menu (or .menu <category>)',
    run: async (ctx) => {
      const sections = getGroups(ctx.list);
      const wanted = (ctx.args[0] || '').toLowerCase();
      if (wanted) {
        const hit = sections.find((s) => s.title.toLowerCase() === wanted);
        return ctx.reply(hit ? categoryBox(hit) : `No category "${wanted}". Try: ${sections.map((s) => s.title.toLowerCase()).join(', ')}`);
      }
      await sendCard(ctx, mainText(ctx, sections));
    },
  },
  {
    name: 'menu2', desc: 'Full text list of every command',
    run: async (ctx) => { await sendCard(ctx, fullText(ctx, getGroups(ctx.list))); },
  },
  {
    name: 'menu3', desc: 'Reply with a number to open a category',
    run: async (ctx) => {
      const sections = getGroups(ctx.list);
      const sent = await sendCard(ctx, numberedText(ctx, sections));
      remember(sent?.key?.id, sections);
    },
  },
];
