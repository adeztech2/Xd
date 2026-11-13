// Per-group protection settings, saved in the db as guard:<group jid>.
const FEATURES = ['link', 'badword', 'bot', 'tag', 'sticker'];
const ACTIONS = ['delete', 'warn', 'kick'];

// Link and badword start from the old global config, the others start off.
function defaults(config) {
  const al = config.antiLink || {};
  const ab = config.antiBadword || {};
  const act = (a) => (ACTIONS.includes(a) ? a : 'delete');
  return {
    link: { on: !!al.enabled, action: act(al.action) },
    badword: { on: !!ab.enabled, action: act(ab.action) },
    bot: { on: false, action: 'kick' },
    tag: { on: false, action: 'delete' },
    sticker: { on: false, action: 'delete' },
    words: [],
  };
}

async function getSettings(db, jid, config) {
  const saved = (await db.get(`guard:${jid}`)) || {};
  const base = defaults(config);
  for (const f of FEATURES) base[f] = { ...base[f], ...(saved[f] || {}) };
  base.words = Array.isArray(saved.words) ? saved.words : [];
  return base;
}

async function saveSettings(db, jid, settings) {
  await db.set(`guard:${jid}`, settings);
}

module.exports = { FEATURES, ACTIONS, getSettings, saveSettings };
