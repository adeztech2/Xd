// Empty string means "no owner set". Only messages sent from the linked account
// (fromMe) get owner rights until OWNER_NUMBER is provided.
const owner = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');

const prefixEnv = (process.env.PREFIX || '').trim();

module.exports = {
  botName: process.env.BOT_NAME || 'ADEZ XMD',
  prefix: prefixEnv ? [prefixEnv] : ['.', '!', '/'],
  owner,                                   // country code + number, no +
  pairNumber: (process.env.PAIR_NUMBER || owner).replace(/\D/g, ''),
  publicMode: (process.env.MODE || 'private').toLowerCase() === 'public',
  sessionDir: './session',

  // ── Auto features ──
  autoRead: true,
  autoTyping: true,
  autoStatusView: true,
  autoStatusReact: { enabled: true, emoji: '💚' },

  // ── Anti suite ──
  antiCall: true,
  antiDelete: true,                        // forwards deleted messages to the owner
  antiLink: { enabled: true, action: 'kick', whitelist: ['youtube.com', 'youtu.be'] }, // action: delete | warn | kick
  antiBadword: { enabled: true, action: 'delete', words: ['spam'] },                   // action: delete | warn

  // ── Group messages (@user is replaced with the member) ──
  welcome: true,
  welcomeMessage: 'Welcome @user 👋\nType .menu for commands',
  leaveMessage: 'Goodbye @user',

  // ── Levels ──
  levelSystem: { enabled: true, xpPerMsg: 5, cooldown: 60000 },

  // ── Startup alert (sent to the bot's own chat when it comes online) ──
  startupAlert: {
    enabled: true,
    timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  },

  // ── Anti-ban / limits ──
  sendDelay: [800, 2500],                  // random delay (ms) before every outgoing message
  rateLimit: { enabled: true, window: 60000, maxRequests: 30 }, // commands per user (owner exempt)
};
