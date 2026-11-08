const card = (title, lines) =>
  `╔═══ ${title} ═══\n${[].concat(lines).map((l) => `║ ◆ ${l}`).join('\n')}\n╚══════════════`;
const fail = (msg) => card('⚠️ ERROR', msg);
const MAX_MB = 40;

const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error('download command error:', e && e.message);
    await ctx.reply(fail(e && e.notFound ? 'Not found. Check the spelling.' : 'Something went wrong. Try again later.'));
  }
};

async function fetchFile(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot' } });
  if (r.status === 404) {
    const e = new Error('not found');
    e.notFound = true;
    throw e;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const size = Number(r.headers.get('content-length') || 0);
  if (size > MAX_MB * 1024 * 1024) return { tooBig: true };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_MB * 1024 * 1024) return { tooBig: true };
  return { buf, type: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0] };
}

const isPrivateHost = (h) =>
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(h);

function parseLink(text) {
  try {
    const url = new URL((text || '').trim());
    if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return null;
    return url;
  } catch (e) {
    return null;
  }
}

// Builds a "download a direct link as <kind>" command
function mediaCommand(name, kind, example) {
  return {
    name,
    desc: `Send a direct link as ${kind}`,
    run: safe(async (ctx) => {
      const url = parseLink(ctx.text);
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

module.exports = [
  mediaCommand('dlimage', 'image', 'https://example.com/photo.jpg'),
  mediaCommand('dlvideo', 'video', 'https://example.com/clip.mp4'),
  mediaCommand('dlaudio', 'audio', 'https://example.com/song.mp3'),
  {
    name: 'gitfile',
    desc: 'Download one file from a GitHub repo',
    run: safe(async (ctx) => {
      const [repo, path, branchArg] = (ctx.text || '').trim().split(/\s+/);
      const example = 'Example: .gitfile adeztech2/adez-md package.json';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !path || path.includes('..')) {
        return ctx.reply(fail(example));
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
