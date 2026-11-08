const OWNER_NUMBER = '254111783552'; // owner WhatsApp number, country code, no +

// [name, emoji, commands]. Edit this list to rename or move commands.
const CATEGORIES = [
  ['general', '🌐', ['menu', 'ping', 'uptime', 'owner']],
  ['group', '👥', ['kick', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'opengroup', 'closegroup', 'setname', 'setdesc']],
  ['tools', '🛠️', ['rank', 'vv', 'calc', 'reverse', 'say', 'shorturl', 'weather', 'translate', 'qr']],
  ['download', '📥', ['dl', 'dlimage', 'dlvideo', 'dlaudio', 'gitzip', 'gitfile', 'npm']],
  ['github', '🐙', ['github', 'repo', 'repos']],
  ['settings', '⚙️', ['mode', 'settings', 'setprefix', 'setbotname', 'antilink', 'welcome']],
  ['fun', '🎉', ['alive', 'time', 'date', 'quote', 'fact', 'flip', 'dice', '8ball', 'joke']],
];

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
    name: 'menu',
    alias: ['help'],
    desc: 'Show commands',
    run: async ({ reply, list, prefix, config, sender, num }) => {
      const p = prefix || config.prefix[0];
      const g = groups(list);

      const top =
        `╔══════════════════╗\n` +
        `║   ⚡ ${String(config.botName).toUpperCase()} ⚡   ║\n` +
        `╚══════════════════╝\n\n` +
        `👤 User    : @${num(sender)}\n` +
        `🔰 Prefix  : ${config.prefix.join(' ')}\n` +
        `🌍 Mode    : ${config.publicMode ? 'Public' : 'Private'}\n` +
        `⏱️ Uptime  : ${uptime()}`;

      const sections = g.map(
        (x) =>
          `╔═══ ${x.icon} ${x.name.toUpperCase()} ═══\n` +
          x.cmds.map((c) => `║ ◆ ${p}${c}`).join('\n') +
          `\n╚══════════════`
      );

      const bottom = `© ADEZ TECH • 2026`;

      await reply([top, ...sections, bottom].join('\n\n'), { mentions: [sender] });
    },
  },
  {
    name: 'ping',
    desc: 'Check bot speed',
    run: async ({ reply, m, config }) => {
      const t = Date.now() - (Number(m.messageTimestamp) * 1000 || Date.now());
      await reply(`*${config.botName}* ⚡ Speed ! ${Math.abs(t)}ms`);
    },
  },
  {
    name: 'uptime',
    desc: 'Bot uptime',
    run: async ({ reply, config }) => {
      await reply(`*${config.botName}* ⏱ Uptime: ${uptime()}`);
    },
  },
  {
    name: 'owner',
    desc: 'Show the owner contact',
    run: async ({ reply, config }) => {
      await reply(
        `╔═══ 👑 OWNER ═══\n` +
          `║ ◆ Bot  : ${config.botName}\n` +
          `║ ◆ Chat : https://wa.me/${OWNER_NUMBER}\n` +
          `╚══════════════\n\n` +
          `© ADEZ TECH • 2026`
      );
    },
  },
];
