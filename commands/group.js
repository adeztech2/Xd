const target = (ctx) => ctx.mentioned[0] || ctx.quotedSender;

module.exports = [
  {
    name: 'kick',
    desc: 'Remove a member (tag or reply)',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
      const u = target(ctx);
      if (!u) return ctx.reply('Tag or reply to someone.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [u], 'remove');
    },
  },
  {
    name: 'promote',
    desc: 'Make member admin',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
      const u = target(ctx);
      if (!u) return ctx.reply('Tag or reply to someone.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [u], 'promote');
    },
  },
  {
    name: 'demote',
    desc: 'Remove admin',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
      const u = target(ctx);
      if (!u) return ctx.reply('Tag or reply to someone.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [u], 'demote');
    },
  },
  {
    name: 'tagall',
    desc: 'Mention everyone',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
      const ids = ctx.meta.participants.map((p) => p.id);
      const text = `📢 ${ctx.text || 'Attention'}\n` + ids.map((i) => `@${ctx.num(i)}`).join(' ');
      await ctx.reply(text, { mentions: ids });
    },
  },
];
