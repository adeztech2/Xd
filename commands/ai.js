// OpenAI-powered Adez AI command. Configure OPENAI_API_KEY in the host environment.
const MAX_PROMPT_CHARS = 2000;
const MAX_REPLY_CHARS = 3500;

// No key set: use a free public text endpoint so .ai still answers (best effort, may be slow or busy).
async function askFree(prompt) {
  const system = 'You are Adez AI, a helpful, friendly assistant replying in WhatsApp. Be concise and use plain text.';
  const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?system=${encodeURIComponent(system)}`, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error('The free AI service is busy. Try again, or add OPENAI_API_KEY for reliable answers.');
  const answer = (await response.text()).trim();
  if (!answer) throw new Error('The AI service returned an empty answer.');
  return answer.slice(0, MAX_REPLY_CHARS);
}

async function askAssistant(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return askFree(prompt);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are Adez AI, a helpful, friendly assistant replying in WhatsApp. Be concise, use plain text, and do not claim to be human.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'The AI API key is invalid.' : response.status === 429 ? 'The AI service is busy or its quota is exhausted.' : `The AI service returned HTTP ${response.status}.`);
  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('The AI service returned an empty answer.');
  return answer.slice(0, MAX_REPLY_CHARS);
}

async function run(ctx) {
  const prompt = (ctx.text || '').trim();
  if (!prompt) return ctx.reply(`Ask Adez AI something. Example: ${ctx.prefix || ctx.config.prefix[0]}ai explain gravity`);
  if (prompt.length > MAX_PROMPT_CHARS) return ctx.reply(`Please keep your question under ${MAX_PROMPT_CHARS} characters.`);
  try { await ctx.reply(await askAssistant(prompt)); }
  catch (error) {
    console.error('Adez AI command error:', error.message);
    await ctx.reply(error.missingKey ? 'AI is not configured. Add OPENAI_API_KEY to the host environment.' : error.message);
  }
}
module.exports = [{ name: 'ai', alias: ['ask', 'chatgpt', 'adezai', 'gpt'], desc: 'Ask Adez AI', run }];
