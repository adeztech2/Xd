// Owner defaults to the requested WhatsApp number; OWNER_NUMBER can override it.
const owner = (process.env.OWNER_NUMBER || '254111783552').replace(/\D/g, '');
const prefixEnv = (process.env.PREFIX || '').trim();

module.exports = {
  botName: process.env.BOT_NAME || 'ADEZ XMD',
  prefix: prefixEnv ? [prefixEnv] : ['.', '!', '/'],
  owner,
  pairNumber: (process.env.PAIR_NUMBER || owner).replace(/\D/g, ''),
  publicMode: (process.env.MODE || 'public').toLowerCase() === 'public',
  sessionDir: './session',

  autoRead: true,
  autoTyping: false,
  autoStatusView: true,
  autoStatusReact: { enabled: true, emoji: '💚' },
  autoReact: {
    enabled: (process.env.AUTO_REACT || 'true').toLowerCase() === 'true',
    emojis: ['✨', '❤️', '👍', '😂', '🔥'],
  },

  antiCall: true,
  antiDelete: true,
  antiLink: { enabled: true, action: 'kick', whitelist: ['youtube.com', 'youtu.be'] },
  antiBadword: { enabled: true, action: 'delete', words: ['spam'] },
  welcome: true,
  welcomeMessage: 'Welcome @user 👋\nType .menu for commands',
  leaveMessage: 'Goodbye @user',
  levelSystem: { enabled: true, xpPerMsg: 5, cooldown: 60000 },
  startupAlert: { enabled: true, timezone: process.env.TIMEZONE || 'Africa/Nairobi' },

  // Immediate sends; rate limits remain enabled. No setting prevents WhatsApp restrictions.
  sendDelay: [0, 0],
  rateLimit: { enabled: true, window: 60000, maxRequests: 30 },
};
