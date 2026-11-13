const crypto = require('crypto');
const dns = require('dns/promises');
const net = require('net');
const yts = require('yt-search');

const card = (_title, lines) => [].concat(lines).join('\n');
const fail = (msg) => msg;
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
  alias: ['song', 'ytmp3', 'yta'],
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
        console.error('play contextInfo error:', e && e.message);
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
      const caption = card('', ['Powered by ADEZ TECH']);
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
  } catch (e) {
    console.error('fbInfo bk9 failed:', e && e.message);
  }
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
    } catch (e) {
      console.error(`fbInfo xcasper ${ep} failed:`, e && e.message);
    }
  }
  return null;
}


// ---------- YouTube video (.video) ----------

async function getMp4Link(id) {
  const cdnRes = await fetch(`${ST_BASE}/random-cdn`, { headers: ST_HEADERS });
  if (!cdnRes.ok) throw new Error('HTTP ' + cdnRes.status);
  const cdn = (await cdnRes.json()).cdn;
  const info = await stPost(`https://${cdn}/v2/info`, { url: `https://www.youtube.com/watch?v=${id}` });
  const dec = stDecrypt(info.data);
  for (const quality of ['360', '480', '720', '240']) {
    try {
      const dl = await stPost(`https://${cdn}/download`, { id, downloadType: 'video', quality, key: dec.key });
      if (dl && dl.data && dl.data.downloadUrl) return { title: dec.title || 'Video', link: dl.data.downloadUrl, quality };
    } catch (e) {
      console.error(`video quality ${quality} failed:`, e && e.message);
    }
  }
  throw new Error('no video link');
}

// Sends a remote file as video/image/audio/document; if it is over the limit, sends the link instead
async function sendRemote(ctx, url, kind, { caption = '', fileName, maxMb = MAX_VIDEO_MB } = {}) {
  await assertPublic(url);
  const f = await fetchFile(url, maxMb);
  if (f.tooBig) {
    await ctx.reply(card('', [`That file is bigger than ${maxMb} MB`, `Download : ${url}`]));
    return false;
  }
  const size = (f.buf.length / (1024 * 1024)).toFixed(1);
  const cap = [caption, `Size : ${size} MB`].filter(Boolean).join('\n');
  if (kind === 'video') await ctx.sock.sendMessage(ctx.jid, { video: f.buf, mimetype: 'video/mp4', caption: cap });
  else if (kind === 'image') await ctx.sock.sendMessage(ctx.jid, { image: f.buf, caption: cap });
  else if (kind === 'audio') await ctx.sock.sendMessage(ctx.jid, { audio: f.buf, mimetype: 'audio/mpeg', fileName });
  else await ctx.sock.sendMessage(ctx.jid, { document: f.buf, mimetype: f.type, fileName: fileName || 'file', caption: cap });
  return true;
}

// Wraps a downloader: reaction states and a friendly error
const downloader = (name, fn) => async (ctx) => {
  try {
    await react(ctx, '⏳');
    const ok = await fn(ctx);
    await react(ctx, ok === false ? '❌' : '✅');
  } catch (e) {
    console.error(`${name} error:`, e && e.message);
    await react(ctx, '❌');
    await ctx.reply(fail(e && e.blocked ? 'That link is not allowed.' : `Could not download that ${name} right now. Try again later.`));
  }
};

const mediaUrl = (u, base) => (u && u.startsWith('/') ? base + u : u);

// ---------- TikTok helpers ----------

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

const UA_BROWSER = { 'User-Agent': 'Mozilla/5.0' };

