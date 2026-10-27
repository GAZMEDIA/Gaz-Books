// Quick check: make a sample book, read it from .md, .docx and .pdf, and
// build all three outputs from each. Files land in test/out/.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readBook, buildAll } = require('../src/engine');

const dir = __dirname;
const out = path.join(dir, 'out');
fs.mkdirSync(out, { recursive: true });
require('./mksample');

(async () => {
  const expected = ['Chapter 1: The Storm', 'Chapter 2: Market Day', 'Chapter 3', 'Chapter 4: The Bell', 'Chapter 5: What the Water Took', 'Chapter 6', 'Chapter 7: Home'];
  const md = await readBook(fs.readFileSync(path.join(dir, 'sample.md')), 'sample.md');
  assert.deepStrictEqual(md.summary.chapters, expected);
  assert.strictEqual(md.summary.author, 'Jones Jnr');
  const r = await buildAll(md.book, { trim: '6x9' });
  for (const f of r.files) fs.writeFileSync(path.join(dir, `sample.${f.kind}`), f.buffer);
  for (const f of r.files) fs.writeFileSync(path.join(out, f.name), f.buffer);
  console.log(`md: ${r.pageCount} pages, ${r.files.length} files`);

  for (const ext of ['docx', 'pdf']) {
    const again = await readBook(fs.readFileSync(path.join(dir, `sample.${ext}`)), `sample.${ext}`);
    assert.deepStrictEqual(again.summary.chapters, expected, `${ext} chapters`);
    assert.strictEqual(again.summary.title, 'The River Remembers', `${ext} title`);
    assert.ok(Math.abs(again.summary.words - md.summary.words) < md.summary.words * 0.02, `${ext} words ${again.summary.words} vs ${md.summary.words}`);
    for (const trim of ['5x8', '8.5x11']) {
      const b = await buildAll(again.book, { trim });
      assert.strictEqual(b.files.length, 3);
      console.log(`${ext} -> ${trim}: ${b.pageCount} pages`);
    }
  }
  console.log('All good.');
})().catch((e) => { console.error(e); process.exit(1); });
