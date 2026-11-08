const card = (title, lines) => `『 ${title} 』\n${[].concat(lines).map((line) => ` ⌬ ${line}`).join('\n')}`;
const digits = (jid) => String(jid || '').split('@')[0].split(':')[0];

function target(ctx) {
  if (ctx.mentioned?.[0]) return ctx.mentioned[0];
  if (ctx.quotedSender) return ctx.quotedSender;
  const number = (ctx.text || '').trim().replace(/^@/, '').replace(/\D/g, '');
  return number.length >= 7 ? `${number}@s.whatsapp.net` : null;
}

async function getMeta(ctx) {
  if (ctx.meta?.participants) return ctx.meta;
  return ctx.sock.groupMetadata(ctx.jid);
}

const safe = (fn) => async (ctx) => {
  try { await fn(ctx); }
  catch (error) {
    console.error('group command error:', error?.message || error);
    await ctx.reply('Command failed. Check your permissions and make sure the bot is a group admin.');
  }
};

function memberAction(action, label) {
  return safe(async (ctx) => {
    const user = target(ctx);
    if (!user) return ctx.reply('Mention or reply to a member, or provide their full number with country code.');
    if (digits(user) === digits(ctx.sock.user?.id)) return ctx.reply('I cannot apply that action to myself.');
    const meta = await getMeta(ctx);
    const member = meta.participants.find((item) => digits(item.id) === digits(user));
    if (!member) return ctx.reply('That user is not in this group.');
    if (action === 'remove' && member.admin && !ctx.isOwner) return ctx.reply('I will not remove another group admin.');
    const result = await ctx.sock.groupParticipantsUpdate(ctx.jid, [member.id], action);
    const status = result?.[0]?.status;
    if (status && !['200', 200].includes(status)) return ctx.reply(`WhatsApp did not complete the action (status ${status}).`);
    await ctx.reply(`${label} @${ctx.num(member.id)}.`, { mentions: [member.id] });
  });
}

function toggleGroupSetting(key, value, message) {
  return safe(async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, value);
    await ctx.reply(message);
  });
}

module.exports = [
  { name: 'kick', alias: ['remove'], desc: 'Remove a member (mention/reply/number)', groupOnly: true, adminOnly: true, run: memberAction('remove', 'Removed') },
  { name: 'add', desc: 'Add a member by full phone number', groupOnly: true, adminOnly: true, run: safe(async (ctx) => {
    const number = (ctx.text || '').replace(/\D/g, '');
    if (number.length < 7 || number.length > 15) return ctx.reply('Usage: .add <country-code-and-number>');
    const result = await ctx.sock.groupParticipantsUpdate(ctx.jid, [`${number}@s.whatsapp.net`], 'add');
    const status = result?.[0]?.status;
    await ctx.reply(status && !['200', 200].includes(status) ? `Could not add that number (WhatsApp status ${status}). They may need to join using the invite link.` : `Add request sent for ${number}. WhatsApp may require them to accept an invitation.`);
  }) },
  { name: 'promote', desc: 'Promote a member to admin', groupOnly: true, adminOnly: true, run: memberAction('promote', 'Promoted') },
  { name: 'demote', desc: 'Demote an admin', groupOnly: true, adminOnly: true, run: memberAction('demote', 'Demoted') },
  { name: 'tagall', alias: ['everyone'], desc: 'Mention every group member', groupOnly: true, adminOnly: true, run: safe(async (ctx) => {
    const ids = (await getMeta(ctx)).participants.map((participant) => participant.id);
    await ctx.reply(`📢 ${ctx.text || 'Attention'}\n${ids.map((id) => `@${ctx.num(id)}`).join(' ')}`, { mentions: ids });
  }) },
  { name: 'hidetag', desc: 'Mention all members without listing names', groupOnly: true, adminOnly: true, run: safe(async (ctx) => {
    const ids = (await getMeta(ctx)).participants.map((participant) => participant.id);
    await ctx.reply(ctx.text || 'Attention', { mentions: ids });
  }) },
  { name: 'admins', alias: ['adminlist'], desc: 'List group admins', groupOnly: true, run: safe(async (ctx) => {
    const admins = (await getMeta(ctx)).participants.filter((participant) => participant.admin).map((participant) => participant.id);
    if (!admins.length) return ctx.reply('No admins found.');
    await ctx.reply(`Group admins:\n${admins.map((id) => `@${ctx.num(id)}`).join('\n')}`, { mentions: admins });
  }) },
  { name: 'groupinfo', alias: ['infogroup'], desc: 'Show group details', groupOnly: true, run: safe(async (ctx) => {
    const meta = await getMeta(ctx);
    const lines = [`Name: ${meta.subject}`, `Members: ${meta.participants.length}`, `Admins: ${meta.participants.filter((participant) => participant.admin).length}`];
    if (meta.creation) lines.push(`Created: ${new Date(meta.creation * 1000).toDateString()}`);
    if (meta.desc) lines.push(`About: ${meta.desc}`);
    await ctx.reply(lines.join('\n'));
  }) },
  { name: 'link', alias: ['invitelink'], desc: 'Get group invite link', groupOnly: true, adminOnly: true, run: safe(async (ctx) => ctx.reply(`https://chat.whatsapp.com/${await ctx.sock.groupInviteCode(ctx.jid)}`)) },
  { name: 'revoke', alias: ['resetlink'], desc: 'Revoke the current invite link', groupOnly: true, adminOnly: true, run: safe(async (ctx) => { await ctx.sock.groupRevokeInvite(ctx.jid); await ctx.reply('Invite link revoked. Use .link for the new link.'); }) },
  { name: 'closegroup', alias: ['mute'], desc: 'Allow only admins to message', groupOnly: true, adminOnly: true, run: toggleGroupSetting('announcement', 'announcement', 'Group closed: only admins can send messages.') },
  { name: 'opengroup', alias: ['unmute'], desc: 'Allow all members to message', groupOnly: true, adminOnly: true, run: toggleGroupSetting('announcement', 'not_announcement', 'Group opened: members can send messages.') },
  { name: 'setname', desc: 'Change the group name', groupOnly: true, adminOnly: true, run: safe(async (ctx) => { if (!ctx.text) return ctx.reply('Usage: .setname <new name>'); await ctx.sock.groupUpdateSubject(ctx.jid, ctx.text.slice(0, 100)); await ctx.reply('Group name changed.'); }) },
  { name: 'setdesc', desc: 'Change the group description', groupOnly: true, adminOnly: true, run: safe(async (ctx) => { if (!ctx.text) return ctx.reply('Usage: .setdesc <description>'); await ctx.sock.groupUpdateDescription(ctx.jid, ctx.text.slice(0, 2048)); await ctx.reply('Group description changed.'); }) },
  { name: 'events', desc: 'Enable/disable group event notices', groupOnly: true, adminOnly: true, run: safe(async (ctx) => {
    const value = (ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(value)) return ctx.reply('Usage: .events on|off');
    await ctx.db.set(`group-events:${ctx.jid}`, value === 'on');
    await ctx.reply(`Group event notices turned ${value}.`);
  }) },
  { name: 'admins', hidden: true, desc: 'List group admins', groupOnly: true, run: async (ctx) => ctx.reply(card('ADMINS', (await getMeta(ctx)).participants.filter((p) => p.admin).map((p) => p.id))) },
];
