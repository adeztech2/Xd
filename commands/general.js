// [name, emoji, commands]. Edit this list to rename or move commands.
const CATEGORIES = [
  ['general', '🌐', ['menu', 'ping', 'uptime', 'owner']],
  ['group', '👥', ['kick', 'promote', 'demote', 'tagall']],
  ['tools', '🛠️', ['rank', 'vv']],
  ['settings', '⚙️', ['mode']],
];

const box = (title, lines) =>
  `┌────✧ ${title} ✧────\n${lines.map((l) => `│✧ ${l}`).join('\n')}\n└──────────────────`;

// Existing commands per category; anything not listed above goes under "other"
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
      const g = groups(list);
      const total = g.reduce((n, x) => n + x.cmds.length, 0);

      const info = box(config.botName, [
        `Prefix: [ ${config.prefix.join(' ')} ]`,
        `Mode: ${config.publicMode ? 'public' : 'private'}`,
        `Uptime: ${uptime()}`,
        `Total commands: ${total}`,
      ]);
      const sections = g.map((x) => box(`${x.icon} ${x.name.toUpperCase()}`, x.cmds.map((c) => p + c)));

      await reply(`Hey, @${num(sender)} 👋\n\n${info}\n\n${sections.join('\n\n')}`, { mentions: [sender] });
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
