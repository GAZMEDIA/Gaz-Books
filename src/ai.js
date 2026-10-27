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

async function writeBackCover(book, { genre, audience, claudeKey }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: claudeKey });
  const schema = {
    type: 'object',
    properties: {
      tagline: { type: 'string' },
      blurb: { type: 'string' },
      genre: { type: 'string' },
      mood: { type: 'string' },
      setting: { type: 'string' },
      details: { type: 'string' },
      searchWords: { type: 'array', items: { type: 'string' } },
    },
    required: ['tagline', 'blurb', 'genre', 'mood', 'setting', 'details', 'searchWords'],
    additionalProperties: false,
  };
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: 'You write back cover copy for books published on Amazon KDP. Write in the language of the manuscript.',
    messages: [{
      role: 'user',
      content: `Book title: ${book.title || 'Untitled'}\nAuthor: ${book.author || ''}\n${genre ? `Genre: ${genre}\n` : ''}${audience ? `Readers: ${audience}\n` : ''}
Here is the opening of the manuscript:\n<manuscript>\n${sampleText(book)}\n</manuscript>

Write:
- tagline: one gripping line, at most 15 words.
- blurb: back cover description, 120 to 170 words, 2 or 3 short paragraphs separated by a blank line. Hook the reader, introduce the main character and the stakes, do not reveal the ending, no reviews or quotes you made up.
- genre, mood, setting: a few words each, for the cover picture.
- details: one sentence describing a strong cover picture for this book (objects, place, light, colours). No text in the picture.
- searchWords: 4 short phrases to search stock photo sites for a fitting cover picture.`,
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to write this back cover.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

module.exports = { writeBackCover, sampleText };
