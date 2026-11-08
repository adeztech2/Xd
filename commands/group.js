const card = (title, lines) => `『 ${title} 』\n${[].concat(lines).map((line) => ` ⌬ ${line}`).join('\n')}`;
const digits = (jid) => String(jid || '').split('@')[0].split(':')[0];
const target = (ctx) => {
  if (ctx.mentioned?.[0]) return ctx.mentioned[0];
  if (ctx.quotedSender) return ctx.quotedSender;
  const number = (ctx.text || '').trim().replace(/^@/, '').replace(/\D/g, '');
  return number.length >= 7 ? `${number}@s.whatsapp.net` : null;
};
const botNumber = (ctx) => digits(ctx.sock.user?.id);

async function getMeta(ctx) {
  if (ctx.meta?.participants) return ctx.meta;
  return ctx.sock.groupMetadata(ctx.jid);
}

const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (error) {
    console.error('group command error:', error?.message || error);
    await ctx.reply('Command failed. Check that you and the bot have the required group admin permissions.');
  }
};

function memberAction(action, doneText) {
  return safe(async (ctx) => {
    const user = target(ctx);
    if (!user) return ctx.reply('Mention or reply to a group member, or provide their full number with country code.');
    if (digits(user) === botNumber(ctx)) return ctx.reply('I cannot apply that action to myself.');
    const meta = await getMeta(ctx);
    const normalized = (jid) => digits(jid);
    const participant = meta.participants.find((entry) => normalized(entry.id) === normalized(user));
    if (!participant) return ctx.reply('That user is not a member of this group.');
    const result = await ctx.sock.groupParticipantsUpdate(ctx.jid, [participant.id], action);
    const status = result?.[0]?.status;
    if (status && !['200', 200].includes(status)) return ctx.reply(`WhatsApp did not complete the action (status ${status}).`);
    await ctx.reply(`${doneText} @${ctx.num(participant.id)}.`, { mentions: [participant.id] });
  });
}

module.exports = [
  { name: 'kick', desc: 'Remove a member (mention, reply, or number)', groupOnly: true, adminOnly: true, run: memberAction('remove', 'Removed') },
  { name: 'promote', desc: 'Make member admin', groupOnly: true, adminOnly: true, run: memberAction('promote', 'Promoted') },
  { name: 'demote', desc: 'Remove admin', groupOnly: true, adminOnly: true, run: memberAction('demote', 'Demoted') },
  {
    name: 'tagall', desc: 'Mention everyone', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const meta = await getMeta(ctx);
      const ids = meta.participants.map((participant) => participant.id);
      await ctx.reply(`📢 ${ctx.text || 'Attention'}\n${ids.map((id) => `@${ctx.num(id)}`).join(' ')}`, { mentions: ids });
    }),
  },
  {
    name: 'hidetag', desc: 'Mention everyone without displaying names', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const ids = (await getMeta(ctx)).participants.map((participant) => participant.id);
      await ctx.reply(ctx.text || 'Attention', { mentions: ids });
    }),
  },
  {
    name: 'admins', desc: 'List group admins', groupOnly: true,
    run: safe(async (ctx) => {
      const admins = (await getMeta(ctx)).participants.filter((participant) => participant.admin).map((participant) => participant.id);
      if (!admins.length) return ctx.reply('No admins found.');
      await ctx.reply(`Group admins:\n${admins.map((id) => `@${ctx.num(id)}`).join('\n')}`, { mentions: admins });
    }),
  },
  {
    name: 'groupinfo', desc: 'Show group details', groupOnly: true,
    run: safe(async (ctx) => {
      const meta = await getMeta(ctx);
      const admins = meta.participants.filter((participant) => participant.admin).length;
      const lines = [`Name: ${meta.subject}`, `Members: ${meta.participants.length}`, `Admins: ${admins}`];
      if (meta.creation) lines.push(`Created: ${new Date(meta.creation * 1000).toDateString()}`);
      if (meta.desc) lines.push(`About: ${meta.desc}`);
      await ctx.reply(lines.join('\n'));
    }),
  },
  { name: 'link', desc: 'Get group invite link', groupOnly: true, adminOnly: true, run: safe(async (ctx) => ctx.reply(`https://chat.whatsapp.com/${await ctx.sock.groupInviteCode(ctx.jid)}`)) },
  { name: 'revoke', desc: 'Reset group invite link', groupOnly: true, adminOnly: true, run: safe(async (ctx) => { await ctx.sock.groupRevokeInvite(ctx.jid); await ctx.reply('The old invite link was revoked.'); }) },
  { name: 'closegroup', desc: 'Only admins can send messages', groupOnly: true, adminOnly: true, run: safe(async (ctx) => { await ctx.sock.groupSettingUpdate(ctx.jid, 'announcement'); await ctx.reply('Group closed: only admins can send messages.'); }) },
  { name: 'opengroup', desc: 'Everyone can send messages', groupOnly: true, adminOnly: true, run: safe(async (ctx) => { await ctx.sock.groupSettingUpdate(ctx.jid, 'not_announcement'); await ctx.reply('Group opened: members can send messages.'); }) },
  {
    name: 'setname', desc: 'Change the group name', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => { if (!ctx.text) return ctx.reply('Type the new group name after the command.'); await ctx.sock.groupUpdateSubject(ctx.jid, ctx.text); await ctx.reply('Group name changed.'); }),
  },
  {
    name: 'setdesc', desc: 'Change the group description', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => { if (!ctx.text) return ctx.reply('Type the new group description after the command.'); await ctx.sock.groupUpdateDescription(ctx.jid, ctx.text); await ctx.reply('Group description changed.'); }),
  },
];
