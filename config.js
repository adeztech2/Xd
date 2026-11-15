// Empty string means "no owner set". Only messages sent from the linked account
// (fromMe) get owner rights until OWNER_NUMBER is provided.
const owner = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const prefixEnv = (process.env.PREFIX || '').trim();

module.exports = {
  botName: process.env.BOT_NAME || 'ADEZ XMD',
  prefix: prefixEnv ? [prefixEnv] : ['.', '!', '/'],
  owner,
  pairNumber: (process.env.PAIR_NUMBER || owner).replace(/\D/g, ''),
  publicMode: (process.env.MODE || 'private').toLowerCase() === 'public',
  sessionDir: './session',
  botTagline: process.env.BOT_TAGLINE || 'The best bot in the universe',
  botPic: process.env.BOT_PIC || 'https://u.pone.rs/tntebijt.jpeg',
  botRepo: process.env.BOT_REPO || 'adeztech2/adez-md',

  // Brand styling for all bot replies. This mimics a WhatsApp business/status card look.
  replyStyle: {
    enabled: process.env.BRAND_QUOTE !== 'off', // set BRAND_QUOTE=off to send plain replies
    title: 'WhatsApp Business',
    subtitle: 'Status',
    contactLabel: 'Contact',
    contactValue: process.env.BOT_CONTACT || 'Arnold Adez',
    divider: '━━━━━━━━━━━━━━',
  },

  autoRead: true,
  autoTyping: true,
  autoStatusView: true,
  autoStatusReact: { enabled: true, emoji: '💚' },
  autoRecording: false,
  chatbot: { enabled: false },

  antiCall: true,
  antiDelete: true,
  antiEdit: false, // owner can enable: .toggle antiedit on (it posts a public notice on every edit)
  antiLink: { enabled: true, action: 'delete', whitelist: ['youtube.com', 'youtu.be'] },
  warnLimit: 3,
  // Words come from BADWORDS (comma separated). Empty = nothing is deleted.
  antiBadword: { enabled: true, action: 'delete', words: (process.env.BADWORDS || '').split(',').map((w) => w.trim()).filter(Boolean) },

  welcome: true,
  welcomeMessage: 'Welcome @user 👋\nType .menu for commands',
  leaveMessage: 'Goodbye @user',

  groupEvents: { enabled: true },
  levelSystem: { enabled: true, xpPerMsg: 5, cooldown: 60000 },

  startupAlert: {
    enabled: true,
    timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  },

  sendDelay: [0, 300], // short pause only; long delays slow replies down
  rateLimit: { enabled: true, window: 60000, maxRequests: 30 },
};
