// [name, emoji, commands]. Edit this list to rename or move commands.
const CATEGORIES = [
  ['general', '🌐', ['menu', 'ping', 'uptime', 'owner']],
  ['group', '👥', ['kick', 'promote', 'demote', 'tagall']],
  ['tools', '🛠️', ['rank', 'vv']],
  ['settings', '⚙️', ['mode']],
];

const TITLES = {
  general: 'MAINFRAME',
  group: 'GROUP SECURITY',
  tools: 'SYSTEM TOOLS',
  settings: 'SETTINGS',
  other: 'OTHER',
};

const block = (title, lines) =>
  `┌─[ ${title} ]\n${lines.map((l) => `│ ${l}`).join('\n')}\n└───────────────────────`;

function groups(list) {
  const names = list.filter((c) => !c.hidden).map((c) => c.name);
  const known = new Set(CATEGORIES.flatMap(([, , n]) => n));
  const g = CATEGORIES
    .map(([name, icon, cmds]) => ({ name, icon, cmds: cmds.filter((n) => names.includes(n)) }))
    .filter((x) => x.cmds.length);
  const other = names.filter((n) => !known.has(n));
  if (other.length) g.push({ name: 'other', icon: '➕', cmds: other });
  return g;
}

function uptime() {
  const s = Math.floor(process.uptime());
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

module.exports = [
  {
    name: 'ping',
    desc: 'Check bot speed',
    run: async ({ reply, m, config }) => {
      const t = Date.now() - (Number(m.messageTimestamp) * 1000 || Date.now());
      await reply(`*${config.botName}* ⚡ Speed ! ${Math.abs(t)}ms`);
    },
  },
  {
    name: 'menu',
    alias: ['help'],
    desc: 'Show commands',
    run: async ({ reply, list, prefix, config, sender, num }) => {
      const p = prefix || config.prefix[0];
      const bot = String(config.botName).toUpperCase();
      const g = groups(list);

      const header =
        `▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄\n` +
        `█ ${bot} // TERMINAL █\n` +
        `▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀\n\n` +
        `[✓] CONNECTION ESTABLISHED\n` +
        `[✓] SECURITY PROTOCOL ACTIVE\n` +
        `[✓] BOT ENGINE INITIALIZED`;

      const identity = block('IDENTITY', [
        `USER   : @${num(sender)}`,
        `BOT    : ${bot}`,
        `PREFIX : ${config.prefix.join(' ')}`,
        `ACCESS : ${config.publicMode ? 'PUBLIC' : 'PRIVATE'}`,
        `UPTIME : ${uptime()}`,
      ]);

      const sections = g.map((x, i) =>
        block(`${String(i + 1).padStart(2, '0')} / ${TITLES[x.name] || x.name.toUpperCase()}`, x.cmds.map((c) => p + c))
      );

      const dev = block('DEVELOPER INFORMATION', [
        `ORGANIZATION : ADEZ TECH`,
        `SYSTEM       : ${bot}`,
        `YEAR         : 2026`,
      ]);

      const footer = `> ROOT ACCESS GRANTED\n> WAITING FOR NEXT COMMAND..._\n[ ${bot} • SYSTEM ONLINE ]`;

      await reply([header, identity, ...sections, dev, footer].join('\n\n'), { mentions: [sender] });
    },
  },
  {
    name: 'uptime',
    desc: 'Bot uptime',
    run: async ({ reply, config }) => {
      await reply(`*${config.botName}* ⏱ Uptime: ${uptime()}`);
    },
  },
];
