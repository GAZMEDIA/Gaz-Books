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
  // Cover maths: same as Amazon's cover calculator.
  const { coverSize, printEstimate } = require('../src/cover');
  const c = coverSize({ trim: '6x9', pages: 240, paper: 'white' });
  assert.strictEqual(c.spine, 0.54);
  assert.strictEqual(c.width, 12.79);
  assert.strictEqual(c.height, 9.25);
  assert.strictEqual(coverSize({ trim: '5x8', pages: 300, paper: 'cream' }).width, 11);
  assert.strictEqual(coverSize({ trim: '6x9', pages: 60 }).spineText, false);
  assert.strictEqual(printEstimate({ trim: '6x9', pages: 240 }).printCost, 3.88);
  console.log('cover sizes ok');

  // Picture search, with a pretend Openverse.
  const realFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true, json: async () => ({ results: [
      { id: 'a', url: 'https://x/a.jpg', thumbnail: 'https://x/a-t.jpg', width: 5000, height: 3500, creator: 'Ada', license: 'by', license_version: '4.0', foreign_landing_url: 'https://x/a' },
      { id: 'b', url: 'https://x/b.jpg', width: 800, height: 600, license: 'cc0' },
    ] }),
  });
  const { searchImages } = require('../src/images');
  const found = await searchImages({ query: 'river', orientation: 'landscape', minPx: c.px });
  global.fetch = realFetch;
  assert.deepStrictEqual(found.map((f) => f.id), ['a']);
  assert.ok(found[0].needsCredit);
  console.log('picture search ok');

  // Plan codes: made like the website does (letter, end day, base58 signature).
  const crypto = require('crypto');
  const lic = require('../src/license');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (buf) => { let n = BigInt(`0x${buf.toString('hex')}`); let o = ''; while (n > 0n) { o = A[Number(n % 58n)] + o; n /= 58n; } return o; };
  const make = (email, L, ymd) => `${L}${ymd}-${b58(crypto.sign(null, Buffer.from(`gazbook-plan-v1|${email}|${L}|${ymd}`), privateKey)).match(/.{1,8}/g).join('-')}`;
  const code = make('jo@example.com', 'W', '20271027');
  assert.deepStrictEqual(lic.readCode(' Jo@Example.com ', code, pub).features, ['format', 'cover']);
  assert.strictEqual(lic.readCode('someone@else.com', code, pub), null);
  assert.strictEqual(lic.readCode('jo@example.com', code.replace('W', 'T'), pub), null);
  assert.strictEqual(lic.readCode('jo@example.com', make('jo@example.com', 'T', '20991231'), pub).forever, true);
  const day = Date.parse('2026-10-27T12:00:00Z');
  assert.strictEqual(lic.licenseState({ firstRun: '2026-10-25' }, day).daysLeft, 5);
  const locked = lic.licenseState({ firstRun: '2026-10-01' }, day);
  assert.strictEqual(locked.kind, 'locked');
  assert.throws(() => lic.need(locked, 'format'), /trial has ended/);
  assert.throws(() => lic.need({ kind: 'plan', features: ['format'] }, 'cover'), /Writer plan/);
  console.log('plan codes ok');

  // Amazon kit: metadata rules, description HTML, the marketing kit Word file
  const { checkMetadata, fileChecks } = require('../src/review');
  const { makeKitDocx, kitBlocks, descriptionHtml } = require('../src/kit-docx');
  const kws = ['river novel', 'free kindle books', 'bestseller fiction', ...Array.from({ length: 15 }, (_, i) => `keyword ${i}`)];
  const meta = checkMetadata({ description: 'A **great** read.', keywords: kws, categories: Array(9).fill('Books > Fiction') }, { title: 'The River' });
  assert.strictEqual(meta.listing.keywords.length, 14);
  assert.ok(!meta.listing.keywords.some((k) => /free|bestseller/.test(k)));
  assert.strictEqual(meta.listing.categories.length, 7);
  assert.strictEqual(descriptionHtml('Hook.\n\n• **Fast** results\n• Clear steps\n\nBuy now.'), '<p>Hook.</p><ul><li><b>Fast</b> results</li><li>Clear steps</li></ul><p>Buy now.</p>');
  const kitDoc = await makeKitDocx(kitBlocks({ book: { title: 'The River', author: 'Ada' }, language: 'German', translated: true, files: [], listing: meta.listing,
    metaWarnings: meta.warnings, changes: [{ before: 'teh', after: 'the', why: 'typo' }, { before: 'teh', after: 'the', why: 'typo' }],
    fileChecks: fileChecks({ pageCount: 120, trim: '6x9', pdfMade: true, cover: true }) }));
  const xml = await (await require('jszip').loadAsync(kitDoc)).file('word/document.xml').async('string');
  assert.ok(xml.includes('2 times') && xml.includes('native German speaker') && xml.includes('Jesaja 61,3'));
  console.log('amazon kit ok');
  console.log('All good.');
})().catch((e) => { console.error(e); process.exit(1); });
