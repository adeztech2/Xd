// Adez AI commands. Replace commands/ai.js with this file.
//
// Provider order for most commands:
//   OPENAI_API_KEY set  -> OpenAI (model: OPENAI_MODEL, default gpt-4o-mini)
//   GEMINI_API_KEY set  -> Google Gemini (model: GEMINI_MODEL, default gemini-2.5-flash)
//   neither set         -> free public endpoint (best effort, may be slow)
// .gemini always uses GEMINI_API_KEY.

const MAX_INPUT_CHARS = 2000;
const MAX_REPLY_CHARS = 3500;
const TIMEOUT_MS = 45000;

const BASE_SYSTEM =
  'You are Adez AI, a helpful, friendly assistant replying in WhatsApp. Be concise, use plain text, and do not claim to be human.';

// ---------- providers ----------

function clip(text) {
  return String(text || '').trim().slice(0, MAX_REPLY_CHARS);
}

async function askFree(system, prompt) {
  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?system=${encodeURIComponent(system)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error('The free AI service is busy. Try again later, or set OPENAI_API_KEY for reliable answers.');
  }
  const answer = clip(await response.text());
  if (!answer) throw new Error('The AI service returned an empty answer.');
  return answer;
}

async function askOpenAI(system, prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('The OpenAI API key is invalid. Check OPENAI_API_KEY.');
    if (response.status === 429) throw new Error('OpenAI is busy or its quota is used up.');
    throw new Error(`OpenAI returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  const answer = clip(data.choices?.[0]?.message?.content);
  if (!answer) throw new Error('OpenAI returned an empty answer.');
  return answer;
}

async function askGemini(system, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini is not set up. Add GEMINI_API_KEY to the host environment.');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });

  if (!response.ok) {
    if (response.status === 400 || response.status === 403) {
      throw new Error('The Gemini API key is invalid or not allowed. Check GEMINI_API_KEY.');
    }
    if (response.status === 404) {
      throw new Error(`Gemini model "${model}" was not found. Set GEMINI_MODEL to a current model name.`);
    }
    if (response.status === 429) throw new Error('Gemini is busy or its quota is used up.');
    throw new Error(`Gemini returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  const answer = clip(
    (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
  );
  if (!answer) {
    throw new Error('Gemini returned an empty answer. It may have been blocked by its safety filters.');
  }
  return answer;
}

async function askAuto(system, prompt) {
  if (process.env.OPENAI_API_KEY) return askOpenAI(system, prompt, process.env.OPENAI_API_KEY);
  if (process.env.GEMINI_API_KEY) return askGemini(system, prompt);
  return askFree(system, prompt);
}

// ---------- command specs ----------
// prepare(text) returns { system, prompt } or null when the input is missing or invalid.

const SPECS = [
  {
    name: 'ai',
    alias: ['ask', 'gpt', 'chatgpt', 'adezai'],
    desc: 'Ask Adez AI anything',
    usage: '<question>',
    example: 'explain gravity',
    prepare: (t) => (t ? { system: BASE_SYSTEM, prompt: t } : null),
  },
  {
    name: 'gemini',
    alias: ['gemeni', 'gem'],
    desc: 'Ask Google Gemini',
    usage: '<question>',
    example: 'write a haiku about rain',
    provider: 'gemini',
    prepare: (t) => (t ? { system: BASE_SYSTEM, prompt: t } : null),
  },
  {
    name: 'explain',
    alias: ['explainit'],
    desc: 'Explain a topic simply',
    usage: '<topic>',
    example: 'how vaccines work',
    prepare: (t) =>
      t
        ? {
            system:
              'Explain the topic simply, as if to a curious beginner. Use short paragraphs and one everyday example. Plain text only.',
            prompt: t,
          }
        : null,
  },
  {
    name: 'summarize',
    alias: ['summary', 'tldr'],
    desc: 'Summarize a text',
    usage: '<text>',
    example: 'paste a paragraph after the command',
    prepare: (t) =>
      t
        ? {
            system: 'Summarize the text clearly in at most 5 short lines. Plain text, no headings.',
            prompt: t,
          }
        : null,
  },
  {
    name: 'translate',
    alias: ['tr'],
    desc: 'Translate text into a language',
    usage: '<language> <text>',
    example: 'french Good morning, how are you?',
    prepare: (t) => {
      const m = t.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m) return null;
      const [, lang, text] = m;
      return {
        system: `Translate the user's text into ${lang}. Return only the translation, with no notes.`,
        prompt: text,
      };
    },
  },
  {
    name: 'rewrite',
    alias: ['improve'],
    desc: 'Rewrite text to be clearer',
    usage: '<text>',
    example: 'hey can u send the file asap',
    prepare: (t) =>
      t
        ? {
            system: 'Rewrite the text to be clearer and more polished, keeping the same meaning. Return only the rewritten text.',
            prompt: t,
          }
        : null,
  },
  {
    name: 'code',
    alias: ['coder'],
    desc: 'Get code help or an example',
    usage: '<what you need>',
    example: 'python function to reverse a string',
    prepare: (t) =>
      t
        ? {
            system:
              'You are a careful programmer. Give working code in one fenced code block, then a short explanation of 1 to 3 lines.',
            prompt: t,
          }
        : null,
  },
  {
    name: 'story',
    alias: ['tale'],
    desc: 'Write a short story',
    usage: '[topic]',
    example: 'a fox who learns to fly',
    prepare: (t) => ({
      system: 'Write a short, original story under 250 words. Plain text, with a title on the first line.',
      prompt: t || 'Write a short story about anything you like.',
    }),
  },
  {
    name: 'poem',
    alias: ['poetry'],
    desc: 'Write an original poem',
    usage: '[topic]',
    example: 'the sea at night',
    prepare: (t) => ({
      system: 'Write an original poem of 8 to 12 lines. Plain text. Do not reproduce existing song lyrics or copyrighted poems.',
      prompt: t || 'Write a poem about hope.',
    }),
  },
  {
    name: 'joke',
    alias: ['funny'],
    desc: 'Tell a short clean joke',
    usage: '[topic]',
    example: 'cats',
    prepare: (t) => ({
      system: 'Tell one short, clean, original joke. Plain text, no preamble.',
      prompt: t ? `Topic: ${t}` : 'Tell me a joke.',
    }),
  },
  {
    name: 'ideas',
    alias: ['idea', 'brainstorm'],
    desc: 'Get a list of ideas on a topic',
    usage: '<topic>',
    example: 'birthday party themes',
    prepare: (t) =>
      t
        ? {
            system: 'Give 5 numbered ideas on the topic, one short line each. Plain text.',
            prompt: t,
          }
        : null,
  },
];

// ---------- shared runner ----------

async function runCommand(spec, ctx) {
  const input = (ctx.text || '').trim();
  const prefix = ctx.prefix || ctx.config.prefix[0];

  if (input.length > MAX_INPUT_CHARS) {
    return ctx.reply(`Please keep your input under ${MAX_INPUT_CHARS} characters.`);
  }

  const job = spec.prepare(input);
  if (!job) {
    return ctx.reply(`Usage: ${prefix}${spec.name} ${spec.usage}\nExample: ${prefix}${spec.name} ${spec.example}`);
  }

  try {
    const answer =
      spec.provider === 'gemini'
        ? await askGemini(job.system, job.prompt)
        : await askAuto(job.system, job.prompt);
    await ctx.reply(answer);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.error(`${spec.name} command error:`, error?.message || error);
    await ctx.reply(
      timedOut
        ? `${spec.name} took too long to answer. Please try again.`
        : error?.message || `${spec.name} could not answer right now. Please try again later.`
    );
  }
}

// ---------- exports ----------

module.exports = SPECS.map((spec) => ({
  name: spec.name,
  alias: spec.alias,
  desc: spec.desc,
  run: (ctx) => runCommand(spec, ctx),
}));
