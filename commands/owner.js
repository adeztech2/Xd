const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const settingFlags = {
  autoreact: ['autoReact', 'enabled'],
  statusview: ['autoStatusView'],
  statusreact: ['autoStatusReact', 'enabled'],
  typing: ['autoTyping'],
  autoread: ['autoRead'],
  anticall: ['antiCall'],
  antidelete: ['antiDelete'],
  antilink: ['antiLink', 'enabled'],
  welcome: ['welcome'],
};

function readSetting(config, path) {
  return path.reduce((value, key) => value && value[key], config);
}
function writeSetting(config, path, value) {
  let target = config;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path[path.length - 1]] = value;
}

module.exports = [
  {
    name: 'mode',
    desc: 'mode public | private',
    ownerOnly: true,
    run: async ({ config, args, reply }) => {
      const value = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(value)) return reply('Use: .mode public | .mode private');
      config.publicMode = value === 'public';
      await reply(`Mode set to ${value}.`);
    },
  },
  {
    name: 'toggle',
    desc: 'Turn bot features on/off, e.g. .toggle autoreact off',
    ownerOnly: true,
    run: async ({ config, args, reply }) => {
      const feature = (args[0] || '').toLowerCase();
      const path = settingFlags[feature];
      if (!path) return reply(`Features: ${Object.keys(settingFlags).join(', ')}\nUsage: .toggle <feature> on|off`);
      const value = (args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return reply(`Usage: .toggle ${feature} on|off`);
      writeSetting(config, path, value === 'on');
      await reply(`${feature} turned ${value}.`);
    },
  },
  {
    name: 'setprefix',
    desc: 'Change command prefix',
    ownerOnly: true,
    run: async ({ config, text, reply }) => {
      const prefix = (text || '').trim();
      if (!prefix || prefix.toLowerCase() === 'none' || /\s/.test(prefix) || prefix.length > 3) {
        return reply('Choose a non-empty prefix of 1–3 characters; prefix cannot be none. Example: .setprefix !');
      }
      config.prefix = [prefix];
      await reply(`Prefix changed to ${prefix}`);
    },
  },
  {
    name: 'setbotname',
    desc: 'Change the bot profile name',
    ownerOnly: true,
    run: async ({ config, text, reply, sock }) => {
      const name = (text || '').trim();
      if (!name || name.length > 25) return reply('Provide a bot name of 1–25 characters. Example: .setbotname ADEZ XMD');
      config.botName = name;
      try {
        if (typeof sock.updateProfileName === 'function') await sock.updateProfileName(name);
      } catch (error) {
        console.error('WhatsApp profile name update failed:', error.message);
        return reply(`Bot name changed to ${name} for menus. WhatsApp profile update failed; check the connection and try again.`);
      }
      await reply(`Bot name changed to ${name}.`);
    },
  },
  {
    name: 'setpic',
    desc: 'Set bot profile picture by replying to an image',
    ownerOnly: true,
    run: async ({ sock, quotedMsg, reply }) => {
      const quoted = quotedMsg?.imageMessage || quotedMsg?.viewOnceMessage?.message?.imageMessage || quotedMsg?.viewOnceMessageV2?.message?.imageMessage;
      if (!quoted) return reply('Reply to an image with .setpic to update the bot profile picture.');
      if (typeof sock.updateProfilePicture !== 'function') return reply('This WhatsApp connection does not support profile picture updates.');
      const stream = await downloadContentFromMessage(quoted, 'image');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const image = Buffer.concat(chunks);
      if (!image.length || image.length > 5 * 1024 * 1024) return reply('Image is empty or over the 5 MB limit.');
      await sock.updateProfilePicture(sock.user.id, image);
      await reply('Bot profile picture updated.');
    },
  },
  {
    name: 'vv',
    desc: 'Reveal a quoted view-once media',
    ownerOnly: true,
    run: async ({ sock, jid, m, quotedMsg, reply }) => {
      if (!quotedMsg) return reply('Reply to a view-once message.');
      const q = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg.viewOnceMessageV2Extension?.message || quotedMsg;
      const kind = q.imageMessage ? 'image' : q.videoMessage ? 'video' : null;
      if (!kind) return reply('No image/video found.');
      const stream = await downloadContentFromMessage(q[`${kind}Message`], kind);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      await sock.sendMessage(jid, { [kind]: Buffer.concat(chunks), caption: q[`${kind}Message`].caption || '' }, { quoted: m });
    },
  },
];
