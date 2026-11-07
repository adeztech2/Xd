module.exports = [
  {
    name: 'ping',
    desc: 'Check bot speed',
    run: async ({ reply, m }) => {
      const t = Date.now() - (Number(m.messageTimestamp) * 1000 || Date.now());
      await reply(`🏓 Pong! ${Math.abs(t)}ms`);
    },
  },
  {
    name: 'menu',
    alias: ['help'],
    desc: 'Show commands',
    run: async ({ reply, list, prefix, config }) => {
      const lines = list.map((c) => `• ${prefix}${c.name} — ${c.desc || ''}`);
      await reply(`*${config.botName}*\nMode: ${config.publicMode ? 'public' : 'private'}\n\n${lines.join('\n')}`);
    },
  },
  {
    name: 'uptime',
    desc: 'Bot uptime',
    run: async ({ reply }) => {
      const s = Math.floor(process.uptime());
      await reply(`⏱ ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`);
    },
  },
];
