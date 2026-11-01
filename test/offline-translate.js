// The real on-computer translator: downloads French from GazBook's models-v1
// release and translates two lines (run in CI on Windows).
//   node test/offline-translate.js <folder for the language files>
// Skipped (not failed) until the "Build translator files" workflow has made the release.
const { offlineTranslate } = require('../app/offline-main');
const { MODELS_URL, stopWorker } = require('../src/fast-translate');

(async () => {
  const r = await fetch(`${MODELS_URL}manifest.json`).catch(() => null);
  if (!r || !r.ok) { console.log('No translator release yet: run "Build translator files" on GitHub first. Skipping.'); return; }
  let last = '';
  const out = await offlineTranslate(['The river was <i>quiet</i> that morning.', 'She opened the letter. Then she smiled.'], 'en', 'fr', {
    cacheDir: process.argv[2] || 'models',
    onStatus: (m) => { const pct = m.split(': ').pop(); if (pct !== last && /0%$/.test(pct)) console.log(m); last = pct; },
  });
  console.log(out);
  stopWorker();
  if (out.length !== 2 || !out.every((t) => t.trim()) || /river/i.test(out[0])) throw new Error('offline translation looks wrong');
  console.log('offline translator ok');
})().catch((e) => { console.error(e); process.exit(1); });
