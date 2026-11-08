// Observe recent message edits and notify the original chat when anti-edit is enabled.
const recent = new Map();
const MAX_TRACKED = 1000;
module.exports = {
  name: 'anti-edit',
  events: {
    message: async (ctx) => {
      const protocol = ctx.m.message?.protocolMessage;
      if (protocol?.type === 14 && ctx.config.antiEdit) {
        const original = recent.get(protocol.key?.id);
        const edited = protocol.editedMessage || {};
        const updated = edited.conversation || edited.extendedTextMessage?.text || edited.imageMessage?.caption || '[edited media/message]';
        await ctx.reply(`Edited message detected.\nBefore: ${original || '[original not cached]'}\nAfter: ${String(updated).slice(0, 700)}`).catch((error) => console.error('anti-edit alert error:', error.message));
        return;
      }
      if (ctx.m.key.id && ctx.body) {
        recent.set(ctx.m.key.id, String(ctx.body).slice(0, 700));
        if (recent.size > MAX_TRACKED) recent.delete(recent.keys().next().value);
      }
    },
  },
};
