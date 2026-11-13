// Group protection settings and warnings.
const { card } = require('../lib/style');
const { FEATURES, ACTIONS, getSettings, saveSettings } = require('../lib/guard');
const { addWarn, getWarns, resetWarns } = require('../lib/warn');

const safe = (fn) => async (ctx) => {
  try { await fn(ctx); } catch (e) {
    console.error('protect error:', e?.message || e);
    await ctx.reply('Command failed. Make sure I am a group admin.').catch(() => {});
  }
};

function target(ctx) {
  if (ctx.mentioned?.[0]) return ctx.mentioned[0];
  if (ctx.quotedSender) return ctx.quotedSender;
  const n = (ctx.text || '').replace(/\D/g, '');
  return n.length >= 7 ? `${n}@s.whatsapp.net` : null;
}

module.exports = [
  {
    name: 'anti', desc: 'Group protection: .anti link|badword|bot|tag|sticker on|off|delete|warn|kick', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const s = await getSettings(ctx.db, ctx.jid, ctx.config);
      const [feature, value] = ctx.args.map((a) => a.toLowerCase());
      if (!feature) {
        return ctx.reply(card('🛡️ GROUP PROTECTION', [
          ...FEATURES.map((f) => `${s[f].on ? '✅' : '❌'} ${f} — ${s[f].action}`),
          '',
          'Use: .anti <feature> on|off|delete|warn|kick',
        ]));
      }
      if (!FEATURES.includes(feature)) return ctx.reply(`Unknown feature. Choose: ${FEATURES.join(', ')}`);
      if (value === 'on') s[feature].on = true;
      else if (value === 'off') s[feature].on = false;
      else if (ACTIONS.includes(value)) { s[feature].on = true; s[feature].action = value; }
      else return ctx.reply('Use on, off, delete, warn or kick.');
      await saveSettings(ctx.db, ctx.jid, s);
      await ctx.reply(`🛡️ anti-${feature} is now ${s[feature].on ? `ON (${s[feature].action})` : 'OFF'}.`);
    }),
  },
  {
    name: 'warn', desc: 'Warn a member (mention or reply)', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const user = target(ctx);
      if (!user) return ctx.reply('Mention or reply to the member you want to warn.');
      const w = await addWarn(ctx, user);
      await ctx.reply(w.kicked ? `🚫 @${ctx.num(user)} removed after ${w.limit} warnings.` : `⚠️ @${ctx.num(user)} warned. Warning ${w.count}/${w.limit}`, { mentions: [user] });
    }),
  },
  {
    name: 'warnings', alias: ['warns'], desc: 'Show warnings of a member', groupOnly: true,
    run: safe(async (ctx) => {
      const user = target(ctx) || ctx.sender;
      await ctx.reply(`⚠️ @${ctx.num(user)} has ${await getWarns(ctx, user)}/${ctx.config.warnLimit || 3} warnings.`, { mentions: [user] });
    }),
  },
  {
    name: 'resetwarn', desc: 'Clear warnings of a member', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const user = target(ctx);
      if (!user) return ctx.reply('Mention or reply to the member.');
      await resetWarns(ctx, user);
      await ctx.reply(`✅ Warnings cleared for @${ctx.num(user)}.`, { mentions: [user] });
    }),
  },
  {
    name: 'addbad', desc: 'Add a bad word for this group', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const word = (ctx.text || '').trim().toLowerCase();
      if (!word) return ctx.reply('Usage: .addbad <word>');
      const s = await getSettings(ctx.db, ctx.jid, ctx.config);
      if (!s.words.includes(word)) s.words.push(word);
      await saveSettings(ctx.db, ctx.jid, s);
      await ctx.reply(`Added "${word}". Turn it on with .anti badword on`);
    }),
  },
  {
    name: 'delbad', desc: 'Remove a bad word for this group', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const word = (ctx.text || '').trim().toLowerCase();
      const s = await getSettings(ctx.db, ctx.jid, ctx.config);
      s.words = s.words.filter((w) => w !== word);
      await saveSettings(ctx.db, ctx.jid, s);
      await ctx.reply(`Removed "${word}".`);
    }),
  },
  {
    name: 'badwords', desc: 'List bad words for this group', groupOnly: true, adminOnly: true,
    run: safe(async (ctx) => {
      const s = await getSettings(ctx.db, ctx.jid, ctx.config);
      await ctx.reply(s.words.length ? `Bad words: ${s.words.join(', ')}` : 'No group bad words set. Use .addbad <word>');
    }),
  },
];
