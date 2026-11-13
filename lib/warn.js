// Warning counter per group member. At the limit the member is removed.
const num = (jid = '') => String(jid).split('@')[0].split(':')[0];
const keyOf = (groupJid, user) => `warn:${groupJid}:${num(user)}`;

async function addWarn(ctx, user) {
  const limit = ctx.config.warnLimit || 3;
  const key = keyOf(ctx.jid, user);
  const rec = (await ctx.db.get(key)) || { count: 0 };
  rec.count += 1;
  if (rec.count >= limit) {
    await ctx.db.del(key);
    await ctx.group.kick(user);
    return { count: rec.count, limit, kicked: true };
  }
  await ctx.db.set(key, rec);
  return { count: rec.count, limit, kicked: false };
}

const getWarns = async (ctx, user) => ((await ctx.db.get(keyOf(ctx.jid, user))) || { count: 0 }).count;
const resetWarns = (ctx, user) => ctx.db.del(keyOf(ctx.jid, user));

module.exports = { addWarn, getWarns, resetWarns };
