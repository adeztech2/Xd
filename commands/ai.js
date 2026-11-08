// OpenAI-powered Adez AI command. Configure OPENAI_API_KEY in the host environment.
const MAX_PROMPT_CHARS = 2000;
const MAX_REPLY_CHARS = 3500;

async function askAssistant(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { const error = new Error('OPENAI_API_KEY is not configured'); error.missingKey = true; throw error; }
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
module.exports = [{ name: 'ai', alias: ['ask', 'chatgpt', 'adezai'], desc: 'Ask Adez AI', run }];
