const LINE = '──────────────';

// [title, emoji, commands]. Keep commands grouped here for the menu display.
const CATEGORIES = [
  ['General', '🌐', ['menu', 'alive', 'ping', 'uptime', 'time', 'date', 'owner']],
  ['Group', '👥', ['kick', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'opengroup', 'closegroup', 'setname', 'setdesc']],
  ['Tools', '🛠️', ['rank', 'vv', 'calc', 'reverse', 'say', 'shorturl', 'weather', 'translate', 'qr']],
  ['AI', '🤖', ['ai']],
  ['Download', '📥', ['play', 'yts', 'dl', 'dlimage', 'dlvideo', 'dlaudio', 'apk', 'facebook', 'instagram', 'tgsticker', 'gitzip', 'gitfile', 'npm']],
  ['GitHub', '🐙', ['github', 'repo', 'repos', 'ghsearch', 'ghissues', 'ghcommits', 'ghrelease']],
  ['Settings', '⚙️', ['mode', 'settings', 'setprefix', 'setbotname', 'antilink', 'welcome']],
  ['Fun', '🎉', ['quote', 'fact', 'flip', 'dice', '8ball', 'joke']],
];

function groups(list) {
  const names = list.filter((command) => !command.hidden).map((command) => command.name);
  const known = new Set(CATEGORIES.flatMap(([, , commands]) => commands));
  const sections = CATEGORIES
    .map(([title, icon, commands]) => ({
      title,
      icon,
      commands: commands.filter((name) => names.includes(name)),
    }))
    .filter((section) => section.commands.length);
  const other = names.filter((name) => !known.has(name));
  if (other.length) sections.push({ title: 'Other', icon: '➕', commands: other });
  return sections;
}

function uptime() {
  const seconds = Math.floor(process.uptime());
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

module.exports = [
  {
    name: 'menu',
    alias: ['help'],
    desc: 'Show commands',
    run: async ({ reply, list, prefix, config, sender, num }) => {
      const p = prefix || config.prefix[0];
      const sections = groups(list);
      const total = sections.reduce((count, section) => count + section.commands.length, 0);
      const header = [
        `┌──「 *⚡ ${config.botName}* 」`,
        `│ 👤 @${num(sender)}`,
        `│ 🌍 ${config.publicMode ? 'Public' : 'Private'} · ⏱ ${uptime()}`,
        `│ 📚 ${total} commands · Prefix ${config.prefix.join(' ')}`,
        `└${LINE}`,
      ].join('\n');
      const categoryRows = sections.map((section) => [
        `┌──「 ${section.icon} *${section.title}* (${section.commands.length}) 」`,
        ...section.commands.map((command) => `│ ◦➛ ${p}${command}`),
        `└${LINE}`,
      ].join('\n'));
      const footer = `_Use ${p}<command> to run a command._\n© ADEZ TECH • 2026\n👨‍💻 Dev: Arnold Adez`;
      await reply([header, ...categoryRows, footer].join('\n\n'), { mentions: [sender] });
    },
  },
  {
    name: 'alive',
    desc: 'Check whether the bot is online',
    run: async ({ reply, config }) => reply(`${config.botName} is online and ready.\nUptime: ${uptime()}`),
  },
  {
    name: 'ping',
    desc: 'Check bot response time',
    run: async ({ reply, m, config }) => {
      const sent = Number(m.messageTimestamp) * 1000;
      const ms = sent ? Math.max(0, Date.now() - sent) : 0;
      await reply(`⚡ *${config.botName}*\n🏓 Speed: ${ms} ms`);
    },
  },
  {
    name: 'uptime',
    desc: 'Bot uptime',
    run: async ({ reply, config }) => reply(`⚡ *${config.botName}*\n⏱️ Uptime: ${uptime()}`),
  },
  {
    name: 'time',
    desc: 'Show the current time',
    run: async ({ reply, config }) => reply(`Current time: ${new Date().toLocaleString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC' })}`),
  },
  {
    name: 'date',
    desc: 'Show today’s date',
    run: async ({ reply, config }) => reply(`Today: ${new Date().toLocaleDateString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC', dateStyle: 'full' })}`),
  },
  { name: 'joke', desc: 'Tell a joke', run: async ({ reply }) => reply('Why do programmers prefer dark mode? Because light attracts bugs.') },
  { name: 'fact', desc: 'Share a fun fact', run: async ({ reply }) => reply('Octopuses have three hearts.') },
  { name: 'flip', desc: 'Flip a coin', run: async ({ reply }) => reply(`🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`) },
  { name: 'dice', desc: 'Roll a six-sided die', run: async ({ reply }) => reply(`🎲 You rolled ${Math.floor(Math.random() * 6) + 1}`) },
  {
    name: '8ball',
    desc: 'Ask the magic 8-ball a question',
    run: async ({ reply, text }) => {
      if (!text) return reply('Ask a question after the command.');
      const answers = ['Yes.', 'No.', 'Definitely.', 'It is uncertain—try again later.', 'Very likely.'];
      await reply(answers[Math.floor(Math.random() * answers.length)]);
    },
  },
  {
    name: 'owner',
    desc: 'Show the owner contact',
    run: async ({ reply, config }) => {
      const link = config.owner ? `https://wa.me/${config.owner}` : 'Not set (add OWNER_NUMBER)';
      await reply(`👑 *Owner*\n${LINE}\n🤖 ${config.botName}\n💬 ${link}\n👨‍💻 Dev: Arnold Adez\n\n© ADEZ TECH • 2026`);
    },
  },
];
