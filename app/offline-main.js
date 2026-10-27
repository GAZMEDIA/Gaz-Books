// The free translator that runs on this computer: Meta's M2M100 (418M, MIT
// licence, about 100 languages) through Transformers.js and ONNX Runtime.
// The model (about 500 MB) is downloaded once, the first time it is used,
// into the app's own folder; after that it works without the internet.
const path = require('path');
const { plain } = require('../src/read');
const { htmlToRuns, runsToHtml } = require('../src/translate');

const MODEL = 'Xenova/m2m100_418M';
// the languages M2M100 knows (ISO 639 codes, as the model names them)
const CODES = 'af am ar ast az ba be bg bn br bs ca ceb cs cy da de el en es et fa ff fi fr fy ga gd gl gu ha he hi hr ht hu hy id ig ilo is it ja jv ka kk km kn ko lb lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl ps pt ro ru sd si sk sl so sq sr ss su sv sw ta th tl tn tr uk ur uz vi wo xh yi yo zh zu'.split(' ');
const NAMES = { ns: 'Northern Sotho', ff: 'Fula', ilo: 'Ilocano', ast: 'Asturian', ceb: 'Cebuano' };

function offlineLanguages() {
  const dn = new Intl.DisplayNames(['en'], { type: 'language' });
  return CODES.map((code) => ({ code, name: NAMES[code] || dn.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));
}

let loading = null;
function translator(cacheDir, onStatus) {
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = require('@huggingface/transformers');
      env.cacheDir = cacheDir;
      env.allowLocalModels = false;
      const seen = {};
      return pipeline('translation', MODEL, {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          seen[p.file] = [p.loaded, p.total];
          const [l, t] = Object.values(seen).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
          onStatus(`Downloading the free translator (only the first time, about 500 MB): ${Math.round((l / t) * 100)}%`);
        },
      });
    })().catch((e) => { loading = null; throw new Error(`The free translator could not be downloaded. Check the internet connection and try again. (${e.message})`); });
  }
  return loading;
}

// Long paragraphs go sentence by sentence: the model is best at short pieces.
const sentences = (t) => t.split(/(?<=[.!?…]["”’')]*)\s+(?=\S)/).filter((s) => s.trim());

// texts: HTML with <i>/<b>; the model can't keep those, so it gets plain text.
async function offlineTranslate(texts, source, target, { cacheDir, onStatus = () => {} }) {
  if (!CODES.includes(target)) throw new Error('The free translator on this computer does not know that language. Try Google free instead.');
  const src = CODES.includes(source) ? source : 'en';
  const t = await translator(cacheDir || path.join(require('electron').app.getPath('userData'), 'models'), onStatus);
  const out = [];
  for (const html of texts) {
    const parts = sentences(plain(htmlToRuns(html)));
    const done = [];
    for (let i = 0; i < parts.length; i += 8) {
      const r = await t(parts.slice(i, i + 8), { src_lang: src, tgt_lang: target, max_new_tokens: 400 });
      done.push(...(Array.isArray(r) ? r : [r]).map((x) => x.translation_text));
    }
    out.push(runsToHtml([{ text: done.join(' ') }]));
  }
  return out;
}

module.exports = { offlineTranslate, offlineLanguages, OFFLINE_CODES: CODES };
