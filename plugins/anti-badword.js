// Remove configured words in groups; reads live config so owner toggles apply immediately.
const escapeRegex = (word) => String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
module.exports = {
  name: 'anti-badword',
  events: { message: async (ctx) => {
    const cfg = ctx.config.antiBadword;
    if (!cfg?.enabled || !cfg.words?.length || !ctx.isGroup || ctx.isAdmin || ctx.isOwner || !ctx.botIsAdmin) return;
    const expression = new RegExp(`(?:^|\\W)(?:${cfg.words.map(escapeRegex).join('|')})(?:$|\\W)`, 'i');
    if (!expression.test(ctx.body || '')) return;
    await ctx.sock.sendMessage(ctx.jid, { delete: ctx.m.key }).catch(() => {});
    if (cfg.action === 'warn') await ctx.reply(`Please avoid that language, @${ctx.num(ctx.sender)}.`, { mentions: [ctx.sender] });
  } },
};
