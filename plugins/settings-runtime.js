// Re-applies saved owner settings on each message. Uses the same flag table as lib/runtime.js.
const { FLAG_PATHS, setPath } = require('../lib/runtime');

module.exports = {
  name: 'settings-runtime',
  events: { message: async (ctx, { db }) => {
    const saved = (await db.get('runtime:settings')) || {};
    for (const [name, path] of Object.entries(FLAG_PATHS)) {
      if (typeof saved[name] === 'boolean') setPath(ctx.config, path, saved[name]);
    }
    const prefix = await db.get('runtime:prefix'); if (typeof prefix === 'string' && prefix) ctx.config.prefix = [prefix];
    const name = await db.get('runtime:botName'); if (typeof name === 'string' && name) ctx.config.botName = name;
    const mode = await db.get('runtime:mode'); if (mode === 'public' || mode === 'private') ctx.config.publicMode = mode === 'public';
  } },
};
