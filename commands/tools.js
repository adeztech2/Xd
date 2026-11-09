const crypto = require('crypto');
const { card, fail, getJson, userError } = require('../lib/style');

const safe = (fn) => async (ctx) => {
  try { await fn(ctx); }
  catch (error) {
    console.error('tools command error:', error?.message);
    await ctx.reply(fail(error?.userMessage || 'Something went wrong. Try again later.')).catch(() => {});
  }
};
const quotedText = (q) => q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || q?.videoMessage?.caption || '';

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

  {
    name: 'weather', alias: ['wx'], desc: 'Current weather, e.g. .weather Nairobi',
    run: safe(async (ctx) => {
      const city = (ctx.text || '').trim().slice(0, 60);
      if (!city) return ctx.reply(fail('Example: .weather Nairobi'));
      const d = await getJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, 20000);
      const c = d.current_condition?.[0];
      if (!c) throw userError('No weather found for that place.');
      const place = d.nearest_area?.[0];
      const name = [place?.areaName?.[0]?.value, place?.country?.[0]?.value].filter(Boolean).join(', ') || city;
      await ctx.reply(card('🌦️ WEATHER', [
        `Place: ${name}`, `Now: ${c.weatherDesc?.[0]?.value || '-'}`, `Temp: ${c.temp_C}°C (feels ${c.FeelsLikeC}°C)`,
        `Humidity: ${c.humidity}%`, `Wind: ${c.windspeedKmph} km/h`,
      ]));
    }),
  },
  {
    name: 'translate', alias: ['tr'], desc: 'Translate, e.g. .translate fr Good morning (or reply to a message)',
    run: safe(async (ctx) => {
      const lang = (ctx.args[0] || '').toLowerCase();
      if (!/^[a-z]{2,3}(-[a-z]{2})?$/.test(lang)) return ctx.reply(fail('Example: .translate sw How are you?\nOr reply to a message with: .translate fr'));
      const text = (ctx.args.slice(1).join(' ') || quotedText(ctx.quotedMsg)).trim().slice(0, 450);
      if (!text) return ctx.reply(fail('Add text after the language, or reply to a message.'));
      const d = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${lang}`, 20000);
      const out = d.responseData?.translatedText;
      if (!out || d.responseStatus >= 400) throw userError('Could not translate that. Check the language code (e.g. en, fr, sw, es).');
      await ctx.reply(card('🌍 TRANSLATE', [`To: ${lang}`, out]));
    }),
  },
  {
    name: 'define', alias: ['dictionary'], desc: 'Meaning of an English word',
    run: safe(async (ctx) => {
      const word = (ctx.text || '').trim().toLowerCase();
      if (!/^[a-z'-]{1,40}$/.test(word)) return ctx.reply(fail('Example: .define resilience'));
      const d = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const meanings = (d[0]?.meanings || []).slice(0, 3);
      if (!meanings.length) throw userError('Word not found.');
      const lines = [`Word: ${d[0].word}`];
      for (const m of meanings) lines.push(`(${m.partOfSpeech}) ${m.definitions?.[0]?.definition || ''}`.slice(0, 220));
      await ctx.reply(card('📖 DEFINE', lines));
    }),
  },
  {
    name: 'wiki', alias: ['wikipedia'], desc: 'Wikipedia summary, e.g. .wiki Nairobi',
    run: safe(async (ctx) => {
      const q = (ctx.text || '').trim().slice(0, 100);
      if (!q) return ctx.reply(fail('Example: .wiki Nairobi'));
      const d = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, '_'))}?redirect=true`);
      if (!d.extract) throw userError('No article found.');
      await ctx.reply(card(`📚 ${String(d.title || q).toUpperCase().slice(0, 40)}`, [d.extract.slice(0, 700), d.content_urls?.desktop?.page || '']));
    }),
  },
  {
    name: 'qr', desc: 'Make a QR code, e.g. .qr https://adez.tech',
    run: safe(async (ctx) => {
      const data = (ctx.text || '').trim().slice(0, 500);
      if (!data) return ctx.reply(fail('Example: .qr https://example.com'));
      const r = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(data)}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await ctx.sock.sendMessage(ctx.jid, { image: Buffer.from(await r.arrayBuffer()), caption: card('🔳 QR CODE', data.slice(0, 80)) }, { quoted: ctx.m });
    }),
  },
  {
    name: 'password', alias: ['genpass'], desc: 'Strong random password, e.g. .password 20',
    run: safe(async (ctx) => {
      const length = Math.min(64, Math.max(8, parseInt(ctx.args[0], 10) || 16));
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?';
      let out = '';
      for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
      await ctx.reply(card('🔐 PASSWORD', [out, 'Keep it private. Do not reuse it.']));
    }),
  },
  { name: 'uuid', desc: 'Generate a UUID', run: safe(async (ctx) => ctx.reply(card('🆔 UUID', crypto.randomUUID()))) },
  {
    name: 'base64', alias: ['b64'], desc: 'Encode/decode, e.g. .base64 encode hello',
    run: safe(async (ctx) => {
      const mode = (ctx.args[0] || '').toLowerCase();
      const text = ctx.args.slice(1).join(' ') || quotedText(ctx.quotedMsg);
      if (!['encode', 'decode'].includes(mode) || !text) return ctx.reply(fail('Example: .base64 encode hello\n.base64 decode aGVsbG8='));
      if (mode === 'decode' && !/^[A-Za-z0-9+/=\s_-]+$/.test(text)) throw userError('That is not valid Base64.');
      const out = mode === 'encode' ? Buffer.from(text).toString('base64') : Buffer.from(text, 'base64').toString('utf8');
      await ctx.reply(card('🔡 BASE64', out.slice(0, 1500)));
    }),
  },
  {
    name: 'hash', desc: 'Hash text, e.g. .hash sha256 hello',
    run: safe(async (ctx) => {
      const algo = (ctx.args[0] || '').toLowerCase();
      const text = ctx.args.slice(1).join(' ');
      if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo) || !text) return ctx.reply(fail('Example: .hash sha256 hello\nAlgorithms: md5, sha1, sha256, sha512'));
      await ctx.reply(card('#️⃣ HASH', [algo.toUpperCase(), crypto.createHash(algo).update(text).digest('hex')]));
    }),
  },
  {
    name: 'bmi', desc: 'Body mass index, e.g. .bmi 70 175 (kg cm)',
    run: safe(async (ctx) => {
      const kg = parseFloat(ctx.args[0]); const cm = parseFloat(ctx.args[1]);
      if (!(kg > 10 && kg < 400) || !(cm > 50 && cm < 260)) return ctx.reply(fail('Example: .bmi 70 175  (weight kg, height cm)'));
      const bmi = kg / (cm / 100) ** 2;
      const label = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
      await ctx.reply(card('⚖️ BMI', [`BMI: ${bmi.toFixed(1)}`, `Range: ${label}`, 'A general guide only, not medical advice.']));
    }),
  },
  {
    name: 'count', alias: ['wordcount'], desc: 'Count words and characters',
    run: safe(async (ctx) => {
      const text = ctx.text || quotedText(ctx.quotedMsg);
      if (!text) return ctx.reply(fail('Example: .count some text here'));
      await ctx.reply(card('🔢 COUNT', [`Characters: ${[...text].length}`, `Words: ${text.trim().split(/\s+/).length}`]));
    }),
  },
];
