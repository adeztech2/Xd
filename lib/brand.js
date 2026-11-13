// Keith-style look: every reply is quoted from a "verified business" contact card
// that carries the bot's name, picture and a "View details" link.
const config = require('../config');

function brandQuote(sock, m) {
  if (!config.replyStyle?.enabled) return m;
  const name = config.botName;
  const number = String(sock.user?.id || '').split(':')[0].split('@')[0];
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:;${name};;;`,
    `FN:${name}`,
    `ORG:${name};`,
    `item1.TEL;waid=${number}:+${number}`,
    'item1.X-ABLabel:Bot',
    `X-WA-BIZ-NAME:${name}`,
    `X-WA-BIZ-DESCRIPTION:${config.botTagline}`,
    'END:VCARD',
  ].join('\n');
  return {
    key: { fromMe: false, participant: '0@s.whatsapp.net', remoteJid: 'status@broadcast', id: m?.key?.id },
    message: { contactMessage: { displayName: name, vcard } },
  };
}

// Verified-looking quote with a location line, e.g. "WhatsApp ✓ / Hi adek" (used by the menu)
function locationQuote(sock, m, text) {
  if (!config.replyStyle?.enabled) return m;
  return {
    key: { fromMe: false, participant: '0@s.whatsapp.net', remoteJid: 'status@broadcast', id: m?.key?.id },
    message: { locationMessage: { degreesLatitude: 0, degreesLongitude: 0, name: text } },
  };
}

module.exports = { brandQuote, locationQuote };
