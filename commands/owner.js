// Auto-service toggles are owner-only. Persist values so they survive restarts.
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settingFlags = {
  autoreact: ['autoReact', 'enabled'], statusview: ['autoStatusView'], statusreact: ['autoStatusReact', 'enabled'],
  typing: ['autoTyping'], autoread: ['autoRead'], autorecording: ['autoRecording'], chatbot: ['chatbot', 'enabled'],
  anticall: ['antiCall'], antidelete: ['antiDelete'], antiedit: ['antiEdit'], antilink: ['antiLink', 'enabled'],
  welcome: ['welcome'], groupevents: ['groupEvents', 'enabled'],
};
function setPath(object, path, value) { let target = object; for (const key of path.slice(0, -1)) target = target[key]; target[path[path.length - 1]] = value; }
module.exports = [
  { name: 'mode', desc: 'Set public/private mode', ownerOnly: true, run: async ({ config, args, reply, db }) => {
    const mode = (args[0] || '').toLowerCase(); if (!['public', 'private'].includes(mode)) return reply('Usage: .mode public|private');
    config.publicMode = mode === 'public'; await db.set('runtime:mode', mode); await reply(`Mode set to ${mode}.`);
  } },
  { name: 'toggle', desc: 'Turn automatic services on/off', ownerOnly: true, run: async ({ config, args, reply, db }) => {
    const feature = (args[0] || '').toLowerCase(); const path = settingFlags[feature];
    if (!path) return reply(`Features: ${Object.keys(settingFlags).join(', ')}\nUsage: .toggle <feature> on|off`);
    const value = (args[1] || '').toLowerCase(); if (!['on', 'off'].includes(value)) return reply(`Usage: .toggle ${feature} on|off`);
    const enabled = value === 'on'; setPath(config, path, enabled);
    const saved = (await db.get('runtime:settings')) || {}; saved[feature] = enabled; await db.set('runtime:settings', saved);
    await reply(`${feature} turned ${value}.`);
  } },
  { name: 'setprefix', desc: 'Change command prefix', ownerOnly: true, run: async ({ config, text, reply, db }) => {
    const prefix = (text || '').trim(); if (!prefix || prefix.toLowerCase() === 'none' || /\s/.test(prefix) || prefix.length > 3) return reply('Choose a prefix of 1–3 characters; it cannot be none. Usage: .setprefix !');
    config.prefix = [prefix]; await db.set('runtime:prefix', prefix); await reply(`Prefix changed to ${prefix}.`);
  } },
  { name: 'setbotname', desc: 'Change bot profile name', ownerOnly: true, run: async ({ config, text, reply, sock, db }) => {
    const name = (text || '').trim(); if (!name || name.length > 25) return reply('Provide a name of 1–25 characters.');
    config.botName = name; await db.set('runtime:botName', name);
    try { if (typeof sock.updateProfileName === 'function') await sock.updateProfileName(name); } catch (error) { console.error('Profile name update failed:', error.message); return reply(`Menu name changed; WhatsApp profile update failed: ${error.message}`); }
    await reply(`Bot name changed to ${name}.`);
  } },
  { name: 'setpic', desc: 'Set profile picture by replying to an image', ownerOnly: true, run: async ({ sock, quotedMsg, reply }) => {
    const message = unwrapQuoted(quotedMsg); const image = message?.imageMessage;
    if (!image) return reply('Reply to an image with .setpic.');
    const stream = await downloadContentFromMessage(image, 'image'); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks); if (!buffer.length || buffer.length > 5 * 1024 * 1024) return reply('Image is empty or over 5 MB.');
    await sock.updateProfilePicture(sock.user.id, buffer); await reply('Profile picture updated.');
  } },
  { name: 'vv', desc: 'Forward quoted view-once image/video', ownerOnly: true, run: async ({ sock, jid, m, quotedMsg, reply }) => {
    const message = unwrapQuoted(quotedMsg); const kind = message?.imageMessage ? 'image' : message?.videoMessage ? 'video' : null;
    if (!kind) return reply('Reply directly to a view-once image/video with .vv.');
    const media = message[`${kind}Message`]; const stream = await downloadContentFromMessage(media, kind); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks); if (!buffer.length) return reply('Could not download the quoted media.');
    await sock.sendMessage(jid, { [kind]: buffer, caption: media.caption || '' }, { quoted: m });
  } },
];
function unwrapQuoted(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    const next = current.ephemeralMessage?.message || current.viewOnceMessageV2?.message || current.viewOnceMessage?.message || current.viewOnceMessageV2Extension?.message || current.documentWithCaptionMessage?.message;
    if (!next) break; current = next;
  }
  return current;
}
