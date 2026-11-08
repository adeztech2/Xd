const card = (title, lines) =>
  `『 ${title} 』\n${[].concat(lines).map((l) => ` ⌬ ${l}`).join('\n')}`;
const digits = (j) => String(j || '').split('@')[0].split(':')[0];
const target = (ctx) => (ctx.mentioned && ctx.mentioned[0]) || ctx.quotedSender;
const botNumber = (ctx) => digits(ctx.sock.user && ctx.sock.user.id);

async function getMeta(ctx) {
  if (ctx.meta && ctx.meta.participants) return ctx.meta;
  return ctx.sock.groupMetadata(ctx.jid);
}

// Runs a command and shows a friendly message if it fails
const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error('group command error:', e && e.message);
    await ctx.reply(card('⚠️ FAILED', 'Something went wrong. Make sure I am a group admin.'));
  }
};

function memberAction(action, doneText) {
  return safe(async (ctx) => {
    const u = target(ctx);
    if (!u) return ctx.reply(card('⚠️ ERROR', 'Tag or reply to someone.'));
    if (digits(u) === botNumber(ctx)) return ctx.reply(card('⚠️ ERROR', 'I can’t do that to myself.'));
    await ctx.sock.groupParticipantsUpdate(ctx.jid, [u], action);
    await ctx.reply(card('✅ DONE', `${doneText} @${ctx.num(u)}`), { mentions: [u] });
  });
}

module.exports = [
  {
    name: 'kick',
    desc: 'Remove a member (tag or reply)',
    groupOnly: true,
    adminOnly: true,
    run: memberAction('remove', 'Removed'),
  },
  {
    name: 'promote',
    desc: 'Make member admin',
    groupOnly: true,
    adminOnly: true,
    run: memberAction('promote', 'Promoted'),
  },
  {
    name: 'demote',
    desc: 'Remove admin',
    groupOnly: true,
    adminOnly: true,
    run: memberAction('demote', 'Demoted'),
  },
  {
    name: 'tagall',
    desc: 'Mention everyone',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      const meta = await getMeta(ctx);
      const ids = meta.participants.map((p) => p.id);
      const text = `📢 ${ctx.text || 'Attention'}\n` + ids.map((i) => `@${ctx.num(i)}`).join(' ');
      await ctx.reply(text, { mentions: ids });
    }),
  },
  {
    name: 'hidetag',
    desc: 'Mention everyone without showing names',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      const meta = await getMeta(ctx);
      const ids = meta.participants.map((p) => p.id);
      await ctx.reply(ctx.text || 'Attention', { mentions: ids });
    }),
  },
  {
    name: 'admins',
    desc: 'List group admins',
    groupOnly: true,
    run: safe(async (ctx) => {
      const meta = await getMeta(ctx);
      const admins = meta.participants.filter((p) => p.admin).map((p) => p.id);
      if (!admins.length) return ctx.reply(card('👑 ADMINS', 'No admins found.'));
      await ctx.reply(card('👑 ADMINS', admins.map((i) => `@${ctx.num(i)}`)), { mentions: admins });
    }),
  },
  {
    name: 'groupinfo',
    desc: 'Show group details',
    groupOnly: true,
    run: safe(async (ctx) => {
      const meta = await getMeta(ctx);
      const admins = meta.participants.filter((p) => p.admin).length;
      const lines = [
        `Name : ${meta.subject}`,
        `Members : ${meta.participants.length}`,
        `Admins : ${admins}`,
      ];
      if (meta.creation) lines.push(`Created : ${new Date(meta.creation * 1000).toDateString()}`);
      if (meta.desc) lines.push(`About : ${meta.desc}`);
      await ctx.reply(card('ℹ️ GROUP INFO', lines));
    }),
  },
  {
    name: 'link',
    desc: 'Get the group invite link',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      const code = await ctx.sock.groupInviteCode(ctx.jid);
      await ctx.reply(card('🔗 GROUP LINK', `https://chat.whatsapp.com/${code}`));
    }),
  },
  {
    name: 'revoke',
    desc: 'Reset the group invite link',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      await ctx.sock.groupRevokeInvite(ctx.jid);
      await ctx.reply(card('✅ DONE', 'The old invite link no longer works.'));
    }),
  },
  {
    name: 'closegroup',
    desc: 'Only admins can send messages',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      await ctx.sock.groupSettingUpdate(ctx.jid, 'announcement');
      await ctx.reply(card('🔒 GROUP CLOSED', 'Only admins can send messages now.'));
    }),
  },
  {
    name: 'opengroup',
    desc: 'Everyone can send messages',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      await ctx.sock.groupSettingUpdate(ctx.jid, 'not_announcement');
      await ctx.reply(card('🔓 GROUP OPEN', 'Everyone can send messages now.'));
    }),
  },
  {
    name: 'setname',
    desc: 'Change the group name',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      if (!ctx.text) return ctx.reply(card('⚠️ ERROR', 'Type the new name after the command.'));
      await ctx.sock.groupUpdateSubject(ctx.jid, ctx.text);
      await ctx.reply(card('✅ DONE', 'Group name changed.'));
    }),
  },
  {
    name: 'setdesc',
    desc: 'Change the group description',
    groupOnly: true,
    adminOnly: true,
    run: safe(async (ctx) => {
      if (!ctx.text) return ctx.reply(card('⚠️ ERROR', 'Type the new description after the command.'));
      await ctx.sock.groupUpdateDescription(ctx.jid, ctx.text);
      await ctx.reply(card('✅ DONE', 'Group description changed.'));
    }),
  },
];
