// Downloads the free on-computer translator and translates two lines (run in CI on Windows):
//   node test/offline-translate.js <cacheDir>
const { offlineTranslate } = require('../app/offline-main');

(async () => {
  let last = '';
  const out = await offlineTranslate(['The river was <i>quiet</i> that morning.', 'She opened the letter. Then she smiled.'], 'en', 'fr', {
    cacheDir: process.argv[2] || 'models',
    onStatus: (m) => { const pct = m.split(': ').pop(); if (pct !== last && /0%$/.test(pct)) console.log(m); last = pct; },
  });
  console.log(out);
  if (out.length !== 2 || !out.every((t) => t.trim()) || /river/i.test(out[0])) throw new Error('offline translation looks wrong');
  console.log('offline translator ok');
})().catch((e) => { console.error(e); process.exit(1); });
