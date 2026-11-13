// Keith-style menus: main card, full text list (.menu2) and numbered reply menu (.menu3).
const { boldSerif } = require('./fancy');
const { brandQuote } = require('./brand');

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
  return [
    `👋 Hey, ${nameOf(ctx)}`,
    '',
    headerBox(ctx, sections).split('\n').slice(1).join('\n'),
    '',
    'Browse the commands with:',
    '│ .menu2 (Full Text List)',
    '│ .menu3 (Interactive Reply Menu)',
    '│ .menu <category> (example: .menu group)',
    '',
    footer(ctx),
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

// Sends text under a picture card (BOT_PIC) with the branded quote on top
function sendCard(ctx, text, mentions = []) {
  const { config } = ctx;
  return ctx.sock.sendMessage(ctx.jid, {
    text,
    mentions,
    contextInfo: {
      mentionedJid: mentions,
      externalAdReply: {
        title: config.botName,
        body: 'Click to open hosting site',
        thumbnailUrl: config.botPic,
        sourceUrl: config.botLink || `https://github.com/${config.botRepo}`,
        mediaType: 1,
        renderLargerThumbnail: true,
      },
    },
  }, { quoted: brandQuote(ctx.sock, ctx.m) });
}

module.exports = { getGroups, categoryBox, mainText, fullText, numberedText, pending, remember, sendCard };
