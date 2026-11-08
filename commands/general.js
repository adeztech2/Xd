const LINE = '──────────────';

// [title, emoji, commands]. Edit this list to rename or move commands.
// Each command should appear in one category only.
const CATEGORIES = [
  ['General', '🌐', ['menu', 'ping', 'uptime', 'owner']],
  ['Group', '👥', ['kick', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'opengroup', 'closegroup', 'setname', 'setdesc']],
  ['Tools', '🛠️', ['rank', 'vv', 'calc', 'reverse', 'say', 'shorturl', 'weather', 'translate', 'qr']],
  ['Download', '📥', ['play', 'yts', 'dl', 'dlimage', 'dlvideo', 'dlaudio', 'apk', 'facebook', 'instagram', 'tgsticker', 'gitzip', 'gitfile', 'npm']],
  ['GitHub', '🐙', ['github', 'repo', 'repos']],
  ['Settings', '⚙️', ['mode', 'settings', 'setprefix', 'setbotname', 'antilink', 'welcome']],
  ['Fun', '🎉', ['alive', 'time', 'date', 'quote', 'fact', 'flip', 'dice', '8ball', 'joke']],
];

function groups(list) {
  const names = list.filter((c) => !c.hidden).map((c) => c.name);
  const known = new Set(CATEGORIES.flatMap(([, , cmds]) => cmds));
  const g = CATEGORIES
    .map(([title, icon, cmds]) => ({ title, icon, cmds: cmds.filter((n) => names.includes(n)) }))
    .filter((x) => x.cmds.length);
  const other = names.filter((n) => !known.has(n));
  if (other.length) g.push({ title: 'Other', icon: '➕', cmds: other });
  return g;
}

function uptime() {
  const s = Math.floor(process.uptime());
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

module.exports = [
  {
    name: 'menu',
    alias: ['help'],
    desc: 'Show commands',
    run: async ({ reply, list, prefix, config, sender, num }) => {
      const p = prefix || config.prefix[0];
      const groupList = groups(list);
      const total = groupList.reduce((n, x) => n + x.cmds.length, 0);

      const header = [
        `┌──「 *⚡ ${config.botName}* 」`,
        `│ 👤 @${num(sender)}`,
        `│ 🌍 ${config.publicMode ? 'Public' : 'Private'} · ⏱ ${uptime()}`,
        `│ 📚 ${total} commands · Prefix ${config.prefix.join(' ')}`,
        `└${LINE}`,
      ].join('\n');

      const sections = groupList.map((x) =>
        [
          `┌──「 ${x.icon} *${x.title}* (${x.cmds.length}) 」`,
          ...x.cmds.map((c) => `│ ◦➛ ${p}${c}`),
          `└${LINE}`,
        ].join('\n')
      );

      const footer = `_Use ${p}<command> to run a command._\n© ADEZ TECH • 2026\n👨‍💻 Dev: Arnold Adez`;

      await reply([header, ...sections, footer].join('\n\n'), { mentions: [sender] });
    },
  },
  {
    name: 'ping',
    desc: 'Check bot speed',
    run: async ({ reply, m, config }) => {
      const sent = Number(m.messageTimestamp) * 1000;
      const ms = sent ? Math.abs(Date.now() - sent) : 0;
      await reply(`⚡ *${config.botName}*\n🏓 Latency: ${ms} ms`);
    },
  },
  {
    name: 'uptime',
    desc: 'Bot uptime',
    run: async ({ reply, config }) => {
      await reply(`⚡ *${config.botName}*\n⏱️ Uptime: ${uptime()}`);
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
