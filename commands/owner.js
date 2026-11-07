const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = [
  {
    name: 'mode',
    desc: 'mode public | private',
    ownerOnly: true,
    run: async ({ config, args, reply }) => {
      const v = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(v)) return reply('Use: mode public | mode private');
      config.publicMode = v === 'public';
      await reply(`✅ Mode set to ${v}`);
    },
  },
  {
    name: 'vv',
    desc: 'Reveal a quoted view-once media',
    ownerOnly: true,
    run: async ({ sock, jid, m, quotedMsg, reply }) => {
      if (!quotedMsg) return reply('Reply to a view-once message.');
      const q =
        quotedMsg.viewOnceMessageV2?.message ||
        quotedMsg.viewOnceMessage?.message ||
        quotedMsg.viewOnceMessageV2Extension?.message ||
        quotedMsg;
      const kind = q.imageMessage ? 'image' : q.videoMessage ? 'video' : null;
      if (!kind) return reply('No image/video found.');
      const stream = await downloadContentFromMessage(q[kind + 'Message'], kind);
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      await sock.sendMessage(jid, { [kind]: Buffer.concat(chunks), caption: q[kind + 'Message'].caption || '' }, { quoted: m });
    },
  },
];
