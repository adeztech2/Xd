function uptime() {
  const s = Math.floor(process.uptime());
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

module.exports = [
  { name: 'alive', desc: 'Check whether bot is online', run: async ({ reply, config }) => reply(`${config.botName} is online.\nUptime: ${uptime()}`) },
  { name: 'ping', desc: 'Check response time', run: async ({ reply, m, config }) => { const sent = Number(m.messageTimestamp) * 1000; await reply(`${config.botName} speed\n\n${sent ? Math.max(0, Date.now() - sent) : 0} ms`); } },
  { name: 'uptime', desc: 'Show uptime', run: async ({ reply }) => reply(`Uptime: ${uptime()}`) },
  { name: 'time', desc: 'Show current time', run: async ({ reply, config }) => reply(new Date().toLocaleString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC' })) },
  { name: 'date', desc: 'Show today’s date', run: async ({ reply, config }) => reply(new Date().toLocaleDateString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC', dateStyle: 'full' })) },
  {
    name: 'adz',
    desc: 'Earn dollars by watching ads',
    run: async ({ reply }) => {
      const text = [
        '💰 *ADEZ PESA - Earn Dollars Online*',
        '',
        'ADEZ PESA is a site where you earn dollars by watching ads and inviting your friends.',
        '',
        '🎁 Join now and get *$10 free*!',
        '',
        '🔗 Register here:',
        'https://wa.me/arnoldadez',
      ].join('\n');
      await reply(text);
    },
  },
  {
    name: 'pair',
    desc: 'Get a pairing code to link WhatsApp',
    run: async ({ reply, text, prefix, config }) => {
      const p = prefix || config.prefix[0];
      const base = (process.env.PAIR_URL || 'https://adez-xmd-session-gen.onrender.com').replace(/\/+$/, '');
      const number = text.replace(/\D/g, '');
      if (!/^[1-9]\d{7,14}$/.test(number)) {
        return reply(`Usage: ${p}pair <number with country code>\nExample: ${p}pair 254111783552\n\nOr use the web page: ${base}/`);
      }
      try {
        const res = await fetch(`${base}/api/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'code', number }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.code) return reply(`❌ ${data.error || 'Could not get a pairing code. Try again.'}`);
        await reply([
          '🔗 *Pairing Code*',
          '',
          `*${data.code}*`,
          '',
          'Open WhatsApp > Linked devices > Link with phone number, then enter this code within 3 minutes.',
          'The bot will send your *SESSION_ID* to your own WhatsApp chat once linked.',
          '',
          '⚠️ Keep your SESSION_ID private. Anyone with it can control your WhatsApp.',
        ].join('\n'));
      } catch (error) {
        console.warn('pair failed:', error.message);
        await reply(`❌ Pair service unavailable. Use the web page instead: ${base}/`);
      }
    },
  },
];
