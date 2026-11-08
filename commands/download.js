const crypto = require('crypto');
const dns = require('dns/promises');
const net = require('net');

const card = (title, lines) =>
  `╔═══ ${title} ═══\n${[].concat(lines).map((l) => `║ ◆ ${l}`).join('\n')}\n╚══════════════`;
const fail = (msg) => card('⚠️ ERROR', msg);
const MAX_MB = 40;
const MAX_SONG_MB = 30;
const MAX_APK_MB = 60;
const MAX_VIDEO_MB = 50;

// ---------- shared helpers ----------

const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error('download command error:', e && e.message);
    let msg = 'Something went wrong. Try again later.';
    if (e && e.notFound) msg = 'Not found. Check the spelling.';
    if (e && e.blocked) msg = 'That link is not allowed.';
    await ctx.reply(fail(msg));
  }
};

const react = async (ctx, emoji) => {
  try {
    await ctx.sock.sendMessage(ctx.jid, { react: { text: emoji, key: ctx.m.key } });
  } catch (e) {}
};

function blockedError() {
  const e = new Error('blocked');
  e.blocked = true;
  return e;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd')) return true;
    const m = l.match(/^::ffff:([0-9.]+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  return true;
}

async function assertPublic(rawUrl) {
  const u = new URL(rawUrl);
  if (!/^https?:$/.test(u.protocol)) throw blockedError();
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) throw blockedError();
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw blockedError();
    return u;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw blockedError();
  return u;
}

async function parseLink(text) {
  let u;
  try {
    u = new URL((text || '').trim());
  } catch (e) {
    return null;
  }
  return assertPublic(u.href);
}

async function fetchFile(url, maxMb = MAX_MB) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot' } });
  if (r.status === 404) {
    const e = new Error('not found');
    e.notFound = true;
    throw e;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const limit = maxMb * 1024 * 1024;
  if (Number(r.headers.get('content-length') || 0) > limit) return { tooBig: true };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > limit) return { tooBig: true };
  return { buf, type: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0] };
}

async function getJsonSafe(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const validRepo = (s) => /^[\w.-]+\/[\w.-]+$/.test(s || '');

// ---------- .play (YouTube song) ----------

const ST_BASE = 'https://media.savetube.me/api';
const ST_HEADERS = {
  accept: '*/*',
  'content-type': 'application/json',
  origin: 'https://yt.savetube.me',
  referer: 'https://yt.savetube.me/',
  'user-agent': 'Mozilla/5.0',
};

function youtubeId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = (url || '').match(p);
    if (m) return m[1];
  }
  return null;
}

function stDecrypt(enc) {
  const key = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
  const data = Buffer.from(enc, 'base64');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, data.subarray(0, 16));
  const out = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
  return JSON.parse(out.toString());
}

async function stPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: ST_HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function getMp3Link(id) {
  const cdnRes = await fetch(`${ST_BASE}/random-cdn`, { headers: ST_HEADERS });
  if (!cdnRes.ok) throw new Error('HTTP ' + cdnRes.status);
  const cdn = (await cdnRes.json()).cdn;
  const info = await stPost(`https://${cdn}/v2/info`, { url: `https://www.youtube.com/watch?v=${id}` });
  const dec = stDecrypt(info.data);
  const dl = await stPost(`https://${cdn}/download`, {
    id,
    downloadType: 'audio',
    quality: '128',
    key: dec.key,
  });
  return { title: dec.title || 'Song', link: dl.data.downloadUrl };
}

