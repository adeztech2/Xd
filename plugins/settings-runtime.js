// Persist runtime settings; apply before command/plugin-specific work in each event.
const PATHS = {
  autoreact: ['autoReact', 'enabled'], statusview: ['autoStatusView'], statusreact: ['autoStatusReact', 'enabled'],
  typing: ['autoTyping'], autoread: ['autoRead'], autorecording: ['autoRecording'], chatbot: ['chatbot', 'enabled'],
  anticall: ['antiCall'], antidelete: ['antiDelete'], antiedit: ['antiEdit'], antilink: ['antiLink', 'enabled'],
  welcome: ['welcome'], groupevents: ['groupEvents', 'enabled'],
};
module.exports = {
  name: 'settings-runtime',
  events: { message: async (ctx, { db }) => {
    const saved = (await db.get('runtime:settings')) || {};
    for (const [name, path] of Object.entries(PATHS)) {
      if (typeof saved[name] !== 'boolean') continue;
      let target = ctx.config; for (const key of path.slice(0, -1)) target = target[key]; target[path[path.length - 1]] = saved[name];
    }
    const prefix = await db.get('runtime:prefix'); if (typeof prefix === 'string' && prefix) ctx.config.prefix = [prefix];
    const name = await db.get('runtime:botName'); if (typeof name === 'string' && name) ctx.config.botName = name;
    const mode = await db.get('runtime:mode'); if (mode === 'public' || mode === 'private') ctx.config.publicMode = mode === 'public';
  } },
};
