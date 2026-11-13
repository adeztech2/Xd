// Downloads through the Keith API. Each command calls {base}{path}?{param}=<input>
// and sends the first file link found in the JSON response.
// Base: KEITH_API_BASE if set, otherwise the default below.
const dns = require('dns/promises');
const net = require('net');

const DEFAULT_KEITH_API_BASE = 'https://keithhostdeploysite-22l75uk5-ff0ccc337078.herokuapp.com';
const MAX_MB = 50;
const TIMEOUT_MS = 60000;

const react = async (ctx, emoji) => {
  try {
    await ctx.sock.sendMessage(ctx.jid, { react: { text: emoji, key: ctx.m.key } });
  } catch (e) {}
};

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
  }
  return true;
}

// Refuses links that point at private or local addresses (SSRF protection).
async function assertPublic(rawUrl) {
  const u = new URL(rawUrl);
  if (!/^https?:$/.test(u.protocol)) throw new Error('blocked');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('blocked');
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked');
}

// Finds the first http(s) link in any JSON shape, preferring keys that usually hold download links.
function findLink(data) {
  const preferred = ['downloadUrl', 'download_url', 'downloadLink', 'url', 'link', 'download', 'audio', 'video', 'image', 'result'];
  if (typeof data === 'string') return /^https?:\/\//i.test(data) ? data : null;
  if (Array.isArray(data)) {
    for (const v of data) {
      const f = findLink(v);
      if (f) return f;
    }
    return null;
  }
  if (data && typeof data === 'object') {
    for (const k of preferred) {
      if (data[k] !== undefined) {
        const f = findLink(data[k]);
        if (f) return f;
      }
    }
    for (const v of Object.values(data)) {
      const f = findLink(v);
      if (f) return f;
    }
  }
  return null;
}

// Chooses how to send the file from its content type.
function sendKind(contentType) {
  const t = (contentType || '').toLowerCase();
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('image/')) return 'image';
  return 'document';
}

