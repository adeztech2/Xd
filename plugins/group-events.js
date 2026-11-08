// Send visible group event notifications and detect edited group messages.
const attached = new WeakSet();
const recent = new Map();
const MAX_TRACKED = 1000;
module.exports = {
  name: 'group-events',
  events: {
    message: async (ctx, { db }) => {
      const ev = ctx.sock.ev;
      if (!attached.has(ev)) {
        attached.add(ev);
        ev.on('group-participants.update', async (event) => {
          try {
            if (!(await db.get(`group-events:${event.id}`))) return;
            const users = (event.participants || []).map((p) => typeof p === 'string' ? p : p.id).join(', ');
            await ctx.sock.sendMessage(event.id, { text: `Group event: ${event.action || 'membership update'}${users ? ` — ${users}` : ''}` });
          } catch (error) { console.error('group event notification error:', error.message); }
        });
        ev.on('groups.update', async (updates) => {
          for (const event of updates || []) {
            try {
              if (!(await db.get(`group-events:${event.id}`))) continue;
              const changed = ['subject', 'desc', 'announce', 'restrict'].filter((key) => event[key] !== undefined);
              if (changed.length) await ctx.sock.sendMessage(event.id, { text: `Group settings changed: ${changed.join(', ')}` });
            } catch (error) { console.error('group settings notification error:', error.message); }
          }
        });
        ev.on('messages.upsert', async ({ messages, type }) => {
          if (type !== 'notify') return;
          for (const message of messages || []) {
            const protocol = message.message?.protocolMessage;
            const groupId = message.key.remoteJid;
            if (!groupId?.endsWith('@g.us')) continue;
            if (protocol?.type === 14) {
              try {
                if (!ctx.config.antiEdit || !(await db.get(`group-events:${groupId}`))) continue;
                const original = recent.get(protocol.key?.id);
                const editedMessage = protocol.editedMessage || {};
                const updated = editedMessage.conversation || editedMessage.extendedTextMessage?.text || '[edited media/message]';
                await ctx.sock.sendMessage(groupId, { text: `Edited message detected.\nBefore: ${original || '[not in recent cache]'}\nAfter: ${String(updated).slice(0, 600)}` });
              } catch (error) { console.error('anti-edit notification error:', error.message); }
              continue;
            }
            const content = message.message?.conversation || message.message?.extendedTextMessage?.text || message.message?.imageMessage?.caption || message.message?.videoMessage?.caption;
            if (message.key.id && content) {
              recent.set(message.key.id, String(content).slice(0, 600));
              if (recent.size > MAX_TRACKED) recent.delete(recent.keys().next().value);
            }
          }
        });
      }
      const eventCommand = (ctx.body || '').trim().match(/^\.?events\s+(on|off)$/i);
      if (!eventCommand || !ctx.isGroup || !ctx.isAdmin) return;
      const enabled = eventCommand[1].toLowerCase() === 'on';
      await db.set(`group-events:${ctx.jid}`, enabled);
      await ctx.reply(`Group event monitoring turned ${enabled ? 'on' : 'off'}.`);
    },
  },
};