const playCommand = {
  name: 'play',
  alias: ['song'],
  desc: 'Send a song from YouTube (name or link)',
  run: async (ctx) => {
    const query = (ctx.text || '').trim();
    if (!query) return ctx.reply(fail('Example: .play Faded Alan Walker'));
    try {
      await react(ctx, '⏳');

      let id = youtubeId(query);
      let title = '';
      let thumb = '';
      let page = '';

      if (!id) {
        let yts;
        try {
          yts = require('yt-search');
        } catch (e) {
          await react(ctx, '❌');
          return ctx.reply(fail('Search is not installed yet. Add yt-search to package.json.'));
        }
        const res = await yts(query);
        const v = res.videos && res.videos[0];
        if (!v) {
          await react(ctx, '❌');
          return ctx.reply(fail('No song found. Try other words.'));
        }
        id = v.videoId;
        title = v.title;
        thumb = v.thumbnail;
        page = v.url;
      }

      const song = await getMp3Link(id);
      title = title || song.title;
      page = page || `https://www.youtube.com/watch?v=${id}`;

      const f = await fetchFile(song.link, MAX_SONG_MB);
      if (f.tooBig) {
        await react(ctx, '❌');
        return ctx.reply(fail(`That song is bigger than ${MAX_SONG_MB} MB.`));
      }

      const fileName = `${title.replace(/[^\w\s.-]/g, '').trim().slice(0, 60) || 'song'}.mp3`;
      const base = { audio: f.buf, mimetype: 'audio/mpeg', fileName };

      try {
        await ctx.sock.sendMessage(ctx.jid, {
          ...base,
          contextInfo: {
            externalAdReply: {
              title: `🎵 ${title}`,
              body: `${ctx.config.botName} • ADEZ TECH`,
              mediaType: 2,
              thumbnailUrl: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              sourceUrl: page,
            },
          },
        });
      } catch (e) {
        await ctx.sock.sendMessage(ctx.jid, base);
      }
      await react(ctx, '✅');
    } catch (e) {
      console.error('play error:', e && e.message);
      await react(ctx, '❌');
      await ctx.reply(fail('Could not get that song right now. Try again later.'));
    }
  },
};

// ---------- direct link downloads ----------

function mediaCommand(name, kind, example) {
  return {
    name,
    desc: `Send a direct link as ${kind}`,
    run: safe(async (ctx) => {
      const url = await parseLink(ctx.text);
      if (!url) return ctx.reply(fail(`Example: .${name} ${example}`));
      const f = await fetchFile(url.href);
      if (f.tooBig) return ctx.reply(fail(`That file is bigger than ${MAX_MB} MB.`));
      if (!f.type.startsWith(kind + '/')) {
        return ctx.reply(fail(`That link is not a ${kind} file. Use .dl for other files.`));
      }
      const caption = card(`📥 ${kind.toUpperCase()}`, ['Powered by ADEZ TECH']);
      if (kind === 'image') await ctx.sock.sendMessage(ctx.jid, { image: f.buf, caption });
      else if (kind === 'video') await ctx.sock.sendMessage(ctx.jid, { video: f.buf, mimetype: f.type, caption });
      else await ctx.sock.sendMessage(ctx.jid, { audio: f.buf, mimetype: f.type });
    }),
  };
}

// ---------- Facebook helpers ----------

const FB_PATTERNS = [
  /https?:\/\/(?:www\.|m\.)?facebook\.com\/.+\/videos\/.+/i,
  /https?:\/\/(?:www\.|m\.)?facebook\.com\/watch/i,
  /https?:\/\/(?:www\.|m\.)?fb\.watch\/.+/i,
  /https?:\/\/(?:www\.)?facebook\.com\/reel\/.+/i,
  /https?:\/\/(?:www\.)?facebook\.com\/share\/.+/i,
  /https?:\/\/(?:www\.)?facebook\.com\/.+\/video/i,
  /https?:\/\/(?:www\.)?fb\.com\/.+/i,
];
const isFbUrl = (u) => FB_PATTERNS.some((p) => p.test(u));

async function fbInfo(link) {
  try {
    const d = await getJsonSafe(`https://api.bk9.dev/download/fb?url=${encodeURIComponent(link)}`);
    const b = d && d.status && d.BK9;
    if (b && (b.hd || b.sd)) return { hd: b.hd || null, sd: b.sd || null, title: b.title || 'Facebook Video' };
  } catch (e) {}
  for (const ep of ['fb', 'fb2']) {
    try {
      const d = await getJsonSafe(`https://apis.xcasper.space/api/downloader/${ep}?url=${encodeURIComponent(link)}`);
      if (!d || !d.success) continue;
      const x = d.data || {};
      const medias = x.medias || x.media || d.medias || d.media || [];
      const first = Array.isArray(medias) && medias[0] && medias[0].url;
      const hd = d.hd || x.hd || null;
      const sd = d.sd || x.sd || d.url || x.url || first || null;
      if (hd || sd) return { hd, sd, title: d.title || x.title || 'Facebook Video' };
    } catch (e) {}
  }
  return null;
}

// ---------- commands ----------

