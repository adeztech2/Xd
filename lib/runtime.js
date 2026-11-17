// Owner settings are saved in the bot's db and applied at startup, so they survive restarts
// even when the owner only uses their own chat.
const db = require('../db');

// Feature name -> path in config. Used by .toggle and at startup.
const FLAG_PATHS = {
  autoreact: ['autoReact', 'enabled'],
  statusview: ['autoStatusView'],
  statusreact: ['autoStatusReact', 'enabled'],
  typing: ['autoTyping'],
  autoread: ['autoRead'],
  autorecording: ['autoRecording'],
  chatbot: ['chatbot', 'enabled'],
  anticall: ['antiCall'],
  antidelete: ['antiDelete'],
  antiedit: ['antiEdit'],
  antilink: ['antiLink', 'enabled'],
  welcome: ['welcome'],
  groupevents: ['groupEvents', 'enabled'],
};

function setPath(object, path, value) {
  let target = object;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path[path.length - 1]] = value;
}

async function saveFlag(feature, enabled) {
  const saved = (await db.get('runtime:settings')) || {};
  saved[feature] = enabled;
  await db.set('runtime:settings', saved);
}

// Applies every saved owner setting to the live config. Call once at startup.
async function applyRuntimeSettings(config) {
  const saved = (await db.get('runtime:settings')) || {};
  for (const [feature, path] of Object.entries(FLAG_PATHS)) {
    if (typeof saved[feature] === 'boolean') setPath(config, path, saved[feature]);
  }

  const prefix = await db.get('runtime:prefix');
  if (typeof prefix === 'string' && prefix) config.prefix = [prefix];

  const botName = await db.get('runtime:botName');
  if (typeof botName === 'string' && botName) config.botName = botName;

  const mode = await db.get('runtime:mode');
  if (mode === 'public' || mode === 'private') config.publicMode = mode === 'public';
}

module.exports = { FLAG_PATHS, setPath, saveFlag, applyRuntimeSettings };
