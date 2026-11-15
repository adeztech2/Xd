// Group event notices. Switch per group with the .events on|off command (commands/group.js).
// Edit notices come from plugins/anti-edit.js only.
const attached = new WeakSet();
module.exports = {
  name: 'group-events',
  events: {
    message: async (ctx, { db }) => {
      const ev = ctx.sock.ev;
      if (ev && !attached.has(ev)) {
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
      }
    },
  },
};