module.exports = [
  playCommand,
  {
    name: 'dl',
    desc: 'Download a file from a direct link',
    run: safe(async (ctx) => {
      const url = await parseLink(ctx.text);
      if (!url) return ctx.reply(fail('Example: .dl https://example.com/file.pdf'));
      const f = await fetchFile(url.href);
      if (f.tooBig) return ctx.reply(fail(`That file is bigger than ${MAX_MB} MB.`));
      const fileName = decodeURIComponent(url.pathname.split('/').pop() || '') || 'file';
      await ctx.sock.sendMessage(ctx.jid, { document: f.buf, mimetype: f.type, fileName });
    }),
  },
  mediaCommand('dlimage', 'image', 'https://example.com/photo.jpg'),
  mediaCommand('dlvideo', 'video', 'https://example.com/clip.mp4'),
  mediaCommand('dlaudio', 'audio', 'https://example.com/song.mp3'),
  {
    name: 'apk',
    alias: ['app', 'apkdl'],
    desc: 'Download an APK by app name',
    run: async (ctx) => {
      const appName = (ctx.text || '').trim();
      if (!appName) return ctx.reply(fail('Example: .apk WhatsApp'));
      try {
        await react(ctx, '⏳');
        const data = await getJsonSafe(
          `https://api.giftedtech.co.ke/api/download/apkdl?apikey=gifted&appName=${encodeURIComponent(appName)}`
        );
        const app = data && data.success && data.result;
        if (!app || !app.download_url) {
          await react(ctx, '❌');
          return ctx.reply(fail('App not found. Check the spelling.'));
        }
        await assertPublic(app.download_url);
        const f = await fetchFile(app.download_url, MAX_APK_MB);
        if (f.tooBig) {
          await react(ctx, '❌');
          return ctx.reply(
            card('📱 APK', [`${app.appname} is bigger than ${MAX_APK_MB} MB`, `Download : ${app.download_url}`])
          );
        }
        const size = (f.buf.length / (1024 * 1024)).toFixed(1);
        await ctx.sock.sendMessage(ctx.jid, {
          document: f.buf,
          fileName: `${String(app.appname).replace(/[^a-zA-Z0-9]/g, '_')}.apk`,
          mimetype: app.mimetype || 'application/vnd.android.package-archive',
          caption: card('📱 APK', [
            `Name : ${app.appname}`,
            `Developer : ${app.developer || 'Unknown'}`,
            `Size : ${size} MB`,
          ]),
        });
        await react(ctx, '✅');
      } catch (e) {
        console.error('apk error:', e && e.message);
        await react(ctx, '❌');
        await ctx.reply(fail('Could not download that app right now. Try again later.'));
      }
    },
  },
  {
    name: 'facebook',
    alias: ['fb', 'fbdl'],
    desc: 'Download a Facebook video or reel',
    run: async (ctx) => {
      const link = (ctx.text || '').trim();
      if (!link) return ctx.reply(fail('Example: .fb https://fb.watch/xxxx'));
      if (!isFbUrl(link)) return ctx.reply(fail('Send a public Facebook video, reel or watch link.'));
      try {
        await react(ctx, '⏳');
        const info = await fbInfo(link);
        if (!info) {
          await react(ctx, '❌');
          return ctx.reply(fail('Could not get that video. Make sure it is public.'));
        }
        let file = null;
        let bigLink = null;
        for (const u of [...new Set([info.hd, info.sd].filter(Boolean))]) {
          try {
            await assertPublic(u);
            const f = await fetchFile(u, MAX_VIDEO_MB);
            if (f.tooBig) {
              bigLink = bigLink || u;
              continue;
            }
            if (f.buf.length > 10000) {
              file = f;
              break;
            }
          } catch (e) {}
        }
        if (!file) {
          await react(ctx, '❌');
          return ctx.reply(
            bigLink
              ? card('📘 FACEBOOK', [`Video is bigger than ${MAX_VIDEO_MB} MB`, `Download : ${bigLink}`])
              : fail('Download failed. Try again later.')
          );
        }
        const size = (file.buf.length / (1024 * 1024)).toFixed(1);
        await ctx.sock.sendMessage(ctx.jid, {
          video: file.buf,
          mimetype: 'video/mp4',
          caption: card('📘 FACEBOOK', [`Title : ${String(info.title).slice(0, 80)}`, `Size : ${size} MB`]),
        });
        await react(ctx, '✅');
      } catch (e) {
        console.error('facebook error:', e && e.message);
        await react(ctx, '❌');
        await ctx.reply(fail('Could not download that video right now. Try again later.'));
      }
    },
  },
  {
    name: 'instagram',
    alias: ['ig', 'igdl', 'insta'],
    desc: 'Download an Instagram reel or post',
    run: async (ctx) => {
      const [link, pick] = (ctx.text || '').trim().split(/\s+/);
      const ok = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(p|reel|tv|reels)\/[a-zA-Z0-9_-]+/i.test(link || '');
      if (!ok) return ctx.reply(fail('Example: .ig https://instagram.com/reel/xxxx'));
      try {
        await react(ctx, '⏳');
        const d = await getJsonSafe(`https://api.bk9.dev/download/instagram?url=${encodeURIComponent(link)}`);
        const items = d && d.status && Array.isArray(d.BK9) ? d.BK9.filter((i) => i && i.url).slice(0, 4) : [];
        if (!items.length) {
          await react(ctx, '❌');
          return ctx.reply(fail('No media found. Make sure the post is public.'));
        }
        const n = Math.min(Math.max(parseInt(pick, 10) || 1, 1), items.length);
        const item = items[n - 1];
        const isVideo = item.type === 'video' || /\.mp4/i.test(item.url);
        await assertPublic(item.url);
        const f = await fetchFile(item.url, MAX_VIDEO_MB);
        if (f.tooBig) {
          await react(ctx, '❌');
          return ctx.reply(card('📷 INSTAGRAM', [`Bigger than ${MAX_VIDEO_MB} MB`, `Download : ${item.url}`]));
        }
        const size = (f.buf.length / (1024 * 1024)).toFixed(1);
        const lines = [`Type : ${isVideo ? 'Video' : 'Photo'}`, `Size : ${size} MB`];
        if (items.length > 1) lines.push(`Item : ${n} of ${items.length} (add a number after the link for others)`);
        const caption = card('📷 INSTAGRAM', lines);
        if (isVideo) await ctx.sock.sendMessage(ctx.jid, { video: f.buf, mimetype: 'video/mp4', caption });
        else await ctx.sock.sendMessage(ctx.jid, { image: f.buf, caption });
        await react(ctx, '✅');
      } catch (e) {
        console.error('instagram error:', e && e.message);
        await react(ctx, '❌');
        await ctx.reply(fail('Could not download that post right now. Try again later.'));
      }
    },
  },
  {
    name: 'yts',
    alias: ['ytsearch'],
    desc: 'Search YouTube videos',
    run: async (ctx) => {
      const query = (ctx.text || '').trim();
      if (!query) return ctx.reply(fail('Example: .yts Faded Alan Walker'));
      try {
        await react(ctx, '⏳');
        let yts;
        try {
          yts = require('yt-search');
        } catch (e) {
          await react(ctx, '❌');
          return ctx.reply(fail('Search is not installed yet. Add yt-search to package.json.'));
        }
        const res = await yts(query);
        const items = (res.videos || []).slice(0, 8);
        if (!items.length) {
          await react(ctx, '❌');
          return ctx.reply(fail('No results. Try other words.'));
        }
        const head = card('🔍 YOUTUBE SEARCH', [`Query : ${query}`, `Results : ${items.length}`]);
        const body = items
          .map(
            (v, i) =>
              `*${i + 1}. ${v.title}*\n   ⏱ ${v.timestamp || 'n/a'} • ${(v.author && v.author.name) || 'Unknown'}\n   🔗 ${v.url}`
          )
          .join('\n\n');
        const foot = card('💡 TIP', ['Send .play <link> to get the song']);
        await ctx.reply([head, body, foot].join('\n\n'));
        await react(ctx, '✅');
      } catch (e) {
        console.error('yts error:', e && e.message);
        await react(ctx, '❌');
        await ctx.reply(fail('Search failed. Try again later.'));
      }
    },
  },
  {
    name: 'tgsticker',
    alias: ['tgs', 'telesticker', 'tgpack'],
    desc: 'Get a Telegram sticker (name | sticker no | pack no)',
    run: async (ctx) => {
      const parts = (ctx.text || '').split('|').map((s) => s.trim());
      const query = parts[0];
      if (!query) return ctx.reply(fail('Example: .tgs pepe   or   .tgs pepe | 2 | 1'));
      try {
        await react(ctx, '⏳');
        const d = await getJsonSafe(`https://apiskeith.top/download/tgstories?q=${encodeURIComponent(query)}`);
        const packs = d && d.status === true && Array.isArray(d.result) ? d.result : [];
        if (!packs.length) {
          await react(ctx, '❌');
          return ctx.reply(fail('No sticker packs found. Try another word.'));
        }
        const packNo = Math.min(Math.max(parseInt(parts[2], 10) || 1, 1), packs.length);
        const stickers = (packs[packNo - 1].stickers || []).filter((s) => s && s.imageUrl);
        if (!stickers.length) {
          await react(ctx, '❌');
          return ctx.reply(fail('That pack has no stickers. Try another pack number.'));
        }
        const n = Math.min(Math.max(parseInt(parts[1], 10) || 1, 1), stickers.length);
        const url = stickers[n - 1].imageUrl;
        await assertPublic(url);
        const f = await fetchFile(url, 5);
        if (f.tooBig) {
          await react(ctx, '❌');
          return ctx.reply(fail('That sticker is too big.'));
        }
        await ctx.sock.sendMessage(ctx.jid, { sticker: f.buf, mimetype: 'image/webp' });
        await react(ctx, '✅');
      } catch (e) {
        console.error('tgsticker error:', e && e.message);
        await react(ctx, '❌');
        await ctx.reply(fail('Could not get that sticker right now. Try again later.'));
      }
    },
  },
  {
    name: 'gitzip',
    desc: 'Download a GitHub repo as zip',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim();
      if (!validRepo(name)) return ctx.reply(fail('Example: .gitzip adeztech2/adez-md'));
      const f = await fetchFile(`https://api.github.com/repos/${name}/zipball`);
      if (f.tooBig) return ctx.reply(fail(`That repo is bigger than ${MAX_MB} MB.`));
      await ctx.sock.sendMessage(ctx.jid, {
        document: f.buf,
        mimetype: 'application/zip',
        fileName: `${name.split('/')[1]}.zip`,
      });
    }),
  },
  {
    name: 'gitfile',
    desc: 'Download one file from a GitHub repo',
    run: safe(async (ctx) => {
      const [repo, path, branchArg] = (ctx.text || '').trim().split(/\s+/);
      if (!validRepo(repo) || !path || path.includes('..')) {
        return ctx.reply(fail('Example: .gitfile adeztech2/adez-md package.json'));
      }
      let branch = branchArg;
      if (!branch) {
        const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { 'User-Agent': 'adez-xmd-bot' } });
        if (r.status === 404) return ctx.reply(fail('Repo not found.'));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        branch = (await r.json()).default_branch;
      }
      const f = await fetchFile(`https://raw.githubusercontent.com/${repo}/${branch}/${path}`);
      if (f.tooBig) return ctx.reply(fail(`That file is bigger than ${MAX_MB} MB.`));
      await ctx.sock.sendMessage(ctx.jid, {
        document: f.buf,
        mimetype: f.type,
        fileName: path.split('/').pop(),
      });
    }),
  },
  {
    name: 'npm',
    desc: 'Get info and the package file of an npm package',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim().toLowerCase();
      if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) return ctx.reply(fail('Example: .npm express'));
      const r = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, {
        headers: { 'User-Agent': 'adez-xmd-bot' },
      });
      if (r.status === 404) return ctx.reply(fail('Package not found.'));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const p = await r.json();
      const lines = [`Name : ${p.name}`, `Version : ${p.version}`];
      if (p.description) lines.push(`About : ${p.description}`);
      if (p.license) lines.push(`License : ${typeof p.license === 'string' ? p.license : p.license.type}`);
      lines.push(`Link : https://www.npmjs.com/package/${p.name}`);
      const f = await fetchFile(p.dist.tarball);
      if (f.tooBig) return ctx.reply(card('📦 NPM', [...lines, `File : bigger than ${MAX_MB} MB, not sent`]));
      await ctx.sock.sendMessage(ctx.jid, {
        document: f.buf,
        mimetype: 'application/gzip',
        fileName: `${p.name.replace('/', '-').replace('@', '')}-${p.version}.tgz`,
        caption: card('📦 NPM', lines),
      });
    }),
  },
];
