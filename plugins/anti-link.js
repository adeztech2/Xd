// Use runtime config on each invocation so owner toggles take effect immediately.
const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|ke|xyz|info|link|app|gg|tv)\b\S*/gi;
module.exports = {
  name: 'anti-link',
  events: { message: async (ctx) => {
    const cfg = ctx.config.antiLink;
    if (!cfg?.enabled || !ctx.isGroup || ctx.isAdmin || ctx.isOwner || !ctx.body || !ctx.botIsAdmin) return;
    const found = ctx.body.match(LINK) || [];
    const blocked = found.filter((link) => !(cfg.whitelist || []).some((allowed) => link.toLowerCase().includes(allowed.toLowerCase())));
    if (!blocked.length) return;
    await ctx.sock.sendMessage(ctx.jid, { delete: ctx.m.key }).catch(() => {});
    if (cfg.action === 'kick') {
      await ctx.group.kick(ctx.sender);
      await ctx.reply(`Removed @${ctx.num(ctx.sender)} for posting a link.`, { mentions: [ctx.sender] });
    } else if (cfg.action === 'warn') await ctx.reply(`Links are not allowed, @${ctx.num(ctx.sender)}.`, { mentions: [ctx.sender] });
  } },
};
