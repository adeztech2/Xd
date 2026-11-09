// Owner-only controls. Every change is saved, so it survives restarts (see lib/runtime.js).
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const db = require('../db');
const { FLAG_PATHS, setPath, saveFlag } = require('../lib/runtime');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Runs a command. Any failure is reported to the owner instead of being dropped silently.
const safe = (name, fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error(`[owner ${name}]`, e.message);
    await ctx.reply(`❌ ${name} failed: ${e.message}`).catch(() => {});
  }
};

async function downloadBuffer(media, type) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Looks through wrappers (ephemeral, view-once, captions) to find the real message.
function unwrapQuoted(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

module.exports = [
  {
    name: 'mode',
    desc: 'Set public or private mode',
    ownerOnly: true,
    run: safe('mode', async ({ config, args, reply }) => {
      const mode = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(mode)) return reply('Usage: .mode public|private');
      config.publicMode = mode === 'public';
      await db.set('runtime:mode', mode);
      await reply(`Mode set to ${mode}.`);
    }),
  },
  {
    name: 'toggle',
    desc: 'Turn automatic services on or off',
    ownerOnly: true,
    run: safe('toggle', async ({ config, args, reply }) => {
      const feature = (args[0] || '').toLowerCase();
      if (!FLAG_PATHS[feature]) {
        return reply(`Features: ${Object.keys(FLAG_PATHS).join(', ')}\nUsage: .toggle <feature> on|off`);
      }
      const value = (args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return reply(`Usage: .toggle ${feature} on|off`);

      const enabled = value === 'on';
      setPath(config, FLAG_PATHS[feature], enabled);
      await saveFlag(feature, enabled);
      await reply(`${feature} turned ${value}.`);
    }),
  },
  {
    name: 'setprefix',
    desc: 'Change the command prefix (1 to 3 characters)',
    ownerOnly: true,
    run: safe('setprefix', async ({ config, text, reply }) => {
      const prefix = (text || '').trim();
      if (!prefix || prefix.toLowerCase() === 'none' || /\s/.test(prefix) || prefix.length > 3) {
        return reply('Choose a prefix of 1 to 3 characters with no spaces. Usage: .setprefix !');
      }
      config.prefix = [prefix];
      await db.set('runtime:prefix', prefix);
      await reply(`Prefix changed to ${prefix}.`);
    }),
  },
  {
    name: 'setbotname',
    desc: 'Change the bot name',
    ownerOnly: true,
    run: safe('setbotname', async ({ config, text, reply, sock }) => {
      const name = (text || '').trim();
      if (!name || name.length > 25) return reply('Provide a name of 1 to 25 characters.');

      config.botName = name;
      await db.set('runtime:botName', name);

      if (typeof sock.updateProfileName !== 'function') {
        return reply(`Bot name changed to ${name} in the menu. This Baileys version cannot change the WhatsApp profile name.`);
      }
      try {
        await sock.updateProfileName(name);
      } catch (e) {
        return reply(`Bot name changed to ${name} in the menu, but the WhatsApp profile name could not be updated: ${e.message}`);
      }
      await reply(`Bot name changed to ${name}.`);
    }),
  },
  {
    name: 'setpic',
    desc: 'Set the profile picture by replying to an image',
    ownerOnly: true,
    run: safe('setpic', async ({ sock, quotedMsg, reply }) => {
      const image = unwrapQuoted(quotedMsg)?.imageMessage;
      if (!image) return reply('Reply to an image with .setpic.');

      const buffer = await downloadBuffer(image, 'image');
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return reply('The image is empty or over 5 MB.');

      await sock.updateProfilePicture(jidNormalizedUser(sock.user.id), buffer);
      await reply('Profile picture updated.');
    }),
  },
  {
    name: 'vv',
    desc: 'Forward a quoted view-once image or video',
    ownerOnly: true,
    run: safe('vv', async ({ sock, jid, m, quotedMsg, reply }) => {
      const message = unwrapQuoted(quotedMsg);
      const kind = message?.imageMessage ? 'image' : message?.videoMessage ? 'video' : null;
      if (!kind) return reply('Reply directly to a view-once image or video with .vv.');

      const media = message[`${kind}Message`];
      const buffer = await downloadBuffer(media, kind);
      if (!buffer.length) return reply('Could not download the quoted media.');

      await sock.sendMessage(jid, { [kind]: buffer, caption: media.caption || '' }, { quoted: m });
    }),
  },
];
