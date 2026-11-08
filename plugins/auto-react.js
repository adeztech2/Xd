// React once to each incoming message with a configured emoji; respects AUTO_REACT=false.
const config = require('../config');

module.exports = {
  name: 'auto-react',
  events: {
    message: async (ctx) => {
      const settings = config.autoReact;
      if (!settings?.enabled || ctx.m.key.fromMe) return;
      const emojis = Array.isArray(settings.emojis) ? settings.emojis.filter(Boolean) : [];
      if (!emojis.length) return;
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      await ctx.sock.sendMessage(ctx.jid, { react: { text: emoji, key: ctx.m.key } });
    },
  },
};
