const owner = (process.env.OWNER_NUMBER || '254111783552').replace(/\D/g, '');

module.exports = {
  botName: 'ADEZ XMD',
  prefix: ['.', '!', '/'],
  owner,                                   // country code + number, no +
  pairNumber: (process.env.PAIR_NUMBER || owner).replace(/\D/g, ''),
  publicMode: false,                       // false = only owner can use commands
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

  // ── Startup alert (sent to the owner when the bot comes online) ──
  startupAlert: {
    enabled: true,
    timezone: 'Africa/Nairobi',
    message: '✅ *{bot}* is online\n🕒 {time}\n🖥 {host}',   // {bot} {time} {host}
  },

  // ── Anti-ban / limits ──
  sendDelay: [800, 2500],                  // random delay (ms) before every outgoing message
  rateLimit: { enabled: true, window: 60000, maxRequests: 30 }, // commands per user (owner exempt)
};
