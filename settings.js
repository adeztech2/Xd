// ADEZ XMD - settings.js
// Central, env-driven settings. No extra dependencies needed.

const fs = require('fs');
const path = require('path');

// ---- Tiny .env loader (no dotenv dependency) ----
for (const file of ['.env', 'set.env']) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

// ---- Helpers ----
const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const bool = (k, d = false) => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
};
const list = (k, d = []) =>
  process.env[k] ? process.env[k].split(',').map(s => s.trim()).filter(Boolean) : d;
const digits = s => String(s || '').replace(/\D/g, '');

// ---- Identity ----
const owner = digits(env('OWNER_NUMBER', '254111783552'));
const sudo = list('SUDO_NUMBERS').map(digits).filter(Boolean);
const devUsernames = list('DEV_USERNAMES', ['arnoldadez']).map(u => u.replace(/^@/, '').toLowerCase());

// ---- Prefix ("none", "off", "no"... = no prefix) ----
const noPrefixWords = ['none', 'null', 'nil', 'off', 'empty', 'no', 'noprefix'];
const rawPrefix = env('PREFIX', '').trim();
const noPrefix = noPrefixWords.includes(rawPrefix.toLowerCase());
const prefix = noPrefix ? [''] : rawPrefix ? [rawPrefix] : ['.', '!', '/'];

// ---- Auto status ----
const autoStatus = {
  view: bool('AUTOVIEW_STATUS', true),
  like: bool('AUTOLIKE_STATUS', true),
  reply: bool('AUTOREPLY_STATUS', false),
  replyText: env('STATUS_REPLY_TEXT', '✅ Status viewed by ADEZ XMD'),
  likeEmojis: list('STATUS_LIKE_EMOJIS', ['💚']),
};

const settings = {
  // Bot identity
  botName: env('BOT_NAME', 'ADEZ XMD'),
  botTagline: env('BOT_TAGLINE', 'The best bot in the universe'),
  botPic: env('BOT_PIC', 'https://u.pone.rs/tntebijt.jpeg'),
  botRepo: env('BOT_REPO', 'adeztech2/Xd'),
  packName: env('BOT_PACKNAME', 'ADEZ XMD'),
  authorName: env('OWNER_NAME', 'Arnold Adez'),
  devUsernames,
  timezone: env('TIMEZONE', 'Africa/Nairobi'),

  // Access
  owner,
  sudo,
  pairNumber: digits(env('PAIR_NUMBER', owner)),
  publicMode: env('MODE', 'private').toLowerCase() === 'public',
  prefix,
  noPrefix,
  noPrefixWords,

  // Session / database
  sessionId: env('SESSION_ID'),
  sessionDir: './session',
  databaseUrl: env('DATABASE_URL'),

  // Brand styling for replies
  replyStyle: {
    enabled: env('BRAND_QUOTE') !== 'off',
    title: 'WhatsApp Business',
    subtitle: 'Status',
    contactLabel: 'Contact',
    contactValue: env('BOT_CONTACT', 'Arnold Adez'),
    divider: '━━━━━━━━━━━━━━',
  },

  // Presence / automation
  autoRead: bool('AUTO_READ', true),
  autoTyping: bool('AUTO_TYPING', true),
  autoRecording: bool('AUTO_RECORDING', false),
  autoStatusView: autoStatus.view,
  autoStatusReact: { enabled: autoStatus.like, emoji: autoStatus.likeEmojis[0] || '💚', emojis: autoStatus.likeEmojis },
  autoStatusReply: { enabled: autoStatus.reply, text: autoStatus.replyText },
  autoReact: {
    enabled: bool('AUTO_REACT', true),
    emojis: list('AUTO_REACT_EMOJIS', ['🙏', '❤️', '👍', '😂', '🔥']),
  },
  chatbot: { enabled: bool('CHATBOT', false) },

  // Protection
  antiCall: bool('ANTI_CALL', true),
  antiDelete: bool('ANTI_DELETE', true),
  antiEdit: bool('ANTI_EDIT', true),
  antiLink: {
    enabled: bool('ANTI_LINK', true),
    action: env('ANTI_LINK_ACTION', 'kick'),
    whitelist: list('ANTI_LINK_WHITELIST', ['youtube.com', 'youtu.be']),
  },
  antiBadword: {
    enabled: bool('ANTI_BADWORD', true),
    action: env('ANTI_BADWORD_ACTION', 'delete'),
    words: list('BADWORDS', ['spam']),
  },
  warnLimit: parseInt(env('WARN_LIMIT', '3'), 10) || 3,

  // Groups
  welcome: bool('WELCOME', true),
  welcomeMessage: env('WELCOME_MESSAGE', 'Welcome @user 👋\nType .menu for commands'),
  leaveMessage: env('LEAVE_MESSAGE', 'Goodbye @user'),
  groupEvents: { enabled: bool('GROUP_EVENTS', true) },
  levelSystem: { enabled: bool('LEVEL_SYSTEM', true), xpPerMsg: 5, cooldown: 60000 },

  // Startup / runtime
  startupAlert: { enabled: bool('STARTUP_ALERT', true), timezone: env('TIMEZONE', 'Africa/Nairobi') },
  sendDelay: [0, 300],
  rateLimit: { enabled: bool('RATE_LIMIT', true), window: 60000, maxRequests: 30 },
};

module.exports = settings;
