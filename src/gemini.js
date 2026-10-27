// Google Gemini, for people who would rather use their Google account than
// buy a Claude key. The key is free from Google AI Studio (aistudio.google.com/apikey),
// where they sign in with their Gmail.
const MODEL = 'gemini-2.5-flash';
const KEY_URL = 'https://aistudio.google.com/apikey';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini's schema dialect: no additionalProperties.
function toGeminiSchema(s) {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties') out[k] = toGeminiSchema(v);
  return out;
}

// One request that answers in JSON matching schema. Retries when Google is busy
// or the free allowance per minute is used up.
async function geminiJson(key, { system, prompt, schema, maxTokens = 32000 }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema), maxOutputTokens: maxTokens, temperature: 0.4 },
  };
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { await wait(Math.min(60000, 4000 * 2 ** attempt)); continue; }
    if (!r.ok) {
      const msg = j.error?.message || `error ${r.status}`;
      if (/API key/i.test(msg)) throw new Error('Your Gemini key did not work. Check it in Settings (get a free one at aistudio.google.com/apikey).');
      if (r.status === 429) throw new Error('Gemini says the free allowance for today is used up. Try again tomorrow, or add billing in Google AI Studio.');
      throw new Error(`Gemini: ${msg}`);
    }
    const c = j.candidates?.[0];
    if (!c || c.finishReason === 'SAFETY' || c.finishReason === 'PROHIBITED_CONTENT') throw new Error('Gemini declined part of this book.');
    if (c.finishReason === 'MAX_TOKENS') throw new Error('A part of the book was too long for Gemini in one go.');
    const text = (c.content?.parts || []).map((p) => p.text || '').join('');
    return JSON.parse(text);
  }
}

module.exports = { geminiJson, GEMINI_KEY_URL: KEY_URL };
