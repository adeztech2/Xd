const fail = (msg) => msg;
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
  const r = await fetch(url, {
    headers: { 'User-Agent': 'adez-xmd-bot', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) {
    const e = new Error('not found');
    e.notFound = true;
    throw e;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function fetchFile(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adez-xmd-bot' }, signal: AbortSignal.timeout(30000) });
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
const repoHelp = 'Example: .repo owner/name';
const safeText = (value, max = 140) => String(value || '').replace(/[\r\n]+/g, ' ').slice(0, max);

module.exports = [
  {
    name: 'github',
    desc: 'GitHub profile info',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim().replace(/^@/, '');
      if (!/^[\w-]+$/.test(name)) return ctx.reply('Example: .github torvalds');
      const u = await getJson(`https://api.github.com/users/${encodeURIComponent(name)}`);
      const lines = [
        `Name: ${u.name || u.login}`,
        `Username: ${u.login}`,
        `Repos: ${u.public_repos}`,
        `Followers: ${u.followers}`,
        `Following: ${u.following}`,
      ];
      if (u.bio) lines.push(`Bio: ${safeText(u.bio, 250)}`);
      lines.push(`Link: ${u.html_url}`);
      await ctx.reply(lines.join('\n'));
    }),
  },
  {
    name: 'repo',
    desc: 'GitHub repo info, e.g. .repo owner/name',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim();
      if (!name) {
        // Keith-style card for the bot's own repo
        const repo = ctx.config.botRepo;
        const r = await getJson(`https://api.github.com/repos/${repo}`);
        const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const text = [
          `Hello @${ctx.m.pushName || 'Anonymous'}, 👋 This is *${ctx.config.botName}*`,
          `${ctx.config.botTagline} developed by Arnold Adez. Fork and give a star 🌟 to my repo`,
          '',
          '┌──────────────',
          `│✞ Stars: ${r.stargazers_count}`,
          `│✞ Forks: ${r.forks_count}`,
          `│✞ Release Date: ${fmt(r.created_at)}`,
          `│✞ Last Update: ${fmt(r.pushed_at)}`,
          '│✞ Owner: Arnold Adez',
          '└──────────────',
        ].join('\n');
        return ctx.sock.sendMessage(ctx.jid, {
          text,
          contextInfo: { externalAdReply: {
            title: ctx.config.botName, body: 'Click to visit repository', thumbnailUrl: ctx.config.botPic,
            sourceUrl: r.html_url, mediaType: 1, renderLargerThumbnail: true,
          } },
        }, { quoted: ctx.m });
      }
      if (!validRepo(name)) return ctx.reply(repoHelp);
      const r = await getJson(`https://api.github.com/repos/${name}`);
      const lines = [
        `Name: ${r.full_name}`,
        `Stars: ${r.stargazers_count}`,
        `Forks: ${r.forks_count}`,
        `Language: ${r.language || 'n/a'}`,
        `Updated: ${new Date(r.pushed_at).toDateString()}`,
      ];
      if (r.description) lines.push(`About: ${safeText(r.description, 250)}`);
      lines.push(`Link: ${r.html_url}`);
      await ctx.reply(lines.join('\n'));
    }),
  },
  {
    name: 'repos',
    desc: 'Latest repos of a GitHub user',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim().replace(/^@/, '');
      if (!/^[\w-]+$/.test(name)) return ctx.reply('Example: .repos torvalds');
      const list = await getJson(`https://api.github.com/users/${encodeURIComponent(name)}/repos?sort=updated&per_page=5`);
      if (!list.length) return ctx.reply('No public repos.');
      await ctx.reply(list.map((r) => `${r.name} ⭐${r.stargazers_count}\n${r.html_url}`).join('\n\n'));
    }),
  },
  {
    name: 'ghsearch',
    desc: 'Search GitHub repositories',
    run: safe(async (ctx) => {
      const query = (ctx.text || '').trim();
      if (!query) return ctx.reply('Example: .ghsearch node whatsapp bot');
      const data = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`);
      if (!data.items?.length) return ctx.reply('No repositories found.');
      await ctx.reply(data.items.map((r) => `${r.full_name} ⭐${r.stargazers_count}\n${safeText(r.description || 'No description', 160)}\n${r.html_url}`).join('\n\n'));
    }),
  },
  {
    name: 'ghissues',
    desc: 'Show open issues and pull requests in a repo',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim();
      if (!validRepo(name)) return ctx.reply(repoHelp);
      const items = await getJson(`https://api.github.com/repos/${name}/issues?state=open&per_page=5`);
      if (!items.length) return ctx.reply(`No open issues or pull requests in ${name}.`);
      await ctx.reply(items.map((issue) => {
        const kind = issue.pull_request ? 'PR' : 'Issue';
        return `${kind} #${issue.number}: ${safeText(issue.title, 160)}\n${issue.html_url}`;
      }).join('\n\n'));
    }),
  },
  {
    name: 'ghcommits',
    desc: 'Show recent commits in a repo',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim();
      if (!validRepo(name)) return ctx.reply(repoHelp);
      const commits = await getJson(`https://api.github.com/repos/${name}/commits?per_page=5`);
      if (!commits.length) return ctx.reply(`No commits found in ${name}.`);
      await ctx.reply(commits.map((c) => {
        const sha = c.sha.slice(0, 7);
        const message = safeText(c.commit?.message, 140);
        const author = safeText(c.commit?.author?.name || c.author?.login || 'Unknown', 60);
        return `${sha} ${message}\nBy: ${author}\n${c.html_url}`;
      }).join('\n\n'));
    }),
  },
  {
    name: 'ghrelease',
    desc: 'Show the latest release of a repo',
    run: safe(async (ctx) => {
      const name = (ctx.text || '').trim();
      if (!validRepo(name)) return ctx.reply(repoHelp);
      const release = await getJson(`https://api.github.com/repos/${name}/releases/latest`);
      await ctx.reply(`Latest release: ${release.name || release.tag_name}\nTag: ${release.tag_name}\nPublished: ${release.published_at ? new Date(release.published_at).toDateString() : 'unknown'}\n${release.html_url}`);
    }),
  },
];
