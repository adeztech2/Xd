const { randomUUID } = require('crypto');

const asList = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => asList(item));
  return [String(value)];
};

function card(title, lines) {
  const items = asList(lines).filter((item) => item !== '');
  return items.length ? `${title}\n${items.join('\n')}` : title;
}

function fail(msg) {
  return msg || 'Something went wrong. Try again later.';
}

function pick(items) {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function userError(message, extra) {
  const error = new Error(message);
  error.userMessage = message;
  if (extra !== undefined) error.extra = extra;
  return error;
}

function safe(nameOrFn, maybeFn) {
  const fn = typeof nameOrFn === 'function' ? nameOrFn : maybeFn;
  const label = typeof nameOrFn === 'string' ? nameOrFn : 'command';

  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (error) {
      const message = error?.userMessage || error?.message || 'Something went wrong. Try again later.';
      console.error(`[${label}]`, error?.stack || error);
      if (ctx?.reply) {
        await ctx.reply(card('⚠️ ERROR', message)).catch(() => {});
      }
    }
  };
}

async function getJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  card,
  fail,
  pick,
  safe,
  userError,
  getJson,
  randomUUID,
};
