// Spelling check that works with no internet: Hunspell dictionaries (the same
// kind LibreOffice uses) for the main book languages. It only finds the
// sentences with unknown words; the AI then fixes those sentences.
const fs = require('fs');
const path = require('path');

const DICTS = { en: 'dictionary-en', de: 'dictionary-de', fr: 'dictionary-fr', es: 'dictionary-es', pt: 'dictionary-pt', nl: 'dictionary-nl', it: 'dictionary-it' };
const NAMES = { english: 'en', german: 'de', deutsch: 'de', french: 'fr', spanish: 'es', portuguese: 'pt', dutch: 'nl', italian: 'it' };
const loaded = {};

function codeFor(code, language) {
  const c = String(code || '').toLowerCase().split('-')[0];
  if (DICTS[c]) return c;
  return NAMES[String(language || '').toLowerCase().split(/[\s(]/)[0]] || '';
}

function checker(code) {
  if (!DICTS[code]) return null;
  if (!loaded[code]) {
    const nspell = require('nspell');
    const dir = path.join(__dirname, '..', 'node_modules', DICTS[code]);
    loaded[code] = nspell(fs.readFileSync(path.join(dir, 'index.aff')), fs.readFileSync(path.join(dir, 'index.dic')));
  }
  return loaded[code];
}

const sentences = (t) => t.split(/(?<=[.!?…]["”’»)]*)\s+(?=\S)/);

// texts: plain paragraphs. Returns [{ para, index, sentence, words }] for
// sentences with unknown words. Names (capitals) and words the book uses
// often are left alone.
function findSuspects(texts, { code, language } = {}) {
  const c = codeFor(code, language);
  const sp = checker(c);
  if (!sp) return { supported: false, suspects: [] };
  const counts = {};
  for (const t of texts) for (const w of t.match(/\p{L}+(?:['’]\p{L}+)?/gu) || []) counts[w] = (counts[w] || 0) + 1;
  const suspects = [];
  texts.forEach((t, para) => {
    sentences(t).forEach((sentence, index) => {
      const words = (sentence.match(/\p{L}+(?:['’]\p{L}+)?/gu) || [])
        .filter((w) => !/^\p{Lu}/u.test(w) && counts[w] < 3 && w.length > 1 && !sp.correct(w.replace(/’/g, "'")));
      if (words.length) suspects.push({ para, index, sentence, words: [...new Set(words)] });
    });
  });
  return { supported: true, suspects };
}

module.exports = { findSuspects, codeFor, sentences };
