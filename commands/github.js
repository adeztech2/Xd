const card = (title, lines) =>
  `╔═══ ${title} ═══\n${[].concat(lines).map((l) => `║ ◆ ${l}`).join('\n')}\n╚══════════════`;
const fail = (msg) => card('⚠️ ERROR', msg);
const MAX_MB = 40;

const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error('github command error:', e && e.message);
    await ctx.reply(fail(e && e.notFound ? 'Not found. Check the spelling.' : 'Something went wrong. Try again later.'));
  }
};

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot', Accept: 'application/vnd.github+json' } });
  if (r.status === 404) {
    const e = new Error('not found');
    e.notFound = true;
    throw e;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function fetchFile(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const size = Number(r.headers.get('content-length') || 0);
  if (size > MAX_MB * 1024 * 1024) return { tooBig: true };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_MB * 1024 * 1024) return { tooBig: true };
  return { buf, type: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0] };
}

const isPrivateHost = (h) =>
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(h);

const validRepo = (s) => /^[\w.-]+\/[\w.-]+$/.test(s || '');

module.exports = [
  {
    name: 'github',
    desc: 'GitHub profile info',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim().replace(/^@/, '');
      if (!/^[\w-]+$/.test(name)) return ctx.reply(fail('Example: .github torvalds'));
      const u = await getJson(`https://api.github.com/users/${name}`);
      const lines = [
        `Name : ${u.name || u.login}`,
        `Username : ${u.login}`,
        `Repos : ${u.public_repos}`,
        `Followers : ${u.followers}`,
        `Following : ${u.following}`,
      ];
      if (u.bio) lines.push(`Bio : ${u.bio}`);
      lines.push(`Link : ${u.html_url}`);
      await ctx.reply(card('🐙 GITHUB', lines));
    }),
  },
  {
    name: 'repo',
    desc: 'GitHub repo info, e.g. .repo owner/name',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim();
      if (!validRepo(name)) return ctx.reply(fail('Example: .repo adeztech2/adez-md'));
      const r = await getJson(`https://api.github.com/repos/${name}`);
      const lines = [
        `Name : ${r.full_name}`,
        `Stars : ${r.stargazers_count}`,
        `Forks : ${r.forks_count}`,
        `Language : ${r.language || 'n/a'}`,
        `Updated : ${new Date(r.pushed_at).toDateString()}`,
      ];
      if (r.description) lines.push(`About : ${r.description}`);
      lines.push(`Link : ${r.html_url}`);
      await ctx.reply(card('📦 REPO', lines));
    }),
  },
  {
    name: 'repos',
    desc: 'Latest repos of a GitHub user',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim().replace(/^@/, '');
      if (!/^[\w-]+$/.test(name)) return ctx.reply(fail('Example: .repos torvalds'));
      const list = await getJson(`https://api.github.com/users/${name}/repos?sort=updated&per_page=5`);
      if (!list.length) return ctx.reply(card('📚 REPOS', ['No public repos.']));
      await ctx.reply(card(`📚 REPOS OF ${name.toUpperCase()}`, list.map((r) => `${r.name} ⭐${r.stargazers_count}`)));
    }),
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
    name: 'dl',
    desc: 'Download a file from a direct link',
    run: safe(async (ctx) => {
      const link = (ctx.text || '').trim();
      let url;
      try {
        url = new URL(link);
      } catch (e) {
        return ctx.reply(fail('Example: .dl https://example.com/file.pdf'));
      }
      if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) {
        return ctx.reply(fail('That link is not allowed.'));
      }
      const f = await fetchFile(url.href);
      if (f.tooBig) return ctx.reply(fail(`That file is bigger than ${MAX_MB} MB.`));
      const fileName = decodeURIComponent(url.pathname.split('/').pop() || '') || 'file';
      await ctx.sock.sendMessage(ctx.jid, { document: f.buf, mimetype: f.type, fileName });
    }),
  },
];
