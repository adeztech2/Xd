const card = (title, lines) =>
  `╔═══ ${title} ═══\n${[].concat(lines).map((l) => `║ ◆ ${l}`).join('\n')}\n╚══════════════`;
const fail = (msg) => card('⚠️ ERROR', msg);

const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error('tools command error:', e && e.message);
    await ctx.reply(fail('Something went wrong. Try again later.'));
  }
};

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

module.exports = [
  {
    name: 'settings',
    desc: 'Show bot settings',
    run: safe(async (ctx) => {
      const c = ctx.config;
      const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      await ctx.reply(
        card('⚙️ SETTINGS', [
          `Bot : ${c.botName}`,
          `Prefix : ${c.prefix.join(' ')}`,
          `Mode : ${c.publicMode ? 'Public' : 'Private'}`,
          `Node : ${process.version}`,
          `Memory : ${mem} MB`,
        ])
      );
    }),
  },
  {
    name: 'calc',
    desc: 'Calculator, e.g. .calc 5*(2+3)',
    run: safe(async (ctx) => {
      const raw = (ctx.text || '').trim();
      if (!raw) return ctx.reply(fail('Example: .calc 5*(2+3)'));
      const expr = raw.replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**');
      if (expr.length > 100 || !/^[0-9+\-*/().%\s]+$/.test(expr)) {
        return ctx.reply(fail('Use only numbers and + - * / ( ) %'));
      }
      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        return ctx.reply(fail('That can’t be calculated.'));
      }
      await ctx.reply(card('🧮 CALC', [`${raw} = ${result}`]));
    }),
  },
  {
    name: 'reverse',
    desc: 'Reverse a text',
    run: safe(async (ctx) => {
      if (!ctx.text) return ctx.reply(fail('Example: .reverse hello'));
      await ctx.reply(card('🔁 REVERSE', [[...ctx.text].reverse().join('')]));
    }),
  },
  {
    name: 'say',
    desc: 'Make the bot repeat your text',
    run: safe(async (ctx) => {
      if (!ctx.text) return ctx.reply(fail('Example: .say hello everyone'));
      await ctx.reply(ctx.text);
    }),
  },
  {
    name: 'shorturl',
    desc: 'Shorten a link',
    run: safe(async (ctx) => {
      const url = (ctx.text || '').trim();
      if (!/^https?:\/\//i.test(url)) return ctx.reply(fail('Example: .shorturl https://example.com'));
      const out = (await getText(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`)).trim();
      if (!out.startsWith('http')) return ctx.reply(fail('Could not shorten that link.'));
      await ctx.reply(card('🔗 SHORT LINK', [out]));
    }),
  },
  {
    name: 'weather',
    desc: 'Weather of a city',
    run: safe(async (ctx) => {
      const city = (ctx.text || '').trim();
      if (!city) return ctx.reply(fail('Example: .weather Nairobi'));
      const out = (await getText(`https://wttr.in/${encodeURIComponent(city)}?format=3`)).trim();
      await ctx.reply(card('🌦️ WEATHER', [out]));
    }),
  },
  {
    name: 'translate',
    desc: 'Translate text, e.g. .translate fr Hello',
    run: safe(async (ctx) => {
      const parts = (ctx.text || '').trim().split(/\s+/);
      const lang = (parts.shift() || '').toLowerCase();
      const text = parts.join(' ');
      if (!/^[a-z]{2}$/.test(lang) || !text) {
        return ctx.reply(fail('Example: .translate fr Good morning'));
      }
      const raw = await getText(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${lang}`
      );
      const out = JSON.parse(raw);
      const t = out && out.responseData && out.responseData.translatedText;
      if (!t) return ctx.reply(fail('Could not translate that.'));
      await ctx.reply(card('🌍 TRANSLATE', [`To : ${lang}`, t]));
    }),
  },
  {
    name: 'qr',
    desc: 'Make a QR code from text or a link',
    run: safe(async (ctx) => {
      const data = (ctx.text || '').trim();
      if (!data) return ctx.reply(fail('Example: .qr https://example.com'));
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(data)}`;
      try {
        await ctx.sock.sendMessage(ctx.jid, { image: { url }, caption: card('🔳 QR CODE', ['Scan me']) });
      } catch (e) {
        await ctx.reply(card('🔳 QR CODE', [url]));
      }
    }),
  },
];
