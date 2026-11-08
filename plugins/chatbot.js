// Adez AI chatbot is opt-in. Enable with .toggle chatbot on; requires OPENAI_API_KEY.
const MAX_TEXT = 1600;
const WINDOW_MS = 60_000;
const lastReply = new Map();
module.exports = {
  name: 'adez-ai-chatbot',
  events: {
    message: async (ctx) => {
      if (!ctx.config.chatbot?.enabled || ctx.m.key.fromMe || (ctx.isGroup && !ctx.config.chatbotInGroups)) return;
      const text = (ctx.body || '').trim();
      if (!text || text.length > MAX_TEXT || ctx.prefix && text.startsWith(ctx.prefix)) return;
      if (/^(menu|help|alive|ping|uptime|time|date|owner)$/i.test(text)) return;
      if (!process.env.OPENAI_API_KEY) return;
      const now = Date.now();
      if (now - (lastReply.get(ctx.sender) || 0) < WINDOW_MS) return;
      lastReply.set(ctx.sender, now);
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [
            { role: 'system', content: 'You are Adez AI, a helpful concise WhatsApp assistant. Reply in plain text and do not claim to be human.' },
            { role: 'user', content: text },
          ], max_tokens: 400 }),
        });
        if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
        const answer = (await response.json()).choices?.[0]?.message?.content?.trim();
        if (answer) await ctx.reply(answer.slice(0, 3000));
      } catch (error) { console.error('Adez AI chatbot error:', error.message); }
    },
  },
};