// param: 'url' for link inputs, 'q' for search terms.
function keithCommand({ name, path, param = 'url', usage, example, alias = [], desc, warning, fileName, needsLink = true }) {
  return {
    name,
    alias,
    desc,
    run: async (ctx) => {
      const prefix = ctx.prefix || ctx.config.prefix[0];
      const input = (ctx.text || '').trim();

      if (needsLink && !/^https?:\/\//i.test(input.split(/\s+/)[0] || '')) {
        return ctx.reply(`Usage: ${prefix}${name} ${usage}\nExample: ${prefix}${name} ${example}`);
      }
      if (!needsLink && !input) {
        return ctx.reply(`Usage: ${prefix}${name} ${usage}\nExample: ${prefix}${name} ${example}`);
      }

      const base = ((process.env.KEITH_API_BASE || '').trim() || DEFAULT_KEITH_API_BASE).replace(/\/+$/, '');
      const value = needsLink ? input.split(/\s+/)[0] : input;

      try {
        await react(ctx, '⏳');
        if (needsLink) await assertPublic(value);

        const apiRes = await fetch(`${base}${path}?${param}=${encodeURIComponent(value)}`, {
          headers: { 'User-Agent': 'adez-xmd-bot' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!apiRes.ok) throw new Error(`API HTTP ${apiRes.status}`);

        const media = findLink(await apiRes.json());
        if (!media) {
          await react(ctx, '❌');
          return ctx.reply('No download link was found. Check the link or search words and try again.');
        }

        await assertPublic(media);
        const fileRes = await fetch(media, {
          headers: { 'User-Agent': 'adez-xmd-bot' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!fileRes.ok) throw new Error(`file HTTP ${fileRes.status}`);

        const limit = MAX_MB * 1024 * 1024;
        const tooBig = () => ctx.reply(`That file is bigger than ${MAX_MB} MB.\nDownload: ${media}`);
        if (Number(fileRes.headers.get('content-length') || 0) > limit) {
          await react(ctx, '❌');
          return tooBig();
        }

        const buf = Buffer.from(await fileRes.arrayBuffer());
        if (buf.length > limit) {
          await react(ctx, '❌');
          return tooBig();
        }

        const contentType = (fileRes.headers.get('content-type') || 'application/octet-stream').split(';')[0];
        const kind = sendKind(contentType);

        if (warning) await ctx.reply(warning);

        if (kind === 'audio') {
          await ctx.sock.sendMessage(ctx.jid, { audio: buf, mimetype: contentType }, { quoted: ctx.m });
        } else if (kind === 'video') {
          await ctx.sock.sendMessage(
            ctx.jid,
            { video: buf, mimetype: contentType, caption: 'Powered by ADEZ TECH' },
            { quoted: ctx.m }
          );
        } else if (kind === 'image') {
          await ctx.sock.sendMessage(ctx.jid, { image: buf, caption: 'Powered by ADEZ TECH' }, { quoted: ctx.m });
        } else {
          await ctx.sock.sendMessage(
            ctx.jid,
            {
              document: buf,
              mimetype: contentType,
              fileName: fileName || 'download',
              caption: 'Powered by ADEZ TECH',
            },
            { quoted: ctx.m }
          );
        }
        await react(ctx, '✅');
      } catch (e) {
        console.error(`${name} error:`, e?.message || e);
        await react(ctx, '❌');
        await ctx.reply('Could not download that right now. Try again later.');
      }
    },
  };
}

const LINK_EXAMPLE = 'https://youtube.com/watch?v=60ItHLz5WEA';

module.exports = [
  keithCommand({
    name: 'keithaudio',
    alias: ['kaudio'],
    desc: 'Download audio from a YouTube link',
    path: '/download/audio',
    usage: '<link>',
    example: LINK_EXAMPLE,
  }),
  keithCommand({
    name: 'keithmp3',
    alias: ['kmp3', 'kytmp3'],
    desc: 'Download a YouTube link as MP3',
    path: '/download/ytmp3',
    usage: '<link>',
    example: LINK_EXAMPLE,
  }),
  keithCommand({
    name: 'keithdlmp3',
    alias: ['kdlmp3'],
    desc: 'Download a YouTube link as MP3 (second source)',
    path: '/download/dlmp3',
    usage: '<link>',
    example: LINK_EXAMPLE,
  }),
  keithCommand({
    name: 'keithvideo',
    alias: ['kvideo'],
    desc: 'Download video from a YouTube link',
    path: '/download/video',
    usage: '<link>',
    example: LINK_EXAMPLE,
  }),
  keithCommand({
    name: 'keithmp4',
    alias: ['kmp4', 'kytmp4'],
    desc: 'Download a YouTube link as MP4',
    path: '/download/dlmp4',
    usage: '<link>',
    example: LINK_EXAMPLE,
  }),
  keithCommand({
    name: 'keithpin',
    alias: ['kpin', 'kpinterest'],
    desc: 'Download a Pinterest image or video',
    path: '/download/pinterest',
    usage: '<pin link>',
    example: 'https://pin.it/1zdlg6EPT',
  }),
  keithCommand({
    name: 'keithig',
    alias: ['kig', 'kinsta'],
    desc: 'Download an Instagram reel or post',
    path: '/download/instadl',
    usage: '<instagram link>',
    example: 'https://www.instagram.com/reel/DD6q97IuzxD/',
  }),
  keithCommand({
    name: 'keithtt',
    alias: ['ktt', 'ktiktok'],
    desc: 'Download a TikTok video',
    path: '/download/tiktokdl3',
    usage: '<tiktok link>',
    example: 'https://vt.tiktok.com/ZSje1Vkup/',
  }),
  keithCommand({
    name: 'keithapk',
    alias: ['kapk'],
    desc: 'Download an APK from an app page link',
    path: '/download/apk',
    usage: '<app page link>',
    example: 'https://apk4all.com.im/apps/xender-share-music-transfer',
    fileName: 'app.apk',
    warning: '⚠️ APK files from third-party sites can be unsafe. Only install apps you trust.',
  }),
  keithCommand({
    name: 'keithncs',
    alias: ['kncs'],
    desc: 'Search No Copyright Sounds music and send the first result',
    path: '/download/ncs',
    param: 'q',
    needsLink: false,
    usage: '<search words>',
    example: 'alan walker',
    fileName: 'track.mp3',
  }),
];
