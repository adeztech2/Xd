// Visible recording presence for incoming voice notes only. Audio is never stored or transcribed.
module.exports = {
  name: 'auto-recording-presence',
  events: {
    message: async (ctx) => {
      if (!ctx.config.autoRecording || ctx.m.key.fromMe) return;
      const message = ctx.m.message || {};
      const audio = message.audioMessage || message.ephemeralMessage?.message?.audioMessage || message.viewOnceMessageV2?.message?.audioMessage;
      if (!audio) return;
      await ctx.sock.sendPresenceUpdate('recording', ctx.jid).catch(() => {});
      setTimeout(() => ctx.sock.sendPresenceUpdate('paused', ctx.jid).catch(() => {}), 2500);
    },
  },
};
