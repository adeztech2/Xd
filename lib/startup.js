// Helpers for the startup alert (sent to the bot's own chat when it connects).
const config = require('../config');

const num = (jid = '') => jid.split('@')[0].split(':')[0];
// Masked version for logs, so phone numbers don't sit in log history
const mask = (jid = '') => {
  const n = num(jid);
  return n.length > 4 ? `${n.slice(0, 4)}****` : '****';
};

function detectHost() {
  const e = process.env;
  if (e.RENDER) return 'Render';
  if (e.DYNO) return 'Heroku';
  if (e.RAILWAY_ENVIRONMENT || e.RAILWAY_PROJECT_ID) return 'Railway';
  if (e.KOYEB_APP_NAME) return 'Koyeb';
  if (e.FLY_APP_NAME) return 'Fly.io';
  if (e.REPL_ID || e.REPL_SLUG) return 'Replit';
  if (e.VERCEL) return 'Vercel';
  if (e.CODESPACES) return 'GitHub Codespaces';
  if (e.PROJECT_DOMAIN) return 'Glitch';
  if (e.P_SERVER_UUID) return 'Pterodactyl panel';
  if (process.platform === 'win32') return 'Windows PC';
  return process.platform === 'linux' ? 'VPS / Linux' : 'Local';
}

// Startup message text sent to the bot's own chat when it connects
function buildStartupAlert(s) {
  const tz = config.startupAlert?.timezone || 'UTC';
  const time = new Date().toLocaleString('en-GB', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const { version } = require('../package.json');
  const prefix = (config.prefix || ['.'])[0] || '';
  const mode = config.publicMode ? 'Public' : 'Private';

  const name = config.botName;
  return [
    `╭───〔 ${name} 〕──────────···`,
    `│ ✻ │▸ *Connected Successfully* ✅`,
    `╰──────────────────⊷`,
    '',
    `┌───「 BOT INFO 」──────────•••`,
    `│ ◦➛ Status: Online 🟢`,
    `│ ◦➛ Number: ${num(s.user.id)}`,
    `│ ◦➛ Time: ${time}`,
    `│ ◦➛ Host: ${detectHost()}`,
    `│ ◦➛ Mode: ${mode}`,
    `│ ◦➛ Prefix: ${prefix || 'none'}`,
    `│ ◦➛ Version: v${version}`,
    `└────────────────────•••`,
    '',
    `Type *${prefix}menu* to see all commands.`,
    '',
    `│ WHATSAPP BOT BY ${name.toUpperCase()}`,
  ].join('\n');
}

module.exports = { num, mask, detectHost, buildStartupAlert };
