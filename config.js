// Empty string means "no owner set". Only messages sent from the linked account
// (fromMe) get owner rights until OWNER_NUMBER is provided.
const owner = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const prefixEnv = (process.env.PREFIX || '').trim();

module.exports = {
  botName: process.env.BOT_NAME || 'ADEZ MD',
  prefix: prefixEnv ? [prefixEnv] : ['.', '!', '/'],
  owner,
  pairNumber: (process.env.PAIR_NUMBER || owner).replace(/\D/g, ''),
  publicMode: (process.env.MODE || 'private').toLowerCase() === 'public',
  sessionDir: './session',

  // Brand styling for all bot replies. This mimics a WhatsApp business/status card look.
  replyStyle: {
    enabled: true,
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
  autoReact: { enabled: true, emojis: ['🙏', '❤️', '👍', '😂', '🔥'] },
  autoRecording: false,
  chatbot: { enabled: false },

  antiCall: true,
  antiDelete: true,
  antiEdit: true,
  antiLink: { enabled: true, action: 'kick', whitelist: ['youtube.com', 'youtu.be'] },
  warnLimit: 3,
  antiBadword: { enabled: true, action: 'delete', words: ['spam'] },

  welcome: true,
  welcomeMessage: 'Welcome @user 👋\nType .menu for commands',
  leaveMessage: 'Goodbye @user',

  groupEvents: { enabled: true },
  levelSystem: { enabled: true, xpPerMsg: 5, cooldown: 60000 },

  startupAlert: {
    enabled: true,
    timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  },

  sendDelay: [800, 2500],
  rateLimit: { enabled: true, window: 60000, maxRequests: 30 },
};
