// Keith-style menus: main card, full text list (.menu2) and numbered reply menu (.menu3).
const { boldSerif } = require('./fancy');
const { brandQuote, locationQuote } = require('./brand');

const DEFAULT_LINK = 'https://host.stanymaxhub.online/services/bots/adez-xmd-5328';
const linkOf = (config) => config.botLink || DEFAULT_LINK;

const CATEGORIES = [
  ['General', ['menu', 'menu2', 'menu3', 'alive', 'ping', 'uptime', 'time', 'date', 'owner', 'adst', 'pair']],
  ['Group', ['kick', 'add', 'promote', 'demote', 'tagall', 'hidetag', 'admins', 'groupinfo', 'link', 'revoke', 'closegroup', 'opengroup', 'setname', 'setdesc', 'events', 'del', 'leave', 'gpic', 'anti', 'warn', 'warnings', 'resetwarn', 'addbad', 'delbad', 'badwords']],
  ['Tools', ['rank', 'settings', 'calc', 'reverse', 'say', 'weather', 'translate', 'define', 'wiki', 'qr', 'password', 'uuid', 'base64', 'hash', 'bmi', 'count']],
  ['AI', ['ai', 'ask', 'chatgpt', 'adezai', 'gpt']],
  ['Download', ['play', 'yts', 'dl', 'dlimage', 'dlvideo', 'dlaudio', 'apk', 'facebook', 'instagram', 'tgsticker', 'gitzip', 'gitfile', 'npm']],
  ['GitHub', ['github', 'repo', 'repos', 'ghsearch', 'ghissues', 'ghcommits', 'ghrelease']],
  ['Settings', ['mode', 'toggle', 'setprefix', 'setbotname', 'setpic', 'vv']],
  ['Fun', ['quote', 'fact', 'flip', 'dice', '8ball', 'joke', 'choose', 'rate', 'truth', 'dare', 'ship', 'pickup', 'compliment', 'roast']],
];

function getGroups(list) {
  const names = list.filter((c) => !c.hidden).map((c) => c.name);
  const known = new Set(CATEGORIES.flatMap(([, cmds]) => cmds));
  const result = CATEGORIES
    .map(([title, cmds]) => ({ title, commands: cmds.filter((n) => names.includes(n)) }))
    .filter((s) => s.commands.length);
  const other = names.filter((n) => !known.has(n));
  if (other.length) result.push({ title: 'Other', commands: other });
  return result;
}

const nameOf = (ctx) => ctx.m.pushName || ctx.num(ctx.sender);
const countOf = (sections) => sections.reduce((n, s) => n + s.commands.length, 0);

function headerBox(ctx, sections) {
  return [
    `└►Hey, ${nameOf(ctx)}`,
    `╭───〔 ${ctx.config.botName} 〕──────────···`,
    `│ ✻ │▸ ${boldSerif('TOTAL PLUGINS')}: ${countOf(sections)}`,
    '╰──────────────────⊷',
  ].join('\n');
}

function categoryBox(section) {
  return [
    `┌───「 ${section.title.toUpperCase()} 」──────────•••`,
    ...section.commands.map((c) => `│ ◦➛ ${c}`),
    '└────────────────────•••',
  ].join('\n');
}

const footer = (ctx) => `WHATSAPP BOT BY ${ctx.config.botName.toUpperCase()}`;

function mainText(ctx, sections) {
  const box = headerBox(ctx, sections).split('\n').slice(1).join('\n');
  return [
    `👋 Hey, @${ctx.num(ctx.sender)}`,
    '',
    box,
    '',
    'Tap *Browse Categories* to see commands.',
    '',
    'You can as well use:',
    '│ .menu2 (Full Text List)',
    '│ .menu3 (Interactive Reply Menu)',
    '│ .menu <category> (example: .menu group)',
    '',
    `│ ${footer(ctx)}`,
  ].join('\n');
}

function fullText(ctx, sections) {
  return [headerBox(ctx, sections), '', ...sections.map(categoryBox).flatMap((b) => [b, '']), footer(ctx)].join('\n');
}

