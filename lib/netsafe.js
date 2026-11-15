const dns = require('dns/promises');
const net = require('net');

function blockedError() { const e = new Error('blocked'); e.blocked = true; return e; }
function tooBigError() { const e = new Error('too big'); e.tooBig = true; return e; }

function isPrivateV4(a, b, c) {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function parseV6(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number);
    s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : new Array(8 - h.length - t.length).fill('0');
  const groups = [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n)) ? groups : null;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return isPrivateV4(a, b, c);
  }
  if (net.isIPv6(ip)) {
    const g = parseV6(ip);
    if (!g) return true;
    const embeddedV4 = () => isPrivateV4(g[6] >> 8, g[6] & 255, g[7] >> 8);
    if (g.slice(0, 7).every((n) => n === 0) && (g[7] === 0 || g[7] === 1)) return true;
    if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return embeddedV4();
    if (g[0] === 0x64 && g[1] === 0xff9b) return embeddedV4();
    if (g[0] === 0x2002) return isPrivateV4(g[1] >> 8, g[1] & 255, g[2] >> 8);
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    return false;
  }
  return true;
}

async function assertPublic(rawUrl) {
  const u = new URL(rawUrl);
  if (!/^https?:$/.test(u.protocol)) throw blockedError();
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) throw blockedError();
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw blockedError();
    return u;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw blockedError();
  return u;
}

// fetch() that checks every redirect hop before following it
async function safeFetch(url, opts = {}, assertFn = assertPublic, maxRedirects = 5) {
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertFn(current);
    const res = await fetch(current, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      try { await res.body?.cancel(); } catch {}
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

// Reads a body but never holds more than `limit` bytes in memory
async function readLimited(res, limit) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > limit) { try { await res.body?.cancel(); } catch {} throw tooBigError(); }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { try { await reader.cancel(); } catch {} throw tooBigError(); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

module.exports = { isPrivateIp, assertPublic, safeFetch, readLimited, blockedError };
