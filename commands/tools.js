const card = (title, lines) => `╔═══ ${title} ═══\n${[].concat(lines).map((line) => `║ ◆ ${line}`).join('\n')}\n╚══════════════`;
const fail = (message) => card('⚠️ ERROR', message);
const safe = (fn) => async (ctx) => {
  try { await fn(ctx); }
  catch (error) { console.error('tools command error:', error?.message); await ctx.reply(fail('Something went wrong. Try again later.')); }
};

module.exports = [
  {
    name: 'settings', desc: 'Show bot settings and feature states',
    run: safe(async (ctx) => {
      const c = ctx.config;
      const enabled = (value) => value ? 'on' : 'off';
      const lines = [
        `Name: ${c.botName}`, `Prefix: ${c.prefix.join(' ')}`, `Mode: ${c.publicMode ? 'Public' : 'Private'}`,
        `Auto-react: ${enabled(c.autoReact?.enabled)}`, `Status view: ${enabled(c.autoStatusView)}`,
        `Status reactions: ${enabled(c.autoStatusReact?.enabled)}`, `Auto-read: ${enabled(c.autoRead)}`,
        `Typing: ${enabled(c.autoTyping)}`, `Recording presence: ${enabled(c.autoRecording)}`,
        `Chatbot: ${enabled(c.chatbot?.enabled)}`, `Anti-call: ${enabled(c.antiCall)}`,
        `Anti-delete: ${enabled(c.antiDelete)}`, `Anti-edit: ${enabled(c.antiEdit)}`,
        `Anti-link: ${enabled(c.antiLink?.enabled)}`, `Group events default: ${enabled(c.groupEvents?.enabled)}`,
        `Node: ${process.version}`, `Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
        'Owner controls: .toggle <feature> on|off',
      ];
      await ctx.reply(card('⚙️ SETTINGS', lines));
    }),
  },
  {
    name: 'calc', desc: 'Calculator, e.g. .calc 5*(2+3)',
    run: safe(async (ctx) => {
      const raw = (ctx.text || '').trim();
      if (!raw) return ctx.reply(fail('Example: .calc 5*(2+3)'));
      const expression = raw.replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**');
      if (expression.length > 100 || !/^[0-9+\-*/().%\s]+$/.test(expression)) return ctx.reply(fail('Use only numbers and + - * / ( ) %'));
      const result = Function(`"use strict"; return (${expression})`)();
      if (typeof result !== 'number' || !Number.isFinite(result)) return ctx.reply(fail('That can’t be calculated.'));
      await ctx.reply(card('🧮 CALC', [`${raw} = ${result}`]));
    }),
  },
  { name: 'reverse', desc: 'Reverse a text', run: safe(async (ctx) => { if (!ctx.text) return ctx.reply(fail('Example: .reverse hello')); await ctx.reply(card('🔁 REVERSE', [[...ctx.text].reverse().join('')])); }) },
  { name: 'say', desc: 'Make the bot repeat your text', run: safe(async (ctx) => { if (!ctx.text) return ctx.reply(fail('Example: .say hello')); await ctx.reply(ctx.text); }) },
];
