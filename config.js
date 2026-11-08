// Empty string means "no owner set". Only messages sent from the linked account
// (fromMe) get owner rights until OWNER_NUMBER is provided.
const owner = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');

const prefixEnv = (process.env.PREFIX || '').trim();

module.exports = {
  botName: process.env.BOT_NAME || 'ADEZ XMD',
  prefix: prefixEnv ? [prefixEnv] : ['.', '!', '/'],
  owner,                                   // country code + number, no +
  pairNumber: (process.env.PAIR_NUMBER || owner).replace(/\D/g, ''),
  // Public by default so commands work for incoming messages on a fresh deploy.
  // Set MODE=private to restrict command access to the owner.
  publicMode: (process.env.MODE || 'public').toLowerCase() === 'public',
  sessionDir: './session',

  // Auto features
  autoRead: true,
  autoTyping: true,
  autoStatusView: true,
  autoStatusReact: { enabled: true, emoji: '💚' },

  // Moderation
  antiCall: true,
  antiDelete: true,
  antiLink: { enabled: true, action: 'kick', whitelist: ['youtube.com', 'youtu.be'] },
  antiBadword: { enabled: true, action: 'delete', words: ['spam'] },

  // Group messages (@user is replaced with the member)
  welcome: true,
  welcomeMessage: 'Welcome @user 👋\nType .menu for commands',
  leaveMessage: 'Goodbye @user',

  // Levels
  levelSystem: { enabled: true, xpPerMsg: 5, cooldown: 60000 },

  // Startup alert
  startupAlert: {
    enabled: true,
    timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  },

  // Conservative pacing and per-user command limits. No setting can guarantee that
  // WhatsApp will never restrict an account; avoid bulk or unsolicited messaging.
  sendDelay: [800, 2500],
  rateLimit: { enabled: true, window: 60000, maxRequests: 30 },
};
