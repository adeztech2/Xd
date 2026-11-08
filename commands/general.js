const LINE = '──────────────';

// [category, command names]
const CATEGORIES = [
  ['General', ['menu', 'alive', 'ping', 'uptime', 'owner']],
  ['Group', ['kick', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'opengroup', 'closegroup', 'setname', 'setdesc']],
  ['Tools', ['rank', 'vv', 'calc', 'reverse', 'say', 'shorturl', 'weather', 'translate', 'qr']],
  ['Download', ['play', 'yts', 'dl', 'dlimage', 'dlvideo', 'dlaudio', 'apk', 'facebook', 'instagram', 'tgsticker', 'gitzip', 'gitfile', 'npm']],
  ['GitHub', ['github', 'repo', 'repos', 'ghsearch', 'ghissues', 'ghcommits', 'ghrelease']],
  ['Settings', ['mode', 'settings', 'setprefix', 'setbotname', 'antilink', 'welcome']],
  ['Fun', ['joke', 'fact', 'flip', 'dice', '8ball']],
];

function commandNames(list) {
  return list.filter((command) => !command.hidden).map((command) => command.name);
}

function menuText(list, config, prefix) {
  const names = commandNames(list);
  const known = new Set(CATEGORIES.flatMap(([, commands]) => commands));
  const sections = CATEGORIES
    .map(([title, commands]) => {
      const available = commands.filter((name) => names.includes(name));
      return available.length ? `${title}\n${available.map((name) => `${prefix}${name}`).join('  ')}` : null;
    })
    .filter(Boolean);
  const other = names.filter((name) => !known.has(name));
  if (other.length) sections.push(`Other\n${other.map((name) => `${prefix}${name}`).join('  ')}`);
  return `⚡ ${config.botName}\nMode: ${config.publicMode ? 'Public' : 'Private'} · Uptime: ${uptime()}\nPrefix: ${config.prefix.join(' ')}\n\n${sections.join('\n\n')}\n\nUse ${prefix}<command> to run a command.`;
}

function uptime() {
  const seconds = Math.floor(process.uptime());
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const jokes = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'A SQL query walks into a bar, walks up to two tables, and asks: “Can I join you?”',
  'There are 10 kinds of people: those who understand binary and those who do not.',
];
const facts = [
  'Octopuses have three hearts.',
  'A day on Venus is longer than its year.',
  'Honey can remain edible for thousands of years when stored properly.',
];
const random = (items) => items[Math.floor(Math.random() * items.length)];

module.exports = [
  {
    name: 'menu',
    alias: ['help'],
    desc: 'Show commands',
    run: async ({ reply, list, prefix, config }) => {
      const p = prefix || config.prefix[0];
      await reply(menuText(list, config, p));
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
      await reply(`${config.botName}\nResponse time: ${ms} ms`);
    },
  },
  {
    name: 'uptime',
    desc: 'Show bot uptime',
    run: async ({ reply }) => reply(`Bot uptime: ${uptime()}`),
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
  {
    name: 'joke',
    desc: 'Tell a joke',
    run: async ({ reply }) => reply(random(jokes)),
  },
  {
    name: 'fact',
    desc: 'Share a fun fact',
    run: async ({ reply }) => reply(random(facts)),
  },
  {
    name: 'flip',
    desc: 'Flip a coin',
    run: async ({ reply }) => reply(`🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`),
  },
  {
    name: 'dice',
    desc: 'Roll a six-sided die',
    run: async ({ reply }) => reply(`🎲 You rolled ${Math.floor(Math.random() * 6) + 1}`),
  },
  {
    name: '8ball',
    desc: 'Ask the magic 8-ball a question',
    run: async ({ reply, text }) => {
      if (!text) return reply('Ask a question after the command.');
      await reply(random(['Yes.', 'No.', 'Definitely.', 'It is uncertain—try again later.', 'Very likely.']));
    },
  },
  {
    name: 'owner',
    desc: 'Show the owner contact',
    run: async ({ reply, config }) => {
      const link = config.owner ? `https://wa.me/${config.owner}` : 'Not set (add OWNER_NUMBER)';
      await reply(`Owner\nBot: ${config.botName}\nContact: ${link}\n${LINE}`);
    },
  },
];