function numberedText(ctx, sections) {
  return [
    headerBox(ctx, sections),
    '',
    '┌───◇ CATEGORIES ◇───────•••',
    '│ 「 Reply with a number below 」',
    ...sections.map((s, i) => `│ ◦➛ ${i + 1}. ${s.title.toUpperCase()}`),
    '└────────────────────•••',
    '',
    footer(ctx),
  ].join('\n');
}

// Message id -> categories, so a numbered reply to .menu3 opens that category
const pending = new Map();
function remember(id, sections) {
  if (!id) return;
  pending.set(id, sections);
  if (pending.size > 100) pending.delete(pending.keys().next().value);
}

// Picture for the card: taken from the hosting page (og:image / twitter:image), cached for an hour.
// Falls back to BOT_PIC when the page has no image or cannot be reached.
let imgCache = { url: null, at: 0 };
async function cardImage(config) {
  if (imgCache.url && Date.now() - imgCache.at < 3600000) return imgCache.url;
  let found = null;
  try {
    const res = await fetch(linkOf(config), { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'Mozilla/5.0' } });
    const html = (await res.text()).slice(0, 200000);
    const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i);
    const val = tag && tag[0].match(/content=["']([^"']+)["']/i);
    if (val) found = new URL(val[1].replace(/&amp;/g, '&'), linkOf(config)).href;
  } catch (e) { /* use fallback */ }
  imgCache = { url: found || config.botPic, at: Date.now() };
  return imgCache.url;
}

// Sends text under a picture card with the branded quote on top; tapping it opens BOT_LINK
async function sendCard(ctx, text, mentions = []) {
  const { config } = ctx;
  const thumb = await cardImage(config);
  return ctx.sock.sendMessage(ctx.jid, {
    text,
    mentions,
    contextInfo: {
      mentionedJid: mentions,
      externalAdReply: {
        title: config.botName,
        body: 'Click to open hosting site',
        thumbnailUrl: thumb,
        sourceUrl: linkOf(config),
        mediaType: 1,
        renderLargerThumbnail: true,
      },
    },
  }, { quoted: brandQuote(ctx.sock, ctx.m) });
}


// Interactive menu: "Tap Here!" opens a sheet with "Hosting Site" and "Next Page" (category list).
// Picking a category sends back ".menu <category>", which the handler runs as a normal command.
async function sendButtonMenu(ctx, text, sections, mentions = []) {
  const { config, sock } = ctx;
  const { generateWAMessageFromContent } = require('./baileys').baileys();
  const link = linkOf(config);
  const pre = config.noPrefix ? '' : ((config.prefix || ['.'])[0] || '.');
  const rows = sections.map((s) => ({
    header: '',
    title: s.title.toUpperCase(),
    description: `There are ${s.commands.length} commands`,
    id: `${pre}menu ${s.title.toLowerCase()}`,
  }));
  const thumb = await cardImage(config);
  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: {
          body: { text },
          header: { title: '', hasMediaAttachment: false },
          contextInfo: {
            mentionedJid: mentions,
            externalAdReply: {
              title: config.botName, body: 'Click to open hosting site', thumbnailUrl: thumb,
              sourceUrl: link, mediaType: 1, renderLargerThumbnail: true,
            },
          },
          nativeFlowMessage: {
            buttons: [
              { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Hosting Site', url: link, merchant_url: link }) },
              { name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Next Page', sections: [{ title: 'Select Menu', rows }] }) },
            ],
            messageParamsJson: '',
          },
        },
      },
    },
  };
  const name = ctx.m.pushName || ctx.num(ctx.sender);
  const msg = generateWAMessageFromContent(ctx.jid, content, { quoted: locationQuote(sock, ctx.m, `Hi ${name}`), userJid: sock.user.id });
  const nodes = [{ tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }];
  if (!ctx.isGroup) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
  await sock.relayMessage(ctx.jid, msg.message, { messageId: msg.key.id, additionalNodes: nodes });
  try { require('./handler').sentCache.set(msg.key.id, msg.message); } catch (e) { /* retry cache is optional */ }
  return msg;
}

module.exports = { sendButtonMenu, cardImage, linkOf, getGroups, categoryBox, mainText, fullText, numberedText, pending, remember, sendCard };
               
