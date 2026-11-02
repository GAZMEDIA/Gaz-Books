// Google Gemini, for people who would rather use their Google account than
// buy a Claude key. The key is free from Google AI Studio (aistudio.google.com/apikey),
// where they sign in with their Gmail.
const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_URL = 'https://aistudio.google.com/apikey';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Google retires models often, so GazBook asks which ones this key can use and
// takes the newest: a "flash" model for text, an "image" model for pictures.
const version = (name) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(name) || [])[1] || 0);
let models = null;
async function availableModels(key) {
  if (models) return models;
  try {
    const r = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) models = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  } catch { /* fall back to Google's aliases below */ }
  return models || [];
}
async function textModels(key) {
  const all = await availableModels(key);
  const newest = (re) => all.filter((n) => re.test(n)).sort((a, b) => version(b) - version(a));
  return [...new Set([
    ...newest(/^gemini-\d+(\.\d+)?-flash$/),
    'gemini-flash-latest',
    ...newest(/^gemini-\d+(\.\d+)?-flash-preview/),
    ...newest(/^gemini-\d+(\.\d+)?-flash-lite$/),
    'gemini-flash-lite-latest',
  ])];
}
async function imageModels(key) {
  const all = await availableModels(key);
  const found = all.filter((n) => /^gemini-\d+(\.\d+)?-(pro|flash)-image/.test(n))
    .sort((a, b) => (/pro/.test(b) - /pro/.test(a)) || version(b) - version(a));
  return [...new Set([...found, 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image'])];
}
const gone = (status, msg) => status === 404 || /no longer available|not found|not supported|deprecated/i.test(msg);

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
async function geminiJson(key, { system, prompt, schema, maxTokens = 32000, think = true }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema), maxOutputTokens: maxTokens, temperature: 0.4 },
  };
  const list = await textModels(key);
  let mi = 0;
  for (let attempt = 0; ; attempt++) {
    const model = list[mi];
    const cfg = { ...body.generationConfig };
    if (!think) cfg.thinkingConfig = version(model) >= 3 || /latest/.test(model) ? { thinkingLevel: 'low' } : { thinkingBudget: 0 };
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ ...body, generationConfig: cfg }),
    });
    const j = await r.json().catch(() => ({}));
    const msg = j.error?.message || `error ${r.status}`;
    if (!r.ok && gone(r.status, msg) && mi < list.length - 1) { mi++; attempt = -1; continue; }
    if (!r.ok && r.status === 400 && /thinking/i.test(msg) && !think) { think = true; attempt = -1; continue; }
    // Busy ("high demand") or this model's free allowance used up: wait a little,
    // then try the next model, which has its own capacity and allowance.
    const busy = r.status >= 500 || /high demand|overloaded|unavailable/i.test(msg);
    if (busy || r.status === 429) {
      if (attempt < 2) { await wait(busy ? 3000 * (attempt + 1) : 8000); continue; }
      if (mi < list.length - 1) { mi++; attempt = -1; continue; }
      if (attempt < 6) { await wait(Math.min(60000, 5000 * 2 ** (attempt - 2))); mi = 0; continue; }
    }
    if (!r.ok) {
      if (/API key/i.test(msg)) throw new Error('Your Gemini key did not work. Check it in Settings (get a free one at aistudio.google.com/apikey).');
      if (r.status === 429) throw new Error('Gemini says the free allowance for today is used up. Try again tomorrow, or add billing in Google AI Studio.');
      if (r.status >= 500 || /high demand|overloaded/i.test(msg)) throw new Error('Google\'s Gemini servers are very busy right now. Please try again in a few minutes.');
      throw new Error(`Gemini: ${msg}`);
    }
    const c = j.candidates?.[0];
    if (!c || c.finishReason === 'SAFETY' || c.finishReason === 'PROHIBITED_CONTENT') throw new Error('Gemini declined part of this book.');
    if (c.finishReason === 'MAX_TOKENS') throw new Error('A part of the book was too long for Gemini in one go.');
    const text = (c.content?.parts || []).map((p) => p.text || '').join('');
    return JSON.parse(text);
  }
}

// A cover picture. Google's picture models need billing turned on in AI Studio
// (a few US cents a picture); with a free key this fails and the caller falls
// back to a free stock photo.
async function geminiImage(key, prompt) {
  let last = 'no picture came back';
  for (const model of await imageModels(key)) {
    const imageConfig = /pro/.test(model) ? { aspectRatio: '2:3', imageSize: '2K' } : { aspectRatio: '2:3' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig } }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status >= 500 && attempt === 0) { await wait(5000); continue; }
      if (!r.ok) { last = j.error?.message || `error ${r.status}`; break; }
      const part = (j.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data);
      if (part) return { buffer: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType || 'image/png', model };
      last = 'Gemini did not return a picture';
      break;
    }
  }
  throw new Error(last);
}

module.exports = { geminiJson, geminiImage, GEMINI_KEY_URL: KEY_URL };
