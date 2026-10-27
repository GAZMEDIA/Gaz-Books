// Translates a whole book, keeping italic and bold.
// Engines:
//  - Google free ('gfree'): the free web translator (the one Google's own
//    pages use), no key, about 250 languages. Google can slow it down or
//    block it at any time, so it waits between parts and retries.
//  - On this computer ('offline'): M2M100 (MIT licence) running in the app,
//    free, about 100 languages; see app/offline-main.js.
//  - Google Translate ('google'): the paid Cloud API, needs an API key.
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

// ---------------------------------------------------------------- Google free

const GFREE = 'https://translate.googleapis.com/translate_a';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function googleFreeLanguages() {
  const r = await fetch(`${GFREE}/l?client=gtx&hl=en`);
  if (!r.ok) throw new Error(`Could not load the language list (${r.status}). Check the internet connection.`);
  const j = await r.json();
  return Object.entries(j.tl || {}).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function googleFreeOne(text, target, source) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${GFREE}/single?client=gtx&dt=t&sl=${encodeURIComponent(source || 'auto')}&tl=${encodeURIComponent(target)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 GazBook' },
      body: new URLSearchParams({ q: text }).toString(),
    });
    if (r.ok) {
      const j = await r.json();
      return (j[0] || []).map((seg) => seg[0] || '').join('');
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { await wait(3000 * 2 ** attempt); continue; }
    throw new Error(r.status === 429
      ? 'Google\'s free translator is busy right now. Wait an hour and try again, or use another translator.'
      : `Google's free translator failed (${r.status}).`);
  }
}

// Paragraphs go together, a blank line between each, and come back the same
// way. If the count doesn't match, each one is sent on its own.
async function googleFreeTranslate(texts, target, source) {
  // it sometimes drops the space before or after <i>…</i>
  // it also turns &lt; back into <, which would read as a tag
  const esc = (t) => t.trim().replace(/<(?!\/?(i|b)>)/g, '&lt;');
  const fix = /^(zh|ja|ko|th|lo|km|my)/.test(target) ? esc
    : (t) => esc(t).replace(/([^\s(“"'‘])<(i|b)>/g, '$1 <$2>').replace(/<\/(i|b)>([^\s.,;:!?)”"'’…—-])/g, '</$1> $2');
  const out = (await googleFreeOne(texts.join('\n\n'), target, source)).split(/\n\s*\n/).map(fix);
  if (out.length === texts.length) return out;
  const one = [];
  for (const t of texts) { one.push(fix(await googleFreeOne(t, target, source))); await wait(300); }
  return one;
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

// ---------------------------------------------------------------- Gemini

async function geminiTranslate(texts, language, key) {
  const { items } = await require('./ai').aiJson({ geminiKey: key }, {
    system: `You are a literary translator. Translate each item of the JSON array the user sends into ${language}. Keep the meaning, tone, dialogue style and paragraph boundaries of a published book. Keep any <i> and <b> tags around the matching translated words. Return exactly one translated item for each input item, in the same order.`,
    prompt: JSON.stringify(texts),
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
  });
  if (!Array.isArray(items) || items.length !== texts.length) throw new Error('The translation came back incomplete. Please try again.');
  return items;
}

// ---------------------------------------------------------------- main

// One group of texts (HTML with <i>/<b>) through the chosen engine.
async function translateTexts(texts, { engine, target, language, googleKey, claudeKey, geminiKey, source, offline }) {
  if (engine === 'gemini') return geminiTranslate(texts, language || target, geminiKey);
  if (engine === 'claude') return claudeTranslate(texts, language || target, claudeKey);
  if (engine === 'gfree') { const out = await googleFreeTranslate(texts, target, source); await wait(400); return out; }
  if (engine === 'offline') return offline(texts, source || 'en', target);
  return googleTranslate(texts, target, googleKey, source);
}

// Plain strings (cover words): lines are translated one by one and put back together.
async function translateStrings(strings, t) {
  const lines = []; const where = [];
  strings.forEach((s, i) => String(s || '').split('\n').forEach((line, j) => { if (line.trim()) { lines.push(runsToHtml([{ text: line }])); where.push([i, j]); } }));
  const out = strings.map((s) => String(s || '').split('\n'));
  for (let k = 0; k < lines.length; k += 40) {
    const got = await translateTexts(lines.slice(k, k + 40), t);
    got.forEach((h, n) => { const [i, j] = where[k + n]; out[i][j] = plain(htmlToRuns(h)); });
  }
  return out.map((l) => l.join('\n'));
}

// offline: async (texts, source, target) => texts, for the 'offline' engine
async function translateBook(book, { engine, target, language, googleKey, claudeKey, geminiKey, source, offline }, onProgress = () => {}) {
  const copy = JSON.parse(JSON.stringify(book));
  const items = collect(copy);
  const groups = engine === 'claude' || engine === 'gemini' ? batches(items, 12000, 80)
    : engine === 'gfree' ? batches(items, 4000, 40)
      : engine === 'offline' ? batches(items, 2000, 8) : batches(items, 25000, 120);
  let done = 0;
  for (const g of groups) {
    const texts = g.map((it) => (it.plainText ? runsToHtml([{ text: it.get() }]) : it.get()));
    const out = await translateTexts(texts, { engine, target, language, googleKey, claudeKey, geminiKey, source, offline });
    g.forEach((it, i) => it.set(it.plainText ? plain(htmlToRuns(out[i])) : out[i]));
    done += g.length;
    onProgress(done / items.length);
  }
  copy.lang = target || 'und';
  copy.rtl = RTL.test(copy.lang);
  return copy;
}

module.exports = { collect, batches, translateBook, translateStrings, googleLanguages, googleFreeLanguages, googleFreeTranslate, htmlToRuns, runsToHtml, RTL };
