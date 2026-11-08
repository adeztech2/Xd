const LINE = '──────────────';
const CATEGORIES = [
  ['General', '🌐', ['menu', 'alive', 'ping', 'uptime', 'time', 'date', 'owner']],
  ['Group', '👥', ['kick', 'add', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'closegroup', 'opengroup', 'setname', 'setdesc', 'events']],
  ['Tools', '🛠️', ['rank', 'vv', 'calc', 'reverse', 'say']], ['AI', '🤖', ['ai', 'ask', 'adezai']],
  ['Download', '📥', ['play', 'yts', 'dl', 'dlimage', 'dlvideo', 'dlaudio', 'apk', 'facebook', 'instagram', 'tgsticker', 'gitzip', 'gitfile', 'npm']],
  ['GitHub', '🐙', ['github', 'repo', 'repos', 'ghsearch', 'ghissues', 'ghcommits', 'ghrelease']],
  ['Settings', '⚙️', ['mode', 'toggle', 'settings', 'setprefix', 'setbotname', 'setpic']],
  ['Fun', '🎉', ['quote', 'fact', 'flip', 'dice', '8ball', 'joke']],
];
function getGroups(list) {
  const names = list.filter((command) => !command.hidden).map((command) => command.name);
  const known = new Set(CATEGORIES.flatMap(([, , commands]) => commands));
  const result = CATEGORIES.map(([title, icon, commands]) => ({ title, icon, commands: commands.filter((name) => names.includes(name)) })).filter((item) => item.commands.length);
  const other = names.filter((name) => !known.has(name)); if (other.length) result.push({ title: 'Other', icon: '➕', commands: other }); return result;
}
function uptime() { const s = Math.floor(process.uptime()); return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`; }
module.exports = [
  { name: 'menu', alias: ['help'], desc: 'Show commands', run: async ({ reply, list, prefix, config, sender, num }) => {
    const p = prefix || config.prefix[0]; const sections = getGroups(list); const total = sections.reduce((n, item) => n + item.commands.length, 0);
    const header = [`┌──「 *⚡ ${config.botName}* 」`, `│ 👤 @${num(sender)}`, `│ 🌍 ${config.publicMode ? 'Public' : 'Private'} · ⏱ ${uptime()}`, `│ 📚 ${total} commands · Prefix ${config.prefix.join(' ')}`, `└${LINE}`].join('\n');
    const rows = sections.map((item) => [`┌──「 ${item.icon} *${item.title}* (${item.commands.length}) 」`, ...item.commands.map((command) => `│ ◦➛ ${p}${command}`), `└${LINE}`].join('\n'));
    await reply([header, ...rows, `_Use ${p}<command> to run a command._`].join('\n\n'), { mentions: [sender] });
  } },
  { name: 'alive', desc: 'Check whether bot is online', run: async ({ reply, config }) => reply(`${config.botName} is online.\nUptime: ${uptime()}`) },
  { name: 'ping', desc: 'Check response time', run: async ({ reply, m }) => { const sent = Number(m.messageTimestamp) * 1000; await reply(`Speed: ${sent ? Math.max(0, Date.now() - sent) : 0} ms`); } },
  { name: 'uptime', desc: 'Show uptime', run: async ({ reply }) => reply(`Uptime: ${uptime()}`) },
  { name: 'time', desc: 'Show current time', run: async ({ reply, config }) => reply(new Date().toLocaleString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC' })) },
  { name: 'date', desc: 'Show today’s date', run: async ({ reply, config }) => reply(new Date().toLocaleDateString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC', dateStyle: 'full' })) },
  { name: 'owner', desc: 'Show owner contact', run: async ({ reply, config }) => reply(`Owner: https://wa.me/${config.owner || '254111783552'}`) },
];
