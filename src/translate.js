// Translates a whole book, keeping italic and bold.
// Two engines:
//  - Google Translate: about 250 languages, needs a Google Cloud API key.
//  - Claude: any language you can name (best for languages Google lacks),
//    needs an Anthropic API key. Quality drops for very rare languages.
const { plain } = require('./read');

const RTL = /^(ar|he|iw|fa|ur|ps|sd|ug|yi|dv|ckb|ks)(-|$)/i;

function runsToHtml(runs) {
  return runs.map((r) => {
    let t = r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (r.i) t = `<i>${t}</i>`;
    if (r.b) t = `<b>${t}</b>`;
    return t;
  }).join('');
}

function htmlToRuns(html) {
  const out = [];
  const st = { i: 0, b: 0 };
  const re = /<(\/?)(i|b|em|strong)\s*>|([^<]+)|<[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      const k = /^(i|em)$/i.test(m[2]) ? 'i' : 'b';
      st[k] += m[1] ? -1 : 1;
    } else if (m[3]) {
      const text = m[3].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
      out.push({ text, i: st.i > 0, b: st.b > 0 });
    }
  }
  return out.length ? out : [{ text: '', i: false, b: false }];
}

// Every piece of text in the book, in order, so we can translate in batches.
function collect(book) {
  const items = [];
  if (book.title) items.push({ get: () => book.title, set: (v) => { book.title = v; }, plainText: true });
  if (book.subtitle) items.push({ get: () => book.subtitle, set: (v) => { book.subtitle = v; }, plainText: true });
  for (const ch of book.chapters) {
    if (ch.title) items.push({ get: () => ch.title, set: (v) => { ch.title = v; }, plainText: true });
    for (const b of ch.blocks) {
      if (!b.runs || !plain(b.runs).trim()) continue;
      items.push({ get: () => runsToHtml(b.runs), set: (v) => { b.runs = htmlToRuns(v); } });
    }
  }
  return items;
}

function batches(items, maxChars, maxCount) {
  const out = []; let cur = []; let n = 0;
  for (const it of items) {
    const len = it.get().length;
    if (cur.length && (n + len > maxChars || cur.length >= maxCount)) { out.push(cur); cur = []; n = 0; }
    cur.push(it); n += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- Google

async function googleLanguages(key) {
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2/languages?target=en&key=${encodeURIComponent(key)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Google rejected the API key.');
  return j.data.languages.map((l) => ({ code: l.language, name: l.name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function googleTranslate(texts, target, key, source) {
  const body = { q: texts, target, format: 'html' };
  if (source) body.source = source;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j.data.translations.map((t) => t.translatedText);
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    throw new Error(j.error?.message || `Google Translate failed (${r.status}).`);
  }
}

// ---------------------------------------------------------------- Claude

async function claudeTranslate(texts, language, key) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false },
      },
    },
    system: `You are a literary translator. Translate each item of the JSON array the user sends into ${language}. Keep the meaning, tone, dialogue style and paragraph boundaries of a published book. Keep any <i> and <b> tags around the matching translated words. Return exactly one translated item for each input item, in the same order.`,
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The translator declined part of this book.');
  if (response.stop_reason === 'max_tokens') throw new Error('A part of the book was too long to translate in one go.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const items = JSON.parse(text).items;
  if (!Array.isArray(items) || items.length !== texts.length) throw new Error('The translation came back incomplete. Please try again.');
  return items;
}

// ---------------------------------------------------------------- main

async function translateBook(book, { engine, target, language, googleKey, claudeKey, source }, onProgress = () => {}) {
  const copy = JSON.parse(JSON.stringify(book));
  const items = collect(copy);
  const groups = engine === 'claude' ? batches(items, 12000, 80) : batches(items, 25000, 120);
  let done = 0;
  for (const g of groups) {
    const texts = g.map((it) => (it.plainText ? runsToHtml([{ text: it.get() }]) : it.get()));
    const out = engine === 'claude'
      ? await claudeTranslate(texts, language || target, claudeKey)
      : await googleTranslate(texts, target, googleKey, source);
    g.forEach((it, i) => it.set(it.plainText ? plain(htmlToRuns(out[i])) : out[i]));
    done += g.length;
    onProgress(done / items.length);
  }
  copy.lang = target || 'und';
  copy.rtl = RTL.test(copy.lang);
  return copy;
}

module.exports = { translateBook, googleLanguages, RTL };
