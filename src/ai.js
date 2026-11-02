// Back cover words and picture ideas written by Claude from the manuscript.
const { plain } = require('./read');

function sampleText(book, maxChars = 24000) {
  const out = [];
  let n = 0;
  for (const ch of book.chapters) {
    if (ch.title) out.push(`\n## ${ch.title}\n`);
    for (const b of ch.blocks) {
      if (!b.runs) continue;
      const t = plain(b.runs);
      out.push(t);
      n += t.length;
      if (n > maxChars) return out.join('\n');
    }
  }
  return out.join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    tagline: { type: 'string' },
    blurb: { type: 'string' },
    genre: { type: 'string' },
    mood: { type: 'string' },
    setting: { type: 'string' },
    details: { type: 'string' },
    searchWords: { type: 'array', items: { type: 'string' } },
    coverPrompt: { type: 'string' },
  },
  required: ['tagline', 'blurb', 'genre', 'mood', 'setting', 'details', 'searchWords', 'coverPrompt'],
  additionalProperties: false,
};
const SYSTEM = 'You write back cover copy for books published on Amazon KDP. Write in the language of the manuscript.';

// Finished answers are kept on disk, so pressing the button again after a
// failure (or a power cut) carries on from where it stopped instead of asking
// the AI everything again. main sets the folder; tests leave it off.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let cacheDir = '';
function setAiCache(dir) { cacheDir = dir; if (dir) fs.mkdirSync(dir, { recursive: true }); }
const cacheFile = (o) => cacheDir && path.join(cacheDir, `${crypto.createHash('sha256').update(JSON.stringify([o.system, o.prompt, o.schema])).digest('hex')}.json`);

// The free Gemini allowance counts requests per minute; space them out a little.
let lastCall = 0;
async function pace(ms) {
  const waitFor = lastCall + ms - Date.now();
  if (waitFor > 0) await new Promise((r) => setTimeout(r, waitFor));
  lastCall = Date.now();
}

// One JSON answer. Tries, in order: answers already remembered, Gemini (with
// a key, online), Claude (with a key), then GazBook's built-in AI on this
// computer (keys.local), so it also works with no internet.
// prompt may be a function of how much book text fits: online models read a
// lot, the built-in AI a short sample.
// keys: { geminiKey, claudeKey, local }; think: false for quick jobs like proofreading.
async function aiJson(keys, o) {
  const big = typeof o.prompt === 'function' ? o.prompt(true) : o.prompt;
  const file = cacheFile({ ...o, prompt: big });
  if (file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not asked before */ } }
  const tries = [];
  if (keys.geminiKey) tries.push(async () => { await pace(4000); return require('./gemini').geminiJson(keys.geminiKey, { ...o, prompt: big }); });
  if (keys.claudeKey) tries.push(() => claudeJson(keys.claudeKey, { ...o, prompt: big }));
  if (keys.local) tries.push(() => keys.local({ ...o, prompt: typeof o.prompt === 'function' ? o.prompt(false) : o.prompt }));
  if (!tries.length) throw new Error('Add your free Gemini key in Settings, or turn on GazBook\'s built-in AI.');
  let out; let err;
  for (const t of tries) {
    try { out = await t(); break; } catch (e) {
      err = e;
      if (/declined/.test(e.message)) throw e;
    }
  }
  if (!out) throw err;
  if (file) { try { fs.writeFileSync(file, JSON.stringify(out)); } catch { /* the cache is only a help */ } }
  return out;
}

async function claudeJson(claudeKey, { system, prompt, schema, maxTokens = 32000, think = true }) {
  if (!claudeKey) throw new Error('Add your free Gemini key in Settings first (click "Get my free Gemini key").');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: claudeKey });
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: think ? 'medium' : 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The AI declined this part of the book.');
  if (response.stop_reason === 'max_tokens') throw new Error('A part of the book was too long for the AI in one go.');
  return JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

// Back cover words, picture ideas and a cover prompt for AI picture makers.
async function writeBackCover(book, { genre, audience, claudeKey, geminiKey, local }) {
  const prompt = (big) => `Book title: ${book.title || 'Untitled'}\n${book.subtitle ? `Subtitle: ${book.subtitle}\n` : ''}Author: ${book.author || ''}\n${genre ? `Genre: ${genre}\n` : ''}${audience ? `Readers: ${audience}\n` : ''}
Here is the opening of the manuscript:\n<manuscript>\n${sampleText(book, big ? 24000 : 6000)}\n</manuscript>

Write:
- tagline: one gripping line, at most 15 words.
- blurb: back cover description, 120 to 170 words, 2 or 3 short paragraphs separated by a blank line. Hook the reader, introduce the main character or the reader's problem and the stakes, do not reveal the ending, no reviews or quotes you made up.
- genre, mood, setting: a few words each, for the cover picture.
- details: one sentence describing a strong cover picture for this book (objects, place, light, colours). No text in the picture.
- searchWords: 4 short phrases to search stock photo sites for a fitting cover picture.
- coverPrompt: ${COVER_PROMPT_TASK(book)}`;
  return aiJson({ geminiKey, claudeKey, local }, { system: SYSTEM, prompt, schema: SCHEMA, maxTokens: 8000 });
}

// The author's own brief for cover prompts (GazBook owner's wording).
const COVER_PROMPT_TASK = (book) => `act as a prompt engineer and write a detailed prompt for an AI picture maker for the cover of the book "${[book.title, book.subtitle].filter(Boolean).join(': ')}" authored by "${book.author || 'the author'}". The cover must be very captivating so it can stand among the best sellers on Amazon KDP. Describe the main image, composition, colours, lighting, mood and style, where the title, subtitle and author name go and their lettering style, and that it must read well as a small thumbnail. Front cover, portrait 1600 x 2560 pixels.`;

module.exports = { writeBackCover, sampleText, aiJson, setAiCache, COVER_PROMPT_TASK };
