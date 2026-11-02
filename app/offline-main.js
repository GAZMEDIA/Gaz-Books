// The free translator that runs on this computer (see src/fast-translate.js):
// no keys, no fees, every CPU core. Each language's files (about 75 MB) are
// downloaded once, the first time that language is used; after that it
// works without the internet.
const path = require('path');
const { plain } = require('../src/read');
const { htmlToRuns, runsToHtml } = require('../src/translate');
const { translatePlain, fastLanguageCodes } = require('../src/fast-translate');
const { KDP_LANGUAGES, kdpLanguage } = require('../src/kdp-languages');

const modelsDir = () => process.env.GAZBOOK_TRANSLATOR_DIR || path.join(require('electron').app.getPath('userData'), 'models', 'translator');

function offlineLanguages() {
  const have = fastLanguageCodes(modelsDir());
  return KDP_LANGUAGES.filter((l) => l.code !== 'en' && (!have || have.includes(l.code))).map((l) => ({ code: l.code, name: l.name }));
}

// texts: HTML with <i>/<b>. A paragraph that is all italic (or all bold)
// stays that way; mixed styling inside a paragraph becomes plain text.
async function offlineTranslate(texts, source, target, { cacheDir, onStatus = () => {}, onProgress = () => {} } = {}) {
  const runs = texts.map((h) => htmlToRuns(h));
  const style = runs.map((r) => {
    const t = r.filter((x) => x.text.trim());
    return { i: t.length > 0 && t.every((x) => x.i), b: t.length > 0 && t.every((x) => x.b) };
  });
  const out = await translatePlain(runs.map((r) => plain(r)), source || 'en', target, {
    modelsDir: cacheDir || modelsDir(), onStatus, onProgress, languageName: (kdpLanguage(target) || {}).name,
  });
  return out.map((t, k) => runsToHtml([{ text: t, ...(style[k].i ? { i: true } : {}), ...(style[k].b ? { b: true } : {}) }]));
}

module.exports = { offlineTranslate, offlineLanguages, modelsDir };
