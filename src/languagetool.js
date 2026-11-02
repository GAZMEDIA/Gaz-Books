// Free spelling and grammar check with no key: LanguageTool's public service
// (about 30 languages). Used when Gemini is busy or out of allowance, so the
// book is still corrected. Limits: 20 requests and 75 KB a minute, 20 KB a
// request, so text goes in pieces with a pause between them.
const { plain } = require('./read');

const API = 'https://api.languagetool.org/v2/check';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SAFE = new Set(['misspelling', 'grammar', 'typographical', 'duplication']);

// LanguageTool needs a regional variant for some languages to check spelling.
function ltLanguage(code, styleSheet = {}) {
  const c = String(code || '').toLowerCase();
  if (!c) return { language: 'auto', preferredVariants: /uk|brit/i.test(styleSheet.spelling || '') ? 'en-GB,de-DE,pt-PT,ca-ES' : 'en-US,de-DE,pt-PT,ca-ES' };
  const map = { en: /uk|brit/i.test(styleSheet.spelling || '') ? 'en-GB' : 'en-US', de: 'de-DE', pt: 'pt-PT', ca: 'ca-ES', nl: 'nl', fr: 'fr', es: 'es', it: 'it', pl: 'pl-PL', ru: 'ru-RU', uk: 'uk-UA', sv: 'sv', da: 'da-DK', el: 'el-GR', ro: 'ro-RO', sk: 'sk-SK', sl: 'sl-SI', ga: 'ga-IE', gl: 'gl-ES', ja: 'ja-JP', zh: 'zh-CN', ar: 'ar', fa: 'fa', ta: 'ta-IN', tl: 'tl-PH', be: 'be-BY', br: 'br-FR', km: 'km-KH', eo: 'eo', ast: 'ast-ES' };
  return map[c.split('-')[0]] ? { language: map[c.split('-')[0]] } : null;
}

// Replace text inside a paragraph's runs (keeping italics and bold), but only
// where the change sits inside one run.
function applyToRuns(runs, fixes) {
  const out = runs.map((r) => ({ ...r }));
  const starts = []; let n = 0;
  for (const r of out) { starts.push(n); n += r.text.length; }
  for (const f of [...fixes].sort((a, b) => b.offset - a.offset)) {
    const i = starts.findIndex((s, k) => f.offset >= s && f.offset + f.length <= s + out[k].text.length);
    if (i < 0) continue;
    const at = f.offset - starts[i];
    out[i].text = out[i].text.slice(0, at) + f.value + out[i].text.slice(at + f.length);
  }
  return out;
}

// paragraphs: [{ runs, set(runs) }]; returns the list of changes made.
async function languageToolFix(paragraphs, { code, styleSheet, onProgress = () => {} } = {}) {
  const lang = ltLanguage(code, styleSheet);
  if (!lang) return { changes: [], unsupported: true };
  // words used often in the book are names or the author's terms: leave them
  const counts = {};
  for (const p of paragraphs) for (const w of plain(p.runs).match(/\p{L}+/gu) || []) counts[w] = (counts[w] || 0) + 1;

  const changes = [];
  let i = 0;
  while (i < paragraphs.length) {
    const group = []; let size = 0;
    while (i < paragraphs.length && (group.length === 0 || size + plain(paragraphs[i].runs).length < 18000)) {
      group.push(paragraphs[i]); size += plain(paragraphs[i].runs).length + 2; i++;
    }
    const texts = group.map((p) => plain(p.runs));
    const text = texts.join('\n\n');
    let j = null;
    for (let attempt = 0; attempt < 4 && !j; attempt++) {
      const form = new URLSearchParams({ text, ...lang, level: 'default' });
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'User-Agent': 'GazBook/1.3 (gazgoc.com.ng)' }, body: form }).catch(() => null);
      if (r && r.ok) j = await r.json();
      else await wait(r && r.status === 429 ? 30000 : 5000);
    }
    if (!j) throw new Error('The free spelling checker (LanguageTool) could not be reached.');
    // map each match back to its paragraph
    const starts = []; let n = 0;
    for (const t of texts) { starts.push(n); n += t.length + 2; }
    const perPara = group.map(() => []);
    for (const m of j.matches || []) {
      const type = m.rule?.issueType;
      const value = m.replacements?.[0]?.value;
      if (!SAFE.has(type) || value === undefined) continue;
      const k = starts.findLastIndex((s) => m.offset >= s);
      const local = m.offset - starts[k];
      const before = texts[k].slice(local, local + m.length);
      if (local + m.length > texts[k].length) continue;
      if (type === 'misspelling' && (/^\p{Lu}/u.test(before) || (counts[before] || 0) >= 3)) continue; // names and the author's own words
      perPara[k].push({ offset: local, length: m.length, value });
      changes.push({ before, after: value, why: m.shortMessage || m.message?.slice(0, 60) || type });
    }
    group.forEach((p, k) => { if (perPara[k].length) p.set(applyToRuns(p.runs, perPara[k])); });
    onProgress(i / paragraphs.length);
    if (i < paragraphs.length) await wait(3500);
  }
  return { changes };
}

module.exports = { languageToolFix, applyToRuns, ltLanguage };
