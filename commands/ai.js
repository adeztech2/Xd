// Adez AI commands. Replace commands/ai.js with this file.
//
// General commands (.ai, .explain, .poem, ...) use the first provider that is configured:
//   OPENAI_API_KEY  -> OpenAI (OPENAI_MODEL, default gpt-4o-mini)
//   GEMINI_API_KEY  -> Google Gemini (GEMINI_MODEL, default gemini-2.5-flash)
//   otherwise       -> Keith AI (KEITH_AI_URL, or KEITH_API_BASE + /keithai)
// .gemini always uses GEMINI_API_KEY.
// Keith model commands (.claude, .mistral, ...) always use KEITH_API_BASE.

const MAX_INPUT_CHARS = 2000;
const MAX_REPLY_CHARS = 3500;
const TIMEOUT_MS = 45000;

const DEFAULT_KEITH_API_BASE = 'https://keithhostdeploysite-22l75uk5-ff0ccc337078.herokuapp.com';

const BASE_SYSTEM =
  'You are Adez AI, a helpful, friendly assistant replying in WhatsApp. Be concise, use plain text, and do not claim to be human.';

// ---------- helpers ----------

function clip(text) {
  return String(text || '').trim().slice(0, MAX_REPLY_CHARS);
}

// Keith endpoints take only a question (?q=), so instructions are added to the question.
function withSystem(system, prompt) {
  return system ? `${system}\n\n${prompt}` : prompt;
}

// Reads the answer from the common Keith response shapes.
function extractKeithText(data) {
  if (data?.status === false) throw new Error('The AI service could not answer that. Try rephrasing.');
  const raw = data?.result ?? data?.message ?? data?.response ?? data?.answer ?? data?.data;
  const text = typeof raw === 'string' ? raw : raw?.text || raw?.message || raw?.content || '';
  const answer = clip(text);
  if (!answer) throw new Error('The AI service returned an empty answer.');
  return answer;
}

function keithBase() {
  return ((process.env.KEITH_API_BASE || '').trim() || DEFAULT_KEITH_API_BASE).replace(/\/+$/, '');
}

// ---------- providers ----------

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
      max_tokens: 900,
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
      generationConfig: {
        maxOutputTokens: 2048,
        // Turn off hidden "thinking" so the budget goes to the visible answer.
        // If Google returns an error about this setting, remove the thinkingConfig line.
        thinkingConfig: { thinkingBudget: 0 },
      },
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
  const answer = clip((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
  if (!answer) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'unknown';
    throw new Error(`Gemini returned no text (reason: ${reason}). Try rephrasing.`);
  }
  return answer;
}

// Calls any Keith endpoint on the Keith base with the given query parameters.
async function askKeithModel(path, params) {
  const response = await fetch(`${keithBase()}${path}?${new URLSearchParams(params).toString()}`, {
    headers: { 'User-Agent': 'adez-xmd-bot' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The AI service returned HTTP ${response.status}.`);
  return extractKeithText(await response.json());
}

// General Keith endpoint. KEITH_AI_URL overrides the default /keithai path if you set it.
async function askKeith(system, prompt) {
  const q = withSystem(system, prompt);
  const full = (process.env.KEITH_AI_URL || '').trim();
  if (full) {
    const sep = full.includes('?') ? '&' : '?';
    const response = await fetch(`${full}${sep}q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'adez-xmd-bot' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Keith AI returned HTTP ${response.status}.`);
    return extractKeithText(await response.json());
  }
  return askKeithModel('/keithai', { q });
}

async function askAuto(system, prompt) {
  if (process.env.OPENAI_API_KEY) return askOpenAI(system, prompt, process.env.OPENAI_API_KEY);
  if (process.env.GEMINI_API_KEY) return askGemini(system, prompt);
  return askKeith(system, prompt);
}

// ---------- command specs ----------
// prepare(text) returns a job or null when the input is missing or invalid.
// A job is { system, prompt } for general providers, or { params } for Keith model endpoints.
// Command names are unique across the project. "joke" belongs to fun.js and "translate" to tools.js.

const KEITH_MODEL = (name, path, desc, example, alias = []) => ({
  name,
  alias,
  desc,
  usage: '<question>',
  example,
  path,
  prepare: (t) => (t ? { params: { q: withSystem(BASE_SYSTEM, t) } } : null),
});

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

  // ----- Keith model endpoints -----
  KEITH_MODEL('claudeai', '/ai/claudeai', 'Ask Claude (via Keith)', 'what is a black hole', ['claude']),
  KEITH_MODEL('mistral', '/ai/mistral', 'Ask Mistral (via Keith)', 'name three uses for baking soda', ['mistralai']),
  KEITH_MODEL('copilot', '/ai/copilot', 'Ask Copilot (via Keith)', 'how do I center a div'),
  KEITH_MODEL('perplexity', '/ai/perplexity', 'Ask Perplexity (via Keith)', 'latest news on solar power', ['pplx']),
  KEITH_MODEL('venice', '/ai/venice', 'Ask Venice AI (via Keith)', 'write a short thank you note'),
  KEITH_MODEL('o3', '/ai/o3', 'Ask the o3 model (via Keith)', 'solve 17 times 23'),
  KEITH_MODEL('chatgpt4', '/ai/chatgpt4', 'Ask ChatGPT-4 (via Keith)', 'give me a study plan for exams', ['gpt4']),
  KEITH_MODEL('deepseek', '/ai/deepseekr', 'Ask DeepSeek (via Keith)', 'explain recursion simply', ['deepseekr']),
  KEITH_MODEL('metai', '/ai/metai', 'Ask Meta AI (via Keith)', 'hi'),
  {
    name: 'lyricsai',
    alias: ['songai'],
    desc: 'Write song lyrics on a topic (via Keith)',
    usage: '<topic>',
    example: 'heartbreak',
    path: '/ai/lyricsgen',
    prepare: (t) =>
      t
        ? {
            params: {
              topic: t,
              genre: 'pop',
              mood: 'emotional',
              structure: 'verse_chorus_bridge',
              language: 'en',
            },
          }
        : null,
  },

  // ----- Prompt-style commands (general providers) -----
  {
    name: 'explain',
    alias: ['explainit'],
    desc: 'Explain a topic simply',
    usage: '<topic>',
    example: 'how vaccines work',
    prepare: (t) =>
      t
        ? {
            system: 'Explain the topic simply, as if to a curious beginner. Use short paragraphs and one everyday example. Plain text only.',
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
    name: 'aitranslate',
    alias: ['trai'],
    desc: 'Translate text with AI',
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
            system: 'You are a careful programmer. Give working code in one fenced code block, then a short explanation of 1 to 3 lines.',
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
    let answer;
    if (spec.path) {
      answer = await askKeithModel(spec.path, job.params);
    } else if (spec.provider === 'gemini') {
      answer = await askGemini(job.system, job.prompt);
    } else {
      answer = await askAuto(job.system, job.prompt);
    }
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
