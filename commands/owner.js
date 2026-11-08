const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const settingFlags = {
  autoreact: ['autoReact', 'enabled'],
  statusview: ['autoStatusView'],
  statusreact: ['autoStatusReact', 'enabled'],
  typing: ['autoTyping'],
  autoread: ['autoRead'],
  autorecording: ['autoRecording'],
  chatbot: ['chatbot', 'enabled'],
  anticall: ['antiCall'],
  antidelete: ['antiDelete'],
  antiedit: ['antiEdit'],
  antilink: ['antiLink', 'enabled'],
  welcome: ['welcome'],
  groupevents: ['groupEvents', 'enabled'],
};

function setPath(object, path, value) {
  let target = object;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path[path.length - 1]] = value;
}

module.exports = [
  {
    name: 'mode', desc: 'mode public | private', ownerOnly: true,
    run: async ({ config, args, reply }) => {
      const value = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(value)) return reply('Use: .mode public | .mode private');
      config.publicMode = value === 'public';
      await reply(`Mode set to ${value}.`);
    },
  },
  {
    name: 'toggle', desc: 'Turn bot features on/off', ownerOnly: true,
    run: async ({ config, args, reply, db }) => {
      const feature = (args[0] || '').toLowerCase();
      const path = settingFlags[feature];
      if (!path) return reply(`Features: ${Object.keys(settingFlags).join(', ')}\nUsage: .toggle <feature> on|off`);
      const value = (args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return reply(`Usage: .toggle ${feature} on|off`);
      const enabled = value === 'on';
      setPath(config, path, enabled);
      const saved = (await db.get('runtime:settings')) || {};
      saved[feature] = enabled;
      await db.set('runtime:settings', saved);
      await reply(`${feature} turned ${value}.`);
    },
  },
  {
    name: 'setprefix', desc: 'Change command prefix', ownerOnly: true,
    run: async ({ config, text, reply, db }) => {
      const prefix = (text || '').trim();
      if (!prefix || prefix.toLowerCase() === 'none' || /\s/.test(prefix) || prefix.length > 3) return reply('Choose a non-empty prefix of 1–3 characters; prefix cannot be none. Example: .setprefix !');
      config.prefix = [prefix];
      await db.set('runtime:prefix', prefix);
      await reply(`Prefix changed to ${prefix}`);
    },
  },
  {
    name: 'setbotname', desc: 'Change bot profile name', ownerOnly: true,
    run: async ({ config, text, reply, sock, db }) => {
      const name = (text || '').trim();
      if (!name || name.length > 25) return reply('Provide a bot name of 1–25 characters.');
      config.botName = name;
      await db.set('runtime:botName', name);
      try {
        if (typeof sock.updateProfileName === 'function') await sock.updateProfileName(name);
      } catch (error) {
        console.error('WhatsApp profile name update failed:', error.message);
        return reply(`Bot name changed for menus, but WhatsApp profile update failed: ${error.message}`);
      }
      await reply(`Bot name changed to ${name}.`);
    },
  },
  {
    name: 'setpic', desc: 'Set profile picture by replying to an image', ownerOnly: true,
    run: async ({ sock, quotedMsg, reply }) => {
      const message = unwrapQuoted(quotedMsg);
      const image = message?.imageMessage;
      if (!image) return reply('Reply to an image with .setpic.');
      if (typeof sock.updateProfilePicture !== 'function') return reply('This connection does not support profile picture updates.');
      const stream = await downloadContentFromMessage(image, 'image');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (!buffer.length || buffer.length > 5 * 1024 * 1024) return reply('Image is empty or over the 5 MB limit.');
      await sock.updateProfilePicture(sock.user.id, buffer);
      await reply('Bot profile picture updated.');
    },
  },
  {
    name: 'vv', desc: 'Forward quoted view-once image/video to the chat', ownerOnly: true,
    run: async ({ sock, jid, m, quotedMsg, reply }) => {
      const message = unwrapQuoted(quotedMsg);
      const kind = message?.imageMessage ? 'image' : message?.videoMessage ? 'video' : null;
      if (!kind) return reply('Reply directly to a view-once image or video with .vv.');
      const media = message[`${kind}Message`];
      const stream = await downloadContentFromMessage(media, kind);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) return reply('Could not download the quoted media.');
      await sock.sendMessage(jid, { [kind]: buffer, caption: media.caption || '' }, { quoted: m });
    },
  },
];

function unwrapQuoted(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    const next = current.ephemeralMessage?.message || current.viewOnceMessageV2?.message || current.viewOnceMessage?.message || current.viewOnceMessageV2Extension?.message || current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current;
}
