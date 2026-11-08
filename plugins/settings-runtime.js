// Apply persisted runtime feature switches once when the bot processes a message.
module.exports = {
  name: 'settings-runtime',
  events: {
    message: async (ctx, { db }) => {
      if (ctx._runtimeSettingsLoaded) return;
      ctx._runtimeSettingsLoaded = true;
      const saved = (await db.get('runtime:settings')) || {};
      const paths = {
        autoreact: ['autoReact', 'enabled'], statusview: ['autoStatusView'],
        statusreact: ['autoStatusReact', 'enabled'], typing: ['autoTyping'], autoread: ['autoRead'],
        autorecording: ['autoRecording'], chatbot: ['chatbot', 'enabled'], anticall: ['antiCall'],
        antidelete: ['antiDelete'], antiedit: ['antiEdit'], antilink: ['antiLink', 'enabled'],
        welcome: ['welcome'], groupevents: ['groupEvents', 'enabled'],
      };
      for (const [name, path] of Object.entries(paths)) {
        if (typeof saved[name] !== 'boolean') continue;
        let target = ctx.config;
        for (const key of path.slice(0, -1)) target = target[key];
        target[path[path.length - 1]] = saved[name];
      }
      const prefix = await db.get('runtime:prefix');
      const botName = await db.get('runtime:botName');
      if (typeof prefix === 'string' && prefix) ctx.config.prefix = [prefix];
      if (typeof botName === 'string' && botName) ctx.config.botName = botName;
    },
  },
};
