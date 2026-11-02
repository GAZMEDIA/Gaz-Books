// The one-minute promise, measured: a 50,000-word book translated on this
// computer and made into paperback PDF, Kindle EPUB and Word, in each language.
// Uses a test translator of the real size with random weights (built by
// translator/make_test_model.py), served from a local copy of the download
// page, so it needs no internet. The words come out as nonsense; the time is real.
//   node test/speed.js [languages, default "fr de es"] [seconds allowed, default 60]
const fs = require('fs');
const os = require('os');
const path = require('path');

const langs = (process.argv[2] || 'fr de es').split(/[ ,]+/).filter(Boolean);
const budget = Number(process.argv[3] || 60);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gazbook-speed-'));

function bookText(words) {
  const S = ['The rain had not stopped for three days, and the river beside the old market was rising faster than anyone wanted to admit',
    '"We can\'t stay here," Amaka said, pulling her wrapper tighter against the wind',
    'Her brother looked at the sky as if it owed him an explanation, then he laughed, because there was nothing else to do',
    'Nobody in the village remembered a storm like this one, not even Mama Ngozi, who remembered everything',
    'They walked past the shuttered shops, the *silent* radio stalls, and the church whose bell had rung all night',
    'It was extraordinary, the way ordinary people became brave when there was no other choice',
    '\'Tell me what you saw,\' the old man whispered, and for a long moment no one answered him',
    'By morning the water had reached the third step of the schoolhouse, and the children were counting the steps that remained'];
  const W = 'quietly slowly suddenly gently bravely sadly softly firmly early late again together alone outside upstairs downstairs nearby tonight yesterday tomorrow'.split(' ');
  const P = 'Lagos Enugu Limbe Accra Kumasi Douala Buea Nsukka Kano Ibadan Abuja Owerri'.split(' ');
  let md = '# The River Remembers\n\nby Jones Jnr\n\n';
  let n = 0; let c = 0; let k = 0;
  while (n < words) {
    md += `# Chapter ${++c}\n\n`;
    for (let p = 0; p < 40 && n < words; p++) {
      // every sentence different, like a real book (the translator skips repeats)
      const para = [0, 1, 2, 3].map(() => { k++; return `${S[k % S.length]}, ${W[k % W.length]} in ${P[Math.floor(k / 8) % P.length]} in ${1950 + (k % 70)}, ${W[Math.floor(k / 3) % W.length]}.`; }).join(' ');
      md += `${para}\n\n`;
      n += para.split(' ').length;
    }
  }
  return md;
}

(async () => {
  const t0 = Date.now();
  const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  // 1. a test translator, packed like the real download page
  const text = bookText(50000);
  const tt = await require('./test-translator').testTranslator(langs, text);
  process.env.GAZBOOK_MODELS_URL = tt.url;
  const modelsDir = path.join(work, 'installed');

  const { readBook, buildAll } = require('../src/engine');
  const { offlineTranslate } = require('../app/offline-main');
  const { stopWorker } = require('../src/fast-translate');
  const { book, summary } = await readBook(Buffer.from(text), 'book.md');
  console.log(`Book: ${summary.words.toLocaleString()} words, ${summary.chapters.length} chapters`);

  // 2. first use: download each language once (not part of the minute)
  for (const l of langs) await offlineTranslate(['Hello.'], 'en', l, { cacheDir: modelsDir });
  console.log(`Translators ready after ${lap()}`);

  // 3. the timed part: the whole one-click job (English + every language, all files, zip)
  const { makeEverything, finish } = require('../src/quick');
  const start = Date.now();
  const out = path.join(work, 'out');
  const res = await makeEverything(book, {
    languages: ['en', ...langs], trim: '6x9', folder: out,
    aboutAuthor: { text: 'Jones Jnr is a writer from Limbe. He writes about rivers, rain and the people who live beside them.\n\nHe has five children.' },
  }, { offline: (texts, src, tgt, onPart) => offlineTranslate(texts, src, tgt, { cacheDir: modelsDir, onProgress: onPart }) });
  await finish(res); // Google Play folder and the zip, as "Finish my books" does
  let failed = false;
  for (const e of res.editions) {
    const kinds = e.files.map((f) => path.basename(f).split(' - ').pop());
    console.log(`  ${e.name}: ${e.pages} pages; ${kinds.join(', ')}`);
    if (!e.printMade) failed = true;
  }
  console.log(`  zip: ${(fs.statSync(res.zipPath).size / 1e6).toFixed(1)} MB; kind of book: ${res.genre}`);
  const total = (Date.now() - start) / 1000;
  const cores = os.cpus().length;
  console.log(`\nEnglish + ${langs.length} translation${langs.length > 1 ? 's' : ''} in ${total.toFixed(1)} s on ${cores} CPU cores (allowed: ${budget} s)`);
  stopWorker();
  tt.close();
  fs.rmSync(work, { recursive: true, force: true });
  if (failed) { console.error('A paperback PDF is missing.'); process.exit(1); }
  if (total > budget) { console.error(`Too slow: ${total.toFixed(1)} s is more than ${budget} s.`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