// Each entry returns { videoUrl, title, stats } or null. Errors are caught by the caller.
const TIKTOK_APIS = [
  {
    name: 'TikWM',
    run: async (link) => {
      const d = await getJsonSafe(`https://www.tikwm.com/api/?url=${encodeURIComponent(link)}&hd=1`);
      const x = d && d.code === 0 && d.data;
      if (!x) return null;
      const videoUrl = mediaUrl(x.hdplay || x.play, 'https://www.tikwm.com');
      if (!videoUrl) return null;
      return {
        videoUrl,
        title: x.title,
        stats: `👁️ ${formatNumber(x.play_count)} | ❤️ ${formatNumber(x.digg_count)}`,
      };
    },
  },
  {
    name: 'SSSTikTok',
    run: async (link) => {
      const r = await fetch('https://ssstik.io/api/action', {
        method: 'POST',
        headers: { ...UA_BROWSER, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: link }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d && d.video ? { videoUrl: d.video, title: d.title } : null;
    },
  },
  {
    name: 'Ddownr',
    run: async (link) => {
      const d = await fetch(`https://api.ddownr.com/api/v1/tiktok?url=${encodeURIComponent(link)}`, {
        headers: UA_BROWSER,
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? r.json() : null));
      return d && d.data && d.data.video ? { videoUrl: d.data.video, title: d.data.title } : null;
    },
  },
  {
    name: 'Tiktokio',
    run: async (link) => {
      const d = await fetch(`https://tiktokio.com/api/v1/tiktok?url=${encodeURIComponent(link)}`, {
        headers: UA_BROWSER,
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? r.json() : null));
      return d && d.data && d.data.video_url ? { videoUrl: d.data.video_url, title: d.data.title } : null;
    },
  },
  {
    name: 'SnapTik',
    run: async (link) => {
      const d = await fetch(`https://snaptik.app/api/action?url=${encodeURIComponent(link)}`, {
        headers: UA_BROWSER,
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? r.json() : null));
      return d && d.video ? { videoUrl: d.video, title: d.title } : null;
    },
  },
  {
    name: 'MusicallyDown',
    run: async (link) => {
      const d = await fetch(`https://musicallydown.com/api/download?url=${encodeURIComponent(link)}`, {
        headers: UA_BROWSER,
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? r.json() : null));
      return d && d.video ? { videoUrl: d.video, title: d.title } : null;
    },
  },
];

// ---------- commands ----------

module.exports = [
  playCommand,
  {
    name: 'video',
    alias: ['ytmp4', 'ytv', 'ytvideo'],
    desc: 'Send a YouTube video (name or link)',
    run: downloader('video', async (ctx) => {
      const query = (ctx.text || '').trim();
      if (!query) { await ctx.reply(fail('Example: .video Faded Alan Walker')); return false; }
      let id = youtubeId(query);
      let title = '';
      if (!id) {
        const res = await yts(query);
        const v = res.videos && res.videos[0];
        if (!v) { await ctx.reply(fail('No video found. Try other words.')); return false; }
        id = v.videoId;
        title = v.title;
      }
      const vid = await getMp4Link(id);
      return sendRemote(ctx, vid.link, 'video', { caption: `Title : ${(title || vid.title).slice(0, 80)}\nQuality : ${vid.quality}p` });
    }),
  },
  {
    name: 'tiktok',
    alias: ['tt', 'ttdl', 'tiktokdl'],
    desc: 'Download a TikTok video (no watermark)',
    run: downloader('TikTok', async (ctx) => {
      const link = (ctx.text || '').trim().split(/\s+/)[0];
      if (!/tiktok\.com\//i.test(link || '')) {
        await ctx.reply(fail('Example: .tiktok https://vm.tiktok.com/xxxx'));
        return false;
      }

      let found = null;
      let usedApi = '';
      for (const api of TIKTOK_APIS) {
        try {
          console.log(`Trying TikTok API: ${api.name}`);
          const r = await api.run(link);
          if (r && r.videoUrl) {
            found = r;
            usedApi = api.name;
            break;
          }
        } catch (e) {
          console.log(`TikTok ${api.name} failed:`, e && e.message);
        }
      }

      if (!found) {
        await ctx.reply(fail('Could not download that TikTok. Make sure it is public, or try again later.'));
        return false;
      }

      await assertPublic(found.videoUrl);
      const f = await fetchFile(found.videoUrl, MAX_VIDEO_MB);
      if (f.tooBig) {
        await ctx.reply(card('', [`Video is bigger than ${MAX_VIDEO_MB} MB`, `Download : ${found.videoUrl}`]));
        return false;
      }

      const size = (f.buf.length / (1024 * 1024)).toFixed(1);
      const caption = card('', [
        `Title : ${String(found.title || 'TikTok').slice(0, 80)}`,
        found.stats ? `Stats : ${found.stats}` : '',
        `Size : ${size} MB`,
        `API : ${usedApi}`,
      ].filter(Boolean));

      await ctx.sock.sendMessage(ctx.jid, { video: f.buf, mimetype: 'video/mp4', caption });
      return true;
    }),
  },
  {
    name: 'ttaudio',
    alias: ['tta', 'tiktokmp3', 'tiktokaudio'],
    desc: 'Get the sound of a TikTok as audio',
    run: downloader('TikTok sound', async (ctx) => {
      const link = (ctx.text || '').trim().split(/\s+/)[0];
      if (!/tiktok\.com\//i.test(link || '')) { await ctx.reply(fail('Example: .ttaudio https://vm.tiktok.com/xxxx')); return false; }
      const d = await getJsonSafe(`https://www.tikwm.com/api/?url=${encodeURIComponent(link)}`);
      const x = d && d.code === 0 && d.data;
      const url = x && mediaUrl(x.music, 'https://www.tikwm.com');
      if (!url) { await ctx.reply(fail('Could not get the sound of that TikTok.')); return false; }
      return sendRemote(ctx, url, 'audio', { fileName: `${String((x.music_info && x.music_info.title) || 'tiktok').replace(/[^\w\s.-]/g, '').slice(0, 50) || 'tiktok'}.mp3`, maxMb: MAX_SONG_MB });
    }),
  },
  {
    name: 'twitter',
    alias: ['x', 'xdl', 'twdl'],
    desc: 'Download a video or photo from a Twitter / X post',
    run: downloader('post', async (ctx) => {
      const [link, pick] = (ctx.text || '').trim().split(/\s+/);
      const m = (link || '').match(/(?:twitter|x)\.com\/([^/?#]+)\/status\/(\d+)/i);
      if (!m) { await ctx.reply(fail('Example: .twitter https://x.com/user/status/123456')); return false; }
      const d = await getJsonSafe(`https://api.vxtwitter.com/${m[1]}/status/${m[2]}`);
      const media = (d && Array.isArray(d.media_extended) ? d.media_extended : []).filter((i) => i && i.url);
      if (!media.length) { await ctx.reply(fail('No media found in that post.')); return false; }
      const n = Math.min(Math.max(parseInt(pick, 10) || 1, 1), media.length);
      const item = media[n - 1];
      const caption = [`Post by : ${d.user_screen_name || m[1]}`, media.length > 1 ? `Item : ${n} of ${media.length} (add a number after the link for others)` : ''].filter(Boolean).join('\n');
      return sendRemote(ctx, item.url, item.type === 'image' ? 'image' : 'video', { caption });
    }),
  },
  {
    name: 'mediafire',
    alias: ['mf', 'mfdl'],
    desc: 'Download a file from a MediaFire link',
    run: downloader('file', async (ctx) => {
      const link = (ctx.text || '').trim().split(/\s+/)[0];
      if (!/^https?:\/\/(www\.)?mediafire\.com\//i.test(link || '')) { await ctx.reply(fail('Example: .mediafire https://www.mediafire.com/file/xxxx/name.zip')); return false; }
      const page = await fetch(link, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
      if (!page.ok) throw new Error('HTTP ' + page.status);
      const html = await page.text();
      let url = null;
      const scrambled = html.match(/data-scrambled-url="([^"]+)"/i);
      if (scrambled) {
        try { url = Buffer.from(scrambled[1], 'base64').toString('utf8'); } catch (e) { /* try the next pattern */ }
      }
      if (!url) {
        const direct = html.match(/href="(https?:\/\/download[^"]*mediafire\.com[^"]+)"/i);
        url = direct && direct[1];
      }
      if (!url || !/^https?:\/\//i.test(url)) { await ctx.reply(fail('Could not find the download link. The file may be private or removed.')); return false; }
      let fileName = 'file';
      try { fileName = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'file'; } catch (e) { /* keep default */ }
      return sendRemote(ctx, url, 'document', { fileName, caption: `Name : ${fileName}`, maxMb: MAX_APK_MB });
    }),
  },
  {
    name: 'dl',
    desc: 'Download a file from a direct link',
    run: safe(async (ctx) => {
      const url = await parseLink(ctx.text);
      if (!url) return ctx.reply(fail('Example: .dl https://example.com/file.pdf'));
      const f = await fetchFile(url.href);
      if (f.tooBig) return ctx.reply(fail(`That file is bigger than ${MAX_MB} MB.`));
      let fileName = 'file';
      try {
        fileName = decodeURIComponent(url.pathname.split('/').pop() || '') || 'file';
      } catch (e) {}
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
            card('', [`${app.appname} is bigger than ${MAX_APK_MB} MB`, `Download : ${app.download_url}`])
          );
        }
        const size = (f.buf.length / (1024 * 1024)).toFixed(1);
        await ctx.sock.sendMessage(ctx.jid, {
          document: f.buf,
          fileName: `${String(app.appname).replace(/[^a-zA-Z0-9]/g, '_')}.apk`,
          mimetype: app.mimetype || 'application/vnd.android.package-archive',
          caption: card('', [
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
          } catch (e) {
            console.error('facebook candidate failed:', e && e.message);
          }
        }
        if (!file) {
          await react(ctx, '❌');
          return ctx.reply(
            bigLink
              ? card('', [`Video is bigger than ${MAX_VIDEO_MB} MB`, `Download : ${bigLink}`])
              : fail('Download failed. Try again later.')
          );
        }
        const size = (file.buf.length / (1024 * 1024)).toFixed(1);
        await ctx.sock.sendMessage(ctx.jid, {
          video: file.buf,
          mimetype: 'video/mp4',
          caption: card('', [`Title : ${String(info.title).slice(0, 80)}`, `Size : ${size} MB`]),
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
          return ctx.reply(card('', [`Bigger than ${MAX_VIDEO_MB} MB`, `Download : ${item.url}`]));
        }
        const size = (f.buf.length / (1024 * 1024)).toFixed(1);
        const lines = [`Type : ${isVideo ? 'Video' : 'Photo'}`, `Size : ${size} MB`];
        if (items.length > 1) lines.push(`Item : ${n} of ${items.length} (add a number after the link for others)`);
        const caption = card('', lines);
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
        const res = await yts(query);
        const items = (res.videos || []).slice(0, 8);
        if (!items.length) {
          await react(ctx, '❌');
          return ctx.reply(fail('No results. Try other words.'));
        }
        const body = items
          .map(
            (v, i) =>
              `${i + 1}. ${v.title}\n⏱ ${v.timestamp || 'n/a'} • ${(v.author && v.author.name) || 'Unknown'}\n🔗 ${v.url}`
          )
          .join('\n\n');
        await ctx.reply(`YouTube results for "${query}"\n\n${body}\n\nSend .play <link> to get the song`);
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
      if (f.tooBig) return ctx.reply(card('', [...lines, `File : bigger than ${MAX_MB} MB, not sent`]));
      await ctx.sock.sendMessage(ctx.jid, {
        document: f.buf,
        mimetype: 'application/gzip',
        fileName: `${p.name.replace('/', '-').replace('@', '')}-${p.version}.tgz`,
        caption: card('', lines),
      });
    }),
  },
];
