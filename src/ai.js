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

// One JSON answer from Gemini (when there is a Gemini key) or Claude.
// keys: { geminiKey, claudeKey }; think: false for quick, simple jobs like proofreading.
async function aiJson({ geminiKey, claudeKey }, { system, prompt, schema, maxTokens = 32000, think = true }) {
  if (geminiKey) return require('./gemini').geminiJson(geminiKey, { system, prompt, schema, maxTokens, think });
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
async function writeBackCover(book, { genre, audience, claudeKey, geminiKey }) {
  const prompt = `Book title: ${book.title || 'Untitled'}\n${book.subtitle ? `Subtitle: ${book.subtitle}\n` : ''}Author: ${book.author || ''}\n${genre ? `Genre: ${genre}\n` : ''}${audience ? `Readers: ${audience}\n` : ''}
Here is the opening of the manuscript:\n<manuscript>\n${sampleText(book)}\n</manuscript>

Write:
- tagline: one gripping line, at most 15 words.
- blurb: back cover description, 120 to 170 words, 2 or 3 short paragraphs separated by a blank line. Hook the reader, introduce the main character or the reader's problem and the stakes, do not reveal the ending, no reviews or quotes you made up.
- genre, mood, setting: a few words each, for the cover picture.
- details: one sentence describing a strong cover picture for this book (objects, place, light, colours). No text in the picture.
- searchWords: 4 short phrases to search stock photo sites for a fitting cover picture.
- coverPrompt: ${COVER_PROMPT_TASK(book)}`;
  return aiJson({ geminiKey, claudeKey }, { system: SYSTEM, prompt, schema: SCHEMA, maxTokens: 8000 });
}

// The author's own brief for cover prompts (GazBook owner's wording).
const COVER_PROMPT_TASK = (book) => `act as a prompt engineer and write a detailed prompt for an AI picture maker for the cover of the book "${[book.title, book.subtitle].filter(Boolean).join(': ')}" authored by "${book.author || 'the author'}". The cover must be very captivating so it can stand among the best sellers on Amazon KDP. Describe the main image, composition, colours, lighting, mood and style, where the title, subtitle and author name go and their lettering style, and that it must read well as a small thumbnail. Front cover, portrait 1600 x 2560 pixels.`;

module.exports = { writeBackCover, sampleText, aiJson, COVER_PROMPT_TASK };
