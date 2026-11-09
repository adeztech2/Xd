const LINE = '──────────────';
const MENU_IMAGE_PAGE = 'https://wa.me/message/FGI2ULZTWGCVL1';
const MAX_MENU_IMAGE_BYTES = 5 * 1024 * 1024;
const CATEGORIES = [
  ['General', '🌐', ['menu', 'alive', 'ping', 'uptime', 'time', 'date', 'owner']],
  ['Group', '👥', ['kick', 'add', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'closegroup', 'opengroup', 'setname', 'setdesc', 'events']],
  ['Tools', '🛠️', ['rank', 'vv', 'calc', 'reverse', 'say']], ['AI', '🤖', ['ai', 'ask', 'adezai']],
  ['Download', '📥', ['play', 'yts', 'dl', 'dlimage', 'dlvideo', 'dlaudio', 'apk', 'facebook', 'instagram', 'tgsticker', 'gitzip', 'gitfile', 'npm']],
  ['GitHub', '🐙', ['github', 'repo', 'repos', 'ghsearch', 'ghissues', 'ghcommits', 'ghrelease']],
  ['Settings', '⚙️', ['mode', 'toggle', 'settings', 'setprefix', 'setbotname', 'setpic']],
  ['Fun', '🎉', ['quote', 'fact', 'flip', 'dice', '8ball', 'joke']],
];

function getGroups(list) {
  const names = list.filter((command) => !command.hidden).map((command) => command.name);
  const known = new Set(CATEGORIES.flatMap(([, , commands]) => commands));
  const result = CATEGORIES
    .map(([title, icon, commands]) => ({ title, icon, commands: commands.filter((name) => names.includes(name)) }))
    .filter((item) => item.commands.length);
  const other = names.filter((name) => !known.has(name));
  if (other.length) result.push({ title: 'Other', icon: '➕', commands: other });
  return result;
}

function uptime() {
  const s = Math.floor(process.uptime());
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function getMetaContent(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const prop = tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (prop?.toLowerCase() !== property.toLowerCase()) continue;
    const value = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (value) return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return null;
}

async function fetchMenuImage() {
  const pageResponse = await fetch(MENU_IMAGE_PAGE, {
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ADEZ-XMD/1.0)', Accept: 'text/html' },
  });
  if (!pageResponse.ok) throw new Error(`WhatsApp page returned HTTP ${pageResponse.status}`);

  const pageHtml = await pageResponse.text();
  const imageUrl = getMetaContent(pageHtml, 'og:image');
  if (!imageUrl) throw new Error('WhatsApp page did not provide a public preview image');

  const parsedUrl = new URL(imageUrl, pageResponse.url || MENU_IMAGE_PAGE);
  const allowedHost = /(^|\.)(wa\.me|whatsapp\.com|whatsapp\.net|fbcdn\.net|fbsbx\.com)$/i.test(parsedUrl.hostname);
  if (parsedUrl.protocol !== 'https:' || !allowedHost) throw new Error('WhatsApp preview image URL is not trusted');

  const imageResponse = await fetch(parsedUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ADEZ-XMD/1.0)' },
  });
  if (!imageResponse.ok) throw new Error(`Preview image returned HTTP ${imageResponse.status}`);
  const finalHost = new URL(imageResponse.url).hostname;
  if (!/^([\w-]+\.)*(wa\.me|whatsapp\.com|whatsapp\.net|fbcdn\.net|fbsbx\.com)$/i.test(finalHost)) {
    throw new Error('Preview image redirected to an untrusted host');
  }
  if (!imageResponse.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
    throw new Error('WhatsApp preview did not return an image');
  }
  const length = Number(imageResponse.headers.get('content-length') || 0);
  if (length > MAX_MENU_IMAGE_BYTES) throw new Error('Preview image is larger than 5 MB');
  const image = Buffer.from(await imageResponse.arrayBuffer());
  if (!image.length || image.length > MAX_MENU_IMAGE_BYTES) throw new Error('Preview image is empty or larger than 5 MB');
  return image;
}

module.exports = [
  {
    name: 'menu', alias: ['help'], desc: 'Show commands',
    run: async ({ reply, sock, jid, m, list, prefix, config, sender, num }) => {
      const p = prefix || config.prefix[0];
      const sections = getGroups(list);
      const total = sections.reduce((n, item) => n + item.commands.length, 0);
      const header = [
        `┌──「 *⚡ ${config.botName}* 」`,
        `│ 👤 @${num(sender)}`,
        `│ 🌍 ${config.publicMode ? 'Public' : 'Private'} · ⏱ ${uptime()}`,
        `│ 📚 ${total} commands · Prefix ${config.prefix.join(' ')}`,
        `└${LINE}`,
      ].join('\n');
      const rows = sections.map((item) => [
        `┌──「 ${item.icon} *${item.title}* (${item.commands.length}) 」`,
        ...item.commands.map((command) => `│ ◦➛ ${p}${command}`),
        `└${LINE}`,
      ].join('\n'));
      const menuText = [header, ...rows, `_Use ${p}<command> to run a command._`].join('\n\n');

      try {
        const image = await fetchMenuImage();
        await sock.sendMessage(jid, { image, caption: menuText }, { quoted: m });
        return;
      } catch (error) {
        console.warn('Menu profile picture unavailable; sending text menu:', error.message);
      }

      await reply(menuText, { mentions: [sender] });
    },
  },
  { name: 'alive', desc: 'Check whether bot is online', run: async ({ reply, config }) => reply(`${config.botName} is online.\nUptime: ${uptime()}`) },
  { name: 'ping', desc: 'Check response time', run: async ({ reply, m }) => { const sent = Number(m.messageTimestamp) * 1000; await reply(`Speed: ${sent ? Math.max(0, Date.now() - sent) : 0} ms`); } },
  { name: 'uptime', desc: 'Show uptime', run: async ({ reply }) => reply(`Uptime: ${uptime()}`) },
  { name: 'time', desc: 'Show current time', run: async ({ reply, config }) => reply(new Date().toLocaleString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC' })) },
  { name: 'date', desc: 'Show today’s date', run: async ({ reply, config }) => reply(new Date().toLocaleDateString('en-GB', { timeZone: config.startupAlert?.timezone || 'UTC', dateStyle: 'full' })) },
  {
    name: 'owner',
    desc: 'Show owner contact',
    run: async ({ reply, config }) => {
      const ownerNumber = (config.owner || process.env.OWNER_NUMBER || '254111783552').replace(/\D/g, '');
      const ownerLink = `https://wa.me/${ownerNumber}`;
      await reply(`Owner: ${ownerLink}`);
    },
  },
];
